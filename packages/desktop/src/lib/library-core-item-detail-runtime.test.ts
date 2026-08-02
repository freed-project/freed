import { describe, expect, it, vi } from "vitest";
import type { FeedItemRow } from "@freed/shared/projection";
import type { LibraryCoreProjectionSourceV1 } from "./automerge-types";
import {
  LIBRARY_CORE_SAVED_ANALYTICS_READER_DISABLED_KEY,
  readLibraryCoreFacetSummary,
  readLibraryCoreItemDetail,
  readLibraryCoreSavedAnalytics,
  readLibraryCoreSurfaceItems,
  scanLibraryCoreItems,
} from "./library-core-item-detail-runtime";

vi.mock("./automerge", () => ({
  getLibraryCoreProjectionSource: vi.fn(),
}));

const source: LibraryCoreProjectionSourceV1 = {
  schemaVersion: 1,
  documentId: "library-document",
  headsDigest: "1".repeat(64),
  headCount: 2,
  storageRevision: { generation: 3, saveRevision: 4 },
};

const row: FeedItemRow = {
  globalId: "rss:item-1",
  platform: "rss",
  contentType: "article",
  publishedAt: 42,
  capturedAt: 43,
  authorId: "author-1",
  authorDisplayName: "Writer",
  authorHandle: "writer",
  sourceUrl: "https://example.test/item-1",
  hidden: 0,
  saved: 1,
  archived: 0,
  readAt: null,
  archivedAt: null,
  likedAt: null,
  tags: "[]",
  contentBlob: "{\"text\":\"preview\"}",
  preservedBlob: "{\"text\":\"complete body\",\"readingTime\":7}",
  rest: "{\"__userState\":{\"liked\":false}}",
};

function response(item: FeedItemRow | null = row) {
  return {
    item,
    queryId: "item_detail_v1",
    schemaVersion: 1,
    source: {
      documentId: source.documentId,
      generationId: "2".repeat(64),
      headCount: source.headCount,
      headsDigest: source.headsDigest,
      projectionRevision: 5,
      storageGeneration: source.storageRevision.generation,
      storageSaveRevision: source.storageRevision.saveRevision,
      transitionSequence: 6,
    },
  };
}

function scanResponse(
  rows: FeedItemRow[],
  nextCursor: string | null,
  sourceOverrides: Record<string, unknown> = {},
) {
  const detail = response();
  return {
    nextCursor,
    queryId: "background_item_page_v1",
    rows,
    schemaVersion: 1,
    source: { ...detail.source, ...sourceOverrides },
  };
}

function analyticsWindows(length: number, startMs: number) {
  return Array.from({ length }, (_, index) => ({
    startMs: startMs + index * 1_000,
    endMs: startMs + (index + 1) * 1_000,
  }));
}

function savedAnalyticsResponse() {
  return {
    contentMix: [
      { count: 4, label: "article" },
      { count: 2, label: "post" },
    ],
    dailyCounts: [0, 0, 0, 1, 1, 2, 2],
    hourlyCounts: [
      0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
      0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1,
    ],
    latestSavedAt: 123_000,
    queryId: "saved_analytics_v1",
    schemaVersion: 1,
    source: response().source,
    sourceCounts: [
      { count: 3, label: "example.test" },
      { count: 2, label: "writer" },
      { count: 1, label: "Unknown" },
    ],
    totalCount: 6,
  };
}

