import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  beginFactoryResetBoundary,
  resetFactoryResetStateForTests,
} from "@freed/ui/lib/factory-reset";

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  listen: vi.fn(),
  hasAcceptedProviderRisk: vi.fn(),
  getProviderPause: vi.fn(),
  prepareSocialScrapeMemory: vi.fn(),
  recordProviderHealthEvent: vi.fn(),
  recordScrapeOutcome: vi.fn(),
  runBackgroundJob: vi.fn(),
  applyLockedSessionDeferredDiag: vi.fn(),
  docReconcileFollowRosterCapture: vi.fn(),
  getPlatformUA: vi.fn(() => "Freed Test UA"),
  storeState: {
    items: [],
    accounts: {},
    setLoading: vi.fn(),
    setError: vi.fn(),
  },
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: mocks.invoke,
  isTauri: () => true,
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: mocks.listen,
}));

vi.mock("@freed/ui/lib/debug-store", () => ({
  addDebugEvent: vi.fn(),
}));

vi.mock("./automerge", () => ({
  docReconcileFollowRosterCapture: mocks.docReconcileFollowRosterCapture,
}));

vi.mock("./background-runtime-coordinator", () => ({
  runBackgroundJob: mocks.runBackgroundJob,
}));

vi.mock("./legal-consent", () => ({
  hasAcceptedProviderRisk: mocks.hasAcceptedProviderRisk,
}));

vi.mock("./memory-monitor", () => ({
  formatScrapeMemoryPressureDetails: () => "Memory remains above the capture limit.",
  prepareSocialScrapeMemory: mocks.prepareSocialScrapeMemory,
}));

vi.mock("./provider-health", () => ({
  getProviderPause: mocks.getProviderPause,
  recordProviderHealthEvent: mocks.recordProviderHealthEvent,
}));

vi.mock("./runtime-health-events", () => ({
  recordScrapeOutcome: mocks.recordScrapeOutcome,
}));

vi.mock("./social-capture-runtime", () => ({
  applyLockedSessionDeferredDiag: mocks.applyLockedSessionDeferredDiag,
  applyNativeMemoryPressureDiag: vi.fn(() => false),
  applyRuntimeDeferredDiag: vi.fn(() => false),
  isRuntimeDeferredStage: vi.fn(() => false),
  SOCIAL_SCRAPE_WAIT_FOR_JOB_KINDS: [],
  SOCIAL_SCRAPE_WAIT_FOR_LOCAL_WORK_MS: 0,
  waitForSocialScrapeEvents: vi.fn(),
}));

vi.mock("./store", () => ({
  useAppStore: {
    getState: () => mocks.storeState,
  },
}));

vi.mock("./user-agent", () => ({
  getPlatformUA: mocks.getPlatformUA,
}));

import {
  captureAuthenticatedEssayProvider,
  resetAuthenticatedEssayCaptureRuntimeForTests,
  type AuthenticatedEssayAuthState,
  type AuthenticatedEssayCaptureConfig,
} from "./authenticated-essay-capture";

function createConfig(authOverrides: Partial<AuthenticatedEssayAuthState> = {}) {
  let auth: AuthenticatedEssayAuthState = {
    isAuthenticated: true,
    ...authOverrides,
  };
  const storeAuth = vi.fn();
  const config: AuthenticatedEssayCaptureConfig<unknown, unknown> = {
    provider: "substack",
    eventName: "substack-feed-data",
    commands: [
      "substack_scrape_graph",
      "substack_scrape_activity",
      "substack_scrape_essays",
    ],
    getWindowMode: () => "hidden",
    normalizeEntries: () => [],
    normalizeProfiles: () => [],
    deduplicateItems: (items) => items,
    deduplicateAccounts: (accounts) => accounts,
    getAuth: () => auth,
    setAuth: (next) => {
      auth = next;
    },
    storeAuth,
  };
  return { config, storeAuth };
}

