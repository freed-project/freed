import { describe, expect, it } from "vitest";
import type { LibraryCoreFeedPageSourceV1 } from "@freed/shared/library-core";

import { materializePwaLibraryCoreFeedGeneration } from "./library-core-feed-materializer";

describe("PWA Library Core feed materializer", () => {
  it("holds staging pages to 128 rows without a corpus-sized output array", async () => {
    const feedItems: Record<string, unknown> = {};
    for (let index = 0; index < 257; index += 1) {
      const globalId = `x:item-${index.toLocaleString("en-US", {
        minimumIntegerDigits: 3,
        useGrouping: false,
      })}`;
      feedItems[globalId] = {
        author: { displayName: "Reader", id: "x:reader" },
        capturedAt: index,
        content: { text: `item ${index.toLocaleString()}` },
        contentType: "post",
        globalId,
        platform: "x",
        publishedAt: index,
        topics: [],
        userState: { archived: false, hidden: false, saved: false, tags: [] },
      };
    }
    const pageLengths: number[] = [];
    let finalizedSource: LibraryCoreFeedPageSourceV1 | null = null;
    const result = await materializePwaLibraryCoreFeedGeneration({
      committed: {
        heads: ["a".repeat(64)],
        revision: { generation: 3, saveRevision: 7 },
      },
      document: { feedItems } as never,
      subtle: crypto.subtle,
      writer: {
        async appendGenerationPage(input) {
          pageLengths.push(input.rows.length);
        },
        async beginGeneration(input) {
          expect(input.totalCount).toBe(257);
          return "staging";
        },
        async finalizeGeneration(source) {
          finalizedSource = source;
        },
      },
    });

    expect(pageLengths).toStrictEqual([128, 128, 1]);
    expect(finalizedSource).toStrictEqual(result.source);
    expect(result.totalCount).toBe(257);
    expect(result.source).toMatchObject({
      projectionRevision: 7,
      transitionSequence: 3,
    });
  });
});
