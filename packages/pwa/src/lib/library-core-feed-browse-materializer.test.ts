import { describe, expect, it } from "vitest";
import {
  filterFeedItems,
  rankFeedItemsInRecommendedOrder,
  type FeedItem,
} from "@freed/shared";
import { createEmptyDoc } from "@freed/shared/schema";

import { materializePwaLibraryCoreFeedBrowseGeneration } from "./library-core-feed-browse-materializer";
import type {
  AppendPwaLibraryCoreBrowseGenerationPageInput,
  PwaLibraryCoreBrowseProjectedRowV1,
} from "./library-core-feed-reader-runtime";

const NOW = 1_780_000_000_000;

function item(
  globalId: string,
  publishedAt: number,
  overrides: Partial<FeedItem> = {},
): FeedItem {
  return {
    author: {
      displayName: globalId,
      handle: globalId,
      id: `author:${globalId}`,
    },
    capturedAt: NOW,
    content: { mediaTypes: [], mediaUrls: [], text: globalId },
    contentType: "post",
    globalId,
    platform: "x",
    publishedAt,
    topics: [],
    userState: {
      archived: false,
      hidden: false,
      saved: false,
      tags: [],
    },
    ...overrides,
  } as FeedItem;
}

describe("PWA Library Core browse materializer", () => {
  it("streams filtered recommendation tuples in bounded pages with exact order metadata", async () => {
    const document = createEmptyDoc();
    const sourceItems = Array.from({ length: 385 }, (_, index) => {
      const globalId = `x:${index.toString().padStart(3, "0")}`;
      return item(globalId, NOW - (index % 11) * 60_000, {
        topics: index % 5 === 0 ? ["essay"] : [],
        userState: {
          archived: false,
          hidden: index === 384,
          saved: index % 2 === 0,
          tags: index % 3 === 0 ? ["work"] : [],
        },
      });
    });
    document.feedItems = Object.fromEntries(
      sourceItems.map((value) => [value.globalId, value]),
    );
    document.preferences.weights.authors["author:x:006"] = 100;

    const pages: PwaLibraryCoreBrowseProjectedRowV1[][] = [];
    const result = await materializePwaLibraryCoreFeedBrowseGeneration({
      committed: {
        heads: ["a".repeat(64)],
        revision: { generation: 4, saveRevision: 9 },
      },
      document,
      filter: { savedOnly: true },
      rankingClockMs: NOW,
      subtle: crypto.subtle,
      writer: {
        async appendBrowseGenerationPage(
          input: AppendPwaLibraryCoreBrowseGenerationPageInput,
        ) {
          pages.push([...input.rows]);
        },
        async beginBrowseGeneration(input) {
          expect(input.totalCount).toBe(192);
          return "staging";
        },
        async finalizeBrowseGeneration() {},
      },
    });

    expect(pages.map((page) => page.length)).toStrictEqual([128, 64]);
    const projected = pages.flat();
    expect(projected.map(({ sourceSequence }) => sourceSequence)).toStrictEqual(
      Array.from({ length: 192 }, (_, index) => index * 2),
    );
    const materializedOrder = [...projected]
      .sort(
        (left, right) =>
          right.priority - left.priority ||
          (right.row.publishedAt ?? 0) - (left.row.publishedAt ?? 0) ||
          left.sourceSequence - right.sourceSequence,
      )
      .map(({ row }) => row.globalId);
    const expectedOrder = rankFeedItemsInRecommendedOrder(
      filterFeedItems(sourceItems, { savedOnly: true }),
      document.preferences.weights,
      { accounts: document.accounts, persons: document.persons },
      NOW,
    ).map(({ globalId }) => globalId);

    expect(materializedOrder).toStrictEqual(expectedOrder);
    expect(result).toMatchObject({
      filter: {
        savedOnly: true,
        schemaVersion: 1,
      },
      rankingClockMs: NOW,
      totalCount: 192,
    });
  });

  it("binds normalized filter and ranking clock into generation identity", async () => {
    const document = createEmptyDoc();
    const identities: string[] = [];
    const run = async (
      tags: string[],
      rankingClockMs: number,
    ): Promise<void> => {
      const result = await materializePwaLibraryCoreFeedBrowseGeneration({
        committed: {
          heads: ["b".repeat(64)],
          revision: { generation: 5, saveRevision: 10 },
        },
        document,
        filter: { tags },
        rankingClockMs,
        subtle: crypto.subtle,
        writer: {
          async appendBrowseGenerationPage() {},
          async beginBrowseGeneration() {
            return "staging";
          },
          async finalizeBrowseGeneration() {},
        },
      });
      identities.push(result.source.generationId);
    };

    await run(["work", "favorite", "work"], NOW);
    await run(["favorite", "work"], NOW);
    await run(["favorite", "work"], NOW + 1);

    expect(identities[0]).toBe(identities[1]);
    expect(identities[2]).not.toBe(identities[1]);
  });
});
