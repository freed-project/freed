import { DatabaseSync } from "node:sqlite";

import { describe, expect, it } from "vitest";

import { projectFeedItem } from "../projection.js";
import {
  SHADOW_INDEX_DDL,
  SHADOW_TABLE_DDL,
  SORT_AT_ABSENT,
  createShadowSchema,
  rowToParams,
  upsertRows,
} from "../shadow-store.js";
import type { ShadowDatabase } from "../shadow-store.js";
import type { FeedItem } from "../types.js";
import { LIBRARY_CORE_QUERY_REGISTRY } from "./query-registry.js";

/**
 * The feed_page_v1 ordering, checked against the thing that has to implement it.
 *
 * A sort contract is only worth declaring if it stays true, and the two ways it
 * silently stops being true are drift and fabrication. Drift: the registry says
 * one order while the store indexes another, and pagination degrades or skips
 * rows with nothing failing. Fabrication: someone makes the sort column NOT NULL
 * by writing a sentinel into `publishedAt`, which is the irreversible data loss
 * the projection exists to prevent. Both are checked here rather than described.
 */

const definition = LIBRARY_CORE_QUERY_REGISTRY.feed_page_v1;

if (definition.status !== "planned_blocked") {
  throw new Error("feed_page_v1 must be a planned Library Core query");
}

const timelineIndexDdl = SHADOW_INDEX_DDL.find((sql) =>
  sql.includes("feed_items_timeline"),
);

function openStore(): ShadowDatabase {
  const db = new DatabaseSync(":memory:") as unknown as ShadowDatabase;
  createShadowSchema(db);
  return db;
}

/**
 * One in eight items has no `publishedAt` at all. That ratio is arbitrary; what
 * matters is that undated items exist, stay null, and still paginate.
 */
function corpus(count: number): FeedItem[] {
  const items: FeedItem[] = [];
  for (let index = 0; index < count; index += 1) {
    const undated = index % 8 === 3;
    const item: Record<string, unknown> = {
      globalId: `x:${String(index).padStart(6, "0")}`,
      platform: "x",
      contentType: "post",
      capturedAt: 1_780_000_000_000,
      author: { id: "a:1", handle: "someone", displayName: "Someone" },
      sourceUrl: `https://example.test/${index}`,
      content: { text: `item ${index}`, mediaUrls: [], mediaTypes: [] },
      userState: { hidden: false, saved: false, archived: false, tags: [] },
    };
    if (!undated) {
      // Heavy ties on purpose: a scrape assigns many items the same timestamp,
      // which is exactly when a missing tie-break starts losing rows.
      item.publishedAt = 1_780_000_000_000 - (index % 32) * 86_400_000;
    }
    items.push(item as unknown as FeedItem);
  }
  return items;
}

describe("feed_page_v1 sort contract", () => {
  it("declares the ordering the shadow store actually indexes", () => {
    expect(definition.stableSort).not.toBeNull();
    expect(definition.blockers).not.toContain("sort_contract_unresolved");

    const sort = definition.stableSort!;
    expect(sort.columns.map((column) => column.column)).toStrictEqual([
      "sortAt",
      "globalId",
    ]);
    expect(definition.tieBreakKey).toBe("globalId");

    // The index must carry every sort column, in order, in the same direction.
    // Anything less and SQLite reorders with a temp B-tree, which is the cost
    // this contract exists to avoid.
    const expectedIndexColumns = sort.columns
      .map((column) => `${column.column} ${column.direction.toUpperCase()}`)
      .join(", ");
    expect(timelineIndexDdl).toBeDefined();
    expect(timelineIndexDdl!.replace(/\s+/g, " ")).toContain(
      `ON feed_items (${expectedIndexColumns})`,
    );
  });

  it("orders on a derived column so no timestamp is ever fabricated", () => {
    // `nullOrdering` claims every sort column is NOT NULL. If that were achieved
    // by constraining `publishedAt`, absence would have to be written as a
    // sentinel and could never be reproduced. The declaration is only honest
    // while the authoritative column stays nullable.
    expect(definition.stableSort!.nullOrdering).toBe(
      "all_sort_columns_not_null",
    );
    const ddl = SHADOW_TABLE_DDL.replace(/\s+/g, " ");
    expect(ddl).toContain("sortAt INTEGER NOT NULL");
    expect(ddl).toContain("publishedAt INTEGER,");
    expect(ddl).not.toContain("publishedAt INTEGER NOT NULL");

    const undated = projectFeedItem(corpus(4)[3]!);
    expect(undated.publishedAt).toBeNull();
    // The sentinel reaches the sort column and nothing else.
    const params = rowToParams(undated);
    expect(params[params.length - 1]).toBe(SORT_AT_ABSENT);
  });

  it("walks every row exactly once through a real keyset page", () => {
    const db = openStore();
    const items = corpus(2_000);
    upsertRows(
      db,
      items.map((item) => projectFeedItem(item)),
    );

    const sql = `
      SELECT globalId, publishedAt, sortAt
      FROM feed_items INDEXED BY feed_items_timeline
      WHERE archived IS NOT 1 AND hidden IS NOT 1
        AND (sortAt < ? OR (sortAt = ? AND globalId > ?))
      ORDER BY sortAt DESC, globalId ASC
      LIMIT ?;
    `;

    const plan = db
      .prepare(`EXPLAIN QUERY PLAN ${sql}`)
      .all(Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER, "", 64)
      .map((row) => (row as { detail: string }).detail)
      .join(" ");
    expect(plan).toContain("feed_items_timeline");
    // The whole point. A temp B-tree here means each page sorts the remaining
    // set, so the page is bounded but the work behind it is not.
    expect(plan).not.toContain("TEMP B-TREE");

    const statement = db.prepare(sql);
    const seen = new Set<string>();
    let sortAt = Number.MAX_SAFE_INTEGER;
    let globalId = "";
    let previous: { sortAt: number; globalId: string } | null = null;
    let undatedSeen = 0;
    let pages = 0;

    for (;;) {
      const rows = statement.all(sortAt, sortAt, globalId, 64) as {
        globalId: string;
        publishedAt: number | null;
        sortAt: number;
      }[];
      if (rows.length === 0) break;
      pages += 1;
      expect(rows.length).toBeLessThanOrEqual(definition.maximumRows);
      // A cursor that fails to advance would otherwise spin here forever.
      expect(pages).toBeLessThanOrEqual(items.length);

      for (const row of rows) {
        // A repeat means the cursor compared differently from the database.
        expect(seen.has(row.globalId)).toBe(false);
        seen.add(row.globalId);
        if (row.publishedAt === null) {
          undatedSeen += 1;
          expect(row.sortAt).toBe(SORT_AT_ABSENT);
        } else {
          expect(row.sortAt).toBe(row.publishedAt);
        }
        if (previous) {
          const descends =
            row.sortAt < previous.sortAt ||
            (row.sortAt === previous.sortAt &&
              row.globalId > previous.globalId);
          expect(descends).toBe(true);
        }
        previous = { sortAt: row.sortAt, globalId: row.globalId };
      }

      const last = rows[rows.length - 1]!;
      sortAt = last.sortAt;
      globalId = last.globalId;
    }

    // No row dropped, no row served twice, and the undated ones survived as
    // undated rather than being quietly dated to the epoch.
    expect(seen.size).toBe(items.length);
    expect(undatedSeen).toBe(250);
  });
});
