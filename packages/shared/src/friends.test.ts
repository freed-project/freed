import { describe, expect, it } from "vitest";
import type { Account, FeedItem, Friend, Person } from "./types.js";
import {
  buildDiscoveredAccountsFromItems,
  compileFriendAuthorIndex,
  isFriendAuthoredItem,
} from "./friends.js";

function item(overrides: Partial<FeedItem> = {}): FeedItem {
  return {
    globalId: "substack:essay:one",
    platform: "substack",
    contentType: "article",
    capturedAt: 1,
    publishedAt: 1,
    author: {
      id: "https://writer.substack.com/",
      handle: "writer",
      displayName: "Writer",
    },
    content: { mediaUrls: [], mediaTypes: [] },
    userState: { hidden: false, saved: false, archived: false, tags: [] },
    topics: [],
    ...overrides,
  };
}

function person(
  id: string,
  relationshipStatus: Person["relationshipStatus"],
): Person {
  return {
    id,
    name: id,
    relationshipStatus,
    careLevel: 3,
    createdAt: 1,
    updatedAt: 1,
  };
}

function account(
  id: string,
  externalId: string,
  personId?: string,
): Account {
  return {
    id,
    ...(personId ? { personId } : {}),
    kind: "social",
    provider: "x",
    externalId,
    firstSeenAt: 1,
    lastSeenAt: 1,
    discoveredFrom: "captured_item",
    createdAt: 1,
    updatedAt: 1,
  };
}

function legacyFriend(id: string, authorId: string): Friend {
  return {
    ...person(id, "friend"),
    sources: [{ platform: "x", authorId }],
  };
}

describe("discovered essay author accounts", () => {
  it("preserves a Substack publication profile URL", () => {
    const accounts = buildDiscoveredAccountsFromItems([item()], {});

    expect(accounts).toEqual([
      expect.objectContaining({ profileUrl: "https://writer.substack.com/" }),
    ]);
  });

  it("preserves a Medium profile identity", () => {
    const accounts = buildDiscoveredAccountsFromItems([
      item({
        globalId: "medium:story:one",
        platform: "medium",
        author: {
          id: "https://medium.com/@ada",
          handle: "ada",
          displayName: "Ada",
        },
      }),
    ], {});

    expect(accounts).toEqual([
      expect.objectContaining({ profileUrl: "https://medium.com/@ada" }),
    ]);
  });

  it("does not create one shared account for unknown authors", () => {
    expect(buildDiscoveredAccountsFromItems([
      item({ author: { id: "unknown", handle: "unknown", displayName: "unknown" } }),
    ], {})).toEqual([]);
  });

  it("waits for a real Medium profile before creating a custom domain connection", () => {
    expect(buildDiscoveredAccountsFromItems([
      item({
        globalId: "medium:story:custom",
        platform: "medium",
        author: {
          id: "https://essays.example.com/feed",
          handle: "Ada Lovelace",
          displayName: "Ada Lovelace",
        },
      }),
    ], {})).toEqual([]);
  });
});

describe("compiled Friends author index", () => {
  it("preserves Person-first decisions and legacy fallback", () => {
    const persons = {
      friend: person("friend", "friend"),
      connection: person("connection", "connection"),
    };
    const accounts = {
      linkedFriend: account("linked-friend", "friend-author", "friend"),
      linkedConnection: account(
        "linked-connection",
        "legacy-shadowed",
        "connection",
      ),
      unlinked: account("unlinked", "legacy-unlinked"),
      missingPerson: account("missing", "legacy-missing", "absent"),
    };
    const friends = {
      legacyOnly: legacyFriend("legacy-only", "legacy-only"),
      shadowed: legacyFriend("shadowed", "legacy-shadowed"),
      unlinked: legacyFriend("legacy-unlinked", "legacy-unlinked"),
      missing: legacyFriend("legacy-missing", "legacy-missing"),
    };
    const index = compileFriendAuthorIndex(persons, accounts, friends);

    expect(index.has("x", "friend-author")).toBe(true);
    expect(index.has("x", "legacy-shadowed")).toBe(false);
    expect(index.has("x", "legacy-unlinked")).toBe(true);
    expect(index.has("x", "legacy-missing")).toBe(true);
    expect(index.has("x", "legacy-only")).toBe(true);
    expect(index.has("x", "unknown")).toBe(false);
  });

  it("lets the first duplicate social Account own the decision", () => {
    const persons = {
      friend: person("friend", "friend"),
      connection: person("connection", "connection"),
    };

    expect(compileFriendAuthorIndex(persons, {
      first: account("first", "duplicate", "connection"),
      second: account("second", "duplicate", "friend"),
    }, {}).has("x", "duplicate")).toBe(false);

    expect(compileFriendAuthorIndex(persons, {
      first: account("first", "duplicate", "friend"),
      second: account("second", "duplicate", "connection"),
    }, {}).has("x", "duplicate")).toBe(true);
  });

  it("ignores later duplicates after the first Account falls back", () => {
    const persons = { friend: person("friend", "friend") };
    const accounts = {
      first: account("first", "duplicate"),
      second: account("second", "duplicate", "friend"),
    };
    const friends = {
      legacy: legacyFriend("legacy", "duplicate"),
    };

    expect(
      compileFriendAuthorIndex(persons, accounts, friends).has(
        "x",
        "duplicate",
      ),
    ).toBe(true);
  });

  it("matches the row predicate across Person, duplicate, and legacy cases", () => {
    const persons = {
      friend: person("friend", "friend"),
      connection: person("connection", "connection"),
    };
    const accounts = {
      friend: account("friend", "friend-author", "friend"),
      duplicateFirst: account("duplicate-first", "duplicate", "connection"),
      duplicateSecond: account("duplicate-second", "duplicate", "friend"),
      unlinked: account("unlinked", "legacy-author"),
      contact: {
        ...account("contact", "contact-author", "friend"),
        kind: "contact" as const,
        provider: "manual_contact" as const,
      },
    };
    const friends = {
      duplicate: legacyFriend("duplicate", "duplicate"),
      legacy: legacyFriend("legacy", "legacy-author"),
    };
    const index = compileFriendAuthorIndex(persons, accounts, friends);

    for (const authorId of [
      "friend-author",
      "duplicate",
      "legacy-author",
      "contact-author",
      "unknown",
    ]) {
      const authoredItem = item({
        globalId: `x:${authorId}`,
        platform: "x",
        author: { id: authorId, handle: authorId, displayName: authorId },
      });
      expect(index.has("x", authorId)).toBe(
        isFriendAuthoredItem(authoredItem, persons, accounts, friends),
      );
    }
  });
});
