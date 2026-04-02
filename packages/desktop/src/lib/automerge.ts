/**
 * Automerge document client for Freed Desktop (main thread)
 *
 * Thin proxy around the Automerge Web Worker. All WASM operations
 * (A.change, A.save, A.load, A.merge, hydrateFromDoc) run in the worker,
 * keeping the main thread free to paint and respond to user input.
 *
 * Key desktop difference from the PWA proxy:
 *   - Handles BROADCAST_REQUEST responses from the worker by calling
 *     invoke("broadcast_doc") on the main thread (Tauri IPC is main-thread only).
 *     The Array.from(binary) conversion already happened in the worker.
 *   - Exports setRelayClientCount(n) so sync.ts can notify the worker.
 *
 * Public API is identical to the previous direct implementation so callers
 * (store.ts, sync.ts, rss-poller.ts) require no changes other than the
 * subscribe callback changing from (doc: FreedDoc) to (state: DocState).
 */

import { invoke } from "@tauri-apps/api/core";
import { addDebugEvent, setDocSnapshot, registerDocAccessors } from "@freed/ui/lib/debug-store";
import type { FeedItem, Friend, ReachOutLog, RssFeed, UserPreferences } from "@freed/shared";
import type { DocState, WorkerRequest, WorkerResponse } from "./automerge-types";
import { log } from "./logger.js";
export type { DocState } from "./automerge-types";

/** Maximum time to wait for any single worker op before treating it as hung. */
const WORKER_REQUEST_TIMEOUT_MS = 60_000;

// ---------------------------------------------------------------------------
// Worker lifecycle
// ---------------------------------------------------------------------------

const worker = new Worker(new URL("./automerge.worker.ts", import.meta.url), {
  type: "module",
});

const workerReady = new Promise<void>((resolve, reject) => {
  const timeout = setTimeout(() => {
    reject(new Error("Automerge worker failed to start within 15 seconds"));
  }, 15_000);

  const onReady = (event: MessageEvent<WorkerResponse>) => {
    if (event.data.type === "READY") {
      clearTimeout(timeout);
      worker.removeEventListener("message", onReady);
      resolve();
    }
  };
  worker.addEventListener("message", onReady);
});

// ---------------------------------------------------------------------------
// Request/response plumbing
// ---------------------------------------------------------------------------

let nextReqId = 1;
const pending = new Map<
  number,
  { resolve: () => void; reject: (err: Error) => void; timer: ReturnType<typeof setTimeout> }
>();

async function request(msg: WorkerRequest): Promise<void> {
  await workerReady;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      if (!pending.has(msg.reqId)) return;
      pending.delete(msg.reqId);
      const opType = (msg as { type: string }).type;
      const errMsg = `[automerge-worker] request TIMEOUT op=${opType} reqId=${msg.reqId}`;
      log.error(errMsg);
      addDebugEvent("error", errMsg);
      reject(new Error(errMsg));
    }, WORKER_REQUEST_TIMEOUT_MS);

    pending.set(msg.reqId, { resolve, reject, timer });
    worker.postMessage(msg);
  });
}

let lastBinary: Uint8Array | null = null;

// Latest hydrated state - updated on every STATE_UPDATE, exposed as getDocState()
let lastDocState: DocState | null = null;

// ---------------------------------------------------------------------------
// Subscriber model
// ---------------------------------------------------------------------------

type Subscriber = (state: DocState) => void;
const subscribers = new Set<Subscriber>();

export function subscribe(callback: Subscriber): () => void {
  subscribers.add(callback);
  return () => subscribers.delete(callback);
}

// ---------------------------------------------------------------------------
// Relay client count - forwarded to the worker for BROADCAST_REQUEST gating
// ---------------------------------------------------------------------------

export function setRelayClientCount(n: number): void {
  const reqId = nextReqId++;
  worker.postMessage({
    reqId,
    type: "UPDATE_RELAY_CLIENT_COUNT",
    count: n,
  } satisfies WorkerRequest);
}

