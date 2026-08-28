import { describe, expect, it } from "vitest";

import {
  decodeLibraryCoreItemScanCursorV1,
  encodeLibraryCoreItemScanCursorV1,
  parseLibraryCoreItemScanRequestV1,
  parseLibraryCoreItemScanResponseV1,
  type LibraryCoreItemScanCursorV1,
} from "./item-scan-contracts.js";

const generationId = "a".repeat(64);
const request = {
  analysisVersion: null,
  cancellationId: "cancel-scan-1",
  cursor: null,
  limit: 2,
  queryId: "background_item_page_v1" as const,
  readerSessionId: "reader-scan-1",
  schemaVersion: 1 as const,
};

function card(globalId: string) {
  return {
    archived: false,
    authorAvatarUrl: null,
    authorDisplayName: null,
    authorHandle: null,
    authorId: null,
    capturedAt: 1,
    contentSignalTags: [],
    contentText: null,
    contentType: "article",
    engagementComments: null,
    engagementLikes: null,
    eventConfidenceBasisPoints: null,
    eventStartsAt: null,
    globalId,
    hidden: globalId === "hidden",
    liked: false,
    likedAt: null,
    likedSyncedAt: null,
    linkPreviewTitle: null,
    locationName: null,
    mediaTypes: [],
    mediaUrls: [],
    platform: "rss",
    publishedAt: 1,
    readAt: null,
    readingTimeMinutes: null,
    rssSource: null,
    saved: false,
    sampleDataFingerprint: null,
    sourceUrl: null,
    tags: [],
  };
}

describe("Library Core background item scan", () => {
  it("round-trips a source-bound identity cursor with no time ordering field", () => {
    const cursor = {
      generationId,
      globalId: "item-2",
      projectionRevision: 7,
      transitionSequence: 7,
    } as LibraryCoreItemScanCursorV1;
    expect(
      decodeLibraryCoreItemScanCursorV1(
        encodeLibraryCoreItemScanCursorV1(cursor),
      ),
    ).toEqual({ ok: true, value: cursor });
  });

  it("accepts only closed bounded requests and binary ordered responses", () => {
    expect(parseLibraryCoreItemScanRequestV1(request).ok).toBe(true);
    expect(
      parseLibraryCoreItemScanRequestV1({ ...request, analysisVersion: 3 }).ok,
    ).toBe(true);
    const { analysisVersion: _analysisVersion, ...missingSelector } = request;
    expect(parseLibraryCoreItemScanRequestV1(missingSelector).ok).toBe(false);
    expect(
      parseLibraryCoreItemScanRequestV1({ ...request, limit: 65 }).ok,
    ).toBe(false);
    expect(
      parseLibraryCoreItemScanRequestV1({ ...request, sql: "SELECT 1" }).ok,
    ).toBe(false);

    const rows = [card("hidden"), card("item-1")];
    const nextCursor = encodeLibraryCoreItemScanCursorV1({
      generationId,
      globalId: "item-1",
      projectionRevision: 7,
      transitionSequence: 7,
    } as LibraryCoreItemScanCursorV1);
    const response = {
      nextCursor,
      queryId: "background_item_page_v1" as const,
      rows,
      schemaVersion: 1 as const,
      source: {
        generationId,
        projectionRevision: 7,
        transitionSequence: 7,
      },
    };
    expect(parseLibraryCoreItemScanResponseV1(response, request).ok).toBe(true);
    expect(
      parseLibraryCoreItemScanResponseV1(
        { ...response, rows: [...rows].reverse() },
        request,
      ).ok,
    ).toBe(false);
    expect(
      parseLibraryCoreItemScanResponseV1(
        { ...response, rows: [card("hidden")] },
        request,
      ).ok,
    ).toBe(false);
  });

  it("preserves hidden, RSS, and sample provenance needed by background jobs", () => {
    const row = {
      ...card("rss:sample"),
      hidden: true,
      rssSource: {
        feedTitle: "Example",
        feedUrl: "https://example.test/feed.xml",
        siteUrl: "https://example.test",
      },
      sampleDataFingerprint: {
        batchId: "sample-batch",
        generatedAt: 1,
        generatorVersion: 1,
        marker: "freed.sample-data.v1",
      },
    };
    const parsed = parseLibraryCoreItemScanResponseV1(
      {
        nextCursor: null,
        queryId: "background_item_page_v1",
        rows: [row],
        schemaVersion: 1,
        source: {
          generationId,
          projectionRevision: 7,
          transitionSequence: 7,
        },
      },
      request,
    );

    expect(parsed).toEqual(
      expect.objectContaining({
        ok: true,
        value: expect.objectContaining({ rows: [row] }),
      }),
    );
  });
});
