import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  listen: vi.fn(),
  prepareSocialScrapeMemory: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: mocks.invoke,
  isTauri: () => true,
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: mocks.listen,
}));

vi.mock("@freed/capture-facebook/browser", () => ({
  fbPostsToFeedItems: vi.fn((posts: Array<{ id?: string }>) =>
    posts.map((post, index) => ({
      globalId: post.id ?? `post-${index}`,
      platform: "facebook",
      content: { text: "post", mediaUrls: [], mediaTypes: [] },
      author: { displayName: "Facebook" },
      createdAt: Date.now(),
      savedAt: Date.now(),
      tags: [],
      topics: [],
    })),
  ),
  deduplicateFeedItems: vi.fn((items: unknown[]) => items),
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
  mocks.listen.mockReset();
  mocks.prepareSocialScrapeMemory.mockReset();
  mocks.prepareSocialScrapeMemory.mockResolvedValue({
    before: {},
    after: { appResidentBytes: 4_000_000_000 },
    recycledScraperWindows: true,
    cacheTrimmed: true,
    mayProceed: false,
  });
});

describe("social capture completion", () => {
  it("keeps Facebook listeners active until the native scraper finishes", async () => {
    const listeners = new Map<string, (event: { payload: unknown }) => void>();
    mocks.prepareSocialScrapeMemory.mockResolvedValue({
      before: {},
      after: { appResidentBytes: 512 * 1024 * 1024 },
      recycledScraperWindows: false,
      cacheTrimmed: false,
      mayProceed: true,
    });
    mocks.listen.mockImplementation(async (eventName: string, callback: (event: { payload: unknown }) => void) => {
      listeners.set(eventName, callback);
      return vi.fn();
    });
    mocks.invoke.mockImplementation(async (command: string) => {
      if (command !== "fb_scrape_feed") return null;

      listeners.get("fb-feed-data")?.({
        payload: {
          posts: [{ id: "post-one", authorName: "One", text: "First" }],
          extractedAt: Date.now(),
          url: "https://www.facebook.com/",
          strategy: "test",
          candidateCount: 1,
        },
      });
      listeners.get("fb-feed-data")?.({
        payload: {
          posts: [{ id: "post-two", authorName: "Two", text: "Second" }],
          extractedAt: Date.now(),
          url: "https://www.facebook.com/",
          strategy: "test",
          candidateCount: 1,
        },
      });
      return null;
    });

    const { fetchFbFeed } = await import("./fb-capture");
    const result = await fetchFbFeed();

    expect(result.diag.errorStage).toBeNull();
    expect(result.diag.postsExtracted).toBe(2);
    expect(result.items).toHaveLength(2);
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

  it("defers Facebook groups before invoking the native scraper", async () => {
    const { captureFbGroups } = await import("./fb-capture");
    const result = await captureFbGroups();

    expect(result).toEqual([]);
    expect(mocks.prepareSocialScrapeMemory).toHaveBeenCalledWith("facebook", "groups scrape");
    expect(mocks.invoke).not.toHaveBeenCalledWith("fb_scrape_groups", expect.anything());
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
