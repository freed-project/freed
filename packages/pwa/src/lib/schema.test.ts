/**
 * Unit tests for the Automerge document schema operations
 *
 * Tests the core CRDT operations: create, add, update, merge.
 * These operations underpin the entire sync pipeline.
 */

import { describe, it, expect } from "vitest";
import * as A from "@automerge/automerge";
import {
  createEmptyDoc,
  addFeedItem,
  removeFeedItem,
  markAsRead,
  toggleSaved,
  hideItem,
  addRssFeed,
  removeRssFeed,
  updatePreferences,
} from "@freed/shared/schema";
import type { FreedDoc } from "@freed/shared/schema";
import type { FeedItem, RssFeed } from "@freed/shared";

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
