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
 *   - Fetches the full Automerge binary on demand for relay, snapshots, and
 *     cloud backup instead of receiving a fresh clone on every state update.
 *   - Exports setRelayClientCount(n) so sync.ts can notify the worker.
 *
 * Public API is identical to the previous direct implementation so callers
 * (store.ts, sync.ts, rss-poller.ts) require no changes other than the
 * subscribe callback changing from (doc: FreedDoc) to (state: DocState).
 */

import { invoke } from "@tauri-apps/api/core";
import { hashSavedUrl } from "@freed/capture-save/normalize";
import { addDebugEvent, setDocSnapshot, registerDocAccessors } from "@freed/ui/lib/debug-store";
import type {
  Account,
  ContentSignalBackfillSummary,
  FeedItem,
  Person,
  ReachOutLog,
  RssFeed,
  SampleDataClearSummary,
  UserPreferences,
} from "@freed/shared";
import type { DocChangeEvent, DocState, DocStats, WorkerRequest, WorkerResponse } from "./automerge-types";
import { applyItemPatchesToState, createItemIndex, type ItemIndex } from "./automerge-state-patches";
import { log } from "./logger.js";
import { recordRuntimeHealthEvent, recordWorkerInit } from "./runtime-health-events";
export type { DocChangeEvent, DocState } from "./automerge-types";

/**
 * Whole-document save, hydrate, and broadcast work can take well over a
 * minute on large libraries, especially when background sync is active.
 * Keep the timeout high enough to catch true hangs without tripping on queue
 * backpressure during normal operation.
 */
const WORKER_REQUEST_TIMEOUT_MS = 180_000;
const WORKER_START_TIMEOUT_MS = 15_000;
const IDLE_WORKER_STOP_RETRY_MS = 1_000;

class WorkerInitFailureError extends Error {}
class WorkerInitTimeoutError extends WorkerInitFailureError {}

// ---------------------------------------------------------------------------
// Worker lifecycle
// ---------------------------------------------------------------------------

let worker: Worker | null = null;
let workerReady: Promise<void> | null = null;
let appDocumentInitialized = false;
let workerDocumentInitialized = false;
let latestRelayClientCount = 0;
let idleWorkerStopTimer: ReturnType<typeof setTimeout> | null = null;

type PendingRequestFailureHandler = {
  reject: (err: Error) => void;
  timer: ReturnType<typeof setTimeout>;
};

function getWorker(): Worker {
  if (!worker) startWorker();
  if (!worker) throw new Error("Automerge worker failed to start");
  return worker;
}

function workerErrorMessage(err: ErrorEvent | MessageEvent): string {
  if ("message" in err && typeof err.message === "string" && err.message.length > 0) {
    return err.message;
  }
  return String(err);
}

function rejectPendingMap<T extends PendingRequestFailureHandler>(pendingMap: Map<number, T>, error: Error): void {
  for (const pendingRequest of pendingMap.values()) {
    clearTimeout(pendingRequest.timer);
    pendingRequest.reject(error);
  }
  pendingMap.clear();
}

function rejectPendingWorkerRequests(error: Error): void {
  rejectPendingMap(pending, error);
  rejectPendingMap(pendingAllItemIds, error);
  rejectPendingMap(pendingDocBinary, error);
  rejectPendingMap(pendingDocHeads, error);
  rejectPendingMap(pendingSavedYouTubeUrls, error);
  rejectPendingMap(pendingPreservedText, error);
  rejectPendingMap(pendingContentSignalBackfill, error);
  rejectPendingMap(pendingSampleDataClear, error);
  rejectPendingMap(pendingInit, error);
}

function resetFailedWorker(failedWorker: Worker, error: Error, phase: string): void {
  if (worker !== failedWorker) return;

  failedWorker.terminate();
  worker = null;
  workerReady = null;
  workerDocumentInitialized = false;
  if (idleWorkerStopTimer) {
    clearTimeout(idleWorkerStopTimer);
    idleWorkerStopTimer = null;
  }
  rejectPendingWorkerRequests(error);
  log.error(`[automerge-worker] reset failed worker phase=${phase}: ${error.message}`);
  addDebugEvent("error", `[automerge-worker] reset failed worker phase=${phase}: ${error.message}`);
  recordRuntimeHealthEvent({
    event: phase.startsWith("startup") ? "worker_start_failed" : "worker_runtime_failed",
    phase,
    message: error.message,
  });
}