// ---------------------------------------------------------------------------
// Inbound worker message handler
// ---------------------------------------------------------------------------

worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
  const msg = event.data;

  if (msg.type === "READY") return;

  if (msg.type === "STATE_UPDATE") {
    lastBinary = msg.binary;
    lastDocState = msg.state;
    for (const sub of subscribers) sub(msg.state);
    return;
  }

  if (msg.type === "BROADCAST_REQUEST") {
    // The worker already ran Array.from(binary). Just invoke on the main thread.
    void invoke("broadcast_doc", { docBytes: msg.data }).catch(() => {
      // Relay may not be running or no clients - safe to ignore
    });
    return;
  }

  if (msg.type === "IMPORT_PROGRESS") {
    // Optional: forward to callers that registered an onChunk via addImportProgressListener
    for (const listener of importProgressListeners) {
      listener(msg.chunkIndex, msg.totalChunks);
    }
    return;
  }

  if (msg.type === "DEBUG_EVENT") {
    addDebugEvent(msg.kind as Parameters<typeof addDebugEvent>[0], msg.detail, msg.bytes);
    return;
  }

  if (msg.type === "DEBUG_SNAPSHOT") {
    setDocSnapshot({
      deviceId: msg.deviceId,
      itemCount: msg.itemCount,
      feedCount: msg.feedCount,
      binarySize: msg.binarySize,
      savedAt: Date.now(),
    });
    return;
  }

  // ACK
  const p = pending.get(msg.reqId);
  if (!p) return;
  clearTimeout(p.timer);
  pending.delete(msg.reqId);
  if (msg.error) p.reject(new Error(msg.error));
  else p.resolve();
};

worker.onerror = (err) => {
  const msg = err instanceof Error ? err.message : String(err);
  log.error(`[automerge-worker] unhandled error: ${msg}`);
  addDebugEvent("error", `[AutomergeWorker] unhandled error: ${msg}`);
};

// ---------------------------------------------------------------------------
// Import progress listeners (for callers using onChunk callbacks)
// ---------------------------------------------------------------------------

type ImportProgressListener = (chunkIndex: number, totalChunks: number) => void;
const importProgressListeners = new Set<ImportProgressListener>();

function withImportProgress<T>(
  fn: () => Promise<T>,
  onChunk?: (chunkIndex: number, totalChunks: number) => void,
): Promise<T> {
  if (!onChunk) return fn();
  importProgressListeners.add(onChunk);
  return fn().finally(() => importProgressListeners.delete(onChunk!));
}

// ---------------------------------------------------------------------------
// Public API - initialization
// ---------------------------------------------------------------------------

function sendInit(): Promise<DocState> {
  return new Promise((resolve, reject) => {
    const reqId = nextReqId++;

    let initialState: DocState | null = null;
    let initAcked = false;

    function tryResolve() {
      if (initialState && initAcked) resolve(initialState);
    }

    const stateHandler = (event: MessageEvent<WorkerResponse>) => {
      const msg = event.data;
      if (msg.type === "STATE_UPDATE" && !initialState) {
        lastBinary = msg.binary;
        initialState = msg.state;
        tryResolve();
      } else if (msg.type === "ACK" && msg.reqId === reqId) {
        registerDocAccessors(
          () => null,
          () => "(doc lives in worker - not directly accessible)",
          () => lastBinary ?? new Uint8Array(0),
        );
        worker.removeEventListener("message", stateHandler);
        if (msg.error) {
          reject(new Error(msg.error));
        } else {
          initAcked = true;
          tryResolve();
        }
      }
    };

    worker.addEventListener("message", stateHandler);
    worker.postMessage({ reqId, type: "INIT" } satisfies WorkerRequest);
  });
}

export async function initDoc(): Promise<DocState> {
  await workerReady;
  try {
    return await sendInit();
  } catch {
    await clearLocalDoc();
    return sendInit();
  }
}

