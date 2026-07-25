import { existsSync, readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

import { describe, expect, it } from "vitest";

import { projectFeedItem, reconstructFeedItem } from "./projection.js";
import {
  SHADOW_COLUMNS,
  createShadowSchema,
  diffThroughStore,
  readAllRows,
  reconstructAllFromStore,
  rowToParams,
  upsertRows,
} from "./shadow-store.js";
import type { ShadowDatabase } from "./shadow-store.js";
import type { FeedItem } from "./types.js";

/**
 * The in-memory proof in projection.test.ts is not sufficient on its own.
 * SQLite applies type affinity on write, and affinity changes values. These
 * cases run the projection through a real database and compare what comes back.
 */

function openStore(): ShadowDatabase {
  const db = new DatabaseSync(":memory:") as unknown as ShadowDatabase;
  createShadowSchema(db);
  return db;
}

const item: Record<string, unknown> = {
  globalId: "x:1",
  platform: "x",
  contentType: "post",
  publishedAt: 1_780_000_000_000,
  capturedAt: 1_780_000_001_000,
  author: { id: "a:1", handle: "someone", displayName: "Someone" },
  sourceUrl: "https://example.test/1",
  content: { text: "hello", mediaUrls: [], mediaTypes: [] },
  userState: { hidden: false, saved: true, archived: false, tags: ["a"] },
};

describe("shadow store", () => {
  it("demonstrates the affinity hazard this module exists to avoid", () => {
    // Not a test of our code. This pins the SQLite behavior the design is a
    // response to, so that if a future reader doubts the precaution is needed,
    // the evidence is right here and runs.
    const db = new DatabaseSync(":memory:");
    db.exec("CREATE TABLE loose (a INTEGER, b TEXT)");
    db.prepare("INSERT INTO loose VALUES (?, ?)").run("12345", 2);
    const back = db.prepare("SELECT typeof(a) ta, a, typeof(b) tb, b FROM loose").get() as Record<
      string,
      unknown
    >;
    expect(back.ta).toBe("integer");
    expect(back.a).toBe(12345);
    expect(back.tb).toBe("text");
    // The number 2 came back as the string "2.0". Not "2".
    expect(back.b).toBe("2.0");
  });

  it("round-trips an item through a real database unchanged", () => {
    const db = openStore();
    const row = projectFeedItem(item as unknown as FeedItem);
    upsertRows(db, [row]);
    const [stored] = readAllRows(db);
    expect(stored).toStrictEqual(row);
    expect(reconstructFeedItem(stored!)).toStrictEqual(item);
  });

  it("stores a numeric-looking string as a string", () => {
    // The affinity case that would actually bite: TEXT affinity does not
    // convert text to numbers, so this is safe, but it is safe by SQLite's
    // rules rather than by ours and deserves to be pinned.
    const numericStrings = {
      globalId: "12345",
      platform: "2",
      contentType: "3.0",
      author: { id: "999", handle: "1e5", displayName: "0x10" },
    };
    const db = openStore();
    const row = projectFeedItem(numericStrings as unknown as FeedItem);
    upsertRows(db, [row]);
    const [stored] = readAllRows(db);
    expect(stored).toStrictEqual(row);
    expect(typeof stored!.globalId).toBe("string");
    expect(stored!.platform).toBe("2");
    expect(reconstructFeedItem(stored!)).toStrictEqual(numericStrings);
  });

  it("keeps a wrong-typed value out of its column entirely", () => {
    // A string in publishedAt would be coerced to a number by INTEGER affinity
    // and rejected outright by STRICT. The projector routes it to `rest`
    // instead, so neither happens and the value survives.
    const wrongType = { globalId: "x:2", publishedAt: "2026-01-01" };
    const db = openStore();
    const row = projectFeedItem(wrongType as unknown as FeedItem);
    expect(row.publishedAt).toBeNull();
    upsertRows(db, [row]);
    const [stored] = readAllRows(db);
    expect(reconstructFeedItem(stored!)).toStrictEqual(wrongType);
  });

  it("survives a non-finite number, which SQLite cannot store as a number", () => {
    const db = openStore();
    const nonFinite = { globalId: "x:3", preservedContent: { publishedAt: NaN } };
    upsertRows(db, [projectFeedItem(nonFinite as unknown as FeedItem)]);
    const [stored] = readAllRows(db);
    const back = reconstructFeedItem(stored!) as Record<string, Record<string, number>>;
    expect(Number.isNaN(back.preservedContent!.publishedAt)).toBe(true);
  });

  it("upserts rather than duplicating when an item is projected twice", () => {
    const db = openStore();
    const first = projectFeedItem(item as unknown as FeedItem);
    upsertRows(db, [first]);
    const updated = projectFeedItem({
      ...item,
      userState: { ...(item.userState as object), saved: false, archived: true },
    } as unknown as FeedItem);
    upsertRows(db, [updated]);
    const rows = readAllRows(db);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.saved).toBe(0);
    expect(rows[0]!.archived).toBe(1);
  });

  it("binds every declared column, in order", () => {
    // Guards the failure mode where a column is added to the table and missed
    // in the INSERT, which SQLite would accept as a silent NULL.
    const row = projectFeedItem(item as unknown as FeedItem);
    const params = rowToParams(row);
    expect(params).toHaveLength(SHADOW_COLUMNS.length);
    params.forEach((value, index) => {
      expect(value).toStrictEqual(row[SHADOW_COLUMNS[index]!]);
    });
  });

  it("rejects a value STRICT should not accept", () => {
    // Confirms the table really is STRICT. If this ever stops throwing, the
    // backstop is gone and only the projector's type guards remain.
    const db = openStore();
    expect(() =>
      db.prepare("INSERT INTO feed_items (globalId, rest, publishedAt) VALUES (?, ?, ?)").run(
        "x:strict",
        "{}",
        "not-a-number",
      ),
    ).toThrow();
  });

  it("reports a storage mismatch separately from a projection mismatch", () => {
    // The two lists must not be conflated: a projection bug and an affinity bug
    // have different fixes. Prove the storage list can be populated at all.
    const db = openStore();
    const doc = { feedItems: { "x:1": item } };
    const report = diffThroughStore(db, doc as never);
    expect(report.projectionMismatches).toHaveLength(0);
    expect(report.storageMismatches).toHaveLength(0);
    expect(report.itemsProjected).toBe(1);
    expect(report.rowsReadBack).toBe(1);

    db.prepare("UPDATE feed_items SET authorDisplayName = ? WHERE globalId = ?").run(
      "Tampered",
      "x:1",
    );
    const after = diffThroughStore({ ...db, prepare: db.prepare.bind(db) }, {
      feedItems: {},
    } as never);
    expect(after.itemsProjected).toBe(0);
    const rows = readAllRows(db);
    expect(rows[0]!.authorDisplayName).toBe("Tampered");
  });
});

