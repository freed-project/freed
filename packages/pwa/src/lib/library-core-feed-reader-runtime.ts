import {
  LIBRARY_CORE_FEED_RECOMMENDATION_ORDER_SCHEMA_VERSION,
  decodeLibraryCoreFeedBrowsePageCursorV1,
  decodeLibraryCoreFeedPageCursorV1,
  encodeLibraryCoreFeedBrowsePageCursorV1,
  encodeLibraryCoreFeedPageCursorV1,
  parseLibraryCoreFeedBrowseFilterV1,
  parseLibraryCoreFeedBrowsePageRequestV1,
  parseLibraryCoreFeedBrowsePageResponseV1,
  parseLibraryCoreFeedCardV1,
  parseLibraryCoreFeedPageRequestV1,
  parseLibraryCoreFeedPageResponseV1,
  parseLibraryCoreFeedPageSourceV1,
  type LibraryCoreFeedBrowseFilterV1,
  type LibraryCoreFeedBrowsePageCursorV1,
  type LibraryCoreFeedBrowsePageRequestV1,
  type LibraryCoreFeedBrowsePageResponseV1,
  type LibraryCoreFeedCardV1,
  type LibraryCoreFeedPageCursorV1,
  type LibraryCoreFeedPageRequestV1,
  type LibraryCoreFeedPageResponseV1,
  type LibraryCoreFeedPageSourceV1,
} from "@freed/shared/library-core";
import {
  lowerHex,
  requestResult,
  transactionDone,
} from "./library-core-indexeddb";

const DATABASE_VERSION = 2;
const GENERATIONS_STORE = "generations";
const ROWS_STORE = "feed_rows";
const BATCHES_STORE = "generation_batches";
const CONTROL_STORE = "control";
const BROWSE_GENERATIONS_STORE = "browse_generations";
const BROWSE_ROWS_STORE = "browse_rows";
const BROWSE_BATCHES_STORE = "browse_generation_batches";
const BROWSE_CONTROL_STORE = "browse_control";
const SELECTED_GENERATION_KEY = "selected_generation";
const SELECTED_BROWSE_GENERATION_KEY = "selected_browse_generation";
const SESSION_MAXIMUM_AGE_MS = 60_000;
const MAXIMUM_READER_SESSIONS = 2;
const MAXIMUM_STAGING_PAGE_ROWS = 128;
const MAXIMUM_RETAINED_GENERATIONS = 2;
const MAXIMUM_SAFE_SORT_KEY = Number.MAX_SAFE_INTEGER;
const TEXT_ENCODER = new TextEncoder();

type GenerationStatus = "staging" | "complete";

interface GenerationStoreNames {
  readonly batches: string;
  readonly control: string;
  readonly generations: string;
  readonly rows: string;
  readonly selectedKey:
    | typeof SELECTED_GENERATION_KEY
    | typeof SELECTED_BROWSE_GENERATION_KEY;
}

const DEFAULT_GENERATION_STORES: GenerationStoreNames = Object.freeze({
  batches: BATCHES_STORE,
  control: CONTROL_STORE,
  generations: GENERATIONS_STORE,
  rows: ROWS_STORE,
  selectedKey: SELECTED_GENERATION_KEY,
});

const BROWSE_GENERATION_STORES: GenerationStoreNames = Object.freeze({
  batches: BROWSE_BATCHES_STORE,
  control: BROWSE_CONTROL_STORE,
  generations: BROWSE_GENERATIONS_STORE,
  rows: BROWSE_ROWS_STORE,
  selectedKey: SELECTED_BROWSE_GENERATION_KEY,
});

interface GenerationRecord extends LibraryCoreFeedPageSourceV1 {
  readonly generationId: LibraryCoreFeedPageSourceV1["generationId"];
  readonly status: GenerationStatus;
  readonly totalCount: number;
  readonly writtenCount: number;
  readonly nextBatchIndex: number;
  readonly selectedSequence: number | null;
}

interface BrowseGenerationRecord extends GenerationRecord {
  readonly filter: LibraryCoreFeedBrowseFilterV1;
  readonly rankingClockMs: number;
  readonly recommendationOrderSchemaVersion:
    typeof LIBRARY_CORE_FEED_RECOMMENDATION_ORDER_SCHEMA_VERSION;
}

interface FeedRowRecord {
  readonly generationId: string;
  readonly orderKey: string;
  readonly globalId: string;
  readonly sortAt: number;
  readonly row: LibraryCoreFeedCardV1;
}

interface BrowseFeedRowRecord {
  readonly generationId: string;
  readonly orderKey: string;
  readonly globalId: string;
  readonly priority: number;
  readonly publishedAt: number;
  readonly sourceSequence: number;
  readonly row: LibraryCoreFeedCardV1;
}

interface GenerationBatchRecord {
  readonly generationId: string;
  readonly batchIndex: number;
  readonly rowCount: number;
  readonly rowsDigest: string;
  readonly writtenCountAfter: number;
}

interface SelectedGenerationRecord {
  readonly key:
    | typeof SELECTED_GENERATION_KEY
    | typeof SELECTED_BROWSE_GENERATION_KEY;
  readonly generationId: string;
  readonly selectionSequence: number;
}

interface ReaderSession {
  readonly source: LibraryCoreFeedPageSourceV1;
  readonly expiresAtMs: number;
  lastRequest: ReaderRequestIdentity | null;
}

interface BrowseReaderSession extends ReaderSession {
  readonly filter: LibraryCoreFeedBrowseFilterV1;
  readonly rankingClockMs: number;
  readonly recommendationOrderSchemaVersion:
    typeof LIBRARY_CORE_FEED_RECOMMENDATION_ORDER_SCHEMA_VERSION;
}

interface ReaderRequestIdentity {
  readonly cancellationId: string;
  readonly cursor: string | null;
  readonly limit: number;
}

interface AppendStoredGenerationPageInput {
  readonly batchIndex: number;
  readonly label: string;
  readonly rowCount: number;
  readonly rowsDigest: string;
  readonly source: LibraryCoreFeedPageSourceV1;
  readonly stores: GenerationStoreNames;
  readonly writeRows: (store: IDBObjectStore) => void;
}

