import {
  parseLibraryCoreFeedPageSourceV1,
  type LibraryCoreFeedPageParseResult,
  type LibraryCoreFeedPageSourceV1,
} from "./feed-page-contracts.js";
import { isLibraryCoreNonnegativeSafeInteger } from "./protocol-scalars.js";

export const LIBRARY_CORE_ACCOUNT_DETAIL_QUERY_ID =
  "account_detail_v1" as const;
export const LIBRARY_CORE_ACCOUNT_DETAIL_SCHEMA_VERSION = 1 as const;
export const LIBRARY_CORE_ACCOUNT_DETAIL_MAXIMUM_RESPONSE_BYTES = 512 * 1_024;
export const LIBRARY_CORE_ACCOUNT_DETAIL_MAXIMUM_FOLLOW_ROLES = 8;

export const LIBRARY_CORE_ACCOUNT_DETAIL_REQUEST_SCHEMA = Object.freeze({
  schemaId: "library_core_account_detail_request_v1",
  schemaVersion: LIBRARY_CORE_ACCOUNT_DETAIL_SCHEMA_VERSION,
  queryId: LIBRARY_CORE_ACCOUNT_DETAIL_QUERY_ID,
  canonicalKeys: Object.freeze(["accountId", "queryId", "schemaVersion"]),
  maximumAccountIdUtf8Bytes: 2_048,
});

export const LIBRARY_CORE_ACCOUNT_DETAIL_RESPONSE_SCHEMA = Object.freeze({
  schemaId: "library_core_account_detail_response_v1",
  schemaVersion: LIBRARY_CORE_ACCOUNT_DETAIL_SCHEMA_VERSION,
  queryId: LIBRARY_CORE_ACCOUNT_DETAIL_QUERY_ID,
  canonicalKeys: Object.freeze([
    "account",
    "queryId",
    "schemaVersion",
    "source",
  ]),
  nullableAccount: true,
  maximumRows: 1,
  maximumResponseBytes: LIBRARY_CORE_ACCOUNT_DETAIL_MAXIMUM_RESPONSE_BYTES,
});

export const LIBRARY_CORE_ACCOUNT_DETAIL_PROJECTION = Object.freeze({
  projectionId: "library_core_account_detail_v1",
  sourceTable: "library_accounts",
  fullContentAllowed: false,
  orderedColumns: Object.freeze(["id"]),
});

export const LIBRARY_CORE_ACCOUNT_DETAIL_SOURCE_IDENTITY = Object.freeze({
  identityId: "library_core_projection_reader_source_v1",
  generationId: "sha256_file_digest",
  transitionSequence: "nonnegative_safe_integer",
  projectionRevision: "nonnegative_safe_integer",
  sessionPinned: true,
});

export const LIBRARY_CORE_ACCOUNT_DETAIL_NESTED_BOUNDS = Object.freeze({
  followRosterRoles: Object.freeze({
    maximumItems: LIBRARY_CORE_ACCOUNT_DETAIL_MAXIMUM_FOLLOW_ROLES,
    maximumUnicodeScalarsPerItem: 64,
    maximumUtf8BytesPerItem: 64,
  }),
});

export interface LibraryCoreAccountDetailV1 {
  readonly address: string | null;
  readonly avatarUrl: string | null;
  readonly createdAt: number;
  readonly discoveredFrom: string;
  readonly displayName: string | null;
  readonly email: string | null;
  readonly externalId: string;
  readonly firstSeenAt: number;
  readonly followRosterActive: boolean | null;
  readonly followRosterRoles: readonly string[];
  readonly followRosterSyncedAt: number | null;
  readonly handle: string | null;
  readonly id: string;
  readonly importedAt: number | null;
  readonly kind: string;
  readonly lastSeenAt: number;
  readonly personId: string | null;
  readonly phone: string | null;
  readonly profileUrl: string | null;
  readonly provider: string;
  readonly sampleBatchId: string | null;
  readonly sampleGeneratedAt: number | null;
  readonly sampleGeneratorVersion: number | null;
  readonly updatedAt: number;
}

export interface LibraryCoreAccountDetailRequestV1 {
  readonly accountId: string;
  readonly queryId: typeof LIBRARY_CORE_ACCOUNT_DETAIL_QUERY_ID;
  readonly schemaVersion: typeof LIBRARY_CORE_ACCOUNT_DETAIL_SCHEMA_VERSION;
}

export interface LibraryCoreAccountDetailResponseV1 {
  readonly account: LibraryCoreAccountDetailV1 | null;
  readonly queryId: typeof LIBRARY_CORE_ACCOUNT_DETAIL_QUERY_ID;
  readonly schemaVersion: typeof LIBRARY_CORE_ACCOUNT_DETAIL_SCHEMA_VERSION;
  readonly source: LibraryCoreFeedPageSourceV1;
}

