import {
  parseLibraryCoreFeedPageSourceV1,
  type LibraryCoreFeedPageParseResult,
  type LibraryCoreFeedPageSourceV1,
} from "./feed-page-contracts.js";
import {
  isLibraryCoreNonnegativeSafeInteger,
  isLibraryCoreOperationInstanceId,
} from "./protocol-scalars.js";
import {
  parseLibraryCoreGeneratedSqliteQueryRow,
  type LibraryCoreGeneratedSqliteQueryRow,
} from "./sqlite-contract.generated.js";
import { CONTENT_SIGNAL_KEYS } from "../content-signals.js";

export const LIBRARY_CORE_FRIEND_CANDIDATE_REVIEW_QUERY_ID =
  "friend_candidate_review_v1" as const;
export const LIBRARY_CORE_FRIEND_CANDIDATE_REVIEW_SCHEMA_VERSION = 1 as const;
export const LIBRARY_CORE_FRIEND_CANDIDATE_REVIEW_MAXIMUM_LIMIT = 10;
export const LIBRARY_CORE_FRIEND_CANDIDATE_REVIEW_MAXIMUM_CONTACT_IDS = 512;
export const LIBRARY_CORE_FRIEND_CANDIDATE_REVIEW_MAXIMUM_DISMISSED_IDS = 256;
export const LIBRARY_CORE_FRIEND_CANDIDATE_REVIEW_MAXIMUM_RESPONSE_BYTES =
  512 * 1_024;

const REQUEST_KEYS = [
  "cancellationId",
  "contactAccountIds",
  "contactPersonIds",
  "dismissedSuggestionIds",
  "limit",
  "nowMs",
  "queryId",
  "readerSessionId",
  "schemaVersion",
] as const;
const RESPONSE_KEYS = ["queryId", "rows", "schemaVersion", "source"] as const;
const textEncoder = new TextEncoder();

export const LIBRARY_CORE_FRIEND_CANDIDATE_REVIEW_REQUEST_SCHEMA =
  Object.freeze({
    schemaId: "library_core_friend_candidate_review_request_v1",
    schemaVersion: LIBRARY_CORE_FRIEND_CANDIDATE_REVIEW_SCHEMA_VERSION,
    queryId: LIBRARY_CORE_FRIEND_CANDIDATE_REVIEW_QUERY_ID,
    canonicalKeys: REQUEST_KEYS,
    maximumContactIds: LIBRARY_CORE_FRIEND_CANDIDATE_REVIEW_MAXIMUM_CONTACT_IDS,
    maximumDismissedIds:
      LIBRARY_CORE_FRIEND_CANDIDATE_REVIEW_MAXIMUM_DISMISSED_IDS,
    maximumLimit: LIBRARY_CORE_FRIEND_CANDIDATE_REVIEW_MAXIMUM_LIMIT,
  });

export const LIBRARY_CORE_FRIEND_CANDIDATE_REVIEW_RESPONSE_SCHEMA =
  Object.freeze({
    schemaId: "library_core_friend_candidate_review_response_v1",
    schemaVersion: LIBRARY_CORE_FRIEND_CANDIDATE_REVIEW_SCHEMA_VERSION,
    queryId: LIBRARY_CORE_FRIEND_CANDIDATE_REVIEW_QUERY_ID,
    canonicalKeys: RESPONSE_KEYS,
    maximumRows: LIBRARY_CORE_FRIEND_CANDIDATE_REVIEW_MAXIMUM_LIMIT,
    maximumResponseBytes:
      LIBRARY_CORE_FRIEND_CANDIDATE_REVIEW_MAXIMUM_RESPONSE_BYTES,
  });

export const LIBRARY_CORE_FRIEND_CANDIDATE_REVIEW_PROJECTION = Object.freeze({
  projectionId: "library_core_friend_candidate_review_row_v1",
  sourceTable: "library_accounts",
  supportingTables: Object.freeze([
    "library_feed_items",
    "library_feed_item_signal_scores",
    "library_persons",
  ]),
  fullContentAllowed: false,
  orderedColumns: Object.freeze([
    "score",
    "last_activity_at",
    "display_name",
    "kind",
    "target_id",
  ]),
});

export const LIBRARY_CORE_FRIEND_CANDIDATE_REVIEW_SOURCE_IDENTITY =
  Object.freeze({
    identityId: "library_core_projection_reader_source_v1",
    generationId: "sha256_file_digest",
    transitionSequence: "nonnegative_safe_integer",
    projectionRevision: "nonnegative_safe_integer",
    sessionPinned: true,
  });

