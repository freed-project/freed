import { describe, expect, it } from "vitest";
import type { FeedItem } from "@freed/shared";
import { renderFeedItemReaderHtml } from "./reader-item-html";

function item(): FeedItem {
  return {
    globalId: "substack:essay:reader-media",
    platform: "substack",
    contentType: "article",
    capturedAt: 1,
    publishedAt: 1,
    author: { id: "writer", handle: "writer", displayName: "Writer" },
    content: {
      mediaUrls: [
        "https://cdn.example.com/cover.jpg",
        "https://cdn.example.com/interview.mp4",
        "https://example.com/source?a=1&b=2",
        "javascript:alert(1)",
      ],
      mediaTypes: ["image", "video", "link", "link"],
    },
    userState: { hidden: false, saved: false, archived: false, tags: [] },
    topics: [],
  };
}

describe("reader item HTML", () => {
  it("renders link media as a safe link instead of a broken image", () => {
    const html = renderFeedItemReaderHtml(item());

    expect(html).toContain('<img src="https://cdn.example.com/cover.jpg"');
    expect(html).toContain('<video src="https://cdn.example.com/interview.mp4"');
    expect(html).toContain(
      '<a href="https://example.com/source?a=1&amp;b=2" target="_blank" rel="noreferrer noopener">https://example.com/source?a=1&amp;b=2</a>',
    );
    expect(html).not.toContain('<img src="https://example.com/source');
    expect(html).not.toContain("javascript:");
  });
});
