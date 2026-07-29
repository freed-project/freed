/**
 * The shadow store: the SQL half of Stage 4.
 *
 * `projection.ts` proves a feed item survives being flattened into a row and
 * rebuilt. That proof is entirely in memory, and it is not sufficient. SQLite
 * applies type affinity on the way in, and affinity is not a no-op:
 *
 *     CREATE TABLE t (a INTEGER, b TEXT);
 *     INSERT INTO t VALUES ('12345', 2);
 *     SELECT typeof(a), a, typeof(b), b FROM t;
 *     -- integer | 12345 | text | '2.0'
 *
 * The string became a number, and the number became the string "2.0", which is
 * not even the text of what was passed. A projection that is lossless in memory
 * can still lose data the moment it is stored. Stage 8 makes that unrecoverable,
 * so the round trip has to be proved through a real database.
 *
 * Two decisions follow.
 *
 * STRICT tables. They reject a value that cannot convert losslessly, turning a
 * silent coercion into an error at the write. Note what STRICT does NOT do: it
 * still accepts '12345' into an INTEGER column, because that conversion is
 * lossless by its definition and not by ours. STRICT is a backstop, not the
 * guarantee.
 *
 * The guarantee is the projector. `asStringColumn` and `asNumberColumn` return
 * null for anything of the wrong JS type, which sends the value to the `__raw`
 * escape inside a TEXT column holding JSON. So only strings ever reach a TEXT
 * column and only finite numbers ever reach a numeric one, and affinity has
 * nothing left to convert. That is a claim about a code path, which is why
 * `diffThroughStore` exists to test it against real data rather than assert it.
 *
 * No SQLite driver is imported here. Desktop binds rusqlite, the PWA binds
 * sqlite-wasm, and tests bind node:sqlite; all three speak the narrow interface
 * below. Keeping the schema and the row mapping in shared is what lets a single
 * conformance test cover every engine.
 */

import { diffProjection, projectFeedItem, reconstructFeedItem } from "./projection.js";
import type { FeedItemRow, ProjectionMismatch } from "./projection.js";
import type { FreedDoc } from "./schema.js";
import type { FeedItem } from "./types.js";

/**
 * Column order is declared once and everything else derives from it, so a
 * column cannot be added to the table and forgotten in the INSERT.
 */
export const SHADOW_COLUMNS = [
  "globalId",
  "platform",
  "contentType",
  "publishedAt",
  "capturedAt",
  "authorId",
  "authorDisplayName",
  "authorHandle",
  "sourceUrl",
  "hidden",
  "saved",
  "archived",
  "readAt",
  "archivedAt",
  "likedAt",
  "tags",
  "contentBlob",
  "preservedBlob",
  "rest",
] as const satisfies readonly (keyof FeedItemRow)[];

export type ShadowColumn = (typeof SHADOW_COLUMNS)[number];

/**
 * Derived columns exist only so the query planner can order without sorting.
 * They are written, never read back, and never reconstructed, which is why they
 * are deliberately absent from `SHADOW_COLUMNS` and from `FeedItemRow`: the
 * round-trip differ compares authoritative data, and a derived value has
 * nothing to say about whether the projection lost anything.
 */
export const SHADOW_DERIVED_COLUMNS = ["sortAt"] as const;

/**
 * Sort position for an item whose `publishedAt` is absent, null, or a value the
 * column cannot hold. Ordering is `sortAt DESC`, so this places undated items
 * at the far end of the timeline.
 *
 * This is not a timestamp and is never presented as one. `publishedAt` stays
 * nullable and authoritative, and `__absent` still records that the field was
 * missing, so nothing here fabricates a date. That distinction is the whole
 * reason for a separate column rather than `COALESCE(publishedAt, 0)` in the
 * schema: writing the sentinel into `publishedAt` itself would be exactly the
 * irreversible fabrication the projection was built to prevent.
 *
 * An item genuinely published at epoch zero shares this sort position. The two
 * remain distinguishable in `publishedAt`, and the `globalId` tie-break keeps
 * the total order strict either way.
 */
export const SORT_AT_ABSENT = 0;

/**
 * The sort key is defensive because it must satisfy NOT NULL for every row the
 * table will accept. A non-integer `publishedAt` cannot reach a STRICT INTEGER
 * column at all, so the fallback is unreachable in practice; it exists so the
 * invariant is guaranteed by construction rather than by that argument holding
 * forever.
 */
export function sortKeyOf(row: FeedItemRow): number {
  return Number.isSafeInteger(row.publishedAt)
    ? (row.publishedAt as number)
    : SORT_AT_ABSENT;
}

