import { describe, expect, it } from "vitest";
import type { Account, ContentSignal, FeedItem, Person } from "@freed/shared";
import { buildFriendCandidateSuggestions } from "@freed/shared";

const NOW = Date.UTC(2026, 4, 2);

function person(id: string, name: string, relationshipStatus: Person["relationshipStatus"] = "connection"): Person {
  return {
    id,
    name,
    relationshipStatus,
    careLevel: relationshipStatus === "friend" ? 3 : 2,
    createdAt: NOW,
    updatedAt: NOW,
  };
}

function account(
  id: string,
  displayName: string,
  externalId: string,
  personId?: string,
  provider: Account["provider"] = "instagram",
): Account {
  return {
    id,
    personId,
    kind: "social",
    provider,
    externalId,
    handle: displayName.toLowerCase().replace(/\s+/g, ""),
    displayName,
    firstSeenAt: NOW,
    lastSeenAt: NOW,
    discoveredFrom: "captured_item",
    createdAt: NOW,
    updatedAt: NOW,
  };
}

function item(id: string, authorId: string, signals: ContentSignal[], publishedAt = NOW - 60_000): FeedItem {
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
    content: {
      text: "Short update",
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
    contentSignals: {
      version: 3,
      method: "rules",
      inferredAt: publishedAt,
      scores: Object.fromEntries(signals.map((signal) => [signal, 1])),
      tags: signals,
    },
  };
}

