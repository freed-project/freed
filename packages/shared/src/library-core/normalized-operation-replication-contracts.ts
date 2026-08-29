import {
  encodeLibraryCoreCanonicalValue,
  type LibraryCoreCanonicalValue,
} from "./canonical-codec.js";
import {
  LIBRARY_CORE_FOLLOWER_RESULT_MAXIMUM_CANONICAL_BYTES,
  parseLibraryCoreFollowerResultEnvelopeV1,
} from "./follower-result-contracts.js";
import { parseLibraryCoreNormalizedIntentEnvelopeRecordV2 } from "./normalized-intent-segment-contracts.js";
import {
  isLibraryCoreLowercaseHex64,
  isLibraryCoreNonnegativeSafeInteger,
  isLibraryCoreOperationInstanceId,
  type LibraryCoreLowercaseHex64,
  type LibraryCoreOperationInstanceId,
} from "./protocol-scalars.js";
import {
  LIBRARY_CORE_NORMALIZED_OPERATION_EXPORT_FORMAT,
  LIBRARY_CORE_NORMALIZED_OPERATION_EXPORT_MAXIMUM_RESPONSE_BYTES,
  LIBRARY_CORE_NORMALIZED_OPERATION_RECORD_MAXIMUM_CANONICAL_BYTES,
  LIBRARY_CORE_NORMALIZED_OPERATION_SEGMENT_MAXIMUM_CANONICAL_BYTES,
  LIBRARY_CORE_NORMALIZED_OPERATION_SEGMENT_MAXIMUM_RECORDS,
  LIBRARY_CORE_NORMALIZED_OPERATION_SEGMENT_PROTOCOL_VERSION,
} from "./sqlite-contract.generated.js";

export type LibraryCoreNormalizedOperationRecordKindV2 =
  "accepted_transaction" | "operation";

export interface LibraryCoreNormalizedOperationExportDescriptorV2 {
  readonly authorityEpoch: LibraryCoreLowercaseHex64;
  readonly firstAvailableRevision: number;
  readonly format: typeof LIBRARY_CORE_NORMALIZED_OPERATION_EXPORT_FORMAT;
  readonly libraryId: LibraryCoreLowercaseHex64;
  readonly operationCount: number;
  readonly protocolVersion: typeof LIBRARY_CORE_NORMALIZED_OPERATION_SEGMENT_PROTOCOL_VERSION;
  readonly sourceRevision: number;
  readonly transactionCount: number;
  readonly writerId: LibraryCoreLowercaseHex64;
}

export interface LibraryCoreNormalizedOperationCursorV2 {
  readonly kind: LibraryCoreNormalizedOperationRecordKindV2;
  readonly memberIndex: number;
  readonly recordDigest: LibraryCoreLowercaseHex64;
  readonly sourceRevision: number;
}

export interface LibraryCoreNormalizedOperationExportRequestV2 {
  readonly after: LibraryCoreNormalizedOperationCursorV2 | null;
  readonly afterSourceRevision: number;
  readonly maximumRecords: number;
  readonly maximumResponseBytes: number;
  readonly snapshot: LibraryCoreNormalizedOperationExportDescriptorV2;
}

export interface LibraryCoreNormalizedOperationExportRecordV2 {
  readonly canonicalRecordJson: string;
  readonly kind: LibraryCoreNormalizedOperationRecordKindV2;
  readonly memberIndex: number;
  readonly recordDigest: LibraryCoreLowercaseHex64;
  readonly sourceRevision: number;
  readonly transactionDigest: LibraryCoreLowercaseHex64;
  readonly transactionId: LibraryCoreOperationInstanceId;
}

export interface LibraryCoreNormalizedOperationExportPageV2 {
  readonly canonicalRecordBytes: number;
  readonly done: boolean;
  readonly nextCursor: LibraryCoreNormalizedOperationCursorV2 | null;
  readonly records: readonly LibraryCoreNormalizedOperationExportRecordV2[];
}

export interface LibraryCoreNormalizedOperationImportPageV2 {
  readonly page: LibraryCoreNormalizedOperationExportPageV2;
  readonly receivedAt: number;
  readonly snapshot: LibraryCoreNormalizedOperationExportDescriptorV2;
}

export interface LibraryCoreNormalizedOperationImportReceiptV2 {
  readonly appliedThroughRevision: number;
  readonly appliedTransactionCount: number;
  readonly receivedAt: number;
  readonly stagedRecordCount: number;
  readonly stagedTransactionCount: number;
}

const textEncoder = new TextEncoder();

