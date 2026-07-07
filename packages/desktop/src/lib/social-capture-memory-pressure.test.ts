import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BackgroundRuntimeTask } from "./background-runtime-coordinator";

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
    runBackgroundJob: vi.fn(
      async <T>(task: BackgroundRuntimeTask<T>) => await task.run(),
    ),
    resetBackgroundRuntimeForTests: vi.fn(),
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
  formatScrapeMemoryPressureDetails: () =>
    "Memory pressure is 2.00 GB, app RSS is 3.00 GB, WebKit RSS is 1.00 GB, high limit is 2.50 GB, critical limit is 3.50 GB after cleanup.",
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

vi.mock("./background-runtime-coordinator", async () => {
  const actual =
    await vi.importActual<typeof import("./background-runtime-coordinator")>(
      "./background-runtime-coordinator",
    );
  return {
    ...actual,
    runBackgroundJob: mocks.runBackgroundJob,
    resetBackgroundRuntimeForTests: mocks.resetBackgroundRuntimeForTests,
  };
});

vi.mock("./fb-auth", () => ({ storeFbAuthState: vi.fn() }));
vi.mock("./instagram-auth", () => ({ storeIgAuthState: vi.fn() }));
vi.mock("./li-auth", () => ({ storeLiAuthState: vi.fn() }));
vi.mock("./media-vault", () => ({
  archiveRecentProviderMedia: vi.fn(),
  upsertMediaVaultRosterFromItems: vi.fn(),
}));

