import { afterEach, describe, expect, it, vi } from "vitest";

function createMockAppState() {
  const state = {
    xAuth: { isAuthenticated: true } as Record<string, unknown>,
    fbAuth: { isAuthenticated: true } as Record<string, unknown>,
    igAuth: { isAuthenticated: true } as Record<string, unknown>,
    liAuth: { isAuthenticated: true } as Record<string, unknown>,
    substackAuth: { isAuthenticated: true } as Record<string, unknown>,
    mediumAuth: { isAuthenticated: true } as Record<string, unknown>,
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
    setSubstackAuth(next: Record<string, unknown>) {
      state.substackAuth = next;
    },
    setMediumAuth(next: Record<string, unknown>) {
      state.mediumAuth = next;
    },
  };

  return state;
}

const TEST_PROVIDER_IDS = [
  "rss",
  "x",
  "facebook",
  "instagram",
  "linkedin",
  "substack",
  "medium",
  "youtube",
  "gdrive",
  "dropbox",
] as const;

type TestProviderId = (typeof TEST_PROVIDER_IDS)[number];

function createValidPersistedProvider(provider: TestProviderId) {
  return {
    provider,
    dailyBuckets: [],
    hourlyBuckets: [],
    latestAttempts: [] as Record<string, unknown>[],
    pause: null as Record<string, unknown> | null,
  };
}

function createValidPersistedHealthRecord(updatedAt: number) {
  const providers = Object.fromEntries(
    TEST_PROVIDER_IDS.map((provider) => [
      provider,
      createValidPersistedProvider(provider),
    ]),
  ) as Record<TestProviderId, ReturnType<typeof createValidPersistedProvider>>;
  return {
    version: 1,
    providers,
    rssFeeds: {} as Record<string, unknown>,
    updatedAt,
  };
}

