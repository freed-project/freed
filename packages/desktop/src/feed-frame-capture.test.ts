import { describe, expect, it, vi } from "vitest";
import { createFrameCapture, isolateFrameDiagnostic, serializeFrameEvidence, FRAME_CAPTURE_LIMITS, summarizeFrameCapture, withFrameEvidence } from "../tests/e2e/helpers/feed-frame-capture";

// Tier 1: evidence fidelity and failure preservation, not browser performance.
// These inputs intentionally use a fake monotonic clock with no real sleeps.
function fixture(bounds = { targetMs: null as number | null, deadlineMs: 1_000, maxIntervals: 256 }, external = false, id = "pre") {
  let now = 0;
  let visibility = "visible";
  let next = 0;
  const callbacks = new Map<number, (timestamp: number) => void>();
  const timers = new Map<number, () => void>();
  const listeners = new Set<() => void>();
  const driver = {
    now: () => now, wallNow: () => 10_000 + now, visibility: () => visibility,
    raf: (callback: (timestamp: number) => void) => { callbacks.set(++next, callback); return next; },
    cancelRaf: (id: number) => { callbacks.delete(id); },
    timer: (callback: () => void) => { timers.set(++next, callback); return next; },
    clearTimer: (id: number) => { timers.delete(id); },
    onVisibility: (callback: () => void) => { listeners.add(callback); return () => { listeners.delete(callback); }; },
  };
  const capture = createFrameCapture(id, bounds, driver, external);
  return {
    capture, driver, callbacks, timers, listeners,
    at(ms: number) { now = ms; },
    frame(timestamp: number, at = timestamp) {
      now = at;
      if (external) capture.sample(timestamp);
      else {
        const pending = [...callbacks.values()];
        callbacks.clear();
        pending.forEach((callback) => callback(timestamp));
      }
    },
    deadline(at: number) { now = at; [...timers.values()].forEach((callback) => callback()); },
    visibility(state: string) { visibility = state; listeners.forEach((callback) => callback()); },
  };
}