function startWorker(): void {
  if (worker) return;

  const nextWorker = new Worker(new URL("./automerge.worker.ts", import.meta.url), {
    type: "module",
  });
  worker = nextWorker;
  workerDocumentInitialized = false;
  log.info("[automerge-worker] started worker");
  recordRuntimeHealthEvent({ event: "worker_spawn" });
  workerReady = new Promise<void>((resolve, reject) => {
    let settled = false;
    const failStartup = (error: Error, phase: string) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      nextWorker.removeEventListener("message", onReady);
      nextWorker.removeEventListener("error", onStartupError);
      nextWorker.removeEventListener("messageerror", onStartupMessageError);
      resetFailedWorker(nextWorker, error, phase);
      reject(error);
    };
    const timeout = setTimeout(() => {
      failStartup(new Error("Automerge worker failed to start within 15 seconds"), "startup_timeout");
    }, WORKER_START_TIMEOUT_MS);

    const onReady = (event: MessageEvent<WorkerResponse>) => {
      if (event.data.type === "READY") {
        settled = true;
        clearTimeout(timeout);
        nextWorker.removeEventListener("message", onReady);
        nextWorker.removeEventListener("error", onStartupError);
        nextWorker.removeEventListener("messageerror", onStartupMessageError);
        resolve();
      }
    };
    const onStartupError = (event: ErrorEvent) => {
      failStartup(new Error(workerErrorMessage(event)), "startup_error");
    };
    const onStartupMessageError = (event: MessageEvent) => {
      failStartup(new Error(workerErrorMessage(event)), "startup_message_error");
    };
    nextWorker.addEventListener("message", onReady);
    nextWorker.addEventListener("error", onStartupError);
    nextWorker.addEventListener("messageerror", onStartupMessageError);
  });
  void workerReady.catch(() => {});
  nextWorker.onmessage = handleWorkerMessage;
  nextWorker.onerror = handleWorkerError;
  nextWorker.onmessageerror = handleWorkerMessageError;
  if (latestRelayClientCount > 0) {
    void workerReady.then(() => {
      if (worker !== nextWorker) return;
      nextWorker.postMessage({
        reqId: nextReqId++,
        type: "UPDATE_RELAY_CLIENT_COUNT",
        count: latestRelayClientCount,
      } satisfies WorkerRequest);
    }).catch(() => {});
  }
}

