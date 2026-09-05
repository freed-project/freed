import { beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { canUseTauriEvents } from "./tauri-runtime";
import {
  getProviderSyncRuntimeEligibility,
  replaceNativeProviderScheduleWake,
} from "./provider-sync-native-wake";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("./tauri-runtime", () => ({ canUseTauriEvents: vi.fn() }));

describe("provider native wake wire boundary", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(canUseTauriEvents).mockReturnValue(true);
    vi.mocked(invoke).mockResolvedValue(undefined);
  });

  it("mirrors a fractional persisted deadline as a later integer without modifying it", async () => {
    const wake = { provider: "facebook" as const, deadlineAtMs: 1788075817236.207 };
    await replaceNativeProviderScheduleWake(wake);
    expect(invoke).toHaveBeenCalledWith("replace_provider_schedule_wake", {
      wake: { provider: "facebook", deadlineAtMs: 1788075817237 },
    });
    expect(wake.deadlineAtMs).toBe(1788075817236.207);
    await replaceNativeProviderScheduleWake(null);
    expect(invoke).toHaveBeenLastCalledWith("replace_provider_schedule_wake", {
      wake: null,
    });
  });

  it.each([NaN, Infinity, -1, Number.MAX_SAFE_INTEGER + 1])(
    "rejects invalid deadline %s before invoking native work",
    async (deadlineAtMs) => {
      await expect(replaceNativeProviderScheduleWake({
        provider: "instagram",
        deadlineAtMs,
      })).rejects.toThrow("Invalid native provider wake deadline");
      expect(invoke).not.toHaveBeenCalled();
    },
  );

  it("fails closed on an unavailable native session probe", async () => {
    vi.mocked(invoke).mockRejectedValue(new Error("IPC unavailable"));
    await expect(getProviderSyncRuntimeEligibility()).resolves.toEqual({
      available: false,
      eligible: false,
      reason: "session_state_unavailable",
    });
  });
});
