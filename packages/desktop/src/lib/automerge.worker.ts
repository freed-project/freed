/**
 * Automerge document worker for Freed Desktop
 *
 * Runs ALL WASM operations (A.change, A.save, A.load, A.merge) off the main
 * thread. The main thread only receives plain-JS state updates via postMessage.
 *
 * Desktop additions over the PWA worker:
 *   - UPDATE_RELAY_CLIENT_COUNT: tracks connected PWA clients
 *   - BROADCAST_REQUEST response: posts pre-serialized Array.from(binary) to
 *     the main thread, which calls invoke("broadcast_doc") - Tauri IPC requires
 *     the main thread, so the worker cannot call invoke() directly
 *   - BATCH_REFRESH_FEEDS: bulk feed+items update for the RSS poller
 *   - BATCH_IMPORT_ITEMS: chunked import with IMPORT_PROGRESS events
 *   - HEAL_UNTITLED_FEEDS, DEDUPLICATE_ITEMS: startup migrations
 */

import * as A from "@automerge/automerge";
import { IndexedDBStorage } from "@freed/sync/storage/indexeddb";
import type { FreedDoc } from "@freed/shared/schema";
import {
  assertNonDestructiveMerge,
  choosePopulatedInputForEmptyMerge,
  createEmptyDoc,
  createDocFromData,
  addAccount,
  addAccounts,
  backfillContentSignals,
  clearSampleData,
  countContentSignalBackfillItems,
  addFeedItem,
  deduplicateDocFeedItems,
  hasLegacyIdentityGraphData,
  migrateLegacyIdentityGraph,
  addPerson,
  addRssFeed,
  removeRssFeed,
  removeAllFeeds,
  updateRssFeed,
  updateFeedItem,
  summarizeDocContentSignals,
  removeFeedItem,
  markAsRead,
  markItemsAsRead,
  toggleSaved,
  toggleArchived,
  archiveItemsById,
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
import {
  countAuthorsWithRecentLocationUpdates,
  countFriendsWithRecentLocationUpdates,
  mergeDefaultPreferences,
  rankFeedItems,
  sortByPriority,
} from "@freed/shared";
import type { Account, FeedItem, Friend, LegacyDeviceContact, LegacyFriendSource, Person, RssFeed, UserPreferences } from "@freed/shared";
import type { DocState, FeedItemPatch, RssFeedPatch, WorkerRequest, WorkerResponse } from "./automerge-types";
import {
  createPersistenceState,
  persistDoc,
  type AutomergePersistenceState,
} from "./automerge-persistence";
import {
  createFeedTextCompactionSummary,
  compactFeedItemTextForSync,
  compactFeedItemsTextForSync,
  formatFeedTextCompactionSummary,
} from "./feed-text-compaction";

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

const storage = new IndexedDBStorage();
let currentDoc: FreedDoc | null = null;
let currentBinary: Uint8Array | null = null;
let persistenceState: AutomergePersistenceState = createPersistenceState(null);
let relayClientCount = 0;
let queuedRequestCount = 0;
let requestChain: Promise<void> = Promise.resolve();
let searchCorpusVersion = 0;
let linkPreviewUrlCounts = new Map<string, number>();

const SLOW_QUEUE_WAIT_MS = 1_000;
const SLOW_REQUEST_PROCESS_MS = 5_000;
const SLOW_SAVE_AND_BROADCAST_MS = 2_000;
const DESKTOP_UI_PRESERVED_TEXT_LIMIT = 0;
const DESKTOP_UI_CONTENT_TEXT_LIMIT = 280;
const DESKTOP_UI_LINK_DESCRIPTION_LIMIT = 180;
const DESKTOP_UI_EVENT_EVIDENCE_LIMIT = 220;
const FRESH_DOC_REBUILD_MIN_CHANGED_BINARY_BYTES = 4 * 1024 * 1024;

interface RequestTrace {
  reqId: number;
  opType: WorkerRequest["type"];
  enqueuedAt: number;
  startedAt: number;
  queuedBeforeStart: number;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function send(msg: WorkerResponse): void {
  self.postMessage(msg);
}

function ack(reqId: number, error?: string): void {
  send({ reqId, type: "ACK", error });
}

function itemLinkPreviewUrl(item: FeedItem | undefined): string | null {
  const url = item?.content.linkPreview?.url;
  return typeof url === "string" && url.length > 0 ? url : null;
}

function addKnownLinkPreviewUrl(item: FeedItem | undefined): void {
  const url = itemLinkPreviewUrl(item);
  if (!url) return;
  linkPreviewUrlCounts.set(url, (linkPreviewUrlCounts.get(url) ?? 0) + 1);
}

function hasKnownLinkPreviewUrl(url: string | null): boolean {
  return Boolean(url && (linkPreviewUrlCounts.get(url) ?? 0) > 0);
}

function rebuildKnownLinkPreviewUrls(doc: FreedDoc | null): void {
  linkPreviewUrlCounts = new Map();
  if (!doc) return;
  for (const item of Object.values(doc.feedItems ?? {}) as FeedItem[]) {
    addKnownLinkPreviewUrl(item);
  }
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
      const contactAccount = personAccounts.find((account) => account.kind === "contact");
      return [person.id, {
        ...person,
        sources,
        contact: contactAccount ? toLegacyContact(contactAccount) : undefined,
      }];
    })
  );
}

function formatMs(ms: number): string {
  return Math.round(ms).toLocaleString();
}

function emitWorkerTrace(
  detail: string,
  kind: Extract<WorkerResponse, { type: "DEBUG_EVENT" }>["kind"] = "change",
): void {
  send({ type: "DEBUG_EVENT", kind, detail });
}

function bumpSearchCorpusVersion(): void {
  searchCorpusVersion += 1;
}

/**
 * Heads as of the last save/load, answered by GET_HEADS without forcing a
 * full A.load when the document is idle-unloaded (an unloaded doc cannot
 * have diverged from its last save). Null until the first INIT.
 */
let lastSavedHeads: string[] | null = null;

function refreshLastSavedHeads(doc: FreedDoc | null): void {
  try {
    lastSavedHeads = doc ? A.getHeads(doc) : null;
  } catch {
    lastSavedHeads = null;
  }
}

function cancelDocIdleUnload(): void {
  // Kept as a named lifecycle hook so request startup documents the intent.
}

function scheduleDocIdleUnload(): void {
  if (!currentDoc || !currentBinary || queuedRequestCount > 0) return;
  currentDoc = null;
  persistenceState = createPersistenceState(currentBinary);
  emitWorkerTrace(
    "[automerge-worker] released idle document after request queue drained",
    "change",
  );
}

