/**
 * Automerge document worker for Freed PWA
 *
 * Runs in a dedicated Web Worker so ALL WASM operations (A.change, A.save,
 * A.load, A.merge) happen off the main thread. The main thread never blocks
 * on CRDT work — it only receives plain-JS state updates via postMessage.
 *
 * Communication protocol:
 *   Main → Worker : WorkerRequest  (typed action objects, no closures)
 *   Worker → Main : WorkerResponse (state updates + acks)
 */

import * as A from "@automerge/automerge";
import { IndexedDBStorage } from "@freed/sync/storage/indexeddb";
import {
  classifyDocumentLoadFailure,
  RepeatableAutomergePersistence,
  type AutomergePersistenceOptions,
} from "@freed/sync/storage/repeatable-automerge-persistence";
import { hashSavedUrl } from "@freed/capture-save/normalize";
import type { FreedDoc } from "@freed/shared/schema";
import {
  assertNonDestructiveMerge,
  compareDocumentHistories,
  createEmptyDoc,
  addAccount,
  addAccounts,
  backfillContentSignals,
  clearSampleData,
  countContentSignalBackfillItems,
  addFeedItem,
  hasLegacyIdentityGraphData,
  migrateLegacyIdentityGraph,
  addPerson,
  addRssFeed,
  summarizeDocContentSignals,
  removeRssFeed,
  removeAllFeeds,
  updateRssFeed,
  updateFeedItem,
  removeFeedItem,
  markAsRead,
  markItemsAsRead,
  toggleSaved,
  toggleArchived,
  archiveItemsById,
  archiveAllReadUnsaved,
  unarchiveSavedItems,
  pruneArchivedItems,
  deleteAllArchivedItems,
  updatePreferences,
  updateAccount,
  updatePerson,
  removeAccount,
  removePerson,
  logReachOut,
  toggleLiked,
  confirmLikedSynced,
  confirmSeenSynced,
} from "@freed/shared/schema";
import {
  countAuthorsWithRecentLocationUpdates,
  countFriendsWithRecentLocationUpdates,
  mergeDefaultPreferences,
  rankFeedItemsInRecommendedOrder,
  resolveDocumentId,
} from "@freed/shared";
import type {
  Account,
  FeedItem,
  Friend,
  LegacyDeviceContact,
  LegacyFriendSource,
  Person,
  RssFeed,
  UserPreferences,
} from "@freed/shared";
import type {
  DocState,
  WorkerErrorCode,
  WorkerRequest,
  WorkerResponse,
} from "./automerge-types";
import { materializePwaLibraryCoreFeedGeneration } from "./library-core-feed-materializer";
import { materializePwaLibraryCoreFeedBrowseGeneration } from "./library-core-feed-browse-materializer";
import { createPwaLibraryCoreFeedReaderRuntime } from "./library-core-feed-reader-runtime";

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

const storage = new IndexedDBStorage();
const persistence = new RepeatableAutomergePersistence(storage);
let libraryCoreFeedReader: ReturnType<
  typeof createPwaLibraryCoreFeedReaderRuntime
> | null = null;
let currentDoc: FreedDoc | null = null;
let searchCorpusVersion = 0;
let requestChain: Promise<void> = Promise.resolve();

function getLibraryCoreFeedReader() {
  libraryCoreFeedReader ??= createPwaLibraryCoreFeedReaderRuntime({
    databaseName: "freed-library-core-feed-v1",
    indexedDb: indexedDB,
    keyRange: IDBKeyRange,
    subtle: crypto.subtle,
  });
  return libraryCoreFeedReader;
}
let acceptingRequests = true;
let fatalPersistenceFailure: FatalPersistenceError | null = null;
const HYDRATED_FEED_ITEM_LIMIT = 2_500;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function send(msg: WorkerResponse): void {
  self.postMessage(msg);
}

class CorruptDocumentError extends Error {
  readonly code: WorkerErrorCode = "CORRUPT_DOCUMENT";

  constructor() {
    super("The stored Automerge document could not be loaded");
    this.name = "CorruptDocumentError";
  }
}

class DocumentLoadFailedError extends Error {
  readonly code: WorkerErrorCode = "DOCUMENT_LOAD_FAILED";

  constructor(byteLength: number, cause: unknown) {
    const detail = cause instanceof Error ? cause.message : String(cause);
    super(
      `Loading the stored Automerge document failed at ${byteLength.toLocaleString()} bytes: ${detail}`,
    );
    this.name = "DocumentLoadFailedError";
    this.cause = cause;
  }
}

