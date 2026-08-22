import {
  LIBRARY_CORE_CHECKPOINT_PAGE_MAXIMUM_DECODED_BYTES,
  LIBRARY_CORE_CHECKPOINT_PAGE_MAXIMUM_RECORDS,
} from "./sqlite-contract.generated.js";
import type { LibraryCoreNormalizedCheckpointRecordV2 } from "./normalized-checkpoint-contracts.js";
import {
  isLibraryCoreLowercaseHex64,
  isLibraryCoreNonnegativeSafeInteger,
  type LibraryCoreLowercaseHex64,
} from "./protocol-scalars.js";

const textEncoder = new TextEncoder();

export interface LibraryCoreBeginNormalizedCheckpointStageV2 {
  readonly authorityEpoch: string;
  readonly createdAt: number;
  readonly expectedRecordCount: number;
  readonly libraryId: string;
  readonly sourceRevision: number;
  readonly stageId: string;
}

export function parseLibraryCoreNormalizedCheckpointStageStatusV2(
  value: unknown,
): LibraryCoreNormalizedCheckpointStageStatusV2 {
  const record = closedRecord(
    value,
    [
      "complete",
      "expectedRecordCount",
      "stagedCanonicalBytes",
      "stagedRecordCount",
      "stageId",
    ],
    "normalized checkpoint stage status",
  );
  if (
    typeof record.complete !== "boolean" ||
    !isLibraryCoreNonnegativeSafeInteger(record.expectedRecordCount) ||
    record.expectedRecordCount === 0 ||
    !isLibraryCoreNonnegativeSafeInteger(record.stagedCanonicalBytes) ||
    !isLibraryCoreNonnegativeSafeInteger(record.stagedRecordCount) ||
    record.stagedRecordCount > record.expectedRecordCount ||
    record.complete !==
      (record.stagedRecordCount === record.expectedRecordCount)
  ) {
    throw new TypeError("normalized checkpoint stage status is invalid");
  }
  return Object.freeze({
    complete: record.complete,
    expectedRecordCount: record.expectedRecordCount,
    stagedCanonicalBytes: record.stagedCanonicalBytes,
    stagedRecordCount: record.stagedRecordCount,
    stageId: boundedText(record.stageId, "stageId"),
  });
}

export function parseLibraryCoreNormalizedCheckpointActivationReceiptV2(
  value: unknown,
): LibraryCoreNormalizedCheckpointActivationReceiptV2 {
  const record = closedRecord(
    value,
    [
      "authorityEpoch",
      "canonicalBytes",
      "checkpointDigest",
      "libraryId",
      "recordCount",
      "sourceRevision",
      "stageId",
    ],
    "normalized checkpoint activation receipt",
  );
  if (
    !isLibraryCoreNonnegativeSafeInteger(record.canonicalBytes) ||
    record.canonicalBytes === 0 ||
    !isLibraryCoreLowercaseHex64(record.checkpointDigest) ||
    !isLibraryCoreNonnegativeSafeInteger(record.recordCount) ||
    record.recordCount === 0 ||
    !isLibraryCoreNonnegativeSafeInteger(record.sourceRevision)
  ) {
    throw new TypeError(
      "normalized checkpoint activation receipt is invalid",
    );
  }
  return Object.freeze({
    authorityEpoch: boundedText(record.authorityEpoch, "authorityEpoch"),
    canonicalBytes: record.canonicalBytes,
    checkpointDigest: record.checkpointDigest,
    libraryId: boundedText(record.libraryId, "libraryId"),
    recordCount: record.recordCount,
    sourceRevision: record.sourceRevision,
    stageId: boundedText(record.stageId, "stageId"),
  });
}

export interface LibraryCoreNormalizedCheckpointStageStatusV2 {
  readonly complete: boolean;
  readonly expectedRecordCount: number;
  readonly stagedCanonicalBytes: number;
  readonly stagedRecordCount: number;
  readonly stageId: string;
}

