import { describe, expect, it } from "vitest";
import type { FeedItem } from "../types.js";
import PARITY_CASES from "./search-parity-v1.json" with { type: "json" };
import {
  LIBRARY_CORE_SEARCH_RESULT_MAXIMUM_BYTES,
  projectLibraryCoreSearchResultItemV1,
  scoreLibraryCoreSearchFieldsV1,
  tokenizeLibraryCoreSearchTextV1,
} from "./search-contracts.js";

describe("Library Core search contract", () => {
  it("keeps normalization and scoring bound to the native parity vectors", () => {
    for (const fixture of PARITY_CASES) {
      const queryTerms = tokenizeLibraryCoreSearchTextV1(fixture.query, 32);
      expect(queryTerms).toEqual(fixture.queryTerms);
      const fields = fixture.fields.map(({ value, weight }) => ({
        terms: tokenizeLibraryCoreSearchTextV1(value),
        weight,
      }));
      expect(scoreLibraryCoreSearchFieldsV1(fields, queryTerms)).toBeCloseTo(
        fixture.score,
        10,
      );
    }
  });

  it("projects a legal large item into a bounded transient result", () => {
    const item = {
      globalId: "rss:large",
      platform: "rss",
      contentType: "article",
      capturedAt: 1,
      publishedAt: 1,
      author: {
        id: "author",
        handle: "author",
        displayName: "Author",
        avatarUrl: "x".repeat(20_000),
      },
      content: {
        text: "😀".repeat(1_000_000),
        mediaUrls: Array.from({ length: 100 }, () => "u".repeat(10_000)),
        mediaTypes: Array.from({ length: 100 }, () => "image"),
      },
      userState: {
        hidden: false,
        saved: false,
        archived: false,
        tags: Array.from({ length: 100 }, () => "t".repeat(10_000)),
        highlights: Array.from({ length: 100 }, () => ({
          text: "h".repeat(10_000),
          note: "n".repeat(10_000),
          createdAt: 1,
        })),
      },
      topics: Array.from({ length: 100 }, () => "p".repeat(10_000)),
      preservedContent: {
        html: "<p>large</p>".repeat(100_000),
        text: "z".repeat(100_000),
        wordCount: 1,
        readingTime: 1,
        preservedAt: 1,
      },
    } as FeedItem;
    const projected = projectLibraryCoreSearchResultItemV1(item);
    const bytes = new TextEncoder().encode(JSON.stringify(projected));
    expect(bytes.byteLength).toBeLessThanOrEqual(
      LIBRARY_CORE_SEARCH_RESULT_MAXIMUM_BYTES,
    );
    expect(projected.preservedContent?.html).toBeUndefined();
    expect(projected.content.mediaUrls).toHaveLength(4);
    expect(projected.userState.highlights).toHaveLength(8);
  });
});