class FatalPersistenceError extends Error {
  readonly code: Extract<
    WorkerErrorCode,
    "AUTOMERGE_PERSISTENCE_FAILED" | "STALE_DOCUMENT_REVISION"
  >;

  constructor(code: FatalPersistenceError["code"], cause: unknown) {
    const message = cause instanceof Error ? cause.message : String(cause);
    super(message);
    this.name = "FatalPersistenceError";
    this.code = code;
    this.cause = cause;
  }
}

function ack(reqId: number, error?: string, errorCode?: WorkerErrorCode): void {
  send({
    reqId,
    type: "ACK",
    ...(error ? { error } : {}),
    ...(errorCode ? { errorCode } : {}),
  });
}

function sendSyncBreadcrumb(detail: string, bytes?: number): void {
  send({
    type: "DEBUG_EVENT",
    kind: "merge_ok",
    detail: `[sync-worker] ${detail}`,
    bytes,
  });
}

function persistenceFailure(error: unknown): FatalPersistenceError {
  const code =
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    ((error as { code?: unknown }).code === "STALE_STORAGE_REVISION" ||
      (error as { code?: unknown }).code ===
        "STALE_AUTOMERGE_PERSISTENCE_STATE")
      ? "STALE_DOCUMENT_REVISION"
      : "AUTOMERGE_PERSISTENCE_FAILED";
  return new FatalPersistenceError(code, error);
}

async function persistCandidate(
  document: FreedDoc,
  options?: AutomergePersistenceOptions,
): Promise<void> {
  try {
    await persistence.persist(document, options);
  } catch (error) {
    throw persistenceFailure(error);
  }
}

function makeFatal(failure: FatalPersistenceError): FatalPersistenceError {
  if (!fatalPersistenceFailure) {
    fatalPersistenceFailure = failure;
    acceptingRequests = false;
    currentDoc = null;
    searchCorpusVersion = 0;
  }
  return fatalPersistenceFailure;
}

function toLegacyContact(account: Account): LegacyDeviceContact {
  const importedFrom: LegacyDeviceContact["importedFrom"] =
    account.provider === "google_contacts"
      ? "google"
      : account.provider === "macos_contacts"
        ? "macos"
        : account.provider === "ios_contacts"
          ? "ios"
          : account.provider === "android_contacts"
            ? "android"
            : "web";
  return {
    importedFrom,
    name: account.displayName ?? account.externalId,
    phone: account.phone,
    email: account.email,
    address: account.address,
    nativeId: account.externalId,
    importedAt: account.importedAt ?? account.createdAt,
  };
}

function projectLegacyFriends(
  persons: Record<string, Person>,
  accounts: Record<string, Account>,
): Record<string, Friend> {
  const accountsByPerson = new Map<string, Account[]>();
  for (const account of Object.values(accounts)) {
    if (!account.personId) continue;
    const group = accountsByPerson.get(account.personId);
    if (group) {
      group.push(account);
    } else {
      accountsByPerson.set(account.personId, [account]);
    }
  }

  return Object.fromEntries(
    Object.values(persons).map((person) => {
      const personAccounts = accountsByPerson.get(person.id) ?? [];
      const sources: LegacyFriendSource[] = personAccounts
        .filter((account) => account.kind === "social")
        .map((account) => ({
          platform: account.provider as LegacyFriendSource["platform"],
          authorId: account.externalId,
          handle: account.handle,
          displayName: account.displayName,
          avatarUrl: account.avatarUrl,
          profileUrl: account.profileUrl,
        }));
      const contactAccount = personAccounts.find(
        (account) => account.kind === "contact",
      );
      return [
        person.id,
        {
          ...person,
          sources,
          contact: contactAccount ? toLegacyContact(contactAccount) : undefined,
        },
      ];
    }),
  );
}

function migrateIdentityGraph(document: FreedDoc, message: string): FreedDoc {
  if (!hasLegacyIdentityGraphData(document)) return document;
  return A.change(document, message, (doc) => {
    migrateLegacyIdentityGraph(doc);
  });
}

function feedItemUpdatesAffectSearchCorpus(
  updates: Partial<FeedItem>,
): boolean {
  if (
    "author" in updates ||
    "contentSignals" in updates ||
    "content" in updates ||
    "contentType" in updates ||
    "preservedContent" in updates ||
    "publishedAt" in updates ||
    "rssSource" in updates ||
    "topics" in updates
  ) {
    return true;
  }

  if (!updates.userState) return false;
  return (
    "hidden" in updates.userState ||
    "tags" in updates.userState ||
    "highlights" in updates.userState
  );
}

