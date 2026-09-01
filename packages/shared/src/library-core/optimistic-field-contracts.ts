import type { FeedItem } from "../types.js";
import {
  parseLibraryCoreFeedPageSourceV1,
  type LibraryCoreFeedPageParseResult,
  type LibraryCoreFeedPageSourceV1,
} from "./feed-page-contracts.js";
import {
  isLibraryCoreEntityId,
  isLibraryCoreNonnegativeSafeInteger,
} from "./protocol-scalars.js";

export const LIBRARY_CORE_OPTIMISTIC_FIELDS_QUERY_ID =
  "optimistic_fields_v1" as const;
export const LIBRARY_CORE_OPTIMISTIC_FIELDS_SCHEMA_VERSION = 1 as const;
export const LIBRARY_CORE_OPTIMISTIC_FIELDS_MAXIMUM_ENTITY_IDS = 64;
export const LIBRARY_CORE_OPTIMISTIC_FIELDS_MAXIMUM_ROWS =
  LIBRARY_CORE_OPTIMISTIC_FIELDS_MAXIMUM_ENTITY_IDS * 7;
export const LIBRARY_CORE_OPTIMISTIC_FIELDS_MAXIMUM_RESPONSE_BYTES =
  2 * 1_048_576;

export const LIBRARY_CORE_OPTIMISTIC_FIELD_PATHS = Object.freeze([
  "archived",
  "archived_at",
  "liked",
  "liked_at",
  "read_at",
  "saved",
  "saved_at",
] as const);

export type LibraryCoreOptimisticFieldPathV1 =
  (typeof LIBRARY_CORE_OPTIMISTIC_FIELD_PATHS)[number];
export type LibraryCoreOptimisticQueryValueTypeV1 =
  "boolean" | "integer" | "null";

export interface LibraryCoreOptimisticFieldsRequestV1 {
  readonly entityIds: readonly string[];
  readonly queryId: typeof LIBRARY_CORE_OPTIMISTIC_FIELDS_QUERY_ID;
  readonly schemaVersion: typeof LIBRARY_CORE_OPTIMISTIC_FIELDS_SCHEMA_VERSION;
}

export interface LibraryCoreOptimisticFieldRowV1 {
  readonly entityId: string;
  readonly fieldPath: LibraryCoreOptimisticFieldPathV1;
  readonly value: boolean | number | null;
  readonly valueType: LibraryCoreOptimisticQueryValueTypeV1;
}

export interface LibraryCoreOptimisticFieldsResponseV1 {
  readonly queryId: typeof LIBRARY_CORE_OPTIMISTIC_FIELDS_QUERY_ID;
  readonly rows: readonly LibraryCoreOptimisticFieldRowV1[];
  readonly schemaVersion: typeof LIBRARY_CORE_OPTIMISTIC_FIELDS_SCHEMA_VERSION;
  readonly source: LibraryCoreFeedPageSourceV1;
}

const REQUEST_KEYS = Object.freeze(["entityIds", "queryId", "schemaVersion"]);
const RESPONSE_KEYS = Object.freeze([
  "queryId",
  "rows",
  "schemaVersion",
  "source",
]);
const ROW_KEYS = Object.freeze(["entityId", "fieldPath", "value", "valueType"]);
const FIELD_PATHS = new Set<string>(LIBRARY_CORE_OPTIMISTIC_FIELD_PATHS);
const textEncoder = new TextEncoder();

function failure<T>(error: string): LibraryCoreFeedPageParseResult<T> {
  return Object.freeze({ error, ok: false });
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

function validEntityId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    isLibraryCoreEntityId(value) &&
    textEncoder.encode(value).byteLength <= 2_048
  );
}

