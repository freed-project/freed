import { describe, expect, it } from "vitest";
import type { Account, FeedItem, Person } from "@freed/shared";
import {
  buildFriendOverviewEntries,
  buildFriendsById,
  buildFriendsWorkspaceIndexes,
  friendFromPersonWithIndexes,
} from "./friends-workspace";

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
    const overview = buildFriendOverviewEntries(friendsById, feedItems, { indexes, now });

    expect(adaFriend.sources).toHaveLength(1);
    expect(adaFriend.contact?.email).toBe("ada@example.com");
    expect(overview.find((entry) => entry.friend.id === "ada")?.items.map((item) => item.globalId)).toEqual([
      "newer-ada",
      "older-ada",
    ]);
    expect(overview.find((entry) => entry.friend.id === "ada")?.lastPostAt).toBe(now - 100);
    expect(overview.find((entry) => entry.friend.id === "maya")?.lastPostAt).toBe(now - 500);
  });
});
