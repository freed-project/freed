import {
  decodeLibraryCoreCanonicalValue,
  encodeLibraryCoreCanonicalValue,
  type LibraryCoreCanonicalValue,
} from "./canonical-codec.js";
import { parseLibraryCoreNormalizedIntentEnvelopeRecordV2 } from "./normalized-intent-segment-contracts.js";
import { LIBRARY_CORE_MAX_OPERATION_ENVELOPE_BYTES } from "./operation-envelope-finalization.js";
import {
  isLibraryCoreLowercaseHex64,
  isLibraryCoreNonnegativeSafeInteger,
  type LibraryCoreLowercaseHex64,
} from "./protocol-scalars.js";

export const LIBRARY_CORE_FOLLOWER_TRANSPORT_PAGE_RECORD_LIMIT = 128;
export const LIBRARY_CORE_FOLLOWER_TRANSPORT_PAGE_CANONICAL_BYTE_LIMIT = 1_048_576;

export interface LibraryCoreFollowerTransportContextV2 {
  readonly actorId: LibraryCoreLowercaseHex64;
  readonly libraryId: LibraryCoreLowercaseHex64;
  readonly nextIntentActorCounter: number;
  readonly nextResultSequence: number;
  readonly previousIntentSegmentDigest: LibraryCoreLowercaseHex64 | null;
  readonly previousResultSegmentDigest: LibraryCoreLowercaseHex64 | null;
  readonly schemaVersion: 2;
  readonly storageEpochId: LibraryCoreLowercaseHex64;
}

export interface LibraryCoreFollowerTransportPageRequestV2 {
  readonly actorId: LibraryCoreLowercaseHex64;
  readonly firstActorCounter: number;
  readonly limit: number;
  readonly schemaVersion: 2;
}

export interface LibraryCoreFollowerTransportPageResponseV2 {
  readonly actorId: LibraryCoreLowercaseHex64;
  readonly canonicalEnvelopes: readonly Uint8Array[];
  readonly done: boolean;
  readonly firstActorCounter: number;
  readonly lastActorCounter: number | null;
  readonly schemaVersion: 2;
}

function closedRecord(
  value: unknown,
  expected: readonly string[],
  label: string,
): Readonly<Record<string, unknown>> {
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype
  ) {
    throw new TypeError(`${label} must be a closed record`);
  }
  const keys = Object.keys(value).sort();
  const sortedExpected = [...expected].sort();
  if (
    keys.length !== sortedExpected.length ||
    keys.some((key, index) => key !== sortedExpected[index])
  ) {
    throw new TypeError(`${label} has unknown or missing fields`);
  }
  return value as Readonly<Record<string, unknown>>;
}

