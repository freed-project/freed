/**
 * Unit tests for the Automerge document schema operations
 *
 * Tests the core CRDT operations: create, add, update, merge.
 * These operations underpin the entire sync pipeline.
 */

import { describe, it, expect, vi } from "vitest";
import * as A from "@automerge/automerge";
import {
  addAccounts,
  addPerson,
  createEmptyDoc,
  createDocFromTrustedCompatibilityData,
  addFeedItem,
  deduplicateDocFeedItems,
  hasLegacyIdentityGraphData,
  getRegisteredDesktopClientIds,
  migrateLegacyIdentityGraph,
  removeFeedItem,
  markAsRead,
  archiveItemsById,
  clearSampleData,
  toggleSaved,
  unarchiveSavedItems,
  hideItem,
  logReachOut,
  addRssFeed,
  assertNonDestructiveMerge,
  compareDocumentHistories,
  evaluateDestructiveMergeGuard,
  removeRssFeed,
  reconcileYouTubeCapture,
  registerDesktopClient,
  updateAccount,
  updateFeedItem,
  updatePerson,
  updatePreferences,
  updateRssFeed,
} from "@freed/shared/schema";
import type { FreedDoc } from "@freed/shared/schema";
import { CONTENT_SIGNAL_VERSION } from "@freed/shared";
import type { Account, FeedItem, ReachOutLog, RssFeed, SampleDataFingerprint } from "@freed/shared";

// =============================================================================
// Test fixtures
// =============================================================================

function makeItem(overrides: Partial<FeedItem> & { globalId: string }): FeedItem {
  return {
    platform: "rss",
    contentType: "article",
    capturedAt: Date.now(),
    publishedAt: Date.now() - 3600000,
    author: { id: "auth-1", handle: "auth1", displayName: "Auth One" },
    content: { text: "Test content", mediaUrls: [], mediaTypes: [] },
    userState: { hidden: false, saved: false, archived: false, tags: [] },
    topics: [],
    ...overrides,
  };
}

function makeFeed(overrides: Partial<RssFeed> & { url: string; title: string }): RssFeed {
  return {
    enabled: true,
    trackUnread: false,
    ...overrides,
  };
}