describe("Desktop Library Core item detail runtime", () => {
  it("reconstructs one complete item from the selected SQLite row", async () => {
    const getSource = vi.fn().mockResolvedValue(source);
    const readNative = vi.fn().mockResolvedValue(response());

    const item = await readLibraryCoreItemDetail(
      row.globalId,
      getSource,
      readNative,
    );

    expect(item).toMatchObject({
      globalId: row.globalId,
      platform: "rss",
      preservedContent: { text: "complete body", readingTime: 7 },
      userState: { saved: true, liked: false },
    });
    expect(getSource).toHaveBeenCalledTimes(2);
    expect(readNative).toHaveBeenCalledWith({
      globalId: row.globalId,
      queryId: "item_detail_v1",
      schemaVersion: 1,
    });
  });

  it("returns null without inventing a missing item", async () => {
    await expect(
      readLibraryCoreItemDetail(
        "rss:missing",
        vi.fn().mockResolvedValue(source),
        vi.fn().mockResolvedValue(response(null)),
      ),
    ).resolves.toBeNull();
  });

  it("rejects a selected generation that is stale before or during the read", async () => {
    const moved = {
      ...source,
      headsDigest: "3".repeat(64),
    };
    await expect(
      readLibraryCoreItemDetail(
        row.globalId,
        vi.fn().mockResolvedValue(moved),
        vi.fn().mockResolvedValue(response()),
      ),
    ).rejects.toThrow("source is stale");

    const getSource = vi
      .fn()
      .mockResolvedValueOnce(source)
      .mockResolvedValueOnce(moved);
    await expect(
      readLibraryCoreItemDetail(
        row.globalId,
        getSource,
        vi.fn().mockResolvedValue(response()),
      ),
    ).rejects.toThrow("source changed during read");
  });

  it("rejects decorated responses and mismatched item identities", async () => {
    await expect(
      readLibraryCoreItemDetail(
        row.globalId,
        vi.fn().mockResolvedValue(source),
        vi.fn().mockResolvedValue({ ...response(), extra: true }),
      ),
    ).rejects.toThrow("response is invalid");
    await expect(
      readLibraryCoreItemDetail(
        row.globalId,
        vi.fn().mockResolvedValue(source),
        vi.fn().mockResolvedValue(response({ ...row, globalId: "rss:other" })),
      ),
    ).rejects.toThrow("row is invalid");
  });

  it("reads exact native facets without retaining item identities", async () => {
    const detail = response();
    const validSummaryResponse = {
      queryId: "library_facet_summary_v1",
      schemaVersion: 1,
      source: detail.source,
      summary: {
        archivedCount: 2,
        sampleItemCount: 5,
        savedArchivedCount: 1,
        savedCount: 3,
        savedPlatformCount: 4,
        tags: ["alpha", "beta"],
        totalCount: 10,
      },
    };
    const readNative = vi.fn().mockResolvedValue(validSummaryResponse);

    await expect(
      readLibraryCoreFacetSummary(
        vi.fn().mockResolvedValue(source),
        readNative,
      ),
    ).resolves.toEqual({
      archivedCount: 2,
      sampleItemCount: 5,
      savedArchivedCount: 1,
      savedCount: 3,
      savedPlatformCount: 4,
      tags: ["alpha", "beta"],
      totalCount: 10,
    });
    expect(readNative).toHaveBeenCalledWith({
      queryId: "library_facet_summary_v1",
      schemaVersion: 1,
    });

    await expect(
      readLibraryCoreFacetSummary(
        vi.fn().mockResolvedValue(source),
        vi.fn().mockResolvedValue({
          ...validSummaryResponse,
          summary: {
            ...validSummaryResponse.summary,
            sampleItemCount: 11,
          },
        }),
      ),
    ).rejects.toThrow("response is inconsistent");
  });

  it.each([
    ["map", 1_000],
    ["story_wall", 250],
  ] as const)("reads only the bounded native candidates for %s", async (surface, limit) => {
    const detail = response();
    const readNative = vi.fn().mockResolvedValue({
      queryId: "library_surface_items_v1",
      rows: [row],
      schemaVersion: 1,
      source: detail.source,
      surface,
    });

    const items = await readLibraryCoreSurfaceItems(
      surface,
      vi.fn().mockResolvedValue(source),
      readNative,
    );

    expect(items.map((item) => item.globalId)).toEqual([row.globalId]);
    expect(readNative).toHaveBeenCalledWith({
      limit,
      queryId: "library_surface_items_v1",
      schemaVersion: 1,
      surface,
    });
  });

  it("reads exact bounded Saved analytics without item bodies", async () => {
    const request = {
      dailyWindows: analyticsWindows(7, 10_000),
      hourlyWindows: analyticsWindows(24, 20_000),
    };
    const readNative = vi.fn().mockResolvedValue(savedAnalyticsResponse());

    await expect(
      readLibraryCoreSavedAnalytics(
        request,
        vi.fn().mockResolvedValue(source),
        readNative,
      ),
    ).resolves.toEqual({
      contentMix: [
        { count: 4, label: "article" },
        { count: 2, label: "post" },
      ],
      dailyCounts: [0, 0, 0, 1, 1, 2, 2],
      hourlyCounts: [
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1,
      ],
      latestSavedAt: 123_000,
      sourceCounts: [
        { count: 3, label: "example.test" },
        { count: 2, label: "writer" },
        { count: 1, label: "Unknown" },
      ],
      totalCount: 6,
    });
    expect(readNative).toHaveBeenCalledWith({
      ...request,
      queryId: "saved_analytics_v1",
      schemaVersion: 1,
    });
  });

  it("keeps the Saved rollback switch ahead of projection reads", async () => {
    const getItem = vi.fn((key: string) =>
      key === LIBRARY_CORE_SAVED_ANALYTICS_READER_DISABLED_KEY ? "1" : null,
    );
    vi.stubGlobal("localStorage", { getItem });
    const getSource = vi.fn().mockResolvedValue(source);
    const readNative = vi.fn().mockResolvedValue(savedAnalyticsResponse());

    try {
      await expect(
        readLibraryCoreSavedAnalytics(
          {
            dailyWindows: analyticsWindows(7, 10_000),
            hourlyWindows: analyticsWindows(24, 20_000),
          },
          getSource,
          readNative,
        ),
      ).rejects.toThrow("Saved analytics reader is disabled");
      expect(getSource).not.toHaveBeenCalled();
      expect(readNative).not.toHaveBeenCalled();
      expect(getItem).toHaveBeenCalledWith(
        LIBRARY_CORE_SAVED_ANALYTICS_READER_DISABLED_KEY,
      );
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("rejects malformed Saved analytics windows and responses", async () => {
    const dailyWindows = analyticsWindows(7, 10_000);
    const hourlyWindows = analyticsWindows(24, 20_000);
    await expect(
      readLibraryCoreSavedAnalytics(
        {
          dailyWindows: dailyWindows.map((window, index) =>
            index === 3 ? { ...window, endMs: window.startMs } : window,
          ),
          hourlyWindows,
        },
        vi.fn(),
        vi.fn(),
      ),
    ).rejects.toThrow("windows are invalid");

    await expect(
      readLibraryCoreSavedAnalytics(
        {
          dailyWindows: dailyWindows.map((window, index) =>
            index === 3 ? { ...window, startMs: window.startMs + 1 } : window,
          ),
          hourlyWindows,
        },
        vi.fn(),
        vi.fn(),
      ),
    ).rejects.toThrow("windows are invalid");

    await expect(
      readLibraryCoreSavedAnalytics(
        { dailyWindows, hourlyWindows },
        vi.fn().mockResolvedValue(source),
        vi.fn().mockResolvedValue({
          ...savedAnalyticsResponse(),
          sourceCounts: [{ count: 5, label: "example.test" }],
        }),
      ),
    ).rejects.toThrow("response is inconsistent");

    await expect(
      readLibraryCoreSavedAnalytics(
        { dailyWindows, hourlyWindows },
        vi.fn().mockResolvedValue(source),
        vi.fn().mockResolvedValue({
          ...savedAnalyticsResponse(),
          dailyCounts: [1],
        }),
      ),
    ).rejects.toThrow("response is invalid");
  });

  it("accepts the duplicate local-hour windows produced by DST", async () => {
    const hourlyWindows = analyticsWindows(24, 20_000);
    hourlyWindows[14] = { ...hourlyWindows[13]! };
    for (let index = 15; index < hourlyWindows.length; index += 1) {
      hourlyWindows[index] = {
        startMs: 20_000 + (index - 1) * 1_000,
        endMs: 20_000 + index * 1_000,
      };
    }
    const readNative = vi.fn().mockResolvedValue(savedAnalyticsResponse());

    await expect(
      readLibraryCoreSavedAnalytics(
        {
          dailyWindows: analyticsWindows(7, 10_000),
          hourlyWindows,
        },
        vi.fn().mockResolvedValue(source),
        readNative,
      ),
    ).resolves.toMatchObject({ totalCount: 6 });
    expect(readNative).toHaveBeenCalledWith({
      dailyWindows: analyticsWindows(7, 10_000),
      hourlyWindows,
      queryId: "saved_analytics_v1",
      schemaVersion: 1,
    });

    hourlyWindows[16] = { ...hourlyWindows[15]! };
    await expect(
      readLibraryCoreSavedAnalytics(
        {
          dailyWindows: analyticsWindows(7, 10_000),
          hourlyWindows,
        },
        vi.fn(),
        vi.fn(),
      ),
    ).rejects.toThrow("windows are invalid");
  });

  it("snapshots Saved request and response arrays across async boundaries", async () => {
    const request = {
      dailyWindows: analyticsWindows(7, 10_000),
      hourlyWindows: analyticsWindows(24, 20_000),
    };
    const nativeResponse = savedAnalyticsResponse();
    let resolveInitialSource!: (value: LibraryCoreProjectionSourceV1) => void;
    const initialSource = new Promise<LibraryCoreProjectionSourceV1>((resolve) => {
      resolveInitialSource = resolve;
    });
    const getSource = vi
      .fn()
      .mockReturnValueOnce(initialSource)
      .mockResolvedValue(source);
    const readNative = vi.fn().mockResolvedValue(nativeResponse);

    const resultPromise = readLibraryCoreSavedAnalytics(
      request,
      getSource,
      readNative,
    );
    request.dailyWindows[0]!.startMs = 999_999;
    resolveInitialSource(source);
    const result = await resultPromise;

    expect(readNative.mock.calls[0]?.[0].dailyWindows[0]).toEqual({
      startMs: 10_000,
      endMs: 11_000,
    });
    expect(readNative.mock.calls[0]?.[0].dailyWindows).not.toBe(
      request.dailyWindows,
    );
    nativeResponse.dailyCounts[0] = 6;
    nativeResponse.hourlyCounts[0] = 6;
    expect(result.dailyCounts[0]).toBe(0);
    expect(result.hourlyCounts[0]).toBe(0);
  });

  it("streams bounded SQLite pages without accumulating the corpus", async () => {
    const secondRow = { ...row, globalId: "rss:item-2" };
    const getSource = vi.fn().mockResolvedValue(source);
    const readNative = vi
      .fn()
      .mockResolvedValueOnce(scanResponse([row], "cursor-1"))
      .mockResolvedValueOnce(scanResponse([secondRow], null));
    const pages: string[][] = [];

    await scanLibraryCoreItems(
      (items) => {
        pages.push(items.map((item) => item.globalId));
      },
      getSource,
      readNative,
    );

    expect(pages).toEqual([["rss:item-1"], ["rss:item-2"]]);
    expect(readNative).toHaveBeenNthCalledWith(1, expect.objectContaining({
      cursor: null,
      limit: 64,
      queryId: "background_item_page_v1",
      schemaVersion: 1,
    }));
    expect(readNative).toHaveBeenNthCalledWith(2, expect.objectContaining({
      cursor: "cursor-1",
      limit: 64,
      queryId: "background_item_page_v1",
      schemaVersion: 1,
    }));
    const firstRequest = readNative.mock.calls[0]?.[0];
    const secondRequest = readNative.mock.calls[1]?.[0];
    expect(firstRequest?.readerSessionId).toBe(secondRequest?.readerSessionId);
    expect(firstRequest?.cancellationId).not.toBe(secondRequest?.cancellationId);
    expect(getSource).toHaveBeenCalledTimes(2);
  });

  it("fails closed when a scan changes generation or stops making progress", async () => {
    await expect(
      scanLibraryCoreItems(
        vi.fn(),
        vi.fn().mockResolvedValue(source),
        vi
          .fn()
          .mockResolvedValueOnce(scanResponse([row], "cursor-1"))
          .mockResolvedValueOnce(
            scanResponse([{ ...row, globalId: "rss:item-2" }], null, {
              generationId: "9".repeat(64),
            }),
          ),
      ),
    ).rejects.toThrow("generation changed");

    await expect(
      scanLibraryCoreItems(
        vi.fn(),
        vi.fn().mockResolvedValue(source),
        vi.fn().mockResolvedValue(scanResponse([], "cursor-1")),
      ),
    ).rejects.toThrow("made no progress");
  });
});
