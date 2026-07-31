import {
  LIBRARY_CORE_PORTABLE_CHECKPOINT_COLLECTIONS,
  createLibraryCoreImmutableObjectKey,
  encodeLibraryCoreCanonicalValue,
  parseLibraryCoreCheckpointManifestV1,
  parseLibraryCoreImmutableObjectReferenceV1,
  parseLibraryCoreOperationSegmentEntryV1,
  parseLibraryCoreOperationSegmentHeaderV1,
  parseLibraryCorePortableCheckpointRecordV1,
  type LibraryCoreCanonicalValue,
  type LibraryCoreCheckpointManifestV1,
  type LibraryCoreImmutableObjectReferenceV1,
  type LibraryCoreLowercaseHex64,
  type LibraryCoreOperationSegmentEntryV1,
  type LibraryCoreOperationSegmentHeaderV1,
  type LibraryCorePortableCheckpointCollection,
  type LibraryCorePortableCheckpointEntryV1,
  type LibraryCorePortableCheckpointHeaderV1,
  type LibraryCorePortableCheckpointRecordV1,
} from "@freed/shared/library-core";
import type {
  LibraryCoreOperationSegmentImportReceiptV1,
  LibraryCoreOperationSegmentImportWriterV1,
  LibraryCorePortableCheckpointImportWriterV1,
  LibraryCorePortableCheckpointStagingReceiptV1,
} from "@freed/sync/cloud";

import {
  lowerHex,
  requestResult,
  transactionDone,
} from "./library-core-indexeddb";

const DATABASE_VERSION = 2;
const GENERATIONS_STORE = "portable_generations";
const RECORDS_STORE = "portable_records";
const PAGES_STORE = "portable_pages";
const CONTROL_STORE = "portable_control";
const OPERATIONS_STORE = "portable_operations";
const SEGMENTS_STORE = "portable_segments";
const SELECTED_GENERATION_KEY = "selected_portable_generation";
const MAXIMUM_RETAINED_GENERATIONS = 2;
const MAXIMUM_COLLECTION_PAGE_ROWS = 128;

type GenerationStatus = "complete" | "staging";

interface PortableGenerationRecord {
  readonly generationId: LibraryCoreLowercaseHex64;
  readonly status: GenerationStatus;
  readonly libraryId: string;
  readonly storageEpoch: string;
  readonly manifestGeneration: number;
  readonly manifestObjectKey: string;
  readonly manifestPageCount: number;
  readonly manifestStoredByteLength: number;
  readonly totalRecordCount: number;
  readonly frontierDigest: LibraryCoreLowercaseHex64;
  readonly checkpointFrontierDigest: LibraryCoreLowercaseHex64;
  readonly importedThroughIngestSequence: number;
  readonly latestOperationSegmentDigest: LibraryCoreLowercaseHex64 | null;
  readonly manifestTransportObjectId: string;
  readonly writtenRecordCount: number;
  readonly nextPageIndex: number;
  readonly header: LibraryCorePortableCheckpointHeaderV1 | null;
  readonly headerDigest: LibraryCoreLowercaseHex64 | null;
  readonly selectionSequence: number | null;
}

interface PortablePageRecord {
  readonly generationId: LibraryCoreLowercaseHex64;
  readonly pageIndex: number;
  readonly pageDigest: LibraryCoreLowercaseHex64;
  readonly recordCount: number;
  readonly writtenRecordCountAfter: number;
}

interface PortableEntryRecord {
  readonly generationId: LibraryCoreLowercaseHex64;
  readonly collection: LibraryCorePortableCheckpointCollection;
  readonly ordinal: number;
  readonly entry: LibraryCorePortableCheckpointEntryV1;
}

interface SelectedPortableGenerationRecord {
  readonly key: typeof SELECTED_GENERATION_KEY;
  readonly generationId: LibraryCoreLowercaseHex64;
  readonly selectionSequence: number;
}

interface PortableOperationRecord {
  readonly entry: LibraryCoreOperationSegmentEntryV1;
  readonly generationId: LibraryCoreLowercaseHex64;
  readonly ingestSequence: number;
  readonly operationId: string;
  readonly segmentDigest: LibraryCoreLowercaseHex64;
}

interface PortableSegmentRecord {
  readonly firstIngestSequence: number;
  readonly generationId: LibraryCoreLowercaseHex64;
  readonly header: LibraryCoreOperationSegmentHeaderV1;
  readonly lastIngestSequence: number;
  readonly objectKey: string;
  readonly storedByteLength: number;
  readonly storedContentDigest: LibraryCoreLowercaseHex64;
  readonly transportObjectId: string;
}

