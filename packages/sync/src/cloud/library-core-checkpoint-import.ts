import {
  createLibraryCoreImmutableObjectKey,
  parseLibraryCoreImmutableObjectDescriptorV1,
  type LibraryCoreCanonicalValue,
  type LibraryCoreImmutableObjectDescriptorV1,
} from "@freed/shared/library-core";
import type {
  LibraryCoreImmutableReadAdapterV1,
  LibraryCorePublishedImmutableObjectReceiptV1,
} from "./library-core-immutable-publication.js";
import { decodeLibraryCoreWireObjectV1 } from "./library-core-wire-object.js";

export const LIBRARY_CORE_CHECKPOINT_PAGE_RECORD_LIMIT = 128;
export const LIBRARY_CORE_CHECKPOINT_PAGE_DECODED_BYTE_LIMIT = 2_097_152;
export const LIBRARY_CORE_CHECKPOINT_RECORD_BYTE_LIMIT = 131_072;
export const LIBRARY_CORE_CHECKPOINT_PAGE_LIMIT = 8_192;
export const LIBRARY_CORE_CHECKPOINT_RECORD_LIMIT = 1_048_576;

const MAX_TRANSPORT_OBJECT_ID_BYTES = 1_024;
const textEncoder = new TextEncoder();

export interface LibraryCoreCheckpointPageReferenceV1 extends LibraryCorePublishedImmutableObjectReceiptV1 {
  readonly pageIndex: number;
}

export interface ImportLibraryCoreCheckpointPagesRequestV1<RecordValue> {
  readonly adapter: LibraryCoreImmutableReadAdapterV1;
  readonly expectedPageCount: number;
  readonly generation: number;
  readonly libraryId: string;
  readonly onPage: (
    pageIndex: number,
    records: readonly RecordValue[],
  ) => Promise<void>;
  readonly pages:
    | Iterable<LibraryCoreCheckpointPageReferenceV1>
    | AsyncIterable<LibraryCoreCheckpointPageReferenceV1>;
  readonly parseRecord: (value: LibraryCoreCanonicalValue) => RecordValue;
  readonly recordIdentity: (record: RecordValue) => string;
  readonly storageEpoch: string;
  readonly subtle: SubtleCrypto;
  readonly totalRecordCount: number;
}

export interface ImportLibraryCoreCheckpointPagesResultV1 {
  readonly importedPageCount: number;
  readonly importedRecordCount: number;
}

function assertBoundedNonemptyText(
  value: unknown,
  label: string,
  maximumBytes: number,
): asserts value is string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    textEncoder.encode(value).byteLength > maximumBytes
  ) {
    throw new TypeError(`${label} must be bounded nonempty text`);
  }
}

function assertSafeIndex(
  value: unknown,
  label: string,
  maximum: number,
): asserts value is number {
  if (
    !Number.isSafeInteger(value) ||
    (value as number) < 0 ||
    (value as number) > maximum
  ) {
    throw new RangeError(
      `${label} must be a nonnegative safe integer no greater than ${maximum.toLocaleString()}`,
    );
  }
}

function checkedIdentity<RecordValue>(
  record: RecordValue,
  identify: (record: RecordValue) => string,
): string {
  const identity = identify(record);
  assertBoundedNonemptyText(identity, "checkpoint record identity", 512);
  return identity;
}

function compareBytes(left: Uint8Array, right: Uint8Array): number {
  const sharedLength = Math.min(left.byteLength, right.byteLength);
  for (let index = 0; index < sharedLength; index += 1) {
    const difference = left[index]! - right[index]!;
    if (difference !== 0) return difference;
  }
  return left.byteLength - right.byteLength;
}

function lowercaseHex(bytes: ArrayBuffer): string {
  return [...new Uint8Array(bytes)]
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");
}

function isUint8Array(value: unknown): value is Uint8Array {
  return (
    ArrayBuffer.isView(value) &&
    Object.prototype.toString.call(value) === "[object Uint8Array]" &&
    (value as Uint8Array).BYTES_PER_ELEMENT === 1
  );
}

function exactArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const output = new Uint8Array(bytes.byteLength);
  output.set(bytes);
  return output.buffer;
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

function exactCheckpointPageDescriptor(
  descriptorInput: LibraryCoreImmutableObjectDescriptorV1,
  request: {
    readonly generation: number;
    readonly libraryId: string;
    readonly pageIndex: number;
    readonly storageEpoch: string;
  },
): LibraryCoreImmutableObjectDescriptorV1 {
  const descriptor =
    parseLibraryCoreImmutableObjectDescriptorV1(descriptorInput);
  const expectedKey = createLibraryCoreImmutableObjectKey({
    kind: "checkpoint_page",
    libraryId: request.libraryId,
    epochId: request.storageEpoch,
    generation: request.generation,
    pageIndex: request.pageIndex,
    digest: descriptor.contentDigest,
  });
  if (descriptor.objectKey !== expectedKey) {
    throw new TypeError(
      "checkpoint page descriptor does not match its library, epoch, generation, and page index",
    );
  }
  return descriptor;
}

