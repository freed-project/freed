/**
 * @vitest-environment jsdom
 */
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { FeedItem } from "@freed/shared";
import {
  PlatformProvider,
  type LibraryFacetSummary,
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
  overrides: Partial<Pick<
    PlatformConfig,
    | "acquireLegacyLibraryItems"
    | "readLibraryFacetSummary"
    | "readLibrarySavedAnalytics"
    | "readLibrarySurfaceItems"
  >>,
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
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
      .IS_REACT_ACT_ENVIRONMENT = true;
  });

  afterAll(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
      .IS_REACT_ACT_ENVIRONMENT = false;
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
          onItems={(items) => { current = items; }}
          readFallbackItems={readFallbackItems}
        />
      </PlatformProvider>,
    );

    expect(current).toEqual([]);
    await flush();
    expect(current.map((candidate) => candidate.globalId)).toEqual(["native-map"]);
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
          onItems={(items) => { current = items; }}
          readFallbackItems={readFallbackItems}
          surface="story_wall"
        />
      </PlatformProvider>,
    );

    expect(current.map((candidate) => candidate.globalId)).toEqual(["fallback"]);
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
        <FacetHarness onSummaries={(summaries) => { current = summaries; }} />
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
          fallbackItems={[savedItem("fallback", Date.now(), "https://fallback.example/a")]}
          onState={(state) => { current = state; }}
        />
      </PlatformProvider>,
    );

    expect((current as LibrarySavedAnalyticsState | null)?.loading).toBe(true);
    expect((current as LibrarySavedAnalyticsState | null)?.analytics).toBeNull();
    await flush();

    expect(readLibrarySavedAnalytics).toHaveBeenCalledOnce();
    const request = readLibrarySavedAnalytics.mock.calls[0][0];
    expect(request.dailyWindows).toHaveLength(7);
    expect(request.hourlyWindows).toHaveLength(24);
    expect(acquireLegacyLibraryItems).not.toHaveBeenCalled();
    expect((current as LibrarySavedAnalyticsState | null)?.analytics?.sourceCounts).toEqual([
      { label: "alpha.example", count: 4 },
      { label: "beta.example", count: 4 },
      { label: "gamma.example", count: 3 },
      { label: "delta.example", count: 2 },
      { label: "epsilon.example", count: 2 },
    ]);
    expect((current as LibrarySavedAnalyticsState | null)?.analytics?.contentMix).toEqual([
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
      .fn<(request: LibrarySavedAnalyticsRequest) => Promise<LibrarySavedAnalytics>>()
      .mockResolvedValueOnce(first)
      .mockResolvedValueOnce(second);
    const config = platformConfig({ readLibrarySavedAnalytics });
    let current: LibrarySavedAnalyticsState | null = null;
    const renderSaved = (fallbackItems: readonly FeedItem[]) => (
      <PlatformProvider value={config}>
        <SavedAnalyticsHarness
          fallbackItems={fallbackItems}
          onState={(state) => { current = state; }}
        />
      </PlatformProvider>
    );

    renderHarness(renderSaved([]));
    await flush();
    expect((current as LibrarySavedAnalyticsState | null)?.analytics?.totalCount).toBe(1);

    act(() => root?.render(renderSaved([])));
    await flush();

    expect(readLibrarySavedAnalytics).toHaveBeenCalledTimes(2);
    expect((current as LibrarySavedAnalyticsState | null)?.analytics?.totalCount).toBe(2);
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
          onState={(state) => { current = state; }}
        />
      </PlatformProvider>,
    );

    expect((current as LibrarySavedAnalyticsState | null)?.loading).toBe(true);
    expect((current as LibrarySavedAnalyticsState | null)?.analytics).toBeNull();
    await flush();
    expect((current as LibrarySavedAnalyticsState | null)?.loading).toBe(false);
    expect((current as LibrarySavedAnalyticsState | null)?.analytics?.totalCount).toBe(2);
    expect((current as LibrarySavedAnalyticsState | null)?.analytics?.latestSavedAt).toBe(savedAt);
    expect((current as LibrarySavedAnalyticsState | null)?.analytics?.dailyCounts.at(-1)).toBe(2);
    expect((current as LibrarySavedAnalyticsState | null)?.analytics?.hourlyCounts.at(-1)).toBe(2);
    expect((current as LibrarySavedAnalyticsState | null)?.analytics?.sourceCounts).toEqual([
      { label: "example.com", count: 2 },
    ]);
    expect((current as LibrarySavedAnalyticsState | null)?.analytics?.contentMix).toEqual([
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
          onState={(state) => { current = state; }}
        />
      </PlatformProvider>,
    );
    renderHarness(renderSaved([]));

    expect((current as LibrarySavedAnalyticsState | null)?.loading).toBe(true);
    await flush();
    expect((current as LibrarySavedAnalyticsState | null)?.loading).toBe(true);
    expect((current as LibrarySavedAnalyticsState | null)?.analytics).toBeNull();
    expect(acquireLegacyLibraryItems).toHaveBeenCalledOnce();

    act(() => {
      root?.render(
        renderSaved([
          savedItem("fallback", Date.now(), "https://fallback.example/item"),
        ]),
      );
    });
    expect((current as LibrarySavedAnalyticsState | null)?.loading).toBe(true);
    expect((current as LibrarySavedAnalyticsState | null)?.analytics).toBeNull();

    await act(async () => {
      resolveAcquisition?.(release);
      await Promise.resolve();
    });
    expect((current as LibrarySavedAnalyticsState | null)?.loading).toBe(false);
    expect((current as LibrarySavedAnalyticsState | null)?.analytics?.totalCount).toBe(1);
  });
});
