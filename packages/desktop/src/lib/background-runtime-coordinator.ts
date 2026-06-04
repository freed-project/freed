import type { RuntimeMemorySnapshot } from "@freed/ui/lib/debug-store";
import { addDebugEvent } from "@freed/ui/lib/debug-store";
import { log } from "./logger";

export type BackgroundJobKind =
  | "cloud-sync"
  | "content-fetch"
  | "content-signal-backfill"
  | "outbox"
  | "rss-poll"
  | "semantic-classifier"
  | "social-scrape"
  | "snapshot";

export interface RendererHeartbeatNote {
  seq: number;
  reason: string;
  visibility: string;
  href: string;
  ts: number;
}

export interface BackgroundRuntimeStatus {
  healthyHeartbeats: number;
  rendererReady: boolean;
  cooldownUntil: number | null;
  pressureLevel: "normal" | "high" | "critical";
  safeModeUntil: number | null;
  lastRecoveryPhase: string | null;
  lastRecoveryReason: string | null;
  activeJob: BackgroundJobKind | null;
  activeSource: string | null;
  activeAgeMs: number | null;
}

export interface RendererRecoveryStateEvent {
  phase: "stale" | "recovery_attempt" | "safe_mode" | "rebuilt" | "recovered";
  reason?: string;
  safeModeActive?: boolean;
  safeModeRemainingMs?: number | null;
}

export interface BackgroundRuntimeTask<T> {
  kind: BackgroundJobKind;
  source: string;
  blocking?: boolean;
  timeoutMs?: number;
  waitForActiveJobMs?: number;
  waitForActiveJobKinds?: readonly BackgroundJobKind[];
  run: () => Promise<T> | T;
}

const REQUIRED_HEALTHY_HEARTBEATS = 2;
const HIGH_PRESSURE_COOLDOWN_MS = 60_000;
const CRITICAL_PRESSURE_COOLDOWN_MS = 120_000;
const DEFAULT_TIMEOUT_MS = 120_000;

let healthyHeartbeats = 0;
let cooldownUntil = 0;
let cooldownReason: string | null = null;
let safeModeUntil = 0;
let lastRecoveryPhase: string | null = null;
let lastRecoveryReason: string | null = null;
let pressureLevel: "normal" | "high" | "critical" = "normal";
let activeJob: {
  kind: BackgroundJobKind;
  source: string;
  startedAt: number;
} | null = null;
let requireRendererHealth = import.meta.env.MODE !== "test";
let activeJobWaiters: Array<() => void> = [];

export class BackgroundRuntimeDeferredError extends Error {
  readonly reason: string;

  constructor(reason: string) {
    super(reason);
    this.name = "BackgroundRuntimeDeferredError";
    this.reason = reason;
  }
}

export function isBackgroundRuntimeDeferredError(
  error: unknown,
): error is BackgroundRuntimeDeferredError {
  return error instanceof BackgroundRuntimeDeferredError;
}

function nowMs(): number {
  return Date.now();
}

function isActiveJobReason(reason: string): boolean {
  return reason.startsWith("active:");
}

export function formatBackgroundRuntimeDeferredReason(reason: string): string {
  if (reason.startsWith("active:semantic-classifier:")) {
    return "Freed is finishing local indexing. Try again in a moment.";
  }
  if (reason.startsWith("active:content-signal-backfill:")) {
    return "Freed is finishing local indexing. Try again in a moment.";
  }
  if (reason.startsWith("active:")) {
    return "Freed is finishing local background work. Try again in a moment.";
  }
  if (reason.startsWith("waiting_for_renderer_heartbeat:")) {
    return "Freed is waiting for the app window to report healthy. Try again in a moment.";
  }
  if (reason.startsWith("renderer_safe_mode:") || reason.startsWith("cooldown:")) {
    return "Freed paused background work while the app recovers. Try again in a moment.";
  }
  if (reason === "high_memory_pressure" || reason === "critical_memory_pressure") {
    return "Freed paused background work because memory is high. Try again after memory settles.";
  }
  return "Freed deferred background work. Try again in a moment.";
}