export function parseLibraryCoreOptimisticFieldsRequestV1(
  value: unknown,
): LibraryCoreFeedPageParseResult<LibraryCoreOptimisticFieldsRequestV1> {
  const record = closedRecord(value, REQUEST_KEYS);
  if (
    !record ||
    record.queryId !== LIBRARY_CORE_OPTIMISTIC_FIELDS_QUERY_ID ||
    record.schemaVersion !== LIBRARY_CORE_OPTIMISTIC_FIELDS_SCHEMA_VERSION ||
    !Array.isArray(record.entityIds) ||
    record.entityIds.length >
      LIBRARY_CORE_OPTIMISTIC_FIELDS_MAXIMUM_ENTITY_IDS ||
    record.entityIds.some((entityId) => !validEntityId(entityId)) ||
    new Set(record.entityIds).size !== record.entityIds.length
  ) {
    return failure("optimistic-fields request is invalid");
  }
  return Object.freeze({
    ok: true,
    value: Object.freeze({
      entityIds: Object.freeze([...record.entityIds]),
      queryId: LIBRARY_CORE_OPTIMISTIC_FIELDS_QUERY_ID,
      schemaVersion: LIBRARY_CORE_OPTIMISTIC_FIELDS_SCHEMA_VERSION,
    }),
  });
}

function parseRow(
  value: unknown,
  requestedIds: ReadonlySet<string>,
): LibraryCoreOptimisticFieldRowV1 | null {
  const row = closedRecord(value, ROW_KEYS);
  if (
    !row ||
    !validEntityId(row.entityId) ||
    !requestedIds.has(row.entityId) ||
    typeof row.fieldPath !== "string" ||
    !FIELD_PATHS.has(row.fieldPath) ||
    !["boolean", "integer", "null"].includes(String(row.valueType))
  ) {
    return null;
  }
  const valueType = row.valueType as LibraryCoreOptimisticQueryValueTypeV1;
  if (
    (valueType === "boolean" && typeof row.value !== "boolean") ||
    (valueType === "integer" &&
      !isLibraryCoreNonnegativeSafeInteger(row.value)) ||
    (valueType === "null" && row.value !== null)
  ) {
    return null;
  }
  return Object.freeze({
    entityId: row.entityId,
    fieldPath: row.fieldPath as LibraryCoreOptimisticFieldPathV1,
    value: row.value as boolean | number | null,
    valueType,
  });
}

export function parseLibraryCoreOptimisticFieldsResponseV1(
  value: unknown,
  request: LibraryCoreOptimisticFieldsRequestV1,
): LibraryCoreFeedPageParseResult<LibraryCoreOptimisticFieldsResponseV1> {
  const record = closedRecord(value, RESPONSE_KEYS);
  if (
    !record ||
    record.queryId !== request.queryId ||
    record.schemaVersion !== request.schemaVersion ||
    !Array.isArray(record.rows) ||
    record.rows.length > LIBRARY_CORE_OPTIMISTIC_FIELDS_MAXIMUM_ROWS ||
    textEncoder.encode(JSON.stringify(value)).byteLength >
      LIBRARY_CORE_OPTIMISTIC_FIELDS_MAXIMUM_RESPONSE_BYTES
  ) {
    return failure("optimistic-fields response is invalid");
  }
  const requestedIds = new Set(request.entityIds);
  const rows = record.rows.map((row) => parseRow(row, requestedIds));
  if (rows.some((row) => row === null)) {
    return failure("optimistic-fields response row is invalid");
  }
  const identities = new Set<string>();
  for (const row of rows as LibraryCoreOptimisticFieldRowV1[]) {
    const identity = `${row.entityId}\u0000${row.fieldPath}`;
    if (identities.has(identity)) {
      return failure("optimistic-fields response contains duplicate fields");
    }
    identities.add(identity);
  }
  const source = parseLibraryCoreFeedPageSourceV1(record.source);
  if (!source.ok) return failure(source.error);
  return Object.freeze({
    ok: true,
    value: Object.freeze({
      queryId: LIBRARY_CORE_OPTIMISTIC_FIELDS_QUERY_ID,
      rows: Object.freeze(rows as LibraryCoreOptimisticFieldRowV1[]),
      schemaVersion: LIBRARY_CORE_OPTIMISTIC_FIELDS_SCHEMA_VERSION,
      source: source.value,
    }),
  });
}

