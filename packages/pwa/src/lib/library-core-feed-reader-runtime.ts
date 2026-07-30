import {
  decodeLibraryCoreFeedPageCursorV1,
  encodeLibraryCoreFeedPageCursorV1,
  parseLibraryCoreFeedCardV1,
  parseLibraryCoreFeedPageRequestV1,
  parseLibraryCoreFeedPageResponseV1,
  parseLibraryCoreFeedPageSourceV1,
  type LibraryCoreFeedCardV1,
  type LibraryCoreFeedPageCursorV1,
  type LibraryCoreFeedPageRequestV1,
  type LibraryCoreFeedPageResponseV1,
  type LibraryCoreFeedPageSourceV1,
} from "@freed/shared/library-core";

const DATABASE_VERSION = 1;
const GENERATIONS_STORE = "generations";
const ROWS_STORE = "feed_rows";
const BATCHES_STORE = "generation_batches";
const CONTROL_STORE = "control";
const SELECTED_GENERATION_KEY = "selected_generation";
const SESSION_MAXIMUM_AGE_MS = 60_000;
const MAXIMUM_READER_SESSIONS = 2;
const MAXIMUM_STAGING_PAGE_ROWS = 128;
const MAXIMUM_RETAINED_GENERATIONS = 2;
const MAXIMUM_SAFE_SORT_KEY = Number.MAX_SAFE_INTEGER;
const TEXT_ENCODER = new TextEncoder();

type GenerationStatus = "staging" | "complete";

interface GenerationRecord extends LibraryCoreFeedPageSourceV1 {
  readonly generationId: LibraryCoreFeedPageSourceV1["generationId"];
  readonly status: GenerationStatus;
  readonly totalCount: number;
  readonly writtenCount: number;
  readonly nextBatchIndex: number;
  readonly selectedSequence: number | null;
}

interface FeedRowRecord {
  readonly generationId: string;
  readonly orderKey: string;
  readonly globalId: string;
  readonly sortAt: number;
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
  readonly key: typeof SELECTED_GENERATION_KEY;
  readonly generationId: string;
  readonly selectionSequence: number;
}

interface ReaderSession {
  readonly source: LibraryCoreFeedPageSourceV1;
  readonly expiresAtMs: number;
  lastRequest: ReaderRequestIdentity | null;
}

interface ReaderRequestIdentity {
  readonly cancellationId: string;
  readonly cursor: string | null;
  readonly limit: number;
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

export type PwaLibraryCoreFeedReaderErrorCode =
  | "RUNTIME_INACTIVE"
  | "CURSOR_STALE"
  | "SESSION_LIMIT"
  | "INVALID_REQUEST"
  | "RESPONSE_TOO_LARGE"
  | "READER_UNAVAILABLE";

export type PwaLibraryCoreFeedReaderResult =
  | Readonly<{
      ok: true;
      value: LibraryCoreFeedPageResponseV1;
    }>
  | Readonly<{
      ok: false;
      code: PwaLibraryCoreFeedReaderErrorCode;
      message: string;
    }>;

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

export type PwaLibraryCoreFeedGenerationState = "complete" | "staging";

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    request.addEventListener("success", () => resolve(request.result), {
      once: true,
    });
    request.addEventListener(
      "error",
      () => reject(request.error ?? new Error("IndexedDB request failed")),
      { once: true },
    );
  });
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    transaction.addEventListener("complete", () => resolve(), { once: true });
    transaction.addEventListener(
      "abort",
      () =>
        reject(transaction.error ?? new Error("IndexedDB transaction aborted")),
      { once: true },
    );
    transaction.addEventListener(
      "error",
      () =>
        reject(transaction.error ?? new Error("IndexedDB transaction failed")),
      { once: true },
    );
  });
}

function openCursor(
  request: IDBRequest<IDBCursorWithValue | null>,
): Promise<IDBCursorWithValue | null> {
  return requestResult(request);
}