/** Latest hydrated state from the worker. Returns null before first INIT. */
export function getDocState(): DocState | null {
  return lastDocState;
}

export function getDocBinary(): Uint8Array {
  if (!lastBinary) throw new Error("Document not initialized");
  return lastBinary;
}

export async function mergeDoc(incoming: Uint8Array): Promise<void> {
  const reqId = nextReqId++;
  return request({ reqId, type: "MERGE_DOC", binary: incoming });
}

export async function clearLocalDoc(): Promise<void> {
  const reqId = nextReqId++;
  return request({ reqId, type: "CLEAR_LOCAL" });
}

// ---------------------------------------------------------------------------
// Document mutations
// ---------------------------------------------------------------------------

export async function docAddFeedItem(item: FeedItem): Promise<void> {
  const reqId = nextReqId++;
  return request({ reqId, type: "ADD_FEED_ITEM", item });
}

export async function docAddFeedItems(items: FeedItem[]): Promise<void> {
  const reqId = nextReqId++;
  return request({ reqId, type: "ADD_FEED_ITEMS", items });
}

export async function docRemoveFeedItem(globalId: string): Promise<void> {
  const reqId = nextReqId++;
  return request({ reqId, type: "REMOVE_FEED_ITEM", globalId });
}

export async function docUpdateFeedItem(
  globalId: string,
  updates: Partial<FeedItem>,
): Promise<void> {
  const reqId = nextReqId++;
  return request({ reqId, type: "UPDATE_FEED_ITEM", globalId, updates });
}

export async function docMarkAsRead(globalId: string): Promise<void> {
  const reqId = nextReqId++;
  return request({ reqId, type: "MARK_AS_READ", globalId });
}

export async function docMarkItemsAsRead(globalIds: string[]): Promise<void> {
  if (globalIds.length === 0) return;
  const reqId = nextReqId++;
  return request({ reqId, type: "MARK_ITEMS_AS_READ", globalIds });
}

export async function docMarkAllAsRead(platform?: string): Promise<void> {
  const reqId = nextReqId++;
  return request({ reqId, type: "MARK_ALL_AS_READ", platform });
}

export async function docToggleSaved(globalId: string): Promise<void> {
  const reqId = nextReqId++;
  return request({ reqId, type: "TOGGLE_SAVED", globalId });
}

export async function docToggleArchived(globalId: string): Promise<void> {
  const reqId = nextReqId++;
  return request({ reqId, type: "TOGGLE_ARCHIVED", globalId });
}

export async function docToggleLiked(globalId: string): Promise<void> {
  const reqId = nextReqId++;
  return request({ reqId, type: "TOGGLE_LIKED", globalId });
}

export async function docConfirmLikedSynced(globalId: string, syncedAt?: number): Promise<void> {
  const reqId = nextReqId++;
  return request({ reqId, type: "CONFIRM_LIKED_SYNCED", globalId, syncedAt });
}

export async function docConfirmSeenSynced(globalId: string, syncedAt?: number): Promise<void> {
  const reqId = nextReqId++;
  return request({ reqId, type: "CONFIRM_SEEN_SYNCED", globalId, syncedAt });
}

export async function docArchiveAllReadUnsaved(
  platform?: string,
  feedUrl?: string,
): Promise<void> {
  const reqId = nextReqId++;
  return request({ reqId, type: "ARCHIVE_ALL_READ_UNSAVED", platform, feedUrl });
}

export async function docPruneArchivedItems(maxAgeMs?: number): Promise<void> {
  const reqId = nextReqId++;
  return request({ reqId, type: "PRUNE_ARCHIVED_ITEMS", maxAgeMs });
}

export async function docDeleteAllArchived(): Promise<void> {
  const reqId = nextReqId++;
  return request({ reqId, type: "DELETE_ALL_ARCHIVED" });
}

export async function docAddRssFeed(feed: RssFeed): Promise<void> {
  const reqId = nextReqId++;
  return request({ reqId, type: "ADD_RSS_FEED", feed });
}

