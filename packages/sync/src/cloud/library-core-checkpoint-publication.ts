import {
  createLibraryCoreImmutableObjectKey,
  encodeLibraryCoreCanonicalValue,
  isLibraryCoreOperationInstanceId,
  LIBRARY_CORE_CHECKPOINT_MANIFEST_PAGE_LIMIT,
  LIBRARY_CORE_CHECKPOINT_MANIFEST_PAGE_RECORD_LIMIT,
  LIBRARY_CORE_CHECKPOINT_MANIFEST_RECORD_LIMIT,
  LIBRARY_CORE_CLOUD_TRANSPORT_IDS,
  parseLibraryCoreCheckpointManifestV1,
  parseLibraryCoreControlPointerV1,
  parseLibraryCoreImmutableObjectDescriptorV1,
  type LibraryCoreCanonicalValue,
  type LibraryCoreCheckpointDatasetSchemaId,
  type LibraryCoreCloudTransportId,
  type LibraryCoreControlPointerV1,
  type LibraryCoreLowercaseHex64,
} from "@freed/shared/library-core";
import {
  publishLibraryCoreImmutableGenerationV1,
  reassignLibraryCoreWriterV1,
  type LibraryCoreImmutablePublicationAdapterV1,
  type LibraryCoreImmutablePublicationResultV1,
  type LibraryCorePreparedImmutableObjectV1,
  type LibraryCorePublishedImmutableObjectReceiptV1,
} from "./library-core-immutable-publication.js";
import {
  LIBRARY_CORE_CHECKPOINT_MANIFEST_BYTE_LIMIT,
  LIBRARY_CORE_CHECKPOINT_PAGE_DECODED_BYTE_LIMIT,
  LIBRARY_CORE_CHECKPOINT_RECORD_BYTE_LIMIT,
} from "./library-core-checkpoint-import.js";
import { decodeLibraryCoreWireObjectV1 } from "./library-core-wire-object.js";

export const LIBRARY_CORE_CHECKPOINT_PUBLICATION_PAGE_LIMIT = 4_096;

export interface LibraryCorePreparedCheckpointPageV1 {
  readonly firstRecordIdentity: string;
  readonly lastRecordIdentity: string;
  readonly object: LibraryCorePreparedImmutableObjectV1<Uint8Array>;
  readonly pageIndex: number;
  readonly recordCount: number;
}

export interface PublishLibraryCoreCheckpointGenerationRequestV1<RecordValue> {
  readonly activeTransport: LibraryCoreCloudTransportId;
  readonly adapter: LibraryCoreImmutablePublicationAdapterV1<Uint8Array>;
  readonly causalFrontierDigest: LibraryCoreLowercaseHex64;
  readonly datasetSchemaId: LibraryCoreCheckpointDatasetSchemaId;
  readonly expectedControl: {
    readonly revision: string | null;
    readonly pointer: LibraryCoreControlPointerV1 | null;
  };
  readonly generation: number;
  readonly libraryId: string;
  readonly pages:
    | Iterable<LibraryCorePreparedCheckpointPageV1>
    | AsyncIterable<LibraryCorePreparedCheckpointPageV1>;
  readonly parseRecord: (value: LibraryCoreCanonicalValue) => RecordValue;
  readonly recordIdentity: (record: RecordValue) => string;
  readonly storageEpoch: string;
  readonly subtle: SubtleCrypto;
  readonly writerId: string;
}

export interface ReassignLibraryCoreCheckpointGenerationRequestV1<RecordValue>
  extends PublishLibraryCoreCheckpointGenerationRequestV1<RecordValue> {
  readonly expectedControl: {
    readonly revision: string;
    readonly pointer: LibraryCoreControlPointerV1;
  };
  readonly epochCertificate: LibraryCorePreparedImmutableObjectV1<Uint8Array>;
}

function exactArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const output = new Uint8Array(bytes.byteLength);
  output.set(bytes);
  return output.buffer;
}

function lowercaseHex(bytes: ArrayBuffer): string {
  return [...new Uint8Array(bytes)]
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");
}

async function sha256(
  bytes: Uint8Array,
  subtle: SubtleCrypto,
): Promise<LibraryCoreLowercaseHex64> {
  return lowercaseHex(
    await subtle.digest("SHA-256", exactArrayBuffer(bytes)),
  ) as LibraryCoreLowercaseHex64;
}

function isUint8Array(value: unknown): value is Uint8Array {
  return (
    ArrayBuffer.isView(value) &&
    Object.prototype.toString.call(value) === "[object Uint8Array]" &&
    (value as Uint8Array).BYTES_PER_ELEMENT === 1
  );
}

const textEncoder = new TextEncoder();

