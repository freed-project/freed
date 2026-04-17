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
import type { FreedDoc } from "@freed/shared/schema";
import {
  createEmptyDoc,
  addAccount,
  addAccounts,
  addFeedItem,
  addPerson,
  addRssFeed,
  removeRssFeed,
  removeAllFeeds,
  updateRssFeed,
  updateFeedItem,
  removeFeedItem,
  markAsRead,
  markItemsAsRead,
  toggleSaved,
  toggleArchived,
  archiveAllReadUnsaved,
  unarchiveSavedItems,
  pruneArchivedItems,
  deleteAllArchivedItems,
  updatePreferences,
  updateLastSync,
  updateAccount,
  updatePerson,
  removeAccount,
  removePerson,
  logReachOut,
  toggleLiked,
  confirmLikedSynced,
  confirmSeenSynced,
} from "@freed/shared/schema";
import { rankFeedItems } from "@freed/shared";
import type { Account, FeedItem, Friend, LegacyDeviceContact, LegacyFriendSource, Person, RssFeed, UserPreferences } from "@freed/shared";
import type { DocState, WorkerRequest, WorkerResponse } from "./automerge-types";

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

const storage = new IndexedDBStorage();
let currentDoc: FreedDoc | null = null;
let searchCorpusVersion = 0;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function send(msg: WorkerResponse): void {
  self.postMessage(msg);
}

function ack(reqId: number, error?: string): void {
  send({ reqId, type: "ACK", error });
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
  accounts: Record<string, Account>
): Record<string, Friend> {
  return Object.fromEntries(
    Object.values(persons).map((person) => {
      const personAccounts = Object.values(accounts).filter((account) => account.personId === person.id);
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
      const contactAccount = personAccounts.find((account) => account.kind === "contact");
      return [person.id, {
        ...person,
        sources,
        contact: contactAccount ? toLegacyContact(contactAccount) : undefined,
      }];
    })
  );
}

function bumpSearchCorpusVersion(): void {
  searchCorpusVersion += 1;
}

