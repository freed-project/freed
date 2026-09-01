import { describe, expect, it } from "vitest";
import {
  parseLibraryCoreRssFeedDetailRequestV1,
  parseLibraryCoreRssFeedDetailResponseV1,
} from "./rss-feed-detail-contracts";

const source = {
  generationId: "a".repeat(64),
  projectionRevision: 7,
  transitionSequence: 7,
};

const request = {
  queryId: "rss_feed_detail_v1" as const,
  schemaVersion: 1 as const,
  url: "https://example.com/feed.xml",
};

const feed = {
  enabled: true,
  folder: "Research",
  imageUrl: "https://example.com/icon.png",
  lastFetched: 30,
  pollInterval: 15,
  sampleBatchId: "sample-batch",
  sampleGeneratedAt: 10,
  sampleGeneratorVersion: 1,
  siteUrl: "https://example.com",
  title: "Example Feed",
  trackUnread: true,
  updatedAt: 40,
  url: request.url,
};

describe("RSS Feed detail contracts", () => {
  it("accepts one complete closed normalized feed", () => {
    expect(
      parseLibraryCoreRssFeedDetailResponseV1(
        { feed, queryId: request.queryId, schemaVersion: 1, source },
        request,
      ),
    ).toMatchObject({ ok: true, value: { feed: { url: request.url } } });
  });

  it("rejects unknown fields and a mismatched feed identity", () => {
    expect(
      parseLibraryCoreRssFeedDetailRequestV1({ ...request, surprise: true }).ok,
    ).toBe(false);
    expect(
      parseLibraryCoreRssFeedDetailResponseV1(
        {
          feed: { ...feed, url: "https://other.example/feed.xml" },
          queryId: request.queryId,
          schemaVersion: 1,
          source,
        },
        request,
      ).ok,
    ).toBe(false);
  });

  it("accepts an explicit missing result and rejects oversized metadata", () => {
    expect(
      parseLibraryCoreRssFeedDetailResponseV1(
        { feed: null, queryId: request.queryId, schemaVersion: 1, source },
        request,
      ).ok,
    ).toBe(true);
    expect(
      parseLibraryCoreRssFeedDetailResponseV1(
        {
          feed: { ...feed, folder: "x".repeat(4_097) },
          queryId: request.queryId,
          schemaVersion: 1,
          source,
        },
        request,
      ).ok,
    ).toBe(false);
  });
});
