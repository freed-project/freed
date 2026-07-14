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
import type {
  DocState,
  DocumentHistoryRelation,
  WorkerRequest,
  WorkerResponse,
} from "./automerge-types";
import { persistWorkerDebugEvent } from "./automerge-worker-debug";
export type { DocState } from "./automerge-types";

// ---------------------------------------------------------------------------
// Worker lifecycle
// ---------------------------------------------------------------------------

const WORKER_START_TIMEOUT_MS = 15_000;
const WORKER_INIT_TIMEOUT_MS = 180_000;

class WorkerLifecycleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WorkerLifecycleError";
  }
}

class InitDataError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InitDataError";
  }
}

interface WorkerGeneration {
  id: number;
  worker: Worker;
  ready: Promise<void>;
  rejectReady: (error: WorkerLifecycleError) => void;
  cleanupReady: () => void;
  failed: boolean;
  failure: WorkerLifecycleError | null;
  documentInitialized: boolean;
}

interface GenerationOwnedRequest<T> {
  generationId: number;
  resolve: (value: T) => void;
  reject: (error: Error) => void;
}

interface PendingInitialization {
  generationId: number;
  rejectLifecycle: (error: WorkerLifecycleError) => void;
}

let activeGeneration: WorkerGeneration | null = null;
let nextGenerationId = 1;
let pendingInitialization: PendingInitialization | null = null;
let appDocumentInitialized = false;

// ---------------------------------------------------------------------------
// Request/response plumbing
// ---------------------------------------------------------------------------

let nextReqId = 1;
const pending = new Map<number, GenerationOwnedRequest<void>>();
const pendingContentSignalBackfill = new Map<
  number,
  GenerationOwnedRequest<ContentSignalBackfillSummary>
>();
const pendingSampleDataClear = new Map<
  number,
  GenerationOwnedRequest<SampleDataClearSummary>
>();
const pendingDocBinary = new Map<
  number,
  GenerationOwnedRequest<Uint8Array>
>();
const pendingDocHeads = new Map<
  number,
  GenerationOwnedRequest<string[] | null>
>();
const pendingDocRelationship = new Map<
  number,
  GenerationOwnedRequest<DocumentHistoryRelation>
>();
const pendingLegacyHtml = new Map<
  number,
  GenerationOwnedRequest<string | null>
>();

const pendingMaps: Array<Map<number, GenerationOwnedRequest<unknown>>> = [
  pending as Map<number, GenerationOwnedRequest<unknown>>,
  pendingContentSignalBackfill as Map<number, GenerationOwnedRequest<unknown>>,
  pendingSampleDataClear as Map<number, GenerationOwnedRequest<unknown>>,
  pendingDocBinary as Map<number, GenerationOwnedRequest<unknown>>,
  pendingDocHeads as Map<number, GenerationOwnedRequest<unknown>>,
  pendingDocRelationship as Map<number, GenerationOwnedRequest<unknown>>,
  pendingLegacyHtml as Map<number, GenerationOwnedRequest<unknown>>,
];

function lifecycleError(message: string): WorkerLifecycleError {
  return new WorkerLifecycleError(message);
}

function workerErrorMessage(event: ErrorEvent | MessageEvent): string {
  const message = (event as { message?: unknown }).message;
  return typeof message === "string" && message.length > 0
    ? message
    : "Automerge worker message could not be decoded";
}

function rejectGenerationRequests(generationId: number, error: WorkerLifecycleError): void {
  if (pendingInitialization?.generationId === generationId) {
    const initialization = pendingInitialization;
    pendingInitialization = null;
    initialization.rejectLifecycle(error);
  }

  for (const pendingMap of pendingMaps) {
    for (const [reqId, request] of pendingMap) {
      if (request.generationId !== generationId) continue;
      pendingMap.delete(reqId);
      request.reject(error);
    }
  }
}

function failWorkerGeneration(
  generation: WorkerGeneration,
  error: WorkerLifecycleError,
  phase: string,
): void {
  if (generation.failed) return;
  generation.failed = true;
  generation.failure = error;
  generation.documentInitialized = false;
  generation.cleanupReady();
  generation.rejectReady(error);
  generation.worker.onmessage = null;
  generation.worker.onerror = null;
  generation.worker.onmessageerror = null;
  generation.worker.terminate();

  if (activeGeneration === generation) {
    activeGeneration = null;
    lastBinary = null;
    lastDocState = null;
  }

  rejectGenerationRequests(generation.id, error);
  const detail = `worker_lifecycle_failed phase=${phase} generation=${generation.id.toLocaleString()} message=${error.message}`;
  console.error(`[AutomergeWorker] ${detail}`);
  addDebugEvent("error", detail);
  persistWorkerDebugEvent({ kind: "worker_lifecycle_failed", detail });
}

