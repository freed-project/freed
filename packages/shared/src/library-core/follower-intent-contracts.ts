import {
  LIBRARY_CORE_MAX_OPERATION_ENVELOPE_BYTES,
  LIBRARY_CORE_MAX_TRANSACTION_ENVELOPE_BYTES,
} from "./operation-envelope-finalization.js";
import {
  LIBRARY_CORE_FOLLOWER_INTENT_PAGE_MAXIMUM_RECORDS,
  LIBRARY_CORE_OPERATION_TRANSACTION_MAXIMUM_MEMBERS,
  LIBRARY_CORE_NATIVE_EXPORT_MAXIMUM_RESPONSE_BYTES,
} from "./sqlite-contract.generated.js";

export const LIBRARY_CORE_FOLLOWER_INTENT_MEMBER_LIMIT =
  LIBRARY_CORE_OPERATION_TRANSACTION_MAXIMUM_MEMBERS;

export interface LibraryCoreFollowerIntentPageCursorV1 {
  readonly actorCounter: number;
  readonly operationId: string;
  readonly transactionId: string;
}

export interface LibraryCoreFollowerIntentPageRequestV1 {
  readonly actorId: string;
  readonly cursor: LibraryCoreFollowerIntentPageCursorV1 | null;
  readonly limit: number;
  readonly schemaVersion: 1;
}

export interface LibraryCoreFollowerIntentPageRecordV1 {
  readonly actorCounter: number;
  readonly actorId: string;
  readonly canonicalEnvelopeJson: string;
  readonly intentEpoch: number;
  readonly intentEpochId: string;
  readonly memberCount: number;
  readonly memberIndex: number;
  readonly operationId: string;
  readonly state: "pending" | "published";
  readonly transactionDigest: string;
  readonly transactionId: string;
}

export interface LibraryCoreFollowerIntentPageResponseV1 {
  readonly actorId: string;
  readonly done: boolean;
  readonly nextCursor: LibraryCoreFollowerIntentPageCursorV1 | null;
  readonly records: readonly LibraryCoreFollowerIntentPageRecordV1[];
  readonly schemaVersion: 1;
}

export interface LibraryCoreFollowerIntentCommitV1 {
  readonly envelopeBytes: readonly Uint8Array[];
}

export interface LibraryCoreFollowerIntentCommitResultV1 {
  readonly actorId: string;
  readonly firstCounter: number;
  readonly lastCounter: number;
  readonly memberCount: number;
  readonly optimisticFieldCount: number;
  readonly state: "pending" | "published";
  readonly transactionId: string;
}

export interface LibraryCoreFollowerIntentPublicationV1 {
  readonly actorId: string;
  readonly publishedAt: number;
  readonly transactionDigest: string;
  readonly transactionId: string;
}

export interface LibraryCoreFollowerIntentPublicationReceiptV1 {
  readonly actorId: string;
  readonly publishedAt: number;
  readonly state: "published";
  readonly transactionId: string;
}

const TEXT_ENCODER = new TextEncoder();

function closedRecord(
  value: unknown,
  keys: readonly string[],
): Record<string, unknown> | null {
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype
  ) {
    return null;
  }
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const ownKeys = Reflect.ownKeys(value);
  if (
    ownKeys.length !== keys.length ||
    ownKeys.some((key) => typeof key !== "string" || !keys.includes(key)) ||
    keys.some(
      (key) => !descriptors[key]?.enumerable || !("value" in descriptors[key]),
    )
  ) {
    return null;
  }
  return Object.fromEntries(keys.map((key) => [key, descriptors[key]!.value]));
}

function boundedIdentity(value: unknown): value is string {
  return (
    typeof value === "string" &&
    TEXT_ENCODER.encode(value).byteLength >= 1 &&
    TEXT_ENCODER.encode(value).byteLength <= 255
  );
}

function digest(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{64}$/.test(value);
}

function parseCursor(
  value: unknown,
): LibraryCoreFollowerIntentPageCursorV1 | null {
  const record = closedRecord(value, [
    "actorCounter",
    "operationId",
    "transactionId",
  ]);
  if (
    !record ||
    !Number.isSafeInteger(record.actorCounter) ||
    (record.actorCounter as number) < 1 ||
    !boundedIdentity(record.operationId) ||
    !boundedIdentity(record.transactionId)
  ) {
    return null;
  }
  return Object.freeze({
    actorCounter: record.actorCounter as number,
    operationId: record.operationId,
    transactionId: record.transactionId,
  });
}

export function parseLibraryCoreFollowerIntentPageRequestV1(
  value: unknown,
): LibraryCoreFollowerIntentPageRequestV1 {
  const record = closedRecord(value, [
    "actorId",
    "cursor",
    "limit",
    "schemaVersion",
  ]);
  const cursor = record?.cursor === null ? null : parseCursor(record?.cursor);
  if (
    !record ||
    !boundedIdentity(record.actorId) ||
    (record.cursor !== null && cursor === null) ||
    !Number.isSafeInteger(record.limit) ||
    (record.limit as number) < 1 ||
    (record.limit as number) >
      LIBRARY_CORE_FOLLOWER_INTENT_PAGE_MAXIMUM_RECORDS ||
    record.schemaVersion !== 1
  ) {
    throw new TypeError("follower intent page request is invalid");
  }
  return Object.freeze({
    actorId: record.actorId,
    cursor,
    limit: record.limit as number,
    schemaVersion: 1,
  });
}