/**
 * Convert the Automerge document to a DocState for postMessage.
 * A.view() creates a cheap immutable read view at the current heads. That avoids
 * the extra eager root clone from A.toJS(), which is expensive on iOS during a
 * large first cloud import.
 */
function hydrateFromDoc(doc: FreedDoc): DocState {
  const plain = A.view(doc, A.getHeads(doc)) as FreedDoc;
  const plainItems = Object.values(plain.feedItems as Record<string, FeedItem>);
  const feeds = plain.rssFeeds as Record<string, RssFeed>;
  const persons = (plain.persons ?? {}) as Record<string, Person>;
  const accounts = (plain.accounts ?? {}) as Record<string, Account>;
  const friends = projectLegacyFriends(persons, accounts);
  const preferences = mergeDefaultPreferences(
    plain.preferences as Partial<UserPreferences> | undefined,
  );

  const visibleItems = plainItems.filter((item) => !item.userState.hidden);
  const rankedItems = rankFeedItemsInRecommendedOrder(
    visibleItems,
    preferences.weights,
    { persons, accounts },
  );
  const hydratedItems =
    rankedItems.length > HYDRATED_FEED_ITEM_LIMIT
      ? rankedItems.slice(0, HYDRATED_FEED_ITEM_LIMIT)
      : rankedItems;
  const projectedItems = hydratedItems.map((item) => {
    if (!item.preservedContent || !("html" in item.preservedContent))
      return item;
    const preservedContent = { ...item.preservedContent };
    delete preservedContent.html;
    return { ...item, preservedContent };
  });

  const feedUnreadCounts: Record<string, number> = {};
  const feedTotalCounts: Record<string, number> = {};
  const unreadCountByPlatform: Record<string, number> = {};
  const itemCountByPlatform: Record<string, number> = {};
  const archivableCountByPlatform: Record<string, number> = {};
  const archivableFeedCounts: Record<string, number> = {};
  let totalUnreadCount = 0;
  let totalItemCount = 0;
  let totalArchivableCount = 0;

  for (const item of plainItems) {
    if (item.userState.hidden || item.userState.archived) continue;
    totalItemCount++;
    itemCountByPlatform[item.platform] =
      (itemCountByPlatform[item.platform] ?? 0) + 1;
    if (item.rssSource) {
      const url = item.rssSource.feedUrl;
      feedTotalCounts[url] = (feedTotalCounts[url] ?? 0) + 1;
    }
    if (!item.userState.readAt) {
      totalUnreadCount++;
      unreadCountByPlatform[item.platform] =
        (unreadCountByPlatform[item.platform] ?? 0) + 1;
      if (item.rssSource) {
        const url = item.rssSource.feedUrl;
        feedUnreadCounts[url] = (feedUnreadCounts[url] ?? 0) + 1;
      }
    } else if (!item.userState.saved) {
      totalArchivableCount++;
      archivableCountByPlatform[item.platform] =
        (archivableCountByPlatform[item.platform] ?? 0) + 1;
      if (item.rssSource) {
        const url = item.rssSource.feedUrl;
        archivableFeedCounts[url] = (archivableFeedCounts[url] ?? 0) + 1;
      }
    }
  }

  return {
    items: projectedItems,
    searchCorpusVersion,
    feeds,
    persons,
    accounts,
    friends,
    preferences,
    feedUnreadCounts,
    feedTotalCounts,
    totalUnreadCount,
    unreadCountByPlatform,
    totalItemCount,
    itemCountByPlatform,
    totalArchivableCount,
    archivableCountByPlatform,
    archivableFeedCounts,
    mapFriendLocationCount: countFriendsWithRecentLocationUpdates(
      rankedItems,
      persons,
      accounts,
    ),
    mapAllContentLocationCount:
      countAuthorsWithRecentLocationUpdates(rankedItems),
  };
}

/**
 * Broadcast only the already committed document and its derived state.
 *
 * Persistence, the live document pointer, the search revision, diagnostics,
 * and UI state advance in that order so a failed compare-and-swap cannot leak
 * a mutation that durable storage rejected.
 */