async function ensureWorkerReady(): Promise<void> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    startWorker();
    const ready = workerReady;
    if (!ready) {
      lastError = new Error("Automerge worker failed to start");
      continue;
    }
    try {
      await ready;
      return;
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

function hasPendingWorkerRequests(): boolean {
  return (
    pending.size > 0 ||
    pendingAllItemIds.size > 0 ||
    pendingDocBinary.size > 0 ||
    pendingDocHeads.size > 0 ||
    pendingSavedYouTubeUrls.size > 0 ||
    pendingPreservedText.size > 0 ||
    pendingContentSignalBackfill.size > 0 ||
    pendingSampleDataClear.size > 0 ||
    pendingInit.size > 0
  );
}

function stopIdleWorker(): boolean {
  if (!worker) return true;
  if (hasPendingWorkerRequests()) {
    return false;
  }
  worker.terminate();
  worker = null;
  workerReady = null;
  workerDocumentInitialized = false;
  log.info("[automerge-worker] terminated idle worker");
  addDebugEvent("change", "[automerge-worker] terminated idle worker");
  return true;
}

function scheduleIdleWorkerStop(): void {
  if (idleWorkerStopTimer || !worker) return;
  idleWorkerStopTimer = setTimeout(() => {
    idleWorkerStopTimer = null;
    if (!stopIdleWorker() && worker) {
      scheduleIdleWorkerStop();
    }
  }, IDLE_WORKER_STOP_RETRY_MS);
}

async function ensureWorkerDocumentReadyFor(type: WorkerRequest["type"]): Promise<void> {
  await ensureWorkerReady();
  if (
    !appDocumentInitialized ||
    workerDocumentInitialized ||
    type === "INIT" ||
    type === "CLEAR_LOCAL" ||
    type === "REPLACE_DOC"
  ) {
    return;
  }
  log.info(`[automerge-worker] reinitializing idle worker op=${type}`);
  await sendInit();
}

startWorker();

// ---------------------------------------------------------------------------
// Request/response plumbing
// ---------------------------------------------------------------------------

let nextReqId = 1;
const pending = new Map<
  number,
  { resolve: () => void; reject: (err: Error) => void; timer: ReturnType<typeof setTimeout> }
>();
const pendingAllItemIds = new Map<
  number,
  { resolve: (ids: string[]) => void; reject: (err: Error) => void; timer: ReturnType<typeof setTimeout> }
>();
const pendingDocBinary = new Map<
  number,
  {
    resolve: (binary: Uint8Array) => void;
    reject: (err: Error) => void;
    timer: ReturnType<typeof setTimeout>;
  }
>();
const pendingDocHeads = new Map<
  number,
  {
    resolve: (heads: string[] | null) => void;
    reject: (err: Error) => void;
    timer: ReturnType<typeof setTimeout>;
  }
>();
const pendingSavedYouTubeUrls = new Map<
  number,
  {
    resolve: (urls: string[]) => void;
    reject: (err: Error) => void;
    timer: ReturnType<typeof setTimeout>;
  }
>();
const pendingPreservedText = new Map<
  number,
  {
    resolve: (text: string | null) => void;
    reject: (err: Error) => void;
    timer: ReturnType<typeof setTimeout>;
  }
>();
const pendingContentSignalBackfill = new Map<
  number,
  {
    resolve: (summary: ContentSignalBackfillSummary) => void;
    reject: (err: Error) => void;
    timer: ReturnType<typeof setTimeout>;
  }
>();
const pendingSampleDataClear = new Map<
  number,
  {
    resolve: (summary: SampleDataClearSummary) => void;
    reject: (err: Error) => void;
    timer: ReturnType<typeof setTimeout>;
  }
>();
const pendingInit = new Map<number, PendingRequestFailureHandler>();
async function request(msg: WorkerRequest): Promise<void> {
  await ensureWorkerDocumentReadyFor(msg.type);
  const activeWorker = getWorker();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      if (!pending.has(msg.reqId)) return;
      const pendingCount = pending.size;
      pending.delete(msg.reqId);
      const opType = (msg as { type: string }).type;
      const errMsg =
        `[automerge-worker] request TIMEOUT op=${opType} reqId=${msg.reqId} ` +
        `timeout_ms=${WORKER_REQUEST_TIMEOUT_MS.toLocaleString()} pending=${pendingCount.toLocaleString()}`;
      log.error(errMsg);
      addDebugEvent("error", errMsg);
      reject(new Error(errMsg));
    }, WORKER_REQUEST_TIMEOUT_MS);

    pending.set(msg.reqId, { resolve, reject, timer });
    activeWorker.postMessage(msg);
  });
}

// Latest hydrated state - updated on every STATE_UPDATE, exposed as getDocState()
let lastDocState: DocState | null = null;
let lastDocStats: DocStats | null = null;
let lastItemIndexById: ItemIndex = new Map();

// ---------------------------------------------------------------------------
// Subscriber model
// ---------------------------------------------------------------------------

type Subscriber = (state: DocState, event: DocChangeEvent) => void;
const subscribers = new Set<Subscriber>();

export function subscribe(callback: Subscriber): () => void {
  subscribers.add(callback);
  return () => subscribers.delete(callback);
}

function isMergeablePreferenceObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function mergePreferencePatch<T extends object>(
  current: T,
  update: Partial<T>,
): T {
  const next = { ...current };

  for (const key of Object.keys(update) as Array<keyof T>) {
    const currentValue = current[key];
    const updateValue = update[key];
    next[key] = (
      isMergeablePreferenceObject(currentValue) && isMergeablePreferenceObject(updateValue)
        ? mergePreferencePatch<Record<string, unknown>>(currentValue, updateValue)
        : updateValue
    ) as T[typeof key];
  }

  return next;
}

function publishState(state: DocState, event: DocChangeEvent): void {
  lastDocState = state;
  if (event.requiresFullScan) {
    lastItemIndexById = createItemIndex(state.items);
  }
  for (const sub of subscribers) sub(state, event);
}