function createWorkerGeneration(): WorkerGeneration {
  const worker = new Worker(new URL("./automerge.worker.ts", import.meta.url), {
    type: "module",
  });
  let rejectReady: (error: WorkerLifecycleError) => void = () => {};
  let cleanupReady = () => {};
  const generation: WorkerGeneration = {
    id: nextGenerationId++,
    worker,
    ready: Promise.resolve(),
    rejectReady: (error) => rejectReady(error),
    cleanupReady: () => cleanupReady(),
    failed: false,
    failure: null,
    documentInitialized: false,
  };

  generation.ready = new Promise<void>((resolve, reject) => {
    rejectReady = reject;
    const timeout = setTimeout(() => {
      failWorkerGeneration(
        generation,
        lifecycleError(
          `Automerge worker failed to start within ${(WORKER_START_TIMEOUT_MS / 1_000).toLocaleString()} seconds`,
        ),
        "startup_timeout",
      );
    }, WORKER_START_TIMEOUT_MS);

    const onReady = (event: MessageEvent<WorkerResponse>) => {
      if (event.data.type !== "READY" || generation.failed) return;
      cleanupReady();
      resolve();
    };

    cleanupReady = () => {
      clearTimeout(timeout);
      worker.removeEventListener("message", onReady);
    };
    generation.cleanupReady = () => cleanupReady();
    worker.addEventListener("message", onReady);
  });
  void generation.ready.catch(() => {});

  worker.onmessage = (event) => handleWorkerMessage(generation, event);
  worker.onerror = (event) => {
    failWorkerGeneration(
      generation,
      lifecycleError(workerErrorMessage(event)),
      "runtime_error",
    );
  };
  worker.onmessageerror = (event) => {
    failWorkerGeneration(
      generation,
      lifecycleError(workerErrorMessage(event)),
      "runtime_message_error",
    );
  };

  activeGeneration = generation;
  return generation;
}

async function getReadyGeneration(): Promise<WorkerGeneration> {
  const generation = activeGeneration?.failed
    ? createWorkerGeneration()
    : activeGeneration ?? createWorkerGeneration();
  await generation.ready;
  if (generation.failed || activeGeneration !== generation) {
    throw generation.failure ?? lifecycleError("Automerge worker generation is no longer active");
  }
  return generation;
}

async function getReadyGenerationWithStartupRetry(): Promise<WorkerGeneration> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      return await getReadyGeneration();
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

function postToGeneration(generation: WorkerGeneration, message: WorkerRequest): void {
  if (generation.failed || activeGeneration !== generation) {
    throw generation.failure ?? lifecycleError("Automerge worker generation is no longer active");
  }
  try {
    generation.worker.postMessage(message);
  } catch (error) {
    const failure = lifecycleError(
      `Automerge worker postMessage failed: ${error instanceof Error ? error.message : String(error)}`,
    );
    failWorkerGeneration(generation, failure, "post_message_error");
    throw failure;
  }
}

function requestOnGeneration<T>(
  generation: WorkerGeneration,
  pendingMap: Map<number, GenerationOwnedRequest<T>>,
  message: WorkerRequest,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const request = { generationId: generation.id, resolve, reject };
    pendingMap.set(message.reqId, request);
    try {
      postToGeneration(generation, message);
    } catch (error) {
      if (pendingMap.get(message.reqId) === request) {
        pendingMap.delete(message.reqId);
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    }
  });
}

async function getGenerationForRequest(type: WorkerRequest["type"]): Promise<WorkerGeneration> {
  const generation = await getReadyGenerationWithStartupRetry();
  if (
    type !== "INIT" &&
    type !== "CLEAR_LOCAL" &&
    appDocumentInitialized &&
    !generation.documentInitialized
  ) {
    await initDoc();
    return getReadyGeneration();
  }
  return generation;
}

async function request(msg: WorkerRequest): Promise<void> {
  const generation = await getGenerationForRequest(msg.type);
  return requestOnGeneration(generation, pending, msg);
}

