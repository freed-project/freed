import { afterEach, beforeEach, describe, expect, it } from "vitest";
import sqlite3InitModule, {
  type Database,
  type Sqlite3Static,
} from "@sqlite.org/sqlite-wasm";
import {
  digestLibraryCoreMediaBlobBytesV1,
  createLibraryCoreContentRangeStorageKeyV1,
  LIBRARY_CORE_CONTENT_RANGE_MAXIMUM_APPEND_BYTES,
} from "@freed/shared/library-core";

import { PwaLibraryCoreSqliteEngine } from "./library-core-sqlite-engine";
import {
  PwaLibraryCoreOpfsContentVault,
  type PwaContentRangeStorageV1,
} from "./library-core-opfs-content-vault";

class MemoryRangeStorage implements PwaContentRangeStorageV1 {
  readonly objects = new Map<string, Uint8Array>();
  readonly removed: string[] = [];
  maximumWrite = 0;

  async create(_publicationId: string, storageKey: string) {
    let bytes = new Uint8Array();
    let closed = false;
    return {
      storageKey,
      writer: {
        close: async () => {
          closed = true;
          this.objects.set(storageKey, bytes);
        },
        flush: async () => {
          if (closed) throw new Error("test writer is closed");
        },
        write: async (next: Uint8Array, at: number) => {
          if (closed || at !== bytes.byteLength) return 0;
          this.maximumWrite = Math.max(this.maximumWrite, next.byteLength);
          const combined = new Uint8Array(bytes.byteLength + next.byteLength);
          combined.set(bytes);
          combined.set(next, bytes.byteLength);
          bytes = combined;
          return next.byteLength;
        },
      },
    };
  }

  async remove(storageKey: string): Promise<void> {
    this.removed.push(storageKey);
    this.objects.delete(storageKey);
  }

  async read(
    storageKey: string,
    at: number,
    maximumBytes: number,
  ): Promise<Uint8Array> {
    const bytes = this.objects.get(storageKey);
    if (!bytes) throw new Error("test content range is absent");
    return bytes.slice(at, at + maximumBytes);
  }

  async scan(
    visit: (
      entry: Readonly<{ byteLength: number; storageKey: string }>,
    ) => Promise<void>,
  ): Promise<void> {
    for (const [storageKey, bytes] of [...this.objects]) {
      await visit({ byteLength: bytes.byteLength, storageKey });
    }
  }

  async stat(storageKey: string): Promise<number | null> {
    return this.objects.get(storageKey)?.byteLength ?? null;
  }
}

