/**
 * Automerge document management for Freed desktop
 *
 * Handles loading, saving, and syncing the Automerge CRDT document.
 */

import * as A from "@automerge/automerge";
import { invoke } from "@tauri-apps/api/core";
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
  toggleSaved,
  updatePreferences,
  updateLastSync,
} from "@freed/shared/schema";
import type { FeedItem, RssFeed, UserPreferences } from "@freed/shared";
import { addDebugEvent, setDocSnapshot, registerDocAccessors } from "@freed/ui/lib/debug-store";

// Singleton storage instance
const storage = new IndexedDBStorage();

// Current document state
let currentDoc: FreedDoc | null = null;

// Subscribers for document changes
type Subscriber = (doc: FreedDoc) => void;
const subscribers = new Set<Subscriber>();

/** Snapshot current doc stats into the debug store */
function snapshotDoc(): void {
  if (!currentDoc) return;
  const binary = A.save(currentDoc);
  setDocSnapshot({
    deviceId: (currentDoc.meta?.deviceId as string | undefined) ?? "unknown",
    itemCount: Object.keys(currentDoc.feedItems ?? {}).length,
    feedCount: Object.keys(currentDoc.rssFeeds ?? {}).length,
    binarySize: binary.byteLength,
    savedAt: Date.now(),
  });
}

/**
 * Initialize or load the Automerge document
 */
export async function initDoc(): Promise<FreedDoc> {
  const saved = await storage.load();

  if (saved) {
    currentDoc = A.load<FreedDoc>(saved);
  } else {
    currentDoc = createEmptyDoc();
    await saveDoc();
  }

  const deviceId = (currentDoc.meta?.deviceId as string | undefined) ?? "unknown";
  addDebugEvent("init", `device ...${deviceId.slice(-8)}`);
  snapshotDoc();

  registerDocAccessors(
    () => currentDoc,
    () => JSON.stringify(A.toJS(currentDoc!), null, 2),
    () => A.save(currentDoc!),
  );

  return currentDoc;
}

/**
 * Get the current document (throws if not initialized)
 */
export function getDoc(): FreedDoc {
  if (!currentDoc) {
    throw new Error("Document not initialized. Call initDoc() first.");
  }
  return currentDoc;
}

/**
 * Save the current document to IndexedDB
 */
async function saveDoc(): Promise<void> {
  if (!currentDoc) return;
  const binary = A.save(currentDoc);
  await storage.save(binary);
}

/**
 * Broadcast the current document to all connected PWA clients via Tauri relay
 */
async function broadcastToRelay(): Promise<void> {
  if (!currentDoc) return;
  try {
    const bytes = A.save(currentDoc);
    await invoke("broadcast_doc", { docBytes: Array.from(bytes) });
  } catch {
    // Relay may not be running yet or no clients connected — safe to ignore
  }
}

/**
 * Apply a change to the document and persist
 */
async function applyChange(
  changeFn: (doc: FreedDoc) => void,
  message?: string
): Promise<FreedDoc> {
  if (!currentDoc) {
    throw new Error("Document not initialized. Call initDoc() first.");
  }

  currentDoc = A.change(currentDoc, message || "update", changeFn);
  await saveDoc();
  addDebugEvent("change", message);
  snapshotDoc();

  // Notify subscribers
  for (const subscriber of subscribers) {
    subscriber(currentDoc);
  }

  // Push updated doc to connected PWA clients
  broadcastToRelay();

  return currentDoc;
}

/**
 * Subscribe to document changes
 */
export function subscribe(callback: Subscriber): () => void {
  subscribers.add(callback);
  return () => subscribers.delete(callback);
}

// =============================================================================
// Document Operations (wrapped for persistence)
// =============================================================================

export async function docAddFeedItem(item: FeedItem): Promise<FreedDoc> {
  // Guard: never overwrite an existing item — that would clobber the user's
  // read/saved/tags state. Consistent with the bulk docBatchRefreshFeeds path.
  return applyChange((doc) => {
    if (!doc.feedItems[item.globalId]) {
      addFeedItem(doc, item);
    }
  }, "Add feed item");
}

export async function docAddRssFeed(feed: RssFeed): Promise<FreedDoc> {
  return applyChange((doc) => addRssFeed(doc, feed), "Add RSS feed");
}

export async function docRemoveRssFeed(url: string): Promise<FreedDoc> {
  return applyChange((doc) => removeRssFeed(doc, url), "Remove RSS feed");
}

export async function docUpdateRssFeed(
  url: string,
  updates: Parameters<typeof updateRssFeed>[2]
): Promise<FreedDoc> {
  return applyChange((doc) => updateRssFeed(doc, url, updates), "Update RSS feed");
}

