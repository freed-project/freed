import { LIBRARY_CORE_CHECKPOINT_PAGE_MAXIMUM_RECORDS } from "@freed/shared/library-core";

const STALL_MS = 5 * 60_000;
const MAX_TOTAL_MS = 2 * 60 * 60_000;

/** Bound useful progress separately from the finite cost of a large checkpoint. */
export function createCheckpointPublicationDeadline(
  expire: (reason: "stalled" | "total") => void,
) {
  const startedAt = performance.now();
  let closed = false;
  let checkpointStarted = false;
  let expectedRecords = 0;
  let records = 0;
  let lastProgressAt: number | null = null;
  let absoluteDeadlineAt = startedAt + STALL_MS;
  const verifiedObjects = new Set<string>();
  let verifiedObjectCount = 0;
  let stallTimer: ReturnType<typeof setTimeout> | undefined;
  let totalTimer: ReturnType<typeof setTimeout>;
  const finish = (reason: "stalled" | "total") => {
    if (closed) return;
    dispose();
    expire(reason);
  };
  const check = () => {
    if (closed) return false;
    const now = performance.now();
    // A busy JS turn can delay timer delivery. Late progress cannot revive it.
    if (now >= absoluteDeadlineAt) {
      finish("total");
      return false;
    }
    if (lastProgressAt !== null && now - lastProgressAt >= STALL_MS) {
      finish("stalled");
      return false;
    }
    return true;
  };
  const progress = () => {
    if (!check()) return;
    lastProgressAt = performance.now();
    clearTimeout(stallTimer);
    stallTimer = setTimeout(() => finish("stalled"), STALL_MS);
  };
  function dispose() {
    closed = true;
    clearTimeout(stallTimer);
    clearTimeout(totalTimer);
    verifiedObjects.clear();
  }
  // Unknown or blocked preflight retains the original five-minute total bound.
  totalTimer = setTimeout(() => finish("total"), STALL_MS);
  return {
    beginCheckpoint(recordCount: number) {
      if (closed || checkpointStarted) return;
      if (!Number.isSafeInteger(recordCount) || recordCount < 0) {
        throw new Error("Invalid checkpoint deadline record count");
      }
      if (performance.now() - startedAt >= STALL_MS) {
        finish("total");
        return;
      }
      checkpointStarted = true;
      expectedRecords = recordCount;
      // Ten seconds per estimated record-bounded page is a planning allowance,
      // not measured Drive latency. Byte-limited pages can exceed this estimate;
      // neither extra pages nor repeated progress can extend the absolute cap.
      const totalMs = Math.min(
        MAX_TOTAL_MS,
        STALL_MS +
          Math.ceil(recordCount / LIBRARY_CORE_CHECKPOINT_PAGE_MAXIMUM_RECORDS) *
            10_000,
      );
      absoluteDeadlineAt = startedAt + totalMs;
      clearTimeout(totalTimer);
      totalTimer = setTimeout(
        () => finish("total"),
        Math.max(0, totalMs - (performance.now() - startedAt)),
      );
      progress();
    },
    advanceRecords(count: number) {
      if (
        closed || !checkpointStarted || !Number.isSafeInteger(count) ||
        count <= records || count > expectedRecords
      ) return;
      records = count;
      progress();
    },
    verifiedObject(objectKey: string) {
      if (closed || !checkpointStarted || objectKey.length === 0 || verifiedObjects.has(objectKey)) return;
      // The immutable publisher admits at most 4,096 dependencies and a manifest.
      if (verifiedObjects.size >= 4_097) return;
      verifiedObjects.add(objectKey);
      verifiedObjectCount += 1;
      progress();
    },
    diagnostics() {
      const now = performance.now();
      return {
        elapsedMs: Math.round(now - startedAt),
        idleMs: Math.round(now - (lastProgressAt ?? startedAt)),
        expectedRecords,
        advancedRecords: records,
        verifiedObjects: verifiedObjectCount,
      };
    },
    check,
    dispose,
  };
}