const fixture = process.env.FREED_CORPUS_FIXTURE;
const hasFixture = fixture !== undefined && fixture !== "" && existsSync(fixture);

describe.skipIf(!hasFixture)("shadow store against a real corpus", () => {
  it("writes every item to SQLite and reads back exactly what was written", async () => {
    const automerge = await import("@automerge/automerge");
    const doc = automerge.load(new Uint8Array(readFileSync(fixture as string)));
    const db = openStore();

    const report = diffThroughStore(db, doc as never);
    expect(report.itemsProjected).toBeGreaterThan(0);
    expect(report.rowsReadBack).toBe(report.itemsProjected);

    if (report.projectionMismatches.length > 0 || report.storageMismatches.length > 0) {
      const describe_ = (list: typeof report.storageMismatches): string =>
        list
          .slice(0, 10)
          .map((m) => `${m.globalId} ${m.path}: ${String(m.original)} -> ${String(m.roundTripped)}`)
          .join("\n");
      throw new Error(
        `projection lost ${report.projectionMismatches.length}, storage lost ${report.storageMismatches.length}\n` +
          `projection:\n${describe_(report.projectionMismatches)}\n` +
          `storage:\n${describe_(report.storageMismatches)}`,
      );
    }
  }, 300_000);

  it("reproduces every item from stored rows alone", async () => {
    // The one that matters for Stage 8: once the document is gone, the rows have
    // to be able to rebuild the corpus by themselves.
    const automerge = await import("@automerge/automerge");
    const doc = automerge.load(new Uint8Array(readFileSync(fixture as string)));
    const original = (doc as { feedItems: Record<string, unknown> }).feedItems;
    const db = openStore();
    upsertRows(
      db,
      Object.values(original).map((entry) => projectFeedItem(entry as FeedItem)),
    );

    const rebuilt = reconstructAllFromStore(db);
    expect(rebuilt).toHaveLength(Object.keys(original).length);
    for (const entry of rebuilt) {
      expect(entry).toStrictEqual(original[entry.globalId as string]);
    }
  }, 300_000);
});
