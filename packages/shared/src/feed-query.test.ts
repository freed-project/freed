import { existsSync, readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

import { describe, expect, it } from "vitest";

import { allFeedIdsByPaging, feedCounts, feedPage } from "./feed-query.js";
import { projectAll } from "./shadow-projector.js";
import { createShadowSchema, upsertRows } from "./shadow-store.js";
import { projectFeedItem } from "./projection.js";
import type { ShadowDatabase } from "./shadow-store.js";
import type { FeedItem } from "./types.js";

function openStore(): ShadowDatabase {
  const db = new DatabaseSync(":memory:") as unknown as ShadowDatabase;
  createShadowSchema(db);
  return db;
}

const HOUR = 3_600_000;
const NOW = 1_780_000_000_000;

function makeItem(globalId: string, overrides: Record<string, unknown> = {}): FeedItem {
  return {
    globalId,
    platform: "x",
    contentType: "post",
    publishedAt: NOW,
    capturedAt: NOW,
    author: { id: "a:1", handle: "someone", displayName: "Someone" },
    content: { text: "hello", mediaUrls: [], mediaTypes: [] },
    userState: { hidden: false, saved: false, archived: false, tags: [] },
    ...overrides,
  } as unknown as FeedItem;
}

function seed(db: ShadowDatabase, items: FeedItem[]): void {
  upsertRows(db, items.map((item) => projectFeedItem(item)));
}

describe("feed page from SQL", () => {
  it("orders newest first", () => {
    const db = openStore();
    seed(db, [
      makeItem("x:old", { publishedAt: NOW - 100 * HOUR }),
      makeItem("x:new", { publishedAt: NOW }),
      makeItem("x:mid", { publishedAt: NOW - 10 * HOUR }),
    ]);
    expect(feedPage(db).rows.map((r) => r.globalId)).toStrictEqual([
      "x:new",
      "x:mid",
      "x:old",
    ]);
  });

  it("breaks ties deterministically instead of leaving them to the engine", () => {
    // The reason this matters is not tidiness. SQLite does not define an order
    // for ties, and an unreproducible page boundary makes keyset pagination
    // drop or repeat items. On the owner's corpus every single item is tied
    // with at least one other, so this is the common case, not an edge case.
    const db = openStore();
    seed(db, [
      makeItem("x:c", { publishedAt: NOW }),
      makeItem("x:a", { publishedAt: NOW }),
      makeItem("x:b", { publishedAt: NOW }),
    ]);
    expect(feedPage(db).rows.map((r) => r.globalId)).toStrictEqual([
      "x:a",
      "x:b",
      "x:c",
    ]);
  });

  it("pins items with no publish date last rather than letting NULL float", () => {
    const db = openStore();
    seed(db, [
      makeItem("x:undated", { publishedAt: undefined }),
      makeItem("x:old", { publishedAt: NOW - 500 * HOUR }),
    ]);
    expect(feedPage(db).rows.map((r) => r.globalId)).toStrictEqual([
      "x:old",
      "x:undated",
    ]);
  });

  it("excludes hidden and archived items from the inbox scope", () => {
    const db = openStore();
    seed(db, [
      makeItem("x:normal"),
      makeItem("x:hidden", {
        userState: { hidden: true, saved: false, archived: false, tags: [] },
      }),
      makeItem("x:archived", {
        userState: { hidden: false, saved: false, archived: true, tags: [] },
      }),
    ]);
    expect(feedPage(db).rows.map((r) => r.globalId)).toStrictEqual(["x:normal"]);
    expect(feedPage(db, { scope: "archived" }).rows.map((r) => r.globalId)).toStrictEqual([
      "x:archived",
    ]);
  });

  it("counts every scope in one pass, and returns zero rather than null when empty", () => {
    const empty = openStore();
    expect(feedCounts(empty)).toStrictEqual({
      total: 0,
      inbox: 0,
      saved: 0,
      archived: 0,
      hidden: 0,
    });

    const db = openStore();
    seed(db, [
      makeItem("x:1"),
      makeItem("x:2", {
        userState: { hidden: false, saved: true, archived: false, tags: [] },
      }),
      makeItem("x:3", {
        userState: { hidden: false, saved: false, archived: true, tags: [] },
      }),
      makeItem("x:4", {
        userState: { hidden: true, saved: false, archived: false, tags: [] },
      }),
    ]);
    expect(feedCounts(db)).toStrictEqual({
      total: 4,
      inbox: 2,
      saved: 1,
      archived: 1,
      hidden: 1,
    });
  });

  it("paginates without dropping or repeating an item", () => {
    const db = openStore();
    const items = Array.from({ length: 25 }, (_, index) =>
      makeItem(`x:${String(index).padStart(3, "0")}`, { publishedAt: NOW - index * HOUR }),
    );
    seed(db, items);

    const paged = allFeedIdsByPaging(db, {}, 7);
    const single = feedPage(db, { limit: 500 }).rows.map((r) => r.globalId);
    expect(paged).toStrictEqual(single);
    expect(new Set(paged).size).toBe(25);
  });

  it("paginates correctly when every item shares a timestamp", () => {
    // The case that breaks a cursor built only on the timestamp: with 25 items
    // at the same publishedAt, a cursor of "publishedAt < X" returns nothing
    // and a cursor of "<=" returns the same page forever.
    const db = openStore();
    seed(
      db,
      Array.from({ length: 25 }, (_, index) =>
        makeItem(`x:${String(index).padStart(3, "0")}`, { publishedAt: NOW }),
      ),
    );
    const paged = allFeedIdsByPaging(db, {}, 7);
    expect(paged).toHaveLength(25);
    expect(new Set(paged).size).toBe(25);
    expect(paged).toStrictEqual([...paged].sort());
  });

  it("stops rather than returning a cursor for a page it knows is last", () => {
    const db = openStore();
    seed(db, [makeItem("x:1"), makeItem("x:2")]);
    expect(feedPage(db, { limit: 10 }).cursor).toBeNull();
    // A full page cannot know it is last, so it does return a cursor.
    expect(feedPage(db, { limit: 2 }).cursor).not.toBeNull();
  });

  it("filters by platform and author", () => {
    const db = openStore();
    seed(db, [
      makeItem("x:1", { platform: "x" }),
      makeItem("fb:1", { platform: "facebook" }),
      makeItem("x:2", {
        platform: "x",
        author: { id: "a:2", handle: "other", displayName: "Other" },
      }),
    ]);
    expect(feedPage(db, { platform: "facebook" }).rows.map((r) => r.globalId)).toStrictEqual([
      "fb:1",
    ]);
    expect(feedPage(db, { authorId: "a:2" }).rows.map((r) => r.globalId)).toStrictEqual([
      "x:2",
    ]);
  });
});

const fixture = process.env.FREED_CORPUS_FIXTURE;
const hasFixture = fixture !== undefined && fixture !== "" && existsSync(fixture);

describe.skipIf(!hasFixture)("feed page against a real corpus", () => {
  it("matches a straight chronological sort of the same items", async () => {
    // The equivalence that has to hold before a surface switches over. Compare
    // against the items themselves rather than against another SQL query, so
    // this cannot pass by both sides sharing a bug.
    const automerge = await import("@automerge/automerge");
    const doc = automerge.load(new Uint8Array(readFileSync(fixture as string)));
    const db = openStore();
    projectAll(db, doc as never);

    const items = Object.values(
      (doc as { feedItems: Record<string, FeedItem> }).feedItems,
    );
    const expected = items
      .filter((item) => !item.userState?.hidden && !item.userState?.archived)
      .sort((a, b) => {
        const left = typeof a.publishedAt === "number" ? a.publishedAt : null;
        const right = typeof b.publishedAt === "number" ? b.publishedAt : null;
        if (left === null && right !== null) return 1;
        if (right === null && left !== null) return -1;
        if (left !== null && right !== null && left !== right) return right - left;
        // Code-unit comparison, NOT localeCompare. SQLite's default BINARY
        // collation orders by byte value, so "…0T" sorts before "…0t";
        // localeCompare is locale-aware and puts lowercase first. The owner's
        // corpus contains Facebook ids differing only in that case, so the two
        // genuinely disagree on real data. Matching SQL to localeCompare would
        // need a custom collation registered on every connection; matching the
        // comparison to BINARY is free and is what the ORDER BY already does.
        return a.globalId < b.globalId ? -1 : a.globalId > b.globalId ? 1 : 0;
      })
      .map((item) => item.globalId);

    const actual = allFeedIdsByPaging(db, {}, 500);
    expect(actual).toHaveLength(expected.length);
    expect(actual).toStrictEqual(expected);
  }, 300_000);

  it("counts agree with the document", async () => {
    const automerge = await import("@automerge/automerge");
    const doc = automerge.load(new Uint8Array(readFileSync(fixture as string)));
    const db = openStore();
    projectAll(db, doc as never);

    const items = Object.values(
      (doc as { feedItems: Record<string, FeedItem> }).feedItems,
    );
    const counts = feedCounts(db);
    expect(counts.total).toBe(items.length);
    expect(counts.saved).toBe(items.filter((i) => i.userState?.saved).length);
    expect(counts.archived).toBe(items.filter((i) => i.userState?.archived).length);
    expect(counts.hidden).toBe(items.filter((i) => i.userState?.hidden).length);
  }, 300_000);
});
