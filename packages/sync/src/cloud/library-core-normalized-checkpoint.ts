import {
  createLibraryCoreImmutableObjectKey,
  createLibraryCoreNormalizedCheckpointDigestAccumulatorV2,
  encodeLibraryCoreCanonicalValue,
  LIBRARY_CORE_CHECKPOINT_PAGE_MAXIMUM_DECODED_BYTES,
  LIBRARY_CORE_CHECKPOINT_PAGE_MAXIMUM_RECORDS,
  LIBRARY_CORE_CHECKPOINT_RECORD_MAXIMUM_CANONICAL_BYTES,
  LIBRARY_CORE_NORMALIZED_CHECKPOINT_DATASET_SCHEMA_ID,
  LIBRARY_CORE_WIRE_FRAME_HEADER_BYTES,
  LIBRARY_CORE_WIRE_FRAME_RECORD_LENGTH_BYTES,
  libraryCoreNormalizedCheckpointRecordIdentityV2,
  parseLibraryCoreImmutableObjectDescriptorV1,
  parseLibraryCoreNormalizedCheckpointExportDescriptorV2,
  parseLibraryCoreNormalizedCheckpointRecordV2,
  type LibraryCoreCanonicalValue,
  type LibraryCoreCloudTransportId,
  type LibraryCoreControlPointerV1,
  type LibraryCoreCheckpointManifestV1,
  type LibraryCoreImmutableObjectReferenceV1,
  type LibraryCoreLowercaseHex64,
  type LibraryCoreNormalizedCheckpointActivationReceiptV2,
  type LibraryCoreNormalizedCheckpointExportDescriptorV2,
  type LibraryCoreNormalizedCheckpointRecordV2,
} from "@freed/shared/library-core";
import {
  publishLibraryCoreCheckpointGenerationV1,
  reassignLibraryCoreCheckpointGenerationV1,
  type LibraryCorePreparedCheckpointPageV1,
} from "./library-core-checkpoint-publication.js";
import {
  importLibraryCoreCheckpointManifestV1,
  type ImportLibraryCoreCheckpointManifestResultV1,
} from "./library-core-checkpoint-import.js";
import type {
  LibraryCoreImmutableReadAdapterV1,
  LibraryCoreImmutablePublicationAdapterV1,
  LibraryCoreImmutablePublicationResultV1,
  LibraryCorePreparedImmutableObjectV1,
} from "./library-core-immutable-publication.js";
import { encodeLibraryCoreWireObjectV1 } from "./library-core-wire-object.js";

const NORMALIZED_CHECKPOINT_PAGE_LIMIT = 8_192;

export interface LibraryCoreNormalizedCheckpointImportWriterV2 {
  prepareImport?(
    manifest: LibraryCoreCheckpointManifestV1,
    manifestReference: LibraryCoreImmutableObjectReferenceV1,
  ): Promise<"already_complete" | "import">;
  beginImport(input: {
    readonly header: LibraryCoreNormalizedCheckpointRecordV2;
    readonly manifest: LibraryCoreCheckpointManifestV1;
    readonly manifestReference: LibraryCoreImmutableObjectReferenceV1;
  }): Promise<void>;
  appendPage(
    pageIndex: number,
    records: readonly LibraryCoreNormalizedCheckpointRecordV2[],
  ): Promise<void>;
  finalizeImport(input: {
    readonly canonicalBytes: number;
    readonly checkpointDigest: LibraryCoreLowercaseHex64;
    readonly recordCount: number;
  }): Promise<LibraryCoreNormalizedCheckpointActivationReceiptV2>;
  abortImport?(): Promise<void>;
}

export interface ImportLibraryCoreNormalizedCheckpointRequestV2 {
  readonly adapter: LibraryCoreImmutableReadAdapterV1;
  readonly generation: number;
  readonly libraryId: string;
  readonly manifest: LibraryCoreImmutableObjectReferenceV1;
  readonly storageEpoch: string;
  readonly subtle: SubtleCrypto;
  readonly writer: LibraryCoreNormalizedCheckpointImportWriterV2;
}

export interface ImportLibraryCoreNormalizedCheckpointResultV2
  extends ImportLibraryCoreCheckpointManifestResultV1 {
  readonly activationReceipt: LibraryCoreNormalizedCheckpointActivationReceiptV2 | null;
}

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

