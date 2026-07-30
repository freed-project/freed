import { describe, expect, it } from "vitest";

import {
  LIBRARY_CORE_FEED_PAGE_MAXIMUM_CURSOR_BYTES,
  LIBRARY_CORE_FEED_PAGE_MAXIMUM_LIMIT,
  LIBRARY_CORE_FEED_PAGE_PROJECTION,
  LIBRARY_CORE_FEED_PAGE_QUERY_ID,
  LIBRARY_CORE_FEED_PAGE_SCHEMA_VERSION,
  decodeLibraryCoreFeedPageCursorV1,
  encodeLibraryCoreFeedPageCursorV1,
  isLibraryCoreVisibleFeedItemV1,
  parseLibraryCoreFeedPageRequestV1,
  parseLibraryCoreFeedPageResponseV1,
  projectLibraryCoreFeedCardV1,
  type LibraryCoreFeedPageCursorV1,
} from "./feed-page-contracts.js";
import {
  isLibraryCoreEntityId,
  isLibraryCoreLowercaseHex64,
  isLibraryCoreOperationInstanceId,
} from "./protocol-scalars.js";

const GENERATION_ID = "a".repeat(64);
const OTHER_GENERATION_ID = "b".repeat(64);

function cursor(
  overrides: Partial<LibraryCoreFeedPageCursorV1> = {},
): LibraryCoreFeedPageCursorV1 {
  const globalId = overrides.globalId ?? "x:item-1";
  const generationId = overrides.generationId ?? GENERATION_ID;
  expect(isLibraryCoreEntityId(globalId)).toBe(true);
  expect(isLibraryCoreLowercaseHex64(generationId)).toBe(true);
  return {
    generationId: generationId as LibraryCoreFeedPageCursorV1["generationId"],
    transitionSequence: 12,
    projectionRevision: 34,
    sortAt: 1_780_000_000_000,
    globalId: globalId as LibraryCoreFeedPageCursorV1["globalId"],
    ...overrides,
  };
}

function request(overrides: Record<string, unknown> = {}) {
  const readerSessionId = "reader-session-1";
  const cancellationId = "cancel-1";
  expect(isLibraryCoreOperationInstanceId(readerSessionId)).toBe(true);
  expect(isLibraryCoreOperationInstanceId(cancellationId)).toBe(true);
  return {
    cancellationId,
    cursor: null,
    limit: 64,
    queryId: LIBRARY_CORE_FEED_PAGE_QUERY_ID,
    readerSessionId,
    schemaVersion: LIBRARY_CORE_FEED_PAGE_SCHEMA_VERSION,
    ...overrides,
  };
}

function feedCard(
  globalId = "x:item-1",
  overrides: Record<string, unknown> = {},
) {
  return {
    archived: false,
    authorAvatarUrl: "https://example.test/avatar.jpg",
    authorDisplayName: "Reader",
    authorHandle: "reader",
    authorId: "x:reader",
    capturedAt: 1_780_000_000_001,
    contentSignalTags: ["article"],
    contentText: "Bounded content",
    contentType: "post",
    engagementComments: 2,
    engagementLikes: 3,
    eventConfidenceBasisPoints: 9_000,
    eventStartsAt: 1_780_000_100_000,
    globalId,
    liked: true,
    likedAt: 1_780_000_000_002,
    likedSyncedAt: null,
    linkPreviewTitle: "Example",
    locationName: null,
    mediaTypes: ["image"],
    mediaUrls: ["https://example.test/media.jpg"],
    platform: "x",
    publishedAt: 1_780_000_000_000,
    readAt: null,
    readingTimeMinutes: 4,
    saved: true,
    sourceUrl: "https://example.test/post",
    tags: ["saved"],
    ...overrides,
  };
}

function response(
  rows: Record<string, unknown>[] = [feedCard()],
  overrides: Record<string, unknown> = {},
) {
  const finalRow = rows[rows.length - 1];
  const nextCursor =
    finalRow && typeof finalRow.globalId === "string"
      ? encodeLibraryCoreFeedPageCursorV1(
          cursor({
            globalId:
              finalRow.globalId as LibraryCoreFeedPageCursorV1["globalId"],
          }),
        )
      : null;
  return {
    nextCursor,
    queryId: LIBRARY_CORE_FEED_PAGE_QUERY_ID,
    rows,
    schemaVersion: LIBRARY_CORE_FEED_PAGE_SCHEMA_VERSION,
    source: {
      generationId: GENERATION_ID,
      projectionRevision: 34,
      transitionSequence: 12,
    },
    totalCount: rows.length + 1,
    ...overrides,
  };
}

function parseResponse(
  value: unknown,
  requestOverrides: Record<string, unknown> = {},
) {
  return parseLibraryCoreFeedPageResponseV1(value, request(requestOverrides));
}

