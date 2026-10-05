import {
  createLibraryCoreImmutableObjectKey,
  encodeLibraryCoreCanonicalValue,
  parseLibraryCoreImmutableObjectDescriptorV1,
  parseLibraryCoreImmutableObjectReferenceV1,
  parseLibraryCoreNormalizedOperationSegmentV2,
  sha256LowerHex,
  sameLibraryCoreNormalizedOperationAnchorV2,
  type LibraryCoreNormalizedOperationAnchorV2,
  type LibraryCoreCanonicalValue,
  type LibraryCoreImmutableObjectReferenceV1,
  type LibraryCoreNormalizedOperationSegmentV2,
  type LibraryCoreNormalizedOperationExportRecordV2,
} from "@freed/shared/library-core";
import type { LibraryCoreImmutableReadAdapterV1, LibraryCorePreparedImmutableObjectV1 } from "./library-core-immutable-publication.js";
import { decodeLibraryCoreWireObjectV1, encodeLibraryCoreWireObjectV1 } from "./library-core-wire-object.js";

const MAX_RECORD_BYTES = 131_072;
const MAX_WIRE_BYTES = 1_048_576 + MAX_RECORD_BYTES + 16 + 129 * 4;
const options = {
  kind: "operations" as const,
  maximumDecodedBytes: MAX_WIRE_BYTES,
  maximumRecordBytes: MAX_RECORD_BYTES,
  maximumRecords: 129,
  // The header contains one exact ordered metadata row for every signed value.
  recordIdentity(value: LibraryCoreCanonicalValue): string {
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError("Operation wire record is invalid.");
    const record = value as Readonly<Record<string, LibraryCoreCanonicalValue>>;
    if (record.format === "freed_normalized_operation_segment_v2") return "header";
    if (typeof record.operation_id === "string") return `operation:${record.operation_id}`;
    if (typeof record.result_body_digest === "string") return `result:${record.result_body_digest}`;
    throw new TypeError("Operation wire record identity is invalid.");
  },
};

export async function prepareLibraryCoreNormalizedOperationSegmentV2(value: LibraryCoreNormalizedOperationSegmentV2): Promise<LibraryCorePreparedImmutableObjectV1<Uint8Array>> {
  const segment = parseLibraryCoreNormalizedOperationSegmentV2(value);
  const { page, ...identity } = segment;
  const header = {
    ...identity,
    page: {
      canonicalRecordBytes: page.canonicalRecordBytes, done: page.done, nextCursor: page.nextCursor,
      records: page.records.map(({ canonicalRecordJson: _json, ...record }) => record),
    },
  };
  const values = [header, ...page.records.map((record) => JSON.parse(record.canonicalRecordJson))] as LibraryCoreCanonicalValue[];
  const source = await encodeLibraryCoreWireObjectV1(values, options);
  const digest = sha256LowerHex(source);
  return Object.freeze({
    source,
    descriptor: parseLibraryCoreImmutableObjectDescriptorV1({
      byteLength: source.byteLength, contentDigest: digest,
      objectKey: createLibraryCoreImmutableObjectKey({
        kind: "operation_segment", libraryId: segment.libraryId, epochId: segment.storageEpoch,
        firstSequence: segment.segmentIndex, lastSequence: segment.segmentIndex, digest,
      }),
    }),
  });
}

export async function readLibraryCoreNormalizedOperationSegmentV2(input: {
  readonly adapter: LibraryCoreImmutableReadAdapterV1;
  readonly reference: LibraryCoreImmutableObjectReferenceV1;
  readonly expectedAnchor: LibraryCoreNormalizedOperationAnchorV2;
  readonly expectedSegmentIndex: number;
}): Promise<LibraryCoreNormalizedOperationSegmentV2> {
  const reference = parseLibraryCoreImmutableObjectReferenceV1(input.reference);
  if (reference.descriptor.byteLength >= 5_000_000) throw new RangeError("Operation object exceeds its stored byte bound.");
  const source = await input.adapter.readImmutable(reference);
  if (source.byteLength !== reference.descriptor.byteLength || sha256LowerHex(source) !== reference.descriptor.contentDigest) {
    throw new Error("Normalized operation object bytes changed.");
  }
  const values = await decodeLibraryCoreWireObjectV1(source, options);
  const header = values[0] as unknown as { page?: { records?: unknown[] } };
  if (!header?.page || !Array.isArray(header.page.records) || values.length !== header.page.records.length + 1) {
    throw new TypeError("Normalized operation wire membership changed.");
  }
  const records = header.page.records.map((metadata, index) => {
    if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)
      || Object.keys(metadata).sort().join(",") !== "kind,memberIndex,recordDigest,sourceRevision,transactionDigest,transactionId") {
      throw new TypeError("Operation wire metadata field set changed.");
    }
    return ({
    ...(metadata as Omit<LibraryCoreNormalizedOperationExportRecordV2, "canonicalRecordJson">),
    canonicalRecordJson: new TextDecoder("utf-8", { fatal: true }).decode(
      encodeLibraryCoreCanonicalValue(values[index + 1]!, { maximumBytes: MAX_RECORD_BYTES }),
    ),
    });
  });
  const segment = parseLibraryCoreNormalizedOperationSegmentV2({ ...header, page: { ...header.page, records } });
  if (!sameLibraryCoreNormalizedOperationAnchorV2(segment, input.expectedAnchor)
    || segment.segmentIndex !== input.expectedSegmentIndex) {
    throw new Error("Normalized operation checkpoint anchor or chain index changed.");
  }
  const expectedKey = createLibraryCoreImmutableObjectKey({
    kind: "operation_segment", libraryId: segment.libraryId, epochId: segment.storageEpoch,
    firstSequence: segment.segmentIndex, lastSequence: segment.segmentIndex, digest: reference.descriptor.contentDigest,
  });
  if (reference.descriptor.objectKey !== expectedKey) throw new Error("Normalized operation object key changed.");
  return segment;
}
