import { describe, expect, it } from "vitest";
import type { Account, FeedItem, Person, RssFeed } from "@freed/shared";
import { buildIdentityGraphModel } from "./identity-graph-model";

describe("buildIdentityGraphModel avatars", () => {
  it("carries avatar URLs and fallback initials for people, accounts, and feeds", () => {
    const person: Person = {
      id: "person-1",
      name: "Lotus Alchemist",
      relationshipStatus: "friend",
      careLevel: 3,
      avatarUrl: "https://example.com/person.jpg",
      createdAt: 1,
      updatedAt: 1,
    };
    const account: Account = {
      id: "account-1",
      kind: "social",
      provider: "instagram",
      externalId: "ig:lotus.alchemist",
      handle: "lotus.alchemist",
      displayName: "Lotus Alchemist",
      avatarUrl: "https://example.com/account.jpg",
      personId: person.id,
      firstSeenAt: 1,
      lastSeenAt: 1,
      discoveredFrom: "captured_item",
      createdAt: 1,
      updatedAt: 1,
    };
    const feed: RssFeed = {
      url: "https://example.com/feed.xml",
      title: "Lotus Dispatch",
      imageUrl: "https://example.com/feed.jpg",
      enabled: true,
    };
    const feedItem: FeedItem = {
      globalId: "ig:1",
      platform: "instagram",
      contentType: "post",
      capturedAt: 1,
      publishedAt: 1,
      author: {
        id: account.externalId,
        handle: "lotus.alchemist",
        displayName: "Lotus Alchemist",
      },
      content: { mediaUrls: [], mediaTypes: [] },
      topics: [],
      userState: { hidden: false, saved: false, archived: false, tags: [] },
    };

    const model = buildIdentityGraphModel({
      persons: [person],
      accounts: { [account.id]: account },
      feeds: { [feed.url]: feed },
      feedItems: { [feedItem.globalId]: feedItem },
      mode: "all_content",
    });

    expect(model.nodes.find((node) => node.id === "person:person-1")).toMatchObject({
      avatarUrl: "https://example.com/person.jpg",
      initials: "LA",
    });
    expect(model.nodes.find((node) => node.id === "account:account-1")).toMatchObject({
      avatarUrl: "https://example.com/account.jpg",
      initials: "L",
    });
    expect(model.nodes.find((node) => node.id === `feed:${feed.url}`)).toMatchObject({
      avatarUrl: "https://example.com/feed.jpg",
      initials: "L",
    });
  });
});
