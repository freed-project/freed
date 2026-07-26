/**
 * Projection of the Automerge document into flat rows for the shadow store.
 *
 * Stage 4 of the storage roadmap. Nothing reads these rows yet. The entire
 * point of this stage is to prove, against a real corpus, that the projection
 * loses nothing before any surface depends on it. Stage 8 makes the write path
 * one-way; a field silently dropped by the projector becomes unrecoverable once
 * the retained Automerge copy is pruned, so the differ below is the safeguard
 * that has to exist first.
 *
 * Two rules earn their keep here, both learned from the differ failing:
 *
 * 1. Absence is data. An early draft wrote `String(author.name ?? "")` and
 *    `asEpoch(publishedAt) ?? 0`, which turns "this field was never set" into
 *    "this field is empty string / epoch zero". That is fabrication, and it is
 *    irreversible. Every modelled path that is missing is recorded in
 *    `__absent` so reconstruction can omit it again. A column holding null
 *    means present-and-null, which is a different fact.
 *
 * 2. Untyped reads are the enemy. The same draft read `author.name`, a field
 *    that does not exist on `Author` (it is `displayName`), and the cast to
 *    Record<string, unknown> hid that from tsc. Reads go through the declared
 *    types wherever possible so the compiler stays useful.
 *
 * Deliberately pure and dependency-free. It runs identically in the worker, in
 * a test, and eventually against rows read back out of SQLite, which is what
 * makes a round-trip comparison meaningful.
 */

import { FEED_ITEM_WRITE_POLICY, dispositionOf, tierOf } from "./sync-write-policy.js";
import type { FreedDoc } from "./schema.js";
import type { FeedItem } from "./types.js";

/** Columns that live in the row itself, queried directly. */
export interface FeedItemRow {
  globalId: string;
  platform: string | null;
  contentType: string | null;
  publishedAt: number | null;
  capturedAt: number | null;
  authorId: string | null;
  authorDisplayName: string | null;
  authorHandle: string | null;
  sourceUrl: string | null;
  /** userState, flattened because filtering and counts read it on every query. */
  hidden: number | null;
  saved: number | null;
  archived: number | null;
  readAt: number | null;
  archivedAt: number | null;
  likedAt: number | null;
  tags: string | null;
  /** Blob-tier payloads, addressed by the row and stored outside it. */
  contentBlob: string | null;
  preservedBlob: string | null;
  /** Everything the columns above do not model, preserved verbatim. */
  rest: string;
}

/**
 * Fields represented by a dedicated column above. Anything NOT listed here is
 * carried in `rest`, which is what makes the projection lossless by
 * construction rather than by remembering to update it.
 */
const MODELLED_FIELDS: ReadonlySet<string> = new Set([
  "globalId",
  "platform",
  "contentType",
  "publishedAt",
  "capturedAt",
  "author",
  "sourceUrl",
  "userState",
  "content",
  "preservedContent",
]);

/** userState keys with their own column. The rest ride along in `__userState`. */
const MODELLED_USER_STATE: ReadonlySet<string> = new Set([
  "hidden",
  "saved",
  "archived",
  "readAt",
  "archivedAt",
  "likedAt",
  "tags",
]);

/** author keys with their own column. The rest ride along in `__author`. */
const MODELLED_AUTHOR: ReadonlySet<string> = new Set(["id", "displayName", "handle"]);

/**
 * Tracks the two ways a typed column can fail to be the whole truth.
 *
 * `absent` records dotted paths that were missing, so a null column can still
 * be told apart from a missing one. `raw` records paths whose value the column
 * cannot represent, with the real value carried alongside.
 *
 * `raw` is what makes losslessness structural instead of true-by-luck. Columns
 * are a query optimization layered over a document with no enforced schema:
 * `publishedAt` is declared `number`, but nothing stopped a past write from
 * putting NaN or a string there, and three items in the owner's corpus prove
 * the declared type is not a guarantee. Rather than trusting every historical
 * writer, anything that does not fit its column falls back to `raw` and comes
 * back out unchanged.
 */
class ColumnEscapes {
  private readonly absentPaths: string[] = [];
  private readonly rawValues: Record<string, unknown> = {};

