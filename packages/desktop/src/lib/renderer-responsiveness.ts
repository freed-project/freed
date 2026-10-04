import {
  observeBrowserLongTasks,
  type FriendsGalaxyLongTaskEntry,
  type FriendsGalaxyLongTaskObserver,
} from "@freed/ui/lib/friends-galaxy-long-tasks";

const PROBE_INTERVAL_MS = 250;
const DELAY_THRESHOLD_MS = 100;

interface ResponsivenessRuntime {
  now(): number;
  visible(): boolean;
  timeout(callback: () => void, delayMs: number): number;
  cancelTimeout(id: number): void;
  frame(callback: () => void): number;
  cancelFrame(id: number): void;
  onVisibility(callback: () => void): () => void;
  observeLongTasks(
    callback: (entries: readonly FriendsGalaxyLongTaskEntry[]) => void,
  ): FriendsGalaxyLongTaskObserver | null;
}

export interface RendererResponsivenessSnapshot {
  probeIntervalMs: number;
  delayThresholdMs: number;
  observationMs: number;
  foregroundObservedMs: number;
  timerSamples: number;
  frameCallbackSamples: number;
  delayedTimerCount: number;
  delayedFrameCallbackCount: number;
  maxTimerLagMs: number | null;
  maxFrameCallbackWaitMs: number | null;
  longTasksSupported: boolean;
  longTaskCount: number | null;
  longTaskTotalMs: number | null;
  longTaskMaxMs: number | null;
}

const browserRuntime: ResponsivenessRuntime = {
  now: () => performance.now(),
  visible: () => document.visibilityState === "visible",
  timeout: (callback, delay) => window.setTimeout(callback, delay),
  cancelTimeout: (id) => window.clearTimeout(id),
  frame: (callback) => window.requestAnimationFrame(callback),
  cancelFrame: (id) => window.cancelAnimationFrame(id),
  onVisibility: (callback) => {
    document.addEventListener("visibilitychange", callback);
    return () => document.removeEventListener("visibilitychange", callback);
  },
  // Do not import historical entries from before this renderer observation.
  observeLongTasks: (callback) => observeBrowserLongTasks(callback, false),
};

/**
 * Cumulative, constant-space foreground diagnostics for this heartbeat lifecycle.
 * One timer then one animation-frame request, at most four probes/second; none while hidden.
 * These are sampled callback delays, not FPS or proof of input responsiveness.
 */
export class RendererResponsivenessMonitor {
  private readonly startedAt: number;
  private visibleSince: number | null = null;
  private foregroundMs = 0;
  private timerId: number | null = null;
  private frameId: number | null = null;
  private disposed = false;
  private generation = 0;
  private timerSamples = 0;
  private frameCallbackSamples = 0;
  private delayedTimerCount = 0;
  private delayedFrameCallbackCount = 0;
  private maxTimerLagMs = 0;
  private maxFrameCallbackWaitMs = 0;
  private longTaskCount = 0;
  private longTaskTotalMs = 0;
  private longTaskMaxMs = 0;
  private readonly observer: FriendsGalaxyLongTaskObserver | null;
  private readonly unlisten: () => void;

  constructor(private readonly runtime: ResponsivenessRuntime = browserRuntime) {
    this.startedAt = runtime.now();
    this.observer = runtime.observeLongTasks((entries) => {
      if (this.disposed || this.visibleSince === null || !runtime.visible()) return;
      for (const entry of entries) {
        // Exclude hidden-era entries delivered asynchronously after visibility resumes.
        if (!Number.isFinite(entry.startTime) || !Number.isFinite(entry.duration)
          || entry.duration < 0 || entry.startTime < this.visibleSince) continue;
        this.longTaskCount += 1;
        this.longTaskTotalMs += entry.duration;
        this.longTaskMaxMs = Math.max(this.longTaskMaxMs, entry.duration);
      }
    });
    this.unlisten = runtime.onVisibility(() => this.syncVisibility());
    this.syncVisibility();
  }

  snapshot(): RendererResponsivenessSnapshot {
    const now = this.runtime.now();
    const supported = this.observer !== null;
    return {
      probeIntervalMs: PROBE_INTERVAL_MS,
      delayThresholdMs: DELAY_THRESHOLD_MS,
      observationMs: Math.max(0, now - this.startedAt),
      foregroundObservedMs: this.foregroundMs
        + (this.visibleSince === null ? 0 : Math.max(0, now - this.visibleSince)),
      timerSamples: this.timerSamples,
      frameCallbackSamples: this.frameCallbackSamples,
      delayedTimerCount: this.delayedTimerCount,
      delayedFrameCallbackCount: this.delayedFrameCallbackCount,
      maxTimerLagMs: this.timerSamples === 0 ? null : this.maxTimerLagMs,
      maxFrameCallbackWaitMs: this.frameCallbackSamples === 0 ? null : this.maxFrameCallbackWaitMs,
      longTasksSupported: supported,
      longTaskCount: supported ? this.longTaskCount : null,
      longTaskTotalMs: supported ? this.longTaskTotalMs : null,
      longTaskMaxMs: supported ? this.longTaskMaxMs : null,
    };
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.stopForeground();
    this.unlisten();
    this.observer?.disconnect();
  }

  private stopForeground(): void {
    this.generation += 1;
    if (this.visibleSince !== null) {
      this.foregroundMs += Math.max(0, this.runtime.now() - this.visibleSince);
      this.visibleSince = null;
    }
    if (this.timerId !== null) this.runtime.cancelTimeout(this.timerId);
    if (this.frameId !== null) this.runtime.cancelFrame(this.frameId);
    this.timerId = null;
    this.frameId = null;
  }

  private syncVisibility(): void {
    this.stopForeground();
    if (this.disposed || !this.runtime.visible()) return;
    this.visibleSince = this.runtime.now();
    this.scheduleProbe();
  }

  private scheduleProbe(): void {
    const generation = this.generation;
    const dueAt = this.runtime.now() + PROBE_INTERVAL_MS;
    this.timerId = this.runtime.timeout(() => {
      if (this.disposed || generation !== this.generation || !this.runtime.visible()) return;
      this.timerId = null;
      const lag = Math.max(0, this.runtime.now() - dueAt);
      this.timerSamples += 1;
      this.maxTimerLagMs = Math.max(this.maxTimerLagMs, lag);
      if (lag >= DELAY_THRESHOLD_MS) this.delayedTimerCount += 1;
      const requestedAt = this.runtime.now();
      this.frameId = this.runtime.frame(() => {
        if (this.disposed || generation !== this.generation || !this.runtime.visible()) return;
        this.frameId = null;
        const wait = Math.max(0, this.runtime.now() - requestedAt);
        this.frameCallbackSamples += 1;
        this.maxFrameCallbackWaitMs = Math.max(this.maxFrameCallbackWaitMs, wait);
        if (wait >= DELAY_THRESHOLD_MS) this.delayedFrameCallbackCount += 1;
        this.scheduleProbe();
      });
    }, PROBE_INTERVAL_MS);
  }
}
