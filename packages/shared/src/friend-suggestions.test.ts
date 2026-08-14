import { describe, expect, it } from "vitest";
import type { Account, FeedItem, Person } from "./types.js";
import {
  buildFriendCandidateSuggestions,
  buildFriendCandidateSuggestionsFromActivity,
  friendCandidateActivitySourceKey,
  type FriendCandidateActivityAggregate,
} from "./friend-suggestions.js";

const now = 1_785_000_000_000;

function account(overrides: Partial<Account>): Account {
  return {
    id: "social:x:ada",
    kind: "social",
    provider: "x",
    externalId: "ada",
    displayName: "Ada Lovelace",
    firstSeenAt: now - 10_000,
    lastSeenAt: now - 1_000,
    discoveredFrom: "follow_roster",
    createdAt: now - 10_000,
    updatedAt: now - 1_000,
    ...overrides,
  };
}

function item(
  globalId: string,
  platform: FeedItem["platform"],
  authorId: string,
  publishedAt: number,
  tags: NonNullable<FeedItem["contentSignals"]>["tags"],
): FeedItem {
  return {
    globalId,
    platform,
    contentType: "post",
    capturedAt: publishedAt,
    publishedAt,
    author: { id: authorId, handle: "ada", displayName: "Ada Lovelace" },
    content: { mediaUrls: [], mediaTypes: [] },
    contentSignals: {
      version: 1,
      method: "rules",
      inferredAt: publishedAt,
      scores: {},
      tags,
    },
    userState: { hidden: false, saved: false, archived: false, tags: [] },
    topics: [],
  };
}

describe("Friends candidate activity aggregates", () => {
  it("preserves the item-backed suggestion contract without retaining the corpus", () => {
    const person: Person = {
      id: "person:ada",
      name: "Ada Lovelace",
      relationshipStatus: "connection",
      careLevel: 3,
      createdAt: now - 20_000,
      updatedAt: now - 1_000,
    };
    const x = account({ personId: person.id });
    const instagram = account({
      id: "social:instagram:ada",
      personId: person.id,
      provider: "instagram",
      externalId: "ada-ig",
    });
    const accounts = { [x.id]: x, [instagram.id]: instagram };
    const items = [
      item("x:older", "x", x.externalId, now - 2_000, ["discussion"]),
      item("instagram:latest", "instagram", instagram.externalId, now - 500, ["event"]),
      item("x:latest", "x", x.externalId, now - 1_000, ["life_update", "moment"]),
    ];
    const activityBySourceKey: Record<string, FriendCandidateActivityAggregate> = {
      [friendCandidateActivitySourceKey("x", "ada")]: {
        itemCount: 2,
        latestActivityAt: now - 1_000,
        recentCount: 2,
        sampleItemIds: ["x:latest", "x:older"],
        signalCounts: { discussion: 1, life_update: 1, moment: 1 },
      },
      [friendCandidateActivitySourceKey("instagram", "ada-ig")]: {
        itemCount: 1,
        latestActivityAt: now - 500,
        recentCount: 1,
        sampleItemIds: ["instagram:latest"],
        signalCounts: { event: 1 },
      },
    };

    const itemBacked = buildFriendCandidateSuggestions({
      persons: [person],
      accounts,
      feedItems: items,
      now,
    });
    const aggregateBacked = buildFriendCandidateSuggestionsFromActivity({
      persons: [person],
      accounts,
      activityBySourceKey,
    });

    expect(aggregateBacked).toEqual(itemBacked);
  });

  it("keeps same-timestamp non-ASCII evidence in UTF-8 binary order", () => {
    expect(friendCandidateActivitySourceKey("x", "ada:west")).not.toBe(
      friendCandidateActivitySourceKey("x:ada", "west"),
    );
    const x = account({});
    const accounts = { [x.id]: x };
    const tags = ["life_update", "moment", "event", "request"] as const;
    const items = [
      item("é", "x", x.externalId, now - 1_000, [...tags]),
      item("z", "x", x.externalId, now - 1_000, [...tags]),
    ];
    const itemBacked = buildFriendCandidateSuggestions({
      persons: [],
      accounts,
      feedItems: items,
      now,
    });
    const aggregateBacked = buildFriendCandidateSuggestionsFromActivity({
      persons: [],
      accounts,
      activityBySourceKey: {
        [friendCandidateActivitySourceKey("x", x.externalId)]: {
          itemCount: 2,
          latestActivityAt: now - 1_000,
          recentCount: 2,
          sampleItemIds: ["z", "é"],
          signalCounts: {
            event: 2,
            life_update: 2,
            moment: 2,
            request: 2,
          },
        },
      },
    });

    expect(itemBacked[0]?.sampleItemIds).toEqual(["z", "é"]);
    expect(aggregateBacked).toEqual(itemBacked);
  });
});