  /** Returns the value when the key exists, and notes the absence when it does not. */
  read(container: Record<string, unknown> | undefined, key: string, path: string): unknown {
    if (container === undefined || !Object.prototype.hasOwnProperty.call(container, key)) {
      this.absentPaths.push(path);
      return undefined;
    }
    return container[key];
  }

  /**
   * Coerce a value into its column. When the coercion is not faithful, keep the
   * column null and stash the original so reconstruction can restore it.
   */
  column<T>(value: unknown, path: string, coerce: (v: unknown) => T | null): T | null {
    if (value === undefined || value === null) return null;
    const coerced = coerce(value);
    if (coerced === null) {
      this.rawValues[path] = value;
      return null;
    }
    return coerced;
  }

  /**
   * Read a field whose contents are spread across several columns. Returns the
   * object to project from, or undefined when there is nothing to spread —
   * either because the field is missing, or because it is present but not an
   * object, in which case it is preserved verbatim in `raw`.
   */
  subObject(
    container: Record<string, unknown>,
    key: string,
  ): Record<string, unknown> | undefined {
    const value = this.read(container, key, key);
    if (value === undefined) return undefined;
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
      this.rawValues[key] = value;
      return undefined;
    }
    return value as Record<string, unknown>;
  }

  absent(): string[] {
    return this.absentPaths;
  }

  raw(): Record<string, unknown> {
    return this.rawValues;
  }
}

/**
 * JSON cannot represent NaN or the infinities; `JSON.stringify` emits `null`
 * for all three. The owner's corpus contains three items whose
 * `preservedContent.publishedAt` is NaN, from an upstream date parse that
 * produced an invalid Date. Silently rewriting those to null would be a data
 * repair performed by the storage layer, which is the wrong place for it: the
 * projector's contract is to be a faithful pipe, and repairing corrupt
 * timestamps is a separate change with its own migration and its own review.
 * So they are encoded and restored exactly, and the corpus defect stays
 * visible to whoever fixes it.
 */
const NON_FINITE_TAG = "__nonFinite";

function jsonReplacer(this: unknown, _key: string, value: unknown): unknown {
  // `this[key]` would give the pre-toJSON value; `value` is what gets written,
  // which is what has to survive, so test that.
  if (typeof value === "number" && !Number.isFinite(value)) {
    return { [NON_FINITE_TAG]: String(value) };
  }
  return value;
}

function jsonReviver(_key: string, value: unknown): unknown {
  if (value !== null && typeof value === "object" && NON_FINITE_TAG in value) {
    return Number((value as Record<string, string>)[NON_FINITE_TAG]);
  }
  return value;
}

export function encodeJson(value: unknown): string {
  return JSON.stringify(value, jsonReplacer);
}

export function decodeJson(text: string): unknown {
  return JSON.parse(text, jsonReviver);
}

