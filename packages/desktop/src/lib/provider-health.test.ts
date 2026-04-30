import { afterEach, describe, expect, it, vi } from "vitest";

function createMockAppState() {
  const state = {
    xAuth: { isAuthenticated: true } as Record<string, unknown>,
    fbAuth: { isAuthenticated: true } as Record<string, unknown>,
    igAuth: { isAuthenticated: true } as Record<string, unknown>,
    liAuth: { isAuthenticated: true } as Record<string, unknown>,
    setXAuth(next: Record<string, unknown>) {
      state.xAuth = next;
    },
    setFbAuth(next: Record<string, unknown>) {
      state.fbAuth = next;
    },
    setIgAuth(next: Record<string, unknown>) {
      state.igAuth = next;
    },
    setLiAuth(next: Record<string, unknown>) {
      state.liAuth = next;
    },
  };

  return state;
}

async function loadProviderHealthModule(options: { native?: boolean } = {}) {
  vi.resetModules();
  localStorage.clear();

  const nativeFiles = new Map<string, string>();
  const nativeWrites: Array<{ path: string; contents: string }> = [];
  const toastInfo = vi.fn();
  const openTo = vi.fn();
  const storeState = createMockAppState();

  vi.doMock("@tauri-apps/api/core", () => ({
    isTauri: () => options.native === true,
  }));
  vi.doMock("@tauri-apps/api/path", () => ({
    appDataDir: vi.fn(async () => "/mock/app-data"),
  }));
  vi.doMock("@tauri-apps/plugin-fs", () => ({
    readTextFile: vi.fn(async (path: string) => {
      const value = nativeFiles.get(path);
      if (value === undefined) throw new Error(`ENOENT: ${path}`);
      return value;
    }),
    writeTextFile: vi.fn(async (path: string, contents: string) => {
      nativeWrites.push({ path, contents });
      nativeFiles.set(path, contents);
    }),
    rename: vi.fn(async (oldPath: string, newPath: string) => {
      const value = nativeFiles.get(oldPath);
      if (value === undefined) throw new Error(`ENOENT: ${oldPath}`);
      nativeFiles.set(newPath, value);
      nativeFiles.delete(oldPath);
    }),
  }));
  vi.doMock("@freed/ui/components/Toast", () => ({
    toast: {
      info: toastInfo,
    },
  }));
  vi.doMock("@freed/ui/lib/settings-store", () => ({
    useSettingsStore: {
      getState: () => ({
        openTo,
      }),
    },
  }));
  vi.doMock("./store", () => ({
    useAppStore: {
      getState: () => storeState,
    },
  }));
  vi.doMock("./fb-auth", () => ({
    storeFbAuthState: vi.fn(),
  }));
  vi.doMock("./instagram-auth", () => ({
    storeIgAuthState: vi.fn(),
  }));
  vi.doMock("./li-auth", () => ({
    storeLiAuthState: vi.fn(),
  }));

  const debugStore = await import("@freed/ui/lib/debug-store");
  debugStore.useDebugStore.setState({ health: null });

  const mod = await import("./provider-health");
  return {
    mod,
    nativeFiles,
    nativeWrites,
    toastInfo,
    openTo,
    storeState,
    debugStore,
  };
}

afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
  vi.resetModules();
  localStorage.clear();
});

