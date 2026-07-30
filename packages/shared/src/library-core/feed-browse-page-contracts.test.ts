import { describe, expect, it } from "vitest";

import {
  LIBRARY_CORE_FEED_BROWSE_PAGE_QUERY_ID,
  LIBRARY_CORE_FEED_BROWSE_PAGE_SCHEMA_VERSION,
  decodeLibraryCoreFeedBrowsePageCursorV1,
  encodeLibraryCoreFeedBrowsePageCursorV1,
  parseLibraryCoreFeedBrowsePageRequestV1,
  parseLibraryCoreFeedBrowsePageResponseV1,
  type LibraryCoreFeedBrowsePageCursorV1,
} from "./feed-browse-page-contracts.js";

const FILTER = Object.freeze({
  archivedOnly: false,
  authorId: null,
  feedUrl: null,
  platform: "x",
  savedOnly: true,
  schemaVersion: 1,
  showHidden: false,
  signals: Object.freeze(["essay"]),
  socialContentFilter: "posts",
  tags: Object.freeze(["important"]),
});

function cursor(
  overrides: Partial<LibraryCoreFeedBrowsePageCursorV1> = {},
): LibraryCoreFeedBrowsePageCursorV1 {
  return {
    generationId:
      "a".repeat(64) as LibraryCoreFeedBrowsePageCursorV1["generationId"],
    transitionSequence: 12,
    projectionRevision: 34,
    priority: 91,
    publishedAt: 1_780_000_000_000,
    sourceSequence: 56,
    globalId: "x:item-1" as LibraryCoreFeedBrowsePageCursorV1["globalId"],
    ...overrides,
  };
}

function request(overrides: Record<string, unknown> = {}) {
  return {
    cancellationId: "cancel-1",
    cursor: null,
    filter: FILTER,
    limit: 64,
    queryId: LIBRARY_CORE_FEED_BROWSE_PAGE_QUERY_ID,
    rankingClockMs: 1_780_000_100_000,
    readerSessionId: "reader-session-1",
    recommendationOrderSchemaVersion: 1,
    schemaVersion: LIBRARY_CORE_FEED_BROWSE_PAGE_SCHEMA_VERSION,
    ...overrides,
  };
}

function feedCard() {
  return {
    archived: false,
    authorAvatarUrl: null,
    authorDisplayName: null,
    authorHandle: null,
    authorId: null,
    capturedAt: 1_780_000_000_001,
    contentSignalTags: [],
    contentText: "Bounded",
    contentType: "post",
    engagementComments: null,
    engagementLikes: null,
    eventConfidenceBasisPoints: null,
    eventStartsAt: null,
    globalId: "x:item-1",
    liked: false,
    likedAt: null,
    likedSyncedAt: null,
    linkPreviewTitle: null,
    locationName: null,
    mediaTypes: [],
    mediaUrls: [],
    platform: "x",
    publishedAt: 1_780_000_000_000,
    readAt: null,
    readingTimeMinutes: null,
    saved: true,
    sourceUrl: null,
    tags: [],
  };
}

describe("Library Core feed-browse page protocol", () => {
  it("round-trips the complete storage ordering tuple in one canonical cursor", () => {
    const expected = cursor();
    const encoded = encodeLibraryCoreFeedBrowsePageCursorV1(expected);
    expect(decodeLibraryCoreFeedBrowsePageCursorV1(encoded)).toStrictEqual({
      ok: true,
      value: expected,
    });
    expect(() =>
      encodeLibraryCoreFeedBrowsePageCursorV1(cursor({ priority: 101 }))
    ).toThrow("invalid Library Core feed-browse cursor");
  });

  it("snapshots one canonical filter and binds its ranking contract", () => {
    const parsed = parseLibraryCoreFeedBrowsePageRequestV1(request());
    expect(parsed).toStrictEqual({
      ok: true,
      value: request(),
    });
    expect(
      parseLibraryCoreFeedBrowsePageRequestV1(request({
        filter: { ...FILTER, tags: ["z", "a"] },
      })),
    ).toMatchObject({ ok: false });
    expect(
      parseLibraryCoreFeedBrowsePageRequestV1(request({
        recommendationOrderSchemaVersion: 2,
      })),
    ).toMatchObject({ ok: false });
    expect(
      parseLibraryCoreFeedBrowsePageRequestV1(request({
        filter: { ...FILTER, platform: "x".repeat(8_193) },
      })),
    ).toMatchObject({ ok: false });
  });

  it("rejects a cursor whose hidden order tuple differs from its response", () => {
    const encoded = encodeLibraryCoreFeedBrowsePageCursorV1(cursor());
    const response = {
      filter: FILTER,
      nextCursor: encoded,
      nextOrder: {
        globalId: "x:item-1",
        priority: 91,
        publishedAt: 1_780_000_000_000,
        sourceSequence: 56,
      },
      queryId: LIBRARY_CORE_FEED_BROWSE_PAGE_QUERY_ID,
      rankingClockMs: 1_780_000_100_000,
      recommendationOrderSchemaVersion: 1,
      rows: [feedCard()],
      schemaVersion: LIBRARY_CORE_FEED_BROWSE_PAGE_SCHEMA_VERSION,
      source: {
        generationId: "a".repeat(64),
        projectionRevision: 34,
        transitionSequence: 12,
      },
      totalCount: 2,
    };
    expect(
      parseLibraryCoreFeedBrowsePageResponseV1(response, request()),
    ).toMatchObject({ ok: true });
    expect(
      parseLibraryCoreFeedBrowsePageResponseV1({
        ...response,
        nextOrder: { ...response.nextOrder, priority: 90 },
      }, request()),
    ).toMatchObject({ ok: false });
  });
});