describe("buildFriendCandidateSuggestions", () => {
  it("ranks a connection with repeated personal posts as high confidence", () => {
    const suggestions = buildFriendCandidateSuggestions({
      persons: [person("person-maya", "Maya Chen")],
      accounts: {
        "social:instagram:maya": account("social:instagram:maya", "Maya Chen", "maya", "person-maya"),
      },
      feedItems: [
        item("instagram:maya:1", "maya", ["life_update", "moment"]),
        item("instagram:maya:2", "maya", ["life_update", "place"]),
        item("instagram:maya:3", "maya", ["request", "discussion"]),
      ],
      now: NOW,
    });

    expect(suggestions).toHaveLength(1);
    expect(suggestions[0]).toMatchObject({
      kind: "connection_person",
      personId: "person-maya",
      displayName: "Maya Chen",
      confidence: "high",
    });
    expect(suggestions[0].score).toBeGreaterThanOrEqual(80);
    expect(suggestions[0].reasons.map((reason) => reason.code)).toContain("personal_updates");
  });

  it("hides news, promotion, RSS-only, and organization-like accounts", () => {
    const suggestions = buildFriendCandidateSuggestions({
      persons: [],
      accounts: {
        "social:instagram:daily": account("social:instagram:daily", "Daily Product News", "daily"),
        "social:x:shop": account("social:x:shop", "Deal Shop Official", "shop", undefined, "x"),
        "social:rss:feed": account("social:rss:feed", "Personal Journal Feed", "feed", undefined, "rss"),
      },
      feedItems: [
        item("instagram:daily:1", "daily", ["news", "product_update"]),
        { ...item("x:shop:1", "shop", ["promotion", "deal"]), platform: "x" },
        { ...item("rss:feed:1", "feed", ["life_update", "moment"]), platform: "rss" },
      ],
      now: NOW,
    });

    expect(suggestions).toEqual([]);
  });

  it("hides Facebook UI chrome accounts", () => {
    const suggestions = buildFriendCandidateSuggestions({
      persons: [],
      accounts: {
        "social:facebook:unknown": {
          ...account("social:facebook:unknown", "Create New Account", "unknown", undefined, "facebook"),
          profileUrl: "https://www.facebook.com/r.php",
        },
        "social:facebook:bookmarks": {
          ...account("social:facebook:bookmarks", "Your Shortcuts", "bookmarks", undefined, "facebook"),
          profileUrl: "https://www.facebook.com/bookmarks",
        },
      },
      feedItems: [
        { ...item("facebook:unknown:1", "unknown", ["life_update", "moment"]), platform: "facebook" },
        { ...item("facebook:bookmarks:1", "bookmarks", ["life_update", "place"]), platform: "facebook" },
      ],
      now: NOW,
    });

    expect(suggestions).toEqual([]);
  });

  it("does not suggest publication-only Substack accounts as friends", () => {
    const publication = {
      ...account(
        "social:substack:systems-thinking",
        "Systems Thinking",
        "https://systems-thinking.substack.com/",
        undefined,
        "substack",
      ),
      profileUrl: "https://systems-thinking.substack.com/",
      followRosterRoles: ["subscription" as const],
    };
    const publicationItem = {
      ...item(
        "substack:essay:systems-thinking",
        publication.externalId,
        ["life_update", "moment", "discussion"],
      ),
      platform: "substack" as const,
    };

    const suggestions = buildFriendCandidateSuggestions({
      persons: [],
      accounts: { [publication.id]: publication },
      feedItems: [publicationItem],
      now: NOW,
    });

    expect(suggestions).toEqual([]);
  });

  it("orders deterministically and keeps ids stable", () => {
    const input = {
      persons: [
        person("person-nora", "Nora Reed"),
        person("person-oliver", "Oliver Stone"),
      ],
      accounts: {
        "social:instagram:nora": account("social:instagram:nora", "Nora Reed", "nora", "person-nora"),
        "social:instagram:oliver": account("social:instagram:oliver", "Oliver Stone", "oliver", "person-oliver"),
      },
      feedItems: [
        item("instagram:nora:1", "nora", ["life_update", "moment"]),
        item("instagram:nora:2", "nora", ["place", "request"]),
        item("instagram:oliver:1", "oliver", ["life_update", "moment"]),
        item("instagram:oliver:2", "oliver", ["place", "request"]),
      ],
      now: NOW,
    };

    const first = buildFriendCandidateSuggestions(input);
    const second = buildFriendCandidateSuggestions(input);

    expect(first.map((suggestion) => suggestion.id)).toEqual(second.map((suggestion) => suggestion.id));
    expect(first.map((suggestion) => suggestion.displayName)).toEqual(["Nora Reed", "Oliver Stone"]);
  });

  it("keeps dismissed suggestions hidden until evidence changes", () => {
    const base = {
      persons: [person("person-zoe", "Zoe Park")],
      accounts: {
        "social:instagram:zoe": account("social:instagram:zoe", "Zoe Park", "zoe", "person-zoe"),
      },
      feedItems: [
        item("instagram:zoe:1", "zoe", ["life_update", "moment"]),
        item("instagram:zoe:2", "zoe", ["place", "request"]),
      ],
      now: NOW,
    };
    const original = buildFriendCandidateSuggestions(base);

    expect(original).toHaveLength(1);
    expect(buildFriendCandidateSuggestions({
      ...base,
      preferences: { dismissedSuggestionIds: [original[0].id] },
    })).toEqual([]);

    const changed = buildFriendCandidateSuggestions({
      ...base,
      feedItems: [
        ...base.feedItems,
        item("instagram:zoe:3", "zoe", ["life_update", "discussion"]),
      ],
      preferences: { dismissedSuggestionIds: [original[0].id] },
    });

    expect(changed).toHaveLength(1);
    expect(changed[0].id).not.toBe(original[0].id);
  });

  it("uses deterministic rule-based signals without AI state", () => {
    const suggestions = buildFriendCandidateSuggestions({
      persons: [],
      accounts: {
        "social:instagram:ida": account("social:instagram:ida", "Ida Wells", "ida"),
      },
      feedItems: [
        item("instagram:ida:1", "ida", ["life_update", "moment"]),
        item("instagram:ida:2", "ida", ["event", "place"]),
        item("instagram:ida:3", "ida", ["recommendation", "discussion"]),
      ],
      now: NOW,
    });

    expect(suggestions).toHaveLength(1);
    expect(suggestions[0]).toMatchObject({
      kind: "unlinked_account",
      accountIds: ["social:instagram:ida"],
      displayName: "Ida Wells",
    });
  });
});
