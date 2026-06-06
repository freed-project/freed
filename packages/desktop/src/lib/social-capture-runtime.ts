import { invoke, isTauri } from "@tauri-apps/api/core";
import type { BackgroundJobKind } from "./background-runtime-coordinator";
import {
  formatBackgroundRuntimeDeferredReason,
  isBackgroundRuntimeDeferredError,
} from "./background-runtime-coordinator";
import { socialProviderCopy, type SocialProviderId } from "./social-provider-copy";

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
export const NATIVE_MEMORY_PRESSURE_STAGE = "memory_pressure";

export interface RuntimeDeferredDiag {
  errorStage: string | null;
  errorMessage: string | null;
}

interface DesktopSessionState {
  available: boolean;
  screenLocked: boolean;
  error?: string | null;
}

export function runtimeDeferredMessage(reason: string): string {
  return formatBackgroundRuntimeDeferredReason(reason).replaceAll("Try again", "Try syncing again");
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

function nativeErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function isNativeSocialMemoryPressureError(error: unknown): boolean {
  const message = nativeErrorMessage(error).toLocaleLowerCase();
  return (
    message.includes("sync paused because freed desktop memory remains high after cleanup") ||
    message.includes("memory remains high after cleanup")
  );
}

export function applyNativeMemoryPressureDiag(
  diag: RuntimeDeferredDiag,
  error: unknown,
  provider: SocialProviderId,
): boolean {
  if (!isNativeSocialMemoryPressureError(error)) return false;
  diag.errorStage = NATIVE_MEMORY_PRESSURE_STAGE;
  diag.errorMessage = `${socialProviderCopy(provider).memoryPressure} Try syncing again in a moment.`;
  return true;
}

export async function applyLockedSessionDeferredDiag(
  diag: RuntimeDeferredDiag,
): Promise<boolean> {
  if (!isTauri() && import.meta.env.VITE_TEST_TAURI !== "1") return false;

  try {
    const state = await invoke<DesktopSessionState>("get_desktop_session_state");
    if (!state?.screenLocked) return false;
    diag.errorStage = RUNTIME_DEFERRED_STAGE;
    diag.errorMessage =
      "Freed paused provider sync because the Mac is locked. Unlock the Mac and try syncing again.";
    return true;
  } catch {
    return false;
  }
}

export function isRuntimeDeferredStage(stage: string | null): boolean {
  return stage === RUNTIME_DEFERRED_STAGE;
}

export function socialCaptureDurationMs(startedAtMs: number): number {
  return Math.max(0, Math.round(performance.now() - startedAtMs));
}

export function formatSocialCaptureDuration(ms: number): string {
  return `${ms.toLocaleString()} ms`;
}
