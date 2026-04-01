/**
 * Message types for the desktop Automerge Web Worker boundary.
 *
 * Desktop-specific additions over the PWA types:
 *   WorkerRequest  - adds BATCH_REFRESH_FEEDS, BATCH_IMPORT_ITEMS,
 *                    HEAL_UNTITLED_FEEDS, DEDUPLICATE_ITEMS,
 *                    UPDATE_RELAY_CLIENT_COUNT
 *   WorkerResponse - adds BROADCAST_REQUEST (main thread calls Tauri invoke),
 *                    IMPORT_PROGRESS (chunk progress for large imports)
 */

import type { FeedItem, Friend, ReachOutLog, RssFeed, UserPreferences } from "@freed/shared";

// ---------------------------------------------------------------------------
// Hydrated state - identical to PWA's DocState (imported for type safety)
// ---------------------------------------------------------------------------

export interface DocState {
  items: FeedItem[];
  feeds: Record<string, RssFeed>;
  friends: Record<string, Friend>;
  preferences: UserPreferences;
  feedUnreadCounts: Record<string, number>;
  feedTotalCounts: Record<string, number>;
  totalUnreadCount: number;
  unreadCountByPlatform: Record<string, number>;
  totalItemCount: number;
  itemCountByPlatform: Record<string, number>;
  totalArchivableCount: number;
  archivableCountByPlatform: Record<string, number>;
  archivableFeedCounts: Record<string, number>;
  /**
   * ALL globalIds in the CRDT, including hidden and archived items.
   * Used by import-export.ts for deduplication pre-scan without needing getDoc().
   */
  allItemIds: string[];
}

// ---------------------------------------------------------------------------
// Main thread → worker
// ---------------------------------------------------------------------------

export type WorkerRequest =
  // Lifecycle
  | { reqId: number; type: "INIT" }
  | { reqId: number; type: "CLEAR_LOCAL" }
  // Mutations shared with PWA
  | { reqId: number; type: "MARK_AS_READ"; globalId: string }
  | { reqId: number; type: "MARK_ALL_AS_READ"; platform?: string }
  | { reqId: number; type: "TOGGLE_SAVED"; globalId: string }
  | { reqId: number; type: "TOGGLE_ARCHIVED"; globalId: string }
  | { reqId: number; type: "TOGGLE_LIKED"; globalId: string }
  | { reqId: number; type: "CONFIRM_LIKED_SYNCED"; globalId: string; syncedAt?: number }
  | { reqId: number; type: "CONFIRM_SEEN_SYNCED"; globalId: string; syncedAt?: number }
  | { reqId: number; type: "ADD_FEED_ITEM"; item: FeedItem }
  | { reqId: number; type: "ADD_FEED_ITEMS"; items: FeedItem[] }
  | { reqId: number; type: "REMOVE_FEED_ITEM"; globalId: string }
  | { reqId: number; type: "UPDATE_FEED_ITEM"; globalId: string; updates: Partial<FeedItem> }
  | { reqId: number; type: "ARCHIVE_ALL_READ_UNSAVED"; platform?: string; feedUrl?: string }
  | { reqId: number; type: "PRUNE_ARCHIVED_ITEMS"; maxAgeMs?: number }
  | { reqId: number; type: "DELETE_ALL_ARCHIVED" }
  | { reqId: number; type: "ADD_RSS_FEED"; feed: RssFeed }
  | { reqId: number; type: "REMOVE_RSS_FEED"; url: string }
  | { reqId: number; type: "UPDATE_RSS_FEED"; url: string; updates: Partial<RssFeed> }
  | { reqId: number; type: "REMOVE_ALL_FEEDS"; includeItems: boolean }
  | { reqId: number; type: "UPDATE_PREFERENCES"; updates: Partial<UserPreferences> }
  | { reqId: number; type: "UPDATE_LAST_SYNC" }
  | { reqId: number; type: "ADD_FRIEND"; friend: Friend }
  | { reqId: number; type: "ADD_FRIENDS"; friends: Friend[] }
  | { reqId: number; type: "UPDATE_FRIEND"; friendId: string; updates: Partial<Friend> }
  | { reqId: number; type: "REMOVE_FRIEND"; friendId: string }
  | { reqId: number; type: "LOG_REACH_OUT"; friendId: string; entry: ReachOutLog }
  | { reqId: number; type: "MERGE_DOC"; binary: Uint8Array }
  // Desktop-specific mutations
  | { reqId: number; type: "BATCH_REFRESH_FEEDS"; feeds: RssFeed[]; items: FeedItem[] }
  | { reqId: number; type: "BATCH_IMPORT_ITEMS"; items: FeedItem[] }
  | { reqId: number; type: "HEAL_UNTITLED_FEEDS" }
  | { reqId: number; type: "DEDUPLICATE_ITEMS" }
  // Relay management (fire-and-forget, reqId ignored)
  | { reqId: number; type: "UPDATE_RELAY_CLIENT_COUNT"; count: number };

// ---------------------------------------------------------------------------
// Worker → main thread
// ---------------------------------------------------------------------------

export type WorkerResponse =
  /** Simple acknowledgement for mutations that return void */
  | { reqId: number; type: "ACK"; error?: string }
  /** Broadcast on every doc mutation - main thread uses this to update UI */
  | { type: "STATE_UPDATE"; state: DocState; binary: Uint8Array }
  /** Debug panel event forwarding */
  | { type: "DEBUG_EVENT"; kind: string; detail?: string; bytes?: number }
  /** Doc size snapshot for the debug panel */
  | { type: "DEBUG_SNAPSHOT"; deviceId: string; itemCount: number; feedCount: number; binarySize: number }
  /** Sent once when the worker module finishes loading */
  | { type: "READY" }
  /**
   * Desktop-only: the worker has run A.save() + Array.from(binary) and
   * asks the main thread to call invoke("broadcast_doc", { docBytes }).
   * Array.from() is O(binary size) - doing it in the worker avoids blocking
   * the main thread for 10–100ms on large documents.
   */
  | { type: "BROADCAST_REQUEST"; data: number[] }
  /** Progress reporting for BATCH_IMPORT_ITEMS. */
  | { type: "IMPORT_PROGRESS"; chunkIndex: number; totalChunks: number };
