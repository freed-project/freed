/**
 * Automerge document client for Freed PWA (main thread)
 *
 * This module is a thin wrapper around the Automerge Web Worker. All WASM
 * operations (A.change, A.save, A.load, A.merge) run in the worker thread,
 * keeping the main thread free to paint and respond to user input.
 *
 * Public API is identical to the previous direct implementation so callers
 * (store.ts, sync.ts, App.tsx) require no changes other than the subscriber
 * type changing from (doc: FreedDoc) to (state: DocState).
 */

import { addDebugEvent, setDocSnapshot, registerDocAccessors } from "@freed/ui/lib/debug-store";
import type { Account, FeedItem, Person, ReachOutLog, RssFeed, UserPreferences } from "@freed/shared";
import type { DocState, WorkerRequest, WorkerResponse } from "./automerge-types";
export type { DocState } from "./automerge-types";

// ---------------------------------------------------------------------------
// Worker lifecycle
// ---------------------------------------------------------------------------

const worker = new Worker(new URL("./automerge.worker.ts", import.meta.url), {
  type: "module",
});

// In Vite dev mode, module workers drop messages sent before module evaluation
// completes. The worker posts a READY message once its onmessage handler is
// installed. We gate all outbound postMessage calls behind this promise.
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
const pending = new Map<number, { resolve: () => void; reject: (err: Error) => void }>();

async function request(msg: WorkerRequest): Promise<void> {
  await workerReady;
  return new Promise((resolve, reject) => {
    pending.set(msg.reqId, { resolve, reject });
    worker.postMessage(msg);
  });
}

// Latest binary from the worker — updated on every STATE_UPDATE.
// Returned synchronously by getDocBinary() so sync.ts callers are unchanged.
let lastBinary: Uint8Array | null = null;

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
// Inbound worker message handler
// ---------------------------------------------------------------------------

worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
  const msg = event.data;

  if (msg.type === "READY") return;

  if (msg.type === "STATE_UPDATE") {
    lastBinary = msg.binary;
    for (const sub of subscribers) sub(msg.state);
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

  // ACK — resolve or reject the pending promise
  const p = pending.get(msg.reqId);
  if (!p) return;
  pending.delete(msg.reqId);
  if (msg.error) {
    p.reject(new Error(msg.error));
  } else {
    p.resolve();
  }
};

worker.onerror = (err) => {
  console.error("[AutomergeWorker] Unhandled error:", err);
};

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Initialize the Automerge document. Must be called once before any mutations.
 * Returns the initial hydrated state (equivalent to the old FreedDoc return,
 * but already processed into plain JS — no WASM on the main thread).
 */
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
          () => "(doc lives in worker — not directly accessible)",
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

/** Binary snapshot of the current doc — used by sync.ts for relay/cloud upload. */
export function getDocBinary(): Uint8Array {
  if (!lastBinary) throw new Error("Document not initialized");
  return lastBinary;
}

/** Merge incoming sync binary into the doc (relay / cloud download). */
export async function mergeDoc(incoming: Uint8Array): Promise<void> {
  const reqId = nextReqId++;
  return request({ reqId, type: "MERGE_DOC", binary: incoming });
}

/** Permanently wipe the local IndexedDB store. Reload the page afterwards. */
export async function clearLocalDoc(): Promise<void> {
  const reqId = nextReqId++;
  return request({ reqId, type: "CLEAR_LOCAL" });
}

// ---------------------------------------------------------------------------
// Document mutations — one function per schema operation
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

export async function docUpdateFeedItem(globalId: string, updates: Partial<FeedItem>): Promise<void> {
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

export async function docArchiveAllReadUnsaved(platform?: string, feedUrl?: string): Promise<void> {
  const reqId = nextReqId++;
  return request({ reqId, type: "ARCHIVE_ALL_READ_UNSAVED", platform, feedUrl });
}

export async function docUnarchiveSavedItems(): Promise<void> {
  const reqId = nextReqId++;
  return request({ reqId, type: "UNARCHIVE_SAVED_ITEMS" });
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

export async function docUpdateRssFeed(url: string, updates: Partial<RssFeed>): Promise<void> {
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

export async function docAddPerson(person: Person): Promise<void> {
  const reqId = nextReqId++;
  return request({ reqId, type: "ADD_PERSON", person });
}

export async function docAddPersons(persons: Person[]): Promise<void> {
  const reqId = nextReqId++;
  return request({ reqId, type: "ADD_PERSONS", persons });
}

export async function docUpdatePerson(personId: string, updates: Partial<Person>): Promise<void> {
  const reqId = nextReqId++;
  return request({ reqId, type: "UPDATE_PERSON", personId, updates });
}

export async function docUpsertConnectionPersons(
  candidates: Array<{ person: Person; accountIds: string[] }>,
): Promise<void> {
  if (candidates.length === 0) return;
  const reqId = nextReqId++;
  return request({ reqId, type: "UPSERT_CONNECTION_PERSONS", candidates });
}

export async function docRemovePerson(personId: string): Promise<void> {
  const reqId = nextReqId++;
  return request({ reqId, type: "REMOVE_PERSON", personId });
}

export async function docLogReachOut(personId: string, entry: ReachOutLog): Promise<void> {
  const reqId = nextReqId++;
  return request({ reqId, type: "LOG_REACH_OUT", personId, entry });
}

export async function docAddAccount(account: Account): Promise<void> {
  const reqId = nextReqId++;
  return request({ reqId, type: "ADD_ACCOUNT", account });
}

export async function docAddAccounts(accounts: Account[]): Promise<void> {
  const reqId = nextReqId++;
  return request({ reqId, type: "ADD_ACCOUNTS", accounts });
}

export async function docUpdateAccount(accountId: string, updates: Partial<Account>): Promise<void> {
  const reqId = nextReqId++;
  return request({ reqId, type: "UPDATE_ACCOUNT", accountId, updates });
}

export async function docRemoveAccount(accountId: string): Promise<void> {
  const reqId = nextReqId++;
  return request({ reqId, type: "REMOVE_ACCOUNT", accountId });
}

/** @deprecated Use docAddPerson. */
export const docAddFriend = docAddPerson;
/** @deprecated Use docAddPersons. */
export const docAddFriends = docAddPersons;
/** @deprecated Use docUpdatePerson. */
export const docUpdateFriend = docUpdatePerson;
/** @deprecated Use docRemovePerson. */
export const docRemoveFriend = docRemovePerson;

/**
 * Add a minimal stub FeedItem for a URL that has not yet been fetched.
 * The stub is created inside the worker; the return value is void because
 * the PWA caller (App.tsx) does not use the returned stub object.
 */
export async function docAddStubItem(url: string, tags: string[] = []): Promise<void> {
  const reqId = nextReqId++;
  return request({ reqId, type: "ADD_STUB_ITEM", url, tags });
}