function closedRecord(
  value: unknown,
  fields: readonly string[],
  label: string,
): Record<string, unknown> {
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(value)) ||
    Object.getOwnPropertySymbols(value).length !== 0
  ) {
    throw new TypeError(`${label} must be a plain closed record`);
  }
  const actual = Object.keys(value).sort();
  const expected = [...fields].sort();
  if (
    actual.length !== expected.length ||
    actual.some((field, index) => field !== expected[index])
  ) {
    throw new TypeError(`${label} has unknown or missing fields`);
  }
  return value as Record<string, unknown>;
}

function operationInstanceId(
  value: unknown,
  label: string,
): LibraryCoreOperationInstanceId {
  if (!isLibraryCoreOperationInstanceId(value)) {
    throw new TypeError(`${label} is invalid`);
  }
  return value;
}

function digest(value: unknown, label: string): LibraryCoreLowercaseHex64 {
  if (!isLibraryCoreLowercaseHex64(value)) {
    throw new TypeError(`${label} is invalid`);
  }
  return value;
}

function nonnegativeInteger(value: unknown, label: string): number {
  if (!isLibraryCoreNonnegativeSafeInteger(value)) {
    throw new TypeError(`${label} is invalid`);
  }
  return value;
}

function recordKind(
  value: unknown,
): LibraryCoreNormalizedOperationRecordKindV2 {
  if (value !== "accepted_transaction" && value !== "operation") {
    throw new TypeError("normalized operation record kind is invalid");
  }
  return value;
}

function memberIndex(
  value: unknown,
  kind: LibraryCoreNormalizedOperationRecordKindV2,
): number {
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    (kind === "accepted_transaction"
      ? value !== -1
      : value < 0 || value >= 1_000)
  ) {
    throw new TypeError("normalized operation member index is invalid");
  }
  return value;
}

function exactCanonicalValue(json: string): LibraryCoreCanonicalValue {
  const bytes = textEncoder.encode(json);
  if (
    bytes.byteLength < 2 ||
    bytes.byteLength >
      LIBRARY_CORE_NORMALIZED_OPERATION_RECORD_MAXIMUM_CANONICAL_BYTES
  ) {
    throw new RangeError("normalized operation record exceeds its byte bound");
  }
  let value: unknown;
  try {
    value = JSON.parse(json);
  } catch {
    throw new TypeError("normalized operation record is not JSON");
  }
  const restored = encodeLibraryCoreCanonicalValue(
    value as LibraryCoreCanonicalValue,
    {
      maximumBytes:
        LIBRARY_CORE_NORMALIZED_OPERATION_RECORD_MAXIMUM_CANONICAL_BYTES,
    },
  );
  if (
    restored.byteLength !== bytes.byteLength ||
    restored.some((byte, index) => byte !== bytes[index])
  ) {
    throw new TypeError(
      "normalized operation record is not exact canonical JSON",
    );
  }
  return value as LibraryCoreCanonicalValue;
}

export function parseLibraryCoreNormalizedOperationExportDescriptorV2(
  value: unknown,
): LibraryCoreNormalizedOperationExportDescriptorV2 {
  const input = closedRecord(
    value,
    [
      "authorityEpoch",
      "firstAvailableRevision",
      "format",
      "libraryId",
      "operationCount",
      "protocolVersion",
      "sourceRevision",
      "transactionCount",
      "writerId",
    ],
    "normalized operation export descriptor",
  );
  if (
    input.format !== LIBRARY_CORE_NORMALIZED_OPERATION_EXPORT_FORMAT ||
    input.protocolVersion !==
      LIBRARY_CORE_NORMALIZED_OPERATION_SEGMENT_PROTOCOL_VERSION
  ) {
    throw new TypeError("normalized operation export version is invalid");
  }
  const sourceRevision = nonnegativeInteger(
    input.sourceRevision,
    "normalized operation source revision",
  );
  const firstAvailableRevision = nonnegativeInteger(
    input.firstAvailableRevision,
    "normalized operation first available revision",
  );
  if (firstAvailableRevision > sourceRevision + 1) {
    throw new TypeError("normalized operation revision range is invalid");
  }
  return Object.freeze({
    authorityEpoch: digest(input.authorityEpoch, "normalized operation epoch"),
    firstAvailableRevision,
    format: LIBRARY_CORE_NORMALIZED_OPERATION_EXPORT_FORMAT,
    libraryId: digest(input.libraryId, "normalized operation Library"),
    operationCount: nonnegativeInteger(
      input.operationCount,
      "normalized operation count",
    ),
    protocolVersion: LIBRARY_CORE_NORMALIZED_OPERATION_SEGMENT_PROTOCOL_VERSION,
    sourceRevision,
    transactionCount: nonnegativeInteger(
      input.transactionCount,
      "normalized operation transaction count",
    ),
    writerId: digest(input.writerId, "normalized operation writer"),
  });
}

