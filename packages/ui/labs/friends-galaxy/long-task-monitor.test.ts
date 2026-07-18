import { describe, expect, it, vi } from "vitest";
import {
  GalaxyLabLongTaskMonitor,
  type GalaxyLabLongTaskEntry,
  type GalaxyLabLongTaskObserverFactory,
} from "./long-task-monitor.js";

describe("Friends Galaxy long-task monitor", () => {
  it("reports unsupported browsers without installing a timer", () => {
    const monitor = new GalaxyLabLongTaskMonitor(() => null);

    expect(monitor.snapshot()).toEqual({
      supported: false,
      count: null,
      totalDurationMs: null,
      worstDurationMs: null,
      latestStartTime: null,
    });
  });

  it("accumulates bounded scalar evidence and ignores malformed entries", () => {
    let emit: ((entries: readonly GalaxyLabLongTaskEntry[]) => void) | null = null;
    const disconnect = vi.fn();
    const factory: GalaxyLabLongTaskObserverFactory = (onEntries) => {
      emit = onEntries;
      return { disconnect };
    };
    const monitor = new GalaxyLabLongTaskMonitor(factory);

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