type SessionAdmission =
  | Readonly<{
      ok: true;
      cursor: LibraryCoreFeedPageCursorV1 | null;
    }>
  | Readonly<{
      ok: false;
      result: PwaLibraryCoreFeedReaderResult;
    }>;

type BrowseSessionAdmission =
  | Readonly<{
      ok: true;
      cursor: LibraryCoreFeedBrowsePageCursorV1 | null;
    }>
  | Readonly<{
      ok: false;
      result: PwaLibraryCoreFeedReaderFailure;
    }>;

export type PwaLibraryCoreFeedReaderErrorCode =
  | "RUNTIME_INACTIVE"
  | "CURSOR_STALE"
  | "SESSION_LIMIT"
  | "INVALID_REQUEST"
  | "RESPONSE_TOO_LARGE"
  | "READER_UNAVAILABLE";

export type PwaLibraryCoreFeedReaderFailure = Readonly<{
  ok: false;
  code: PwaLibraryCoreFeedReaderErrorCode;
  message: string;
}>;

export type PwaLibraryCoreFeedReaderResult =
  | Readonly<{
      ok: true;
      value: LibraryCoreFeedPageResponseV1;
    }>
  | PwaLibraryCoreFeedReaderFailure;

export type PwaLibraryCoreFeedBrowseReaderResult =
  | Readonly<{
      ok: true;
      value: LibraryCoreFeedBrowsePageResponseV1;
    }>
  | PwaLibraryCoreFeedReaderFailure;

export interface PwaLibraryCoreFeedReaderRuntimeOptions {
  readonly databaseName: string;
  readonly indexedDb: IDBFactory;
  readonly keyRange: typeof IDBKeyRange;
  readonly subtle: SubtleCrypto;
  readonly now?: () => number;
}

export interface BeginPwaLibraryCoreFeedGenerationInput {
  readonly source: LibraryCoreFeedPageSourceV1;
  readonly totalCount: number;
}

export interface AppendPwaLibraryCoreFeedGenerationPageInput {
  readonly source: LibraryCoreFeedPageSourceV1;
  readonly batchIndex: number;
  readonly rows: readonly LibraryCoreFeedCardV1[];
}

export interface PwaLibraryCoreBrowseProjectedRowV1 {
  readonly priority: number;
  readonly row: LibraryCoreFeedCardV1;
  readonly sourceSequence: number;
}

export interface BeginPwaLibraryCoreBrowseGenerationInput {
  readonly filter: LibraryCoreFeedBrowseFilterV1;
  readonly rankingClockMs: number;
  readonly recommendationOrderSchemaVersion:
    typeof LIBRARY_CORE_FEED_RECOMMENDATION_ORDER_SCHEMA_VERSION;
  readonly source: LibraryCoreFeedPageSourceV1;
  readonly totalCount: number;
}

export interface AppendPwaLibraryCoreBrowseGenerationPageInput {
  readonly source: LibraryCoreFeedPageSourceV1;
  readonly batchIndex: number;
  readonly rows: readonly PwaLibraryCoreBrowseProjectedRowV1[];
}

export type PwaLibraryCoreFeedGenerationState = "complete" | "staging";

function openCursor(
  request: IDBRequest<IDBCursorWithValue | null>,
): Promise<IDBCursorWithValue | null> {
  return requestResult(request);
}

function reverseSortKey(sortAt: number): string {
  return (MAXIMUM_SAFE_SORT_KEY - sortAt).toString(16).padStart(14, "0");
}

function feedRowOrderKey(row: LibraryCoreFeedCardV1): string {
  const sortAt = row.publishedAt ?? 0;
  return `${reverseSortKey(sortAt)}\u0000${lowerHex(
    TEXT_ENCODER.encode(row.globalId).buffer,
  )}`;
}

function forwardSortKey(value: number): string {
  return value.toString(16).padStart(14, "0");
}

function browseFeedRowOrderKey(
  value: PwaLibraryCoreBrowseProjectedRowV1,
): string {
  return `${(100 - value.priority).toString(16).padStart(2, "0")}\u0000${
    reverseSortKey(value.row.publishedAt ?? 0)
  }\u0000${forwardSortKey(value.sourceSequence)}\u0000${lowerHex(
    TEXT_ENCODER.encode(value.row.globalId).buffer,
  )}`;
}

function browseCursorOrderKey(
  value: LibraryCoreFeedBrowsePageCursorV1,
): string {
  return `${(100 - value.priority).toString(16).padStart(2, "0")}\u0000${
    reverseSortKey(value.publishedAt)
  }\u0000${forwardSortKey(value.sourceSequence)}\u0000${lowerHex(
    TEXT_ENCODER.encode(value.globalId).buffer,
  )}`;
}

function generationRange(
  keyRange: typeof IDBKeyRange,
  generationId: string,
): IDBKeyRange {
  return keyRange.bound(
    [generationId, ""],
    [generationId, "\uffff"],
  );
}

function sourceMatches(
  left: LibraryCoreFeedPageSourceV1,
  right: LibraryCoreFeedPageSourceV1,
): boolean {
  return (
    left.generationId === right.generationId &&
    left.transitionSequence === right.transitionSequence &&
    left.projectionRevision === right.projectionRevision
  );
}

function sourceOfGeneration(
  generation: GenerationRecord,
): LibraryCoreFeedPageSourceV1 {
  return Object.freeze({
    generationId: generation.generationId,
    projectionRevision: generation.projectionRevision,
    transitionSequence: generation.transitionSequence,
  });
}

function readerFailure(
  code: PwaLibraryCoreFeedReaderErrorCode,
  message: string,
): PwaLibraryCoreFeedReaderFailure {
  return Object.freeze({ ok: false, code, message });
}

function snapshotSource(
  value: unknown,
): LibraryCoreFeedPageSourceV1 {
  const parsed = parseLibraryCoreFeedPageSourceV1(value);
  if (!parsed.ok) {
    throw new TypeError(parsed.error);
  }
  return parsed.value;
}

function snapshotBrowseFilter(
  value: unknown,
): LibraryCoreFeedBrowseFilterV1 {
  const parsed = parseLibraryCoreFeedBrowseFilterV1(value);
  if (!parsed.ok) throw new TypeError(parsed.error);
  return parsed.value;
}