export function parseLibraryCoreNormalizedOperationCursorV2(
  value: unknown,
): LibraryCoreNormalizedOperationCursorV2 | null {
  if (value === null) return null;
  const input = closedRecord(
    value,
    ["kind", "memberIndex", "recordDigest", "sourceRevision"],
    "normalized operation cursor",
  );
  const kind = recordKind(input.kind);
  return Object.freeze({
    kind,
    memberIndex: memberIndex(input.memberIndex, kind),
    recordDigest: digest(
      input.recordDigest,
      "normalized operation cursor digest",
    ),
    sourceRevision: nonnegativeInteger(
      input.sourceRevision,
      "normalized operation cursor revision",
    ),
  });
}

export function parseLibraryCoreNormalizedOperationExportRequestV2(
  value: unknown,
): LibraryCoreNormalizedOperationExportRequestV2 {
  const input = closedRecord(
    value,
    [
      "after",
      "afterSourceRevision",
      "maximumRecords",
      "maximumResponseBytes",
      "snapshot",
    ],
    "normalized operation export request",
  );
  const snapshot = parseLibraryCoreNormalizedOperationExportDescriptorV2(
    input.snapshot,
  );
  const afterSourceRevision = nonnegativeInteger(
    input.afterSourceRevision,
    "normalized operation starting revision",
  );
  const after = parseLibraryCoreNormalizedOperationCursorV2(input.after);
  const maximumRecords = nonnegativeInteger(
    input.maximumRecords,
    "normalized operation maximum records",
  );
  const maximumResponseBytes = nonnegativeInteger(
    input.maximumResponseBytes,
    "normalized operation maximum response bytes",
  );
  if (
    afterSourceRevision > snapshot.sourceRevision ||
    maximumRecords < 1 ||
    maximumRecords >
      LIBRARY_CORE_NORMALIZED_OPERATION_SEGMENT_MAXIMUM_RECORDS ||
    maximumResponseBytes < 1 ||
    maximumResponseBytes >
      LIBRARY_CORE_NORMALIZED_OPERATION_EXPORT_MAXIMUM_RESPONSE_BYTES ||
    (after !== null &&
      (after.sourceRevision <= afterSourceRevision ||
        after.sourceRevision > snapshot.sourceRevision))
  ) {
    throw new RangeError("normalized operation export request is invalid");
  }
  return Object.freeze({
    after,
    afterSourceRevision,
    maximumRecords,
    maximumResponseBytes,
    snapshot,
  });
}

export function parseLibraryCoreNormalizedOperationExportRecordV2(
  value: unknown,
): LibraryCoreNormalizedOperationExportRecordV2 {
  const input = closedRecord(
    value,
    [
      "canonicalRecordJson",
      "kind",
      "memberIndex",
      "recordDigest",
      "sourceRevision",
      "transactionDigest",
      "transactionId",
    ],
    "normalized operation export record",
  );
  const kind = recordKind(input.kind);
  if (typeof input.canonicalRecordJson !== "string") {
    throw new TypeError("normalized operation canonical record is invalid");
  }
  const canonical = exactCanonicalValue(input.canonicalRecordJson);
  const sourceRevision = nonnegativeInteger(
    input.sourceRevision,
    "normalized operation record revision",
  );
  const transactionId = operationInstanceId(
    input.transactionId,
    "normalized operation transaction",
  );
  const transactionDigest = digest(
    input.transactionDigest,
    "normalized operation transaction digest",
  );
  const parsedMemberIndex = memberIndex(input.memberIndex, kind);
  if (kind === "accepted_transaction") {
    const result = parseLibraryCoreFollowerResultEnvelopeV1(canonical);
    if (
      result.status !== "accepted" ||
      result.authoritative_source_revision !== sourceRevision ||
      result.transaction_id !== transactionId ||
      result.transaction_digest !== transactionDigest ||
      result.result_body_digest !== input.recordDigest
    ) {
      throw new TypeError("normalized accepted transaction identity changed");
    }
    encodeLibraryCoreCanonicalValue(
      result as unknown as LibraryCoreCanonicalValue,
      { maximumBytes: LIBRARY_CORE_FOLLOWER_RESULT_MAXIMUM_CANONICAL_BYTES },
    );
  } else {
    const operation =
      parseLibraryCoreNormalizedIntentEnvelopeRecordV2(canonical);
    if (
      operation.transaction_id !== transactionId ||
      operation.transaction_digest !== transactionDigest ||
      operation.transaction_member_index !== parsedMemberIndex
    ) {
      throw new TypeError("normalized operation identity changed");
    }
  }
  return Object.freeze({
    canonicalRecordJson: input.canonicalRecordJson,
    kind,
    memberIndex: parsedMemberIndex,
    recordDigest: digest(
      input.recordDigest,
      "normalized operation record digest",
    ),
    sourceRevision,
    transactionDigest,
    transactionId,
  });
}

