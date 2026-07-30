/**
 * Automerge document worker for Freed Desktop
 *
 * Runs ALL WASM operations (A.change, A.save, A.load, A.merge) off the main
 * thread. The main thread only receives plain-JS state updates via postMessage.
 *
 * Desktop additions over the PWA worker:
 *   - UPDATE_RELAY_CLIENT_COUNT: tracks connected PWA clients
 *   - BROADCAST_REQUEST response: posts pre-serialized Array.from(binary) to
 *     the main thread, which calls invoke("broadcast_doc") - Tauri IPC requires
 *     the main thread, so the worker cannot call invoke() directly
 *   - BATCH_REFRESH_FEEDS: bulk feed+items update for the RSS poller
 *   - BATCH_IMPORT_ITEMS: chunked import with IMPORT_PROGRESS events
 *   - HEAL_UNTITLED_FEEDS, DEDUPLICATE_ITEMS: startup migrations
 */

import * as A from "@automerge/automerge";
import type { StorageRevision } from "@freed/sync/types";
import { IndexedDBStorage } from "@freed/sync/storage/indexeddb";
import {
  classifyDocumentLoadFailure,
  RepeatableAutomergePersistence,
  StaleAutomergePersistenceStateError,
  type AutomergePersistenceOptions,
} from "@freed/sync/storage/repeatable-automerge-persistence";
import type { FreedDoc } from "@freed/shared/schema";
import {
  projectFeedItem,
  type FeedItemRow,
} from "@freed/shared/projection";
import {
  assertNonDestructiveMerge,
  compareDocumentHistories,
  createEmptyDoc,
  createDocFromTrustedCompatibilityData,
  addAccount,
  addAccounts,
  backfillContentSignals,
  clearSampleData,
  countContentSignalBackfillItems,
  addFeedItem,
  deduplicateDocFeedItems,
  hasLegacyIdentityGraphData,
  getRegisteredDesktopClientIds,
  migrateLegacyIdentityGraph,
  registerDesktopClient,
  addPerson,
  addRssFeed,
  removeRssFeed,
  removeAllFeeds,
  reconcileYouTubeCapture,
  reconcileFollowRosterCapture,
  reconcileProviderEssayItems,
  updateRssFeed,
  updateFeedItem,
  summarizeDocContentSignals,
  removeFeedItem,
  markAsRead,
  markItemsAsRead,
  toggleSaved,
  toggleArchived,
  archiveItemsById,
  pruneArchivedItems,
  deleteAllArchivedItems,
  updatePreferences,
  updateAccount,
  updatePerson,
  removeAccount,
  removePerson,
  logReachOut,
  toggleLiked,
  confirmLikedSynced,
  confirmSeenSynced,
} from "@freed/shared/schema";
import {
  calculatePriority,
  countAuthorsWithRecentLocationUpdates,
  countFriendsWithRecentLocationUpdates,
  collectSavedYouTubeVideoUrls,
  mergeDefaultPreferences,
  rankFeedItems,
  rankFeedItemsInRecommendedOrder,
  resolveDocumentId,
  stripDeviceLocalPreferenceUpdates,
} from "@freed/shared";
import {
  LIBRARY_CORE_FEED_RECOMMENDATION_ORDER_SCHEMA_VERSION,
  matchesLibraryCoreFeedBrowseFilterV1,
  normalizeLibraryCoreFeedBrowseFilterV1,
  parseLibraryCoreFeedCardV1,
  projectLibraryCoreFeedCardV1,
  type LibraryCoreFeedBrowseFilterV1,
} from "@freed/shared/library-core";
import type {
  Account,
  DesktopClientRegistration,
  FeedItem,
  Friend,
  LegacyDeviceContact,
  LegacyFriendSource,
  Person,
  RssFeed,
  UserPreferences,
} from "@freed/shared";
import type {
  DocState,
  FeedItemPatch,
  LibraryCoreExternalSnapshotV1,
  LibraryCoreFeedBrowseGenerationBindingV1,
  LibraryCoreFeedBrowseProjectedRowV1,
  LibraryCoreFeedBrowseProjectionBatchV1,
  LibraryCoreProjectionBatchV1,
  LibraryCoreProjectionSourceV1,
  RssFeedPatch,
  RssFeedRefreshUpdate,
  WorkerErrorCode,
  WorkerRequest,
  WorkerResponse,
} from "./automerge-types";
import {
  createFeedTextCompactionSummary,
  compactFeedItemTextForSync,
  compactFeedItemsTextForSync,
  formatFeedTextCompactionSummary,
} from "./feed-text-compaction";

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

const storage = new IndexedDBStorage();
let persistence = new RepeatableAutomergePersistence(storage);
let currentDoc: FreedDoc | null = null;
let currentBinary: Uint8Array | null = null;
let relayClientCount = 0;
let activeDesktopClientRegistration: DesktopClientRegistration | null = null;
let queuedRequestCount = 0;
let requestChain: Promise<void> = Promise.resolve();
let acceptingRequests = true;
const MAX_LIBRARY_CORE_PROJECTION_SESSION_ID_BYTES = 128;
const MAX_LIBRARY_CORE_PROJECTION_BATCH_ROWS = 1_000;
const MAX_LIBRARY_CORE_PROJECTION_BATCH_BYTES = 4 * 1_048_576;
const LIBRARY_CORE_PROJECTION_ENVELOPE_RESERVE_BYTES = 64 * 1_024;
const MAX_LIBRARY_CORE_PROJECTION_INDEX_ENTRIES = 250_000;
const MAX_LIBRARY_CORE_PROJECTION_INDEX_BYTES = 16 * 1_048_576;
const MAX_LIBRARY_CORE_PROJECTION_ENTITY_ID_BYTES = 4_096;
const MAX_LIBRARY_CORE_EXTERNAL_EXPORT_CHUNK_BYTES = 1_048_576;
const MAX_LIBRARY_CORE_FEED_BROWSE_ROWS = 250_000;
const MAX_LIBRARY_CORE_FEED_BROWSE_BATCH_ROWS = 128;
const LIBRARY_CORE_FEED_BROWSE_SOURCE_DOMAIN =
  "freed-desktop-library-core-feed-browse-generation-v1";

interface LibraryCoreProjectionSession {
  readonly sessionId: string;
  readonly source: LibraryCoreProjectionSourceV1;
  itemIds: string[];
  readonly totalRows: number;
  nextOffset: number;
  nextBatchIndex: number;
  lastBatch: LibraryCoreProjectionBatchV1 | null;
  completed: boolean;
}

let libraryCoreProjectionSession: LibraryCoreProjectionSession | null = null;

interface LibraryCoreFeedBrowseProjectionEntry {
  readonly globalId: string;
  readonly item: FeedItem;
}

interface LibraryCoreFeedBrowseProjectionSession {
  readonly sessionId: string;
  readonly source: LibraryCoreProjectionSourceV1;
  readonly binding: LibraryCoreFeedBrowseGenerationBindingV1;
  readonly filter: LibraryCoreFeedBrowseFilterV1;
  readonly iterator: Generator<
    LibraryCoreFeedBrowseProjectionEntry,
    void,
    undefined
  >;
  readonly preferences: ReturnType<typeof mergeDefaultPreferences>;
  readonly priorityContext: {
    readonly accounts: FreedDoc["accounts"];
    readonly persons: FreedDoc["persons"];
    readonly personByAuthorKey: Map<
      string,
      FreedDoc["persons"][string] | null
    >;
  };
  nextSourceSequence: number;
  nextBatchIndex: number;
  projectedRows: number;
  lastBatch: LibraryCoreFeedBrowseProjectionBatchV1 | null;
  completed: boolean;
}

let libraryCoreFeedBrowseProjectionSession:
  | LibraryCoreFeedBrowseProjectionSession
  | null = null;

interface LibraryCoreExternalExportSession {
  readonly sessionId: string;
  readonly source: LibraryCoreExternalSnapshotV1;
  readonly bytes: Uint8Array;
}

let libraryCoreExternalExportSession: LibraryCoreExternalExportSession | null =
  null;
let searchCorpusVersion = 0;
let linkPreviewUrlCounts = new Map<string, number>();
let lastCommittedItemCount = 0;
let lastCommittedFriendCount = 0;
let persistenceFailure: Error | null = null;
let corruptStorageRevision: StorageRevision | null = null;

const SLOW_QUEUE_WAIT_MS = 1_000;
const SLOW_REQUEST_PROCESS_MS = 5_000;
const SLOW_SAVE_AND_BROADCAST_MS = 2_000;
const DESKTOP_UI_PRESERVED_TEXT_LIMIT = 0;
const DESKTOP_UI_CONTENT_TEXT_LIMIT = 280;
const DESKTOP_UI_LINK_DESCRIPTION_LIMIT = 180;
const DESKTOP_UI_EVENT_EVIDENCE_LIMIT = 220;
const FRESH_DOC_REBUILD_MIN_CHANGED_BINARY_BYTES = 4 * 1024 * 1024;

interface RequestTrace {
  reqId: number;
  opType: WorkerRequest["type"];
  enqueuedAt: number;
  startedAt: number;
  queuedBeforeStart: number;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function send(msg: WorkerResponse): void {
  self.postMessage(msg);
}

function sendTransferred(
  msg: WorkerResponse,
  transfer: Transferable[],
): void {
  self.postMessage(msg, { transfer });
}

class CorruptDocumentError extends Error {
  readonly code: WorkerErrorCode = "CORRUPT_DOCUMENT";

  constructor() {
    super("The stored Automerge document could not be loaded");
    this.name = "CorruptDocumentError";
  }
}

class DocumentLoadFailedError extends Error {
  readonly code: WorkerErrorCode = "DOCUMENT_LOAD_FAILED";

  constructor(byteLength: number, cause: unknown) {
    const detail = cause instanceof Error ? cause.message : String(cause);
    super(
      `Loading the stored Automerge document failed at ${byteLength.toLocaleString()} bytes: ${detail}`,
    );
    this.name = "DocumentLoadFailedError";
    this.cause = cause;
  }
}

class AutomergePersistenceError extends Error {
  readonly code: WorkerErrorCode = "AUTOMERGE_PERSISTENCE_FAILED";

