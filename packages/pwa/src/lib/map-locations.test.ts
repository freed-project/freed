import { describe, expect, it, vi } from "vitest";
import {
  extractLocationFromItem,
  getDefaultMapMode,
  getLatestAuthorLocationMarkers,
  getLatestFriendLocationMarkers,
  getLastSeenLocationForFriend,
  groupResolvedLocations,
  type FeedItem,
  type Friend,
  type LocationMarkerSummary,
  type ResolvedLocationItem,
} from "@freed/shared";
import {
  openFriendFromMap,
  openPostFromMap,
} from "@freed/ui/lib/map-navigation";

function makeFriend(overrides: Partial<Friend> & { id: string }): Friend {
  const now = Date.now();
  return {
    name: "Ada Lovelace",
    sources: [
      {
        platform: "instagram",
        authorId: "ada-ig",
        handle: "ada",
      },
    ],
    careLevel: 4,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function makeItem(
  overrides: Partial<FeedItem> & { globalId: string; publishedAt: number }
): FeedItem {
  return {
    platform: "instagram",
    contentType: "post",
    capturedAt: overrides.publishedAt,
    author: {
      id: "ada-ig",
      handle: "ada",
      displayName: "Ada",
    },
    content: {
      text: "Testing map logic",
      mediaUrls: [],
      mediaTypes: [],
    },
    userState: {
      hidden: false,
      saved: false,
      archived: false,
      tags: [],
    },
    topics: [],
    ...overrides,
  };
}

function markerFromResolved(resolved: ResolvedLocationItem[]): LocationMarkerSummary {
  const markers = groupResolvedLocations(resolved);
  expect(markers).toHaveLength(1);
  return markers[0];
}

describe("location grouping", () => {
  it("collapses repeated friend posts at the same coordinates into one marker", () => {
    const friend = makeFriend({ id: "friend-1" });
    const resolved: ResolvedLocationItem[] = [
      {
        item: makeItem({ globalId: "ig:1", publishedAt: 10 }),
        friend,
        lat: 48.8566,
        lng: 2.3522,
        label: "Paris",
      },
      {
        item: makeItem({ globalId: "ig:2", publishedAt: 20 }),
        friend,
        lat: 48.8566,
        lng: 2.3522,
        label: "Paris, France",
      },
    ];

    const marker = markerFromResolved(resolved);
    expect(marker.groupCount).toBe(2);
    expect(marker.item.globalId).toBe("ig:2");
    expect(marker.label).toBe("Paris, France");
  });

  it("groups unmatched authors independently by platform author identity", () => {
    const resolved: ResolvedLocationItem[] = [
      {
        item: makeItem({ globalId: "ig:1", publishedAt: 10 }),
        friend: null,
        lat: 40.7128,
        lng: -74.006,
        label: "New York",
      },
      {
        item: makeItem({
          globalId: "ig:2",
          publishedAt: 20,
          author: { id: "another-author", handle: "another", displayName: "Another" },
        }),
        friend: null,
        lat: 40.7128,
        lng: -74.006,
        label: "New York",
      },
    ];

    const markers = groupResolvedLocations(resolved);
    expect(markers).toHaveLength(2);
  });

  it("picks the newest resolvable location as the friend last seen summary", () => {
    const friend = makeFriend({ id: "friend-1" });
    const lastSeen = getLastSeenLocationForFriend(
      [
        {
          item: makeItem({ globalId: "ig:1", publishedAt: 10 }),
          friend,
          lat: 37.7749,
          lng: -122.4194,
          label: "San Francisco",
        },
        {
          item: makeItem({ globalId: "ig:2", publishedAt: 40 }),
          friend,
          lat: 51.5072,
          lng: -0.1276,
          label: "London",
        },
      ],
      friend.id
    );

    expect(lastSeen?.label).toBe("London");
    expect(lastSeen?.item.globalId).toBe("ig:2");
  });

  it("shows only the newest location per friend on the main map", () => {
    const ada = makeFriend({ id: "friend-ada" });
    const maya = makeFriend({
      id: "friend-maya",
      name: "Maya Chen",
      sources: [
        {
          platform: "instagram",
          authorId: "maya-ig",
          handle: "maya",
        },
      ],
    });

    const markers = getLatestFriendLocationMarkers([
      {
        item: makeItem({ globalId: "ig:1", publishedAt: 10 }),
        friend: ada,
        lat: 37.7749,
        lng: -122.4194,
        label: "San Francisco",
      },
      {
        item: makeItem({ globalId: "ig:2", publishedAt: 40 }),
        friend: ada,
        lat: 51.5072,
        lng: -0.1276,
        label: "London",
      },
      {
        item: makeItem({
          globalId: "ig:3",
          publishedAt: 30,
          author: { id: "maya-ig", handle: "maya", displayName: "Maya" },
        }),
        friend: maya,
        lat: 48.8566,
        lng: 2.3522,
        label: "Paris",
      },
      {
        item: makeItem({
          globalId: "ig:4",
          publishedAt: 20,
          author: { id: "unlinked", handle: "ghost", displayName: "Ghost" },
        }),
        friend: null,
        lat: 35.6762,
        lng: 139.6503,
        label: "Tokyo",
      },
    ]);

    expect(markers).toHaveLength(2);
    expect(markers.map((marker) => marker.friend?.id)).toEqual([
      "friend-ada",
      "friend-maya",
    ]);
    expect(markers[0]?.label).toBe("London");
    expect(markers[0]?.item.globalId).toBe("ig:2");
  });

  it("shows only the newest location per author in all-content mode", () => {
    const ada = makeFriend({ id: "friend-ada" });

    const markers = getLatestAuthorLocationMarkers([
      {
        item: makeItem({ globalId: "ig:1", publishedAt: 10 }),
        friend: ada,
        lat: 37.7749,
        lng: -122.4194,
        label: "San Francisco",
      },
      {
        item: makeItem({ globalId: "ig:2", publishedAt: 40 }),
        friend: ada,
        lat: 51.5072,
        lng: -0.1276,
        label: "London",
      },
      {
        item: makeItem({
          globalId: "ig:3",
          publishedAt: 30,
          author: { id: "maya-ig", handle: "maya", displayName: "Maya" },
        }),
        friend: null,
        lat: 48.8566,
        lng: 2.3522,
        label: "Paris",
      },
    ]);

    expect(markers).toHaveLength(2);
    expect(markers.map((marker) => marker.authorKey)).toEqual([
      "author:instagram:ada-ig",
      "author:instagram:maya-ig",
    ]);
    expect(markers[0]?.label).toBe("London");
    expect(markers[0]?.item.globalId).toBe("ig:2");
  });

  it("recovers story place names from Instagram location URLs when the label is junk", () => {
    const signal = extractLocationFromItem(
      makeItem({
        globalId: "ig:story-1",
        publishedAt: 10,
        contentType: "story",
        location: {
          name: "Locations",
          url: "https://www.instagram.com/explore/locations/123456789/big-bear-california/",
          source: "sticker",
        },
      }),
    );

    expect(signal).toEqual({ name: "Big Bear California" });
  });

  it("rejects unrecoverable generic story labels", () => {
    const signal = extractLocationFromItem(
      makeItem({
        globalId: "ig:story-2",
        publishedAt: 10,
        contentType: "story",
        location: {
          name: "Check registration",
          source: "sticker",
        },
      }),
    );

    expect(signal).toBeNull();
  });

  it("defaults to all content when there are no friend markers", () => {
    expect(getDefaultMapMode(0, 4)).toBe("all_content");
    expect(getDefaultMapMode(2, 4)).toBe("friends");
    expect(getDefaultMapMode(0, 0)).toBe("friends");
  });
});

describe("map navigation helpers", () => {
  it("opens a friend from a marker", () => {
    const friend = makeFriend({ id: "friend-1" });
    const marker = markerFromResolved([
      {
        item: makeItem({ globalId: "ig:1", publishedAt: 10 }),
        friend,
        lat: 48.8566,
        lng: 2.3522,
        label: "Paris",
      },
    ]);

    const setActiveView = vi.fn();
    const setSelectedFriend = vi.fn();
    const setSelectedItem = vi.fn();

    openFriendFromMap(marker, {
      setActiveView,
      setSelectedFriend,
      setSelectedItem,
    });

    expect(setSelectedFriend).toHaveBeenCalledWith(friend.id);
    expect(setSelectedItem).toHaveBeenCalledWith(null);
    expect(setActiveView).toHaveBeenCalledWith("friends");
  });

  it("opens a post from a marker and clears map-only state", () => {
    const friend = makeFriend({ id: "friend-1" });
    const marker = markerFromResolved([
      {
        item: makeItem({ globalId: "ig:1", publishedAt: 10 }),
        friend,
        lat: 48.8566,
        lng: 2.3522,
        label: "Paris",
      },
    ]);

    const setActiveView = vi.fn();
    const setSelectedFriend = vi.fn();
    const setSelectedItem = vi.fn();
    const setFilter = vi.fn();
    const setSearchQuery = vi.fn();

    openPostFromMap(marker, {
      setActiveView,
      setSelectedFriend,
      setSelectedItem,
      setFilter,
      setSearchQuery,
    });

    expect(setFilter).toHaveBeenCalledWith({});
    expect(setSearchQuery).toHaveBeenCalledWith("");
    expect(setSelectedFriend).toHaveBeenCalledWith(friend.id);
    expect(setSelectedItem).toHaveBeenCalledWith("ig:1");
    expect(setActiveView).toHaveBeenCalledWith("feed");
  });
});
