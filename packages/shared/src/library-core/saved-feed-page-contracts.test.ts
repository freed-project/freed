import { describe, expect, it } from "vitest";
import type { FeedItem, SavedContentSortMode } from "../types.js";
import { normalizeLibraryCoreFeedBrowseFilterV1 } from "./feed-browse-filter-contract.js";
import type {
  LibraryCoreEntityId,
  LibraryCoreLowercaseHex64,
} from "./protocol-scalars.js";
import {
  LIBRARY_CORE_SAVED_FEED_SORT_ORDER_V1,
  compareLibraryCoreSavedFeedSortKeyV1,
  encodeLibraryCoreSavedFeedPageCursorV1,
  libraryCoreSavedFeedSortKeyV1,
  parseLibraryCoreSavedFeedPageRequestV1,
  parseLibraryCoreSavedFeedPageResponseV1,
  projectLibraryCoreSavedFeedCardV1,
  type LibraryCoreSavedFeedPageResponseV1,
} from "./saved-feed-page-contracts.js";

const generationId = "a".repeat(64) as LibraryCoreLowercaseHex64;
const filter = normalizeLibraryCoreFeedBrowseFilterV1({ savedOnly: true });

function entityId(value: string): LibraryCoreEntityId {
  return value as LibraryCoreEntityId;
}

function item(
  globalId: string,
  {
    capturedAt,
    priority,
    publishedAt,
    readingTime,
    savedAt,
  }: {
    capturedAt: number;
    priority: number;
    publishedAt: number;
    readingTime?: number;
    savedAt?: number;
  },
): FeedItem {
  return {
    globalId,
    platform: "saved",
    contentType: "article",
    capturedAt,
    publishedAt,
    author: { id: "author", handle: "author", displayName: "Author" },
    content: { text: globalId, mediaUrls: [], mediaTypes: [] },
    ...(readingTime === undefined
      ? {}
      : {
          preservedContent: {
            text: "",
            wordCount: readingTime * 200,
            readingTime,
            preservedAt: capturedAt,
          },
        }),
    userState: {
      hidden: false,
      saved: true,
      ...(savedAt === undefined ? {} : { savedAt }),
      archived: false,
      tags: [],
    },
    topics: [],
    priority,
  };
}

