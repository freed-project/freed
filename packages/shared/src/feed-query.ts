/**
 * The feed, as SQL.
 *
 * Stage 5 of the storage roadmap: the first surface that does not walk the
 * hydrated item array. Today the feed page and its counts require every item to
 * be materialised in the renderer, which is the cost that keeps the corpus in
 * memory. Measured on the owner's real 15,846-item document, the same items
 * cost 927 MB resident as an Automerge document and 7 MB served from here.
 *
 * ## Why the ordering is a plain timestamp
 *
 * The worker builds the feed like this:
 *
 *     sortByPriority(rankFeedItems(visibleItems.sort((a, b) => b.publishedAt - a.publishedAt), ...))
 *
 * Items are sorted newest-first and then handed to a stable sort by priority.
 * Measured against the owner's document, that priority sort does almost
 * nothing: 15,846 items collapse into 63 distinct values, 8,759 of them (55%)
 * share the single value 17, and every item is tied with at least one other.
 * The stored weights are empty except recency, and 93.8% of the corpus is older
 * than the 168-hour recency horizon where the recency term is zero by design.
 *
 * So priority is, in practice, a coarse recency bucket, and within each bucket
 * the stable sort preserves the newest-first pre-sort. The feed reads as
 * chronological because it very nearly is.
 *
 * The owner's decision (issue #1152) is that ordering is time-based for now,
 * with the classification system carrying filtering instead. Ordering by
 * `publishedAt` directly is therefore not a new behavior so much as the removal
 * of a layer that was not changing the answer. It differs from today only by
 * dissolving those coarse buckets, which makes the order strictly rather than
 * approximately chronological.
 *
 * ## Why there is an explicit tiebreaker
 *
 * `Array.prototype.sort` is stable, so today's ties silently fall back to
 * document iteration order. SQLite guarantees nothing for ties, and an
 * undefined order is not merely untidy here: it breaks keyset pagination,
 * because a page boundary that cannot be reproduced can drop or repeat items
 * between pages. `globalId` breaks every remaining tie, which makes the total
 * order deterministic and the pagination sound.
 *
 * That tiebreak uses SQLite's default BINARY collation, which orders by byte
 * value. Anyone reimplementing this comparison in JavaScript must use `<` and
 * `>` rather than `localeCompare`: the two disagree on case, `localeCompare`
 * putting lowercase first and BINARY putting uppercase first, and the owner's
 * corpus contains Facebook ids differing only in that case. A reimplementation
 * that reached for `localeCompare` would produce a subtly different order on
 * real data and pass every synthetic test.
 */

import { SHADOW_COLUMNS } from "./shadow-store.js";
import type { ShadowDatabase } from "./shadow-store.js";
import type { FeedItemRow } from "./projection.js";

export type FeedScope = "inbox" | "saved" | "archived";

export interface FeedPageQuery {
  scope?: FeedScope;
  platform?: string;
  authorId?: string;
  limit?: number;
  /** Keyset cursor from a previous page. Omit for the first page. */
  after?: FeedCursor;
}

/**
 * Keyset pagination, not OFFSET.
 *
 * OFFSET makes the database walk and discard every skipped row, so page N costs
 * O(N x pageSize) and a corpus this size gets slower the further the reader
 * scrolls. It is also incorrect under concurrent writes: an item inserted above
 * the current position shifts every subsequent page by one, which duplicates
 * one item and hides another. A cursor on the sort key has neither problem.
 */
export interface FeedCursor {
  publishedAt: number | null;
  globalId: string;
}

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 500;

/**
 * `publishedAt` is nullable, and NULL sorts inconsistently across engines and
 * comparisons. Items with no publish date are pinned last rather than allowed
 * to float, so the order is total and reproducible.
 */
const ORDER_BY = "publishedAt IS NULL, publishedAt DESC, globalId ASC";

function scopePredicate(scope: FeedScope): string {
  switch (scope) {
    case "saved":
      return "saved = 1";
    case "archived":
      return "archived = 1";
    case "inbox":
    default:
      // Matches the worker, which filters hidden items out of the feed and
      // keeps archived ones in their own view.
      return "(hidden IS NOT 1) AND (archived IS NOT 1)";
  }
}

export interface BuiltQuery {
  sql: string;
  params: (string | number | null)[];
}