  constructor(cause: unknown) {
    super(
      cause instanceof Error
        ? cause.message
        : `Automerge persistence failed: ${String(cause)}`,
    );
    this.name = "AutomergePersistenceError";
    this.cause = cause;
  }
}

function ack(reqId: number, error?: string, errorCode?: WorkerErrorCode): void {
  send({
    reqId,
    type: "ACK",
    ...(error ? { error } : {}),
    ...(errorCode ? { errorCode } : {}),
  });
}

const projectionTextEncoder = new TextEncoder();

function validateProjectionSessionId(sessionId: string): void {
  const byteLength = projectionTextEncoder.encode(sessionId).byteLength;
  if (
    byteLength === 0 ||
    byteLength > MAX_LIBRARY_CORE_PROJECTION_SESSION_ID_BYTES
  ) {
    throw new Error(
      `Library Core projection session ID must contain 1 through ${MAX_LIBRARY_CORE_PROJECTION_SESSION_ID_BYTES.toLocaleString()} UTF-8 bytes`,
    );
  }
}

function validateExternalExportSessionId(sessionId: string): void {
  const byteLength = projectionTextEncoder.encode(sessionId).byteLength;
  if (
    byteLength === 0 ||
    byteLength > MAX_LIBRARY_CORE_PROJECTION_SESSION_ID_BYTES
  ) {
    throw new Error(
      `Library Core external export session ID must contain 1 through ${MAX_LIBRARY_CORE_PROJECTION_SESSION_ID_BYTES.toLocaleString()} UTF-8 bytes`,
    );
  }
}

function sameStorageRevision(
  left: StorageRevision,
  right: StorageRevision,
): boolean {
  return (
    left.generation === right.generation &&
    left.saveRevision === right.saveRevision
  );
}

async function requireCurrentExternalExport(
  sessionId: string,
): Promise<LibraryCoreExternalExportSession> {
  validateExternalExportSessionId(sessionId);
  const session = libraryCoreExternalExportSession;
  if (!session || session.sessionId !== sessionId) {
    throw new Error("Library Core external export session is not active");
  }
  const currentRevision = await storage.currentRevision();
  if (!sameStorageRevision(currentRevision, session.source.storageRevision)) {
    libraryCoreExternalExportSession = null;
    throw new Error("Library Core external export source changed");
  }
  return session;
}

async function startLibraryCoreExternalExport(
  sessionId: string,
): Promise<LibraryCoreExternalExportSession> {
  validateExternalExportSessionId(sessionId);
  if (currentDoc || currentBinary) {
    throw new Error(
      "Library Core external export must begin before Automerge is loaded",
    );
  }
  if (libraryCoreProjectionSession && !libraryCoreProjectionSession.completed) {
    throw new Error(
      `Library Core projection session ${libraryCoreProjectionSession.sessionId} is already active`,
    );
  }
  if (
    libraryCoreFeedBrowseProjectionSession &&
    !libraryCoreFeedBrowseProjectionSession.completed
  ) {
    throw new Error(
      `Library Core browse projection session ${libraryCoreFeedBrowseProjectionSession.sessionId} is already active`,
    );
  }
  const active = libraryCoreExternalExportSession;
  if (active) {
    if (active.sessionId !== sessionId) {
      throw new Error(
        `Library Core external export session ${active.sessionId} is already active`,
      );
    }
    return requireCurrentExternalExport(sessionId);
  }

  const snapshot = await storage.loadRawSnapshotForExternalMigration();
  const bytes = snapshot.data ?? new Uint8Array(0);
  const session: LibraryCoreExternalExportSession = {
    sessionId,
    source: {
      schemaVersion: 1,
      storageRevision: { ...snapshot.revision },
      byteLength: bytes.byteLength,
    },
    bytes,
  };
  libraryCoreExternalExportSession = session;
  return session;
}

async function readLibraryCoreExternalExportChunk(
  sessionId: string,
  offset: number,
): Promise<{
  session: LibraryCoreExternalExportSession;
  bytes: Uint8Array;
  nextOffset: number;
  done: boolean;
}> {
  if (!Number.isSafeInteger(offset) || offset < 0) {
    throw new Error("Library Core external export offset is invalid");
  }
  const session = await requireCurrentExternalExport(sessionId);
  if (offset > session.source.byteLength) {
    throw new Error("Library Core external export offset exceeds its source");
  }
  const nextOffset = Math.min(
    offset + MAX_LIBRARY_CORE_EXTERNAL_EXPORT_CHUNK_BYTES,
    session.source.byteLength,
  );
  return {
    session,
    bytes: session.bytes.slice(offset, nextOffset),
    nextOffset,
    done: nextOffset === session.source.byteLength,
  };
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    Uint8Array.from(bytes).buffer,
  );
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

async function projectionHeadsDigest(heads: readonly string[]): Promise<string> {
  const canonicalHeads = [...heads].sort();
  return sha256Hex(
    projectionTextEncoder.encode(
      ["library-core-projection-heads-v1", ...canonicalHeads].join("\n"),
    ),
  );
}

async function currentProjectionSource(
  doc: FreedDoc,
): Promise<LibraryCoreProjectionSourceV1> {
  const snapshot = persistence.snapshot();
  if (!snapshot.bytes) throw new Error("Document not initialized");

  const documentId = resolveDocumentId(doc.meta);
  if (
    projectionTextEncoder.encode(documentId).byteLength >
    MAX_LIBRARY_CORE_PROJECTION_SESSION_ID_BYTES * 32
  ) {
    throw new Error("Library Core projection document ID exceeds 4,096 bytes");
  }

  const heads = A.getHeads(doc);
  const [headsDigest, durableHeadsDigest] = await Promise.all([
    projectionHeadsDigest(heads),
    projectionHeadsDigest(snapshot.heads),
  ]);
  if (headsDigest !== durableHeadsDigest) {
    throw new Error(
      "Library Core projection source is not the exact durable Automerge revision",
    );
  }

  return {
    schemaVersion: 1,
    documentId,
    headsDigest,
    headCount: heads.length,
    storageRevision: { ...snapshot.revision },
  };
}

function sameProjectionSource(
  left: LibraryCoreProjectionSourceV1,
  right: LibraryCoreProjectionSourceV1,
): boolean {
  return (
    left.schemaVersion === right.schemaVersion &&
    left.documentId === right.documentId &&
    left.headsDigest === right.headsDigest &&
    left.headCount === right.headCount &&
    left.storageRevision.generation === right.storageRevision.generation &&
    left.storageRevision.saveRevision === right.storageRevision.saveRevision
  );
}

async function startLibraryCoreProjection(
  sessionId: string,
): Promise<LibraryCoreProjectionSession> {
  validateProjectionSessionId(sessionId);
  if (
    libraryCoreFeedBrowseProjectionSession &&
    !libraryCoreFeedBrowseProjectionSession.completed
  ) {
    throw new Error(
      `Library Core browse projection session ${libraryCoreFeedBrowseProjectionSession.sessionId} is already active`,
    );
  }
  const doc = ensureCurrentDocLoaded("BEGIN_LIBRARY_CORE_PROJECTION");
  const source = await currentProjectionSource(doc);
  const active = libraryCoreProjectionSession;
  if (active && active.sessionId === sessionId) {
    if (!sameProjectionSource(active.source, source)) {
      libraryCoreProjectionSession = null;
      throw new Error("Library Core projection source changed");
    }
    return active;
  }
  if (active && !active.completed) {
    throw new Error(
      `Library Core projection session ${active.sessionId} is already active`,
    );
  }

  const itemIds: string[] = [];
  let indexBytes = 0;
  for (const globalId in doc.feedItems ?? {}) {
    if (!Object.prototype.hasOwnProperty.call(doc.feedItems, globalId)) continue;
    if (itemIds.length >= MAX_LIBRARY_CORE_PROJECTION_INDEX_ENTRIES) {
      throw new Error(
        `Library Core projection index exceeds ${MAX_LIBRARY_CORE_PROJECTION_INDEX_ENTRIES.toLocaleString()} entries`,
      );
    }
    const globalIdBytes = projectionTextEncoder.encode(globalId).byteLength;
    if (
      globalIdBytes === 0 ||
      globalIdBytes > MAX_LIBRARY_CORE_PROJECTION_ENTITY_ID_BYTES
    ) {
      throw new Error(
        "Library Core projection encountered an invalid entity ID",
      );
    }
    indexBytes += globalIdBytes;
    if (indexBytes > MAX_LIBRARY_CORE_PROJECTION_INDEX_BYTES) {
      throw new Error(
        `Library Core projection index exceeds ${MAX_LIBRARY_CORE_PROJECTION_INDEX_BYTES.toLocaleString()} bytes`,
      );
    }
    itemIds.push(globalId);
  }
  itemIds.sort();
  const session: LibraryCoreProjectionSession = {
    sessionId,
    source,
    itemIds,
    totalRows: itemIds.length,
    nextOffset: 0,
    nextBatchIndex: 0,
    lastBatch: null,
    completed: false,
  };
  libraryCoreProjectionSession = session;
  return session;
}

async function nextLibraryCoreProjectionBatch(
  sessionId: string,
  batchIndex: number,
): Promise<LibraryCoreProjectionBatchV1> {
  validateProjectionSessionId(sessionId);
  if (!Number.isSafeInteger(batchIndex) || batchIndex < 0) {
    throw new Error("Library Core projection batch index is invalid");
  }

  const session = libraryCoreProjectionSession;
  if (!session || session.sessionId !== sessionId) {
    throw new Error("Library Core projection session is not active");
  }
  if (session.lastBatch?.batchIndex === batchIndex) {
    return session.lastBatch;
  }
  if (session.completed || batchIndex !== session.nextBatchIndex) {
    throw new Error(
      `Library Core projection expected batch ${session.nextBatchIndex.toLocaleString()}`,
    );
  }

  const doc = ensureCurrentDocLoaded("NEXT_LIBRARY_CORE_PROJECTION_BATCH");
  const source = await currentProjectionSource(doc);
  if (!sameProjectionSource(session.source, source)) {
    libraryCoreProjectionSession = null;
    throw new Error("Library Core projection source changed");
  }

  const maximumRowBytes =
    MAX_LIBRARY_CORE_PROJECTION_BATCH_BYTES -
    LIBRARY_CORE_PROJECTION_ENVELOPE_RESERVE_BYTES;
  const rows: FeedItemRow[] = [];
  let rowBytes = 0;
  let nextOffset = session.nextOffset;
  while (
    nextOffset < session.totalRows &&
    rows.length < MAX_LIBRARY_CORE_PROJECTION_BATCH_ROWS
  ) {
    const globalId = session.itemIds[nextOffset];
    const item = doc.feedItems[globalId] as FeedItem | undefined;
    if (!item) {
      libraryCoreProjectionSession = null;
      throw new Error(
        `Library Core projection source lost item ${globalId}`,
      );
    }
    const row = projectFeedItem(item);
    const encoded = JSON.stringify(row);
    if (encoded === undefined) {
      throw new Error(
        `Library Core projection could not encode item ${globalId}`,
      );
    }
    const encodedBytes = projectionTextEncoder.encode(encoded).byteLength;
    const nextRowBytes =
      rowBytes + encodedBytes + (rows.length === 0 ? 0 : 1);
    if (nextRowBytes > maximumRowBytes) {
      if (rows.length === 0) {
        libraryCoreProjectionSession = null;
        throw new Error(
          `Library Core projection item ${globalId} exceeds the ${maximumRowBytes.toLocaleString()} byte batch row budget`,
        );
      }
      break;
    }
    rows.push(row);
    rowBytes = nextRowBytes;
    nextOffset += 1;
  }

  const done = nextOffset === session.totalRows;
  const batch: LibraryCoreProjectionBatchV1 = {
    sessionId,
    source: session.source,
    batchIndex,
    rows,
    rowBytes,
    projectedRows: nextOffset,
    totalRows: session.totalRows,
    done,
  };
  session.nextOffset = nextOffset;
  session.nextBatchIndex += 1;
  session.lastBatch = batch;
  session.completed = done;
  if (done) session.itemIds = [];
  return batch;
}

function* libraryCoreFeedBrowseEntries(
  feedItems: FreedDoc["feedItems"],
): Generator<LibraryCoreFeedBrowseProjectionEntry, void, undefined> {
  for (const globalId in feedItems) {
    if (!Object.prototype.hasOwnProperty.call(feedItems, globalId)) continue;
    const item = feedItems[globalId];
    if (
      typeof item !== "object" ||
      item === null ||
      Array.isArray(item) ||
      item.globalId !== globalId
    ) {
      throw new TypeError(
        "committed Automerge feed item identity does not match its map key",
      );
    }
    yield { globalId, item };
  }
}

function sameLibraryCoreFeedBrowseBinding(
  left: LibraryCoreFeedBrowseGenerationBindingV1,
  right: LibraryCoreFeedBrowseGenerationBindingV1,
): boolean {
  return (
    left.generationId === right.generationId &&
    left.transitionSequence === right.transitionSequence &&
    left.projectionRevision === right.projectionRevision &&
    left.filterJson === right.filterJson &&
    left.rankingClockMs === right.rankingClockMs &&
    left.recommendationOrderSchemaVersion ===
      right.recommendationOrderSchemaVersion &&
    left.totalRows === right.totalRows
  );
}

function buildLibraryCoreFeedBrowsePriorityContext(
  doc: FreedDoc,
): LibraryCoreFeedBrowseProjectionSession["priorityContext"] {
  const personByAuthorKey = new Map<
    string,
    FreedDoc["persons"][string] | null
  >();
  for (const accountId in doc.accounts) {
    if (!Object.prototype.hasOwnProperty.call(doc.accounts, accountId)) {
      continue;
    }
    const account = doc.accounts[accountId];
    if (account.kind !== "social") continue;
    personByAuthorKey.set(
      `${account.provider}:${account.externalId}`,
      account.personId ? doc.persons[account.personId] ?? null : null,
    );
  }
  return {
    accounts: doc.accounts,
    persons: doc.persons,
    personByAuthorKey,
  };
}

async function startLibraryCoreFeedBrowseProjection(
  sessionId: string,
  filterInput: Parameters<
    typeof normalizeLibraryCoreFeedBrowseFilterV1
  >[0],
  rankingClockMs: number,
): Promise<LibraryCoreFeedBrowseProjectionSession> {
  validateProjectionSessionId(sessionId);
  if (!Number.isSafeInteger(rankingClockMs) || rankingClockMs < 0) {
    throw new Error("Library Core browse ranking clock is invalid");
  }
  if (
    libraryCoreProjectionSession &&
    !libraryCoreProjectionSession.completed
  ) {
    throw new Error(
      `Library Core projection session ${libraryCoreProjectionSession.sessionId} is already active`,
    );
  }
  const doc = ensureCurrentDocLoaded(
    "BEGIN_LIBRARY_CORE_FEED_BROWSE_PROJECTION",
  );
  const source = await currentProjectionSource(doc);
  const filter = normalizeLibraryCoreFeedBrowseFilterV1(filterInput);
  const filterJson = JSON.stringify(filter);
  let totalRows = 0;
  for (const { item } of libraryCoreFeedBrowseEntries(doc.feedItems)) {
    if (!matchesLibraryCoreFeedBrowseFilterV1(item, filter)) continue;
    totalRows += 1;
    if (totalRows > MAX_LIBRARY_CORE_FEED_BROWSE_ROWS) {
      throw new Error(
        `Library Core browse projection exceeds ${MAX_LIBRARY_CORE_FEED_BROWSE_ROWS.toLocaleString()} rows`,
      );
    }
  }
  const generationId = await sha256Hex(
    projectionTextEncoder.encode(
      JSON.stringify({
        domain: LIBRARY_CORE_FEED_BROWSE_SOURCE_DOMAIN,
        documentId: source.documentId,
        filter,
        headCount: source.headCount,
        headsDigest: source.headsDigest,
        projectionRevision: source.storageRevision.saveRevision,
        rankingClockMs,
        recommendationOrderSchemaVersion:
          LIBRARY_CORE_FEED_RECOMMENDATION_ORDER_SCHEMA_VERSION,
        transitionSequence: source.storageRevision.generation,
      }),
    ),
  );
  const binding: LibraryCoreFeedBrowseGenerationBindingV1 = {
    generationId,
    transitionSequence: source.storageRevision.generation,
    projectionRevision: source.storageRevision.saveRevision,
    filterJson,
    rankingClockMs,
    recommendationOrderSchemaVersion:
      LIBRARY_CORE_FEED_RECOMMENDATION_ORDER_SCHEMA_VERSION,
    totalRows,
  };
  const active = libraryCoreFeedBrowseProjectionSession;
  if (active && active.sessionId === sessionId) {
    if (
      !sameProjectionSource(active.source, source) ||
      !sameLibraryCoreFeedBrowseBinding(active.binding, binding)
    ) {
      libraryCoreFeedBrowseProjectionSession = null;
      throw new Error("Library Core browse projection source changed");
    }
    return active;
  }
  if (active && !active.completed) {
    throw new Error(
      `Library Core browse projection session ${active.sessionId} is already active`,
    );
  }

  const session: LibraryCoreFeedBrowseProjectionSession = {
    sessionId,
    source,
    binding,
    filter,
    iterator: libraryCoreFeedBrowseEntries(doc.feedItems),
    preferences: mergeDefaultPreferences(doc.preferences),
    priorityContext: buildLibraryCoreFeedBrowsePriorityContext(doc),
    nextSourceSequence: 0,
    nextBatchIndex: 0,
    projectedRows: 0,
    lastBatch: null,
    completed: false,
  };
  libraryCoreFeedBrowseProjectionSession = session;
  return session;
}

async function nextLibraryCoreFeedBrowseProjectionBatch(
  sessionId: string,
  batchIndex: number,
): Promise<LibraryCoreFeedBrowseProjectionBatchV1> {
  validateProjectionSessionId(sessionId);
  if (!Number.isSafeInteger(batchIndex) || batchIndex < 0) {
    throw new Error("Library Core browse projection batch index is invalid");
  }
  const session = libraryCoreFeedBrowseProjectionSession;
  if (!session || session.sessionId !== sessionId) {
    throw new Error("Library Core browse projection session is not active");
  }
  if (session.lastBatch?.batchIndex === batchIndex) {
    return session.lastBatch;
  }
  if (session.completed || batchIndex !== session.nextBatchIndex) {
    throw new Error(
      `Library Core browse projection expected batch ${session.nextBatchIndex.toLocaleString()}`,
    );
  }
  const doc = ensureCurrentDocLoaded(
    "NEXT_LIBRARY_CORE_FEED_BROWSE_PROJECTION_BATCH",
  );
  const source = await currentProjectionSource(doc);
  if (!sameProjectionSource(session.source, source)) {
    libraryCoreFeedBrowseProjectionSession = null;
    throw new Error("Library Core browse projection source changed");
  }

  const rows: LibraryCoreFeedBrowseProjectedRowV1[] = [];
  let done = false;
  while (rows.length < MAX_LIBRARY_CORE_FEED_BROWSE_BATCH_ROWS) {
    const next = session.iterator.next();
    if (next.done) {
      done = true;
      break;
    }
    const sourceSequence = session.nextSourceSequence;
    session.nextSourceSequence += 1;
    if (!Number.isSafeInteger(session.nextSourceSequence)) {
      libraryCoreFeedBrowseProjectionSession = null;
      throw new Error("Library Core browse source sequence is invalid");
    }
    if (!matchesLibraryCoreFeedBrowseFilterV1(next.value.item, session.filter)) {
      continue;
    }
    const parsedCard = parseLibraryCoreFeedCardV1(
      projectLibraryCoreFeedCardV1(next.value.item),
    );
    if (!parsedCard.ok) {
      libraryCoreFeedBrowseProjectionSession = null;
      throw new Error(parsedCard.error);
    }
    const card = parsedCard.value;
    rows.push({
      priority: calculatePriority(
        next.value.item,
        session.preferences.weights,
        session.binding.rankingClockMs,
        session.priorityContext,
      ),
      publishedAt: card.publishedAt ?? 0,
      sourceSequence,
      globalId: next.value.globalId,
      cardJson: JSON.stringify(card),
    });
  }
  session.projectedRows += rows.length;
  if (
    session.projectedRows > session.binding.totalRows ||
    (done && session.projectedRows !== session.binding.totalRows)
  ) {
    libraryCoreFeedBrowseProjectionSession = null;
    throw new Error("Library Core browse projection row count changed");
  }
  const batch: LibraryCoreFeedBrowseProjectionBatchV1 = {
    sessionId,
    binding: session.binding,
    batchIndex,
    rows,
    projectedRows: session.projectedRows,
    done,
  };
  session.nextBatchIndex += 1;
  session.lastBatch = batch;
  session.completed = done;
  return batch;
}

function itemLinkPreviewUrl(item: FeedItem | undefined): string | null {
  const url = item?.content.linkPreview?.url;
  return typeof url === "string" && url.length > 0 ? url : null;
}

function addKnownLinkPreviewUrl(item: FeedItem | undefined): void {
  const url = itemLinkPreviewUrl(item);
  if (!url) return;
  linkPreviewUrlCounts.set(url, (linkPreviewUrlCounts.get(url) ?? 0) + 1);
}

function rebuildKnownLinkPreviewUrls(doc: FreedDoc | null): void {
  linkPreviewUrlCounts = new Map();
  if (!doc) return;
  for (const item of Object.values(doc.feedItems ?? {}) as FeedItem[]) {
    addKnownLinkPreviewUrl(item);
  }
}

function isAuthenticatedEssayArticle(item: FeedItem): boolean {
  return (
    item.contentType === "article" &&
    (item.platform === "substack" || item.platform === "medium")
  );
}

function readerTextLength(item: FeedItem): number {
  return Math.max(
    item.content.text?.length ?? 0,
    item.preservedContent?.text.length ?? 0,
  );
}

function shouldMergeEssayRssItem(
  existing: FeedItem,
  incoming: FeedItem,
): boolean {
  if (!isAuthenticatedEssayArticle(incoming)) return false;
  if (
    existing.platform !== incoming.platform ||
    existing.contentType !== "article"
  )
    return true;
  if (!existing.rssSource) return true;
  if (readerTextLength(incoming) > readerTextLength(existing)) return true;
  if (
    incoming.content.mediaUrls.some(
      (url) => !existing.content.mediaUrls.includes(url),
    )
  )
    return true;
  const existingPreview = existing.content.linkPreview;
  const incomingPreview = incoming.content.linkPreview;
  return Boolean(
    incomingPreview &&
    (!existingPreview ||
      (incomingPreview.title?.length ?? 0) >
        (existingPreview.title?.length ?? 0) ||
      (incomingPreview.description?.length ?? 0) >
        (existingPreview.description?.length ?? 0)),
  );
}

function toLegacyContact(account: Account): LegacyDeviceContact {
  const importedFrom: LegacyDeviceContact["importedFrom"] =
    account.provider === "google_contacts"
      ? "google"
      : account.provider === "macos_contacts"
        ? "macos"
        : account.provider === "ios_contacts"
          ? "ios"
          : account.provider === "android_contacts"
            ? "android"
            : "web";
  return {
    importedFrom,
    name: account.displayName ?? account.externalId,
    phone: account.phone,
    email: account.email,
    address: account.address,
    nativeId: account.externalId,
    importedAt: account.importedAt ?? account.createdAt,
  };
}

function projectLegacyFriends(
  persons: Record<string, Person>,
  accounts: Record<string, Account>,
): Record<string, Friend> {
  const accountsByPerson = new Map<string, Account[]>();
  for (const account of Object.values(accounts)) {
    if (!account.personId) continue;
    const group = accountsByPerson.get(account.personId);
    if (group) {
      group.push(account);
    } else {
      accountsByPerson.set(account.personId, [account]);
    }
  }

  return Object.fromEntries(
    Object.values(persons).map((person) => {
      const personAccounts = accountsByPerson.get(person.id) ?? [];
      const sources: LegacyFriendSource[] = personAccounts
        .filter((account) => account.kind === "social")
        .map((account) => ({
          platform: account.provider as LegacyFriendSource["platform"],
          authorId: account.externalId,
          handle: account.handle,
          displayName: account.displayName,
          avatarUrl: account.avatarUrl,
          profileUrl: account.profileUrl,
        }));
      const contactAccount = personAccounts.find(
        (account) => account.kind === "contact",
      );
      return [
        person.id,
        {
          ...person,
          sources,
          contact: contactAccount ? toLegacyContact(contactAccount) : undefined,
        },
      ];
    }),
  );
}

function formatMs(ms: number): string {
  return Math.round(ms).toLocaleString();
}

function emitWorkerTrace(
  detail: string,
  kind: Extract<WorkerResponse, { type: "DEBUG_EVENT" }>["kind"] = "change",
): void {
  send({ type: "DEBUG_EVENT", kind, detail });
}

function bumpSearchCorpusVersion(): void {
  searchCorpusVersion += 1;
}

/**
 * Heads as of the last save/load, answered by GET_HEADS without forcing a
 * full A.load when the document is idle-unloaded (an unloaded doc cannot
 * have diverged from its last save). Null until the first INIT.
 */
let lastSavedHeads: string[] | null = null;

function refreshLastSavedHeads(doc: FreedDoc | null): void {
  try {
    lastSavedHeads = doc ? A.getHeads(doc) : null;
  } catch {
    lastSavedHeads = null;
  }
}

function cancelDocIdleUnload(): void {
  // Kept as a named lifecycle hook so request startup documents the intent.
}

function scheduleDocIdleUnload(): void {
  if (!currentDoc || !currentBinary || queuedRequestCount > 0) return;
  currentDoc = null;
  emitWorkerTrace(
    "[automerge-worker] released idle document after request queue drained",
    "change",
  );
}

function ensureCurrentDocLoaded(reason: WorkerRequest["type"]): FreedDoc {
  if (currentDoc) return currentDoc;
  if (!currentBinary) throw new Error("Document not initialized");

  const startedAt = performance.now();
  currentDoc = A.load<FreedDoc>(currentBinary);
  rebuildKnownLinkPreviewUrls(currentDoc);
  emitWorkerTrace(
    `[automerge-worker] reloaded idle document op=${reason}` +
      ` load_ms=${formatMs(performance.now() - startedAt)}` +
      ` bytes=${currentBinary.byteLength.toLocaleString()}`,
    "change",
  );
  return currentDoc;
}

function migrateLoadedIdentityGraph(
  source: FreedDoc,
  message: string,
): { doc: FreedDoc; changed: boolean } {
  if (!hasLegacyIdentityGraphData(source)) {
    return { doc: source, changed: false };
  }
  const doc = A.change(source, message, (draft) => {
    migrateLegacyIdentityGraph(draft);
  });
  return { doc, changed: true };
}

interface FeedTextCompactionResult {
  doc: FreedDoc;
  changed: boolean;
  rebuiltHistory: boolean;
  debugDetail: string | null;
}

function compactLoadedFeedText(
  source: FreedDoc,
  message: string,
  options: { rebuildHistory?: boolean; previousBinaryBytes?: number } = {},
): FeedTextCompactionResult {
  let summary = createFeedTextCompactionSummary();
  let doc = A.change(source, message, (draft) => {
    summary = compactFeedItemsTextForSync(
      Object.values(draft.feedItems) as FeedItem[],
    );
  });
  let debugDetail: string | null =
    summary.changed > 0
      ? `[automerge-worker] ${message}: ${formatFeedTextCompactionSummary(summary)}`
      : null;

  const previousBinaryBytes =
    options.previousBinaryBytes ?? currentBinary?.byteLength ?? 0;
  const shouldRebuildForChangedText =
    options.rebuildHistory === true &&
    summary.changed > 0 &&
    previousBinaryBytes >= FRESH_DOC_REBUILD_MIN_CHANGED_BINARY_BYTES;
  if (!shouldRebuildForChangedText) {
    return {
      doc,
      changed: summary.changed > 0,
      rebuiltHistory: false,
      debugDetail,
    };
  }

  const plain = A.toJS(doc) as Partial<FreedDoc>;
  doc = createDocFromTrustedCompatibilityData(plain);
  const rebuiltBytes = A.save(doc).byteLength;
  debugDetail =
    `[automerge-worker] rebuilt compacted document` +
    ` previous_bytes=${previousBinaryBytes.toLocaleString()}` +
    ` rebuilt_bytes=${rebuiltBytes.toLocaleString()}` +
    ` saved_bytes=${Math.max(0, previousBinaryBytes - rebuiltBytes).toLocaleString()}`;
  return {
    doc,
    changed: true,
    rebuiltHistory: true,
    debugDetail,
  };
}

/*
 * Candidate preparation is deliberately side-effect free. The caller installs
 * the resulting document and emits its diagnostics only after the storage CAS
 * commits.
 */
function prepareLoadedDocument(
  source: FreedDoc,
  identityMessage: string,
  compactionMessage: string,
  options: { rebuildHistory?: boolean; previousBinaryBytes?: number } = {},
): {
  doc: FreedDoc;
  changed: boolean;
  identityMigrated: boolean;
  compaction: FeedTextCompactionResult;
} {
  const identity = migrateLoadedIdentityGraph(source, identityMessage);
  const compaction = compactLoadedFeedText(
    identity.doc,
    compactionMessage,
    options,
  );
  return {
    doc: compaction.doc,
    changed: identity.changed || compaction.changed,
    identityMigrated: identity.changed,
    compaction,
  };
}

function feedItemUpdatesAffectSearchCorpus(
  updates: Partial<FeedItem>,
): boolean {
  if (
    "author" in updates ||
    "contentSignals" in updates ||
    "eventCandidate" in updates ||
    "content" in updates ||
    "contentType" in updates ||
    "location" in updates ||
    "timeRange" in updates ||
    "preservedContent" in updates ||
    "publishedAt" in updates ||
    "rssSource" in updates ||
    "topics" in updates
  ) {
    return true;
  }

  if (!updates.userState) return false;
  return (
    "hidden" in updates.userState ||
    "tags" in updates.userState ||
    "highlights" in updates.userState
  );
}

function cloneFeedItemForPatch(item: FeedItem): FeedItem {
  return trimFeedItemForDesktopUi(item);
}

function cloneRssFeedForPatch(feed: RssFeed): RssFeed {
  return JSON.parse(JSON.stringify(feed)) as RssFeed;
}

function findRssFeedByUrl(
  feeds: Record<string, RssFeed>,
  url: string,
): RssFeed | undefined {
  return Object.values(feeds).find((feed) => feed.url === url);
}

function rssFeedPatchRecord(
  url: string,
  feed: RssFeed | undefined,
): Record<string, RssFeed> {
  return feed
    ? (Object.fromEntries([[url, cloneRssFeedForPatch(feed)]]) as Record<
        string,
        RssFeed
      >)
    : {};
}

function cloneRecordValues<T>(
  record: Record<string, T> | undefined,
): Record<string, T> {
  const cloned: Record<string, T> = {};
  for (const [key, value] of Object.entries(record ?? {})) {
    cloned[key] = JSON.parse(JSON.stringify(value)) as T;
  }
  return cloned;
}

function cloneFeedItemsForDesktopUi(
  record: Record<string, FeedItem> | undefined,
): {
  items: FeedItem[];
  totalCount: number;
} {
  const items: FeedItem[] = [];
  let totalCount = 0;

  for (const item of Object.values(record ?? {})) {
    totalCount++;
    items.push(cloneFeedItemForPatch(item));
  }

  return { items, totalCount };
}

function trimFeedItemForDesktopUi(item: FeedItem): FeedItem {
  const contentText = item.content.text;
  const linkPreview = item.content.linkPreview;
  const linkDescription = linkPreview?.description;
  const preservedContent = item.preservedContent;
  const preservedText = preservedContent?.text;
  const eventCandidate = item.eventCandidate;
  const eventEvidence = eventCandidate?.evidence;
  const tags = item.contentSignals?.tags ?? [];

  return {
    globalId: item.globalId,
    platform: item.platform,
    contentType: item.contentType,
    capturedAt: item.capturedAt,
    publishedAt: item.publishedAt,
    author: { ...item.author },
    content: {
      text: contentText?.slice(0, DESKTOP_UI_CONTENT_TEXT_LIMIT),
      mediaUrls: [...item.content.mediaUrls],
      mediaTypes: [...item.content.mediaTypes],
      linkPreview: linkPreview
        ? {
            url: linkPreview.url,
            title: linkPreview.title,
            description: linkDescription?.slice(
              0,
              DESKTOP_UI_LINK_DESCRIPTION_LIMIT,
            ),
          }
        : undefined,
    },
    engagement: item.engagement ? { ...item.engagement } : undefined,
    location: item.location
      ? {
          ...item.location,
          coordinates: item.location.coordinates
            ? { ...item.location.coordinates }
            : undefined,
        }
      : undefined,
    timeRange: item.timeRange ? { ...item.timeRange } : undefined,
    rssSource: item.rssSource ? { ...item.rssSource } : undefined,
    fbGroup: item.fbGroup ? { ...item.fbGroup } : undefined,
    // The reader asks the worker for full preserved text on demand. Keeping
    // it in every renderer item makes all non-reader surfaces pay for it.
    preservedContent: preservedContent
      ? {
          author: preservedContent.author,
          publishedAt: preservedContent.publishedAt,
          wordCount: preservedContent.wordCount,
          readingTime: preservedContent.readingTime,
          preservedAt: preservedContent.preservedAt,
          text: preservedText?.slice(0, DESKTOP_UI_PRESERVED_TEXT_LIMIT) ?? "",
        }
      : undefined,
    userState: {
      ...item.userState,
      tags: [...item.userState.tags],
      highlights: item.userState.highlights?.map((highlight) => ({
        ...highlight,
      })),
    },
    topics: [...item.topics],
    contentSignals:
      tags.length > 0
        ? ({ tags: [...tags] } as FeedItem["contentSignals"])
        : undefined,
    eventCandidate: eventCandidate
      ? {
          ...eventCandidate,
          evidence: eventEvidence?.slice(0, DESKTOP_UI_EVENT_EVIDENCE_LIMIT),
        }
      : undefined,
    priority: item.priority,
    priorityComputedAt: item.priorityComputedAt,
    sourceUrl: item.sourceUrl,
  };
}

function markAllVisibleAsRead(doc: FreedDoc, platform?: string): string[] {
  const now = Date.now();
  const changedIds: string[] = [];
  for (const item of Object.values(doc.feedItems) as FeedItem[]) {
    if (item.userState.readAt) continue;
    if (item.userState.hidden || item.userState.archived) continue;
    if (platform && item.platform !== platform) continue;
    item.userState.readAt = now;
    changedIds.push(item.globalId);
  }
  return changedIds;
}

function archiveAllReadableUnsaved(
  doc: FreedDoc,
  platform?: string,
  feedUrl?: string,
): string[] {
  const now = Date.now();
  const changedIds: string[] = [];
  for (const item of Object.values(doc.feedItems) as FeedItem[]) {
    if (item.userState.archived) continue;
    if (item.userState.hidden) continue;
    if (item.userState.saved) continue;
    if (!item.userState.readAt) continue;
    if (platform && item.platform !== platform) continue;
    if (feedUrl && item.rssSource?.feedUrl !== feedUrl) continue;
    item.userState.archived = true;
    item.userState.archivedAt = now;
    changedIds.push(item.globalId);
  }
  return changedIds;
}

function unarchiveSavedItemIds(doc: FreedDoc): string[] {
  const changedIds: string[] = [];
  for (const item of Object.values(doc.feedItems) as FeedItem[]) {
    if (!item.userState.saved) continue;
    if (!item.userState.archived) continue;
    item.userState.archived = false;
    delete (item.userState as unknown as Record<string, unknown>).archivedAt;
    changedIds.push(item.globalId);
  }
  return changedIds;
}

function healUntitledFeedTitles(doc: FreedDoc): number {
  let changed = 0;
  for (const feed of Object.values(doc.rssFeeds) as RssFeed[]) {
    const isUntitled =
      feed.title === "Untitled Feed" || feed.title === feed.url;
    if (!isUntitled) continue;
    let healed: string | undefined;
    try {
      healed = new URL(feed.url).hostname.replace(/^(?:www|feeds?)\./, "");
    } catch {
      /* non-fatal */
    }
    if (!healed || healed === feed.title) continue;
    feed.title = healed;
    changed++;
  }
  return changed;
}

function rankedPatchItemsFromDoc(doc: FreedDoc, items: FeedItem[]): FeedItem[] {
  const preferences = mergeDefaultPreferences(
    doc.preferences as Partial<UserPreferences> | undefined,
  );
  const persons = doc.persons as Record<string, Person> | undefined;
  const accounts = doc.accounts as Record<string, Account> | undefined;

  return rankFeedItems(
    [...items].sort((a, b) => {
      const timeDelta =
        (b.publishedAt || b.capturedAt) - (a.publishedAt || a.capturedAt);
      return timeDelta || a.globalId.localeCompare(b.globalId);
    }),
    preferences.weights,
    {
      persons: persons ?? {},
      accounts: accounts ?? {},
    },
  );
}

function cloneRankedFeedItemPatches(
  doc: FreedDoc | null,
  changedIds: string[],
): FeedItemPatch[] {
  const items = changedIds
    .map((globalId) => doc?.feedItems[globalId] as FeedItem | undefined)
    .filter((item): item is FeedItem => Boolean(item))
    .map((item) => cloneFeedItemForPatch(item));
  if (!doc || items.length === 0) return items.map((item) => ({ item }));

  return rankedPatchItemsFromDoc(doc, items).map((item) => ({ item }));
}

/**
 * Convert the Automerge proxy document to a plain-JS DocState for postMessage.
 * Build the projection incrementally so large synced article bodies are
 * trimmed before we hold a full deep clone of the document in worker memory.
 */
function hydrateFromDoc(doc: FreedDoc): DocState {
  const { items: plainItems, totalCount: docItemCount } =
    cloneFeedItemsForDesktopUi(
      doc.feedItems as Record<string, FeedItem> | undefined,
    );
  const feeds = cloneRecordValues(
    doc.rssFeeds as Record<string, RssFeed> | undefined,
  );
  const persons = cloneRecordValues(
    doc.persons as Record<string, Person> | undefined,
  );
  const accounts = cloneRecordValues(
    doc.accounts as Record<string, Account> | undefined,
  );
  const friends = projectLegacyFriends(persons, accounts);
  const preferences = mergeDefaultPreferences(
    doc.preferences as Partial<UserPreferences> | undefined,
  );

  const visibleItems = plainItems.filter((item) => !item.userState.hidden);
  const rankedItems = rankFeedItemsInRecommendedOrder(
    visibleItems,
    preferences.weights,
    { persons, accounts },
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
    itemCountByPlatform[item.platform] =
      (itemCountByPlatform[item.platform] ?? 0) + 1;
    if (item.rssSource) {
      const url = item.rssSource.feedUrl;
      feedTotalCounts[url] = (feedTotalCounts[url] ?? 0) + 1;
    }
    if (!item.userState.readAt) {
      totalUnreadCount++;
      unreadCountByPlatform[item.platform] =
        (unreadCountByPlatform[item.platform] ?? 0) + 1;
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
    searchCorpusVersion,
    feeds,
    persons,
    accounts,
    friends,
    preferences,
    desktopClientIds: getRegisteredDesktopClientIds(doc),
    feedUnreadCounts,
    feedTotalCounts,
    totalUnreadCount,
    unreadCountByPlatform,
    totalItemCount,
    itemCountByPlatform,
    totalArchivableCount,
    archivableCountByPlatform,
    archivableFeedCounts,
    mapFriendLocationCount: countFriendsWithRecentLocationUpdates(
      rankedItems,
      persons,
      accounts,
    ),
    mapAllContentLocationCount:
      countAuthorsWithRecentLocationUpdates(rankedItems),
    docItemCount,
  };
}

function preferenceUpdateRequiresFullHydration(
  updates: Partial<UserPreferences>,
): boolean {
  return updates.weights !== undefined;
}

/**
 * Persist, hydrate, and broadcast state plus, if relay clients are connected,
 * request a broadcast_doc IPC call from the main thread. The Array.from(binary)
 * work stays in the worker, and the main thread only asks for the full binary
 * later when snapshots or cloud sync actually need it.
 */
interface CommitCandidateOptions {
  persistence?: AutomergePersistenceOptions;
  searchCorpusChanged?: boolean;
  searchCorpusVersionOverride?: number;
  diagnostics?: string[];
}

function installCommittedDocument(
  doc: FreedDoc,
  binary: Uint8Array,
  searchCorpusChanged: boolean,
): void {
  // A projection session is an exact view of one durable revision. Any commit
  // invalidates it before the new document becomes visible.
  libraryCoreProjectionSession = null;
  libraryCoreFeedBrowseProjectionSession = null;
  currentDoc = doc;
  currentBinary = Uint8Array.from(binary);
  refreshLastSavedHeads(doc);
  if (searchCorpusChanged) bumpSearchCorpusVersion();
  rebuildKnownLinkPreviewUrls(doc);
  lastCommittedItemCount = Object.keys(doc.feedItems ?? {}).length;
  lastCommittedFriendCount = Object.keys(doc.persons ?? {}).length;
}

async function commitCandidate(
  doc: FreedDoc,
  options: CommitCandidateOptions = {},
): Promise<{
  binary: Uint8Array;
  persistMode: "compact" | "incremental" | "replace";
}> {
  const persistenceOptions = options.persistence ?? {};
  try {
    await persistence.persist(doc, persistenceOptions);
  } catch (error) {
    if (error instanceof StaleAutomergePersistenceStateError) throw error;
    throw new AutomergePersistenceError(error);
  }
  const snapshot = persistence.snapshot();
  if (!snapshot.bytes) {
    throw new Error("Committed Automerge document has no durable bytes");
  }
  installCommittedDocument(
    doc,
    snapshot.bytes,
    options.searchCorpusChanged === true,
  );
  if (options.searchCorpusVersionOverride !== undefined) {
    searchCorpusVersion = options.searchCorpusVersionOverride;
  }
  for (const detail of options.diagnostics ?? []) {
    emitWorkerTrace(detail, "change");
  }
  return {
    binary: snapshot.bytes,
    persistMode: persistenceOptions.mode ?? "incremental",
  };
}

async function saveAndBroadcast(
  doc: FreedDoc,
  trace?: RequestTrace,
  options: CommitCandidateOptions = {},
): Promise<void> {
  const startedAt = performance.now();
  const committed = await commitCandidate(doc, options);
  const binary = committed.binary;
  const afterPersistAt = performance.now();
  const state = hydrateFromDoc(doc);
  const afterHydrateAt = performance.now();

  const snapshot: Extract<WorkerResponse, { type: "DEBUG_SNAPSHOT" }> = {
    type: "DEBUG_SNAPSHOT",
    documentId: resolveDocumentId(doc.meta),
    itemCount: Object.keys(doc.feedItems ?? {}).length,
    feedCount: Object.keys(doc.rssFeeds ?? {}).length,
    binarySize: binary.byteLength,
  };
  send(snapshot);
  send({ type: "STATE_UPDATE", state, mutation: trace?.opType });

  // Request main thread to relay the binary to connected PWA clients.
  // Array.from() (O(binary size)) runs here in the worker, off the main thread.
  if (relayClientCount > 0) {
    send({ type: "BROADCAST_REQUEST", data: Array.from(binary) });
  }

  const completedAt = performance.now();
  const totalMs = completedAt - startedAt;
  if (
    trace &&
    (trace.opType === "UPDATE_PREFERENCES" ||
      totalMs >= SLOW_SAVE_AND_BROADCAST_MS)
  ) {
    emitWorkerTrace(
      `[automerge-worker] save op=${trace.opType} reqId=${trace.reqId}` +
        ` persist_ms=${formatMs(afterPersistAt - startedAt)}` +
        ` hydrate_ms=${formatMs(afterHydrateAt - afterPersistAt)}` +
        ` emit_ms=${formatMs(completedAt - afterHydrateAt)}` +
        ` total_ms=${formatMs(totalMs)}` +
        ` persist_mode=${committed.persistMode}` +
        ` bytes=${binary.byteLength.toLocaleString()}`,
    );
  }
}

async function hydrateAndBroadcastWithoutPersist(
  doc: FreedDoc,
  trace?: RequestTrace,
): Promise<void> {
  const startedAt = performance.now();
  const state = hydrateFromDoc(doc);
  rebuildKnownLinkPreviewUrls(doc);
  const afterHydrateAt = performance.now();

  send({
    type: "DEBUG_SNAPSHOT",
    documentId: resolveDocumentId(doc.meta),
    itemCount: Object.keys(doc.feedItems ?? {}).length,
    feedCount: Object.keys(doc.rssFeeds ?? {}).length,
    binarySize: currentBinary?.byteLength ?? 0,
  });
  send({ type: "STATE_UPDATE", state, mutation: trace?.opType });

  const totalMs = performance.now() - startedAt;
  if (trace && totalMs >= SLOW_SAVE_AND_BROADCAST_MS) {
    emitWorkerTrace(
      `[automerge-worker] clean-hydrate op=${trace.opType} reqId=${trace.reqId}` +
        ` hydrate_ms=${formatMs(afterHydrateAt - startedAt)}` +
        ` emit_ms=${formatMs(totalMs - (afterHydrateAt - startedAt))}` +
        ` total_ms=${formatMs(totalMs)}` +
        ` bytes=${(currentBinary?.byteLength ?? 0).toLocaleString()}`,
    );
  }
}

async function persistAndBroadcastWithoutHydration(
  doc: FreedDoc,
  trace?: RequestTrace,
  options: CommitCandidateOptions = {},
): Promise<void> {
  const startedAt = performance.now();
  const committed = await commitCandidate(doc, options);
  const binary = committed.binary;
  const afterPersistAt = performance.now();

  send({
    type: "DEBUG_SNAPSHOT",
    documentId: resolveDocumentId(doc.meta),
    itemCount: Object.keys(doc.feedItems ?? {}).length,
    feedCount: Object.keys(doc.rssFeeds ?? {}).length,
    binarySize: binary.byteLength,
  });

  if (relayClientCount > 0) {
    send({ type: "BROADCAST_REQUEST", data: Array.from(binary) });
  }

  const totalMs = performance.now() - startedAt;
  if (trace && totalMs >= SLOW_SAVE_AND_BROADCAST_MS) {
    emitWorkerTrace(
      `[automerge-worker] patch-save op=${trace.opType} reqId=${trace.reqId}` +
        ` persist_ms=${formatMs(afterPersistAt - startedAt)}` +
        ` total_ms=${formatMs(totalMs)}` +
        ` persist_mode=${committed.persistMode}` +
        ` bytes=${binary.byteLength.toLocaleString()}`,
    );
  }
}

async function applyChange(
  changeFn: (doc: FreedDoc) => void,
  message: string,
  trace?: RequestTrace,
  searchCorpusChanged = false,
): Promise<void> {
  if (!currentDoc) throw new Error("Document not initialized");
  const candidate = A.change(currentDoc, message, changeFn);
  await saveAndBroadcast(candidate, trace, {
    searchCorpusChanged,
    diagnostics: [message],
  });
}

async function applyPreferenceChange(
  updates: Partial<UserPreferences>,
  trace?: RequestTrace,
): Promise<void> {
  if (!currentDoc) throw new Error("Document not initialized");
  const syncedUpdates = stripDeviceLocalPreferenceUpdates(updates);
  if (Object.keys(syncedUpdates).length === 0) return;
  const candidate = A.change(currentDoc, "Update preferences", (doc) => {
    updatePreferences(doc, syncedUpdates);
  });

  if (preferenceUpdateRequiresFullHydration(syncedUpdates)) {
    await saveAndBroadcast(candidate, trace, {
      diagnostics: ["Update preferences"],
    });
    return;
  }

  await persistAndBroadcastWithoutHydration(candidate, trace, {
    diagnostics: ["Update preferences"],
  });
  send({
    type: "PREFERENCES_PATCH",
    updates: syncedUpdates,
    mutation: trace?.opType,
  });
}

async function applyRssFeedPatchChange(
  changeFn: (doc: FreedDoc) => RssFeedPatch,
  message: string,
  trace?: RequestTrace,
): Promise<void> {
  if (!currentDoc) throw new Error("Document not initialized");
  let patch: RssFeedPatch = { feeds: {}, removedUrls: [] };
  const candidate = A.change(currentDoc, message, (doc) => {
    patch = changeFn(doc);
  });
  await persistAndBroadcastWithoutHydration(candidate, trace, {
    diagnostics: [message],
  });
  send({ type: "FEEDS_PATCH", patch, mutation: trace?.opType });
}

async function applyCountedChange(
  changeFn: (doc: FreedDoc) => number,
  message: string,
  trace?: RequestTrace,
  searchCorpusChanged = false,
): Promise<number> {
  if (!currentDoc) throw new Error("Document not initialized");
  let changedCount = 0;
  const candidate = A.change(currentDoc, message, (doc) => {
    changedCount = changeFn(doc);
  });

  if (changedCount === 0) {
    emitWorkerTrace(
      `[automerge-worker] skip op=${trace?.opType ?? "unknown"} reason=no_changes`,
      "change",
    );
    return changedCount;
  }

  await saveAndBroadcast(candidate, trace, {
    searchCorpusChanged,
    diagnostics: [`${message}: ${changedCount.toLocaleString()} changed`],
  });
  return changedCount;
}

async function applyItemPatchChange(
  changeFn: (doc: FreedDoc) => string[],
  message: string,
  trace?: RequestTrace,
): Promise<void> {
  if (!currentDoc) throw new Error("Document not initialized");
  let changedIds: string[] = [];
  const candidate = A.change(currentDoc, message, (doc) => {
    changedIds = changeFn(doc);
  });
  await persistAndBroadcastWithoutHydration(candidate, trace, {
    diagnostics: [message],
  });

  const patches = changedIds
    .map((globalId) => candidate.feedItems[globalId] as FeedItem | undefined)
    .filter((item): item is FeedItem => Boolean(item))
    .map((item) => ({ item: cloneFeedItemForPatch(item) }));
  if (patches.length > 0) {
    send({
      type: "ITEM_PATCH",
      patches,
      changedItemIds: changedIds,
      mutation: trace?.opType,
    });
  }
}

async function applyAddFeedItemsPatchChange(
  items: FeedItem[],
  trace?: RequestTrace,
): Promise<void> {
  if (!currentDoc) throw new Error("Document not initialized");
  let changedIds: string[] = [];
  let dedupedCount = 0;
  const candidate = A.change(
    currentDoc,
    `Add ${items.length.toLocaleString()} feed items`,
    (doc) => {
      for (const item of items) {
        compactFeedItemTextForSync(item);
        if (doc.feedItems[item.globalId]) continue;
        addFeedItem(doc, item);
        changedIds.push(item.globalId);
      }
      if (
        changedIds.length > 0 &&
        items.some(
          (item) =>
            item.platform === "facebook" || item.platform === "instagram",
        )
      ) {
        dedupedCount = deduplicateDocFeedItems(doc);
      }
    },
  );

  if (changedIds.length === 0 && dedupedCount === 0) {
    emitWorkerTrace(
      `[automerge-worker] skip op=${trace?.opType ?? "unknown"} reason=no_changes`,
      "change",
    );
    return;
  }

  const diagnostics = [
    `Add ${items.length.toLocaleString()} feed items: ${changedIds.length.toLocaleString()} changed`,
  ];

  if (dedupedCount > 0) {
    diagnostics.push(
      `[automerge-worker] full-hydrate op=${trace?.opType ?? "unknown"} reason=social_dedup deleted=${dedupedCount.toLocaleString()}`,
    );
    await saveAndBroadcast(candidate, trace, {
      searchCorpusChanged: true,
      diagnostics,
    });
    return;
  }

  await persistAndBroadcastWithoutHydration(candidate, trace, {
    searchCorpusChanged: true,
    diagnostics,
  });
  const patches = cloneRankedFeedItemPatches(candidate, changedIds);

  if (patches.length > 0) {
    send({
      type: "ITEM_PATCH",
      patches,
      changedItemIds: changedIds,
      preservePriorityOrder: true,
      searchCorpusVersion,
      mutation: trace?.opType,
    });
  }
}

async function applyBatchRefreshFeedsPatchChange(
  feeds: RssFeedRefreshUpdate[],
  items: FeedItem[],
  trace?: RequestTrace,
): Promise<void> {
  if (!currentDoc) throw new Error("Document not initialized");
  const patchedFeeds = new Map<string, RssFeed>();
  let changedIds: string[] = [];
  const removedEssayDuplicateIds: string[] = [];
  const changedIdSet = new Set<string>();
  const candidateLinkPreviewUrlCounts = new Map(linkPreviewUrlCounts);
  const candidateHasKnownLinkPreviewUrl = (url: string | null): boolean =>
    Boolean(url && (candidateLinkPreviewUrlCounts.get(url) ?? 0) > 0);
  const candidateAddKnownLinkPreviewUrl = (
    item: FeedItem | undefined,
  ): void => {
    const url = itemLinkPreviewUrl(item);
    if (!url) return;
    candidateLinkPreviewUrlCounts.set(
      url,
      (candidateLinkPreviewUrlCounts.get(url) ?? 0) + 1,
    );
  };
  const markChanged = (globalId: string) => {
    if (changedIdSet.has(globalId)) return;
    changedIdSet.add(globalId);
    changedIds.push(globalId);
  };
  const candidate = A.change(
    currentDoc,
    `Refresh ${feeds.length.toLocaleString()} feeds, ${items.length.toLocaleString()} items`,
    (doc) => {
      for (const feed of feeds) {
        const stored = findRssFeedByUrl(
          doc.rssFeeds as Record<string, RssFeed>,
          feed.url,
        );
        if (!stored) continue;
        if (feed.lastFetched !== undefined)
          stored.lastFetched = feed.lastFetched;
        if (
          feed.title &&
          feed.title !== "Untitled Feed" &&
          feed.title !== feed.url
        ) {
          if (stored.title === "Untitled Feed" || stored.title === stored.url) {
            stored.title = feed.title;
          }
        }
        if (feed.siteUrl && !stored.siteUrl) stored.siteUrl = feed.siteUrl;
        patchedFeeds.set(feed.url, cloneRssFeedForPatch(stored));
      }

      for (const item of items) compactFeedItemTextForSync(item);

      for (const provider of ["substack", "medium"] as const) {
        const providerItems = items.filter(
          (item) =>
            item.platform === provider && item.contentType === "article",
        );
        const essayResult = reconcileProviderEssayItems(
          doc,
          providerItems,
          provider,
          { shouldMergeExisting: shouldMergeEssayRssItem },
        );
        for (const globalId of essayResult.changedIds) markChanged(globalId);
        for (const globalId of essayResult.addedIds) {
          candidateAddKnownLinkPreviewUrl(
            doc.feedItems[globalId] as FeedItem | undefined,
          );
        }
        removedEssayDuplicateIds.push(...essayResult.removedIds);
      }

      for (const item of items) {
        if (isAuthenticatedEssayArticle(item)) continue;
        const existingById = doc.feedItems[item.globalId];
        if (existingById) continue;

        const linkUrl = itemLinkPreviewUrl(item);
        if (candidateHasKnownLinkPreviewUrl(linkUrl)) continue;
        addFeedItem(doc, item);
        markChanged(item.globalId);
        candidateAddKnownLinkPreviewUrl(item);
      }
    },
  );

  const feedPatch: RssFeedPatch = {
    feeds: Object.fromEntries(patchedFeeds),
    removedUrls: [],
  };
  const feedChanged = patchedFeeds.size > 0;
  if (
    !feedChanged &&
    changedIds.length === 0 &&
    removedEssayDuplicateIds.length === 0
  ) {
    emitWorkerTrace(
      `[automerge-worker] skip op=${trace?.opType ?? "unknown"} reason=no_changes`,
      "change",
    );
    return;
  }

  const diagnostics = [
    `Refresh ${feeds.length.toLocaleString()} feeds, ${items.length.toLocaleString()} items: ` +
      `${changedIds.length.toLocaleString()} changed, ` +
      `${removedEssayDuplicateIds.length.toLocaleString()} removed`,
  ];

  await persistAndBroadcastWithoutHydration(candidate, trace, {
    searchCorpusChanged:
      changedIds.length > 0 || removedEssayDuplicateIds.length > 0,
    diagnostics,
  });

  if (feedChanged) {
    send({ type: "FEEDS_PATCH", patch: feedPatch, mutation: trace?.opType });
  }

  const patches = cloneRankedFeedItemPatches(candidate, changedIds);
  if (patches.length > 0 || removedEssayDuplicateIds.length > 0) {
    send({
      type: "ITEM_PATCH",
      patches,
      changedItemIds: [...changedIds, ...removedEssayDuplicateIds],
      removedItemIds: removedEssayDuplicateIds,
      preservePriorityOrder: true,
      searchCorpusVersion,
      mutation: trace?.opType,
    });
  }
}

async function handleRequest(
  req: WorkerRequest,
  enqueuedAt: number,
): Promise<void> {
  const startedAt = performance.now();
  const trace: RequestTrace = {
    reqId: req.reqId,
    opType: req.type,
    enqueuedAt,
    startedAt,
    queuedBeforeStart: Math.max(0, queuedRequestCount - 1),
  };
  const waitMs = startedAt - enqueuedAt;
  if (req.type === "UPDATE_PREFERENCES" || waitMs >= SLOW_QUEUE_WAIT_MS) {
    emitWorkerTrace(
      `[automerge-worker] start op=${req.type} reqId=${req.reqId}` +
        ` wait_ms=${formatMs(waitMs)}` +
        ` queued=${trace.queuedBeforeStart.toLocaleString()}`,
    );
  }
  cancelDocIdleUnload();

  if (persistenceFailure) {
    ack(req.reqId, persistenceFailure.message, "AUTOMERGE_PERSISTENCE_FAILED");
    return;
  }

  const isExternalExportRequest =
    req.type === "BEGIN_LIBRARY_CORE_EXTERNAL_EXPORT" ||
    req.type === "READ_LIBRARY_CORE_EXTERNAL_EXPORT_CHUNK" ||
    req.type === "CONFIRM_LIBRARY_CORE_EXTERNAL_EXPORT" ||
    req.type === "CANCEL_LIBRARY_CORE_EXTERNAL_EXPORT";
  if (
    libraryCoreExternalExportSession &&
    req.type !== "QUIESCE" &&
    !isExternalExportRequest
  ) {
    ack(
      req.reqId,
      `Library Core external export session ${libraryCoreExternalExportSession.sessionId} is active`,
    );
    return;
  }

  if (
    req.type !== "INIT" &&
    req.type !== "QUIESCE" &&
    req.type !== "CLEAR_LOCAL" &&
    req.type !== "REPLACE_DOC" &&
    req.type !== "GET_DOC_BINARY" &&
    req.type !== "GET_COMMITTED_DOC" &&
    req.type !== "GET_HEADS" &&
    req.type !== "BEGIN_LIBRARY_CORE_PROJECTION" &&
    req.type !== "NEXT_LIBRARY_CORE_PROJECTION_BATCH" &&
    req.type !== "CANCEL_LIBRARY_CORE_PROJECTION" &&
    !isExternalExportRequest
  ) {
    ensureCurrentDocLoaded(req.type);
  }

  const applyRequestChange = (
    changeFn: (doc: FreedDoc) => void,
    message: string,
    searchCorpusChanged = false,
  ) => applyChange(changeFn, message, trace, searchCorpusChanged);

  try {
    switch (req.type) {
      case "QUIESCE":
        libraryCoreProjectionSession = null;
        libraryCoreFeedBrowseProjectionSession = null;
        libraryCoreExternalExportSession = null;
        ack(req.reqId);
        break;

      case "INIT": {
        libraryCoreProjectionSession = null;
        libraryCoreFeedBrowseProjectionSession = null;
        libraryCoreExternalExportSession = null;
        const requestedDesktopClientRegistration =
          req.desktopClientRegistration ?? null;
        let loaded;
        try {
          loaded = await persistence.load<FreedDoc>();
        } catch (error) {
          let snapshot: ReturnType<typeof persistence.snapshot> | null = null;
          try {
            snapshot = persistence.snapshot();
          } catch {
            // Storage failed before a committed revision could be captured.
          }
          if (
            snapshot?.bytes &&
            classifyDocumentLoadFailure(error) === "corrupt"
          ) {
            corruptStorageRevision = { ...snapshot.revision };
            throw new CorruptDocumentError();
          }
          throw new DocumentLoadFailedError(
            snapshot?.bytes?.byteLength ?? 0,
            error,
          );
        }
        corruptStorageRevision = null;
        let candidate = loaded.document ?? createEmptyDoc();
        const prepared = prepareLoadedDocument(
          candidate,
          "Migrate legacy identity graph",
          "Compact oversized synced feed text",
          {
            rebuildHistory: true,
            previousBinaryBytes: loaded.committed.byteLength,
          },
        );
        candidate = prepared.doc;
        let loadedDocNeedsPersist =
          loaded.document === null || prepared.changed;
        if (requestedDesktopClientRegistration) {
          const registeredDoc = registerDesktopClient(
            candidate,
            requestedDesktopClientRegistration,
          );
          if (registeredDoc !== candidate) {
            candidate = registeredDoc;
            loadedDocNeedsPersist = true;
          }
        }
        const documentId = resolveDocumentId(candidate.meta);
        const diagnostics = [
          ...(prepared.identityMigrated
            ? ["[automerge-worker] migrated legacy identity graph"]
            : []),
          ...(prepared.compaction.debugDetail
            ? [prepared.compaction.debugDetail]
            : []),
          `document ...${documentId.slice(-8)}`,
        ];
        if (loadedDocNeedsPersist) {
          await saveAndBroadcast(candidate, trace, {
            persistence: prepared.compaction.rebuiltHistory
              ? {
                  mode: "replace",
                  expectedRevision: loaded.committed.revision,
                }
              : {},
            diagnostics,
            searchCorpusVersionOverride: 1,
          });
        } else {
          const snapshot = persistence.snapshot();
          if (!snapshot.bytes) {
            throw new Error("Loaded Automerge document has no durable bytes");
          }
          installCommittedDocument(candidate, snapshot.bytes, false);
          searchCorpusVersion = 1;
          for (const detail of diagnostics) {
            emitWorkerTrace(detail, "change");
          }
          await hydrateAndBroadcastWithoutPersist(candidate, trace);
        }
        activeDesktopClientRegistration = requestedDesktopClientRegistration;
        send({
          type: "INIT_STATS",
          durationMs: Math.round(performance.now() - startedAt),
          docBytes: currentBinary?.byteLength ?? 0,
        });
        ack(req.reqId);
        break;
      }

      case "CLEAR_LOCAL":
        cancelDocIdleUnload();
        try {
          if (corruptStorageRevision) {
            await storage.clear(corruptStorageRevision);
            persistence = new RepeatableAutomergePersistence(storage);
            await persistence.load<FreedDoc>();
            corruptStorageRevision = null;
          } else {
            await persistence.clear(persistence.current().revision);
          }
        } catch (error) {
          throw new AutomergePersistenceError(error);
        }
        libraryCoreProjectionSession = null;
        libraryCoreFeedBrowseProjectionSession = null;
        libraryCoreExternalExportSession = null;
        currentDoc = null;
        currentBinary = null;
        refreshLastSavedHeads(null);
        linkPreviewUrlCounts = new Map();
        lastCommittedItemCount = 0;
        lastCommittedFriendCount = 0;
        searchCorpusVersion = 0;
        ack(req.reqId);
        break;

      case "REPLACE_DOC": {
        const candidateDesktopClientRegistration =
          req.desktopClientRegistration ?? activeDesktopClientRegistration;
        let candidate = A.load<FreedDoc>(req.binary);
        if (candidateDesktopClientRegistration) {
          candidate = registerDesktopClient(
            candidate,
            candidateDesktopClientRegistration,
          );
        }
        const prepared = prepareLoadedDocument(
          candidate,
          "Migrate legacy identity graph",
          "Compact oversized synced feed text",
          {
            rebuildHistory: true,
            previousBinaryBytes: req.binary.byteLength,
          },
        );
        candidate = prepared.doc;
        await saveAndBroadcast(candidate, trace, {
          persistence: {
            mode: "replace",
            expectedRevision: req.expectedRevision,
          },
          searchCorpusChanged: true,
          diagnostics: [
            ...(prepared.identityMigrated
              ? ["[automerge-worker] migrated legacy identity graph"]
              : []),
            ...(prepared.compaction.debugDetail
              ? [prepared.compaction.debugDetail]
              : []),
          ],
        });
        activeDesktopClientRegistration = candidateDesktopClientRegistration;
        ack(req.reqId);
        break;
      }

      case "GET_DOC_BINARY":
        if (!currentBinary) throw new Error("Document not initialized");
        send({
          reqId: req.reqId,
          type: "DOC_BINARY",
          binary: Uint8Array.from(currentBinary),
        });
        break;

      case "GET_COMMITTED_DOC": {
        const snapshot = persistence.snapshot();
        if (!snapshot.bytes) throw new Error("Document not initialized");
        send({
          reqId: req.reqId,
          type: "COMMITTED_DOC",
          binary: Uint8Array.from(snapshot.bytes),
          heads: [...snapshot.heads],
          revision: { ...snapshot.revision },
          itemCount: lastCommittedItemCount,
          friendCount: lastCommittedFriendCount,
        });
        break;
      }

      case "GET_HEADS":
        send({
          reqId: req.reqId,
          type: "DOC_HEADS",
          heads: currentDoc ? A.getHeads(currentDoc) : lastSavedHeads,
        });
        break;

      case "COMPARE_DOC": {
        const doc = ensureCurrentDocLoaded(req.type);
        const incomingDoc = A.load<FreedDoc>(req.binary);
        send({
          reqId: req.reqId,
          type: "DOC_RELATIONSHIP",
          relation: compareDocumentHistories(doc, incomingDoc),
        });
        break;
      }

      case "GET_SAVED_YOUTUBE_URLS": {
        const doc = ensureCurrentDocLoaded(req.type);
        const plain = A.view(doc, A.getHeads(doc)) as FreedDoc;
        send({
          reqId: req.reqId,
          type: "SAVED_YOUTUBE_URLS",
          urls: collectSavedYouTubeVideoUrls(
            Object.values(plain.feedItems as Record<string, FeedItem>),
          ),
        });
        break;
      }

      case "MERGE_DOC": {
        if (!currentDoc) throw new Error("Document not initialized");
        const beforeCount = Object.keys(currentDoc.feedItems ?? {}).length;
        const incomingDoc = A.load<FreedDoc>(req.binary);
        let candidate = A.merge(currentDoc, incomingDoc);
        const guard = assertNonDestructiveMerge(
          currentDoc,
          incomingDoc,
          candidate,
          {
            source: "Desktop sync",
          },
        );
        const prepared = prepareLoadedDocument(
          candidate,
          "Migrate legacy identity graph",
          "Compact oversized synced feed text after merge",
          {
            rebuildHistory: true,
            previousBinaryBytes: Math.max(
              currentBinary?.byteLength ?? 0,
              req.binary.byteLength,
            ),
          },
        );
        candidate = prepared.doc;
        if (activeDesktopClientRegistration) {
          candidate = registerDesktopClient(
            candidate,
            activeDesktopClientRegistration,
          );
        }
        const afterCount = Object.keys(candidate.feedItems ?? {}).length;
        const delta = afterCount - beforeCount;
        await saveAndBroadcast(candidate, trace, {
          persistence: prepared.compaction.rebuiltHistory
            ? {
                mode: "replace",
                expectedRevision: persistence.current().revision,
              }
            : {},
          searchCorpusChanged: true,
          diagnostics: [
            ...(prepared.identityMigrated
              ? ["[automerge-worker] migrated legacy identity graph"]
              : []),
            ...(prepared.compaction.debugDetail
              ? [prepared.compaction.debugDetail]
              : []),
          ],
        });
        send({
          type: "DEBUG_EVENT",
          kind: "merge_ok",
          detail:
            delta !== 0
              ? `${delta > 0 ? "+" : ""}${delta} items`
              : "no new items",
          bytes: req.binary.byteLength,
        });
        if (guard.deletedItemCount > 0) {
          send({
            type: "DEBUG_EVENT",
            kind: "merge_ok",
            detail: `merge safety checked ${guard.deletedItemCount.toLocaleString()} item deletions`,
            bytes: req.binary.byteLength,
          });
        }
        ack(req.reqId);
        break;
      }

      case "MARK_AS_READ":
        await applyItemPatchChange(
          (doc) => {
            markAsRead(doc, req.globalId);
            return [req.globalId];
          },
          "Mark as read",
          trace,
        );
        ack(req.reqId);
        break;

      case "MARK_ITEMS_AS_READ":
        await applyItemPatchChange(
          (doc) => {
            markItemsAsRead(doc, req.globalIds);
            return req.globalIds;
          },
          `Mark ${req.globalIds.length.toLocaleString()} items as read`,
          trace,
        );
        ack(req.reqId);
        break;

      case "MARK_ALL_AS_READ":
        await applyItemPatchChange(
          (doc) => markAllVisibleAsRead(doc, req.platform),
          "Mark all as read",
          trace,
        );
        ack(req.reqId);
        break;

      case "TOGGLE_SAVED":
        await applyItemPatchChange(
          (doc) => {
            toggleSaved(doc, req.globalId);
            return [req.globalId];
          },
          "Toggle saved",
          trace,
        );
        ack(req.reqId);
        break;

      case "TOGGLE_ARCHIVED":
        await applyItemPatchChange(
          (doc) => {
            toggleArchived(doc, req.globalId);
            return [req.globalId];
          },
          "Toggle archived",
          trace,
        );
        ack(req.reqId);
        break;

      case "ARCHIVE_ITEMS":
        await applyItemPatchChange(
          (doc) => archiveItemsById(doc, req.globalIds),
          `Archive ${req.globalIds.length.toLocaleString()} items`,
          trace,
        );
        ack(req.reqId);
        break;

      case "TOGGLE_LIKED":
        await applyItemPatchChange(
          (doc) => {
            toggleLiked(doc, req.globalId);
            return [req.globalId];
          },
          "Toggle liked",
          trace,
        );
        ack(req.reqId);
        break;

      case "CONFIRM_LIKED_SYNCED":
        await applyItemPatchChange(
          (doc) => {
            confirmLikedSynced(doc, req.globalId, req.syncedAt);
            return [req.globalId];
          },
          "Confirm liked synced",
          trace,
        );
        ack(req.reqId);
        break;

      case "CONFIRM_SEEN_SYNCED":
        await applyItemPatchChange(
          (doc) => {
            confirmSeenSynced(doc, req.globalId, req.syncedAt);
            return [req.globalId];
          },
          "Confirm seen synced",
          trace,
        );
        ack(req.reqId);
        break;

      case "ADD_FEED_ITEM":
        await applyRequestChange(
          (doc) => {
            compactFeedItemTextForSync(req.item);
            if (!doc.feedItems[req.item.globalId]) addFeedItem(doc, req.item);
          },
          "Add feed item",
          true,
        );
        ack(req.reqId);
        break;

      case "ADD_FEED_ITEMS":
        await applyAddFeedItemsPatchChange(req.items, trace);
        ack(req.reqId);
        break;

      case "RECONCILE_YOUTUBE_CAPTURE":
        await applyRequestChange(
          (doc) => {
            for (const item of req.items) compactFeedItemTextForSync(item);
            reconcileYouTubeCapture(doc, req.accounts, req.items, req.options);
          },
          `Reconcile ${req.accounts.length.toLocaleString()} YouTube channels and ${req.items.length.toLocaleString()} videos`,
          true,
        );
        ack(req.reqId);
        break;

      case "RECONCILE_FOLLOW_ROSTER_CAPTURE":
        await applyRequestChange(
          (doc) => {
            for (const item of req.items) compactFeedItemTextForSync(item);
            reconcileFollowRosterCapture(
              doc,
              req.accounts,
              req.items,
              req.options,
            );
          },
          `Reconcile ${req.accounts.length.toLocaleString()} ${req.options.provider} accounts and ${req.items.length.toLocaleString()} items`,
          true,
        );
        ack(req.reqId);
        break;

      case "ADD_SAMPLE_LIBRARY_DATA":
        await applyRequestChange(
          (doc) => {
            for (const feed of req.feeds) {
              addRssFeed(doc, feed);
            }
            for (const item of req.items) {
              compactFeedItemTextForSync(item);
              if (!doc.feedItems[item.globalId]) addFeedItem(doc, item);
            }
            for (const person of req.persons) {
              addPerson(doc, person);
            }
            addAccounts(doc, req.accounts);
          },
          `Add sample library data: ${req.items.length.toLocaleString()} items`,
          true,
        );
        ack(req.reqId);
        break;

      case "REMOVE_FEED_ITEM":
        await applyRequestChange(
          (doc) => removeFeedItem(doc, req.globalId),
          "Remove feed item",
          true,
        );
        ack(req.reqId);
        break;

      case "CLEAR_SAMPLE_DATA": {
        let summary = { feeds: 0, items: 0, persons: 0, accounts: 0, total: 0 };
        await applyRequestChange(
          (doc) => {
            summary = clearSampleData(doc);
          },
          "Clear sample data",
          true,
        );
        send({ reqId: req.reqId, type: "SAMPLE_DATA_CLEAR_RESULT", summary });
        break;
      }

      case "UPDATE_FEED_ITEM":
        await applyRequestChange(
          (doc) => {
            updateFeedItem(doc, req.globalId, req.updates);
            const item = doc.feedItems[req.globalId] as FeedItem | undefined;
            if (item) compactFeedItemTextForSync(item);
          },
          "Update feed item",
          feedItemUpdatesAffectSearchCorpus(req.updates),
        );
        ack(req.reqId);
        break;

      case "ARCHIVE_ALL_READ_UNSAVED":
        await applyItemPatchChange(
          (doc) => archiveAllReadableUnsaved(doc, req.platform, req.feedUrl),
          "Archive all read",
          trace,
        );
        ack(req.reqId);
        break;

      case "UNARCHIVE_SAVED_ITEMS":
        await applyItemPatchChange(
          (doc) => unarchiveSavedItemIds(doc),
          "Unarchive saved items",
          trace,
        );
        ack(req.reqId);
        break;

      case "PRUNE_ARCHIVED_ITEMS":
        await applyCountedChange(
          (doc) => pruneArchivedItems(doc, req.maxAgeMs),
          "Prune archived items",
          trace,
          true,
        );
        ack(req.reqId);
        break;

      case "DELETE_ALL_ARCHIVED":
        await applyRequestChange(
          (doc) => deleteAllArchivedItems(doc),
          "Delete all archived items",
          true,
        );
        ack(req.reqId);
        break;

      case "ADD_RSS_FEED":
        await applyRssFeedPatchChange(
          (doc) => {
            addRssFeed(doc, req.feed);
            const stored = findRssFeedByUrl(
              doc.rssFeeds as Record<string, RssFeed>,
              req.feed.url,
            );
            return {
              feeds: rssFeedPatchRecord(req.feed.url, stored),
              removedUrls: [],
            };
          },
          "Add RSS feed",
          trace,
        );
        ack(req.reqId);
        break;

      case "REMOVE_RSS_FEED":
        if (req.includeItems) {
          await applyRequestChange(
            (doc) => removeRssFeed(doc, req.url, true),
            "Remove RSS feed and articles",
            true,
          );
        } else {
          await applyRssFeedPatchChange(
            (doc) => {
              removeRssFeed(doc, req.url, false);
              return { feeds: {}, removedUrls: [req.url] };
            },
            "Remove RSS feed",
            trace,
          );
        }
        ack(req.reqId);
        break;

      case "UPDATE_RSS_FEED":
        await applyRssFeedPatchChange(
          (doc) => {
            updateRssFeed(
              doc,
              req.url,
              req.updates as Parameters<typeof updateRssFeed>[2],
            );
            const stored = findRssFeedByUrl(
              doc.rssFeeds as Record<string, RssFeed>,
              req.url,
            );
            return {
              feeds: rssFeedPatchRecord(req.url, stored),
              removedUrls: [],
            };
          },
          "Update RSS feed",
          trace,
        );
        ack(req.reqId);
        break;

      case "REMOVE_ALL_FEEDS":
        await applyRequestChange(
          (doc) => removeAllFeeds(doc, req.includeItems),
          req.includeItems
            ? "Remove all feeds and articles"
            : "Remove all feeds",
          true,
        );
        ack(req.reqId);
        break;

      case "UPDATE_PREFERENCES":
        await applyPreferenceChange(req.updates, trace);
        ack(req.reqId);
        break;

      case "ADD_PERSON":
        await applyRequestChange(
          (doc) => addPerson(doc, req.person),
          "Add person",
        );
        ack(req.reqId);
        break;

      case "ADD_PERSONS":
        await applyRequestChange((doc) => {
          for (const person of req.persons) {
            addPerson(doc, person);
          }
        }, `Add ${req.persons.length.toLocaleString()} people`);
        ack(req.reqId);
        break;

      case "UPDATE_PERSON":
        await applyRequestChange(
          (doc) =>
            updatePerson(doc, req.personId, req.updates as Partial<Person>),
          "Update person",
        );
        ack(req.reqId);
        break;

      case "UPSERT_CONNECTION_PERSONS":
        await applyRequestChange((doc) => {
          const now = Date.now();
          for (const candidate of req.candidates) {
            if (doc.persons[candidate.person.id]) {
              updatePerson(doc, candidate.person.id, candidate.person);
            } else {
              addPerson(doc, candidate.person);
            }
            for (const accountId of candidate.accountIds) {
              const account = doc.accounts[accountId];
              if (!account || account.personId === candidate.person.id)
                continue;
              updateAccount(doc, accountId, {
                personId: candidate.person.id,
                updatedAt: now,
              });
            }
          }
        }, `Upsert ${req.candidates.length.toLocaleString()} connection people`);
        ack(req.reqId);
        break;

      case "REMOVE_PERSON":
        await applyRequestChange(
          (doc) => removePerson(doc, req.personId),
          "Remove person",
        );
        ack(req.reqId);
        break;

      case "LOG_REACH_OUT":
        await applyRequestChange(
          (doc) => logReachOut(doc, req.personId, req.entry),
          "Log reach-out",
        );
        ack(req.reqId);
        break;

      case "ADD_ACCOUNT":
        await applyRequestChange(
          (doc) => addAccount(doc, req.account),
          "Add account",
        );
        ack(req.reqId);
        break;

      case "ADD_ACCOUNTS":
        await applyRequestChange(
          (doc) => addAccounts(doc, req.accounts),
          `Add ${req.accounts.length.toLocaleString()} accounts`,
        );
        ack(req.reqId);
        break;

      case "UPDATE_ACCOUNT":
        await applyRequestChange(
          (doc) => updateAccount(doc, req.accountId, req.updates),
          "Update account",
        );
        ack(req.reqId);
        break;

      case "REMOVE_ACCOUNT":
        await applyRequestChange(
          (doc) => removeAccount(doc, req.accountId),
          "Remove account",
        );
        ack(req.reqId);
        break;

      case "BATCH_REFRESH_FEEDS":
        await applyBatchRefreshFeedsPatchChange(req.feeds, req.items, trace);
        ack(req.reqId);
        break;

      case "BATCH_IMPORT_ITEMS": {
        const CHUNK = 500;
        const items = req.items;
        const totalChunks = Math.ceil(items.length / CHUNK);
        for (let i = 0; i < items.length; i += CHUNK) {
          const chunkIndex = Math.floor(i / CHUNK);
          const chunk = items.slice(i, i + CHUNK);
          await applyRequestChange(
            (doc) => {
              for (const item of chunk) {
                compactFeedItemTextForSync(item);
                if (!doc.feedItems[item.globalId]) addFeedItem(doc, item);
              }
            },
            `Batch import chunk ${chunkIndex + 1}/${totalChunks}`,
            true,
          );
          send({
            type: "IMPORT_PROGRESS",
            chunkIndex: chunkIndex + 1,
            totalChunks,
          });
        }
        ack(req.reqId);
        break;
      }

      case "HEAL_UNTITLED_FEEDS":
        await applyCountedChange(
          healUntitledFeedTitles,
          "Heal untitled feed titles from URL hostname",
          trace,
          true,
        );
        ack(req.reqId);
        break;

      case "DEDUPLICATE_ITEMS":
        await applyCountedChange(
          deduplicateDocFeedItems,
          "Deduplicate feed items by article link URL and linked social cross-posts",
          trace,
          true,
        );
        ack(req.reqId);
        break;

      case "BACKFILL_CONTENT_SIGNALS": {
        if (!currentDoc) throw new Error("Document not initialized");
        let summary = summarizeDocContentSignals(currentDoc);
        const pendingCount = countContentSignalBackfillItems(currentDoc);
        if (pendingCount > 0) {
          const candidate = A.change(
            currentDoc,
            "Backfill content signals",
            (doc) => {
              summary = backfillContentSignals(doc, req.batchSize);
            },
          );
          await saveAndBroadcast(candidate, trace, {
            searchCorpusChanged: true,
            diagnostics: [
              `[content-signals] backfilled ${summary.updated.toLocaleString()} items, ` +
                `${summary.remaining.toLocaleString()} remaining`,
            ],
          });
        }
        send({
          reqId: req.reqId,
          type: "CONTENT_SIGNAL_BACKFILL_RESULT",
          summary,
        });
        break;
      }

      case "GET_ALL_ITEM_IDS":
        if (!currentDoc) throw new Error("Document not initialized");
        send({
          reqId: req.reqId,
          type: "ALL_ITEM_IDS",
          ids: Object.keys(currentDoc.feedItems ?? {}),
        });
        break;

      case "GET_ITEM_PRESERVED_TEXT":
        if (!currentDoc) throw new Error("Document not initialized");
        send({
          reqId: req.reqId,
          type: "ITEM_PRESERVED_TEXT",
          globalId: req.globalId,
          text:
            currentDoc.feedItems[req.globalId]?.preservedContent?.text ??
            currentDoc.feedItems[req.globalId]?.content.text ??
            null,
        });
        break;

      case "GET_ITEM_LEGACY_HTML":
        if (!currentDoc) throw new Error("Document not initialized");
        send({
          reqId: req.reqId,
          type: "ITEM_LEGACY_HTML",
          globalId: req.globalId,
          html:
            currentDoc.feedItems[req.globalId]?.preservedContent?.html ?? null,
        });
        break;

      case "BEGIN_LIBRARY_CORE_PROJECTION": {
        const session = await startLibraryCoreProjection(req.sessionId);
        send({
          reqId: req.reqId,
          type: "LIBRARY_CORE_PROJECTION_STARTED",
          sessionId: session.sessionId,
          source: session.source,
          totalRows: session.totalRows,
          nextBatchIndex: session.nextBatchIndex,
          projectedRows: session.nextOffset,
          maximumBatchRows: MAX_LIBRARY_CORE_PROJECTION_BATCH_ROWS,
          maximumBatchBytes: MAX_LIBRARY_CORE_PROJECTION_BATCH_BYTES,
        });
        break;
      }

      case "NEXT_LIBRARY_CORE_PROJECTION_BATCH": {
        const batch = await nextLibraryCoreProjectionBatch(
          req.sessionId,
          req.batchIndex,
        );
        send({
          reqId: req.reqId,
          type: "LIBRARY_CORE_PROJECTION_BATCH",
          ...batch,
        });
        break;
      }

      case "CANCEL_LIBRARY_CORE_PROJECTION":
        validateProjectionSessionId(req.sessionId);
        if (
          libraryCoreProjectionSession &&
          libraryCoreProjectionSession.sessionId !== req.sessionId
        ) {
          throw new Error(
            `Library Core projection session ${libraryCoreProjectionSession.sessionId} is active`,
          );
        }
        libraryCoreProjectionSession = null;
        ack(req.reqId);
        break;

      case "BEGIN_LIBRARY_CORE_FEED_BROWSE_PROJECTION": {
        const session = await startLibraryCoreFeedBrowseProjection(
          req.sessionId,
          req.filter,
          req.rankingClockMs,
        );
        send({
          reqId: req.reqId,
          type: "LIBRARY_CORE_FEED_BROWSE_PROJECTION_STARTED",
          sessionId: session.sessionId,
          binding: session.binding,
          filter: session.filter,
          nextBatchIndex: session.nextBatchIndex,
          projectedRows: session.projectedRows,
          maximumBatchRows: MAX_LIBRARY_CORE_FEED_BROWSE_BATCH_ROWS,
        });
        break;
      }

      case "NEXT_LIBRARY_CORE_FEED_BROWSE_PROJECTION_BATCH": {
        const batch = await nextLibraryCoreFeedBrowseProjectionBatch(
          req.sessionId,
          req.batchIndex,
        );
        send({
          reqId: req.reqId,
          type: "LIBRARY_CORE_FEED_BROWSE_PROJECTION_BATCH",
          ...batch,
        });
        break;
      }

      case "CANCEL_LIBRARY_CORE_FEED_BROWSE_PROJECTION":
        validateProjectionSessionId(req.sessionId);
        if (
          libraryCoreFeedBrowseProjectionSession &&
          libraryCoreFeedBrowseProjectionSession.sessionId !== req.sessionId
        ) {
          throw new Error(
            `Library Core browse projection session ${libraryCoreFeedBrowseProjectionSession.sessionId} is active`,
          );
        }
        libraryCoreFeedBrowseProjectionSession = null;
        ack(req.reqId);
        break;

      case "BEGIN_LIBRARY_CORE_EXTERNAL_EXPORT": {
        const session = await startLibraryCoreExternalExport(req.sessionId);
        send({
          reqId: req.reqId,
          type: "LIBRARY_CORE_EXTERNAL_EXPORT_STARTED",
          sessionId: session.sessionId,
          source: session.source,
          maximumChunkBytes: MAX_LIBRARY_CORE_EXTERNAL_EXPORT_CHUNK_BYTES,
        });
        break;
      }

      case "READ_LIBRARY_CORE_EXTERNAL_EXPORT_CHUNK": {
        const chunk = await readLibraryCoreExternalExportChunk(
          req.sessionId,
          req.offset,
        );
        const response: WorkerResponse = {
          reqId: req.reqId,
          type: "LIBRARY_CORE_EXTERNAL_EXPORT_CHUNK",
          sessionId: chunk.session.sessionId,
          source: chunk.session.source,
          offset: req.offset,
          nextOffset: chunk.nextOffset,
          bytes: chunk.bytes,
          done: chunk.done,
        };
        sendTransferred(response, [chunk.bytes.buffer]);
        break;
      }

      case "CONFIRM_LIBRARY_CORE_EXTERNAL_EXPORT": {
        const session = await requireCurrentExternalExport(req.sessionId);
        send({
          reqId: req.reqId,
          type: "LIBRARY_CORE_EXTERNAL_EXPORT_CONFIRMED",
          sessionId: session.sessionId,
          source: session.source,
        });
        break;
      }

      case "CANCEL_LIBRARY_CORE_EXTERNAL_EXPORT":
        validateExternalExportSessionId(req.sessionId);
        if (
          libraryCoreExternalExportSession &&
          libraryCoreExternalExportSession.sessionId !== req.sessionId
        ) {
          throw new Error(
            `Library Core external export session ${libraryCoreExternalExportSession.sessionId} is active`,
          );
        }
        libraryCoreExternalExportSession = null;
        ack(req.reqId);
        break;

      case "UPDATE_RELAY_CLIENT_COUNT":
        relayClientCount = req.count;
        ack(req.reqId);
        break;

      default: {
        const _exhaustive: never = req;
        void _exhaustive;
        ack(
          (req as WorkerRequest).reqId,
          `Unknown request type: ${(req as { type: string }).type}`,
        );
      }
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const errorCode: WorkerErrorCode | undefined =
      err instanceof CorruptDocumentError
        ? err.code
        : err instanceof DocumentLoadFailedError
          ? err.code
          : err instanceof StaleAutomergePersistenceStateError
            ? "STALE_DOCUMENT_REVISION"
            : err instanceof AutomergePersistenceError
              ? err.code
              : undefined;
    if (err instanceof AutomergePersistenceError) {
      persistenceFailure = err;
      acceptingRequests = false;
    }
    emitWorkerTrace(
      `[automerge-worker] error op=${req.type} reqId=${req.reqId}` +
        ` wait_ms=${formatMs(waitMs)}` +
        ` process_ms=${formatMs(performance.now() - startedAt)}` +
        ` message=${message}`,
      "error",
    );
    ack(req.reqId, message, errorCode);
    return;
  }

  const processMs = performance.now() - startedAt;
  if (
    req.type === "UPDATE_PREFERENCES" ||
    waitMs >= SLOW_QUEUE_WAIT_MS ||
    processMs >= SLOW_REQUEST_PROCESS_MS
  ) {
    emitWorkerTrace(
      `[automerge-worker] complete op=${req.type} reqId=${req.reqId}` +
        ` wait_ms=${formatMs(waitMs)}` +
        ` process_ms=${formatMs(processMs)}` +
        ` total_ms=${formatMs(performance.now() - enqueuedAt)}`,
    );
  }
}

function enqueueRequest(req: WorkerRequest): void {
  const enqueuedAt = performance.now();
  queuedRequestCount += 1;
  requestChain = requestChain
    .then(() => handleRequest(req, enqueuedAt))
    .catch((error) => {
      const message = error instanceof Error ? error.message : String(error);
      emitWorkerTrace(
        `[automerge-worker] queue failure op=${req.type} reqId=${req.reqId} message=${message}`,
        "error",
      );
      ack(req.reqId, message);
    })
    .finally(() => {
      queuedRequestCount = Math.max(0, queuedRequestCount - 1);
      scheduleDocIdleUnload();
    });
}

// ---------------------------------------------------------------------------
// Message handler
// ---------------------------------------------------------------------------

self.onmessage = (event: MessageEvent<WorkerRequest>) => {
  const req = event.data;
  if (persistenceFailure) {
    ack(req.reqId, persistenceFailure.message, "AUTOMERGE_PERSISTENCE_FAILED");
    return;
  }
  if (req.type === "QUIESCE") {
    acceptingRequests = false;
    enqueueRequest(req);
    return;
  }
  if (!acceptingRequests && req.type !== "CLEAR_LOCAL") {
    ack(req.reqId, "Automerge worker is quiesced for factory reset");
    return;
  }
  if (req.type === "UPDATE_RELAY_CLIENT_COUNT") {
    relayClientCount = req.count;
    return;
  }

  enqueueRequest(req);
};

// Signal the main thread that the module finished loading and the onmessage
// handler is installed. Without this, messages sent before evaluation completes
// are silently dropped in Vite's dev-mode module workers.
self.postMessage({ type: "READY" } satisfies WorkerResponse);

export {};
