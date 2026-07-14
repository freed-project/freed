import { describe, expect, it } from "vitest";
import { createDefaultPreferences } from "@freed/shared";
import {
  projectArchiveItems,
  projectMarkItemsAsRead,
  projectRemoveItem,
  projectRenameFeed,
  projectToggleArchived,
  projectToggleLiked,
  projectToggleSaved,
  projectUpdateAccount,
  projectUpdateItem,
  projectUpdatePerson,
  projectUpdatePreferences,
  rollbackOptimisticPatch,
} from "@freed/shared/optimistic-state";
import type {
  Account,
  FeedItem,
  Friend,
  Person,
  RssFeed,
  UserPreferences,
} from "@freed/shared";

function makeItem(id: string, state: Partial<FeedItem["userState"]> = {}): FeedItem {
  return {
    globalId: id,
    platform: "x",
    contentType: "post",
    capturedAt: 1,
    publishedAt: 1,
    author: {
      id: "author",
      handle: "author",
      displayName: "Author",
    },
    content: {
      text: id,
      mediaUrls: [],
      mediaTypes: [],
    },
    topics: [],
    userState: {
      hidden: false,
      saved: false,
      archived: false,
      tags: [],
      ...state,
    },
  };
}

function makePerson(id: string): Person {
  return {
    id,
    name: "Original",
    relationshipStatus: "friend",
    careLevel: 3,
    createdAt: 1,
    updatedAt: 1,
  };
}

function makeAccount(id: string): Account {
  return {
    id,
    kind: "social",
    provider: "x",
    externalId: id,
    handle: "original",
    firstSeenAt: 1,
    lastSeenAt: 1,
    discoveredFrom: "captured_item",
    createdAt: 1,
    updatedAt: 1,
  };
}

describe("optimistic state projections", () => {
  it("toggles saved state and clears archive state immediately", () => {
    const item = makeItem("item", { archived: true, archivedAt: 10 });
    const patch = projectToggleSaved({ items: [item] }, "item", 20);

    expect(patch?.items?.[0].userState.saved).toBe(true);
    expect(patch?.items?.[0].userState.savedAt).toBe(20);
    expect(patch?.items?.[0].userState.archived).toBe(false);
    expect(patch?.items?.[0].userState.archivedAt).toBeUndefined();
  });

  it("archives and unarchives unsaved items immediately", () => {
    const item = makeItem("item");
    const archived = projectToggleArchived({ items: [item] }, "item", 30);
    const unarchived = projectToggleArchived({ items: archived!.items! }, "item", 40);

    expect(archived?.items?.[0].userState.archived).toBe(true);
    expect(archived?.items?.[0].userState.archivedAt).toBe(30);
    expect(unarchived?.items?.[0].userState.archived).toBe(false);
    expect(unarchived?.items?.[0].userState.archivedAt).toBeUndefined();
  });

  it("does not archive saved items", () => {
    const patch = projectToggleArchived({ items: [makeItem("item", { saved: true })] }, "item", 30);

    expect(patch).toBeNull();
  });

  it("toggles like intent and clears stale sync failure state", () => {
    const item = makeItem("item", { likedSyncedAt: -1 });
    const patch = projectToggleLiked({ items: [item] }, "item", 50);

    expect(patch?.items?.[0].userState.liked).toBe(true);
    expect(patch?.items?.[0].userState.likedAt).toBe(50);
    expect(patch?.items?.[0].userState.likedSyncedAt).toBeUndefined();
  });

  it("marks specific items read without touching other items", () => {
    const patch = projectMarkItemsAsRead(
      { items: [makeItem("target"), makeItem("other")] },
      ["target"],
      60,
    );

    expect(patch?.items?.[0].userState.readAt).toBe(60);
    expect(patch?.items?.[1].userState.readAt).toBeUndefined();
  });

  it("archives only read visible unsaved items in a requested set", () => {
    const patch = projectArchiveItems(
      {
        items: [
          makeItem("target", { readAt: 1 }),
          makeItem("unread"),
          makeItem("saved", { readAt: 1, saved: true }),
        ],
      },
      ["target", "unread", "saved"],
      70,
    );

    expect(patch?.items?.[0].userState.archived).toBe(true);
    expect(patch?.items?.[0].userState.archivedAt).toBe(70);
    expect(patch?.items?.[1].userState.archived).toBe(false);
    expect(patch?.items?.[2].userState.archived).toBe(false);
  });

  it("removes a visible item from the projected list", () => {
    const patch = projectRemoveItem({ items: [makeItem("target"), makeItem("other")] }, "target");

    expect(patch?.items?.map((item) => item.globalId)).toEqual(["other"]);
  });

  it("updates item, feed, person, account, and preference slices", () => {
    const feed: RssFeed = {
      url: "https://example.com/feed.xml",
      title: "Old",
      enabled: true,
      trackUnread: true,
    };
    const person = makePerson("person");
    const friend = { ...person, sources: [] } satisfies Friend;
    const account = makeAccount("account");
    const preferences: UserPreferences = createDefaultPreferences();

    expect(projectUpdateItem({ items: [makeItem("item")] }, "item", { content: { text: "Next", mediaUrls: [], mediaTypes: [] } })?.items?.[0].content.text).toBe("Next");
    expect(projectRenameFeed({ feeds: { [feed.url]: feed } }, feed.url, "New")?.feeds?.[feed.url].title).toBe("New");
    expect(projectUpdatePerson({ persons: { person }, friends: { person: friend } }, "person", { name: "New" }, 80)?.persons?.person.name).toBe("New");
    expect(projectUpdateAccount({ accounts: { account } }, "account", { handle: "new" }, 90)?.accounts?.account.handle).toBe("new");
    expect(projectUpdatePreferences(
      { preferences },
      { display: { ...preferences.display, showEngagementCounts: true } },
    )?.preferences?.display.showEngagementCounts).toBe(true);
  });

  it("rolls back only slices that still match the failed projection", () => {
    const before = { items: [makeItem("before")] };
    const projected = { items: [makeItem("projected")], feeds: {} };
    const current = {
      items: projected.items,
      feeds: { later: { url: "later", title: "Later", enabled: true, trackUnread: true } },
      persons: {},
      accounts: {},
      friends: {},
      preferences: createDefaultPreferences(),
    };

    const rollback = rollbackOptimisticPatch(current, before, projected);

    expect(rollback?.items).toBe(before.items);
    expect(rollback?.feeds).toBeUndefined();
  });
});