// ---------------------------------------------------------------------------
// Relay client count - forwarded to the worker for BROADCAST_REQUEST gating
// ---------------------------------------------------------------------------

export function setRelayClientCount(n: number): void {
  latestRelayClientCount = n;
  if (!worker) return;
  const activeWorker = worker;
  void ensureWorkerReady().then(() => {
    if (worker !== activeWorker) return;
    activeWorker.postMessage({
      reqId: nextReqId++,
      type: "UPDATE_RELAY_CLIENT_COUNT",
      count: n,
    } satisfies WorkerRequest);
  });
}

// ---------------------------------------------------------------------------
// Inbound worker message handler
// ---------------------------------------------------------------------------

function handleWorkerMessage(event: MessageEvent<WorkerResponse>) {
  const sourceWorker = event.currentTarget as Worker | null;
  if (sourceWorker && sourceWorker !== worker) return;
  const msg = event.data;

  if (msg.type === "READY") return;

  if (msg.type === "STATE_UPDATE") {
    publishState(msg.state, {
      source: "state_update",
      mutation: msg.mutation,
      changedItemIds: null,
      requiresFullScan: true,
    });
    return;
  }

  if (msg.type === "PREFERENCES_PATCH") {
    if (!lastDocState) return;
    const preferences = mergePreferencePatch(lastDocState.preferences, msg.updates);
    publishState(
      { ...lastDocState, preferences },
      {
        source: "preferences_patch",
        mutation: msg.mutation,
        changedItemIds: null,
        changedItems: [],
        requiresFullScan: false,
      },
    );
    return;
  }

  if (msg.type === "ITEM_PATCH") {
    if (!lastDocState) return;
    const changedItems = msg.patches.map((patch) => patch.item);
    const patched = applyItemPatchesToState(lastDocState, msg.patches, lastItemIndexById, {
      orderedItemIds: msg.orderedItemIds,
      preservePriorityOrder: msg.preservePriorityOrder,
      searchCorpusVersion: msg.searchCorpusVersion,
      docItemCount: msg.docItemCount,
    });
    lastItemIndexById = patched.itemIndex;
    publishState(patched.state, {
      source: "item_patch",
      mutation: msg.mutation,
      changedItemIds: msg.changedItemIds,
      changedItems,
      requiresFullScan: false,
    });
    return;
  }

  if (msg.type === "FEEDS_PATCH") {
    if (!lastDocState) return;
    const feeds = { ...lastDocState.feeds };
    for (const url of msg.patch.removedUrls) {
      delete feeds[url];
    }
    Object.assign(feeds, msg.patch.feeds);
    publishState(
      { ...lastDocState, feeds },
      {
        source: "feeds_patch",
        mutation: msg.mutation,
        changedItemIds: null,
        changedItems: [],
        requiresFullScan: false,
      },
    );
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
    if (
      msg.kind === "change" &&
      (msg.detail ?? "").startsWith("[automerge-worker] released idle document")
    ) {
      scheduleIdleWorkerStop();
    }
    return;
  }

  if (msg.type === "INIT_STATS") {
    recordWorkerInit({ durationMs: msg.durationMs, docBytes: msg.docBytes });
    return;
  }

  if (msg.type === "INIT_RECOVERY") {
    recordRuntimeHealthEvent({
      event: "worker_init_recovery",
      reason: msg.reason,
      action: msg.action,
      recoveryBytes: msg.recoveryBytes,
    });
    return;
  }

  if (msg.type === "DEBUG_SNAPSHOT") {
    lastDocStats = { binaryBytes: msg.binarySize, itemCount: msg.itemCount };
    setDocSnapshot({
      deviceId: msg.deviceId,
      itemCount: msg.itemCount,
      feedCount: msg.feedCount,
      binarySize: msg.binarySize,
      savedAt: Date.now(),
    });
    return;
  }

  if (msg.type === "ALL_ITEM_IDS") {
    const pendingIds = pendingAllItemIds.get(msg.reqId);
    if (!pendingIds) return;
    clearTimeout(pendingIds.timer);
    pendingAllItemIds.delete(msg.reqId);
    pendingIds.resolve(msg.ids);
    return;
  }

  if (msg.type === "DOC_BINARY") {
    const pendingBinary = pendingDocBinary.get(msg.reqId);
    if (!pendingBinary) return;
    clearTimeout(pendingBinary.timer);
    pendingDocBinary.delete(msg.reqId);
    pendingBinary.resolve(msg.binary);
    return;
  }

  if (msg.type === "DOC_HEADS") {
    const pendingHeads = pendingDocHeads.get(msg.reqId);
    if (!pendingHeads) return;
    clearTimeout(pendingHeads.timer);
    pendingDocHeads.delete(msg.reqId);
    pendingHeads.resolve(msg.heads);
    return;
  }

  if (msg.type === "SAVED_YOUTUBE_URLS") {
    const pendingUrls = pendingSavedYouTubeUrls.get(msg.reqId);
    if (!pendingUrls) return;
    clearTimeout(pendingUrls.timer);
    pendingSavedYouTubeUrls.delete(msg.reqId);
    pendingUrls.resolve(msg.urls);
    return;
  }

  if (msg.type === "ITEM_PRESERVED_TEXT") {
    const pendingText = pendingPreservedText.get(msg.reqId);
    if (!pendingText) return;
    clearTimeout(pendingText.timer);
    pendingPreservedText.delete(msg.reqId);
    pendingText.resolve(msg.text);
    return;
  }

  if (msg.type === "CONTENT_SIGNAL_BACKFILL_RESULT") {
    const pendingBackfill = pendingContentSignalBackfill.get(msg.reqId);
    if (!pendingBackfill) return;
    clearTimeout(pendingBackfill.timer);
    pendingContentSignalBackfill.delete(msg.reqId);
    pendingBackfill.resolve(msg.summary);
    return;
  }

  if (msg.type === "SAMPLE_DATA_CLEAR_RESULT") {
    const pendingClear = pendingSampleDataClear.get(msg.reqId);
    if (!pendingClear) return;
    clearTimeout(pendingClear.timer);
    pendingSampleDataClear.delete(msg.reqId);
    pendingClear.resolve(msg.summary);
    return;
  }

  // ACK
  const pendingBackfill = pendingContentSignalBackfill.get(msg.reqId);
  if (pendingBackfill && msg.error) {
    clearTimeout(pendingBackfill.timer);
    pendingContentSignalBackfill.delete(msg.reqId);
    pendingBackfill.reject(new Error(msg.error));
    return;
  }

  const pendingClear = pendingSampleDataClear.get(msg.reqId);
  if (pendingClear && msg.error) {
    clearTimeout(pendingClear.timer);
    pendingSampleDataClear.delete(msg.reqId);
    pendingClear.reject(new Error(msg.error));
    return;
  }

  const pendingUrls = pendingSavedYouTubeUrls.get(msg.reqId);
  if (pendingUrls && msg.error) {
    clearTimeout(pendingUrls.timer);
    pendingSavedYouTubeUrls.delete(msg.reqId);
    pendingUrls.reject(new Error(msg.error));
    return;
  }

  const p = pending.get(msg.reqId);
  if (!p) return;
  clearTimeout(p.timer);
  pending.delete(msg.reqId);
  if (msg.error) p.reject(new Error(msg.error));
  else p.resolve();
}