async function requestResult<T>(
  pendingMap: Map<number, GenerationOwnedRequest<T>>,
  message: WorkerRequest,
): Promise<T> {
  const generation = await getGenerationForRequest(message.type);
  return requestOnGeneration(generation, pendingMap, message);
}

// Latest binary fetched from the worker for the debug escape hatch.
let lastBinary: Uint8Array | null = null;
let lastDocState: DocState | null = null;
let initPromise: Promise<DocState> | null = null;

// ---------------------------------------------------------------------------
// Subscriber model
// ---------------------------------------------------------------------------

interface DocChangeEvent {
  mutation?: WorkerRequest["type"];
}

type Subscriber = (state: DocState, event: DocChangeEvent) => void;
const subscribers = new Set<Subscriber>();

export function subscribe(callback: Subscriber): () => void {
  subscribers.add(callback);
  return () => subscribers.delete(callback);
}

// ---------------------------------------------------------------------------
// Inbound worker message handler
// ---------------------------------------------------------------------------

function getOwnedRequest<T>(
  pendingMap: Map<number, GenerationOwnedRequest<T>>,
  reqId: number,
  generationId: number,
): GenerationOwnedRequest<T> | null {
  const request = pendingMap.get(reqId);
  return request?.generationId === generationId ? request : null;
}

function handleWorkerMessage(
  generation: WorkerGeneration,
  event: MessageEvent<WorkerResponse>,
): void {
  if (generation.failed || activeGeneration !== generation) return;
  const msg = event.data;

  if (msg.type === "READY") return;

  if (msg.type === "STATE_UPDATE") {
    if (msg.binary) lastBinary = msg.binary;
    lastDocState = msg.state;
    for (const sub of subscribers) sub(msg.state, { mutation: msg.mutation });
    return;
  }

  if (msg.type === "DOC_BINARY") {
    const pendingBinary = getOwnedRequest(pendingDocBinary, msg.reqId, generation.id);
    if (!pendingBinary) return;
    pendingDocBinary.delete(msg.reqId);
    lastBinary = msg.binary;
    pendingBinary.resolve(msg.binary);
    return;
  }

  if (msg.type === "DOC_HEADS") {
    const pendingHeads = getOwnedRequest(pendingDocHeads, msg.reqId, generation.id);
    if (!pendingHeads) return;
    pendingDocHeads.delete(msg.reqId);
    pendingHeads.resolve(msg.heads);
    return;
  }

  if (msg.type === "DOC_RELATIONSHIP") {
    const pendingRelationship = getOwnedRequest(pendingDocRelationship, msg.reqId, generation.id);
    if (!pendingRelationship) return;
    pendingDocRelationship.delete(msg.reqId);
    pendingRelationship.resolve(msg.relation);
    return;
  }

  if (msg.type === "ITEM_LEGACY_HTML") {
    const pendingHtml = getOwnedRequest(pendingLegacyHtml, msg.reqId, generation.id);
    if (!pendingHtml) return;
    pendingLegacyHtml.delete(msg.reqId);
    pendingHtml.resolve(msg.html);
    return;
  }

  if (msg.type === "INIT_STATS") {
    // Worker-INIT counter (stability P0-03) on the PWA debug channel, same
    // field names as the desktop runtime-health worker_init event.
    const detail = `worker_init durationMs=${msg.durationMs.toLocaleString()} docBytes=${msg.docBytes.toLocaleString()}`;
    addDebugEvent("change", detail, msg.docBytes);
    persistWorkerDebugEvent({ kind: "worker_init", detail, bytes: msg.docBytes });
    return;
  }

  if (msg.type === "DEBUG_EVENT") {
    addDebugEvent(msg.kind as Parameters<typeof addDebugEvent>[0], msg.detail, msg.bytes);
    persistWorkerDebugEvent({ kind: msg.kind, detail: msg.detail, bytes: msg.bytes });
    return;
  }

  if (msg.type === "DEBUG_SNAPSHOT") {
    setDocSnapshot({
      documentId: msg.documentId,
      itemCount: msg.itemCount,
      feedCount: msg.feedCount,
      binarySize: msg.binarySize,
      savedAt: Date.now(),
    });
    return;
  }

  if (msg.type === "CONTENT_SIGNAL_BACKFILL_RESULT") {
    const pendingBackfill = getOwnedRequest(
      pendingContentSignalBackfill,
      msg.reqId,
      generation.id,
    );
    if (!pendingBackfill) return;
    pendingContentSignalBackfill.delete(msg.reqId);
    pendingBackfill.resolve(msg.summary);
    return;
  }

  if (msg.type === "SAMPLE_DATA_CLEAR_RESULT") {
    const pendingClear = getOwnedRequest(pendingSampleDataClear, msg.reqId, generation.id);
    if (!pendingClear) return;
    pendingSampleDataClear.delete(msg.reqId);
    pendingClear.resolve(msg.summary);
    return;
  }

  // ACK — resolve or reject the pending promise
  const pendingBackfill = getOwnedRequest(
    pendingContentSignalBackfill,
    msg.reqId,
    generation.id,
  );
  if (pendingBackfill && msg.error) {
    pendingContentSignalBackfill.delete(msg.reqId);
    pendingBackfill.reject(new Error(msg.error));
    return;
  }

  const pendingClear = getOwnedRequest(pendingSampleDataClear, msg.reqId, generation.id);
  if (pendingClear && msg.error) {
    pendingSampleDataClear.delete(msg.reqId);
    pendingClear.reject(new Error(msg.error));
    return;
  }

  const pendingBinary = getOwnedRequest(pendingDocBinary, msg.reqId, generation.id);
  if (pendingBinary && msg.error) {
    pendingDocBinary.delete(msg.reqId);
    pendingBinary.reject(new Error(msg.error));
    return;
  }

  const pendingHeads = getOwnedRequest(pendingDocHeads, msg.reqId, generation.id);
  if (pendingHeads && msg.error) {
    pendingDocHeads.delete(msg.reqId);
    pendingHeads.reject(new Error(msg.error));
    return;
  }

  const pendingRelationship = getOwnedRequest(
    pendingDocRelationship,
    msg.reqId,
    generation.id,
  );
  if (pendingRelationship && msg.error) {
    pendingDocRelationship.delete(msg.reqId);
    pendingRelationship.reject(new Error(msg.error));
    return;
  }

  const pendingHtml = getOwnedRequest(pendingLegacyHtml, msg.reqId, generation.id);
  if (pendingHtml && msg.error) {
    pendingLegacyHtml.delete(msg.reqId);
    pendingHtml.reject(new Error(msg.error));
    return;
  }

  const p = getOwnedRequest(pending, msg.reqId, generation.id);
  if (!p) return;
  pending.delete(msg.reqId);
  if (msg.error) {
    p.reject(new Error(msg.error));
  } else {
    p.resolve();
  }
}

