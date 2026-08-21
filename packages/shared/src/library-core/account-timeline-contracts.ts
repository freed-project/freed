import {
  decodeLibraryCorePersonTimelineCursorV1,
  encodeLibraryCorePersonTimelineCursorV1,
  libraryCorePersonTimelinePersonDigestV1,
  parseLibraryCorePersonTimelineRequestV1,
  parseLibraryCorePersonTimelineResponseV1,
  type LibraryCorePersonTimelineRequestV1,
  type LibraryCorePersonTimelineResponseV1,
} from "./person-timeline-contracts.js";
import type {
  LibraryCoreFeedCardV1,
  LibraryCoreFeedPageCursorV1,
  LibraryCoreFeedPageParseResult,
  LibraryCoreFeedPageSourceV1,
} from "./feed-page-contracts.js";
import type { LibraryCoreLowercaseHex64 } from "./protocol-scalars.js";

export const LIBRARY_CORE_ACCOUNT_TIMELINE_QUERY_ID =
  "account_timeline_v1" as const;
export const LIBRARY_CORE_ACCOUNT_TIMELINE_SCHEMA_VERSION = 1 as const;
export const LIBRARY_CORE_ACCOUNT_TIMELINE_DEFAULT_LIMIT = 50;
export const LIBRARY_CORE_ACCOUNT_TIMELINE_MAXIMUM_LIMIT = 100;
export const LIBRARY_CORE_ACCOUNT_TIMELINE_MAXIMUM_CURSOR_BYTES = 5_700;
export const LIBRARY_CORE_ACCOUNT_TIMELINE_MAXIMUM_RESPONSE_BYTES =
  2 * 1_048_576;

export const LIBRARY_CORE_ACCOUNT_TIMELINE_REQUEST_SCHEMA = Object.freeze({
  schemaId: "library_core_account_timeline_request_v1",
  schemaVersion: LIBRARY_CORE_ACCOUNT_TIMELINE_SCHEMA_VERSION,
  queryId: LIBRARY_CORE_ACCOUNT_TIMELINE_QUERY_ID,
  canonicalKeys: Object.freeze([
    "accountId",
    "cancellationId",
    "cursor",
    "limit",
    "queryId",
    "readerSessionId",
    "schemaVersion",
  ]),
  defaultLimit: LIBRARY_CORE_ACCOUNT_TIMELINE_DEFAULT_LIMIT,
  maximumLimit: LIBRARY_CORE_ACCOUNT_TIMELINE_MAXIMUM_LIMIT,
  cursorCodec: "library_core_account_timeline_cursor_v1",
  maximumCursorBytes: LIBRARY_CORE_ACCOUNT_TIMELINE_MAXIMUM_CURSOR_BYTES,
});

export const LIBRARY_CORE_ACCOUNT_TIMELINE_RESPONSE_SCHEMA = Object.freeze({
  schemaId: "library_core_account_timeline_response_v1",
  schemaVersion: LIBRARY_CORE_ACCOUNT_TIMELINE_SCHEMA_VERSION,
  queryId: LIBRARY_CORE_ACCOUNT_TIMELINE_QUERY_ID,
  canonicalKeys: Object.freeze([
    "nextCursor",
    "queryId",
    "rows",
    "schemaVersion",
    "source",
    "totalCount",
  ]),
  maximumRows: LIBRARY_CORE_ACCOUNT_TIMELINE_MAXIMUM_LIMIT,
  maximumResponseBytes: LIBRARY_CORE_ACCOUNT_TIMELINE_MAXIMUM_RESPONSE_BYTES,
});

const REQUEST_KEYS = LIBRARY_CORE_ACCOUNT_TIMELINE_REQUEST_SCHEMA.canonicalKeys;
const RESPONSE_KEYS =
  LIBRARY_CORE_ACCOUNT_TIMELINE_RESPONSE_SCHEMA.canonicalKeys;

export interface LibraryCoreAccountTimelineCursorV1 extends LibraryCoreFeedPageCursorV1 {
  readonly accountDigest: LibraryCoreLowercaseHex64;
}

export interface LibraryCoreAccountTimelineRequestV1 {
  readonly accountId: string;
  readonly cancellationId: string;
  readonly cursor: string | null;
  readonly limit: number;
  readonly queryId: typeof LIBRARY_CORE_ACCOUNT_TIMELINE_QUERY_ID;
  readonly readerSessionId: string;
  readonly schemaVersion: typeof LIBRARY_CORE_ACCOUNT_TIMELINE_SCHEMA_VERSION;
}

export interface LibraryCoreAccountTimelineResponseV1 {
  readonly nextCursor: string | null;
  readonly queryId: typeof LIBRARY_CORE_ACCOUNT_TIMELINE_QUERY_ID;
  readonly rows: readonly LibraryCoreFeedCardV1[];
  readonly schemaVersion: typeof LIBRARY_CORE_ACCOUNT_TIMELINE_SCHEMA_VERSION;
  readonly source: LibraryCoreFeedPageSourceV1;
  readonly totalCount: number;
}

function failure<T>(error: string): LibraryCoreFeedPageParseResult<T> {
  return Object.freeze({ error, ok: false });
}