export async function docUpdateFeedItem(
  globalId: string,
  updates: Partial<FeedItem>
): Promise<FreedDoc> {
  return applyChange(
    (doc) => updateFeedItem(doc, globalId, updates),
    "Update feed item"
  );
}

export async function docRemoveFeedItem(globalId: string): Promise<FreedDoc> {
  return applyChange(
    (doc) => removeFeedItem(doc, globalId),
    "Remove feed item"
  );
}

export async function docMarkAsRead(globalId: string): Promise<FreedDoc> {
  return applyChange((doc) => markAsRead(doc, globalId), "Mark as read");
}

export async function docToggleSaved(globalId: string): Promise<FreedDoc> {
  return applyChange((doc) => toggleSaved(doc, globalId), "Toggle saved");
}

export async function docUpdatePreferences(
  updates: Partial<UserPreferences>
): Promise<FreedDoc> {
  return applyChange(
    (doc) => updatePreferences(doc, updates),
    "Update preferences"
  );
}

export async function docUpdateLastSync(): Promise<FreedDoc> {
  return applyChange((doc) => updateLastSync(doc), "Update last sync");
}

/**
 * Remove all feed subscriptions in a single CRDT change.
 * When includeItems is true, all articles are also deleted.
 * This change propagates to all synced devices.
 */
export async function docRemoveAllFeeds(includeItems: boolean): Promise<FreedDoc> {
  return applyChange(
    (doc) => removeAllFeeds(doc, includeItems),
    includeItems ? "Remove all feeds and articles" : "Remove all feeds",
  );
}

/**
 * Wipe the IndexedDB document store for this device.
 * Local-only — does NOT propagate to other devices.
 * After calling this, reload the page to start fresh.
 */
export async function clearLocalDoc(): Promise<void> {
  await storage.clear();
}

/**
 * Mark all unread items as read in a single Automerge change.
 * Optionally filter by platform.
 */
export async function docMarkAllAsRead(platform?: string): Promise<FreedDoc> {
  return applyChange((doc) => {
    const now = Date.now();
    for (const item of Object.values(doc.feedItems)) {
      if (item.userState.readAt) continue;
      if (item.userState.hidden || item.userState.archived) continue;
      if (platform && item.platform !== platform) continue;
      item.userState.readAt = now;
    }
  }, "Mark all as read");
}

/**
 * Bulk add feed items (more efficient for initial feed fetch)
 */
export async function docAddFeedItems(items: FeedItem[]): Promise<FreedDoc> {
  return applyChange((doc) => {
    for (const item of items) {
      // Only add if not already present
      if (!doc.feedItems[item.globalId]) {
        addFeedItem(doc, item);
      }
    }
  }, `Add ${items.length} feed items`);
}

/**
 * Batch refresh: update feed timestamps AND add new items in a single Automerge
 * change. This is critical for performance — replacing N per-feed writes with 1.
 *
 * Uses a dual-key dedup strategy: skip if globalId already exists OR if the
 * item's article link URL already exists in the store. The link-URL check
 * protects against key-scheme migrations creating phantom duplicates (e.g.
 * switching from link-first to guid-first globalId construction).
 */
export async function docBatchRefreshFeeds(
  feeds: RssFeed[],
  items: FeedItem[],
): Promise<FreedDoc> {
  return applyChange((doc) => {
    for (const feed of feeds) {
      const stored = doc.rssFeeds[feed.url];
      if (!stored) continue;

      if (feed.lastFetched !== undefined) {
        stored.lastFetched = feed.lastFetched;
      }

      // Heal sentinel titles — never clobbers user-set names.
      // "Untitled Feed" (OPML fallback) and the raw feed URL (addRssFeed fallback)
      // are treated as sentinels. The incoming title may be the real XML title or
      // a hostname-derived fallback from refreshAllFeeds; both are better than
      // leaving the sentinel in place.
      if (feed.title && feed.title !== "Untitled Feed" && feed.title !== feed.url) {
        if (stored.title === "Untitled Feed" || stored.title === stored.url) {
          console.log(`[Heal] CRDT write: "${stored.title}" → "${feed.title}" (${feed.url})`);
          stored.title = feed.title;
        }
      }

      // Backfill missing siteUrl from live feed data
      if (feed.siteUrl && !stored.siteUrl) {
        stored.siteUrl = feed.siteUrl;
      }
    }

    // Build secondary index: article link URL → exists, so we can skip items
    // whose article link is already stored under a different globalId.
    const existingLinkUrls = new Set<string>();
    for (const existing of Object.values(doc.feedItems)) {
      const url = existing.content.linkPreview?.url;
      if (url) existingLinkUrls.add(url);
    }

    for (const item of items) {
      if (doc.feedItems[item.globalId]) continue;
      const linkUrl = item.content.linkPreview?.url;
      if (linkUrl && existingLinkUrls.has(linkUrl)) continue;
      addFeedItem(doc, item);
      if (linkUrl) existingLinkUrls.add(linkUrl);
    }
  }, `Refresh ${feeds.length} feeds, ${items.length} items`);
}

