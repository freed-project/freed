import { describe, expect, it } from "vitest";

import {
  sanitizeFeedItemWrite,
  sanitizeRssFeedWrite,
  sanitizeUserPreferenceWrite,
} from "./sync-write-policy.js";
import type { RssFeed, UserPreferences } from "./types.js";

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
