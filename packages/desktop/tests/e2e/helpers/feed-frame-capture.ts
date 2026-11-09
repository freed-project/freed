/** Diagnostic retention only. These limits never select or alter an assertion. */
export const FRAME_CAPTURE_LIMITS = {
  control: { targetMs: 500, deadlineMs: 1_000, maxIntervals: 256 },
  scroll: { targetMs: null, deadlineMs: 10_000, maxIntervals: 4_096 },
} as const;

type Bounds = { targetMs: number | null; deadlineMs: number; maxIntervals: number };
type Driver = {
  now(): number;
  wallNow(): number;
  visibility(): string;
  raf?: (callback: (timestamp: number) => void) => number;
  cancelRaf(id: number): void;
  timer(callback: () => void, ms: number): number;
  clearTimer(id: number): void;
  onVisibility(callback: () => void): () => void;
};

/**
 * Self-contained so Playwright can install this exact implementation in the
 * page. Tests inject the clock and scheduler; no browser globals are required.
 */
export function createFrameCapture(id: string, bounds: Bounds, driver: Driver, external = false) {
  const encode = (value: number): number | string => Number.isFinite(value) ? value : String(value);
  const started = driver.now();
  const wallStarted = driver.wallNow();
  const timestamps: Array<number | string> = [];
  const intervals: Array<number | string> = [];
  const invalid: Array<{ index: number; timestamp: number | string; interval: number | string | null }> = [];
  const visibility = [{ atMs: started, state: driver.visibility() }];
  let visibilityObserved = 1;
  let observed = 0;
  let previous: number | null = null;
  let first: number | null = null;
  let last: number | null = null;
  let ended: number | null = null;
  let windowEnded: number | null = null;
  let windowStopReason: string | null = null;
  let wallEnded: number | null = null;
  let reason: string | null = null;
  let raf: number | undefined;
  let timer: number | undefined;
  let removeVisibility = () => {};
  let callbackCostMs = 0;
  let resolveDone: () => void = () => {};
  const done = new Promise<void>((resolve) => { resolveDone = resolve; });

  function stop(stopReason = "workload-ended") {
    if ((stopReason === "workload-ended" || stopReason === "aborted") && windowEnded === null) {
      windowEnded = driver.now();
      windowStopReason = stopReason;
    }
    if (reason !== null) return;
    reason = stopReason;
    ended = driver.now();
    wallEnded = driver.wallNow();
    if (raf !== undefined) driver.cancelRaf(raf);
    if (timer !== undefined) driver.clearTimer(timer);
    removeVisibility();
    resolveDone();
  }

  function sample(timestamp: number) {
    if (reason !== null) {
      if (external && windowEnded === null && (reason === "interval-cap" || reason === "deadline")) {
        observed++;
        first ??= timestamp;
        last = timestamp;
      }
      return;
    }
    const before = driver.now();
    // Count the callback even if the deadline was handled late. Never retain
    // a sample beyond the declared monotonic collection bound.
    observed++;
    first ??= timestamp;
    last = timestamp;
    if (before - started >= bounds.deadlineMs) {
      stop("deadline");
      return;
    }
    const delta = previous === null ? null : timestamp - previous;
    timestamps.push(encode(timestamp));
    if (delta !== null) intervals.push(encode(delta));
    if (!Number.isFinite(timestamp) || (delta !== null && (!Number.isFinite(delta) || delta <= 0))) {
      invalid.push({ index: observed - 1, timestamp: encode(timestamp), interval: delta === null ? null : encode(delta) });
    }
    previous = timestamp;
    callbackCostMs += driver.now() - before;
    if (intervals.length >= bounds.maxIntervals) stop("interval-cap");
    else if (bounds.targetMs !== null && before - started >= bounds.targetMs) stop("target-reached");
  }

  function loop(timestamp: number) {
    sample(timestamp);
    if (reason === null) raf = driver.raf!(loop);
  }

  if (!driver.raf) stop("unsupported");
  else {
    removeVisibility = driver.onVisibility(() => {
      visibilityObserved++;
      if (visibility.length < bounds.maxIntervals + 1) {
        visibility.push({ atMs: driver.now(), state: driver.visibility() });
      }
    });
    timer = driver.timer(() => stop("deadline"), bounds.deadlineMs);
    if (!external) raf = driver.raf(loop);
  }

  function snapshot() {
    const at = ended ?? driver.now();
    const gaps: string[] = [];
    if (!timestamps.length) gaps.push("no-retained-samples");
    if (reason === null) gaps.push("capture-still-running");
    if (reason === "deadline" || reason === "interval-cap") gaps.push("retention-ended-before-window");
    if (reason === "aborted") gaps.push("workload-incomplete");
    if (visibility.some((entry) => entry.state !== "visible")) gaps.push("document-not-continuously-visible");
    if (visibilityObserved > visibility.length) gaps.push("visibility-history-truncated");
    if (invalid.length) gaps.push("invalid-samples");
    const complete = gaps.length === 0 && (reason === "target-reached" || reason === "workload-ended");
    return {
      id, bounds, state: (reason === "unsupported" ? "unsupported" : complete ? "complete" : "incomplete") as "unsupported" | "complete" | "incomplete",
      stopReason: reason, windowStopReason, windowEndedMs: windowEnded, startedMs: started, endedMs: ended, wallStartedMs: wallStarted, wallEndedMs: wallEnded,
      elapsedMs: at - started, deadlineOverrunMs: Math.max(0, at - started - bounds.deadlineMs),
      firstObservedMs: first === null ? null : encode(first), lastObservedMs: last === null ? null : encode(last),
      firstRetainedMs: timestamps[0] ?? null, lastRetainedMs: timestamps.at(-1) ?? null,
      observedTimestamps: observed, retainedTimestamps: timestamps.length,
      discardedTimestamps: observed - timestamps.length,
      observedIntervals: Math.max(0, observed - 1), retainedIntervals: intervals.length,
      discardedIntervals: Math.max(0, observed - 1) - intervals.length,
      // After cancellation no callbacks are observed; absence is not zero loss.
      unobservedAfterStop: !external && (reason === "deadline" || reason === "interval-cap") ? "unknown" : null,
      timestamps: [...timestamps], intervals: [...intervals], invalidSamples: [...invalid],
      visibility: [...visibility], discardedVisibilityChanges: visibilityObserved - visibility.length,
      coverageGaps: gaps,
      unsampledBoundsMs: {
        beforeFirst: typeof timestamps[0] === "number" ? timestamps[0] - started : null,
        afterLast: typeof timestamps.at(-1) === "number" ? at - (timestamps.at(-1) as number) : null,
      },
      callbackCostMs,
    };
  }
  return { sample, stop, snapshot, done };
}