describe("Library Core feed-page cursor v1", () => {
  it("round-trips every source and ordering field through a canonical opaque cursor", () => {
    const expected = cursor();
    const encoded = encodeLibraryCoreFeedPageCursorV1(expected);
    expect(encoded).toBe(
      "AaqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqAAAAAAAAAAwAAAAAAAAAIgAAAZ5wRIgAAAh4Oml0ZW0tMQ",
    );
    expect(encoded).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(decodeLibraryCoreFeedPageCursorV1(encoded)).toStrictEqual({
      ok: true,
      value: expected,
    });
  });

  it("fits the largest entity identity and rejects malformed or noncanonical input", () => {
    const maximumIdentity = "x".repeat(4_096);
    const encoded = encodeLibraryCoreFeedPageCursorV1(
      cursor({
        globalId: maximumIdentity as LibraryCoreFeedPageCursorV1["globalId"],
      }),
    );
    expect(encoded.length).toBe(LIBRARY_CORE_FEED_PAGE_MAXIMUM_CURSOR_BYTES);
    expect(decodeLibraryCoreFeedPageCursorV1(encoded).ok).toBe(true);
    expect(decodeLibraryCoreFeedPageCursorV1(`${encoded}=`).ok).toBe(false);
    expect(decodeLibraryCoreFeedPageCursorV1(`${encoded}A`).ok).toBe(false);
    expect(decodeLibraryCoreFeedPageCursorV1("A").ok).toBe(false);
  });

  it("rejects unsafe cursor integers before encoding", () => {
    expect(() =>
      encodeLibraryCoreFeedPageCursorV1(
        cursor({ transitionSequence: Number.MAX_SAFE_INTEGER + 1 }),
      ),
    ).toThrow(TypeError);
    expect(() =>
      encodeLibraryCoreFeedPageCursorV1(cursor({ sortAt: -0 })),
    ).toThrow(TypeError);
  });
});

describe("Library Core feed-page request v1", () => {
  it("accepts one exact bounded request and snapshots it", () => {
    const input = request({
      cursor: encodeLibraryCoreFeedPageCursorV1(cursor()),
      limit: LIBRARY_CORE_FEED_PAGE_MAXIMUM_LIMIT,
    });
    const parsed = parseLibraryCoreFeedPageRequestV1(input);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    input.limit = 1;
    expect(parsed.value.limit).toBe(LIBRARY_CORE_FEED_PAGE_MAXIMUM_LIMIT);
    expect(Object.isFrozen(parsed.value)).toBe(true);
  });

  it("rejects unknown fields, accessors, invalid identities, and invalid bounds", () => {
    expect(parseLibraryCoreFeedPageRequestV1(request({ extra: true })).ok).toBe(
      false,
    );
    const accessor = request();
    Object.defineProperty(accessor, "limit", {
      enumerable: true,
      get: () => 64,
    });
    expect(parseLibraryCoreFeedPageRequestV1(accessor).ok).toBe(false);
    expect(parseLibraryCoreFeedPageRequestV1(request({ limit: 0 })).ok).toBe(
      false,
    );
    expect(
      parseLibraryCoreFeedPageRequestV1(
        request({ limit: LIBRARY_CORE_FEED_PAGE_MAXIMUM_LIMIT + 1 }),
      ).ok,
    ).toBe(false);
    expect(
      parseLibraryCoreFeedPageRequestV1(
        request({ readerSessionId: "spaces are not valid" }),
      ).ok,
    ).toBe(false);
  });
});

