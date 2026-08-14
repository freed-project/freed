import { expect, test } from "@playwright/test";

test("PWA search keeps its corpus projection in IndexedDB and streams bounded matches", async ({
  page,
}) => {
  await page.goto("/favicon.svg");

  const result = await page.evaluate(async () => {
    const modulePath = "/src/lib/library-core-search-index.ts";
    const { PwaLibraryCoreSearchIndex } = await import(modulePath);
    const databaseName = `freed-library-search-${crypto.randomUUID()}`;
    const index = new PwaLibraryCoreSearchIndex({
      databaseName,
      indexedDb: indexedDB,
      keyRange: IDBKeyRange,
    });
    const items = Array.from({ length: 101 }, (_, itemIndex) => ({
      globalId: `rss:item-${itemIndex.toString().padStart(3, "0")}`,
      platform: "rss",
      contentType: "article",
      capturedAt: itemIndex,
      publishedAt: itemIndex,
      author: {
        id: "author",
        displayName: "Ada Lovelace",
        handle: "ada",
      },
      content: {
        text: `analytical engine notebook ${itemIndex}`,
        mediaUrls: [],
        mediaTypes: [],
      },
      userState: {
        saved: false,
        archived: false,
        hidden: false,
        tags: [],
      },
      topics: [],
      priority: itemIndex,
      sourceUrl: `https://example.com/${itemIndex}`,
    }));
    let scanCount = 0;
    let largestSourcePage = 0;
    const scan = async (visit: (items: readonly unknown[]) => unknown) => {
      scanCount += 1;
      for (let offset = 0; offset < items.length; offset += 17) {
        const sourcePage = items.slice(offset, offset + 17);
        largestSourcePage = Math.max(largestSourcePage, sourcePage.length);
        if ((await visit(sourcePage)) === "stop") return;
      }
    };

    await index.ensureBuilt(41, scan);
    await index.ensureBuilt(41, scan);
    const matches: Array<{ id: string; score: number }> = [];
    const batchSizes: number[] = [];
    await index.search("analyticl eng", 41, (batch) => {
      batchSizes.push(batch.length);
      for (const match of batch) {
        matches.push({ id: match.item.globalId, score: match.score });
      }
      return "continue";
    });
    const fuzzyOnlyMatches: string[] = [];
    await index.search("analyticl", 41, (batch) => {
      fuzzyOnlyMatches.push(...batch.map(({ item }) => item.globalId));
      return "continue";
    });

    await index.ensureBuilt(42, scan);
    await index.close();
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.deleteDatabase(databaseName);
      request.addEventListener("success", () => resolve(), { once: true });
      request.addEventListener("error", () => reject(request.error), {
        once: true,
      });
    });
    return {
      batchSizes,
      largestSourcePage,
      fuzzyOnlyMatchCount: fuzzyOnlyMatches.length,
      matchCount: matches.length,
      minimumScore: Math.min(...matches.map(({ score }) => score)),
      scanCount,
      uniqueMatchCount: new Set(matches.map(({ id }) => id)).size,
    };
  });

  expect(result.scanCount).toBe(2);
  expect(result.largestSourcePage).toBe(17);
  expect(result.matchCount).toBe(101);
  expect(result.fuzzyOnlyMatchCount).toBe(101);
  expect(result.uniqueMatchCount).toBe(101);
  expect(result.minimumScore).toBeGreaterThan(0);
  expect(Math.max(...result.batchSizes)).toBeLessThanOrEqual(32);
});
