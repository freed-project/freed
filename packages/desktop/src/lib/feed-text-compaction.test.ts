import { describe, expect, it } from "vitest";
import type { FeedItem } from "@freed/shared";
import {
  SYNC_CONTENT_TEXT_LIMIT,
  SYNC_PRESERVED_TEXT_LIMIT,
  compactFeedItemTextForSync,
  compactFeedItemsTextForSync,
  formatFeedTextCompactionSummary,
} from "./feed-text-compaction";

function makeItem(overrides: Partial<FeedItem> = {}): FeedItem {
  return {
    globalId: "rss:item",
    platform: "rss",
    contentType: "article",
    capturedAt: 1,
    publishedAt: 1,
    author: { id: "author", handle: "author", displayName: "Author" },
    content: {
      text: "short",
      mediaUrls: [],
      mediaTypes: [],
      linkPreview: { url: "https://example.com/article" },
    },
    preservedContent: {
      text: "summary",
      html: "<article>full</article>",
      wordCount: 1,
      readingTime: 1,
      preservedAt: 1,
    },
    userState: {
      hidden: false,
      saved: false,
      archived: false,
      tags: [],
    },
    topics: [],
    ...overrides,
  };
}

describe("feed text compaction", () => {
  it("caps synced feed body text and strips local html", () => {
    const item = makeItem({
      content: {
        text: "a".repeat(SYNC_CONTENT_TEXT_LIMIT + 50),
        mediaUrls: [],
        mediaTypes: [],
        linkPreview: { url: "https://example.com/article" },
      },
      preservedContent: {
        text: "b".repeat(SYNC_PRESERVED_TEXT_LIMIT + 75),
        html: "<article>local only</article>",
        wordCount: 2_000,
        readingTime: 8,
        preservedAt: 1,
      },
    });

    const summary = compactFeedItemTextForSync(item);

    expect(item.content.text).toHaveLength(SYNC_CONTENT_TEXT_LIMIT);
    expect(item.preservedContent?.text).toHaveLength(SYNC_PRESERVED_TEXT_LIMIT);
    expect(item.preservedContent).not.toHaveProperty("html");
    expect(summary).toMatchObject({
      scanned: 1,
      changed: 1,
      contentTextTrimmed: 50,
      preservedTextTrimmed: 75,
      htmlFieldsRemoved: 1,
    });
  });

  it("keeps compact items unchanged", () => {
    const item = makeItem({
      preservedContent: {
        text: "summary",
        wordCount: 1,
        readingTime: 1,
        preservedAt: 1,
      },
    });

    const summary = compactFeedItemTextForSync(item);

    expect(item.content.text).toBe("short");
    expect(item.preservedContent?.text).toBe("summary");
    expect(summary).toMatchObject({
      scanned: 1,
      changed: 0,
      contentTextTrimmed: 0,
      preservedTextTrimmed: 0,
      htmlFieldsRemoved: 0,
    });
  });

  it("summarizes batch compaction for diagnostics", () => {
    const summary = compactFeedItemsTextForSync([
      makeItem({
        content: {
          text: "a".repeat(SYNC_CONTENT_TEXT_LIMIT + 10),
          mediaUrls: [],
          mediaTypes: [],
        },
      }),
      makeItem({ globalId: "rss:other" }),
    ]);

    expect(summary.scanned).toBe(2);
    expect(summary.changed).toBe(2);
    expect(summary.contentTextTrimmed).toBe(10);
    expect(summary.htmlFieldsRemoved).toBe(2);
    expect(formatFeedTextCompactionSummary(summary)).toContain("2 of 2 items compacted");
  });
});
