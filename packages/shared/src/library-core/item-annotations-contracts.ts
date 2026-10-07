import {
  parseLibraryCoreFeedPageSourceV1,
  type LibraryCoreFeedPageSourceV1,
  type LibraryCoreFeedPageParseResult,
} from "./feed-page-contracts.js";
import { parseLibraryCoreItemDetailRequestV1 } from "./item-detail-contracts.js";
import {
  FEED_ITEM_ANNOTATIONS_REPLACE_PAYLOAD_SCHEMA,
  type FeedItemAnnotationsReplacePayloadV1,
} from "./operation-payload-contracts.js";

export interface LibraryCoreItemAnnotationsRequestV1 {
  readonly globalId: string;
  readonly queryId: "item_annotations_v1";
  readonly schemaVersion: 1;
}

export interface LibraryCoreItemAnnotationsResponseV1 {
  readonly globalId: string;
  readonly highlights: FeedItemAnnotationsReplacePayloadV1["highlights"];
  readonly queryId: "item_annotations_v1";
  readonly schemaVersion: 1;
  readonly source: LibraryCoreFeedPageSourceV1;
  readonly tags: readonly string[];
}

function closed(
  value: unknown,
  keys: readonly string[],
): value is Record<string, unknown> {
  if (
    !value ||
    typeof value !== "object" ||
    Object.getPrototypeOf(value) !== Object.prototype
  )
    return false;
  const ownKeys = Reflect.ownKeys(value);
  return (
    ownKeys.length === keys.length &&
    ownKeys.every((key) => typeof key === "string" && keys.includes(key)) &&
    keys.every((key) => {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      return descriptor?.enumerable === true && "value" in descriptor;
    })
  );
}

/** Read at most 64 annotations for one item without expanding its feed card. */
export function parseLibraryCoreItemAnnotationsRequestV1(
  value: unknown,
): LibraryCoreFeedPageParseResult<LibraryCoreItemAnnotationsRequestV1> {
  if (
    !closed(value, ["globalId", "queryId", "schemaVersion"]) ||
    value.queryId !== "item_annotations_v1"
  ) {
    return { ok: false, error: "item annotations request is invalid" };
  }
  const parsed = parseLibraryCoreItemDetailRequestV1({
    ...value,
    queryId: "item_detail_v1",
  });
  return parsed.ok
    ? {
        ok: true,
        value: Object.freeze({
          ...parsed.value,
          queryId: "item_annotations_v1",
        }),
      }
    : parsed;
}

/** Validate the exact identity, source fence, and existing annotation bounds. */
export function parseLibraryCoreItemAnnotationsResponseV1(
  value: unknown,
  request: LibraryCoreItemAnnotationsRequestV1,
): LibraryCoreFeedPageParseResult<LibraryCoreItemAnnotationsResponseV1> {
  if (
    !closed(value, [
      "globalId",
      "highlights",
      "queryId",
      "schemaVersion",
      "source",
      "tags",
    ]) ||
    value.globalId !== request.globalId ||
    value.queryId !== request.queryId ||
    value.schemaVersion !== 1
  ) {
    return { ok: false, error: "item annotations response is invalid" };
  }
  const source = parseLibraryCoreFeedPageSourceV1(value.source);
  const annotations = FEED_ITEM_ANNOTATIONS_REPLACE_PAYLOAD_SCHEMA.validate({
    assigned_at_ms: 0,
    highlights: value.highlights,
    tags: value.tags,
  });
  if (
    !source.ok ||
    !annotations.ok ||
    new TextEncoder().encode(JSON.stringify(value)).length > 1_048_576
  ) {
    return {
      ok: false,
      error: "item annotations response exceeds its contract",
    };
  }
  return {
    ok: true,
    value: Object.freeze({
      globalId: request.globalId,
      highlights: annotations.value.highlights,
      queryId: "item_annotations_v1",
      schemaVersion: 1,
      source: source.value,
      tags: annotations.value.tags,
    }),
  };
}

/** Device-local exclusion is separate from the canonical annotation snapshot. */
export interface LibraryCoreItemAnnotationEditStateRequestV1 {
  readonly globalId: string;
  readonly queryId: "item_annotation_edit_state_v1";
  readonly schemaVersion: 1;
}
export interface LibraryCoreItemAnnotationEditStateResponseV1 extends LibraryCoreItemAnnotationEditStateRequestV1 {
  readonly source: LibraryCoreFeedPageSourceV1;
  readonly localSequence: number;
  readonly pending: boolean;
}
export function parseLibraryCoreItemAnnotationEditStateRequestV1(value: unknown): LibraryCoreFeedPageParseResult<LibraryCoreItemAnnotationEditStateRequestV1> {
  if (!closed(value, ["globalId", "queryId", "schemaVersion"]) || value.queryId !== "item_annotation_edit_state_v1") return { ok: false, error: "annotation edit state request is invalid" };
  const parsed = parseLibraryCoreItemDetailRequestV1({ ...value, queryId: "item_detail_v1" });
  return parsed.ok ? { ok: true, value: Object.freeze({ ...parsed.value, queryId: "item_annotation_edit_state_v1" }) } : parsed;
}
export function parseLibraryCoreItemAnnotationEditStateResponseV1(value: unknown, request: LibraryCoreItemAnnotationEditStateRequestV1): LibraryCoreFeedPageParseResult<LibraryCoreItemAnnotationEditStateResponseV1> {
  if (!closed(value, ["globalId", "queryId", "schemaVersion", "source", "localSequence", "pending"]) || value.globalId !== request.globalId || value.queryId !== request.queryId || value.schemaVersion !== 1 || typeof value.pending !== "boolean" || typeof value.localSequence !== "number" || !Number.isSafeInteger(value.localSequence) || value.localSequence < 0) return { ok: false, error: "annotation edit state response is invalid" };
  const source = parseLibraryCoreFeedPageSourceV1(value.source);
  return source.ok ? { ok: true, value: Object.freeze({ ...request, source: source.value, localSequence: value.localSequence, pending: value.pending }) } : source;
}
