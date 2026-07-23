import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const state = {
    feeds: {
      example: {
        url: "https://example.com/feed.xml",
        title: "Example",
        enabled: true,
        trackUnread: false,
      },
    },
    items: [],
    xAuth: { isAuthenticated: false, cookies: null },
    fbAuth: { isAuthenticated: false },
    igAuth: { isAuthenticated: false },
    liAuth: { isAuthenticated: false },
    ytAuth: { isAuthenticated: false },
    setLoading: vi.fn(),
    setSyncing: vi.fn(),
    setError: vi.fn(),
    addFeed: vi.fn(async () => {}),
    addItems: vi.fn(async () => {}),
  };
  return {
    state,
    invoke: vi.fn(),
    recordRssPullAttempt: vi.fn(),
    recordProviderHealthEvent: vi.fn(async () => {}),
    docBatchRefreshFeeds: vi.fn(async () => {}),
  };
});

vi.mock("@tauri-apps/api/core", () => ({
  isTauri: () => true,
  invoke: mocks.invoke,
}));

vi.mock("@freed/ui/lib/debug-store", () => ({ addDebugEvent: vi.fn() }));
vi.mock("./automerge", () => ({ docBatchRefreshFeeds: mocks.docBatchRefreshFeeds }));
vi.mock("./fb-capture", () => ({ captureFbFeed: vi.fn() }));
vi.mock("./instagram-capture", () => ({ captureIgFeed: vi.fn() }));
vi.mock("./li-capture", () => ({ captureLiFeed: vi.fn() }));
vi.mock("./x-capture", () => ({ captureXTimeline: vi.fn() }));
vi.mock("./youtube-capture", () => ({ captureYouTube: vi.fn() }));
vi.mock("./provider-health", () => ({
  isProviderPaused: () => false,
  recordProviderHealthEvent: mocks.recordProviderHealthEvent,
}));
vi.mock("./runtime-health-events", () => ({
  recordRssPullAttempt: mocks.recordRssPullAttempt,
}));
vi.mock("./store", () => ({
  useAppStore: { getState: () => mocks.state },
  withProviderSyncing: async (_provider: string, run: () => Promise<unknown>) => run(),
}));

const FEED_XML = `<?xml version="1.0" encoding="UTF-8"?>
  <rss version="2.0">
    <channel>
      <title>Example Feed</title>
      <link>https://example.com</link>
      <item>
        <guid>example-entry</guid>
        <title>Example entry</title>
        <link>https://example.com/entry</link>
        <description>Example text</description>
      </item>
    </channel>
  </rss>`;

describe("RSS request surface counters", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.localStorage.clear();
    mocks.invoke.mockImplementation(async (command: string) => {
      if (command === "fetch_url") return FEED_XML;
      return null;
    });
  });

  it("counts subscription, manual, and scheduled pulls without feed identifiers", async () => {
    const { addRssFeed, refreshAllFeeds, refreshRssFeeds } = await import("./capture");

    await addRssFeed("https://new.example/feed.xml");
    await refreshRssFeeds();
    await refreshAllFeeds();

    expect(mocks.recordRssPullAttempt.mock.calls).toEqual([
      [{ trigger: "subscription" }],
      [{ trigger: "manual" }],
      [{ trigger: "scheduled" }],
    ]);
    for (const [payload] of mocks.recordRssPullAttempt.mock.calls) {
      expect(payload).not.toHaveProperty("url");
      expect(payload).not.toHaveProperty("feedId");
    }
  });
});
