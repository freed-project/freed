import { beforeEach, describe, expect, it, vi } from "vitest";

type ProviderStage = "x" | "facebook" | "instagram" | "linkedin" | "youtube";

const mocks = vi.hoisted(() => {
  const state = {
    feeds: {} as Record<string, {
      url: string;
      title: string;
      enabled: boolean;
      trackUnread: boolean;
    }>,
    items: [] as unknown[],
    xAuth: { isAuthenticated: false, cookies: null as unknown },
    fbAuth: { isAuthenticated: false },
    igAuth: { isAuthenticated: false },
    liAuth: { isAuthenticated: false },
    ytAuth: { isAuthenticated: false },
    addFeed: vi.fn(async () => undefined),
    addItems: vi.fn(async () => undefined),
    setLoading: vi.fn(),
    setSyncing: vi.fn(),
    setError: vi.fn(),
  };

  return {
    state,
    resetActive: false,
    invoke: vi.fn(),
    captureXTimeline: vi.fn(),
    captureFbFeed: vi.fn(),
    captureIgFeed: vi.fn(),
    captureLiFeed: vi.fn(),
    captureYouTube: vi.fn(),
    docBatchRefreshFeeds: vi.fn(async () => undefined),
    recordProviderHealthEvent: vi.fn(async () => undefined),
    recordRssPullAttempt: vi.fn(),
    withProviderSyncing: vi.fn(
      async (_provider: string, run: () => Promise<unknown>) => run(),
    ),
  };
});

vi.mock("@tauri-apps/api/core", () => ({
  isTauri: () => true,
  invoke: mocks.invoke,
}));

vi.mock("@freed/ui/lib/debug-store", () => ({ addDebugEvent: vi.fn() }));
vi.mock("@freed/ui/lib/factory-reset", () => ({
  captureFactoryResetWriteEpoch: () => mocks.resetActive ? null : 0,
  isFactoryResetWriteAllowed: (epoch: number | null) => !mocks.resetActive && epoch === 0,
  isFactoryResetInProgress: () => mocks.resetActive,
  trackFactoryResetSensitiveOperation: <T,>(operation: Promise<T>) => operation,
}));
vi.mock("./automerge", () => ({
  docBatchRefreshFeeds: mocks.docBatchRefreshFeeds,
}));
vi.mock("./fb-capture", () => ({ captureFbFeed: mocks.captureFbFeed }));
vi.mock("./instagram-capture", () => ({ captureIgFeed: mocks.captureIgFeed }));
vi.mock("./li-capture", () => ({ captureLiFeed: mocks.captureLiFeed }));
vi.mock("./x-capture", () => ({ captureXTimeline: mocks.captureXTimeline }));
vi.mock("./youtube-capture", () => ({ captureYouTube: mocks.captureYouTube }));
vi.mock("./provider-health", () => ({
  isProviderPaused: () => false,
  recordProviderHealthEvent: mocks.recordProviderHealthEvent,
}));
vi.mock("./runtime-health-events", () => ({
  recordRssPullAttempt: mocks.recordRssPullAttempt,
}));
vi.mock("./store", () => ({
  useAppStore: { getState: () => mocks.state },
  withProviderSyncing: mocks.withProviderSyncing,
}));

const FEED_XML = `<?xml version="1.0" encoding="UTF-8"?>
  <rss version="2.0">
    <channel>
      <title>Reset feed</title>
      <link>https://example.com</link>
      <item>
        <guid>reset-entry</guid>
        <title>Reset entry</title>
        <link>https://example.com/entry</link>
        <description>Reset boundary test</description>
      </item>
    </channel>
  </rss>`;

function socialResult(provider: ProviderStage): unknown {
  if (provider === "x") return undefined;
  if (provider === "youtube") {
    return {
      items: [],
      diag: {
        errorStage: null,
        errorMessage: null,
        videosExtracted: 1,
        itemsAdded: 1,
      },
    };
  }
  return {
    items: [],
    diag: {
      errorStage: null,
      errorMessage: null,
      postsExtracted: 1,
      itemsAdded: 1,
    },
  };
}

function captureMock(provider: ProviderStage) {
  if (provider === "x") return mocks.captureXTimeline;
  if (provider === "facebook") return mocks.captureFbFeed;
  if (provider === "instagram") return mocks.captureIgFeed;
  if (provider === "linkedin") return mocks.captureLiFeed;
  return mocks.captureYouTube;
}