describe("saved-feed page contracts", () => {
  it("matches all four Saved sort modes with exact fallbacks and binary ties", () => {
    const items = [
      item("saved:a", {
        capturedAt: 50,
        savedAt: 100,
        publishedAt: 400,
        priority: 10,
        readingTime: 5,
      }),
      item("saved:b", {
        capturedAt: 60,
        savedAt: 300,
        publishedAt: 100,
        priority: 90,
      }),
      item("saved:c", {
        capturedAt: 70,
        savedAt: 200,
        publishedAt: 300,
        priority: 90,
        readingTime: 2,
      }),
      item("saved:d", {
        capturedAt: 80,
        savedAt: 200,
        publishedAt: 300,
        priority: 90,
        readingTime: 2,
      }),
      item("saved:e", {
        capturedAt: 250,
        publishedAt: 0,
        priority: 20,
        readingTime: 7,
      }),
    ];
    const expectations: Record<SavedContentSortMode, readonly string[]> = {
      date_saved: ["saved:b", "saved:e", "saved:c", "saved:d", "saved:a"],
      date_published: ["saved:a", "saved:c", "saved:d", "saved:e", "saved:b"],
      recommended: ["saved:c", "saved:d", "saved:b", "saved:e", "saved:a"],
      shortest_read: ["saved:c", "saved:d", "saved:a", "saved:e", "saved:b"],
    };
    for (const [mode, expected] of Object.entries(expectations) as [
      SavedContentSortMode,
      readonly string[],
    ][]) {
      const ordered = items
        .map((entry) =>
          libraryCoreSavedFeedSortKeyV1(entry, mode, entry.priority ?? 0),
        )
        .sort(compareLibraryCoreSavedFeedSortKeyV1)
        .map((entry) => entry.globalId);
      expect(ordered, mode).toEqual(expected);
    }
    const compact = projectLibraryCoreSavedFeedCardV1(items[2]!);
    expect(compact.savedAt).toBe(200);
    expect(compact.readingTimeMinutes).toBe(2);
    expect(projectLibraryCoreSavedFeedCardV1(items[4]!).savedAt).toBeNull();

    const binaryTies = ["saved:a", "saved:A", "saved:!"].map((globalId) =>
      item(globalId, {
        capturedAt: 50,
        savedAt: 100,
        publishedAt: 400,
        priority: 10,
      }),
    );
    const expectedBinaryOrder = ["saved:!", "saved:A", "saved:a"];
    expect(
      binaryTies
        .map((entry) =>
          libraryCoreSavedFeedSortKeyV1(
            entry,
            "date_saved",
            entry.priority ?? 0,
          ),
        )
        .sort(compareLibraryCoreSavedFeedSortKeyV1)
        .map((entry) => entry.globalId),
    ).toEqual(expectedBinaryOrder);

    const rawPublishedOrder = [
      item("saved:z", {
        capturedAt: 1_000,
        publishedAt: 0,
        priority: 50,
      }),
      item("saved:a", {
        capturedAt: 1,
        publishedAt: 1,
        priority: 50,
      }),
    ]
      .map((entry) =>
        libraryCoreSavedFeedSortKeyV1(
          entry,
          "recommended",
          entry.priority ?? 0,
        ),
      )
      .sort(compareLibraryCoreSavedFeedSortKeyV1)
      .map((entry) => entry.globalId);
    expect(rawPublishedOrder).toEqual(["saved:a", "saved:z"]);

    const shortestTie = [
      item("saved:z", {
        capturedAt: 1,
        savedAt: 999,
        publishedAt: 1,
        priority: 1,
        readingTime: 2,
      }),
      item("saved:a", {
        capturedAt: 1,
        savedAt: 1,
        publishedAt: 1,
        priority: 1,
        readingTime: 2,
      }),
    ]
      .map((entry) =>
        libraryCoreSavedFeedSortKeyV1(entry, "shortest_read", 1),
      )
      .sort(compareLibraryCoreSavedFeedSortKeyV1)
      .map((entry) => entry.globalId);
    expect(shortestTie).toEqual(["saved:a", "saved:z"]);
    expect(LIBRARY_CORE_SAVED_FEED_SORT_ORDER_V1).toMatchObject({
      schemaVersion: 1,
      recommendationPriority: "calculatePriority_at_pinned_rankingClockMs",
      orders: {
        recommended: [
          "recalculatedPriority_desc",
          "rawPublishedAt_desc",
          "globalId_binary_asc",
        ],
      },
    });
  });

  it("fences a cursor to its exact generation, source revision, and sort", () => {
    const cursor = encodeLibraryCoreSavedFeedPageCursorV1({
      generationId,
      transitionSequence: 12,
      projectionRevision: 34,
      sortMode: "date_saved",
      sortGroup: 0,
      sortPrimary: 300,
      sortSecondary: 0,
      globalId: entityId("saved:item-1"),
    });
    expect(cursor).toBe(
      "AQCqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqgAAAAAAAAAMAAAAAAAAACIAAAAAAAAAASwAAAAAAAAAAAAMc2F2ZWQ6aXRlbS0x",
    );
    const request = {
      cancellationId: "saved-cancel:1",
      cursor,
      filter,
      limit: 128,
      queryId: "saved_feed_page_v1",
      rankingClockMs: 500,
      readerSessionId: "saved-reader:1",
      schemaVersion: 1,
      sortMode: "date_saved",
    };
    expect(parseLibraryCoreSavedFeedPageRequestV1(request).ok).toBe(true);
    expect(
      parseLibraryCoreSavedFeedPageRequestV1({
        ...request,
        sortMode: "date_published",
      }),
    ).toMatchObject({ ok: false, error: "request cursor sort is stale" });

    const response = {
      filter,
      nextCursor: cursor,
      queryId: "saved_feed_page_v1",
      rankingClockMs: 500,
      rows: [
        projectLibraryCoreSavedFeedCardV1(
          item("saved:item-1", {
            capturedAt: 10,
            savedAt: 300,
            publishedAt: 20,
            priority: 1,
          }),
        ),
      ],
      schemaVersion: 1,
      sortMode: "date_saved",
      source: { generationId, projectionRevision: 34, transitionSequence: 12 },
      totalCount: 1,
    };
    expect(parseLibraryCoreSavedFeedPageResponseV1(response).ok).toBe(true);
    expect(
      parseLibraryCoreSavedFeedPageResponseV1({
        ...response,
        source: {
          generationId,
          projectionRevision: 35,
          transitionSequence: 12,
        },
      }),
    ).toMatchObject({ ok: false, error: "response cursor is stale" });
  });

  it("rejects responses above the row or byte ceiling", () => {
    const compact = projectLibraryCoreSavedFeedCardV1(
      item("saved:item", {
        capturedAt: 10,
        savedAt: 20,
        publishedAt: 10,
        priority: 1,
      }),
    );
    const response: LibraryCoreSavedFeedPageResponseV1 = {
      filter,
      nextCursor: null,
      queryId: "saved_feed_page_v1",
      rankingClockMs: 500,
      rows: Array.from({ length: 129 }, (_, index) => ({
        ...compact,
        globalId: entityId(`saved:item-${index}`),
      })),
      schemaVersion: 1,
      sortMode: "date_saved",
      source: { generationId, projectionRevision: 34, transitionSequence: 12 },
      totalCount: 129,
    };
    expect(parseLibraryCoreSavedFeedPageResponseV1(response).ok).toBe(false);

    const oversizedRows = Array.from({ length: 128 }, (_, index) => ({
      ...compact,
      globalId: entityId(`saved:large-${index}`),
      mediaUrls: Array.from(
        { length: 8 },
        (__, mediaIndex) =>
          `https://example.com/${index}/${mediaIndex}/${"x".repeat(2_000)}`,
      ),
    }));
    expect(
      parseLibraryCoreSavedFeedPageResponseV1({
        ...response,
        rows: oversizedRows,
        totalCount: 128,
      }),
    ).toMatchObject({ ok: false, error: "response exceeds its byte ceiling" });
  });
});