createWorkerGeneration();

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Initialize the Automerge document. Must be called once before any mutations.
 * Returns the initial hydrated state (equivalent to the old FreedDoc return,
 * but already processed into plain JS — no WASM on the main thread).
 */
function sendInit(generation: WorkerGeneration): Promise<DocState> {
  return new Promise((resolve, reject) => {
    const reqId = nextReqId++;
    let initialState: DocState | null = null;
    let initAcked = false;
    let settled = false;

    const cleanup = () => {
      clearTimeout(timeout);
      generation.worker.removeEventListener("message", stateHandler);
      if (pendingInitialization?.generationId === generation.id) {
        pendingInitialization = null;
      }
    };

    function tryResolve() {
      if (!initialState || !initAcked || settled) return;
      settled = true;
      cleanup();
      generation.documentInitialized = true;
      appDocumentInitialized = true;
      try {
        registerDocAccessors(
          () => null,
          () => "(doc lives in worker, not directly accessible)",
          () => lastBinary ?? new Uint8Array(0),
        );
      } catch (error) {
        console.error("[AutomergeWorker] Failed to register debug document accessors", error);
      }
      resolve(initialState);
    }

    function stateHandler(event: MessageEvent<WorkerResponse>) {
      if (generation.failed || activeGeneration !== generation || settled) return;
      const msg = event.data;
      if (msg.type === "STATE_UPDATE" && !initialState) {
        if (msg.binary) lastBinary = msg.binary;
        lastDocState = msg.state;
        initialState = msg.state;
        tryResolve();
      } else if (msg.type === "ACK" && msg.reqId === reqId) {
        if (msg.error) {
          settled = true;
          cleanup();
          generation.documentInitialized = false;
          lastBinary = null;
          lastDocState = null;
          reject(new InitDataError(msg.error));
        } else {
          initAcked = true;
          tryResolve();
        }
      }
    }

    const timeout = setTimeout(() => {
      failWorkerGeneration(
        generation,
        lifecycleError(
          `Automerge worker INIT timed out after ${WORKER_INIT_TIMEOUT_MS.toLocaleString()} milliseconds`,
        ),
        "runtime_init_timeout",
      );
    }, WORKER_INIT_TIMEOUT_MS);

    pendingInitialization = {
      generationId: generation.id,
      rejectLifecycle: (error) => {
        if (settled) return;
        settled = true;
        cleanup();
        reject(error);
      },
    };
    generation.worker.addEventListener("message", stateHandler);
    try {
      postToGeneration(generation, { reqId, type: "INIT" } satisfies WorkerRequest);
    } catch (error) {
      if (!settled) {
        settled = true;
        cleanup();
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    }
  });
}

async function initializeGenerationWithDataRecovery(
  generation: WorkerGeneration,
): Promise<DocState> {
  try {
    return await sendInit(generation);
  } catch (error) {
    if (!(error instanceof InitDataError)) throw error;
    lastBinary = null;
    lastDocState = null;
    generation.documentInitialized = false;
    const reqId = nextReqId++;
    await requestOnGeneration(
      generation,
      pending,
      { reqId, type: "CLEAR_LOCAL" } satisfies WorkerRequest,
    );
    return sendInit(generation);
  }
}

async function initializeDocument(): Promise<DocState> {
  let lifecycleRetries = 0;
  while (true) {
    try {
      const generation = await getReadyGeneration();
      return await initializeGenerationWithDataRecovery(generation);
    } catch (error) {
      if (error instanceof WorkerLifecycleError && lifecycleRetries < 1) {
        lifecycleRetries += 1;
        continue;
      }
      throw error;
    }
  }
}

export function initDoc(): Promise<DocState> {
  if (initPromise) return initPromise;
  if (
    lastDocState &&
    activeGeneration?.documentInitialized &&
    !activeGeneration.failed
  ) {
    return Promise.resolve(lastDocState);
  }

  const initialization = initializeDocument().finally(() => {
    if (initPromise === initialization) initPromise = null;
  });
  initPromise = initialization;
  return initialization;
}

/** Binary snapshot of the current doc — used by sync.ts for relay/cloud upload. */
export async function getDocBinary(): Promise<Uint8Array> {
  const reqId = nextReqId++;
  return requestResult(
    pendingDocBinary,
    { reqId, type: "GET_DOC_BINARY" } satisfies WorkerRequest,
  );
}

/**
 * Current document heads for upload-loop accounting (stability P0-03).
 * Null before the first INIT completes.
 */
export async function getDocHeads(): Promise<string[] | null> {
  const reqId = nextReqId++;
  return requestResult(
    pendingDocHeads,
    { reqId, type: "GET_HEADS" } satisfies WorkerRequest,
  );
}

/** Compare incoming Automerge history with the current local document. */
export async function compareDoc(
  incoming: Uint8Array,
): Promise<DocumentHistoryRelation> {
  const reqId = nextReqId++;
  return requestResult(
    pendingDocRelationship,
    {
      reqId,
      type: "COMPARE_DOC",
      binary: incoming,
    } satisfies WorkerRequest,
  );
}

export async function getItemLegacyHtml(globalId: string): Promise<string | null> {
  const reqId = nextReqId++;
  return requestResult(
    pendingLegacyHtml,
    { reqId, type: "GET_ITEM_LEGACY_HTML", globalId } satisfies WorkerRequest,
  );
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
  const reqId = nextReqId++;
  return requestResult(
    pendingSampleDataClear,
    { reqId, type: "CLEAR_SAMPLE_DATA" } satisfies WorkerRequest,
  );
}

export async function docUpdateFeedItem(globalId: string, updates: Partial<FeedItem>): Promise<void> {
  const reqId = nextReqId++;
  return request({ reqId, type: "UPDATE_FEED_ITEM", globalId, updates });
}

export async function docBackfillContentSignals(
  batchSize: number = 200,
): Promise<ContentSignalBackfillSummary> {
  const reqId = nextReqId++;
  return requestResult(
    pendingContentSignalBackfill,
    { reqId, type: "BACKFILL_CONTENT_SIGNALS", batchSize } satisfies WorkerRequest,
  );
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
