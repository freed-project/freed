import { expect, test } from "@playwright/test";

test("PWA search invalidates stale v1 projections at the same corpus revision", async ({
  page,
}) => {
  await page.goto("/favicon.svg");

  const result = await page.evaluate(async () => {
    const databaseName = `freed-library-search-upgrade-${crypto.randomUUID()}`;
    const legacyDatabase = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(databaseName, 1);
      request.addEventListener("upgradeneeded", () => {
        const database = request.result;
        const documents = database.createObjectStore("search_documents", {
          keyPath: ["corpusVersion", "globalId"],
        });
        documents.createIndex("by_search_key", [
          "corpusVersion",
          "searchKeys",
          "globalId",
        ]);
        database.createObjectStore("search_meta", { keyPath: "key" });
      });
      request.addEventListener("success", () => resolve(request.result), {
        once: true,
      });
      request.addEventListener("error", () => reject(request.error), {
        once: true,
      });
    });
    const legacyWrite = legacyDatabase.transaction(
      ["search_documents", "search_meta"],
      "readwrite",
    );
    legacyWrite.objectStore("search_documents").put({
      corpusVersion: 41,
      fields: [{ terms: ["legacy"], weight: 4 }],
      globalId: "rss:legacy",
      item: {
        globalId: "rss:legacy",
        preservedContent: { text: "x".repeat(200_000) },
      },
      searchKeys: ["legacy"],
    });
    legacyWrite.objectStore("search_meta").put({
      corpusVersion: 41,
      key: "active_index",
    });
    await new Promise<void>((resolve, reject) => {
      legacyWrite.addEventListener("complete", () => resolve(), { once: true });
      legacyWrite.addEventListener("error", () => reject(legacyWrite.error), {
        once: true,
      });
      legacyWrite.addEventListener("abort", () => reject(legacyWrite.error), {
        once: true,
      });
    });
    legacyDatabase.close();

    const modulePath = "/src/lib/library-core-search-index.ts";
    const { PwaLibraryCoreSearchIndex } = await import(modulePath);
    const index = new PwaLibraryCoreSearchIndex({
      databaseName,
      indexedDb: indexedDB,
      keyRange: IDBKeyRange,
    });
    const currentItem = {
      globalId: "rss:current",
      platform: "rss",
      contentType: "article",
      capturedAt: 1,
      publishedAt: 1,
      author: { id: "author", displayName: "Author", handle: "author" },
      content: {
        text: "current bounded search document",
        mediaUrls: [],
        mediaTypes: [],
      },
      userState: { saved: false, archived: false, hidden: false, tags: [] },
      topics: [],
      preservedContent: {
        html: "<p>retired</p>".repeat(50_000),
        text: "x".repeat(200_000),
      },
    };
    let scanCount = 0;
    const source41 = {
      corpusVersion: 41,
      sourceToken: "library-a:generation-a:41",
    };
    await index.ensureBuilt(
      source41,
      async (visit: (items: readonly unknown[]) => unknown) => {
        scanCount += 1;
        await visit([currentItem]);
      },
    );
    const matches: Array<{ id: string; bytes: number; hasHtml: boolean }> = [];
    await index.search("current", source41, (batch) => {
      for (const match of batch) {
        matches.push({
          id: match.item.globalId,
          bytes: new TextEncoder().encode(JSON.stringify(match.item))
            .byteLength,
          hasHtml: Boolean(match.item.preservedContent?.html),
        });
      }
      return "continue";
    });
    await index.close();
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.deleteDatabase(databaseName);
      request.addEventListener("success", () => resolve(), { once: true });
      request.addEventListener("error", () => reject(request.error), {
        once: true,
      });
    });
    return { matches, scanCount };
  });

  expect(result.scanCount).toBe(1);
  expect(result.matches).toEqual([
    {
      id: "rss:current",
      bytes: expect.any(Number),
      hasHtml: false,
    },
  ]);
  expect(result.matches[0]?.bytes).toBeLessThanOrEqual(131_072);
});

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
    items.push(
      {
        ...items[0]!,
        globalId: "rss:prefix-only",
        content: {
          ...items[0]!.content,
          text: "architecture handbook",
        },
      },
      {
        ...items[0]!,
        globalId: "rss:fuzzy-only",
        content: {
          ...items[0]!.content,
          text: "archtectur handbook",
        },
      },
    );
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

    const source41 = {
      corpusVersion: 41,
      sourceToken: "library-a:generation-a:41",
    };
    const source42 = {
      corpusVersion: 42,
      sourceToken: "library-a:generation-b:42",
    };
    await index.ensureBuilt(source41, scan);
    await index.ensureBuilt(source41, scan);
    const matches: Array<{ id: string; score: number }> = [];
    const batchSizes: number[] = [];
    await index.search("analyticl eng", source41, (batch) => {
      batchSizes.push(batch.length);
      for (const match of batch) {
        matches.push({ id: match.item.globalId, score: match.score });
      }
      return "continue";
    });
    const fuzzyOnlyMatches: string[] = [];
    await index.search("analyticl", source41, (batch) => {
      fuzzyOnlyMatches.push(...batch.map(({ item }) => item.globalId));
      return "continue";
    });
    const mixedPrefixAndFuzzyMatches: string[] = [];
    await index.search("architectur", source41, (batch) => {
      mixedPrefixAndFuzzyMatches.push(
        ...batch.map(({ item }) => item.globalId),
      );
      return "continue";
    });
    const aliasMatches: string[] = [];
    await index.search(
      "countess",
      source41,
      (batch) => {
        aliasMatches.push(...batch.map(({ item }) => item.globalId));
        return "continue";
      },
      {
        accountAliases: new Map([["rss:author", "Countess Ada"]]),
      },
    );
    const cancellation = new AbortController();
    let cancellationBatchCount = 0;
    let cancellationRejected = false;
    try {
      await index.search(
        "analytical",
        source41,
        () => {
          cancellationBatchCount += 1;
          cancellation.abort();
          return "continue";
        },
        { signal: cancellation.signal },
      );
    } catch (error) {
      cancellationRejected =
        error instanceof DOMException && error.name === "AbortError";
    }

    await index.ensureBuilt(source42, scan);
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
      mixedPrefixAndFuzzyMatches,
      cancellationBatchCount,
      cancellationRejected,
      aliasMatchCount: aliasMatches.length,
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
  expect(result.mixedPrefixAndFuzzyMatches).toEqual([
    "rss:fuzzy-only",
    "rss:prefix-only",
  ]);
  expect(result.cancellationBatchCount).toBe(1);
  expect(result.cancellationRejected).toBe(true);
  expect(result.aliasMatchCount).toBe(103);
});