export interface PwaLibraryCorePortableCheckpointStoreOptions {
  readonly databaseName: string;
  readonly indexedDb: IDBFactory;
  readonly keyRange: typeof IDBKeyRange;
  readonly subtle: SubtleCrypto;
}

export interface ReadPwaLibraryCorePortableCollectionPageInput {
  readonly afterOrdinal: number | null;
  readonly collection: LibraryCorePortableCheckpointCollection;
  readonly limit: number;
}

export interface PwaLibraryCorePortableCollectionPage {
  readonly entries: readonly LibraryCorePortableCheckpointEntryV1[];
  readonly frontierDigest: LibraryCoreLowercaseHex64;
  readonly generationId: LibraryCoreLowercaseHex64;
  readonly materializedDigest: LibraryCoreLowercaseHex64;
  readonly nextOrdinal: number | null;
}

export interface ReadPwaLibraryCoreOperationPageInput {
  readonly afterIngestSequence: number;
  readonly limit: number;
}

export interface PwaLibraryCoreOperationPage {
  readonly entries: readonly LibraryCoreOperationSegmentEntryV1[];
  readonly frontierDigest: LibraryCoreLowercaseHex64;
  readonly importedThroughIngestSequence: number;
  readonly latestOperationSegmentDigest: LibraryCoreLowercaseHex64 | null;
  readonly nextAfterIngestSequence: number | null;
}

function snapshotReference(
  reference: LibraryCoreImmutableObjectReferenceV1,
): LibraryCoreImmutableObjectReferenceV1 {
  return Object.freeze({
    descriptor: Object.freeze({
      byteLength: reference.descriptor.byteLength,
      contentDigest: reference.descriptor.contentDigest,
      objectKey: reference.descriptor.objectKey,
    }),
    transportObjectId: reference.transportObjectId,
  });
}

function generationMatches(
  generation: PortableGenerationRecord,
  manifest: LibraryCoreCheckpointManifestV1,
  reference: LibraryCoreImmutableObjectReferenceV1,
): boolean {
  return (
    generation.generationId === reference.descriptor.contentDigest &&
    generation.libraryId === manifest.libraryId &&
    generation.storageEpoch === manifest.storageEpoch &&
    generation.manifestGeneration === manifest.generation &&
    generation.manifestObjectKey === reference.descriptor.objectKey &&
    generation.manifestPageCount === manifest.pages.length &&
    generation.manifestStoredByteLength === reference.descriptor.byteLength &&
    generation.manifestTransportObjectId === reference.transportObjectId &&
    generation.totalRecordCount === manifest.totalRecordCount &&
    generation.checkpointFrontierDigest === manifest.causalFrontierDigest
  );
}

function assertManifestReference(
  manifest: LibraryCoreCheckpointManifestV1,
  reference: LibraryCoreImmutableObjectReferenceV1,
): void {
  const expectedKey = createLibraryCoreImmutableObjectKey({
    kind: "checkpoint_manifest",
    libraryId: manifest.libraryId,
    epochId: manifest.storageEpoch,
    generation: manifest.generation,
    digest: reference.descriptor.contentDigest,
  });
  if (reference.descriptor.objectKey !== expectedKey) {
    throw new TypeError(
      "portable checkpoint manifest reference does not match its library, epoch, and generation",
    );
  }
}

function entriesRange(
  keyRange: typeof IDBKeyRange,
  generationId: string,
): IDBKeyRange {
  return keyRange.bound(
    [generationId, "", 0],
    [generationId, "\uffff", Number.MAX_SAFE_INTEGER],
  );
}

function collectionRange(
  keyRange: typeof IDBKeyRange,
  generationId: string,
  collection: LibraryCorePortableCheckpointCollection,
  afterOrdinal = -1,
): IDBKeyRange {
  return keyRange.bound(
    [generationId, collection, afterOrdinal + 1],
    [generationId, collection, Number.MAX_SAFE_INTEGER],
  );
}

function exactArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const output = new Uint8Array(bytes.byteLength);
  output.set(bytes);
  return output.buffer;
}

/**
 * Dormant IndexedDB materialization for complete adapter-neutral Library Core
 * checkpoints. Automerge remains authoritative and no product reader selects
 * this database before the governed replacement-protocol cutover.
 */