function compareBytes(left: Uint8Array, right: Uint8Array): number {
  const sharedLength = Math.min(left.byteLength, right.byteLength);
  for (let index = 0; index < sharedLength; index += 1) {
    const difference = left[index]! - right[index]!;
    if (difference !== 0) return difference;
  }
  return left.byteLength - right.byteLength;
}

function boundedIdentity(value: unknown, label: string): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > 512 ||
    textEncoder.encode(value).byteLength > 512
  ) {
    throw new TypeError(`${label} must be bounded nonempty text`);
  }
  return value;
}

function assertWriterPreflight<RecordValue>(
  request: PublishLibraryCoreCheckpointGenerationRequestV1<RecordValue>,
): void {
  parseLibraryCoreCheckpointManifestV1({
    causalFrontierDigest: request.causalFrontierDigest,
    datasetSchemaId: request.datasetSchemaId,
    generation: request.generation,
    kind: "checkpoint_manifest",
    libraryId: request.libraryId,
    pages: [],
    protocolVersion: 1,
    schemaVersion: 1,
    storageEpoch: request.storageEpoch,
    totalRecordCount: 0,
  });
  if (!isLibraryCoreOperationInstanceId(request.writerId)) {
    throw new TypeError(
      "checkpoint publication writerId must be a bounded Library Core identifier",
    );
  }
  if (!LIBRARY_CORE_CLOUD_TRANSPORT_IDS.includes(request.activeTransport)) {
    throw new TypeError(
      "checkpoint publication activeTransport is unsupported",
    );
  }
  if (
    request.subtle === null ||
    typeof request.subtle !== "object" ||
    typeof request.subtle.digest !== "function"
  ) {
    throw new TypeError(
      "checkpoint publication subtle must provide SHA-256 digest support",
    );
  }
  const expectedPointer =
    request.expectedControl.pointer === null
      ? null
      : parseLibraryCoreControlPointerV1(request.expectedControl.pointer);
  if (expectedPointer === null) {
    if (request.generation !== 0) {
      throw new TypeError(
        "the first checkpoint publication must use generation zero",
      );
    }
  } else if (
    request.libraryId !== expectedPointer.libraryId ||
    request.storageEpoch !== expectedPointer.storageEpoch ||
    request.writerId !== expectedPointer.writerId ||
    request.activeTransport !== expectedPointer.activeTransport ||
    request.generation <= expectedPointer.generation
  ) {
    throw new TypeError(
      "checkpoint publication must preserve library, writer epoch, and active transport while advancing generation",
    );
  }
}

function assertReassignmentPreflight<RecordValue>(
  request: ReassignLibraryCoreCheckpointGenerationRequestV1<RecordValue>,
): void {
  parseLibraryCoreCheckpointManifestV1({
    causalFrontierDigest: request.causalFrontierDigest,
    datasetSchemaId: request.datasetSchemaId,
    generation: request.generation,
    kind: "checkpoint_manifest",
    libraryId: request.libraryId,
    pages: [],
    protocolVersion: 1,
    schemaVersion: 1,
    storageEpoch: request.storageEpoch,
    totalRecordCount: 0,
  });
  const previous = parseLibraryCoreControlPointerV1(
    request.expectedControl.pointer,
  );
  if (
    !isLibraryCoreOperationInstanceId(request.writerId) ||
    request.generation !== 0 ||
    request.libraryId !== previous.libraryId ||
    request.activeTransport !== previous.activeTransport ||
    request.causalFrontierDigest !== previous.causalFrontierDigest ||
    request.storageEpoch === previous.storageEpoch ||
    request.writerId === previous.writerId
  ) {
    throw new TypeError(
      "checkpoint writer reassignment must preserve the library, transport, and frontier while creating generation zero for a new epoch and writer",
    );
  }
  if (!LIBRARY_CORE_CLOUD_TRANSPORT_IDS.includes(request.activeTransport)) {
    throw new TypeError(
      "checkpoint publication activeTransport is unsupported",
    );
  }
  if (
    request.subtle === null ||
    typeof request.subtle !== "object" ||
    typeof request.subtle.digest !== "function"
  ) {
    throw new TypeError(
      "checkpoint publication subtle must provide SHA-256 digest support",
    );
  }
}

interface PreparedPageMetadataV1 {
  readonly firstRecordIdentity: string;
  readonly lastRecordIdentity: string;
  readonly pageIndex: number;
  readonly recordCount: number;
}