async function loadProviderHealthModule(options: { native?: boolean } = {}) {
  vi.resetModules();
  localStorage.clear();

  const nativeFiles = new Map<string, string>();
  const nativeWrites: Array<{ path: string; contents: string }> = [];
  const nativeFs = { readError: null as Error | null };
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
      if (nativeFs.readError) throw nativeFs.readError;
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
    remove: vi.fn(async (path: string) => {
      if (!nativeFiles.delete(path)) throw new Error(`ENOENT: ${path}`);
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
  vi.doMock("./substack-auth", () => ({
    storeSubstackAuthState: vi.fn(),
  }));
  vi.doMock("./medium-auth", () => ({
    storeMediumAuthState: vi.fn(),
  }));

  const debugStore = await import("@freed/ui/lib/debug-store");
  debugStore.useDebugStore.setState({ health: null });

  const mod = await import("./provider-health");
  return {
    mod,
    nativeFiles,
    nativeFs,
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

  it("normalizes attempt scope to the provider request surface", async () => {
    const { mod } = await loadProviderHealthModule();

    const rssAttempt = await mod.recordProviderHealthEvent({
      provider: "rss",
      outcome: "empty",
    });
    const socialAttempt = await mod.recordProviderHealthEvent({
      provider: "x",
      scope: "rss_feed",
      feedUrl: "https://example.com/not-an-rss-request",
      outcome: "error",
    });

    expect(rssAttempt).toMatchObject({
      provider: "rss",
      scope: "rss_feed",
      feedUrl: undefined,
    });
    expect(socialAttempt).toMatchObject({
      provider: "x",
      scope: "provider",
    });
  });

  it("persists native health state through the filesystem and debounces RSS feed writes", async () => {
    vi.useFakeTimers();
    const now = new Date("2026-04-02T19:15:00.000Z");
    vi.setSystemTime(now);

    const { mod, nativeFiles, nativeWrites } = await loadProviderHealthModule({ native: true });
    await mod.initProviderHealth();
    const writesAfterInit = nativeWrites.length;

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

    expect(nativeWrites).toHaveLength(writesAfterInit);

    await vi.advanceTimersByTimeAsync(5_000);

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
    const persisted = createValidPersistedHealthRecord(now.getTime());
    persisted.providers.x.latestAttempts = [
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
    ];
    persisted.providers.rss.latestAttempts = [
      {
        id: "existing-rss-batch",
        provider: "rss",
        scope: "provider",
        outcome: "empty",
        reason: "No feeds were due",
        startedAt: now.getTime() - 500,
        finishedAt: now.getTime(),
        durationMs: 500,
        itemsSeen: 0,
        itemsAdded: 0,
        bytesMoved: 0,
        signalType: "none",
      },
    ];
    nativeFiles.set(
      "/mock/app-data/sync-health.json",
      JSON.stringify({
        "provider-health": persisted,
      }),
    );

    await mod.initProviderHealth();

    const provider = debugStore.useDebugStore.getState().health?.providers.x;
    expect(provider?.lastOutcome).toBe("error");
    expect(provider?.lastError).toBe("Rate limit exceeded");
    expect(
      debugStore.useDebugStore.getState().health?.providers.rss.lastOutcome,
    ).toBe("empty");
    expect(
      debugStore.useDebugStore.getState().health?.providers.rss.latestAttempts[0],
    ).toMatchObject({
      id: "existing-rss-batch",
      provider: "rss",
      scope: "rss_feed",
      outcome: "empty",
      reason: "No feeds were due",
      durationMs: 500,
    });
  });

  it("upgrades the provider set written before Substack and Medium were added", async () => {
    vi.useFakeTimers();
    const now = new Date("2026-04-02T19:15:00.000Z");
    vi.setSystemTime(now);

    const { mod, nativeFiles, debugStore } =
      await loadProviderHealthModule({ native: true });
    const persisted = createValidPersistedHealthRecord(now.getTime());
    const legacyProviders = Object.fromEntries(
      Object.entries(persisted.providers).filter(
        ([provider]) => provider !== "substack" && provider !== "medium",
      ),
    );
    nativeFiles.set(
      "/mock/app-data/sync-health.json",
      JSON.stringify({
        "provider-health": {
          ...persisted,
          providers: legacyProviders,
        },
      }),
    );

    await mod.initProviderHealth();

    expect(mod.isProviderPaused("substack")).toBe(false);
    expect(mod.isProviderPaused("medium")).toBe(false);
    expect(debugStore.useDebugStore.getState().health?.providers.substack.status).toBe("idle");
    expect(debugStore.useDebugStore.getState().health?.providers.medium.status).toBe("idle");
  });

  it("blocks automatic provider work without overwriting a future health-store version", async () => {
    vi.useFakeTimers();
    const now = new Date("2026-04-02T19:15:00.000Z");
    vi.setSystemTime(now);

    const { mod, nativeFiles, nativeWrites, debugStore } =
      await loadProviderHealthModule({ native: true });
    const raw = JSON.stringify({
      "provider-health": {
        version: 2,
        providers: {
          x: {
            pause: {
              pausedUntil: now.getTime() + 60_000,
              pauseReason: "Future pause",
              pauseLevel: 1,
              detectedAt: now.getTime(),
              detectedBy: "auto",
            },
          },
        },
      },
    });
    nativeFiles.set("/mock/app-data/sync-health.json", raw);

    await mod.initProviderHealth();

    expect(mod.isProviderPaused("x")).toBe(true);
    expect(debugStore.useDebugStore.getState().health?.providers.x).toMatchObject({
      status: "paused",
      currentMessage: expect.stringContaining("local request history"),
    });
    expect(nativeFiles.get("/mock/app-data/sync-health.json")).toBe(raw);
    expect(nativeWrites).toEqual([]);
  });

  it("blocks automatic provider work when an active pause record is malformed", async () => {
    vi.useFakeTimers();
    const now = new Date("2026-04-02T19:15:00.000Z");
    vi.setSystemTime(now);

    const { mod, nativeFiles, nativeWrites } =
      await loadProviderHealthModule({ native: true });
    const persisted = createValidPersistedHealthRecord(now.getTime());
    persisted.providers.facebook = {
      ...persisted.providers.facebook,
      pause: {
        pausedUntil: now.getTime() + 60_000,
        pauseReason: 42,
      },
    };
    const raw = JSON.stringify({ "provider-health": persisted });
    nativeFiles.set("/mock/app-data/sync-health.json", raw);

    await mod.initProviderHealth();

    expect(mod.isProviderPaused("facebook")).toBe(true);
    expect(nativeFiles.get("/mock/app-data/sync-health.json")).toBe(raw);
    expect(nativeWrites).toEqual([]);
  });

  it("blocks all automatic social work when nested request history is malformed", async () => {
    vi.useFakeTimers();
    const now = new Date("2026-04-02T19:15:00.000Z");
    vi.setSystemTime(now);
    const nowMs = now.getTime();
    const baseRecord = createValidPersistedHealthRecord(nowMs);
    const feedUrl = "https://example.com/rss.xml";
    const validAttempt = {
      id: "attempt-1",
      provider: "x",
      scope: "provider",
      outcome: "error",
      startedAt: nowMs - 1_000,
      finishedAt: nowMs,
      durationMs: 1_000,
      itemsSeen: 0,
      itemsAdded: 0,
      bytesMoved: 0,
      signalType: "none",
    };
    const validRssAttempt = {
      ...validAttempt,
      id: "rss-attempt-1",
      provider: "rss",
      scope: "rss_feed",
      feedUrl,
    };
    const validDailyBucket = {
      dateKey: "2026-04-02",
      attempts: 1,
      successes: 0,
      failures: 1,
      itemsSeen: 0,
      itemsAdded: 0,
      bytesMoved: 0,
    };
    const validHourlyBucket = {
      hourKey: "2026-04-02T19",
      attempts: 1,
      successes: 0,
      failures: 1,
      itemsSeen: 0,
      itemsAdded: 0,
      bytesMoved: 0,
    };
    const withProvider = (
      provider: TestProviderId,
      update: Record<string, unknown>,
    ) => ({
      ...baseRecord,
      providers: {
        ...baseRecord.providers,
        [provider]: {
          ...baseRecord.providers[provider],
          ...update,
        },
      },
    });
    const cases: Array<{ label: string; record: Record<string, unknown> }> = [
      {
        label: "latestAttempts",
        record: withProvider("x", { latestAttempts: "not-an-array" }),
      },
      {
        label: "bucket counts",
        record: withProvider("x", {
          dailyBuckets: [{ ...validDailyBucket, attempts: "1" }],
        }),
      },
      {
        label: "attempt timestamp",
        record: withProvider("x", {
          latestAttempts: [{ ...validAttempt, finishedAt: "later" }],
        }),
      },
      {
        label: "attempt outcome",
        record: withProvider("x", {
          latestAttempts: [{ ...validAttempt, outcome: "maybe" }],
        }),
      },
      {
        label: "missing provider",
        record: {
          ...baseRecord,
          providers: Object.fromEntries(
            Object.entries(baseRecord.providers).filter(
              ([provider]) => provider !== "dropbox",
            ),
          ),
        },
      },
      {
        label: "unknown provider",
        record: {
          ...baseRecord,
          providers: {
            ...baseRecord.providers,
            bluesky: createValidPersistedProvider("x"),
          },
        },
      },
      {
        label: "social attempt scope",
        record: withProvider("x", {
          latestAttempts: [{
            ...validAttempt,
            scope: "rss_feed",
            feedUrl,
          }],
        }),
      },
      {
        label: "RSS attempt scope",
        record: withProvider("rss", {
          latestAttempts: [{ ...validRssAttempt, scope: "provider" }],
        }),
      },
      {
        label: "invalid daily bucket key",
        record: withProvider("x", {
          dailyBuckets: [{ ...validDailyBucket, dateKey: "2026-02-30" }],
        }),
      },
      {
        label: "invalid hourly bucket key",
        record: withProvider("x", {
          hourlyBuckets: [{ ...validHourlyBucket, hourKey: "2026-04-02T24" }],
        }),
      },
      {
        label: "duplicate daily bucket key",
        record: withProvider("x", {
          dailyBuckets: [validDailyBucket, { ...validDailyBucket }],
        }),
      },
      {
        label: "duplicate hourly bucket key",
        record: withProvider("x", {
          hourlyBuckets: [validHourlyBucket, { ...validHourlyBucket }],
        }),
      },
      {
        label: "provider attempt overflow",
        record: withProvider("x", {
          latestAttempts: Array.from({ length: 21 }, (_unused, index) => ({
            ...validAttempt,
            id: `attempt-${index.toLocaleString("en-US", { useGrouping: false })}`,
          })),
        }),
      },
      {
        label: "RSS feed entry",
        record: {
          ...baseRecord,
          rssFeeds: {
            [feedUrl]: {
              feedUrl,
              feedTitle: 42,
              dailyBuckets: [],
              hourlyBuckets: [],
              latestAttempts: [],
            },
          },
        },
      },
      {
        label: "RSS feed attempt overflow",
        record: {
          ...baseRecord,
          rssFeeds: {
            [feedUrl]: {
              feedUrl,
              feedTitle: "Example Feed",
              dailyBuckets: [],
              hourlyBuckets: [],
              latestAttempts: Array.from(
                { length: 6 },
                (_unused, index) => ({
                  ...validRssAttempt,
                  id: `rss-attempt-${index.toLocaleString("en-US", { useGrouping: false })}`,
                }),
              ),
            },
          },
        },
      },
    ];

    for (const testCase of cases) {
      const { mod, nativeFiles, nativeWrites } =
        await loadProviderHealthModule({ native: true });
      const raw = JSON.stringify({ "provider-health": testCase.record });
      nativeFiles.set("/mock/app-data/sync-health.json", raw);

      await mod.initProviderHealth();

      const automaticProviderWork = vi.fn();
      for (const provider of [
        "x",
        "facebook",
        "instagram",
        "linkedin",
        "youtube",
      ] as const) {
        if (!mod.isProviderPaused(provider)) automaticProviderWork(provider);
      }
      expect(automaticProviderWork, testCase.label).not.toHaveBeenCalled();
      expect(
        nativeFiles.get("/mock/app-data/sync-health.json"),
        testCase.label,
      ).toBe(raw);
      expect(nativeWrites, testCase.label).toEqual([]);
    }
  });

  it("upgrades an explicitly recognized legacy snapshot without dropping its history", async () => {
    vi.useFakeTimers();
    const now = new Date("2026-04-02T19:15:00.000Z");
    vi.setSystemTime(now);
    const nowMs = now.getTime();
    const { mod, nativeFiles, debugStore } =
      await loadProviderHealthModule({ native: true });
    nativeFiles.set(
      "/mock/app-data/sync-health.json",
      JSON.stringify({
        "provider-health": {
          version: 1,
          providers: {
            x: {
              provider: "x",
              status: "degraded",
              lastAttemptAt: nowMs,
              lastOutcome: "error",
              lastError: "Legacy request failed",
              pause: null,
            },
          },
          failingRssFeeds: [{
            feedUrl: "https://example.com/rss.xml",
            feedTitle: "Example Feed",
            status: "failing",
            failedAttemptsSinceSuccess: 3,
            outageSince: nowMs - 26 * 60 * 60 * 1_000,
            lastAttemptAt: nowMs,
            lastError: "Legacy RSS request failed",
          }],
          updatedAt: nowMs,
        },
      }),
    );

    await mod.initProviderHealth();

    expect(debugStore.useDebugStore.getState().health?.providers.x).toMatchObject({
      status: "degraded",
      lastOutcome: "error",
      lastError: "Legacy request failed",
    });
    expect(
      debugStore.useDebugStore.getState().health?.failingRssFeeds[0],
    ).toMatchObject({
      feedUrl: "https://example.com/rss.xml",
      failedAttemptsSinceSuccess: 3,
      lastError: "Legacy RSS request failed",
    });
    expect(mod.isProviderPaused("x")).toBe(false);
  });

  it("preserves malformed raw evidence before a manual sync repairs the health store", async () => {
    vi.useFakeTimers();
    const now = new Date("2026-04-02T19:15:00.000Z");
    vi.setSystemTime(now);

    const { mod, nativeFiles, debugStore } =
      await loadProviderHealthModule({ native: true });
    const malformedRaw = "{not valid json";
    nativeFiles.set("/mock/app-data/sync-health.json", malformedRaw);

    await mod.initProviderHealth();

    expect(mod.isProviderPaused("x")).toBe(true);
    expect(nativeFiles.get("/mock/app-data/sync-health.json")).toBe(malformedRaw);

    await mod.clearProviderPause("x");

    const recoveryPath = [...nativeFiles.keys()].find((path) =>
      path.includes("/sync-health.recovery."),
    );
    expect(recoveryPath).toBeTruthy();
    const recovery = JSON.parse(nativeFiles.get(recoveryPath ?? "") ?? "{}") as {
      status?: string;
      raw?: string;
    };
    expect(recovery).toMatchObject({
      status: "corrupt",
      raw: malformedRaw,
    });
    const repaired = JSON.parse(
      nativeFiles.get("/mock/app-data/sync-health.json") ?? "{}",
    ) as { "provider-health"?: { version?: number } };
    expect(repaired["provider-health"]?.version).toBe(1);
    expect(mod.isProviderPaused("x")).toBe(false);
    expect(debugStore.useDebugStore.getState().health?.providers.x.status).toBe("idle");
  });

  it("fails closed on a native read error until manual sync recovery succeeds", async () => {
    vi.useFakeTimers();
    const now = new Date("2026-04-02T19:15:00.000Z");
    vi.setSystemTime(now);

    const { mod, nativeFiles, nativeFs, nativeWrites } =
      await loadProviderHealthModule({ native: true });
    nativeFs.readError = new Error("provider health file is not readable");

    await mod.initProviderHealth();

    expect(mod.isProviderPaused("instagram")).toBe(true);
    expect(nativeWrites).toEqual([]);

    await mod.clearProviderPause("instagram");

    const recoveryPath = [...nativeFiles.keys()].find((path) =>
      path.includes("/sync-health.recovery."),
    );
    const recovery = JSON.parse(nativeFiles.get(recoveryPath ?? "") ?? "{}") as {
      status?: string;
      raw?: string | null;
    };
    expect(recovery).toMatchObject({
      status: "unavailable",
      raw: null,
    });
    expect(nativeFiles.has("/mock/app-data/sync-health.json")).toBe(true);
    expect(mod.isProviderPaused("instagram")).toBe(false);
  });

  it("compacts retained RSS feed attempts before writing diagnostics", async () => {
    vi.useFakeTimers();
    const now = new Date("2026-04-02T19:15:00.000Z");
    vi.setSystemTime(now);

    const { mod, nativeFiles } = await loadProviderHealthModule({ native: true });
    const feedUrl = "https://example.com/rss.xml";
    const longReason = "Connection refused while loading ".repeat(20);

    for (let index = 0; index < 8; index += 1) {
      await mod.recordProviderHealthEvent({
        provider: "rss",
        scope: "rss_feed",
        feedUrl,
        feedTitle: "Example Feed",
        outcome: "error",
        stage: "fetch",
        reason: longReason,
        finishedAt: now.getTime() + index * 1_000,
      });
    }

    await vi.advanceTimersByTimeAsync(5_000);

    const stored = JSON.parse(
      nativeFiles.get("/mock/app-data/sync-health.json") ?? "{}",
    ) as {
      "provider-health"?: {
        rssFeeds?: Record<string, { latestAttempts?: Array<{ reason?: string }> }>;
      };
    };
    const attempts = stored["provider-health"]?.rssFeeds?.[feedUrl]?.latestAttempts ?? [];

    expect(attempts).toHaveLength(5);
    expect(attempts[0]?.reason?.length).toBeLessThanOrEqual(240);
    expect(attempts[0]?.reason?.endsWith("...")).toBe(true);
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

  it("keeps old memory-pressure deferrals out of current provider status", async () => {
    vi.useFakeTimers();
    const now = new Date("2026-04-02T19:15:00.000Z");
    vi.setSystemTime(now);

    const { mod, debugStore } = await loadProviderHealthModule();

    await mod.recordProviderHealthEvent({
      provider: "facebook",
      outcome: "success",
      finishedAt: now.getTime() - 60 * 60 * 1000,
      itemsSeen: 12,
      itemsAdded: 8,
    });

    await mod.recordProviderHealthEvent({
      provider: "facebook",
      outcome: "error",
      stage: "memory_pressure",
      reason: "Facebook sync did not start because Freed Desktop memory is high. App RSS is 2.62 GB after cleanup.",
      finishedAt: now.getTime() - 20 * 60 * 1000,
    });

    const provider = debugStore.useDebugStore.getState().health?.providers.facebook;

    expect(provider?.status).toBe("healthy");
    expect(provider?.lastOutcome).toBe("success");
    expect(provider?.lastError).toBeUndefined();
    expect(provider?.currentMessage).toBeUndefined();
    expect(provider?.latestAttempts[0]?.stage).toBe("memory_pressure");
  });

  it("keeps old post-cleanup critical memory deferrals out of current provider status", async () => {
    vi.useFakeTimers();
    const now = new Date("2026-04-02T19:15:00.000Z");
    vi.setSystemTime(now);

    const { mod, debugStore } = await loadProviderHealthModule();

    await mod.recordProviderHealthEvent({
      provider: "instagram",
      outcome: "success",
      finishedAt: now.getTime() - 60 * 60 * 1000,
      itemsSeen: 5,
      itemsAdded: 3,
    });

    await mod.recordProviderHealthEvent({
      provider: "instagram",
      outcome: "error",
      stage: "invoke",
      reason:
        "Instagram sync paused because Freed Desktop memory remains critically high after cleanup.",
      finishedAt: now.getTime() - 20 * 60 * 1000,
    });

    const provider = debugStore.useDebugStore.getState().health?.providers.instagram;

    expect(provider?.status).toBe("healthy");
    expect(provider?.lastOutcome).toBe("success");
    expect(provider?.lastError).toBeUndefined();
    expect(provider?.currentMessage).toBeUndefined();
    expect(provider?.latestAttempts[0]?.stage).toBe("invoke");
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

  it("syncs Medium pause state into its authenticated session", async () => {
    vi.useFakeTimers();
    const now = new Date("2026-07-13T19:15:00.000Z");
    vi.setSystemTime(now);

    const { mod, storeState } = await loadProviderHealthModule();

    await mod.recordProviderHealthEvent({
      provider: "medium",
      outcome: "provider_rate_limit",
      stage: "provider_rate_limit",
      reason: "Medium asked Freed to slow down",
      signalType: "explicit",
      finishedAt: now.getTime(),
    });

    const pause = mod.getProviderPause("medium");
    expect(pause?.pauseLevel).toBe(1);
    expect(storeState.mediumAuth.pausedUntil).toBe(pause?.pausedUntil);

    await mod.clearProviderPause("medium");
    expect(storeState.mediumAuth.pausedUntil).toBeUndefined();
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

  it("drops stale runtime-deferred provider attempts from visible status", async () => {
    vi.useFakeTimers();
    const now = new Date("2026-04-02T19:15:00.000Z");
    vi.setSystemTime(now);

    const { mod, debugStore } = await loadProviderHealthModule();

    await mod.recordProviderHealthEvent({
      provider: "instagram",
      outcome: "error",
      stage: "runtime_deferred",
      reason: "background work is paused for 113949 ms while renderer safe mode is active",
      finishedAt: now.getTime() - 16 * 60 * 1_000,
    });

    const provider = debugStore.useDebugStore.getState().health?.providers.instagram;
    expect(provider?.status).toBe("idle");
    expect(provider?.lastOutcome).toBeUndefined();
    expect(provider?.lastError).toBeUndefined();
    expect(provider?.currentMessage).toBeUndefined();
  });

  it("sanitizes active runtime-deferred provider attempts before exposing status", async () => {
    vi.useFakeTimers();
    const now = new Date("2026-04-02T19:15:00.000Z");
    vi.setSystemTime(now);

    const { mod, debugStore } = await loadProviderHealthModule();

    await mod.recordProviderHealthEvent({
      provider: "linkedin",
      outcome: "error",
      stage: "runtime_deferred",
      reason: "background work is paused for 487586 ms while renderer safe mode is active",
      finishedAt: now.getTime(),
    });

    const provider = debugStore.useDebugStore.getState().health?.providers.linkedin;
    const expected =
      "Freed paused background work while the app recovers. Try syncing again in a moment.";
    expect(provider?.status).toBe("degraded");
    expect(provider?.lastError).toBe(expected);
    expect(provider?.currentMessage).toBe(expected);
    expect(provider?.latestAttempts[0]?.reason).toContain("487586 ms");
  });
});
