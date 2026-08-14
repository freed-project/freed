const DEFAULT_QUIET_MS = 600;
const DEFAULT_MAX_WAIT_MS = 2_000;

export interface FriendsGalaxySourceSchedulerOptions<T> {
  flush(value: T): void;
  now?(): number;
  setTimer?(callback: () => void, delayMs: number): ReturnType<typeof setTimeout>;
  clearTimer?(timer: ReturnType<typeof setTimeout>): void;
  quietMs?: number;
  maxWaitMs?: number;
}

/**
 * Admits the first source immediately, then collapses sustained background
 * mutations into latest-wins snapshots without delaying isolated edits.
 */
export class FriendsGalaxySourceScheduler<T> {
  private readonly flushValue: (value: T) => void;
  private readonly now: () => number;
  private readonly setTimer: NonNullable<FriendsGalaxySourceSchedulerOptions<T>["setTimer"]>;
  private readonly clearTimer: NonNullable<FriendsGalaxySourceSchedulerOptions<T>["clearTimer"]>;
  private readonly quietMs: number;
  private readonly maxWaitMs: number;
  private pending: T | null = null;
  private pendingSinceMs = 0;
  private lastRequestAtMs: number | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private disposed = false;

  constructor(options: FriendsGalaxySourceSchedulerOptions<T>) {
    this.flushValue = options.flush;
    this.now = options.now ?? (() => performance.now());
    this.setTimer = options.setTimer ?? ((callback, delayMs) =>
      setTimeout(callback, delayMs));
    this.clearTimer = options.clearTimer ?? ((timer) => clearTimeout(timer));
    this.quietMs = Math.max(0, options.quietMs ?? DEFAULT_QUIET_MS);
    this.maxWaitMs = Math.max(this.quietMs, options.maxWaitMs ?? DEFAULT_MAX_WAIT_MS);
  }

  request(value: T, immediate = false): void {
    if (this.disposed) return;
    const now = this.now();
    const isolated = this.pending === null && (
      this.lastRequestAtMs === null || now - this.lastRequestAtMs >= this.quietMs
    );
    this.lastRequestAtMs = now;
    if (immediate || isolated) {
      this.cancelTimer();
      this.pending = null;
      this.flushValue(value);
      return;
    }
    if (this.pending === null) this.pendingSinceMs = now;
    this.pending = value;
    this.schedule(now);
  }

  flush(): void {
    if (this.pending === null || this.disposed) return;
    const value = this.pending;
    this.pending = null;
    this.cancelTimer();
    this.flushValue(value);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.pending = null;
    this.cancelTimer();
  }

  private schedule(now: number): void {
    this.cancelTimer();
    const quietDeadline = now + this.quietMs;
    const maximumDeadline = this.pendingSinceMs + this.maxWaitMs;
    const delayMs = Math.max(0, Math.min(quietDeadline, maximumDeadline) - now);
    this.timer = this.setTimer(() => {
      this.timer = null;
      this.flush();
    }, delayMs);
  }

  private cancelTimer(): void {
    if (this.timer === null) return;
    this.clearTimer(this.timer);
    this.timer = null;
  }
}
