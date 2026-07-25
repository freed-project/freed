/**
 * Shared Automerge merge helpers for cloud sync.
 * Pure functions — no side effects, safe in both browser and Node.
 */

import * as A from "@automerge/automerge";
import {
  assertNonDestructiveMerge,
  evaluateDestructiveMergeGuard,
  type DestructiveMergeGuardOptions,
  type DestructiveMergeGuardReport,
  type FreedDoc,
} from "@freed/shared/schema";

/**
 * A stale empty first-sync document can carry delete history that resolves a
 * populated cloud feed to empty. Recover only that guard-blocked full wipe.
 * Restoring entries onto the merged document keeps every non-feed merge result
 * and both input histories instead of replacing the document with one input.
 */
function restorePopulatedFeedAfterBlockedEmptyMerge(
  localDoc: FreedDoc,
  incomingDoc: FreedDoc,
  mergedDoc: FreedDoc,
  guard: DestructiveMergeGuardReport,
): FreedDoc {
  if (!guard.blocked || guard.mergedItemCount !== 0) return mergedDoc;

  const populatedDoc =
    guard.localItemCount > 0 && guard.incomingItemCount === 0
      ? localDoc
      : guard.incomingItemCount > 0 && guard.localItemCount === 0
        ? incomingDoc
        : null;
  if (!populatedDoc) return mergedDoc;

  const populatedItems = A.toJS(populatedDoc).feedItems;
  const restored = A.change(
    A.clone(mergedDoc),
    "Restore populated feed after blocked empty cloud merge",
    (draft) => {
      for (const [id, item] of Object.entries(populatedItems)) {
        draft.feedItems[id] = item;
      }
    },
  );
  return restored;
}

/**
 * How a caller performs the cloud CRDT merge.
 *
 * `mergeBinaries` loads two full documents and merges them, which on the
 * owner's real 15,846-item document peaks at 1,356 MB. WebAssembly.Memory
 * grows and never shrinks, so whichever thread runs it keeps that peak as a
 * permanent floor for the life of the instance.
 *
 * Desktop therefore injects a strategy that runs the merge in a worker it
 * terminates afterward, which is the only way to give the memory back. This
 * stays an injected strategy rather than an import because packages/sync must
 * remain storage-agnostic and run in a browser, in Node, and in the PWA, none
 * of which have the desktop's worker.
 */
export type CloudMergeStrategy = (
  local: Uint8Array,
  remote: Uint8Array,
  options?: DestructiveMergeGuardOptions,
) => Promise<Uint8Array>;

/** Default strategy: merge in the calling thread. */
export const inProcessCloudMerge: CloudMergeStrategy = async (
  local,
  remote,
  options,
) => mergeBinaries(local, remote, options);

/**
 * CRDT-merge two raw Automerge binaries and return the merged binary.
 * Neither input is mutated — a fresh document is produced each time.
 */
export function mergeBinaries(
  a: Uint8Array,
  b: Uint8Array,
  options: DestructiveMergeGuardOptions = {},
): Uint8Array {
  const docA = A.load<FreedDoc>(a);
  const docB = A.load<FreedDoc>(b);
  const merged = A.merge(docA, docB);
  const guardOptions = {
    source: "cloud upload",
    ...options,
  };
  const guard = evaluateDestructiveMergeGuard(docA, docB, merged, guardOptions);
  if (!guard.blocked) return A.save(merged);

  const resolved = restorePopulatedFeedAfterBlockedEmptyMerge(
    docA,
    docB,
    merged,
    guard,
  );
  if (resolved === merged) throw new Error(guard.message);

  assertNonDestructiveMerge(docA, docB, resolved, guardOptions);
  return A.save(resolved);
}

export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