describe("capture factory reset boundary", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    window.localStorage.clear();
    mocks.resetActive = false;
    mocks.state.feeds = {};
    mocks.state.items = [];
    mocks.state.xAuth = { isAuthenticated: false, cookies: null };
    mocks.state.fbAuth = { isAuthenticated: false };
    mocks.state.igAuth = { isAuthenticated: false };
    mocks.state.liAuth = { isAuthenticated: false };
    mocks.state.ytAuth = { isAuthenticated: false };
    mocks.captureXTimeline.mockResolvedValue(socialResult("x"));
    mocks.captureFbFeed.mockResolvedValue(socialResult("facebook"));
    mocks.captureIgFeed.mockResolvedValue(socialResult("instagram"));
    mocks.captureLiFeed.mockResolvedValue(socialResult("linkedin"));
    mocks.captureYouTube.mockResolvedValue(socialResult("youtube"));
  });

  it("rejects a new RSS subscription before issuing a request during reset", async () => {
    mocks.resetActive = true;

    const { addRssFeed } = await import("./capture");
    await expect(addRssFeed("https://example.com/new.xml")).rejects.toThrow(
      "Factory reset is in progress",
    );

    expect(mocks.invoke).not.toHaveBeenCalled();
    expect(mocks.state.addFeed).not.toHaveBeenCalled();
    expect(mocks.state.addItems).not.toHaveBeenCalled();
  });

  it("rejects late RSS subscription data without restoring a feed or items", async () => {
    let resolveFetch!: (xml: string) => void;
    mocks.invoke.mockImplementation(
      () => new Promise<string>((resolve) => {
        resolveFetch = resolve;
      }),
    );

    const { addRssFeed } = await import("./capture");
    const adding = addRssFeed("https://example.com/new.xml");
    await vi.waitFor(() => expect(mocks.invoke).toHaveBeenCalledOnce());

    mocks.resetActive = true;
    resolveFetch(FEED_XML);

    await expect(adding).rejects.toThrow("Factory reset is in progress");
    expect(mocks.state.addFeed).not.toHaveBeenCalled();
    expect(mocks.state.addItems).not.toHaveBeenCalled();
    expect(mocks.state.setError).toHaveBeenCalledOnce();
    expect(mocks.state.setError).toHaveBeenCalledWith(null);
    expect(mocks.state.setLoading).toHaveBeenLastCalledWith(true);
  });

  it("does not start another RSS batch after reset begins", async () => {
    mocks.state.feeds = Object.fromEntries(
      Array.from({ length: 6 }, (_, index) => {
        const number = index + 1;
        return [
          `feed-${number.toLocaleString()}`,
          {
            url: `https://example.com/feed-${number.toLocaleString()}.xml`,
            title: `Feed ${number.toLocaleString()}`,
            enabled: true,
            trackUnread: false,
          },
        ];
      }),
    );
    const pendingFetches: Array<(html: string) => void> = [];
    mocks.invoke.mockImplementation(
      () => new Promise<string>((resolve) => pendingFetches.push(resolve)),
    );

    const { refreshAllFeeds } = await import("./capture");
    const refreshing = refreshAllFeeds();
    await vi.waitFor(() => expect(mocks.invoke).toHaveBeenCalledTimes(5));

    mocks.resetActive = true;
    for (const resolve of pendingFetches) resolve(FEED_XML);
    await refreshing;

    expect(mocks.invoke).toHaveBeenCalledTimes(5);
    expect(mocks.invoke).not.toHaveBeenCalledWith("fetch_url", {
      url: "https://example.com/feed-6.xml",
    });
    expect(mocks.captureXTimeline).not.toHaveBeenCalled();
    expect(mocks.captureFbFeed).not.toHaveBeenCalled();
    expect(mocks.captureIgFeed).not.toHaveBeenCalled();
    expect(mocks.captureLiFeed).not.toHaveBeenCalled();
    expect(mocks.captureYouTube).not.toHaveBeenCalled();
  });

  it.each<ProviderStage>(["x", "facebook", "instagram", "linkedin"])(
    "does not start the provider after %s when reset begins",
    async (pausedStage) => {
      mocks.state.xAuth = { isAuthenticated: true, cookies: [{ name: "auth_token" }] };
      mocks.state.fbAuth = { isAuthenticated: true };
      mocks.state.igAuth = { isAuthenticated: true };
      mocks.state.liAuth = { isAuthenticated: true };
      mocks.state.ytAuth = { isAuthenticated: true };

      let releaseStage!: (value: unknown) => void;
      captureMock(pausedStage).mockImplementationOnce(
        () => new Promise<unknown>((resolve) => {
          releaseStage = resolve;
        }),
      );

      const { refreshAllFeeds } = await import("./capture");
      const refreshing = refreshAllFeeds();
      await vi.waitFor(() => expect(captureMock(pausedStage)).toHaveBeenCalledOnce());

      mocks.resetActive = true;
      releaseStage(socialResult(pausedStage));
      await refreshing;

      const stages: ProviderStage[] = ["x", "facebook", "instagram", "linkedin", "youtube"];
      const laterStages = stages.slice(stages.indexOf(pausedStage) + 1);
      for (const provider of laterStages) {
        expect(captureMock(provider)).not.toHaveBeenCalled();
      }
    },
  );

  it("ignores a direct social refresh after reset begins", async () => {
    mocks.state.fbAuth = { isAuthenticated: true };
    mocks.resetActive = true;

    const { refreshSocialProvider } = await import("./capture");
    const result = await refreshSocialProvider("facebook", "deferred_retry");

    expect(result).toMatchObject({
      provider: "facebook",
      status: "ignored",
      stage: "factory_reset",
    });
    expect(mocks.captureFbFeed).not.toHaveBeenCalled();
  });
});