export interface LibraryCoreNormalizedCheckpointActivationReceiptV2 {
  readonly authorityEpoch: string;
  readonly canonicalBytes: number;
  readonly checkpointDigest: LibraryCoreLowercaseHex64;
  readonly libraryId: string;
  readonly recordCount: number;
  readonly sourceRevision: number;
  readonly stageId: string;
}

export interface LibraryCoreNormalizedCheckpointStagePageV2 {
  readonly records: readonly LibraryCoreNormalizedCheckpointRecordV2[];
  readonly stageId: string;
}

function closedRecord(value: unknown, keys: readonly string[], label: string) {
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype ||
    Object.getOwnPropertySymbols(value).length !== 0
  ) {
    throw new TypeError(`${label} must be a closed record`);
  }
  const record = value as Record<string, unknown>;
  const actual = Object.keys(record).sort();
  const expected = [...keys].sort();
  if (
    actual.length !== expected.length ||
    actual.some((key, index) => key !== expected[index])
  ) {
    throw new TypeError(`${label} has unknown or missing fields`);
  }
  return record;
}

function boundedText(value: unknown, label: string): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    textEncoder.encode(value).byteLength > 255
  ) {
    throw new TypeError(`${label} must be bounded nonempty text`);
  }
  return value;
}

export function parseLibraryCoreNormalizedCheckpointStageIdV2(
  value: unknown,
): string {
  return boundedText(value, "stageId");
}

export function parseLibraryCoreBeginNormalizedCheckpointStageV2(
  value: unknown,
): LibraryCoreBeginNormalizedCheckpointStageV2 {
  const record = closedRecord(
    value,
    [
      "authorityEpoch",
      "createdAt",
      "expectedRecordCount",
      "libraryId",
      "sourceRevision",
      "stageId",
    ],
    "normalized checkpoint stage",
  );
  if (
    !isLibraryCoreNonnegativeSafeInteger(record.createdAt) ||
    !isLibraryCoreNonnegativeSafeInteger(record.sourceRevision) ||
    !isLibraryCoreNonnegativeSafeInteger(record.expectedRecordCount) ||
    record.expectedRecordCount === 0
  ) {
    throw new TypeError("normalized checkpoint stage identity is invalid");
  }
  return Object.freeze({
    authorityEpoch: boundedText(record.authorityEpoch, "authorityEpoch"),
    createdAt: record.createdAt,
    expectedRecordCount: record.expectedRecordCount,
    libraryId: boundedText(record.libraryId, "libraryId"),
    sourceRevision: record.sourceRevision,
    stageId: boundedText(record.stageId, "stageId"),
  });
}

export function parseLibraryCoreNormalizedCheckpointStagePageV2(
  value: unknown,
): LibraryCoreNormalizedCheckpointStagePageV2 {
  const record = closedRecord(
    value,
    ["records", "stageId"],
    "normalized checkpoint stage page",
  );
  if (
    !Array.isArray(record.records) ||
    record.records.length === 0 ||
    record.records.length > LIBRARY_CORE_CHECKPOINT_PAGE_MAXIMUM_RECORDS
  ) {
    throw new TypeError(
      "normalized checkpoint stage page is outside its record bound",
    );
  }
  return Object.freeze({
    records: Object.freeze([
      ...record.records,
    ]) as readonly LibraryCoreNormalizedCheckpointRecordV2[],
    stageId: boundedText(record.stageId, "stageId"),
  });
}

export function assertLibraryCoreNormalizedCheckpointPageBytesV2(
  canonicalBytes: number,
): void {
  if (
    !isLibraryCoreNonnegativeSafeInteger(canonicalBytes) ||
    canonicalBytes === 0 ||
    canonicalBytes > LIBRARY_CORE_CHECKPOINT_PAGE_MAXIMUM_DECODED_BYTES
  ) {
    throw new RangeError(
      "normalized checkpoint stage page exceeds its decoded byte bound",
    );
  }
}