function handleWorkerError(err: ErrorEvent) {
  const failedWorker = (err.currentTarget as Worker | null) ?? worker;
  if (failedWorker && failedWorker !== worker) return;
  const msg = workerErrorMessage(err);
  log.error(`[automerge-worker] unhandled error: ${msg}`);
  addDebugEvent("error", `[AutomergeWorker] unhandled error: ${msg}`);
  if (failedWorker) {
    resetFailedWorker(failedWorker, new Error(msg), "runtime_error");
  }
}

function handleWorkerMessageError(err: MessageEvent) {
  const failedWorker = (err.currentTarget as Worker | null) ?? worker;
  if (failedWorker && failedWorker !== worker) return;
  const msg = workerErrorMessage(err);
  log.error(`[automerge-worker] message error: ${msg}`);
  addDebugEvent("error", `[AutomergeWorker] message error: ${msg}`);
  if (failedWorker) {
    resetFailedWorker(failedWorker, new Error(msg), "runtime_message_error");
  }
}

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
    const activeWorker = getWorker();
    const reqId = nextReqId++;

    let initialState: DocState | null = null;
    let initAcked = false;
    let settled = false;

    function cleanup() {
      const pendingRequest = pendingInit.get(reqId);
      if (pendingRequest) clearTimeout(pendingRequest.timer);
      pendingInit.delete(reqId);
      activeWorker.removeEventListener("message", stateHandler);
    }

    function fail(error: Error) {
      if (settled) return;
      settled = true;
      cleanup();
      reject(error);
    }

    function tryResolve() {
      if (!initialState || !initAcked || settled) return;
      settled = true;
      cleanup();
      appDocumentInitialized = true;
      workerDocumentInitialized = true;
      resolve(initialState);
    }

    const stateHandler = (event: MessageEvent<WorkerResponse>) => {
      const sourceWorker = event.currentTarget as Worker | null;
      if (
        (sourceWorker && sourceWorker !== activeWorker) ||
        worker !== activeWorker
      ) {
        return;
      }
      const msg = event.data;
      if (msg.type === "STATE_UPDATE" && !initialState) {
        lastDocState = msg.state;
        lastItemIndexById = createItemIndex(msg.state.items);
        initialState = msg.state;
        tryResolve();
      } else if (msg.type === "ACK" && msg.reqId === reqId) {
        registerDocAccessors(
          () => null,
          () => "(doc lives in worker - not directly accessible)",
          () => new Uint8Array(0),
        );
        if (msg.error) {
          fail(new WorkerInitFailureError(msg.error));
        } else {
          initAcked = true;
          tryResolve();
        }
      }
    };

    const timer = setTimeout(() => {
      if (!pendingInit.has(reqId)) return;
      pendingInit.delete(reqId);
      const error = new WorkerInitTimeoutError(
        `[automerge-worker] request TIMEOUT op=INIT reqId=${reqId}` +
          ` timeout_ms=${WORKER_REQUEST_TIMEOUT_MS.toLocaleString()}`,
      );
      resetFailedWorker(activeWorker, error, "runtime_init_timeout");
      fail(error);
    }, WORKER_REQUEST_TIMEOUT_MS);

    pendingInit.set(reqId, {
      timer,
      reject: (error) =>
        fail(
          error instanceof WorkerInitFailureError
            ? error
            : new WorkerInitFailureError(error.message),
        ),
    });
    activeWorker.addEventListener("message", stateHandler);
    activeWorker.postMessage({ reqId, type: "INIT" } satisfies WorkerRequest);
  });
}

