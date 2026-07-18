export interface GalaxyLabLongTaskEntry {
  startTime: number;
  duration: number;
}

export interface GalaxyLabLongTaskObserver {
  disconnect(): void;
}

export type GalaxyLabLongTaskObserverFactory = (
  onEntries: (entries: readonly GalaxyLabLongTaskEntry[]) => void,
) => GalaxyLabLongTaskObserver | null;

export interface GalaxyLabLongTaskSnapshot {
  supported: boolean;
  count: number | null;
  totalDurationMs: number | null;
  worstDurationMs: number | null;
  latestStartTime: number | null;
}

function browserLongTaskObserverFactory(
  onEntries: (entries: readonly GalaxyLabLongTaskEntry[]) => void,
): GalaxyLabLongTaskObserver | null {
  if (
    typeof PerformanceObserver === "undefined" ||
    !PerformanceObserver.supportedEntryTypes?.includes("longtask")
  ) {
    return null;
  }
  const observer = new PerformanceObserver((list) => {
    onEntries(list.getEntries());
  });
  try {
    observer.observe({ type: "longtask", buffered: true });
    return observer;
  } catch {
    observer.disconnect();
    return null;
  }
}

export class GalaxyLabLongTaskMonitor {
  private readonly observer: GalaxyLabLongTaskObserver | null;
  private taskCount = 0;
  private totalDurationMs = 0;
  private worstDurationMs = 0;
  private latestStartTime = 0;

  constructor(factory: GalaxyLabLongTaskObserverFactory = browserLongTaskObserverFactory) {
    this.observer = factory((entries) => this.record(entries));
  }

  snapshot(): GalaxyLabLongTaskSnapshot {
    if (!this.observer) {
      return {
        supported: false,
        count: null,
        totalDurationMs: null,
        worstDurationMs: null,
        latestStartTime: null,
      };
    }
    return {
      supported: true,
      count: this.taskCount,
      totalDurationMs: this.totalDurationMs,
      worstDurationMs: this.worstDurationMs,
      latestStartTime: this.taskCount > 0 ? this.latestStartTime : null,
    };
  }

  dispose(): void {
    this.observer?.disconnect();
  }

  private record(entries: readonly GalaxyLabLongTaskEntry[]): void {
    for (const entry of entries) {
      if (
        !Number.isFinite(entry.startTime) ||
        !Number.isFinite(entry.duration) ||
        entry.duration < 0
      ) {
        continue;
      }
      this.taskCount += 1;
      this.totalDurationMs += entry.duration;
      this.worstDurationMs = Math.max(this.worstDurationMs, entry.duration);
      this.latestStartTime = Math.max(this.latestStartTime, entry.startTime);
    }
  }
}
