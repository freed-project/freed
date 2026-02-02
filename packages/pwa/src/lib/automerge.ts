/**
 * Automerge document management for FREED PWA
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
  updateFeedItem,
  removeFeedItem,
  markAsRead,
  toggleSaved,
  updatePreferences,
  updateLastSync,
} from "@freed/shared/schema";
import type { FeedItem, RssFeed, UserPreferences } from "@freed/shared";

// Singleton storage instance
const storage = new IndexedDBStorage();

// Current document state
let currentDoc: FreedDoc | null = null;

// Subscribers for document changes
type Subscriber = (doc: FreedDoc) => void;
const subscribers = new Set<Subscriber>();

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
  return applyChange((doc) => addFeedItem(doc, item), "Add feed item");
}

export async function docAddRssFeed(feed: RssFeed): Promise<FreedDoc> {
  return applyChange((doc) => addRssFeed(doc, feed), "Add RSS feed");
}

export async function docRemoveRssFeed(url: string): Promise<FreedDoc> {
  return applyChange((doc) => removeRssFeed(doc, url), "Remove RSS feed");
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
  return applyChange((doc) => removeFeedItem(doc, globalId), "Remove feed item");
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

  const incomingDoc = A.load<FreedDoc>(incoming);
  currentDoc = A.merge(currentDoc, incomingDoc);
  await saveDoc();

  // Notify subscribers
  for (const subscriber of subscribers) {
    subscriber(currentDoc);
  }

  return currentDoc;
}