function snapshotRows(
  value: readonly LibraryCoreFeedCardV1[],
): readonly LibraryCoreFeedCardV1[] {
  if (
    !Array.isArray(value) ||
    value.length === 0 ||
    value.length > MAXIMUM_STAGING_PAGE_ROWS
  ) {
    throw new TypeError(
      "a PWA Library Core generation page must contain 1 through 128 rows",
    );
  }

  const rows: LibraryCoreFeedCardV1[] = [];
  const orderKeys = new Set<string>();
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (!descriptor || !descriptor.enumerable || !("value" in descriptor)) {
      throw new TypeError("generation rows must be one dense data array");
    }
    const parsed = parseLibraryCoreFeedCardV1(descriptor.value);
    if (!parsed.ok) throw new TypeError(parsed.error);
    const orderKey = feedRowOrderKey(parsed.value);
    if (orderKeys.has(orderKey)) {
      throw new TypeError("generation page repeats one feed row");
    }
    orderKeys.add(orderKey);
    rows.push(parsed.value);
  }
  return Object.freeze(rows);
}

function snapshotBrowseRows(
  value: readonly PwaLibraryCoreBrowseProjectedRowV1[],
): readonly PwaLibraryCoreBrowseProjectedRowV1[] {
  if (
    !Array.isArray(value) ||
    value.length === 0 ||
    value.length > MAXIMUM_STAGING_PAGE_ROWS
  ) {
    throw new TypeError(
      "a PWA Library Core browse generation page must contain 1 through 128 rows",
    );
  }

  const rows: PwaLibraryCoreBrowseProjectedRowV1[] = [];
  const orderKeys = new Set<string>();
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (!descriptor || !descriptor.enumerable || !("value" in descriptor)) {
      throw new TypeError("browse generation rows must be one dense data array");
    }
    const candidate = descriptor.value as Partial<PwaLibraryCoreBrowseProjectedRowV1>;
    const parsed = parseLibraryCoreFeedCardV1(candidate?.row);
    if (!parsed.ok) throw new TypeError(parsed.error);
    if (
      !Number.isSafeInteger(candidate.priority) ||
      (candidate.priority ?? -1) < 0 ||
      (candidate.priority ?? 101) > 100
    ) {
      throw new TypeError("browse generation row priority must be 0 through 100");
    }
    if (
      !Number.isSafeInteger(candidate.sourceSequence) ||
      (candidate.sourceSequence ?? -1) < 0
    ) {
      throw new TypeError(
        "browse generation row sourceSequence must be nonnegative and safe",
      );
    }
    const row = Object.freeze({
      priority: candidate.priority,
      row: parsed.value,
      sourceSequence: candidate.sourceSequence,
    }) as PwaLibraryCoreBrowseProjectedRowV1;
    const orderKey = browseFeedRowOrderKey(row);
    if (orderKeys.has(orderKey)) {
      throw new TypeError("browse generation page repeats one ordered row");
    }
    orderKeys.add(orderKey);
    rows.push(row);
  }
  return Object.freeze(rows);
}

/**
 * Dormant row-oriented browser implementation of `feed_page_v1`.
 *
 * The Automerge worker can populate it only through an explicit dormant
 * materialization request. No product reader calls that request or this
 * runtime yet, so Automerge remains authoritative until governed read cutover.
 */
class PwaLibraryCoreFeedReaderRuntime {
  readonly #databaseName: string;
  readonly #indexedDb: IDBFactory;
  readonly #keyRange: typeof IDBKeyRange;
  readonly #subtle: SubtleCrypto;
  readonly #now: () => number;
  readonly #sessions = new Map<string, ReaderSession>();
  readonly #browseSessions = new Map<string, BrowseReaderSession>();
  #databasePromise: Promise<IDBDatabase> | null = null;
  #quiesced = false;

  constructor(options: PwaLibraryCoreFeedReaderRuntimeOptions) {
    if (!options.databaseName) {
      throw new TypeError("Library Core PWA database name is required");
    }
    this.#databaseName = options.databaseName;
    this.#indexedDb = options.indexedDb;
    this.#keyRange = options.keyRange;
    this.#subtle = options.subtle;
    this.#now = options.now ?? Date.now;
  }

