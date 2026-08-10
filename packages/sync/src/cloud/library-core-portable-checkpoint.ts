import {
  createLibraryCoreImmutableObjectKey,
  libraryCorePortableCheckpointRecordIdentityV1,
  LibraryCorePortableCheckpointStreamVerifierV1,
  parseLibraryCoreImmutableObjectDescriptorV1,
  parseLibraryCorePortableCheckpointRecordV1,
  type LibraryCoreCanonicalValue,
  type LibraryCoreCheckpointManifestV1,
  type LibraryCoreCloudTransportId,
  type LibraryCoreControlPointerV1,
  type LibraryCoreImmutableObjectReferenceV1,
  type LibraryCoreLowercaseHex64,
  type LibraryCorePortableCheckpointEntryV1,
  type LibraryCorePortableCheckpointHeaderV1,
  type LibraryCorePortableCheckpointRecordV1,
} from "@freed/shared/library-core";
import { importLibraryCoreCheckpointManifestV1 } from "./library-core-checkpoint-import.js";
import {
  publishLibraryCoreCheckpointGenerationV1,
  reassignLibraryCoreCheckpointGenerationV1,
  type LibraryCorePreparedCheckpointPageV1,
} from "./library-core-checkpoint-publication.js";
import type {
  LibraryCoreImmutablePublicationAdapterV1,
  LibraryCoreImmutablePublicationResultV1,
  LibraryCoreImmutableReadAdapterV1,
  LibraryCorePreparedImmutableObjectV1,
} from "./library-core-immutable-publication.js";
import { encodeLibraryCoreWireObjectV1 } from "./library-core-wire-object.js";

const PORTABLE_CHECKPOINT_DATASET_SCHEMA_ID =
  "library_core_logical_checkpoint_v1" as const;
const PORTABLE_CHECKPOINT_PAGE_RECORD_LIMIT = 128;
const PORTABLE_CHECKPOINT_PAGE_LIMIT = 4_096;

async function* asAsyncIterable<T>(
  values: Iterable<T> | AsyncIterable<T>,
): AsyncIterable<T> {
  if (Symbol.asyncIterator in Object(values)) {
    yield* values as AsyncIterable<T>;
    return;
  }
  yield* values as Iterable<T>;
}

function exactArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const output = new Uint8Array(bytes.byteLength);
  output.set(bytes);
  return output.buffer;
}

function lowercaseHex(bytes: ArrayBuffer): string {
  let output = "";
  for (const value of new Uint8Array(bytes)) {
    output += value.toString(16).padStart(2, "0");
  }
  return output;
}

async function sha256(
  bytes: Uint8Array,
  subtle: SubtleCrypto,
): Promise<LibraryCoreLowercaseHex64> {
  return lowercaseHex(
    await subtle.digest("SHA-256", exactArrayBuffer(bytes)),
  ) as LibraryCoreLowercaseHex64;
}

function canonicalRecord(
  record: LibraryCorePortableCheckpointRecordV1,
): LibraryCoreCanonicalValue {
  return record as unknown as LibraryCoreCanonicalValue;
}

export interface PrepareLibraryCorePortableCheckpointPagesRequestV1 {
  readonly entries:
    | Iterable<LibraryCorePortableCheckpointEntryV1>
    | AsyncIterable<LibraryCorePortableCheckpointEntryV1>;
  readonly generation: number;
  readonly header: LibraryCorePortableCheckpointHeaderV1;
  readonly subtle: SubtleCrypto;
}

/**
 * Encode one complete logical checkpoint as bounded immutable page objects.
 *
 * The producer retains at most 128 records and one encoded page. It verifies
 * the complete collection order and declared counts as the source advances.
 */
