import * as A from "@automerge/automerge";
import { describe, expect, it } from "vitest";
import type {
  RevisionedStorageAdapter,
  RevisionedStorageValue,
  StorageRevision,
} from "../types.js";
import {
  classifyDocumentLoadFailure,
  RepeatableAutomergePersistence,
  StaleAutomergePersistenceStateError,
  UnreadableAutomergePersistenceStateError,
} from "./repeatable-automerge-persistence.js";

class MemoryRevisionedStorage implements RevisionedStorageAdapter {
  value: RevisionedStorageValue = {
    data: null,
    revision: { generation: 0, saveRevision: 0 },
  };
  readonly attemptedBytes: Uint8Array[] = [];
  failNextSave = false;

  async load(): Promise<RevisionedStorageValue> {
    return {
      data: this.value.data ? Uint8Array.from(this.value.data) : null,
      revision: { ...this.value.revision },
    };
  }

  async save(
    data: Uint8Array,
    expectedRevision: StorageRevision,
  ): Promise<StorageRevision> {
    this.attemptedBytes.push(Uint8Array.from(data));
    if (this.failNextSave) {
      this.failNextSave = false;
      throw new Error("simulated storage failure");
    }
    expect(expectedRevision).toEqual(this.value.revision);
    const revision = {
      generation: expectedRevision.generation,
      saveRevision: expectedRevision.saveRevision + 1,
    };
    this.value = { data: Uint8Array.from(data), revision };
    return { ...revision };
  }

  async clear(expectedRevision: StorageRevision): Promise<StorageRevision> {
    expect(expectedRevision).toEqual(this.value.revision);
    const revision = {
      generation: expectedRevision.generation + 1,
      saveRevision: 0,
    };
    this.value = { data: null, revision };
    return { ...revision };
  }
}