function lowerHex(bytes: ArrayBuffer): string {
  let output = "";
  for (const byte of new Uint8Array(bytes)) {
    output += byte.toString(16).padStart(2, "0");
  }
  return output;
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
): PwaLibraryCoreFeedReaderResult {
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
    this.#requireAvailable();
    const source = snapshotSource(input.source);
    if (!Number.isSafeInteger(input.totalCount) || input.totalCount < 0) {
      throw new TypeError("generation totalCount must be nonnegative and safe");
    }

    const database = await this.#database();
    const transaction = database.transaction(
      [GENERATIONS_STORE],
      "readwrite",
    );
    const store = transaction.objectStore(GENERATIONS_STORE);
    const existing = (await requestResult(
      store.get(source.generationId),
    )) as GenerationRecord | undefined;
    if (existing) {
      if (
        sourceMatches(existing, source) &&
        existing.totalCount === input.totalCount
      ) {
        await transactionDone(transaction);
        return existing.status;
      }
      transaction.abort();
      throw new Error("generation identity already exists with different state");
    }
    const generations = (await requestResult(
      store.getAll(),
    )) as GenerationRecord[];
    if (generations.some((generation) => generation.status === "staging")) {
      transaction.abort();
      throw new Error("another PWA Library Core generation is still staging");
    }

    store.add({
      ...source,
      status: "staging",
      totalCount: input.totalCount,
      writtenCount: 0,
      nextBatchIndex: 0,
      selectedSequence: null,
    } satisfies GenerationRecord);
    await transactionDone(transaction);
    return "staging";
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
    const encodedRows = TEXT_ENCODER.encode(JSON.stringify(rows));
    const rowsDigest = lowerHex(
      await this.#subtle.digest("SHA-256", encodedRows),
    );
    const database = await this.#database();
    const transaction = database.transaction(
      [GENERATIONS_STORE, ROWS_STORE, BATCHES_STORE],
      "readwrite",
    );
    const generations = transaction.objectStore(GENERATIONS_STORE);
    const feedRows = transaction.objectStore(ROWS_STORE);
    const batches = transaction.objectStore(BATCHES_STORE);
    const generation = (await requestResult(
      generations.get(source.generationId),
    )) as GenerationRecord | undefined;
    if (
      !generation ||
      generation.status !== "staging" ||
      !sourceMatches(generation, source)
    ) {
      transaction.abort();
      throw new Error("generation is absent, complete, or source-mismatched");
    }

    const existingBatch = (await requestResult(
      batches.get([source.generationId, input.batchIndex]),
    )) as GenerationBatchRecord | undefined;
    if (existingBatch) {
      if (
        existingBatch.rowsDigest === rowsDigest &&
        existingBatch.rowCount === rows.length &&
        existingBatch.writtenCountAfter <= generation.writtenCount &&
        generation.nextBatchIndex > input.batchIndex
      ) {
        await transactionDone(transaction);
        return;
      }
      transaction.abort();
      throw new Error("generation batch replay changed its exact rows");
    }
    if (
      generation.nextBatchIndex !== input.batchIndex ||
      generation.writtenCount + rows.length > generation.totalCount
    ) {
      transaction.abort();
      throw new Error("generation page is skipped, reordered, or oversized");
    }

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
    batches.add({
      generationId: source.generationId,
      batchIndex: input.batchIndex,
      rowCount: rows.length,
      rowsDigest,
      writtenCountAfter: generation.writtenCount + rows.length,
    } satisfies GenerationBatchRecord);
    generations.put({
      ...generation,
      writtenCount: generation.writtenCount + rows.length,
      nextBatchIndex: generation.nextBatchIndex + 1,
    } satisfies GenerationRecord);
    await transactionDone(transaction);
  }

  async finalizeGeneration(
    sourceValue: LibraryCoreFeedPageSourceV1,
  ): Promise<void> {
    this.#requireAvailable();
    const source = snapshotSource(sourceValue);
    const database = await this.#database();
    const transaction = database.transaction(
      [GENERATIONS_STORE, ROWS_STORE, CONTROL_STORE],
      "readwrite",
    );
    const generations = transaction.objectStore(GENERATIONS_STORE);
    const rows = transaction.objectStore(ROWS_STORE);
    const control = transaction.objectStore(CONTROL_STORE);
    const generation = (await requestResult(
      generations.get(source.generationId),
    )) as GenerationRecord | undefined;
    const selected = (await requestResult(
      control.get(SELECTED_GENERATION_KEY),
    )) as SelectedGenerationRecord | undefined;
    if (generation?.status === "complete" && sourceMatches(generation, source)) {
      if (
        selected?.generationId === source.generationId &&
        generation.selectedSequence !== selected.selectionSequence
      ) {
        transaction.abort();
        throw new Error(
          "completed generation selection sequence is inconsistent",
        );
      }
      if (selected?.generationId !== source.generationId) {
        const selectionSequence = (selected?.selectionSequence ?? 0) + 1;
        if (!Number.isSafeInteger(selectionSequence)) {
          transaction.abort();
          throw new Error("generation selection sequence exhausted");
        }
        generations.put({
          ...generation,
          selectedSequence: selectionSequence,
        } satisfies GenerationRecord);
        control.put({
          key: SELECTED_GENERATION_KEY,
          generationId: source.generationId,
          selectionSequence,
        } satisfies SelectedGenerationRecord);
      }
      await transactionDone(transaction);
      this.#sessions.clear();
      await this.#pruneOldGenerations(source.generationId);
      return;
    }
    if (
      !generation ||
      generation.status !== "staging" ||
      !sourceMatches(generation, source)
    ) {
      transaction.abort();
      throw new Error("generation is absent, complete, or source-mismatched");
    }
    const actualCount = await requestResult(
      rows.count(generationRange(this.#keyRange, source.generationId)),
    );
    if (
      generation.writtenCount !== generation.totalCount ||
      actualCount !== generation.totalCount
    ) {
      transaction.abort();
      throw new Error("generation cannot publish before every row is durable");
    }

    const selectionSequence = (selected?.selectionSequence ?? 0) + 1;
    if (!Number.isSafeInteger(selectionSequence)) {
      transaction.abort();
      throw new Error("generation selection sequence exhausted");
    }
    generations.put({
      ...generation,
      status: "complete",
      selectedSequence: selectionSequence,
    } satisfies GenerationRecord);
    control.put({
      key: SELECTED_GENERATION_KEY,
      generationId: source.generationId,
      selectionSequence,
    } satisfies SelectedGenerationRecord);
    await transactionDone(transaction);
    this.#sessions.clear();
    await this.#pruneOldGenerations(source.generationId);
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
    const session = this.#sessions.get(readerSessionId);
    if (session?.lastRequest?.cancellationId !== cancellationId) return false;
    return this.#sessions.delete(readerSessionId);
  }

  async quiesce(): Promise<void> {
    this.#quiesced = true;
    this.#sessions.clear();
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
    } else if (request.cursor !== null) {
      return {
        ok: false,
        result: readerFailure(
          "CURSOR_STALE",
          "cursor cannot resume an absent or expired reader session",
        ),
      };
    } else if (this.#sessions.size >= MAXIMUM_READER_SESSIONS) {
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

  #expireSessions(): void {
    const now = this.#now();
    for (const [sessionId, session] of this.#sessions) {
      if (session.expiresAtMs <= now) this.#sessions.delete(sessionId);
    }
  }

  #requireAvailable(): void {
    if (this.#quiesced) {
      throw new Error("PWA Library Core reader is quiesced");
    }
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

  async #pruneOldGenerations(selectedGenerationId: string): Promise<void> {
    const database = await this.#database();
    const transaction = database.transaction(
      [GENERATIONS_STORE],
      "readonly",
    );
    const generations = (await requestResult(
      transaction.objectStore(GENERATIONS_STORE).getAll(),
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
      await this.#deleteGeneration(generation.generationId);
    }
  }

  async #deleteGeneration(generationId: string): Promise<void> {
    const database = await this.#database();
    const transaction = database.transaction(
      [GENERATIONS_STORE, ROWS_STORE, BATCHES_STORE],
      "readwrite",
    );
    const range = generationRange(this.#keyRange, generationId);
    transaction.objectStore(ROWS_STORE).delete(range);
    transaction.objectStore(BATCHES_STORE).delete(
      this.#keyRange.bound(
        [generationId, 0],
        [generationId, Number.MAX_SAFE_INTEGER],
      ),
    );
    transaction.objectStore(GENERATIONS_STORE).delete(generationId);
    await transactionDone(transaction);
  }
}

export function createPwaLibraryCoreFeedReaderRuntime(
  options: PwaLibraryCoreFeedReaderRuntimeOptions,
): PwaLibraryCoreFeedReaderRuntime {
  return new PwaLibraryCoreFeedReaderRuntime(options);
}