async function sha256(bytes: Uint8Array, subtle: SubtleCrypto): Promise<string> {
  const digest = new Uint8Array(
    await subtle.digest("SHA-256", exactArrayBuffer(bytes)),
  );
  return Array.from(digest, (value) =>
    value.toString(16).padStart(2, "0"),
  ).join("");
}

function canonicalRecord(
  record: LibraryCoreNormalizedCheckpointRecordV2,
): LibraryCoreCanonicalValue {
  return record as unknown as LibraryCoreCanonicalValue;
}

function encodedRecordByteLength(
  record: LibraryCoreNormalizedCheckpointRecordV2,
): number {
  return encodeLibraryCoreCanonicalValue(canonicalRecord(record), {
    maximumBytes: LIBRARY_CORE_CHECKPOINT_RECORD_MAXIMUM_CANONICAL_BYTES,
  }).byteLength;
}

export interface PrepareLibraryCoreNormalizedCheckpointPagesRequestV2 {
  readonly descriptor: LibraryCoreNormalizedCheckpointExportDescriptorV2;
  readonly generation: number;
  readonly records:
    | Iterable<LibraryCoreNormalizedCheckpointRecordV2>
    | AsyncIterable<LibraryCoreNormalizedCheckpointRecordV2>;
  readonly subtle: SubtleCrypto;
}

export async function* prepareLibraryCoreNormalizedCheckpointPagesV2(
  input: PrepareLibraryCoreNormalizedCheckpointPagesRequestV2,
): AsyncIterable<LibraryCorePreparedCheckpointPageV1> {
  const descriptor = parseLibraryCoreNormalizedCheckpointExportDescriptorV2(
    input.descriptor,
  );
  let pageRecords: LibraryCoreNormalizedCheckpointRecordV2[] = [];
  let decodedPageBytes = LIBRARY_CORE_WIRE_FRAME_HEADER_BYTES;
  let pageIndex = 0;
  let recordCount = 0;
  let previousIdentity: string | null = null;

  const flush = async (): Promise<LibraryCorePreparedCheckpointPageV1> => {
    if (pageIndex >= NORMALIZED_CHECKPOINT_PAGE_LIMIT) {
      throw new RangeError("normalized checkpoint exceeds its page limit");
    }
    const firstRecordIdentity = libraryCoreNormalizedCheckpointRecordIdentityV2(
      pageRecords[0]!,
    );
    const lastRecordIdentity = libraryCoreNormalizedCheckpointRecordIdentityV2(
      pageRecords.at(-1)!,
    );
    const source = await encodeLibraryCoreWireObjectV1(
      pageRecords.map(canonicalRecord),
      {
        kind: "checkpoint",
        maximumDecodedBytes:
          LIBRARY_CORE_CHECKPOINT_PAGE_MAXIMUM_DECODED_BYTES,
        maximumRecordBytes:
          LIBRARY_CORE_CHECKPOINT_RECORD_MAXIMUM_CANONICAL_BYTES,
        maximumRecords: LIBRARY_CORE_CHECKPOINT_PAGE_MAXIMUM_RECORDS,
        recordIdentity(value) {
          return libraryCoreNormalizedCheckpointRecordIdentityV2(
            parseLibraryCoreNormalizedCheckpointRecordV2(value),
          );
        },
      },
    );
    const contentDigest = await sha256(source, input.subtle);
    const prepared = Object.freeze({
      firstRecordIdentity,
      lastRecordIdentity,
      object: Object.freeze({
        descriptor: parseLibraryCoreImmutableObjectDescriptorV1({
          byteLength: source.byteLength,
          contentDigest,
          objectKey: createLibraryCoreImmutableObjectKey({
            digest: contentDigest,
            epochId: descriptor.authorityEpoch,
            generation: input.generation,
            kind: "checkpoint_page",
            libraryId: descriptor.libraryId,
            pageIndex,
          }),
        }),
        source,
      }),
      pageIndex,
      recordCount: pageRecords.length,
    });
    pageIndex += 1;
    pageRecords = [];
    decodedPageBytes = LIBRARY_CORE_WIRE_FRAME_HEADER_BYTES;
    return prepared;
  };

  for await (const value of asAsyncIterable(input.records)) {
    const record = parseLibraryCoreNormalizedCheckpointRecordV2(value);
    const identity = libraryCoreNormalizedCheckpointRecordIdentityV2(record);
    if (previousIdentity !== null && identity <= previousIdentity) {
      throw new TypeError(
        "normalized checkpoint records must have unique canonical order",
      );
    }
    if (recordCount === 0) {
      if (
        record.registryKey !== "00_checkpoint_header" ||
        record.payload.libraryId !== descriptor.libraryId ||
        record.payload.authorityEpoch !== descriptor.authorityEpoch ||
        record.payload.sourceRevision !== descriptor.sourceRevision
      ) {
        throw new TypeError(
          "normalized checkpoint header does not match its pinned export",
        );
      }
    }
    const frameBytes =
      LIBRARY_CORE_WIRE_FRAME_RECORD_LENGTH_BYTES +
      encodedRecordByteLength(record);
    if (
      pageRecords.length > 0 &&
      (pageRecords.length === LIBRARY_CORE_CHECKPOINT_PAGE_MAXIMUM_RECORDS ||
        decodedPageBytes + frameBytes >
          LIBRARY_CORE_CHECKPOINT_PAGE_MAXIMUM_DECODED_BYTES)
    ) {
      yield await flush();
    }
    if (
      decodedPageBytes + frameBytes >
      LIBRARY_CORE_CHECKPOINT_PAGE_MAXIMUM_DECODED_BYTES
    ) {
      throw new RangeError(
        "normalized checkpoint record cannot fit inside one bounded page",
      );
    }
    pageRecords.push(record);
    decodedPageBytes += frameBytes;
    previousIdentity = identity;
    recordCount += 1;
  }
  if (recordCount !== descriptor.recordCount || pageRecords.length === 0) {
    throw new TypeError(
      "normalized checkpoint record count changed during publication",
    );
  }
  yield await flush();
}