function feedItemUpdatesAffectSearchCorpus(updates: Partial<FeedItem>): boolean {
  if (
    "author" in updates ||
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
 * Convert the Automerge proxy document to a plain-JS DocState for postMessage.
 * A.toJS() converts CRDT proxies to regular objects, safe for structured clone.
 */
function hydrateFromDoc(doc: FreedDoc): DocState {
  // A.toJS must receive the document root, not a sub-property.
  const plain = A.toJS(doc) as FreedDoc;
  const plainItems = Object.values(plain.feedItems as Record<string, FeedItem>);
  const feeds = plain.rssFeeds as Record<string, RssFeed>;
  const persons = (plain.persons ?? {}) as Record<string, Person>;
  const accounts = (plain.accounts ?? {}) as Record<string, Account>;
  const friends = projectLegacyFriends(persons, accounts);
  const preferences = plain.preferences as UserPreferences;

  const visibleItems = plainItems.filter((item) => !item.userState.hidden);
  const rankedItems = rankFeedItems(
    visibleItems.sort((a, b) => b.publishedAt - a.publishedAt),
    preferences.weights,
  );

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
    itemCountByPlatform[item.platform] = (itemCountByPlatform[item.platform] ?? 0) + 1;
    if (item.rssSource) {
      const url = item.rssSource.feedUrl;
      feedTotalCounts[url] = (feedTotalCounts[url] ?? 0) + 1;
    }
    if (!item.userState.readAt) {
      totalUnreadCount++;
      unreadCountByPlatform[item.platform] = (unreadCountByPlatform[item.platform] ?? 0) + 1;
      if (item.rssSource) {
        const url = item.rssSource.feedUrl;
        feedUnreadCounts[url] = (feedUnreadCounts[url] ?? 0) + 1;
      }
    } else if (!item.userState.saved) {
      totalArchivableCount++;
      archivableCountByPlatform[item.platform] = (archivableCountByPlatform[item.platform] ?? 0) + 1;
      if (item.rssSource) {
        const url = item.rssSource.feedUrl;
        archivableFeedCounts[url] = (archivableFeedCounts[url] ?? 0) + 1;
      }
    }
  }

  return {
    items: rankedItems,
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
  };
}

/**
 * Persist the doc to IndexedDB and broadcast the hydrated state + binary to
 * the main thread. Called after every mutation.
 */
async function saveAndBroadcast(): Promise<void> {
  if (!currentDoc) return;
  const binary = A.save(currentDoc);
  await storage.save(binary);
  const state = hydrateFromDoc(currentDoc);

  const snapshot: Extract<WorkerResponse, { type: "DEBUG_SNAPSHOT" }> = {
    type: "DEBUG_SNAPSHOT",
    deviceId: (currentDoc.meta?.deviceId as string | undefined) ?? "unknown",
    itemCount: Object.keys(currentDoc.feedItems ?? {}).length,
    feedCount: Object.keys(currentDoc.rssFeeds ?? {}).length,
    binarySize: binary.byteLength,
  };
  send(snapshot);

  // binary is cloned by structured-clone on postMessage (not transferred) so
  // the copy in storage.save() above is not affected.
  const stateUpdate: WorkerResponse = { type: "STATE_UPDATE", state, binary };
  send(stateUpdate);
}

/**
 * Apply a change function to the doc, persist, and broadcast state.
 * Returns the updated doc.
 */
async function applyChange(
  changeFn: (doc: FreedDoc) => void,
  message: string,
  searchCorpusChanged = false,
): Promise<void> {
  if (!currentDoc) throw new Error("Document not initialized");
  currentDoc = A.change(currentDoc, message, changeFn);
  if (searchCorpusChanged) bumpSearchCorpusVersion();
  send({ type: "DEBUG_EVENT", kind: "change", detail: message });
  await saveAndBroadcast();
}

// ---------------------------------------------------------------------------
// Message handler
// ---------------------------------------------------------------------------

self.onmessage = async (event: MessageEvent<WorkerRequest>) => {
  const req = event.data;

  try {
    switch (req.type) {
      case "INIT": {
        const saved = await storage.load();
        if (saved) {
          try {
            currentDoc = A.load<FreedDoc>(saved);
          } catch {
            await storage.clear();
            send({ type: "DEBUG_EVENT", kind: "init", detail: "corrupt doc cleared, creating fresh" });
          }
        }
        if (!currentDoc) {
          currentDoc = createEmptyDoc();
          const binary = A.save(currentDoc);
          await storage.save(binary);
        }
        searchCorpusVersion = 1;
        const deviceId = (currentDoc.meta?.deviceId as string | undefined) ?? "unknown";
        send({ type: "DEBUG_EVENT", kind: "init", detail: `device ...${deviceId.slice(-8)}` });
        await saveAndBroadcast();
        ack(req.reqId);
        break;
      }

      case "MARK_AS_READ":
        await applyChange((doc) => markAsRead(doc, req.globalId), "Mark as read");
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
        await applyChange((doc) => toggleSaved(doc, req.globalId), "Toggle saved");
        ack(req.reqId);
        break;

      case "TOGGLE_ARCHIVED":
        await applyChange((doc) => toggleArchived(doc, req.globalId), "Toggle archived");
        ack(req.reqId);
        break;

      case "TOGGLE_LIKED":
        await applyChange((doc) => toggleLiked(doc, req.globalId), "Toggle liked");
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
        await applyChange((doc) => {
          if (!doc.feedItems[req.item.globalId]) addFeedItem(doc, req.item);
        }, "Add feed item", true);
        ack(req.reqId);
        break;

      case "ADD_FEED_ITEMS":
        await applyChange((doc) => {
          for (const item of req.items) {
            if (!doc.feedItems[item.globalId]) addFeedItem(doc, item);
          }
        }, `Add ${req.items.length} feed items`, true);
        ack(req.reqId);
        break;

      case "REMOVE_FEED_ITEM":
        await applyChange((doc) => removeFeedItem(doc, req.globalId), "Remove feed item", true);
        ack(req.reqId);
        break;

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
        await applyChange((doc) => unarchiveSavedItems(doc), "Unarchive saved items");
        ack(req.reqId);
        break;

      case "PRUNE_ARCHIVED_ITEMS":
        await applyChange((doc) => pruneArchivedItems(doc, req.maxAgeMs), "Prune archived items", true);
        ack(req.reqId);
        break;

      case "DELETE_ALL_ARCHIVED":
        await applyChange((doc) => deleteAllArchivedItems(doc), "Delete all archived items", true);
        ack(req.reqId);
        break;

      case "ADD_RSS_FEED":
        await applyChange((doc) => addRssFeed(doc, req.feed), "Add RSS feed", true);
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
          (doc) => updateRssFeed(doc, req.url, req.updates as Parameters<typeof updateRssFeed>[2]),
          "Update RSS feed",
          true,
        );
        ack(req.reqId);
        break;

      case "REMOVE_ALL_FEEDS":
        await applyChange(
          (doc) => removeAllFeeds(doc, req.includeItems),
          req.includeItems ? "Remove all feeds and articles" : "Remove all feeds",
          true,
        );
        ack(req.reqId);
        break;

      case "UPDATE_PREFERENCES":
        await applyChange((doc) => updatePreferences(doc, req.updates), "Update preferences");
        ack(req.reqId);
        break;

      case "UPDATE_LAST_SYNC":
        await applyChange((doc) => updateLastSync(doc), "Update last sync");
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
        await applyChange((doc) => updatePerson(doc, req.personId, req.updates as Partial<Person>), "Update person");
        ack(req.reqId);
        break;

      case "REMOVE_PERSON":
        await applyChange((doc) => removePerson(doc, req.personId), "Remove person");
        ack(req.reqId);
        break;

      case "LOG_REACH_OUT":
        await applyChange((doc) => logReachOut(doc, req.personId, req.entry), "Log reach-out");
        ack(req.reqId);
        break;

      case "ADD_ACCOUNT":
        await applyChange((doc) => addAccount(doc, req.account), "Add account");
        ack(req.reqId);
        break;

      case "ADD_ACCOUNTS":
        await applyChange((doc) => addAccounts(doc, req.accounts), `Add ${req.accounts.length.toLocaleString()} accounts`);
        ack(req.reqId);
        break;

      case "UPDATE_ACCOUNT":
        await applyChange((doc) => updateAccount(doc, req.accountId, req.updates), "Update account");
        ack(req.reqId);
        break;

      case "REMOVE_ACCOUNT":
        await applyChange((doc) => removeAccount(doc, req.accountId), "Remove account");
        ack(req.reqId);
        break;

      case "ADD_STUB_ITEM": {
        // Build the stub inside the worker so the globalId is consistent
        let hash = 0;
        for (let i = 0; i < req.url.length; i++) {
          const ch = req.url.charCodeAt(i);
          hash = (hash << 5) - hash + ch;
          hash = hash & hash;
        }
        const globalId = `saved:${Math.abs(hash).toString(36)}`;
        const now = Date.now();
        let hostname = req.url;
        try { hostname = new URL(req.url).hostname; } catch { /* malformed */ }

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
          userState: { hidden: false, saved: true, savedAt: now, archived: false, tags: req.tags },
          topics: [],
        };

        await applyChange((doc) => {
          if (!doc.feedItems[stub.globalId]) addFeedItem(doc, stub);
        }, `Add stub item for ${req.url}`, true);
        ack(req.reqId);
        break;
      }

      case "MERGE_DOC": {
        if (!currentDoc) throw new Error("Document not initialized");
        const beforeCount = Object.keys(currentDoc.feedItems ?? {}).length;
        const incomingDoc = A.load<FreedDoc>(req.binary);
        currentDoc = A.merge(currentDoc, incomingDoc);
        const afterCount = Object.keys(currentDoc.feedItems ?? {}).length;
        const delta = afterCount - beforeCount;
        send({
          type: "DEBUG_EVENT",
          kind: "merge_ok",
          detail: delta !== 0 ? `${delta > 0 ? "+" : ""}${delta} items` : "no new items",
          bytes: req.binary.byteLength,
        });
        bumpSearchCorpusVersion();
        await saveAndBroadcast();
        ack(req.reqId);
        break;
      }

      case "CLEAR_LOCAL":
        await storage.clear();
        currentDoc = null;
        searchCorpusVersion = 0;
        ack(req.reqId);
        break;

      default: {
        const _exhaustive: never = req;
        void _exhaustive;
        ack((req as WorkerRequest).reqId, `Unknown request type: ${(req as { type: string }).type}`);
      }
    }
  } catch (err) {
    ack(req.reqId, err instanceof Error ? err.message : String(err));
  }
};

// Signal the main thread that the module finished loading and the onmessage
// handler is installed. Without this, messages sent before evaluation completes
// are silently dropped in Vite's dev-mode module workers.
self.postMessage({ type: "READY" } satisfies WorkerResponse);

// Required for TypeScript module isolation
export {};