async function* checkpointDependencies<RecordValue>(
  request: PublishLibraryCoreCheckpointGenerationRequestV1<RecordValue>,
  metadata: PreparedPageMetadataV1[],
): AsyncIterable<LibraryCorePreparedImmutableObjectV1<Uint8Array>> {
  let pageIndex = 0;
  let totalRecordCount = 0;
  let previousLastIdentity: string | null = null;
  for await (const page of request.pages) {
    if (
      pageIndex >=
      Math.min(
        LIBRARY_CORE_CHECKPOINT_MANIFEST_PAGE_LIMIT,
        LIBRARY_CORE_CHECKPOINT_PUBLICATION_PAGE_LIMIT,
      )
    ) {
      throw new RangeError(
        `checkpoint publication exceeds ${LIBRARY_CORE_CHECKPOINT_PUBLICATION_PAGE_LIMIT.toLocaleString()} pages`,
      );
    }
    if (page.pageIndex !== pageIndex) {
      throw new TypeError(
        "checkpoint publication page indexes must be contiguous",
      );
    }
    if (
      !Number.isSafeInteger(page.recordCount) ||
      page.recordCount <= 0 ||
      page.recordCount > LIBRARY_CORE_CHECKPOINT_MANIFEST_PAGE_RECORD_LIMIT
    ) {
      throw new RangeError(
        `checkpoint publication pages must contain between 1 and ${LIBRARY_CORE_CHECKPOINT_MANIFEST_PAGE_RECORD_LIMIT.toLocaleString()} records`,
      );
    }
    totalRecordCount += page.recordCount;
    if (totalRecordCount > LIBRARY_CORE_CHECKPOINT_MANIFEST_RECORD_LIMIT) {
      throw new RangeError(
        `checkpoint publication exceeds ${LIBRARY_CORE_CHECKPOINT_MANIFEST_RECORD_LIMIT.toLocaleString()} records`,
      );
    }
    const firstRecordIdentity = boundedIdentity(
      page.firstRecordIdentity,
      "checkpoint publication firstRecordIdentity",
    );
    const lastRecordIdentity = boundedIdentity(
      page.lastRecordIdentity,
      "checkpoint publication lastRecordIdentity",
    );
    const rangeOrder = compareBytes(
      textEncoder.encode(firstRecordIdentity),
      textEncoder.encode(lastRecordIdentity),
    );
    if (rangeOrder > 0 || (rangeOrder === 0 && page.recordCount !== 1)) {
      throw new TypeError(
        "checkpoint publication page identity range does not match its record count",
      );
    }
    if (
      previousLastIdentity !== null &&
      compareBytes(
        textEncoder.encode(firstRecordIdentity),
        textEncoder.encode(previousLastIdentity),
      ) <= 0
    ) {
      throw new TypeError(
        "checkpoint publication page identity ranges must be strictly increasing",
      );
    }
    const descriptor = parseLibraryCoreImmutableObjectDescriptorV1(
      page.object.descriptor,
    );
    const expectedObjectKey = createLibraryCoreImmutableObjectKey({
      kind: "checkpoint_page",
      libraryId: request.libraryId,
      epochId: request.storageEpoch,
      generation: request.generation,
      pageIndex,
      digest: descriptor.contentDigest,
    });
    if (descriptor.objectKey !== expectedObjectKey) {
      throw new TypeError(
        "checkpoint publication page does not match its library, epoch, generation, and page index",
      );
    }
    if (!isUint8Array(page.object.source)) {
      throw new TypeError(
        "checkpoint publication page sources must be Uint8Array values",
      );
    }
    if (page.object.source.byteLength !== descriptor.byteLength) {
      throw new Error(
        "checkpoint publication page byte length does not match its descriptor",
      );
    }
    if (
      (await sha256(page.object.source, request.subtle)) !==
      descriptor.contentDigest
    ) {
      throw new Error(
        "checkpoint publication page digest does not match its descriptor",
      );
    }
    const recordIdentities: string[] = [];
    const records = await decodeLibraryCoreWireObjectV1(page.object.source, {
      kind: "checkpoint",
      maximumDecodedBytes: LIBRARY_CORE_CHECKPOINT_PAGE_DECODED_BYTE_LIMIT,
      maximumRecordBytes: LIBRARY_CORE_CHECKPOINT_RECORD_BYTE_LIMIT,
      maximumRecords: LIBRARY_CORE_CHECKPOINT_MANIFEST_PAGE_RECORD_LIMIT,
      recordIdentity(value) {
        const identity = boundedIdentity(
          request.recordIdentity(request.parseRecord(value)),
          "checkpoint publication record identity",
        );
        recordIdentities.push(identity);
        return identity;
      },
    });
    if (
      records.length !== page.recordCount ||
      recordIdentities[0] !== firstRecordIdentity ||
      recordIdentities.at(-1) !== lastRecordIdentity
    ) {
      throw new TypeError(
        "checkpoint publication page contents do not match their declared count and identity range",
      );
    }
    for (
      let recordIndex = 1;
      recordIndex < recordIdentities.length;
      recordIndex += 1
    ) {
      if (
        compareBytes(
          textEncoder.encode(recordIdentities[recordIndex]!),
          textEncoder.encode(recordIdentities[recordIndex - 1]!),
        ) <= 0
      ) {
        throw new TypeError(
          "checkpoint publication page record identities must be strictly increasing",
        );
      }
    }
    metadata.push(
      Object.freeze({
        firstRecordIdentity,
        lastRecordIdentity,
        pageIndex,
        recordCount: page.recordCount,
      }),
    );
    previousLastIdentity = lastRecordIdentity;
    pageIndex += 1;
    yield Object.freeze({
      descriptor,
      source: page.object.source,
    });
  }
}