const REQUEST_KEYS = ["accountId", "queryId", "schemaVersion"] as const;
const RESPONSE_KEYS = [
  "account",
  "queryId",
  "schemaVersion",
  "source",
] as const;
const ACCOUNT_KEYS = [
  "address",
  "avatarUrl",
  "createdAt",
  "discoveredFrom",
  "displayName",
  "email",
  "externalId",
  "firstSeenAt",
  "followRosterActive",
  "followRosterRoles",
  "followRosterSyncedAt",
  "handle",
  "id",
  "importedAt",
  "kind",
  "lastSeenAt",
  "personId",
  "phone",
  "profileUrl",
  "provider",
  "sampleBatchId",
  "sampleGeneratedAt",
  "sampleGeneratorVersion",
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
  const descriptors = Object.getOwnPropertyDescriptors(value);
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

function nullableInteger(value: unknown): number | null | undefined {
  if (value === null) return null;
  return isLibraryCoreNonnegativeSafeInteger(value) ? value : undefined;
}

export function parseLibraryCoreAccountDetailRequestV1(
  value: unknown,
): LibraryCoreFeedPageParseResult<LibraryCoreAccountDetailRequestV1> {
  const record = closedRecord(value, REQUEST_KEYS);
  const accountId = boundedText(record?.accountId, 2_048);
  if (
    !record ||
    !accountId ||
    record.queryId !== LIBRARY_CORE_ACCOUNT_DETAIL_QUERY_ID ||
    record.schemaVersion !== LIBRARY_CORE_ACCOUNT_DETAIL_SCHEMA_VERSION
  ) {
    return failure("account detail request is invalid");
  }
  return Object.freeze({
    ok: true,
    value: Object.freeze({
      accountId,
      queryId: LIBRARY_CORE_ACCOUNT_DETAIL_QUERY_ID,
      schemaVersion: LIBRARY_CORE_ACCOUNT_DETAIL_SCHEMA_VERSION,
    }),
  });
}

function parseAccount(value: unknown): LibraryCoreAccountDetailV1 | null {
  const record = closedRecord(value, ACCOUNT_KEYS);
  if (!record) return null;
  const strings = {
    address: boundedText(record.address, 4_096, true),
    avatarUrl: boundedText(record.avatarUrl, 8_192, true),
    discoveredFrom: boundedText(record.discoveredFrom, 64),
    displayName: boundedText(record.displayName, 512, true),
    email: boundedText(record.email, 4_096, true),
    externalId: boundedText(record.externalId, 4_096),
    handle: boundedText(record.handle, 512, true),
    id: boundedText(record.id, 2_048),
    kind: boundedText(record.kind, 64),
    personId: boundedText(record.personId, 2_048, true),
    phone: boundedText(record.phone, 512, true),
    profileUrl: boundedText(record.profileUrl, 8_192, true),
    provider: boundedText(record.provider, 64),
    sampleBatchId: boundedText(record.sampleBatchId, 255, true),
  };
  const integers = {
    importedAt: nullableInteger(record.importedAt),
    followRosterSyncedAt: nullableInteger(record.followRosterSyncedAt),
    sampleGeneratedAt: nullableInteger(record.sampleGeneratedAt),
    sampleGeneratorVersion: nullableInteger(record.sampleGeneratorVersion),
  };
  if (
    Object.values(strings).some((entry) => entry === undefined) ||
    !strings.id ||
    !strings.externalId ||
    !strings.kind ||
    !strings.provider ||
    !strings.discoveredFrom ||
    Object.values(integers).some((entry) => entry === undefined) ||
    !isLibraryCoreNonnegativeSafeInteger(record.createdAt) ||
    !isLibraryCoreNonnegativeSafeInteger(record.firstSeenAt) ||
    !isLibraryCoreNonnegativeSafeInteger(record.lastSeenAt) ||
    !isLibraryCoreNonnegativeSafeInteger(record.updatedAt) ||
    (record.followRosterActive !== null &&
      typeof record.followRosterActive !== "boolean") ||
    !Array.isArray(record.followRosterRoles) ||
    record.followRosterRoles.length >
      LIBRARY_CORE_ACCOUNT_DETAIL_MAXIMUM_FOLLOW_ROLES
  ) {
    return null;
  }
  const roles = record.followRosterRoles.map((role) => boundedText(role, 64));
  if (
    roles.some((role) => role === undefined || role.length === 0) ||
    roles.some((role, index) => index > 0 && roles[index - 1]! >= role!)
  ) {
    return null;
  }
  return Object.freeze({
    ...strings,
    ...integers,
    createdAt: record.createdAt,
    firstSeenAt: record.firstSeenAt,
    followRosterActive: record.followRosterActive,
    followRosterRoles: Object.freeze(roles) as readonly string[],
    lastSeenAt: record.lastSeenAt,
    updatedAt: record.updatedAt,
  }) as LibraryCoreAccountDetailV1;
}

export function parseLibraryCoreAccountDetailResponseV1(
  value: unknown,
  requestValue: unknown,
): LibraryCoreFeedPageParseResult<LibraryCoreAccountDetailResponseV1> {
  const request = parseLibraryCoreAccountDetailRequestV1(requestValue);
  const record = closedRecord(value, RESPONSE_KEYS);
  const source = parseLibraryCoreFeedPageSourceV1(record?.source);
  if (
    !request.ok ||
    !record ||
    !source.ok ||
    record.queryId !== LIBRARY_CORE_ACCOUNT_DETAIL_QUERY_ID ||
    record.schemaVersion !== LIBRARY_CORE_ACCOUNT_DETAIL_SCHEMA_VERSION
  ) {
    return failure("account detail response is invalid");
  }
  const account = record.account === null ? null : parseAccount(record.account);
  if (account === null && record.account !== null) {
    return failure("account detail row is invalid");
  }
  if (account !== null && account.id !== request.value.accountId) {
    return failure("account detail row does not match the requested identity");
  }
  const response = Object.freeze({
    account,
    queryId: LIBRARY_CORE_ACCOUNT_DETAIL_QUERY_ID,
    schemaVersion: LIBRARY_CORE_ACCOUNT_DETAIL_SCHEMA_VERSION,
    source: source.value,
  });
  if (
    textEncoder.encode(JSON.stringify(response)).byteLength >
    LIBRARY_CORE_ACCOUNT_DETAIL_MAXIMUM_RESPONSE_BYTES
  ) {
    return failure("account detail response exceeds its byte bound");
  }
  return Object.freeze({ ok: true, value: response });
}
