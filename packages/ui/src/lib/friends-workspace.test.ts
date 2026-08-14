import { describe, expect, it } from "vitest";
import type { Account, FeedItem, Person, RssFeed } from "@freed/shared";
import {
  buildFriendOverviewEntries,
  buildFriendOverviewEntriesFromActivity,
  buildFriendsById,
  buildFriendsWorkspaceIndexes,
  friendActivitySourceKey,
  friendFromPersonWithIndexes,
} from "./friends-workspace";
import {
  buildVisibleFriendsFallbackItems,
  createLibraryFriendsGraphRequest,
} from "./friends-library-read-model";

function feedItem(id: string, authorId: string, publishedAt: number): FeedItem {
  return {
    globalId: id,
    platform: "instagram",
    contentType: "post",
    capturedAt: publishedAt,
    publishedAt,
    author: {
      id: authorId,
      handle: authorId,
      displayName: authorId,
    },
    content: { text: "", mediaUrls: [], mediaTypes: [] },
    topics: [],
    userState: { hidden: false, saved: false, archived: false, tags: [] },
  };
}

describe("Friends workspace indexes", () => {
  it("builds friends and overview rows without repeated global scans", () => {
    const now = 10_000;
    const ada: Person = {
      id: "ada",
      name: "Ada Lovelace",
      relationshipStatus: "friend",
      careLevel: 5,
      createdAt: now,
      updatedAt: now,
    };
    const maya: Person = {
      id: "maya",
      name: "Maya Angelou",
      relationshipStatus: "friend",
      careLevel: 3,
      createdAt: now,
      updatedAt: now,
    };
    const accounts: Record<string, Account> = {
      "ada-ig": {
        id: "ada-ig",
        personId: ada.id,
        kind: "social",
        provider: "instagram",
        externalId: "ada",
        handle: "ada",
        displayName: "Ada",
        firstSeenAt: now,
        lastSeenAt: now,
        discoveredFrom: "captured_item",
        createdAt: now,
        updatedAt: now,
      },
      "ada-contact": {
        id: "ada-contact",
        personId: ada.id,
        kind: "contact",
        provider: "google_contacts",
        externalId: "people/ada",
        displayName: "Ada L.",
        email: "ada@example.com",
        importedAt: now,
        firstSeenAt: now,
        lastSeenAt: now,
        discoveredFrom: "contact_import",
        createdAt: now,
        updatedAt: now,
      },
      "maya-ig": {
        id: "maya-ig",
        personId: maya.id,
        kind: "social",
        provider: "instagram",
        externalId: "maya",
        handle: "maya",
        displayName: "Maya",
        firstSeenAt: now,
        lastSeenAt: now,
        discoveredFrom: "captured_item",
        createdAt: now,
        updatedAt: now,
      },
    };
    const feedItems: Record<string, FeedItem> = {
      "older-ada": feedItem("older-ada", "ada", now - 2_000),
      "newer-ada": feedItem("newer-ada", "ada", now - 100),
      "maya-post": feedItem("maya-post", "maya", now - 500),
    };

    const indexes = buildFriendsWorkspaceIndexes(accounts, feedItems);
    const adaFriend = friendFromPersonWithIndexes(ada, indexes);
    const friendsById = buildFriendsById([ada, maya], indexes);
    const overview = buildFriendOverviewEntries(friendsById, feedItems, {
      indexes,
      now,
    });

    expect(adaFriend.sources).toHaveLength(1);
    expect(adaFriend.contact?.email).toBe("ada@example.com");
    expect(
      overview.find((entry) => entry.friend.id === "ada")?.avatarUrlCandidates,
    ).toEqual([]);
    expect(
      overview.find((entry) => entry.friend.id === "ada")?.lastPostAt,
    ).toBe(now - 100);
    expect(
      overview.find((entry) => entry.friend.id === "maya")?.lastPostAt,
    ).toBe(now - 500);

    const nativeOverview = buildFriendOverviewEntriesFromActivity(
      friendsById,
      {
        [friendActivitySourceKey("instagram", "ada")]: {
          avatarUrl: "https://example.com/ada.jpg",
          avatarPublishedAt: now - 100,
          avatarGlobalId: "newer-ada",
          hasLocation: true,
          latestActivityAt: now - 100,
        },
        [friendActivitySourceKey("instagram", "maya")]: {
          avatarUrl: null,
          avatarPublishedAt: null,
          avatarGlobalId: null,
          hasLocation: false,
          latestActivityAt: now - 500,
        },
      },
      now,
    );
    expect(
      nativeOverview.find((entry) => entry.friend.id === "ada"),
    ).toMatchObject({
      avatarUrlCandidates: ["https://example.com/ada.jpg"],
      hasLocation: true,
      isRecentlyActive: true,
      lastPostAt: now - 100,
    });
  });

  it("orders compact avatar evidence exactly like fallback items across sources", () => {
    const now = 10_000;
    const person: Person = {
      id: "ada",
      name: "Ada Lovelace",
      relationshipStatus: "friend",
      careLevel: 5,
      createdAt: now,
      updatedAt: now,
    };
    const accounts: Record<string, Account> = {
      instagram: {
        id: "ada-instagram",
        personId: person.id,
        kind: "social",
        provider: "instagram",
        externalId: "ada-instagram",
        firstSeenAt: now,
        lastSeenAt: now,
        discoveredFrom: "captured_item",
        createdAt: now,
        updatedAt: now,
      },
      x: {
        id: "ada-x",
        personId: person.id,
        kind: "social",
        provider: "x",
        externalId: "ada-x",
        firstSeenAt: now,
        lastSeenAt: now,
        discoveredFrom: "captured_item",
        createdAt: now,
        updatedAt: now,
      },
    };
    const instagramAvatar = {
      ...feedItem("é-avatar", "ada-instagram", now - 1_000),
      author: {
        id: "ada-instagram",
        handle: "ada-instagram",
        displayName: "Ada Instagram",
        avatarUrl: "https://example.com/instagram.jpg",
      },
    } satisfies FeedItem;
    const instagramNewerWithoutAvatar = feedItem(
      "instagram-newer",
      "ada-instagram",
      now - 100,
    );
    const xAvatar = {
      ...feedItem("z-avatar", "ada-x", now - 1_000),
      platform: "x",
      author: {
        id: "ada-x",
        handle: "ada-x",
        displayName: "Ada X",
        avatarUrl: "https://example.com/x.jpg",
      },
    } satisfies FeedItem;
    const feedItems = {
      [instagramAvatar.globalId]: instagramAvatar,
      [instagramNewerWithoutAvatar.globalId]: instagramNewerWithoutAvatar,
      [xAvatar.globalId]: xAvatar,
    };
    const indexes = buildFriendsWorkspaceIndexes(accounts, feedItems);
    const friends = buildFriendsById([person], indexes);
    const fallback = buildFriendOverviewEntries(friends, feedItems, {
      indexes,
      now,
    });
    const compact = buildFriendOverviewEntriesFromActivity(
      friends,
      {
        [friendActivitySourceKey("instagram", "ada-instagram")]: {
          avatarUrl: "https://example.com/instagram.jpg",
          avatarPublishedAt: now - 1_000,
          avatarGlobalId: "é-avatar",
          hasLocation: false,
          latestActivityAt: now - 100,
        },
        [friendActivitySourceKey("x", "ada-x")]: {
          avatarUrl: "https://example.com/x.jpg",
          avatarPublishedAt: now - 1_000,
          avatarGlobalId: "z-avatar",
          hasLocation: false,
          latestActivityAt: now - 1_000,
        },
      },
      now,
    );

    expect(compact[0]?.lastPostAt).toBe(now - 100);
    expect(compact[0]?.avatarUrlCandidates).toEqual([
      "https://example.com/x.jpg",
      "https://example.com/instagram.jpg",
    ]);
    expect(compact[0]?.avatarUrlCandidates).toEqual(
      fallback[0]?.avatarUrlCandidates,
    );
  });

  it("pins the 45-day graph window and excludes only hidden fallback rows", () => {
    const now = 1_785_000_000_000;
    const archived = {
      ...feedItem("archived", "ada", now - 1),
      userState: {
        hidden: false,
        saved: false,
        archived: true,
        tags: [],
      },
    } satisfies FeedItem;
    const hidden = {
      ...feedItem("hidden", "ada", now - 2),
      userState: {
        hidden: true,
        saved: false,
        archived: false,
        tags: [],
      },
    } satisfies FeedItem;

    expect(
      Object.keys(buildVisibleFriendsFallbackItems([hidden, archived])),
    ).toEqual(["archived"]);

    const accounts: Record<string, Account> = {
      second: {
        id: "second",
        kind: "social",
        provider: "x",
        externalId: "z",
        firstSeenAt: now,
        lastSeenAt: now,
        discoveredFrom: "captured_item",
        createdAt: now,
        updatedAt: now,
      },
      first: {
        id: "first",
        kind: "social",
        provider: "instagram",
        externalId: "é ",
        firstSeenAt: now,
        lastSeenAt: now,
        discoveredFrom: "captured_item",
        createdAt: now,
        updatedAt: now,
      },
    };
    const feed: RssFeed = {
      url: " https://example.test/feed.xml ",
      title: "Exact identity feed",
      enabled: true,
      trackUnread: false,
    };
    const request = createLibraryFriendsGraphRequest(
      accounts,
      { [feed.url]: feed },
      now,
    );
    expect(request.sources).toEqual([
      { platform: "instagram", authorId: "é " },
      { platform: "x", authorId: "z" },
    ]);
    expect(request.rssFeedUrls).toEqual([" https://example.test/feed.xml "]);
    expect(request.recentWindow).toEqual({
      startMs: now - 45 * 24 * 60 * 60 * 1_000,
      endMs: now,
    });
  });
});