export const LIBRARY_CORE_FRIEND_CANDIDATE_REVIEW_NESTED_BOUNDS = Object.freeze(
  {
    accountIds: Object.freeze({ maximumItems: 16, sortedUnique: true }),
    contactAccountIds: Object.freeze({
      maximumItems: LIBRARY_CORE_FRIEND_CANDIDATE_REVIEW_MAXIMUM_CONTACT_IDS,
      sortedUnique: true,
    }),
    contactPersonIds: Object.freeze({
      maximumItems: LIBRARY_CORE_FRIEND_CANDIDATE_REVIEW_MAXIMUM_CONTACT_IDS,
      sortedUnique: true,
    }),
    dismissedSuggestionIds: Object.freeze({
      maximumItems: LIBRARY_CORE_FRIEND_CANDIDATE_REVIEW_MAXIMUM_DISMISSED_IDS,
      sortedUnique: true,
    }),
    sampleItemIds: Object.freeze({ maximumItems: 5, sortedUnique: false }),
    signalCounts: Object.freeze({ maximumEntries: 32 }),
  },
);

export interface LibraryCoreFriendCandidateReviewRequestV1 {
  readonly cancellationId: string;
  readonly contactAccountIds: readonly string[];
  readonly contactPersonIds: readonly string[];
  readonly dismissedSuggestionIds: readonly string[];
  readonly limit: number;
  readonly nowMs: number;
  readonly queryId: typeof LIBRARY_CORE_FRIEND_CANDIDATE_REVIEW_QUERY_ID;
  readonly readerSessionId: string;
  readonly schemaVersion: typeof LIBRARY_CORE_FRIEND_CANDIDATE_REVIEW_SCHEMA_VERSION;
}

export type LibraryCoreFriendCandidateReviewRowV1 =
  LibraryCoreGeneratedSqliteQueryRow<"friend_candidate_review_v1">;

export interface LibraryCoreFriendCandidateReviewResponseV1 {
  readonly queryId: typeof LIBRARY_CORE_FRIEND_CANDIDATE_REVIEW_QUERY_ID;
  readonly rows: readonly LibraryCoreFriendCandidateReviewRowV1[];
  readonly schemaVersion: typeof LIBRARY_CORE_FRIEND_CANDIDATE_REVIEW_SCHEMA_VERSION;
  readonly source: LibraryCoreFeedPageSourceV1;
}

function recordValue(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function exactKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
): boolean {
  const keys = Object.keys(value).sort();
  const sortedExpected = [...expected].sort();
  return (
    keys.length === sortedExpected.length &&
    keys.every((key, index) => key === sortedExpected[index])
  );
}

function boundedSortedUniqueIds(
  value: unknown,
  maximumItems: number,
  maximumItemBytes: number,
): readonly string[] | null {
  if (!Array.isArray(value) || value.length > maximumItems) return null;
  const result: string[] = [];
  for (const candidate of value) {
    if (
      typeof candidate !== "string" ||
      candidate.length === 0 ||
      textEncoder.encode(candidate).byteLength > maximumItemBytes ||
      (result.length > 0 && result[result.length - 1]! >= candidate)
    ) {
      return null;
    }
    result.push(candidate);
  }
  return Object.freeze(result);
}

function validNestedRow(row: LibraryCoreFriendCandidateReviewRowV1): boolean {
  try {
    const accountIds = JSON.parse(row.accountIdsJson) as unknown;
    const sampleItemIds = JSON.parse(row.sampleItemIdsJson) as unknown;
    const signalCounts = JSON.parse(row.signalCountsJson) as unknown;
    if (
      boundedSortedUniqueIds(accountIds, 16, 2_048) === null ||
      !Array.isArray(sampleItemIds) ||
      sampleItemIds.length > 5 ||
      sampleItemIds.some(
        (value) =>
          typeof value !== "string" ||
          value.length === 0 ||
          textEncoder.encode(value).byteLength > 2_048,
      ) ||
      !signalCounts ||
      typeof signalCounts !== "object" ||
      Array.isArray(signalCounts)
    ) {
      return false;
    }
    const entries = Object.entries(signalCounts);
    const signalSet = new Set<string>(CONTENT_SIGNAL_KEYS);
    return (
      entries.length <= 32 &&
      entries.every(
        ([signal, count]) =>
          signalSet.has(signal) &&
          Number.isSafeInteger(count) &&
          (count as number) >= 0,
      )
    );
  } catch {
    return false;
  }
}

