import {
  parseLibraryCoreFeedPageSourceV1,
  type LibraryCoreFeedPageParseResult,
  type LibraryCoreFeedPageSourceV1,
} from "./feed-page-contracts.js";

export const LIBRARY_CORE_CONTACT_MATCH_QUERY_ID = "contact_match_v1" as const;
export const LIBRARY_CORE_CONTACT_MATCH_SCHEMA_VERSION = 1 as const;
export const LIBRARY_CORE_CONTACT_MATCH_MAXIMUM_NAMES = 8;
export const LIBRARY_CORE_CONTACT_MATCH_MAXIMUM_EMAILS = 16;
export const LIBRARY_CORE_CONTACT_MATCH_MAXIMUM_ACCOUNT_IDS = 32;
export const LIBRARY_CORE_CONTACT_MATCH_MAXIMUM_RESPONSE_BYTES = 128 * 1_024;

export const LIBRARY_CORE_CONTACT_MATCH_REQUEST_SCHEMA = Object.freeze({
  schemaId: "library_core_contact_match_request_v1",
  schemaVersion: LIBRARY_CORE_CONTACT_MATCH_SCHEMA_VERSION,
  queryId: LIBRARY_CORE_CONTACT_MATCH_QUERY_ID,
  canonicalKeys: Object.freeze(["emails", "names", "queryId", "schemaVersion"]),
  maximumNames: LIBRARY_CORE_CONTACT_MATCH_MAXIMUM_NAMES,
  maximumEmails: LIBRARY_CORE_CONTACT_MATCH_MAXIMUM_EMAILS,
});

export const LIBRARY_CORE_CONTACT_MATCH_RESPONSE_SCHEMA = Object.freeze({
  schemaId: "library_core_contact_match_response_v1",
  schemaVersion: LIBRARY_CORE_CONTACT_MATCH_SCHEMA_VERSION,
  queryId: LIBRARY_CORE_CONTACT_MATCH_QUERY_ID,
  canonicalKeys: Object.freeze([
    "accountIds",
    "confidence",
    "personId",
    "queryId",
    "schemaVersion",
    "source",
  ]),
  maximumRows: 1,
  maximumResponseBytes: LIBRARY_CORE_CONTACT_MATCH_MAXIMUM_RESPONSE_BYTES,
});

export const LIBRARY_CORE_CONTACT_MATCH_PROJECTION = Object.freeze({
  projectionId: "library_core_contact_match_v1",
  sourceTable: "library_persons_and_accounts",
  fullContentAllowed: false,
  orderedColumns: Object.freeze(["match_rank", "entity_id"]),
});

export const LIBRARY_CORE_CONTACT_MATCH_SOURCE_IDENTITY = Object.freeze({
  identityId: "library_core_projection_reader_source_v1",
  generationId: "sha256_file_digest",
  transitionSequence: "nonnegative_safe_integer",
  projectionRevision: "nonnegative_safe_integer",
  sessionPinned: true,
});

export const LIBRARY_CORE_CONTACT_MATCH_NESTED_BOUNDS = Object.freeze({
  accountIds: Object.freeze({
    maximumItems: LIBRARY_CORE_CONTACT_MATCH_MAXIMUM_ACCOUNT_IDS,
    maximumUnicodeScalarsPerItem: 2_048,
    maximumUtf8BytesPerItem: 2_048,
  }),
  emails: Object.freeze({
    maximumItems: LIBRARY_CORE_CONTACT_MATCH_MAXIMUM_EMAILS,
    maximumUnicodeScalarsPerItem: 4_096,
    maximumUtf8BytesPerItem: 4_096,
  }),
  names: Object.freeze({
    maximumItems: LIBRARY_CORE_CONTACT_MATCH_MAXIMUM_NAMES,
    maximumUnicodeScalarsPerItem: 512,
    maximumUtf8BytesPerItem: 512,
  }),
});

export interface LibraryCoreContactMatchRequestV1 {
  readonly emails: readonly string[];
  readonly names: readonly string[];
  readonly queryId: typeof LIBRARY_CORE_CONTACT_MATCH_QUERY_ID;
  readonly schemaVersion: typeof LIBRARY_CORE_CONTACT_MATCH_SCHEMA_VERSION;
}

export interface LibraryCoreContactMatchResponseV1 {
  readonly accountIds: readonly string[];
  readonly confidence: "high" | "medium";
  readonly personId: string | null;
  readonly queryId: typeof LIBRARY_CORE_CONTACT_MATCH_QUERY_ID;
  readonly schemaVersion: typeof LIBRARY_CORE_CONTACT_MATCH_SCHEMA_VERSION;
  readonly source: LibraryCoreFeedPageSourceV1;
}