test("PWA search serializes generation rebuilds, binds Library identity, and cancels projection work", async ({
  page,
}) => {
  await page.goto("/favicon.svg");

  const result = await page.evaluate(async () => {
    const modulePath = "/src/lib/library-core-search-index.ts";
    const { PwaLibraryCoreSearchIndex } = await import(modulePath);
    const databaseName = `freed-library-search-race-${crypto.randomUUID()}`;
    const index = new PwaLibraryCoreSearchIndex({
      databaseName,
      indexedDb: indexedDB,
      keyRange: IDBKeyRange,
    });
    const item = (globalId: string, text: string) => ({
      globalId,
      platform: "rss",
      contentType: "article",
      capturedAt: 1,
      publishedAt: 1,
      author: { id: "author", displayName: "Author", handle: "author" },
      content: { text, mediaUrls: [], mediaTypes: [] },
      userState: { saved: false, archived: false, hidden: false, tags: [] },
      topics: [],
    });
    const oldSource = {
      corpusVersion: 1,
      sourceToken: "library-a:generation-a:1",
    };
    const replacementSource = {
      corpusVersion: 1,
      sourceToken: "library-b:generation-b:1",
    };
    let releaseOldBuild!: () => void;
    const oldBuildBlocked = new Promise<void>((resolve) => {
      releaseOldBuild = resolve;
    });
    let oldBuildStarted!: () => void;
    const oldBuildStart = new Promise<void>((resolve) => {
      oldBuildStarted = resolve;
    });
    const oldBuild = index.ensureBuilt(oldSource, async (visit) => {
      oldBuildStarted();
      await oldBuildBlocked;
      await visit([item("rss:old", "old library result")]);
    });
    await oldBuildStart;
    const replacementBuild = index.ensureBuilt(
      replacementSource,
      async (visit) => {
        await visit([item("rss:new", "replacement library result")]);
      },
    );
    releaseOldBuild();
    await Promise.all([oldBuild, replacementBuild]);

    const replacementMatches: string[] = [];
    await index.search("replacement", replacementSource, (matches) => {
      replacementMatches.push(...matches.map((match) => match.item.globalId));
      return "continue";
    });
    let staleSourceRejected = false;
    try {
      await index.search("old", oldSource, () => "continue");
    } catch {
      staleSourceRejected = true;
    }

    const cancelledSource = {
      corpusVersion: 2,
      sourceToken: "library-b:generation-c:2",
    };
    const controller = new AbortController();
    let projectedPages = 0;
    let cancelled = false;
    try {
      await index.ensureBuilt(
        cancelledSource,
        async (visit) => {
          projectedPages += 1;
          await visit([item("rss:cancelled", "cancelled projection")]);
          controller.abort();
          projectedPages += 1;
          await visit([item("rss:must-not-run", "second projection")]);
        },
        controller.signal,
      );
    } catch (error) {
      cancelled = error instanceof DOMException && error.name === "AbortError";
    }
    await index.ensureBuilt(cancelledSource, async (visit) => {
      await visit([item("rss:recovered", "recovered projection")]);
    });
    const recoveredMatches: string[] = [];
    await index.search("recovered", cancelledSource, (matches) => {
      recoveredMatches.push(...matches.map((match) => match.item.globalId));
      return "continue";
    });
    await index.close();
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.deleteDatabase(databaseName);
      request.addEventListener("success", () => resolve(), { once: true });
      request.addEventListener("error", () => reject(request.error), {
        once: true,
      });
    });
    return {
      cancelled,
      projectedPages,
      recoveredMatches,
      replacementMatches,
      staleSourceRejected,
    };
  });

  expect(result).toEqual({
    cancelled: true,
    projectedPages: 2,
    recoveredMatches: ["rss:recovered"],
    replacementMatches: ["rss:new"],
    staleSourceRejected: true,
  });
});
