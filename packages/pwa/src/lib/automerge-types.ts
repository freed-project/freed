/**
 * Shared message types for the Automerge Web Worker boundary.
 *
 * Main thread → worker: WorkerRequest (typed action objects)
 * Worker → main thread: WorkerResponse (state updates, acks, debug events)
 *
 * Using typed action objects instead of function closures lets us cross the
 * postMessage boundary without serialization loss.
 */

import type { FeedItem, Friend, ReachOutLog, RssFeed, UserPreferences } from "@freed/shared";

// ---------------------------------------------------------------------------
// Hydrated state posted to the main thread after every doc mutation.
// Plain JS — safe for structured-clone transfer.
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
}

// ---------------------------------------------------------------------------
// Main thread → worker
// ---------------------------------------------------------------------------

export type WorkerRequest =
  | { reqId: number; type: "INIT" }
  | { reqId: number; type: "MARK_AS_READ"; globalId: string }
  | { reqId: number; type: "MARK_ALL_AS_READ"; platform?: string }
  | { reqId: number; type: "TOGGLE_SAVED"; globalId: string }
  | { reqId: number; type: "TOGGLE_ARCHIVED"; globalId: string }
  | { reqId: number; type: "ADD_FEED_ITEM"; item: FeedItem }
  | { reqId: number; type: "ADD_FEED_ITEMS"; items: FeedItem[] }
  | { reqId: number; type: "REMOVE_FEED_ITEM"; globalId: string }
  | { reqId: number; type: "UPDATE_FEED_ITEM"; globalId: string; updates: Partial<FeedItem> }
  | { reqId: number; type: "ARCHIVE_ALL_READ_UNSAVED"; platform?: string; feedUrl?: string }
  | { reqId: number; type: "PRUNE_ARCHIVED_ITEMS"; maxAgeMs?: number }
  | { reqId: number; type: "ADD_RSS_FEED"; feed: RssFeed }
  | { reqId: number; type: "REMOVE_RSS_FEED"; url: string }
  | { reqId: number; type: "UPDATE_RSS_FEED"; url: string; updates: Partial<RssFeed> }
  | { reqId: number; type: "REMOVE_ALL_FEEDS"; includeItems: boolean }
  | { reqId: number; type: "UPDATE_PREFERENCES"; updates: Partial<UserPreferences> }
  | { reqId: number; type: "UPDATE_LAST_SYNC" }
  | { reqId: number; type: "ADD_FRIEND"; friend: Friend }
  | { reqId: number; type: "UPDATE_FRIEND"; friendId: string; updates: Partial<Friend> }
  | { reqId: number; type: "REMOVE_FRIEND"; friendId: string }
  | { reqId: number; type: "LOG_REACH_OUT"; friendId: string; entry: ReachOutLog }
  | { reqId: number; type: "ADD_STUB_ITEM"; url: string; tags: string[] }
  | { reqId: number; type: "MERGE_DOC"; binary: Uint8Array }
  | { reqId: number; type: "CLEAR_LOCAL" };

// ---------------------------------------------------------------------------
// Worker → main thread
// ---------------------------------------------------------------------------

export type WorkerResponse =
  /** Simple acknowledgement for mutations that return void */
  | { reqId: number; type: "ACK"; error?: string }
  /** Broadcast on every doc mutation — main thread uses this to update UI */
  | { type: "STATE_UPDATE"; state: DocState; binary: Uint8Array }
  /** Debug panel event forwarding */
  | { type: "DEBUG_EVENT"; kind: string; detail?: string; bytes?: number }
  /** Doc size snapshot for the debug panel */
  | { type: "DEBUG_SNAPSHOT"; deviceId: string; itemCount: number; feedCount: number; binarySize: number }
  /** Sent once when the worker module finishes loading and is ready for messages */
  | { type: "READY" };
