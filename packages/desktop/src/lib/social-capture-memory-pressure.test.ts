import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const recordProviderHealthEvent = vi.fn();
  const storeState = {
    items: [] as Array<{ platform: string; globalId?: string }>,
    preferences: {},
    fbAuth: { isAuthenticated: true, lastCapturedAt: 123_456 },
    igAuth: { isAuthenticated: true, lastCapturedAt: 123_456 },
    liAuth: { isAuthenticated: true, lastCapturedAt: 123_456 },
    setLoading: vi.fn(),
    setError: vi.fn(),
    setFbAuth: vi.fn(
      (next: {
        isAuthenticated?: boolean;
        lastCapturedAt?: number;
        lastCaptureError?: string;
      }) => {
        storeState.fbAuth = { ...storeState.fbAuth, ...next };
      },
    ),
    setIgAuth: vi.fn(
      (next: {
        isAuthenticated?: boolean;
        lastCapturedAt?: number;
        lastCaptureError?: string;
      }) => {
        storeState.igAuth = { ...storeState.igAuth, ...next };
      },
    ),
    setLiAuth: vi.fn(
      (next: {
        isAuthenticated?: boolean;
        lastCapturedAt?: number;
        lastCaptureError?: string;
      }) => {
        storeState.liAuth = { ...storeState.liAuth, ...next };
      },
    ),
    addItems: vi.fn(async (items: Array<{ platform: string; globalId?: string }>) => {
      storeState.items.push(...items);
    }),
    updatePreferences: vi.fn(async (next: Record<string, unknown>) => {
      storeState.preferences = { ...storeState.preferences, ...next };
    }),
  };

  return {
    invoke: vi.fn(),
    listen: vi.fn(),
    prepareSocialScrapeMemory: vi.fn(),
    recordProviderHealthEvent,
    storeState,
    resetStoreState: () => {
      storeState.items = [];
      storeState.preferences = {};
      storeState.fbAuth = { isAuthenticated: true, lastCapturedAt: 123_456 };
      storeState.igAuth = { isAuthenticated: true, lastCapturedAt: 123_456 };
      storeState.liAuth = { isAuthenticated: true, lastCapturedAt: 123_456 };
      storeState.setLoading.mockClear();
      storeState.setError.mockClear();
      storeState.setFbAuth.mockClear();
      storeState.setIgAuth.mockClear();
      storeState.setLiAuth.mockClear();
      storeState.addItems.mockClear();
      storeState.updatePreferences.mockClear();
      recordProviderHealthEvent.mockClear();
    },
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
  };
});

vi.mock("@tauri-apps/api/core", () => ({
  invoke: mocks.invoke,
  isTauri: () => true,
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: mocks.listen,
}));

vi.mock("@freed/capture-facebook/browser", () => ({
  fbPostsToFeedItems: mocks.fbPostsToFeedItems,
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
    getState: () => mocks.storeState,
  },
}));

vi.mock("./scraper-media-diag", () => ({
  attachScraperMediaDiagListener: vi.fn(),
}));

