// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { extractMetadataBrowser } from "./browser.js";
import { buildSavedFeedItem } from "./normalize.js";

const url = "https://example.com/article";
const validDate = "2026-01-02T03:04:05.000Z";

describe("article publication timestamps", () => {
  it.each(['property="article:published_time"', 'name="date"'])(
    "rejects invalid %s and preserves valid dates through the real browser extractor",
    (selector) => {
      expect(extractMetadataBrowser(`<meta ${selector} content="not-a-date">`, url).publishedAt)
        .toBeUndefined();
      expect(extractMetadataBrowser(`<meta ${selector} content="${validDate}">`, url).publishedAt)
        .toBe(Date.parse(validDate));
      expect(extractMetadataBrowser(`<meta ${selector} content="">`, url).publishedAt)
        .toBeUndefined();
      expect(extractMetadataBrowser("<title>No date</title>", url).publishedAt)
        .toBeUndefined();
    },
  );

  it.each([NaN, Infinity, -Infinity, undefined, 0, Date.parse(validDate)])(
    "guards both saved-item publication dates for %s",
    (publishedAt) => {
      const now = 1_800_000_000_000;
      const item = buildSavedFeedItem(
        { url, title: "Article", publishedAt },
        { html: "<p>Article</p>", text: "Article", wordCount: 1, readingTime: 1 },
        { now },
      );
      expect(item.publishedAt).toBe(Number.isFinite(publishedAt) ? publishedAt : now);
      expect(Number.isFinite(item.publishedAt)).toBe(true);
      if (Number.isFinite(publishedAt)) {
        expect(item.preservedContent?.publishedAt).toBe(publishedAt);
      } else {
        expect(item.preservedContent).toBeDefined();
        expect(item.preservedContent).not.toHaveProperty("publishedAt");
      }
    },
  );
});
