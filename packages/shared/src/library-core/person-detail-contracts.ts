import {
  parseLibraryCoreFeedPageSourceV1,
  type LibraryCoreFeedPageParseResult,
  type LibraryCoreFeedPageSourceV1,
} from "./feed-page-contracts.js";
import { isLibraryCoreNonnegativeSafeInteger } from "./protocol-scalars.js";

export const LIBRARY_CORE_PERSON_DETAIL_QUERY_ID = "person_detail_v1" as const;
export const LIBRARY_CORE_PERSON_DETAIL_SCHEMA_VERSION = 1 as const;
export const LIBRARY_CORE_PERSON_DETAIL_MAXIMUM_ENTITY_ID_UTF8_BYTES = 2_048;
export const LIBRARY_CORE_PERSON_DETAIL_MAXIMUM_RESPONSE_BYTES = 2 * 1_048_576;
export const LIBRARY_CORE_PERSON_DETAIL_MAXIMUM_TAGS = 64;
export const LIBRARY_CORE_PERSON_DETAIL_MAXIMUM_REACH_OUTS = 20;
export const LIBRARY_CORE_PERSON_DETAIL_MAXIMUM_LINKED_ACCOUNTS = 64;

export const LIBRARY_CORE_PERSON_DETAIL_REQUEST_SCHEMA = Object.freeze({
  schemaId: "library_core_person_detail_request_v1",
  schemaVersion: LIBRARY_CORE_PERSON_DETAIL_SCHEMA_VERSION,
  queryId: LIBRARY_CORE_PERSON_DETAIL_QUERY_ID,
  canonicalKeys: Object.freeze(["personId", "queryId", "schemaVersion"]),
  maximumPersonIdUtf8Bytes:
    LIBRARY_CORE_PERSON_DETAIL_MAXIMUM_ENTITY_ID_UTF8_BYTES,
});

export const LIBRARY_CORE_PERSON_DETAIL_RESPONSE_SCHEMA = Object.freeze({
  schemaId: "library_core_person_detail_response_v1",
  schemaVersion: LIBRARY_CORE_PERSON_DETAIL_SCHEMA_VERSION,
  queryId: LIBRARY_CORE_PERSON_DETAIL_QUERY_ID,
  canonicalKeys: Object.freeze([
    "linkedAccountCount",
    "linkedAccounts",
    "person",
    "queryId",
    "schemaVersion",
    "source",
  ]),
  nullablePerson: true,
  maximumRows: 1,
  maximumResponseBytes: LIBRARY_CORE_PERSON_DETAIL_MAXIMUM_RESPONSE_BYTES,
});

export const LIBRARY_CORE_PERSON_DETAIL_PROJECTION = Object.freeze({
  projectionId: "library_core_person_detail_v1",
  sourceTable: "library_persons_and_accounts",
  fullContentAllowed: false,
  orderedColumns: Object.freeze(["id"]),
});

export const LIBRARY_CORE_PERSON_DETAIL_SOURCE_IDENTITY = Object.freeze({
  identityId: "library_core_projection_reader_source_v1",
  generationId: "sha256_file_digest",
  transitionSequence: "nonnegative_safe_integer",
  projectionRevision: "nonnegative_safe_integer",
  sessionPinned: true,
});

export const LIBRARY_CORE_PERSON_DETAIL_NESTED_BOUNDS = Object.freeze({
  tags: Object.freeze({
    maximumItems: LIBRARY_CORE_PERSON_DETAIL_MAXIMUM_TAGS,
    maximumUnicodeScalarsPerItem: 1_024,
    maximumUtf8BytesPerItem: 1_024,
  }),
  reachOuts: Object.freeze({
    maximumItems: LIBRARY_CORE_PERSON_DETAIL_MAXIMUM_REACH_OUTS,
    maximumUnicodeScalarsPerItem: 65_536,
    maximumUtf8BytesPerItem: 65_536,
  }),
  linkedAccounts: Object.freeze({
    maximumItems: LIBRARY_CORE_PERSON_DETAIL_MAXIMUM_LINKED_ACCOUNTS,
  }),
});

export interface LibraryCorePersonReachOutV1 {
  readonly channel: string | null;
  readonly loggedAt: number;
  readonly notes: string | null;
  readonly reachOutId: string;
}

export interface LibraryCorePersonDetailV1 {
  readonly avatarUrl: string | null;
  readonly bio: string | null;
  readonly careLevel: number;
  readonly createdAt: number;
  readonly id: string;
  readonly name: string;
  readonly notes: string | null;
  readonly reachOutIntervalDays: number | null;
  readonly reachOuts: readonly LibraryCorePersonReachOutV1[];
  readonly relationshipStatus: string;
  readonly sampleBatchId: string | null;
  readonly sampleGeneratedAt: number | null;
  readonly sampleGeneratorVersion: number | null;
  readonly tags: readonly string[];
  readonly updatedAt: number;
}