function activeKindFromReason(reason: string): BackgroundJobKind | null {
  if (!isActiveJobReason(reason)) return null;
  const [, kind] = reason.split(":");
  return (kind as BackgroundJobKind | undefined) ?? null;
}

function shouldWaitForActiveJob<T>(
  task: BackgroundRuntimeTask<T>,
  reason: string,
): boolean {
  if (!task.waitForActiveJobMs || task.waitForActiveJobMs <= 0) return false;
  const activeKind = activeKindFromReason(reason);
  if (!activeKind) return false;
  return !task.waitForActiveJobKinds || task.waitForActiveJobKinds.includes(activeKind);
}

function notifyActiveJobWaiters(): void {
  const waiters = activeJobWaiters;
  activeJobWaiters = [];
  for (const notify of waiters) {
    notify();
  }
}

function waitForActiveJobChange(timeoutMs: number): Promise<void> {
  if (timeoutMs <= 0 || !activeJob) return Promise.resolve();

  return new Promise((resolve) => {
    let done = false;
    let timeoutHandle: ReturnType<typeof setTimeout> | null = null;

    const finish = () => {
      if (done) return;
      done = true;
      if (timeoutHandle) clearTimeout(timeoutHandle);
      activeJobWaiters = activeJobWaiters.filter((waiter) => waiter !== finish);
      resolve();
    };

    activeJobWaiters.push(finish);
    timeoutHandle = setTimeout(finish, timeoutMs);
  });
}

function markCooldown(durationMs: number, reason: string): void {
  cooldownUntil = Math.max(cooldownUntil, nowMs() + durationMs);
  cooldownReason = reason;
  const message = `[background-runtime] paused reason=${reason} cooldown_ms=${durationMs.toLocaleString()}`;
  log.warn(message);
  addDebugEvent("error", message);
}

export function noteRendererHeartbeat(_payload: RendererHeartbeatNote): void {
  healthyHeartbeats += 1;
  if (
    healthyHeartbeats >= REQUIRED_HEALTHY_HEARTBEATS &&
    cooldownReason?.startsWith("renderer_")
  ) {
    cooldownUntil = 0;
    cooldownReason = null;
  }
}

export function noteRendererRecovery(reason: string): void {
  healthyHeartbeats = 0;
  lastRecoveryPhase = "recovery";
  lastRecoveryReason = reason;
  markCooldown(CRITICAL_PRESSURE_COOLDOWN_MS, `renderer_recovery:${reason}`);
}

export function noteRendererRecoveryState(event: RendererRecoveryStateEvent): void {
  lastRecoveryPhase = event.phase;
  lastRecoveryReason = event.reason ?? null;

  if (event.phase === "recovered") {
    safeModeUntil = 0;
    return;
  }

  if (event.phase === "stale" || event.phase === "recovery_attempt" || event.phase === "safe_mode") {
    healthyHeartbeats = 0;
    const reason = event.reason ?? event.phase;
    markCooldown(CRITICAL_PRESSURE_COOLDOWN_MS, `renderer_${event.phase}:${reason}`);
  }

  if (event.safeModeActive || event.phase === "safe_mode") {
    const durationMs = Math.max(event.safeModeRemainingMs ?? CRITICAL_PRESSURE_COOLDOWN_MS, CRITICAL_PRESSURE_COOLDOWN_MS);
    safeModeUntil = Math.max(safeModeUntil, nowMs() + durationMs);
    markCooldown(durationMs, `renderer_safe_mode:${event.reason ?? "repeated_recovery"}`);
  }
}

export function noteMemoryPressure(snapshot: RuntimeMemorySnapshot): void {
  pressureLevel = snapshot.pressureLevel ?? "normal";
  if (pressureLevel === "critical") {
    markCooldown(CRITICAL_PRESSURE_COOLDOWN_MS, "critical_memory_pressure");
  } else if (pressureLevel === "high") {
    markCooldown(HIGH_PRESSURE_COOLDOWN_MS, "high_memory_pressure");
  }
}