function closedRecord(
  value: unknown,
  keys: readonly string[],
  label: string,
): LibraryCoreFeedPageParseResult<Record<string, unknown>> {
  if (
    value === null ||
    typeof value !== "object" ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(value))
  ) {
    return failure(`${label} must be one plain record`);
  }
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const ownKeys = Reflect.ownKeys(value);
  if (
    ownKeys.length !== keys.length ||
    ownKeys.some((key) => typeof key !== "string" || !keys.includes(key))
  ) {
    return failure(`${label} has unknown or missing fields`);
  }
  const snapshot: Record<string, unknown> = {};
  for (const key of keys) {
    const descriptor = descriptors[key];
    if (!descriptor || !descriptor.enumerable || !("value" in descriptor)) {
      return failure(`${label}.${key} must be an enumerable data property`);
    }
    snapshot[key] = descriptor.value;
  }
  return Object.freeze({ ok: true, value: snapshot });
}

function translatedRequest(
  record: Readonly<Record<string, unknown>>,
): LibraryCorePersonTimelineRequestV1 {
  return {
    cancellationId: record.cancellationId as string,
    cursor: record.cursor as string | null,
    limit: record.limit as number,
    personId: record.accountId as string,
    queryId: "person_timeline_v1",
    readerSessionId: record.readerSessionId as string,
    schemaVersion: record.schemaVersion as 1,
  };
}

export function libraryCoreAccountTimelineAccountDigestV1(
  accountId: string,
): LibraryCoreLowercaseHex64 {
  return libraryCorePersonTimelinePersonDigestV1(accountId);
}

export function encodeLibraryCoreAccountTimelineCursorV1(
  cursor: LibraryCoreAccountTimelineCursorV1,
): string {
  return encodeLibraryCorePersonTimelineCursorV1({
    ...cursor,
    personDigest: cursor.accountDigest,
  });
}

export function decodeLibraryCoreAccountTimelineCursorV1(
  value: unknown,
): LibraryCoreFeedPageParseResult<LibraryCoreAccountTimelineCursorV1> {
  const parsed = decodeLibraryCorePersonTimelineCursorV1(value);
  return parsed.ok
    ? Object.freeze({
        ok: true,
        value: Object.freeze({
          accountDigest: parsed.value.personDigest,
          generationId: parsed.value.generationId,
          globalId: parsed.value.globalId,
          projectionRevision: parsed.value.projectionRevision,
          sortAt: parsed.value.sortAt,
          transitionSequence: parsed.value.transitionSequence,
        }),
      })
    : failure(parsed.error);
}

export function parseLibraryCoreAccountTimelineRequestV1(
  value: unknown,
): LibraryCoreFeedPageParseResult<LibraryCoreAccountTimelineRequestV1> {
  const record = closedRecord(value, REQUEST_KEYS, "request");
  if (!record.ok) return record;
  if (record.value.queryId !== LIBRARY_CORE_ACCOUNT_TIMELINE_QUERY_ID) {
    return failure("account timeline request is invalid");
  }
  const parsed = parseLibraryCorePersonTimelineRequestV1(
    translatedRequest(record.value),
  );
  if (!parsed.ok) return failure(parsed.error);
  return Object.freeze({
    ok: true,
    value: Object.freeze({
      accountId: parsed.value.personId,
      cancellationId: parsed.value.cancellationId,
      cursor: parsed.value.cursor,
      limit: parsed.value.limit,
      queryId: LIBRARY_CORE_ACCOUNT_TIMELINE_QUERY_ID,
      readerSessionId: parsed.value.readerSessionId,
      schemaVersion: LIBRARY_CORE_ACCOUNT_TIMELINE_SCHEMA_VERSION,
    }),
  });
}

export function parseLibraryCoreAccountTimelineResponseV1(
  value: unknown,
  requestValue: unknown,
): LibraryCoreFeedPageParseResult<LibraryCoreAccountTimelineResponseV1> {
  const request = parseLibraryCoreAccountTimelineRequestV1(requestValue);
  if (!request.ok) return failure(request.error);
  const response = closedRecord(value, RESPONSE_KEYS, "response");
  if (!response.ok) return response;
  if (response.value.queryId !== LIBRARY_CORE_ACCOUNT_TIMELINE_QUERY_ID) {
    return failure("account timeline response is invalid");
  }
  const translatedResponse = {
    nextCursor: response.value.nextCursor,
    queryId: "person_timeline_v1",
    rows: response.value.rows,
    schemaVersion: response.value.schemaVersion,
    source: response.value.source,
    totalCount: response.value.totalCount,
  };
  const translatedRequestValue: LibraryCorePersonTimelineRequestV1 = {
    cancellationId: request.value.cancellationId,
    cursor: request.value.cursor,
    limit: request.value.limit,
    personId: request.value.accountId,
    queryId: "person_timeline_v1",
    readerSessionId: request.value.readerSessionId,
    schemaVersion: 1,
  };
  const parsed = parseLibraryCorePersonTimelineResponseV1(
    translatedResponse,
    translatedRequestValue,
  );
  if (!parsed.ok) return failure(parsed.error);
  const result: LibraryCorePersonTimelineResponseV1 = parsed.value;
  return Object.freeze({
    ok: true,
    value: Object.freeze({
      nextCursor: result.nextCursor,
      queryId: LIBRARY_CORE_ACCOUNT_TIMELINE_QUERY_ID,
      rows: result.rows,
      schemaVersion: LIBRARY_CORE_ACCOUNT_TIMELINE_SCHEMA_VERSION,
      source: result.source,
      totalCount: result.totalCount,
    }),
  });
}
