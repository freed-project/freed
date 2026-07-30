import { describe, expect, it } from "vitest";

import {
  matchesLibraryCoreFeedBrowseFilterV1,
  normalizeLibraryCoreFeedBrowseFilterV1,
} from "./feed-browse-filter-contract.js";
import type { FeedItem } from "../types.js";

function item(overrides: Partial<FeedItem> = {}): FeedItem {
  return {
    author: { id: "author-1", name: "Author" },
    capturedAt: 1,
    content: { mediaTypes: [], mediaUrls: [], text: "hello" },
    contentSignals: {
      inferredAt: 1,
      method: "rules",
      scores: {},
      tags: ["essay", "news"],
      version: 1,
    },
    contentType: "post",
    globalId: "x:1",
    platform: "x",
    publishedAt: 1,
    topics: [],
    userState: {
      archived: false,
      hidden: false,
      saved: true,
      tags: ["favorite", "work"],
    },
    ...overrides,
  } as FeedItem;
}

describe("Library Core feed browse filter contract", () => {
  it("pins every product filter branch in one table", () => {
    const cases: ReadonlyArray<{
      expected: boolean;
      filter?: Parameters<typeof normalizeLibraryCoreFeedBrowseFilterV1>[0];
      value?: FeedItem;
    }> = [
      { expected: true },
      {
        expected: false,
        value: item({
          userState: {
            archived: false,
            hidden: true,
            saved: true,
            tags: ["favorite"],
          },
        }),
      },
      {
        expected: true,
        filter: { showHidden: true },
        value: item({
          userState: {
            archived: false,
            hidden: true,
            saved: true,
            tags: [],
          },
        }),
      },
      {
        expected: false,
        value: item({
          userState: {
            archived: true,
            hidden: false,
            saved: true,
            tags: [],
          },
        }),
      },
      {
        expected: true,
        filter: { archivedOnly: true },
        value: item({
          userState: {
            archived: true,
            hidden: false,
            saved: false,
            tags: [],
          },
        }),
      },
      { expected: true, filter: { platform: "x" } },
      { expected: false, filter: { platform: "facebook" } },
      {
        expected: true,
        filter: { platform: "rss" },
        value: item({
          platform: "substack",
          rssSource: {
            feedTitle: "Example",
            feedUrl: "https://example.com/feed",
            siteUrl: "https://example.com",
          },
        }),
      },
      { expected: true, filter: { authorId: "author-1" } },
      { expected: false, filter: { authorId: "author-2" } },
      {
        expected: true,
        filter: { feedUrl: "https://example.com/feed" },
        value: item({
          rssSource: {
            feedTitle: "Example",
            feedUrl: "https://example.com/feed",
            siteUrl: "https://example.com",
          },
        }),
      },
      { expected: true, filter: { socialContentFilter: "posts" } },
      {
        expected: false,
        filter: { socialContentFilter: "stories" },
      },
      {
        expected: true,
        filter: { socialContentFilter: "stories" },
        value: item({ contentType: "story" }),
      },
      { expected: true, filter: { savedOnly: true } },
      {
        expected: false,
        filter: { savedOnly: true },
        value: item({
          userState: {
            archived: false,
            hidden: false,
            saved: false,
            tags: [],
          },
        }),
      },
      { expected: true, filter: { tags: ["missing", "work"] } },
      { expected: false, filter: { tags: ["missing"] } },
      { expected: true, filter: { signals: ["request", "essay"] } },
      { expected: false, filter: { signals: ["request"] } },
    ];

    for (const testCase of cases) {
      expect(
        matchesLibraryCoreFeedBrowseFilterV1(
          testCase.value ?? item(),
          normalizeLibraryCoreFeedBrowseFilterV1(testCase.filter),
        ),
      ).toBe(testCase.expected);
    }
  });

  it("normalizes set filters without changing exact string matching", () => {
    const normalized = normalizeLibraryCoreFeedBrowseFilterV1({
      authorId: " author-1 ",
      signals: ["news", "essay", "news"],
      tags: ["work", "favorite", "work"],
    });

    expect(normalized).toStrictEqual({
      archivedOnly: false,
      authorId: " author-1 ",
      feedUrl: null,
      platform: null,
      savedOnly: false,
      schemaVersion: 1,
      showHidden: false,
      signals: ["essay", "news"],
      socialContentFilter: "all",
      tags: ["favorite", "work"],
    });
    expect(
      matchesLibraryCoreFeedBrowseFilterV1(item(), normalized),
    ).toBe(false);
  });
});
