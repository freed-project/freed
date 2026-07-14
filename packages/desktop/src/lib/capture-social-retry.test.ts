import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const state = {
    feeds: {},
    items: [],
    xAuth: { isAuthenticated: false, cookies: null },
    fbAuth: { isAuthenticated: true },
    igAuth: { isAuthenticated: false },
    liAuth: { isAuthenticated: false },
    setSyncing: vi.fn(),
    setError: vi.fn(),
  };

  return {
    state,
    addDebugEvent: vi.fn(),
    captureFbFeed: vi.fn(),
    captureIgFeed: vi.fn(),
    captureLiFeed: vi.fn(),
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

describe("scheduled social capture retries", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(Math, "random").mockReturnValue(0);
    mocks.addDebugEvent.mockClear();
    mocks.captureFbFeed.mockReset();
    mocks.captureIgFeed.mockReset();
    mocks.captureLiFeed.mockReset();
    mocks.captureXTimeline.mockReset();
    mocks.docBatchRefreshFeeds.mockReset();
    mocks.isProviderPaused.mockReset();
    mocks.isProviderPaused.mockReturnValue(false);
    mocks.recordProviderHealthEvent.mockClear();
    mocks.withProviderSyncing.mockClear();
    mocks.state.setSyncing.mockClear();
    mocks.state.setError.mockClear();
    mocks.state.fbAuth = { isAuthenticated: true };
    mocks.state.igAuth = { isAuthenticated: false };
    mocks.state.liAuth = { isAuthenticated: false };
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

    const { refreshAllFeeds } = await import("./capture");
    await refreshAllFeeds();

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

    const { refreshSocialProvider } = await import("./capture");
    const result = await refreshSocialProvider("facebook");

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

    const { refreshSocialProvider } = await import("./capture");
    const result = await refreshSocialProvider("facebook");

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

    const { refreshSocialProvider } = await import("./capture");
    const result = await refreshSocialProvider("facebook");

    expect(mocks.captureFbFeed).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      provider: "facebook",
      status: "ignored",
      stage: "auth",
    });
  });

  it("does not start automatic capture when provider health fails closed", async () => {
    mocks.isProviderPaused.mockReturnValue(true);

    const { refreshSocialProvider } = await import("./capture");
    const result = await refreshSocialProvider("facebook", "scheduled");

    expect(mocks.captureFbFeed).not.toHaveBeenCalled();
    expect(mocks.withProviderSyncing).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      provider: "facebook",
      status: "ignored",
      stage: "paused",
    });
  });
});
