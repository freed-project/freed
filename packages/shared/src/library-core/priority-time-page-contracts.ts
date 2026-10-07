import { parseLibraryCoreFeedPageSourceV1, type LibraryCoreFeedPageParseResult } from "./feed-page-contracts.js";
import { parseLibraryCoreItemScanRequestV1, parseLibraryCoreItemScanResponseV1, type LibraryCoreItemScanRequestV1, type LibraryCoreItemScanResponseV1 } from "./item-scan-contracts.js";

export const LIBRARY_CORE_PRIORITY_TIME_QUERY_ID = "priority_time_page_v1" as const;
/** Admission envelope measured against the existing priority refresh index. */
export const LIBRARY_CORE_PRIORITY_TIME_MAXIMUM_CORPUS = 25_000;

export interface LibraryCorePriorityTimePageRequestV1 {
  readonly queryId: typeof LIBRARY_CORE_PRIORITY_TIME_QUERY_ID;
  readonly schemaVersion: 1;
  readonly cancellationId: string;
  readonly readerSessionId: string;
  readonly limit: number;
  readonly priorityComputedBeforeMs: number;
  readonly generationId: string;
  readonly sourceRevision: number;
}
export type LibraryCorePriorityTimePageResponseV1 = Omit<LibraryCoreItemScanResponseV1, "queryId"> & {
  readonly queryId: typeof LIBRARY_CORE_PRIORITY_TIME_QUERY_ID;
};

/** Reuse the bounded metadata codec, never its cursor traversal. */
export function priorityTimeItemScanRequest(request: LibraryCorePriorityTimePageRequestV1): LibraryCoreItemScanRequestV1 {
  return { analysisVersion: null, cancellationId: request.cancellationId, cursor: null,
    limit: request.limit, priorityComputedBeforeMs: request.priorityComputedBeforeMs,
    queryId: "background_item_page_v1", readerSessionId: request.readerSessionId, schemaVersion: 1 };
}

export function parseLibraryCorePriorityTimePageRequestV1(input: unknown): LibraryCoreFeedPageParseResult<LibraryCorePriorityTimePageRequestV1> {
  const keys = ["queryId", "schemaVersion", "cancellationId", "readerSessionId", "limit", "priorityComputedBeforeMs", "generationId", "sourceRevision"];
  if (!input || typeof input !== "object" || Object.getPrototypeOf(input) !== Object.prototype) return { ok: false, error: "priority time request is invalid" };
  const own = Reflect.ownKeys(input), descriptors = Object.getOwnPropertyDescriptors(input);
  if (own.length !== keys.length || own.some(key => typeof key !== "string" || !keys.includes(key)) ||
    keys.some(key => !descriptors[key]?.enumerable || !("value" in descriptors[key]!))) return { ok: false, error: "priority time request is invalid" };
  const value = input as LibraryCorePriorityTimePageRequestV1;
  const scan = parseLibraryCoreItemScanRequestV1(priorityTimeItemScanRequest(value));
  const source = parseLibraryCoreFeedPageSourceV1({ generationId: value.generationId,
    projectionRevision: value.sourceRevision, transitionSequence: value.sourceRevision });
  if (value.queryId !== LIBRARY_CORE_PRIORITY_TIME_QUERY_ID || value.schemaVersion !== 1 ||
    value.priorityComputedBeforeMs === null || !scan.ok || !source.ok) return { ok: false, error: "priority time request is invalid" };
  return { ok: true, value: Object.freeze({ ...value }) };
}

export function parseLibraryCorePriorityTimePageResponseV1(input: unknown, request: LibraryCorePriorityTimePageRequestV1): LibraryCoreFeedPageParseResult<LibraryCorePriorityTimePageResponseV1> {
  const checked = parseLibraryCorePriorityTimePageRequestV1(request);
  if (!checked.ok) return checked;
  if (!input || typeof input !== "object" || Object.getPrototypeOf(input) !== Object.prototype ||
    Object.getOwnPropertyDescriptor(input, "queryId")?.value !== LIBRARY_CORE_PRIORITY_TIME_QUERY_ID) return { ok: false, error: "priority time response is invalid" };
  const descriptors = Object.getOwnPropertyDescriptors(input);
  // Inspect descriptors before copying to keep accessors outside the wire codec.
  if (Reflect.ownKeys(input).some(key => typeof key !== "string" || !descriptors[key]?.enumerable || !("value" in descriptors[key]!))) return { ok: false, error: "priority time response is invalid" };
  const parsed = parseLibraryCoreItemScanResponseV1({ ...input, queryId: "background_item_page_v1" }, priorityTimeItemScanRequest(checked.value));
  if (!parsed.ok) return parsed;
  if (parsed.value.source.generationId !== checked.value.generationId ||
    parsed.value.source.projectionRevision !== checked.value.sourceRevision ||
    parsed.value.source.transitionSequence !== checked.value.sourceRevision) return { ok: false, error: "CURSOR_STALE" };
  return { ok: true, value: Object.freeze({ ...parsed.value, queryId: LIBRARY_CORE_PRIORITY_TIME_QUERY_ID }) };
}
