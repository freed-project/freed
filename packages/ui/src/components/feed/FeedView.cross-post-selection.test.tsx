/** @vitest-environment jsdom */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FeedItem as FeedItemType } from "@freed/shared";
import { libraryCoreFeedCardToItemV1, projectLibraryCoreFeedCardV1 } from "@freed/shared/library-core";
import type { PlatformConfig, ReaderHydrationResult } from "../../context/PlatformContext.js";

const fixture = vi.hoisted(() => ({
  state: {} as Record<string, any>,
  bounded: {
    feed: { items: [] as FeedItemType[], status: "ready", totalCount: 2, windowStartIndex: 0, hasMore: false, hasPrevious: false },
    retry: vi.fn(), loadMore: vi.fn(), loadPrevious: vi.fn(), patchItems: vi.fn(),
  },
  display: [{ friendsMode: "all_content", savedContentSortMode: "date_saved", dualColumnMode: false, sidebarMode: "closed" }],
}));
vi.mock("../../context/PlatformContext.js", async (importOriginal) => ({
  ...await importOriginal<typeof import("../../context/PlatformContext.js")>(),
  useAppStore: (selector: (state: any) => unknown) => selector(fixture.state),
}));
vi.mock("../../hooks/useLibraryFacetSummary.js", () => ({ useLibraryFacetSummary: () => ({ rssFeedCount: 0 }) }));
vi.mock("../../hooks/useIsMobile.js", () => ({ useIsMobile: () => true }));
vi.mock("../../lib/device-display-preferences.js", () => ({ useDeviceDisplayPreferences: () => fixture.display }));
vi.mock("./useBoundedFeedItems.js", () => ({ useBoundedFeedItems: () => fixture.bounded }));
vi.mock("../AddFeedDialog.js", () => ({ AddFeedDialog: () => null }));
vi.mock("./FeedList.js", async () => {
  const { FeedItem } = await import("./FeedItem.js");
  return { FeedList: ({ items, onItemClick }: { items: FeedItemType[]; onItemClick: (item: FeedItemType) => void }) => (
    <div data-testid="synthetic-feed-list">{items.map((item) => (
      <div key={item.globalId} data-card-id={item.globalId}>
        <FeedItem item={item} onClick={() => onItemClick(item)} />
      </div>
    ))}</div>
  ) };
});

import { PlatformProvider } from "../../context/PlatformContext.js";
import { FeedView } from "./FeedView.js";

const SHARED_URL = "https://example.com/shared-article";
function post(id: "before" | "selected", detail = false): FeedItemType {
  return {
    globalId: `facebook:cross-post-${id}`,
    platform: "facebook", contentType: "post", capturedAt: 1_712_147_200_000, publishedAt: 1_712_147_140_000,
    author: { id: `author-${id}`, handle: id, displayName: `${id} ${detail ? "detail" : "card"} author` },
    content: {
      text: `${id} ${detail ? "detail" : "card"} body`,
      mediaUrls: [`https://example.com/${id}-${detail ? "detail" : "card"}.jpg`], mediaTypes: ["image"],
      linkPreview: { url: SHARED_URL, title: "Shared article" },
    },
    sourceUrl: `https://example.com/posts/${id}`,
    userState: { hidden: false, saved: false, archived: false, tags: [] }, topics: [],
  };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((complete) => { resolve = complete; });
  return { promise, resolve };
}

