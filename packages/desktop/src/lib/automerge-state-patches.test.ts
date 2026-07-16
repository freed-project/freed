import { describe, expect, it } from "vitest";
import { createDefaultPreferences, type FeedItem } from "@freed/shared";
import type { DocState } from "./automerge-types";
import {
  applyItemPatchesToState,
  applyPreferencePatchToState,
  createItemIndex,
} from "./automerge-state-patches";

const FEED_URL = "https://example.com/feed.xml";

function makeItem(globalId: string, userState: Partial<FeedItem["userState"]> = {}): FeedItem {
  return {
    globalId,
    platform: "rss",
    contentType: "article",
    capturedAt: 1,
    publishedAt: 1,
    author: {
      id: "author",
      handle: "author",
      displayName: "Author",
    },
    content: {
      text: "Article",
      mediaUrls: [],
      mediaTypes: [],
    },
    rssSource: {
      feedUrl: FEED_URL,
      feedTitle: "Example",
      siteUrl: "https://example.com",
    },
    sourceUrl: "https://example.com/article",
    topics: [],
    userState: {
      hidden: false,
      saved: false,
      archived: false,
      tags: [],
      ...userState,
    },
  };
}

function makeState(items: FeedItem[]): DocState {
  return {
    items,
    searchCorpusVersion: 1,
    feeds: {},
    persons: {},
    accounts: {},
    friends: {},
    preferences: createDefaultPreferences(),
    desktopClientIds: [],
    feedUnreadCounts: { [FEED_URL]: 1 },
    feedTotalCounts: { [FEED_URL]: 2 },
    totalUnreadCount: 1,
    unreadCountByPlatform: { rss: 1 },
    totalItemCount: 2,
    itemCountByPlatform: { rss: 2 },
    totalArchivableCount: 1,
    archivableCountByPlatform: { rss: 1 },
    archivableFeedCounts: { [FEED_URL]: 1 },
    mapFriendLocationCount: 7,
    mapAllContentLocationCount: 11,
    docItemCount: items.length,
  };
}