function broadcastCommitted(
  document: FreedDoc,
  syncBreadcrumbLabel?: string,
  mutation?: WorkerRequest["type"],
): void {
  const committed = persistence.snapshot();
  const binary = committed.bytes;
  if (!binary) {
    throw new Error("Committed Automerge document bytes are missing");
  }
  if (syncBreadcrumbLabel)
    sendSyncBreadcrumb(
      `${syncBreadcrumbLabel}: hydrating state`,
      binary.byteLength,
    );
  const state = hydrateFromDoc(document);
  if (syncBreadcrumbLabel)
    sendSyncBreadcrumb(
      `${syncBreadcrumbLabel}: posting state`,
      binary.byteLength,
    );

  const snapshot: Extract<WorkerResponse, { type: "DEBUG_SNAPSHOT" }> = {
    type: "DEBUG_SNAPSHOT",
    documentId: resolveDocumentId(document.meta),
    itemCount: Object.keys(document.feedItems ?? {}).length,
    feedCount: Object.keys(document.rssFeeds ?? {}).length,
    binarySize: binary.byteLength,
  };
  send(snapshot);

  if (state.items.length < state.totalItemCount) {
    send({
      type: "DEBUG_EVENT",
      kind: "change",
      detail:
        `[pwa] hydrated ${state.items.length.toLocaleString()} of ` +
        `${state.totalItemCount.toLocaleString()} visible items for mobile memory safety`,
      bytes: binary.byteLength,
    });
  }

  const stateUpdate: WorkerResponse = { type: "STATE_UPDATE", state, mutation };
  send(stateUpdate);
}

/**
 * Apply one candidate change and expose it only after its durable CAS commits.
 */
async function applyChange(
  changeFn: (doc: FreedDoc) => void,
  message: string,
  searchCorpusChanged = false,
  mutation?: WorkerRequest["type"],
): Promise<void> {
  if (!currentDoc) throw new Error("Document not initialized");
  const candidate = A.change(currentDoc, message, changeFn);
  const candidateSearchCorpusVersion = searchCorpusChanged
    ? searchCorpusVersion + 1
    : searchCorpusVersion;
  await persistCandidate(candidate);
  currentDoc = candidate;
  searchCorpusVersion = candidateSearchCorpusVersion;
  send({ type: "DEBUG_EVENT", kind: "change", detail: message });
  broadcastCommitted(candidate, undefined, mutation);
}

// ---------------------------------------------------------------------------
// Message handler
// ---------------------------------------------------------------------------

