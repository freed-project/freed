import { describe, expect, it } from "vitest";
import {
  getProviderStatusDetail,
  getProviderStatusLabel,
  getProviderStatusTone,
} from "@freed/ui/lib/provider-status";
import type { ProviderHealthSnapshot } from "@freed/ui/lib/debug-store";

function snapshot(
  overrides: Partial<ProviderHealthSnapshot>,
): ProviderHealthSnapshot {
  return {
    provider: "facebook",
    status: "healthy",
    pause: null,
    dailyBuckets: [],
    hourlyBuckets: [],
    latestAttempts: [],
    totalSeen7d: 0,
    totalAdded7d: 0,
    totalBytes7d: 0,
    ...overrides,
  };
}

describe("provider status transient failures", () => {
  it("does not turn stale memory-pressure auth errors into sidebar warnings", () => {
    const authError =
      "Facebook sync did not start because Freed Desktop memory is high. App RSS is 2.62 GB after cleanup.";

    expect(
      getProviderStatusTone({
        isConnected: true,
        authError,
        snapshot: snapshot({ status: "healthy" }),
      }),
    ).toBe("healthy");
    expect(
      getProviderStatusLabel({
        isConnected: true,
        authError,
        snapshot: snapshot({ status: "healthy" }),
      }),
    ).toBe("Connected");
    expect(
      getProviderStatusDetail({
        isConnected: true,
        authError,
        snapshot: snapshot({ status: "healthy" }),
      }),
    ).toBe("Sync looks healthy right now.");
  });

  it("does not turn stale renderer safe-mode auth errors into sidebar warnings", () => {
    const authError =
      "background work is paused for 113949 ms while renderer safe mode is active";

    expect(
      getProviderStatusTone({
        isConnected: true,
        authError,
        snapshot: snapshot({ status: "healthy" }),
      }),
    ).toBe("healthy");
    expect(
      getProviderStatusLabel({
        isConnected: true,
        authError,
        snapshot: snapshot({ status: "healthy" }),
      }),
    ).toBe("Connected");
    expect(
      getProviderStatusDetail({
        isConnected: true,
        authError,
        snapshot: snapshot({ status: "healthy" }),
      }),
    ).toBe("Sync looks healthy right now.");
  });

  it("still warns while memory pressure is the active provider snapshot", () => {
    const currentMessage =
      "Facebook sync did not start because Freed Desktop memory is high. App RSS is 2.62 GB after cleanup.";

    expect(
      getProviderStatusTone({
        isConnected: true,
        snapshot: snapshot({
          status: "degraded",
          lastOutcome: "error",
          currentMessage,
        }),
      }),
    ).toBe("warning");
    expect(
      getProviderStatusDetail({
        isConnected: true,
        snapshot: snapshot({
          status: "degraded",
          lastOutcome: "error",
          currentMessage,
        }),
      }),
    ).toBe(currentMessage);
  });

  it("keeps empty social syncs out of the healthy connected state", () => {
    const emptySnapshot = snapshot({
      status: "healthy",
      lastOutcome: "empty",
      currentMessage: "No posts pulled",
    });

    expect(
      getProviderStatusTone({
        isConnected: true,
        snapshot: emptySnapshot,
      }),
    ).toBe("warning");
    expect(
      getProviderStatusLabel({
        isConnected: true,
        snapshot: emptySnapshot,
      }),
    ).toBe("No posts pulled");
    expect(
      getProviderStatusDetail({
        isConnected: true,
        snapshot: emptySnapshot,
      }),
    ).toBe("No posts pulled");
  });
});