export async function initDoc(): Promise<DocState> {
  await ensureWorkerReady();
  const state = await sendInit();
  appDocumentInitialized = true;
  workerDocumentInitialized = true;
  return state;
}

/** Latest hydrated state from the worker. Returns null before first INIT. */
export function getDocState(): DocState | null {
  return lastDocState;
}

export async function getDocBinary(): Promise<Uint8Array> {
  await ensureWorkerDocumentReadyFor("GET_DOC_BINARY");
  const activeWorker = getWorker();
  return new Promise((resolve, reject) => {
    const reqId = nextReqId++;
    const timer = setTimeout(() => {
      if (!pendingDocBinary.has(reqId)) return;
      pendingDocBinary.delete(reqId);
      reject(
        new Error(
          `[automerge-worker] request TIMEOUT op=GET_DOC_BINARY reqId=${reqId} timeout_ms=${WORKER_REQUEST_TIMEOUT_MS.toLocaleString()}`,
        ),
      );
    }, WORKER_REQUEST_TIMEOUT_MS);

    pendingDocBinary.set(reqId, { resolve, reject, timer });
    activeWorker.postMessage({ reqId, type: "GET_DOC_BINARY" } satisfies WorkerRequest);
  });
}

/**
 * Current document heads for upload-loop accounting (stability P0-03).
 * Never forces a document load or a worker re-INIT: an idle worker answers
 * with the heads at last save, and a fresh worker answers null.
 */