export interface LibraryCorePersonLinkedAccountV1 {
  readonly address: string | null;
  readonly avatarUrl: string | null;
  readonly createdAt: number;
  readonly discoveredFrom: string;
  readonly displayName: string | null;
  readonly email: string | null;
  readonly externalId: string;
  readonly firstSeenAt: number;
  readonly handle: string | null;
  readonly id: string;
  readonly importedAt: number | null;
  readonly kind: string;
  readonly lastSeenAt: number;
  readonly phone: string | null;
  readonly profileUrl: string | null;
  readonly provider: string;
  readonly updatedAt: number;
}

export interface LibraryCorePersonDetailRequestV1 {
  readonly personId: string;
  readonly queryId: typeof LIBRARY_CORE_PERSON_DETAIL_QUERY_ID;
  readonly schemaVersion: typeof LIBRARY_CORE_PERSON_DETAIL_SCHEMA_VERSION;
}

export interface LibraryCorePersonDetailResponseV1 {
  readonly linkedAccountCount: number;
  readonly linkedAccounts: readonly LibraryCorePersonLinkedAccountV1[];
  readonly person: LibraryCorePersonDetailV1 | null;
  readonly queryId: typeof LIBRARY_CORE_PERSON_DETAIL_QUERY_ID;
  readonly schemaVersion: typeof LIBRARY_CORE_PERSON_DETAIL_SCHEMA_VERSION;
  readonly source: LibraryCoreFeedPageSourceV1;
}

const REQUEST_KEYS = ["personId", "queryId", "schemaVersion"] as const;
const RESPONSE_KEYS = [
  "linkedAccountCount",
  "linkedAccounts",
  "person",
  "queryId",
  "schemaVersion",
  "source",
] as const;
const PERSON_KEYS = [
  "avatarUrl",
  "bio",
  "careLevel",
  "createdAt",
  "id",
  "name",
  "notes",
  "reachOutIntervalDays",
  "reachOuts",
  "relationshipStatus",
  "sampleBatchId",
  "sampleGeneratedAt",
  "sampleGeneratorVersion",
  "tags",
  "updatedAt",
] as const;
const REACH_OUT_KEYS = ["channel", "loggedAt", "notes", "reachOutId"] as const;
const LINKED_ACCOUNT_KEYS = [
  "address",
  "avatarUrl",
  "createdAt",
  "discoveredFrom",
  "displayName",
  "email",
  "externalId",
  "firstSeenAt",
  "handle",
  "id",
  "importedAt",
  "kind",
  "lastSeenAt",
  "phone",
  "profileUrl",
  "provider",
  "updatedAt",
] as const;
const textEncoder = new TextEncoder();

function failure<T>(error: string): LibraryCoreFeedPageParseResult<T> {
  return Object.freeze({ ok: false, error });
}

function closedRecord(
  value: unknown,
  keys: readonly string[],
): Record<string, unknown> | null {
  if (
    value === null ||
    typeof value !== "object" ||
    Object.getPrototypeOf(value) !== Object.prototype
  ) {
    return null;
  }
  const ownKeys = Reflect.ownKeys(value);
  if (
    ownKeys.length !== keys.length ||
    ownKeys.some((key) => typeof key !== "string" || !keys.includes(key))
  ) {
    return null;
  }
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const snapshot: Record<string, unknown> = {};
  for (const key of keys) {
    const descriptor = descriptors[key];
    if (!descriptor?.enumerable || !("value" in descriptor)) return null;
    snapshot[key] = descriptor.value;
  }
  return snapshot;
}

function boundedText(
  value: unknown,
  maximumBytes: number,
  nullable: true,
): string | null | undefined;
function boundedText(
  value: unknown,
  maximumBytes: number,
  nullable?: false,
): string | undefined;
function boundedText(
  value: unknown,
  maximumBytes: number,
  nullable = false,
): string | null | undefined {
  if (nullable && value === null) return null;
  if (
    typeof value !== "string" ||
    textEncoder.encode(value).byteLength > maximumBytes
  ) {
    return undefined;
  }
  return value;
}

function nullableSafeInteger(value: unknown): number | null | undefined {
  if (value === null) return null;
  return isLibraryCoreNonnegativeSafeInteger(value) ? value : undefined;
}