beforeEach(() => {
  vi.useRealTimers();
  vi.resetModules();
  mocks.resetStoreState();
  mocks.invoke.mockReset();
  mocks.listen.mockReset();
  mocks.runBackgroundJob.mockReset();
  mocks.runBackgroundJob.mockImplementation(
    async <T>(task: BackgroundRuntimeTask<T>) => await task.run(),
  );
  mocks.resetBackgroundRuntimeForTests.mockReset();
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
        outcome: "error",
        stage: "extract_empty",
        reason: expectedMessage,
        itemsSeen: 0,
        itemsAdded: 0,
      }),
    );
    expect(mocks.storeState.fbAuth.lastCapturedAt).toBe(123_456);
  });

  it("records silent Facebook extraction as a sync failure", async () => {
    mocks.prepareSocialScrapeMemory.mockResolvedValue({
      before: {},
      after: { appResidentBytes: 512 * 1024 * 1024 },
      recycledScraperWindows: false,
      cacheTrimmed: false,
      mayProceed: true,
    });
    mocks.listen.mockResolvedValue(vi.fn());
    mocks.invoke.mockImplementation(async (command: string) => {
      if (command === "fb_scrape_feed") return null;
      return null;
    });

    const { captureFbFeed } = await import("./fb-capture");
    const { recordProviderHealthEvent } = await import("./provider-health");

    const result = await captureFbFeed();
    const expectedMessage =
      "Facebook extraction returned no scrape batches. The WebView may be on a stale page, the injected script may not have emitted, or the renderer may have stalled before extraction finished.";

    expect(result.items).toEqual([]);
    expect(result.diag.errorStage).toBe("extract_silent");
    expect(result.diag.errorMessage).toBe(expectedMessage);
    expect(mocks.storeState.setError).toHaveBeenCalledWith(expectedMessage);
    expect(mocks.storeState.setFbAuth).toHaveBeenCalledWith({
      isAuthenticated: true,
      lastCapturedAt: 123_456,
      lastCaptureError: expectedMessage,
    });
    expect(recordProviderHealthEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: "facebook",
        outcome: "error",
        stage: "extract_silent",
        reason: expectedMessage,
        itemsSeen: 0,
        itemsAdded: 0,
      }),
    );
  });

  it("fails Facebook sync locally when the isolated WebView has no auth cookies", async () => {
    mocks.invoke.mockImplementation(async (command: string) => {
      if (command === "get_social_provider_cookie_state") {
        return {
          provider: "facebook",
          available: true,
          hasAuthCookie: false,
          cookieCount: 6,
          cookieNames: ["datr", "fr", "ps_l", "ps_n", "sb", "wd"],
          error: null,
        };
      }
      return null;
    });

    const { captureFbFeed } = await import("./fb-capture");
    const { recordProviderHealthEvent } = await import("./provider-health");
    const { storeFbAuthState } = await import("./fb-auth");

    const result = await captureFbFeed();
    const expectedMessage =
      "Facebook is not connected in the local WebView session. Reconnect Facebook and try again.";

    expect(result.diag.errorStage).toBe("auth");
    expect(result.items).toEqual([]);
    expect(mocks.prepareSocialScrapeMemory).not.toHaveBeenCalled();
    expect(mocks.invoke).not.toHaveBeenCalledWith("fb_scrape_feed", expect.anything());
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
    expect(recordProviderHealthEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: "facebook",
        outcome: "error",
        stage: "auth",
        reason: expectedMessage,
        itemsSeen: 0,
        itemsAdded: 0,
      }),
    );
  });

  it("records why Facebook saw posts but added no new items", async () => {
    const listeners = new Map<string, (event: { payload: unknown }) => void>();
    mocks.storeState.items = [{ platform: "facebook", globalId: "existing-post" }];
    mocks.storeState.addItems.mockImplementationOnce(async () => undefined);
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
          posts: [{ id: "existing-post", authorName: "Existing", text: "Already here" }],
          extractedAt: Date.now(),
          url: "https://www.facebook.com/",
          strategy: "test",
          candidateCount: 1,
        },
      });
      return null;
    });

    const { captureFbFeed } = await import("./fb-capture");
    const { recordProviderHealthEvent } = await import("./provider-health");

    const result = await captureFbFeed();

    expect(result.diag.postsExtracted).toBe(1);
    expect(result.diag.itemsAdded).toBe(0);
    expect(result.diag.existingItems).toBe(1);
    expect(recordProviderHealthEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: "facebook",
        outcome: "success",
        reason: "No new Facebook items: 1 already present, 1 write candidate.",
        itemsSeen: 1,
        itemsAdded: 0,
      }),
    );
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

  it("fails Facebook sync when rendered candidates cannot be parsed into posts", async () => {
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
          strategy: "role-main-fallback",
          candidateCount: 3,
          rejected: {
            suggestedOrSponsored: 1,
            missingAuthor: 2,
            missingContent: 1,
          },
          scrollY: 640,
          feedContainerFound: true,
          scrapeRunId: "fb-test-run",
          pageState: {
            state: "feed_possible",
            feedLike: true,
            feedUnitCount: 3,
            scrollHeight: 4_200,
            url: "https://www.facebook.com/",
            title: "Facebook",
          },
        },
      });
      return null;
    });

    const { captureFbFeed } = await import("./fb-capture");
    const { recordProviderHealthEvent } = await import("./provider-health");

    const result = await captureFbFeed();
    const expectedMessage =
      "Facebook rendered post-like blocks, but Freed Desktop could not parse any posts. " +
      "3 candidates, 2 missing author, 1 missing content, 1 suggested or sponsored, " +
      "1 extraction pass, max scrollY 640, page state feed_possible.";

    expect(result.items).toEqual([]);
    expect(result.diag.errorStage).toBe("extract");
    expect(result.diag.errorMessage).toBe(expectedMessage);
    expect(result.diag.totalCandidateCount).toBe(3);
    expect(result.diag.totalRejected).toEqual({
      suggestedOrSponsored: 1,
      missingAuthor: 2,
      missingContent: 1,
    });
    expect(result.diag.scrapeRunId).toBe("fb-test-run");
    expect(mocks.storeState.setError).toHaveBeenCalledWith(expectedMessage);
    expect(recordProviderHealthEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: "facebook",
        outcome: "error",
        stage: "extract",
        reason: expectedMessage,
        itemsSeen: 0,
        itemsAdded: 0,
      }),
    );
  });

  it("defers Facebook sync before scraping when the Mac session is locked", async () => {
    mocks.invoke.mockImplementation(async (command: string) => {
      if (command === "get_desktop_session_state") {
        return {
          available: true,
          screenLocked: true,
          error: null,
        };
      }
      return null;
    });

    const { captureFbFeed } = await import("./fb-capture");
    const { recordProviderHealthEvent } = await import("./provider-health");

    const result = await captureFbFeed();
    const expectedMessage =
      "Freed paused provider sync because the Mac is locked. Unlock the Mac and try syncing again.";

    expect(result.diag.errorStage).toBe("runtime_deferred");
    expect(result.diag.errorMessage).toBe(expectedMessage);
    expect(mocks.prepareSocialScrapeMemory).not.toHaveBeenCalled();
    expect(mocks.invoke).not.toHaveBeenCalledWith("fb_scrape_feed", expect.anything());
    expect(mocks.storeState.setError).toHaveBeenCalledWith(null);
    expect(mocks.storeState.setError).not.toHaveBeenCalledWith(expectedMessage);
    expect(mocks.storeState.setFbAuth).not.toHaveBeenCalled();
    expect(recordProviderHealthEvent).not.toHaveBeenCalled();
  });

  it("defers LinkedIn sync before scraping when the Mac session is locked", async () => {
    mocks.invoke.mockImplementation(async (command: string) => {
      if (command === "get_desktop_session_state") {
        return {
          available: true,
          screenLocked: true,
          error: null,
        };
      }
      return null;
    });

    const { captureLiFeed } = await import("./li-capture");
    const { recordProviderHealthEvent } = await import("./provider-health");

    const result = await captureLiFeed();

    expect(result.diag.errorStage).toBe("runtime_deferred");
    expect(mocks.prepareSocialScrapeMemory).not.toHaveBeenCalled();
    expect(mocks.invoke).not.toHaveBeenCalledWith("li_scrape_feed", expect.anything());
    expect(mocks.storeState.setError).toHaveBeenCalledWith(null);
    expect(mocks.storeState.setLiAuth).not.toHaveBeenCalled();
    expect(recordProviderHealthEvent).not.toHaveBeenCalled();
  });

  it("defers Instagram sync before scraping when the Mac session is locked", async () => {
    mocks.invoke.mockImplementation(async (command: string) => {
      if (command === "get_desktop_session_state") {
        return {
          available: true,
          screenLocked: true,
          error: null,
        };
      }
      return null;
    });

    const { captureIgFeed } = await import("./instagram-capture");
    const { recordProviderHealthEvent } = await import("./provider-health");

    const result = await captureIgFeed();

    expect(result.diag.errorStage).toBe("runtime_deferred");
    expect(mocks.prepareSocialScrapeMemory).not.toHaveBeenCalled();
    expect(mocks.invoke).not.toHaveBeenCalledWith("ig_scrape_feed", expect.anything());
    expect(mocks.storeState.setError).toHaveBeenCalledWith(null);
    expect(mocks.storeState.setIgAuth).not.toHaveBeenCalled();
    expect(recordProviderHealthEvent).not.toHaveBeenCalled();
  });

  it("invokes Instagram scrape while local semantic indexing is active", async () => {
    mocks.prepareSocialScrapeMemory.mockResolvedValue({
      before: {},
      after: { appResidentBytes: 512 * 1024 * 1024 },
      recycledScraperWindows: false,
      cacheTrimmed: false,
      mayProceed: true,
    });
    mocks.listen.mockResolvedValue(vi.fn());
    mocks.invoke.mockResolvedValue(null);

    let releaseSemantic: () => void = () => {};
    mocks.runBackgroundJob.mockImplementation(async <T>(task: BackgroundRuntimeTask<T>) => {
      if (task.kind === "semantic-classifier") {
        return await new Promise<T>((resolve) => {
          releaseSemantic = () => resolve(undefined as T);
        });
      }
      return await task.run();
    });
    const { runBackgroundJob } = await import("./background-runtime-coordinator");
    const semantic = runBackgroundJob({
      kind: "semantic-classifier",
      source: "content-signals",
      blocking: false,
      run: () => new Promise<void>((resolve) => {
        releaseSemantic = resolve;
      }),
    });

    await Promise.resolve();
    const { fetchIgFeed } = await import("./instagram-capture");
    const resultPromise = fetchIgFeed();

    await Promise.resolve();
    await resultPromise;
    expect(mocks.invoke).toHaveBeenCalledWith("ig_scrape_feed", expect.anything());

    releaseSemantic();
    await semantic;
  });

  it("does not mark an empty Instagram feed scrape as a successful account sync", async () => {
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
      if (command !== "ig_scrape_feed") return null;
      listeners.get("ig-feed-data")?.({
        payload: {
          posts: [],
          extractedAt: Date.now(),
          url: "https://www.instagram.com/?variant=following",
          strategy: "article",
          candidateCount: 3,
          scrollY: 640,
          rejected: {
            suggestedOrSponsored: 1,
            missingContent: 2,
          },
          pageState: {
            articleCount: 3,
            mainFound: true,
            loggedInCookie: true,
            loginChrome: false,
            feedLike: true,
            scrollHeight: 4_200,
            url: "https://www.instagram.com/?variant=following",
            title: "Instagram",
          },
        },
      });
      return null;
    });

    const { captureIgFeed } = await import("./instagram-capture");
    const { recordProviderHealthEvent } = await import("./provider-health");

    const result = await captureIgFeed();
    const expectedMessage =
      "Instagram feed returned 0 posts. 1 extraction pass, last strategy article, " +
      "3 candidates on the last pass, scrollY 640, scrollHeight 4,200, 3 rejected.";

    expect(result.items).toEqual([]);
    expect(result.diag.errorStage).toBe("extract_empty");
    expect(result.diag.errorMessage).toBe(expectedMessage);
    expect(result.diag.totalCandidateCount).toBe(3);
    expect(result.diag.totalRejected).toEqual({
      suggestedOrSponsored: 1,
      missingContent: 2,
      duplicate: 0,
      tinyOrInvisible: 0,
    });
    expect(mocks.storeState.setError).toHaveBeenCalledWith(expectedMessage);
    expect(mocks.storeState.setIgAuth).toHaveBeenCalledWith(
      expect.objectContaining({ lastCaptureError: expectedMessage }),
    );
    expect(recordProviderHealthEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: "instagram",
        outcome: "error",
        stage: "extract_empty",
        reason: expectedMessage,
        itemsSeen: 0,
        itemsAdded: 0,
      }),
    );
  });

  it("records silent Instagram extraction as a sync failure", async () => {
    mocks.prepareSocialScrapeMemory.mockResolvedValue({
      before: {},
      after: { appResidentBytes: 512 * 1024 * 1024 },
      recycledScraperWindows: false,
      cacheTrimmed: false,
      mayProceed: true,
    });
    mocks.listen.mockResolvedValue(vi.fn());
    mocks.invoke.mockImplementation(async (command: string) => {
      if (command === "ig_scrape_feed") return null;
      return null;
    });

    const { captureIgFeed } = await import("./instagram-capture");
    const { recordProviderHealthEvent } = await import("./provider-health");

    const result = await captureIgFeed();
    const expectedMessage =
      "Instagram extraction returned no scrape batches. The WebView may be on a stale page, the injected script may not have emitted, or the renderer may have stalled before extraction finished.";

    expect(result.items).toEqual([]);
    expect(result.diag.errorStage).toBe("extract_silent");
    expect(result.diag.errorMessage).toBe(expectedMessage);
    expect(mocks.storeState.setError).toHaveBeenCalledWith(expectedMessage);
    expect(mocks.storeState.setIgAuth).toHaveBeenCalledWith(
      expect.objectContaining({ lastCaptureError: expectedMessage }),
    );
    expect(recordProviderHealthEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: "instagram",
        outcome: "error",
        stage: "extract_silent",
        reason: expectedMessage,
        itemsSeen: 0,
        itemsAdded: 0,
      }),
    );
  });

  it("records Instagram placeholder feed recovery failures with a specific stage", async () => {
    mocks.prepareSocialScrapeMemory.mockResolvedValue({
      before: {},
      after: { appResidentBytes: 512 * 1024 * 1024 },
      recycledScraperWindows: false,
      cacheTrimmed: false,
      mayProceed: true,
    });
    mocks.listen.mockResolvedValue(vi.fn());
    mocks.invoke.mockImplementation(async (command: string) => {
      if (command === "ig_scrape_feed") {
        throw new Error(
          "placeholder_feed: Instagram loaded placeholder feed articles after one refresh. ready_articles=0, tiny_articles=2, articles=2, scroll_height=1,199",
        );
      }
      return null;
    });

    const { captureIgFeed } = await import("./instagram-capture");
    const { recordProviderHealthEvent } = await import("./provider-health");

    const result = await captureIgFeed();

    expect(result.items).toEqual([]);
    expect(result.diag.errorStage).toBe("placeholder_feed");
    expect(result.diag.errorMessage).toContain(
      "Instagram loaded placeholder feed articles after one refresh",
    );
    expect(mocks.storeState.setError).toHaveBeenCalledWith(
      expect.stringContaining("placeholder feed articles"),
    );
    expect(recordProviderHealthEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: "instagram",
        outcome: "error",
        stage: "placeholder_feed",
        reason: expect.stringContaining("placeholder feed articles"),
      }),
    );
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

    const { BackgroundRuntimeDeferredError } = await import("./background-runtime-coordinator");
    mocks.runBackgroundJob.mockImplementation(async <T>(task: BackgroundRuntimeTask<T>) => {
      if (task.kind === "social-scrape" && task.source === "instagram:feed") {
        throw new BackgroundRuntimeDeferredError("active:social-scrape:facebook:feed");
      }
      return await task.run();
    });

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
  });

  it("does not poison LinkedIn health when app recovery defers the scrape", async () => {
    mocks.prepareSocialScrapeMemory.mockResolvedValue({
      before: {},
      after: { appResidentBytes: 512 * 1024 * 1024 },
      recycledScraperWindows: false,
      cacheTrimmed: false,
      mayProceed: true,
    });
    mocks.listen.mockResolvedValue(vi.fn());

    const { BackgroundRuntimeDeferredError } = await import("./background-runtime-coordinator");
    mocks.runBackgroundJob.mockImplementation(async <T>(task: BackgroundRuntimeTask<T>) => {
      if (task.kind === "social-scrape" && task.source === "linkedin:feed") {
        throw new BackgroundRuntimeDeferredError("renderer_safe_mode:487586");
      }
      return await task.run();
    });

    const { captureLiFeed } = await import("./li-capture");
    const result = await captureLiFeed();

    expect(result.diag.errorStage).toBe("runtime_deferred");
    expect(result.diag.errorMessage).toBe(
      "Freed paused background work while the app recovers. Try syncing again in a moment.",
    );
    expect(mocks.invoke).not.toHaveBeenCalledWith("li_scrape_feed", expect.anything());
    expect(mocks.storeState.setError).toHaveBeenCalledWith(null);
    expect(mocks.storeState.setError).not.toHaveBeenCalledWith(
      expect.stringContaining("renderer"),
    );
    expect(mocks.storeState.setLiAuth).not.toHaveBeenCalled();
    expect(mocks.recordProviderHealthEvent).not.toHaveBeenCalled();
  });
});

