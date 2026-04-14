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
  createEmptyDoc,
  addFeedItem,
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
  pruneArchivedItems,
  deleteAllArchivedItems,
  updatePreferences,
  updateLastSync,
  addFriend,
  updateFriend,
  removeFriend,
  logReachOut,
  toggleLiked,
  confirmLikedSynced,
  confirmSeenSynced,
} from "@freed/shared/schema";
import { createDefaultPreferences, rankFeedItems } from "@freed/shared";
import type { FeedItem, Friend, RssFeed, UserPreferences } from "@freed/shared";
import type { DocState, WorkerRequest, WorkerResponse } from "./automerge-types";
import {
  createPersistenceState,
  persistDoc,
  type AutomergePersistenceState,
} from "./automerge-persistence";

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

const SLOW_QUEUE_WAIT_MS = 1_000;
const SLOW_REQUEST_PROCESS_MS = 5_000;
const SLOW_SAVE_AND_BROADCAST_MS = 2_000;
const DESKTOP_UI_PRESERVED_TEXT_LIMIT = 3_000;

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

function formatMs(ms: number): string {
  return Math.round(ms).toLocaleString();
}

function emitWorkerTrace(
  detail: string,
  kind: Extract<WorkerResponse, { type: "DEBUG_EVENT" }>["kind"] = "change",
): void {
  send({ type: "DEBUG_EVENT", kind, detail });
}

/**
 * Convert the Automerge proxy document to a plain-JS DocState for postMessage.
 * Identical to the PWA worker — runs entirely off the main thread.
 */
function hydrateFromDoc(doc: FreedDoc): DocState {
  const plain = A.toJS(doc) as FreedDoc;
  const plainItems = Object.values(plain.feedItems as Record<string, FeedItem>).map((item) => {
    const preservedContent = item.preservedContent;
    const preservedText = preservedContent?.text;
    if (!preservedContent || !preservedText || preservedText.length <= DESKTOP_UI_PRESERVED_TEXT_LIMIT) {
      return item;
    }

    return {
      ...item,
      preservedContent: {
        ...preservedContent,
        text: preservedText.slice(0, DESKTOP_UI_PRESERVED_TEXT_LIMIT),
      },
    } as FeedItem;
  });
  const feeds = plain.rssFeeds as Record<string, RssFeed>;
  const friends = (plain.friends ?? {}) as Record<string, Friend>;
  const preferences = {
    ...createDefaultPreferences(),
    ...(plain.preferences as Partial<UserPreferences>),
    xCapture: {
      ...createDefaultPreferences().xCapture,
      ...(plain.preferences?.xCapture as Partial<UserPreferences["xCapture"]> | undefined),
    },
    fbCapture: {
      ...createDefaultPreferences().fbCapture,
      ...(plain.preferences?.fbCapture as Partial<UserPreferences["fbCapture"]> | undefined),
    },
    ai: {
      ...createDefaultPreferences().ai,
      ...(plain.preferences?.ai as Partial<UserPreferences["ai"]> | undefined),
    },
    display: {
      ...createDefaultPreferences().display,
      ...(plain.preferences?.display as Partial<UserPreferences["display"]> | undefined),
      reading: {
        ...createDefaultPreferences().display.reading,
        ...(plain.preferences?.display?.reading as Partial<UserPreferences["display"]["reading"]> | undefined),
      },
    },
    sync: {
      ...createDefaultPreferences().sync,
      ...(plain.preferences?.sync as Partial<UserPreferences["sync"]> | undefined),
    },
    ulysses: {
      ...createDefaultPreferences().ulysses,
      ...(plain.preferences?.ulysses as Partial<UserPreferences["ulysses"]> | undefined),
      allowedPaths: {
        ...createDefaultPreferences().ulysses.allowedPaths,
        ...(plain.preferences?.ulysses?.allowedPaths as Record<string, string[]> | undefined),
      },
    },
    weights: {
      ...createDefaultPreferences().weights,
      ...(plain.preferences?.weights as Partial<UserPreferences["weights"]> | undefined),
    },
  } satisfies UserPreferences;

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
    feeds,
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
    docItemCount: Object.keys(plain.feedItems as Record<string, FeedItem>).length,
  };
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
  const afterSerializeAt = performance.now();
  await storage.save(binary);
  const afterPersistAt = performance.now();
  const state = hydrateFromDoc(doc);
  const afterHydrateAt = performance.now();

  const snapshot: Extract<WorkerResponse, { type: "DEBUG_SNAPSHOT" }> = {
    type: "DEBUG_SNAPSHOT",
    deviceId: (doc.meta?.deviceId as string | undefined) ?? "unknown",
    itemCount: Object.keys(doc.feedItems ?? {}).length,
    feedCount: Object.keys(doc.rssFeeds ?? {}).length,
    binarySize: binary.byteLength,
  };
  send(snapshot);
  send({ type: "STATE_UPDATE", state });

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