export async function* prepareLibraryCorePortableCheckpointPagesV1(
  request: PrepareLibraryCorePortableCheckpointPagesRequestV1,
): AsyncIterable<LibraryCorePreparedCheckpointPageV1> {
  const verifier = new LibraryCorePortableCheckpointStreamVerifierV1();
  const header = verifier.accept(request.header);
  if (header.kind !== "logical_checkpoint_header") {
    throw new TypeError(
      "portable checkpoint source must begin with its header",
    );
  }
  const declaredRecordCount =
    1 +
    Object.values(header.collection_counts).reduce(
      (total, count) => total + count,
      0,
    );
  const maximumPublishedRecords =
    PORTABLE_CHECKPOINT_PAGE_LIMIT * PORTABLE_CHECKPOINT_PAGE_RECORD_LIMIT;
  if (declaredRecordCount > maximumPublishedRecords) {
    throw new RangeError(
      `portable checkpoint publication supports at most ${maximumPublishedRecords.toLocaleString()} records`,
    );
  }
  let records: LibraryCorePortableCheckpointRecordV1[] = [header];
  let pageIndex = 0;

  const flush = async (): Promise<LibraryCorePreparedCheckpointPageV1> => {
    if (pageIndex >= PORTABLE_CHECKPOINT_PAGE_LIMIT) {
      throw new RangeError(
        `portable checkpoint exceeds ${PORTABLE_CHECKPOINT_PAGE_LIMIT.toLocaleString()} pages`,
      );
    }
    const identities = records.map((record) =>
      libraryCorePortableCheckpointRecordIdentityV1(record),
    );
    const source = await encodeLibraryCoreWireObjectV1(
      records.map(canonicalRecord),
      {
        kind: "checkpoint",
        maximumDecodedBytes: 2_097_152,
        maximumRecordBytes: 131_072,
        maximumRecords: PORTABLE_CHECKPOINT_PAGE_RECORD_LIMIT,
        recordIdentity(value) {
          return libraryCorePortableCheckpointRecordIdentityV1(
            parseLibraryCorePortableCheckpointRecordV1(value),
          );
        },
      },
    );
    const contentDigest = await sha256(source, request.subtle);
    const prepared = Object.freeze({
      firstRecordIdentity: identities[0]!,
      lastRecordIdentity: identities.at(-1)!,
      object: Object.freeze({
        descriptor: parseLibraryCoreImmutableObjectDescriptorV1({
          byteLength: source.byteLength,
          contentDigest,
          objectKey: createLibraryCoreImmutableObjectKey({
            digest: contentDigest,
            epochId: header.epoch_id,
            generation: request.generation,
            kind: "checkpoint_page",
            libraryId: header.library_id,
            pageIndex,
          }),
        }),
        source,
      }),
      pageIndex,
      recordCount: records.length,
    });
    pageIndex += 1;
    records = [];
    return prepared;
  };

  for await (const input of asAsyncIterable(request.entries)) {
    records.push(verifier.accept(input));
    if (records.length === PORTABLE_CHECKPOINT_PAGE_RECORD_LIMIT) {
      yield await flush();
    }
  }
  verifier.finish();
  if (records.length > 0) {
    yield await flush();
  }
}

export interface PublishLibraryCorePortableCheckpointRequestV1 {
  readonly activeTransport: LibraryCoreCloudTransportId;
  readonly adapter: LibraryCoreImmutablePublicationAdapterV1<Uint8Array>;
  readonly entries:
    | Iterable<LibraryCorePortableCheckpointEntryV1>
    | AsyncIterable<LibraryCorePortableCheckpointEntryV1>;
  readonly expectedControl: {
    readonly revision: string | null;
    readonly pointer: LibraryCoreControlPointerV1 | null;
  };
  readonly generation: number;
  readonly header: LibraryCorePortableCheckpointHeaderV1;
  readonly subtle: SubtleCrypto;
  readonly writerId: string;
}

export interface ReassignLibraryCorePortableCheckpointRequestV1
  extends PublishLibraryCorePortableCheckpointRequestV1 {
  readonly expectedControl: {
    readonly revision: string;
    readonly pointer: LibraryCoreControlPointerV1;
  };
  readonly epochCertificate: LibraryCorePreparedImmutableObjectV1<Uint8Array>;
}

/**
 * Publish a complete portable logical checkpoint through the exact immutable
 * page, manifest, and control compare-and-swap pipeline.
 */