vi.mock("./provider-health", () => ({
  getProviderPause: vi.fn(() => null),
  recordProviderHealthEvent: mocks.recordProviderHealthEvent,
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
  mocks.resetStoreState();
  mocks.invoke.mockReset();
  mocks.listen.mockReset();
  mocks.fbPostsToFeedItems.mockClear();
  mocks.fbPostsToFeedItems.mockImplementation((posts: Array<{ id?: string }>) =>
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
  );
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
    mocks.listen.mockImplementation(
      async (
        eventName: string,
        callback: (event: { payload: unknown }) => void,
      ) => {
        listeners.set(eventName, callback);
        return vi.fn();
      },
    );
    mocks.invoke.mockImplementation(async (command: string) => {
      if (command !== "fb_scrape_feed") return null;

      listeners.get("fb-diag")?.({
        payload: {
          title: "Facebook",
          scrollHeight: 12_345,
          url: "https://www.facebook.com/",
        },
      });
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
    const { addDebugEvent } = await import("@freed/ui/lib/debug-store");
    const result = await fetchFbFeed();

    expect(result.diag.errorStage).toBeNull();
    expect(result.diag.postsExtracted).toBe(2);
    expect(result.items).toHaveLength(2);
    expect(addDebugEvent).toHaveBeenCalledWith(
      "change",
      '[FB] DOM diag: title="Facebook", scrollHeight=12,345, url=https://www.facebook.com/',
    );
  });

  it("treats extracted Facebook posts that normalize to zero items as a sync failure", async () => {
    const listeners = new Map<string, (event: { payload: unknown }) => void>();
    mocks.prepareSocialScrapeMemory.mockResolvedValue({
      before: {},
      after: { appResidentBytes: 512 * 1024 * 1024 },
      recycledScraperWindows: false,
      cacheTrimmed: false,
      mayProceed: true,
    });
    mocks.fbPostsToFeedItems.mockReturnValue([]);
    mocks.listen.mockImplementation(async (eventName: string, callback: (event: { payload: unknown }) => void) => {
      listeners.set(eventName, callback);
      return vi.fn();
    });
    mocks.invoke.mockImplementation(async (command: string) => {
      if (command !== "fb_scrape_feed") return null;

      listeners.get("fb-feed-data")?.({
        payload: {
          posts: [{ id: "raw-post", authorName: "Raw", text: "Rejected" }],
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

    expect(result.items).toEqual([]);
    expect(result.diag.postsExtracted).toBe(1);
    expect(result.diag.itemsNormalized).toBe(0);
    expect(result.diag.errorStage).toBe("normalize");
    expect(result.diag.errorMessage).toBe(
      "Extracted 1 Facebook post, but none passed normalization. accepted=0, missingId=0, invalidAuthor=1, unexpected=0, firstRejected=invalidAuthor(id:y,url:n,author:y,profile:n,text:8,media:0)",
    );
  });

  it("does not mark an empty Facebook feed scrape as a successful account sync", async () => {
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
          posts: [],
          extractedAt: Date.now(),
          url: "https://www.facebook.com/",
          strategy: "feed-pass",
          candidateCount: 0,
          scrollY: 135,
          feedContainerFound: false,
        },
      });
      return null;
    });

    const { captureFbFeed } = await import("./fb-capture");
    const { recordProviderHealthEvent } = await import("./provider-health");
    const { storeFbAuthState } = await import("./fb-auth");

    const result = await captureFbFeed();
    const expectedMessage =
      "Feed returned no posts. Facebook may need a moment to load. " +
      "1 extraction pass, last strategy feed-pass, 0 candidates on the last pass, " +
      "scrollY 135, feed container not found.";

    expect(result.items).toEqual([]);
    expect(mocks.storeState.setError).toHaveBeenCalledWith(expectedMessage);
    expect(mocks.storeState.setFbAuth).toHaveBeenCalledWith({
      isAuthenticated: true,
      lastCapturedAt: 123_456,
      lastCaptureError: expectedMessage,
    });
    expect(storeFbAuthState).toHaveBeenCalledWith({
      isAuthenticated: true,
      lastCapturedAt: 123_456,
      lastCaptureError: expectedMessage,
    });
    expect(recordProviderHealthEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: "facebook",
        outcome: "empty",
        stage: "empty",
        itemsSeen: 0,
        itemsAdded: 0,
      }),
    );
    expect(mocks.storeState.fbAuth.lastCapturedAt).toBe(123_456);
  });

  it("clears Facebook auth when the scraper reports an unauthenticated page", async () => {
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
          posts: [],
          error: "Facebook did not render an authenticated feed. Reconnect Facebook and try again.",
          extractedAt: Date.now(),
          url: "https://www.facebook.com/",
          strategy: "not_authenticated",
          candidateCount: 0,
          scrollY: 0,
          feedContainerFound: false,
        },
      });
      throw new Error("Facebook did not render an authenticated feed. Reconnect Facebook and try again.");
    });

    const { captureFbFeed } = await import("./fb-capture");
    const { storeFbAuthState } = await import("./fb-auth");

    const result = await captureFbFeed();
    const expectedMessage =
      "Facebook did not render an authenticated feed. Reconnect Facebook and try again.";

    expect(result.diag.errorStage).toBe("auth");
    expect(result.items).toEqual([]);
    expect(mocks.storeState.setError).toHaveBeenCalledWith(expectedMessage);
    expect(mocks.storeState.setFbAuth).toHaveBeenCalledWith({
      isAuthenticated: false,
      lastCapturedAt: 123_456,
      lastCaptureError: expectedMessage,
    });
    expect(storeFbAuthState).toHaveBeenCalledWith({
      isAuthenticated: false,
      lastCapturedAt: 123_456,
      lastCaptureError: expectedMessage,
    });
  });

  it("flags the Facebook zero-post pattern where scroll never advances", async () => {
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

      for (let pass = 0; pass < 8; pass++) {
        listeners.get("fb-feed-data")?.({
          payload: {
            posts: [],
            extractedAt: Date.now(),
            url: "https://www.facebook.com/",
            strategy: "role-main-fallback",
            candidateCount: 0,
            scrollY: 135,
            feedContainerFound: false,
          },
        });
      }
      return null;
    });

    const { captureFbFeed } = await import("./fb-capture");

    const result = await captureFbFeed();
    const expectedMessage =
      "Feed returned no posts. Facebook may need a moment to load. " +
      "8 extraction passes, last strategy role-main-fallback, 0 candidates on the last pass, " +
      "scrollY 135, feed container not found, scroll appears stuck near the top.";

    expect(result.items).toEqual([]);
    expect(mocks.storeState.setError).toHaveBeenCalledWith(expectedMessage);
    expect(mocks.storeState.setFbAuth).toHaveBeenCalledWith({
      isAuthenticated: true,
      lastCapturedAt: 123_456,
      lastCaptureError: expectedMessage,
    });
  });

  it("waits for local semantic indexing before invoking Instagram scrape", async () => {
    mocks.prepareSocialScrapeMemory.mockResolvedValue({
      before: {},
      after: { appResidentBytes: 512 * 1024 * 1024 },
      recycledScraperWindows: false,
      cacheTrimmed: false,
      mayProceed: true,
    });
    mocks.listen.mockResolvedValue(vi.fn());
    mocks.invoke.mockResolvedValue(null);

    const coordinator = await import("./background-runtime-coordinator");
    coordinator.resetBackgroundRuntimeForTests();
    let releaseSemantic: () => void = () => {};
    const semantic = coordinator.runBackgroundJob({
      kind: "semantic-classifier",
      source: "content-signals",
      run: () => new Promise<void>((resolve) => {
        releaseSemantic = resolve;
      }),
    });

    await Promise.resolve();
    const { fetchIgFeed } = await import("./instagram-capture");
    const resultPromise = fetchIgFeed();

    await Promise.resolve();
    expect(mocks.invoke).not.toHaveBeenCalledWith("ig_scrape_feed", expect.anything());

    releaseSemantic();
    await semantic;
    const result = await resultPromise;

    expect(result.diag.errorStage).toBeNull();
    expect(mocks.invoke).toHaveBeenCalledWith("ig_scrape_feed", expect.anything());
  });

  it("does not poison Instagram health when a provider scrape is already active", async () => {
    mocks.prepareSocialScrapeMemory.mockResolvedValue({
      before: {},
      after: { appResidentBytes: 512 * 1024 * 1024 },
      recycledScraperWindows: false,
      cacheTrimmed: false,
      mayProceed: true,
    });
    mocks.listen.mockResolvedValue(vi.fn());

    const coordinator = await import("./background-runtime-coordinator");
    coordinator.resetBackgroundRuntimeForTests();
    let releaseScrape: () => void = () => {};
    const activeScrape = coordinator.runBackgroundJob({
      kind: "social-scrape",
      source: "facebook:feed",
      run: () => new Promise<void>((resolve) => {
        releaseScrape = resolve;
      }),
    });

    await Promise.resolve();
    const { captureIgFeed } = await import("./instagram-capture");
    const result = await captureIgFeed();

    expect(result.diag.errorStage).toBe("runtime_deferred");
    expect(result.diag.errorMessage).toContain("local background work");
    expect(mocks.invoke).not.toHaveBeenCalledWith("ig_scrape_feed", expect.anything());
    expect(mocks.storeState.setError).toHaveBeenCalledWith(null);
    expect(mocks.storeState.setError).not.toHaveBeenCalledWith(
      expect.stringContaining("background work"),
    );
    expect(mocks.storeState.setIgAuth).not.toHaveBeenCalled();
    expect(mocks.recordProviderHealthEvent).not.toHaveBeenCalled();

    releaseScrape();
    await activeScrape;
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