export function parseLibraryCoreFollowerIntentPageResponseV1(
  value: unknown,
): LibraryCoreFollowerIntentPageResponseV1 {
  const record = closedRecord(value, [
    "actorId",
    "done",
    "nextCursor",
    "records",
    "schemaVersion",
  ]);
  const nextCursor =
    record?.nextCursor === null ? null : parseCursor(record?.nextCursor);
  if (
    !record ||
    !boundedIdentity(record.actorId) ||
    typeof record.done !== "boolean" ||
    (record.nextCursor !== null && nextCursor === null) ||
    !Array.isArray(record.records) ||
    record.records.length > LIBRARY_CORE_FOLLOWER_INTENT_PAGE_MAXIMUM_RECORDS ||
    record.schemaVersion !== 1
  ) {
    throw new TypeError("follower intent page response is invalid");
  }
  const inputRecords = record.records;
  const records = inputRecords.map((candidate, index) => {
    const member = closedRecord(candidate, [
      "actorCounter",
      "actorId",
      "canonicalEnvelopeJson",
      "intentEpoch",
      "intentEpochId",
      "memberCount",
      "memberIndex",
      "operationId",
      "state",
      "transactionDigest",
      "transactionId",
    ]);
    if (
      !member ||
      !Number.isSafeInteger(member.actorCounter) ||
      (member.actorCounter as number) < 1 ||
      member.actorId !== record.actorId ||
      typeof member.canonicalEnvelopeJson !== "string" ||
      TEXT_ENCODER.encode(member.canonicalEnvelopeJson).byteLength < 1 ||
      TEXT_ENCODER.encode(member.canonicalEnvelopeJson).byteLength >
        LIBRARY_CORE_MAX_OPERATION_ENVELOPE_BYTES ||
      !Number.isSafeInteger(member.intentEpoch) ||
      (member.intentEpoch as number) < 1 ||
      !boundedIdentity(member.intentEpochId) ||
      !Number.isSafeInteger(member.memberCount) ||
      (member.memberCount as number) < 1 ||
      (member.memberCount as number) >
        LIBRARY_CORE_FOLLOWER_INTENT_MEMBER_LIMIT ||
      !Number.isSafeInteger(member.memberIndex) ||
      (member.memberIndex as number) < 0 ||
      (member.memberIndex as number) >= (member.memberCount as number) ||
      !boundedIdentity(member.operationId) ||
      (member.state !== "pending" && member.state !== "published") ||
      !digest(member.transactionDigest) ||
      !boundedIdentity(member.transactionId) ||
      (index > 0 &&
        (member.actorCounter as number) <=
          (inputRecords[index - 1] as LibraryCoreFollowerIntentPageRecordV1)
            .actorCounter)
    ) {
      throw new TypeError("follower intent page record is invalid");
    }
    return Object.freeze({
      actorCounter: member.actorCounter as number,
      actorId: member.actorId as string,
      canonicalEnvelopeJson: member.canonicalEnvelopeJson,
      intentEpoch: member.intentEpoch as number,
      intentEpochId: member.intentEpochId,
      memberCount: member.memberCount as number,
      memberIndex: member.memberIndex as number,
      operationId: member.operationId,
      state: member.state,
      transactionDigest: member.transactionDigest,
      transactionId: member.transactionId,
    });
  });
  const last = records.at(-1);
  if (
    (records.length === 0 && nextCursor !== null) ||
    (last !== undefined &&
      (nextCursor === null ||
        nextCursor.actorCounter !== last.actorCounter ||
        nextCursor.operationId !== last.operationId ||
        nextCursor.transactionId !== last.transactionId)) ||
    TEXT_ENCODER.encode(JSON.stringify(value)).byteLength >
      LIBRARY_CORE_NATIVE_EXPORT_MAXIMUM_RESPONSE_BYTES
  ) {
    throw new TypeError("follower intent page boundary is invalid");
  }
  return Object.freeze({
    actorId: record.actorId,
    done: record.done,
    nextCursor,
    records: Object.freeze(records),
    schemaVersion: 1,
  });
}

export function parseLibraryCoreFollowerIntentPublicationV1(
  value: unknown,
): LibraryCoreFollowerIntentPublicationV1 {
  const record = closedRecord(value, [
    "actorId",
    "publishedAt",
    "transactionDigest",
    "transactionId",
  ]);
  if (
    !record ||
    !boundedIdentity(record.actorId) ||
    !Number.isSafeInteger(record.publishedAt) ||
    (record.publishedAt as number) < 0 ||
    !digest(record.transactionDigest) ||
    !boundedIdentity(record.transactionId)
  ) {
    throw new TypeError("follower intent publication is invalid");
  }
  return Object.freeze({
    actorId: record.actorId,
    publishedAt: record.publishedAt as number,
    transactionDigest: record.transactionDigest,
    transactionId: record.transactionId,
  });
}

