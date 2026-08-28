import { invoke } from "@tauri-apps/api/core";
import { canUseTauriEvents } from "./tauri-runtime";
import type { AutomaticSyncProvider } from "./provider-sync-cadence";

export interface ProviderSyncRuntimeEligibility {
  available: boolean;
  eligible: boolean;
  reason: "screen_locked" | "session_state_unavailable" | null;
}

export interface NativeProviderScheduleWake {
  provider: AutomaticSyncProvider;
  deadlineAtMs: number;
}

export async function getProviderSyncRuntimeEligibility(): Promise<ProviderSyncRuntimeEligibility> {
  if (!canUseTauriEvents()) {
    return { available: false, eligible: true, reason: null };
  }
  try {
    return await invoke<ProviderSyncRuntimeEligibility>(
      "get_provider_sync_runtime_eligibility",
    );
  } catch {
    return {
      available: false,
      eligible: false,
      reason: "session_state_unavailable",
    };
  }
}

export async function replaceNativeProviderScheduleWake(
  wake: NativeProviderScheduleWake | null,
): Promise<void> {
  if (!canUseTauriEvents()) return;
  await invoke("replace_provider_schedule_wake", { wake });
}
