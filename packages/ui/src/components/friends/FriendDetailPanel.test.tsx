/**
 * @vitest-environment jsdom
 */
import { act, type ReactElement } from "react";
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
import type { FeedItem, Friend } from "@freed/shared";
import { FriendDetailPanel } from "./FriendDetailPanel.js";

vi.mock("../map/MiniFriendMapCard.js", () => ({
  MiniFriendMapCard: ({ feedItems }: { feedItems: readonly FeedItem[] }) => (
    <div data-testid="mini-map-items">
      {feedItems.map((item) => item.globalId).join(",")}
    </div>
  ),
}));

const friend: Friend = {
  id: "friend-1",
  name: "Ada Lovelace",
  relationshipStatus: "friend",
  careLevel: 5,
  sources: [],
  createdAt: 1,
  updatedAt: 1,
};

const timelineItem: FeedItem = {
  globalId: "rss:ada:1",
  platform: "rss",
  contentType: "post",
  capturedAt: 1,
  publishedAt: 1,
  author: { id: "ada", handle: "ada", displayName: "Ada" },
  content: { text: "Timeline item", mediaUrls: [], mediaTypes: [] },
  userState: { hidden: false, saved: false, archived: false, tags: [] },
  topics: [],
};

function buttonNamed(
  container: HTMLElement,
  name: string,
): HTMLButtonElement | null {
  return (
    [...container.querySelectorAll("button")].find(
      (button) => button.textContent?.trim() === name,
    ) ?? null
  );
}

describe("FriendDetailPanel timeline paging", () => {
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
    await act(async () => root?.unmount());
    container?.remove();
    root = null;
    container = null;
  });

  function renderPanel({
    activityLoading = false,
    feedItems = [timelineItem],
    locationItems = [],
    timelineAwayFromNewest,
    timelineHasMore,
    onLoadMoreTimeline,
    onShowNewestTimeline,
  }: {
    activityLoading?: boolean;
    feedItems?: readonly FeedItem[];
    locationItems?: readonly FeedItem[];
    timelineAwayFromNewest: boolean;
    timelineHasMore: boolean;
    onLoadMoreTimeline: () => void;
    onShowNewestTimeline: () => void;
  }): ReactElement {
    return (
      <FriendDetailPanel
        friend={friend}
        feedItems={feedItems}
        locationItems={locationItems}
        activityAvatarUrls={[]}
        latestPostAt={activityLoading ? null : timelineItem.publishedAt}
        activityLoading={activityLoading}
        timelineLoading={false}
        timelineLoadingMore={false}
        timelineHasMore={timelineHasMore}
        timelineAwayFromNewest={timelineAwayFromNewest}
        timelineTotalCount={130}
        onLoadMoreTimeline={onLoadMoreTimeline}
        onShowNewestTimeline={onShowNewestTimeline}
        onLogReachOut={() => undefined}
        onOpenMap={() => undefined}
      />
    );
  }

  it("offers older posts from newest and an explicit return after paging", async () => {
    const onLoadMoreTimeline = vi.fn();
    const onShowNewestTimeline = vi.fn();
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(
        renderPanel({
          timelineAwayFromNewest: false,
          timelineHasMore: true,
          onLoadMoreTimeline,
          onShowNewestTimeline,
        }),
      );
    });

    expect(container.textContent).toContain("130 captured posts");
    expect(buttonNamed(container, "Back to newest")).toBeNull();
    buttonNamed(container, "Older posts")?.click();
    expect(onLoadMoreTimeline).toHaveBeenCalledOnce();

    await act(async () => {
      root?.render(
        renderPanel({
          timelineAwayFromNewest: true,
          timelineHasMore: false,
          onLoadMoreTimeline,
          onShowNewestTimeline,
        }),
      );
    });

    expect(buttonNamed(container, "Older posts")).toBeNull();
    buttonNamed(container, "Back to newest")?.click();
    expect(onShowNewestTimeline).toHaveBeenCalledOnce();
  });

  it("keeps map input separate from the current timeline window", async () => {
    const locationItem = {
      ...timelineItem,
      globalId: "rss:ada:older-location",
      location: {
        name: "London",
        source: "geo_tag" as const,
      },
    };
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(
        renderPanel({
          locationItems: [locationItem],
          timelineAwayFromNewest: false,
          timelineHasMore: false,
          onLoadMoreTimeline: () => undefined,
          onShowNewestTimeline: () => undefined,
        }),
      );
    });

    expect(
      container.querySelector('[data-testid="mini-map-items"]')?.textContent,
    ).toBe(locationItem.globalId);
    expect(
      container.querySelector('[data-testid="mini-map-items"]')?.textContent,
    ).not.toContain(timelineItem.globalId);
  });

  it("keeps newest navigation and avoids false-zero copy on empty deferred activity", async () => {
    const onShowNewestTimeline = vi.fn();
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(
        renderPanel({
          activityLoading: true,
          feedItems: [],
          timelineAwayFromNewest: true,
          timelineHasMore: false,
          onLoadMoreTimeline: () => undefined,
          onShowNewestTimeline,
        }),
      );
    });

    expect(container.textContent).toContain("Last post loading...");
    expect(container.textContent).not.toContain("Last post never");
    buttonNamed(container, "Back to newest")?.click();
    expect(onShowNewestTimeline).toHaveBeenCalledOnce();
  });
});
