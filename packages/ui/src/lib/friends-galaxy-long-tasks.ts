export interface FriendsGalaxyLongTaskEntry {
  startTime: number;
  duration: number;
}

export interface FriendsGalaxyLongTaskObserver {
  disconnect(): void;
}

export type FriendsGalaxyLongTaskObserverFactory = (
  onEntries: (entries: readonly FriendsGalaxyLongTaskEntry[]) => void,
) => FriendsGalaxyLongTaskObserver | null;

export interface FriendsGalaxyLongTaskSnapshot {
  supported: boolean;
  count: number | null;
  totalDurationMs: number | null;
  worstDurationMs: number | null;
  latestStartTime: number | null;
}

export function observeBrowserLongTasks(
  onEntries: (entries: readonly FriendsGalaxyLongTaskEntry[]) => void,
  buffered = true,
): FriendsGalaxyLongTaskObserver | null {
  if (
    typeof PerformanceObserver === "undefined" ||
    !PerformanceObserver.supportedEntryTypes?.includes("longtask")
  ) {
    return null;
  }
  let observer: PerformanceObserver | null = null;
  try {
    observer = new PerformanceObserver((list) => {
      onEntries(list.getEntries());
    });
    observer.observe({ type: "longtask", buffered });
    return observer;
  } catch {
    observer?.disconnect();
    return null;
  }
}

export class FriendsGalaxyLongTaskMonitor {
  private readonly observer: FriendsGalaxyLongTaskObserver | null;
  private taskCount = 0;
  private totalDurationMs = 0;
  private worstDurationMs = 0;
  private latestStartTime = 0;

  constructor(
    factory: FriendsGalaxyLongTaskObserverFactory = observeBrowserLongTasks,
  ) {
    this.observer = factory((entries) => this.record(entries));
  }

  snapshot(): FriendsGalaxyLongTaskSnapshot {
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

  private record(entries: readonly FriendsGalaxyLongTaskEntry[]): void {
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
