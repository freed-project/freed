import type { BackgroundJobKind } from "./background-runtime-coordinator";
import { isBackgroundRuntimeDeferredError } from "./background-runtime-coordinator";

export const SOCIAL_SCRAPE_WAIT_FOR_LOCAL_WORK_MS = 150_000;
export const SOCIAL_SCRAPE_WAIT_FOR_JOB_KINDS = [
  "cloud-sync",
  "content-fetch",
  "content-signal-backfill",
  "outbox",
  "rss-poll",
  "semantic-classifier",
  "snapshot",
] satisfies BackgroundJobKind[];

export const RUNTIME_DEFERRED_STAGE = "runtime_deferred";

export interface RuntimeDeferredDiag {
  errorStage: string | null;
  errorMessage: string | null;
}

export function runtimeDeferredMessage(reason: string): string {
  if (reason.startsWith("active:semantic-classifier:")) {
    return "Freed is finishing local semantic indexing. Try syncing again in a moment.";
  }
  if (reason.startsWith("active:content-signal-backfill:")) {
    return "Freed is finishing local content-signal indexing. Try syncing again in a moment.";
  }
  if (reason.startsWith("active:")) {
    return "Freed is finishing local background work. Try syncing again in a moment.";
  }
  if (reason.startsWith("waiting_for_renderer_heartbeat:")) {
    return "Freed is waiting for the app window to report healthy. Try syncing again in a moment.";
  }
  if (reason.startsWith("renderer_safe_mode:") || reason.startsWith("cooldown:")) {
    return "Freed paused background work while the app recovers. Try syncing again in a moment.";
  }
  if (reason === "high_memory_pressure" || reason === "critical_memory_pressure") {
    return "Freed paused provider sync because memory is high. Try syncing again after memory settles.";
  }
  return "Freed deferred provider sync for local background work. Try syncing again in a moment.";
}

export function applyRuntimeDeferredDiag(
  diag: RuntimeDeferredDiag,
  error: unknown,
): boolean {
  if (!isBackgroundRuntimeDeferredError(error)) return false;
  diag.errorStage = RUNTIME_DEFERRED_STAGE;
  diag.errorMessage = runtimeDeferredMessage(error.reason);
  return true;
}

export function isRuntimeDeferredStage(stage: string | null): boolean {
  return stage === RUNTIME_DEFERRED_STAGE;
}
