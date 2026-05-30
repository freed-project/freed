import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const state = {
    feeds: {},
    items: [],
    xAuth: { isAuthenticated: false, cookies: null },
    fbAuth: { isAuthenticated: true },
    igAuth: { isAuthenticated: false },
    liAuth: { isAuthenticated: false },
    substackAuth: { isAuthenticated: false },
    mediumAuth: { isAuthenticated: false },
    ytAuth: { isAuthenticated: false },
    setSyncing: vi.fn(),
    setError: vi.fn(),
  };

  return {
    state,
    addDebugEvent: vi.fn(),
    captureFbFeed: vi.fn(),
    captureIgFeed: vi.fn(),
    captureLiFeed: vi.fn(),
    captureSubstackFeed: vi.fn(),
    captureMediumFeed: vi.fn(),
    captureYouTube: vi.fn(),
    captureXTimeline: vi.fn(),
    docBatchRefreshFeeds: vi.fn(),
    isProviderPaused: vi.fn(() => false),
    recordProviderHealthEvent: vi.fn(),
    withProviderSyncing: vi.fn(
      async (_provider: string, run: () => Promise<unknown>) => run(),
    ),
  };
});

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
  isTauri: () => true,
}));

vi.mock("@freed/ui/lib/debug-store", () => ({
  addDebugEvent: mocks.addDebugEvent,
}));

vi.mock("./automerge", () => ({
  docBatchRefreshFeeds: mocks.docBatchRefreshFeeds,
}));

vi.mock("./fb-capture", () => ({
  captureFbFeed: mocks.captureFbFeed,
}));

vi.mock("./instagram-capture", () => ({
  captureIgFeed: mocks.captureIgFeed,
}));

vi.mock("./li-capture", () => ({
  captureLiFeed: mocks.captureLiFeed,
}));

vi.mock("./substack-capture", () => ({
  captureSubstackFeed: mocks.captureSubstackFeed,
}));

vi.mock("./medium-capture", () => ({
  captureMediumFeed: mocks.captureMediumFeed,
}));

vi.mock("./youtube-capture", () => ({
  captureYouTube: mocks.captureYouTube,
}));

vi.mock("./x-capture", () => ({
  captureXTimeline: mocks.captureXTimeline,
}));

vi.mock("./provider-health", () => ({
  isProviderPaused: mocks.isProviderPaused,
  recordProviderHealthEvent: mocks.recordProviderHealthEvent,
}));

vi.mock("./store", () => ({
  useAppStore: {
    getState: () => mocks.state,
  },
  withProviderSyncing: mocks.withProviderSyncing,
}));

let captureModule: typeof import("./capture");