function ensureCurrentDocLoaded(reason: WorkerRequest["type"]): FreedDoc {
  if (currentDoc) return currentDoc;
  if (!currentBinary) throw new Error("Document not initialized");

  const startedAt = performance.now();
  currentDoc = A.load<FreedDoc>(currentBinary);
  persistenceState = createPersistenceState(currentBinary);
  rebuildKnownLinkPreviewUrls(currentDoc);
  emitWorkerTrace(
    `[automerge-worker] reloaded idle document op=${reason}` +
      ` load_ms=${formatMs(performance.now() - startedAt)}` +
      ` bytes=${currentBinary.byteLength.toLocaleString()}`,
    "change",
  );
  return currentDoc;
}

function migrateLoadedIdentityGraph(message: string): boolean {
  if (!currentDoc || !hasLegacyIdentityGraphData(currentDoc)) return false;
  currentDoc = A.change(currentDoc, message, (doc) => {
    migrateLegacyIdentityGraph(doc);
  });
  return true;
}

function compactLoadedFeedText(
  message: string,
  options: { rebuildHistory?: boolean; previousBinaryBytes?: number } = {},
): boolean {
  if (!currentDoc) return false;
  let summary = createFeedTextCompactionSummary();
  currentDoc = A.change(currentDoc, message, (doc) => {
    summary = compactFeedItemsTextForSync(Object.values(doc.feedItems) as FeedItem[]);
  });
  if (summary.changed > 0) {
    bumpSearchCorpusVersion();
    emitWorkerTrace(
      `[automerge-worker] ${message}: ${formatFeedTextCompactionSummary(summary)}`,
      "change",
    );
  }

  const previousBinaryBytes = options.previousBinaryBytes ?? currentBinary?.byteLength ?? 0;
  if (!options.rebuildHistory) return summary.changed > 0;
  const shouldRebuildForChangedText =
    summary.changed > 0 && previousBinaryBytes >= FRESH_DOC_REBUILD_MIN_CHANGED_BINARY_BYTES;
  if (!shouldRebuildForChangedText) return summary.changed > 0;

  const plain = A.toJS(currentDoc) as Partial<FreedDoc>;
  const rebuiltDoc = createDocFromData(plain);
  const rebuiltBinary = A.save(rebuiltDoc);
  const bytesSaved = previousBinaryBytes - rebuiltBinary.byteLength;
  currentDoc = rebuiltDoc;
  currentBinary = rebuiltBinary;
  refreshLastSavedHeads(rebuiltDoc);
  persistenceState = createPersistenceState(rebuiltBinary);
  emitWorkerTrace(
    `[automerge-worker] rebuilt compacted document` +
      ` previous_bytes=${previousBinaryBytes.toLocaleString()}` +
      ` rebuilt_bytes=${rebuiltBinary.byteLength.toLocaleString()}` +
      ` saved_bytes=${Math.max(0, bytesSaved).toLocaleString()}`,
    "change",
  );
  return true;
}

