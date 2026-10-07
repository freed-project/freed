import { decodeLibraryCoreCanonicalBase64 } from "./canonical-base64.js";
import { parseLibraryCoreFeedPageSourceV1, type LibraryCoreFeedPageSourceV1, type LibraryCoreFeedPageParseResult } from "./feed-page-contracts.js";
import { isLibraryCoreEntityId, isLibraryCoreLowercaseHex64, isLibraryCoreNonnegativeSafeInteger } from "./protocol-scalars.js";

export const ANNOTATION_TEXT_MAXIMUM_BYTES = 65_536;
export const ANNOTATION_TEXT_AGGREGATE_BYTES = 524_288;
export const ANNOTATION_TEXT_MAXIMUM_RANGES = 64;
export type LibraryCoreAnnotationTextState = "ready" | "missing" | "unavailable" | "excluded" | "corrupt" | "oversized" | "invalid_text";
export interface LibraryCoreItemAnnotationTextRequestV1 {
  readonly queryId: "item_annotation_text_range_v1";
  readonly schemaVersion: 1;
  readonly globalId: string;
  readonly annotationIndex: number;
  readonly expectedSource: LibraryCoreFeedPageSourceV1;
  readonly offsetBytes: number;
  readonly limitBytes: number;
}
export interface LibraryCoreItemAnnotationTextResponseV1 {
  readonly queryId: "item_annotation_text_range_v1";
  readonly schemaVersion: 1;
  readonly globalId: string;
  readonly annotationIndex: number;
  readonly source: LibraryCoreFeedPageSourceV1;
  readonly state: LibraryCoreAnnotationTextState;
  readonly text: null | Readonly<{ blobDigest: string | null; contentLength: number; startOffset: number; endOffset: number; bytesBase64: string }>;
}
function closed(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Object.getPrototypeOf(value) !== Object.prototype) return false;
  return Reflect.ownKeys(value).length === keys.length && keys.every(key => {
    const field = Object.getOwnPropertyDescriptor(value, key);
    return field?.enumerable === true && "value" in field;
  });
}
export function sameAnnotationSource(a: Readonly<{ generationId: string; projectionRevision: number; transitionSequence: number }>, b: Readonly<{ generationId: string; projectionRevision: number; transitionSequence: number }>): boolean {
  return a.generationId === b.generationId && a.projectionRevision === b.projectionRevision && a.transitionSequence === b.transitionSequence;
}
export function parseLibraryCoreItemAnnotationTextRequestV1(value: unknown): LibraryCoreFeedPageParseResult<LibraryCoreItemAnnotationTextRequestV1> {
  const invalid = { ok: false as const, error: "annotation text request is invalid" };
  if (!closed(value, ["queryId", "schemaVersion", "globalId", "annotationIndex", "expectedSource", "offsetBytes", "limitBytes"]) || value.queryId !== "item_annotation_text_range_v1" || value.schemaVersion !== 1 || !isLibraryCoreEntityId(value.globalId) || new TextEncoder().encode(value.globalId).length > 2_048 || !isLibraryCoreNonnegativeSafeInteger(value.annotationIndex) || value.annotationIndex >= 64 || !isLibraryCoreNonnegativeSafeInteger(value.offsetBytes) || value.offsetBytes > ANNOTATION_TEXT_MAXIMUM_BYTES || !isLibraryCoreNonnegativeSafeInteger(value.limitBytes) || value.limitBytes < 1 || value.limitBytes > ANNOTATION_TEXT_MAXIMUM_BYTES) return invalid;
  const source = parseLibraryCoreFeedPageSourceV1(value.expectedSource);
  if (!source.ok) return invalid;
  return { ok: true, value: Object.freeze({ queryId: value.queryId, schemaVersion: 1, globalId: value.globalId, annotationIndex: value.annotationIndex, expectedSource: source.value, offsetBytes: value.offsetBytes, limitBytes: value.limitBytes }) };
}
export function parseLibraryCoreItemAnnotationTextResponseV1(value: unknown, request: LibraryCoreItemAnnotationTextRequestV1): LibraryCoreFeedPageParseResult<LibraryCoreItemAnnotationTextResponseV1> {
  const invalid = { ok: false as const, error: "annotation text response is invalid" };
  if (!closed(value, ["queryId", "schemaVersion", "globalId", "annotationIndex", "source", "state", "text"]) || value.queryId !== request.queryId || value.schemaVersion !== 1 || value.globalId !== request.globalId || value.annotationIndex !== request.annotationIndex) return invalid;
  const source = parseLibraryCoreFeedPageSourceV1(value.source);
  if (!source.ok || !sameAnnotationSource(source.value, request.expectedSource)) return invalid;
  if (!["ready", "missing", "unavailable", "excluded", "corrupt", "oversized", "invalid_text"].includes(value.state as string)) return invalid;
  const state = value.state as LibraryCoreAnnotationTextState;
  let text: LibraryCoreItemAnnotationTextResponseV1["text"] = null;
  if (state === "ready") {
    const row = value.text;
    if (!closed(row, ["blobDigest", "contentLength", "startOffset", "endOffset", "bytesBase64"]) || (row.blobDigest !== null && !isLibraryCoreLowercaseHex64(row.blobDigest)) || !isLibraryCoreNonnegativeSafeInteger(row.contentLength) || row.contentLength < 1 || row.contentLength > ANNOTATION_TEXT_MAXIMUM_BYTES || row.startOffset !== request.offsetBytes || request.offsetBytes > row.contentLength || row.endOffset !== Math.min(row.contentLength, request.offsetBytes + request.limitBytes) || typeof row.bytesBase64 !== "string" || row.bytesBase64.length > 87_384) return invalid;
    try { if (decodeLibraryCoreCanonicalBase64(row.bytesBase64).length !== Number(row.endOffset) - request.offsetBytes) return invalid; } catch { return invalid; }
    text = Object.freeze({ blobDigest: row.blobDigest as string | null, contentLength: row.contentLength, startOffset: request.offsetBytes, endOffset: Number(row.endOffset), bytesBase64: row.bytesBase64 });
  } else if (value.text !== null) return invalid;
  if (new TextEncoder().encode(JSON.stringify(value)).length > 131_072) return invalid;
  return { ok: true, value: Object.freeze({ queryId: request.queryId, schemaVersion: 1, globalId: request.globalId, annotationIndex: request.annotationIndex, source: source.value, state, text }) };
}
