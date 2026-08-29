import { describe, expect, it, vi } from "vitest";
import type {
  LibraryCoreProviderMediaPageRequestV1,
  LibraryCoreProviderMediaPageResponseV1,
  LibraryCoreProviderMediaRowV1,
} from "@freed/shared/library-core";

import {
  readSavedLibraryCoreYouTubeVideoUrls,
  scanLibraryCoreProviderItems,
} from "./library-core-provider-settings-runtime";

function row(
  index: number,
  platform: "facebook" | "instagram" | "youtube",
  overrides: Partial<LibraryCoreProviderMediaRowV1> = {},
): LibraryCoreProviderMediaRowV1 {
  return {
    archived: false,
    authorAvatarUrl: null,
    authorDisplayName: `Author ${index.toLocaleString()}`,
    authorHandle: `author-${index.toLocaleString()}`,
    authorId: `author-${index.toLocaleString()}`,
    capturedAt: index,
    contentSignalTags: [],
    contentText: null,
    contentType: "post",
    engagementComments: null,
    engagementLikes: null,
    eventConfidenceBasisPoints: null,
    eventStartsAt: null,
    fbGroup: null,
    globalId: `${platform}:item-${index.toLocaleString()}` as never,
    liked: false,
    likedAt: null,
    likedSyncedAt: null,
    linkPreviewTitle: null,
    linkUrl: null,
    locationName: null,
    mediaTypes: [],
    mediaUrls: [],
    platform,
    publishedAt: index,
    readAt: null,
    readingTimeMinutes: null,
    saved: false,
    sourceUrl: null,
    tags: [],
    ...overrides,
  };
}

function pagedQuery(rows: readonly LibraryCoreProviderMediaRowV1[]) {
  return vi.fn(
    async (
      request: LibraryCoreProviderMediaPageRequestV1,
    ): Promise<LibraryCoreProviderMediaPageResponseV1> => {
      const start = request.cursor === null ? 0 : Number(request.cursor);
      const pageRows = rows.slice(start, start + request.limit);
      const next = start + pageRows.length;
      return {
        nextCursor: next < rows.length ? String(next) : null,
        queryId: "provider_media_page_v1",
        rows: pageRows,
        schemaVersion: 1,
        source: {
          generationId: "a".repeat(64) as never,
          projectionRevision: 1,
          transitionSequence: 1,
        },
      };
    },
  );
}

describe("Library Core provider settings runtime", () => {
  it("streams provider rows through query-specific pages bounded at 64", async () => {
    const rows = Array.from({ length: 130 }, (_, index) =>
      row(index, "instagram"),
    );
    const queryPage = pagedQuery(rows);
    const visitedIds: string[] = [];
    let maximumResidentRows = 0;
    await scanLibraryCoreProviderItems(
      "instagram",
      async (page) => {
        maximumResidentRows = Math.max(maximumResidentRows, page.length);
        visitedIds.push(...page.map((entry) => entry.globalId));
      },
      { queryPage },
    );
    expect(maximumResidentRows).toBe(64);
    expect(visitedIds).toEqual(rows.map((entry) => entry.globalId));
    expect(queryPage).toHaveBeenCalledTimes(3);
    expect(queryPage.mock.calls[0]?.[0]).toMatchObject({
      provider: "instagram",
      queryId: "provider_media_page_v1",
      savedOnly: false,
    });
  });

  it("fails closed on oversized pages, cancellation, and visitor failures", async () => {
    const oversized = pagedQuery(
      Array.from({ length: 65 }, (_, index) => row(index, "facebook")),
    );
    await expect(
      scanLibraryCoreProviderItems("facebook", vi.fn(), {
        queryPage: async (request) => ({
          ...(await oversized({ ...request, limit: 65 })),
          nextCursor: null,
        }),
      }),
    ).rejects.toThrow("page exceeds 64 rows");
    const controller = new AbortController();
    await expect(
      scanLibraryCoreProviderItems("facebook", () => controller.abort(), {
        queryPage: pagedQuery([row(1, "facebook")]),
        signal: controller.signal,
      }),
    ).rejects.toThrow("scan was cancelled");
    await expect(
      scanLibraryCoreProviderItems(
        "facebook",
        () => {
          throw new Error("visitor rejected page");
        },
        { queryPage: pagedQuery([row(1, "facebook")]) },
      ),
    ).rejects.toThrow("visitor rejected page");
  });

  it("asks SQLite for saved YouTube rows and deduplicates canonical identities", async () => {
    const firstId = "ABCDEFGHIJK";
    const secondId = "LMNOPQRSTUV";
    const queryPage = pagedQuery([
      row(1, "youtube", {
        saved: true,
        sourceUrl: `https://youtu.be/${firstId}?feature=share`,
      }),
      row(2, "youtube", {
        linkUrl: `https://www.youtube.com/watch?v=${secondId}`,
        saved: true,
      }),
      row(3, "youtube", {
        saved: true,
        sourceUrl: `https://www.youtube.com/shorts/${secondId}`,
      }),
    ]);
    await expect(
      readSavedLibraryCoreYouTubeVideoUrls({ queryPage }),
    ).resolves.toEqual([
      `https://www.youtube.com/watch?v=${firstId}`,
      `https://www.youtube.com/watch?v=${secondId}`,
    ]);
    expect(queryPage.mock.calls[0]?.[0]).toMatchObject({
      provider: "youtube",
      savedOnly: true,
    });
  });
});