export async function getDocHeads(): Promise<string[] | null> {
  await ensureWorkerReady();
  const activeWorker = getWorker();
  return new Promise((resolve, reject) => {
    const reqId = nextReqId++;
    const timer = setTimeout(() => {
      if (!pendingDocHeads.has(reqId)) return;
      pendingDocHeads.delete(reqId);
      reject(
        new Error(
          `[automerge-worker] request TIMEOUT op=GET_HEADS reqId=${reqId} timeout_ms=${WORKER_REQUEST_TIMEOUT_MS.toLocaleString()}`,
        ),
      );
    }, WORKER_REQUEST_TIMEOUT_MS);

    pendingDocHeads.set(reqId, { resolve, reject, timer });
    activeWorker.postMessage({ reqId, type: "GET_HEADS" } satisfies WorkerRequest);
  });
}

/** Canonical URLs for every saved YouTube item in the complete document. */
export async function getSavedYouTubeVideoUrls(): Promise<string[]> {
  await ensureWorkerDocumentReadyFor("GET_SAVED_YOUTUBE_URLS");
  const activeWorker = getWorker();
  return new Promise((resolve, reject) => {
    const reqId = nextReqId++;
    const timer = setTimeout(() => {
      if (!pendingSavedYouTubeUrls.has(reqId)) return;
      pendingSavedYouTubeUrls.delete(reqId);
      reject(
        new Error(
          `[automerge-worker] request TIMEOUT op=GET_SAVED_YOUTUBE_URLS reqId=${reqId} timeout_ms=${WORKER_REQUEST_TIMEOUT_MS.toLocaleString()}`,
        ),
      );
    }, WORKER_REQUEST_TIMEOUT_MS);

    pendingSavedYouTubeUrls.set(reqId, { resolve, reject, timer });
    activeWorker.postMessage({ reqId, type: "GET_SAVED_YOUTUBE_URLS" } satisfies WorkerRequest);
  });
}

export function getCachedDocStats(): DocStats | null {
  return lastDocStats;
}

export async function getAllItemIds(): Promise<string[]> {
  await ensureWorkerDocumentReadyFor("GET_ALL_ITEM_IDS");
  const activeWorker = getWorker();
  return new Promise((resolve, reject) => {
    const reqId = nextReqId++;
    const timer = setTimeout(() => {
      if (!pendingAllItemIds.has(reqId)) return;
      pendingAllItemIds.delete(reqId);
      reject(
        new Error(
          `[automerge-worker] request TIMEOUT op=GET_ALL_ITEM_IDS reqId=${reqId} timeout_ms=${WORKER_REQUEST_TIMEOUT_MS.toLocaleString()}`,
        ),
      );
    }, WORKER_REQUEST_TIMEOUT_MS);

    pendingAllItemIds.set(reqId, { resolve, reject, timer });
    activeWorker.postMessage({ reqId, type: "GET_ALL_ITEM_IDS" } satisfies WorkerRequest);
  });
}

export async function getItemPreservedText(globalId: string): Promise<string | null> {
  await ensureWorkerDocumentReadyFor("GET_ITEM_PRESERVED_TEXT");
  const activeWorker = getWorker();
  return new Promise((resolve, reject) => {
    const reqId = nextReqId++;
    const timer = setTimeout(() => {
      if (!pendingPreservedText.has(reqId)) return;
      pendingPreservedText.delete(reqId);
      reject(
        new Error(
          `[automerge-worker] request TIMEOUT op=GET_ITEM_PRESERVED_TEXT reqId=${reqId} timeout_ms=${WORKER_REQUEST_TIMEOUT_MS.toLocaleString()}`,
        ),
      );
    }, WORKER_REQUEST_TIMEOUT_MS);

    pendingPreservedText.set(reqId, { resolve, reject, timer });
    activeWorker.postMessage({ reqId, type: "GET_ITEM_PRESERVED_TEXT", globalId } satisfies WorkerRequest);
  });
}

export async function mergeDoc(incoming: Uint8Array): Promise<void> {
  const reqId = nextReqId++;
  return request({ reqId, type: "MERGE_DOC", binary: incoming });
}

export async function clearLocalDoc(): Promise<void> {
  const reqId = nextReqId++;
  return request({ reqId, type: "CLEAR_LOCAL" });
}