describe("provider health", () => {
  it("aggregates daily and hourly volume for successful syncs", async () => {
    vi.useFakeTimers();
    const now = new Date("2026-04-02T19:15:00.000Z");
    vi.setSystemTime(now);

    const { mod, debugStore } = await loadProviderHealthModule();

    await mod.recordProviderHealthEvent({
      provider: "x",
      outcome: "success",
      startedAt: now.getTime() - 30_000,
      finishedAt: now.getTime(),
      itemsSeen: 12,
      itemsAdded: 8,
    });

    const snapshot = debugStore.useDebugStore.getState().health;
    const provider = snapshot?.providers.x;

    expect(provider?.totalSeen7d).toBe(12);
    expect(provider?.totalAdded7d).toBe(8);
    expect(
      provider?.dailyBuckets.find((bucket) => bucket.dateKey === "2026-04-02")
        ?.successes,
    ).toBe(1);
    expect(
      provider?.hourlyBuckets.find((bucket) => bucket.hourKey === "2026-04-02T19")
        ?.itemsSeen,
    ).toBe(12);
  });

  it("persists native health state through the filesystem instead of Tauri store", async () => {
    vi.useFakeTimers();
    const now = new Date("2026-04-02T19:15:00.000Z");
    vi.setSystemTime(now);

    const { mod, nativeFiles, nativeWrites } = await loadProviderHealthModule({ native: true });

    await mod.recordProviderHealthEvent({
      provider: "rss",
      scope: "rss_feed",
      feedUrl: "https://example.com/rss.xml",
      feedTitle: "Example Feed",
      outcome: "success",
      finishedAt: now.getTime(),
      itemsSeen: 42,
      itemsAdded: 5,
    });

    const stored = JSON.parse(
      nativeFiles.get("/mock/app-data/sync-health.json") ?? "{}",
    ) as {
      "provider-health"?: {
        providers?: {
          rss?: { latestAttempts?: Array<{ itemsSeen?: number }> };
        };
        rssFeeds?: Record<string, unknown>;
      };
    };

    expect(nativeWrites.some((write) => write.path.endsWith("sync-health.json.tmp"))).toBe(true);
    expect(stored["provider-health"]?.rssFeeds?.["https://example.com/rss.xml"]).toBeTruthy();
    expect(stored["provider-health"]?.providers?.rss?.latestAttempts?.[0]?.itemsSeen).toBe(42);
  });

  it("reads existing native health files written in the store-compatible shape", async () => {
    vi.useFakeTimers();
    const now = new Date("2026-04-02T19:15:00.000Z");
    vi.setSystemTime(now);

    const { mod, nativeFiles, debugStore } = await loadProviderHealthModule({ native: true });
    nativeFiles.set(
      "/mock/app-data/sync-health.json",
      JSON.stringify({
        "provider-health": {
          version: 1,
          providers: {
            x: {
              provider: "x",
              dailyBuckets: [],
              hourlyBuckets: [],
              latestAttempts: [
                {
                  id: "existing",
                  provider: "x",
                  scope: "provider",
                  outcome: "error",
                  reason: "Rate limit exceeded",
                  startedAt: now.getTime() - 1_000,
                  finishedAt: now.getTime(),
                  durationMs: 1_000,
                  itemsSeen: 0,
                  itemsAdded: 0,
                  bytesMoved: 0,
                  signalType: "explicit",
                },
              ],
              pause: null,
            },
          },
          rssFeeds: {},
          updatedAt: now.getTime(),
        },
      }),
    );

    await mod.initProviderHealth();

    const provider = debugStore.useDebugStore.getState().health?.providers.x;
    expect(provider?.lastOutcome).toBe("error");
    expect(provider?.lastError).toBe("Rate limit exceeded");
  });

  it("does not auto-pause on cooldown outcomes", async () => {
    vi.useFakeTimers();
    const now = new Date("2026-04-02T19:15:00.000Z");
    vi.setSystemTime(now);

    const { mod, toastInfo, storeState } = await loadProviderHealthModule();

    await mod.recordProviderHealthEvent({
      provider: "instagram",
      outcome: "cooldown",
      stage: "cooldown",
      reason: "Cooling down",
      finishedAt: now.getTime(),
    });

    expect(mod.getProviderPause("instagram")).toBeNull();
    expect(storeState.igAuth.pausedUntil).toBeUndefined();
    expect(toastInfo).not.toHaveBeenCalled();
  });

  it("auto-pauses on explicit provider rate limits and exposes the toast action", async () => {
    vi.useFakeTimers();
    const now = new Date("2026-04-02T19:15:00.000Z");
    vi.setSystemTime(now);

    const { mod, toastInfo, openTo, storeState, debugStore } = await loadProviderHealthModule();

    await mod.recordProviderHealthEvent({
      provider: "x",
      outcome: "provider_rate_limit",
      stage: "provider_rate_limit",
      reason: "Rate limit exceeded",
      signalType: "explicit",
      finishedAt: now.getTime(),
    });

    const pause = mod.getProviderPause("x");

    expect(pause?.pauseLevel).toBe(1);
    expect(pause?.pausedUntil).toBe(now.getTime() + 2 * 60 * 60 * 1000);
    expect(debugStore.useDebugStore.getState().health?.providers.x.status).toBe("paused");
    expect(storeState.xAuth.pausedUntil).toBe(pause?.pausedUntil);
    expect(toastInfo).toHaveBeenCalledTimes(1);

    const action = toastInfo.mock.calls[0]?.[1]?.onAction as (() => void) | undefined;
    action?.();
    expect(openTo).toHaveBeenCalledWith("x");
  });

  it("heuristically pauses repeated suspicious failures and escalates across detections", async () => {
    vi.useFakeTimers();
    const now = new Date("2026-04-02T19:15:00.000Z");
    vi.setSystemTime(now);

    const { mod } = await loadProviderHealthModule();

    await mod.recordProviderHealthEvent({
      provider: "facebook",
      outcome: "success",
      finishedAt: now.getTime() - 2 * 24 * 60 * 60 * 1000,
      itemsSeen: 3,
      itemsAdded: 3,
    });

    for (const minutesAgo of [80, 40, 5]) {
      await mod.recordProviderHealthEvent({
        provider: "facebook",
        outcome: "error",
        stage: minutesAgo === 40 ? "extract" : "timeout",
        reason: "Suspicious failure",
        finishedAt: now.getTime() - minutesAgo * 60 * 1000,
      });
    }

    expect(mod.getProviderPause("facebook")?.pauseLevel).toBe(1);
    expect(mod.getProviderPause("facebook")?.pauseReason).toContain("Repeated failures");

    await mod.clearProviderPause("facebook");

    for (const minutesAgo of [80, 40, 5]) {
      await mod.recordProviderHealthEvent({
        provider: "facebook",
        outcome: minutesAgo === 5 ? "empty" : "error",
        stage: minutesAgo === 5 ? "empty" : "timeout",
        reason: "Still looks throttled",
        finishedAt: now.getTime() + 60 * 60 * 1000 - minutesAgo * 60 * 1000,
      });
    }

    const secondPause = mod.getProviderPause("facebook");
    expect(secondPause?.pauseLevel).toBe(2);
    expect(
      secondPause ? secondPause.pausedUntil - secondPause.detectedAt : null,
    ).toBe(4 * 60 * 60 * 1000);

    await mod.recordProviderHealthEvent({
      provider: "facebook",
      outcome: "success",
      finishedAt: now.getTime() + 5 * 60 * 60 * 1000,
      itemsSeen: 2,
      itemsAdded: 2,
    });

    expect(mod.getProviderPause("facebook")).toBeNull();

    await mod.recordProviderHealthEvent({
      provider: "facebook",
      outcome: "provider_rate_limit",
      stage: "provider_rate_limit",
      reason: "Rate limit again",
      finishedAt: now.getTime() + 5 * 60 * 60 * 1000 + 60_000,
    });

    expect(mod.getProviderPause("facebook")?.pauseLevel).toBe(1);
  });

  it("resets future pause escalation without wiping diagnostics", async () => {
    vi.useFakeTimers();
    const now = new Date("2026-04-02T19:15:00.000Z");
    vi.setSystemTime(now);

    const { mod, debugStore, storeState } = await loadProviderHealthModule();

    await mod.recordProviderHealthEvent({
      provider: "facebook",
      outcome: "provider_rate_limit",
      stage: "provider_rate_limit",
      reason: "Rate limit exceeded",
      finishedAt: now.getTime(),
    });

    expect(mod.getProviderPause("facebook")?.pauseLevel).toBe(1);

    await mod.resetProviderPauseState("facebook");

    expect(mod.getProviderPause("facebook")).toBeNull();
    expect(storeState.fbAuth.pausedUntil).toBeUndefined();
    expect(
      debugStore.useDebugStore.getState().health?.providers.facebook.dailyBuckets.some(
        (bucket) => bucket.failures > 0,
      ),
    ).toBe(true);

    await mod.recordProviderHealthEvent({
      provider: "facebook",
      outcome: "provider_rate_limit",
      stage: "provider_rate_limit",
      reason: "Rate limit exceeded again",
      finishedAt: now.getTime() + 60_000,
    });

    expect(mod.getProviderPause("facebook")?.pauseLevel).toBe(1);
  });

  it("marks RSS feeds as failing after a 24 hour outage and clears on success", async () => {
    vi.useFakeTimers();
    const now = new Date("2026-04-02T19:15:00.000Z");
    vi.setSystemTime(now);

    const { mod, debugStore } = await loadProviderHealthModule();
    const feedUrl = "https://example.com/rss.xml";

    for (const hoursAgo of [26, 25, 24]) {
      await mod.recordProviderHealthEvent({
        provider: "rss",
        scope: "rss_feed",
        feedUrl,
        feedTitle: "Example Feed",
        outcome: "error",
        stage: "fetch",
        reason: "Connection refused",
        finishedAt: now.getTime() - hoursAgo * 60 * 60 * 1000,
      });
    }

    let failingFeeds = debugStore.useDebugStore.getState().health?.failingRssFeeds ?? [];
    expect(failingFeeds).toHaveLength(1);
    expect(failingFeeds[0]?.feedUrl).toBe(feedUrl);
    expect(failingFeeds[0]?.failedAttemptsSinceSuccess).toBe(3);

    await mod.recordProviderHealthEvent({
      provider: "rss",
      scope: "rss_feed",
      feedUrl,
      feedTitle: "Example Feed",
      outcome: "success",
      finishedAt: now.getTime(),
      itemsSeen: 4,
      itemsAdded: 2,
    });

    failingFeeds = debugStore.useDebugStore.getState().health?.failingRssFeeds ?? [];
    expect(failingFeeds).toHaveLength(0);
  });

  it("clears visible provider errors after a successful sync", async () => {
    vi.useFakeTimers();
    const now = new Date("2026-04-02T19:15:00.000Z");
    vi.setSystemTime(now);

    const { mod, debugStore } = await loadProviderHealthModule();

    await mod.recordProviderHealthEvent({
      provider: "x",
      outcome: "error",
      stage: "auth",
      reason: "Could not authenticate you.",
      finishedAt: now.getTime() - 60_000,
    });

    await mod.recordProviderHealthEvent({
      provider: "x",
      outcome: "success",
      finishedAt: now.getTime(),
      itemsSeen: 7,
      itemsAdded: 4,
    });

    const provider = debugStore.useDebugStore.getState().health?.providers.x;
    expect(provider?.status).toBe("healthy");
    expect(provider?.lastOutcome).toBe("success");
    expect(provider?.lastError).toBeUndefined();
    expect(provider?.currentMessage).toBeUndefined();
  });
});