describe("PWA Library Core OPFS content vault", () => {
  let database: Database;
  let engine: PwaLibraryCoreSqliteEngine;
  let sqlite3: Sqlite3Static;

  beforeEach(async () => {
    sqlite3 = await sqlite3InitModule();
    database = new sqlite3.oo1.DB(":memory:", "c");
    engine = new PwaLibraryCoreSqliteEngine(
      database,
      sqlite3.version.libVersion,
    );
    engine.initialize();
  });

  afterEach(() => {
    if (database.isOpen()) database.close();
  });

  function installRange(bytes: Uint8Array): string {
    const digest = digestLibraryCoreMediaBlobBytesV1(bytes);
    database.exec({
      sql: `INSERT INTO library_blobs
              (content_digest, byte_length, storage_layout, chunk_bytes,
               chunk_count, range_count, range_granularity,
               range_index_root_digest, rendition_id,
               cloud_availability_commitment, media_type)
            VALUES (?1, ?2, 'authenticated_ranges', 0, 0, 1, ?2, ?3,
                    'video', ?4, 'video/mp4');`,
      bind: [digest, bytes.byteLength, "d".repeat(64), "e".repeat(64)],
    });
    database.exec({
      sql: `INSERT INTO library_content_ranges
              (content_digest, range_index, byte_offset, byte_length, range_digest)
            VALUES (?1, 0, 0, ?2, ?1);`,
      bind: [digest, bytes.byteLength],
    });
    return digest;
  }

  it("streams bounded writes before publishing verified OPFS availability", async () => {
    const bytes = Uint8Array.from(
      { length: LIBRARY_CORE_CONTENT_RANGE_MAXIMUM_APPEND_BYTES * 2 + 17 },
      (_, index) => (index * 19 + 3) % 251,
    );
    const contentDigest = installRange(bytes);
    const storage = new MemoryRangeStorage();
    const vault = new PwaLibraryCoreOpfsContentVault(engine, storage);
    const publicationId = "f".repeat(64);
    const started = await vault.begin({
      contentDigest,
      publicationId,
      rangeIndex: 0,
      schemaVersion: 1,
    });
    expect(started.nextOffset).toBe(0);
    for (
      let offset = 0;
      offset < bytes.byteLength;
      offset += LIBRARY_CORE_CONTENT_RANGE_MAXIMUM_APPEND_BYTES
    ) {
      await vault.append({
        bytes: bytes.slice(
          offset,
          offset + LIBRARY_CORE_CONTENT_RANGE_MAXIMUM_APPEND_BYTES,
        ),
        expectedOffset: offset,
        publicationId,
        schemaVersion: 1,
      });
    }
    const receipt = await vault.finalize({
      publicationId,
      schemaVersion: 1,
      verifiedAt: 100,
    });
    expect(receipt).toMatchObject({
      changed: true,
      hydrationState: "partially_cached",
      verifiedBytes: bytes.byteLength,
    });
    expect(storage.maximumWrite).toBe(
      LIBRARY_CORE_CONTENT_RANGE_MAXIMUM_APPEND_BYTES,
    );
    const storageKey = createLibraryCoreContentRangeStorageKeyV1(
      contentDigest,
      0,
      contentDigest,
    );
    expect(storage.objects.get(storageKey)).toEqual(bytes);
    const read = await vault.read({
      contentDigest,
      maximumBytes: 19,
      rangeIndex: 0,
      rangeOffset: bytes.byteLength - 19,
      schemaVersion: 1,
    });
    expect(read.bytes).toEqual(bytes.slice(-19));
    expect(read.rangeComplete).toBe(true);
    await expect(
      vault.read({
        contentDigest,
        maximumBytes: 1,
        rangeIndex: 0,
        rangeOffset: bytes.byteLength,
        schemaVersion: 1,
      }),
    ).rejects.toThrow(/outside the range/);
    expect(
      engine.readContentState({ contentDigest, schemaVersion: 1 }),
    ).toMatchObject({
      availability: {
        completeDigestVerifiedAt: null,
        hydrationState: "partially_cached",
        storageKey: null,
        storageKind: "opfs",
        verifiedBytes: bytes.byteLength,
      },
    });
    await vault.reconcile();
    expect(storage.objects.get(storageKey)).toEqual(bytes);
    expect(
      engine.readContentState({ contentDigest, schemaVersion: 1 }),
    ).toMatchObject({ contentRevision: 1 });
  });

  it("deletes changed bytes without publishing a SQLite range", async () => {
    const expected = Uint8Array.from([1, 2, 3, 4]);
    const contentDigest = installRange(expected);
    const storage = new MemoryRangeStorage();
    const vault = new PwaLibraryCoreOpfsContentVault(engine, storage);
    const publicationId = "c".repeat(64);
    await vault.begin({
      contentDigest,
      publicationId,
      rangeIndex: 0,
      schemaVersion: 1,
    });
    await vault.append({
      bytes: Uint8Array.from([1, 2, 3, 5]),
      expectedOffset: 0,
      publicationId,
      schemaVersion: 1,
    });
    await expect(
      vault.finalize({ publicationId, schemaVersion: 1, verifiedAt: 100 }),
    ).rejects.toThrow(/digest is invalid/);
    expect(storage.removed).toEqual([
      createLibraryCoreContentRangeStorageKeyV1(
        contentDigest,
        0,
        contentDigest,
      ),
    ]);
    expect(
      database.exec({
        sql: "SELECT count(*) FROM library_device_content_ranges;",
        rowMode: 0,
        returnValue: "resultRows",
      }),
    ).toEqual([0]);
  });

  it("prunes missing proofs and orphan objects during bounded startup reconciliation", async () => {
    const bytes = Uint8Array.from([1, 2, 3, 4, 5]);
    const contentDigest = installRange(bytes);
    const storage = new MemoryRangeStorage();
    const storageKey = createLibraryCoreContentRangeStorageKeyV1(
      contentDigest,
      0,
      contentDigest,
    );
    engine.registerVerifiedContentRange({
      byteLength: bytes.byteLength,
      contentDigest,
      rangeContentDigest: contentDigest,
      rangeIndex: 0,
      schemaVersion: 1,
      storageKey,
      storageKind: "opfs",
      verifiedAt: 100,
    });
    storage.objects.set("orphan.bin", bytes);
    const vault = new PwaLibraryCoreOpfsContentVault(engine, storage);

    await vault.reconcile();

    expect(storage.objects.size).toBe(0);
    expect(
      engine.readContentState({ contentDigest, schemaVersion: 1 }),
    ).toMatchObject({ availability: null, contentRevision: 2 });
  });
});
