import type { Highlight } from "../types.js";
import { SAVED_ITEM_NOTE_MARKER } from "../saved-item-note.js";
import { decodeLibraryCoreCanonicalBase64 } from "./canonical-base64.js";
import { type LibraryCoreItemAnnotationsResponseV1, parseLibraryCoreItemAnnotationsResponseV1 } from "./item-annotations-contracts.js";
import { ANNOTATION_TEXT_AGGREGATE_BYTES, ANNOTATION_TEXT_MAXIMUM_BYTES, sameAnnotationSource, type LibraryCoreAnnotationTextState } from "./item-annotation-text-contracts.js";
import type { LibraryCoreNormalizedQueryExecutor } from "./normalized-feed-readers.js";
import { canonicalizeFeedItemHighlightsV1, canonicalizeFeedItemTagsV1, FEED_ITEM_ANNOTATIONS_REPLACE_PAYLOAD_SCHEMA } from "./operation-payload-contracts.js";

export interface LibraryCoreHydratedAnnotations {
  readonly originals: LibraryCoreItemAnnotationsResponseV1;
  readonly state: LibraryCoreAnnotationTextState | "stale";
  readonly highlights: readonly Highlight[] | null;
}
/** A failed selection retains canonical evidence but never offers a partial replacement. */
export class LibraryCoreAnnotationHydrationError extends Error {
  readonly snapshot: LibraryCoreHydratedAnnotations;
  constructor(snapshot: LibraryCoreHydratedAnnotations) {
    super(`Annotation text is ${snapshot.state}; saved annotations have not changed`);
    this.name = "LibraryCoreAnnotationHydrationError";
    this.snapshot = snapshot;
  }
}
export async function hydrateLibraryCoreAnnotations(query: LibraryCoreNormalizedQueryExecutor, input: LibraryCoreItemAnnotationsResponseV1): Promise<LibraryCoreHydratedAnnotations> {
  const parsed = parseLibraryCoreItemAnnotationsResponseV1(input, { queryId: "item_annotations_v1", schemaVersion: 1, globalId: input.globalId });
  if (!parsed.ok) throw new TypeError(parsed.error);
  const originals = parsed.value;
  const failure = (state: LibraryCoreHydratedAnnotations["state"]): LibraryCoreHydratedAnnotations => Object.freeze({ originals, state, highlights: null });
  const highlights: Highlight[] = [];
  let total = 0;
  let hydrated = false;
  for (let index = 0; index < originals.highlights.length; index += 1) {
    const row = originals.highlights[index]!;
    let text = row.text;
    if (text === null) {
      let result;
      try { result = await query({ queryId: "item_annotation_text_range_v1", schemaVersion: 1, globalId: originals.globalId, annotationIndex: index, expectedSource: originals.source, offsetBytes: 0, limitBytes: ANNOTATION_TEXT_MAXIMUM_BYTES }); }
      catch { return failure("unavailable"); }
      if (!sameAnnotationSource(result.source, originals.source)) return failure("stale");
      if (result.state !== "ready") return failure(result.state);
      if (!result.text || result.text.blobDigest !== row.textBlobDigest || result.text.startOffset !== 0 || result.text.endOffset !== result.text.contentLength) return failure("corrupt");
      try { text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(decodeLibraryCoreCanonicalBase64(result.text.bytesBase64)); } catch { return failure("invalid_text"); }
      hydrated = true;
    }
    const length = new TextEncoder().encode(text).length;
    if (length === 0) return failure("invalid_text");
    total += length;
    if (length > ANNOTATION_TEXT_MAXIMUM_BYTES || total > ANNOTATION_TEXT_AGGREGATE_BYTES) return failure("oversized");
    highlights.push(Object.freeze({ createdAt: row.createdAt, text, ...(row.note === null ? {} : { note: row.note }) }));
  }
  if (new TextEncoder().encode(JSON.stringify(highlights)).length > 1_048_576) return failure("oversized");
  if (hydrated) {
    try {
      const current = await query({ queryId: "item_annotations_v1", schemaVersion: 1, globalId: originals.globalId });
      if (!sameAnnotationSource(current.source, originals.source)) return failure("stale");
    } catch { return failure("unavailable"); }
  }
  return Object.freeze({ originals, state: "ready", highlights: Object.freeze(highlights) });
}

/** Existing note edits retain every quote's canonical representation and ordering. */
export function replaceHydratedSavedNote(snapshot: LibraryCoreHydratedAnnotations, note: string, assignedAtMs: number) {
  if (snapshot.state !== "ready" || !snapshot.highlights || snapshot.highlights.length !== snapshot.originals.highlights.length) throw new LibraryCoreAnnotationHydrationError(snapshot);
  const highlights = snapshot.originals.highlights.filter((_, index) => snapshot.highlights![index]!.text !== SAVED_ITEM_NOTE_MARKER);
  if (note.length > 0) highlights.push(Object.freeze({ createdAt: assignedAtMs, text: SAVED_ITEM_NOTE_MARKER, textBlobDigest: null, note }));
  const payload = FEED_ITEM_ANNOTATIONS_REPLACE_PAYLOAD_SCHEMA.validate({ assigned_at_ms: assignedAtMs, highlights, tags: snapshot.originals.tags });
  if (!payload.ok) throw new TypeError(payload.reason);
  return payload.value;
}


/** Preserve the canonical representation of unchanged quotes in complete replacements. */
export function assembleHydratedAnnotationReplacement(
  snapshot: LibraryCoreHydratedAnnotations,
  input: readonly Highlight[],
  tags: readonly string[],
  assignedAtMs: number,
) {
  if (snapshot.state !== "ready" || !snapshot.highlights) throw new LibraryCoreAnnotationHydrationError(snapshot);
  const used = new Set<number>();
  const highlights = canonicalizeFeedItemHighlightsV1(input).map(row => {
    const index = snapshot.highlights!.findIndex((old, index) =>
      !used.has(index) && old.createdAt === row.createdAt && old.text === row.text);
    if (index < 0) return row;
    used.add(index);
    return Object.freeze({ ...snapshot.originals.highlights[index]!, note: row.note });
  });
  // Existing generic callers cannot prove that an absent digest-backed quote
  // means an intentional deletion. Fail closed until an explicit edit API does.
  if (snapshot.originals.highlights.some((row, index) => row.textBlobDigest !== null &&
      !used.has(index) && snapshot.highlights![index]!.text !== SAVED_ITEM_NOTE_MARKER)) {
    throw new Error("Annotation replacement omits an authenticated quote; reopen the item");
  }
  const payload = FEED_ITEM_ANNOTATIONS_REPLACE_PAYLOAD_SCHEMA.validate({
    assigned_at_ms: assignedAtMs, highlights, tags: canonicalizeFeedItemTagsV1(tags),
  });
  if (!payload.ok) throw new TypeError(payload.reason);
  return payload.value;
}