export async function docRemoveRssFeed(
  url: string,
  includeItems: boolean = false,
): Promise<void> {
  const reqId = nextReqId++;
  return request({ reqId, type: "REMOVE_RSS_FEED", url, includeItems });
}

export async function docUpdateRssFeed(
  url: string,
  updates: Partial<RssFeed>,
): Promise<void> {
  const reqId = nextReqId++;
  return request({ reqId, type: "UPDATE_RSS_FEED", url, updates });
}

export async function docRemoveAllFeeds(includeItems: boolean): Promise<void> {
  const reqId = nextReqId++;
  return request({ reqId, type: "REMOVE_ALL_FEEDS", includeItems });
}

export async function docUpdatePreferences(updates: Partial<UserPreferences>): Promise<void> {
  const reqId = nextReqId++;
  return request({ reqId, type: "UPDATE_PREFERENCES", updates });
}

export async function docUpdateLastSync(): Promise<void> {
  const reqId = nextReqId++;
  return request({ reqId, type: "UPDATE_LAST_SYNC" });
}

export async function docAddFriend(friend: Friend): Promise<void> {
  const reqId = nextReqId++;
  return request({ reqId, type: "ADD_FRIEND", friend });
}

export async function docAddFriends(friends: Friend[]): Promise<void> {
  const reqId = nextReqId++;
  return request({ reqId, type: "ADD_FRIENDS", friends });
}

export async function docUpdateFriend(
  friendId: string,
  updates: Partial<Friend>,
): Promise<void> {
  const reqId = nextReqId++;
  return request({ reqId, type: "UPDATE_FRIEND", friendId, updates });
}

export async function docRemoveFriend(friendId: string): Promise<void> {
  const reqId = nextReqId++;
  return request({ reqId, type: "REMOVE_FRIEND", friendId });
}

export async function docLogReachOut(friendId: string, entry: ReachOutLog): Promise<void> {
  const reqId = nextReqId++;
  return request({ reqId, type: "LOG_REACH_OUT", friendId, entry });
}

// ─── Desktop-specific mutations ─────────────────────────────────────────────

export async function docBatchRefreshFeeds(
  feeds: RssFeed[],
  items: FeedItem[],
): Promise<void> {
  const reqId = nextReqId++;
  return request({ reqId, type: "BATCH_REFRESH_FEEDS", feeds, items });
}

export async function docBatchImportItems(
  items: FeedItem[],
  onChunk?: (chunkIndex: number, totalChunks: number) => void,
): Promise<void> {
  const reqId = nextReqId++;
  return withImportProgress(
    () => request({ reqId, type: "BATCH_IMPORT_ITEMS", items }),
    onChunk,
  );
}

export async function docHealUntitledFeedTitles(): Promise<void> {
  const reqId = nextReqId++;
  return request({ reqId, type: "HEAL_UNTITLED_FEEDS" });
}

export async function docDeduplicateFeedItems(): Promise<void> {
  const reqId = nextReqId++;
  return request({ reqId, type: "DEDUPLICATE_ITEMS" });
}

/**
 * Add a minimal stub FeedItem for a URL. The stub is constructed on the main
 * thread (pure JS - no WASM), then posted to the worker via ADD_FEED_ITEM.
 * Returns the stub so callers that use the FeedItem directly are unchanged.
 */
export async function docAddStubItem(url: string, tags: string[] = []): Promise<FeedItem> {
  let hash = 0;
  for (let i = 0; i < url.length; i++) {
    const ch = url.charCodeAt(i);
    hash = (hash << 5) - hash + ch;
    hash = hash & hash;
  }
  const globalId = `saved:${Math.abs(hash).toString(36)}`;
  const now = Date.now();
  let hostname = url;
  try { hostname = new URL(url).hostname; } catch { /* malformed */ }

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

  await docAddFeedItem(stub);
  return stub;
}