export function parseLibraryCoreNormalizedOperationExportPageV2(
  value: unknown,
): LibraryCoreNormalizedOperationExportPageV2 {
  const input = closedRecord(
    value,
    ["canonicalRecordBytes", "done", "nextCursor", "records"],
    "normalized operation export page",
  );
  if (!Array.isArray(input.records) || typeof input.done !== "boolean") {
    throw new TypeError("normalized operation export page is invalid");
  }
  const records = Object.freeze(
    input.records.map(parseLibraryCoreNormalizedOperationExportRecordV2),
  );
  const canonicalRecordBytes = nonnegativeInteger(
    input.canonicalRecordBytes,
    "normalized operation page bytes",
  );
  const exactBytes = records.reduce(
    (total, record) =>
      total + textEncoder.encode(record.canonicalRecordJson).byteLength,
    0,
  );
  const nextCursor = parseLibraryCoreNormalizedOperationCursorV2(
    input.nextCursor,
  );
  const last = records.at(-1);
  if (
    records.length >
      LIBRARY_CORE_NORMALIZED_OPERATION_SEGMENT_MAXIMUM_RECORDS ||
    canonicalRecordBytes !== exactBytes ||
    canonicalRecordBytes >
      LIBRARY_CORE_NORMALIZED_OPERATION_SEGMENT_MAXIMUM_CANONICAL_BYTES ||
    (last === undefined) !== (nextCursor === null) ||
    (last !== undefined &&
      (nextCursor?.kind !== last.kind ||
        nextCursor.memberIndex !== last.memberIndex ||
        nextCursor.recordDigest !== last.recordDigest ||
        nextCursor.sourceRevision !== last.sourceRevision))
  ) {
    throw new TypeError("normalized operation export page identity changed");
  }
  return Object.freeze({
    canonicalRecordBytes,
    done: input.done,
    nextCursor,
    records,
  });
}

export function parseLibraryCoreNormalizedOperationImportPageV2(
  value: unknown,
): LibraryCoreNormalizedOperationImportPageV2 {
  const input = closedRecord(
    value,
    ["page", "receivedAt", "snapshot"],
    "normalized operation import page",
  );
  const snapshot = parseLibraryCoreNormalizedOperationExportDescriptorV2(
    input.snapshot,
  );
  const page = parseLibraryCoreNormalizedOperationExportPageV2(input.page);
  const receivedAt = nonnegativeInteger(
    input.receivedAt,
    "normalized operation import time",
  );
  if (
    page.records.some(
      (record) =>
        record.sourceRevision < snapshot.firstAvailableRevision ||
        record.sourceRevision > snapshot.sourceRevision,
    )
  ) {
    throw new TypeError("normalized operation import crossed its snapshot");
  }
  return Object.freeze({ page, receivedAt, snapshot });
}

export function parseLibraryCoreNormalizedOperationImportReceiptV2(
  value: unknown,
): LibraryCoreNormalizedOperationImportReceiptV2 {
  const input = closedRecord(
    value,
    [
      "appliedThroughRevision",
      "appliedTransactionCount",
      "receivedAt",
      "stagedRecordCount",
      "stagedTransactionCount",
    ],
    "normalized operation import receipt",
  );
  const appliedThroughRevision = nonnegativeInteger(
    input.appliedThroughRevision,
    "normalized operation applied revision",
  );
  const appliedTransactionCount = nonnegativeInteger(
    input.appliedTransactionCount,
    "normalized operation applied transaction count",
  );
  const receivedAt = nonnegativeInteger(
    input.receivedAt,
    "normalized operation receipt time",
  );
  const stagedRecordCount = nonnegativeInteger(
    input.stagedRecordCount,
    "normalized operation staged record count",
  );
  const stagedTransactionCount = nonnegativeInteger(
    input.stagedTransactionCount,
    "normalized operation staged transaction count",
  );
  if (
    stagedRecordCount >
      LIBRARY_CORE_NORMALIZED_OPERATION_SEGMENT_MAXIMUM_RECORDS ||
    stagedTransactionCount > stagedRecordCount
  ) {
    throw new TypeError("normalized operation import receipt is invalid");
  }
  return Object.freeze({
    appliedThroughRevision,
    appliedTransactionCount,
    receivedAt,
    stagedRecordCount,
    stagedTransactionCount,
  });
}
