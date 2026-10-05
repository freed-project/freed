import { PRIORITY_RECENCY_HORIZON_MS } from "../ranking.js";
import { LIBRARY_CORE_SQLITE_QUERY_PROGRAMS } from "./sqlite-contract.generated.js";
import { parseLibraryCorePriorityTimePageRequestV1, parseLibraryCorePriorityTimePageResponseV1 } from "./priority-time-page-contracts.js";
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
  priorityComputedBeforeMs: null,
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
    linkPreviewUrl: null,
    locationName: null,
    mediaTypes: [],
    mediaUrls: [],
    platform: "rss",
    publishedAt: 1,
    rankingCareLevel: null,
    rankingEngagementReposts: null,
    rankingEngagementViews: null,
    readAt: null,
    readingTimeMinutes: null,
    rssSource: null,
    saved: false,
    sampleDataFingerprint: null,
    sourceUrl: null,
    tags: [],
    topics: [],
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

  it("accepts the indexed stale-priority order without weakening ordinary pages", () => {
    const priorityRequest = {
      ...request,
      priorityComputedBeforeMs: 1_000,
    };
    const response = {
      nextCursor: null,
      queryId: "background_item_page_v1" as const,
      rows: [card("z-oldest"), card("a-newer")],
      schemaVersion: 1 as const,
      source: {
        generationId,
        projectionRevision: 7,
        transitionSequence: 7,
      },
    };

    expect(
      parseLibraryCoreItemScanResponseV1(response, priorityRequest).ok,
    ).toBe(true);
    expect(parseLibraryCoreItemScanResponseV1(response, request).ok).toBe(
      false,
    );
  });
});


describe("source-fenced time-only priority metadata", () => {
  it("uses the shared decay horizon and existing index without a schema extension", () => {
    const sql = LIBRARY_CORE_SQLITE_QUERY_PROGRAMS.priority_time_page_v1.sql;
    expect(sql).toContain(`item.priority_computed_at - item.published_at < ${PRIORITY_RECENCY_HORIZON_MS}`);
    expect(sql).toContain("INDEXED BY library_feed_items_priority_refresh");
  });
  const timeRequest = { queryId: "priority_time_page_v1" as const, schemaVersion: 1 as const,
    cancellationId: "cancel-time-1", readerSessionId: "reader-time-1", limit: 64,
    priorityComputedBeforeMs: 1000, generationId, sourceRevision: 7 };
  it("rejects cursor/progress overrides and malformed source bounds", () => {
    expect(parseLibraryCorePriorityTimePageRequestV1(timeRequest).ok).toBe(true);
    for (const invalid of [{...timeRequest,cursor:"opaque"}, {...timeRequest,priorityComputedBeforeMs:null},
      {...timeRequest,sourceRevision:-1}, {...timeRequest,limit:65}, {...timeRequest,generationId:"unknown"}])
      expect(parseLibraryCorePriorityTimePageRequestV1(invalid).ok).toBe(false);
  });
  it("requires the response to match both source counters and generation", () => {
    const response = {queryId:"priority_time_page_v1",schemaVersion:1,rows:[card("old")],nextCursor:null,
      source:{generationId,projectionRevision:7,transitionSequence:7}};
    expect(parseLibraryCorePriorityTimePageResponseV1(response,timeRequest).ok).toBe(true);
    for (const source of [{...response.source,projectionRevision:8},{...response.source,transitionSequence:8},
      {...response.source,generationId:"b".repeat(64)}])
      expect(parseLibraryCorePriorityTimePageResponseV1({...response,source},timeRequest)).toEqual({ok:false,error:"CURSOR_STALE"});
    expect(parseLibraryCorePriorityTimePageResponseV1({...response,extra:true},timeRequest).ok).toBe(false);
  });
});