const textEncoder = new TextEncoder();
const REQUEST_KEYS = LIBRARY_CORE_CONTACT_MATCH_REQUEST_SCHEMA.canonicalKeys;
const RESPONSE_KEYS = LIBRARY_CORE_CONTACT_MATCH_RESPONSE_SCHEMA.canonicalKeys;

function failure<T>(error: string): LibraryCoreFeedPageParseResult<T> {
  return Object.freeze({ ok: false, error });
}

function closedRecord(value: unknown, keys: readonly string[]): Record<string, unknown> | null {
  if (value === null || typeof value !== "object" || Object.getPrototypeOf(value) !== Object.prototype) {
    return null;
  }
  const ownKeys = Reflect.ownKeys(value);
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (
    ownKeys.length !== keys.length ||
    ownKeys.some((key) => typeof key !== "string" || !keys.includes(key)) ||
    keys.some((key) => !descriptors[key]?.enumerable || !("value" in descriptors[key]))
  ) {
    return null;
  }
  return Object.fromEntries(keys.map((key) => [key, descriptors[key]!.value]));
}

function boundedSortedUniqueStrings(
  value: unknown,
  maximumItems: number,
  maximumBytes: number,
): readonly string[] | null {
  if (!Array.isArray(value) || value.length > maximumItems) return null;
  const result: string[] = [];
  for (const entry of value) {
    if (
      typeof entry !== "string" ||
      entry.length === 0 ||
      textEncoder.encode(entry).byteLength > maximumBytes ||
      (result.length > 0 && result.at(-1)! >= entry)
    ) {
      return null;
    }
    result.push(entry);
  }
  return Object.freeze(result);
}

export function parseLibraryCoreContactMatchRequestV1(
  value: unknown,
): LibraryCoreFeedPageParseResult<LibraryCoreContactMatchRequestV1> {
  const record = closedRecord(value, REQUEST_KEYS);
  const emails = boundedSortedUniqueStrings(
    record?.emails,
    LIBRARY_CORE_CONTACT_MATCH_MAXIMUM_EMAILS,
    4_096,
  );
  const names = boundedSortedUniqueStrings(
    record?.names,
    LIBRARY_CORE_CONTACT_MATCH_MAXIMUM_NAMES,
    512,
  );
  if (
    !record ||
    !emails ||
    !names ||
    emails.length + names.length === 0 ||
    record.queryId !== LIBRARY_CORE_CONTACT_MATCH_QUERY_ID ||
    record.schemaVersion !== LIBRARY_CORE_CONTACT_MATCH_SCHEMA_VERSION
  ) {
    return failure("contact match request is invalid");
  }
  return Object.freeze({
    ok: true,
    value: Object.freeze({
      emails,
      names,
      queryId: LIBRARY_CORE_CONTACT_MATCH_QUERY_ID,
      schemaVersion: LIBRARY_CORE_CONTACT_MATCH_SCHEMA_VERSION,
    }),
  });
}

export function parseLibraryCoreContactMatchResponseV1(
  value: unknown,
  requestValue: unknown,
): LibraryCoreFeedPageParseResult<LibraryCoreContactMatchResponseV1> {
  const request = parseLibraryCoreContactMatchRequestV1(requestValue);
  const record = closedRecord(value, RESPONSE_KEYS);
  const source = parseLibraryCoreFeedPageSourceV1(record?.source);
  const accountIds = boundedSortedUniqueStrings(
    record?.accountIds,
    LIBRARY_CORE_CONTACT_MATCH_MAXIMUM_ACCOUNT_IDS,
    2_048,
  );
  const personId = record?.personId === null
    ? null
    : typeof record?.personId === "string" && record.personId.length > 0 && textEncoder.encode(record.personId).byteLength <= 2_048
      ? record.personId
      : undefined;
  if (
    !request.ok ||
    !record ||
    !source.ok ||
    !accountIds ||
    personId === undefined ||
    (record.confidence !== "high" && record.confidence !== "medium") ||
    record.queryId !== LIBRARY_CORE_CONTACT_MATCH_QUERY_ID ||
    record.schemaVersion !== LIBRARY_CORE_CONTACT_MATCH_SCHEMA_VERSION
  ) {
    return failure("contact match response is invalid");
  }
  return Object.freeze({
    ok: true,
    value: Object.freeze({
      accountIds,
      confidence: record.confidence,
      personId,
      queryId: LIBRARY_CORE_CONTACT_MATCH_QUERY_ID,
      schemaVersion: LIBRARY_CORE_CONTACT_MATCH_SCHEMA_VERSION,
      source: source.value,
    }),
  });
}
