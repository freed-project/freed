import { describe, expect, it } from "vitest";
import { parseLibraryCoreItemAnnotationTextRequestV1, parseLibraryCoreItemAnnotationTextResponseV1 } from "./item-annotation-text-contracts.js";
import { assembleHydratedAnnotationReplacement, hydrateLibraryCoreAnnotations, replaceHydratedSavedNote, retainRenderedAnnotationSnapshot, assertLibraryCoreAnnotationEditEligible } from "./annotation-hydration.js";
import { encodeLibraryCoreCanonicalBase64 } from "./canonical-base64.js";
import { parseLibraryCoreItemAnnotationsResponseV1 } from "./item-annotations-contracts.js";
import { digestLibraryCoreMediaBlobBytesV1 } from "./media-blob-transport-contracts.js";
import type { LibraryCoreNormalizedQueryExecutor } from "./normalized-feed-readers.js";
const source = { generationId: "a".repeat(64), projectionRevision: 7, transitionSequence: 7 };
const raw = { queryId: "item_annotation_text_range_v1", schemaVersion: 1, globalId: "item", annotationIndex: 0, expectedSource: source, offsetBytes: 0, limitBytes: 65_536 };
const parsed = parseLibraryCoreItemAnnotationTextRequestV1(raw);
if (!parsed.ok) throw new Error(parsed.error);
const request = parsed.value;
const quote = "\ufeffA\r\ne\u0301\0🦉";
const bytes = new TextEncoder().encode(quote);
const digest = digestLibraryCoreMediaBlobBytesV1(bytes);
const response = { queryId: request.queryId, schemaVersion: 1, globalId: "item", annotationIndex: 0, source: request.expectedSource, state: "ready", text: { blobDigest: digest, contentLength: bytes.length, startOffset: 0, endOffset: bytes.length, bytesBase64: encodeLibraryCoreCanonicalBase64(bytes) } } as const;
function originals(count = 1) {
  const req = { queryId: "item_annotations_v1", schemaVersion: 1, globalId: "item" } as const;
  const parsed = parseLibraryCoreItemAnnotationsResponseV1({ ...req, source, tags: ["keep"], highlights: Array.from({ length: count }, () => ({ createdAt: 1, text: null, textBlobDigest: digest, note: "original" })) }, req);
  if (!parsed.ok) throw new Error(parsed.error);
  return parsed.value;
}
describe("authenticated annotation boundary", () => {
  it("binds exact identity, source, offsets and closed fields", () => {
    expect(parseLibraryCoreItemAnnotationTextResponseV1(response, request).ok).toBe(true);
    for (const change of [{ annotationIndex: 1 }, { globalId: "other" }, { source: { ...source, transitionSequence: 8 } }, { extra: 1 }, { text: { ...response.text, endOffset: 1 } }, { text: { ...response.text, bytesBase64: "!!!!" } }, { state: "corrupt" }]) expect(parseLibraryCoreItemAnnotationTextResponseV1({ ...response, ...change }, request).ok).toBe(false);
    for (const change of [{ annotationIndex: 64 }, { offsetBytes: -1 }, { limitBytes: 65_537 }, { limitBytes: 1.5 }, { schemaVersion: 2 }, { storageKey: "arbitrary" }]) expect(parseLibraryCoreItemAnnotationTextRequestV1({ ...raw, ...change }).ok).toBe(false);
    expect(parseLibraryCoreItemAnnotationTextRequestV1(Object.defineProperty({ ...raw }, "globalId", { get: () => { throw new Error("accessor called"); } })).ok).toBe(false);
  });
  it("retains exact text and canonical digest through existing note edits", async () => {
    const original = originals(2), before = JSON.stringify(original);
    const query = (async (r: { queryId: string; annotationIndex?: number }) => r.queryId === "item_annotation_edit_state_v1" ? { queryId: r.queryId, schemaVersion: 1, globalId: "item", source, pending: false, localSequence: 0 } : r.queryId === "item_annotations_v1" ? original : { ...response, annotationIndex: r.annotationIndex }) as LibraryCoreNormalizedQueryExecutor;
    const snapshot = await hydrateLibraryCoreAnnotations(query, original);
    expect(snapshot.highlights?.map(h => h.text)).toEqual([quote, quote]);
    const payload = replaceHydratedSavedNote(snapshot, "new note", 10);
    expect(payload.highlights.slice(0, 2)).toEqual(original.highlights);
    expect(JSON.stringify(original)).toBe(before);
  });
  it.each(["missing", "unavailable", "excluded", "corrupt", "oversized", "invalid_text"] as const)("blocks incomplete replacement for %s", async state => {
    const original = originals();
    const snapshot = await hydrateLibraryCoreAnnotations((async () => ({ ...response, state, text: null })) as LibraryCoreNormalizedQueryExecutor, original);
    expect(snapshot).toMatchObject({ state, highlights: null, originals: original });
    expect(() => replaceHydratedSavedNote(snapshot, "write", 1)).toThrow();
  });
  it("refuses final source drift and aggregate overflow without partial display", async () => {
    const original = originals();
    const query = (async (r: { queryId: string }) => r.queryId === "item_annotation_edit_state_v1" ? { queryId: r.queryId, schemaVersion: 1, globalId: "item", source, pending: false, localSequence: 0 } : r.queryId === "item_annotations_v1" ? { ...original, source: { ...source, projectionRevision: 8 } } : response) as LibraryCoreNormalizedQueryExecutor;
    expect((await hydrateLibraryCoreAnnotations(query, original)).state).toBe("stale");
    const large = new Uint8Array(65_536).fill(97);
    const largeQuery = (async (r: { annotationIndex: number }) => ({ ...response, annotationIndex: r.annotationIndex, text: { ...response.text, contentLength: large.length, endOffset: large.length, bytesBase64: encodeLibraryCoreCanonicalBase64(large) } })) as LibraryCoreNormalizedQueryExecutor;
    expect(await hydrateLibraryCoreAnnotations(largeQuery, originals(9))).toMatchObject({ state: "oversized", highlights: null });
  });
  it("enforces note and aggregate canonical payload caps independently", async () => {
    const snapshot = await hydrateLibraryCoreAnnotations((async (r: { queryId: string }) => r.queryId === "item_annotation_edit_state_v1" ? { queryId: r.queryId, schemaVersion: 1, globalId: "item", source, pending: false, localSequence: 0 } : r.queryId === "item_annotations_v1" ? originals() : response) as LibraryCoreNormalizedQueryExecutor, originals());
    expect(() => replaceHydratedSavedNote(snapshot, "a".repeat(8_193), 1)).toThrow();
    const inline = { ...snapshot, originals: { ...snapshot.originals, highlights: [{ createdAt: 1, text: "a".repeat(65_536), textBlobDigest: null, note: null }, { createdAt: 2, text: "b".repeat(40_000), textBlobDigest: null, note: null }] }, highlights: [{ text: "a", createdAt: 1 }, { text: "b", createdAt: 2 }] };
    expect(() => replaceHydratedSavedNote(inline, "note", 3)).toThrow();
  });
  it("preserves duplicate canonical quotes and changed notes in generic tag/highlight replacements", async () => {
    const original = originals(2);
    const query = (async (r: { queryId: string; annotationIndex?: number }) => r.queryId === "item_annotation_edit_state_v1" ? { queryId: r.queryId, schemaVersion: 1, globalId: "item", source, pending: false, localSequence: 0 } : r.queryId === "item_annotations_v1" ? original : { ...response, annotationIndex: r.annotationIndex }) as LibraryCoreNormalizedQueryExecutor;
    const snapshot = await hydrateLibraryCoreAnnotations(query, original);
    const input = snapshot.highlights!.map((row, index) => ({ ...row, note: index === 0 ? "changed" : row.note }));
    const payload = assembleHydratedAnnotationReplacement(snapshot, input, ["new-tag"], 10);
    expect(payload.highlights).toEqual([{ ...original.highlights[0], note: "changed" }, original.highlights[1]]);
    expect(payload.tags).toEqual(["new-tag"]);
    expect(() => assembleHydratedAnnotationReplacement(snapshot, input.slice(1), [], 10)).toThrow("omits an authenticated quote");
    expect(() => assembleHydratedAnnotationReplacement({ ...snapshot, state: "unavailable", highlights: null }, [], [], 10)).toThrow();
  });

  it("retains readable quotes while pending, refuses preparation and re-enables after settlement", async () => {
    const original=originals();
    let pending=true;
    const query=(async (r: {queryId:string}) => r.queryId === "item_annotation_edit_state_v1" ? {queryId:r.queryId,schemaVersion:1,globalId:"item",source,pending,localSequence:1} : r.queryId === "item_annotations_v1" ? original : response) as LibraryCoreNormalizedQueryExecutor;
    const blocked=await hydrateLibraryCoreAnnotations(query,original);
    expect(blocked).toMatchObject({state:"ready",editState:"pending",highlights:[{text:quote}]});
    expect(()=>retainRenderedAnnotationSnapshot(blocked,"item")).toThrow("pending");
    expect(()=>replaceHydratedSavedNote(blocked,"new",10)).toThrow("pending");
    pending=false;
    const ready=await hydrateLibraryCoreAnnotations(query,original);
    expect(ready.editState).toBe("ready");
    expect(replaceHydratedSavedNote(ready,"new",10).highlights[0]).toEqual(original.highlights[0]);
    pending=true;
    await expect(assertLibraryCoreAnnotationEditEligible(query,ready)).rejects.toThrow("pending");
    const unavailable=await hydrateLibraryCoreAnnotations((async (r:{queryId:string})=>{if(r.queryId === "item_annotation_edit_state_v1") throw new Error("unknown query");return r.queryId === "item_annotations_v1" ? original : response;}) as LibraryCoreNormalizedQueryExecutor,original);
    expect(unavailable).toMatchObject({state:"ready",editState:"unavailable",highlights:[{text:quote}]});
    expect(()=>retainRenderedAnnotationSnapshot(unavailable,"item")).toThrow("not ready");
  });

});