export function parseLibraryCorePersonDetailRequestV1(
  value: unknown,
): LibraryCoreFeedPageParseResult<LibraryCorePersonDetailRequestV1> {
  const record = closedRecord(value, REQUEST_KEYS);
  const personId = boundedText(
    record?.personId,
    LIBRARY_CORE_PERSON_DETAIL_MAXIMUM_ENTITY_ID_UTF8_BYTES,
  );
  if (
    !record ||
    personId === undefined ||
    personId.length === 0 ||
    record.queryId !== LIBRARY_CORE_PERSON_DETAIL_QUERY_ID ||
    record.schemaVersion !== LIBRARY_CORE_PERSON_DETAIL_SCHEMA_VERSION
  ) {
    return failure("person detail request is invalid");
  }
  return Object.freeze({
    ok: true,
    value: Object.freeze({
      personId,
      queryId: LIBRARY_CORE_PERSON_DETAIL_QUERY_ID,
      schemaVersion: LIBRARY_CORE_PERSON_DETAIL_SCHEMA_VERSION,
    }),
  });
}

function parseReachOut(value: unknown): LibraryCorePersonReachOutV1 | null {
  const record = closedRecord(value, REACH_OUT_KEYS);
  const channel = boundedText(record?.channel, 64, true);
  const notes = boundedText(record?.notes, 65_536, true);
  const reachOutId = boundedText(record?.reachOutId, 255);
  if (
    !record ||
    channel === undefined ||
    notes === undefined ||
    reachOutId === undefined ||
    reachOutId.length === 0 ||
    !isLibraryCoreNonnegativeSafeInteger(record.loggedAt)
  ) {
    return null;
  }
  return Object.freeze({
    channel,
    loggedAt: record.loggedAt,
    notes,
    reachOutId,
  });
}

function parsePerson(value: unknown): LibraryCorePersonDetailV1 | null {
  const record = closedRecord(value, PERSON_KEYS);
  if (
    !record ||
    !Array.isArray(record.tags) ||
    !Array.isArray(record.reachOuts)
  ) {
    return null;
  }
  const id = boundedText(record.id, 2_048);
  const name = boundedText(record.name, 4_096);
  const avatarUrl = boundedText(record.avatarUrl, 8_192, true);
  const bio = boundedText(record.bio, 65_536, true);
  const notes = boundedText(record.notes, 65_536, true);
  const relationshipStatus = boundedText(record.relationshipStatus, 255);
  const sampleBatchId = boundedText(record.sampleBatchId, 255, true);
  const reachOutIntervalDays = nullableSafeInteger(record.reachOutIntervalDays);
  const sampleGeneratedAt = nullableSafeInteger(record.sampleGeneratedAt);
  const sampleGeneratorVersion = nullableSafeInteger(
    record.sampleGeneratorVersion,
  );
  if (
    id === undefined ||
    id.length === 0 ||
    name === undefined ||
    relationshipStatus === undefined ||
    avatarUrl === undefined ||
    bio === undefined ||
    notes === undefined ||
    sampleBatchId === undefined ||
    reachOutIntervalDays === undefined ||
    sampleGeneratedAt === undefined ||
    sampleGeneratorVersion === undefined ||
    !isLibraryCoreNonnegativeSafeInteger(record.createdAt) ||
    !isLibraryCoreNonnegativeSafeInteger(record.updatedAt) ||
    !Number.isSafeInteger(record.careLevel) ||
    Number(record.careLevel) < 1 ||
    Number(record.careLevel) > 5 ||
    record.tags.length > LIBRARY_CORE_PERSON_DETAIL_MAXIMUM_TAGS ||
    record.reachOuts.length > LIBRARY_CORE_PERSON_DETAIL_MAXIMUM_REACH_OUTS
  ) {
    return null;
  }
  const tags = record.tags.map((tag) => boundedText(tag, 1_024));
  const reachOuts = record.reachOuts.map(parseReachOut);
  if (
    tags.some((tag) => tag === undefined) ||
    reachOuts.some((row) => row === null)
  ) {
    return null;
  }
  return Object.freeze({
    avatarUrl,
    bio,
    careLevel: record.careLevel as number,
    createdAt: record.createdAt,
    id,
    name,
    notes,
    reachOutIntervalDays,
    reachOuts: Object.freeze(reachOuts as LibraryCorePersonReachOutV1[]),
    relationshipStatus,
    sampleBatchId,
    sampleGeneratedAt,
    sampleGeneratorVersion,
    tags: Object.freeze(tags as string[]),
    updatedAt: record.updatedAt,
  });
}