class PwaLibraryCorePortableCheckpointStore
  implements
    LibraryCorePortableCheckpointImportWriterV1,
    LibraryCoreOperationSegmentImportWriterV1
{
  readonly #databaseName: string;
  readonly #indexedDb: IDBFactory;
  readonly #keyRange: typeof IDBKeyRange;
  readonly #subtle: SubtleCrypto;
  #databasePromise: Promise<IDBDatabase> | null = null;
  #activeGenerationId: LibraryCoreLowercaseHex64 | null = null;
  #quiesced = false;

  constructor(options: PwaLibraryCorePortableCheckpointStoreOptions) {
    if (!options.databaseName) {
      throw new TypeError("PWA Library Core database name is required");
    }
    this.#databaseName = options.databaseName;
    this.#indexedDb = options.indexedDb;
    this.#keyRange = options.keyRange;
    this.#subtle = options.subtle;
  }

  async beginImport(input: {
    readonly manifest: LibraryCoreCheckpointManifestV1;
    readonly manifestReference: LibraryCoreImmutableObjectReferenceV1;
  }): Promise<"already_complete" | "import"> {
    this.#requireAvailable();
    const manifest = parseLibraryCoreCheckpointManifestV1(input.manifest);
    if (manifest.datasetSchemaId !== "library_core_logical_checkpoint_v1") {
      throw new TypeError(
        "PWA Library Core store requires a logical checkpoint manifest",
      );
    }
    const reference = snapshotReference(
      parseLibraryCoreImmutableObjectReferenceV1(input.manifestReference),
    );
    assertManifestReference(manifest, reference);
    const generationId = reference.descriptor.contentDigest;
    const database = await this.#database();
    const transaction = database.transaction(
      [GENERATIONS_STORE, CONTROL_STORE],
      "readwrite",
    );
    const generations = transaction.objectStore(GENERATIONS_STORE);
    const control = transaction.objectStore(CONTROL_STORE);
    const existing = (await requestResult(generations.get(generationId))) as
      PortableGenerationRecord | undefined;
    if (existing) {
      if (!generationMatches(existing, manifest, reference)) {
        transaction.abort();
        throw new Error(
          "portable checkpoint identity already exists with different state",
        );
      }
      if (existing.status === "complete") {
        const selected = (await requestResult(
          control.get(SELECTED_GENERATION_KEY),
        )) as SelectedPortableGenerationRecord | undefined;
        if (
          selected?.generationId === generationId &&
          existing.selectionSequence !== selected.selectionSequence
        ) {
          transaction.abort();
          throw new Error(
            "portable checkpoint selection sequence is inconsistent",
          );
        }
        if (selected?.generationId !== generationId) {
          const selectionSequence = (selected?.selectionSequence ?? 0) + 1;
          if (!Number.isSafeInteger(selectionSequence)) {
            transaction.abort();
            throw new Error("portable checkpoint selection sequence exhausted");
          }
          generations.put({
            ...existing,
            selectionSequence,
          } satisfies PortableGenerationRecord);
          control.put({
            key: SELECTED_GENERATION_KEY,
            generationId,
            selectionSequence,
          } satisfies SelectedPortableGenerationRecord);
        }
        await transactionDone(transaction);
        this.#activeGenerationId = null;
        return "already_complete";
      }
      await transactionDone(transaction);
      this.#activeGenerationId = generationId;
      return "import";
    }

    const allGenerations = (await requestResult(
      generations.getAll(),
    )) as PortableGenerationRecord[];
    if (allGenerations.some((generation) => generation.status === "staging")) {
      transaction.abort();
      throw new Error(
        "another PWA Library Core portable checkpoint is still staging",
      );
    }
    generations.add({
      checkpointFrontierDigest: manifest.causalFrontierDigest,
      frontierDigest: manifest.causalFrontierDigest,
      generationId,
      header: null,
      headerDigest: null,
      importedThroughIngestSequence: 0,
      libraryId: manifest.libraryId,
      latestOperationSegmentDigest: null,
      manifestGeneration: manifest.generation,
      manifestObjectKey: reference.descriptor.objectKey,
      manifestPageCount: manifest.pages.length,
      manifestStoredByteLength: reference.descriptor.byteLength,
      manifestTransportObjectId: reference.transportObjectId,
      nextPageIndex: 0,
      selectionSequence: null,
      status: "staging",
      storageEpoch: manifest.storageEpoch,
      totalRecordCount: manifest.totalRecordCount,
      writtenRecordCount: 0,
    } satisfies PortableGenerationRecord);
    await transactionDone(transaction);
    this.#activeGenerationId = generationId;
    return "import";
  }

  async appendPage(
    pageIndex: number,
    inputRecords: readonly LibraryCorePortableCheckpointRecordV1[],
  ): Promise<void> {
    this.#requireAvailable();
    const generationId = this.#requireActiveGeneration();
    if (!Number.isSafeInteger(pageIndex) || pageIndex < 0) {
      throw new TypeError(
        "portable checkpoint pageIndex must be nonnegative and safe",
      );
    }
    const records = Object.freeze(
      inputRecords.map((record) =>
        parseLibraryCorePortableCheckpointRecordV1(record),
      ),
    );
    if (records.length === 0 || records.length > MAXIMUM_COLLECTION_PAGE_ROWS) {
      throw new RangeError(
        `portable checkpoint page must contain 1 through ${MAXIMUM_COLLECTION_PAGE_ROWS.toLocaleString()} records`,
      );
    }
    const pageDigest = await this.#canonicalDigest(
      records as unknown as LibraryCoreCanonicalValue,
    );
    const header = records.find(
      (record): record is LibraryCorePortableCheckpointHeaderV1 =>
        record.kind === "logical_checkpoint_header",
    );
    const headerDigest = header
      ? await this.#canonicalDigest(
          header as unknown as LibraryCoreCanonicalValue,
        )
      : null;

    const database = await this.#database();
    const transaction = database.transaction(
      [GENERATIONS_STORE, RECORDS_STORE, PAGES_STORE],
      "readwrite",
    );
    const generations = transaction.objectStore(GENERATIONS_STORE);
    const pages = transaction.objectStore(PAGES_STORE);
    const entries = transaction.objectStore(RECORDS_STORE);
    const generation = (await requestResult(generations.get(generationId))) as
      PortableGenerationRecord | undefined;
    if (!generation || generation.status !== "staging") {
      transaction.abort();
      throw new Error(
        "portable checkpoint generation is absent or no longer staging",
      );
    }

    const existingPage = (await requestResult(
      pages.get([generationId, pageIndex]),
    )) as PortablePageRecord | undefined;
    if (existingPage) {
      if (
        existingPage.pageDigest === pageDigest &&
        existingPage.recordCount === records.length &&
        existingPage.writtenRecordCountAfter <= generation.writtenRecordCount &&
        generation.nextPageIndex > pageIndex
      ) {
        await transactionDone(transaction);
        return;
      }
      transaction.abort();
      throw new Error(
        "portable checkpoint page replay changed its exact records",
      );
    }
    if (
      generation.nextPageIndex !== pageIndex ||
      generation.writtenRecordCount + records.length >
        generation.totalRecordCount
    ) {
      transaction.abort();
      throw new Error(
        "portable checkpoint page is skipped, reordered, or oversized",
      );
    }
    if (
      generation.writtenRecordCount === 0
        ? pageIndex !== 0 ||
          records[0]?.kind !== "logical_checkpoint_header" ||
          header === undefined
        : header !== undefined
    ) {
      transaction.abort();
      throw new Error(
        "portable checkpoint header is missing, repeated, or out of order",
      );
    }
    if (
      header &&
      (header.library_id !== generation.libraryId ||
        header.epoch_id !== generation.storageEpoch ||
        header.materializer_position.frontier_digest !==
          generation.frontierDigest)
    ) {
      transaction.abort();
      throw new Error(
        "portable checkpoint header does not match its staging generation",
      );
    }

    for (const record of records) {
      if (record.kind !== "logical_checkpoint_entry") continue;
      entries.add({
        collection: record.collection,
        entry: record,
        generationId,
        ordinal: record.ordinal,
      } satisfies PortableEntryRecord);
    }
    const writtenRecordCountAfter =
      generation.writtenRecordCount + records.length;
    pages.add({
      generationId,
      pageDigest,
      pageIndex,
      recordCount: records.length,
      writtenRecordCountAfter,
    } satisfies PortablePageRecord);
    generations.put({
      ...generation,
      header: header ?? generation.header,
      headerDigest: headerDigest ?? generation.headerDigest,
      nextPageIndex: pageIndex + 1,
      writtenRecordCount: writtenRecordCountAfter,
    } satisfies PortableGenerationRecord);
    await transactionDone(transaction);
  }

  async finalizeImport(input: {
    readonly header: LibraryCorePortableCheckpointHeaderV1;
    readonly manifest: LibraryCoreCheckpointManifestV1;
    readonly manifestReference: LibraryCoreImmutableObjectReferenceV1;
  }): Promise<LibraryCorePortableCheckpointStagingReceiptV1> {
    this.#requireAvailable();
    const generationId = this.#requireActiveGeneration();
    const manifest = parseLibraryCoreCheckpointManifestV1(input.manifest);
    const manifestReference = parseLibraryCoreImmutableObjectReferenceV1(
      input.manifestReference,
    );
    assertManifestReference(manifest, manifestReference);
    if (generationId !== manifestReference.descriptor.contentDigest) {
      throw new Error(
        "portable checkpoint finalization changed its active generation",
      );
    }
    const header = parseLibraryCorePortableCheckpointRecordV1(input.header);
    if (header.kind !== "logical_checkpoint_header") {
      throw new TypeError("portable checkpoint finalization header is invalid");
    }
    const headerDigest = await this.#canonicalDigest(
      header as unknown as LibraryCoreCanonicalValue,
    );

    const database = await this.#database();
    const transaction = database.transaction(
      [
        GENERATIONS_STORE,
        RECORDS_STORE,
        PAGES_STORE,
        OPERATIONS_STORE,
        SEGMENTS_STORE,
        CONTROL_STORE,
      ],
      "readwrite",
    );
    const generations = transaction.objectStore(GENERATIONS_STORE);
    const entries = transaction.objectStore(RECORDS_STORE);
    const pages = transaction.objectStore(PAGES_STORE);
    const control = transaction.objectStore(CONTROL_STORE);
    const generation = (await requestResult(generations.get(generationId))) as
      PortableGenerationRecord | undefined;
    if (
      !generation ||
      generation.status !== "staging" ||
      !generationMatches(generation, manifest, manifestReference) ||
      generation.headerDigest !== headerDigest ||
      generation.writtenRecordCount !== generation.totalRecordCount ||
      generation.nextPageIndex !== generation.manifestPageCount
    ) {
      transaction.abort();
      throw new Error(
        "portable checkpoint staging generation is incomplete or mismatched",
      );
    }

    const entryCountRequest = entries.count(
      entriesRange(this.#keyRange, generationId),
    );
    const pageCountRequest = pages.count(
      this.#keyRange.bound(
        [generationId, 0],
        [generationId, Number.MAX_SAFE_INTEGER],
      ),
    );
    const collectionCountRequests =
      LIBRARY_CORE_PORTABLE_CHECKPOINT_COLLECTIONS.map((collection) =>
        entries.count(
          collectionRange(this.#keyRange, generationId, collection),
        ),
      );
    const [entryCount, pageCount, collectionCounts] = await Promise.all([
      requestResult(entryCountRequest),
      requestResult(pageCountRequest),
      Promise.all(collectionCountRequests.map(requestResult)),
    ]);
    if (
      entryCount !== generation.totalRecordCount - 1 ||
      pageCount !== generation.manifestPageCount ||
      collectionCounts.some(
        (count, index) =>
          count !==
          header.collection_counts[
            LIBRARY_CORE_PORTABLE_CHECKPOINT_COLLECTIONS[index]!
          ],
      )
    ) {
      transaction.abort();
      throw new Error(
        "portable checkpoint staged row counts do not match its verified header",
      );
    }

    const selected = (await requestResult(
      control.get(SELECTED_GENERATION_KEY),
    )) as SelectedPortableGenerationRecord | undefined;
    const selectionSequence = (selected?.selectionSequence ?? 0) + 1;
    if (!Number.isSafeInteger(selectionSequence)) {
      transaction.abort();
      throw new Error("portable checkpoint selection sequence exhausted");
    }
    generations.put({
      ...generation,
      importedThroughIngestSequence:
        header.materializer_position.ingest_sequence,
      latestOperationSegmentDigest: null,
      selectionSequence,
      status: "complete",
    } satisfies PortableGenerationRecord);
    control.put({
      key: SELECTED_GENERATION_KEY,
      generationId,
      selectionSequence,
    } satisfies SelectedPortableGenerationRecord);

    const allGenerations = (await requestResult(
      generations.getAll(),
    )) as PortableGenerationRecord[];
    const obsolete = allGenerations
      .filter(
        (candidate) =>
          candidate.status === "complete" &&
          candidate.generationId !== generationId,
      )
      .sort(
        (left, right) =>
          (right.selectionSequence ?? -1) - (left.selectionSequence ?? -1),
      )
      .slice(MAXIMUM_RETAINED_GENERATIONS - 1);
    for (const candidate of obsolete) {
      entries.delete(entriesRange(this.#keyRange, candidate.generationId));
      transaction
        .objectStore(OPERATIONS_STORE)
        .delete(
          this.#keyRange.bound(
            [candidate.generationId, 0],
            [candidate.generationId, Number.MAX_SAFE_INTEGER],
          ),
        );
      transaction
        .objectStore(SEGMENTS_STORE)
        .delete(
          this.#keyRange.bound(
            [candidate.generationId, 0],
            [candidate.generationId, Number.MAX_SAFE_INTEGER],
          ),
        );
      pages.delete(
        this.#keyRange.bound(
          [candidate.generationId, 0],
          [candidate.generationId, Number.MAX_SAFE_INTEGER],
        ),
      );
      generations.delete(candidate.generationId);
    }

    await transactionDone(transaction);
    this.#activeGenerationId = null;
    return Object.freeze({
      frontierDigest: header.materializer_position.frontier_digest,
      ingestSequence: header.materializer_position.ingest_sequence,
      libraryId: header.library_id,
      materializedDigest: header.materializer_position.materialized_digest,
      recordCount: generation.totalRecordCount,
      storageEpoch: header.epoch_id,
    });
  }

  async abortImport(_error: unknown): Promise<void> {
    const generationId = this.#activeGenerationId;
    this.#activeGenerationId = null;
    if (generationId === null || this.#quiesced) return;
    const database = await this.#database();
    const transaction = database.transaction(
      [GENERATIONS_STORE, RECORDS_STORE, PAGES_STORE],
      "readwrite",
    );
    const generations = transaction.objectStore(GENERATIONS_STORE);
    const generation = (await requestResult(generations.get(generationId))) as
      PortableGenerationRecord | undefined;
    if (generation?.status === "staging") {
      transaction
        .objectStore(RECORDS_STORE)
        .delete(entriesRange(this.#keyRange, generationId));
      transaction
        .objectStore(PAGES_STORE)
        .delete(
          this.#keyRange.bound(
            [generationId, 0],
            [generationId, Number.MAX_SAFE_INTEGER],
          ),
        );
      generations.delete(generationId);
    }
    await transactionDone(transaction);
  }

  async appendOperationSegment(input: {
    readonly entries: readonly LibraryCoreOperationSegmentEntryV1[];
    readonly header: LibraryCoreOperationSegmentHeaderV1;
    readonly reference: LibraryCoreImmutableObjectReferenceV1;
  }): Promise<LibraryCoreOperationSegmentImportReceiptV1> {
    this.#requireAvailable();
    const header = parseLibraryCoreOperationSegmentHeaderV1(input.header);
    const entries = Object.freeze(
      input.entries.map(parseLibraryCoreOperationSegmentEntryV1),
    );
    const reference = snapshotReference(
      parseLibraryCoreImmutableObjectReferenceV1(input.reference),
    );
    const database = await this.#database();
    const transaction = database.transaction(
      [GENERATIONS_STORE, OPERATIONS_STORE, SEGMENTS_STORE, CONTROL_STORE],
      "readwrite",
    );
    const generations = transaction.objectStore(GENERATIONS_STORE);
    const operations = transaction.objectStore(OPERATIONS_STORE);
    const segments = transaction.objectStore(SEGMENTS_STORE);
    const selected = (await requestResult(
      transaction.objectStore(CONTROL_STORE).get(SELECTED_GENERATION_KEY),
    )) as SelectedPortableGenerationRecord | undefined;
    const generation = selected
      ? ((await requestResult(generations.get(selected.generationId))) as
          PortableGenerationRecord | undefined)
      : undefined;
    if (
      !selected ||
      !generation ||
      generation.status !== "complete" ||
      generation.selectionSequence !== selected.selectionSequence ||
      generation.header === null ||
      header.library_id !== generation.libraryId ||
      header.epoch_id !== generation.storageEpoch
    ) {
      transaction.abort();
      throw new Error(
        "operation segment has no matching complete selected checkpoint",
      );
    }
    const existing = (await requestResult(
      segments.get([generation.generationId, header.first_ingest_sequence]),
    )) as PortableSegmentRecord | undefined;
    if (existing) {
      if (
        existing.header.segment_digest === header.segment_digest &&
        existing.lastIngestSequence === header.last_ingest_sequence &&
        existing.objectKey === reference.descriptor.objectKey &&
        existing.storedByteLength === reference.descriptor.byteLength &&
        existing.storedContentDigest === reference.descriptor.contentDigest &&
        existing.transportObjectId === reference.transportObjectId &&
        generation.importedThroughIngestSequence >= header.last_ingest_sequence
      ) {
        await transactionDone(transaction);
        return this.#segmentReceipt(header);
      }
      transaction.abort();
      throw new Error(
        "operation segment sequence already exists with different bytes",
      );
    }
    if (
      header.first_ingest_sequence !==
        generation.importedThroughIngestSequence + 1 ||
      header.base_frontier_digest !== generation.frontierDigest ||
      header.previous_segment_digest !== generation.latestOperationSegmentDigest
    ) {
      transaction.abort();
      throw new Error(
        "operation segment is skipped, reordered, or does not extend the selected frontier",
      );
    }
    for (const entry of entries) {
      operations.add({
        entry,
        generationId: generation.generationId,
        ingestSequence: entry.ingest_sequence,
        operationId: entry.operation_id,
        segmentDigest: header.segment_digest,
      } satisfies PortableOperationRecord);
    }
    segments.add({
      firstIngestSequence: header.first_ingest_sequence,
      generationId: generation.generationId,
      header,
      lastIngestSequence: header.last_ingest_sequence,
      objectKey: reference.descriptor.objectKey,
      storedByteLength: reference.descriptor.byteLength,
      storedContentDigest: reference.descriptor.contentDigest,
      transportObjectId: reference.transportObjectId,
    } satisfies PortableSegmentRecord);
    generations.put({
      ...generation,
      frontierDigest: header.result_frontier_digest,
      importedThroughIngestSequence: header.last_ingest_sequence,
      latestOperationSegmentDigest: header.segment_digest,
    } satisfies PortableGenerationRecord);
    await transactionDone(transaction);
    return this.#segmentReceipt(header);
  }

  async readSelectedOperationPage(
    input: ReadPwaLibraryCoreOperationPageInput,
  ): Promise<PwaLibraryCoreOperationPage> {
    this.#requireAvailable();
    if (
      !Number.isSafeInteger(input.afterIngestSequence) ||
      input.afterIngestSequence < 0 ||
      !Number.isSafeInteger(input.limit) ||
      input.limit < 1 ||
      input.limit > MAXIMUM_COLLECTION_PAGE_ROWS
    ) {
      throw new TypeError("portable operation page request is invalid");
    }
    const database = await this.#database();
    const transaction = database.transaction(
      [GENERATIONS_STORE, OPERATIONS_STORE, CONTROL_STORE],
      "readonly",
    );
    const selected = (await requestResult(
      transaction.objectStore(CONTROL_STORE).get(SELECTED_GENERATION_KEY),
    )) as SelectedPortableGenerationRecord | undefined;
    const generation = selected
      ? ((await requestResult(
          transaction.objectStore(GENERATIONS_STORE).get(selected.generationId),
        )) as PortableGenerationRecord | undefined)
      : undefined;
    if (
      !selected ||
      !generation ||
      generation.status !== "complete" ||
      generation.selectionSequence !== selected.selectionSequence
    ) {
      transaction.abort();
      throw new Error("no complete portable checkpoint is selected");
    }
    const entries: LibraryCoreOperationSegmentEntryV1[] = [];
    const request = transaction
      .objectStore(OPERATIONS_STORE)
      .openCursor(
        this.#keyRange.bound(
          [generation.generationId, input.afterIngestSequence + 1],
          [generation.generationId, Number.MAX_SAFE_INTEGER],
        ),
        "next",
      );
    let cursor = await requestResult(request);
    while (cursor && entries.length < input.limit) {
      const stored = cursor.value as PortableOperationRecord;
      entries.push(parseLibraryCoreOperationSegmentEntryV1(stored.entry));
      cursor.continue();
      cursor = await requestResult(cursor.request);
    }
    await transactionDone(transaction);
    const lastSequence = entries.at(-1)?.ingest_sequence ?? null;
    return Object.freeze({
      entries: Object.freeze(entries),
      frontierDigest: generation.frontierDigest,
      importedThroughIngestSequence: generation.importedThroughIngestSequence,
      latestOperationSegmentDigest: generation.latestOperationSegmentDigest,
      nextAfterIngestSequence:
        lastSequence !== null &&
        lastSequence < generation.importedThroughIngestSequence
          ? lastSequence
          : null,
    });
  }

  async readSelectedCollectionPage(
    input: ReadPwaLibraryCorePortableCollectionPageInput,
  ): Promise<PwaLibraryCorePortableCollectionPage> {
    this.#requireAvailable();
    if (
      !LIBRARY_CORE_PORTABLE_CHECKPOINT_COLLECTIONS.includes(
        input.collection,
      ) ||
      !Number.isSafeInteger(input.limit) ||
      input.limit < 1 ||
      input.limit > MAXIMUM_COLLECTION_PAGE_ROWS ||
      (input.afterOrdinal !== null &&
        (!Number.isSafeInteger(input.afterOrdinal) || input.afterOrdinal < 0))
    ) {
      throw new TypeError(
        "portable checkpoint collection page request is invalid",
      );
    }
    const database = await this.#database();
    const transaction = database.transaction(
      [GENERATIONS_STORE, RECORDS_STORE, CONTROL_STORE],
      "readonly",
    );
    const selected = (await requestResult(
      transaction.objectStore(CONTROL_STORE).get(SELECTED_GENERATION_KEY),
    )) as SelectedPortableGenerationRecord | undefined;
    if (!selected) {
      transaction.abort();
      throw new Error("no complete portable checkpoint is selected");
    }
    const generation = (await requestResult(
      transaction.objectStore(GENERATIONS_STORE).get(selected.generationId),
    )) as PortableGenerationRecord | undefined;
    if (
      !generation ||
      generation.status !== "complete" ||
      generation.selectionSequence !== selected.selectionSequence ||
      generation.header === null
    ) {
      transaction.abort();
      throw new Error(
        "selected portable checkpoint is incomplete or inconsistent",
      );
    }

    const entries: LibraryCorePortableCheckpointEntryV1[] = [];
    const request = transaction
      .objectStore(RECORDS_STORE)
      .openCursor(
        collectionRange(
          this.#keyRange,
          generation.generationId,
          input.collection,
          input.afterOrdinal ?? -1,
        ),
        "next",
      );
    let cursor = await requestResult(request);
    while (cursor && entries.length < input.limit) {
      const stored = cursor.value as PortableEntryRecord;
      const parsed = parseLibraryCorePortableCheckpointRecordV1(stored.entry);
      if (
        parsed.kind !== "logical_checkpoint_entry" ||
        parsed.collection !== input.collection
      ) {
        transaction.abort();
        throw new Error("portable checkpoint collection row is inconsistent");
      }
      entries.push(parsed);
      cursor.continue();
      cursor = await requestResult(cursor.request);
    }
    await transactionDone(transaction);
    const finalOrdinal = entries.at(-1)?.ordinal ?? null;
    const declaredCount = generation.header.collection_counts[input.collection];
    return Object.freeze({
      entries: Object.freeze(entries),
      frontierDigest: generation.header.materializer_position.frontier_digest,
      generationId: generation.generationId,
      materializedDigest:
        generation.header.materializer_position.materialized_digest,
      nextOrdinal:
        finalOrdinal !== null && finalOrdinal + 1 < declaredCount
          ? finalOrdinal
          : null,
    });
  }

  async quiesce(): Promise<void> {
    this.#quiesced = true;
    if (this.#databasePromise) {
      const database = await this.#databasePromise;
      database.close();
      this.#databasePromise = null;
    }
    this.#activeGenerationId = null;
  }

  #segmentReceipt(
    header: LibraryCoreOperationSegmentHeaderV1,
  ): LibraryCoreOperationSegmentImportReceiptV1 {
    return Object.freeze({
      firstIngestSequence: header.first_ingest_sequence,
      importedOperationCount: header.operation_count,
      lastIngestSequence: header.last_ingest_sequence,
      resultFrontierDigest: header.result_frontier_digest,
      segmentDigest: header.segment_digest,
    });
  }

  async #canonicalDigest(
    value: LibraryCoreCanonicalValue,
  ): Promise<LibraryCoreLowercaseHex64> {
    const bytes = encodeLibraryCoreCanonicalValue(value);
    return lowerHex(
      await this.#subtle.digest("SHA-256", exactArrayBuffer(bytes)),
    ) as LibraryCoreLowercaseHex64;
  }

  #requireAvailable(): void {
    if (this.#quiesced) {
      throw new Error("PWA Library Core portable checkpoint store is quiesced");
    }
  }

  #requireActiveGeneration(): LibraryCoreLowercaseHex64 {
    if (this.#activeGenerationId === null) {
      throw new Error("portable checkpoint import has not begun");
    }
    return this.#activeGenerationId;
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
          if (!database.objectStoreNames.contains(RECORDS_STORE)) {
            database.createObjectStore(RECORDS_STORE, {
              keyPath: ["generationId", "collection", "ordinal"],
            });
          }
          if (!database.objectStoreNames.contains(PAGES_STORE)) {
            database.createObjectStore(PAGES_STORE, {
              keyPath: ["generationId", "pageIndex"],
            });
          }
          if (!database.objectStoreNames.contains(CONTROL_STORE)) {
            database.createObjectStore(CONTROL_STORE, { keyPath: "key" });
          }
          if (!database.objectStoreNames.contains(OPERATIONS_STORE)) {
            const operations = database.createObjectStore(OPERATIONS_STORE, {
              keyPath: ["generationId", "ingestSequence"],
            });
            operations.createIndex(
              "by_generation_operation_id",
              ["generationId", "operationId"],
              { unique: true },
            );
          }
          if (!database.objectStoreNames.contains(SEGMENTS_STORE)) {
            database.createObjectStore(SEGMENTS_STORE, {
              keyPath: ["generationId", "firstIngestSequence"],
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
              request.error ??
                new Error("PWA Library Core portable database failed"),
            ),
          { once: true },
        );
        request.addEventListener(
          "blocked",
          () =>
            reject(
              new Error("PWA Library Core portable database upgrade blocked"),
            ),
          { once: true },
        );
      });
    }
    return this.#databasePromise;
  }
}

export function createPwaLibraryCorePortableCheckpointStore(
  options: PwaLibraryCorePortableCheckpointStoreOptions,
): PwaLibraryCorePortableCheckpointStore {
  return new PwaLibraryCorePortableCheckpointStore(options);
}