export function buildFeedPageQuery(query: FeedPageQuery = {}): BuiltQuery {
  const limit = Math.min(Math.max(1, query.limit ?? DEFAULT_LIMIT), MAX_LIMIT);
  const where: string[] = [scopePredicate(query.scope ?? "inbox")];
  const params: (string | number | null)[] = [];

  if (query.platform !== undefined) {
    where.push("platform = ?");
    params.push(query.platform);
  }
  if (query.authorId !== undefined) {
    where.push("authorId = ?");
    params.push(query.authorId);
  }

  if (query.after !== undefined) {
    const { publishedAt, globalId } = query.after;
    if (publishedAt === null) {
      // Already inside the null-dated tail; only globalId can advance.
      where.push("publishedAt IS NULL AND globalId > ?");
      params.push(globalId);
    } else {
      // Strictly after the cursor in (publishedAt DESC, globalId ASC) order.
      where.push(
        "(publishedAt IS NULL OR publishedAt < ? OR (publishedAt = ? AND globalId > ?))",
      );
      params.push(publishedAt, publishedAt, globalId);
    }
  }

  params.push(limit);
  return {
    sql:
      `SELECT ${SHADOW_COLUMNS.join(", ")} FROM feed_items` +
      ` WHERE ${where.join(" AND ")}` +
      ` ORDER BY ${ORDER_BY}` +
      ` LIMIT ?`,
    params,
  };
}

export interface FeedPage {
  rows: FeedItemRow[];
  /** Pass to the next call. Null when the page was not full, meaning the end. */
  cursor: FeedCursor | null;
}

export function feedPage(db: ShadowDatabase, query: FeedPageQuery = {}): FeedPage {
  const limit = Math.min(Math.max(1, query.limit ?? DEFAULT_LIMIT), MAX_LIMIT);
  const built = buildFeedPageQuery(query);
  const rows = db
    .prepare(built.sql)
    .all(...built.params)
    .map((record) => record as unknown as FeedItemRow);

  const last = rows[rows.length - 1];
  return {
    rows,
    // A short page means there is nothing after it. Returning a cursor anyway
    // would make a caller issue one guaranteed-empty query per scroll.
    cursor:
      rows.length === limit && last !== undefined
        ? { publishedAt: last.publishedAt, globalId: last.globalId }
        : null,
  };
}

export interface FeedCounts {
  total: number;
  inbox: number;
  saved: number;
  archived: number;
  hidden: number;
}

/**
 * The numbers shown beside the feed's filters, in one pass.
 *
 * This is the half of Stage 5 the Automerge path cannot do cheaply: producing
 * these today means walking every hydrated item in the renderer, which is
 * exactly the work that keeps the corpus resident.
 */
export function feedCounts(db: ShadowDatabase): FeedCounts {
  const [row] = db
    .prepare(
      "SELECT count(*) AS total," +
        " coalesce(sum((hidden IS NOT 1) AND (archived IS NOT 1)), 0) AS inbox," +
        " coalesce(sum(saved = 1), 0) AS saved," +
        " coalesce(sum(archived = 1), 0) AS archived," +
        " coalesce(sum(hidden = 1), 0) AS hidden" +
        " FROM feed_items",
    )
    .all() as unknown as Partial<FeedCounts>[];
  // Rebuilt rather than returned as-is, for two reasons. node:sqlite hands back
  // rows created with a null prototype, so passing one out leaks the driver's
  // object shape to every caller and fails any strict structural comparison.
  // And the `coalesce` above only covers sum() over no rows returning NULL; the
  // `?? 0` here covers a driver that omits the key entirely.
  return {
    total: row?.total ?? 0,
    inbox: row?.inbox ?? 0,
    saved: row?.saved ?? 0,
    archived: row?.archived ?? 0,
    hidden: row?.hidden ?? 0,
  };
}

/**
 * Walk every page and return the ids in order. Used to prove the paginated
 * result equals the single-query result, which is the property keyset
 * pagination is easy to get subtly wrong about.
 */
export function allFeedIdsByPaging(
  db: ShadowDatabase,
  query: FeedPageQuery = {},
  pageSize = 100,
): string[] {
  const ids: string[] = [];
  let cursor: FeedCursor | undefined;
  for (;;) {
    const page = feedPage(db, { ...query, limit: pageSize, after: cursor });
    for (const row of page.rows) ids.push(row.globalId);
    if (page.cursor === null) break;
    cursor = page.cursor;
  }
  return ids;
}