export async function replaceLocalDoc(binary: Uint8Array): Promise<void> {
  const reqId = nextReqId++;
  return request({ reqId, type: "REPLACE_DOC", binary });
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

/** Reconcile one authenticated YouTube capture in a single Automerge change. */
export async function docReconcileYouTubeCapture(
  accounts: Account[],
  items: FeedItem[],
  options: { rosterComplete: boolean; capturedAt: number },
): Promise<void> {
  const reqId = nextReqId++;
  return request({
    reqId,
    type: "RECONCILE_YOUTUBE_CAPTURE",
    accounts,
    items,
    options,
  });
}

export async function docAddSampleLibraryData(data: {
  feeds: RssFeed[];
  items: FeedItem[];
  persons: Person[];
  accounts: Account[];
}): Promise<void> {
  const reqId = nextReqId++;
  return request({
    reqId,
    type: "ADD_SAMPLE_LIBRARY_DATA",
    feeds: data.feeds,
    items: data.items,
    persons: data.persons,
    accounts: data.accounts,
  });
}

export async function docRemoveFeedItem(globalId: string): Promise<void> {
  const reqId = nextReqId++;
  return request({ reqId, type: "REMOVE_FEED_ITEM", globalId });
}

export async function docClearSampleData(): Promise<SampleDataClearSummary> {
  await ensureWorkerDocumentReadyFor("CLEAR_SAMPLE_DATA");
  const activeWorker = getWorker();
  return new Promise((resolve, reject) => {
    const reqId = nextReqId++;
    const timer = setTimeout(() => {
      if (!pendingSampleDataClear.has(reqId)) return;
      pendingSampleDataClear.delete(reqId);
      reject(
        new Error(
          `[automerge-worker] request TIMEOUT op=CLEAR_SAMPLE_DATA reqId=${reqId} timeout_ms=${WORKER_REQUEST_TIMEOUT_MS.toLocaleString()}`,
        ),
      );
    }, WORKER_REQUEST_TIMEOUT_MS);

    pendingSampleDataClear.set(reqId, { resolve, reject, timer });
    activeWorker.postMessage({ reqId, type: "CLEAR_SAMPLE_DATA" } satisfies WorkerRequest);
  });
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

export async function docArchiveItems(globalIds: string[]): Promise<void> {
  if (globalIds.length === 0) return;
  const reqId = nextReqId++;
  return request({ reqId, type: "ARCHIVE_ITEMS", globalIds });
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

export async function docAddPerson(person: Person): Promise<void> {
  const reqId = nextReqId++;
  return request({ reqId, type: "ADD_PERSON", person });
}

export async function docAddPersons(persons: Person[]): Promise<void> {
  const reqId = nextReqId++;
  return request({ reqId, type: "ADD_PERSONS", persons });
}

export async function docUpdatePerson(
  personId: string,
  updates: Partial<Person>,
): Promise<void> {
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

export async function docUpdateAccount(
  accountId: string,
  updates: Partial<Account>,
): Promise<void> {
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

export async function docBackfillContentSignals(
  batchSize: number = 200,
): Promise<ContentSignalBackfillSummary> {
  await ensureWorkerDocumentReadyFor("BACKFILL_CONTENT_SIGNALS");
  const activeWorker = getWorker();
  return new Promise((resolve, reject) => {
    const reqId = nextReqId++;
    const timer = setTimeout(() => {
      if (!pendingContentSignalBackfill.has(reqId)) return;
      pendingContentSignalBackfill.delete(reqId);
      reject(
        new Error(
          `[automerge-worker] request TIMEOUT op=BACKFILL_CONTENT_SIGNALS reqId=${reqId} timeout_ms=${WORKER_REQUEST_TIMEOUT_MS.toLocaleString()}`,
        ),
      );
    }, WORKER_REQUEST_TIMEOUT_MS);

    pendingContentSignalBackfill.set(reqId, { resolve, reject, timer });
    activeWorker.postMessage({ reqId, type: "BACKFILL_CONTENT_SIGNALS", batchSize } satisfies WorkerRequest);
  });
}

/**
 * Add a minimal stub FeedItem for a URL. The stub is constructed on the main
 * thread (pure JS - no WASM), then posted to the worker via ADD_FEED_ITEM.
 * Returns the stub so callers that use the FeedItem directly are unchanged.
 */
export async function docAddStubItem(url: string, tags: string[] = []): Promise<FeedItem> {
  const globalId = `saved:${hashSavedUrl(url)}`;
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