/**
 * Publish one exact logical checkpoint generation.
 *
 * Page bytes are uploaded and remotely verified first. The canonical manifest
 * is then built only from those exact provider receipts, published, verified,
 * and bound into the compare-and-swap control pointer.
 */
export async function publishLibraryCoreCheckpointGenerationV1<RecordValue>(
  request: PublishLibraryCoreCheckpointGenerationRequestV1<RecordValue>,
): Promise<LibraryCoreImmutablePublicationResultV1> {
  assertWriterPreflight(request);
  return publishPreparedCheckpointGenerationV1(request, null);
}

/** Publish generation zero while atomically assigning a fresh writer epoch. */
export async function reassignLibraryCoreCheckpointGenerationV1<RecordValue>(
  request: ReassignLibraryCoreCheckpointGenerationRequestV1<RecordValue>,
): Promise<LibraryCoreImmutablePublicationResultV1> {
  assertReassignmentPreflight(request);
  return publishPreparedCheckpointGenerationV1(
    request,
    request.epochCertificate,
  );
}

async function publishPreparedCheckpointGenerationV1<RecordValue>(
  request: PublishLibraryCoreCheckpointGenerationRequestV1<RecordValue>,
  epochCertificate: LibraryCorePreparedImmutableObjectV1<Uint8Array> | null,
): Promise<LibraryCoreImmutablePublicationResultV1> {
  const pages: PreparedPageMetadataV1[] = [];
  const publication = {
    adapter: request.adapter,
    expectedControl: request.expectedControl,
    dependencies: checkpointDependencies(request, pages),
    async prepareManifest(
      receipts: readonly LibraryCorePublishedImmutableObjectReceiptV1[],
    ) {
      const pageReceipts =
        epochCertificate === null ? receipts : receipts.slice(1);
      const manifest = parseLibraryCoreCheckpointManifestV1({
        causalFrontierDigest: request.causalFrontierDigest,
        datasetSchemaId: request.datasetSchemaId,
        generation: request.generation,
        kind: "checkpoint_manifest",
        libraryId: request.libraryId,
        pages: pages.map((page, pageIndex) => ({
          ...page,
          object: {
            descriptor: pageReceipts[pageIndex]?.descriptor,
            transportObjectId: pageReceipts[pageIndex]?.transportObjectId,
          },
        })),
        protocolVersion: 1,
        schemaVersion: 1,
        storageEpoch: request.storageEpoch,
        totalRecordCount: pages.reduce(
          (count, page) => count + page.recordCount,
          0,
        ),
      });
      const source = encodeLibraryCoreCanonicalValue(
        manifest as unknown as LibraryCoreCanonicalValue,
        { maximumBytes: LIBRARY_CORE_CHECKPOINT_MANIFEST_BYTE_LIMIT },
      );
      const contentDigest = await sha256(source, request.subtle);
      const descriptor = parseLibraryCoreImmutableObjectDescriptorV1({
        objectKey: createLibraryCoreImmutableObjectKey({
          kind: "checkpoint_manifest",
          libraryId: request.libraryId,
          epochId: request.storageEpoch,
          generation: request.generation,
          digest: contentDigest,
        }),
        contentDigest,
        byteLength: source.byteLength,
      });

      return {
        manifest: Object.freeze({ descriptor, source }),
        prepareControlPointer(
          manifestReceipt: LibraryCorePublishedImmutableObjectReceiptV1,
        ) {
          return parseLibraryCoreControlPointerV1({
            activeTransport: request.activeTransport,
            causalFrontierDigest: request.causalFrontierDigest,
            generation: request.generation,
            libraryId: request.libraryId,
            manifest: {
              descriptor: manifestReceipt.descriptor,
              transportObjectId: manifestReceipt.transportObjectId,
            },
            protocolVersion: 1,
            schemaVersion: 1,
            storageEpoch: request.storageEpoch,
            writerId: request.writerId,
          });
        },
      };
    },
  };
  if (epochCertificate === null) {
    return publishLibraryCoreImmutableGenerationV1(publication);
  }
  const reassignment = request as ReassignLibraryCoreCheckpointGenerationRequestV1<RecordValue>;
  return reassignLibraryCoreWriterV1({
    ...publication,
    expectedControl: reassignment.expectedControl,
    epochCertificate,
    targetStorageEpoch: reassignment.storageEpoch,
    targetWriterId: reassignment.writerId,
  });
}
