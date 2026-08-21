import type { FeedItem } from "../types.js";
import {
  parseLibraryCoreFeedBrowseFilterV1,
  type LibraryCoreFeedBrowseFilterV1,
} from "./feed-browse-filter-contract.js";
import { isLibraryCoreSearchQueryV1 } from "./search-contracts.js";

export const LIBRARY_CORE_SCOPE_ACTION_SCHEMA_VERSION = 1 as const;
export const LIBRARY_CORE_SCOPE_ACTION_BATCH_LIMIT = 1_000 as const;

export type LibraryCoreScopeActionKindV1 = "archive" | "read";

export interface LibraryCoreScopeActionRequestV1 {
  readonly action: LibraryCoreScopeActionKindV1;
  readonly filter: LibraryCoreFeedBrowseFilterV1;
  readonly identityMode: "all_content" | "friends";
  readonly query: string | null;
  readonly schemaVersion: typeof LIBRARY_CORE_SCOPE_ACTION_SCHEMA_VERSION;
}

export interface LibraryCoreScopeActionReceiptV1 {
  readonly affectedCount: number;
  readonly batchCount: number;
  readonly schemaVersion: typeof LIBRARY_CORE_SCOPE_ACTION_SCHEMA_VERSION;
}

export interface LibraryCoreScopeActionRuntimeV1 {
  readonly scan: (
    visit: (items: readonly FeedItem[]) => Promise<void>,
  ) => Promise<void>;
  readonly commitBatch: (
    action: LibraryCoreScopeActionKindV1,
    entityIds: readonly string[],
  ) => Promise<void>;
}

const REQUEST_KEYS = [
  "action",
  "filter",
  "identityMode",
  "query",
  "schemaVersion",
] as const;

export function parseLibraryCoreScopeActionRequestV1(
  value: unknown,
): LibraryCoreScopeActionRequestV1 {
  if (
    value === null ||
    typeof value !== "object" ||
    Object.getPrototypeOf(value) !== Object.prototype
  ) {
    throw new TypeError("Library scope action must be one plain record");
  }
  const record = value as Record<string, unknown>;
  const keys = Reflect.ownKeys(record);
  if (
    keys.length !== REQUEST_KEYS.length ||
    keys.some(
      (key) =>
        typeof key !== "string" ||
        !REQUEST_KEYS.includes(key as (typeof REQUEST_KEYS)[number]),
    )
  ) {
    throw new TypeError("Library scope action fields are invalid");
  }
  const filter = parseLibraryCoreFeedBrowseFilterV1(record.filter);
  if (!filter.ok) throw new TypeError(filter.error);
  if (
    record.schemaVersion !== LIBRARY_CORE_SCOPE_ACTION_SCHEMA_VERSION ||
    (record.action !== "archive" && record.action !== "read") ||
    (record.identityMode !== "all_content" && record.identityMode !== "friends") ||
    !(
      record.query === null ||
      (typeof record.query === "string" &&
        isLibraryCoreSearchQueryV1(record.query))
    )
  ) {
    throw new TypeError("Library scope action value is invalid");
  }
  return Object.freeze({
    action: record.action,
    filter: filter.value,
    identityMode: record.identityMode,
    query: record.query,
    schemaVersion: record.schemaVersion,
  });
}

function eligible(
  action: LibraryCoreScopeActionKindV1,
  item: FeedItem,
): boolean {
  if (item.userState.hidden || item.userState.archived) return false;
  return action === "read"
    ? item.userState.readAt === undefined
    : item.userState.readAt !== undefined && !item.userState.saved;
}

/**
 * Resolve one complete SQLite scope into one explicit bounded transaction.
 * Larger sets fail before any mutation until durable SQLite staging lands.
 */
export async function executeLibraryCoreScopeActionV1(
  input: LibraryCoreScopeActionRequestV1,
  runtime: LibraryCoreScopeActionRuntimeV1,
): Promise<LibraryCoreScopeActionReceiptV1> {
  const request = parseLibraryCoreScopeActionRequestV1(input);
  const pending: string[] = [];
  await runtime.scan(async (items) => {
    for (const item of items) {
      if (!eligible(request.action, item)) continue;
      pending.push(item.globalId);
      if (pending.length > LIBRARY_CORE_SCOPE_ACTION_BATCH_LIMIT) {
        throw new Error("Library scope action requires durable SQLite staging");
      }
    }
  });
  if (pending.length > 0) {
    await runtime.commitBatch(request.action, Object.freeze(pending));
  }
  return Object.freeze({
    affectedCount: pending.length,
    batchCount: pending.length === 0 ? 0 : 1,
    schemaVersion: LIBRARY_CORE_SCOPE_ACTION_SCHEMA_VERSION,
  });
}