describe("bounded frame evidence", () => {
  it("retains ordered precision, excludes the first timestamp from intervals and reproduces legacy metrics", () => {
    const f = fixture();
    [0, 16.649, 33.3, 83.351, 133.402, 183.453].forEach((ts) => f.frame(ts));
    f.capture.stop();
    const data = f.capture.snapshot();
    expect(data.timestamps).toEqual([0, 16.649, 33.3, 83.351, 133.402, 183.453]);
    expect(data.intervals).toEqual([16.649, 33.3 - 16.649, 83.351 - 33.3, 133.402 - 83.351, 183.453 - 133.402]);
    expect(data).toMatchObject({ state: "complete", observedTimestamps: 6, observedIntervals: 5, discardedIntervals: 0 });
    expect(summarizeFrameCapture(data)).toMatchObject({
      reconstructsLegacy: true,
      summary: { p50Ms: 50.1, p95Ms: 50.1, p99Ms: 50.1, droppedFrames: 3, fps: 27, sampleCount: 5 },
    });
    // Snapshot mutation cannot reorder or corrupt collector buffers.
    data.timestamps.reverse();
    expect(f.capture.snapshot().timestamps[0]).toBe(0);
  });

  it("marks zero intervals invalid and keeps nonfinite differences explicit", () => {
    const f = fixture();
    f.frame(10); f.frame(10, 20); f.frame(-Number.MAX_VALUE, 30); f.frame(Number.MAX_VALUE, 40);
    f.capture.stop();
    const data = JSON.parse(JSON.stringify(f.capture.snapshot()));
    expect(data.intervals[0]).toBe(0);
    expect(data.intervals[2]).toBe("Infinity");
    expect(data.invalidSamples.map((sample: { index: number }) => sample.index)).toEqual([1, 2, 3]);
    expect(summarizeFrameCapture(data).reconstructsLegacy).toBe(false);
    expect(JSON.parse(serializeFrameEvidence({ summary: { fps: Infinity, p95Ms: NaN }, interval: -Infinity })))
      .toEqual({ summary: { fps: "Infinity", p95Ms: "NaN" }, interval: "-Infinity" });
  });

  it("preserves rounding boundaries without relaxing a p95 at or above 50 ms", () => {
    for (const [delta, rounded] of [[50.049, 50], [50.051, 50.1]]) {
      const f = fixture();
      f.frame(0); f.frame(delta); f.frame(delta * 2); f.capture.stop();
      expect(summarizeFrameCapture(f.capture.snapshot()).summary.p95Ms).toBe(rounded);
    }
  });

  it("isolates thrown diagnostic drivers from the unchanged legacy callback", () => {
    const f = fixture();
    const errors: unknown[] = [];
    const isolated = new Function(`return (${isolateFrameDiagnostic.toString()})`)() as typeof isolateFrameDiagnostic;
    expect(isolated(() => createFrameCapture("broken", FRAME_CAPTURE_LIMITS.scroll, {
      ...f.driver, now: () => { throw new Error("clock unavailable"); },
    }), (error) => errors.push(error))).toBeUndefined();
    const deltas: number[] = [];
    let last: number | null = null;
    for (const ts of [0, 16.7, 33.4]) {
      isolated(() => { throw new Error("diagnostic sample failed"); }, (error) => errors.push(error));
      if (last !== null) deltas.push(ts - last);
      last = ts;
    }
    expect(deltas).toEqual([16.7, 16.7]);
    expect(errors).toHaveLength(4);
    expect(() => isolated(() => { throw new Error("hook"); }, () => { throw new Error("reporting"); })).not.toThrow();
    f.capture.stop();
  });

  it("keeps controls independent and ends exactly at their target", async () => {
    const pre = fixture(FRAME_CAPTURE_LIMITS.control, false, "capture/pre");
    const scroll = fixture(FRAME_CAPTURE_LIMITS.scroll, true, "capture/scroll");
    const post = fixture(FRAME_CAPTURE_LIMITS.control, false, "capture/post");
    pre.frame(10); pre.frame(499); pre.frame(500);
    scroll.frame(111); scroll.frame(123); scroll.capture.stop();
    post.frame(30); post.frame(500);
    await Promise.all([pre.capture.done, post.capture.done]);
    expect(pre.capture.snapshot()).toMatchObject({ id: "capture/pre", stopReason: "target-reached", timestamps: [10, 499, 500] });
    expect(scroll.capture.snapshot()).toMatchObject({ id: "capture/scroll", timestamps: [111, 123] });
    expect(post.capture.snapshot()).toMatchObject({ id: "capture/post", timestamps: [30, 500] });
    expect(pre.callbacks.size + pre.timers.size + pre.listeners.size).toBe(0);
  });

  it("caps retained intervals exactly without stopping external observations or substituting subset metrics", () => {
    const f = fixture({ targetMs: null, deadlineMs: 1_000, maxIntervals: 2 }, true);
    [0, 10, 20, 70, 140].forEach((ts) => f.frame(ts));
    f.capture.stop();
    expect(f.capture.snapshot()).toMatchObject({
      state: "incomplete", stopReason: "interval-cap", intervals: [10, 10],
      observedIntervals: 4, retainedIntervals: 2, discardedIntervals: 2, windowEndedMs: 140,
    });
    expect(summarizeFrameCapture(f.capture.snapshot())).toMatchObject({ reconstructsLegacy: false, summary: { p95Ms: 10 } });
  });

  it("excludes the exact deadline sample and records late timer handling", () => {
    const f = fixture({ targetMs: null, deadlineMs: 100, maxIntervals: 10 }, true);
    f.frame(0); f.frame(99.99); f.frame(100);
    f.frame(150); f.capture.stop();
    expect(f.capture.snapshot()).toMatchObject({ stopReason: "deadline", timestamps: [0, 99.99], discardedTimestamps: 2, windowEndedMs: 150 });
    const delayed = fixture(FRAME_CAPTURE_LIMITS.control);
    delayed.frame(20);
    delayed.deadline(1_230);
    expect(delayed.capture.snapshot()).toMatchObject({ elapsedMs: 1_230, deadlineOverrunMs: 230, state: "incomplete" });
  });

  it("serializes invalid samples explicitly and reports visibility gaps without changing raw order", () => {
    const f = fixture();
    f.frame(20); f.visibility("hidden"); f.frame(10, 30); f.frame(NaN, 40); f.frame(Infinity, 50); f.visibility("visible");
    f.capture.stop();
    const data = JSON.parse(JSON.stringify(f.capture.snapshot()));
    expect(data.timestamps).toEqual([20, 10, "NaN", "Infinity"]);
    expect(data.intervals).toEqual([-10, "NaN", "NaN"]);
    expect(data.invalidSamples.map((sample: { index: number }) => sample.index)).toEqual([1, 2, 3]);
    expect(data.coverageGaps).toEqual(expect.arrayContaining(["invalid-samples", "document-not-continuously-visible"]));
    expect(summarizeFrameCapture(data).reconstructsLegacy).toBe(false);
  });

  it("distinguishes empty, unsupported and interrupted capture, with idempotent owned cleanup", () => {
    const f = fixture();
    f.capture.stop("aborted"); f.at(400); f.capture.stop();
    expect(f.capture.snapshot()).toMatchObject({ state: "incomplete", stopReason: "aborted", endedMs: 0, timestamps: [] });
    expect(f.callbacks.size + f.timers.size + f.listeners.size).toBe(0);
    const unsupported = createFrameCapture("unsupported", FRAME_CAPTURE_LIMITS.control, { ...f.driver, raf: undefined });
    expect(unsupported.snapshot().state).toBe("unsupported");
    expect(summarizeFrameCapture(f.capture.snapshot()).summary).toEqual({ p50Ms: null, p95Ms: null, p99Ms: null, fps: null, droppedFrames: null, sampleCount: 0 });
    const one = fixture(); one.frame(1); one.frame(2); one.capture.stop();
    expect(summarizeFrameCapture(one.capture.snapshot())).toMatchObject({ reconstructsLegacy: true, summary: { p95Ms: null, sampleCount: 1 } });
  });

  it("bounds visibility history and installs the self-contained collector without module closures", () => {
    const f = fixture({ targetMs: null, deadlineMs: 100, maxIntervals: 2 });
    for (let i = 0; i < 10; i++) f.visibility(i % 2 ? "visible" : "hidden");
    expect(f.capture.snapshot()).toMatchObject({ discardedVisibilityChanges: 8 });
    const installed = new Function(`return (${createFrameCapture.toString()})`)() as typeof createFrameCapture;
    const capture = installed("installed", FRAME_CAPTURE_LIMITS.scroll, f.driver, true);
    capture.sample(1); capture.sample(17); capture.stop();
    expect(capture.snapshot().intervals).toEqual([16]);
    f.capture.stop();
  });
});