export function parseLibraryCoreFriendCandidateReviewRequestV1(
  input: unknown,
): LibraryCoreFeedPageParseResult<LibraryCoreFriendCandidateReviewRequestV1> {
  const record = recordValue(input);
  const contactAccountIds = boundedSortedUniqueIds(
    record?.contactAccountIds,
    LIBRARY_CORE_FRIEND_CANDIDATE_REVIEW_MAXIMUM_CONTACT_IDS,
    2_048,
  );
  const contactPersonIds = boundedSortedUniqueIds(
    record?.contactPersonIds,
    LIBRARY_CORE_FRIEND_CANDIDATE_REVIEW_MAXIMUM_CONTACT_IDS,
    2_048,
  );
  const dismissedSuggestionIds = boundedSortedUniqueIds(
    record?.dismissedSuggestionIds,
    LIBRARY_CORE_FRIEND_CANDIDATE_REVIEW_MAXIMUM_DISMISSED_IDS,
    8_192,
  );
  if (
    !record ||
    !exactKeys(record, REQUEST_KEYS) ||
    record.queryId !== LIBRARY_CORE_FRIEND_CANDIDATE_REVIEW_QUERY_ID ||
    record.schemaVersion !==
      LIBRARY_CORE_FRIEND_CANDIDATE_REVIEW_SCHEMA_VERSION ||
    !isLibraryCoreOperationInstanceId(record.cancellationId) ||
    !isLibraryCoreOperationInstanceId(record.readerSessionId) ||
    !isLibraryCoreNonnegativeSafeInteger(record.nowMs) ||
    !Number.isInteger(record.limit) ||
    (record.limit as number) < 1 ||
    (record.limit as number) >
      LIBRARY_CORE_FRIEND_CANDIDATE_REVIEW_MAXIMUM_LIMIT ||
    contactAccountIds === null ||
    contactPersonIds === null ||
    dismissedSuggestionIds === null
  ) {
    return { ok: false, error: "Friend candidate review request is invalid" };
  }
  return {
    ok: true,
    value: Object.freeze({
      cancellationId: record.cancellationId,
      contactAccountIds,
      contactPersonIds,
      dismissedSuggestionIds,
      limit: record.limit,
      nowMs: record.nowMs,
      queryId: LIBRARY_CORE_FRIEND_CANDIDATE_REVIEW_QUERY_ID,
      readerSessionId: record.readerSessionId,
      schemaVersion: LIBRARY_CORE_FRIEND_CANDIDATE_REVIEW_SCHEMA_VERSION,
    }) as LibraryCoreFriendCandidateReviewRequestV1,
  };
}

export function parseLibraryCoreFriendCandidateReviewResponseV1(
  input: unknown,
  request: LibraryCoreFriendCandidateReviewRequestV1,
): LibraryCoreFeedPageParseResult<LibraryCoreFriendCandidateReviewResponseV1> {
  const record = recordValue(input);
  const source = parseLibraryCoreFeedPageSourceV1(record?.source);
  if (
    !record ||
    !exactKeys(record, RESPONSE_KEYS) ||
    record.queryId !== LIBRARY_CORE_FRIEND_CANDIDATE_REVIEW_QUERY_ID ||
    record.schemaVersion !==
      LIBRARY_CORE_FRIEND_CANDIDATE_REVIEW_SCHEMA_VERSION ||
    !source.ok ||
    !Array.isArray(record.rows) ||
    record.rows.length > request.limit ||
    textEncoder.encode(JSON.stringify(record)).byteLength >
      LIBRARY_CORE_FRIEND_CANDIDATE_REVIEW_MAXIMUM_RESPONSE_BYTES
  ) {
    return { ok: false, error: "Friend candidate review response is invalid" };
  }
  const rows = record.rows.map((row) =>
    parseLibraryCoreGeneratedSqliteQueryRow(
      LIBRARY_CORE_FRIEND_CANDIDATE_REVIEW_QUERY_ID,
      row,
    ),
  );
  if (rows.some((row) => row === null || !validNestedRow(row))) {
    return { ok: false, error: "Friend candidate review row is invalid" };
  }
  return {
    ok: true,
    value: Object.freeze({
      queryId: LIBRARY_CORE_FRIEND_CANDIDATE_REVIEW_QUERY_ID,
      rows: Object.freeze(rows as LibraryCoreFriendCandidateReviewRowV1[]),
      schemaVersion: LIBRARY_CORE_FRIEND_CANDIDATE_REVIEW_SCHEMA_VERSION,
      source: source.value,
    }),
  };
}