describe("Library Core feed-page response v1", () => {
  it("accepts a bounded page and detaches every retained row and nested array", () => {
    const row = feedCard();
    expect(Object.keys(row).sort()).toStrictEqual(
      [...LIBRARY_CORE_FEED_PAGE_PROJECTION.selectedFields].sort(),
    );
    const input = response([row]);
    const parsed = parseResponse(input);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;

    row.authorDisplayName = "mutated";
    (row.tags as string[])[0] = "mutated";
    input.rows.length = 0;

    expect(parsed.value.rows).toHaveLength(1);
    expect(parsed.value.rows[0]?.authorDisplayName).toBe("Reader");
    expect(parsed.value.rows[0]?.tags).toStrictEqual(["saved"]);
    expect(Object.isFrozen(parsed.value)).toBe(true);
    expect(Object.isFrozen(parsed.value.rows)).toBe(true);
    expect(Object.isFrozen(parsed.value.rows[0])).toBe(true);
    expect(Object.isFrozen(parsed.value.rows[0]?.tags)).toBe(true);
  });

  it("binds the next cursor to the exact source generation, revision, and final row", () => {
    const rows = [feedCard("x:item-1"), feedCard("x:item-2")];
    expect(parseResponse(response(rows)).ok).toBe(true);
    expect(
      parseResponse(response(rows), {
        cursor: encodeLibraryCoreFeedPageCursorV1(
          cursor({
            generationId:
              OTHER_GENERATION_ID as LibraryCoreFeedPageCursorV1["generationId"],
          }),
        ),
      }).ok,
    ).toBe(false);
    expect(parseResponse(response(rows), { limit: 1 }).ok).toBe(false);
    expect(
      parseResponse(
        response(rows, {
          nextCursor: encodeLibraryCoreFeedPageCursorV1(
            cursor({
              generationId:
                OTHER_GENERATION_ID as LibraryCoreFeedPageCursorV1["generationId"],
            }),
          ),
        }),
      ).ok,
    ).toBe(false);
    expect(
      parseResponse(
        response(rows, {
          nextCursor: encodeLibraryCoreFeedPageCursorV1(
            cursor({
              projectionRevision: 35,
              globalId: "x:item-2" as LibraryCoreFeedPageCursorV1["globalId"],
            }),
          ),
        }),
      ).ok,
    ).toBe(false);
    expect(
      parseResponse(
        response(rows, {
          nextCursor: encodeLibraryCoreFeedPageCursorV1(
            cursor({
              globalId: "x:item-1" as LibraryCoreFeedPageCursorV1["globalId"],
            }),
          ),
        }),
      ).ok,
    ).toBe(false);
  });

  it("rejects oversized nested values, decorated arrays, and impossible totals", () => {
    expect(
      parseResponse(
        response([feedCard("x:item-1", { mediaUrls: Array(9).fill("x") })]),
      ).ok,
    ).toBe(false);
    expect(
      parseResponse(
        response([feedCard("x:item-1", { contentText: "x".repeat(1_501) })]),
      ).ok,
    ).toBe(false);
    expect(
      parseResponse(response([feedCard("x:item-1", { publishedAt: -1 })])).ok,
    ).toBe(false);
    const decoratedRows = [feedCard()];
    Object.defineProperty(decoratedRows, "extra", {
      enumerable: true,
      value: true,
    });
    expect(parseResponse(response(decoratedRows)).ok).toBe(false);
    expect(parseResponse(response([feedCard()], { totalCount: 0 })).ok).toBe(
      false,
    );
  });

  it("enforces the serialized response ceiling after every field is bounded", () => {
    const expensiveRow = feedCard("x:item-0", {
      authorId: "😀".repeat(4_096),
      mediaUrls: Array(8).fill("😀".repeat(2_048)),
    });
    const rows = Array.from(
      { length: LIBRARY_CORE_FEED_PAGE_MAXIMUM_LIMIT },
      (_, index) => ({
        ...expensiveRow,
        globalId: `x:item-${index}`,
      }),
    );
    expect(parseResponse(response(rows)).ok).toBe(false);
  });
});

describe("Library Core feed-card projection v1", () => {
  it("matches the bounded native card projection one item at a time", () => {
    const item = {
      globalId: "x:item-projected",
      platform: "x",
      contentType: "post",
      capturedAt: 1_780_000_000_001,
      publishedAt: 1_780_000_000_000,
      author: {
        id: "x:author",
        displayName: "Reader",
        handle: "reader",
        avatarUrl: "😀".repeat(2_049),
      },
      content: {
        text: "x".repeat(1_501),
        mediaUrls: [...Array(9).fill("https://example.test/image"), 7],
        mediaTypes: ["image", 7],
        linkPreview: { title: "Example" },
      },
      engagement: { likes: 3, comments: 2 },
      location: { name: "Here" },
      preservedContent: { readingTime: 4 },
      userState: {
        archived: false,
        hidden: false,
        liked: true,
        likedAt: 1_780_000_000_002,
        likedSyncedAt: null,
        readAt: null,
        saved: true,
        tags: ["saved"],
      },
      contentSignals: { tags: ["article"] },
      eventCandidate: {
        startsAt: 1_780_000_100_000,
        confidence: 0.9,
      },
      sourceUrl: "https://example.test/post",
      topics: [],
    };

    const projected = projectLibraryCoreFeedCardV1(item as never);
    expect(projected).toMatchObject({
      authorAvatarUrl: "😀".repeat(2_048),
      contentText: "x".repeat(1_500),
      eventConfidenceBasisPoints: 9_000,
      globalId: "x:item-projected",
      liked: true,
      likedSyncedAt: null,
      mediaTypes: ["image"],
      mediaUrls: Array(8).fill("https://example.test/image"),
      readingTimeMinutes: 4,
    });
    expect(isLibraryCoreVisibleFeedItemV1(item as never)).toBe(true);
    expect(
      isLibraryCoreVisibleFeedItemV1({
        ...item,
        userState: { ...item.userState, archived: true },
      } as never),
    ).toBe(false);
    expect(
      isLibraryCoreVisibleFeedItemV1({
        ...item,
        userState: { ...item.userState, hidden: true },
      } as never),
    ).toBe(false);
  });
});
