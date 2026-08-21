import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  LIBRARY_CORE_FEED_BROWSE_PAGE_V3_QUERY_ID,
  LIBRARY_CORE_FEED_BROWSE_PAGE_V3_SCHEMA_VERSION,
  LIBRARY_CORE_FEED_BROWSE_FRIENDS_PREDICATE_SCHEMA_VERSION,
  LIBRARY_CORE_FEED_RECOMMENDATION_ORDER_SCHEMA_VERSION,
  normalizeLibraryCoreFeedBrowseFilterV1,
  type LibraryCoreFeedBrowsePageRequestV3,
} from "@freed/shared/library-core";

const mocks = vi.hoisted(() => ({ invoke: vi.fn() }));

vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));

const { queryNormalizedLibrary } = await import(
  "./library-core-normalized-query-client"
);

const request = {
  cancellationId: "desktop-query-test",
  cursor: null,
  direction: "next",
  filter: normalizeLibraryCoreFeedBrowseFilterV1({ platform: "rss" }),
  friendsPredicateSchemaVersion:
    LIBRARY_CORE_FEED_BROWSE_FRIENDS_PREDICATE_SCHEMA_VERSION,
  identityMode: "all_content",
  limit: 64,
  queryId: LIBRARY_CORE_FEED_BROWSE_PAGE_V3_QUERY_ID,
  rankingClockMs: 123_456,
  readerSessionId: "desktop-reader-test",
  recommendationOrderSchemaVersion:
    LIBRARY_CORE_FEED_RECOMMENDATION_ORDER_SCHEMA_VERSION,
  schemaVersion: LIBRARY_CORE_FEED_BROWSE_PAGE_V3_SCHEMA_VERSION,
} as LibraryCoreFeedBrowsePageRequestV3;

const response = {
  filter: request.filter,
  friendsPredicateSchemaVersion:
    LIBRARY_CORE_FEED_BROWSE_FRIENDS_PREDICATE_SCHEMA_VERSION,
  identityMode: "all_content",
  nextCursor: null,
  nextOrder: null,
  previousCursor: null,
  previousOrder: null,
  queryId: LIBRARY_CORE_FEED_BROWSE_PAGE_V3_QUERY_ID,
  rankingClockMs: request.rankingClockMs,
  recommendationOrderSchemaVersion:
    LIBRARY_CORE_FEED_RECOMMENDATION_ORDER_SCHEMA_VERSION,
  rows: [],
  schemaVersion: LIBRARY_CORE_FEED_BROWSE_PAGE_V3_SCHEMA_VERSION,
  source: {
    generationId: "a".repeat(64),
    projectionRevision: 1,
    transitionSequence: 1,
  },
  totalCount: 0,
};

describe("Freed Desktop normalized query client", () => {
  beforeEach(() => mocks.invoke.mockReset());

  it("sends only the validated typed request to the native boundary", async () => {
    mocks.invoke.mockResolvedValue(response);

    await expect(queryNormalizedLibrary(request)).resolves.toEqual(response);
    expect(mocks.invoke).toHaveBeenCalledWith("query_normalized_library", {
      request,
    });
  });

  it("rejects a native response with compatibility payload fields", async () => {
    mocks.invoke.mockResolvedValue({ ...response, shellJson: "{}" });

    await expect(queryNormalizedLibrary(request)).rejects.toThrow(
      "response fields do not match schema version 3",
    );
  });
});
