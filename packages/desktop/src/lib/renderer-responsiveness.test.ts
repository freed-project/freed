import { describe, expect, it, vi } from "vitest";
import { RendererResponsivenessMonitor } from "./renderer-responsiveness";
import { rendererHeartbeatTiming } from "./renderer-heartbeat";
import type { FriendsGalaxyLongTaskEntry } from "@freed/ui/lib/friends-galaxy-long-tasks";

function harness(supported = false, initiallyVisible = true) {
  let now = 0;
  let visible = initiallyVisible;
  let nextId = 0;
  const timers = new Map<number, { callback: () => void; delay: number }>();
  const frames = new Map<number, () => void>();
  let onVisibility = () => {};
  let onLongTasks = (_entries: readonly FriendsGalaxyLongTaskEntry[]) => {};
  const disconnect = vi.fn();
  const unlisten = vi.fn();
  const monitor = new RendererResponsivenessMonitor({
    now: () => now,
    visible: () => visible,
    timeout: (callback, delay) => {
      timers.set(++nextId, { callback, delay }); return nextId;
    },
    cancelTimeout: (id) => { timers.delete(id); },
    frame: (callback) => { frames.set(++nextId, callback); return nextId; },
    cancelFrame: (id) => { frames.delete(id); },
    onVisibility: (callback) => { onVisibility = callback; return unlisten; },
    observeLongTasks: (callback) => {
      onLongTasks = callback; return supported ? { disconnect } : null;
    },
  });
  return {
    monitor, timers, frames, disconnect, unlisten,
    at(time: number) { now = time; },
    visibility(state: boolean) { visible = state; onVisibility(); },
    tasks(entries: readonly FriendsGalaxyLongTaskEntry[]) { onLongTasks(entries); },
    timer(time: number) {
      now = time;
      const [id, { callback, delay }] = [...timers][0];
      expect(delay).toBe(250);
      timers.delete(id); callback();
    },
    paint(time: number) {
      now = time;
      const [id, callback] = [...frames][0];
      frames.delete(id); callback();
    },
  };
}

describe("app-wide foreground responsiveness", () => {
  it("retains a between-heartbeat timer stall with a bounded probe chain", () => {
    const h = harness();
    expect(h.timers.size).toBe(1);
    h.timer(750); // 500 ms late, long before the 15-second heartbeat.
    expect(h.timers.size).toBe(0);
    expect(h.frames.size).toBe(1);
    h.paint(766);
    h.timer(1016); h.paint(1032);
    h.at(15_000);
    // The original 15-second timing signal can report zero after this stall.
    expect(rendererHeartbeatTiming("visible", 15_000, 15_000, 15_000).eventLoopLagMs).toBe(0);
    expect(h.monitor.snapshot()).toMatchObject({
      timerSamples: 2, frameCallbackSamples: 2,
      delayedTimerCount: 1, delayedFrameCallbackCount: 0,
      maxTimerLagMs: 500, maxFrameCallbackWaitMs: 16,
      longTasksSupported: false, longTaskCount: null,
      longTaskTotalMs: null, longTaskMaxMs: null,
    });
    expect(h.timers.size).toBe(1);
    expect(h.frames.size).toBe(0);
    h.monitor.dispose();
  });
  it("distinguishes a delayed animation-frame callback from a late timer", () => {
    const h = harness();
    h.timer(250);
    expect(h.monitor.snapshot()).toMatchObject({ timerSamples: 1, frameCallbackSamples: 0, maxFrameCallbackWaitMs: null });
    h.paint(1500);
    expect(h.monitor.snapshot()).toMatchObject({
      maxTimerLagMs: 0, maxFrameCallbackWaitMs: 1250,
      delayedTimerCount: 0, delayedFrameCallbackCount: 1,
    });
    h.monitor.dispose();
  });
  it("cancels hidden probes, rejects hidden-era tasks, and cleans up once", () => {
    const h = harness(true);
    h.tasks([{ startTime: 10, duration: 70 }]);
    h.timer(250);
    const stalePaint = [...h.frames.values()][0];
    h.at(260); h.visibility(false);
    expect(h.frames.size + h.timers.size).toBe(0);
    h.tasks([{ startTime: 300, duration: 1000 }]);
    h.at(60_000); h.visibility(true);
    stalePaint(); // A previously dispatched callback must not create a second loop.
    expect(h.timers.size).toBe(1);
    expect(h.monitor.snapshot().frameCallbackSamples).toBe(0);
    h.tasks([{ startTime: 300, duration: 1000 }, { startTime: 60_005, duration: 80 }]);
    h.tasks([{ startTime: NaN, duration: 80 }, { startTime: 60_005, duration: Infinity }]);
    h.timer(60_250); h.paint(60_266);
    expect(h.monitor.snapshot()).toMatchObject({
      foregroundObservedMs: 526, observationMs: 60_266,
      maxTimerLagMs: 0, longTasksSupported: true,
      longTaskCount: 2, longTaskTotalMs: 150, longTaskMaxMs: 80,
    });
    h.monitor.dispose(); h.monitor.dispose();
    h.visibility(true);
    expect(h.frames.size + h.timers.size).toBe(0);
    expect(h.disconnect).toHaveBeenCalledTimes(1);
    expect(h.unlisten).toHaveBeenCalledTimes(1);
  });
  it("reports unavailable probe metrics when mounted hidden", () => {
    const h = harness(false, false);
    h.at(60_000);
    expect(h.timers.size + h.frames.size).toBe(0);
    expect(h.monitor.snapshot()).toMatchObject({
      foregroundObservedMs: 0, timerSamples: 0, frameCallbackSamples: 0,
      maxTimerLagMs: null, maxFrameCallbackWaitMs: null,
    });
    h.visibility(true);
    expect(h.timers.size).toBe(1);
    h.monitor.dispose();
  });
});