export async function publishLibraryCorePortableCheckpointV1(
  request: PublishLibraryCorePortableCheckpointRequestV1,
): Promise<LibraryCoreImmutablePublicationResultV1> {
  const parsedHeader = parseLibraryCorePortableCheckpointRecordV1(
    request.header,
  );
  if (parsedHeader.kind !== "logical_checkpoint_header") {
    throw new TypeError("portable checkpoint header is invalid");
  }
  return publishLibraryCoreCheckpointGenerationV1({
    activeTransport: request.activeTransport,
    adapter: request.adapter,
    causalFrontierDigest: parsedHeader.materializer_position.frontier_digest,
    datasetSchemaId: PORTABLE_CHECKPOINT_DATASET_SCHEMA_ID,
    expectedControl: request.expectedControl,
    generation: request.generation,
    libraryId: parsedHeader.library_id,
    pages: prepareLibraryCorePortableCheckpointPagesV1({
      entries: request.entries,
      generation: request.generation,
      header: parsedHeader,
      subtle: request.subtle,
    }),
    parseRecord: parseLibraryCorePortableCheckpointRecordV1,
    recordIdentity: libraryCorePortableCheckpointRecordIdentityV1,
    storageEpoch: parsedHeader.epoch_id,
    subtle: request.subtle,
    writerId: request.writerId,
  });
}

/** Publish a complete portable checkpoint as generation zero of a new writer epoch. */
export async function reassignLibraryCorePortableCheckpointV1(
  request: ReassignLibraryCorePortableCheckpointRequestV1,
): Promise<LibraryCoreImmutablePublicationResultV1> {
  const parsedHeader = parseLibraryCorePortableCheckpointRecordV1(
    request.header,
  );
  if (parsedHeader.kind !== "logical_checkpoint_header") {
    throw new TypeError("portable checkpoint header is invalid");
  }
  return reassignLibraryCoreCheckpointGenerationV1({
    activeTransport: request.activeTransport,
    adapter: request.adapter,
    causalFrontierDigest: parsedHeader.materializer_position.frontier_digest,
    datasetSchemaId: PORTABLE_CHECKPOINT_DATASET_SCHEMA_ID,
    epochCertificate: request.epochCertificate,
    expectedControl: request.expectedControl,
    generation: request.generation,
    libraryId: parsedHeader.library_id,
    pages: prepareLibraryCorePortableCheckpointPagesV1({
      entries: request.entries,
      generation: request.generation,
      header: parsedHeader,
      subtle: request.subtle,
    }),
    parseRecord: parseLibraryCorePortableCheckpointRecordV1,
    recordIdentity: libraryCorePortableCheckpointRecordIdentityV1,
    storageEpoch: parsedHeader.epoch_id,
    subtle: request.subtle,
    writerId: request.writerId,
  });
}

export interface LibraryCorePortableCheckpointImportWriterV1 {
  abortImport?(error: unknown): Promise<void>;
  appendPage(
    pageIndex: number,
    records: readonly LibraryCorePortableCheckpointRecordV1[],
  ): Promise<void>;
  beginImport(input: {
    readonly manifest: LibraryCoreCheckpointManifestV1;
    readonly manifestReference: LibraryCoreImmutableObjectReferenceV1;
  }): Promise<"already_complete" | "import">;
  finalizeImport(input: {
    readonly header: LibraryCorePortableCheckpointHeaderV1;
    readonly manifest: LibraryCoreCheckpointManifestV1;
    readonly manifestReference: LibraryCoreImmutableObjectReferenceV1;
  }): Promise<LibraryCorePortableCheckpointStagingReceiptV1>;
}

export interface LibraryCorePortableCheckpointStagingReceiptV1 {
  readonly frontierDigest: LibraryCoreLowercaseHex64;
  readonly ingestSequence: number;
  readonly libraryId: string;
  readonly materializedDigest: LibraryCoreLowercaseHex64;
  readonly recordCount: number;
  readonly storageEpoch: string;
}

export interface ImportLibraryCorePortableCheckpointRequestV1 {
  readonly adapter: LibraryCoreImmutableReadAdapterV1;
  readonly generation: number;
  readonly libraryId: string;
  readonly manifest: LibraryCoreImmutableObjectReferenceV1;
  readonly storageEpoch: string;
  readonly subtle: SubtleCrypto;
  readonly writer: LibraryCorePortableCheckpointImportWriterV1;
}