beforeEach(() => {
  resetFactoryResetStateForTests();
  resetAuthenticatedEssayCaptureRuntimeForTests();
  vi.clearAllMocks();
  localStorage.clear();
  mocks.hasAcceptedProviderRisk.mockResolvedValue(true);
  mocks.getProviderPause.mockReturnValue(null);
  mocks.applyLockedSessionDeferredDiag.mockResolvedValue(false);
  mocks.prepareSocialScrapeMemory.mockResolvedValue({
    before: {},
    after: {},
    recycledScraperWindows: false,
    cacheTrimmed: false,
    mayProceed: true,
  });
});

afterEach(() => {
  resetAuthenticatedEssayCaptureRuntimeForTests();
  resetFactoryResetStateForTests();
});

describe("authenticated essay capture safety gates", () => {
  it("stops before native work when provider consent is not current", async () => {
    mocks.hasAcceptedProviderRisk.mockResolvedValue(false);
    const { config } = createConfig();

    const result = await captureAuthenticatedEssayProvider(config, "scheduled");

    expect(result.diag.errorStage).toBe("consent_required");
    expect(mocks.getProviderPause).not.toHaveBeenCalled();
    expect(mocks.prepareSocialScrapeMemory).not.toHaveBeenCalled();
    expect(mocks.invoke).not.toHaveBeenCalled();
  });

  it("rejects provider work that starts after factory reset", async () => {
    beginFactoryResetBoundary();
    const { config } = createConfig();

    await expect(
      captureAuthenticatedEssayProvider(config, "scheduled"),
    ).rejects.toThrow("Factory reset is in progress");

    expect(mocks.hasAcceptedProviderRisk).not.toHaveBeenCalled();
    expect(mocks.invoke).not.toHaveBeenCalled();
    expect(mocks.docReconcileFollowRosterCapture).not.toHaveBeenCalled();
  });

  it("stops before native work while the provider is paused", async () => {
    mocks.getProviderPause.mockReturnValue({
      pausedUntil: Date.now() + 60_000,
      pauseReason: "Provider cooldown",
    });
    const { config } = createConfig();

    const result = await captureAuthenticatedEssayProvider(config, "scheduled");

    expect(result.diag.errorStage).toBe("provider_rate_limit");
    expect(mocks.prepareSocialScrapeMemory).not.toHaveBeenCalled();
    expect(mocks.invoke).not.toHaveBeenCalled();
  });

  it("honors a restart safe local cooldown before native work", async () => {
    localStorage.setItem(
      "freed.capture-cooldown.substack",
      (Date.now() + 60_000).toString(),
    );
    const { config } = createConfig();

    const result = await captureAuthenticatedEssayProvider(config, "scheduled");

    expect(result.diag.errorStage).toBe("cooldown");
    expect(result.diag.retryAfterMs).toBeGreaterThan(59_000);
    expect(result.diag.retryAfterMs).toBeLessThanOrEqual(60_000);
    expect(mocks.prepareSocialScrapeMemory).not.toHaveBeenCalled();
    expect(mocks.invoke).not.toHaveBeenCalled();
  });

  it("ignores malformed cooldown data and still runs the memory preflight", async () => {
    mocks.prepareSocialScrapeMemory.mockResolvedValue({
      before: {},
      after: {},
      recycledScraperWindows: true,
      cacheTrimmed: true,
      mayProceed: false,
    });
    const { config } = createConfig({ captureCooldownUntil: Number.NaN });

    const result = await captureAuthenticatedEssayProvider(config, "scheduled");

    expect(result.diag.errorStage).toBe("memory_pressure");
    expect(mocks.prepareSocialScrapeMemory).toHaveBeenCalledWith(
      "substack",
      "authenticated essay capture",
    );
    expect(mocks.invoke).not.toHaveBeenCalled();
  });
});