async function handleRequest(req: WorkerRequest): Promise<void> {
  try {
    switch (req.type) {
      case "QUIESCE":
        await libraryCoreFeedReader?.quiesce();
        ack(req.reqId);
        break;

      case "INIT": {
        const initStartedAt = performance.now();
        let loaded;
        try {
          loaded = await persistence.load<FreedDoc>();
        } catch (error) {
          let snapshot: ReturnType<typeof persistence.snapshot> | null = null;
          try {
            snapshot = persistence.snapshot();
          } catch {
            // Storage failed before a committed revision could be captured.
          }
          if (
            snapshot?.bytes &&
            classifyDocumentLoadFailure(error) === "corrupt"
          ) {
            throw new CorruptDocumentError();
          }
          throw new DocumentLoadFailedError(
            snapshot?.bytes?.byteLength ?? 0,
            error,
          );
        }

        const source = loaded.document ?? createEmptyDoc();
        const candidate = migrateIdentityGraph(
          source,
          "Migrate legacy identity graph",
        );
        if (!loaded.document || candidate !== source) {
          await persistCandidate(candidate);
        }

        currentDoc = candidate;
        searchCorpusVersion = 1;
        const committed = persistence.current();
        const documentId = resolveDocumentId(candidate.meta);
        send({
          type: "DEBUG_EVENT",
          kind: "init",
          detail: `document ...${documentId.slice(-8)}`,
        });
        broadcastCommitted(candidate);
        send({
          type: "INIT_STATS",
          durationMs: Math.round(performance.now() - initStartedAt),
          docBytes: committed.byteLength,
        });
        ack(req.reqId);
        break;
      }

      case "MARK_AS_READ":
        await applyChange(
          (doc) => markAsRead(doc, req.globalId),
          "Mark as read",
        );
        ack(req.reqId);
        break;

      case "MARK_ITEMS_AS_READ":
        await applyChange(
          (doc) => markItemsAsRead(doc, req.globalIds),
          `Mark ${req.globalIds.length.toLocaleString()} items as read`,
        );
        ack(req.reqId);
        break;

      case "MARK_ALL_AS_READ":
        await applyChange((doc) => {
          const now = Date.now();
          for (const item of Object.values(doc.feedItems)) {
            if (item.userState.readAt) continue;
            if (item.userState.hidden || item.userState.archived) continue;
            if (req.platform && item.platform !== req.platform) continue;
            item.userState.readAt = now;
          }
        }, "Mark all as read");
        ack(req.reqId);
        break;

      case "TOGGLE_SAVED":
        await applyChange(
          (doc) => toggleSaved(doc, req.globalId),
          "Toggle saved",
        );
        ack(req.reqId);
        break;

      case "TOGGLE_ARCHIVED":
        await applyChange(
          (doc) => toggleArchived(doc, req.globalId),
          "Toggle archived",
        );
        ack(req.reqId);
        break;

      case "ARCHIVE_ITEMS":
        await applyChange((doc) => {
          archiveItemsById(doc, req.globalIds);
        }, `Archive ${req.globalIds.length.toLocaleString()} items`);
        ack(req.reqId);
        break;

      case "TOGGLE_LIKED":
        await applyChange(
          (doc) => toggleLiked(doc, req.globalId),
          "Toggle liked",
        );
        ack(req.reqId);
        break;

      case "CONFIRM_LIKED_SYNCED":
        await applyChange(
          (doc) => confirmLikedSynced(doc, req.globalId, req.syncedAt),
          "Confirm liked synced",
        );
        ack(req.reqId);
        break;

      case "CONFIRM_SEEN_SYNCED":
        await applyChange(
          (doc) => confirmSeenSynced(doc, req.globalId, req.syncedAt),
          "Confirm seen synced",
        );
        ack(req.reqId);
        break;

      case "ADD_FEED_ITEM":
        await applyChange(
          (doc) => {
            if (!doc.feedItems[req.item.globalId]) addFeedItem(doc, req.item);
          },
          "Add feed item",
          true,
        );
        ack(req.reqId);
        break;

      case "ADD_FEED_ITEMS":
        await applyChange(
          (doc) => {
            for (const item of req.items) {
              if (!doc.feedItems[item.globalId]) addFeedItem(doc, item);
            }
          },
          `Add ${req.items.length} feed items`,
          true,
        );
        ack(req.reqId);
        break;

      case "ADD_SAMPLE_LIBRARY_DATA":
        await applyChange(
          (doc) => {
            for (const feed of req.feeds) {
              addRssFeed(doc, feed);
            }
            for (const item of req.items) {
              if (!doc.feedItems[item.globalId]) addFeedItem(doc, item);
            }
            for (const person of req.persons) {
              addPerson(doc, person);
            }
            addAccounts(doc, req.accounts);
          },
          `Add sample library data: ${req.items.length.toLocaleString()} items`,
          true,
        );
        ack(req.reqId);
        break;

      case "REMOVE_FEED_ITEM":
        await applyChange(
          (doc) => removeFeedItem(doc, req.globalId),
          "Remove feed item",
          true,
        );
        ack(req.reqId);
        break;

      case "CLEAR_SAMPLE_DATA": {
        let summary = { feeds: 0, items: 0, persons: 0, accounts: 0, total: 0 };
        await applyChange(
          (doc) => {
            summary = clearSampleData(doc);
          },
          "Clear sample data",
          true,
        );
        send({ reqId: req.reqId, type: "SAMPLE_DATA_CLEAR_RESULT", summary });
        break;
      }

      case "GET_DOC_BINARY": {
        if (!currentDoc) throw new Error("Document not initialized");
        const committed = persistence.snapshot();
        if (!committed.bytes) {
          throw new Error("Committed Automerge document bytes are missing");
        }
        send({
          reqId: req.reqId,
          type: "DOC_BINARY",
          binary: committed.bytes,
        });
        break;
      }

      case "GET_COMMITTED_DOC": {
        if (!currentDoc) throw new Error("Document not initialized");
        const committed = persistence.snapshot();
        if (!committed.bytes) {
          throw new Error("Committed Automerge document bytes are missing");
        }
        send({
          reqId: req.reqId,
          type: "COMMITTED_DOC",
          binary: committed.bytes,
          heads: [...committed.heads],
          revision: {
            generation: committed.revision.generation,
            saveRevision: committed.revision.saveRevision,
          },
        });
        break;
      }

      case "GET_HEADS": {
        const committed = currentDoc ? persistence.current() : null;
        send({
          reqId: req.reqId,
          type: "DOC_HEADS",
          heads: committed ? [...committed.heads] : null,
        });
        break;
      }

      case "COMPARE_DOC": {
        if (!currentDoc) throw new Error("Document not initialized");
        const incomingDoc = A.load<FreedDoc>(req.binary);
        send({
          reqId: req.reqId,
          type: "DOC_RELATIONSHIP",
          relation: compareDocumentHistories(currentDoc, incomingDoc),
        });
        break;
      }

      case "UPDATE_FEED_ITEM":
        await applyChange(
          (doc) => updateFeedItem(doc, req.globalId, req.updates),
          "Update feed item",
          feedItemUpdatesAffectSearchCorpus(req.updates),
        );
        ack(req.reqId);
        break;

      case "ARCHIVE_ALL_READ_UNSAVED":
        await applyChange(
          (doc) => archiveAllReadUnsaved(doc, req.platform, req.feedUrl),
          "Archive all read",
        );
        ack(req.reqId);
        break;

      case "UNARCHIVE_SAVED_ITEMS":
        await applyChange(
          (doc) => unarchiveSavedItems(doc),
          "Unarchive saved items",
        );
        ack(req.reqId);
        break;

      case "PRUNE_ARCHIVED_ITEMS":
        await applyChange(
          (doc) => pruneArchivedItems(doc, req.maxAgeMs),
          "Prune archived items",
          true,
        );
        ack(req.reqId);
        break;

      case "DELETE_ALL_ARCHIVED":
        await applyChange(
          (doc) => deleteAllArchivedItems(doc),
          "Delete all archived items",
          true,
        );
        ack(req.reqId);
        break;

      case "ADD_RSS_FEED":
        await applyChange(
          (doc) => addRssFeed(doc, req.feed),
          "Add RSS feed",
          true,
        );
        ack(req.reqId);
        break;

      case "REMOVE_RSS_FEED":
        await applyChange(
          (doc) => removeRssFeed(doc, req.url, req.includeItems),
          req.includeItems ? "Remove RSS feed and articles" : "Remove RSS feed",
          true,
        );
        ack(req.reqId);
        break;

      case "UPDATE_RSS_FEED":
        await applyChange(
          (doc) =>
            updateRssFeed(
              doc,
              req.url,
              req.updates as Parameters<typeof updateRssFeed>[2],
            ),
          "Update RSS feed",
          true,
        );
        ack(req.reqId);
        break;

      case "REMOVE_ALL_FEEDS":
        await applyChange(
          (doc) => removeAllFeeds(doc, req.includeItems),
          req.includeItems
            ? "Remove all feeds and articles"
            : "Remove all feeds",
          true,
        );
        ack(req.reqId);
        break;

      case "UPDATE_PREFERENCES":
        await applyChange(
          (doc) => updatePreferences(doc, req.updates),
          "Update preferences",
        );
        ack(req.reqId);
        break;

      case "ADD_PERSON":
        await applyChange((doc) => addPerson(doc, req.person), "Add person");
        ack(req.reqId);
        break;

      case "ADD_PERSONS":
        await applyChange((doc) => {
          for (const person of req.persons) {
            addPerson(doc, person);
          }
        }, `Add ${req.persons.length.toLocaleString()} people`);
        ack(req.reqId);
        break;

      case "UPDATE_PERSON":
        await applyChange(
          (doc) =>
            updatePerson(doc, req.personId, req.updates as Partial<Person>),
          "Update person",
        );
        ack(req.reqId);
        break;

      case "UPSERT_CONNECTION_PERSONS":
        await applyChange((doc) => {
          const now = Date.now();
          for (const candidate of req.candidates) {
            if (doc.persons[candidate.person.id]) {
              updatePerson(doc, candidate.person.id, candidate.person);
            } else {
              addPerson(doc, candidate.person);
            }
            for (const accountId of candidate.accountIds) {
              const account = doc.accounts[accountId];
              if (!account || account.personId === candidate.person.id)
                continue;
              updateAccount(doc, accountId, {
                personId: candidate.person.id,
                updatedAt: now,
              });
            }
          }
        }, `Upsert ${req.candidates.length.toLocaleString()} connection people`);
        ack(req.reqId);
        break;

      case "REMOVE_PERSON":
        await applyChange(
          (doc) => removePerson(doc, req.personId),
          "Remove person",
          false,
          req.type,
        );
        ack(req.reqId);
        break;

      case "LOG_REACH_OUT":
        await applyChange(
          (doc) => logReachOut(doc, req.personId, req.entry),
          "Log reach-out",
        );
        ack(req.reqId);
        break;

      case "ADD_ACCOUNT":
        await applyChange((doc) => addAccount(doc, req.account), "Add account");
        ack(req.reqId);
        break;

      case "ADD_ACCOUNTS":
        await applyChange(
          (doc) => addAccounts(doc, req.accounts),
          `Add ${req.accounts.length.toLocaleString()} accounts`,
        );
        ack(req.reqId);
        break;

      case "UPDATE_ACCOUNT":
        await applyChange(
          (doc) => updateAccount(doc, req.accountId, req.updates),
          "Update account",
        );
        ack(req.reqId);
        break;

      case "REMOVE_ACCOUNT":
        await applyChange(
          (doc) => removeAccount(doc, req.accountId),
          "Remove account",
          false,
          req.type,
        );
        ack(req.reqId);
        break;

      case "ADD_STUB_ITEM": {
        // Build the stub inside the worker so the globalId is consistent
        const globalId = `saved:${hashSavedUrl(req.url)}`;
        const now = Date.now();
        let hostname = req.url;
        try {
          hostname = new URL(req.url).hostname;
        } catch {
          /* malformed */
        }

        const stub: FeedItem = {
          globalId,
          platform: "saved",
          contentType: "article",
          capturedAt: now,
          publishedAt: now,
          author: { id: hostname, handle: hostname, displayName: hostname },
          content: {
            text: req.url,
            mediaUrls: [],
            mediaTypes: [],
            linkPreview: { url: req.url, title: req.url },
          },
          userState: {
            hidden: false,
            saved: true,
            savedAt: now,
            archived: false,
            tags: req.tags,
          },
          topics: [],
        };

        await applyChange(
          (doc) => {
            if (!doc.feedItems[stub.globalId]) addFeedItem(doc, stub);
          },
          `Add stub item for ${req.url}`,
          true,
        );
        ack(req.reqId);
        break;
      }

      case "BACKFILL_CONTENT_SIGNALS": {
        if (!currentDoc) throw new Error("Document not initialized");
        let summary = summarizeDocContentSignals(currentDoc);
        const pendingCount = countContentSignalBackfillItems(currentDoc);
        if (pendingCount > 0) {
          const candidate = A.change(
            currentDoc,
            "Backfill content signals",
            (doc) => {
              summary = backfillContentSignals(doc, req.batchSize);
            },
          );
          await persistCandidate(candidate);
          currentDoc = candidate;
          searchCorpusVersion += 1;
          send({
            type: "DEBUG_EVENT",
            kind: "change",
            detail:
              `[content-signals] backfilled ${summary.updated.toLocaleString()} items, ` +
              `${summary.remaining.toLocaleString()} remaining`,
          });
          broadcastCommitted(candidate);
        }
        send({
          reqId: req.reqId,
          type: "CONTENT_SIGNAL_BACKFILL_RESULT",
          summary,
        });
        break;
      }

      case "MERGE_DOC": {
        if (!currentDoc) throw new Error("Document not initialized");
        const beforeCount = Object.keys(currentDoc.feedItems ?? {}).length;
        const incomingDoc = A.load<FreedDoc>(req.binary);
        const incomingCount = Object.keys(incomingDoc.feedItems ?? {}).length;
        const mergedDoc = A.merge(currentDoc, incomingDoc);
        const guard = assertNonDestructiveMerge(
          currentDoc,
          incomingDoc,
          mergedDoc,
          {
            source: "PWA sync",
          },
        );
        const candidate = migrateIdentityGraph(
          mergedDoc,
          "Migrate legacy identity graph",
        );
        await persistCandidate(candidate);
        currentDoc = candidate;
        searchCorpusVersion += 1;
        const afterCount = Object.keys(candidate.feedItems ?? {}).length;
        const delta = afterCount - beforeCount;
        sendSyncBreadcrumb(
          `loaded remote document, local feed items: ${beforeCount.toLocaleString()}, remote feed items: ${incomingCount.toLocaleString()}`,
          req.binary.byteLength,
        );
        send({
          type: "DEBUG_EVENT",
          kind: "merge_ok",
          detail:
            delta !== 0
              ? `${delta > 0 ? "+" : ""}${delta} items`
              : "no new items",
          bytes: req.binary.byteLength,
        });
        if (guard.deletedItemCount > 0) {
          send({
            type: "DEBUG_EVENT",
            kind: "merge_ok",
            detail: `merge safety checked ${guard.deletedItemCount.toLocaleString()} item deletions`,
            bytes: req.binary.byteLength,
          });
        }
        broadcastCommitted(candidate, "merge", req.type);
        sendSyncBreadcrumb("merge broadcast complete", req.binary.byteLength);
        ack(req.reqId);
        break;
      }

      case "GET_ITEM_LEGACY_HTML":
        if (!currentDoc) throw new Error("Document not initialized");
        send({
          reqId: req.reqId,
          type: "ITEM_LEGACY_HTML",
          globalId: req.globalId,
          html:
            currentDoc.feedItems[req.globalId]?.preservedContent?.html ?? null,
        });
        break;

      case "MATERIALIZE_LIBRARY_CORE_FEED_GENERATION": {
        if (!currentDoc) throw new Error("Document not initialized");
        const result = await materializePwaLibraryCoreFeedGeneration({
          committed: persistence.current(),
          document: currentDoc,
          subtle: crypto.subtle,
          writer: getLibraryCoreFeedReader(),
        });
        send({
          reqId: req.reqId,
          type: "LIBRARY_CORE_FEED_GENERATION_RESULT",
          source: result.source,
          totalCount: result.totalCount,
        });
        break;
      }

      case "MATERIALIZE_LIBRARY_CORE_FEED_BROWSE_GENERATION": {
        if (!currentDoc) throw new Error("Document not initialized");
        send({
          reqId: req.reqId,
          type: "LIBRARY_CORE_FEED_BROWSE_GENERATION_RESULT",
          result: await materializePwaLibraryCoreFeedBrowseGeneration({
            committed: persistence.current(),
            document: currentDoc,
            filter: req.filter,
            rankingClockMs: req.rankingClockMs,
            subtle: crypto.subtle,
            writer: getLibraryCoreFeedReader(),
          }),
        });
        break;
      }

      case "READ_LIBRARY_CORE_FEED_PAGE":
        send({
          reqId: req.reqId,
          type: "LIBRARY_CORE_FEED_PAGE_RESULT",
          result: await getLibraryCoreFeedReader().readFeedPage(req.request),
        });
        break;

      case "CANCEL_LIBRARY_CORE_FEED_READER":
        send({
          reqId: req.reqId,
          type: "LIBRARY_CORE_FEED_READER_CANCEL_RESULT",
          cancelled:
            libraryCoreFeedReader?.cancelReader(
              req.readerSessionId,
              req.cancellationId,
            ) ?? false,
        });
        break;

      case "CLEAR_LOCAL": {
        const revision = persistence.current().revision;
        try {
          await persistence.clear(revision);
        } catch (error) {
          throw persistenceFailure(error);
        }
        currentDoc = null;
        searchCorpusVersion = 0;
        ack(req.reqId);
        break;
      }

      default: {
        const _exhaustive: never = req;
        void _exhaustive;
        ack(
          (req as WorkerRequest).reqId,
          `Unknown request type: ${(req as { type: string }).type}`,
        );
      }
    }
  } catch (err) {
    const failure =
      err instanceof FatalPersistenceError ? makeFatal(err) : null;
    ack(
      req.reqId,
      failure?.message ?? (err instanceof Error ? err.message : String(err)),
      failure?.code ??
        (err instanceof CorruptDocumentError ||
        err instanceof DocumentLoadFailedError
          ? err.code
          : undefined),
    );
  }
}

function enqueueRequest(req: WorkerRequest): void {
  requestChain = requestChain
    .then(() => {
      if (fatalPersistenceFailure) {
        ack(
          req.reqId,
          fatalPersistenceFailure.message,
          fatalPersistenceFailure.code,
        );
        return;
      }
      return handleRequest(req);
    })
    .catch((err) => {
      ack(req.reqId, err instanceof Error ? err.message : String(err));
    });
}

self.onmessage = (event: MessageEvent<WorkerRequest>) => {
  const request = event.data;
  if (fatalPersistenceFailure) {
    ack(
      request.reqId,
      fatalPersistenceFailure.message,
      fatalPersistenceFailure.code,
    );
    return;
  }
  if (request.type === "QUIESCE") {
    acceptingRequests = false;
    enqueueRequest(request);
    return;
  }
  if (!acceptingRequests) {
    ack(request.reqId, "Automerge worker is quiesced for factory reset");
    return;
  }
  enqueueRequest(request);
};

// Signal the main thread that the module finished loading and the onmessage
// handler is installed. Without this, messages sent before evaluation completes
// are silently dropped in Vite's dev-mode module workers.
self.postMessage({ type: "READY" } satisfies WorkerResponse);

// Required for TypeScript module isolation
export {};