export interface PublishLibraryCoreNormalizedCheckpointRequestV2
  extends PrepareLibraryCoreNormalizedCheckpointPagesRequestV2 {
  readonly activeTransport: LibraryCoreCloudTransportId;
  readonly adapter: LibraryCoreImmutablePublicationAdapterV1<Uint8Array>;
  readonly expectedControl: {
    readonly revision: string | null;
    readonly pointer: LibraryCoreControlPointerV1 | null;
  };
}

export interface ReassignLibraryCoreNormalizedCheckpointRequestV2
  extends PublishLibraryCoreNormalizedCheckpointRequestV2 {
  readonly expectedControl: {
    readonly revision: string;
    readonly pointer: LibraryCoreControlPointerV1;
  };
  readonly epochCertificate: LibraryCorePreparedImmutableObjectV1<Uint8Array>;
}

export function publishLibraryCoreNormalizedCheckpointV2(
  input: PublishLibraryCoreNormalizedCheckpointRequestV2,
): Promise<LibraryCoreImmutablePublicationResultV1> {
  const descriptor = parseLibraryCoreNormalizedCheckpointExportDescriptorV2(
    input.descriptor,
  );
  return publishLibraryCoreCheckpointGenerationV1({
    activeTransport: input.activeTransport,
    adapter: input.adapter,
    causalFrontierDigest: descriptor.causalFrontierDigest,
    datasetSchemaId: LIBRARY_CORE_NORMALIZED_CHECKPOINT_DATASET_SCHEMA_ID,
    expectedControl: input.expectedControl,
    generation: input.generation,
    libraryId: descriptor.libraryId,
    pages: prepareLibraryCoreNormalizedCheckpointPagesV2(input),
    parseRecord: parseLibraryCoreNormalizedCheckpointRecordV2,
    recordIdentity: libraryCoreNormalizedCheckpointRecordIdentityV2,
    storageEpoch: descriptor.authorityEpoch,
    subtle: input.subtle,
    writerId: descriptor.writerId,
  });
}

