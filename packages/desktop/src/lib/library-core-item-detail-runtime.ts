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
const ITEM_SCAN_QUERY_ID = "background_item_page_v1";
const ITEM_DETAIL_SCHEMA_VERSION = 1;
const ITEM_SCAN_PAGE_LIMIT = 64;
const MAXIMUM_ITEM_SCAN_PAGES = 4_096;
let activeItemScan: Promise<void> | null = null;
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
const ITEM_SCAN_RESPONSE_KEYS = [
  "nextCursor",
  "queryId",
  "rows",
  "schemaVersion",
  "source",
] as const;
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

interface NativeItemScanResponseV1 {
  readonly nextCursor: string | null;
  readonly queryId: typeof ITEM_SCAN_QUERY_ID;
  readonly rows: FeedItemRow[];
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

function parseRow(value: unknown, requestedId?: string): FeedItemRow {
  const row = closedRecord(value, ROW_KEYS);
  if (
    !row ||
    typeof row.globalId !== "string" ||
    row.globalId.length === 0 ||
    new TextEncoder().encode(row.globalId).length > 4_096 ||
    (requestedId !== undefined && row.globalId !== requestedId) ||
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

function parseItemScanResponse(value: unknown): NativeItemScanResponseV1 {
  const response = closedRecord(value, ITEM_SCAN_RESPONSE_KEYS);
  const source = closedRecord(response?.source, SOURCE_KEYS);
  if (
    !response ||
    !source ||
    response.queryId !== ITEM_SCAN_QUERY_ID ||
    response.schemaVersion !== ITEM_DETAIL_SCHEMA_VERSION ||
    !nullableString(response.nextCursor) ||
    (typeof response.nextCursor === "string" && response.nextCursor.length === 0) ||
    !Array.isArray(response.rows) ||
    response.rows.length > ITEM_SCAN_PAGE_LIMIT ||
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
    throw new Error("Library Core item scan response is invalid");
  }
  const rows = response.rows.map((row) => parseRow(row));
  return {
    nextCursor: response.nextCursor,
    queryId: ITEM_SCAN_QUERY_ID,
    rows,
    schemaVersion: ITEM_DETAIL_SCHEMA_VERSION,
    source: source as unknown as NativeItemDetailSourceV1,
  };
}

function sameSelectedSource(
  left: NativeItemDetailSourceV1,
  right: NativeItemDetailSourceV1,
): boolean {
  return SOURCE_KEYS.every((key) => left[key] === right[key]);
}

function newReaderOperationId(prefix: string): string {
  return `${prefix}:${crypto.randomUUID()}`;
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

/**
 * Stream every lossless item from one authenticated immutable SQLite
 * generation. At most one native page and one reconstructed page are retained
 * at a time, so background maintenance cost is independent of Library size.
 */
async function scanLibraryCoreItemsExclusive(
  visitPage: (items: readonly FeedItem[]) => void | Promise<void>,
  getSource: () => Promise<LibraryCoreProjectionSourceV1> =
    getLibraryCoreProjectionSource,
  readNative: (request: {
    cancellationId: string;
    cursor: string | null;
    limit: number;
    queryId: typeof ITEM_SCAN_QUERY_ID;
    readerSessionId: string;
    schemaVersion: typeof ITEM_DETAIL_SCHEMA_VERSION;
  }) => Promise<unknown> = (request) =>
    invoke("read_library_core_item_scan_page", { request }),
  cancelNative: (
    readerSessionId: string,
    cancellationId: string,
  ) => Promise<unknown> = (readerSessionId, cancellationId) =>
    invoke("cancel_library_core_feed_reader", {
      readerSessionId,
      cancellationId,
    }),
): Promise<void> {
  if (
    typeof localStorage !== "undefined" &&
    localStorage.getItem(LIBRARY_CORE_ITEM_DETAIL_READER_DISABLED_KEY) === "1"
  ) {
    throw new Error("Library Core item scan reader is disabled");
  }
  const before = await getSource();
  const readerSessionId = newReaderOperationId("item-scan-reader");
  let cursor: string | null = null;
  let selectedSource: NativeItemDetailSourceV1 | null = null;
  let previousGlobalId: string | null = null;
  let lastCompletedCancellationId: string | null = null;
  let exhausted = false;
  try {
    for (let pageNumber = 0; pageNumber < MAXIMUM_ITEM_SCAN_PAGES; pageNumber += 1) {
      const cancellationId = newReaderOperationId("item-scan-page");
      const rawResponse = await readNative({
        cancellationId,
        cursor,
        limit: ITEM_SCAN_PAGE_LIMIT,
        queryId: ITEM_SCAN_QUERY_ID,
        readerSessionId,
        schemaVersion: ITEM_DETAIL_SCHEMA_VERSION,
      });
      lastCompletedCancellationId = cancellationId;
      const response = parseItemScanResponse(rawResponse);
      if (!sourceMatches(before, response.source)) {
        throw new Error("Library Core item scan source is stale");
      }
      if (selectedSource && !sameSelectedSource(selectedSource, response.source)) {
        throw new Error("Library Core item scan generation changed");
      }
      selectedSource ??= response.source;
      for (const row of response.rows) {
        if (previousGlobalId !== null && row.globalId <= previousGlobalId) {
          throw new Error("Library Core item scan order is invalid");
        }
        previousGlobalId = row.globalId;
      }
      if (response.rows.length === 0 && response.nextCursor !== null) {
        throw new Error("Library Core item scan cursor made no progress");
      }
      await visitPage(
        response.rows.map(
          (row) => reconstructFeedItem(row) as unknown as FeedItem,
        ),
      );
      if (response.nextCursor === null) {
        const after = await getSource();
        if (!sourceMatches(after, response.source)) {
          throw new Error("Library Core item scan source changed during read");
        }
        exhausted = true;
        return;
      }
      if (response.nextCursor === cursor) {
        throw new Error("Library Core item scan cursor repeated");
      }
      cursor = response.nextCursor;
    }
    throw new Error("Library Core item scan exceeded its page bound");
  } finally {
    if (!exhausted && lastCompletedCancellationId !== null) {
      await cancelNative(readerSessionId, lastCompletedCancellationId).catch(() => undefined);
    }
  }
}

export async function scanLibraryCoreItems(
  visitPage: (items: readonly FeedItem[]) => void | Promise<void>,
  getSource: () => Promise<LibraryCoreProjectionSourceV1> =
    getLibraryCoreProjectionSource,
  readNative?: Parameters<typeof scanLibraryCoreItemsExclusive>[2],
  cancelNative?: Parameters<typeof scanLibraryCoreItemsExclusive>[3],
): Promise<void> {
  while (activeItemScan !== null) {
    try {
      await activeItemScan;
    } catch {
      // A failed prior consumer must not prevent the next bounded scan.
    }
  }

  const current = scanLibraryCoreItemsExclusive(
    visitPage,
    getSource,
    readNative,
    cancelNative,
  );
  activeItemScan = current;
  try {
    await current;
  } finally {
    if (activeItemScan === current) activeItemScan = null;
  }
}