/**
 * Startup migration: heal "Untitled Feed" and raw-URL-as-title sentinels using
 * the feed URL hostname as a fallback — zero network required.
 *
 * This runs synchronously during app initialization so the user never sees
 * "Untitled Feed" in the sidebar. The RSS poller's network-based heal can
 * later upgrade these hostname titles to the real XML <title> values.
 *
 * Safe to call on every startup — it is a no-op for feeds that already have
 * a proper title.
 */
export async function docHealUntitledFeedTitles(): Promise<FreedDoc> {
  return applyChange((doc) => {
    for (const feed of Object.values(doc.rssFeeds)) {
      const isUntitled = feed.title === "Untitled Feed" || feed.title === feed.url;
      if (!isUntitled) continue;

      let healed: string | undefined;
      try {
        healed = new URL(feed.url).hostname.replace(/^(?:www|feeds?)\./, "");
      } catch {
        // Malformed URL — leave as-is; network heal will try again later
      }

      if (healed) {
        feed.title = healed;
      }
    }
  }, "Heal untitled feed titles from URL hostname");
}

/**
 * One-time migration: deduplicate feed items that share the same article link
 * URL but have different globalIds (caused by key-scheme changes, e.g. guid →
 * link priority flip).
 *
 * Scoring keeps the copy with the most user engagement:
 *   saved (100) > tags (10/ea) > archived (5) > read (1)
 * Ties are broken by keeping the newer globalId (guid-based keys are more
 * stable long-term). The losers are deleted from the CRDT.
 *
 * Safe to call on every startup — it's a no-op when no duplicates exist.
 */
export async function docDeduplicateFeedItems(): Promise<FreedDoc> {
  return applyChange((doc) => {
    // Group globalIds by article link URL
    const linkToIds = new Map<string, string[]>();
    for (const [id, item] of Object.entries(doc.feedItems)) {
      const url = item.content.linkPreview?.url;
      if (!url) continue;
      const group = linkToIds.get(url);
      if (group) {
        group.push(id);
      } else {
        linkToIds.set(url, [id]);
      }
    }

    for (const ids of linkToIds.values()) {
      if (ids.length <= 1) continue;

      // Score each duplicate: higher = more user state worth preserving
      const scored = ids.map((id) => {
        const s = doc.feedItems[id].userState;
        const score =
          (s.saved ? 100 : 0) +
          ((s.tags?.length ?? 0) * 10) +
          (s.archived ? 5 : 0) +
          (s.readAt ? 1 : 0);
        return { id, score };
      });

      // Highest score wins; ties go to the last entry (guid-keyed items sort
      // lexicographically after link-keyed "rss:https://..." entries in practice)
      scored.sort((a, b) => b.score - a.score || b.id.localeCompare(a.id));

      for (let i = 1; i < scored.length; i++) {
        delete doc.feedItems[scored[i].id];
      }
    }
  }, "Deduplicate feed items by article link URL");
}

/**
 * Get binary representation for sync
 */
export function getDocBinary(): Uint8Array {
  if (!currentDoc) {
    throw new Error("Document not initialized");
  }
  return A.save(currentDoc);
}

/**
 * Merge with incoming sync data
 */
export async function mergeDoc(incoming: Uint8Array): Promise<FreedDoc> {
  if (!currentDoc) {
    throw new Error("Document not initialized");
  }

  try {
    const beforeCount = Object.keys(currentDoc.feedItems ?? {}).length;
    const incomingDoc = A.load<FreedDoc>(incoming);
    currentDoc = A.merge(currentDoc, incomingDoc);
    await saveDoc();

    const afterCount = Object.keys(currentDoc.feedItems ?? {}).length;
    const delta = afterCount - beforeCount;
    addDebugEvent("merge_ok", delta !== 0 ? `${delta > 0 ? "+" : ""}${delta} items` : "no new items", incoming.byteLength);
    snapshotDoc();
  } catch (err) {
    addDebugEvent("merge_err", err instanceof Error ? err.message : String(err));
    throw err;
  }

  // Notify subscribers
  for (const subscriber of subscribers) {
    subscriber(currentDoc);
  }

  return currentDoc;
}