export function parseLibraryCoreFollowerIntentCommitResultV1(
  value: unknown,
): LibraryCoreFollowerIntentCommitResultV1 {
  const record = closedRecord(value, [
    "actorId",
    "firstCounter",
    "lastCounter",
    "memberCount",
    "optimisticFieldCount",
    "state",
    "transactionId",
  ]);
  if (
    !record ||
    !boundedIdentity(record.actorId) ||
    !Number.isSafeInteger(record.firstCounter) ||
    (record.firstCounter as number) < 1 ||
    !Number.isSafeInteger(record.lastCounter) ||
    (record.lastCounter as number) < (record.firstCounter as number) ||
    !Number.isSafeInteger(record.memberCount) ||
    (record.memberCount as number) < 1 ||
    (record.memberCount as number) >
      LIBRARY_CORE_FOLLOWER_INTENT_MEMBER_LIMIT ||
    (record.lastCounter as number) - (record.firstCounter as number) + 1 !==
      record.memberCount ||
    !Number.isSafeInteger(record.optimisticFieldCount) ||
    (record.optimisticFieldCount as number) < 0 ||
    (record.optimisticFieldCount as number) >
      LIBRARY_CORE_FOLLOWER_INTENT_MEMBER_LIMIT * 8 ||
    (record.state !== "pending" && record.state !== "published") ||
    !boundedIdentity(record.transactionId)
  ) {
    throw new TypeError("follower intent commit result is invalid");
  }
  return Object.freeze({
    actorId: record.actorId,
    firstCounter: record.firstCounter as number,
    lastCounter: record.lastCounter as number,
    memberCount: record.memberCount as number,
    optimisticFieldCount: record.optimisticFieldCount as number,
    state: record.state,
    transactionId: record.transactionId,
  });
}

export function parseLibraryCoreFollowerIntentPublicationReceiptV1(
  value: unknown,
): LibraryCoreFollowerIntentPublicationReceiptV1 {
  const record = closedRecord(value, [
    "actorId",
    "publishedAt",
    "state",
    "transactionId",
  ]);
  if (
    !record ||
    !boundedIdentity(record.actorId) ||
    !Number.isSafeInteger(record.publishedAt) ||
    (record.publishedAt as number) < 0 ||
    record.state !== "published" ||
    !boundedIdentity(record.transactionId)
  ) {
    throw new TypeError("follower intent publication receipt is invalid");
  }
  return Object.freeze({
    actorId: record.actorId,
    publishedAt: record.publishedAt as number,
    state: "published",
    transactionId: record.transactionId,
  });
}

/**
 * Snapshot one complete signed follower transaction before it crosses an
 * asynchronous worker or SQLite boundary.
 */
export function parseLibraryCoreFollowerIntentCommitV1(
  value: unknown,
): LibraryCoreFollowerIntentCommitV1 {
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype
  ) {
    throw new TypeError("follower intent commit must be a closed record");
  }
  const names = Object.getOwnPropertyNames(value);
  if (names.length !== 1 || names[0] !== "envelopeBytes") {
    throw new TypeError("follower intent commit has an invalid field set");
  }
  const descriptor = Object.getOwnPropertyDescriptor(value, "envelopeBytes");
  if (
    descriptor === undefined ||
    !descriptor.enumerable ||
    !("value" in descriptor) ||
    !Array.isArray(descriptor.value) ||
    descriptor.value.length === 0 ||
    descriptor.value.length > LIBRARY_CORE_FOLLOWER_INTENT_MEMBER_LIMIT
  ) {
    throw new TypeError(
      "follower intent envelopes must be a bounded dense array",
    );
  }
  const snapshots: Uint8Array[] = [];
  let totalBytes = 0;
  for (let index = 0; index < descriptor.value.length; index += 1) {
    const member = Object.getOwnPropertyDescriptor(
      descriptor.value,
      String(index),
    );
    if (
      member === undefined ||
      !member.enumerable ||
      !("value" in member) ||
      !(member.value instanceof Uint8Array)
    ) {
      throw new TypeError(
        "follower intent envelopes must contain Uint8Array values",
      );
    }
    const snapshot = new Uint8Array(member.value);
    if (
      snapshot.byteLength === 0 ||
      snapshot.byteLength > LIBRARY_CORE_MAX_OPERATION_ENVELOPE_BYTES
    ) {
      throw new RangeError(
        "one follower intent envelope exceeds 131,072 bytes",
      );
    }
    totalBytes += snapshot.byteLength;
    if (totalBytes > LIBRARY_CORE_MAX_TRANSACTION_ENVELOPE_BYTES) {
      throw new RangeError(
        "follower intent transaction exceeds 4,194,304 bytes",
      );
    }
    snapshots.push(snapshot);
  }
  return Object.freeze({ envelopeBytes: Object.freeze(snapshots) });
}
