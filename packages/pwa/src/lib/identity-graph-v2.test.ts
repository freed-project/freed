import { describe, expect, it } from "vitest";
import type { Account, FeedItem, Person, RssFeed } from "@freed/shared";
import { buildProvisionalPersonCandidates } from "@freed/shared";
import {
  nudgeOverlapsBucketed,
  buildIdentityGraphLayout,
} from "../../../ui/src/lib/identity-graph-layout";
import {
  buildIdentityGraphActivityIndex,
  buildIdentityGraphModel,
  createIdentityGraphModelSignature,
} from "../../../ui/src/lib/identity-graph-model";
import { shouldShowGraphLabel } from "../../../ui/src/lib/identity-graph-render";

const NOW = 1_717_000_000_000;

function createPerson(overrides: Partial<Person>): Person {
  return {
    id: "person-1",
    name: "Ada Lovelace",
    relationshipStatus: "friend",
    careLevel: 4,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

function createAccount(overrides: Partial<Account>): Account {
  return {
    id: "account-1",
    kind: "social",
    provider: "instagram",
    externalId: "ada-ig",
    displayName: "Ada Lovelace",
    firstSeenAt: NOW,
    lastSeenAt: NOW,
    discoveredFrom: "captured_item",
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

function createFeedItem(overrides: Partial<FeedItem>): FeedItem {
  return {
    globalId: "item-1",
    platform: "instagram",
    contentType: "post",
    capturedAt: NOW,
    publishedAt: NOW,
    author: {
      id: "ada-ig",
      handle: "ada",
      displayName: "Ada Lovelace",
    },
    content: {
      text: "Hello world",
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
  } as FeedItem;
}

describe("identity graph v2 model", () => {
  it("indexes social and rss activity in one pass", () => {
    const accounts = {
      "account-ada-ig": createAccount({
        id: "account-ada-ig",
        personId: "friend-ada",
        provider: "instagram",
        externalId: "ada-ig",
      }),
      "account-grace-li": createAccount({
        id: "account-grace-li",
        personId: "friend-grace",
        provider: "linkedin",
        externalId: "grace-li",
        displayName: "Grace Hopper",
      }),
    };
    const feedItems = {
      "item-1": createFeedItem({
        globalId: "item-1",
        platform: "instagram",
        author: { id: "ada-ig", handle: "ada", displayName: "Ada Lovelace" },
      }),
      "item-2": createFeedItem({
        globalId: "item-2",
        platform: "instagram",
        author: { id: "ada-ig", handle: "ada", displayName: "Ada Lovelace" },
      }),
      "item-3": createFeedItem({
        globalId: "item-3",
        platform: "linkedin",
        author: { id: "grace-li", handle: "grace", displayName: "Grace Hopper" },
      }),
      "item-rss": createFeedItem({
        globalId: "item-rss",
        platform: "rss",
        contentType: "article",
        author: { id: "feed-author", handle: "feed-author", displayName: "Feed Author" },
        rssSource: { feedUrl: "https://example.com/feed.xml", feedTitle: "Example Feed" },
      }),
    };

    const activityIndex = buildIdentityGraphActivityIndex(accounts, feedItems);

    expect(activityIndex.socialCounts.get("instagram:ada-ig")).toBe(2);
    expect(activityIndex.socialCounts.get("linkedin:grace-li")).toBe(1);
    expect(activityIndex.rssCounts.get("https://example.com/feed.xml")).toBe(1);
    expect(activityIndex.linkedAccountCounts.get("friend-ada")).toBe(1);
    expect(activityIndex.linkedAccountCounts.get("friend-grace")).toBe(1);
  });

  it("derives person, account, and feed nodes in all-content mode", () => {
    const persons = [
      createPerson({ id: "friend-ada", name: "Ada Lovelace", relationshipStatus: "friend" }),
      createPerson({ id: "connection-grace", name: "Grace Hopper", relationshipStatus: "connection", careLevel: 2 }),
    ];
    const accounts = {
      "account-ada-ig": createAccount({ id: "account-ada-ig", personId: "friend-ada", provider: "instagram", externalId: "ada-ig" }),
      "account-grace-li": createAccount({ id: "account-grace-li", personId: "connection-grace", provider: "linkedin", externalId: "grace-li", displayName: "Grace Hopper" }),
      "account-paper": createAccount({ id: "account-paper", provider: "x", externalId: "journal-paper", displayName: "Systems Journal" }),
    };
    const feeds: Record<string, RssFeed> = {
      "https://example.com/feed.xml": {
        url: "https://example.com/feed.xml",
        title: "Example Feed",
        enabled: true,
        trackUnread: true,
      },
    };
    const feedItems = {
      "item-ada": createFeedItem({ globalId: "item-ada", author: { id: "ada-ig", handle: "ada", displayName: "Ada Lovelace" } }),
      "item-feed": createFeedItem({
        globalId: "item-feed",
        platform: "rss",
        contentType: "article",
        author: { id: "feed-author", handle: "feed-author", displayName: "Feed Author" },
        rssSource: { feedUrl: "https://example.com/feed.xml", feedTitle: "Example Feed" },
      }),
    };

    const model = buildIdentityGraphModel({
      persons,
      accounts,
      feeds,
      feedItems,
      mode: "all_content",
    });

    expect(model.nodes.map((node) => node.kind)).toEqual(
      expect.arrayContaining(["friend_person", "connection_person", "account", "feed"]),
    );
    expect(model.nodes.find((node) => node.feedUrl === "https://example.com/feed.xml")).toBeTruthy();
    expect(model.edges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sourceId: "person:friend-ada",
          targetId: "account:account-ada-ig",
        }),
        expect.objectContaining({
          sourceId: "person:connection-grace",
          targetId: "account:account-grace-li",
        }),
      ]),
    );
  });

  it("moves edges when an account is re-linked to a different identity", () => {
    const persons = [
      createPerson({ id: "friend-ada", name: "Ada Lovelace", relationshipStatus: "friend" }),
      createPerson({ id: "friend-grace", name: "Grace Hopper", relationshipStatus: "friend" }),
    ];
    const accounts = {
      "account-shared": createAccount({ id: "account-shared", personId: "friend-ada", externalId: "shared-author" }),
    };

    const firstModel = buildIdentityGraphModel({
      persons,
      accounts,
      feeds: {},
      feedItems: {},
      mode: "all_content",
    });
    expect(firstModel.edges).toEqual([
      expect.objectContaining({
        sourceId: "person:friend-ada",
        targetId: "account:account-shared",
      }),
    ]);

    const movedModel = buildIdentityGraphModel({
      persons,
      accounts: {
        "account-shared": { ...accounts["account-shared"], personId: "friend-grace" },
      },
      feeds: {},
      feedItems: {},
      mode: "all_content",
    });
    expect(movedModel.edges).toEqual([
      expect.objectContaining({
        sourceId: "person:friend-grace",
        targetId: "account:account-shared",
      }),
    ]);
  });

  it("keeps model signatures stable when only non-graph fields change", () => {
    const persons = [
      createPerson({ id: "friend-ada", name: "Ada Lovelace", relationshipStatus: "friend" }),
    ];
    const baseAccount = createAccount({
      id: "account-ada-ig",
      personId: "friend-ada",
      provider: "instagram",
      externalId: "ada-ig",
    });
    const firstModel = buildIdentityGraphModel({
      persons,
      accounts: {
        "account-ada-ig": baseAccount,
      },
      feeds: {},
      feedItems: {},
      mode: "all_content",
    });
    const secondModel = buildIdentityGraphModel({
      persons: persons.map((person) => ({ ...person, updatedAt: person.updatedAt + 5_000 })),
      accounts: {
        "account-ada-ig": {
          ...baseAccount,
          updatedAt: baseAccount.updatedAt + 10_000,
          firstSeenAt: baseAccount.firstSeenAt + 3_000,
        },
      },
      feeds: {},
      feedItems: {},
      mode: "all_content",
    });

    expect(createIdentityGraphModelSignature(firstModel)).toBe(
      createIdentityGraphModelSignature(secondModel),
    );
  });

  it("rebuilds model and layout quickly for a large synthetic graph", () => {
    const personEntries = Array.from({ length: 180 }, (_, index) =>
      createPerson({
        id: `person-${index}`,
        name: `Person ${index}`,
        relationshipStatus: index < 120 ? "friend" : "connection",
        careLevel: index < 120 ? 3 + (index % 3) : 2,
      }),
    );
    const accountEntries = Object.fromEntries(
      Array.from({ length: 1_440 }, (_, index) => {
        const personId = index < 960 ? `person-${index % 180}` : undefined;
        return [
          `account-${index}`,
          createAccount({
            id: `account-${index}`,
            personId,
            provider: index % 3 === 0 ? "instagram" : index % 3 === 1 ? "linkedin" : "x",
            externalId: `external-${index}`,
            displayName: `Channel ${index}`,
          }),
        ];
      }),
    );
    const feeds = Object.fromEntries(
      Array.from({ length: 240 }, (_, index) => [
        `https://example.com/feed-${index}.xml`,
        {
          url: `https://example.com/feed-${index}.xml`,
          title: `Feed ${index}`,
          enabled: true,
          trackUnread: true,
        } satisfies RssFeed,
      ]),
    );
    const feedItems = Object.fromEntries(
      Array.from({ length: 3_600 }, (_, index) => [
        `item-${index}`,
        createFeedItem({
          globalId: `item-${index}`,
          platform: index % 5 === 0 ? "rss" : index % 2 === 0 ? "instagram" : "x",
          contentType: index % 5 === 0 ? "article" : "post",
          author: {
            id: index % 5 === 0 ? `feed-author-${index % 240}` : `external-${index % 1_440}`,
            handle: `handle-${index}`,
            displayName: `Author ${index}`,
          },
          rssSource:
            index % 5 === 0
              ? {
                  feedUrl: `https://example.com/feed-${index % 240}.xml`,
                  feedTitle: `Feed ${index % 240}`,
                }
              : undefined,
        }),
      ]),
    );

    const modelStart = performance.now();
    const model = buildIdentityGraphModel({
      persons: personEntries,
      accounts: accountEntries,
      feeds,
      feedItems,
      mode: "all_content",
    });
    const modelElapsedMs = performance.now() - modelStart;

    const layoutStart = performance.now();
    const layout = buildIdentityGraphLayout({
      model,
      width: 1_440,
      height: 900,
      quality: "full",
    });
    const layoutElapsedMs = performance.now() - layoutStart;

    expect(model.nodes.length).toBeGreaterThan(1_800);
    expect(layout.nodes.length).toBe(model.nodes.length);
    expect(modelElapsedMs).toBeLessThan(500);
    expect(layoutElapsedMs).toBeLessThan(500);
  });
});

describe("provisional identity candidates", () => {
  it("groups obvious human social accounts into provisional connection people", () => {
    const candidates = buildProvisionalPersonCandidates(
      {},
      {
        "account-ig": createAccount({
          id: "account-ig",
          provider: "instagram",
          externalId: "maya-ig",
          displayName: "Maya Angelou",
        }),
        "account-li": createAccount({
          id: "account-li",
          provider: "linkedin",
          externalId: "maya-li",
          displayName: "Maya Angelou",
        }),
        "account-org": createAccount({
          id: "account-org",
          provider: "x",
          externalId: "freed-news",
          displayName: "Freed News Network",
        }),
      },
      NOW,
    );

    expect(candidates).toHaveLength(1);
    expect(candidates[0]).toMatchObject({
      person: {
        name: "Maya Angelou",
        relationshipStatus: "connection",
      },
      accountIds: ["account-ig", "account-li"],
    });
  });
});

describe("identity graph v2 layout", () => {
  it("bucketed overlap nudging preserves minimum spacing", () => {
    const nodes = [
      { id: "a", kind: "friend_person", label: "A", radius: 20, labelPriority: 100, ring: 0, weight: 100, interactive: true, x: 0, y: 0 },
      { id: "b", kind: "friend_person", label: "B", radius: 20, labelPriority: 100, ring: 0, weight: 100, interactive: true, x: 5, y: 0 },
      { id: "c", kind: "connection_person", label: "C", radius: 18, labelPriority: 80, ring: 1, weight: 80, interactive: true, x: 8, y: 5 },
    ];

    nudgeOverlapsBucketed(nodes, 4);

    for (let leftIndex = 0; leftIndex < nodes.length; leftIndex += 1) {
      for (let rightIndex = leftIndex + 1; rightIndex < nodes.length; rightIndex += 1) {
        const left = nodes[leftIndex]!;
        const right = nodes[rightIndex]!;
        expect(Math.hypot(right.x - left.x, right.y - left.y)).toBeGreaterThanOrEqual(
          left.radius + right.radius + 9.5,
        );
      }
    }
  });

  it("keeps friends closer to center than provisional people and outer channels", () => {
    const model = buildIdentityGraphModel({
      persons: [
        createPerson({ id: "friend-ada", name: "Ada Lovelace", relationshipStatus: "friend", careLevel: 5 }),
        createPerson({ id: "friend-grace", name: "Grace Hopper", relationshipStatus: "friend", careLevel: 4 }),
        createPerson({ id: "connection-linus", name: "Linus Torvalds", relationshipStatus: "connection", careLevel: 2 }),
      ],
      accounts: {
        "account-ada": createAccount({ id: "account-ada", personId: "friend-ada", provider: "instagram", externalId: "ada-ig" }),
        "account-grace": createAccount({ id: "account-grace", personId: "friend-grace", provider: "linkedin", externalId: "grace-li" }),
        "account-linus": createAccount({ id: "account-linus", personId: "connection-linus", provider: "x", externalId: "linus-x" }),
        "account-paper": createAccount({ id: "account-paper", provider: "x", externalId: "systems-paper", displayName: "Systems Paper" }),
      },
      feeds: {
        "https://example.com/feed.xml": {
          url: "https://example.com/feed.xml",
          title: "Example Feed",
          enabled: true,
          trackUnread: true,
        },
      },
      feedItems: {},
      mode: "all_content",
    });

    const firstLayout = buildIdentityGraphLayout({
      model,
      width: 1_400,
      height: 900,
    });
    const secondLayout = buildIdentityGraphLayout({
      model,
      width: 1_400,
      height: 900,
    });

    const centerX = 700;
    const centerY = 450;
    const averageDistance = (predicate: (node: (typeof firstLayout.nodes)[number]) => boolean) => {
      const nodes = firstLayout.nodes.filter(predicate);
      return nodes.reduce((sum, node) => sum + Math.hypot(node.x - centerX, node.y - centerY), 0) / nodes.length;
    };

    expect(averageDistance((node) => node.kind === "friend_person")).toBeLessThan(
      averageDistance((node) => node.kind === "connection_person"),
    );
    expect(averageDistance((node) => node.kind === "connection_person")).toBeLessThan(
      averageDistance((node) => node.kind === "feed" || (node.kind === "account" && !node.linkedPersonId)),
    );
    expect(firstLayout.nodes).toEqual(secondLayout.nodes);
  });
});

describe("identity graph interactive label quality", () => {
  it("hides low-priority outer labels during motion", () => {
    const highlighted = new Set<string>();
    const feedNode = {
      id: "feed:example",
      kind: "feed",
      label: "Example Feed",
      radius: 10,
      labelPriority: 24,
      feedUrl: "https://example.com/feed.xml",
      provider: "rss",
      ring: 3 as const,
      weight: 16,
      interactive: false,
      x: 0,
      y: 0,
    };
    const linkedAccountNode = {
      id: "account:linked",
      kind: "account",
      label: "Linked Account",
      radius: 14,
      labelPriority: 58,
      accountId: "account:linked",
      linkedPersonId: "friend-ada",
      provider: "instagram",
      ring: 2 as const,
      weight: 60,
      interactive: true,
      x: 0,
      y: 0,
    };

    expect(
      shouldShowGraphLabel({
        node: feedNode,
        scale: 1.4,
        highlighted,
        qualityMode: "interactive",
      }),
    ).toBe(false);
    expect(
      shouldShowGraphLabel({
        node: linkedAccountNode,
        scale: 1.15,
        highlighted,
        qualityMode: "interactive",
      }),
    ).toBe(true);
    expect(
      shouldShowGraphLabel({
        node: feedNode,
        scale: 1.4,
        highlighted,
        qualityMode: "settled",
      }),
    ).toBe(true);
  });
});
