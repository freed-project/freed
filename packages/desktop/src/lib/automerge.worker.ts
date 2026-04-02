/**
 * Automerge document worker for Freed Desktop
 *
 * Runs ALL WASM operations (A.change, A.save, A.load, A.merge) off the main
 * thread. The main thread only receives plain-JS state updates via postMessage.
 *
 * Desktop additions over the PWA worker:
 *   - UPDATE_RELAY_CLIENT_COUNT: tracks connected PWA clients
 *   - BROADCAST_REQUEST response: posts pre-serialized Array.from(binary) to
 *     the main thread, which calls invoke("broadcast_doc") — Tauri IPC requires
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

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

const storage = new IndexedDBStorage();
let currentDoc: FreedDoc | null = null;
let relayClientCount = 0;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function send(msg: WorkerResponse): void {
  self.postMessage(msg);
}

function ack(reqId: number, error?: string): void {
  send({ reqId, type: "ACK", error });
}

/**
 * Convert the Automerge proxy document to a plain-JS DocState for postMessage.
 * Identical to the PWA worker — runs entirely off the main thread.
 */
function hydrateFromDoc(doc: FreedDoc): DocState {
  const plain = A.toJS(doc) as FreedDoc;
  const plainItems = Object.values(plain.feedItems as Record<string, FeedItem>);
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
    allItemIds: Object.keys(plain.feedItems as Record<string, FeedItem>),
  };
}

/**
 * Persist, hydrate, and broadcast state + (if relay clients connected) request
 * a broadcast_doc IPC call from the main thread. The Array.from(binary) here
 * is the key optimization — it runs in the worker, not the main thread.
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
  send({ type: "STATE_UPDATE", state, binary });

  // Request main thread to relay the binary to connected PWA clients.
  // Array.from() (O(binary size)) runs here in the worker — off the main thread.
  if (relayClientCount > 0) {
    send({ type: "BROADCAST_REQUEST", data: Array.from(binary) });
  }
}

async function applyChange(
  changeFn: (doc: FreedDoc) => void,
  message: string,
): Promise<void> {
  if (!currentDoc) throw new Error("Document not initialized");
  currentDoc = A.change(currentDoc, message, changeFn);
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
      // ─── Relay management (fire-and-forget) ─────────────────────────────
      case "UPDATE_RELAY_CLIENT_COUNT":
        relayClientCount = req.count;
        ack(req.reqId);
        break;

      // ─── Lifecycle ────────────────────────────────────────────────────────
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
        const deviceId = (currentDoc.meta?.deviceId as string | undefined) ?? "unknown";
        send({ type: "DEBUG_EVENT", kind: "init", detail: `device ...${deviceId.slice(-8)}` });
        await saveAndBroadcast();
        ack(req.reqId);
        break;
      }

      case "CLEAR_LOCAL":
        await storage.clear();
        currentDoc = null;
        ack(req.reqId);
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
        await saveAndBroadcast();
        ack(req.reqId);
        break;
      }

      // ─── Item mutations ───────────────────────────────────────────────────
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
        }, "Add feed item");
        ack(req.reqId);
        break;

      case "ADD_FEED_ITEMS":
        await applyChange((doc) => {
          for (const item of req.items) {
            if (!doc.feedItems[item.globalId]) addFeedItem(doc, item);
          }
        }, `Add ${req.items.length} feed items`);
        ack(req.reqId);
        break;

      case "REMOVE_FEED_ITEM":
        await applyChange((doc) => removeFeedItem(doc, req.globalId), "Remove feed item");
        ack(req.reqId);
        break;

      case "UPDATE_FEED_ITEM":
        await applyChange(
          (doc) => updateFeedItem(doc, req.globalId, req.updates),
          "Update feed item",
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

      case "PRUNE_ARCHIVED_ITEMS":
        await applyChange(
          (doc) => pruneArchivedItems(doc, req.maxAgeMs),
          "Prune archived items",
        );
        ack(req.reqId);
        break;

      case "DELETE_ALL_ARCHIVED":
        await applyChange(
          (doc) => deleteAllArchivedItems(doc),
          "Delete all archived items",
        );
        ack(req.reqId);
        break;

      // ─── Feed mutations ───────────────────────────────────────────────────
      case "ADD_RSS_FEED":
        await applyChange((doc) => addRssFeed(doc, req.feed), "Add RSS feed");
        ack(req.reqId);
        break;

      case "REMOVE_RSS_FEED":
        await applyChange(
          (doc) => removeRssFeed(doc, req.url, req.includeItems),
          req.includeItems ? "Remove RSS feed and articles" : "Remove RSS feed",
        );
        ack(req.reqId);
        break;

      case "UPDATE_RSS_FEED":
        await applyChange(
          (doc) => updateRssFeed(doc, req.url, req.updates as Parameters<typeof updateRssFeed>[2]),
          "Update RSS feed",
        );
        ack(req.reqId);
        break;

      case "REMOVE_ALL_FEEDS":
        await applyChange(
          (doc) => removeAllFeeds(doc, req.includeItems),
          req.includeItems ? "Remove all feeds and articles" : "Remove all feeds",
        );
        ack(req.reqId);
        break;

      // ─── Preferences + sync ───────────────────────────────────────────────
      case "UPDATE_PREFERENCES":
        await applyChange(
          (doc) => updatePreferences(doc, req.updates),
          "Update preferences",
        );
        ack(req.reqId);
        break;

      case "UPDATE_LAST_SYNC":
        await applyChange((doc) => updateLastSync(doc), "Update last sync");
        ack(req.reqId);
        break;

      // ─── Friend mutations ─────────────────────────────────────────────────
      case "ADD_FRIEND":
        await applyChange((doc) => addFriend(doc, req.friend), "Add friend");
        ack(req.reqId);
        break;

      case "ADD_FRIENDS":
        await applyChange((doc) => {
          for (const friend of req.friends) {
            addFriend(doc, friend);
          }
        }, `Add ${req.friends.length} friends`);
        ack(req.reqId);
        break;

      case "UPDATE_FRIEND":
        await applyChange(
          (doc) => updateFriend(doc, req.friendId, req.updates as Partial<Friend>),
          "Update friend",
        );
        ack(req.reqId);
        break;

      case "REMOVE_FRIEND":
        await applyChange((doc) => removeFriend(doc, req.friendId), "Remove friend");
        ack(req.reqId);
        break;

      case "LOG_REACH_OUT":
        await applyChange(
          (doc) => logReachOut(doc, req.friendId, req.entry),
          "Log reach-out",
        );
        ack(req.reqId);
        break;

      // ─── Desktop-specific mutations ───────────────────────────────────────
      case "BATCH_REFRESH_FEEDS":
        await applyChange((doc) => {
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
          await applyChange((doc) => {
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
        await applyChange((doc) => {
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
        await applyChange((doc) => {
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

export {};