export function reassignLibraryCoreNormalizedCheckpointV2(
  input: ReassignLibraryCoreNormalizedCheckpointRequestV2,
): Promise<LibraryCoreImmutablePublicationResultV1> {
  const descriptor = parseLibraryCoreNormalizedCheckpointExportDescriptorV2(
    input.descriptor,
  );
  return reassignLibraryCoreCheckpointGenerationV1({
    activeTransport: input.activeTransport,
    adapter: input.adapter,
    causalFrontierDigest: descriptor.causalFrontierDigest,
    datasetSchemaId: LIBRARY_CORE_NORMALIZED_CHECKPOINT_DATASET_SCHEMA_ID,
    epochCertificate: input.epochCertificate,
    expectedControl: input.expectedControl,
    generation: input.generation,
    libraryId: descriptor.libraryId,
    pages: prepareLibraryCoreNormalizedCheckpointPagesV2(input),
    parseRecord: parseLibraryCoreNormalizedCheckpointRecordV2,
    recordIdentity: libraryCoreNormalizedCheckpointRecordIdentityV2,
    storageEpoch: descriptor.authorityEpoch,
    subtle: input.subtle,
    writerId: descriptor.writerId,
  });
}

export async function importLibraryCoreNormalizedCheckpointV2(
  input: ImportLibraryCoreNormalizedCheckpointRequestV2,
): Promise<ImportLibraryCoreNormalizedCheckpointResultV2> {
  const digest = createLibraryCoreNormalizedCheckpointDigestAccumulatorV2();
  let began = false;
  let importedManifest: LibraryCoreCheckpointManifestV1 | null = null;
  let importedManifestReference: LibraryCoreImmutableObjectReferenceV1 | null =
    null;
  try {
    const imported = await importLibraryCoreCheckpointManifestV1({
      adapter: input.adapter,
      datasetSchemaId: LIBRARY_CORE_NORMALIZED_CHECKPOINT_DATASET_SCHEMA_ID,
      generation: input.generation,
      libraryId: input.libraryId,
      manifest: input.manifest,
      async onPage(pageIndex, records) {
        if (records.length === 0) {
          throw new TypeError("normalized checkpoint page must not be empty");
        }
        if (!began) {
          if (
            pageIndex !== 0 ||
            importedManifest === null ||
            importedManifestReference === null
          ) {
            throw new TypeError(
              "normalized checkpoint import did not begin at its first page",
            );
          }
          const header = records[0]!;
          if (
            header.registryKey !== "00_checkpoint_header" ||
            header.primaryKey !== "checkpoint" ||
            header.payload.libraryId !== importedManifest.libraryId ||
            header.payload.authorityEpoch !== importedManifest.storageEpoch ||
            !Number.isSafeInteger(header.payload.sourceRevision) ||
            (header.payload.sourceRevision as number) < 0
          ) {
            throw new TypeError(
              "normalized checkpoint header does not match its manifest",
            );
          }
          await input.writer.beginImport({
            header,
            manifest: importedManifest,
            manifestReference: importedManifestReference,
          });
          began = true;
        }
        for (const record of records) digest.push(record);
        await input.writer.appendPage(pageIndex, records);
      },
      parseRecord: parseLibraryCoreNormalizedCheckpointRecordV2,
      async prepareImport(manifest, manifestReference) {
        importedManifest = manifest;
        importedManifestReference = manifestReference;
        return (
          (await input.writer.prepareImport?.(
            manifest,
            manifestReference,
          )) ?? "import"
        );
      },
      recordIdentity: libraryCoreNormalizedCheckpointRecordIdentityV2,
      storageEpoch: input.storageEpoch,
      subtle: input.subtle,
    });
    if (imported.status === "already_complete") {
      return Object.freeze({ ...imported, activationReceipt: null });
    }
    if (!began) {
      throw new TypeError("normalized checkpoint imported no records");
    }
    const completed = digest.finish();
    const activationReceipt = await input.writer.finalizeImport(completed);
    if (
      activationReceipt.checkpointDigest !== completed.checkpointDigest ||
      activationReceipt.canonicalBytes !== completed.canonicalBytes ||
      activationReceipt.recordCount !== completed.recordCount ||
      activationReceipt.libraryId !== input.libraryId ||
      activationReceipt.authorityEpoch !== input.storageEpoch
    ) {
      throw new TypeError(
        "normalized checkpoint activation receipt does not match its import",
      );
    }
    return Object.freeze({ ...imported, activationReceipt });
  } catch (error) {
    if (began && input.writer.abortImport !== undefined) {
      try {
        await input.writer.abortImport();
      } catch (abortError) {
        throw new AggregateError(
          [error, abortError],
          "normalized checkpoint import and cleanup both failed",
        );
      }
    }
    throw error;
  }
}