/**
 * Verify and import one complete ordered logical checkpoint without retaining
 * the corpus in JavaScript memory.
 *
 * Each page is authenticated and parsed before its bounded rows reach the
 * caller. Record identities must be strictly increasing across the complete
 * checkpoint, which rejects duplicates and reordered pages while retaining
 * only one prior identity.
 */
export async function importLibraryCoreCheckpointPagesV1<RecordValue>(
  request: ImportLibraryCoreCheckpointPagesRequestV1<RecordValue>,
): Promise<ImportLibraryCoreCheckpointPagesResultV1> {
  assertSafeIndex(
    request.expectedPageCount,
    "expectedPageCount",
    LIBRARY_CORE_CHECKPOINT_PAGE_LIMIT,
  );
  assertSafeIndex(
    request.totalRecordCount,
    "totalRecordCount",
    LIBRARY_CORE_CHECKPOINT_RECORD_LIMIT,
  );
  assertSafeIndex(request.generation, "generation", Number.MAX_SAFE_INTEGER);
  if ((request.totalRecordCount === 0) !== (request.expectedPageCount === 0)) {
    throw new TypeError(
      "empty checkpoints must have zero records and zero pages",
    );
  }

  let expectedPageIndex = 0;
  let importedRecordCount = 0;
  let previousIdentityBytes: Uint8Array | null = null;

  for await (const page of asAsyncIterable(request.pages)) {
    if (expectedPageIndex >= request.expectedPageCount) {
      throw new RangeError("checkpoint contains more pages than declared");
    }
    if (page.pageIndex !== expectedPageIndex) {
      throw new TypeError(
        `checkpoint page index must be contiguous at ${expectedPageIndex.toLocaleString()}`,
      );
    }
    assertBoundedNonemptyText(
      page.transportObjectId,
      "checkpoint transportObjectId",
      MAX_TRANSPORT_OBJECT_ID_BYTES,
    );
    const descriptor = exactCheckpointPageDescriptor(page.descriptor, {
      generation: request.generation,
      libraryId: request.libraryId,
      pageIndex: expectedPageIndex,
      storageEpoch: request.storageEpoch,
    });
    const bytes = await request.adapter.readImmutable({
      descriptor,
      transportObjectId: page.transportObjectId,
    });
    if (!isUint8Array(bytes)) {
      throw new TypeError(
        "checkpoint immutable reader must return a Uint8Array",
      );
    }
    if (bytes.byteLength !== descriptor.byteLength) {
      throw new Error("checkpoint page byte length does not match descriptor");
    }
    const digest = lowercaseHex(
      await request.subtle.digest("SHA-256", exactArrayBuffer(bytes)),
    );
    if (digest !== descriptor.contentDigest) {
      throw new Error("checkpoint page digest does not match descriptor");
    }

    const canonicalRecords = await decodeLibraryCoreWireObjectV1(bytes, {
      kind: "checkpoint",
      maximumDecodedBytes: LIBRARY_CORE_CHECKPOINT_PAGE_DECODED_BYTE_LIMIT,
      maximumRecordBytes: LIBRARY_CORE_CHECKPOINT_RECORD_BYTE_LIMIT,
      maximumRecords: LIBRARY_CORE_CHECKPOINT_PAGE_RECORD_LIMIT,
      recordIdentity(value) {
        return checkedIdentity(
          request.parseRecord(value),
          request.recordIdentity,
        );
      },
    });
    if (canonicalRecords.length === 0) {
      throw new TypeError("checkpoint pages must not be empty");
    }

    const records: RecordValue[] = [];
    for (const canonicalRecord of canonicalRecords) {
      const record = request.parseRecord(canonicalRecord);
      const identity = checkedIdentity(record, request.recordIdentity);
      const identityBytes = textEncoder.encode(identity);
      if (
        previousIdentityBytes !== null &&
        compareBytes(identityBytes, previousIdentityBytes) <= 0
      ) {
        throw new TypeError(
          "checkpoint record identities must be strictly increasing",
        );
      }
      previousIdentityBytes = identityBytes;
      records.push(record);
    }
    importedRecordCount += records.length;
    if (importedRecordCount > request.totalRecordCount) {
      throw new RangeError("checkpoint contains more records than declared");
    }
    await request.onPage(expectedPageIndex, Object.freeze(records));
    expectedPageIndex += 1;
  }

  if (expectedPageIndex !== request.expectedPageCount) {
    throw new TypeError("checkpoint ended before every declared page");
  }
  if (importedRecordCount !== request.totalRecordCount) {
    throw new TypeError("checkpoint record count does not match declaration");
  }
  return Object.freeze({
    importedPageCount: expectedPageIndex,
    importedRecordCount,
  });
}
