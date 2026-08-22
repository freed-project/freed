import { describe, expect, it, vi } from "vitest";
import {
  openLibraryCoreNormalizedFeedReaderV1,
  openLibraryCoreNormalizedSavedFeedReaderV1,
  readLibraryCoreNormalizedFeedSignalCountsV1,
  scanLibraryCoreContentFetchCandidatesV1,
  scanLibraryCoreNormalizedBackgroundItemsV1,
  type LibraryCoreNormalizedQueryExecutor,
} from "./normalized-feed-readers.js";
import {
  readLibraryCoreNormalizedPreferencesV1,
  readLibraryCoreNormalizedPersonsGraphV1,
  readLibraryCoreNormalizedFriendsLocationItemV1,
  searchLibraryCoreNormalizedItemsV1,
} from "./normalized-surface-readers.js";
import { CONTENT_SIGNAL_KEYS } from "../content-signals.js";

const feedCard = (globalId: string) => ({
  archived: false,
  authorAvatarUrl: null,
  authorDisplayName: "Reader",
  authorHandle: "reader",
  authorId: "reader-1",
  capturedAt: 200,
  contentSignalTags: [],
  contentText: "Bounded row",
  contentType: "post",
  engagementComments: null,
  engagementLikes: null,
  eventConfidenceBasisPoints: null,
  eventStartsAt: null,
  globalId,
  liked: false,
  likedAt: null,
  likedSyncedAt: null,
  linkPreviewTitle: null,
  locationName: null,
  mediaTypes: [],
  mediaUrls: [],
  platform: "rss",
  publishedAt: 100,
  readAt: null,
  readingTimeMinutes: null,
  saved: false,
  sourceUrl: "https://example.com/item",
  tags: [],
});

const backgroundCard = (globalId: string) => ({
  ...feedCard(globalId),
  hidden: false,
  rssSource: null,
  sampleDataFingerprint: null,
});