function positiveInteger(value: unknown, label: string): number {
  if (!isLibraryCoreNonnegativeSafeInteger(value) || value < 1) {
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

function nullableDigest(
  value: unknown,
  label: string,
): LibraryCoreLowercaseHex64 | null {
  return value === null ? null : digest(value, label);
}

function exactCanonicalEnvelope(
  value: unknown,
  actorId: LibraryCoreLowercaseHex64,
  expectedCounter: number,
): Uint8Array {
  if (
    !(value instanceof Uint8Array) ||
    value.byteLength < 1 ||
    value.byteLength > LIBRARY_CORE_MAX_OPERATION_ENVELOPE_BYTES
  ) {
    throw new TypeError("follower transport envelope bytes are invalid");
  }
  const bytes = new Uint8Array(value);
  const envelope = parseLibraryCoreNormalizedIntentEnvelopeRecordV2(
    decodeLibraryCoreCanonicalValue(bytes, {
      maximumBytes: LIBRARY_CORE_MAX_OPERATION_ENVELOPE_BYTES,
    }),
  );
  const restored = encodeLibraryCoreCanonicalValue(
    envelope as LibraryCoreCanonicalValue,
    { maximumBytes: LIBRARY_CORE_MAX_OPERATION_ENVELOPE_BYTES },
  );
  if (
    envelope.actor_id !== actorId ||
    envelope.actor_sequence !== expectedCounter ||
    restored.byteLength !== bytes.byteLength ||
    restored.some((byte, index) => byte !== bytes[index])
  ) {
    throw new TypeError("follower transport envelope identity changed");
  }
  return bytes;
}

export function parseLibraryCoreFollowerTransportContextV2(
  value: unknown,
): LibraryCoreFollowerTransportContextV2 {
  const input = closedRecord(
    value,
    [
      "actorId",
      "libraryId",
      "nextIntentActorCounter",
      "nextResultSequence",
      "previousIntentSegmentDigest",
      "previousResultSegmentDigest",
      "schemaVersion",
      "storageEpochId",
    ],
    "follower transport context",
  );
  if (input.schemaVersion !== 2) {
    throw new TypeError("follower transport context version is invalid");
  }
  const nextIntentActorCounter = positiveInteger(
    input.nextIntentActorCounter,
    "follower transport next intent counter",
  );
  const nextResultSequence = positiveInteger(
    input.nextResultSequence,
    "follower transport next result sequence",
  );
  const previousIntentSegmentDigest = nullableDigest(
    input.previousIntentSegmentDigest,
    "follower transport previous intent digest",
  );
  const previousResultSegmentDigest = nullableDigest(
    input.previousResultSegmentDigest,
    "follower transport previous result digest",
  );
  if (
    (nextIntentActorCounter === 1) !== (previousIntentSegmentDigest === null) ||
    (nextResultSequence === 1) !== (previousResultSegmentDigest === null)
  ) {
    throw new TypeError("follower transport chain frontier is invalid");
  }
  return Object.freeze({
    actorId: digest(input.actorId, "follower transport actor"),
    libraryId: digest(input.libraryId, "follower transport Library"),
    nextIntentActorCounter,
    nextResultSequence,
    previousIntentSegmentDigest,
    previousResultSegmentDigest,
    schemaVersion: 2,
    storageEpochId: digest(
      input.storageEpochId,
      "follower transport storage epoch",
    ),
  });
}

export function parseLibraryCoreFollowerTransportPageRequestV2(
  value: unknown,
): LibraryCoreFollowerTransportPageRequestV2 {
  const input = closedRecord(
    value,
    ["actorId", "firstActorCounter", "limit", "schemaVersion"],
    "follower transport page request",
  );
  const limit = positiveInteger(input.limit, "follower transport page limit");
  if (
    input.schemaVersion !== 2 ||
    limit > LIBRARY_CORE_FOLLOWER_TRANSPORT_PAGE_RECORD_LIMIT
  ) {
    throw new RangeError("follower transport page request is invalid");
  }
  return Object.freeze({
    actorId: digest(input.actorId, "follower transport page actor"),
    firstActorCounter: positiveInteger(
      input.firstActorCounter,
      "follower transport first actor counter",
    ),
    limit,
    schemaVersion: 2,
  });
}

export function parseLibraryCoreFollowerTransportPageResponseV2(
  value: unknown,
): LibraryCoreFollowerTransportPageResponseV2 {
  const input = closedRecord(
    value,
    [
      "actorId",
      "canonicalEnvelopes",
      "done",
      "firstActorCounter",
      "lastActorCounter",
      "schemaVersion",
    ],
    "follower transport page response",
  );
  if (
    input.schemaVersion !== 2 ||
    typeof input.done !== "boolean" ||
    !Array.isArray(input.canonicalEnvelopes) ||
    input.canonicalEnvelopes.length >
      LIBRARY_CORE_FOLLOWER_TRANSPORT_PAGE_RECORD_LIMIT
  ) {
    throw new TypeError("follower transport page response is invalid");
  }
  const actorId = digest(input.actorId, "follower transport page actor");
  const firstActorCounter = positiveInteger(
    input.firstActorCounter,
    "follower transport first actor counter",
  );
  const canonicalEnvelopes = Object.freeze(
    input.canonicalEnvelopes.map((bytes, index) =>
      exactCanonicalEnvelope(bytes, actorId, firstActorCounter + index),
    ),
  );
  const canonicalBytes = canonicalEnvelopes.reduce(
    (total, bytes) => total + bytes.byteLength,
    0,
  );
  const expectedLast = canonicalEnvelopes.length
    ? firstActorCounter + canonicalEnvelopes.length - 1
    : null;
  if (
    canonicalBytes >
      LIBRARY_CORE_FOLLOWER_TRANSPORT_PAGE_CANONICAL_BYTE_LIMIT ||
    input.lastActorCounter !== expectedLast ||
    (canonicalEnvelopes.length === 0 && !input.done)
  ) {
    throw new RangeError("follower transport page boundary changed");
  }
  return Object.freeze({
    actorId,
    canonicalEnvelopes,
    done: input.done,
    firstActorCounter,
    lastActorCounter: expectedLast,
    schemaVersion: 2,
  });
}