/** Same floor-index and rounding convention as measureFps, for evidence only. */
export function summarizeFrameCapture(capture: ReturnType<ReturnType<typeof createFrameCapture>["snapshot"]>) {
  const deltas = capture.intervals;
  const valid = deltas.every((value): value is number => typeof value === "number" && Number.isFinite(value));
  let summary = null;
  if (valid && deltas.length >= 2) {
    const sorted = [...deltas].sort((a, b) => a - b);
    const pct = (p: number) => Math.round(sorted[Math.floor((p / 100) * (sorted.length - 1))] * 10) / 10;
    summary = {
      p50Ms: pct(50), p95Ms: pct(95), p99Ms: pct(99),
      droppedFrames: deltas.filter((delta) => delta > 32).length,
      fps: Math.round(1000 / (deltas.reduce((sum, delta) => sum + delta, 0) / deltas.length)),
      sampleCount: deltas.length,
    };
  }
  return {
    summary: summary ?? { p50Ms: null, p95Ms: null, p99Ms: null, droppedFrames: null, fps: null, sampleCount: deltas.length },
    reconstructsLegacy: capture.state === "complete" && valid,
    limitation: capture.state === "complete" && valid ? null : "Retained subset cannot reconstruct the full legacy measurement.",
  };
}

/** Diagnostic failures must never replace the workload/assertion failure. */
export async function withFrameEvidence<T>(steps: {
  work(): Promise<T>;
  finish(): Promise<void>;
  attach(): Promise<void>;
  assert(value: T): Promise<void>;
  diagnosticError(error: unknown): void;
}) {
  let value!: T;
  let failed = false;
  let original: unknown;
  try { value = await steps.work(); } catch (error) { failed = true; original = error; }
  for (const action of [steps.finish, steps.attach]) {
    try { await action(); } catch (error) {
      isolateFrameDiagnostic(() => steps.diagnosticError(error), () => {});
    }
  }
  if (failed) throw original;
  await steps.assert(value);
}

/** Keep an optional diagnostic hook outside the legacy measurement verdict. */
export function isolateFrameDiagnostic<T>(action: () => T, onError: (error: unknown) => void): T | undefined {
  try { return action(); } catch (error) {
    // Even diagnostic error reporting must not interrupt the legacy callback.
    try { onError(error); } catch { /* The caller can still report missing evidence. */ }
    return undefined;
  }
}

/** JSON must not silently coerce nonfinite raw or derived measurements to null. */
export function serializeFrameEvidence(evidence: unknown): string {
  return JSON.stringify(evidence, (_key, value) =>
    typeof value === "number" && !Number.isFinite(value) ? String(value) : value, 2);
}