function parseLinkedAccount(
  value: unknown,
): LibraryCorePersonLinkedAccountV1 | null {
  const record = closedRecord(value, LINKED_ACCOUNT_KEYS);
  if (!record) return null;
  const address = boundedText(record.address, 4_096, true);
  const avatarUrl = boundedText(record.avatarUrl, 8_192, true);
  const discoveredFrom = boundedText(record.discoveredFrom, 64);
  const displayName = boundedText(record.displayName, 512, true);
  const email = boundedText(record.email, 4_096, true);
  const externalId = boundedText(record.externalId, 4_096);
  const handle = boundedText(record.handle, 512, true);
  const id = boundedText(record.id, 2_048);
  const importedAt = nullableSafeInteger(record.importedAt);
  const kind = boundedText(record.kind, 64);
  const phone = boundedText(record.phone, 512, true);
  const profileUrl = boundedText(record.profileUrl, 8_192, true);
  const provider = boundedText(record.provider, 64);
  if (
    address === undefined ||
    avatarUrl === undefined ||
    discoveredFrom === undefined ||
    !discoveredFrom ||
    displayName === undefined ||
    email === undefined ||
    externalId === undefined ||
    !externalId ||
    handle === undefined ||
    id === undefined ||
    !id ||
    importedAt === undefined ||
    kind === undefined ||
    !kind ||
    phone === undefined ||
    profileUrl === undefined ||
    provider === undefined ||
    !provider ||
    !isLibraryCoreNonnegativeSafeInteger(record.createdAt) ||
    !isLibraryCoreNonnegativeSafeInteger(record.firstSeenAt) ||
    !isLibraryCoreNonnegativeSafeInteger(record.lastSeenAt) ||
    !isLibraryCoreNonnegativeSafeInteger(record.updatedAt)
  ) {
    return null;
  }
  return Object.freeze({
    address,
    avatarUrl,
    createdAt: record.createdAt,
    discoveredFrom,
    displayName,
    email,
    externalId,
    firstSeenAt: record.firstSeenAt,
    handle,
    id,
    importedAt,
    kind,
    lastSeenAt: record.lastSeenAt,
    phone,
    profileUrl,
    provider,
    updatedAt: record.updatedAt,
  });
}

export function parseLibraryCorePersonDetailResponseV1(
  value: unknown,
  requestValue?: unknown,
): LibraryCoreFeedPageParseResult<LibraryCorePersonDetailResponseV1> {
  const record = closedRecord(value, RESPONSE_KEYS);
  const source = parseLibraryCoreFeedPageSourceV1(record?.source);
  const request =
    requestValue === undefined
      ? null
      : parseLibraryCorePersonDetailRequestV1(requestValue);
  if (
    !record ||
    !source.ok ||
    (request !== null && !request.ok) ||
    record.queryId !== LIBRARY_CORE_PERSON_DETAIL_QUERY_ID ||
    record.schemaVersion !== LIBRARY_CORE_PERSON_DETAIL_SCHEMA_VERSION
  ) {
    return failure("person detail response is invalid");
  }
  const person = record.person === null ? null : parsePerson(record.person);
  if (
    !Array.isArray(record.linkedAccounts) ||
    record.linkedAccounts.length >
      LIBRARY_CORE_PERSON_DETAIL_MAXIMUM_LINKED_ACCOUNTS ||
    !isLibraryCoreNonnegativeSafeInteger(record.linkedAccountCount)
  ) {
    return failure("person detail linked accounts are invalid");
  }
  const linkedAccounts =
    person === null ? [] : record.linkedAccounts.map(parseLinkedAccount);
  if (
    (record.person !== null && person === null) ||
    (person !== null && request?.ok && person.id !== request.value.personId) ||
    (person === null &&
      (record.linkedAccountCount !== 0 ||
        record.linkedAccounts.length !== 0)) ||
    linkedAccounts.some((account) => account === null) ||
    record.linkedAccountCount < linkedAccounts.length ||
    linkedAccounts.some(
      (account, index) =>
        index > 0 && linkedAccounts[index - 1]!.id >= account!.id,
    )
  ) {
    return failure("person detail row is invalid");
  }
  const response = Object.freeze({
    linkedAccountCount: record.linkedAccountCount,
    linkedAccounts: Object.freeze(
      linkedAccounts as LibraryCorePersonLinkedAccountV1[],
    ),
    person,
    queryId: LIBRARY_CORE_PERSON_DETAIL_QUERY_ID,
    schemaVersion: LIBRARY_CORE_PERSON_DETAIL_SCHEMA_VERSION,
    source: source.value,
  });
  if (
    textEncoder.encode(JSON.stringify(response)).byteLength >
    LIBRARY_CORE_PERSON_DETAIL_MAXIMUM_RESPONSE_BYTES
  ) {
    return failure("person detail response exceeds its byte bound");
  }
  return Object.freeze({ ok: true, value: response });
}