describe("scheduled social capture retries", () => {
  beforeAll(async () => {
    captureModule = await import("./capture");
  });

  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(Math, "random").mockReturnValue(0);
    mocks.addDebugEvent.mockClear();
    mocks.captureFbFeed.mockReset();
    mocks.captureIgFeed.mockReset();
    mocks.captureLiFeed.mockReset();
    mocks.captureSubstackFeed.mockReset();
    mocks.captureMediumFeed.mockReset();
    mocks.captureYouTube.mockReset();
    mocks.captureXTimeline.mockReset();
    mocks.docBatchRefreshFeeds.mockReset();
    mocks.isProviderPaused.mockClear();
    mocks.recordProviderHealthEvent.mockClear();
    mocks.withProviderSyncing.mockClear();
    mocks.state.setSyncing.mockClear();
    mocks.state.setError.mockClear();
    mocks.state.fbAuth = { isAuthenticated: true };
    mocks.state.igAuth = { isAuthenticated: false };
    mocks.state.liAuth = { isAuthenticated: false };
    mocks.state.substackAuth = { isAuthenticated: false };
    mocks.state.mediumAuth = { isAuthenticated: false };
    mocks.state.ytAuth = { isAuthenticated: false };
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("retries a Facebook memory deferral before the next scheduled poll", async () => {
    mocks.captureFbFeed
      .mockResolvedValueOnce({
        items: [],
        diag: {
          errorStage: "memory_pressure",
          errorMessage: "Facebook sync did not start because Freed Desktop memory is high.",
        },
      })
      .mockResolvedValueOnce({
        items: [],
        diag: {
          errorStage: null,
          errorMessage: null,
        },
      });

    await captureModule.refreshAllFeeds();

    expect(mocks.captureFbFeed).toHaveBeenCalledTimes(1);
    expect(mocks.addDebugEvent).toHaveBeenCalledWith(
      "change",
      "[FB] retry scheduled in 120s after memory_pressure",
    );

    await vi.advanceTimersByTimeAsync(119_999);
    expect(mocks.captureFbFeed).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1);
    expect(mocks.captureFbFeed).toHaveBeenCalledTimes(2);
    expect(mocks.withProviderSyncing).toHaveBeenLastCalledWith(
      "facebook",
      expect.any(Function),
    );
  });

  it("returns success details when Facebook sees posts", async () => {
    mocks.captureFbFeed.mockResolvedValueOnce({
      items: [],
      diag: {
        errorStage: null,
        errorMessage: null,
        postsExtracted: 4,
        itemsAdded: 0,
      },
    });

    const result = await captureModule.refreshSocialProvider("facebook");

    expect(result).toMatchObject({
      provider: "facebook",
      status: "success",
      postsExtracted: 4,
      itemsAdded: 0,
    });
  });

  it("returns empty when Facebook sees no posts", async () => {
    mocks.captureFbFeed.mockResolvedValueOnce({
      items: [],
      diag: {
        errorStage: null,
        errorMessage: null,
        postsExtracted: 0,
        itemsAdded: 0,
      },
    });

    const result = await captureModule.refreshSocialProvider("facebook");

    expect(result).toMatchObject({
      provider: "facebook",
      status: "empty",
      stage: "empty",
      postsExtracted: 0,
      itemsAdded: 0,
    });
  });

  it("returns ignored when Facebook is not authenticated", async () => {
    mocks.state.fbAuth = { isAuthenticated: false };

    const result = await captureModule.refreshSocialProvider("facebook");

    expect(mocks.captureFbFeed).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      provider: "facebook",
      status: "ignored",
      stage: "auth",
    });
  });

  it("summarizes Substack graph and activity records", async () => {
    mocks.state.substackAuth = { isAuthenticated: true };
    mocks.captureSubstackFeed.mockResolvedValueOnce({
      items: [],
      accounts: [],
      diag: {
        errorStage: null,
        errorMessage: null,
        entriesExtracted: 3,
        profilesExtracted: 5,
        itemsAdded: 2,
        accountsAdded: 4,
      },
    });

    const result = await captureModule.refreshSocialProvider("substack", "scheduled");

    expect(mocks.captureSubstackFeed).toHaveBeenCalledWith("scheduled");
    expect(result).toMatchObject({
      provider: "substack",
      status: "success",
      postsExtracted: 8,
      itemsAdded: 6,
    });
  });

  it("retries a local cooldown without immediate provider traffic", async () => {
    mocks.state.mediumAuth = { isAuthenticated: true };
    mocks.captureMediumFeed
      .mockResolvedValueOnce({
        items: [],
        accounts: [],
        diag: {
          errorStage: "cooldown",
          errorMessage: "Cooling down.",
          retryAfterMs: 300_000,
          entriesExtracted: 0,
          profilesExtracted: 0,
          itemsAdded: 0,
          accountsAdded: 0,
        },
      })
      .mockResolvedValueOnce({
        items: [],
        accounts: [],
        diag: {
          errorStage: null,
          errorMessage: null,
          entriesExtracted: 0,
          profilesExtracted: 0,
          itemsAdded: 0,
          accountsAdded: 0,
        },
      });

    const first = await captureModule.refreshSocialProvider("medium", "scheduled");

    expect(first.status).toBe("deferred");
    expect(mocks.captureMediumFeed).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(299_999);
    expect(mocks.captureMediumFeed).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(mocks.captureMediumFeed).toHaveBeenCalledTimes(2);
    expect(mocks.captureMediumFeed).toHaveBeenLastCalledWith("deferred_retry");
  });
});