function feedItemUpdatesAffectSearchCorpus(updates: Partial<FeedItem>): boolean {
  if (
    "author" in updates ||
    "contentSignals" in updates ||
    "eventCandidate" in updates ||
    "content" in updates ||
    "contentType" in updates ||
    "location" in updates ||
    "timeRange" in updates ||
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

function cloneFeedItemForPatch(item: FeedItem): FeedItem {
  return trimFeedItemForDesktopUi(item);
}

function cloneRssFeedForPatch(feed: RssFeed): RssFeed {
  return JSON.parse(JSON.stringify(feed)) as RssFeed;
}

function cloneRecordValues<T>(record: Record<string, T> | undefined): Record<string, T> {
  const cloned: Record<string, T> = {};
  for (const [key, value] of Object.entries(record ?? {})) {
    cloned[key] = JSON.parse(JSON.stringify(value)) as T;
  }
  return cloned;
}

function cloneFeedItemsForDesktopUi(record: Record<string, FeedItem> | undefined): {
  items: FeedItem[];
  totalCount: number;
} {
  const items: FeedItem[] = [];
  let totalCount = 0;

  for (const item of Object.values(record ?? {})) {
    totalCount++;
    items.push(cloneFeedItemForPatch(item));
  }

  return { items, totalCount };
}

function trimFeedItemForDesktopUi(item: FeedItem): FeedItem {
  const contentText = item.content.text;
  const linkPreview = item.content.linkPreview;
  const linkDescription = linkPreview?.description;
  const preservedContent = item.preservedContent;
  const preservedText = preservedContent?.text;
  const eventCandidate = item.eventCandidate;
  const eventEvidence = eventCandidate?.evidence;
  const tags = item.contentSignals?.tags ?? [];

  return {
    globalId: item.globalId,
    platform: item.platform,
    contentType: item.contentType,
    capturedAt: item.capturedAt,
    publishedAt: item.publishedAt,
    author: { ...item.author },
    content: {
      text: contentText?.slice(0, DESKTOP_UI_CONTENT_TEXT_LIMIT),
      mediaUrls: [...item.content.mediaUrls],
      mediaTypes: [...item.content.mediaTypes],
      linkPreview: linkPreview
        ? {
            url: linkPreview.url,
            title: linkPreview.title,
            description: linkDescription?.slice(0, DESKTOP_UI_LINK_DESCRIPTION_LIMIT),
          }
        : undefined,
    },
    engagement: item.engagement ? { ...item.engagement } : undefined,
    location: item.location
      ? {
          ...item.location,
          coordinates: item.location.coordinates ? { ...item.location.coordinates } : undefined,
        }
      : undefined,
    timeRange: item.timeRange ? { ...item.timeRange } : undefined,
    rssSource: item.rssSource ? { ...item.rssSource } : undefined,
    fbGroup: item.fbGroup ? { ...item.fbGroup } : undefined,
    // The reader asks the worker for full preserved text on demand. Keeping
    // it in every renderer item makes all non-reader surfaces pay for it.
    preservedContent: preservedContent
      ? {
          author: preservedContent.author,
          publishedAt: preservedContent.publishedAt,
          wordCount: preservedContent.wordCount,
          readingTime: preservedContent.readingTime,
          preservedAt: preservedContent.preservedAt,
          text: preservedText?.slice(0, DESKTOP_UI_PRESERVED_TEXT_LIMIT) ?? "",
        }
      : undefined,
    userState: {
      ...item.userState,
      tags: [...item.userState.tags],
      highlights: item.userState.highlights?.map((highlight) => ({ ...highlight })),
    },
    topics: [...item.topics],
    contentSignals: tags.length > 0 ? ({ tags: [...tags] } as FeedItem["contentSignals"]) : undefined,
    eventCandidate: eventCandidate
      ? {
          ...eventCandidate,
          evidence: eventEvidence?.slice(0, DESKTOP_UI_EVENT_EVIDENCE_LIMIT),
        }
      : undefined,
    priority: item.priority,
    priorityComputedAt: item.priorityComputedAt,
    sourceUrl: item.sourceUrl,
  };
}

function markAllVisibleAsRead(doc: FreedDoc, platform?: string): string[] {
  const now = Date.now();
  const changedIds: string[] = [];
  for (const item of Object.values(doc.feedItems) as FeedItem[]) {
    if (item.userState.readAt) continue;
    if (item.userState.hidden || item.userState.archived) continue;
    if (platform && item.platform !== platform) continue;
    item.userState.readAt = now;
    changedIds.push(item.globalId);
  }
  return changedIds;
}

function archiveAllReadableUnsaved(doc: FreedDoc, platform?: string, feedUrl?: string): string[] {
  const now = Date.now();
  const changedIds: string[] = [];
  for (const item of Object.values(doc.feedItems) as FeedItem[]) {
    if (item.userState.archived) continue;
    if (item.userState.hidden) continue;
    if (item.userState.saved) continue;
    if (!item.userState.readAt) continue;
    if (platform && item.platform !== platform) continue;
    if (feedUrl && item.rssSource?.feedUrl !== feedUrl) continue;
    item.userState.archived = true;
    item.userState.archivedAt = now;
    changedIds.push(item.globalId);
  }
  return changedIds;
}

function unarchiveSavedItemIds(doc: FreedDoc): string[] {
  const changedIds: string[] = [];
  for (const item of Object.values(doc.feedItems) as FeedItem[]) {
    if (!item.userState.saved) continue;
    if (!item.userState.archived) continue;
    item.userState.archived = false;
    delete (item.userState as unknown as Record<string, unknown>).archivedAt;
    changedIds.push(item.globalId);
  }
  return changedIds;
}

function healUntitledFeedTitles(doc: FreedDoc): number {
  let changed = 0;
  for (const feed of Object.values(doc.rssFeeds) as RssFeed[]) {
    const isUntitled = feed.title === "Untitled Feed" || feed.title === feed.url;
    if (!isUntitled) continue;
    let healed: string | undefined;
    try {
      healed = new URL(feed.url).hostname.replace(/^(?:www|feeds?)\./, "");
    } catch { /* non-fatal */ }
    if (!healed || healed === feed.title) continue;
    feed.title = healed;
    changed++;
  }
  return changed;
}

function rankedPatchItemsFromDoc(doc: FreedDoc, items: FeedItem[]): FeedItem[] {
  const preferences = mergeDefaultPreferences(doc.preferences as Partial<UserPreferences> | undefined);
  const persons = doc.persons as Record<string, Person> | undefined;
  const accounts = doc.accounts as Record<string, Account> | undefined;

  return rankFeedItems(
    [...items].sort((a, b) => {
      const timeDelta = (b.publishedAt || b.capturedAt) - (a.publishedAt || a.capturedAt);
      return timeDelta || a.globalId.localeCompare(b.globalId);
    }),
    preferences.weights,
    {
      persons: persons ?? {},
      accounts: accounts ?? {},
    },
  );
}

function cloneRankedFeedItemPatches(doc: FreedDoc | null, changedIds: string[]): FeedItemPatch[] {
  const items = changedIds
    .map((globalId) => doc?.feedItems[globalId] as FeedItem | undefined)
    .filter((item): item is FeedItem => Boolean(item))
    .map((item) => cloneFeedItemForPatch(item));
  if (!doc || items.length === 0) return items.map((item) => ({ item }));

  return rankedPatchItemsFromDoc(doc, items).map((item) => ({ item }));
}

/**
 * Convert the Automerge proxy document to a plain-JS DocState for postMessage.
 * Build the projection incrementally so large synced article bodies are
 * trimmed before we hold a full deep clone of the document in worker memory.
 */
function hydrateFromDoc(doc: FreedDoc): DocState {
  const { items: plainItems, totalCount: docItemCount } = cloneFeedItemsForDesktopUi(
    doc.feedItems as Record<string, FeedItem> | undefined,
  );
  const feeds = cloneRecordValues(doc.rssFeeds as Record<string, RssFeed> | undefined);
  const persons = cloneRecordValues(doc.persons as Record<string, Person> | undefined);
  const accounts = cloneRecordValues(doc.accounts as Record<string, Account> | undefined);
  const friends = projectLegacyFriends(persons, accounts);
  const preferences = mergeDefaultPreferences(doc.preferences as Partial<UserPreferences> | undefined);

  const visibleItems = plainItems.filter((item) => !item.userState.hidden);
  const rankedItems = sortByPriority(
    rankFeedItems(
      visibleItems.sort((a, b) => b.publishedAt - a.publishedAt),
      preferences.weights,
      { persons, accounts },
    ),
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
      archivableCountByPlatform[item.platform] =
        (archivableCountByPlatform[item.platform] ?? 0) + 1;
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
    mapFriendLocationCount: countFriendsWithRecentLocationUpdates(rankedItems, persons, accounts),
    mapAllContentLocationCount: countAuthorsWithRecentLocationUpdates(rankedItems),
    docItemCount,
  };
}

function preferenceUpdateRequiresFullHydration(updates: Partial<UserPreferences>): boolean {
  return updates.weights !== undefined;
}

/**
 * Persist, hydrate, and broadcast state plus, if relay clients are connected,
 * request a broadcast_doc IPC call from the main thread. The Array.from(binary)
 * work stays in the worker, and the main thread only asks for the full binary
 * later when snapshots or cloud sync actually need it.
 */
async function saveAndBroadcast(trace?: RequestTrace): Promise<void> {
  const doc = currentDoc;
  if (!doc) return;

  const startedAt = performance.now();
  const persisted = persistDoc(doc, persistenceState);
  const binary = persisted.binary;
  persistenceState = persisted.persistence;
  currentBinary = binary;
  refreshLastSavedHeads(doc);
  const afterSerializeAt = performance.now();
  await storage.save(binary);
  const afterPersistAt = performance.now();
  const state = hydrateFromDoc(doc);
  rebuildKnownLinkPreviewUrls(doc);
  const afterHydrateAt = performance.now();

  const snapshot: Extract<WorkerResponse, { type: "DEBUG_SNAPSHOT" }> = {
    type: "DEBUG_SNAPSHOT",
    deviceId: (doc.meta?.deviceId as string | undefined) ?? "unknown",
    itemCount: Object.keys(doc.feedItems ?? {}).length,
    feedCount: Object.keys(doc.rssFeeds ?? {}).length,
    binarySize: binary.byteLength,
  };
  send(snapshot);
  send({ type: "STATE_UPDATE", state, mutation: trace?.opType });

  // Request main thread to relay the binary to connected PWA clients.
  // Array.from() (O(binary size)) runs here in the worker, off the main thread.
  if (relayClientCount > 0) {
    send({ type: "BROADCAST_REQUEST", data: Array.from(binary) });
  }

  const completedAt = performance.now();
  const totalMs = completedAt - startedAt;
  if (
    trace &&
    (trace.opType === "UPDATE_PREFERENCES" || totalMs >= SLOW_SAVE_AND_BROADCAST_MS)
  ) {
    emitWorkerTrace(
      `[automerge-worker] save op=${trace.opType} reqId=${trace.reqId}` +
        ` serialize_ms=${formatMs(afterSerializeAt - startedAt)}` +
        ` persist_ms=${formatMs(afterPersistAt - afterSerializeAt)}` +
        ` hydrate_ms=${formatMs(afterHydrateAt - afterPersistAt)}` +
        ` emit_ms=${formatMs(completedAt - afterHydrateAt)}` +
        ` total_ms=${formatMs(totalMs)}` +
        ` persist_mode=${persisted.usedIncremental ? "incremental" : "snapshot"}` +
        ` bytes=${binary.byteLength.toLocaleString()}`,
    );
  }
}

async function hydrateAndBroadcastWithoutPersist(trace?: RequestTrace): Promise<void> {
  const doc = currentDoc;
  if (!doc) return;

  const startedAt = performance.now();
  const state = hydrateFromDoc(doc);
  rebuildKnownLinkPreviewUrls(doc);
  const afterHydrateAt = performance.now();

  send({
    type: "DEBUG_SNAPSHOT",
    deviceId: (doc.meta?.deviceId as string | undefined) ?? "unknown",
    itemCount: Object.keys(doc.feedItems ?? {}).length,
    feedCount: Object.keys(doc.rssFeeds ?? {}).length,
    binarySize: currentBinary?.byteLength ?? 0,
  });
  send({ type: "STATE_UPDATE", state, mutation: trace?.opType });

  const totalMs = performance.now() - startedAt;
  if (trace && totalMs >= SLOW_SAVE_AND_BROADCAST_MS) {
    emitWorkerTrace(
      `[automerge-worker] clean-hydrate op=${trace.opType} reqId=${trace.reqId}` +
        ` hydrate_ms=${formatMs(afterHydrateAt - startedAt)}` +
        ` emit_ms=${formatMs(totalMs - (afterHydrateAt - startedAt))}` +
        ` total_ms=${formatMs(totalMs)}` +
        ` bytes=${(currentBinary?.byteLength ?? 0).toLocaleString()}`,
    );
  }
}

async function persistAndBroadcastWithoutHydration(trace?: RequestTrace): Promise<void> {
  const doc = currentDoc;
  if (!doc) return;

  const startedAt = performance.now();
  const persisted = persistDoc(doc, persistenceState);
  const binary = persisted.binary;
  persistenceState = persisted.persistence;
  currentBinary = binary;
  refreshLastSavedHeads(doc);
  const afterSerializeAt = performance.now();
  await storage.save(binary);
  const afterPersistAt = performance.now();

  send({
    type: "DEBUG_SNAPSHOT",
    deviceId: (doc.meta?.deviceId as string | undefined) ?? "unknown",
    itemCount: Object.keys(doc.feedItems ?? {}).length,
    feedCount: Object.keys(doc.rssFeeds ?? {}).length,
    binarySize: binary.byteLength,
  });

  if (relayClientCount > 0) {
    send({ type: "BROADCAST_REQUEST", data: Array.from(binary) });
  }

  const totalMs = performance.now() - startedAt;
  if (trace && totalMs >= SLOW_SAVE_AND_BROADCAST_MS) {
    emitWorkerTrace(
      `[automerge-worker] patch-save op=${trace.opType} reqId=${trace.reqId}` +
        ` serialize_ms=${formatMs(afterSerializeAt - startedAt)}` +
        ` persist_ms=${formatMs(afterPersistAt - afterSerializeAt)}` +
        ` total_ms=${formatMs(totalMs)}` +
        ` persist_mode=${persisted.usedIncremental ? "incremental" : "snapshot"}` +
        ` bytes=${binary.byteLength.toLocaleString()}`,
    );
  }
}

async function applyChange(
  changeFn: (doc: FreedDoc) => void,
  message: string,
  trace?: RequestTrace,
  searchCorpusChanged = false,
): Promise<void> {
  if (!currentDoc) throw new Error("Document not initialized");
  currentDoc = A.change(currentDoc, message, changeFn);
  if (searchCorpusChanged) bumpSearchCorpusVersion();
  send({ type: "DEBUG_EVENT", kind: "change", detail: message });
  await saveAndBroadcast(trace);
}

async function applyPreferenceChange(
  updates: Partial<UserPreferences>,
  trace?: RequestTrace,
): Promise<void> {
  if (!currentDoc) throw new Error("Document not initialized");
  currentDoc = A.change(currentDoc, "Update preferences", (doc) => {
    updatePreferences(doc, updates);
  });
  send({ type: "DEBUG_EVENT", kind: "change", detail: "Update preferences" });

  if (preferenceUpdateRequiresFullHydration(updates)) {
    await saveAndBroadcast(trace);
    return;
  }

  await persistAndBroadcastWithoutHydration(trace);
  send({ type: "PREFERENCES_PATCH", updates, mutation: trace?.opType });
}

async function applyRssFeedPatchChange(
  changeFn: (doc: FreedDoc) => RssFeedPatch,
  message: string,
  trace?: RequestTrace,
): Promise<void> {
  if (!currentDoc) throw new Error("Document not initialized");
  let patch: RssFeedPatch = { feeds: {}, removedUrls: [] };
  currentDoc = A.change(currentDoc, message, (doc) => {
    patch = changeFn(doc);
  });
  send({ type: "DEBUG_EVENT", kind: "change", detail: message });
  await persistAndBroadcastWithoutHydration(trace);
  send({ type: "FEEDS_PATCH", patch, mutation: trace?.opType });
}

async function applyCountedChange(
  changeFn: (doc: FreedDoc) => number,
  message: string,
  trace?: RequestTrace,
  searchCorpusChanged = false,
): Promise<number> {
  if (!currentDoc) throw new Error("Document not initialized");
  let changedCount = 0;
  currentDoc = A.change(currentDoc, message, (doc) => {
    changedCount = changeFn(doc);
  });

  if (changedCount === 0) {
    emitWorkerTrace(
      `[automerge-worker] skip op=${trace?.opType ?? "unknown"} reason=no_changes`,
      "change",
    );
    return changedCount;
  }

  if (searchCorpusChanged) bumpSearchCorpusVersion();
  send({
    type: "DEBUG_EVENT",
    kind: "change",
    detail: `${message}: ${changedCount.toLocaleString()} changed`,
  });
  await saveAndBroadcast(trace);
  return changedCount;
}

async function applyItemPatchChange(
  changeFn: (doc: FreedDoc) => string[],
  message: string,
  trace?: RequestTrace,
): Promise<void> {
  if (!currentDoc) throw new Error("Document not initialized");
  let changedIds: string[] = [];
  currentDoc = A.change(currentDoc, message, (doc) => {
    changedIds = changeFn(doc);
  });
  send({ type: "DEBUG_EVENT", kind: "change", detail: message });
  await persistAndBroadcastWithoutHydration(trace);

  const patches = changedIds
    .map((globalId) => currentDoc?.feedItems[globalId] as FeedItem | undefined)
    .filter((item): item is FeedItem => Boolean(item))
    .map((item) => ({ item: cloneFeedItemForPatch(item) }));
  if (patches.length > 0) {
    send({
      type: "ITEM_PATCH",
      patches,
      changedItemIds: changedIds,
      mutation: trace?.opType,
    });
  }
}

async function applyAddFeedItemsPatchChange(items: FeedItem[], trace?: RequestTrace): Promise<void> {
  if (!currentDoc) throw new Error("Document not initialized");
  let changedIds: string[] = [];
  let dedupedCount = 0;
  currentDoc = A.change(currentDoc, `Add ${items.length.toLocaleString()} feed items`, (doc) => {
    for (const item of items) {
      compactFeedItemTextForSync(item);
      if (doc.feedItems[item.globalId]) continue;
      addFeedItem(doc, item);
      changedIds.push(item.globalId);
      addKnownLinkPreviewUrl(item);
    }
    if (
      changedIds.length > 0 &&
      items.some((item) => item.platform === "facebook" || item.platform === "instagram")
    ) {
      dedupedCount = deduplicateDocFeedItems(doc);
    }
  });

  if (changedIds.length === 0 && dedupedCount === 0) {
    emitWorkerTrace(
      `[automerge-worker] skip op=${trace?.opType ?? "unknown"} reason=no_changes`,
      "change",
    );
    return;
  }

  bumpSearchCorpusVersion();
  send({
    type: "DEBUG_EVENT",
    kind: "change",
    detail: `Add ${items.length.toLocaleString()} feed items: ${changedIds.length.toLocaleString()} changed`,
  });

  if (dedupedCount > 0) {
    emitWorkerTrace(
      `[automerge-worker] full-hydrate op=${trace?.opType ?? "unknown"} reason=social_dedup deleted=${dedupedCount.toLocaleString()}`,
    );
    await saveAndBroadcast(trace);
    return;
  }

  await persistAndBroadcastWithoutHydration(trace);
  const doc = currentDoc;
  const patches = cloneRankedFeedItemPatches(doc, changedIds);

  if (patches.length > 0) {
    send({
      type: "ITEM_PATCH",
      patches,
      changedItemIds: changedIds,
      preservePriorityOrder: true,
      searchCorpusVersion,
      mutation: trace?.opType,
    });
  }
}

async function applyBatchRefreshFeedsPatchChange(
  feeds: RssFeed[],
  items: FeedItem[],
  trace?: RequestTrace,
): Promise<void> {
  if (!currentDoc) throw new Error("Document not initialized");
  const feedPatch: RssFeedPatch = { feeds: {}, removedUrls: [] };
  let changedIds: string[] = [];
  currentDoc = A.change(currentDoc, `Refresh ${feeds.length.toLocaleString()} feeds, ${items.length.toLocaleString()} items`, (doc) => {
    for (const feed of feeds) {
      const stored = doc.rssFeeds[feed.url] as RssFeed | undefined;
      if (!stored) continue;
      if (feed.lastFetched !== undefined) stored.lastFetched = feed.lastFetched;
      if (feed.lastFetchAttemptedAt !== undefined) stored.lastFetchAttemptedAt = feed.lastFetchAttemptedAt;
      if (feed.nextFetchAfter !== undefined) stored.nextFetchAfter = feed.nextFetchAfter;
      if (feed.consecutiveFailures !== undefined) stored.consecutiveFailures = feed.consecutiveFailures;
      if (feed.lastFetchError !== undefined) stored.lastFetchError = feed.lastFetchError;
      if (feed.title && feed.title !== "Untitled Feed" && feed.title !== feed.url) {
        if (stored.title === "Untitled Feed" || stored.title === stored.url) {
          stored.title = feed.title;
        }
      }
      if (feed.siteUrl && !stored.siteUrl) stored.siteUrl = feed.siteUrl;
      feedPatch.feeds[feed.url] = cloneRssFeedForPatch(stored);
    }

    for (const item of items) {
      compactFeedItemTextForSync(item);
      if (doc.feedItems[item.globalId]) continue;
      const linkUrl = itemLinkPreviewUrl(item);
      if (hasKnownLinkPreviewUrl(linkUrl)) continue;
      addFeedItem(doc, item);
      changedIds.push(item.globalId);
      addKnownLinkPreviewUrl(item);
    }
  });

  const feedChanged = Object.keys(feedPatch.feeds).length > 0 || feedPatch.removedUrls.length > 0;
  if (!feedChanged && changedIds.length === 0) {
    emitWorkerTrace(
      `[automerge-worker] skip op=${trace?.opType ?? "unknown"} reason=no_changes`,
      "change",
    );
    return;
  }

  if (changedIds.length > 0) bumpSearchCorpusVersion();
  send({
    type: "DEBUG_EVENT",
    kind: "change",
    detail:
      `Refresh ${feeds.length.toLocaleString()} feeds, ${items.length.toLocaleString()} items: ` +
      `${changedIds.length.toLocaleString()} new`,
  });
  await persistAndBroadcastWithoutHydration(trace);

  if (feedChanged) {
    send({ type: "FEEDS_PATCH", patch: feedPatch, mutation: trace?.opType });
  }

  const doc = currentDoc;
  const patches = cloneRankedFeedItemPatches(doc, changedIds);
  if (patches.length > 0) {
    send({
      type: "ITEM_PATCH",
      patches,
      changedItemIds: changedIds,
      preservePriorityOrder: true,
      searchCorpusVersion,
      mutation: trace?.opType,
    });
  }
}

async function handleRequest(
  req: WorkerRequest,
  enqueuedAt: number,
): Promise<void> {
  const startedAt = performance.now();
  const trace: RequestTrace = {
    reqId: req.reqId,
    opType: req.type,
    enqueuedAt,
    startedAt,
    queuedBeforeStart: Math.max(0, queuedRequestCount - 1),
  };
  const waitMs = startedAt - enqueuedAt;
  if (req.type === "UPDATE_PREFERENCES" || waitMs >= SLOW_QUEUE_WAIT_MS) {
    emitWorkerTrace(
      `[automerge-worker] start op=${req.type} reqId=${req.reqId}` +
        ` wait_ms=${formatMs(waitMs)}` +
        ` queued=${trace.queuedBeforeStart.toLocaleString()}`,
    );
  }
  cancelDocIdleUnload();

  if (
    req.type !== "INIT" &&
    req.type !== "CLEAR_LOCAL" &&
    req.type !== "REPLACE_DOC" &&
    req.type !== "GET_DOC_BINARY" &&
    req.type !== "GET_HEADS"
  ) {
    ensureCurrentDocLoaded(req.type);
  }

  const applyRequestChange = (
    changeFn: (doc: FreedDoc) => void,
    message: string,
    searchCorpusChanged = false,
  ) => applyChange(changeFn, message, trace, searchCorpusChanged);

  try {
    switch (req.type) {
      case "INIT": {
        let loadedDocNeedsPersist = false;
        const saved = await storage.load();
        if (saved) {
          try {
            currentDoc = A.load<FreedDoc>(saved);
            currentBinary = saved;
            persistenceState = createPersistenceState(saved);
            loadedDocNeedsPersist =
              migrateLoadedIdentityGraph("Migrate legacy identity graph") || loadedDocNeedsPersist;
            loadedDocNeedsPersist =
              compactLoadedFeedText("Compact oversized synced feed text", {
                rebuildHistory: true,
                previousBinaryBytes: saved.byteLength,
              }) || loadedDocNeedsPersist;
          } catch {
            await storage.clear();
            currentDoc = null;
            currentBinary = null;
            persistenceState = createPersistenceState(null);
            send({ type: "DEBUG_EVENT", kind: "init", detail: "corrupt doc cleared, creating fresh" });
          }
        }
        if (!currentDoc) {
          currentDoc = createEmptyDoc();
          const binary = A.save(currentDoc);
          currentBinary = binary;
          persistenceState = createPersistenceState(binary);
          await storage.save(binary);
        }
        refreshLastSavedHeads(currentDoc);
        searchCorpusVersion = 1;
        const initializedDoc = currentDoc;
        if (!initializedDoc) throw new Error("Document not initialized");
        const deviceId = (initializedDoc.meta?.deviceId as string | undefined) ?? "unknown";
        send({ type: "DEBUG_EVENT", kind: "init", detail: `device ...${deviceId.slice(-8)}` });
        if (loadedDocNeedsPersist) {
          await saveAndBroadcast(trace);
        } else {
          await hydrateAndBroadcastWithoutPersist(trace);
        }
        send({
          type: "INIT_STATS",
          durationMs: Math.round(performance.now() - startedAt),
          docBytes: currentBinary?.byteLength ?? 0,
        });
        ack(req.reqId);
        break;
      }

      case "CLEAR_LOCAL":
        cancelDocIdleUnload();
        await storage.clear();
        currentDoc = null;
        currentBinary = null;
        refreshLastSavedHeads(null);
        persistenceState = createPersistenceState(null);
        linkPreviewUrlCounts = new Map();
        searchCorpusVersion = 0;
        ack(req.reqId);
        break;

      case "REPLACE_DOC":
        currentDoc = A.load<FreedDoc>(req.binary);
        currentBinary = req.binary;
        refreshLastSavedHeads(currentDoc);
        persistenceState = createPersistenceState(req.binary);
        migrateLoadedIdentityGraph("Migrate legacy identity graph");
        compactLoadedFeedText("Compact oversized synced feed text", {
          rebuildHistory: true,
          previousBinaryBytes: req.binary.byteLength,
        });
        bumpSearchCorpusVersion();
        await saveAndBroadcast(trace);
        ack(req.reqId);
        break;

      case "GET_DOC_BINARY":
        if (!currentBinary) {
          const doc = ensureCurrentDocLoaded(req.type);
          currentBinary = A.save(doc);
          refreshLastSavedHeads(doc);
          persistenceState = createPersistenceState(currentBinary);
        }
        send({ reqId: req.reqId, type: "DOC_BINARY", binary: currentBinary });
        break;

      case "GET_HEADS":
        send({
          reqId: req.reqId,
          type: "DOC_HEADS",
          heads: currentDoc ? A.getHeads(currentDoc) : lastSavedHeads,
        });
        break;

      case "MERGE_DOC": {
        if (!currentDoc) throw new Error("Document not initialized");
        const beforeCount = Object.keys(currentDoc.feedItems ?? {}).length;
        const incomingDoc = A.load<FreedDoc>(req.binary);
        const mergedDoc = A.merge(currentDoc, incomingDoc);
        const populatedSide = choosePopulatedInputForEmptyMerge(currentDoc, incomingDoc, mergedDoc);
        const resolvedDoc =
          populatedSide === "local" ? currentDoc : populatedSide === "incoming" ? incomingDoc : mergedDoc;
        const guard = assertNonDestructiveMerge(currentDoc, incomingDoc, resolvedDoc, {
          source: "Desktop sync",
        });
        currentDoc = populatedSide ? A.clone(resolvedDoc) : resolvedDoc;
        migrateLoadedIdentityGraph("Migrate legacy identity graph");
        compactLoadedFeedText("Compact oversized synced feed text after merge", {
          rebuildHistory: true,
          previousBinaryBytes: Math.max(currentBinary?.byteLength ?? 0, req.binary.byteLength),
        });
        const afterCount = Object.keys(currentDoc.feedItems ?? {}).length;
        const delta = afterCount - beforeCount;
        send({
          type: "DEBUG_EVENT",
          kind: "merge_ok",
          detail: delta !== 0 ? `${delta > 0 ? "+" : ""}${delta} items` : "no new items",
          bytes: req.binary.byteLength,
        });
        if (populatedSide) {
          send({
            type: "DEBUG_EVENT",
            kind: "merge_ok",
            detail: `adopted ${populatedSide} document because the other sync input was empty`,
            bytes: req.binary.byteLength,
          });
        }
        if (guard.deletedItemCount > 0) {
          send({
            type: "DEBUG_EVENT",
            kind: "merge_ok",
            detail: `merge safety checked ${guard.deletedItemCount.toLocaleString()} item deletions`,
            bytes: req.binary.byteLength,
          });
        }
        bumpSearchCorpusVersion();
        await saveAndBroadcast(trace);
        ack(req.reqId);
        break;
      }

      case "MARK_AS_READ":
        await applyItemPatchChange((doc) => {
          markAsRead(doc, req.globalId);
          return [req.globalId];
        }, "Mark as read", trace);
        ack(req.reqId);
        break;

      case "MARK_ITEMS_AS_READ":
        await applyItemPatchChange(
          (doc) => {
            markItemsAsRead(doc, req.globalIds);
            return req.globalIds;
          },
          `Mark ${req.globalIds.length.toLocaleString()} items as read`,
          trace,
        );
        ack(req.reqId);
        break;

      case "MARK_ALL_AS_READ":
        await applyItemPatchChange(
          (doc) => markAllVisibleAsRead(doc, req.platform),
          "Mark all as read",
          trace,
        );
        ack(req.reqId);
        break;

      case "TOGGLE_SAVED":
        await applyItemPatchChange((doc) => {
          toggleSaved(doc, req.globalId);
          return [req.globalId];
        }, "Toggle saved", trace);
        ack(req.reqId);
        break;

      case "TOGGLE_ARCHIVED":
        await applyItemPatchChange((doc) => {
          toggleArchived(doc, req.globalId);
          return [req.globalId];
        }, "Toggle archived", trace);
        ack(req.reqId);
        break;

      case "ARCHIVE_ITEMS":
        await applyItemPatchChange(
          (doc) => archiveItemsById(doc, req.globalIds),
          `Archive ${req.globalIds.length.toLocaleString()} items`,
          trace,
        );
        ack(req.reqId);
        break;

      case "TOGGLE_LIKED":
        await applyItemPatchChange((doc) => {
          toggleLiked(doc, req.globalId);
          return [req.globalId];
        }, "Toggle liked", trace);
        ack(req.reqId);
        break;

      case "CONFIRM_LIKED_SYNCED":
        await applyItemPatchChange(
          (doc) => {
            confirmLikedSynced(doc, req.globalId, req.syncedAt);
            return [req.globalId];
          },
          "Confirm liked synced",
          trace,
        );
        ack(req.reqId);
        break;

      case "CONFIRM_SEEN_SYNCED":
        await applyItemPatchChange(
          (doc) => {
            confirmSeenSynced(doc, req.globalId, req.syncedAt);
            return [req.globalId];
          },
          "Confirm seen synced",
          trace,
        );
        ack(req.reqId);
        break;

      case "ADD_FEED_ITEM":
        await applyRequestChange((doc) => {
          compactFeedItemTextForSync(req.item);
          if (!doc.feedItems[req.item.globalId]) addFeedItem(doc, req.item);
        }, "Add feed item", true);
        ack(req.reqId);
        break;

      case "ADD_FEED_ITEMS":
        await applyAddFeedItemsPatchChange(req.items, trace);
        ack(req.reqId);
        break;

      case "ADD_SAMPLE_LIBRARY_DATA":
        await applyRequestChange((doc) => {
          for (const feed of req.feeds) {
            addRssFeed(doc, feed);
          }
          for (const item of req.items) {
            compactFeedItemTextForSync(item);
            if (!doc.feedItems[item.globalId]) addFeedItem(doc, item);
          }
          for (const person of req.persons) {
            addPerson(doc, person);
          }
          addAccounts(doc, req.accounts);
        }, `Add sample library data: ${req.items.length.toLocaleString()} items`, true);
        ack(req.reqId);
        break;

      case "REMOVE_FEED_ITEM":
        await applyRequestChange((doc) => removeFeedItem(doc, req.globalId), "Remove feed item", true);
        ack(req.reqId);
        break;

      case "CLEAR_SAMPLE_DATA": {
        let summary = { feeds: 0, items: 0, persons: 0, accounts: 0, total: 0 };
        await applyRequestChange((doc) => {
          summary = clearSampleData(doc);
        }, "Clear sample data", true);
        send({ reqId: req.reqId, type: "SAMPLE_DATA_CLEAR_RESULT", summary });
        break;
      }

      case "UPDATE_FEED_ITEM":
        await applyRequestChange(
          (doc) => {
            updateFeedItem(doc, req.globalId, req.updates);
            const item = doc.feedItems[req.globalId] as FeedItem | undefined;
            if (item) compactFeedItemTextForSync(item);
          },
          "Update feed item",
          feedItemUpdatesAffectSearchCorpus(req.updates),
        );
        ack(req.reqId);
        break;

      case "ARCHIVE_ALL_READ_UNSAVED":
        await applyItemPatchChange(
          (doc) => archiveAllReadableUnsaved(doc, req.platform, req.feedUrl),
          "Archive all read",
          trace,
        );
        ack(req.reqId);
        break;

      case "UNARCHIVE_SAVED_ITEMS":
        await applyItemPatchChange(
          (doc) => unarchiveSavedItemIds(doc),
          "Unarchive saved items",
          trace,
        );
        ack(req.reqId);
        break;

      case "PRUNE_ARCHIVED_ITEMS":
        await applyCountedChange(
          (doc) => pruneArchivedItems(doc, req.maxAgeMs),
          "Prune archived items",
          trace,
          true,
        );
        ack(req.reqId);
        break;

      case "DELETE_ALL_ARCHIVED":
        await applyRequestChange(
          (doc) => deleteAllArchivedItems(doc),
          "Delete all archived items",
          true,
        );
        ack(req.reqId);
        break;

      case "ADD_RSS_FEED":
        await applyRssFeedPatchChange(
          (doc) => {
            addRssFeed(doc, req.feed);
            const stored = doc.rssFeeds[req.feed.url] as RssFeed | undefined;
            return {
              feeds: stored ? { [req.feed.url]: cloneRssFeedForPatch(stored) } : {},
              removedUrls: [],
            };
          },
          "Add RSS feed",
          trace,
        );
        ack(req.reqId);
        break;

      case "REMOVE_RSS_FEED":
        if (req.includeItems) {
          await applyRequestChange(
            (doc) => removeRssFeed(doc, req.url, true),
            "Remove RSS feed and articles",
            true,
          );
        } else {
          await applyRssFeedPatchChange(
            (doc) => {
              removeRssFeed(doc, req.url, false);
              return { feeds: {}, removedUrls: [req.url] };
            },
            "Remove RSS feed",
            trace,
          );
        }
        ack(req.reqId);
        break;

      case "UPDATE_RSS_FEED":
        await applyRssFeedPatchChange(
          (doc) => {
            updateRssFeed(doc, req.url, req.updates as Parameters<typeof updateRssFeed>[2]);
            const stored = doc.rssFeeds[req.url] as RssFeed | undefined;
            return {
              feeds: stored ? { [req.url]: cloneRssFeedForPatch(stored) } : {},
              removedUrls: [],
            };
          },
          "Update RSS feed",
          trace,
        );
        ack(req.reqId);
        break;

      case "REMOVE_ALL_FEEDS":
        await applyRequestChange(
          (doc) => removeAllFeeds(doc, req.includeItems),
          req.includeItems ? "Remove all feeds and articles" : "Remove all feeds",
          true,
        );
        ack(req.reqId);
        break;

      case "UPDATE_PREFERENCES":
        await applyPreferenceChange(req.updates, trace);
        ack(req.reqId);
        break;

      case "UPDATE_LAST_SYNC":
        if (!currentDoc) throw new Error("Document not initialized");
        currentDoc = A.change(currentDoc, "Update last sync", (doc) => {
          updateLastSync(doc);
        });
        send({ type: "DEBUG_EVENT", kind: "change", detail: "Update last sync" });
        await persistAndBroadcastWithoutHydration(trace);
        ack(req.reqId);
        break;

      case "ADD_PERSON":
        await applyRequestChange((doc) => addPerson(doc, req.person), "Add person");
        ack(req.reqId);
        break;

      case "ADD_PERSONS":
        await applyRequestChange((doc) => {
          for (const person of req.persons) {
            addPerson(doc, person);
          }
        }, `Add ${req.persons.length.toLocaleString()} people`);
        ack(req.reqId);
        break;

      case "UPDATE_PERSON":
        await applyRequestChange(
          (doc) => updatePerson(doc, req.personId, req.updates as Partial<Person>),
          "Update person",
        );
        ack(req.reqId);
        break;

      case "UPSERT_CONNECTION_PERSONS":
        await applyRequestChange((doc) => {
          const now = Date.now();
          for (const candidate of req.candidates) {
            if (doc.persons[candidate.person.id]) {
              updatePerson(doc, candidate.person.id, candidate.person);
            } else {
              addPerson(doc, candidate.person);
            }
            for (const accountId of candidate.accountIds) {
              const account = doc.accounts[accountId];
              if (!account || account.personId === candidate.person.id) continue;
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
        await applyRequestChange((doc) => removePerson(doc, req.personId), "Remove person");
        ack(req.reqId);
        break;

      case "LOG_REACH_OUT":
        await applyRequestChange(
          (doc) => logReachOut(doc, req.personId, req.entry),
          "Log reach-out",
        );
        ack(req.reqId);
        break;

      case "ADD_ACCOUNT":
        await applyRequestChange((doc) => addAccount(doc, req.account), "Add account");
        ack(req.reqId);
        break;

      case "ADD_ACCOUNTS":
        await applyRequestChange((doc) => addAccounts(doc, req.accounts), `Add ${req.accounts.length.toLocaleString()} accounts`);
        ack(req.reqId);
        break;

      case "UPDATE_ACCOUNT":
        await applyRequestChange((doc) => updateAccount(doc, req.accountId, req.updates), "Update account");
        ack(req.reqId);
        break;

      case "REMOVE_ACCOUNT":
        await applyRequestChange((doc) => removeAccount(doc, req.accountId), "Remove account");
        ack(req.reqId);
        break;

      case "BATCH_REFRESH_FEEDS":
        await applyBatchRefreshFeedsPatchChange(req.feeds, req.items, trace);
        ack(req.reqId);
        break;

      case "BATCH_IMPORT_ITEMS": {
        const CHUNK = 500;
        const items = req.items;
        const totalChunks = Math.ceil(items.length / CHUNK);
        for (let i = 0; i < items.length; i += CHUNK) {
          const chunkIndex = Math.floor(i / CHUNK);
          const chunk = items.slice(i, i + CHUNK);
          await applyRequestChange((doc) => {
            for (const item of chunk) {
              compactFeedItemTextForSync(item);
              if (!doc.feedItems[item.globalId]) addFeedItem(doc, item);
            }
          }, `Batch import chunk ${chunkIndex + 1}/${totalChunks}`, true);
          send({ type: "IMPORT_PROGRESS", chunkIndex: chunkIndex + 1, totalChunks });
        }
        ack(req.reqId);
        break;
      }

      case "HEAL_UNTITLED_FEEDS":
        await applyCountedChange(
          healUntitledFeedTitles,
          "Heal untitled feed titles from URL hostname",
          trace,
          true,
        );
        ack(req.reqId);
        break;

      case "DEDUPLICATE_ITEMS":
        await applyCountedChange(
          deduplicateDocFeedItems,
          "Deduplicate feed items by article link URL and linked social cross-posts",
          trace,
          true,
        );
        ack(req.reqId);
        break;

      case "BACKFILL_CONTENT_SIGNALS": {
        if (!currentDoc) throw new Error("Document not initialized");
        let summary = summarizeDocContentSignals(currentDoc);
        const pendingCount = countContentSignalBackfillItems(currentDoc);
        if (pendingCount > 0) {
          currentDoc = A.change(currentDoc, "Backfill content signals", (doc) => {
            summary = backfillContentSignals(doc, req.batchSize);
          });
          bumpSearchCorpusVersion();
          send({
            type: "DEBUG_EVENT",
            kind: "change",
            detail:
              `[content-signals] backfilled ${summary.updated.toLocaleString()} items, ` +
              `${summary.remaining.toLocaleString()} remaining`,
          });
          await saveAndBroadcast(trace);
        }
        send({ reqId: req.reqId, type: "CONTENT_SIGNAL_BACKFILL_RESULT", summary });
        break;
      }

      case "GET_ALL_ITEM_IDS":
        if (!currentDoc) throw new Error("Document not initialized");
        send({
          reqId: req.reqId,
          type: "ALL_ITEM_IDS",
          ids: Object.keys(currentDoc.feedItems ?? {}),
        });
        break;

      case "GET_ITEM_PRESERVED_TEXT":
        if (!currentDoc) throw new Error("Document not initialized");
        send({
          reqId: req.reqId,
          type: "ITEM_PRESERVED_TEXT",
          globalId: req.globalId,
          text:
            currentDoc.feedItems[req.globalId]?.preservedContent?.text ??
            currentDoc.feedItems[req.globalId]?.content.text ??
            null,
        });
        break;

      case "UPDATE_RELAY_CLIENT_COUNT":
        relayClientCount = req.count;
        ack(req.reqId);
        break;

      default: {
        const _exhaustive: never = req;
        void _exhaustive;
        ack((req as WorkerRequest).reqId, `Unknown request type: ${(req as { type: string }).type}`);
      }
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    emitWorkerTrace(
      `[automerge-worker] error op=${req.type} reqId=${req.reqId}` +
        ` wait_ms=${formatMs(waitMs)}` +
        ` process_ms=${formatMs(performance.now() - startedAt)}` +
        ` message=${message}`,
      "error",
    );
    ack(req.reqId, message);
    return;
  }

  const processMs = performance.now() - startedAt;
  if (
    req.type === "UPDATE_PREFERENCES" ||
    waitMs >= SLOW_QUEUE_WAIT_MS ||
    processMs >= SLOW_REQUEST_PROCESS_MS
  ) {
    emitWorkerTrace(
      `[automerge-worker] complete op=${req.type} reqId=${req.reqId}` +
        ` wait_ms=${formatMs(waitMs)}` +
        ` process_ms=${formatMs(processMs)}` +
        ` total_ms=${formatMs(performance.now() - enqueuedAt)}`,
    );
  }
}

function enqueueRequest(req: WorkerRequest): void {
  const enqueuedAt = performance.now();
  queuedRequestCount += 1;
  requestChain = requestChain
    .then(() => handleRequest(req, enqueuedAt))
    .catch((error) => {
      const message = error instanceof Error ? error.message : String(error);
      emitWorkerTrace(
        `[automerge-worker] queue failure op=${req.type} reqId=${req.reqId} message=${message}`,
        "error",
      );
      ack(req.reqId, message);
    })
    .finally(() => {
      queuedRequestCount = Math.max(0, queuedRequestCount - 1);
      scheduleDocIdleUnload();
    });
}

// ---------------------------------------------------------------------------
// Message handler
// ---------------------------------------------------------------------------

self.onmessage = (event: MessageEvent<WorkerRequest>) => {
  const req = event.data;
  if (req.type === "UPDATE_RELAY_CLIENT_COUNT") {
    relayClientCount = req.count;
    return;
  }

  enqueueRequest(req);
};

// Signal the main thread that the module finished loading and the onmessage
// handler is installed. Without this, messages sent before evaluation completes
// are silently dropped in Vite's dev-mode module workers.
self.postMessage({ type: "READY" } satisfies WorkerResponse);

export {};
