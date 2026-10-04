import { afterEach, describe, expect, it, vi } from "vitest";
import {
  FriendsGalaxyLongTaskMonitor,
  observeBrowserLongTasks,
  type FriendsGalaxyLongTaskEntry,
  type FriendsGalaxyLongTaskObserverFactory,
} from "../../src/lib/friends-galaxy-long-tasks.js";

describe("Friends Galaxy long-task monitor", () => {
  it("reports unsupported browsers without installing a timer", () => {
    const monitor = new FriendsGalaxyLongTaskMonitor(() => null);

    expect(monitor.snapshot()).toEqual({
      supported: false,
      count: null,
      totalDurationMs: null,
      worstDurationMs: null,
      latestStartTime: null,
    });
  });

  it("accumulates bounded scalar evidence and ignores malformed entries", () => {
    let emit: ((entries: readonly FriendsGalaxyLongTaskEntry[]) => void) | null = null;
    const disconnect = vi.fn();
    const factory: FriendsGalaxyLongTaskObserverFactory = (onEntries) => {
      emit = onEntries;
      return { disconnect };
    };
    const monitor = new FriendsGalaxyLongTaskMonitor(factory);

    emit!([
      { startTime: 100, duration: 52 },
      { startTime: 240, duration: 81 },
      { startTime: Number.NaN, duration: 90 },
      { startTime: 300, duration: -1 },
    ]);

    expect(monitor.snapshot()).toEqual({
      supported: true,
      count: 2,
      totalDurationMs: 133,
      worstDurationMs: 81,
      latestStartTime: 240,
    });
    monitor.dispose();
    expect(disconnect).toHaveBeenCalledOnce();
  });
});

afterEach(() => vi.unstubAllGlobals());
describe("browser LongTask support", () => {
  it("reports unavailable when the API or entry type is absent", () => {
    vi.stubGlobal("PerformanceObserver", undefined);
    expect(observeBrowserLongTasks(() => {})).toBeNull();
    vi.stubGlobal("PerformanceObserver", class { static supportedEntryTypes = ["mark"]; });
    expect(observeBrowserLongTasks(() => {})).toBeNull();
  });
  it("fails safely on observer construction or registration failure", () => {
    vi.stubGlobal("PerformanceObserver", class {
      static supportedEntryTypes = ["longtask"];
      constructor() { throw new Error("unavailable"); }
    });
    expect(observeBrowserLongTasks(() => {})).toBeNull();
    const disconnect = vi.fn();
    vi.stubGlobal("PerformanceObserver", class {
      static supportedEntryTypes = ["longtask"];
      observe() { throw new Error("unavailable"); }
      disconnect = disconnect;
    });
    expect(observeBrowserLongTasks(() => {})).toBeNull();
    expect(disconnect).toHaveBeenCalledOnce();
  });
  it("can exclude historical entries without changing the graph default", () => {
    const observe = vi.fn();
    vi.stubGlobal("PerformanceObserver", class {
      static supportedEntryTypes = ["longtask"];
      observe = observe;
      disconnect() {}
    });
    expect(observeBrowserLongTasks(() => {}, false)).not.toBeNull();
    expect(observe).toHaveBeenLastCalledWith({ type: "longtask", buffered: false });
    expect(observeBrowserLongTasks(() => {})).not.toBeNull();
    expect(observe).toHaveBeenLastCalledWith({ type: "longtask", buffered: true });
  });
});