export function getBackgroundRuntimeStatus(): BackgroundRuntimeStatus {
  const activeAgeMs = activeJob ? nowMs() - activeJob.startedAt : null;
  return {
    healthyHeartbeats,
    rendererReady: !requireRendererHealth || healthyHeartbeats >= REQUIRED_HEALTHY_HEARTBEATS,
    cooldownUntil: cooldownUntil > nowMs() ? cooldownUntil : null,
    pressureLevel,
    safeModeUntil: safeModeUntil > nowMs() ? safeModeUntil : null,
    lastRecoveryPhase,
    lastRecoveryReason,
    activeJob: activeJob?.kind ?? null,
    activeSource: activeJob?.source ?? null,
    activeAgeMs,
  };
}

export function canStartBackgroundJob(kind: BackgroundJobKind): { ok: true } | { ok: false; reason: string } {
  if (requireRendererHealth && healthyHeartbeats < REQUIRED_HEALTHY_HEARTBEATS) {
    return {
      ok: false,
      reason: `waiting_for_renderer_heartbeat:${healthyHeartbeats.toLocaleString()}`,
    };
  }

  const safeModeRemainingMs = safeModeUntil - nowMs();
  if (safeModeRemainingMs > 0 && kind !== "snapshot") {
    return {
      ok: false,
      reason: `renderer_safe_mode:${Math.ceil(safeModeRemainingMs).toLocaleString()}`,
    };
  }

  const cooldownRemainingMs = cooldownUntil - nowMs();
  if (cooldownRemainingMs > 0 && kind !== "snapshot") {
    return {
      ok: false,
      reason: `cooldown:${Math.ceil(cooldownRemainingMs).toLocaleString()}`,
    };
  }

  if (pressureLevel === "critical") {
    return { ok: false, reason: "critical_memory_pressure" };
  }

  if (pressureLevel === "high" && kind !== "snapshot") {
    return { ok: false, reason: "high_memory_pressure" };
  }

  if (activeJob) {
    return { ok: false, reason: `active:${activeJob.kind}:${activeJob.source}` };
  }

  return { ok: true };
}

export async function runBackgroundJob<T>(task: BackgroundRuntimeTask<T>): Promise<T> {
  let gate = canStartBackgroundJob(task.kind);
  if (!gate.ok && shouldWaitForActiveJob(task, gate.reason)) {
    const deadline = nowMs() + (task.waitForActiveJobMs ?? 0);
    while (!gate.ok && shouldWaitForActiveJob(task, gate.reason)) {
      const remainingMs = deadline - nowMs();
      if (remainingMs <= 0) break;
      await waitForActiveJobChange(remainingMs);
      gate = canStartBackgroundJob(task.kind);
    }
  }

  if (!gate.ok) {
    throw new BackgroundRuntimeDeferredError(gate.reason);
  }

  const blocking = task.blocking !== false;
  if (blocking) {
    activeJob = {
      kind: task.kind,
      source: task.source,
      startedAt: nowMs(),
    };
  }

  let timeoutHandle: ReturnType<typeof setTimeout> | null = null;
  try {
    const timeoutMs = task.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    return await Promise.race([
      Promise.resolve().then(task.run),
      new Promise<never>((_, reject) => {
        timeoutHandle = setTimeout(() => {
          reject(
            new Error(
              `[background-runtime] job timed out kind=${task.kind} source=${task.source} timeout_ms=${timeoutMs.toLocaleString()}`,
            ),
          );
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timeoutHandle) clearTimeout(timeoutHandle);
    if (blocking) {
      activeJob = null;
      notifyActiveJobWaiters();
    }
  }
}

export function resetBackgroundRuntimeForTests(options?: { requireRendererHealth?: boolean }): void {
  healthyHeartbeats = 0;
  cooldownUntil = 0;
  cooldownReason = null;
  safeModeUntil = 0;
  lastRecoveryPhase = null;
  lastRecoveryReason = null;
  pressureLevel = "normal";
  activeJob = null;
  notifyActiveJobWaiters();
  requireRendererHealth = options?.requireRendererHealth ?? false;
}