/** Merge sparse local follower fields into one already bounded FeedItem row. */
export function applyLibraryCoreOptimisticFieldsV1(
  item: FeedItem,
  rows: readonly LibraryCoreOptimisticFieldRowV1[],
): FeedItem {
  let userState = item.userState;
  for (const row of rows) {
    if (row.entityId !== item.globalId) continue;
    switch (row.fieldPath) {
      case "archived":
        userState = { ...userState, archived: row.value as boolean };
        break;
      case "archived_at":
        userState = {
          ...userState,
          archivedAt: row.value as number | undefined,
        };
        if (row.value === null) delete userState.archivedAt;
        break;
      case "liked":
        userState = { ...userState, liked: row.value as boolean };
        break;
      case "liked_at":
        userState = { ...userState, likedAt: row.value as number | undefined };
        if (row.value === null) delete userState.likedAt;
        break;
      case "read_at":
        userState = { ...userState, readAt: row.value as number };
        break;
      case "saved":
        userState = { ...userState, saved: row.value as boolean };
        break;
      case "saved_at":
        userState = { ...userState, savedAt: row.value as number | undefined };
        if (row.value === null) delete userState.savedAt;
        break;
    }
  }
  return userState === item.userState ? item : { ...item, userState };
}

export type LibraryCoreOptimisticFieldsQueryV1 = (
  request: LibraryCoreOptimisticFieldsRequestV1,
) => Promise<LibraryCoreOptimisticFieldsResponseV1>;

/** Resolve sparse follower overlays for one bounded visible FeedItem window. */
export async function applyLibraryCoreVisibleOptimisticFieldsV1(
  query: LibraryCoreOptimisticFieldsQueryV1,
  items: readonly FeedItem[],
  expectedProjectionRevision: number,
): Promise<readonly FeedItem[]> {
  if (items.length === 0) return Object.freeze([]);
  const rows: LibraryCoreOptimisticFieldRowV1[] = [];
  let generationId: string | null = null;
  let localSequence: number | null = null;
  const entityIds = [...new Set(items.map((item) => item.globalId))].sort();
  for (
    let offset = 0;
    offset < entityIds.length;
    offset += LIBRARY_CORE_OPTIMISTIC_FIELDS_MAXIMUM_ENTITY_IDS
  ) {
    const response = await query({
      entityIds: entityIds.slice(
        offset,
        offset + LIBRARY_CORE_OPTIMISTIC_FIELDS_MAXIMUM_ENTITY_IDS,
      ),
      queryId: LIBRARY_CORE_OPTIMISTIC_FIELDS_QUERY_ID,
      schemaVersion: LIBRARY_CORE_OPTIMISTIC_FIELDS_SCHEMA_VERSION,
    });
    if (
      response.source.projectionRevision !== expectedProjectionRevision ||
      (generationId !== null &&
        response.source.generationId !== generationId) ||
      (localSequence !== null &&
        response.source.transitionSequence !== localSequence)
    ) {
      throw new Error(
        "SQLite Library changed while optimistic fields were loading",
      );
    }
    generationId = response.source.generationId;
    localSequence = response.source.transitionSequence;
    rows.push(...response.rows);
  }
  const rowsByEntity = new Map<string, LibraryCoreOptimisticFieldRowV1[]>();
  for (const row of rows) {
    const entityRows = rowsByEntity.get(row.entityId) ?? [];
    entityRows.push(row);
    rowsByEntity.set(row.entityId, entityRows);
  }
  return Object.freeze(
    items.map((item) =>
      applyLibraryCoreOptimisticFieldsV1(
        item,
        rowsByEntity.get(item.globalId) ?? [],
      ),
    ),
  );
}
