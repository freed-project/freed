import { describe, expect, it } from "vitest";
import type { FeedItem } from "@freed/shared";
import {
  buildIdentityGraphActivitySummaries,
  buildIdentityGraphActivitySummariesFromCompact,
  socialActivitySummaryKey,
} from "./identity-graph-activity-summary.js";

function item(overrides: Partial<FeedItem>): FeedItem {
  return {
    globalId: "item-1",
    platform: "instagram",
    contentType: "post",
    capturedAt: 1,
    publishedAt: 1,
    author: {
      id: "author-1",
      handle: "author-1",
      displayName: "Author 1",
    },
    content: {
      text: "hello",
      mediaUrls: [],
      mediaTypes: [],
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

describe("buildIdentityGraphActivitySummaries", () => {
  it("summarizes social and RSS activity without retaining every item", () => {
    const summaries = buildIdentityGraphActivitySummaries({
      "ig:1": item({
        globalId: "ig:1",
        publishedAt: 10,
        author: {
          id: "ada",
          handle: "ada",
          displayName: "Ada",
          avatarUrl: "https://example.com/ada.png",
        },
      }),
      "ig:2": item({
        globalId: "ig:2",
        publishedAt: 20,
        author: {
          id: "ada",
          handle: "ada",
          displayName: "Ada",
        },
        location: {
          name: "Paris",
          coordinates: {
            lat: 48.8566,
            lng: 2.3522,
          },
          source: "geo_tag",
        },
      }),
      "rss:1": item({
        globalId: "rss:1",
        platform: "rss",
        contentType: "article",
        publishedAt: 30,
        rssSource: {
          feedUrl: "https://example.com/feed.xml",
          feedTitle: "Example",
          siteUrl: "https://example.com",
        },
      }),
    });

    const social =
      summaries.social[socialActivitySummaryKey("instagram", "ada")];
    expect(social).toMatchObject({
      itemCount: 2,
      latestActivityAt: 20,
      hasLocation: true,
      avatarUrl: "https://example.com/ada.png",
      avatarPublishedAt: 10,
      avatarGlobalId: "ig:1",
    });
    expect(social?.sampleItemIds).toEqual(["ig:2", "ig:1"]);
    expect(summaries.rss["https://example.com/feed.xml"]?.itemCount).toBe(1);
    expect(summaries.itemCount).toBe(3);
  });

  it("adapts native compact activity without constructing item records", () => {
    const summaries = buildIdentityGraphActivitySummariesFromCompact({
      totalItemCount: 17_000,
      social: [
        {
          platform: "instagram",
          authorId: "ada",
          itemCount: 12_000,
          latestActivityAt: 20,
          sampleItems: [
            { globalId: "ig:2", publishedAt: 20 },
            { globalId: "ig:1", publishedAt: 10 },
          ],
          hasLocation: true,
          avatarUrl: "https://example.com/ada.png",
          avatarPublishedAt: 20,
          avatarGlobalId: "ig:2",
        },
      ],
      rss: [
        {
          feedUrl: "https://example.com/feed.xml",
          itemCount: 5_000,
          latestActivityAt: 30,
          sampleItems: [{ globalId: "rss:1", publishedAt: 30 }],
          hasLocation: false,
          avatarUrl: null,
          avatarPublishedAt: null,
          avatarGlobalId: null,
        },
      ],
    });

    expect(
      summaries.social[socialActivitySummaryKey("instagram", "ada")],
    ).toMatchObject({
      itemCount: 12_000,
      sampleItemIds: ["ig:2", "ig:1"],
      avatarPublishedAt: 20,
      avatarGlobalId: "ig:2",
    });
    expect(summaries.rss["https://example.com/feed.xml"]?.itemCount).toBe(
      5_000,
    );
    expect(summaries.itemCount).toBe(17_000);
  });
});
