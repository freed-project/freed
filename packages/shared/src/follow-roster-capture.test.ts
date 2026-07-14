import * as A from "@automerge/automerge";
import { describe, expect, it } from "vitest";
import type { Account, FeedItem, Person } from "./types.js";
import {
  addAccount,
  addFeedItem,
  addPerson,
  createEmptyDoc,
  mergeFeedItemInto,
  reconcileFollowRosterCapture,
  reconcileProviderEssayItems,
  reconcileYouTubeCapture,
  stripUndefined,
  updateFeedItem,
} from "./schema.js";
import { matchesFeedFilter } from "./ranking.js";

const now = 1_780_243_200_000;

function account(overrides: Partial<Account> = {}): Account {
  return {
    id: "social:substack:ada",
    kind: "social",
    provider: "substack",
    externalId: "ada",
    handle: "ada",
    displayName: "Ada Lovelace",
    firstSeenAt: now,
    lastSeenAt: now,
    discoveredFrom: "follow_roster",
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function item(overrides: Partial<FeedItem> = {}): FeedItem {
  return {
    globalId: "substack:essay:one",
    platform: "substack",
    contentType: "article",
    capturedAt: now,
    publishedAt: now,
    author: { id: "substack:ada", handle: "ada", displayName: "Ada Lovelace" },
    content: { text: "Original", mediaUrls: [], mediaTypes: [] },
    sourceUrl: "https://ada.substack.com/p/one",
    topics: ["essay"],
    userState: { hidden: false, saved: false, archived: false, tags: [] },
    ...overrides,
  };
}

describe("feed item sanitization", () => {
  it("drops prototype mutation keys from captured and updated records", () => {
    const untrusted = JSON.parse(
      '{"safe":"value","__proto__":{"polluted":"root"},"nested":{"constructor":{"prototype":{"polluted":"nested"}},"prototype":{"polluted":"nested"}}}',
    ) as Record<string, unknown>;
    const sanitized = stripUndefined(untrusted);

    expect(Object.getPrototypeOf(sanitized)).toBe(Object.prototype);
    expect((sanitized as Record<string, unknown>).polluted).toBeUndefined();
    expect(Object.hasOwn(sanitized, "__proto__")).toBe(false);
    expect(Object.hasOwn(sanitized.nested as object, "constructor")).toBe(false);
    expect(Object.hasOwn(sanitized.nested as object, "prototype")).toBe(false);

    const captured = item() as FeedItem & Record<string, unknown>;
    Object.defineProperty(captured, "__proto__", {
      value: { polluted: "captured" },
      enumerable: true,
    });
    Object.defineProperty(captured.content, "constructor", {
      value: { prototype: { polluted: "nested" } },
      enumerable: true,
    });

    const doc = A.change(createEmptyDoc(), (draft) => {
      addFeedItem(draft, captured);
      const updates = JSON.parse(
        '{"__proto__":{"polluted":"updated"},"content":{"mediaUrls":[],"mediaTypes":[],"prototype":{"polluted":"nested-update"}}}',
      ) as Partial<FeedItem>;
      updateFeedItem(draft, captured.globalId, updates);
    });

    expect((Object.prototype as Record<string, unknown>).polluted).toBeUndefined();
    expect(Object.hasOwn(doc.feedItems[captured.globalId], "__proto__")).toBe(false);
    expect(Object.hasOwn(doc.feedItems[captured.globalId].content, "constructor")).toBe(false);
    expect(Object.hasOwn(doc.feedItems[captured.globalId].content, "prototype")).toBe(false);
  });

  it("rejects unsafe record IDs before capture reconciliation", () => {
    const unsafeIds = ["__proto__", "constructor", "prototype"];
    const doc = A.change(createEmptyDoc(), (draft) => {
      for (const id of unsafeIds) {
        addAccount(draft, account({ id }));
        addFeedItem(draft, item({ globalId: id, contentType: "post" }));
      }
      reconcileFollowRosterCapture(
        draft,
        unsafeIds.map((id) => account({ id })),
        unsafeIds.map((globalId) => item({ globalId, contentType: "post" })),
        { provider: "substack", capturedAt: now },
      );
      reconcileProviderEssayItems(
        draft,
        unsafeIds.map((globalId) => item({ globalId })),
        "substack",
      );
      reconcileYouTubeCapture(
        draft,
        unsafeIds.map((id) => account({ id, provider: "youtube" })),
        unsafeIds.map((globalId) => item({ globalId, platform: "youtube" })),
        { rosterComplete: true, capturedAt: now },
      );
    });

    expect(Object.keys(doc.accounts)).toEqual([]);
    expect(Object.keys(doc.feedItems)).toEqual([]);
    expect((Object.prototype as Record<string, unknown>).priority).toBeUndefined();
    expect((Object.prototype as Record<string, unknown>).priorityComputedAt).toBeUndefined();
  });
});

describe("reconcileFollowRosterCapture", () => {
  it("preserves person links, graph placement, and feed interaction state", () => {
    const person: Person = {
      id: "person:ada",
      name: "Ada Lovelace",
      relationshipStatus: "connection",
      careLevel: 2,
      createdAt: now,
      updatedAt: now,
    };
    let doc = A.change(createEmptyDoc(), (draft) => {
      addPerson(draft, person);
      addAccount(draft, account({
        personId: person.id,
        graphX: 42,
        firstSeenAt: now - 10_000,
        discoveredFrom: "captured_item",
      }));
      addFeedItem(draft, item({
        content: { text: "Old text", mediaUrls: [], mediaTypes: [] },
        userState: { hidden: false, saved: true, readAt: now, archived: false, tags: ["keep"] },
      }));
    });

    doc = A.change(doc, (draft) => {
      reconcileFollowRosterCapture(
        draft,
        [account({ displayName: "Augusta Ada King", lastSeenAt: now + 5_000 })],
        [item({ content: { text: "Fresh text", mediaUrls: [], mediaTypes: [] } })],
        { provider: "substack", capturedAt: now + 5_000 },
      );
    });

    expect(doc.accounts[account().id]).toMatchObject({
      personId: person.id,
      graphX: 42,
      displayName: "Augusta Ada King",
      discoveredFrom: "follow_roster",
      firstSeenAt: now - 10_000,
      followRosterActive: true,
      followRosterSyncedAt: now + 5_000,
      updatedAt: now + 5_000,
    });
    expect(doc.feedItems[item().globalId]?.content.text).toBe("Fresh text");
    expect(doc.feedItems[item().globalId]?.userState).toMatchObject({
      saved: true,
      readAt: now,
      tags: ["keep"],
    });
  });

  it("unions relationship directions across partial roster captures", () => {
    const doc = A.change(createEmptyDoc(), (draft) => {
      addAccount(draft, account({ followRosterRoles: ["follower"] }));
      reconcileFollowRosterCapture(
        draft,
        [account({ followRosterRoles: ["following", "subscription"] })],
        [],
        { provider: "substack", capturedAt: now + 5_000 },
      );
    });

    expect(doc.accounts[account().id]?.followRosterRoles).toEqual([
      "follower",
      "following",
      "subscription",
    ]);
  });

  it("does not downgrade a descriptive roster name to its handle", () => {
    const doc = A.change(createEmptyDoc(), (draft) => {
      addAccount(draft, account({ displayName: "Ada Lovelace" }));
      reconcileFollowRosterCapture(
        draft,
        [account({ displayName: "ada" })],
        [],
        { provider: "substack", capturedAt: now + 5_000 },
      );
    });

    expect(doc.accounts[account().id]?.displayName).toBe("Ada Lovelace");
  });

  it("refreshes an existing author account when activity reveals a richer identity", () => {
    const authorId = "https://substack.com/@ada";
    const doc = A.change(createEmptyDoc(), (draft) => {
      addAccount(draft, account({
        id: `social:substack:${authorId}`,
        externalId: authorId,
        handle: "ada",
        displayName: "ada",
        profileUrl: authorId,
        personId: "person:ada",
      }));
      reconcileFollowRosterCapture(
        draft,
        [],
        [item({
          contentType: "post",
          author: {
            id: authorId,
            handle: "ada",
            displayName: "Ada Lovelace",
            avatarUrl: "https://images.example/ada.jpg",
          },
        })],
        { provider: "substack", capturedAt: now + 5_000 },
      );
    });

    expect(doc.accounts[`social:substack:${authorId}`]).toMatchObject({
      displayName: "Ada Lovelace",
      avatarUrl: "https://images.example/ada.jpg",
      personId: "person:ada",
      discoveredFrom: "follow_roster",
    });
    expect(Object.keys(doc.accounts)).toHaveLength(1);
  });

  it("ignores records from another provider", () => {
    const doc = A.change(createEmptyDoc(), (draft) => {
      reconcileFollowRosterCapture(
        draft,
        [account({ provider: "medium" })],
        [item({ platform: "medium" })],
        { provider: "substack", capturedAt: now },
      );
    });

    expect(Object.keys(doc.accounts)).toHaveLength(0);
    expect(Object.keys(doc.feedItems)).toHaveLength(0);
  });

  it("reuses a matching legacy RSS record without losing interaction state", () => {
    const legacyId = "rss:legacy-one";
    const doc = A.change(createEmptyDoc(), (draft) => {
      addFeedItem(draft, item({
        globalId: legacyId,
        platform: "rss",
        contentType: "post",
        author: {
          id: "https://ada.substack.com/feed",
          handle: "Ada's feed",
          displayName: "Ada's feed",
        },
        sourceUrl: "https://ada.substack.com/p/one?utm_source=rss",
        content: {
          text: "The complete RSS essay body",
          mediaUrls: [],
          mediaTypes: [],
          linkPreview: {
            url: "https://ada.substack.com/p/one?utm_source=rss",
            title: "One",
          },
        },
        rssSource: {
          feedUrl: "https://ada.substack.com/feed",
          feedTitle: "Ada",
          siteUrl: "https://ada.substack.com",
        },
        userState: { hidden: false, saved: true, archived: false, tags: ["keep"] },
      }));

      reconcileFollowRosterCapture(
        draft,
        [],
        [item({
          globalId: "substack:essay:https%3A%2F%2Fada.substack.com%2Fp%2Fone",
          author: {
            id: "https://substack.com/@ada",
            handle: "ada",
            displayName: "Ada Lovelace",
          },
          sourceUrl: "https://ada.substack.com/p/one",
          content: {
            mediaUrls: [],
            mediaTypes: [],
            linkPreview: { url: "https://ada.substack.com/p/one", title: "One" },
          },
        })],
        { provider: "substack", capturedAt: now },
      );
    });

    expect(Object.keys(doc.feedItems)).toEqual([legacyId]);
    expect(doc.feedItems[legacyId]).toMatchObject({
      globalId: legacyId,
      platform: "substack",
      contentType: "article",
      author: {
        id: "https://substack.com/@ada",
        handle: "ada",
        displayName: "Ada Lovelace",
      },
      content: { text: "The complete RSS essay body" },
      userState: { saved: true, tags: ["keep"] },
    });
    expect(
      matchesFeedFilter(doc.feedItems[legacyId], {
        platform: "rss",
        feedUrl: "https://ada.substack.com/feed",
      }),
    ).toBe(true);
    expect(
      matchesFeedFilter(doc.feedItems[legacyId], { platform: "substack" }),
    ).toBe(true);
    expect(doc.accounts["social:substack:https://substack.com/@ada"]).toMatchObject({
      provider: "substack",
      externalId: "https://substack.com/@ada",
      profileUrl: "https://substack.com/@ada",
      discoveredFrom: "captured_item",
    });
  });

  it("consolidates existing RSS and provider duplicates into the authenticated record", () => {
    const providerId = item().globalId;
    const legacyId = "rss:legacy-duplicate";
    const doc = A.change(createEmptyDoc(), (draft) => {
      addFeedItem(draft, item({
        globalId: providerId,
        content: {
          mediaUrls: [],
          mediaTypes: [],
          linkPreview: { url: "https://ada.substack.com/p/one", title: "One" },
        },
        userState: { hidden: false, saved: false, archived: false, tags: ["provider"] },
      }));
      addFeedItem(draft, item({
        globalId: legacyId,
        platform: "rss",
        contentType: "post",
        content: {
          text: "The complete RSS essay body",
          mediaUrls: [],
          mediaTypes: [],
          linkPreview: {
            url: "https://ada.substack.com/p/one?utm_source=rss",
            title: "One",
          },
        },
        rssSource: {
          feedUrl: "https://ada.substack.com/feed",
          feedTitle: "Ada",
          siteUrl: "https://ada.substack.com",
        },
        userState: { hidden: false, saved: true, archived: false, tags: ["rss"] },
      }));

      reconcileFollowRosterCapture(
        draft,
        [],
        [item({
          author: {
            id: "https://substack.com/@ada",
            handle: "ada",
            displayName: "Ada Lovelace",
          },
          content: {
            mediaUrls: [],
            mediaTypes: [],
            linkPreview: { url: "https://ada.substack.com/p/one", title: "One" },
          },
        })],
        { provider: "substack", capturedAt: now },
      );
    });

    expect(Object.keys(doc.feedItems)).toEqual([providerId]);
    expect(doc.feedItems[providerId]).toMatchObject({
      platform: "substack",
      contentType: "article",
      author: { id: "https://substack.com/@ada" },
      content: { text: "The complete RSS essay body" },
      rssSource: { feedUrl: "https://ada.substack.com/feed" },
      userState: { saved: true },
    });
    expect(doc.feedItems[providerId].userState.tags).toEqual(
      expect.arrayContaining(["provider", "rss"]),
    );
  });

  it("keeps a descriptive RSS publication name when capture only supplies its handle", () => {
    const legacyId = "rss:deep-thoughts";
    const doc = A.change(createEmptyDoc(), (draft) => {
      addFeedItem(draft, item({
        globalId: legacyId,
        platform: "rss",
        author: {
          id: "https://deepthoughts.substack.com/feed",
          handle: "deepthoughts",
          displayName: "Deep Thoughts",
        },
        sourceUrl: "https://deepthoughts.substack.com/p/one",
        content: {
          text: "The complete RSS essay body",
          mediaUrls: [],
          mediaTypes: [],
          linkPreview: {
            url: "https://deepthoughts.substack.com/p/one",
            title: "One",
          },
        },
        rssSource: {
          feedUrl: "https://deepthoughts.substack.com/feed",
          feedTitle: "Deep Thoughts",
          siteUrl: "https://deepthoughts.substack.com",
        },
      }));

      reconcileFollowRosterCapture(
        draft,
        [],
        [item({
          globalId: "substack:essay:https%3A%2F%2Fdeepthoughts.substack.com%2Fp%2Fone",
          author: {
            id: "https://deepthoughts.substack.com/",
            handle: "deepthoughts",
            displayName: "deepthoughts",
          },
          sourceUrl: "https://deepthoughts.substack.com/p/one",
          content: {
            mediaUrls: [],
            mediaTypes: [],
            linkPreview: {
              url: "https://deepthoughts.substack.com/p/one",
              title: "One",
            },
          },
        })],
        { provider: "substack", capturedAt: now },
      );
    });

    expect(Object.keys(doc.feedItems)).toEqual([legacyId]);
    expect(doc.feedItems[legacyId].author).toMatchObject({
      id: "https://deepthoughts.substack.com/",
      handle: "deepthoughts",
      displayName: "Deep Thoughts",
    });
  });

  it("merges an RSS body into an authenticated article record", () => {
    const target = item({
      content: {
        mediaUrls: [],
        mediaTypes: [],
        linkPreview: { url: "https://ada.substack.com/p/one", title: "One" },
      },
      userState: { hidden: false, saved: true, archived: false, tags: ["keep"] },
    });
    const source = item({
      content: {
        text: "The complete RSS essay body",
        mediaUrls: [],
        mediaTypes: [],
        linkPreview: { url: "https://ada.substack.com/p/one", title: "One" },
      },
      rssSource: {
        feedUrl: "https://ada.substack.com/feed",
        feedTitle: "Ada",
        siteUrl: "https://ada.substack.com",
      },
    });

    mergeFeedItemInto(target, source);

    expect(target.content.text).toBe("The complete RSS essay body");
    expect(target.rssSource?.feedUrl).toBe("https://ada.substack.com/feed");
    expect(target.userState).toMatchObject({ saved: true, tags: ["keep"] });
  });

  it("keeps merged media types aligned with their URLs", () => {
    const target = item({
      content: {
        mediaUrls: ["https://cdn.example.com/cover.jpg"],
        mediaTypes: ["image"],
      },
    });
    const source = item({
      content: {
        mediaUrls: [
          "https://cdn.example.com/cover.jpg",
          "https://cdn.example.com/interview.mp4",
        ],
        mediaTypes: ["image", "video"],
      },
    });

    mergeFeedItemInto(target, source);

    expect(target.content.mediaUrls).toEqual([
      "https://cdn.example.com/cover.jpg",
      "https://cdn.example.com/interview.mp4",
    ]);
    expect(target.content.mediaTypes).toEqual(["image", "video"]);
  });

  it("repairs legacy media alignment inside an Automerge change", () => {
    let doc = A.change(createEmptyDoc(), (draft) => {
      addFeedItem(draft, item({
        content: {
          mediaUrls: [
            "https://cdn.example.com/cover.jpg",
            "https://cdn.example.com/interview.mp4",
          ],
          mediaTypes: [],
        },
      }));
    });

    doc = A.change(doc, (draft) => {
      mergeFeedItemInto(draft.feedItems[item().globalId], item({
        content: {
          mediaUrls: [
            "https://cdn.example.com/interview.mp4",
            "https://example.com/source",
          ],
          mediaTypes: ["video", "link"],
        },
      }));
    });

    expect(doc.feedItems[item().globalId].content.mediaUrls).toEqual([
      "https://cdn.example.com/cover.jpg",
      "https://cdn.example.com/interview.mp4",
      "https://example.com/source",
    ]);
    expect(doc.feedItems[item().globalId].content.mediaTypes).toEqual([
      "image",
      "video",
      "link",
    ]);
  });
});
