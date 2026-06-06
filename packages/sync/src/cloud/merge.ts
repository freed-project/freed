/**
 * Shared Automerge merge helpers for cloud sync.
 * Pure functions — no side effects, safe in both browser and Node.
 */

import * as A from "@automerge/automerge";
import {
  assertNonDestructiveMerge,
  choosePopulatedInputForEmptyMerge,
  type DestructiveMergeGuardOptions,
  type FreedDoc,
} from "@freed/shared/schema";

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
  const populatedSide = choosePopulatedInputForEmptyMerge(docA, docB, merged);
  const resolved = populatedSide === "local" ? docA : populatedSide === "incoming" ? docB : merged;
  assertNonDestructiveMerge(docA, docB, resolved, {
    source: "cloud upload",
    ...options,
  });
  return A.save(resolved);
}

export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