async function applyChange(
  changeFn: (doc: FreedDoc) => void,
  message: string,
  trace?: RequestTrace,
): Promise<void> {
  if (!currentDoc) throw new Error("Document not initialized");
  currentDoc = A.change(currentDoc, message, changeFn);
  send({ type: "DEBUG_EVENT", kind: "change", detail: message });
  await saveAndBroadcast(trace);
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

  const applyRequestChange = (
    changeFn: (doc: FreedDoc) => void,
    message: string,
  ) => applyChange(changeFn, message, trace);

  try {
    switch (req.type) {
      case "INIT": {
        const saved = await storage.load();
        if (saved) {
          try {
            currentDoc = A.load<FreedDoc>(saved);
            currentBinary = saved;
            persistenceState = createPersistenceState(saved);
          } catch {
            await storage.clear();
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
        const deviceId = (currentDoc.meta?.deviceId as string | undefined) ?? "unknown";
        send({ type: "DEBUG_EVENT", kind: "init", detail: `device ...${deviceId.slice(-8)}` });
        await saveAndBroadcast(trace);
        ack(req.reqId);
        break;
      }

      case "CLEAR_LOCAL":
        await storage.clear();
        currentDoc = null;
        currentBinary = null;
        persistenceState = createPersistenceState(null);
        ack(req.reqId);
        break;

      case "REPLACE_DOC":
        currentDoc = A.load<FreedDoc>(req.binary);
        currentBinary = req.binary;
        persistenceState = createPersistenceState(req.binary);
        await storage.save(req.binary);
        await saveAndBroadcast(trace);
        ack(req.reqId);
        break;

      case "GET_DOC_BINARY":
        if (!currentDoc) throw new Error("Document not initialized");
        if (!currentBinary) {
          currentBinary = A.save(currentDoc);
          persistenceState = createPersistenceState(currentBinary);
        }
        send({ reqId: req.reqId, type: "DOC_BINARY", binary: currentBinary });
        break;

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
        await saveAndBroadcast(trace);
        ack(req.reqId);
        break;
      }

      case "MARK_AS_READ":
        await applyRequestChange((doc) => markAsRead(doc, req.globalId), "Mark as read");
        ack(req.reqId);
        break;

      case "MARK_ITEMS_AS_READ":
        await applyRequestChange(
          (doc) => markItemsAsRead(doc, req.globalIds),
          `Mark ${req.globalIds.length.toLocaleString()} items as read`,
        );
        ack(req.reqId);
        break;

      case "MARK_ALL_AS_READ":
        await applyRequestChange((doc) => {
          const now = Date.now();
          for (const item of Object.values(doc.feedItems) as FeedItem[]) {
            if (item.userState.readAt) continue;
            if (item.userState.hidden || item.userState.archived) continue;
            if (req.platform && item.platform !== req.platform) continue;
            item.userState.readAt = now;
          }
        }, "Mark all as read");
        ack(req.reqId);
        break;

      case "TOGGLE_SAVED":
        await applyRequestChange((doc) => toggleSaved(doc, req.globalId), "Toggle saved");
        ack(req.reqId);
        break;

      case "TOGGLE_ARCHIVED":
        await applyRequestChange((doc) => toggleArchived(doc, req.globalId), "Toggle archived");
        ack(req.reqId);
        break;

      case "TOGGLE_LIKED":
        await applyRequestChange((doc) => toggleLiked(doc, req.globalId), "Toggle liked");
        ack(req.reqId);
        break;

      case "CONFIRM_LIKED_SYNCED":
        await applyRequestChange(
          (doc) => confirmLikedSynced(doc, req.globalId, req.syncedAt),
          "Confirm liked synced",
        );
        ack(req.reqId);
        break;

      case "CONFIRM_SEEN_SYNCED":
        await applyRequestChange(
          (doc) => confirmSeenSynced(doc, req.globalId, req.syncedAt),
          "Confirm seen synced",
        );
        ack(req.reqId);
        break;

      case "ADD_FEED_ITEM":
        await applyRequestChange((doc) => {
          if (!doc.feedItems[req.item.globalId]) addFeedItem(doc, req.item);
        }, "Add feed item");
        ack(req.reqId);
        break;

      case "ADD_FEED_ITEMS":
        await applyRequestChange((doc) => {
          for (const item of req.items) {
            if (!doc.feedItems[item.globalId]) addFeedItem(doc, item);
          }
        }, `Add ${req.items.length} feed items`);
        ack(req.reqId);
        break;

      case "REMOVE_FEED_ITEM":
        await applyRequestChange((doc) => removeFeedItem(doc, req.globalId), "Remove feed item");
        ack(req.reqId);
        break;

      case "UPDATE_FEED_ITEM":
        await applyRequestChange(
          (doc) => updateFeedItem(doc, req.globalId, req.updates),
          "Update feed item",
        );
        ack(req.reqId);
        break;

      case "ARCHIVE_ALL_READ_UNSAVED":
        await applyRequestChange(
          (doc) => archiveAllReadUnsaved(doc, req.platform, req.feedUrl),
          "Archive all read",
        );
        ack(req.reqId);
        break;

      case "PRUNE_ARCHIVED_ITEMS":
        await applyRequestChange(
          (doc) => pruneArchivedItems(doc, req.maxAgeMs),
          "Prune archived items",
        );
        ack(req.reqId);
        break;

      case "DELETE_ALL_ARCHIVED":
        await applyRequestChange(
          (doc) => deleteAllArchivedItems(doc),
          "Delete all archived items",
        );
        ack(req.reqId);
        break;

      case "ADD_RSS_FEED":
        await applyRequestChange((doc) => addRssFeed(doc, req.feed), "Add RSS feed");
        ack(req.reqId);
        break;

      case "REMOVE_RSS_FEED":
        await applyRequestChange(
          (doc) => removeRssFeed(doc, req.url, req.includeItems),
          req.includeItems ? "Remove RSS feed and articles" : "Remove RSS feed",
        );
        ack(req.reqId);
        break;

      case "UPDATE_RSS_FEED":
        await applyRequestChange(
          (doc) => updateRssFeed(doc, req.url, req.updates as Parameters<typeof updateRssFeed>[2]),
          "Update RSS feed",
        );
        ack(req.reqId);
        break;

      case "REMOVE_ALL_FEEDS":
        await applyRequestChange(
          (doc) => removeAllFeeds(doc, req.includeItems),
          req.includeItems ? "Remove all feeds and articles" : "Remove all feeds",
        );
        ack(req.reqId);
        break;

      case "UPDATE_PREFERENCES":
        await applyRequestChange(
          (doc) => updatePreferences(doc, req.updates),
          "Update preferences",
        );
        ack(req.reqId);
        break;

      case "UPDATE_LAST_SYNC":
        await applyRequestChange((doc) => updateLastSync(doc), "Update last sync");
        ack(req.reqId);
        break;

      case "ADD_FRIEND":
        await applyRequestChange((doc) => addFriend(doc, req.friend), "Add friend");
        ack(req.reqId);
        break;

      case "ADD_FRIENDS":
        await applyRequestChange((doc) => {
          for (const friend of req.friends) {
            addFriend(doc, friend);
          }
        }, `Add ${req.friends.length} friends`);
        ack(req.reqId);
        break;

      case "UPDATE_FRIEND":
        await applyRequestChange(
          (doc) => updateFriend(doc, req.friendId, req.updates as Partial<Friend>),
          "Update friend",
        );
        ack(req.reqId);
        break;

      case "REMOVE_FRIEND":
        await applyRequestChange((doc) => removeFriend(doc, req.friendId), "Remove friend");
        ack(req.reqId);
        break;

      case "LOG_REACH_OUT":
        await applyRequestChange(
          (doc) => logReachOut(doc, req.friendId, req.entry),
          "Log reach-out",
        );
        ack(req.reqId);
        break;

      case "BATCH_REFRESH_FEEDS":
        await applyRequestChange((doc) => {
          for (const feed of req.feeds) {
            const stored = doc.rssFeeds[feed.url] as RssFeed | undefined;
            if (!stored) continue;
            if (feed.lastFetched !== undefined) stored.lastFetched = feed.lastFetched;
            if (feed.title && feed.title !== "Untitled Feed" && feed.title !== feed.url) {
              if (stored.title === "Untitled Feed" || stored.title === stored.url) {
                stored.title = feed.title;
              }
            }
            if (feed.siteUrl && !stored.siteUrl) stored.siteUrl = feed.siteUrl;
          }

          const existingLinkUrls = new Set<string>();
          for (const existing of Object.values(doc.feedItems) as FeedItem[]) {
            const url = existing.content.linkPreview?.url;
            if (url) existingLinkUrls.add(url);
          }
          for (const item of req.items) {
            if (doc.feedItems[item.globalId]) continue;
            const linkUrl = item.content.linkPreview?.url;
            if (linkUrl && existingLinkUrls.has(linkUrl)) continue;
            addFeedItem(doc, item);
            if (linkUrl) existingLinkUrls.add(linkUrl);
          }
        }, `Refresh ${req.feeds.length} feeds, ${req.items.length} items`);
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
              if (!doc.feedItems[item.globalId]) addFeedItem(doc, item);
            }
          }, `Batch import chunk ${chunkIndex + 1}/${totalChunks}`);
          send({ type: "IMPORT_PROGRESS", chunkIndex: chunkIndex + 1, totalChunks });
        }
        ack(req.reqId);
        break;
      }

      case "HEAL_UNTITLED_FEEDS":
        await applyRequestChange((doc) => {
          for (const feed of Object.values(doc.rssFeeds) as RssFeed[]) {
            const isUntitled = feed.title === "Untitled Feed" || feed.title === feed.url;
            if (!isUntitled) continue;
            let healed: string | undefined;
            try { healed = new URL(feed.url).hostname.replace(/^(?:www|feeds?)\./, ""); } catch { /* */ }
            if (healed) feed.title = healed;
          }
        }, "Heal untitled feed titles from URL hostname");
        ack(req.reqId);
        break;

      case "DEDUPLICATE_ITEMS":
        await applyRequestChange((doc) => {
          const linkToIds = new Map<string, string[]>();
          for (const [id, item] of Object.entries(doc.feedItems) as [string, FeedItem][]) {
            const url = item.content.linkPreview?.url;
            if (!url) continue;
            const group = linkToIds.get(url);
            if (group) group.push(id);
            else linkToIds.set(url, [id]);
          }
          for (const ids of linkToIds.values()) {
            if (ids.length <= 1) continue;
            const scored = ids.map((id) => {
              const s = (doc.feedItems[id] as FeedItem).userState;
              return {
                id,
                score:
                  (s.saved ? 100 : 0) +
                  ((s.tags?.length ?? 0) * 10) +
                  (s.archived ? 5 : 0) +
                  (s.readAt ? 1 : 0),
              };
            });
            scored.sort((a, b) => b.score - a.score || b.id.localeCompare(a.id));
            for (let i = 1; i < scored.length; i++) delete doc.feedItems[scored[i].id];
          }
        }, "Deduplicate feed items by article link URL");
        ack(req.reqId);
        break;

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
          text: currentDoc.feedItems[req.globalId]?.preservedContent?.text ?? null,
        });
        break;

      case "GET_DOC_BINARY":
        if (!currentDoc) throw new Error("Document not initialized");
        if (!currentBinary) {
          currentBinary = A.save(currentDoc);
          persistenceState = createPersistenceState(currentBinary);
        }
        send({
          reqId: req.reqId,
          type: "DOC_BINARY",
          binary: currentBinary,
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