/**
 * INTEGER for the timestamps and flags, TEXT for everything else. `rest` and
 * the derived `sortAt` are the only NOT NULL columns besides the key: every
 * other column is legitimately absent on some item, and the projection records
 * that absence inside `rest`.
 */
export const SHADOW_TABLE_DDL = `
CREATE TABLE IF NOT EXISTS feed_items (
  globalId          TEXT    NOT NULL PRIMARY KEY,
  platform          TEXT,
  contentType       TEXT,
  publishedAt       INTEGER,
  capturedAt        INTEGER,
  authorId          TEXT,
  authorDisplayName TEXT,
  authorHandle      TEXT,
  sourceUrl         TEXT,
  hidden            INTEGER,
  saved             INTEGER,
  archived          INTEGER,
  readAt            INTEGER,
  archivedAt        INTEGER,
  likedAt           INTEGER,
  tags              TEXT,
  contentBlob       TEXT,
  preservedBlob     TEXT,
  rest              TEXT    NOT NULL,
  sortAt            INTEGER NOT NULL
) STRICT;
`.trim();

/**
 * Projection revision is advanced in the same transaction as row changes.
 * Readers bind page and count results to it so a cursor cannot silently walk
 * across two different projections.
 */
export const SHADOW_META_DDL = `
CREATE TABLE IF NOT EXISTS library_meta (
  key          TEXT    NOT NULL PRIMARY KEY,
  integerValue INTEGER NOT NULL
) STRICT;

INSERT OR IGNORE INTO library_meta (key, integerValue)
VALUES ('projectionRevision', 0);
`.trim();

/** Version of the physical shadow schema consumed by every SQLite adapter. */
export const SHADOW_SCHEMA_VERSION_DDL = "PRAGMA user_version = 1;";

/**
 * Indexes the Stage 5 and 6 surfaces will read through. Declared here with the
 * schema so the shape the query planner sees is reviewed alongside the columns,
 * not bolted on once a surface is already slow.
 */
export const SHADOW_INDEX_DDL = [
  // The feed's default ordering, filtered to what is not archived or hidden.
  //
  // Both columns of the feed_page_v1 sort contract are in the index, and in its
  // exact direction, so a keyset page is an index range scan. Ordering by the
  // nullable `publishedAt` instead would force `ORDER BY publishedAt IS NULL,
  // ...` to keep undated items at the end, and that leading expression is not
  // index-satisfiable: SQLite falls back to USE TEMP B-TREE FOR ORDER BY and
  // sorts the whole remaining set on every page. Measured first-page cost with
  // that shape was 0.24ms at 4k rows, 4.22ms at 64k and 15.82ms at 256k, rising
  // with the corpus; against this index it is flat at ~0.03ms across the same
  // range. A bounded result with unbounded work is the failure Library Core
  // exists to remove, so the sort key is a column rather than an expression.
  `CREATE INDEX IF NOT EXISTS feed_items_timeline
     ON feed_items (sortAt DESC, globalId ASC)
     WHERE archived IS NOT 1 AND hidden IS NOT 1;`,
  // Saved and archived views, and the counts beside them. These still order by
  // the authoritative column: their queries' sort contracts are unresolved, and
  // switching them would presuppose decisions this slice has not measured. Each
  // needs the same treatment when its contract is resolved.
  `CREATE INDEX IF NOT EXISTS feed_items_saved ON feed_items (saved, publishedAt DESC) WHERE saved = 1;`,
  `CREATE INDEX IF NOT EXISTS feed_items_archived ON feed_items (archivedAt DESC) WHERE archived = 1;`,
  // Per-source and per-author grouping.
  `CREATE INDEX IF NOT EXISTS feed_items_platform ON feed_items (platform, publishedAt DESC);`,
  `CREATE INDEX IF NOT EXISTS feed_items_author ON feed_items (authorId, publishedAt DESC);`,
].map((sql) => sql.trim());

/**
 * Written columns are the authoritative ones plus the derived ones. Reads stay
 * on `SHADOW_COLUMNS` alone, so a derived value can never re-enter the document
 * it was computed from.
 */
const SHADOW_WRITE_COLUMNS = [
  ...SHADOW_COLUMNS,
  ...SHADOW_DERIVED_COLUMNS,
] as const;

export const SHADOW_UPSERT_SQL = `
INSERT INTO feed_items (${SHADOW_WRITE_COLUMNS.join(", ")})
VALUES (${SHADOW_WRITE_COLUMNS.map(() => "?").join(", ")})
ON CONFLICT(globalId) DO UPDATE SET
${SHADOW_WRITE_COLUMNS.filter((c) => c !== "globalId")
  .map((c) => `  ${c} = excluded.${c}`)
  .join(",\n")};
`.trim();

