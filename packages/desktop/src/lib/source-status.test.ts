import { describe, expect, it } from "vitest";
import { getDesktopSourceStatus, type SourceStatusInput } from "./source-status";
import type {
  HealthProviderId,
  ProviderHealthDebugState,
  ProviderHealthSnapshot,
} from "@freed/ui/lib/debug-store";

function providerSnapshot(
  provider: HealthProviderId,
  overrides: Partial<ProviderHealthSnapshot> = {},
): ProviderHealthSnapshot {
  return {
    provider,
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

function health(
  overrides: Partial<ProviderHealthDebugState["providers"]> = {},
): ProviderHealthDebugState {
  return {
    providers: {
      rss: providerSnapshot("rss"),
      x: providerSnapshot("x"),
      facebook: providerSnapshot("facebook"),
      instagram: providerSnapshot("instagram"),
      linkedin: providerSnapshot("linkedin"),
      substack: providerSnapshot("substack"),
      medium: providerSnapshot("medium"),
      youtube: providerSnapshot("youtube"),
      gdrive: providerSnapshot("gdrive"),
      dropbox: providerSnapshot("dropbox"),
      ...overrides,
    },
    failingRssFeeds: [],
    updatedAt: Date.now(),
  };
}

function sourceState(overrides: Partial<SourceStatusInput> = {}): SourceStatusInput {
  return {
    feeds: {},
    providerSyncCounts: {},
    itemCountByPlatform: {},
    ...overrides,
  };
}

describe("desktop source status", () => {
  it("does not use old Facebook items as proof of a live connection", () => {
    const status = getDesktopSourceStatus(
      "facebook",
      sourceState({
        fbAuth: { isAuthenticated: false },
        itemCountByPlatform: { facebook: 132 },
      }),
      health({
        facebook: providerSnapshot("facebook", {
          status: "healthy",
          lastOutcome: "success",
          lastSuccessfulAt: Date.now() - 60_000,
        }),
      }),
    );

    expect(status).toBeNull();
  });

  it("still surfaces reconnect-required social source errors without a live connection", () => {
    const status = getDesktopSourceStatus(
      "facebook",
      sourceState({
        fbAuth: {
          isAuthenticated: false,
          lastCaptureError:
            "Facebook did not render an authenticated feed. Reconnect Facebook and try again.",
        },
        itemCountByPlatform: { facebook: 132 },
      }),
      health({
        facebook: providerSnapshot("facebook", {
          status: "healthy",
          lastOutcome: "success",
        }),
      }),
    );

    expect(status?.tone).toBe("critical");
    expect(status?.label).toBe("Reconnect required");
  });

  it("projects the authenticated YouTube session and active capture state", () => {
    const status = getDesktopSourceStatus(
      "youtube",
      sourceState({
        ytAuth: { isAuthenticated: true },
        providerSyncCounts: { youtube: 1 },
      }),
      health({
        youtube: providerSnapshot("youtube", {
          status: "healthy",
          lastOutcome: "success",
          lastSuccessfulAt: Date.now(),
        }),
      }),
    );

    expect(status?.tone).toBe("healthy");
    expect(status?.syncing).toBe(true);
  });

  it("projects authenticated beta source health and active sync state", () => {
    const status = getDesktopSourceStatus(
      "substack",
      sourceState({
        substackAuth: { isAuthenticated: true },
        providerSyncCounts: { substack: 1 },
      }),
      health({
        substack: providerSnapshot("substack", {
          status: "healthy",
          lastOutcome: "success",
          lastSuccessfulAt: Date.now(),
        }),
      }),
    );

    expect(status?.tone).toBe("healthy");
    expect(status?.syncing).toBe(true);
  });
});
