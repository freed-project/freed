import type { RuntimeMemorySnapshot } from "@freed/ui/lib/debug-store";
import { addDebugEvent } from "@freed/ui/lib/debug-store";
import { log } from "./logger";

export type BackgroundJobKind =
  | "cloud-sync"
  | "content-fetch"
  | "outbox"
  | "rss-poll"
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
  activeJob: BackgroundJobKind | null;
  activeSource: string | null;
  activeAgeMs: number | null;
}

export interface BackgroundRuntimeTask<T> {
  kind: BackgroundJobKind;
  source: string;
  timeoutMs?: number;
  run: () => Promise<T> | T;
}

const REQUIRED_HEALTHY_HEARTBEATS = 2;
const HIGH_PRESSURE_COOLDOWN_MS = 60_000;
const CRITICAL_PRESSURE_COOLDOWN_MS = 120_000;
const DEFAULT_TIMEOUT_MS = 120_000;

let healthyHeartbeats = 0;
let cooldownUntil = 0;
let pressureLevel: "normal" | "high" | "critical" = "normal";
let activeJob: {
  kind: BackgroundJobKind;
  source: string;
  startedAt: number;
} | null = null;
let requireRendererHealth = import.meta.env.MODE !== "test";

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

function markCooldown(durationMs: number, reason: string): void {
  cooldownUntil = Math.max(cooldownUntil, nowMs() + durationMs);
  const message = `[background-runtime] paused reason=${reason} cooldown_ms=${durationMs.toLocaleString()}`;
  log.warn(message);
  addDebugEvent("error", message);
}

export function noteRendererHeartbeat(_payload: RendererHeartbeatNote): void {
  healthyHeartbeats += 1;
}

export function noteRendererRecovery(reason: string): void {
  healthyHeartbeats = 0;
  markCooldown(CRITICAL_PRESSURE_COOLDOWN_MS, `renderer_recovery:${reason}`);
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

  const cooldownRemainingMs = cooldownUntil - nowMs();
  if (cooldownRemainingMs > 0) {
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
  const gate = canStartBackgroundJob(task.kind);
  if (!gate.ok) {
    throw new BackgroundRuntimeDeferredError(gate.reason);
  }

  activeJob = {
    kind: task.kind,
    source: task.source,
    startedAt: nowMs(),
  };

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
    activeJob = null;
  }
}

export function resetBackgroundRuntimeForTests(options?: { requireRendererHealth?: boolean }): void {
  healthyHeartbeats = 0;
  cooldownUntil = 0;
  pressureLevel = "normal";
  activeJob = null;
  requireRendererHealth = options?.requireRendererHealth ?? false;
}