function asNumberColumn(value: unknown): number | null {
  // Only finite numbers survive a SQLite numeric column and a JSON round trip.
  // Anything else is left for the differ to flag rather than silently coerced.
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function asStringColumn(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function asBoolColumn(value: unknown): number | null {
  return typeof value === "boolean" ? (value ? 1 : 0) : null;
}

export function projectFeedItem(item: FeedItem): FeedItemRow {
  const absent = new ColumnEscapes();
  const raw = item as unknown as Record<string, unknown>;

  // `author` and `userState` are spread across several columns each, so a value
  // that is present but not an object has nowhere to go. Route it to the raw
  // escape rather than letting reconstruction rebuild `null` as `{}`. The
  // corpus contains no such value; this holds the invariant structurally so a
  // future writer cannot quietly break it.
  const author = absent.subObject(raw, "author");
  const userState = absent.subObject(raw, "userState");

  const rest: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (MODELLED_FIELDS.has(key)) continue;
    rest[key] = value;
  }

  // userState carries more than the flattened flags (sync acknowledgement
  // timestamps, likedSyncedAt's three-state sentinel). Keep the remainder so a
  // round trip reproduces it exactly.
  if (userState !== undefined) {
    const userStateRest: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(userState)) {
      if (MODELLED_USER_STATE.has(key)) continue;
      userStateRest[key] = value;
    }
    if (Object.keys(userStateRest).length > 0) rest.__userState = userStateRest;
  }

  if (author !== undefined) {
    const authorRest: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(author)) {
      if (MODELLED_AUTHOR.has(key)) continue;
      authorRest[key] = value;
    }
    if (Object.keys(authorRest).length > 0) rest.__author = authorRest;
  }

  const platform = absent.read(raw, "platform", "platform");
  const contentType = absent.read(raw, "contentType", "contentType");
  const publishedAt = absent.read(raw, "publishedAt", "publishedAt");
  const capturedAt = absent.read(raw, "capturedAt", "capturedAt");
  const sourceUrl = absent.read(raw, "sourceUrl", "sourceUrl");
  const content = absent.read(raw, "content", "content");
  const preserved = absent.read(raw, "preservedContent", "preservedContent");

  const authorId = author && absent.read(author, "id", "author.id");
  const authorDisplayName =
    author && absent.read(author, "displayName", "author.displayName");
  const authorHandle = author && absent.read(author, "handle", "author.handle");

  const hidden = userState && absent.read(userState, "hidden", "userState.hidden");
  const saved = userState && absent.read(userState, "saved", "userState.saved");
  const archived = userState && absent.read(userState, "archived", "userState.archived");
  const readAt = userState && absent.read(userState, "readAt", "userState.readAt");
  const archivedAt = userState && absent.read(userState, "archivedAt", "userState.archivedAt");
  const likedAt = userState && absent.read(userState, "likedAt", "userState.likedAt");
  const tags = userState && absent.read(userState, "tags", "userState.tags");

  const row: FeedItemRow = {
    globalId: String(item.globalId),
    platform: absent.column(platform, "platform", asStringColumn),
    contentType: absent.column(contentType, "contentType", asStringColumn),
    publishedAt: absent.column(publishedAt, "publishedAt", asNumberColumn),
    capturedAt: absent.column(capturedAt, "capturedAt", asNumberColumn),
    authorId: absent.column(authorId, "author.id", asStringColumn),
    authorDisplayName: absent.column(
      authorDisplayName,
      "author.displayName",
      asStringColumn,
    ),
    authorHandle: absent.column(authorHandle, "author.handle", asStringColumn),
    sourceUrl: absent.column(sourceUrl, "sourceUrl", asStringColumn),
    hidden: absent.column(hidden, "userState.hidden", asBoolColumn),
    saved: absent.column(saved, "userState.saved", asBoolColumn),
    archived: absent.column(archived, "userState.archived", asBoolColumn),
    readAt: absent.column(readAt, "userState.readAt", asNumberColumn),
    archivedAt: absent.column(archivedAt, "userState.archivedAt", asNumberColumn),
    likedAt: absent.column(likedAt, "userState.likedAt", asNumberColumn),
    tags: tags === undefined ? null : encodeJson(tags),
    contentBlob: content === undefined ? null : encodeJson(content),
    preservedBlob: preserved === undefined ? null : encodeJson(preserved),
    rest: "",
  };

  // Written last: the escape records are only complete once every column above
  // has been attempted.
  const absentPaths = absent.absent();
  if (absentPaths.length > 0) rest.__absent = absentPaths;
  const rawValues = absent.raw();
  if (Object.keys(rawValues).length > 0) rest.__raw = rawValues;
  row.rest = encodeJson(rest);
  return row;
}

