import type { FeedItem } from "../types.js";
import {
  parseLibraryCoreFeedBrowseFilterV1,
  type LibraryCoreFeedBrowseFilterV1,
} from "./feed-browse-filter-contract.js";
import { isLibraryCoreSearchQueryV1 } from "./search-contracts.js";
import { LibraryCoreSha256 } from "./sha256.js";

export const LIBRARY_CORE_SCOPE_ACTION_SCHEMA_VERSION = 1 as const;
export const LIBRARY_CORE_SCOPE_ACTION_BATCH_LIMIT = 1_000 as const;
export const LIBRARY_CORE_SCOPE_ACTION_STAGE_APPEND_LIMIT = 256 as const;

export type LibraryCoreScopeActionKindV1 = "archive" | "read";

export type LibraryCoreRssFeedScopeActionKindV1 =
  | "rss_feeds_heal_untitled_frozen"
  | "rss_feeds_remove_keep_items"
  | "rss_feeds_remove_with_items";

export interface LibraryCoreRssFeedScopeActionRequestV1 {
  readonly action: LibraryCoreRssFeedScopeActionKindV1;
  readonly schemaVersion: typeof LIBRARY_CORE_SCOPE_ACTION_SCHEMA_VERSION;
}

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

export interface LibraryCoreScopeActionStageStatusV1 {
  readonly memberCount: number;
  readonly stageId: string;
  readonly state: "ready" | "staging";
}

export interface LibraryCoreScopeActionStagePageV1 {
  readonly entityIds: readonly string[];
  readonly nextOrdinal: number;
  readonly stageId: string;
}

export interface LibraryCoreScopeActionRuntimeV1 {
  readonly scan: (
    visit: (items: readonly FeedItem[]) => Promise<void>,
  ) => Promise<void>;
  readonly beginStage: (
    request: LibraryCoreScopeActionRequestV1,
  ) => Promise<string>;
  readonly appendStage: (
    stageId: string,
    entityIds: readonly string[],
  ) => Promise<void>;
  readonly finalizeStage: (stageId: string) => Promise<number>;
  readonly readStage: (
    stageId: string,
    afterOrdinal: number,
  ) => Promise<
    Readonly<{
      entityIds: readonly string[];
      nextOrdinal: number;
    }>
  >;
  readonly closeStage: (stageId: string) => Promise<void>;
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
const RSS_FEED_REQUEST_KEYS = ["action", "schemaVersion"] as const;

export function parseLibraryCoreRssFeedScopeActionRequestV1(
  value: unknown,
): LibraryCoreRssFeedScopeActionRequestV1 {
  if (
    value === null ||
    typeof value !== "object" ||
    Object.getPrototypeOf(value) !== Object.prototype
  ) {
    throw new TypeError("Library RSS Feed scope action must be one plain record");
  }
  const record = value as Record<string, unknown>;
  const keys = Reflect.ownKeys(record);
  if (
    keys.length !== RSS_FEED_REQUEST_KEYS.length ||
    keys.some(
      (key) =>
        typeof key !== "string" ||
        !RSS_FEED_REQUEST_KEYS.includes(
          key as (typeof RSS_FEED_REQUEST_KEYS)[number],
        ),
    ) ||
    record.schemaVersion !== LIBRARY_CORE_SCOPE_ACTION_SCHEMA_VERSION ||
    (record.action !== "rss_feeds_heal_untitled_frozen" &&
      record.action !== "rss_feeds_remove_keep_items" &&
      record.action !== "rss_feeds_remove_with_items")
  ) {
    throw new TypeError("Library RSS Feed scope action fields are invalid");
  }
  return Object.freeze({
    action: record.action as LibraryCoreRssFeedScopeActionKindV1,
    schemaVersion: LIBRARY_CORE_SCOPE_ACTION_SCHEMA_VERSION,
  });
}

export function digestLibraryCoreRssFeedScopeActionRequestV1(
  input: LibraryCoreRssFeedScopeActionRequestV1,
): string {
  const request = parseLibraryCoreRssFeedScopeActionRequestV1(input);
  return new LibraryCoreSha256()
    .update(new TextEncoder().encode(JSON.stringify(request)))
    .digestLowerHex();
}

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
    (record.identityMode !== "all_content" &&
      record.identityMode !== "friends") ||
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

export function digestLibraryCoreScopeActionRequestV1(
  input: LibraryCoreScopeActionRequestV1,
): string {
  const request = parseLibraryCoreScopeActionRequestV1(input);
  return new LibraryCoreSha256()
    .update(new TextEncoder().encode(JSON.stringify(request)))
    .digestLowerHex();
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
 * Freeze one complete SQLite scope in local SQLite, then emit explicit bounded
 * transactions without exposing the complete selected set to React.
 */
export async function executeLibraryCoreScopeActionV1(
  input: LibraryCoreScopeActionRequestV1,
  runtime: LibraryCoreScopeActionRuntimeV1,
): Promise<LibraryCoreScopeActionReceiptV1> {
  const request = parseLibraryCoreScopeActionRequestV1(input);
  const stageId = await runtime.beginStage(request);
  let affectedCount = 0;
  let batchCount = 0;
  try {
    await runtime.scan(async (items) => {
      let pending: string[] = [];
      for (const item of items) {
        if (!eligible(request.action, item)) continue;
        pending.push(item.globalId);
        if (pending.length === LIBRARY_CORE_SCOPE_ACTION_STAGE_APPEND_LIMIT) {
          await runtime.appendStage(stageId, Object.freeze(pending));
          pending = [];
        }
      }
      if (pending.length > 0) {
        await runtime.appendStage(stageId, Object.freeze(pending));
      }
    });
    affectedCount = await runtime.finalizeStage(stageId);
    let afterOrdinal = -1;
    for (;;) {
      const page = await runtime.readStage(stageId, afterOrdinal);
      if (page.entityIds.length === 0) break;
      if (page.entityIds.length > LIBRARY_CORE_SCOPE_ACTION_BATCH_LIMIT) {
        throw new Error(
          "Library scope action stage returned an oversized batch",
        );
      }
      await runtime.commitBatch(request.action, page.entityIds);
      batchCount += 1;
      if (page.nextOrdinal <= afterOrdinal) {
        throw new Error("Library scope action stage did not advance");
      }
      afterOrdinal = page.nextOrdinal;
    }
  } finally {
    await runtime.closeStage(stageId);
  }
  return Object.freeze({
    affectedCount,
    batchCount,
    schemaVersion: LIBRARY_CORE_SCOPE_ACTION_SCHEMA_VERSION,
  });
}
