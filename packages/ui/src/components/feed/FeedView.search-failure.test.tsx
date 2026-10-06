/** @vitest-environment jsdom */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PlatformConfig } from "../../context/PlatformContext.js";

const fixture = vi.hoisted(() => ({
  platform: {} as PlatformConfig,
  state: {} as Record<string, any>,
  bounded: {
    feed: { items: [], status: "idle", totalCount: 0, windowStartIndex: 0, hasMore: false, hasPrevious: false },
    retry: vi.fn(), loadMore: vi.fn(), loadPrevious: vi.fn(), patchItems: vi.fn(),
  },
  facets: { rssFeedCount: 0 },
  detail: { item: null },
  display: [{ friendsMode: "all_content", savedContentSortMode: "date_saved", dualColumnMode: false, sidebarMode: "closed" }],
}));
vi.mock("../../context/PlatformContext.js", () => ({
  usePlatform: () => fixture.platform,
  useAppStore: (selector: (state: any) => unknown) => selector(fixture.state),
}));
vi.mock("../../hooks/useLibraryFacetSummary.js", () => ({ useLibraryFacetSummary: () => fixture.facets }));
vi.mock("../../hooks/useLibraryItemDetail.js", () => ({ useLibraryItemDetail: () => fixture.detail }));
vi.mock("../../hooks/useIsMobile.js", () => ({ useIsMobile: () => true }));
vi.mock("../../lib/device-display-preferences.js", () => ({ useDeviceDisplayPreferences: () => fixture.display }));
vi.mock("./useBoundedFeedItems.js", () => ({ useBoundedFeedItems: () => fixture.bounded }));
vi.mock("./ReaderView.js", () => ({ ReaderView: () => null }));
vi.mock("./FeedItem.js", () => ({ FeedItem: () => null }));
vi.mock("../AddFeedDialog.js", () => ({ AddFeedDialog: () => null }));
// FeedList owns the empty copy and layout. This fixture observes whether
// FeedView admits its empty state and forwards the real search hook's loading state.
vi.mock("./FeedList.js", () => ({
  FeedList: ({ loading, items, searchQuery }: { loading: boolean; items: unknown[]; searchQuery: string }) => (
    <div data-feed-list data-loading={String(loading)} data-empty={String(items.length === 0)}>{searchQuery}</div>
  ),
}));

import { FeedView } from "./FeedView.js";

describe("FeedView SQLite search presentation", () => {
  let host: HTMLDivElement;
  let root: Root;
  beforeEach(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    const noop = vi.fn();
    fixture.state = {
      activeFilter: {}, searchQuery: "needle", searchCorpusVersion: 41,
      libraryItemVersion: 41, savedFeedVersion: 41, isInitialized: true,
      selectedItemId: null, setSelectedItem: noop, setSelectedAccount: noop,
      setSelectedPerson: noop, setActiveView: noop, setVisibleFeedTotalCount: noop,
      markAsRead: noop, markItemsAsRead: noop, toggleSaved: noop, toggleArchived: noop,
      preferences: { display: { reading: { markReadOnScroll: false, showReadInGrayscale: false } } },
    };
    fixture.platform = {} as PlatformConfig;
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
  });
  afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = false;
  });

  it("shows query failure instead of admitting an empty FeedList", async () => {
    fixture.platform.searchLibraryItems = async () => { throw "QUERY_DEADLINE"; };
    await act(async () => root.render(<FeedView />));
    const alert = host.querySelector('[role="alert"]');
    expect(alert?.textContent).toContain("Unable to search this Library.");
    expect(alert?.textContent).toContain("needle");
    expect(alert?.getAttribute("data-search-failure-code")).toBe("QUERY_DEADLINE");
    expect(host.querySelector("[data-feed-list]")).toBeNull();
    expect(fixture.state.searchQuery).toBe("needle");
  });

  it("keeps a pending query loading until a true zero is admitted", async () => {
    let complete!: () => void;
    fixture.platform.searchLibraryItems = () => new Promise<void>((resolve) => { complete = resolve; });
    await act(async () => root.render(<FeedView />));
    expect(host.querySelector("[data-feed-list]")?.getAttribute("data-loading")).toBe("true");
    expect(host.querySelector('[role="alert"]')).toBeNull();
    await act(async () => complete());
    expect(host.querySelector("[data-feed-list]")?.getAttribute("data-loading")).toBe("false");
    expect(host.querySelector("[data-feed-list]")?.getAttribute("data-empty")).toBe("true");
    expect(host.querySelector('[role="alert"]')).toBeNull();
  });

  it("stops admitting an old zero during refresh and hides raw failure details", async () => {
    let fail!: (error: unknown) => void;
    fixture.platform.searchLibraryItems = vi.fn()
      .mockResolvedValueOnce(undefined)
      .mockImplementationOnce(() => new Promise<void>((_resolve, reject) => { fail = reject; }));
    await act(async () => root.render(<FeedView />));
    expect(host.querySelector("[data-feed-list]")?.getAttribute("data-loading")).toBe("false");
    fixture.state.searchCorpusVersion = 42;
    fixture.state.libraryItemVersion = 42;
    await act(async () => root.render(<FeedView />));
    expect(host.querySelector("[data-feed-list]")?.getAttribute("data-loading")).toBe("true");
    await act(async () => fail(new Error("private fixture content and path")));
    expect(host.querySelector('[role="alert"]')?.getAttribute("data-search-failure-code")).toBe("QUERY_FAILED");
    expect(host.querySelector("[data-feed-list]")).toBeNull();
    expect(host.textContent).not.toContain("private fixture content and path");
  });
});