describe("authenticated essay extraction events", () => {
  function installEventHarness(
    payloadForCommand: (command: string) => Record<string, unknown> | null,
  ): void {
    let onEvent: ((event: { payload: Record<string, unknown> }) => void) | null = null;
    mocks.listen.mockImplementation(async (_eventName, handler) => {
      onEvent = handler;
      return vi.fn();
    });
    mocks.runBackgroundJob.mockImplementation(async ({ run }) => run());
    mocks.invoke.mockImplementation(async (command: string) => {
      const payload = payloadForCommand(command);
      if (payload) onEvent?.({ payload });
      onEvent?.({ payload: { done: true, candidateCount: 0, url: "about:blank" } });
    });
  }

  it("rejects native completion markers that have no matching extraction payloads", async () => {
    installEventHarness(() => null);
    const { config } = createConfig();

    const result = await captureAuthenticatedEssayProvider(config, "manual");

    expect(result.diag).toMatchObject({
      errorStage: "event_timeout",
      extractionPasses: 0,
      completedScopes: 3,
      lastCandidateCount: null,
      lastUrl: null,
    });
    expect(mocks.docReconcileFollowRosterCapture).not.toHaveBeenCalled();
  });

  it("keeps extractor diagnostics instead of replacing them with completion defaults", async () => {
    const now = Date.now();
    const dateNow = vi
      .spyOn(Date, "now")
      .mockReturnValue(now + 37 * 60 * 1000);
    installEventHarness((command) => ({
      entries: [],
      profiles: [],
      candidateCount: command === "substack_scrape_essays" ? 7 : 3,
      url: `https://substack.com/${command}`,
      extractedAt: Date.now(),
    }));
    const { config } = createConfig();

    const result = await captureAuthenticatedEssayProvider(config, "manual");

    expect(result.diag).toMatchObject({
      errorStage: null,
      extractionPasses: 3,
      completedScopes: 3,
      lastCandidateCount: 7,
      lastUrl: "https://substack.com/substack_scrape_essays",
    });
    expect(mocks.invoke).toHaveBeenCalledWith("substack_scrape_graph", {
      windowMode: "hidden",
      userAgent: "Freed Test UA",
    });
    expect(mocks.docReconcileFollowRosterCapture).toHaveBeenCalledTimes(1);
    dateNow.mockRestore();
  });

  it("starts the cooldown when provider work begins even if the load fails", async () => {
    mocks.listen.mockResolvedValue(vi.fn());
    mocks.runBackgroundJob.mockImplementation(async ({ run }) => run());
    mocks.invoke.mockRejectedValueOnce(new Error("provider load failed"));
    const { config, storeAuth } = createConfig();
    config.provider = "medium";
    config.eventName = "medium-feed-data";
    config.commands = [
      "medium_scrape_graph",
      "medium_scrape_activity",
      "medium_scrape_essays",
    ];

    const failed = await captureAuthenticatedEssayProvider(config, "manual");
    const deferred = await captureAuthenticatedEssayProvider(config, "manual");

    expect(failed.diag.errorStage).toBe("invoke");
    expect(storeAuth).toHaveBeenCalledWith(
      expect.objectContaining({ captureCooldownUntil: expect.any(Number) }),
    );
    expect(deferred.diag.errorStage).toBe("cooldown");
    expect(deferred.diag.retryAfterMs).toBeGreaterThan(29 * 60 * 1000);
    expect(mocks.invoke).toHaveBeenCalledTimes(1);
  });

  it("stops an active provider sequence when factory reset begins", async () => {
    mocks.listen.mockResolvedValue(vi.fn());
    mocks.runBackgroundJob.mockImplementation(async ({ run }) => run());
    mocks.invoke.mockImplementationOnce(async () => {
      beginFactoryResetBoundary();
      return null;
    });
    const { config, storeAuth } = createConfig();

    await expect(
      captureAuthenticatedEssayProvider(config, "manual"),
    ).rejects.toThrow("Factory reset is in progress");

    expect(mocks.invoke).toHaveBeenCalledTimes(1);
    expect(mocks.docReconcileFollowRosterCapture).not.toHaveBeenCalled();
    expect(storeAuth).not.toHaveBeenCalled();
  });
});