export const SHADOW_SELECT_ALL_SQL = `SELECT ${SHADOW_COLUMNS.join(", ")} FROM feed_items;`;
export const SHADOW_SELECT_ONE_SQL = `SELECT ${SHADOW_COLUMNS.join(", ")} FROM feed_items WHERE globalId = ?;`;
export const SHADOW_DELETE_SQL = `DELETE FROM feed_items WHERE globalId = ?;`;

/** The slice of a SQLite driver this module needs. rusqlite, sqlite-wasm and node:sqlite all fit. */
export interface ShadowStatement {
  run(...params: readonly (string | number | null)[]): unknown;
  all(...params: readonly (string | number | null)[]): unknown[];
}

export interface ShadowDatabase {
  exec(sql: string): void;
  prepare(sql: string): ShadowStatement;
}

export function createShadowSchema(db: ShadowDatabase): void {
  db.exec(SHADOW_TABLE_DDL);
  db.exec(SHADOW_META_DDL);
  for (const sql of SHADOW_INDEX_DDL) db.exec(sql);
  db.exec(SHADOW_SCHEMA_VERSION_DDL);
}

/** Bind order matches SHADOW_WRITE_COLUMNS by construction rather than by hand. */
export function rowToParams(row: FeedItemRow): (string | number | null)[] {
  return [...SHADOW_COLUMNS.map((column) => row[column]), sortKeyOf(row)];
}

/**
 * Rebuild a row from what the database returned. Drivers differ in how they
 * present a result, so read defensively and let the differ report anything the
 * engine changed rather than papering over it here.
 */
export function paramsToRow(record: Record<string, unknown>): FeedItemRow {
  const out = {} as Record<ShadowColumn, unknown>;
  for (const column of SHADOW_COLUMNS) out[column] = record[column] ?? null;
  return out as unknown as FeedItemRow;
}

export function upsertRows(db: ShadowDatabase, rows: readonly FeedItemRow[]): void {
  const statement = db.prepare(SHADOW_UPSERT_SQL);
  for (const row of rows) statement.run(...rowToParams(row));
}

export function readAllRows(db: ShadowDatabase): FeedItemRow[] {
  return db
    .prepare(SHADOW_SELECT_ALL_SQL)
    .all()
    .map((record) => paramsToRow(record as Record<string, unknown>));
}

export interface StoreRoundTripReport {
  itemsProjected: number;
  rowsReadBack: number;
  /** Fields that did not survive projection, before SQLite is involved at all. */
  projectionMismatches: ProjectionMismatch[];
  /** Fields that survived projection but not storage. These are affinity damage. */
  storageMismatches: ProjectionMismatch[];
}

/**
 * Project a document into the store, read every row back out, rebuild the items
 * and compare. Splitting the two mismatch lists is the point: a projection bug
 * and an affinity bug need different fixes, and a single combined number would
 * hide which one is happening.
 */
export function diffThroughStore(db: ShadowDatabase, doc: FreedDoc): StoreRoundTripReport {
  const items = Object.entries((doc.feedItems ?? {}) as Record<string, FeedItem>);

  const rows = items.map(([, item]) => projectFeedItem(item));
  upsertRows(db, rows);

  const readBack = new Map<string, FeedItemRow>();
  for (const row of readAllRows(db)) readBack.set(row.globalId, row);

  const storageMismatches: ProjectionMismatch[] = [];
  for (let index = 0; index < items.length; index += 1) {
    const entry = items[index];
    const written = rows[index];
    if (entry === undefined || written === undefined) continue;
    const [globalId] = entry;
    const stored = readBack.get(globalId);
    if (stored === undefined) {
      storageMismatches.push({
        globalId,
        path: "<row>",
        original: "present",
        roundTripped: "missing",
      });
      continue;
    }
    // Compare the row the projector produced against the row the engine
    // returned, column by column. This isolates affinity: both sides went
    // through the identical projection, so any difference is the database.
    for (const column of SHADOW_COLUMNS) {
      if (!Object.is(written[column], stored[column])) {
        storageMismatches.push({
          globalId,
          path: column,
          original: written[column],
          roundTripped: stored[column],
        });
      }
    }
  }

  return {
    itemsProjected: items.length,
    rowsReadBack: readBack.size,
    projectionMismatches: diffProjection(doc),
    storageMismatches,
  };
}

/** Rebuild every item from stored rows. Used to prove the store alone can reproduce the corpus. */
export function reconstructAllFromStore(db: ShadowDatabase): Record<string, unknown>[] {
  return readAllRows(db).map((row) => reconstructFeedItem(row));
}