describe("RepeatableAutomergePersistence", () => {
  it("authorizes recovery only for recognized document corruption", () => {
    const healthy = A.save(A.from({ value: 1 }));
    const flipped = Uint8Array.from(healthy);
    flipped[flipped.length - 3] ^= 0xff;
    const damaged = [
      Uint8Array.from([0, 1, 2, 3, 4, 5, 6, 7]),
      healthy.slice(0, 12),
      flipped,
    ];

    for (const bytes of damaged) {
      let failure: unknown;
      try {
        A.load(bytes);
      } catch (error) {
        failure = error;
      }
      expect(failure).toBeInstanceOf(RangeError);
      expect(classifyDocumentLoadFailure(failure)).toBe("corrupt");
    }

    const nonCorruptionFailures: unknown[] = [
      new RangeError("Array buffer allocation failed"),
      new RangeError("Invalid array buffer length"),
      new Error("Out of memory"),
      new Error("WebAssembly.Memory.grow(): Unable to grow instance memory"),
      new Error("memory access out of bounds"),
      new RangeError("Maximum call stack size exceeded"),
      new RangeError("not enough data: array buffer allocation failed"),
      new Error("worker terminated"),
      new TypeError("undefined is not a function"),
      null,
      undefined,
    ];
    for (const failure of nonCorruptionFailures) {
      expect(classifyDocumentLoadFailure(failure)).toBe("load_failed");
    }
  });

  it("retries a failed first save from identical committed heads and bytes", async () => {
    const storage = new MemoryRevisionedStorage();
    const persistence = new RepeatableAutomergePersistence(storage);
    await persistence.load<{ count: number }>();
    const document = A.from({ count: 1 });
    storage.failNextSave = true;

    await expect(persistence.persist(document)).rejects.toThrow(
      "simulated storage failure",
    );
    expect(persistence.current()).toEqual({
      revision: { generation: 0, saveRevision: 0 },
      heads: [],
      byteLength: 0,
      hasDocument: false,
    });

    await expect(persistence.persist(document)).resolves.toMatchObject({
      revision: { generation: 0, saveRevision: 1 },
      heads: A.getHeads(document),
      hasDocument: true,
    });
    expect(storage.attemptedBytes).toHaveLength(2);
    expect(storage.attemptedBytes[1]).toEqual(storage.attemptedBytes[0]);
    expect(A.load<{ count: number }>(storage.value.data!).count).toBe(1);
    const snapshot = persistence.snapshot();
    snapshot.bytes![0] ^= 0xff;
    expect(persistence.snapshot().bytes).toEqual(storage.value.data);
  });

  it("appends later deltas and can compact the committed document", async () => {
    const storage = new MemoryRevisionedStorage();
    const persistence = new RepeatableAutomergePersistence(storage);
    await persistence.load<{ values: number[] }>();
    let document = A.from({ values: [1] });
    await persistence.persist(document);
    const firstBytes = Uint8Array.from(storage.value.data!);

    document = A.change(document, (draft) => {
      draft.values.push(2);
    });
    await persistence.persist(document);
    const appendedBytes = Uint8Array.from(storage.value.data!);
    expect(appendedBytes.slice(0, firstBytes.byteLength)).toEqual(firstBytes);
    expect(A.load<{ values: number[] }>(appendedBytes).values).toEqual([1, 2]);

    await persistence.persist(document, { mode: "compact" });
    expect(storage.value.revision).toEqual({
      generation: 0,
      saveRevision: 3,
    });
    expect(storage.value.data!.byteLength).toBeLessThan(
      appendedBytes.byteLength,
    );
    expect(A.load<{ values: number[] }>(storage.value.data!).values).toEqual([
      1, 2,
    ]);
  });

  it("requires the caller revision before replacing unrelated history", async () => {
    const storage = new MemoryRevisionedStorage();
    const persistence = new RepeatableAutomergePersistence(storage);
    await persistence.load<{ source: string }>();
    await persistence.persist(A.from({ source: "first" }));
    const expectedRevision = persistence.current().revision;
    const replacement = A.from({ source: "replacement" });

    await expect(
      persistence.persist(replacement, {
        mode: "replace",
        expectedRevision: { generation: 0, saveRevision: 0 },
      }),
    ).rejects.toBeInstanceOf(StaleAutomergePersistenceStateError);

    await persistence.persist(replacement, {
      mode: "replace",
      expectedRevision,
    });
    expect(A.load<{ source: string }>(storage.value.data!).source).toBe(
      "replacement",
    );
    expect(persistence.current().revision).toEqual({
      generation: 0,
      saveRevision: 2,
    });
  });

  it("keeps corrupt committed bytes recoverable without letting them be extended", async () => {
    // The whole point of retaining the revision through a decode failure. If
    // load() recorded its committed state only after A.load() succeeded, a
    // corrupt document would leave `committed` null, and every recovery entry
    // point (current, snapshot, clear) would throw "must load before use". The
    // caller would be holding a document it cannot read and is not permitted to
    // replace, which is precisely the situation recovery exists for.
    const storage = new MemoryRevisionedStorage();
    storage.value = {
      data: Uint8Array.from([0, 1, 2, 3, 4, 5, 6, 7]),
      revision: { generation: 3, saveRevision: 9 },
    };
    const persistence = new RepeatableAutomergePersistence(storage);

    await expect(persistence.load<{ count: number }>()).rejects.toThrow();

    // The exact durable revision survived the failure, so recovery can fence on
    // it. A second storage.load() to rediscover it would be a race: the value
    // can move between the failed decode and the user's eventual clear.
    expect(persistence.current()).toEqual({
      revision: { generation: 3, saveRevision: 9 },
      heads: [],
      byteLength: 8,
      hasDocument: true,
    });

    // Writing is refused. Every persist path either appends to the committed
    // bytes or trusts the committed heads, and neither means anything here;
    // appending would make the corruption durable and destroy the evidence.
    await expect(
      persistence.persist(A.from({ count: 1 })),
    ).rejects.toBeInstanceOf(UnreadableAutomergePersistenceStateError);
    await expect(
      persistence.persist(A.from({ count: 1 }), { mode: "compact" }),
    ).rejects.toBeInstanceOf(UnreadableAutomergePersistenceStateError);
    await expect(
      persistence.persist(A.from({ count: 1 }), {
        mode: "replace",
        expectedRevision: { generation: 3, saveRevision: 9 },
      }),
    ).rejects.toBeInstanceOf(UnreadableAutomergePersistenceStateError);
    expect(storage.attemptedBytes).toHaveLength(0);

    // A clear at a revision the caller guessed must still be rejected. Recovery
    // is fenced, not a licence to wipe.
    await expect(
      persistence.clear({ generation: 3, saveRevision: 8 }),
    ).rejects.toBeInstanceOf(StaleAutomergePersistenceStateError);

    await expect(
      persistence.clear({ generation: 3, saveRevision: 9 }),
    ).resolves.toEqual({
      revision: { generation: 4, saveRevision: 0 },
      heads: [],
      byteLength: 0,
      hasDocument: false,
    });
    expect(storage.value.data).toBeNull();

    // Clearing restored readability, because there are no undecodable bytes
    // left, and a fresh load sees an empty library at the new generation.
    const reloaded = await persistence.load<{ count: number }>();
    expect(reloaded.document).toBeNull();
    expect(reloaded.committed).toEqual({
      revision: { generation: 4, saveRevision: 0 },
      heads: [],
      byteLength: 0,
      hasDocument: false,
    });
    await expect(
      persistence.persist(A.from({ count: 1 })),
    ).resolves.toMatchObject({ hasDocument: true });
  });
});
