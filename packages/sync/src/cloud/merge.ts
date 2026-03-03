/**
 * Shared Automerge merge helpers for cloud sync.
 * Pure functions — no side effects, safe in both browser and Node.
 */

import * as A from "@automerge/automerge";
import type { FreedDoc } from "@freed/shared/schema";

/**
 * CRDT-merge two raw Automerge binaries and return the merged binary.
 * Neither input is mutated — a fresh document is produced each time.
 */
export function mergeBinaries(a: Uint8Array, b: Uint8Array): Uint8Array {
  const docA = A.load<FreedDoc>(a);
  const docB = A.load<FreedDoc>(b);
  return A.save(A.merge(docA, docB));
}

export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