describe("Automerge item patch state updates", () => {
  it("replaces Facebook capture maps so removed groups stay removed", () => {
    const state = makeState([]);
    state.preferences.fbCapture = {
      knownGroups: {
        one: { id: "one", name: "One", url: "https://facebook.com/groups/one" },
        two: { id: "two", name: "Two", url: "https://facebook.com/groups/two" },
      },
      excludedGroupIds: { one: true },
    };

    const result = applyPreferencePatchToState(state, {
      fbCapture: {
        knownGroups: {
          two: { id: "two", name: "Two", url: "https://facebook.com/groups/two" },
        },
        excludedGroupIds: {},
      },
    });

    expect(result.preferences.fbCapture.knownGroups).toEqual({
      two: { id: "two", name: "Two", url: "https://facebook.com/groups/two" },
    });
    expect(result.preferences.fbCapture.excludedGroupIds).toEqual({});
    expect(result.preferences.display).toEqual(state.preferences.display);
  });

  it("preserves the omitted Facebook capture map in a partial patch", () => {
    const state = makeState([]);
    state.preferences.fbCapture = {
      knownGroups: {
        one: { id: "one", name: "One", url: "https://facebook.com/groups/one" },
      },
      excludedGroupIds: { one: true },
    };

    const result = applyPreferencePatchToState(state, {
      fbCapture: { excludedGroupIds: {} },
    });

    expect(result.preferences.fbCapture.knownGroups).toEqual(
      state.preferences.fbCapture.knownGroups,
    );
    expect(result.preferences.fbCapture.excludedGroupIds).toEqual({});
  });

  it("updates read and archivable counts without rebuilding every count from items", () => {
    const unread = makeItem("rss:unread");
    const read = makeItem("rss:read", { readAt: 10 });
    const state = makeState([unread, read]);
    const index = createItemIndex(state.items);

    const patchedUnread = makeItem("rss:unread", { readAt: 20 });
    const result = applyItemPatchesToState(state, [{ item: patchedUnread }], index);

    expect(result.state.items).toEqual([patchedUnread, read]);
    expect(result.itemIndex.get("rss:unread")).toBe(0);
    expect(result.itemIndex.get("rss:read")).toBe(1);
    expect(result.state.totalUnreadCount).toBe(0);
    expect(result.state.unreadCountByPlatform).toEqual({});
    expect(result.state.feedUnreadCounts).toEqual({});
    expect(result.state.totalArchivableCount).toBe(2);
    expect(result.state.archivableCountByPlatform).toEqual({ rss: 2 });
    expect(result.state.archivableFeedCounts).toEqual({ [FEED_URL]: 2 });
    expect(result.state.mapFriendLocationCount).toBe(7);
    expect(result.state.mapAllContentLocationCount).toBe(11);
  });

  it("removes archived items from aggregate counts while keeping them in the item list", () => {
    const unread = makeItem("rss:unread");
    const read = makeItem("rss:read", { readAt: 10 });
    const state = makeState([unread, read]);
    const index = createItemIndex(state.items);

    const archivedUnread = makeItem("rss:unread", { archived: true, archivedAt: 30 });
    const result = applyItemPatchesToState(state, [{ item: archivedUnread }], index);

    expect(result.state.items).toEqual([archivedUnread, read]);
    expect(result.state.totalItemCount).toBe(1);
    expect(result.state.itemCountByPlatform).toEqual({ rss: 1 });
    expect(result.state.feedTotalCounts).toEqual({ [FEED_URL]: 1 });
    expect(result.state.totalUnreadCount).toBe(0);
    expect(result.state.feedUnreadCounts).toEqual({});
  });

  it("drops hidden patched items and rebuilds the affected index", () => {
    const unread = makeItem("rss:unread");
    const read = makeItem("rss:read", { readAt: 10 });
    const state = makeState([unread, read]);
    const index = createItemIndex(state.items);

    const hiddenUnread = makeItem("rss:unread", { hidden: true });
    const result = applyItemPatchesToState(state, [{ item: hiddenUnread }], index);

    expect(result.state.items).toEqual([read]);
    expect(result.itemIndex.has("rss:unread")).toBe(false);
    expect(result.itemIndex.get("rss:read")).toBe(0);
    expect(result.state.totalItemCount).toBe(1);
    expect(result.state.totalUnreadCount).toBe(0);
  });

  it("removes duplicate records and updates counts without hydrating full state", () => {
    const unread = makeItem("rss:unread");
    const read = makeItem("rss:read", { readAt: 10 });
    const state = makeState([unread, read]);
    const index = createItemIndex(state.items);
    const patchedRead = makeItem("rss:read", { readAt: 10, saved: true });

    const result = applyItemPatchesToState(state, [{ item: patchedRead }], index, {
      removedItemIds: ["rss:unread"],
      searchCorpusVersion: 2,
    });

    expect(result.state.items).toEqual([patchedRead]);
    expect(result.itemIndex.has("rss:unread")).toBe(false);
    expect(result.itemIndex.get("rss:read")).toBe(0);
    expect(result.state.searchCorpusVersion).toBe(2);
    expect(result.state.docItemCount).toBe(1);
    expect(result.state.totalItemCount).toBe(1);
    expect(result.state.totalUnreadCount).toBe(0);
    expect(result.state.itemCountByPlatform).toEqual({ rss: 1 });
    expect(result.state.feedTotalCounts).toEqual({ [FEED_URL]: 1 });
    expect(result.state.feedUnreadCounts).toEqual({});
  });

  it("decrements the document count for removed records outside the UI projection", () => {
    const unread = makeItem("rss:unread");
    const state = {
      ...makeState([unread]),
      docItemCount: 2,
      totalItemCount: 1,
      itemCountByPlatform: { rss: 1 },
      feedTotalCounts: { [FEED_URL]: 1 },
    };
    const index = createItemIndex(state.items);

    const result = applyItemPatchesToState(state, [], index, {
      removedItemIds: ["rss:hidden-duplicate"],
    });

    expect(result.state.items).toBe(state.items);
    expect(result.itemIndex).toBe(index);
    expect(result.state.docItemCount).toBe(1);
    expect(result.state.totalItemCount).toBe(1);
  });

  it("preserves count map identity for count-neutral item patches", () => {
    const unread = makeItem("rss:unread");
    const read = makeItem("rss:read", { readAt: 10 });
    const state = makeState([unread, read]);
    const index = createItemIndex(state.items);

    const likedUnread = makeItem("rss:unread", { liked: true, likedAt: 40 });
    const result = applyItemPatchesToState(state, [{ item: likedUnread }], index);

    expect(result.state.items).toEqual([likedUnread, read]);
    expect(result.state.feedUnreadCounts).toBe(state.feedUnreadCounts);
    expect(result.state.feedTotalCounts).toBe(state.feedTotalCounts);
    expect(result.state.unreadCountByPlatform).toBe(state.unreadCountByPlatform);
    expect(result.state.itemCountByPlatform).toBe(state.itemCountByPlatform);
    expect(result.state.archivableCountByPlatform).toBe(state.archivableCountByPlatform);
    expect(result.state.archivableFeedCounts).toBe(state.archivableFeedCounts);
    expect(result.state.totalUnreadCount).toBe(state.totalUnreadCount);
    expect(result.state.totalItemCount).toBe(state.totalItemCount);
    expect(result.state.totalArchivableCount).toBe(state.totalArchivableCount);
  });

  it("adds new items with ranked order metadata without a full state update", () => {
    const unread = makeItem("rss:unread");
    const read = makeItem("rss:read", { readAt: 10 });
    const state = makeState([unread, read]);
    const index = createItemIndex(state.items);
    const added = makeItem("rss:new");

    const result = applyItemPatchesToState(state, [{ item: added }], index, {
      orderedItemIds: ["rss:new", "rss:unread", "rss:read"],
      searchCorpusVersion: 2,
      docItemCount: 3,
    });

    expect(result.state.items.map((item) => item.globalId)).toEqual([
      "rss:new",
      "rss:unread",
      "rss:read",
    ]);
    expect(result.itemIndex.get("rss:new")).toBe(0);
    expect(result.state.searchCorpusVersion).toBe(2);
    expect(result.state.docItemCount).toBe(3);
    expect(result.state.totalUnreadCount).toBe(2);
    expect(result.state.unreadCountByPlatform).toEqual({ rss: 2 });
    expect(result.state.feedUnreadCounts).toEqual({ [FEED_URL]: 2 });
    expect(result.state.totalItemCount).toBe(3);
    expect(result.state.itemCountByPlatform).toEqual({ rss: 3 });
    expect(result.state.feedTotalCounts).toEqual({ [FEED_URL]: 3 });
    expect(result.state.totalArchivableCount).toBe(1);
  });

  it("merges ranked patch additions into priority order without full ordered ids", () => {
    const high = { ...makeItem("rss:high"), priority: 90, publishedAt: 30 };
    const mid = { ...makeItem("rss:mid"), priority: 50, publishedAt: 20 };
    const low = { ...makeItem("rss:low"), priority: 10, publishedAt: 10 };
    const state = {
      ...makeState([high, mid, low]),
      feedUnreadCounts: { [FEED_URL]: 3 },
      feedTotalCounts: { [FEED_URL]: 3 },
      totalUnreadCount: 3,
      unreadCountByPlatform: { rss: 3 },
      totalItemCount: 3,
      itemCountByPlatform: { rss: 3 },
      totalArchivableCount: 0,
      archivableCountByPlatform: {},
      archivableFeedCounts: {},
    };
    const index = createItemIndex(state.items);
    const addedTop = { ...makeItem("rss:top"), priority: 95, publishedAt: 40 };
    const addedMiddle = { ...makeItem("rss:middle"), priority: 40, publishedAt: 15 };

    const result = applyItemPatchesToState(
      state,
      [{ item: addedMiddle }, { item: addedTop }],
      index,
      {
        preservePriorityOrder: true,
        searchCorpusVersion: 2,
      },
    );

    expect(result.state.items.map((item) => item.globalId)).toEqual([
      "rss:top",
      "rss:high",
      "rss:mid",
      "rss:middle",
      "rss:low",
    ]);
    expect(result.itemIndex.get("rss:top")).toBe(0);
    expect(result.itemIndex.get("rss:middle")).toBe(3);
    expect(result.state.searchCorpusVersion).toBe(2);
    expect(result.state.docItemCount).toBe(5);
    expect(result.state.totalItemCount).toBe(5);
    expect(result.state.totalUnreadCount).toBe(5);
  });

  it("keeps a synced X like patch count-neutral and in place", () => {
    const { rssSource: _rssSource, ...baseXPost } = makeItem("x:2049705418436600244");
    const xPost = {
      ...baseXPost,
      platform: "x" as const,
    };
    const read = makeItem("rss:read", { readAt: 10 });
    const state = {
      ...makeState([xPost, read]),
      feedUnreadCounts: {},
      feedTotalCounts: { [FEED_URL]: 1 },
      totalUnreadCount: 1,
      unreadCountByPlatform: { x: 1 },
      totalItemCount: 2,
      itemCountByPlatform: { x: 1, rss: 1 },
      totalArchivableCount: 1,
      archivableCountByPlatform: { rss: 1 },
      archivableFeedCounts: { [FEED_URL]: 1 },
    };
    const index = createItemIndex(state.items);

    const likedXPost = {
      ...xPost,
      userState: {
        ...xPost.userState,
        liked: true,
        likedAt: 40,
        likedSyncedAt: 50,
      },
    };
    const result = applyItemPatchesToState(state, [{ item: likedXPost }], index);

    expect(result.state.items).toEqual([likedXPost, read]);
    expect(result.itemIndex.get("x:2049705418436600244")).toBe(0);
    expect(result.state.totalUnreadCount).toBe(state.totalUnreadCount);
    expect(result.state.unreadCountByPlatform).toBe(state.unreadCountByPlatform);
    expect(result.state.totalItemCount).toBe(state.totalItemCount);
    expect(result.state.itemCountByPlatform).toBe(state.itemCountByPlatform);
    expect(result.state.totalArchivableCount).toBe(state.totalArchivableCount);
    expect(result.state.mapFriendLocationCount).toBe(state.mapFriendLocationCount);
    expect(result.state.mapAllContentLocationCount).toBe(state.mapAllContentLocationCount);
  });

  it("applies a large archive patch batch to aggregate counts", () => {
    const items = Array.from({ length: 300 }, (_, index) =>
      makeItem(`rss:read-${index}`, { readAt: 10 + index })
    );
    const state: DocState = {
      ...makeState(items),
      feedUnreadCounts: {},
      totalUnreadCount: 0,
      unreadCountByPlatform: {},
      feedTotalCounts: { [FEED_URL]: 300 },
      totalItemCount: 300,
      itemCountByPlatform: { rss: 300 },
      totalArchivableCount: 300,
      archivableCountByPlatform: { rss: 300 },
      archivableFeedCounts: { [FEED_URL]: 300 },
    };
    const index = createItemIndex(state.items);
    const patches = items.map((item) => ({
      item: {
        ...item,
        userState: {
          ...item.userState,
          archived: true,
          archivedAt: 500,
        },
      },
    }));

    const result = applyItemPatchesToState(state, patches, index);

    expect(result.state.items).toHaveLength(300);
    expect(result.state.items.every((item) => item.userState.archived)).toBe(true);
    expect(result.state.totalItemCount).toBe(0);
    expect(result.state.itemCountByPlatform).toEqual({});
    expect(result.state.feedTotalCounts).toEqual({});
    expect(result.state.totalArchivableCount).toBe(0);
    expect(result.state.archivableCountByPlatform).toEqual({});
    expect(result.state.archivableFeedCounts).toEqual({});
  });
});
