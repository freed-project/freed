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
 * INTEGER for the timestamps and flags, TEXT for everything else. `rest` is the
 * only NOT NULL column besides the key: every other column is legitimately
 * absent on some item, and the projection records that absence inside `rest`.
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
  rest              TEXT    NOT NULL
) STRICT;
`.trim();

/**
 * Indexes the Stage 5 and 6 surfaces will read through. Declared here with the
 * schema so the shape the query planner sees is reviewed alongside the columns,
 * not bolted on once a surface is already slow.
 */
export const SHADOW_INDEX_DDL = [
  // The feed's default ordering, filtered to what is not archived or hidden.
  `CREATE INDEX IF NOT EXISTS feed_items_timeline
     ON feed_items (publishedAt DESC)
     WHERE archived IS NOT 1 AND hidden IS NOT 1;`,
  // Saved and archived views, and the counts beside them.
  `CREATE INDEX IF NOT EXISTS feed_items_saved ON feed_items (saved, publishedAt DESC) WHERE saved = 1;`,
  `CREATE INDEX IF NOT EXISTS feed_items_archived ON feed_items (archivedAt DESC) WHERE archived = 1;`,
  // Per-source and per-author grouping.
  `CREATE INDEX IF NOT EXISTS feed_items_platform ON feed_items (platform, publishedAt DESC);`,
  `CREATE INDEX IF NOT EXISTS feed_items_author ON feed_items (authorId, publishedAt DESC);`,
].map((sql) => sql.trim());

export const SHADOW_UPSERT_SQL = `
INSERT INTO feed_items (${SHADOW_COLUMNS.join(", ")})
VALUES (${SHADOW_COLUMNS.map(() => "?").join(", ")})
ON CONFLICT(globalId) DO UPDATE SET
${SHADOW_COLUMNS.filter((c) => c !== "globalId")
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
  for (const sql of SHADOW_INDEX_DDL) db.exec(sql);
}

/** Bind order matches SHADOW_COLUMNS by construction rather than by hand. */
export function rowToParams(row: FeedItemRow): (string | number | null)[] {
  return SHADOW_COLUMNS.map((column) => row[column]);
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