/** Reconstruct the item a row came from. Used by the differ, not by the app. */
export function reconstructFeedItem(row: FeedItemRow): Record<string, unknown> {
  const rest = decodeJson(row.rest) as Record<string, unknown>;
  const userStateRest = (rest.__userState ?? undefined) as Record<string, unknown> | undefined;
  const authorRest = (rest.__author ?? undefined) as Record<string, unknown> | undefined;
  const absent = new Set((rest.__absent ?? []) as string[]);
  const rawValues = (rest.__raw ?? {}) as Record<string, unknown>;
  delete rest.__userState;
  delete rest.__author;
  delete rest.__absent;
  delete rest.__raw;

  const put = (
    target: Record<string, unknown>,
    key: string,
    path: string,
    value: unknown,
  ): void => {
    if (absent.has(path)) return;
    // A raw override always wins: the column was null because it could not hold
    // the real value, not because the value was null.
    target[key] = Object.prototype.hasOwnProperty.call(rawValues, path)
      ? rawValues[path]
      : value;
  };

  const item: Record<string, unknown> = { globalId: row.globalId };
  put(item, "platform", "platform", row.platform);
  put(item, "contentType", "contentType", row.contentType);
  put(item, "publishedAt", "publishedAt", row.publishedAt);
  put(item, "capturedAt", "capturedAt", row.capturedAt);
  put(item, "sourceUrl", "sourceUrl", row.sourceUrl);

  if (Object.prototype.hasOwnProperty.call(rawValues, "author")) {
    item.author = rawValues.author;
  } else if (!absent.has("author")) {
    const author: Record<string, unknown> = {};
    put(author, "id", "author.id", row.authorId);
    put(author, "displayName", "author.displayName", row.authorDisplayName);
    put(author, "handle", "author.handle", row.authorHandle);
    Object.assign(author, authorRest ?? {});
    item.author = author;
  }

  if (Object.prototype.hasOwnProperty.call(rawValues, "userState")) {
    item.userState = rawValues.userState;
  } else if (!absent.has("userState")) {
    const userState: Record<string, unknown> = {};
    put(userState, "hidden", "userState.hidden", row.hidden === null ? null : row.hidden === 1);
    put(userState, "saved", "userState.saved", row.saved === null ? null : row.saved === 1);
    put(
      userState,
      "archived",
      "userState.archived",
      row.archived === null ? null : row.archived === 1,
    );
    put(userState, "readAt", "userState.readAt", row.readAt);
    put(userState, "archivedAt", "userState.archivedAt", row.archivedAt);
    put(userState, "likedAt", "userState.likedAt", row.likedAt);
    put(
      userState,
      "tags",
      "userState.tags",
      row.tags === null ? null : decodeJson(row.tags),
    );
    Object.assign(userState, userStateRest ?? {});
    item.userState = userState;
  }

  if (!absent.has("content")) {
    item.content = row.contentBlob === null ? null : decodeJson(row.contentBlob);
  }
  if (!absent.has("preservedContent")) {
    item.preservedContent =
      row.preservedBlob === null ? null : decodeJson(row.preservedBlob);
  }

  Object.assign(item, rest);
  return item;
}

export interface ProjectionMismatch {
  globalId: string;
  path: string;
  original: unknown;
  roundTripped: unknown;
}

/** Deep structural comparison, order-insensitive for object keys. */
function collectMismatches(
  original: unknown,
  roundTripped: unknown,
  path: string,
  globalId: string,
  out: ProjectionMismatch[],
): void {
  // Object.is rather than ===, on both counts: NaN must compare equal to the
  // NaN it round-tripped into, and +0 must NOT compare equal to -0, which is a
  // real difference a numeric column can introduce.
  if (Object.is(original, roundTripped)) return;
  const bothObjects =
    original !== null &&
    roundTripped !== null &&
    typeof original === "object" &&
    typeof roundTripped === "object";
  if (!bothObjects) {
    out.push({ globalId, path, original, roundTripped });
    return;
  }
  if (Array.isArray(original) !== Array.isArray(roundTripped)) {
    out.push({ globalId, path, original, roundTripped });
    return;
  }
  const a = original as Record<string, unknown>;
  const b = roundTripped as Record<string, unknown>;
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const key of keys) {
    collectMismatches(a[key], b[key], path ? `${path}.${key}` : key, globalId, out);
  }
}

/**
 * Project every item, reconstruct it, and report every field that did not
 * survive. An empty result is the evidence Stage 8 depends on.
 */
export function diffProjection(doc: FreedDoc): ProjectionMismatch[] {
  const out: ProjectionMismatch[] = [];
  for (const [globalId, item] of Object.entries(doc.feedItems ?? {})) {
    const row = projectFeedItem(item as FeedItem);
    const back = reconstructFeedItem(row);
    collectMismatches(item, back, "", globalId, out);
  }
  return out;
}

/** Fields the Stage 3 contract marks blob-tier, which the projector must move out of the row. */
export function blobTierFields(): string[] {
  return Object.entries(FEED_ITEM_WRITE_POLICY)
    .filter(([, policy]) => tierOf(policy) === "blob")
    .map(([field]) => field);
}

/** Fields the contract says never leave the device, which must not be projected into a synced tier. */
export function deviceLocalFields(): string[] {
  return Object.entries(FEED_ITEM_WRITE_POLICY)
    .filter(([, policy]) => dispositionOf(policy) === "device-local")
    .map(([field]) => field);
}