  async beginGeneration(
    input: BeginPwaLibraryCoreFeedGenerationInput,
  ): Promise<PwaLibraryCoreFeedGenerationState> {
    return this.#beginStoredGeneration(
      input,
      DEFAULT_GENERATION_STORES,
      "generation",
    );
  }

  async beginBrowseGeneration(
    input: BeginPwaLibraryCoreBrowseGenerationInput,
  ): Promise<PwaLibraryCoreFeedGenerationState> {
    const filter = snapshotBrowseFilter(input.filter);
    if (
      !Number.isSafeInteger(input.rankingClockMs) ||
      input.rankingClockMs < 0 ||
      input.recommendationOrderSchemaVersion !==
        LIBRARY_CORE_FEED_RECOMMENDATION_ORDER_SCHEMA_VERSION
    ) {
      throw new TypeError("browse generation binding is invalid");
    }
    return this.#beginStoredGeneration(
      { ...input, filter },
      BROWSE_GENERATION_STORES,
      "browse generation",
    );
  }

  async appendGenerationPage(
    input: AppendPwaLibraryCoreFeedGenerationPageInput,
  ): Promise<void> {
    this.#requireAvailable();
    const source = snapshotSource(input.source);
    if (!Number.isSafeInteger(input.batchIndex) || input.batchIndex < 0) {
      throw new TypeError("generation batchIndex must be nonnegative and safe");
    }
    const rows = snapshotRows(input.rows);
    await this.#appendStoredGenerationPage({
      batchIndex: input.batchIndex,
      label: "generation",
      rowCount: rows.length,
      rowsDigest: await this.#rowsDigest(rows),
      source,
      stores: DEFAULT_GENERATION_STORES,
      writeRows(feedRows) {
        for (const row of rows) {
          const sortAt = row.publishedAt ?? 0;
          feedRows.add({
            generationId: source.generationId,
            orderKey: feedRowOrderKey(row),
            globalId: row.globalId,
            sortAt,
            row,
          } satisfies FeedRowRecord);
        }
      },
    });
  }

  async appendBrowseGenerationPage(
    input: AppendPwaLibraryCoreBrowseGenerationPageInput,
  ): Promise<void> {
    this.#requireAvailable();
    const source = snapshotSource(input.source);
    if (!Number.isSafeInteger(input.batchIndex) || input.batchIndex < 0) {
      throw new TypeError(
        "browse generation batchIndex must be nonnegative and safe",
      );
    }
    const rows = snapshotBrowseRows(input.rows);
    await this.#appendStoredGenerationPage({
      batchIndex: input.batchIndex,
      label: "browse generation",
      rowCount: rows.length,
      rowsDigest: await this.#rowsDigest(rows),
      source,
      stores: BROWSE_GENERATION_STORES,
      writeRows(feedRows) {
        for (const projected of rows) {
          feedRows.add({
            generationId: source.generationId,
            orderKey: browseFeedRowOrderKey(projected),
            globalId: projected.row.globalId,
            priority: projected.priority,
            publishedAt: projected.row.publishedAt ?? 0,
            sourceSequence: projected.sourceSequence,
            row: projected.row,
          } satisfies BrowseFeedRowRecord);
        }
      },
    });
  }

  async finalizeGeneration(
    sourceValue: LibraryCoreFeedPageSourceV1,
  ): Promise<void> {
    const source = await this.#finalizeStoredGeneration(
      sourceValue,
      DEFAULT_GENERATION_STORES,
      "generation",
    );
    this.#sessions.clear();
    await this.#pruneStoredGenerations(
      source.generationId,
      DEFAULT_GENERATION_STORES,
    );
  }

  async finalizeBrowseGeneration(
    sourceValue: LibraryCoreFeedPageSourceV1,
  ): Promise<void> {
    const source = await this.#finalizeStoredGeneration(
      sourceValue,
      BROWSE_GENERATION_STORES,
      "browse generation",
    );
    this.#browseSessions.clear();
    await this.#pruneStoredGenerations(
      source.generationId,
      BROWSE_GENERATION_STORES,
    );
  }

  async readFeedPage(
    requestValue: unknown,
  ): Promise<PwaLibraryCoreFeedReaderResult> {
    if (this.#quiesced) {
      return readerFailure("READER_UNAVAILABLE", "reader is quiesced");
    }
    const request = parseLibraryCoreFeedPageRequestV1(requestValue);
    if (!request.ok) {
      return readerFailure("INVALID_REQUEST", request.error);
    }
    this.#expireSessions();

    try {
      const database = await this.#database();
      const transaction = database.transaction(
        [GENERATIONS_STORE, ROWS_STORE, CONTROL_STORE],
        "readonly",
      );
      const control = transaction.objectStore(CONTROL_STORE);
      const generations = transaction.objectStore(GENERATIONS_STORE);
      const rowsStore = transaction.objectStore(ROWS_STORE);
      const selected = (await requestResult(
        control.get(SELECTED_GENERATION_KEY),
      )) as SelectedGenerationRecord | undefined;
      if (!selected) {
        await transactionDone(transaction);
        return readerFailure(
          "RUNTIME_INACTIVE",
          "no complete PWA Library Core generation is selected",
        );
      }
      const generation = (await requestResult(
        generations.get(selected.generationId),
      )) as GenerationRecord | undefined;
      if (
        !generation ||
        generation.status !== "complete" ||
        generation.selectedSequence !== selected.selectionSequence
      ) {
        transaction.abort();
        return readerFailure(
          "READER_UNAVAILABLE",
          "selected PWA Library Core generation is incomplete or inconsistent",
        );
      }
      const source = sourceOfGeneration(generation);
      const sessionResult = this.#admitSession(request.value, source);
      if (!sessionResult.ok) {
        transaction.abort();
        return sessionResult.result;
      }

      let lowerOrderKey = "";
      if (request.value.cursor !== null) {
        const cursor = sessionResult.cursor;
        if (!cursor) {
          transaction.abort();
          return readerFailure("CURSOR_STALE", "cursor is invalid or stale");
        }
        lowerOrderKey = `${reverseSortKey(cursor.sortAt)}\u0000${lowerHex(
          TEXT_ENCODER.encode(cursor.globalId).buffer,
        )}`;
      }
      const range = this.#keyRange.bound(
        [source.generationId, lowerOrderKey],
        [source.generationId, "\uffff"],
        request.value.cursor !== null,
        false,
      );
      const rows: LibraryCoreFeedCardV1[] = [];
      let cursor = await openCursor(rowsStore.openCursor(range, "next"));
      while (cursor && rows.length < request.value.limit) {
        const record = cursor.value as FeedRowRecord;
        const parsed = parseLibraryCoreFeedCardV1(record.row);
        if (!parsed.ok) {
          transaction.abort();
          return readerFailure("READER_UNAVAILABLE", parsed.error);
        }
        rows.push(parsed.value);
        cursor.continue();
        cursor = await openCursor(cursor.request);
      }
      await transactionDone(transaction);

      const finalRow = rows[rows.length - 1];
      const nextCursor =
        finalRow && rows.length === request.value.limit
          ? encodeLibraryCoreFeedPageCursorV1({
              ...source,
              sortAt: finalRow.publishedAt ?? 0,
              globalId: finalRow.globalId,
            })
          : null;
      const responseValue = {
        nextCursor,
        queryId: request.value.queryId,
        rows,
        schemaVersion: request.value.schemaVersion,
        source,
        totalCount: generation.totalCount,
      };
      const response = parseLibraryCoreFeedPageResponseV1(
        responseValue,
        request.value,
      );
      if (!response.ok) {
        return readerFailure(
          response.error.includes("exceeds")
            ? "RESPONSE_TOO_LARGE"
            : "READER_UNAVAILABLE",
          response.error,
        );
      }
      const session = this.#sessions.get(request.value.readerSessionId);
      if (!session) {
        return readerFailure(
          "CURSOR_STALE",
          "reader session expired before its response completed",
        );
      }
      session.lastRequest = {
        cancellationId: request.value.cancellationId,
        cursor: request.value.cursor,
        limit: request.value.limit,
      };
      if (nextCursor === null) {
        this.#sessions.delete(request.value.readerSessionId);
      }
      return Object.freeze({ ok: true, value: response.value });
    } catch (error) {
      return readerFailure(
        "READER_UNAVAILABLE",
        error instanceof Error ? error.message : "IndexedDB reader failed",
      );
    }
  }

  async readBrowseFeedPage(
    requestValue: unknown,
  ): Promise<PwaLibraryCoreFeedBrowseReaderResult> {
    if (this.#quiesced) {
      return readerFailure("READER_UNAVAILABLE", "reader is quiesced");
    }
    const request = parseLibraryCoreFeedBrowsePageRequestV1(requestValue);
    if (!request.ok) {
      return readerFailure("INVALID_REQUEST", request.error);
    }
    this.#expireSessions();

    try {
      const database = await this.#database();
      const transaction = database.transaction(
        [
          BROWSE_GENERATIONS_STORE,
          BROWSE_ROWS_STORE,
          BROWSE_CONTROL_STORE,
        ],
        "readonly",
      );
      const selected = (await requestResult(
        transaction.objectStore(BROWSE_CONTROL_STORE).get(
          SELECTED_BROWSE_GENERATION_KEY,
        ),
      )) as SelectedGenerationRecord | undefined;
      if (!selected) {
        await transactionDone(transaction);
        return readerFailure(
          "RUNTIME_INACTIVE",
          "no complete PWA Library Core browse generation is selected",
        );
      }
      const generation = (await requestResult(
        transaction.objectStore(BROWSE_GENERATIONS_STORE).get(
          selected.generationId,
        ),
      )) as BrowseGenerationRecord | undefined;
      if (
        !generation ||
        generation.status !== "complete" ||
        generation.selectedSequence !== selected.selectionSequence ||
        generation.rankingClockMs !== request.value.rankingClockMs ||
        generation.recommendationOrderSchemaVersion !==
          request.value.recommendationOrderSchemaVersion ||
        JSON.stringify(generation.filter) !==
          JSON.stringify(request.value.filter)
      ) {
        transaction.abort();
        return readerFailure(
          "CURSOR_STALE",
          "selected browse generation does not match the requested query",
        );
      }
      const source = sourceOfGeneration(generation);
      const sessionResult = this.#admitBrowseSession(
        request.value,
        source,
        generation,
      );
      if (!sessionResult.ok) {
        transaction.abort();
        return sessionResult.result;
      }

      let lowerOrderKey = "";
      if (sessionResult.cursor) {
        lowerOrderKey = browseCursorOrderKey(sessionResult.cursor);
      }
      const range = this.#keyRange.bound(
        [source.generationId, lowerOrderKey],
        [source.generationId, "\uffff"],
        request.value.cursor !== null,
        false,
      );
      const rowsStore = transaction.objectStore(BROWSE_ROWS_STORE);
      const rows: LibraryCoreFeedCardV1[] = [];
      let finalRecord: BrowseFeedRowRecord | null = null;
      let cursor = await openCursor(rowsStore.openCursor(range, "next"));
      while (cursor && rows.length < request.value.limit) {
        const record = cursor.value as BrowseFeedRowRecord;
        const parsed = parseLibraryCoreFeedCardV1(record.row);
        if (
          !parsed.ok ||
          record.globalId !== parsed.value.globalId ||
          record.publishedAt !== (parsed.value.publishedAt ?? 0) ||
          !Number.isSafeInteger(record.priority) ||
          record.priority < 0 ||
          record.priority > 100 ||
          !Number.isSafeInteger(record.sourceSequence) ||
          record.sourceSequence < 0 ||
          record.orderKey !== browseFeedRowOrderKey({
            priority: record.priority,
            row: parsed.value,
            sourceSequence: record.sourceSequence,
          })
        ) {
          transaction.abort();
          return readerFailure(
            "READER_UNAVAILABLE",
            parsed.ok ? "stored browse row ordering is inconsistent" : parsed.error,
          );
        }
        rows.push(parsed.value);
        finalRecord = record;
        cursor.continue();
        cursor = await openCursor(cursor.request);
      }
      await transactionDone(transaction);
      const nextCursor =
        finalRecord && rows.length === request.value.limit
          ? encodeLibraryCoreFeedBrowsePageCursorV1({
              ...source,
              priority: finalRecord.priority,
              publishedAt: finalRecord.publishedAt,
              sourceSequence: finalRecord.sourceSequence,
              globalId: rows[rows.length - 1]!.globalId,
            })
          : null;
      const nextOrder = nextCursor && finalRecord
        ? {
            globalId: rows[rows.length - 1]!.globalId,
            priority: finalRecord.priority,
            publishedAt: finalRecord.publishedAt,
            sourceSequence: finalRecord.sourceSequence,
          }
        : null;
      const response = parseLibraryCoreFeedBrowsePageResponseV1({
        filter: generation.filter,
        nextCursor,
        nextOrder,
        queryId: request.value.queryId,
        rankingClockMs: generation.rankingClockMs,
        recommendationOrderSchemaVersion:
          generation.recommendationOrderSchemaVersion,
        rows,
        schemaVersion: request.value.schemaVersion,
        source,
        totalCount: generation.totalCount,
      }, request.value);
      if (!response.ok) {
        return readerFailure(
          response.error.includes("exceeds")
            ? "RESPONSE_TOO_LARGE"
            : "READER_UNAVAILABLE",
          response.error,
        );
      }
      const session = this.#browseSessions.get(request.value.readerSessionId);
      if (!session) {
        return readerFailure(
          "CURSOR_STALE",
          "browse reader session expired before its response completed",
        );
      }
      session.lastRequest = {
        cancellationId: request.value.cancellationId,
        cursor: request.value.cursor,
        limit: request.value.limit,
      };
      if (nextCursor === null) {
        this.#browseSessions.delete(request.value.readerSessionId);
      }
      return Object.freeze({ ok: true, value: response.value });
    } catch (error) {
      return readerFailure(
        "READER_UNAVAILABLE",
        error instanceof Error ? error.message : "IndexedDB browse reader failed",
      );
    }
  }

  cancelReader(
    readerSessionId: string,
    cancellationId: string,
  ): boolean {
    const request = parseLibraryCoreFeedPageRequestV1({
      cancellationId,
      cursor: null,
      limit: 1,
      queryId: "feed_page_v1",
      readerSessionId,
      schemaVersion: 1,
    });
    if (!request.ok) return false;
    const session = this.#sessions.get(readerSessionId) ??
      this.#browseSessions.get(readerSessionId);
    if (session?.lastRequest?.cancellationId !== cancellationId) return false;
    const deletedDefault = this.#sessions.delete(readerSessionId);
    const deletedBrowse = this.#browseSessions.delete(readerSessionId);
    return deletedDefault || deletedBrowse;
  }

  async quiesce(): Promise<void> {
    this.#quiesced = true;
    this.#sessions.clear();
    this.#browseSessions.clear();
    const databasePromise = this.#databasePromise;
    this.#databasePromise = null;
    if (!databasePromise) return;
    const database = await databasePromise;
    database.close();
  }

  #admitSession(
    request: LibraryCoreFeedPageRequestV1,
    source: LibraryCoreFeedPageSourceV1,
  ): SessionAdmission {
    const existing = this.#sessions.get(request.readerSessionId);
    if (existing) {
      if (!sourceMatches(existing.source, source)) {
        this.#sessions.delete(request.readerSessionId);
        return {
          ok: false,
          result: readerFailure(
            "CURSOR_STALE",
            "reader session identity or source is no longer selected",
          ),
        };
      }
      if (
        existing.lastRequest?.cancellationId === request.cancellationId &&
        (existing.lastRequest.cursor !== request.cursor ||
          existing.lastRequest.limit !== request.limit)
      ) {
        return {
          ok: false,
          result: readerFailure(
            "INVALID_REQUEST",
            "cancellation identity was replayed for a different request",
          ),
        };
      }
    } else if (this.#browseSessions.has(request.readerSessionId)) {
      return {
        ok: false,
        result: readerFailure(
          "INVALID_REQUEST",
          "reader session identity is already used by another query",
        ),
      };
    } else if (request.cursor !== null) {
      return {
        ok: false,
        result: readerFailure(
          "CURSOR_STALE",
          "cursor cannot resume an absent or expired reader session",
        ),
      };
    } else if (
      this.#sessions.size + this.#browseSessions.size >=
        MAXIMUM_READER_SESSIONS
    ) {
      return {
        ok: false,
        result: readerFailure(
          "SESSION_LIMIT",
          "PWA Library Core reader session limit reached",
        ),
      };
    } else {
      this.#sessions.set(request.readerSessionId, {
        source,
        expiresAtMs: this.#now() + SESSION_MAXIMUM_AGE_MS,
        lastRequest: null,
      });
    }

    if (request.cursor === null) return Object.freeze({ ok: true, cursor: null });
    const cursor = decodeLibraryCoreFeedPageCursorV1(request.cursor);
    if (!cursor.ok || !sourceMatches(cursor.value, source)) {
      return {
        ok: false,
        result: readerFailure(
          "CURSOR_STALE",
          "cursor source is no longer selected",
        ),
      };
    }
    return Object.freeze({ ok: true, cursor: cursor.value });
  }

  #admitBrowseSession(
    request: LibraryCoreFeedBrowsePageRequestV1,
    source: LibraryCoreFeedPageSourceV1,
    generation: BrowseGenerationRecord,
  ): BrowseSessionAdmission {
    const existing = this.#browseSessions.get(request.readerSessionId);
    if (existing) {
      if (
        !sourceMatches(existing.source, source) ||
        existing.rankingClockMs !== request.rankingClockMs ||
        existing.recommendationOrderSchemaVersion !==
          request.recommendationOrderSchemaVersion ||
        JSON.stringify(existing.filter) !== JSON.stringify(request.filter)
      ) {
        this.#browseSessions.delete(request.readerSessionId);
        return {
          ok: false,
          result: readerFailure(
            "CURSOR_STALE",
            "browse reader session identity or query changed",
          ),
        };
      }
      if (
        existing.lastRequest?.cancellationId === request.cancellationId &&
        (existing.lastRequest.cursor !== request.cursor ||
          existing.lastRequest.limit !== request.limit)
      ) {
        return {
          ok: false,
          result: readerFailure(
            "INVALID_REQUEST",
            "cancellation identity was replayed for a different request",
          ),
        };
      }
    } else if (this.#sessions.has(request.readerSessionId)) {
      return {
        ok: false,
        result: readerFailure(
          "INVALID_REQUEST",
          "reader session identity is already used by another query",
        ),
      };
    } else if (request.cursor !== null) {
      return {
        ok: false,
        result: readerFailure(
          "CURSOR_STALE",
          "cursor cannot resume an absent or expired browse session",
        ),
      };
    } else if (
      this.#sessions.size + this.#browseSessions.size >=
        MAXIMUM_READER_SESSIONS
    ) {
      return {
        ok: false,
        result: readerFailure(
          "SESSION_LIMIT",
          "PWA Library Core reader session limit reached",
        ),
      };
    } else {
      this.#browseSessions.set(request.readerSessionId, {
        source,
        expiresAtMs: this.#now() + SESSION_MAXIMUM_AGE_MS,
        lastRequest: null,
        filter: generation.filter,
        rankingClockMs: generation.rankingClockMs,
        recommendationOrderSchemaVersion:
          generation.recommendationOrderSchemaVersion,
      });
    }
    if (request.cursor === null) return Object.freeze({ ok: true, cursor: null });
    const cursor = decodeLibraryCoreFeedBrowsePageCursorV1(request.cursor);
    if (!cursor.ok || !sourceMatches(cursor.value, source)) {
      return {
        ok: false,
        result: readerFailure(
          "CURSOR_STALE",
          "browse cursor source is no longer selected",
        ),
      };
    }
    return Object.freeze({ ok: true, cursor: cursor.value });
  }

  #expireSessions(): void {
    const now = this.#now();
    for (const [sessionId, session] of this.#sessions) {
      if (session.expiresAtMs <= now) this.#sessions.delete(sessionId);
    }
    for (const [sessionId, session] of this.#browseSessions) {
      if (session.expiresAtMs <= now) this.#browseSessions.delete(sessionId);
    }
  }

  #requireAvailable(): void {
    if (this.#quiesced) {
      throw new Error("PWA Library Core reader is quiesced");
    }
  }

  async #beginStoredGeneration(
    input:
      | BeginPwaLibraryCoreFeedGenerationInput
      | BeginPwaLibraryCoreBrowseGenerationInput,
    stores: GenerationStoreNames,
    label: string,
  ): Promise<PwaLibraryCoreFeedGenerationState> {
    this.#requireAvailable();
    const source = snapshotSource(input.source);
    if (!Number.isSafeInteger(input.totalCount) || input.totalCount < 0) {
      throw new TypeError(
        `${label} totalCount must be nonnegative and safe`,
      );
    }

    const database = await this.#database();
    const transaction = database.transaction(
      [stores.generations],
      "readwrite",
    );
    const store = transaction.objectStore(stores.generations);
    const browseBinding =
      "filter" in input
        ? Object.freeze({
            filter: snapshotBrowseFilter(input.filter),
            rankingClockMs: input.rankingClockMs,
            recommendationOrderSchemaVersion:
              input.recommendationOrderSchemaVersion,
          })
        : null;
    if (
      browseBinding &&
      (!Number.isSafeInteger(browseBinding.rankingClockMs) ||
        browseBinding.rankingClockMs < 0 ||
        browseBinding.recommendationOrderSchemaVersion !==
          LIBRARY_CORE_FEED_RECOMMENDATION_ORDER_SCHEMA_VERSION)
    ) {
      transaction.abort();
      throw new TypeError("browse generation binding is invalid");
    }
    const existing = (await requestResult(
      store.get(source.generationId),
    )) as GenerationRecord | undefined;
    if (existing) {
      const existingBrowse = existing as Partial<BrowseGenerationRecord>;
      if (
        sourceMatches(existing, source) &&
        existing.totalCount === input.totalCount &&
        (!browseBinding ||
          (existingBrowse.rankingClockMs === browseBinding.rankingClockMs &&
            existingBrowse.recommendationOrderSchemaVersion ===
              browseBinding.recommendationOrderSchemaVersion &&
            JSON.stringify(existingBrowse.filter) ===
              JSON.stringify(browseBinding.filter)))
      ) {
        await transactionDone(transaction);
        return existing.status;
      }
      transaction.abort();
      throw new Error(
        `${label} identity already exists with different state`,
      );
    }
    const generations = (await requestResult(
      store.getAll(),
    )) as GenerationRecord[];
    if (generations.some((generation) => generation.status === "staging")) {
      transaction.abort();
      throw new Error(
        `another PWA Library Core ${label} is still staging`,
      );
    }

    store.add({
      ...source,
      ...(browseBinding ?? {}),
      status: "staging",
      totalCount: input.totalCount,
      writtenCount: 0,
      nextBatchIndex: 0,
      selectedSequence: null,
    } satisfies GenerationRecord);
    await transactionDone(transaction);
    return "staging";
  }

  async #rowsDigest(value: unknown): Promise<string> {
    return lowerHex(
      await this.#subtle.digest(
        "SHA-256",
        TEXT_ENCODER.encode(JSON.stringify(value)),
      ),
    );
  }

  async #appendStoredGenerationPage(
    input: AppendStoredGenerationPageInput,
  ): Promise<void> {
    const database = await this.#database();
    const transaction = database.transaction(
      [input.stores.generations, input.stores.rows, input.stores.batches],
      "readwrite",
    );
    const generations = transaction.objectStore(input.stores.generations);
    const rows = transaction.objectStore(input.stores.rows);
    const batches = transaction.objectStore(input.stores.batches);
    const generation = (await requestResult(
      generations.get(input.source.generationId),
    )) as GenerationRecord | undefined;
    if (
      !generation ||
      generation.status !== "staging" ||
      !sourceMatches(generation, input.source)
    ) {
      transaction.abort();
      throw new Error(
        `${input.label} is absent, complete, or source-mismatched`,
      );
    }

    const existingBatch = (await requestResult(
      batches.get([input.source.generationId, input.batchIndex]),
    )) as GenerationBatchRecord | undefined;
    if (existingBatch) {
      if (
        existingBatch.rowsDigest === input.rowsDigest &&
        existingBatch.rowCount === input.rowCount &&
        existingBatch.writtenCountAfter <= generation.writtenCount &&
        generation.nextBatchIndex > input.batchIndex
      ) {
        await transactionDone(transaction);
        return;
      }
      transaction.abort();
      throw new Error(`${input.label} batch replay changed its exact rows`);
    }
    if (
      generation.nextBatchIndex !== input.batchIndex ||
      generation.writtenCount + input.rowCount > generation.totalCount
    ) {
      transaction.abort();
      throw new Error(
        `${input.label} page is skipped, reordered, or oversized`,
      );
    }

    input.writeRows(rows);
    batches.add({
      generationId: input.source.generationId,
      batchIndex: input.batchIndex,
      rowCount: input.rowCount,
      rowsDigest: input.rowsDigest,
      writtenCountAfter: generation.writtenCount + input.rowCount,
    } satisfies GenerationBatchRecord);
    generations.put({
      ...generation,
      writtenCount: generation.writtenCount + input.rowCount,
      nextBatchIndex: generation.nextBatchIndex + 1,
    } satisfies GenerationRecord);
    await transactionDone(transaction);
  }

  async #finalizeStoredGeneration(
    sourceValue: LibraryCoreFeedPageSourceV1,
    stores: GenerationStoreNames,
    label: string,
  ): Promise<LibraryCoreFeedPageSourceV1> {
    this.#requireAvailable();
    const source = snapshotSource(sourceValue);
    const database = await this.#database();
    const transaction = database.transaction(
      [stores.generations, stores.rows, stores.control],
      "readwrite",
    );
    const generations = transaction.objectStore(stores.generations);
    const rows = transaction.objectStore(stores.rows);
    const control = transaction.objectStore(stores.control);
    const generation = (await requestResult(
      generations.get(source.generationId),
    )) as GenerationRecord | undefined;
    const selected = (await requestResult(
      control.get(stores.selectedKey),
    )) as SelectedGenerationRecord | undefined;
    if (generation?.status === "complete" && sourceMatches(generation, source)) {
      if (
        selected?.generationId === source.generationId &&
        generation.selectedSequence !== selected.selectionSequence
      ) {
        transaction.abort();
        throw new Error(
          `completed ${label} selection sequence is inconsistent`,
        );
      }
      if (selected?.generationId !== source.generationId) {
        const selectionSequence = (selected?.selectionSequence ?? 0) + 1;
        if (!Number.isSafeInteger(selectionSequence)) {
          transaction.abort();
          throw new Error(`${label} selection sequence exhausted`);
        }
        generations.put({
          ...generation,
          selectedSequence: selectionSequence,
        } satisfies GenerationRecord);
        control.put({
          key: stores.selectedKey,
          generationId: source.generationId,
          selectionSequence,
        } satisfies SelectedGenerationRecord);
      }
      await transactionDone(transaction);
      return source;
    }
    if (
      !generation ||
      generation.status !== "staging" ||
      !sourceMatches(generation, source)
    ) {
      transaction.abort();
      throw new Error(`${label} is absent, complete, or source-mismatched`);
    }
    const actualCount = await requestResult(
      rows.count(generationRange(this.#keyRange, source.generationId)),
    );
    if (
      generation.writtenCount !== generation.totalCount ||
      actualCount !== generation.totalCount
    ) {
      transaction.abort();
      throw new Error(
        `${label} cannot publish before every row is durable`,
      );
    }

    const selectionSequence = (selected?.selectionSequence ?? 0) + 1;
    if (!Number.isSafeInteger(selectionSequence)) {
      transaction.abort();
      throw new Error(`${label} selection sequence exhausted`);
    }
    generations.put({
      ...generation,
      status: "complete",
      selectedSequence: selectionSequence,
    } satisfies GenerationRecord);
    control.put({
      key: stores.selectedKey,
      generationId: source.generationId,
      selectionSequence,
    } satisfies SelectedGenerationRecord);
    await transactionDone(transaction);
    return source;
  }

  #database(): Promise<IDBDatabase> {
    this.#requireAvailable();
    if (!this.#databasePromise) {
      this.#databasePromise = new Promise<IDBDatabase>((resolve, reject) => {
        const request = this.#indexedDb.open(
          this.#databaseName,
          DATABASE_VERSION,
        );
        request.addEventListener("upgradeneeded", () => {
          const database = request.result;
          if (!database.objectStoreNames.contains(GENERATIONS_STORE)) {
            database.createObjectStore(GENERATIONS_STORE, {
              keyPath: "generationId",
            });
          }
          if (!database.objectStoreNames.contains(ROWS_STORE)) {
            const rows = database.createObjectStore(ROWS_STORE, {
              keyPath: ["generationId", "orderKey"],
            });
            rows.createIndex(
              "generation_global_id",
              ["generationId", "globalId"],
              { unique: true },
            );
          }
          if (!database.objectStoreNames.contains(BATCHES_STORE)) {
            database.createObjectStore(BATCHES_STORE, {
              keyPath: ["generationId", "batchIndex"],
            });
          }
          if (!database.objectStoreNames.contains(CONTROL_STORE)) {
            database.createObjectStore(CONTROL_STORE, { keyPath: "key" });
          }
          if (!database.objectStoreNames.contains(BROWSE_GENERATIONS_STORE)) {
            database.createObjectStore(BROWSE_GENERATIONS_STORE, {
              keyPath: "generationId",
            });
          }
          if (!database.objectStoreNames.contains(BROWSE_ROWS_STORE)) {
            const browseRows = database.createObjectStore(BROWSE_ROWS_STORE, {
              keyPath: ["generationId", "orderKey"],
            });
            browseRows.createIndex(
              "browse_generation_global_id",
              ["generationId", "globalId"],
              { unique: true },
            );
            browseRows.createIndex(
              "browse_generation_source_sequence",
              ["generationId", "sourceSequence"],
              { unique: true },
            );
          }
          if (!database.objectStoreNames.contains(BROWSE_BATCHES_STORE)) {
            database.createObjectStore(BROWSE_BATCHES_STORE, {
              keyPath: ["generationId", "batchIndex"],
            });
          }
          if (!database.objectStoreNames.contains(BROWSE_CONTROL_STORE)) {
            database.createObjectStore(BROWSE_CONTROL_STORE, {
              keyPath: "key",
            });
          }
        });
        request.addEventListener(
          "success",
          () => {
            const database = request.result;
            database.addEventListener("versionchange", () => {
              database.close();
              this.#databasePromise = null;
            });
            resolve(database);
          },
          { once: true },
        );
        request.addEventListener(
          "error",
          () =>
            reject(
              request.error ?? new Error("PWA Library Core database failed"),
            ),
          { once: true },
        );
        request.addEventListener(
          "blocked",
          () => reject(new Error("PWA Library Core database upgrade blocked")),
          { once: true },
        );
      });
    }
    return this.#databasePromise;
  }

  async #pruneStoredGenerations(
    selectedGenerationId: string,
    stores: GenerationStoreNames,
  ): Promise<void> {
    const database = await this.#database();
    const transaction = database.transaction(
      [stores.generations],
      "readonly",
    );
    const generations = (await requestResult(
      transaction.objectStore(stores.generations).getAll(),
    )) as GenerationRecord[];
    await transactionDone(transaction);
    const retained = generations
      .filter(
        (generation) =>
          generation.status === "complete" &&
          generation.generationId !== selectedGenerationId,
      )
      .sort(
        (left, right) =>
          (right.selectedSequence ?? -1) - (left.selectedSequence ?? -1),
      );
    const obsolete = retained.slice(MAXIMUM_RETAINED_GENERATIONS - 1);
    for (const generation of obsolete) {
      await this.#deleteStoredGeneration(generation.generationId, stores);
    }
  }

  async #deleteStoredGeneration(
    generationId: string,
    stores: GenerationStoreNames,
  ): Promise<void> {
    const database = await this.#database();
    const transaction = database.transaction(
      [stores.generations, stores.rows, stores.batches],
      "readwrite",
    );
    const range = generationRange(this.#keyRange, generationId);
    transaction.objectStore(stores.rows).delete(range);
    transaction.objectStore(stores.batches).delete(
      this.#keyRange.bound(
        [generationId, 0],
        [generationId, Number.MAX_SAFE_INTEGER],
      ),
    );
    transaction.objectStore(stores.generations).delete(generationId);
    await transactionDone(transaction);
  }
}

export function createPwaLibraryCoreFeedReaderRuntime(
  options: PwaLibraryCoreFeedReaderRuntimeOptions,
): PwaLibraryCoreFeedReaderRuntime {
  return new PwaLibraryCoreFeedReaderRuntime(options);
}
