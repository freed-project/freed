import { describe, expect, it } from "vitest";

import {
  sanitizeFeedItemCaptureWrite,
  sanitizeFeedItemWrite,
  sanitizeRssFeedWrite,
  sanitizeUserPreferenceWrite,
} from "./sync-write-policy.js";
import type { FeedItem, RssFeed, UserPreferences } from "./types.js";

describe("synchronized write policy", () => {
  it("retains normalized nested content and excludes Primary-derived ranking", () => {
    const sanitized = sanitizeFeedItemWrite({
      content: { text: "kept", mediaUrls: [], mediaTypes: [] },
      preservedContent: {
        text: "also kept",
        preservedAt: 1,
        wordCount: 2,
        readingTime: 1,
      },
      priority: 10,
      priorityComputedAt: 20,
    });

    expect(sanitized.content).toBeDefined();
    expect(sanitized.preservedContent).toBeDefined();
    expect(sanitized).not.toHaveProperty("priority");
    expect(sanitized).not.toHaveProperty("priorityComputedAt");
  });

  it("projects one capture shape without analysis or annotation side channels", () => {
    const captured = sanitizeFeedItemCaptureWrite({
      contentSignals: { scores: { technical: 1 }, tags: ["technical"] },
      eventCandidate: { confidence: 0.9, isEvent: true },
      globalId: "item-1",
      userState: {
        archived: false,
        hidden: false,
        highlights: [{ end: 4, start: 0, text: "test" }],
        saved: true,
        tags: ["private"],
      },
    } as unknown as FeedItem);

    expect(captured).not.toHaveProperty("contentSignals");
    expect(captured).not.toHaveProperty("eventCandidate");
    expect(captured.userState).not.toHaveProperty("highlights");
    expect(captured.userState.tags).toEqual([]);
    expect(captured.userState.saved).toBe(true);
  });

  it("drops obsolete document-era preference and RSS fields", () => {
    const preferences = sanitizeUserPreferenceWrite({
      display: {
        itemsPerPage: 500,
        compactMode: true,
        friendAvatarTint: "red",
        showEngagementCounts: true,
      },
      sync: { cloudProvider: "gdrive", autoBackup: true },
    } as unknown as Partial<UserPreferences>);
    const feed = sanitizeRssFeedWrite({
      url: "https://example.com/feed.xml",
      etag: "retired-etag",
      lastModified: "yesterday",
    } as unknown as Partial<RssFeed>);

    expect(preferences).toStrictEqual({
      display: { showEngagementCounts: true },
    });
    expect(feed).toStrictEqual({ url: "https://example.com/feed.xml" });
  });
});
