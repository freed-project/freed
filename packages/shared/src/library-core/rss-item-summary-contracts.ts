import {
  parseLibraryCoreFeedPageSourceV1,
  type LibraryCoreFeedPageSourceV1,
  type LibraryCoreFeedPageParseResult,
} from "./feed-page-contracts.js";

export interface LibraryCoreRssItemSummaryRequestV1 {
  readonly queryId: "rss_item_summary_v1";
  readonly schemaVersion: 1;
}
export interface LibraryCoreRssItemSummaryResponseV1
  extends LibraryCoreRssItemSummaryRequestV1 {
  readonly source: LibraryCoreFeedPageSourceV1;
  readonly totalCount: number;
  readonly unreadCount: number;
}

function closed(
  value: unknown,
  keys: readonly string[],
): value is Record<string, unknown> {
  if (
    !value ||
    typeof value !== "object" ||
    Object.getPrototypeOf(value) !== Object.prototype ||
    Reflect.ownKeys(value).length !== keys.length
  )
    return false;
  return keys.every((key) => {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    return descriptor?.enumerable === true && "value" in descriptor;
  });
}

/** Validate the parameter-free RSS navigation aggregate. */
export function parseLibraryCoreRssItemSummaryRequestV1(
  value: unknown,
): LibraryCoreFeedPageParseResult<LibraryCoreRssItemSummaryRequestV1> {
  return closed(value, ["queryId", "schemaVersion"]) &&
    value.queryId === "rss_item_summary_v1" &&
    value.schemaVersion === 1
    ? {
        ok: true,
        value: Object.freeze({
          queryId: "rss_item_summary_v1",
          schemaVersion: 1,
        }),
      }
    : { ok: false, error: "RSS summary request is invalid" };
}

/** Keep overlapping RSS navigation counts separate from disjoint provider totals. */
export function parseLibraryCoreRssItemSummaryResponseV1(
  value: unknown,
): LibraryCoreFeedPageParseResult<LibraryCoreRssItemSummaryResponseV1> {
  if (
    !closed(value, [
      "queryId",
      "schemaVersion",
      "source",
      "totalCount",
      "unreadCount",
    ])
  )
    return { ok: false, error: "RSS summary response is invalid" };
  const source = parseLibraryCoreFeedPageSourceV1(value.source);
  if (
    !source.ok ||
    value.queryId !== "rss_item_summary_v1" ||
    value.schemaVersion !== 1 ||
    !Number.isSafeInteger(value.totalCount) ||
    !Number.isSafeInteger(value.unreadCount) ||
    (value.unreadCount as number) < 0 ||
    (value.totalCount as number) < (value.unreadCount as number)
  ) {
    return { ok: false, error: "RSS summary counts or source are invalid" };
  }
  return {
    ok: true,
    value: Object.freeze({
      queryId: "rss_item_summary_v1",
      schemaVersion: 1,
      source: source.value,
      totalCount: value.totalCount as number,
      unreadCount: value.unreadCount as number,
    }),
  };
}
