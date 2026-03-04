/**
 * Automerge document management for Freed PWA
 *
 * Handles loading, saving, and syncing the Automerge CRDT document.
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
  toggleSaved,
  toggleArchived,
  archiveAllReadUnsaved,
  pruneArchivedItems,
  updatePreferences,
  updateLastSync,
  addFriend,
  updateFriend,
  removeFriend,
  logReachOut,
} from "@freed/shared/schema";
import type { FeedItem, Friend, ReachOutLog, RssFeed, UserPreferences } from "@freed/shared";
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

  // Register window escape hatch so the console can inspect the live doc.
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
  // read/saved/tags state. Consistent with the bulk docAddFeedItems path.
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

export async function docToggleArchived(globalId: string): Promise<FreedDoc> {
  return applyChange((doc) => toggleArchived(doc, globalId), "Toggle archived");
}

export async function docArchiveAllReadUnsaved(
  platform?: string,
  feedUrl?: string,
): Promise<FreedDoc> {
  return applyChange(
    (doc) => archiveAllReadUnsaved(doc, platform, feedUrl),
    "Archive all read",
  );
}

export async function docPruneArchivedItems(maxAgeMs?: number): Promise<FreedDoc> {
  return applyChange(
    (doc) => pruneArchivedItems(doc, maxAgeMs),
    "Prune archived items",
  );
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

// =============================================================================
// Friend Operations
// =============================================================================

export async function docAddFriend(friend: Friend): Promise<FreedDoc> {
  return applyChange((doc) => addFriend(doc, friend), "Add friend");
}

export async function docUpdateFriend(
  id: string,
  updates: Partial<Friend>
): Promise<FreedDoc> {
  return applyChange((doc) => updateFriend(doc, id, updates), "Update friend");
}

export async function docRemoveFriend(id: string): Promise<FreedDoc> {
  return applyChange((doc) => removeFriend(doc, id), "Remove friend");
}

export async function docLogReachOut(
  id: string,
  entry: ReachOutLog
): Promise<FreedDoc> {
  return applyChange((doc) => logReachOut(doc, id, entry), "Log reach-out");
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
 * Add a minimal stub FeedItem for a URL that has not yet been fetched.
 *
 * Used by the PWA Save URL flow. The stub syncs to the desktop via relay,
 * where the content fetcher picks it up, fetches the HTML (bypassing CORS),
 * extracts the content, and syncs the result back to all devices.
 *
 * The stub has no preservedContent -- the desktop fills that in after fetch.
 */
export async function docAddStubItem(
  url: string,
  tags: string[] = [],
): Promise<FeedItem> {
  let hash = 0;
  for (let i = 0; i < url.length; i++) {
    const ch = url.charCodeAt(i);
    hash = (hash << 5) - hash + ch;
    hash = hash & hash;
  }
  const globalId = `saved:${Math.abs(hash).toString(36)}`;
  const now = Date.now();

  let hostname = url;
  try {
    hostname = new URL(url).hostname;
  } catch {
    // malformed URL
  }

  const stub: FeedItem = {
    globalId,
    platform: "saved",
    contentType: "article",
    capturedAt: now,
    publishedAt: now,
    author: { id: hostname, handle: hostname, displayName: hostname },
    content: {
      text: url,
      mediaUrls: [],
      mediaTypes: [],
      linkPreview: { url, title: url },
    },
    userState: { hidden: false, saved: true, savedAt: now, archived: false, tags },
    topics: [],
  };

  await applyChange((doc) => {
    if (!doc.feedItems[stub.globalId]) {
      addFeedItem(doc, stub);
    }
  }, `Add stub item for ${url}`);

  return stub;
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