describe("cross-platform normalized feed readers", () => {
  it("streams bounded background pages through one source-fenced query contract", async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({
        nextCursor: "opaque-background-next",
        rows: [backgroundCard("first")],
      })
      .mockResolvedValueOnce({
        nextCursor: null,
        rows: [backgroundCard("second")],
      }) as unknown as LibraryCoreNormalizedQueryExecutor;
    const visited: string[][] = [];

    await scanLibraryCoreNormalizedBackgroundItemsV1(
      { query, randomId: () => "test" },
      (items) => {
        visited.push(items.map((item) => item.globalId));
        return "continue";
      },
    );

    expect(visited).toEqual([["first"], ["second"]]);
    expect(query).toHaveBeenNthCalledWith(1, {
      cancellationId: "background-page:test",
      cursor: null,
      limit: 64,
      queryId: "background_item_page_v1",
      readerSessionId: "background-reader:test",
      schemaVersion: 1,
    });
    expect(query).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        cursor: "opaque-background-next",
        readerSessionId: "background-reader:test",
      }),
    );
  });

  it("stops a background scan without issuing another SQLite query", async () => {
    const query = vi.fn(async () => ({
      nextCursor: "unused-next",
      rows: [backgroundCard("first")],
    })) as unknown as LibraryCoreNormalizedQueryExecutor;

    await scanLibraryCoreNormalizedBackgroundItemsV1(
      { query, randomId: () => "test" },
      () => "stop",
    );

    expect(query).toHaveBeenCalledOnce();
  });

  it("streams compact content fetch candidates without reconstructing items", async () => {
    const candidate = {
      capturedAt: 20,
      globalId: "rss:item-1",
      linkUrl: "https://example.test/article",
      publishedAt: 10,
    };
    const query = vi
      .fn()
      .mockResolvedValueOnce({ nextCursor: "next", rows: [candidate] })
      .mockResolvedValueOnce({
        nextCursor: null,
        rows: [],
      }) as unknown as LibraryCoreNormalizedQueryExecutor;
    const visit = vi.fn();

    await scanLibraryCoreContentFetchCandidatesV1(
      { query, randomId: () => "test" },
      visit,
    );

    expect(visit).toHaveBeenCalledOnce();
    expect(visit).toHaveBeenCalledWith([candidate]);
    expect(query).toHaveBeenNthCalledWith(1, {
      cancellationId: "content-fetch-page:test",
      cursor: null,
      limit: 64,
      queryId: "content_fetch_claim_v1",
      readerSessionId: "content-fetch-reader:test",
      schemaVersion: 1,
    });
    expect(query).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        cursor: "next",
        readerSessionId: "content-fetch-reader:test",
      }),
    );
  });

  it("batches Friends aggregates through the bounded SQLite contract", async () => {
    const sources = Array.from({ length: 129 }, (_, index) => ({
      authorId: `author-${index}`,
      platform: "x",
    }));
    const query = vi.fn(async (request: { sources: typeof sources }) => ({
      queryId: "persons_graph_v1",
      rss: [],
      schemaVersion: 1,
      social: request.sources.map((source) => ({
        ...source,
        avatarGlobalId: null,
        avatarPublishedAt: null,
        avatarUrl: null,
        hasLocation: false,
        itemCount: 1,
        latestActivityAt: 100,
        locationCandidateCount: 0,
        locationCandidates: [],
        recentCount: 1,
        sampleItems: [],
        signalCounts: CONTENT_SIGNAL_KEYS.map((label) => ({ count: 0, label })),
      })),
      source: {
        generationId: "a".repeat(64),
        projectionRevision: 7,
        transitionSequence: 7,
      },
      totalItemCount: 129,
    })) as unknown as LibraryCoreNormalizedQueryExecutor;

    const graph = await readLibraryCoreNormalizedPersonsGraphV1(
      { query, randomId: () => "test" },
      {
        recentWindow: { startMs: 0, endMs: 200 },
        rssFeedUrls: [],
        sources,
      },
    );

    expect(query).toHaveBeenCalledTimes(2);
    expect(graph.social).toHaveLength(129);
    expect(graph.social.at(-1)?.authorId).toBe("author-128");
    expect(graph.sourceToken).toBe(`sqlite-v1:${"a".repeat(64)}:7:7`);
  });

  it("binds a Friends location item to the exact SQLite graph source", async () => {
    const query = vi.fn(async () => ({
      item: {
        card: { ...feedCard("located"), locationName: "Babbage Square" },
        contentBody: { blobDigest: null, storage: "inline" },
        preservedBody: { blobDigest: null, storage: "none" },
      },
      source: {
        generationId: "a".repeat(64),
        projectionRevision: 7,
        transitionSequence: 7,
      },
    })) as unknown as LibraryCoreNormalizedQueryExecutor;

    await expect(
      readLibraryCoreNormalizedFriendsLocationItemV1(
        { query, randomId: () => "test" },
        {
          effectiveAt: 100,
          globalId: "located",
          owner: { authorId: "reader-1", kind: "social", platform: "rss" },
          publishedAt: 100,
          referenceTimeMs: 200,
          sourceToken: `sqlite-v1:${"a".repeat(64)}:7:7`,
        },
      ),
    ).resolves.toMatchObject({ globalId: "located" });
  });

  it("reconstructs synchronized preferences through the normalized executor", async () => {
    const query = vi.fn(async () => ({
      rows: [
        {
          booleanValue: null,
          integerValue: null,
          path: "o:$.display",
          realValue: null,
          textValue: null,
          updatedAt: 1,
          valueType: "null",
        },
        {
          booleanValue: null,
          integerValue: null,
          path: "v:$.display.themeId",
          realValue: null,
          textValue: "neon",
          updatedAt: 1,
          valueType: "text",
        },
      ],
    })) as unknown as LibraryCoreNormalizedQueryExecutor;

    await expect(
      readLibraryCoreNormalizedPreferencesV1({
        query,
        randomId: () => "test",
      }),
    ).resolves.toEqual(
      expect.objectContaining({
        display: expect.objectContaining({ themeId: "neon" }),
        weights: expect.any(Object),
      }),
    );
    expect(query).toHaveBeenCalledWith({
      queryId: "preferences_snapshot_v1",
      schemaVersion: 1,
    });
  });

  it("streams source-fenced SQLite search pages without retaining a corpus", async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({
        nextCursor: "opaque-search-next",
        rows: [{ card: feedCard("match"), priority: 91, score: 12 }],
      })
      .mockResolvedValueOnce({
        nextCursor: null,
        rows: [],
      }) as unknown as LibraryCoreNormalizedQueryExecutor;
    const visit = vi.fn(() => "continue" as const);

    await searchLibraryCoreNormalizedItemsV1(
      { query, randomId: () => "test" },
      {
        filter: { platform: "rss" },
        identityMode: "friends",
        query: "bounded",
      },
      visit,
    );

    expect(query).toHaveBeenCalledTimes(2);
    expect(query).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        cursor: null,
        identityMode: "friends",
        queryId: "search_page_v1",
      }),
    );
    expect(query).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ cursor: "opaque-search-next" }),
    );
    expect(visit).toHaveBeenCalledWith([
      expect.objectContaining({
        item: expect.objectContaining({ globalId: "match", priority: 91 }),
        score: 12,
      }),
    ]);
  });

  it("uses opaque bidirectional pages without platform storage logic", async () => {
    const query = vi.fn(async () => ({
      rows: [feedCard("first")],
      nextCursor: "opaque-next",
      previousCursor: null,
      totalCount: 2,
    })) as unknown as LibraryCoreNormalizedQueryExecutor;
    const reader = await openLibraryCoreNormalizedFeedReaderV1(
      { query, randomId: () => "test" },
      { platform: "rss" },
      100,
    );

    expect(reader.totalCount).toBe(2);
    await expect(reader.readPage(null, "next")).resolves.toEqual({
      items: [expect.objectContaining({ globalId: "first" })],
      nextCursor: "opaque-next",
      previousCursor: null,
    });
    expect(query).toHaveBeenCalledWith(
      expect.objectContaining({
        identityMode: "all_content",
        queryId: "feed_browse_page_v3",
        rankingClockMs: 100,
      }),
    );
  });

  it("binds Friends to the closed SQLite identity predicate", async () => {
    const query = vi.fn(async () => ({
      rows: [feedCard("friend")],
      nextCursor: null,
      previousCursor: null,
      totalCount: 1,
    })) as unknown as LibraryCoreNormalizedQueryExecutor;

    await openLibraryCoreNormalizedFeedReaderV1(
      { query, randomId: () => "test" },
      {},
      100,
      "friends",
    );

    expect(query).toHaveBeenCalledWith(
      expect.objectContaining({
        friendsPredicateSchemaVersion: 1,
        identityMode: "friends",
        queryId: "feed_browse_page_v3",
      }),
    );
  });

  it("preserves Saved metadata through the shared reader", async () => {
    const query = vi.fn(async () => ({
      rows: [{ ...feedCard("saved"), saved: true, savedAt: 150 }],
      nextCursor: null,
      previousCursor: null,
      totalCount: 1,
    })) as unknown as LibraryCoreNormalizedQueryExecutor;
    const reader = await openLibraryCoreNormalizedSavedFeedReaderV1(
      { query, randomId: () => "test" },
      {},
      "date_saved",
    );

    await expect(reader.readNext()).resolves.toEqual([
      expect.objectContaining({
        userState: expect.objectContaining({ saved: true, savedAt: 150 }),
      }),
    ]);
    expect(query).toHaveBeenCalledWith(
      expect.objectContaining({
        queryId: "saved_feed_page_v2",
        sortMode: "date_saved",
      }),
    );
  });

  it("derives all signal counts through the same normalized executor", async () => {
    const query = vi.fn(async () => ({
      totalCount: 42,
    })) as unknown as LibraryCoreNormalizedQueryExecutor;
    const counts = await readLibraryCoreNormalizedFeedSignalCountsV1(
      { query, randomId: () => "test" },
      { platform: "rss" },
      100,
    );

    expect(counts.all).toBe(42);
    expect(query).toHaveBeenCalledTimes(6);
    expect(query).toHaveBeenCalledWith(
      expect.objectContaining({
        limit: 1,
        queryId: "feed_browse_page_v3",
      }),
    );
  });
});
