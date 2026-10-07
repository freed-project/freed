import { afterEach, beforeEach, describe, expect, it } from "vitest";
import sqlite3InitModule, { type Database } from "@sqlite.org/sqlite-wasm";
import { LibraryCoreSha256, digestLibraryCoreMediaBlobBytesV1, decodeLibraryCoreCanonicalBase64, parseLibraryCoreItemAnnotationTextRequestV1 } from "@freed/shared/library-core";
import { PwaLibraryCoreSqliteEngine } from "./library-core-sqlite-engine";
const quote = "\ufeffExact\r\ne\u0301\0🦉";
const bytes = Uint8Array.from(new TextEncoder().encode(quote));
const digest = digestLibraryCoreMediaBlobBytesV1(bytes);
const generation = "a".repeat(64);
function request(limitBytes = 65_536) {
  const parsed = parseLibraryCoreItemAnnotationTextRequestV1({ queryId: "item_annotation_text_range_v1", schemaVersion: 1, globalId: "item", annotationIndex: 0, expectedSource: { generationId: generation, projectionRevision: 0, transitionSequence: 0 }, offsetBytes: 0, limitBytes });
  if (!parsed.ok) throw new Error(parsed.error);
  return parsed.value;
}
function rangeRoot(length: number) {
  const hash = new LibraryCoreSha256();
  hash.update(new TextEncoder().encode("freed.library-core.v1/digest-records/content-range-map\0"));
  hash.update(new TextEncoder().encode(digest));
  const integer = (n: number) => { const b = new Uint8Array(8); new DataView(b.buffer).setBigUint64(0, BigInt(n)); return b; };
  for (const n of [length, 1, 0, 0, length]) hash.update(integer(n));
  hash.update(new TextEncoder().encode(digest));
  return hash.digestLowerHex();
}
describe("registered annotation query on real SQLite WASM", () => {
  let database: Database;
  let engine: PwaLibraryCoreSqliteEngine;
  beforeEach(async () => {
    const sqlite = await sqlite3InitModule();
    database = new sqlite.oo1.DB(":memory:", "c");
    engine = new PwaLibraryCoreSqliteEngine(database, sqlite.version.libVersion);
    engine.initialize();
    database.exec(`INSERT INTO library_meta(singleton_id,library_id,schema_version,authority_epoch,source_revision,updated_at) VALUES(1,'${generation}',1,'epoch',0,0); INSERT INTO library_materialization_generation VALUES(1,'${generation}');
      INSERT INTO library_feed_items(global_id,platform,content_type,captured_at,published_at,author_id,author_handle,author_display_name,hidden,saved,archived,updated_at) VALUES('item','saved','article',0,0,'a','a','a',0,1,0,0);`);
  });
  afterEach(() => database.close());
  function seed(layout: "inline_chunks" | "authenticated_ranges") {
    if (layout === "inline_chunks") {
      database.exec({ sql: "INSERT INTO library_blobs(content_digest,byte_length,storage_layout,chunk_bytes,chunk_count,media_type) VALUES(?1,?2,'inline_chunks',65536,1,'text/plain');", bind: [digest, bytes.length] });
      database.exec({ sql: "INSERT INTO library_blob_chunks VALUES(?1,0,?1,?2);", bind: [digest, bytes] });
    } else {
      database.exec({ sql: "INSERT INTO library_blobs(content_digest,byte_length,storage_layout,chunk_bytes,chunk_count,range_count,range_granularity,range_index_root_digest,rendition_id,cloud_availability_commitment,media_type) VALUES(?1,?2,'authenticated_ranges',0,0,1,?2,?3,'text',?1,'text/plain');", bind: [digest, bytes.length, rangeRoot(bytes.length)] });
      database.exec({ sql: "INSERT INTO library_content_ranges VALUES(?1,0,0,?2,?1);", bind: [digest, bytes.length] });
      database.exec({ sql: "INSERT INTO library_device_content_ranges VALUES(?1,0,?2,?1,'opfs','private-key',1);", bind: [digest, bytes.length] });
    }
    database.exec({ sql: "INSERT INTO library_feed_item_highlights VALUES('item',7,NULL,?1,'keep',1);", bind: [digest] });
  }
  it.each(["inline_chunks", "authenticated_ranges"] as const)("returns exact full and partial text from %s", async layout => {
    seed(layout);
    const read = async () => bytes.slice();
    const result = await engine.queryWithVerification(request(), read);
    expect(result.state).toBe("ready");
    expect(new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(decodeLibraryCoreCanonicalBase64(result.text!.bytesBase64))).toBe(quote);
    const part = await engine.queryWithVerification(request(2), read);
    expect(decodeLibraryCoreCanonicalBase64(part.text!.bytesBase64)).toEqual(bytes.slice(0, 2));
    expect(database.selectValue("SELECT text_blob_digest FROM library_feed_item_highlights")).toBe(digest);
    expect(database.selectValue("SELECT source_revision FROM library_meta")).toBe(0);
  });
  it("rejects corrupt unrequested suffixes, truncated objects and absent vault without changing annotations", async () => {
    seed("authenticated_ranges");
    const changed = bytes.slice(); changed[changed.length - 1] ^= 1;
    expect((await engine.queryWithVerification(request(1), async () => changed)).state).toBe("corrupt");
    expect((await engine.queryWithVerification(request(1), async () => bytes.slice(0, -1))).state).toBe("corrupt");
    expect((await engine.queryWithVerification(request())).state).toBe("unavailable");
    expect(database.selectValue("SELECT text_blob_digest FROM library_feed_item_highlights")).toBe(digest);
  });
  it("checks exclusion and length before physical access and all source fields", async () => {
    seed("authenticated_ranges");
    let reads = 0; const read = async () => { reads++; return bytes; };
    database.exec({ sql: "INSERT INTO library_device_content_policies VALUES(?1,'excluded',0)", bind: [digest] });
    expect((await engine.queryWithVerification(request(), read)).state).toBe("excluded");
    database.exec("DELETE FROM library_device_content_policies; UPDATE library_blobs SET byte_length=65537;");
    expect((await engine.queryWithVerification(request(), read)).state).toBe("oversized");
    expect(reads).toBe(0);
    for (const field of ["generationId", "projectionRevision", "transitionSequence"] as const) {
      const input = request();
      const expectedSource = { ...input.expectedSource, [field]: field === "generationId" ? "b".repeat(64) : 1 };
      await expect(engine.queryWithVerification({ ...input, expectedSource } as typeof input, read)).rejects.toThrow("CURSOR_STALE");
    }
  });
  it("rejects full digest mismatch and invalid UTF-8 even for a valid requested prefix", async () => {
    seed("inline_chunks");
    database.exec({ sql: "UPDATE library_blob_chunks SET bytes=?1", bind: [new Uint8Array(bytes.length).fill(97)] });
    expect((await engine.queryWithVerification(request(1))).state).toBe("corrupt");
    const invalid = new Uint8Array([65, 255]); const badDigest = digestLibraryCoreMediaBlobBytesV1(invalid);
    database.exec("DELETE FROM library_feed_item_highlights; DELETE FROM library_blob_chunks; DELETE FROM library_blobs;");
    database.exec({ sql: "INSERT INTO library_blobs(content_digest,byte_length,chunk_bytes,chunk_count,media_type) VALUES(?1,2,65536,1,'text/plain');", bind: [badDigest] });
    database.exec({ sql: "INSERT INTO library_blob_chunks VALUES(?1,0,?1,?2);", bind: [badDigest, invalid] });
    database.exec({ sql: "INSERT INTO library_feed_item_highlights VALUES('item',0,NULL,?1,NULL,0);", bind: [badDigest] });
    expect((await engine.queryWithVerification(request(1))).state).toBe("invalid_text");
  });
  it("refuses a source change across asynchronous vault access and closes its read transaction", async () => {
    seed("authenticated_ranges");
    await expect(engine.queryWithVerification(request(), async () => {
      database.exec("UPDATE library_meta SET source_revision = 1; UPDATE library_change_state SET revision = 1;");
      return bytes.slice();
    })).rejects.toThrow("CURSOR_STALE");
    // The injected write was in the synthetic read transaction and was rolled back.
    expect(database.selectValue("SELECT source_revision FROM library_meta")).toBe(0);
    expect((await engine.queryWithVerification(request(), async () => bytes.slice())).state).toBe("ready");
  });
  it("authenticates the range map before calling physical storage", async () => {
    seed("authenticated_ranges");
    database.exec("UPDATE library_content_ranges SET byte_offset = 1;");
    let reads = 0;
    expect((await engine.queryWithVerification(request(), async () => { reads++; return bytes; })).state).toBe("corrupt");
    expect(reads).toBe(0);
  });

});
