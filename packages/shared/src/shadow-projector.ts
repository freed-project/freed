/**
 * Keeps the shadow store in step with the Automerge document.
 *
 * Stage 4 built the projection and proved it lossless, and Stage 4b proved the
 * round trip survives a real database. Neither of them writes anything at
 * runtime. This is the part that does, and it is where the interesting failure
 * lives, because a projector is only useful if it cannot silently fall behind.
 *
 * It can fall behind for three reasons, and all three are properties of the
 * existing worker protocol rather than hypotheticals:
 *
 * 1. `ITEM_PATCH.removedItemIds` is declared optional. A delete path that does
 *    not populate it leaves a row in the store for an item that no longer
 *    exists in the document.
 * 2. `ITEM_PATCH` is not the only message that changes the document.
 *    `STATE_UPDATE` replaces state wholesale, and a projector that only follows
 *    patches never sees it.
 * 3. The process restarts. Patches that arrived while it was not running were
 *    not applied to anything.
 *
 * So incremental application alone is not a design, it is half of one. The
 * other half is `reconcile`, which compares the store against the document and
 * repairs the difference, and `driftOf`, which reports the difference without
 * repairing it so drift can be measured before Stage 8 depends on its absence.
 *
 * Stage 8 makes the write path one-way. After that, an item the projector
 * missed is not recoverable from anywhere, which is the whole reason this
 * module reports drift as a first-class result instead of quietly fixing it.
 */

import { projectFeedItem } from "./projection.js";
import { SHADOW_DELETE_SQL, readAllRows, upsertRows } from "./shadow-store.js";
import type { ShadowDatabase } from "./shadow-store.js";
import type { FeedItemRow } from "./projection.js";
import type { FreedDoc } from "./schema.js";
import type { FeedItem } from "./types.js";

/** The subset of a worker ITEM_PATCH this module needs. */
export interface ItemPatchEvent {
  /** Items that still exist, already cloned by the worker. */
  patches: readonly { readonly item: FeedItem }[];
  /** Every id the mutation touched, including ones that were deleted. */
  changedItemIds?: readonly string[];
  /** Ids the mutation removed. Optional in the worker protocol, hence `missingRemovals`. */
  removedItemIds?: readonly string[];
}

export interface RowOperations {
  upserts: FeedItemRow[];
  deletes: string[];
  /**
   * Ids the mutation reported as changed but did not supply an item for, and
   * did not list as removed either. Under the current protocol that means a
   * deletion the sender did not declare. They are treated as deletions, and
   * counted, because a projector that guesses silently is how drift starts.
   */
  missingRemovals: string[];
}

/**
 * Turn one patch event into row operations. Pure, so the interesting decision
 * (what to do about an undeclared removal) is visible in a test rather than
 * buried in an event handler.
 */
export function operationsForPatch(event: ItemPatchEvent): RowOperations {
  const upserts = event.patches.map((patch) => projectFeedItem(patch.item));
  const supplied = new Set(upserts.map((row) => row.globalId));
  const declaredRemovals = event.removedItemIds ?? [];
  const deletes = [...declaredRemovals];

  // An id that changed, produced no item, and was not declared removed. The
  // worker filters `patches` to items that still exist, so this is what a
  // delete looks like when `removedItemIds` was not populated.
  const declared = new Set(declaredRemovals);
  const missingRemovals: string[] = [];
  for (const id of event.changedItemIds ?? []) {
    if (supplied.has(id) || declared.has(id)) continue;
    missingRemovals.push(id);
    deletes.push(id);
  }

  return { upserts, deletes, missingRemovals };
}

export function applyOperations(db: ShadowDatabase, operations: RowOperations): void {
  if (operations.upserts.length > 0) upsertRows(db, operations.upserts);
  if (operations.deletes.length > 0) {
    const statement = db.prepare(SHADOW_DELETE_SQL);
    for (const globalId of operations.deletes) statement.run(globalId);
  }
}

/** Apply one worker patch event to the store. Returns what it did. */
export function applyItemPatch(db: ShadowDatabase, event: ItemPatchEvent): RowOperations {
  const operations = operationsForPatch(event);
  applyOperations(db, operations);
  return operations;
}

export interface ProjectionDrift {
  /** In the document, absent from the store. The projector missed an insert. */
  missingFromStore: string[];
  /** In the store, absent from the document. The projector missed a delete. */
  staleInStore: string[];
  /** Present in both, but the projected row differs. The projector missed an update. */
  divergentRows: string[];
  itemsInDocument: number;
  rowsInStore: number;
}

export function isDrifted(drift: ProjectionDrift): boolean {
  return (
    drift.missingFromStore.length > 0 ||
    drift.staleInStore.length > 0 ||
    drift.divergentRows.length > 0
  );
}

/**
 * Compare the store against the document without changing either.
 *
 * Reported rather than repaired on purpose. Before Stage 8 the document is
 * still the source of truth, so drift is a bug to be found and fixed at its
 * cause. A projector that silently self-heals would hide exactly the defect
 * that has to be gone before the write path becomes one-way.
 */
export function driftOf(db: ShadowDatabase, doc: FreedDoc): ProjectionDrift {
  const items = (doc.feedItems ?? {}) as Record<string, FeedItem>;
  const stored = new Map<string, FeedItemRow>();
  for (const row of readAllRows(db)) stored.set(row.globalId, row);

  const missingFromStore: string[] = [];
  const divergentRows: string[] = [];
  for (const [globalId, item] of Object.entries(items)) {
    const row = stored.get(globalId);
    if (row === undefined) {
      missingFromStore.push(globalId);
      continue;
    }
    const expected = projectFeedItem(item);
    for (const key of Object.keys(expected) as (keyof FeedItemRow)[]) {
      if (!Object.is(expected[key], row[key])) {
        divergentRows.push(globalId);
        break;
      }
    }
  }

  const staleInStore: string[] = [];
  for (const globalId of stored.keys()) {
    if (!Object.prototype.hasOwnProperty.call(items, globalId)) {
      staleInStore.push(globalId);
    }
  }

  return {
    missingFromStore,
    staleInStore,
    divergentRows,
    itemsInDocument: Object.keys(items).length,
    rowsInStore: stored.size,
  };
}

/**
 * Bring the store into agreement with the document and report what was wrong.
 *
 * Used at startup and after any message that replaces state wholesale. The
 * returned drift describes the state BEFORE the repair, so a caller can log or
 * alarm on it. Repairing without reporting would make the projector look
 * correct precisely when it is not.
 */
export function reconcile(db: ShadowDatabase, doc: FreedDoc): ProjectionDrift {
  const drift = driftOf(db, doc);
  if (!isDrifted(drift)) return drift;

  const items = (doc.feedItems ?? {}) as Record<string, FeedItem>;
  const upserts: FeedItemRow[] = [];
  for (const globalId of [...drift.missingFromStore, ...drift.divergentRows]) {
    const item = items[globalId];
    if (item !== undefined) upserts.push(projectFeedItem(item));
  }
  applyOperations(db, { upserts, deletes: drift.staleInStore, missingRemovals: [] });
  return drift;
}

/** Project an entire document into an empty store. Startup, and the Stage 4b tests. */
export function projectAll(db: ShadowDatabase, doc: FreedDoc): number {
  const items = Object.values((doc.feedItems ?? {}) as Record<string, FeedItem>);
  upsertRows(db, items.map((item) => projectFeedItem(item)));
  return items.length;
}