// Tier1: actual FeedView, detail hook, ReaderView and FeedItem composition.
// Distinct posts share one linked URL; controlled detail/media promises protect
// globalId selection rather than URL equality. The flat FeedItem fixture does
// not claim complete nested sharing capture, real image decode or live access.
describe("FeedView cross-post detail and media selection", () => {
  let host: HTMLDivElement;
  let root: Root;
  beforeEach(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    const values = new Map<string, string>();
    Object.defineProperty(window, "localStorage", { configurable: true, value: {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => { values.set(key, value); },
      removeItem: (key: string) => { values.delete(key); }, clear: () => { values.clear(); },
    } });
    Object.defineProperty(window.navigator, "onLine", { configurable: true, value: true });
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("Synthetic test forbids network requests"); }));
    const noop = vi.fn();
    fixture.state = {
      activeFilter: {}, searchQuery: "", searchCorpusVersion: 41, libraryItemVersion: 41, savedFeedVersion: 41,
      isInitialized: true, selectedItemId: null,
      setSelectedItem: vi.fn((id: string | null) => { fixture.state.selectedItemId = id; }),
      setSelectedAccount: noop, setSelectedPerson: noop, setActiveView: noop, setVisibleFeedTotalCount: noop,
      markAsRead: noop, markItemsAsRead: noop, toggleSaved: noop, toggleArchived: noop, toggleLiked: noop,
      preferences: { display: { reading: { markReadOnScroll: false, showReadInGrayscale: false, focusMode: false, focusIntensity: "normal" } } },
    };
    fixture.bounded.feed.items = [post("before"), post("selected")].map((item) =>
      libraryCoreFeedCardToItemV1(projectLibraryCoreFeedCardV1(item)),
    );
    host = document.createElement("div"); document.body.appendChild(host); root = createRoot(host);
  });
  afterEach(async () => {
    await act(async () => root.unmount()); host.remove();
    vi.unstubAllGlobals(); vi.restoreAllMocks();
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = false;
  });

  it.each([
    { label: "late detail then media", order: "detail-first", html: false },
    { label: "late media then detail", order: "media-first", html: false },
    { label: "late detail then media with HTML", order: "detail-first", html: true },
    { label: "late media then detail with HTML", order: "media-first", html: true },
  ])(
    "keeps the selected cross-post when requests resolve out of order: $label", async ({ order, html }) => {
      const first = post("before"), selected = post("selected");
      expect(first.content.linkPreview!.url).toBe(selected.content.linkPreview!.url);
      expect(first.globalId).not.toBe(selected.globalId);
      const details = new Map([first, selected].map((item) => [item.globalId, deferred<FeedItemType | null>()]));
      const media = new Map([first, selected].map((item) => [item.globalId, deferred<ReaderHydrationResult>()]));
      const readLibraryItemDetail = vi.fn((id: string) => details.get(id)!.promise);
      const hydrateReaderItem = vi.fn((item: FeedItemType) => media.get(item.globalId)!.promise);
      const platform = {
        store: (() => undefined) as PlatformConfig["store"], feedMediaPreviews: "lazy-thumbnails",
        openBoundedFeedReader: vi.fn(), readLibraryItemDetail,
        getLocalContent: vi.fn(async () => null), hydrateReaderItem,
      } as unknown as PlatformConfig;
      const render = () => root.render(<PlatformProvider value={platform}><FeedView /></PlatformProvider>);
      await act(async () => render());
      for (const id of ["before", "selected"] as const) {
        const thumbnail = host.querySelector<HTMLImageElement>(`[data-card-id="${post(id).globalId}"] img[src="https://example.com/${id}-card.jpg"]`);
        expect(thumbnail).not.toBeNull(); expect(thumbnail!.getAttribute("loading")).toBe("lazy");
      }
      await act(async () => {
        const card = host.querySelector<HTMLElement>(`[data-card-id="${first.globalId}"] [role="button"]`);
        expect(card).not.toBeNull(); card!.click(); render();
      });
      expect(readLibraryItemDetail.mock.calls.map(([id]) => id)).toEqual([first.globalId]);
      expect(hydrateReaderItem.mock.calls.map(([item]) => item.globalId)).toEqual([first.globalId]);
      // Change the actual store selection while the first detail and media
      // requests remain pending, as navigation to the next feed item does.
      await act(async () => { fixture.state.setSelectedItem(selected.globalId); render(); });
      expect(readLibraryItemDetail.mock.calls.map(([id]) => id)).toEqual([first.globalId, selected.globalId]);
      expect(hydrateReaderItem.mock.calls.map(([item]) => item.globalId)).toEqual([first.globalId, selected.globalId]);
      const assertSelected = () => {
        expect(fixture.state.selectedItemId).toBe(selected.globalId);
        expect(host.textContent).not.toContain("before card author");
        expect(host.textContent).not.toContain("before detail author");
        expect(host.textContent).not.toContain("Obsolete first hydration body");
        expect(host.querySelector('img[src*="/before-"]')).toBeNull();
        expect(host.querySelector('img[src="https://example.com/obsolete-hydration.jpg"]')).toBeNull();
      };
      assertSelected();
      const settleDetail = (id: "before" | "selected") => act(async () => details.get(post(id).globalId)!.resolve(post(id, true)));
      const settleMedia = (id: "before" | "selected") => act(async () => media.get(post(id).globalId)!.resolve({
        ...(html ? { html: `<article><h1>${id === "before" ? "Obsolete first" : "Selected"} hydration title</h1><img src="https://example.com/${id === "before" ? "obsolete" : "selected"}-hydration.jpg"><p>${id === "before" ? "Obsolete first" : "Selected"} hydration body</p></article>` } : {}),
        text: id === "before" ? "Obsolete first hydration body" : "Selected hydration body",
        mediaUrls: [`https://example.com/${id === "before" ? "obsolete" : "selected"}-hydration.jpg`], mediaTypes: ["image"],
      }));
      if (order === "detail-first") { await settleDetail("selected"); await settleMedia("selected"); }
      else { await settleMedia("selected"); await settleDetail("selected"); }
      const assertCurrentResult = () => {
        assertSelected();
        expect(host.textContent).toContain("selected detail author");
        expect(host.textContent).toContain("Selected hydration body");
        // A soft assertion still fails the case, while allowing the later
        // obsolete requests to settle and exercise the independent fence.
        expect.soft(host.querySelector('img[src="https://example.com/selected-hydration.jpg"]')).not.toBeNull();
      };
      assertCurrentResult();
      if (order === "detail-first") { await settleDetail("before"); assertCurrentResult(); await settleMedia("before"); }
      else { await settleMedia("before"); assertCurrentResult(); await settleDetail("before"); }
      assertCurrentResult();
      expect(readLibraryItemDetail).toHaveBeenCalledTimes(2);
      expect(hydrateReaderItem).toHaveBeenCalledTimes(2);
      expect(globalThis.fetch).not.toHaveBeenCalled();
    },
  );
});
