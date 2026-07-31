import { invoke } from "@tauri-apps/api/core";
import type { FeedItem } from "@freed/shared";
import {
  reconstructFeedItem,
  type FeedItemRow,
} from "@freed/shared/projection";

import {
  getLibraryCoreProjectionSource,
} from "./automerge";
import type { LibraryCoreProjectionSourceV1 } from "./automerge-types";

const ITEM_DETAIL_QUERY_ID = "item_detail_v1";
const ITEM_DETAIL_SCHEMA_VERSION = 1;
export const LIBRARY_CORE_ITEM_DETAIL_READER_DISABLED_KEY =
  "freed.libraryCore.itemDetailReaderV1.disabled";
const ROW_KEYS = [
  "archived",
  "archivedAt",
  "authorDisplayName",
  "authorHandle",
  "authorId",
  "capturedAt",
  "contentBlob",
  "contentType",
  "globalId",
  "hidden",
  "likedAt",
  "platform",
  "preservedBlob",
  "publishedAt",
  "readAt",
  "rest",
  "saved",
  "sourceUrl",
  "tags",
] as const satisfies readonly (keyof FeedItemRow)[];
const RESPONSE_KEYS = ["item", "queryId", "schemaVersion", "source"] as const;
const SOURCE_KEYS = [
  "documentId",
  "generationId",
  "headCount",
  "headsDigest",
  "projectionRevision",
  "storageGeneration",
  "storageSaveRevision",
  "transitionSequence",
] as const;

interface NativeItemDetailSourceV1 {
  readonly documentId: string;
  readonly generationId: string;
  readonly headCount: number;
  readonly headsDigest: string;
  readonly projectionRevision: number;
  readonly storageGeneration: number;
  readonly storageSaveRevision: number;
  readonly transitionSequence: number;
}

interface NativeItemDetailResponseV1 {
  readonly item: FeedItemRow | null;
  readonly queryId: typeof ITEM_DETAIL_QUERY_ID;
  readonly schemaVersion: typeof ITEM_DETAIL_SCHEMA_VERSION;
  readonly source: NativeItemDetailSourceV1;
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
  const record = value as Record<string, unknown>;
  const ownKeys = Object.keys(record);
  if (
    ownKeys.length !== keys.length ||
    ownKeys.some((key) => !keys.includes(key))
  ) {
    return null;
  }
  return record;
}

function safeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}

function nullableString(value: unknown): value is string | null {
  return value === null || typeof value === "string";
}

function nullableSafeInteger(value: unknown): value is number | null {
  return value === null || Number.isSafeInteger(value);
}

function nullableBooleanColumn(value: unknown): value is 0 | 1 | null {
  return value === null || value === 0 || value === 1;
}

function parseRow(value: unknown, requestedId: string): FeedItemRow | null {
  const row = closedRecord(value, ROW_KEYS);
  if (
    !row ||
    row.globalId !== requestedId ||
    !nullableString(row.platform) ||
    !nullableString(row.contentType) ||
    !nullableSafeInteger(row.publishedAt) ||
    !nullableSafeInteger(row.capturedAt) ||
    !nullableString(row.authorId) ||
    !nullableString(row.authorDisplayName) ||
    !nullableString(row.authorHandle) ||
    !nullableString(row.sourceUrl) ||
    !nullableBooleanColumn(row.hidden) ||
    !nullableBooleanColumn(row.saved) ||
    !nullableBooleanColumn(row.archived) ||
    !nullableSafeInteger(row.readAt) ||
    !nullableSafeInteger(row.archivedAt) ||
    !nullableSafeInteger(row.likedAt) ||
    !nullableString(row.tags) ||
    !nullableString(row.contentBlob) ||
    !nullableString(row.preservedBlob) ||
    typeof row.rest !== "string"
  ) {
    throw new Error("Library Core item detail row is invalid");
  }
  return row as unknown as FeedItemRow;
}

function parseResponse(value: unknown, requestedId: string): NativeItemDetailResponseV1 {
  const response = closedRecord(value, RESPONSE_KEYS);
  const source = closedRecord(response?.source, SOURCE_KEYS);
  if (
    !response ||
    !source ||
    response.queryId !== ITEM_DETAIL_QUERY_ID ||
    response.schemaVersion !== ITEM_DETAIL_SCHEMA_VERSION ||
    typeof source.documentId !== "string" ||
    source.documentId.length === 0 ||
    typeof source.generationId !== "string" ||
    !/^[0-9a-f]{64}$/u.test(source.generationId) ||
    !safeInteger(source.headCount) ||
    typeof source.headsDigest !== "string" ||
    !/^[0-9a-f]{64}$/u.test(source.headsDigest) ||
    !safeInteger(source.projectionRevision) ||
    !safeInteger(source.storageGeneration) ||
    !safeInteger(source.storageSaveRevision) ||
    !safeInteger(source.transitionSequence)
  ) {
    throw new Error("Library Core item detail response is invalid");
  }
  return {
    item: response.item === null ? null : parseRow(response.item, requestedId),
    queryId: ITEM_DETAIL_QUERY_ID,
    schemaVersion: ITEM_DETAIL_SCHEMA_VERSION,
    source: source as unknown as NativeItemDetailSourceV1,
  };
}

function sourceMatches(
  current: LibraryCoreProjectionSourceV1,
  selected: NativeItemDetailSourceV1,
): boolean {
  return (
    current.documentId === selected.documentId &&
    current.headsDigest === selected.headsDigest &&
    current.headCount === selected.headCount &&
    current.storageRevision.generation === selected.storageGeneration &&
    current.storageRevision.saveRevision === selected.storageSaveRevision
  );
}

/**
 * Read one lossless item from the authenticated immutable SQLite generation.
 * Source checks on both sides of the native read prevent a stale projection
 * from being presented after an Automerge mutation or cloud merge.
 */
export async function readLibraryCoreItemDetail(
  globalId: string,
  getSource: () => Promise<LibraryCoreProjectionSourceV1> =
    getLibraryCoreProjectionSource,
  readNative: (request: {
    globalId: string;
    queryId: typeof ITEM_DETAIL_QUERY_ID;
    schemaVersion: typeof ITEM_DETAIL_SCHEMA_VERSION;
  }) => Promise<unknown> = (request) =>
    invoke("read_library_core_item_detail", { request }),
): Promise<FeedItem | null> {
  if (
    typeof localStorage !== "undefined" &&
    localStorage.getItem(LIBRARY_CORE_ITEM_DETAIL_READER_DISABLED_KEY) === "1"
  ) {
    throw new Error("Library Core item detail reader is disabled");
  }
  if (!globalId || new TextEncoder().encode(globalId).length > 4_096) {
    throw new Error("Library Core item identity is invalid");
  }
  const before = await getSource();
  const response = parseResponse(
    await readNative({
      globalId,
      queryId: ITEM_DETAIL_QUERY_ID,
      schemaVersion: ITEM_DETAIL_SCHEMA_VERSION,
    }),
    globalId,
  );
  if (!sourceMatches(before, response.source)) {
    throw new Error("Library Core item detail source is stale");
  }
  const after = await getSource();
  if (!sourceMatches(after, response.source)) {
    throw new Error("Library Core item detail source changed during read");
  }
  if (response.item === null) return null;
  return reconstructFeedItem(response.item) as unknown as FeedItem;
}
