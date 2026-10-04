import {
  isLibraryCoreLowercaseHex64,
  isLibraryCoreNonnegativeSafeInteger,
} from "./protocol-scalars.js";
import {
  parseLibraryCoreImmutableObjectReferenceV1,
  type LibraryCoreImmutableObjectReferenceV1,
} from "./immutable-transport-contracts.js";
import {
  parseLibraryCoreNormalizedOperationExportDescriptorV2,
  parseLibraryCoreNormalizedOperationExportPageV2,
  type LibraryCoreNormalizedOperationExportDescriptorV2,
  type LibraryCoreNormalizedOperationExportPageV2,
  type LibraryCoreNormalizedOperationExportRecordV2,
} from "./normalized-operation-replication-contracts.js";

/** Bound a recovery chain independently of Library size. Refresh its checkpoint
 * before appending another segment once this limit is reached. */
export const LIBRARY_CORE_OPERATION_CHAIN_MAXIMUM_SEGMENTS = 64;
export interface LibraryCoreNormalizedOperationAnchorV2 {
  readonly libraryId: string;
  readonly storageEpoch: string;
  readonly writerId: string;
  readonly checkpointDigest: string;
  readonly checkpointRevision: number;
}
export interface LibraryCoreNormalizedOperationHeadV2 extends LibraryCoreNormalizedOperationAnchorV2 {
  readonly format: "freed_normalized_operation_head_v2";
  readonly protocolVersion: 2;
  readonly segmentCount: number;
  readonly tail: LibraryCoreImmutableObjectReferenceV1 | null;
}
export interface LibraryCoreNormalizedOperationSegmentV2 extends LibraryCoreNormalizedOperationAnchorV2 {
  readonly format: "freed_normalized_operation_segment_v2";
  readonly protocolVersion: 2;
  readonly segmentIndex: number;
  readonly previous: LibraryCoreImmutableObjectReferenceV1 | null;
  readonly snapshot: LibraryCoreNormalizedOperationExportDescriptorV2;
  readonly page: LibraryCoreNormalizedOperationExportPageV2;
}

function closed(value: unknown, fields: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || Object.keys(value).sort().join(",") !== [...fields].sort().join(",")) {
    throw new TypeError("Normalized operation transport has an invalid field set.");
  }
  return value as Record<string, unknown>;
}
const anchorFields = ["libraryId", "storageEpoch", "writerId", "checkpointDigest", "checkpointRevision"] as const;
function anchor(value: Record<string, unknown>): LibraryCoreNormalizedOperationAnchorV2 {
  for (const key of ["libraryId", "storageEpoch", "writerId", "checkpointDigest"] as const) {
    if (!isLibraryCoreLowercaseHex64(value[key])) throw new TypeError("Normalized operation anchor identity is invalid.");
  }
  if (!isLibraryCoreNonnegativeSafeInteger(value.checkpointRevision)) {
    throw new TypeError("Normalized operation checkpoint revision is invalid.");
  }
  return Object.freeze({
    libraryId: value.libraryId as string, storageEpoch: value.storageEpoch as string,
    writerId: value.writerId as string, checkpointDigest: value.checkpointDigest as string,
    checkpointRevision: value.checkpointRevision,
  });
}
function index(value: unknown, minimum: number): number {
  if (!isLibraryCoreNonnegativeSafeInteger(value) || value < minimum || value > LIBRARY_CORE_OPERATION_CHAIN_MAXIMUM_SEGMENTS) {
    throw new RangeError("Normalized operation chain exceeds its segment bound.");
  }
  return value;
}

export function parseLibraryCoreNormalizedOperationHeadV2(value: unknown): LibraryCoreNormalizedOperationHeadV2 {
  const input = closed(value, [...anchorFields, "format", "protocolVersion", "segmentCount", "tail"]);
  if (input.format !== "freed_normalized_operation_head_v2" || input.protocolVersion !== 2) {
    throw new TypeError("Normalized operation head version is unsupported.");
  }
  const segmentCount = index(input.segmentCount, 0);
  const tail = input.tail === null ? null : parseLibraryCoreImmutableObjectReferenceV1(input.tail);
  if ((segmentCount === 0) !== (tail === null)) throw new TypeError("Normalized operation head is incomplete.");
  return Object.freeze({ ...anchor(input), format: input.format, protocolVersion: 2, segmentCount, tail });
}

export function parseLibraryCoreNormalizedOperationSegmentV2(value: unknown): LibraryCoreNormalizedOperationSegmentV2 {
  const input = closed(value, [...anchorFields, "format", "protocolVersion", "segmentIndex", "previous", "snapshot", "page"]);
  if (input.format !== "freed_normalized_operation_segment_v2" || input.protocolVersion !== 2) {
    throw new TypeError("Normalized operation segment version is unsupported.");
  }
  const identity = anchor(input);
  const segmentIndex = index(input.segmentIndex, 1);
  const previous = input.previous === null ? null : parseLibraryCoreImmutableObjectReferenceV1(input.previous);
  const snapshot = parseLibraryCoreNormalizedOperationExportDescriptorV2(input.snapshot);
  const page = parseLibraryCoreNormalizedOperationExportPageV2(input.page);
  if ((segmentIndex === 1) !== (previous === null) || page.records.length === 0
    || snapshot.libraryId !== identity.libraryId || snapshot.authorityEpoch !== identity.storageEpoch || snapshot.writerId !== identity.writerId
    || page.records.some((record) => record.sourceRevision <= identity.checkpointRevision
      || record.sourceRevision < snapshot.firstAvailableRevision || record.sourceRevision > snapshot.sourceRevision)) {
    throw new TypeError("Normalized operation segment crossed its authority or checkpoint.");
  }
  let previousRecord: LibraryCoreNormalizedOperationExportRecordV2 | undefined;
  for (const record of page.records) {
    if (previousRecord && (record.sourceRevision < previousRecord.sourceRevision
      || (record.sourceRevision === previousRecord.sourceRevision
        && (record.kind === "accepted_transaction" || record.memberIndex <= previousRecord.memberIndex)))) {
      throw new TypeError("Normalized operation segment records are not ordered.");
    }
    previousRecord = record;
  }
  return Object.freeze({ ...identity, format: input.format, protocolVersion: 2, segmentIndex, previous, snapshot, page });
}

export function sameLibraryCoreNormalizedOperationAnchorV2(left: LibraryCoreNormalizedOperationAnchorV2, right: LibraryCoreNormalizedOperationAnchorV2): boolean {
  return anchorFields.every((field) => left[field] === right[field]);
}
