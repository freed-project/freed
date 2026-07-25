import { existsSync, readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

import { describe, expect, it } from "vitest";

import {
  applyItemPatch,
  driftOf,
  isDrifted,
  operationsForPatch,
  projectAll,
  reconcile,
} from "./shadow-projector.js";
import { createShadowSchema, readAllRows } from "./shadow-store.js";
import type { ShadowDatabase } from "./shadow-store.js";
import type { FeedItem } from "./types.js";

function openStore(): ShadowDatabase {
  const db = new DatabaseSync(":memory:") as unknown as ShadowDatabase;
  createShadowSchema(db);
  return db;
}

function makeItem(globalId: string, overrides: Record<string, unknown> = {}): FeedItem {
  return {
    globalId,
    platform: "x",
    contentType: "post",
    publishedAt: 1_780_000_000_000,
    capturedAt: 1_780_000_001_000,
    author: { id: "a:1", handle: "someone", displayName: "Someone" },
    content: { text: "hello", mediaUrls: [], mediaTypes: [] },
    userState: { hidden: false, saved: false, archived: false, tags: [] },
    ...overrides,
  } as unknown as FeedItem;
}

function docOf(...items: FeedItem[]): { feedItems: Record<string, FeedItem> } {
  return { feedItems: Object.fromEntries(items.map((item) => [item.globalId, item])) };
}

describe("shadow projector", () => {
  it("applies inserts and updates from a patch", () => {
    const db = openStore();
    applyItemPatch(db, { patches: [{ item: makeItem("x:1") }, { item: makeItem("x:2") }] });
    expect(readAllRows(db)).toHaveLength(2);

    applyItemPatch(db, {
      patches: [
        {
          item: makeItem("x:1", {
            userState: { hidden: false, saved: true, archived: false, tags: [] },
          }),
        },
      ],
    });
    const rows = readAllRows(db);
    expect(rows).toHaveLength(2);
    expect(rows.find((r) => r.globalId === "x:1")?.saved).toBe(1);
  });

  it("applies a declared removal", () => {
    const db = openStore();
    applyItemPatch(db, { patches: [{ item: makeItem("x:1") }, { item: makeItem("x:2") }] });
    const result = applyItemPatch(db, {
      patches: [],
      changedItemIds: ["x:1"],
      removedItemIds: ["x:1"],
    });
    expect(result.deletes).toStrictEqual(["x:1"]);
    expect(result.missingRemovals).toStrictEqual([]);
    expect(readAllRows(db).map((r) => r.globalId)).toStrictEqual(["x:2"]);
  });

  it("treats an undeclared removal as a deletion and counts it", () => {
    // The reason this module does not just trust removedItemIds: the field is
    // OPTIONAL in the worker's ITEM_PATCH type. A delete path that forgets it
    // would otherwise leave a row behind forever, and under Stage 8 that row
    // becomes the only copy, so the item would appear to be resurrected.
    const db = openStore();
    applyItemPatch(db, { patches: [{ item: makeItem("x:1") }, { item: makeItem("x:2") }] });

    const result = applyItemPatch(db, {
      patches: [],
      changedItemIds: ["x:1"],
      // removedItemIds deliberately absent
    });
    expect(result.missingRemovals).toStrictEqual(["x:1"]);
    expect(result.deletes).toStrictEqual(["x:1"]);
    expect(readAllRows(db).map((r) => r.globalId)).toStrictEqual(["x:2"]);
  });

  it("does not mistake a supplied item for a removal", () => {
    const operations = operationsForPatch({
      patches: [{ item: makeItem("x:1") }],
      changedItemIds: ["x:1", "x:2"],
      removedItemIds: ["x:2"],
    });
    expect(operations.upserts.map((r) => r.globalId)).toStrictEqual(["x:1"]);
    expect(operations.deletes).toStrictEqual(["x:2"]);
    expect(operations.missingRemovals).toStrictEqual([]);
  });

  it("reports no drift when the store matches the document", () => {
    const db = openStore();
    const doc = docOf(makeItem("x:1"), makeItem("x:2"));
    projectAll(db, doc as never);
    const drift = driftOf(db, doc as never);
    expect(isDrifted(drift)).toBe(false);
    expect(drift.itemsInDocument).toBe(2);
    expect(drift.rowsInStore).toBe(2);
  });

  it("detects each of the three ways the projector can fall behind", () => {
    const db = openStore();
    const doc = docOf(makeItem("x:1"), makeItem("x:2"), makeItem("x:3"));

    // Missed insert: x:3 never projected.
    projectAll(db, docOf(makeItem("x:1"), makeItem("x:2")) as never);
    // Missed delete: x:9 is in the store but not the document.
    applyItemPatch(db, { patches: [{ item: makeItem("x:9") }] });
    // Missed update: x:2 changed in the document after being projected.
    const changed = makeItem("x:2", {
      userState: { hidden: true, saved: false, archived: false, tags: [] },
    });
    const driftDoc = docOf(makeItem("x:1"), changed, makeItem("x:3"));

    const drift = driftOf(db, driftDoc as never);
    expect(drift.missingFromStore).toStrictEqual(["x:3"]);
    expect(drift.staleInStore).toStrictEqual(["x:9"]);
    expect(drift.divergentRows).toStrictEqual(["x:2"]);
    expect(isDrifted(drift)).toBe(true);
    void doc;
  });

  it("reconcile repairs the store and reports what was wrong before repairing", () => {
    const db = openStore();
    projectAll(db, docOf(makeItem("x:1")) as never);
    applyItemPatch(db, { patches: [{ item: makeItem("x:stale") }] });
    const target = docOf(
      makeItem("x:1"),
      makeItem("x:2"),
      makeItem("x:3", { platform: "facebook" }),
    );

    const before = reconcile(db, target as never);
    // The returned drift describes the state BEFORE repair. A reconcile that
    // reported a clean result would make the projector look correct exactly
    // when it was not, which is the failure this whole module exists to avoid.
    expect(before.missingFromStore.sort()).toStrictEqual(["x:2", "x:3"]);
    expect(before.staleInStore).toStrictEqual(["x:stale"]);

    const after = driftOf(db, target as never);
    expect(isDrifted(after)).toBe(false);
    expect(readAllRows(db).map((r) => r.globalId).sort()).toStrictEqual(["x:1", "x:2", "x:3"]);
  });

  it("reconcile is a no-op on an already-correct store", () => {
    const db = openStore();
    const doc = docOf(makeItem("x:1"), makeItem("x:2"));
    projectAll(db, doc as never);
    const drift = reconcile(db, doc as never);
    expect(isDrifted(drift)).toBe(false);
    expect(readAllRows(db)).toHaveLength(2);
  });

  it("survives replaying the same patch twice", () => {
    // At-least-once delivery is the realistic assumption for a worker message
    // that may be re-sent after a reconnect or a reconcile that races a patch.
    const db = openStore();
    const event = { patches: [{ item: makeItem("x:1") }] };
    applyItemPatch(db, event);
    applyItemPatch(db, event);
    expect(readAllRows(db)).toHaveLength(1);
  });

  it("survives deleting an id that is not in the store", () => {
    const db = openStore();
    projectAll(db, docOf(makeItem("x:1")) as never);
    expect(() =>
      applyItemPatch(db, { patches: [], changedItemIds: ["x:gone"], removedItemIds: ["x:gone"] }),
    ).not.toThrow();
    expect(readAllRows(db)).toHaveLength(1);
  });
});

const fixture = process.env.FREED_CORPUS_FIXTURE;
const hasFixture = fixture !== undefined && fixture !== "" && existsSync(fixture);

describe.skipIf(!hasFixture)("shadow projector against a real corpus", () => {
  it("converges on the real document and reports zero drift", async () => {
    const automerge = await import("@automerge/automerge");
    const doc = automerge.load(new Uint8Array(readFileSync(fixture as string)));
    const db = openStore();

    const projected = projectAll(db, doc as never);
    expect(projected).toBeGreaterThan(0);

    const drift = driftOf(db, doc as never);
    if (isDrifted(drift)) {
      throw new Error(
        `drift after projecting ${projected} items: ` +
          `${drift.missingFromStore.length} missing, ` +
          `${drift.staleInStore.length} stale, ` +
          `${drift.divergentRows.length} divergent`,
      );
    }
    expect(drift.rowsInStore).toBe(projected);
  }, 300_000);

  it("detects a single tampered row in the real corpus", async () => {
    // A drift detector that cannot fail on 15,846 rows proves nothing. Corrupt
    // exactly one row and confirm it is found.
    const automerge = await import("@automerge/automerge");
    const doc = automerge.load(new Uint8Array(readFileSync(fixture as string)));
    const db = openStore();
    projectAll(db, doc as never);

    const [victim] = readAllRows(db);
    db.prepare("UPDATE feed_items SET authorDisplayName = ? WHERE globalId = ?").run(
      "tampered",
      victim!.globalId,
    );

    const drift = driftOf(db, doc as never);
    expect(drift.divergentRows).toStrictEqual([victim!.globalId]);
    expect(drift.missingFromStore).toHaveLength(0);
    expect(drift.staleInStore).toHaveLength(0);
  }, 300_000);
});
