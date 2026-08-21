/**
 * @vitest-environment jsdom
 */
import { act, useMemo, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import type { FeedItem } from "@freed/shared";
import {
  PlatformProvider,
  type LibraryFacetSummary,
  type LibraryFriendsGraph,
  type LibraryFriendsGraphRequest,
  type LibraryFriendsSource,
  type LibraryPersonTimelineRequest,
  type LibraryPersonTimelinePage,
  type LibrarySavedAnalytics,
  type LibrarySavedAnalyticsRequest,
  type LibrarySurface,
  type PlatformConfig,
} from "../context/PlatformContext.js";
import { useLibraryFacetSummary } from "./useLibraryFacetSummary.js";
import {
  useLibrarySavedAnalytics,
  type LibrarySavedAnalyticsState,
} from "./useLibrarySavedAnalytics.js";
import { useLibrarySurfaceItems } from "./useLibrarySurfaceItems.js";
import {
  useLibraryFriendsRows,
  type LibraryFriendsRowsState,
} from "./useLibraryFriendsRows.js";
import { createLibrarySavedAnalyticsRequest } from "../lib/saved-library-analytics.js";

function item(globalId: string): FeedItem {
  return {
    globalId,
    platform: "rss",
    contentType: "post",
    capturedAt: 1,
    publishedAt: 1,
    author: { id: "author", handle: "author", displayName: "Author" },
    content: { text: globalId, mediaUrls: [], mediaTypes: [] },
    userState: { hidden: false, saved: false, archived: false, tags: [] },
    topics: [],
  };
}

function savedItem(
  globalId: string,
  savedAt: number,
  sourceUrl: string,
  contentType: FeedItem["contentType"] = "article",
): FeedItem {
  return {
    ...item(globalId),
    platform: "saved",
    contentType,
    sourceUrl,
    userState: {
      hidden: false,
      saved: true,
      savedAt,
      archived: false,
      tags: [],
    },
  };
}

function platformConfig(
  overrides: Partial<
    Pick<
      PlatformConfig,
      | "acquireLegacyLibraryItems"
      | "readLibraryFacetSummary"
      | "readLibraryFriendsGraph"
      | "readLibraryFriendsLocationItem"
      | "readLibraryPersonTimeline"
      | "readLibrarySavedAnalytics"
      | "readLibrarySurfaceItems"
    >
  >,
): PlatformConfig {
  return {
    store: (() => undefined) as unknown as PlatformConfig["store"],
    SourceIndicator: null,
    HeaderSyncIndicator: null,
    SettingsExtraSections: null,
    LegalSettingsContent: null,
    FeedEmptyState: null,
    XSettingsContent: null,
    FacebookSettingsContent: null,
    InstagramSettingsContent: null,
    LinkedInSettingsContent: null,
    SubstackSettingsContent: null,
    MediumSettingsContent: null,
    GoogleContactsSettingsContent: null,
    ...overrides,
  };
}

function SurfaceHarness({
  onItems,
  readFallbackItems,
  surface = "map",
}: {
  onItems: (items: readonly FeedItem[]) => void;
  readFallbackItems: () => FeedItem[];
  surface?: LibrarySurface;
}) {
  onItems(useLibrarySurfaceItems(surface, readFallbackItems, 7));
  return null;
}

function FacetHarness({
  onSummaries,
}: {
  onSummaries: (summaries: readonly LibraryFacetSummary[]) => void;
}) {
  const first = useLibraryFacetSummary([], 8);
  const second = useLibraryFacetSummary([], 8);
  onSummaries([first, second]);
  return null;
}

function SavedAnalyticsHarness({
  fallbackItems,
  onState,
}: {
  fallbackItems: readonly FeedItem[];
  onState: (state: LibrarySavedAnalyticsState) => void;
}) {
  onState(useLibrarySavedAnalytics(fallbackItems, 9));
  return null;
}

const friendsGraphRequest: LibraryFriendsGraphRequest = {
  sources: [{ platform: "rss", authorId: "author" }],
  rssFeedUrls: [],
  recentWindow: { startMs: 1, endMs: 1_000 },
};

function friendsGraph(
  totalItemCount: number,
  {
    hasLocation,
    locationCandidateCount = 0,
    locationCandidates = [],
    sourceToken = "friends-source-1",
  }: {
    hasLocation?: boolean;
    locationCandidateCount?: number;
    locationCandidates?: LibraryFriendsGraph["social"][number]["locationCandidates"];
    sourceToken?: string;
  } = {},
): LibraryFriendsGraph {
  return {
    sourceToken,
    totalItemCount,
    social: [
      {
        platform: "rss",
        authorId: "author",
        itemCount: totalItemCount,
        latestActivityAt: totalItemCount,
        hasLocation: hasLocation ?? locationCandidateCount > 0,
        locationCandidateCount,
        locationCandidates,
        avatarGlobalId: null,
        avatarPublishedAt: null,
        avatarUrl: null,
        sampleItems: [],
        recentCount: 0,
        signalCounts: [],
      },
    ],
    rss: [],
  };
}

function locationItem(globalId: string, publishedAt: number): FeedItem {
  return {
    ...item(globalId),
    capturedAt: publishedAt,
    publishedAt,
    location: {
      name: "London",
      source: "geo_tag",
    },
  };
}

function coordinateLocationItem(
  globalId: string,
  publishedAt: number,
  lat: number,
  lng: number,
): FeedItem {
  return {
    ...locationItem(globalId, publishedAt),
    location: {
      name: globalId,
      coordinates: { lat, lng },
      source: "geo_tag",
    },
  };
}

function FriendsHarness({
  locationSources,
  sourceVersion,
  timelineIdentity,
  timelineSources = friendsGraphRequest.sources,
  onState,
}: {
  locationSources?: readonly LibraryFriendsSource[];
  sourceVersion: number;
  timelineIdentity?: LibraryPersonTimelineRequest | null;
  timelineSources?: readonly LibraryFriendsSource[];
  onState: (state: LibraryFriendsRowsState) => void;
}) {
  const resolvedTimelineIdentity = useMemo<LibraryPersonTimelineRequest | null>(
    () =>
      timelineIdentity === undefined
        ? timelineSources.length > 0
          ? { personId: "person-1" }
          : null
        : timelineIdentity,
    [timelineIdentity, timelineSources.length],
  );
  onState(
    useLibraryFriendsRows({
      graphRequest: friendsGraphRequest,
      locationSources: locationSources ?? timelineSources,
      timelineIdentity: resolvedTimelineIdentity,
      timelineSources,
      sourceVersion,
    }),
  );
  return null;
}

async function flush(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe("Library row query hooks", () => {
  let container: HTMLDivElement | null = null;
  let root: Root | null = null;

  beforeAll(() => {
    (
      globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
  });

  afterAll(() => {
    (
      globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = false;
  });

  afterEach(async () => {
    vi.useRealTimers();
    await act(async () => {
      root?.unmount();
    });
    container?.remove();
    root = null;
    container = null;
  });

  function renderHarness(node: ReactNode): void {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    act(() => root?.render(node));
  }

  it("preserves the legacy duplicate hour across spring-forward DST", () => {
    const previousTimeZone = process.env.TZ;
    process.env.TZ = "America/Los_Angeles";
    try {
      const request = createLibrarySavedAnalyticsRequest(
        new Date("2026-03-08T12:00:00-07:00"),
      );
      const repeatedWindow = {
        startMs: 1_772_964_000_000,
        endMs: 1_772_967_600_000,
      };

      expect(
        request.hourlyWindows.filter(
          (window) =>
            window.startMs === repeatedWindow.startMs &&
            window.endMs === repeatedWindow.endMs,
        ),
      ).toHaveLength(2);
    } finally {
      if (previousTimeZone === undefined) delete process.env.TZ;
      else process.env.TZ = previousTimeZone;
    }
  });

  it("loads bounded native rows without materializing the fallback corpus", async () => {
    const readLibrarySurfaceItems = vi.fn(async () => [item("native-map")]);
    const readFallbackItems = vi.fn(() => [item("fallback")]);
    let current: readonly FeedItem[] = [];
    renderHarness(
      <PlatformProvider value={platformConfig({ readLibrarySurfaceItems })}>
        <SurfaceHarness
          onItems={(items) => {
            current = items;
          }}
          readFallbackItems={readFallbackItems}
        />
      </PlatformProvider>,
    );

    expect(current).toEqual([]);
    await flush();
    expect(current.map((candidate) => candidate.globalId)).toEqual([
      "native-map",
    ]);
    expect(readFallbackItems).not.toHaveBeenCalled();
    expect(readLibrarySurfaceItems).toHaveBeenCalledOnce();
    expect(readLibrarySurfaceItems).toHaveBeenCalledWith("map");
  });

  it("leases the compatibility corpus only when a native surface reader is unavailable", async () => {
    const release = vi.fn();
    const acquireLegacyLibraryItems = vi.fn(async () => release);
    const readFallbackItems = vi.fn(() => [item("fallback")]);
    let current: readonly FeedItem[] = [];
    renderHarness(
      <PlatformProvider value={platformConfig({ acquireLegacyLibraryItems })}>
        <SurfaceHarness
          onItems={(items) => {
            current = items;
          }}
          readFallbackItems={readFallbackItems}
          surface="story_wall"
        />
      </PlatformProvider>,
    );

    expect(current.map((candidate) => candidate.globalId)).toEqual([
      "fallback",
    ]);
    await flush();
    expect(acquireLegacyLibraryItems).toHaveBeenCalledOnce();
    expect(readFallbackItems).toHaveBeenCalledOnce();

    await act(async () => {
      root?.unmount();
    });
    root = null;
    expect(release).toHaveBeenCalledOnce();
  });

  it("shares one exact facet query across multiple consumers", async () => {
    const summary: LibraryFacetSummary = {
      archivedCount: 2,
      sampleItemCount: 5,
      savedArchivedCount: 1,
      savedCount: 3,
      savedPlatformCount: 4,
      tags: ["alpha", "beta"],
      totalCount: 10,
    };
    const readLibraryFacetSummary = vi.fn(async () => summary);
    let current: readonly LibraryFacetSummary[] = [];
    renderHarness(
      <PlatformProvider value={platformConfig({ readLibraryFacetSummary })}>
        <FacetHarness
          onSummaries={(summaries) => {
            current = summaries;
          }}
        />
      </PlatformProvider>,
    );

    await flush();
    expect(readLibraryFacetSummary).toHaveBeenCalledOnce();
    expect(current).toEqual([summary, summary]);
  });

  it("loads Saved analytics natively without leasing the compatibility corpus", async () => {
    const analytics: LibrarySavedAnalytics = {
      totalCount: 9,
      latestSavedAt: 900,
      dailyCounts: [0, 0, 0, 0, 1, 2, 3],
      hourlyCounts: Array.from({ length: 24 }, (_, index) => index),
      sourceCounts: [
        { label: "zeta.example", count: 2 },
        { label: "beta.example", count: 4 },
        { label: "alpha.example", count: 4 },
        { label: "gamma.example", count: 3 },
        { label: "epsilon.example", count: 2 },
        { label: "delta.example", count: 2 },
      ],
      contentMix: [
        { label: "video", count: 2 },
        { label: "article", count: 5 },
      ],
    };
    const readLibrarySavedAnalytics = vi.fn(
      async (_request: LibrarySavedAnalyticsRequest) => analytics,
    );
    const acquireLegacyLibraryItems = vi.fn(async () => vi.fn());
    let current: LibrarySavedAnalyticsState | null = null;
    renderHarness(
      <PlatformProvider
        value={platformConfig({
          acquireLegacyLibraryItems,
          readLibrarySavedAnalytics,
        })}
      >
        <SavedAnalyticsHarness
          fallbackItems={[
            savedItem("fallback", Date.now(), "https://fallback.example/a"),
          ]}
          onState={(state) => {
            current = state;
          }}
        />
      </PlatformProvider>,
    );

    expect((current as LibrarySavedAnalyticsState | null)?.loading).toBe(true);
    expect(
      (current as LibrarySavedAnalyticsState | null)?.analytics,
    ).toBeNull();
    await flush();

    expect(readLibrarySavedAnalytics).toHaveBeenCalledOnce();
    const request = readLibrarySavedAnalytics.mock.calls[0][0];
    expect(request.dailyWindows).toHaveLength(7);
    expect(request.hourlyWindows).toHaveLength(24);
    expect(acquireLegacyLibraryItems).not.toHaveBeenCalled();
    expect(
      (current as LibrarySavedAnalyticsState | null)?.analytics?.sourceCounts,
    ).toEqual([
      { label: "alpha.example", count: 4 },
      { label: "beta.example", count: 4 },
      { label: "gamma.example", count: 3 },
      { label: "delta.example", count: 2 },
      { label: "epsilon.example", count: 2 },
    ]);
    expect(
      (current as LibrarySavedAnalyticsState | null)?.analytics?.contentMix,
    ).toEqual([
      { label: "article", count: 5 },
      { label: "video", count: 2 },
    ]);
  });

  it("refreshes native Saved analytics after an item patch without a search version change", async () => {
    const first: LibrarySavedAnalytics = {
      totalCount: 1,
      latestSavedAt: 100,
      dailyCounts: [0, 0, 0, 0, 0, 0, 1],
      hourlyCounts: [...Array<number>(23).fill(0), 1],
      sourceCounts: [{ label: "one.example", count: 1 }],
      contentMix: [{ label: "article", count: 1 }],
    };
    const second: LibrarySavedAnalytics = {
      ...first,
      totalCount: 2,
      latestSavedAt: 200,
      dailyCounts: [0, 0, 0, 0, 0, 0, 2],
      hourlyCounts: [...Array<number>(23).fill(0), 2],
      sourceCounts: [{ label: "one.example", count: 2 }],
      contentMix: [{ label: "article", count: 2 }],
    };
    const readLibrarySavedAnalytics = vi
      .fn<
        (
          request: LibrarySavedAnalyticsRequest,
        ) => Promise<LibrarySavedAnalytics>
      >()
      .mockResolvedValueOnce(first)
      .mockResolvedValueOnce(second);
    const config = platformConfig({ readLibrarySavedAnalytics });
    let current: LibrarySavedAnalyticsState | null = null;
    const renderSaved = (fallbackItems: readonly FeedItem[]) => (
      <PlatformProvider value={config}>
        <SavedAnalyticsHarness
          fallbackItems={fallbackItems}
          onState={(state) => {
            current = state;
          }}
        />
      </PlatformProvider>
    );

    renderHarness(renderSaved([]));
    await flush();
    expect(
      (current as LibrarySavedAnalyticsState | null)?.analytics?.totalCount,
    ).toBe(1);

    act(() => root?.render(renderSaved([])));
    await flush();

    expect(readLibrarySavedAnalytics).toHaveBeenCalledTimes(2);
    expect(
      (current as LibrarySavedAnalyticsState | null)?.analytics?.totalCount,
    ).toBe(2);
  });

  it("leases and exactly reduces the compatibility corpus without a native Saved reader", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-02-14T12:30:00-08:00"));
    const release = vi.fn();
    const acquireLegacyLibraryItems = vi.fn(async () => release);
    const savedAt = Date.now();
    let current: LibrarySavedAnalyticsState | null = null;
    renderHarness(
      <PlatformProvider value={platformConfig({ acquireLegacyLibraryItems })}>
        <SavedAnalyticsHarness
          fallbackItems={[
            savedItem("one", savedAt - 1, "https://www.example.com/one"),
            savedItem("two", savedAt, "https://example.com/two", "video"),
            item("not-saved-platform"),
          ]}
          onState={(state) => {
            current = state;
          }}
        />
      </PlatformProvider>,
    );

    expect((current as LibrarySavedAnalyticsState | null)?.loading).toBe(true);
    expect(
      (current as LibrarySavedAnalyticsState | null)?.analytics,
    ).toBeNull();
    await flush();
    expect((current as LibrarySavedAnalyticsState | null)?.loading).toBe(false);
    expect(
      (current as LibrarySavedAnalyticsState | null)?.analytics?.totalCount,
    ).toBe(2);
    expect(
      (current as LibrarySavedAnalyticsState | null)?.analytics?.latestSavedAt,
    ).toBe(savedAt);
    expect(
      (current as LibrarySavedAnalyticsState | null)?.analytics?.dailyCounts.at(
        -1,
      ),
    ).toBe(2);
    expect(
      (
        current as LibrarySavedAnalyticsState | null
      )?.analytics?.hourlyCounts.at(-1),
    ).toBe(2);
    expect(
      (current as LibrarySavedAnalyticsState | null)?.analytics?.sourceCounts,
    ).toEqual([{ label: "example.com", count: 2 }]);
    expect(
      (current as LibrarySavedAnalyticsState | null)?.analytics?.contentMix,
    ).toEqual([
      { label: "article", count: 1 },
      { label: "video", count: 1 },
    ]);
    expect(acquireLegacyLibraryItems).toHaveBeenCalledOnce();

    await act(async () => {
      root?.unmount();
    });
    root = null;
    expect(release).toHaveBeenCalledOnce();
  });

  it("waits for compatibility hydration before reducing after a native Saved read rejects", async () => {
    const release = vi.fn();
    let resolveAcquisition: ((release: () => void) => void) | null = null;
    const acquireLegacyLibraryItems = vi.fn(
      () =>
        new Promise<() => void>((resolve) => {
          resolveAcquisition = resolve;
        }),
    );
    const readLibrarySavedAnalytics = vi.fn(
      async (_request: LibrarySavedAnalyticsRequest) => {
        throw new Error("stale source");
      },
    );
    let current: LibrarySavedAnalyticsState | null = null;
    const renderSaved = (fallbackItems: readonly FeedItem[]) => (
      <PlatformProvider
        value={platformConfig({
          acquireLegacyLibraryItems,
          readLibrarySavedAnalytics,
        })}
      >
        <SavedAnalyticsHarness
          fallbackItems={fallbackItems}
          onState={(state) => {
            current = state;
          }}
        />
      </PlatformProvider>
    );
    renderHarness(renderSaved([]));

    expect((current as LibrarySavedAnalyticsState | null)?.loading).toBe(true);
    await flush();
    expect((current as LibrarySavedAnalyticsState | null)?.loading).toBe(true);
    expect(
      (current as LibrarySavedAnalyticsState | null)?.analytics,
    ).toBeNull();
    expect(acquireLegacyLibraryItems).toHaveBeenCalledOnce();

    act(() => {
      root?.render(
        renderSaved([
          savedItem("fallback", Date.now(), "https://fallback.example/item"),
        ]),
      );
    });
    expect((current as LibrarySavedAnalyticsState | null)?.loading).toBe(true);
    expect(
      (current as LibrarySavedAnalyticsState | null)?.analytics,
    ).toBeNull();

    await act(async () => {
      resolveAcquisition?.(release);
      await Promise.resolve();
    });
    expect((current as LibrarySavedAnalyticsState | null)?.loading).toBe(false);
    expect(
      (current as LibrarySavedAnalyticsState | null)?.analytics?.totalCount,
    ).toBe(1);
  });

  it("walks a native Friends timeline past the third page, replaces each row window, and returns to newest", async () => {
    const graph = friendsGraph(130);
    const firstPage = Array.from({ length: 50 }, (_, index) =>
      item(`native-${index.toLocaleString()}`),
    );
    const secondPage = Array.from({ length: 50 }, (_, index) =>
      item(`native-${(index + 50).toLocaleString()}`),
    );
    const thirdPage = Array.from({ length: 30 }, (_, index) =>
      item(`native-${(index + 100).toLocaleString()}`),
    );
    const readLibraryFriendsGraph = vi.fn(async () => graph);
    const readLibraryPersonTimeline = vi
      .fn()
      .mockResolvedValueOnce({
        items: firstPage,
        totalCount: 130,
        nextCursor: "page-2",
      })
      .mockResolvedValueOnce({
        items: secondPage,
        totalCount: 130,
        nextCursor: "page-3",
      })
      .mockResolvedValueOnce({
        items: thirdPage,
        totalCount: 130,
        nextCursor: null,
      })
      .mockResolvedValueOnce({
        items: firstPage,
        totalCount: 130,
        nextCursor: "page-2",
      })
      .mockResolvedValueOnce({
        items: firstPage,
        totalCount: 130,
        nextCursor: "page-2",
      });
    const acquireLegacyLibraryItems = vi.fn(async () => vi.fn());
    let current: LibraryFriendsRowsState | null = null;
    const config = platformConfig({
      acquireLegacyLibraryItems,
      readLibraryFriendsGraph,
      readLibraryPersonTimeline,
    });
    const renderFriends = (
      fallbackItems: readonly FeedItem[],
      timelineIdentity?: LibraryPersonTimelineRequest,
    ) => (
      <PlatformProvider value={config}>
        <FriendsHarness
          sourceVersion={1}
          timelineIdentity={timelineIdentity}
          onState={(state) => {
            current = state;
          }}
        />
      </PlatformProvider>
    );
    renderHarness(renderFriends([]));

    await flush();
    expect(
      (current as LibraryFriendsRowsState | null)?.timelineItems,
    ).toHaveLength(50);
    expect(
      (current as LibraryFriendsRowsState | null)?.timelineAwayFromNewest,
    ).toBe(false);
    expect(readLibraryPersonTimeline).toHaveBeenNthCalledWith(1, {
      personId: "person-1",
      limit: 50,
      cursor: null,
    });

    act(() => root?.render(renderFriends([item("unrelated-fallback")])));
    await flush();
    expect(readLibraryPersonTimeline).toHaveBeenCalledTimes(1);

    act(() => {
      current?.loadMoreTimeline();
      current?.loadMoreTimeline();
    });
    await flush();

    expect((current as LibraryFriendsRowsState | null)?.timelineItems).toEqual(
      secondPage,
    );
    expect((current as LibraryFriendsRowsState | null)?.timelineHasMore).toBe(
      true,
    );
    expect(
      (current as LibraryFriendsRowsState | null)?.timelineAwayFromNewest,
    ).toBe(true);
    expect(readLibraryPersonTimeline).toHaveBeenNthCalledWith(2, {
      personId: "person-1",
      limit: 50,
      cursor: "page-2",
    });
    expect(readLibraryPersonTimeline).toHaveBeenCalledTimes(2);

    act(() => {
      current?.loadMoreTimeline();
      current?.loadMoreTimeline();
    });
    await flush();

    expect((current as LibraryFriendsRowsState | null)?.timelineItems).toEqual(
      thirdPage,
    );
    expect((current as LibraryFriendsRowsState | null)?.timelineHasMore).toBe(
      false,
    );
    expect(
      (current as LibraryFriendsRowsState | null)?.timelineAwayFromNewest,
    ).toBe(true);
    expect(readLibraryPersonTimeline).toHaveBeenNthCalledWith(3, {
      personId: "person-1",
      limit: 50,
      cursor: "page-3",
    });

    act(() => {
      current?.showNewestTimeline();
      current?.showNewestTimeline();
    });
    await flush();

    expect((current as LibraryFriendsRowsState | null)?.timelineItems).toEqual(
      firstPage,
    );
    expect((current as LibraryFriendsRowsState | null)?.timelineHasMore).toBe(
      true,
    );
    expect(
      (current as LibraryFriendsRowsState | null)?.timelineAwayFromNewest,
    ).toBe(false);
    expect(readLibraryPersonTimeline).toHaveBeenNthCalledWith(4, {
      personId: "person-1",
      limit: 50,
      cursor: null,
    });
    expect(readLibraryPersonTimeline).toHaveBeenCalledTimes(4);
    expect(acquireLegacyLibraryItems).not.toHaveBeenCalled();

    act(() =>
      root?.render(renderFriends([], { accountId: "account-unlinked" })),
    );
    await flush();
    expect(readLibraryPersonTimeline).toHaveBeenNthCalledWith(5, {
      accountId: "account-unlinked",
      limit: 50,
      cursor: null,
    });
  });

  it("keeps an exact location older than the current 50-row timeline window", async () => {
    const olderLocation = locationItem("rss:older-location", 10);
    const firstPage = Array.from({ length: 50 }, (_, index) => ({
      ...item(`rss:newer-${index.toLocaleString()}`),
      publishedAt: 100 - index,
    }));
    const graph = friendsGraph(51, {
      locationCandidateCount: 1,
      locationCandidates: [
        {
          globalId: olderLocation.globalId,
          publishedAt: olderLocation.publishedAt,
          effectiveAt: olderLocation.publishedAt,
        },
      ],
    });
    const readLibraryFriendsLocationItem = vi.fn(async () => olderLocation);
    const acquireLegacyLibraryItems = vi.fn(async () => vi.fn());
    let current: LibraryFriendsRowsState | null = null;
    renderHarness(
      <PlatformProvider
        value={platformConfig({
          acquireLegacyLibraryItems,
          readLibraryFriendsGraph: vi.fn(async () => graph),
          readLibraryFriendsLocationItem,
          readLibraryPersonTimeline: vi.fn(async () => ({
            items: firstPage,
            totalCount: 51,
            nextCursor: "older-page",
          })),
        })}
      >
        <FriendsHarness
          sourceVersion={1}
          onState={(state) => {
            current = state;
          }}
        />
      </PlatformProvider>,
    );

    await flush();
    await flush();

    expect(
      (current as LibraryFriendsRowsState | null)?.timelineItems,
    ).not.toContainEqual(olderLocation);
    expect((current as LibraryFriendsRowsState | null)?.locationItems).toEqual([
      olderLocation,
    ]);
    expect(readLibraryFriendsLocationItem).toHaveBeenCalledOnce();
    expect(readLibraryFriendsLocationItem).toHaveBeenCalledWith({
      globalId: olderLocation.globalId,
      publishedAt: olderLocation.publishedAt,
      effectiveAt: olderLocation.publishedAt,
      owner: { kind: "social", platform: "rss", authorId: "author" },
      referenceTimeMs: friendsGraphRequest.recentWindow.endMs,
      sourceToken: graph.sourceToken,
    });
    expect(acquireLegacyLibraryItems).not.toHaveBeenCalled();
  });

  it("ignores a stale location batch after the graph source changes", async () => {
    const firstLocation = locationItem("rss:location-a", 10);
    const secondLocation = locationItem("rss:location-b", 20);
    const firstGraph = friendsGraph(1, {
      sourceToken: "friends-source-a",
      locationCandidateCount: 1,
      locationCandidates: [
        {
          globalId: firstLocation.globalId,
          publishedAt: firstLocation.publishedAt,
          effectiveAt: firstLocation.publishedAt,
        },
      ],
    });
    const secondGraph = friendsGraph(1, {
      sourceToken: "friends-source-b",
      locationCandidateCount: 1,
      locationCandidates: [
        {
          globalId: secondLocation.globalId,
          publishedAt: secondLocation.publishedAt,
          effectiveAt: secondLocation.publishedAt,
        },
      ],
    });
    let resolveFirst: ((value: FeedItem | null) => void) | null = null;
    let resolveSecond: ((value: FeedItem | null) => void) | null = null;
    const readLibraryFriendsLocationItem = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise<FeedItem | null>((resolve) => {
            resolveFirst = resolve;
          }),
      )
      .mockImplementationOnce(
        () =>
          new Promise<FeedItem | null>((resolve) => {
            resolveSecond = resolve;
          }),
      );
    const readLibraryFriendsGraph = vi
      .fn()
      .mockResolvedValueOnce(firstGraph)
      .mockResolvedValueOnce(secondGraph);
    const config = platformConfig({
      readLibraryFriendsGraph,
      readLibraryFriendsLocationItem,
      readLibraryPersonTimeline: vi.fn(async () => ({
        items: [],
        totalCount: 0,
        nextCursor: null,
      })),
    });
    let current: LibraryFriendsRowsState | null = null;
    const renderFriends = (sourceVersion: number) => (
      <PlatformProvider value={config}>
        <FriendsHarness
          sourceVersion={sourceVersion}
          onState={(state) => {
            current = state;
          }}
        />
      </PlatformProvider>
    );
    renderHarness(renderFriends(1));
    await flush();
    expect(readLibraryFriendsLocationItem).toHaveBeenCalledTimes(1);

    act(() => root?.render(renderFriends(2)));
    await flush();
    expect(readLibraryFriendsLocationItem).toHaveBeenCalledTimes(2);

    await act(async () => {
      resolveFirst?.(firstLocation);
      await Promise.resolve();
    });
    expect((current as LibraryFriendsRowsState | null)?.locationItems).toEqual(
      [],
    );

    await act(async () => {
      resolveSecond?.(secondLocation);
      await Promise.resolve();
      await Promise.resolve();
    });
    expect((current as LibraryFriendsRowsState | null)?.locationItems).toEqual([
      secondLocation,
    ]);
  });

  it("fails closed when selected sources exceed the bounded location candidates", async () => {
    const candidates = Array.from({ length: 8 }, (_, index) => ({
      globalId: `rss:location-${index.toLocaleString()}`,
      publishedAt: 100 - index,
      effectiveAt: 100 - index,
    }));
    const graph = friendsGraph(9, {
      locationCandidateCount: 9,
      locationCandidates: candidates,
    });
    const acquireLegacyLibraryItems = vi.fn(async () => vi.fn());
    const readLibraryFriendsLocationItem = vi.fn();
    let current: LibraryFriendsRowsState | null = null;
    renderHarness(
      <PlatformProvider
        value={platformConfig({
          acquireLegacyLibraryItems,
          readLibraryFriendsGraph: vi.fn(async () => graph),
          readLibraryFriendsLocationItem,
          readLibraryPersonTimeline: vi.fn(async () => ({
            items: [],
            totalCount: 0,
            nextCursor: null,
          })),
        })}
      >
        <FriendsHarness
          sourceVersion={1}
          onState={(state) => {
            current = state;
          }}
        />
      </PlatformProvider>,
    );

    await flush();
    await flush();

    expect((current as LibraryFriendsRowsState | null)?.locationItems).toEqual(
      [],
    );
    expect(acquireLegacyLibraryItems).not.toHaveBeenCalled();
    expect(readLibraryFriendsLocationItem).not.toHaveBeenCalled();
  });

  it("fails closed when equal-time location candidates are ambiguous", async () => {
    const firstLocation = coordinateLocationItem("rss:z-location", 50, 1, 2);
    const secondLocation = coordinateLocationItem("rss:a-location", 50, 3, 4);
    const graph = friendsGraph(2, {
      locationCandidateCount: 2,
      locationCandidates: [firstLocation, secondLocation].map((entry) => ({
        globalId: entry.globalId,
        publishedAt: entry.publishedAt,
        effectiveAt: entry.publishedAt,
      })),
    });
    const acquireLegacyLibraryItems = vi.fn(async () => vi.fn());
    const readLibraryFriendsLocationItem = vi.fn();
    let current: LibraryFriendsRowsState | null = null;
    renderHarness(
      <PlatformProvider
        value={platformConfig({
          acquireLegacyLibraryItems,
          readLibraryFriendsGraph: vi.fn(async () => graph),
          readLibraryFriendsLocationItem,
          readLibraryPersonTimeline: vi.fn(async () => ({
            items: [],
            totalCount: 2,
            nextCursor: null,
          })),
        })}
      >
        <FriendsHarness
          sourceVersion={1}
          onState={(state) => {
            current = state;
          }}
        />
      </PlatformProvider>,
    );

    await flush();
    await flush();

    expect((current as LibraryFriendsRowsState | null)?.locationItems).toEqual(
      [],
    );
    expect(acquireLegacyLibraryItems).not.toHaveBeenCalled();
    expect(readLibraryFriendsLocationItem).not.toHaveBeenCalled();
  });

  it("rejects an exact location whose effective timestamp differs from the graph", async () => {
    const fallbackLocation = coordinateLocationItem(
      "rss:effective-fallback",
      50,
      1,
      2,
    );
    const mismatchedLocation: FeedItem = {
      ...fallbackLocation,
      timeRange: {
        startsAt: 75,
        kind: "event",
      },
    };
    const graph = friendsGraph(1, {
      locationCandidateCount: 1,
      locationCandidates: [
        {
          globalId: mismatchedLocation.globalId,
          publishedAt: mismatchedLocation.publishedAt,
          effectiveAt: 50,
        },
      ],
    });
    const acquireLegacyLibraryItems = vi.fn(async () => vi.fn());
    const readLibraryFriendsLocationItem = vi.fn(
      async () => mismatchedLocation,
    );
    let current: LibraryFriendsRowsState | null = null;
    renderHarness(
      <PlatformProvider
        value={platformConfig({
          acquireLegacyLibraryItems,
          readLibraryFriendsGraph: vi.fn(async () => graph),
          readLibraryFriendsLocationItem,
          readLibraryPersonTimeline: vi.fn(async () => ({
            items: [],
            totalCount: 1,
            nextCursor: null,
          })),
        })}
      >
        <FriendsHarness
          sourceVersion={1}
          onState={(state) => {
            current = state;
          }}
        />
      </PlatformProvider>,
    );

    await flush();
    await flush();

    expect((current as LibraryFriendsRowsState | null)?.locationItems).toEqual(
      [],
    );
    expect(acquireLegacyLibraryItems).not.toHaveBeenCalled();
  });

  it("accepts all-time location history with no current-visible candidates", async () => {
    const graph = friendsGraph(1, {
      hasLocation: true,
      locationCandidateCount: 0,
      locationCandidates: [],
    });
    const acquireLegacyLibraryItems = vi.fn(async () => vi.fn());
    const readLibraryFriendsLocationItem = vi.fn();
    let current: LibraryFriendsRowsState | null = null;
    renderHarness(
      <PlatformProvider
        value={platformConfig({
          acquireLegacyLibraryItems,
          readLibraryFriendsGraph: vi.fn(async () => graph),
          readLibraryFriendsLocationItem,
          readLibraryPersonTimeline: vi.fn(async () => ({
            items: [],
            totalCount: 0,
            nextCursor: null,
          })),
        })}
      >
        <FriendsHarness
          sourceVersion={1}
          onState={(state) => {
            current = state;
          }}
        />
      </PlatformProvider>,
    );

    await flush();
    await flush();

    expect((current as LibraryFriendsRowsState | null)?.locationItems).toEqual(
      [],
    );
    expect(acquireLegacyLibraryItems).not.toHaveBeenCalled();
    expect(readLibraryFriendsLocationItem).not.toHaveBeenCalled();
  });

  it("does not read location candidates for standalone account detail", async () => {
    const candidates = Array.from({ length: 8 }, (_, index) => ({
      globalId: `rss:account-location-${index.toLocaleString()}`,
      publishedAt: 100 - index,
      effectiveAt: 100 - index,
    }));
    const graph = friendsGraph(9, {
      locationCandidateCount: 9,
      locationCandidates: candidates,
    });
    const acquireLegacyLibraryItems = vi.fn(async () => vi.fn());
    const readLibraryFriendsLocationItem = vi.fn();
    let current: LibraryFriendsRowsState | null = null;
    renderHarness(
      <PlatformProvider
        value={platformConfig({
          acquireLegacyLibraryItems,
          readLibraryFriendsGraph: vi.fn(async () => graph),
          readLibraryFriendsLocationItem,
          readLibraryPersonTimeline: vi.fn(async () => ({
            items: [],
            totalCount: 9,
            nextCursor: null,
          })),
        })}
      >
        <FriendsHarness
          locationSources={[]}
          sourceVersion={1}
          onState={(state) => {
            current = state;
          }}
        />
      </PlatformProvider>,
    );

    await flush();
    await flush();

    expect((current as LibraryFriendsRowsState | null)?.locationItems).toEqual(
      [],
    );
    expect(readLibraryFriendsLocationItem).not.toHaveBeenCalled();
    expect(acquireLegacyLibraryItems).not.toHaveBeenCalled();
  });

  it("does not read a timeline or lease the corpus on the overview", async () => {
    const graph = friendsGraph(0);
    const readLibraryFriendsGraph = vi.fn(async () => graph);
    const readLibraryPersonTimeline = vi.fn(async () => ({
      items: [],
      totalCount: 0,
      nextCursor: null,
    }));
    const acquireLegacyLibraryItems = vi.fn(async () => vi.fn());
    let current: LibraryFriendsRowsState | null = null;
    renderHarness(
      <PlatformProvider
        value={platformConfig({
          acquireLegacyLibraryItems,
          readLibraryFriendsGraph,
          readLibraryPersonTimeline,
        })}
      >
        <FriendsHarness
          sourceVersion={1}
          timelineSources={[]}
          onState={(state) => {
            current = state;
          }}
        />
      </PlatformProvider>,
    );

    await flush();
    expect((current as LibraryFriendsRowsState | null)?.graph).toEqual(graph);
    expect((current as LibraryFriendsRowsState | null)?.timelineLoading).toBe(
      false,
    );
    expect(readLibraryPersonTimeline).not.toHaveBeenCalled();
    expect(acquireLegacyLibraryItems).not.toHaveBeenCalled();
  });

  it("fails closed when Friends SQLite reads reject", async () => {
    const acquireLegacyLibraryItems = vi.fn(async () => vi.fn());
    const readLibraryFriendsGraph = vi.fn(async () => {
      throw new Error("graph read failed");
    });
    const readLibraryPersonTimeline = vi.fn(async () => {
      throw new Error("timeline read failed");
    });
    const config = platformConfig({
      acquireLegacyLibraryItems,
      readLibraryFriendsGraph,
      readLibraryPersonTimeline,
    });
    let current: LibraryFriendsRowsState | null = null;
    const renderFriends = () => (
      <PlatformProvider value={config}>
        <FriendsHarness
          sourceVersion={1}
          onState={(state) => {
            current = state;
          }}
        />
      </PlatformProvider>
    );
    renderHarness(renderFriends());
    await flush();
    await flush();

    expect((current as LibraryFriendsRowsState | null)?.graph).toBeNull();
    expect((current as LibraryFriendsRowsState | null)?.graphLoading).toBe(false);
    expect((current as LibraryFriendsRowsState | null)?.timelineItems).toEqual([]);
    expect((current as LibraryFriendsRowsState | null)?.timelineLoading).toBe(false);
    expect(readLibraryFriendsGraph).toHaveBeenCalledOnce();
    expect(readLibraryPersonTimeline).toHaveBeenCalledOnce();
    expect(acquireLegacyLibraryItems).not.toHaveBeenCalled();
  });

  it("retries failed Friends reads when the native reader changes", async () => {
    const acquireLegacyLibraryItems = vi.fn(async () => vi.fn());
    const firstGraphReader = vi.fn(async () => {
      throw new Error("first graph failure");
    });
    const firstTimelineReader = vi.fn(async () => {
      throw new Error("first timeline failure");
    });
    const secondGraphReader = vi.fn(async () => {
      throw new Error("second graph failure");
    });
    const secondTimelineReader = vi.fn(async () => {
      throw new Error("second timeline failure");
    });
    let current: LibraryFriendsRowsState | null = null;
    const renderFriends = (
      readLibraryFriendsGraph: typeof firstGraphReader,
      readLibraryPersonTimeline: typeof firstTimelineReader,
    ) => (
      <PlatformProvider
        value={platformConfig({
          acquireLegacyLibraryItems,
          readLibraryFriendsGraph,
          readLibraryPersonTimeline,
        })}
      >
        <FriendsHarness
          sourceVersion={1}
          onState={(state) => {
            current = state;
          }}
        />
      </PlatformProvider>
    );

    renderHarness(renderFriends(firstGraphReader, firstTimelineReader));
    await flush();
    await flush();
    await flush();

    expect(firstGraphReader).toHaveBeenCalledOnce();
    expect(firstTimelineReader).toHaveBeenCalledOnce();

    act(() => {
      root?.render(renderFriends(secondGraphReader, secondTimelineReader));
    });
    await flush();
    await flush();
    await flush();

    expect(secondGraphReader).toHaveBeenCalledOnce();
    expect(secondTimelineReader).toHaveBeenCalledOnce();
    expect((current as LibraryFriendsRowsState | null)?.graph).toBeNull();
    expect((current as LibraryFriendsRowsState | null)?.timelineItems).toEqual([]);
    expect(acquireLegacyLibraryItems).not.toHaveBeenCalled();
  });
});