describe("failure-safe evidence delivery", () => {
  it("retains partial evidence and missing post-control, cleans up, and rethrows the workload failure", async () => {
    const f = fixture();
    const original = new Error("workload failed");
    const attached: unknown[] = [];
    const assert = vi.fn();
    await expect(withFrameEvidence({
      work: async () => { f.frame(1); f.frame(18); throw original; },
      finish: async () => { f.capture.stop("aborted"); },
      attach: async () => { attached.push({ scroll: f.capture.snapshot(), post: { state: "missing", reason: "page unavailable" } }); },
      assert, diagnosticError: vi.fn(),
    })).rejects.toBe(original);
    expect(attached).toEqual([expect.objectContaining({ scroll: expect.objectContaining({ intervals: [17], stopReason: "aborted" }), post: { state: "missing", reason: "page unavailable" } })]);
    expect(f.callbacks.size + f.timers.size + f.listeners.size).toBe(0);
    expect(assert).not.toHaveBeenCalled();
  });

  it.each(["workload", "assertion"])("preserves the original %s failure when diagnostic delivery also fails", async (failure) => {
    const original = new Error(failure);
    const diagnosticError = vi.fn();
    const order: string[] = [];
    await expect(withFrameEvidence({
      work: async () => { if (failure === "workload") throw original; return 17; },
      finish: async () => { order.push("cleanup"); throw new Error("page gone"); },
      attach: async () => { order.push("attach"); throw new Error("disk full"); },
      assert: async () => { order.push("assert"); throw original; },
      diagnosticError,
    })).rejects.toBe(original);
    expect(diagnosticError).toHaveBeenCalledTimes(2);
    expect(order).toEqual(failure === "workload" ? ["cleanup", "attach"] : ["cleanup", "attach", "assert"]);
  });

  it.each(["workload", "assertion"])("preserves the original %s failure when diagnostic reporting throws", async (failure) => {
    const original = new Error(failure);
    const diagnosticError = vi.fn(() => { throw new Error("reporter failed"); });
    const order: string[] = [];
    await expect(withFrameEvidence({
      work: async () => { if (failure === "workload") throw original; return 17; },
      finish: async () => { order.push("cleanup"); throw new Error("page gone"); },
      attach: async () => { order.push("attach"); throw new Error("disk full"); },
      assert: async (value) => { expect(value).toBe(17); order.push("assert"); throw original; },
      diagnosticError,
    })).rejects.toBe(original);
    expect(diagnosticError).toHaveBeenCalledTimes(2);
    expect(order).toEqual(failure === "workload" ? ["cleanup", "attach"] : ["cleanup", "attach", "assert"]);
  });
});
