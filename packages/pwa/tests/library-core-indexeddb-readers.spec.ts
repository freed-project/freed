import { expect, test } from "@playwright/test";

test("PWA IndexedDB readers cover the complete Library beyond the renderer window", async ({
  page,
}) => {
  test.setTimeout(120_000);
  await page.goto("/favicon.svg");

  const result = await page.evaluate(async () => {
    interface TestItem {
      globalId: string;
      platform: string;
      contentType: string;
      capturedAt: number;
      publishedAt: number;
      author: {
        id: string;
        handle: string;
        displayName: string;
        avatarUrl?: string;
      };
      content: {
        text: string;
        mediaUrls: string[];
        mediaTypes: string[];
      };
      userState: {
        saved: boolean;
        archived: boolean;
        hidden: boolean;
        tags: string[];
        savedAt?: number;
      };
      topics: string[];
      [key: string]: unknown;
    }

    interface BrowserReader {
      readonly totalCount: number;
      readNext(): Promise<readonly TestItem[]>;
      close(): Promise<void>;
    }

    const modulePath = "/src/lib/library-core-indexeddb-readers.ts";
    const { createPwaLibraryCoreIndexedDbReaders } = await import(modulePath);
    const databaseName = `freed-library-readers-${crypto.randomUUID()}`;
    const totalItemCount = 2_607;
    const idFor = (index: number) => `x:item-${String(index).padStart(4, "0")}`;
    const items: TestItem[] = Array.from(
      { length: totalItemCount },
      (_, index) => ({
        globalId: idFor(index),
        platform: "x",
        contentType: "post",
        capturedAt: index + 100,
        publishedAt: index + 100,
        author: {
          id: "ordinary-author",
          handle: "ordinary",
          displayName: "Ordinary Author",
        },
        content: {
          text: `Library item ${String(index)}`,
          mediaUrls:
            index < 251
              ? [`https://reader.example/media-${String(index)}.jpg`]
              : [],
          mediaTypes: index < 251 ? ["image"] : [],
        },
        userState: {
          saved: false,
          archived: false,
          hidden: false,
          tags: [],
        },
        topics: [],
        ...(index < 1_001
          ? {
              location: {
                name: `Map point ${String(index)}`,
                coordinates: {
                  lat: 30 + index / 10_000,
                  lng: -120 + index / 10_000,
                },
                source: "geo_tag",
              },
            }
          : {}),
      }),
    );
    const replaceItem = (index: number, patch: Partial<TestItem>) => {
      items[index] = { ...items[index]!, ...patch } as TestItem;
      return items[index]!;
    };
    const renameItem = (index: number, globalId: string) =>
      replaceItem(index, { globalId });

    replaceItem(2_501, {
      ...renameItem(2_501, "x:deep-archived"),
      userState: {
        ...items[2_501]!.userState,
        archived: true,
      },
    });
    replaceItem(2_502, {
      ...renameItem(2_502, "linkedin:deep-provider"),
      platform: "linkedin",
    });
    replaceItem(2_503, {
      ...renameItem(2_503, "rss:deep-feed"),
      platform: "rss",
      rssSource: {
        feedUrl: "https://reader.example/deep.xml",
        feedTitle: "Deep Reader",
        siteUrl: "https://reader.example",
      },
    });
    replaceItem(2_504, {
      ...renameItem(2_504, "x:deep-tag"),
      userState: {
        ...items[2_504]!.userState,
        tags: ["deep-library-tag"],
      },
    });
    replaceItem(2_505, {
      ...renameItem(2_505, "x:deep-signal"),
      contentSignals: {
        version: 3,
        method: "rules",
        inferredAt: 2_605,
        scores: { news: 1 },
        tags: ["news"],
      },
    });
    replaceItem(2_506, {
      ...renameItem(2_506, "x:deep-author-filter"),
      author: {
        id: "deep-author",
        handle: "deep-author",
        displayName: "Deep Author",
      },
    });
    replaceItem(2_507, {
      ...renameItem(2_507, "x:deep-hidden"),
      author: {
        id: "deep-hidden-author",
        handle: "hidden",
        displayName: "Hidden Author",
      },
      userState: {
        ...items[2_507]!.userState,
        hidden: true,
      },
    });
    replaceItem(2_508, {
      ...renameItem(2_508, "x:deep-friend-new"),
      publishedAt: 9_000,
      author: {
        id: "deep-friend",
        handle: "deep-friend",
        displayName: "Deep Friend",
        avatarUrl: "https://reader.example/friend.png",
      },
      location: {
        name: "Deep Point",
        coordinates: { lat: 37.7, lng: -122.4 },
        source: "geo_tag",
      },
      contentSignals: {
        version: 3,
        method: "rules",
        inferredAt: 2_608,
        scores: { event: 1 },
        tags: ["event"],
      },
    });
    replaceItem(2_509, {
      ...renameItem(2_509, "x:deep-friend-old"),
      publishedAt: 8_000,
      author: {
        id: "deep-friend",
        handle: "deep-friend",
        displayName: "Deep Friend",
      },
    });
    replaceItem(2_510, {
      ...renameItem(2_510, "instagram:deep-story"),
      platform: "instagram",
      contentType: "story",
      content: {
        text: "Deep story",
        mediaUrls: ["https://reader.example/deep-story.jpg"],
        mediaTypes: ["image"],
      },
    });

    const savedItem = (
      index: number,
      globalId: string,
      publishedAt: number,
      savedAt: number,
      readingTime: number | null,
      archived = false,
    ) => {
      const base = renameItem(index, globalId);
      replaceItem(index, {
        ...base,
        capturedAt: publishedAt,
        publishedAt,
        preservedContent:
          readingTime === null
            ? undefined
            : {
                text: globalId,
                wordCount: readingTime * 200,
                readingTime,
                preservedAt: savedAt,
              },
        userState: {
          ...base.userState,
          saved: true,
          savedAt,
          archived,
        },
      });
    };
    savedItem(2_511, "x:saved-a", 100, 1_000, 5);
    savedItem(2_512, "x:saved-b", 400, 900, 1);
    savedItem(2_513, "x:saved-c", 300, 1_100, null);
    savedItem(2_514, "x:saved-archived", 200, 800, 2, true);

    const byId = new Map(items.map((item) => [item.globalId, item]));
    let sourceRevision = 11;
    let changeRevisionDuringNextScan = false;
    let scanCount = 0;
    let largestSourcePage = 0;
    const scanItems = async (
      visit: (
        page: readonly TestItem[],
      ) => "continue" | "stop" | Promise<"continue" | "stop">,
    ) => {
      scanCount += 1;
      for (let offset = 0; offset < items.length; offset += 31) {
        const sourcePage = items.slice(offset, offset + 31);
        largestSourcePage = Math.max(largestSourcePage, sourcePage.length);
        const decision = await visit(sourcePage);
        if (changeRevisionDuringNextScan) {
          changeRevisionDuringNextScan = false;
          sourceRevision += 1;
        }
        if (decision === "stop") return;
      }
    };
    const readers = createPwaLibraryCoreIndexedDbReaders({
      databaseName,
      indexedDb: indexedDB,
      keyRange: IDBKeyRange,
      subtle: crypto.subtle,
      scanItems,
      readItem: async (globalId: string) => byId.get(globalId) ?? null,
      getState: () => ({
        preferences: {
          weights: {
            recency: 50,
            platforms: {},
            topics: {},
            authors: {},
          },
        },
        persons: {
          "person:deep-friend": {
            id: "person:deep-friend",
            name: "Deep Friend",
            relationshipStatus: "friend",
            careLevel: 4,
            createdAt: 1,
            updatedAt: 1,
          },
        },
        accounts: {
          "account:deep-friend": {
            id: "account:deep-friend",
            personId: "person:deep-friend",
            kind: "social",
            provider: "x",
            externalId: "deep-friend",
            firstSeenAt: 1,
            lastSeenAt: 1,
            discoveredFrom: "captured_item",
            createdAt: 1,
            updatedAt: 1,
          },
        },
        friends: {},
      }),
      getSourceRevision: () => sourceRevision,
      randomId: () => crypto.randomUUID(),
    });

    let largestReaderPage = 0;
    const collectReader = async (reader: BrowserReader) => {
      const rows: TestItem[] = [];
      for (;;) {
        const batch = await reader.readNext();
        largestReaderPage = Math.max(largestReaderPage, batch.length);
        if (batch.length === 0) break;
        rows.push(...batch);
      }
      await reader.close();
      return {
        ids: rows.map((item) => item.globalId),
        publishedById: Object.fromEntries(
          rows.map((item) => [item.globalId, item.publishedAt]),
        ),
        totalCount: reader.totalCount,
      };
    };
    const readFilter = async (filter: Record<string, unknown>) =>
      collectReader(await readers.openFeedReader(filter, 10_000));

    const ordinary = await readFilter({});
    const archived = await readFilter({ archivedOnly: true });
    const provider = await readFilter({ platform: "linkedin" });
    const feed = await readFilter({
      platform: "rss",
      feedUrl: "https://reader.example/deep.xml",
    });
    const tag = await readFilter({ tags: ["deep-library-tag"] });
    const signal = await readFilter({ signals: ["news"] });
    const author = await readFilter({
      platform: "x",
      authorId: "deep-author",
    });
    const hiddenDefault = await readFilter({
      platform: "x",
      authorId: "deep-hidden-author",
    });
    const hiddenIncluded = await readFilter({
      platform: "x",
      authorId: "deep-hidden-author",
      showHidden: true,
    });
    const stories = await readFilter({ socialContentFilter: "stories" });

    const savedDate = await collectReader(
      await readers.openSavedFeedReader({}, "date_saved", 10_000),
    );
    const savedPublished = await collectReader(
      await readers.openSavedFeedReader({}, "date_published", 10_000),
    );
    const savedRecommended = await collectReader(
      await readers.openSavedFeedReader({}, "recommended", 10_000),
    );
    const savedShortest = await collectReader(
      await readers.openSavedFeedReader({}, "shortest_read", 10_000),
    );
    const friendsFeed = await collectReader(
      await readers.openFriendsFeedReader({}, 10_000),
    );

    const facets = await readers.readFacetSummary();
    const signalCounts = await readers.readFeedSignalCounts({});
    const dailyWindows = Array.from({ length: 7 }, (_, index) => ({
      startMs: index === 0 ? 0 : 20_000 + index * 100,
      endMs: index === 0 ? 2_000 : 20_050 + index * 100,
    }));
    const hourlyWindows = Array.from({ length: 24 }, (_, index) => ({
      startMs: index === 0 ? 0 : 30_000 + index * 100,
      endMs: index === 0 ? 2_000 : 30_050 + index * 100,
    }));
    const savedAnalytics = await readers.readSavedAnalytics({
      dailyWindows,
      hourlyWindows,
    });
    const graph = await readers.readFriendsGraph({
      sources: [{ platform: "x", authorId: "deep-friend" }],
      rssFeedUrls: ["https://reader.example/deep.xml"],
      recentWindow: { startMs: 0, endMs: 10_000 },
    });
    const firstTimeline = await readers.readPersonTimeline({
      sources: [{ platform: "x", authorId: "deep-friend" }],
      limit: 1,
    });
    const secondTimeline = await readers.readPersonTimeline({
      sources: [{ platform: "x", authorId: "deep-friend" }],
      limit: 1,
      cursor: firstTimeline.nextCursor,
    });
    const locationCandidate = graph.social[0]!.locationCandidates[0]!;
    const locationItem = await readers.readFriendsLocationItem({
      ...locationCandidate,
      owner: {
        kind: "social",
        platform: "x",
        authorId: "deep-friend",
      },
      referenceTimeMs: 10_000,
      sourceToken: graph.sourceToken,
    });
    const mapItems = await readers.readSurfaceItems("map");
    const storyWallItems = await readers.readSurfaceItems("story_wall");
    const staleReader = await readers.openFeedReader(
      { platform: "linkedin" },
      10_000,
    );
    sourceRevision += 1;
    let staleReaderError: string | null = null;
    try {
      await staleReader.readNext();
    } catch (error) {
      staleReaderError =
        error instanceof Error ? error.message : "unknown reader failure";
    }
    await staleReader.close();
    changeRevisionDuringNextScan = true;
    let staleAggregateError: string | null = null;
    try {
      await readers.readFacetSummary();
    } catch (error) {
      staleAggregateError =
        error instanceof Error ? error.message : "unknown aggregate failure";
    }

    await readers.quiesce();
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.deleteDatabase(databaseName);
      request.addEventListener("success", () => resolve(), { once: true });
      request.addEventListener("error", () => reject(request.error), {
        once: true,
      });
    });

    return {
      ordinaryCount: ordinary.totalCount,
      ordinaryReadCount: ordinary.ids.length,
      archivedIds: archived.ids,
      providerIds: provider.ids,
      feedIds: feed.ids,
      tagIds: tag.ids,
      signalIds: signal.ids,
      authorIds: author.ids,
      hiddenDefaultIds: hiddenDefault.ids,
      hiddenIncludedIds: hiddenIncluded.ids,
      storyFilterIds: stories.ids,
      savedDateIds: savedDate.ids,
      savedPublishedIds: savedPublished.ids,
      savedRecommendedIds: savedRecommended.ids,
      savedShortestIds: savedShortest.ids,
      savedAPublishedAt: savedDate.publishedById["x:saved-a"],
      friendsFeedIds: friendsFeed.ids,
      facets,
      signalCounts,
      savedAnalytics,
      graph,
      firstTimelineIds: firstTimeline.items.map(
        (item: TestItem) => item.globalId,
      ),
      firstTimelineNextCursor: firstTimeline.nextCursor,
      secondTimelineIds: secondTimeline.items.map(
        (item: TestItem) => item.globalId,
      ),
      secondTimelineNextCursor: secondTimeline.nextCursor,
      locationItemId: locationItem?.globalId ?? null,
      mapCount: mapItems.length,
      mapIds: mapItems.map((item: TestItem) => item.globalId),
      storyWallCount: storyWallItems.length,
      storyWallIds: storyWallItems.map((item: TestItem) => item.globalId),
      staleReaderError,
      staleAggregateError,
      largestReaderPage,
      largestSourcePage,
      scanCount,
    };
  });

  expect(result.ordinaryCount).toBeGreaterThan(2_500);
  expect(result.ordinaryReadCount).toBe(result.ordinaryCount);
  expect(result.archivedIds).toEqual(["x:deep-archived", "x:saved-archived"]);
  expect(result.providerIds).toEqual(["linkedin:deep-provider"]);
  expect(result.feedIds).toEqual(["rss:deep-feed"]);
  expect(result.tagIds).toEqual(["x:deep-tag"]);
  expect(result.signalIds).toEqual(["x:deep-signal"]);
  expect(result.authorIds).toEqual(["x:deep-author-filter"]);
  expect(result.hiddenDefaultIds).toEqual([]);
  expect(result.hiddenIncludedIds).toEqual(["x:deep-hidden"]);
  expect(result.storyFilterIds).toEqual(["instagram:deep-story"]);
  expect(result.savedDateIds).toEqual(["x:saved-c", "x:saved-a", "x:saved-b"]);
  expect(result.savedPublishedIds).toEqual([
    "x:saved-b",
    "x:saved-c",
    "x:saved-a",
  ]);
  expect(new Set(result.savedRecommendedIds)).toEqual(
    new Set(["x:saved-a", "x:saved-b", "x:saved-c"]),
  );
  expect(result.savedShortestIds).toEqual([
    "x:saved-b",
    "x:saved-a",
    "x:saved-c",
  ]);
  expect(result.savedAPublishedAt).toBe(100);
  expect(result.friendsFeedIds).toEqual([
    "x:deep-friend-new",
    "x:deep-friend-old",
  ]);
  expect(result.facets).toMatchObject({
    archivedCount: 2,
    savedArchivedCount: 1,
    savedCount: 4,
    savedPlatformCount: 1,
    totalCount: 2_607,
  });
  expect(result.facets.tags).toContain("deep-library-tag");
  expect(result.signalCounts.news).toBe(1);
  expect(result.savedAnalytics.totalCount).toBe(4);
  expect(result.savedAnalytics.dailyCounts[0]).toBe(4);
  expect(result.savedAnalytics.hourlyCounts[0]).toBe(4);
  expect(result.graph.totalItemCount).toBe(2_607);
  expect(result.graph.social[0]).toMatchObject({
    itemCount: 2,
    recentCount: 2,
    hasLocation: true,
  });
  expect(result.graph.rss[0]).toMatchObject({ itemCount: 1 });
  expect(result.firstTimelineIds).toEqual(["x:deep-friend-new"]);
  expect(result.firstTimelineNextCursor).not.toBeNull();
  expect(result.secondTimelineIds).toEqual(["x:deep-friend-old"]);
  expect(result.secondTimelineNextCursor).toBeNull();
  expect(result.locationItemId).toBe("x:deep-friend-new");
  expect(result.mapCount).toBe(1_000);
  expect(result.mapIds).toContain("x:deep-friend-new");
  expect(result.storyWallCount).toBe(250);
  expect(result.storyWallIds).toContain("instagram:deep-story");
  expect(result.staleReaderError).toContain("source is stale");
  expect(result.staleAggregateError).toContain("changed during its bounded read");
  expect(result.largestSourcePage).toBe(31);
  expect(result.largestReaderPage).toBeLessThanOrEqual(128);
  expect(result.scanCount).toBeGreaterThan(0);
});
