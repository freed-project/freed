import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  prepareSocialScrapeMemory: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: mocks.invoke,
  isTauri: () => true,
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(),
}));

vi.mock("@freed/ui/lib/debug-store", () => ({
  addDebugEvent: vi.fn(),
}));

vi.mock("./memory-monitor", () => ({
  formatBytesForMemoryLog: (bytes: number) => `${bytes.toLocaleString()} B`,
  prepareSocialScrapeMemory: mocks.prepareSocialScrapeMemory,
}));

vi.mock("./store", () => ({
  useAppStore: {
    getState: () => ({
      addFeedItems: vi.fn(),
      preferences: {},
    }),
  },
}));

vi.mock("./scraper-media-diag", () => ({
  attachScraperMediaDiagListener: vi.fn(),
}));

vi.mock("./provider-health", () => ({
  getProviderPause: vi.fn(() => null),
  recordProviderHealthEvent: vi.fn(),
}));

vi.mock("./fb-auth", () => ({ storeFbAuthState: vi.fn() }));
vi.mock("./instagram-auth", () => ({ storeIgAuthState: vi.fn() }));
vi.mock("./li-auth", () => ({ storeLiAuthState: vi.fn() }));
vi.mock("./media-vault", () => ({
  archiveRecentProviderMedia: vi.fn(),
  upsertMediaVaultRosterFromItems: vi.fn(),
}));

beforeEach(() => {
  vi.resetModules();
  mocks.invoke.mockReset();
  mocks.prepareSocialScrapeMemory.mockReset();
  mocks.prepareSocialScrapeMemory.mockResolvedValue({
    before: {},
    after: { appResidentBytes: 4_000_000_000 },
    recycledScraperWindows: true,
    cacheTrimmed: true,
    mayProceed: false,
  });
});

describe("social capture memory pressure gate", () => {
  it("returns Facebook memory diagnostics before invoking the native scraper", async () => {
    const { fetchFbFeed } = await import("./fb-capture");
    const result = await fetchFbFeed();

    expect(result.diag.errorStage).toBe("memory_pressure");
    expect(mocks.prepareSocialScrapeMemory).toHaveBeenCalledWith("facebook", "feed scrape");
    expect(mocks.invoke).not.toHaveBeenCalledWith("fb_scrape_feed", expect.anything());
  });

  it("returns Instagram memory diagnostics before invoking the native scraper", async () => {
    const { fetchIgFeed } = await import("./instagram-capture");
    const result = await fetchIgFeed();

    expect(result.diag.errorStage).toBe("memory_pressure");
    expect(mocks.prepareSocialScrapeMemory).toHaveBeenCalledWith("instagram", "feed scrape");
    expect(mocks.invoke).not.toHaveBeenCalledWith("ig_scrape_feed", expect.anything());
  });

  it("returns LinkedIn memory diagnostics before invoking the native scraper", async () => {
    const { fetchLiFeed } = await import("./li-capture");
    const result = await fetchLiFeed();

    expect(result.diag.errorStage).toBe("memory_pressure");
    expect(mocks.prepareSocialScrapeMemory).toHaveBeenCalledWith("linkedin", "feed scrape");
    expect(mocks.invoke).not.toHaveBeenCalledWith("li_scrape_feed", expect.anything());
  });
});
