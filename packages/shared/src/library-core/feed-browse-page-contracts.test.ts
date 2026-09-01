import { describe, expect, it } from "vitest";

import {
  LIBRARY_CORE_FEED_BROWSE_PAGE_QUERY_ID,
  LIBRARY_CORE_FEED_BROWSE_PAGE_SCHEMA_VERSION,
  LIBRARY_CORE_FEED_BROWSE_PAGE_V2_QUERY_ID,
  LIBRARY_CORE_FEED_BROWSE_PAGE_V2_SCHEMA_VERSION,
  LIBRARY_CORE_FEED_BROWSE_PAGE_V3_QUERY_ID,
  LIBRARY_CORE_FEED_BROWSE_PAGE_V3_SCHEMA_VERSION,
  LIBRARY_CORE_FEED_BROWSE_FRIENDS_PREDICATE_SCHEMA_VERSION,
  decodeLibraryCoreFeedBrowsePageCursorV1,
  encodeLibraryCoreFeedBrowsePageCursorV1,
  encodeLibraryCoreFeedBrowsePageCursorV2,
  libraryCoreFeedBrowseBindingDigestV3,
  libraryCoreFeedBrowseFilterDigestV1,
  libraryCoreFeedBrowseBindingFilterV2,
  parseLibraryCoreFeedBrowsePageRequestV1,
  parseLibraryCoreFeedBrowsePageResponseV1,
  parseLibraryCoreFeedBrowsePageResponseV2,
  parseLibraryCoreFeedBrowsePageResponseV3,
  type LibraryCoreFeedBrowsePageCursorV1,
  type LibraryCoreFeedBrowsePageCursorV2,
} from "./feed-browse-page-contracts.js";
import type { LibraryCoreFeedBrowseFilterV1 } from "./feed-browse-filter-contract.js";

const FILTER: LibraryCoreFeedBrowseFilterV1 = Object.freeze({
  archivedOnly: false,
  authorId: null,
  feedUrl: null,
  platform: "x",
  savedOnly: true,
  schemaVersion: 1,
  showHidden: false,
  signals: Object.freeze(["essay"] as const),
  socialContentFilter: "posts",
  tags: Object.freeze(["important"]),
});

function cursor(
  overrides: Partial<LibraryCoreFeedBrowsePageCursorV1> = {},
): LibraryCoreFeedBrowsePageCursorV1 {
  return {
    generationId: "a".repeat(
      64,
    ) as LibraryCoreFeedBrowsePageCursorV1["generationId"],
    transitionSequence: 12,
    projectionRevision: 34,
    priority: 91,
    publishedAt: 1_780_000_000_000,
    sourceSequence: 56,
    globalId: "x:item-1" as LibraryCoreFeedBrowsePageCursorV1["globalId"],
    ...overrides,
  };
}

