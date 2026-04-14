import * as A from "@automerge/automerge";
import type { FreedDoc } from "@freed/shared/schema";

const MIN_SNAPSHOT_BYTES_BEFORE_INCREMENTAL = 1_024;

export interface AutomergePersistenceState {
  binary: Uint8Array | null;
  baseSnapshotBytes: number;
  incrementalBytesSinceSnapshot: number;
}

export interface PersistDocResult {
  binary: Uint8Array;
  persistence: AutomergePersistenceState;
  usedIncremental: boolean;
}

export function createPersistenceState(binary: Uint8Array | null): AutomergePersistenceState {
  return {
    binary,
    baseSnapshotBytes: binary?.byteLength ?? 0,
    incrementalBytesSinceSnapshot: 0,
  };
}

function concatUint8Arrays(left: Uint8Array, right: Uint8Array): Uint8Array {
  const combined = new Uint8Array(left.byteLength + right.byteLength);
  combined.set(left, 0);
  combined.set(right, left.byteLength);
  return combined;
}

export function persistDoc(
  doc: FreedDoc,
  state: AutomergePersistenceState,
): PersistDocResult {
  const currentBinary = state.binary;
  if (!currentBinary) {
    const snapshot = A.save(doc);
    return {
      binary: snapshot,
      persistence: createPersistenceState(snapshot),
      usedIncremental: false,
    };
  }

  const incremental = A.saveIncremental(doc);
  if (incremental.byteLength === 0) {
    return {
      binary: currentBinary,
      persistence: state,
      usedIncremental: false,
    };
  }

  const nextIncrementalBytes = state.incrementalBytesSinceSnapshot + incremental.byteLength;
  const shouldCompact =
    state.baseSnapshotBytes < MIN_SNAPSHOT_BYTES_BEFORE_INCREMENTAL ||
    nextIncrementalBytes >= state.baseSnapshotBytes;

  if (shouldCompact) {
    const snapshot = A.save(doc);
    return {
      binary: snapshot,
      persistence: createPersistenceState(snapshot),
      usedIncremental: false,
    };
  }

  const appendedBinary = concatUint8Arrays(currentBinary, incremental);
  return {
    binary: appendedBinary,
    persistence: {
      binary: appendedBinary,
      baseSnapshotBytes: state.baseSnapshotBytes,
      incrementalBytesSinceSnapshot: nextIncrementalBytes,
    },
    usedIncremental: true,
  };
}