function makeAccount(overrides: Partial<Account> & {
  id: string;
  kind: Account["kind"];
  provider: Account["provider"];
  externalId: string;
}): Account {
  return {
    personId: "person-1",
    firstSeenAt: 1,
    lastSeenAt: 1,
    discoveredFrom: "captured_item",
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

const sampleFingerprint: SampleDataFingerprint = {
  marker: "freed.sample-data.v1",
  batchId: "test-batch",
  generatedAt: 1,
  generatorVersion: 1,
};

// =============================================================================
// identity graph placement
// =============================================================================

describe("identity graph placement", () => {
  it("keeps viewport graph placement out of Automerge writes", () => {
    let doc = createEmptyDoc();

    doc = A.change(doc, (d) => {
      addPerson(d, {
        id: "person-graph",
        name: "Graph Person",
        relationshipStatus: "friend",
        careLevel: 4,
        graphX: 123,
        graphY: 456,
        graphPinned: true,
        graphUpdatedAt: 789,
        createdAt: 1,
        updatedAt: 1,
      });
      addAccounts(d, [
        makeAccount({
          id: "account-graph",
          personId: "person-graph",
          kind: "social",
          provider: "instagram",
          externalId: "graph-person",
          graphX: 234,
          graphY: 567,
          graphPinned: true,
          graphUpdatedAt: 890,
        }),
      ]);
      updatePerson(d, "person-graph", { graphX: 321, graphY: 654 });
      updateAccount(d, "account-graph", { graphPinned: false });
    });

    expect(doc.persons["person-graph"]).not.toHaveProperty("graphX");
    expect(doc.persons["person-graph"]).not.toHaveProperty("graphY");
    expect(doc.persons["person-graph"]).not.toHaveProperty("graphPinned");
    expect(doc.persons["person-graph"]).not.toHaveProperty("graphUpdatedAt");
    expect(doc.accounts["account-graph"]).not.toHaveProperty("graphX");
    expect(doc.accounts["account-graph"]).not.toHaveProperty("graphY");
    expect(doc.accounts["account-graph"]).not.toHaveProperty("graphPinned");
    expect(doc.accounts["account-graph"]).not.toHaveProperty("graphUpdatedAt");
  });
});

describe("reach-out log synchronization", () => {
  it("drops unknown runtime fields at the direct write boundary", () => {
    let doc = createEmptyDoc();
    doc = A.change(doc, (draft) => {
      addPerson(draft, {
        id: "person-log",
        name: "Log Person",
        relationshipStatus: "friend",
        careLevel: 4,
        createdAt: 1,
        updatedAt: 1,
      });
      logReachOut(draft, "person-log", {
        loggedAt: 2,
        channel: "other",
        notes: "Hello",
        localStatus: "queued",
      } as ReachOutLog & { localStatus: string });
    });

    expect(doc.persons["person-log"].reachOutLog).toEqual([{
      loggedAt: 2,
      channel: "other",
      notes: "Hello",
    }]);
  });
});

describe("clearSampleData", () => {
  it("removes only fingerprinted sample records and unlinks real accounts", () => {
    let doc = createEmptyDoc();

    doc = A.change(doc, (draft) => {
      addRssFeed(draft, makeFeed({
        url: "https://sample.freed.wtf/test/feed",
        title: "Sample",
        sampleDataFingerprint: sampleFingerprint,
      }));
      addRssFeed(draft, makeFeed({ url: "https://example.com/feed", title: "Real" }));
      addFeedItem(draft, makeItem({
        globalId: "sample:item",
        sampleDataFingerprint: sampleFingerprint,
      }));
      addFeedItem(draft, makeItem({ globalId: "real:item" }));
      addPerson(draft, {
        id: "sample-person",
        name: "Sample Person",
        relationshipStatus: "friend",
        careLevel: 3,
        sampleDataFingerprint: sampleFingerprint,
        createdAt: 1,
        updatedAt: 1,
      });
      addPerson(draft, {
        id: "real-person",
        name: "Real Person",
        relationshipStatus: "friend",
        careLevel: 3,
        createdAt: 1,
        updatedAt: 1,
      });
      addAccounts(draft, [
        makeAccount({
          id: "sample-account",
          personId: "sample-person",
          kind: "social",
          provider: "x",
          externalId: "sample",
          sampleDataFingerprint: sampleFingerprint,
        }),
        makeAccount({
          id: "real-linked-account",
          personId: "sample-person",
          kind: "social",
          provider: "instagram",
          externalId: "real-linked",
        }),
        makeAccount({
          id: "real-account",
          personId: "real-person",
          kind: "social",
          provider: "facebook",
          externalId: "real",
        }),
      ]);
    });

    let summary = { feeds: 0, items: 0, persons: 0, accounts: 0, total: 0 };
    doc = A.change(doc, (draft) => {
      summary = clearSampleData(draft);
    });

    expect(summary).toEqual({ feeds: 1, items: 1, persons: 1, accounts: 1, total: 4 });
    expect(doc.rssFeeds["https://sample.freed.wtf/test/feed"]).toBeUndefined();
    expect(doc.rssFeeds["https://example.com/feed"]).toBeDefined();
    expect(doc.feedItems["sample:item"]).toBeUndefined();
    expect(doc.feedItems["real:item"]).toBeDefined();
    expect(doc.persons["sample-person"]).toBeUndefined();
    expect(doc.persons["real-person"]).toBeDefined();
    expect(doc.accounts["sample-account"]).toBeUndefined();
    expect(doc.accounts["real-account"]?.personId).toBe("real-person");
    expect(doc.accounts["real-linked-account"]).toBeDefined();
    expect(doc.accounts["real-linked-account"]?.personId).toBeUndefined();
  });
});

// =============================================================================
// createEmptyDoc
// =============================================================================

describe("createEmptyDoc", () => {
  it("creates a valid Automerge document", () => {
    const doc = createEmptyDoc();
    expect(doc).toBeDefined();
    expect(doc.feedItems).toBeDefined();
    expect(doc.rssFeeds).toBeDefined();
    expect(doc.preferences).toBeDefined();
  });

  it("starts with empty feed items and feeds", () => {
    const doc = createEmptyDoc();
    expect(Object.keys(doc.feedItems)).toHaveLength(0);
    expect(Object.keys(doc.rssFeeds)).toHaveLength(0);
  });

  it("has default preferences with ranking weights", () => {
    const doc = createEmptyDoc();
    expect(doc.preferences.weights).toBeDefined();
    expect(typeof doc.preferences.weights.recency).toBe("number");
  });

  it("is a real Automerge document (can be saved and loaded)", () => {
    const doc = createEmptyDoc();
    const binary = A.save(doc);
    expect(binary).toBeInstanceOf(Uint8Array);
    expect(binary.length).toBeGreaterThan(0);

    const loaded = A.load<FreedDoc>(binary);
    expect(Object.keys(loaded.feedItems)).toHaveLength(0);
  });
});

// =============================================================================
// addFeedItem / removeFeedItem
// =============================================================================

describe("addFeedItem", () => {
  it("adds an item to the document", () => {
    let doc = createEmptyDoc();
    const item = makeItem({ globalId: "rss:https://example.com/1" });

    doc = A.change(doc, (d) => addFeedItem(d, item));

    expect(doc.feedItems["rss:https://example.com/1"]).toBeDefined();
    expect(doc.feedItems["rss:https://example.com/1"].content.text).toBe("Test content");
  });

  it("adds multiple items independently", () => {
    let doc = createEmptyDoc();

    doc = A.change(doc, (d) => {
      addFeedItem(d, makeItem({ globalId: "item-1" }));
      addFeedItem(d, makeItem({ globalId: "item-2" }));
      addFeedItem(d, makeItem({ globalId: "item-3" }));
    });

    expect(Object.keys(doc.feedItems)).toHaveLength(3);
  });

  it("overwrites an existing item with the same globalId", () => {
    let doc = createEmptyDoc();
    const item = makeItem({ globalId: "item-1" });
    const updated = { ...item, content: { ...item.content, text: "Updated text" } };

    doc = A.change(doc, (d) => addFeedItem(d, item));
    doc = A.change(doc, (d) => addFeedItem(d, updated));

    expect(doc.feedItems["item-1"].content.text).toBe("Updated text");
  });

  it.each([
    ["populated", "<article>local</article>"],
    ["empty", ""],
  ])("strips %s device-local reader HTML from additions and updates", (_label, html) => {
    let doc = createEmptyDoc();
    doc = A.change(doc, (d) => addFeedItem(d, makeItem({
      globalId: "item-1",
      preservedContent: {
        text: "Synced summary",
        html,
        wordCount: 2,
        readingTime: 1,
        preservedAt: 1,
      },
    })));
    expect(doc.feedItems["item-1"].preservedContent).not.toHaveProperty("html");

    doc = A.change(doc, (d) => updateFeedItem(d, "item-1", {
      preservedContent: {
        text: "Updated summary",
        html,
        wordCount: 2,
        readingTime: 1,
        preservedAt: 2,
      },
    }));
    expect(doc.feedItems["item-1"].preservedContent).toMatchObject({ text: "Updated summary" });
    expect(doc.feedItems["item-1"].preservedContent).not.toHaveProperty("html");
  });

  it("updates preserved metadata without overwriting retained legacy reader HTML", () => {
    const item = makeItem({
      globalId: "item-1",
      preservedContent: {
        text: "Legacy summary",
        html: "<article>retained legacy reader content</article>",
        wordCount: 2,
        readingTime: 1,
        preservedAt: 1,
      },
    });
    let doc = createDocFromTrustedCompatibilityData({ feedItems: { [item.globalId]: item } });

    doc = A.change(doc, (draft) => updateFeedItem(draft, item.globalId, {
      preservedContent: {
        text: "Current synced summary",
        html: "<article>incoming content must not replace the local blob</article>",
        wordCount: 4,
        readingTime: 2,
        preservedAt: 2,
      },
    }));

    expect(doc.feedItems[item.globalId].preservedContent).toEqual({
      text: "Current synced summary",
      html: "<article>retained legacy reader content</article>",
      wordCount: 4,
      readingTime: 2,
      preservedAt: 2,
    });
  });
});

describe("removeFeedItem", () => {
  it("removes an item from the document", () => {
    let doc = createEmptyDoc();
    doc = A.change(doc, (d) => addFeedItem(d, makeItem({ globalId: "item-1" })));
    doc = A.change(doc, (d) => removeFeedItem(d, "item-1"));

    expect(doc.feedItems["item-1"]).toBeUndefined();
  });

  it("is a no-op when item does not exist", () => {
    let doc = createEmptyDoc();
    // Should not throw
    expect(() => {
      doc = A.change(doc, (d) => removeFeedItem(d, "nonexistent"));
    }).not.toThrow();
  });
});

describe("deduplicateDocFeedItems", () => {
  it("deduplicates exact URL matches and preserves the richer user state", () => {
    let doc = createEmptyDoc();

    doc = A.change(doc, (d) => {
      addFeedItem(d, makeItem({
        globalId: "rss:item-1",
        content: {
          text: "Same article",
          mediaUrls: [],
          mediaTypes: [],
          linkPreview: { url: "https://example.com/article", title: "Article" },
        },
      }));
      addFeedItem(d, makeItem({
        globalId: "rss:item-2",
        content: {
          text: "Same article mirrored",
          mediaUrls: [],
          mediaTypes: [],
          linkPreview: { url: "https://example.com/article", title: "Article" },
        },
        userState: {
          hidden: false,
          saved: true,
          savedAt: 100,
          archived: false,
          tags: ["keep-me"],
        },
      }));
      deduplicateDocFeedItems(d);
    });

    expect(Object.keys(doc.feedItems)).toHaveLength(1);
    const [survivor] = Object.values(doc.feedItems);
    expect(survivor.userState.saved).toBe(true);
    expect(survivor.userState.tags).toContain("keep-me");
  });

  it("preserves the only legacy reader HTML when the selected keeper has none", () => {
    const sharedUrl = "https://example.com/legacy-reader-article";
    const keeper = makeItem({
      globalId: "rss:keeper",
      publishedAt: 200,
      content: {
        text: "Current article",
        mediaUrls: [],
        mediaTypes: [],
        linkPreview: { url: sharedUrl, title: "Article" },
      },
      preservedContent: {
        text: "Current summary",
        wordCount: 2,
        readingTime: 1,
        preservedAt: 2,
      },
    });
    const duplicate = makeItem({
      globalId: "rss:duplicate",
      publishedAt: 100,
      content: {
        text: "Older copy of the article",
        mediaUrls: [],
        mediaTypes: [],
        linkPreview: { url: sharedUrl, title: "Article" },
      },
      preservedContent: {
        text: "Legacy summary",
        html: "<article>only retained reader content</article>",
        wordCount: 4,
        readingTime: 2,
        preservedAt: 1,
      },
    });
    let doc = createDocFromTrustedCompatibilityData({
      feedItems: {
        [keeper.globalId]: keeper,
        [duplicate.globalId]: duplicate,
      },
    });

    doc = A.change(doc, (draft) => {
      expect(deduplicateDocFeedItems(draft)).toBe(1);
    });

    expect(Object.keys(doc.feedItems)).toEqual([keeper.globalId]);
    expect(doc.feedItems[keeper.globalId].preservedContent?.html).toBe(
      "<article>only retained reader content</article>",
    );
  });

  it("deduplicates likely Facebook and Instagram cross-posts for the same linked person", () => {
    let doc = createEmptyDoc();

    doc = A.change(doc, (d) => {
      addPerson(d, {
        id: "person-1",
        name: "Casey",
        relationshipStatus: "friend",
        careLevel: 4,
        createdAt: 1,
        updatedAt: 1,
      });
      addAccounts(d, [
        makeAccount({
          id: "person-1:facebook:casey-fb",
          personId: "person-1",
          kind: "social",
          provider: "facebook",
          externalId: "casey-fb",
        }),
        makeAccount({
          id: "person-1:instagram:casey-ig",
          personId: "person-1",
          kind: "social",
          provider: "instagram",
          externalId: "casey-ig",
        }),
      ]);

      addFeedItem(d, makeItem({
        globalId: "facebook:1",
        platform: "facebook",
        contentType: "story",
        publishedAt: 1_000,
        author: { id: "casey-fb", handle: "casey", displayName: "Casey" },
        content: {
          text: "Brunch in Echo Park with too much sun and exactly enough coffee.",
          mediaUrls: [],
          mediaTypes: [],
        },
        userState: {
          hidden: false,
          saved: true,
          savedAt: 1_100,
          archived: false,
          tags: ["brunch"],
        },
      }));

      addFeedItem(d, makeItem({
        globalId: "instagram:1",
        platform: "instagram",
        contentType: "story",
        publishedAt: 1_000 + 60_000,
        author: { id: "casey-ig", handle: "casey", displayName: "Casey Nguyen" },
        content: {
          text: "Brunch in Echo Park with too much sun and exactly enough coffee!!!",
          mediaUrls: ["https://img.example.com/story.jpg"],
          mediaTypes: ["image"],
        },
        location: {
          name: "Echo Park",
          source: "sticker",
          url: "https://maps.example.com/echo-park",
        },
      }));

      deduplicateDocFeedItems(d);
    });

    expect(Object.keys(doc.feedItems)).toHaveLength(1);
    const [survivor] = Object.values(doc.feedItems);
    expect(survivor.userState.saved).toBe(true);
    expect(survivor.userState.tags).toContain("brunch");
    expect(survivor.location?.name).toBe("Echo Park");
    expect(survivor.content.mediaUrls).toContain("https://img.example.com/story.jpg");
  });

  it("keeps same-text social posts when the linked person or time window does not match", () => {
    let doc = createEmptyDoc();

    doc = A.change(doc, (d) => {
      addPerson(d, {
        id: "person-1",
        name: "Casey",
        relationshipStatus: "friend",
        careLevel: 4,
        createdAt: 1,
        updatedAt: 1,
      });
      addPerson(d, {
        id: "person-2",
        name: "Jordan",
        relationshipStatus: "friend",
        careLevel: 4,
        createdAt: 1,
        updatedAt: 1,
      });
      addAccounts(d, [
        makeAccount({
          id: "person-1:facebook:casey-fb",
          personId: "person-1",
          kind: "social",
          provider: "facebook",
          externalId: "casey-fb",
        }),
        makeAccount({
          id: "person-2:instagram:jordan-ig",
          personId: "person-2",
          kind: "social",
          provider: "instagram",
          externalId: "jordan-ig",
        }),
      ]);

      addFeedItem(d, makeItem({
        globalId: "facebook:2",
        platform: "facebook",
        publishedAt: 1_000,
        author: { id: "casey-fb", handle: "casey", displayName: "Casey" },
        content: {
          text: "Sunset walk by the reservoir and a terrible joke about pelicans.",
          mediaUrls: [],
          mediaTypes: [],
        },
      }));

      addFeedItem(d, makeItem({
        globalId: "instagram:2",
        platform: "instagram",
        publishedAt: 1_000 + 12 * 60_000,
        author: { id: "jordan-ig", handle: "jordan", displayName: "Jordan" },
        content: {
          text: "Sunset walk by the reservoir and a terrible joke about pelicans.",
          mediaUrls: [],
          mediaTypes: [],
        },
      }));

      deduplicateDocFeedItems(d);
    });

    expect(Object.keys(doc.feedItems)).toHaveLength(2);
  });

  it("deduplicates same-platform stories with unstable captured story IDs", () => {
    let doc = createEmptyDoc();

    doc = A.change(doc, (d) => {
      addFeedItem(d, makeItem({
        globalId: "ig:story_ada_1774389196662",
        platform: "instagram",
        contentType: "story",
        publishedAt: 1_774_389_007_000,
        author: { id: "ig:ada", handle: "ada", displayName: "Ada" },
        content: {
          text: "",
          mediaUrls: ["https://cdn.example/story-video.mp4"],
          mediaTypes: ["video"],
        },
        location: {
          name: "Big Bear, California",
          source: "sticker",
          url: "https://www.instagram.com/explore/locations/123/big-bear-california/",
        },
        userState: {
          hidden: false,
          saved: true,
          savedAt: 1_774_389_200_000,
          archived: false,
          tags: ["trip"],
        },
      }));

      addFeedItem(d, makeItem({
        globalId: "ig:story_ada_1774389204187",
        platform: "instagram",
        contentType: "story",
        publishedAt: 1_774_389_007_000,
        author: { id: "ig:ada", handle: "ada", displayName: "Ada" },
        content: {
          text: "",
          mediaUrls: ["https://cdn.example/story-video.mp4"],
          mediaTypes: ["video"],
        },
        location: {
          name: "Big Bear, California",
          source: "sticker",
          url: "https://www.instagram.com/explore/locations/123/big-bear-california/",
        },
      }));

      deduplicateDocFeedItems(d);
    });

    expect(Object.keys(doc.feedItems)).toHaveLength(1);
    const [survivor] = Object.values(doc.feedItems);
    expect(survivor.platform).toBe("instagram");
    expect(survivor.contentType).toBe("story");
    expect(survivor.userState.saved).toBe(true);
    expect(survivor.userState.tags).toContain("trip");
    expect(survivor.content.mediaUrls).toContain("https://cdn.example/story-video.mp4");
  });
});

// =============================================================================
// markAsRead
// =============================================================================

describe("markAsRead", () => {
  it("sets readAt on the item", () => {
    let doc = createEmptyDoc();
    doc = A.change(doc, (d) => addFeedItem(d, makeItem({ globalId: "item-1" })));

    expect(doc.feedItems["item-1"].userState.readAt).toBeUndefined();

    doc = A.change(doc, (d) => markAsRead(d, "item-1"));

    expect(doc.feedItems["item-1"].userState.readAt).toBeDefined();
    expect(typeof doc.feedItems["item-1"].userState.readAt).toBe("number");
  });

  it("is a no-op when item does not exist", () => {
    let doc = createEmptyDoc();
    expect(() => {
      doc = A.change(doc, (d) => markAsRead(d, "nonexistent"));
    }).not.toThrow();
  });
});

describe("archiveItemsById", () => {
  it("archives only visible read unsaved IDs with one timestamp", () => {
    let doc = createEmptyDoc();
    doc = A.change(doc, (d) => {
      addFeedItem(d, makeItem({
        globalId: "read-target-a",
        userState: { hidden: false, saved: false, archived: false, readAt: 1, tags: [] },
      }));
      addFeedItem(d, makeItem({
        globalId: "read-target-b",
        userState: { hidden: false, saved: false, archived: false, readAt: 2, tags: [] },
      }));
      addFeedItem(d, makeItem({
        globalId: "unread-skip",
        userState: { hidden: false, saved: false, archived: false, tags: [] },
      }));
      addFeedItem(d, makeItem({
        globalId: "saved-skip",
        userState: { hidden: false, saved: true, archived: false, readAt: 3, tags: [] },
      }));
      addFeedItem(d, makeItem({
        globalId: "hidden-skip",
        userState: { hidden: true, saved: false, archived: false, readAt: 4, tags: [] },
      }));
      addFeedItem(d, makeItem({
        globalId: "archived-skip",
        userState: { hidden: false, saved: false, archived: true, archivedAt: 5, readAt: 5, tags: [] },
      }));
    });

    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(123456);
    let changedIds: string[] = [];
    doc = A.change(doc, (d) => {
      changedIds = archiveItemsById(d, [
        "read-target-a",
        "missing-skip",
        "unread-skip",
        "saved-skip",
        "hidden-skip",
        "archived-skip",
        "read-target-b",
      ]);
    });
    nowSpy.mockRestore();

    expect(changedIds).toEqual(["read-target-a", "read-target-b"]);
    expect(doc.feedItems["read-target-a"].userState.archived).toBe(true);
    expect(doc.feedItems["read-target-b"].userState.archived).toBe(true);
    expect(doc.feedItems["read-target-a"].userState.archivedAt).toBe(123456);
    expect(doc.feedItems["read-target-b"].userState.archivedAt).toBe(123456);
    expect(doc.feedItems["unread-skip"].userState.archived).toBe(false);
    expect(doc.feedItems["saved-skip"].userState.archived).toBe(false);
    expect(doc.feedItems["hidden-skip"].userState.archived).toBe(false);
    expect(doc.feedItems["archived-skip"].userState.archivedAt).toBe(5);
  });
});

// =============================================================================
// toggleSaved
// =============================================================================

describe("toggleSaved", () => {
  it("saves an unsaved item", () => {
    let doc = createEmptyDoc();
    doc = A.change(doc, (d) => addFeedItem(d, makeItem({ globalId: "item-1" })));
    doc = A.change(doc, (d) => toggleSaved(d, "item-1"));

    expect(doc.feedItems["item-1"].userState.saved).toBe(true);
    expect(doc.feedItems["item-1"].userState.savedAt).toBeDefined();
  });

  it("unsaves a saved item", () => {
    let doc = createEmptyDoc();
    doc = A.change(doc, (d) =>
      addFeedItem(d, makeItem({
        globalId: "item-1",
        userState: { hidden: false, saved: true, archived: false, tags: [] },
      }))
    );
    doc = A.change(doc, (d) => toggleSaved(d, "item-1"));

    expect(doc.feedItems["item-1"].userState.saved).toBe(false);
    expect(doc.feedItems["item-1"].userState.savedAt).toBeUndefined();
  });

  it("toggles twice returns to original state", () => {
    let doc = createEmptyDoc();
    doc = A.change(doc, (d) => addFeedItem(d, makeItem({ globalId: "item-1" })));
    doc = A.change(doc, (d) => toggleSaved(d, "item-1"));
    doc = A.change(doc, (d) => toggleSaved(d, "item-1"));

    expect(doc.feedItems["item-1"].userState.saved).toBe(false);
  });
});

// =============================================================================
// hideItem
// =============================================================================

describe("hideItem", () => {
  it("sets hidden to true", () => {
    let doc = createEmptyDoc();
    doc = A.change(doc, (d) => addFeedItem(d, makeItem({ globalId: "item-1" })));
    doc = A.change(doc, (d) => hideItem(d, "item-1"));

    expect(doc.feedItems["item-1"].userState.hidden).toBe(true);
  });
});

// =============================================================================
// addRssFeed / removeRssFeed
// =============================================================================

describe("addRssFeed", () => {
  it("adds a feed to the document", () => {
    let doc = createEmptyDoc();
    const feed = makeFeed({ url: "https://example.com/feed", title: "Example" });
    doc = A.change(doc, (d) => addRssFeed(d, feed));

    expect(doc.rssFeeds["https://example.com/feed"]).toBeDefined();
    expect(doc.rssFeeds["https://example.com/feed"].title).toBe("Example");
  });

  it("indexes feed by URL", () => {
    let doc = createEmptyDoc();
    doc = A.change(doc, (d) => {
      addRssFeed(d, makeFeed({ url: "https://a.com/feed", title: "A" }));
      addRssFeed(d, makeFeed({ url: "https://b.com/feed", title: "B" }));
    });

    expect(Object.keys(doc.rssFeeds)).toHaveLength(2);
  });

  it("strips device-local RSS scheduler and HTTP state from new feeds", () => {
    const url = "https://local-state.example/feed";
    let doc = createEmptyDoc();
    doc = A.change(doc, (d) => addRssFeed(d, makeFeed({
      url,
      title: "Local state",
      lastFetched: 123,
      lastFetchAttemptedAt: 124,
      nextFetchAfter: 456,
      consecutiveFailures: 3,
      lastFetchError: "offline",
      etag: "local-etag",
      lastModified: "yesterday",
    })));

    expect(doc.rssFeeds[url].lastFetched).toBe(123);
    expect(doc.rssFeeds[url].lastFetchAttemptedAt).toBeUndefined();
    expect(doc.rssFeeds[url].nextFetchAfter).toBeUndefined();
    expect(doc.rssFeeds[url].consecutiveFailures).toBeUndefined();
    expect(doc.rssFeeds[url].lastFetchError).toBeUndefined();
    expect(doc.rssFeeds[url].etag).toBeUndefined();
    expect(doc.rssFeeds[url].lastModified).toBeUndefined();
  });

  it("strips device-local RSS scheduler and HTTP state from feed updates", () => {
    const url = "https://local-update.example/feed";
    let doc = createEmptyDoc();
    doc = A.change(doc, (draft) => {
      addRssFeed(draft, makeFeed({ url, title: "Original" }));
      updateRssFeed(draft, url, {
        title: "Updated",
        lastFetched: 321,
        lastFetchAttemptedAt: 322,
        nextFetchAfter: 654,
        consecutiveFailures: 4,
        lastFetchError: "offline",
        etag: "local-etag",
        lastModified: "today",
      });
    });

    expect(doc.rssFeeds[url].title).toBe("Updated");
    expect(doc.rssFeeds[url].lastFetched).toBe(321);
    expect(doc.rssFeeds[url].lastFetchAttemptedAt).toBeUndefined();
    expect(doc.rssFeeds[url].nextFetchAfter).toBeUndefined();
    expect(doc.rssFeeds[url].consecutiveFailures).toBeUndefined();
    expect(doc.rssFeeds[url].lastFetchError).toBeUndefined();
    expect(doc.rssFeeds[url].etag).toBeUndefined();
    expect(doc.rssFeeds[url].lastModified).toBeUndefined();
  });

  it("retains legacy RSS runtime state across unrelated metadata updates", () => {
    const url = "https://legacy-runtime.example/feed";
    const legacyFeed = makeFeed({
      url,
      title: "Legacy title",
      lastFetched: 123,
      lastFetchAttemptedAt: 124,
      nextFetchAfter: 456,
      consecutiveFailures: 3,
      lastFetchError: "offline",
      etag: "legacy-etag",
      lastModified: "yesterday",
    });
    let doc = createDocFromTrustedCompatibilityData({ rssFeeds: { [url]: legacyFeed } });

    doc = A.change(doc, (draft) => {
      updateRssFeed(draft, url, { title: "Current title" });
    });

    expect(doc.rssFeeds[url]).toMatchObject({
      title: "Current title",
      lastFetched: 123,
      lastFetchAttemptedAt: 124,
      nextFetchAfter: 456,
      consecutiveFailures: 3,
      lastFetchError: "offline",
      etag: "legacy-etag",
      lastModified: "yesterday",
    });
  });
});

describe("removeRssFeed", () => {
  it("removes a feed by URL", () => {
    let doc = createEmptyDoc();
    const url = "https://example.com/feed";
    doc = A.change(doc, (d) => addRssFeed(d, makeFeed({ url, title: "Example" })));
    doc = A.change(doc, (d) => removeRssFeed(d, url));

    expect(doc.rssFeeds[url]).toBeUndefined();
  });
});

describe("reconcileYouTubeCapture", () => {
  it("preserves linked identity and saved video state while reconciling a complete roster", () => {
    let doc = createEmptyDoc();
    doc = A.change(doc, (draft) => {
      addAccounts(draft, [
        makeAccount({
          id: "social:youtube:followed",
          kind: "social",
          provider: "youtube",
          externalId: "followed",
          displayName: "Old followed title",
          discoveredFrom: "follow_roster",
          followRosterActive: true,
        }),
        makeAccount({
          id: "social:youtube:unfollowed",
          kind: "social",
          provider: "youtube",
          externalId: "unfollowed",
          displayName: "Unfollowed",
          discoveredFrom: "follow_roster",
          followRosterActive: true,
        }),
        makeAccount({
          id: "social:x:other",
          kind: "social",
          provider: "x",
          externalId: "other",
          displayName: "Other provider",
        }),
      ]);
      addFeedItem(draft, makeItem({
        globalId: "youtube:yt:video:dQw4w9WgXcQ",
        platform: "youtube",
        userState: { hidden: false, saved: true, archived: false, tags: [] },
      }));
    });

    doc = A.change(doc, (draft) => reconcileYouTubeCapture(
      draft,
      [makeAccount({
        id: "social:youtube:followed",
        kind: "social",
        provider: "youtube",
        externalId: "followed",
        displayName: "Current followed title",
        discoveredFrom: "follow_roster",
        personId: undefined,
      })],
      [makeItem({
        globalId: "youtube:yt:video:dQw4w9WgXcQ",
        platform: "youtube",
        userState: { hidden: false, saved: false, archived: false, tags: [] },
      })],
      { rosterComplete: true, capturedAt: 456 },
    ));

    expect(doc.accounts["social:youtube:followed"]).toMatchObject({
      personId: "person-1",
      displayName: "Current followed title",
      followRosterSyncedAt: 456,
      followRosterActive: true,
    });
    expect(doc.accounts["social:youtube:unfollowed"]).toMatchObject({
      followRosterSyncedAt: 456,
      followRosterActive: false,
    });
    expect(doc.accounts["social:x:other"].followRosterActive).toBeUndefined();
    expect(doc.feedItems["youtube:yt:video:dQw4w9WgXcQ"].userState.saved).toBe(true);
  });

  it("does not infer unfollows from an incomplete website capture", () => {
    let doc = createEmptyDoc();
    doc = A.change(doc, (draft) => {
      addAccounts(draft, [makeAccount({
        id: "social:youtube:existing",
        kind: "social",
        provider: "youtube",
        externalId: "existing",
        displayName: "Existing YouTube channel",
        discoveredFrom: "follow_roster",
        followRosterActive: true,
      })]);
    });

    doc = A.change(doc, (draft) => reconcileYouTubeCapture(
      draft,
      [],
      [],
      { rosterComplete: false, capturedAt: 456 },
    ));

    expect(doc.accounts["social:youtube:existing"]).toMatchObject({
      followRosterActive: true,
    });
  });
});

// =============================================================================
// updatePreferences
// =============================================================================

describe("updatePreferences", () => {
  it("updates ranking weights", () => {
    let doc = createEmptyDoc();
    doc = A.change(doc, (d) =>
      updatePreferences(d, { weights: { ...d.preferences.weights, recency: 80 } })
    );

    expect(doc.preferences.weights.recency).toBe(80);
  });

  it("preserves other preference fields when updating weights", () => {
    let doc = createEmptyDoc();
    const originalCompactMode = doc.preferences.display.compactMode;

    doc = A.change(doc, (d) =>
      updatePreferences(d, { weights: { ...d.preferences.weights, recency: 90 } })
    );

    expect(doc.preferences.display.compactMode).toBe(originalCompactMode);
  });

  it("keeps device-local display updates out of Automerge", () => {
    let doc = createEmptyDoc();
    doc = A.change(doc, (d) =>
      updatePreferences(d, {
        display: {
          sidebarMode: "closed",
          mapMode: "friends",
          friendAvatarTint: "#ff00ff",
          reading: {
            dualColumnMode: false,
            focusMode: true,
          },
        },
      } as never)
    );

    expect(doc.preferences.display.sidebarMode).toBeUndefined();
    expect(doc.preferences.display.mapMode).toBeUndefined();
    expect(doc.preferences.display.friendAvatarTint).toBeUndefined();
    expect(doc.preferences.display.reading.dualColumnMode).toBeUndefined();
    expect(doc.preferences.display.reading.focusMode).toBe(true);
  });

  it("keeps device runtime settings and transient operation status out of Automerge", () => {
    let doc = createEmptyDoc();
    doc = A.change(doc, (d) =>
      updatePreferences(d, {
        sync: { autoBackup: true, backupFrequency: "hourly", cloudProvider: "gdrive" },
        ai: {
          ...d.preferences.ai,
          provider: "ollama",
          model: "qwen",
          ollamaUrl: "http://desktop.local:11434",
          autoSummarize: true,
        },
        storyWall: {
          publishTarget: {
            status: "error",
            lastError: "local failure",
          },
        },
      } as never)
    );

    expect(doc.preferences.sync).toBeUndefined();
    expect(doc.preferences.ai.ollamaUrl).toBeUndefined();
    expect(doc.preferences.ai.provider).toBeUndefined();
    expect(doc.preferences.ai.model).toBeUndefined();
    expect(doc.preferences.ai.autoSummarize).toBe(true);
    expect(doc.preferences.storyWall.publishTarget.status).toBeUndefined();
    expect(doc.preferences.storyWall.publishTarget.lastError).toBeUndefined();
  });
});

describe("legacy identity graph migration", () => {
  function makeLegacyFriend() {
    const now = Date.now();
    return {
      id: "person-1",
      name: "Ada Lovelace",
      sources: [{
        platform: "x" as const,
        authorId: "ada-l",
        handle: "ada",
        displayName: "Ada",
      }],
      careLevel: 3 as const,
      createdAt: now,
      updatedAt: now,
    };
  }

  it("migrates legacy friends into persons and accounts when creating docs from data", () => {
    const base = A.toJS(createEmptyDoc()) as FreedDoc;
    const legacyFriend = makeLegacyFriend();
    const doc = createDocFromTrustedCompatibilityData({
      feedItems: base.feedItems,
      rssFeeds: base.rssFeeds,
      preferences: base.preferences,
      meta: base.meta,
      friends: {
        [legacyFriend.id]: legacyFriend,
      },
    } as unknown as Partial<FreedDoc>);

    expect(doc.persons[legacyFriend.id]?.name).toBe(legacyFriend.name);
    expect(doc.accounts[`${legacyFriend.id}:x:${legacyFriend.sources[0].authorId}`]).toBeDefined();
  });

  it("repairs loaded legacy docs before discovered account writes run", () => {
    const base = A.toJS(createEmptyDoc()) as FreedDoc;
    const legacyFriend = makeLegacyFriend();
    let doc = A.from({
      feedItems: base.feedItems,
      rssFeeds: base.rssFeeds,
      preferences: base.preferences,
      meta: base.meta,
      friends: {
        [legacyFriend.id]: legacyFriend,
      },
    } as Record<string, unknown>) as unknown as FreedDoc;

    expect(hasLegacyIdentityGraphData(doc)).toBe(true);

    doc = A.change(doc, (draft) => {
      migrateLegacyIdentityGraph(draft);
    });

    const discoveredAccount: Account = {
      id: `${legacyFriend.id}:x:new-author`,
      personId: legacyFriend.id,
      kind: "social",
      provider: "x",
      externalId: "new-author",
      handle: "newauthor",
      displayName: "New Author",
      firstSeenAt: legacyFriend.updatedAt,
      lastSeenAt: legacyFriend.updatedAt,
      discoveredFrom: "captured_item",
      createdAt: legacyFriend.updatedAt,
      updatedAt: legacyFriend.updatedAt,
    };

    doc = A.change(doc, (draft) => {
      addAccounts(draft, [discoveredAccount]);
    });

    expect(doc.persons[legacyFriend.id]?.name).toBe(legacyFriend.name);
    expect(doc.accounts[discoveredAccount.id]?.externalId).toBe("new-author");
  });
});

describe("unarchiveSavedItems", () => {
  it("clears stale archived state from saved items only", () => {
    let doc = createEmptyDoc();
    doc = A.change(doc, (d) => {
      addFeedItem(
        d,
        makeItem({
          globalId: "saved-archived",
          userState: {
            hidden: false,
            saved: true,
            savedAt: Date.now(),
            archived: true,
            archivedAt: Date.now(),
            tags: [],
          },
        }),
      );
      addFeedItem(
        d,
        makeItem({
          globalId: "plain-archived",
          userState: {
            hidden: false,
            saved: false,
            archived: true,
            archivedAt: Date.now(),
            tags: [],
          },
        }),
      );
    });

    doc = A.change(doc, (d) => {
      const repaired = unarchiveSavedItems(d);
      expect(repaired).toBe(1);
    });

    expect(doc.feedItems["saved-archived"].userState.archived).toBe(false);
    expect(doc.feedItems["saved-archived"].userState.archivedAt).toBeUndefined();
    expect(doc.feedItems["plain-archived"].userState.archived).toBe(true);
  });
});

describe("liked intent compatibility", () => {
  function mergeLikedStates(
    existing: { likedAt: number; likedSyncedAt?: number },
    incoming: { likedAt: number; likedSyncedAt?: number },
  ): FeedItem["userState"] {
    const globalId = "youtube:liked-intent";
    const existingState: FeedItem["userState"] = {
      hidden: false,
      saved: false,
      archived: false,
      tags: [],
      liked: true,
      likedAt: existing.likedAt,
      ...(existing.likedSyncedAt !== undefined
        ? { likedSyncedAt: existing.likedSyncedAt }
        : {}),
    };
    const incomingState: FeedItem["userState"] = {
      hidden: false,
      saved: false,
      archived: false,
      tags: [],
      liked: true,
      likedAt: incoming.likedAt,
      ...(incoming.likedSyncedAt !== undefined
        ? { likedSyncedAt: incoming.likedSyncedAt }
        : {}),
    };

    let doc = A.change(createEmptyDoc(), "Add existing liked intent", (draft) => {
      draft.feedItems[globalId] = makeItem({ globalId, userState: existingState });
    });
    doc = A.change(doc, "Merge captured liked intent", (draft) => {
      reconcileYouTubeCapture(
        draft,
        [],
        [makeItem({ globalId, userState: incomingState })],
        { rosterComplete: false, capturedAt: 2_000 },
      );
    });
    return A.toJS(doc).feedItems[globalId].userState;
  }

  it.each([-1, 150])(
    "keeps a newer like intent independent of older sync status %s",
    (olderSyncStatus) => {
      const oldIntent = { likedAt: 100, likedSyncedAt: olderSyncStatus };
      const newIntent = { likedAt: 200 };

      expect(mergeLikedStates(oldIntent, newIntent)).toMatchObject({
        likedAt: 200,
      });
      expect(mergeLikedStates(oldIntent, newIntent).likedSyncedAt).toBeUndefined();

      expect(mergeLikedStates(newIntent, oldIntent)).toMatchObject({
        likedAt: 200,
      });
      expect(mergeLikedStates(newIntent, oldIntent).likedSyncedAt).toBeUndefined();
    },
  );

  it("keeps an existing historical failure without importing a new negative marker", () => {
    const terminalIntent = { likedAt: 100, likedSyncedAt: -1 };
    const sameIntent = { likedAt: 100 };

    expect(mergeLikedStates(terminalIntent, sameIntent).likedSyncedAt).toBe(-1);
    expect(mergeLikedStates(sameIntent, terminalIntent).likedSyncedAt).toBeUndefined();
  });

  it("preserves a historical failure marker already present in Automerge history", () => {
    const globalId = "youtube:legacy-failure";
    const base = A.change(createEmptyDoc(), (draft) => {
      addFeedItem(draft, makeItem({
        globalId,
        userState: {
          hidden: false,
          saved: false,
          archived: false,
          tags: [],
          liked: true,
          likedAt: 100,
        },
      }));
    });
    const legacy = A.change(A.clone(base), (draft) => {
      draft.feedItems[globalId].userState.likedSyncedAt = -1;
    });
    const current = A.change(A.clone(base), (draft) => {
      draft.preferences.display.showEngagementCounts = true;
    });

    expect(A.merge(current, legacy).feedItems[globalId].userState.likedSyncedAt).toBe(-1);
  });
});

// =============================================================================
// Automerge CRDT merge semantics (simulates desktop→PWA sync)
// =============================================================================

describe("Automerge merge / sync simulation", () => {
  it("merges diverged documents from a shared ancestor (desktop→PWA sync)", () => {
    // Correct sync semantics: PWA starts by receiving the desktop's doc,
    // then both devices diverge and are merged back together.
    let desktop = createEmptyDoc();
    desktop = A.change(desktop, (d) =>
      addFeedItem(d, makeItem({ globalId: "desktop-item-1" }))
    );

    // PWA initializes from the desktop's serialized doc (simulates first sync)
    let pwa = A.load<FreedDoc>(A.save(desktop));

    // Both devices make independent changes
    desktop = A.change(desktop, (d) =>
      addFeedItem(d, makeItem({ globalId: "desktop-item-2" }))
    );
    pwa = A.change(pwa, (d) =>
      addFeedItem(d, makeItem({ globalId: "pwa-item-1" }))
    );

    // Merge: all items from both sides should be present
    const merged = A.merge(pwa, desktop);

    expect(merged.feedItems["desktop-item-1"]).toBeDefined();
    expect(merged.feedItems["desktop-item-2"]).toBeDefined();
    expect(merged.feedItems["pwa-item-1"]).toBeDefined();
  });

  it("blocks a merge that would delete most of a much larger document", () => {
    let trusted = createEmptyDoc();
    trusted = A.change(trusted, (d) => {
      for (let i = 0; i < 600; i += 1) {
        addFeedItem(d, makeItem({ globalId: `trusted-item-${i}` }));
      }
    });

    let deleteHeavy = A.clone(trusted);
    deleteHeavy = A.change(deleteHeavy, (d) => {
      for (let i = 20; i < 600; i += 1) {
        delete d.feedItems[`trusted-item-${i}`];
      }
    });

    const merged = A.merge(trusted, deleteHeavy);
    const report = evaluateDestructiveMergeGuard(trusted, deleteHeavy, merged, {
      source: "test sync",
    });

    expect(report).toMatchObject({
      blocked: true,
      largestInputItemCount: 600,
      mergedItemCount: 20,
      deletedItemCount: 580,
    });
    expect(() =>
      assertNonDestructiveMerge(trusted, deleteHeavy, merged, { source: "test sync" }),
    ).toThrow(/Freed blocked a sync merge/);
  });

  it("blocks stale delete history from emptying a populated peer", () => {
    let populated = createEmptyDoc();
    populated = A.change(populated, (d) => {
      addRssFeed(d, makeFeed({ url: "https://example.com/feed.xml", title: "Example" }));
      for (let i = 0; i < 600; i += 1) {
        addFeedItem(d, makeItem({ globalId: `cloud-item-${i}` }));
      }
    });

    let staleEmpty = A.clone(populated);
    staleEmpty = A.change(staleEmpty, (d) => {
      for (const id of Object.keys(d.feedItems)) {
        delete d.feedItems[id];
      }
      for (const url of Object.keys(d.rssFeeds)) {
        delete d.rssFeeds[url];
      }
    });

    const merged = A.merge(staleEmpty, populated);
    expect(Object.keys(merged.feedItems)).toHaveLength(0);
    expect(() =>
      assertNonDestructiveMerge(staleEmpty, populated, merged, { source: "test sync" }),
    ).toThrow(/Freed blocked a sync merge/);
  });

  it("keeps native local RSS and preferences when stale feed deletion wins the merge", () => {
    let populated = createEmptyDoc();
    populated = A.change(populated, (d) => {
      addRssFeed(d, makeFeed({ url: "https://example.com/feed.xml", title: "Example" }));
      for (let i = 0; i < 600; i += 1) {
        addFeedItem(d, makeItem({ globalId: `cloud-item-${i}` }));
      }
    });

    let staleFeedEmpty = A.clone(populated);
    staleFeedEmpty = A.change(staleFeedEmpty, (d) => {
      for (const id of Object.keys(d.feedItems)) {
        delete d.feedItems[id];
      }
      d.rssFeeds["https://local.example/feed.xml"] = makeFeed({
        url: "https://local.example/feed.xml",
        title: "Local only",
      });
      d.preferences.display.themeId = "midas";
      d.preferences.display.showEngagementCounts = true;
      d.preferences.weights.recency = 73;
    });

    const merged = A.merge(staleFeedEmpty, populated);
    expect(Object.keys(merged.feedItems)).toHaveLength(0);
    expect(Object.keys(merged.rssFeeds).length).toBeGreaterThan(0);
    expect(merged.rssFeeds["https://local.example/feed.xml"]?.title).toBe("Local only");
    expect(merged.preferences.display.themeId).toBe("midas");
    expect(merged.preferences.display.showEngagementCounts).toBe(true);
    expect(merged.preferences.weights.recency).toBe(73);

    expect(() =>
      assertNonDestructiveMerge(staleFeedEmpty, populated, merged, { source: "test sync" }),
    ).toThrow(/Freed blocked a sync merge/);
  });

  it("leaves a nonempty merged library root unchanged", () => {
    const base = createEmptyDoc();
    let local = A.clone(base);
    local = A.change(local, (d) => {
      addFeedItem(d, makeItem({ globalId: "local-item" }));
    });

    let incoming = A.clone(base);
    incoming = A.change(incoming, (d) => {
      addFeedItem(d, makeItem({ globalId: "incoming-item" }));
    });

    const merged = A.merge(local, incoming);
    expect(Object.keys(merged.feedItems).sort()).toEqual(["incoming-item", "local-item"]);
  });

  it.each(["feedItems", "rssFeeds", "persons", "accounts"] as const)(
    "keeps an intentional local-ahead delete of the final %s entry",
    (root) => {
      let base = createEmptyDoc();
      base = A.change(base, `Seed ${root}`, (draft) => {
        switch (root) {
          case "feedItems":
            addFeedItem(draft, makeItem({ globalId: "last-feed-item" }));
            break;
          case "rssFeeds":
            addRssFeed(draft, makeFeed({
              url: "https://example.com/last.xml",
              title: "Last feed",
            }));
            break;
          case "persons":
            addPerson(draft, {
              id: "last-person",
              name: "Last Person",
              relationshipStatus: "friend",
              careLevel: 3,
              createdAt: 1,
              updatedAt: 1,
            });
            break;
          case "accounts":
            addAccounts(draft, [makeAccount({
              id: "last-account",
              kind: "social",
              provider: "x",
              externalId: "last-account",
            })]);
            break;
        }
      });
      const localAhead = A.change(A.clone(base), `Delete ${root}`, (draft) => {
        const entries = draft[root] as Record<string, unknown>;
        for (const key of Object.keys(entries)) delete entries[key];
      });
      const merged = A.merge(localAhead, base);

      expect(compareDocumentHistories(localAhead, base)).toBe("local-ahead");
      expect(Object.keys(merged[root])).toHaveLength(0);
      expect(() =>
        assertNonDestructiveMerge(localAhead, base, merged, { source: "test sync" }),
      ).not.toThrow();
    },
  );

  it("creates structured-cloneable Automerge views for large PWA hydration", () => {
    let doc = createEmptyDoc();
    doc = A.change(doc, (d) => {
      addRssFeed(d, makeFeed({ url: "https://example.com/feed.xml", title: "Example" }));
      for (let i = 0; i < 1_500; i += 1) {
        addFeedItem(d, makeItem({
          globalId: `cloud-item-${i}`,
          publishedAt: 10_000 - i,
          content: {
            text: `Cloud item ${i}`,
            mediaUrls: [],
            mediaTypes: [],
          },
        }));
      }
    });

    const view = A.view(doc, A.getHeads(doc)) as FreedDoc;
    const cloned = structuredClone({
      items: Object.values(view.feedItems),
      feeds: view.rssFeeds,
      persons: view.persons,
      accounts: view.accounts,
    });

    expect(cloned.items).toHaveLength(1_500);
    expect(cloned.items[0]).toMatchObject({ globalId: "cloud-item-0" });
    expect(Object.keys(cloned.feeds)).toEqual(["https://example.com/feed.xml"]);
  });

  it("serializes and deserializes without data loss", () => {
    let doc = createEmptyDoc();
    doc = A.change(doc, (d) => {
      addFeedItem(d, makeItem({ globalId: "item-1" }));
      addFeedItem(d, makeItem({ globalId: "item-2" }));
      addRssFeed(d, makeFeed({ url: "https://example.com/feed", title: "Example" }));
    });

    const binary = A.save(doc);
    const reloaded = A.load<FreedDoc>(binary);

    expect(Object.keys(reloaded.feedItems)).toHaveLength(2);
    expect(Object.keys(reloaded.rssFeeds)).toHaveLength(1);
  });

  it("last-write-wins for concurrent userState changes to the same item", () => {
    // Both devices mark same item as read at different times
    let docA = createEmptyDoc();
    docA = A.change(docA, (d) => addFeedItem(d, makeItem({ globalId: "shared-item" })));

    // B branches from A
    let docB = A.clone(docA);

    // A marks as read at t=1000
    docA = A.change(docA, (d) => {
      d.feedItems["shared-item"].userState.readAt = 1000;
    });

    // B marks as read at t=2000 (later)
    docB = A.change(docB, (d) => {
      d.feedItems["shared-item"].userState.readAt = 2000;
    });

    // Merge A into B — both changes should be present via CRDT
    const merged = A.merge(docB, docA);

    // Both changes exist; the document should have readAt set
    expect(merged.feedItems["shared-item"].userState.readAt).toBeDefined();
  });

  it("preserves concurrent Freed Desktop registrations across a merge", () => {
    const base = createEmptyDoc();
    const firstDesktop = registerDesktopClient(base, {
      id: "desktop-first",
      registeredAt: 1000,
    });
    const secondDesktop = registerDesktopClient(A.clone(base), {
      id: "desktop-second",
      registeredAt: 2000,
    });

    const merged = A.merge(firstDesktop, secondDesktop);

    expect(getRegisteredDesktopClientIds(merged)).toEqual([
      "desktop-first",
      "desktop-second",
    ]);
  });

  it("preserves registrations when two fresh Freed Desktop libraries merge", () => {
    const firstDesktop = registerDesktopClient(createEmptyDoc(), {
      id: "desktop-first",
      registeredAt: 1000,
    });
    const secondDesktop = registerDesktopClient(createEmptyDoc(), {
      id: "desktop-second",
      registeredAt: 2000,
    });

    expect(getRegisteredDesktopClientIds(A.merge(firstDesktop, secondDesktop))).toEqual([
      "desktop-first",
      "desktop-second",
    ]);
  });

  it("preserves Freed Desktop registrations when compacting into a fresh document", () => {
    const registered = registerDesktopClient(createEmptyDoc(), {
      id: "desktop-first",
      registeredAt: 1000,
    });

    const rebuilt = createDocFromTrustedCompatibilityData(A.toJS(registered) as FreedDoc);

    expect(getRegisteredDesktopClientIds(rebuilt)).toEqual(["desktop-first"]);
    expect(registerDesktopClient(rebuilt, {
      id: "desktop-first",
      registeredAt: 2000,
    })).toBe(rebuilt);
  });

  it("repairs a malformed reserved registration that blocks the current installation", () => {
    const malformed = A.change(createEmptyDoc(), (draft) => {
      (draft as unknown as Record<string, unknown>)["desktopClient:desktop-current"] = "invalid";
    });

    const repaired = registerDesktopClient(malformed, {
      id: "desktop-current",
      registeredAt: 1000,
    });

    expect(getRegisteredDesktopClientIds(repaired)).toEqual(["desktop-current"]);
    expect((A.toJS(repaired) as unknown as Record<string, unknown>)["desktopClient:desktop-current"])
      .toEqual({ id: "desktop-current", registeredAt: 1000 });
  });

  it("does not alter future roots when no library recovery is needed", () => {
    const base = createEmptyDoc();
    const source = A.change(A.clone(base), (draft) => {
      const root = draft as unknown as Record<string, unknown>;
      root["desktopClient:desktop-future"] = {
        id: "desktop-future",
        registeredAt: 1000,
        futureCapability: { version: 2 },
      };
      root.futureLibraryState = {
        version: 2,
        values: ["survives", "adoption"],
      };
    });

    const merged = A.merge(base, source);
    const preserved = merged;
    expect(preserved).toBe(merged);
    const preservedPlain = A.toJS(preserved) as unknown as Record<string, unknown>;
    const registration = preservedPlain[
      "desktopClient:desktop-future"
    ];

    expect(registration).toEqual({
      id: "desktop-future",
      registeredAt: 1000,
      futureCapability: { version: 2 },
    });
    expect(preservedPlain.futureLibraryState).toEqual({
      version: 2,
      values: ["survives", "adoption"],
    });
  });

  it("preserves unknown future roots when compacting trusted document data", () => {
    const withFutureRoot = A.change(createEmptyDoc(), (draft) => {
      (draft as unknown as Record<string, unknown>).futureLibraryState = {
        version: 2,
        values: ["keep", "this"],
      };
    });
    const plain = A.toJS(withFutureRoot) as Partial<FreedDoc> & Record<string, unknown>;
    plain.friends = {};
    plain["desktopClient:malformed"] = { id: "different-id" };

    const rebuilt = createDocFromTrustedCompatibilityData(plain);
    const rebuiltPlain = A.toJS(rebuilt) as unknown as Record<string, unknown>;

    expect(rebuiltPlain.futureLibraryState).toEqual({
      version: 2,
      values: ["keep", "this"],
    });
    expect(rebuiltPlain.friends).toBeUndefined();
    expect(rebuiltPlain["desktopClient:malformed"]).toBeUndefined();
  });

  it("preserves registrations when an incoming populated document replaces stale empty local state", () => {
    let base = createEmptyDoc();
    base = A.change(base, (draft) => {
      addFeedItem(draft, makeItem({ globalId: "incoming-item" }));
    });
    let staleEmpty = registerDesktopClient(A.clone(base), {
      id: "desktop-stale-local",
      registeredAt: 1000,
    });
    const incoming = registerDesktopClient(A.clone(base), {
      id: "desktop-incoming",
      registeredAt: 2000,
    });
    staleEmpty = A.change(staleEmpty, (draft) => {
      for (const id of Object.keys(draft.feedItems)) {
        delete draft.feedItems[id];
      }
    });

    const merged = A.merge(staleEmpty, incoming);
    const adopted = merged;
    const reloaded = A.load<FreedDoc>(A.save(adopted));

    expect(getRegisteredDesktopClientIds(reloaded)).toEqual([
      "desktop-incoming",
      "desktop-stale-local",
    ]);
  });

  it("preserves registrations when populated local state wins over an empty incoming document", () => {
    let local = registerDesktopClient(createEmptyDoc(), {
      id: "desktop-local",
      registeredAt: 1000,
    });
    local = A.change(local, (draft) => {
      addFeedItem(draft, makeItem({ globalId: "local-item" }));
    });
    const incomingEmpty = registerDesktopClient(createEmptyDoc(), {
      id: "desktop-empty-incoming",
      registeredAt: 2000,
    });

    const merged = A.merge(local, incomingEmpty);
    const adopted = merged;
    const reloaded = A.load<FreedDoc>(A.save(adopted));

    expect(getRegisteredDesktopClientIds(reloaded)).toEqual([
      "desktop-empty-incoming",
      "desktop-local",
    ]);
  });

  it("leaves feed and compatibility deletions to native Automerge history", () => {
    let base = createEmptyDoc();
    base = A.change(base, "Seed shared future root", (draft) => {
      addFeedItem(draft, makeItem({ globalId: "shared-item" }));
      const root = draft as unknown as Record<string, unknown>;
      root.futureLibraryState = {
        fromLocal: 0,
        fromIncoming: 0,
      };
      root.futureRemovedState = {
        values: ["restore", "me"],
      };
    });
    base = registerDesktopClient(base, {
      id: "desktop-shared",
      registeredAt: 1000,
    });

    const populated = A.change(A.clone(base), "Update future root locally", (draft) => {
      const future = (draft as unknown as Record<string, unknown>)
        .futureLibraryState as Record<string, number>;
      future.fromLocal = 1;
    });
    const staleEmpty = A.change(A.clone(base), "Delete library and update future root", (draft) => {
      delete draft.feedItems["shared-item"];
      const root = draft as unknown as Record<string, unknown>;
      delete root.futureRemovedState;
      delete root["desktopClient:desktop-shared"];
      const future = root.futureLibraryState as Record<string, number>;
      future.fromIncoming = 1;
    });

    const merged = A.merge(populated, staleEmpty);
    const restored = merged;
    const plain = A.toJS(restored) as unknown as Record<string, unknown>;

    expect(restored.feedItems["shared-item"]).toBeUndefined();
    expect(plain.futureLibraryState).toEqual({
      fromLocal: 1,
      fromIncoming: 1,
    });
    expect(plain.futureRemovedState).toBeUndefined();
    expect(getRegisteredDesktopClientIds(restored)).toEqual([]);
  });

  it("compares Automerge history containment without materializing a merge", () => {
    const base = createEmptyDoc();
    const localAhead = A.change(A.clone(base), "Local change", (draft) => {
      draft.preferences.display.themeId = "midas";
    });
    const incomingAhead = A.change(A.clone(localAhead), "Incoming change", (draft) => {
      draft.preferences.display.showEngagementCounts = true;
    });
    const diverged = A.change(A.clone(base), "Diverged change", (draft) => {
      draft.preferences.display.themeId = "ember";
    });

    expect(compareDocumentHistories(base, A.clone(base))).toBe("equal");
    expect(compareDocumentHistories(localAhead, base)).toBe("local-ahead");
    expect(compareDocumentHistories(localAhead, incomingAhead)).toBe("incoming-ahead");
    expect(compareDocumentHistories(localAhead, diverged)).toBe("diverged");
  });

  it("preserves future content-signal scores and tags during older enrichment", () => {
    let doc = createEmptyDoc();
    doc = A.change(doc, "Add signal item", (draft) => {
      addFeedItem(draft, makeItem({ globalId: "future-signal-item" }));
    });
    doc = A.change(doc, "Add future signal values", (draft) => {
      const signals = draft.feedItems["future-signal-item"].contentSignals;
      if (!signals) throw new Error("Expected inferred content signals");
      (signals.scores as Record<string, number>).future_signal = 0.91;
      (signals.tags as string[]).push("future_signal");
    });
    doc = A.change(doc, "Refresh known signal values", (draft) => {
      updateFeedItem(draft, "future-signal-item", {
        contentSignals: {
          version: CONTENT_SIGNAL_VERSION,
          method: "rules",
          inferredAt: 2_000,
          scores: { event: 0.8 },
          tags: ["event"],
        },
      });
    });

    const signals = doc.feedItems["future-signal-item"].contentSignals;
    expect(signals?.scores).toMatchObject({ event: 0.8, future_signal: 0.91 });
    expect(signals?.tags).toEqual(["event", "future_signal"]);
  });

  it("ignores malformed root registrations without reporting a duplicate Desktop client", () => {
    let doc = registerDesktopClient(createEmptyDoc(), {
      id: "desktop-valid",
      registeredAt: 1000,
    });
    doc = A.change(doc, (draft) => {
      (draft as unknown as Record<string, unknown>)["desktopClient:desktop-malformed"] = {
        id: "desktop-malformed",
      };
      (draft as unknown as Record<string, unknown>)["desktopClient:wrong-key"] = {
        id: "desktop-other",
        registeredAt: 2000,
      };
    });

    const reloaded = A.load<FreedDoc>(A.save(doc));

    expect(getRegisteredDesktopClientIds(reloaded)).toEqual(["desktop-valid"]);
  });

  it("supports bulk add (docAddFeedItems pattern) efficiently", () => {
    let doc = createEmptyDoc();
    const items = Array.from({ length: 50 }, (_, i) =>
      makeItem({ globalId: `item-${i}`, publishedAt: Date.now() - i * 60000 })
    );

    doc = A.change(doc, (d) => {
      for (const item of items) {
        if (!d.feedItems[item.globalId]) {
          addFeedItem(d, item);
        }
      }
    });

    expect(Object.keys(doc.feedItems)).toHaveLength(50);

    // Re-adding same items should not create duplicates (guard in the change fn)
    doc = A.change(doc, (d) => {
      for (const item of items) {
        if (!d.feedItems[item.globalId]) {
          addFeedItem(d, item);
        }
      }
    });

    expect(Object.keys(doc.feedItems)).toHaveLength(50);
  });
});