function cursorV2(
  overrides: Partial<LibraryCoreFeedBrowsePageCursorV2> = {},
): LibraryCoreFeedBrowsePageCursorV2 {
  const { sourceSequence: _sourceSequence, ...value } = cursor();
  return {
    ...value,
    filterDigest: libraryCoreFeedBrowseBindingDigestV3(FILTER, "all_content"),
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

function requestV2(overrides: Record<string, unknown> = {}) {
  return {
    cancellationId: "cancel-1",
    cursor: null,
    filter: FILTER,
    friendsPredicateSchemaVersion:
      LIBRARY_CORE_FEED_BROWSE_FRIENDS_PREDICATE_SCHEMA_VERSION,
    identityMode: "friends",
    limit: 64,
    queryId: LIBRARY_CORE_FEED_BROWSE_PAGE_V2_QUERY_ID,
    rankingClockMs: 1_780_000_100_000,
    readerSessionId: "reader-session-1",
    recommendationOrderSchemaVersion: 1,
    schemaVersion: LIBRARY_CORE_FEED_BROWSE_PAGE_V2_SCHEMA_VERSION,
    ...overrides,
  };
}

function requestV3(overrides: Record<string, unknown> = {}) {
  return {
    cancellationId: "cancel-1",
    cursor: null,
    direction: "next",
    filter: FILTER,
    friendsPredicateSchemaVersion:
      LIBRARY_CORE_FEED_BROWSE_FRIENDS_PREDICATE_SCHEMA_VERSION,
    identityMode: "all_content",
    limit: 64,
    queryId: LIBRARY_CORE_FEED_BROWSE_PAGE_V3_QUERY_ID,
    rankingClockMs: 1_780_000_100_000,
    readerSessionId: "reader-session-1",
    recommendationOrderSchemaVersion: 1,
    schemaVersion: LIBRARY_CORE_FEED_BROWSE_PAGE_V3_SCHEMA_VERSION,
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
      encodeLibraryCoreFeedBrowsePageCursorV1(cursor({ priority: 101 })),
    ).toThrow("invalid Library Core feed-browse cursor");
  });

  it("snapshots one canonical filter and binds its ranking contract", () => {
    expect(libraryCoreFeedBrowseFilterDigestV1(FILTER)).toBe(
      "60d920ddd5b896d7e24cb500f1ad80958fdaa871fa9707dad0faaf2631d75bb2",
    );
    const parsed = parseLibraryCoreFeedBrowsePageRequestV1(request());
    expect(parsed).toStrictEqual({
      ok: true,
      value: request(),
    });
    expect(
      parseLibraryCoreFeedBrowsePageRequestV1(
        request({
          filter: { ...FILTER, tags: ["z", "a"] },
        }),
      ),
    ).toMatchObject({ ok: false });
    expect(
      parseLibraryCoreFeedBrowsePageRequestV1(
        request({
          recommendationOrderSchemaVersion: 2,
        }),
      ),
    ).toMatchObject({ ok: false });
    expect(
      parseLibraryCoreFeedBrowsePageRequestV1(
        request({
          filter: { ...FILTER, platform: "x".repeat(8_193) },
        }),
      ),
    ).toMatchObject({ ok: false });
    expect(
      parseLibraryCoreFeedBrowsePageRequestV1(
        request({
          identityMode: "friends",
        }),
      ),
    ).toMatchObject({ ok: false });
  });

  it("binds closed V2 identity fields without changing V1", () => {
    const binding = libraryCoreFeedBrowseBindingFilterV2(FILTER, "friends");
    expect(Object.keys(binding)).toStrictEqual([
      "filter",
      "friendsPredicateSchemaVersion",
      "identityMode",
    ]);
    expect(binding).toStrictEqual({
      filter: FILTER,
      friendsPredicateSchemaVersion: 1,
      identityMode: "friends",
    });
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
      parseLibraryCoreFeedBrowsePageResponseV1(
        {
          ...response,
          nextOrder: { ...response.nextOrder, priority: 90 },
        },
        request(),
      ),
    ).toMatchObject({ ok: false });
  });

  it("binds V2 responses to the requested identity predicate", () => {
    const encoded = encodeLibraryCoreFeedBrowsePageCursorV1(cursor());
    const response = {
      filter: FILTER,
      friendsPredicateSchemaVersion:
        LIBRARY_CORE_FEED_BROWSE_FRIENDS_PREDICATE_SCHEMA_VERSION,
      identityMode: "friends",
      nextCursor: encoded,
      nextOrder: {
        globalId: "x:item-1",
        priority: 91,
        publishedAt: 1_780_000_000_000,
        sourceSequence: 56,
      },
      queryId: LIBRARY_CORE_FEED_BROWSE_PAGE_V2_QUERY_ID,
      rankingClockMs: 1_780_000_100_000,
      recommendationOrderSchemaVersion: 1,
      rows: [feedCard()],
      schemaVersion: LIBRARY_CORE_FEED_BROWSE_PAGE_V2_SCHEMA_VERSION,
      source: {
        generationId: "a".repeat(64),
        projectionRevision: 34,
        transitionSequence: 12,
      },
      totalCount: 2,
    };
    expect(
      parseLibraryCoreFeedBrowsePageResponseV2(response, requestV2()),
    ).toMatchObject({ ok: true });
    expect(
      parseLibraryCoreFeedBrowsePageResponseV2(
        {
          ...response,
          identityMode: "all_content",
        },
        requestV2(),
      ),
    ).toMatchObject({ ok: false });
    expect(
      parseLibraryCoreFeedBrowsePageResponseV2(
        {
          ...response,
          friendsPredicateSchemaVersion: 2,
        },
        requestV2(),
      ),
    ).toMatchObject({ ok: false });
    expect(
      parseLibraryCoreFeedBrowsePageResponseV2(
        {
          ...response,
          identityMode: "all_content",
        },
        requestV2({ identityMode: "all_content" }),
      ),
    ).toMatchObject({ ok: true });
    expect(
      parseLibraryCoreFeedBrowsePageResponseV2(
        response,
        requestV2({ identityMode: "connections" }),
      ),
    ).toMatchObject({ ok: false });
    expect(
      parseLibraryCoreFeedBrowsePageResponseV2(
        response,
        requestV2({ friendsPredicateSchemaVersion: 2 }),
      ),
    ).toMatchObject({ ok: false });
    expect(
      parseLibraryCoreFeedBrowsePageResponseV2(
        response,
        requestV2({ extra: true }),
      ),
    ).toMatchObject({ ok: false });
  });

  it("requires one explicit V3 direction and a cursor to walk backward", () => {
    const encoded = encodeLibraryCoreFeedBrowsePageCursorV2(cursorV2());
    expect(encoded).toBe(
      "AqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqjUiL4MhdEaI8xRpNC-OSBt6nELE0CxhKIuFM9Vug-t8AAAAAAAAADAAAAAAAAAAiWwAAAZ5wRIgAAAh4Oml0ZW0tMQ",
    );
    // The request contract is enforced through the response parser, which
    // validates its bound request before reading a single row.
    const emptyPage = {
      filter: FILTER,
      friendsPredicateSchemaVersion:
        LIBRARY_CORE_FEED_BROWSE_FRIENDS_PREDICATE_SCHEMA_VERSION,
      identityMode: "all_content",
      nextCursor: null,
      nextOrder: null,
      previousCursor: null,
      previousOrder: null,
      queryId: LIBRARY_CORE_FEED_BROWSE_PAGE_V3_QUERY_ID,
      rankingClockMs: 1_780_000_100_000,
      recommendationOrderSchemaVersion: 1,
      rows: [],
      schemaVersion: LIBRARY_CORE_FEED_BROWSE_PAGE_V3_SCHEMA_VERSION,
      source: {
        generationId: "a".repeat(64),
        projectionRevision: 34,
        transitionSequence: 12,
      },
      totalCount: 2,
    };
    const parseWith = (request: Record<string, unknown>) =>
      parseLibraryCoreFeedBrowsePageResponseV3(emptyPage, request);

    expect(parseWith(requestV3())).toMatchObject({ ok: true });
    const previousResult = parseWith(
      requestV3({ direction: "previous", cursor: encoded }),
    );
    expect(previousResult).toMatchObject({ ok: true });
    expect(
      parseWith(
        requestV3({
          cursor: encoded,
          filter: { ...FILTER, savedOnly: false },
        }),
      ),
    ).toMatchObject({
      error: "browse request cursor belongs to a different filter",
      ok: false,
    });
    // A backward page has no meaning without a leading row to resume from.
    expect(parseWith(requestV3({ direction: "previous" }))).toMatchObject({
      ok: false,
    });
    for (const direction of ["sideways", "", null, 1, undefined]) {
      expect(parseWith(requestV3({ direction }))).toMatchObject({ ok: false });
    }
    // The closed V1 and V2 request shapes must not pass as V3.
    expect(parseWith(request())).toMatchObject({ ok: false });
    expect(parseWith(requestV2())).toMatchObject({ ok: false });
    expect(
      parseWith(
        requestV3({
          schemaVersion: LIBRARY_CORE_FEED_BROWSE_PAGE_V2_SCHEMA_VERSION,
        }),
      ),
    ).toMatchObject({ ok: false });
    expect(parseWith(requestV3({ extra: true }))).toMatchObject({ ok: false });
    // A V3 request must not satisfy the closed V1 parser either.
    expect(parseLibraryCoreFeedBrowsePageRequestV1(requestV3())).toMatchObject({
      ok: false,
    });
  });

  it("binds both V3 traversal edges to the rows and source they claim", () => {
    const leading = encodeLibraryCoreFeedBrowsePageCursorV2(cursorV2());
    const response = {
      filter: FILTER,
      friendsPredicateSchemaVersion:
        LIBRARY_CORE_FEED_BROWSE_FRIENDS_PREDICATE_SCHEMA_VERSION,
      identityMode: "all_content",
      nextCursor: leading,
      nextOrder: {
        globalId: "x:item-1",
        priority: 91,
        publishedAt: 1_780_000_000_000,
      },
      previousCursor: leading,
      previousOrder: {
        globalId: "x:item-1",
        priority: 91,
        publishedAt: 1_780_000_000_000,
      },
      queryId: LIBRARY_CORE_FEED_BROWSE_PAGE_V3_QUERY_ID,
      rankingClockMs: 1_780_000_100_000,
      recommendationOrderSchemaVersion: 1,
      rows: [feedCard()],
      schemaVersion: LIBRARY_CORE_FEED_BROWSE_PAGE_V3_SCHEMA_VERSION,
      source: {
        generationId: "a".repeat(64),
        projectionRevision: 34,
        transitionSequence: 12,
      },
      totalCount: 2,
    };
    expect(
      parseLibraryCoreFeedBrowsePageResponseV3(response, requestV3()),
    ).toMatchObject({ ok: true });
    // A terminal head reports no backward edge at all.
    expect(
      parseLibraryCoreFeedBrowsePageResponseV3(
        { ...response, previousCursor: null, previousOrder: null },
        requestV3(),
      ),
    ).toMatchObject({ ok: true });
    // Cursor and order must agree, and both must bind the first row.
    expect(
      parseLibraryCoreFeedBrowsePageResponseV3(
        { ...response, previousOrder: null },
        requestV3(),
      ),
    ).toMatchObject({ ok: false });
    expect(
      parseLibraryCoreFeedBrowsePageResponseV3(
        {
          ...response,
          previousOrder: { ...response.previousOrder, sourceSequence: 57 },
        },
        requestV3(),
      ),
    ).toMatchObject({ ok: false });
    expect(
      parseLibraryCoreFeedBrowsePageResponseV3(
        {
          ...response,
          previousCursor: encodeLibraryCoreFeedBrowsePageCursorV2(
            cursorV2({
              globalId:
                "x:other" as LibraryCoreFeedBrowsePageCursorV2["globalId"],
            }),
          ),
        },
        requestV3(),
      ),
    ).toMatchObject({ ok: false });
    // A generation that does not match the response source cannot be resumed.
    expect(
      parseLibraryCoreFeedBrowsePageResponseV3(
        {
          ...response,
          previousCursor: encodeLibraryCoreFeedBrowsePageCursorV2(
            cursorV2({ projectionRevision: 35 }),
          ),
        },
        requestV3(),
      ),
    ).toMatchObject({ ok: false });
    // An empty page has no edge to resume from on either side.
    expect(
      parseLibraryCoreFeedBrowsePageResponseV3(
        {
          ...response,
          rows: [],
          nextCursor: null,
          nextOrder: null,
        },
        requestV3(),
      ),
    ).toMatchObject({ ok: false });
    expect(
      parseLibraryCoreFeedBrowsePageResponseV3(
        {
          ...response,
          rows: [],
          nextCursor: null,
          nextOrder: null,
          previousCursor: null,
          previousOrder: null,
        },
        requestV3(),
      ),
    ).toMatchObject({ ok: true });
    // The closed V1 and V2 response shapes stay separable from V3.
    expect(
      parseLibraryCoreFeedBrowsePageResponseV1(response, request()),
    ).toMatchObject({ ok: false });
    expect(
      parseLibraryCoreFeedBrowsePageResponseV3(
        { ...response, queryId: LIBRARY_CORE_FEED_BROWSE_PAGE_QUERY_ID },
        requestV3(),
      ),
    ).toMatchObject({ ok: false });
  });
});