describe("social capture memory pressure gate", () => {
  function allowRendererMemoryPreflight(): void {
    mocks.prepareSocialScrapeMemory.mockResolvedValue({
      before: {},
      after: { appResidentBytes: 512 * 1024 * 1024 },
      recycledScraperWindows: false,
      cacheTrimmed: false,
      mayProceed: true,
    });
  }

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

  it("classifies native Instagram memory rejections after renderer preflight", async () => {
    allowRendererMemoryPreflight();
    mocks.listen.mockResolvedValue(vi.fn());
    mocks.invoke.mockImplementation(async (command: string) => {
      if (command === "ig_scrape_feed") {
        throw new Error(
          "Instagram sync paused because Freed Desktop memory remains high after cleanup.",
        );
      }
      return null;
    });

    const { fetchIgFeed } = await import("./instagram-capture");
    const result = await fetchIgFeed();

    expect(result.diag.errorStage).toBe("memory_pressure");
    expect(result.diag.errorMessage).toContain("Instagram sync did not start");
    expect(mocks.invoke).toHaveBeenCalledWith("ig_scrape_feed", expect.anything());
  });

  it("classifies native Facebook memory rejections after renderer preflight", async () => {
    allowRendererMemoryPreflight();
    mocks.listen.mockResolvedValue(vi.fn());
    mocks.invoke.mockImplementation(async (command: string) => {
      if (command === "fb_scrape_feed") {
        throw new Error(
          "Facebook sync paused because Freed Desktop memory remains high after cleanup.",
        );
      }
      return null;
    });

    const { fetchFbFeed } = await import("./fb-capture");
    const result = await fetchFbFeed();

    expect(result.diag.errorStage).toBe("memory_pressure");
    expect(result.diag.errorMessage).toContain("Facebook sync did not start");
    expect(mocks.invoke).toHaveBeenCalledWith("fb_scrape_feed", expect.anything());
  });

  it("returns LinkedIn memory diagnostics before invoking the native scraper", async () => {
    const { fetchLiFeed } = await import("./li-capture");
    const result = await fetchLiFeed();

    expect(result.diag.errorStage).toBe("memory_pressure");
    expect(mocks.prepareSocialScrapeMemory).toHaveBeenCalledWith("linkedin", "feed scrape");
    expect(mocks.invoke).not.toHaveBeenCalledWith("li_scrape_feed", expect.anything());
  });

  it("classifies native LinkedIn memory rejections after renderer preflight", async () => {
    allowRendererMemoryPreflight();
    mocks.listen.mockResolvedValue(vi.fn());
    mocks.invoke.mockImplementation(async (command: string) => {
      if (command === "li_scrape_feed") {
        throw new Error(
          "LinkedIn sync paused because Freed Desktop memory remains high after cleanup.",
        );
      }
      return null;
    });

    const { fetchLiFeed } = await import("./li-capture");
    const result = await fetchLiFeed();

    expect(result.diag.errorStage).toBe("memory_pressure");
    expect(result.diag.errorMessage).toContain("LinkedIn sync did not start");
    expect(mocks.invoke).toHaveBeenCalledWith("li_scrape_feed", expect.anything());
  });

  it("classifies LinkedIn scrapes with no extraction events as IPC timeouts", async () => {
    allowRendererMemoryPreflight();
    mocks.listen.mockResolvedValue(vi.fn());
    mocks.invoke.mockImplementation(async (command: string) => {
      if (command === "li_scrape_feed") {
        return null;
      }
      return null;
    });

    const { fetchLiFeed } = await import("./li-capture");
    const result = await fetchLiFeed();

    expect(result.items).toEqual([]);
    expect(result.diag.extractionPasses).toBe(0);
    expect(result.diag.errorStage).toBe("event_timeout");
    expect(result.diag.errorMessage).toBe(
      "LinkedIn scraper finished before Freed received any extraction events. url=unknown.",
    );
    expect(mocks.invoke).toHaveBeenCalledWith("li_scrape_feed", expect.anything());
  });
});