export interface ImportLibraryCorePortableCheckpointResultV1 {
  readonly header: LibraryCorePortableCheckpointHeaderV1 | null;
  readonly importedPageCount: number;
  readonly importedRecordCount: number;
  readonly status: "already_complete" | "imported";
}

/**
 * Verify and stage a complete portable checkpoint into an injected row store.
 *
 * The writer may transact each bounded page immediately, but must not select
 * it until finalizeImport verifies the staged adapter state and returns a
 * receipt matching the header, collection counts, manifest frontier, library,
 * epoch, and materialized-state digest.
 */
export async function importLibraryCorePortableCheckpointV1(
  request: ImportLibraryCorePortableCheckpointRequestV1,
): Promise<ImportLibraryCorePortableCheckpointResultV1> {
  const verifier = new LibraryCorePortableCheckpointStreamVerifierV1();
  let manifestBody: LibraryCoreCheckpointManifestV1 | null = null;
  let manifestReference: LibraryCoreImmutableObjectReferenceV1 | null = null;
  try {
    const imported = await importLibraryCoreCheckpointManifestV1({
      adapter: request.adapter,
      datasetSchemaId: PORTABLE_CHECKPOINT_DATASET_SCHEMA_ID,
      generation: request.generation,
      libraryId: request.libraryId,
      manifest: request.manifest,
      async onPage(pageIndex, records) {
        const verified = records.map((record) => verifier.accept(record));
        await request.writer.appendPage(pageIndex, Object.freeze(verified));
      },
      parseRecord: parseLibraryCorePortableCheckpointRecordV1,
      async prepareImport(manifest, reference) {
        manifestBody = manifest;
        manifestReference = reference;
        return request.writer.beginImport({
          manifest,
          manifestReference: reference,
        });
      },
      recordIdentity: libraryCorePortableCheckpointRecordIdentityV1,
      storageEpoch: request.storageEpoch,
      subtle: request.subtle,
    });
    if (imported.status === "already_complete") {
      return Object.freeze({
        header: null,
        importedPageCount: 0,
        importedRecordCount: 0,
        status: "already_complete",
      });
    }
    if (manifestBody === null || manifestReference === null) {
      throw new TypeError("portable checkpoint manifest was not prepared");
    }
    const completedManifest = manifestBody as LibraryCoreCheckpointManifestV1;
    const completedManifestReference =
      manifestReference as LibraryCoreImmutableObjectReferenceV1;
    const verified = verifier.finish();
    if (
      verified.recordCount !== completedManifest.totalRecordCount ||
      verified.header.library_id !== request.libraryId ||
      verified.header.epoch_id !== request.storageEpoch ||
      verified.header.materializer_position.frontier_digest !==
        completedManifest.causalFrontierDigest
    ) {
      throw new TypeError(
        "portable checkpoint header does not match its authenticated manifest",
      );
    }
    const stagingReceipt = await request.writer.finalizeImport({
      header: verified.header,
      manifest: completedManifest,
      manifestReference: completedManifestReference,
    });
    if (
      stagingReceipt.libraryId !== verified.header.library_id ||
      stagingReceipt.storageEpoch !== verified.header.epoch_id ||
      stagingReceipt.frontierDigest !==
        verified.header.materializer_position.frontier_digest ||
      stagingReceipt.ingestSequence !==
        verified.header.materializer_position.ingest_sequence ||
      stagingReceipt.materializedDigest !==
        verified.header.materializer_position.materialized_digest ||
      stagingReceipt.recordCount !== verified.recordCount
    ) {
      throw new TypeError(
        "portable checkpoint staging receipt does not match the verified logical checkpoint",
      );
    }
    return Object.freeze({
      header: verified.header,
      importedPageCount: imported.importedPageCount,
      importedRecordCount: imported.importedRecordCount,
      status: "imported",
    });
  } catch (error) {
    await request.writer.abortImport?.(error);
    throw error;
  }
}
