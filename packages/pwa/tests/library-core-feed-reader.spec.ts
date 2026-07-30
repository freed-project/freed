import { expect, test } from "@playwright/test";

test("dormant IndexedDB feed reader preserves bounded session and generation semantics", async ({
  page,
}) => {
  await page.goto("/favicon.svg");

  const result = await page.evaluate(async () => {
    const modulePath =
      "/src/lib/library-core-feed-reader-runtime.ts";
    const { createPwaLibraryCoreFeedReaderRuntime } = await import(modulePath);
    const databaseName = `freed-library-core-feed-reader-${crypto.randomUUID()}`;
    let nowMs = 1_000;
    let runtime = createPwaLibraryCoreFeedReaderRuntime({
      databaseName,
      indexedDb: indexedDB,
      keyRange: IDBKeyRange,
      subtle: crypto.subtle,
      now: () => nowMs,
    });
    const sourceA = {
      generationId: "a".repeat(64),
      projectionRevision: 2,
      transitionSequence: 1,
    };
    const sourceB = {
      generationId: "b".repeat(64),
      projectionRevision: 3,
      transitionSequence: 2,
    };
    const row = (globalId: string, publishedAt: number) => ({
      archived: false,
      authorAvatarUrl: null,
      authorDisplayName: null,
      authorHandle: null,
      authorId: null,
      capturedAt: publishedAt,
      contentSignalTags: [],
      contentText: `content ${globalId}`,
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
      platform: "test",
      publishedAt,
      readAt: null,
      readingTimeMinutes: null,
      saved: false,
      sourceUrl: null,
      tags: [],
    });
    const request = (
      readerSessionId: string,
      cancellationId: string,
      cursor: string | null = null,
      limit = 2,
    ) => ({
      cancellationId,
      cursor,
      limit,
      queryId: "feed_page_v1",
      readerSessionId,
      schemaVersion: 1,
    });
    const utf8EarlierId = "item-\u{e000}";
    const utf8LaterId = "item-\u{10000}";

    const inactive = await runtime.readFeedPage(
      request("inactive", "cancel-inactive"),
    );
    await runtime.beginGeneration({ source: sourceA, totalCount: 3 });
    await runtime.appendGenerationPage({
      source: sourceA,
      batchIndex: 0,
      rows: [row(utf8EarlierId, 200), row(utf8LaterId, 200)],
    });
    let parallelStagingRejected = false;
    try {
      await runtime.beginGeneration({ source: sourceB, totalCount: 1 });
    } catch {
      parallelStagingRejected = true;
    }
    await runtime.quiesce();
    runtime = createPwaLibraryCoreFeedReaderRuntime({
      databaseName,
      indexedDb: indexedDB,
      keyRange: IDBKeyRange,
      subtle: crypto.subtle,
      now: () => nowMs,
    });
    await runtime.appendGenerationPage({
      source: sourceA,
      batchIndex: 0,
      rows: [row(utf8EarlierId, 200), row(utf8LaterId, 200)],
    });
    let changedReplayRejected = false;
    try {
      await runtime.appendGenerationPage({
        source: sourceA,
        batchIndex: 0,
        rows: [row(utf8EarlierId, 200), row("item-z", 200)],
      });
    } catch {
      changedReplayRejected = true;
    }

    let incompleteRejected = false;
    try {
      await runtime.finalizeGeneration(sourceA);
    } catch {
      incompleteRejected = true;
    }
    let duplicateEntityRejected = false;
    try {
      await runtime.appendGenerationPage({
        source: sourceA,
        batchIndex: 1,
        rows: [row(utf8EarlierId, 100)],
      });
    } catch {
      duplicateEntityRejected = true;
    }
    await runtime.appendGenerationPage({
      source: sourceA,
      batchIndex: 1,
      rows: [row("item-c", 100)],
    });
    await runtime.finalizeGeneration(sourceA);
    await runtime.finalizeGeneration(sourceA);

    const first = await runtime.readFeedPage(
      request("page-session", "page-cancel"),
    );
    const changedCancellationReplay =
      first.ok && first.value.nextCursor
        ? await runtime.readFeedPage(
            request(
              "page-session",
              "page-cancel",
              first.value.nextCursor,
            ),
          )
        : null;
    const second =
      first.ok && first.value.nextCursor
        ? await runtime.readFeedPage(
            request(
              "page-session",
              "page-cancel-2",
              first.value.nextCursor,
            ),
          )
        : null;
    const exhaustedRetry =
      first.ok && first.value.nextCursor
        ? await runtime.readFeedPage(
            request(
              "page-session",
              "page-cancel-2",
              first.value.nextCursor,
            ),
          )
        : null;

    const capOne = await runtime.readFeedPage(
      request("cap-one", "cancel-one", null, 1),
    );
    const capTwo = await runtime.readFeedPage(
      request("cap-two", "cancel-two", null, 1),
    );
    const capThree = await runtime.readFeedPage(
      request("cap-three", "cancel-three", null, 1),
    );
    const wrongCancellation = runtime.cancelReader(
      "cap-one",
      "wrong-cancellation",
    );
    const exactCancellation = runtime.cancelReader(
      "cap-one",
      "cancel-one",
    );

    const expiring = await runtime.readFeedPage(
      request("expiring", "expiring-cancel", null, 1),
    );
    nowMs += 60_000;
    const expired =
      expiring.ok && expiring.value.nextCursor
        ? await runtime.readFeedPage(
            request(
              "expiring",
              "expiring-cancel",
              expiring.value.nextCursor,
              1,
            ),
          )
        : null;

    const staleStart = await runtime.readFeedPage(
      request("stale", "stale-cancel", null, 1),
    );
    await runtime.readFeedPage(
      request("stale-two", "stale-two-cancel", null, 1),
    );
    await runtime.beginGeneration({ source: sourceB, totalCount: 1 });
    await runtime.appendGenerationPage({
      source: sourceB,
      batchIndex: 0,
      rows: [row("item-new", 300)],
    });
    await runtime.finalizeGeneration(sourceB);
    const postSelection = await runtime.readFeedPage(
      request("post-selection", "post-selection-cancel", null, 1),
    );
    const stale =
      staleStart.ok && staleStart.value.nextCursor
        ? await runtime.readFeedPage(
            request(
              "stale",
              "stale-cancel",
              staleStart.value.nextCursor,
              1,
            ),
          )
        : null;

    await runtime.quiesce();
    const reopened = createPwaLibraryCoreFeedReaderRuntime({
      databaseName,
      indexedDb: indexedDB,
      keyRange: IDBKeyRange,
      subtle: crypto.subtle,
      now: () => nowMs,
    });
    const afterReopen = await reopened.readFeedPage(
      request("reopened", "reopened-cancel", null, 1),
    );
    await reopened.quiesce();
    await new Promise<void>((resolve, reject) => {
      const deletion = indexedDB.deleteDatabase(databaseName);
      deletion.onsuccess = () => resolve();
      deletion.onerror = () => reject(deletion.error);
      deletion.onblocked = () =>
        reject(new Error("test database deletion was blocked"));
    });
    const automergeClientPath = "/src/lib/automerge.ts";
    const automergeClient = await import(automergeClientPath);
    const workerBridgeInactive =
      await automergeClient.readLibraryCoreFeedPage(
        request("worker-bridge", "worker-bridge-cancel", null, 1),
      );
    const workerBridgeCancellation =
      await automergeClient.cancelLibraryCoreFeedReader(
        "worker-bridge",
        "worker-bridge-cancel",
      );
    await automergeClient.quiescePwaAutomergeForFactoryReset();

    return {
      inactive,
      parallelStagingRejected,
      changedReplayRejected,
      incompleteRejected,
      duplicateEntityRejected,
      first,
      changedCancellationReplay,
      second,
      exhaustedRetry,
      capOne,
      capTwo,
      capThree,
      wrongCancellation,
      exactCancellation,
      expired,
      postSelection,
      stale,
      afterReopen,
      workerBridgeInactive,
      workerBridgeCancellation,
    };
  });

  expect(result.inactive).toMatchObject({
    ok: false,
    code: "RUNTIME_INACTIVE",
  });
  expect(result.parallelStagingRejected).toBe(true);
  expect(result.changedReplayRejected).toBe(true);
  expect(result.incompleteRejected).toBe(true);
  expect(result.duplicateEntityRejected).toBe(true);
  expect(result.first).toMatchObject({
    ok: true,
    value: {
      totalCount: 3,
      rows: [{ globalId: "item-\u{e000}" }, { globalId: "item-\u{10000}" }],
    },
  });
  expect(result.changedCancellationReplay).toMatchObject({
    ok: false,
    code: "INVALID_REQUEST",
  });
  expect(result.second).toMatchObject({
    ok: true,
    value: {
      nextCursor: null,
      rows: [{ globalId: "item-c" }],
    },
  });
  expect(result.exhaustedRetry).toMatchObject({
    ok: false,
    code: "CURSOR_STALE",
  });
  expect(result.capOne).toMatchObject({ ok: true });
  expect(result.capTwo).toMatchObject({ ok: true });
  expect(result.capThree).toMatchObject({
    ok: false,
    code: "SESSION_LIMIT",
  });
  expect(result.wrongCancellation).toBe(false);
  expect(result.exactCancellation).toBe(true);
  expect(result.expired).toMatchObject({
    ok: false,
    code: "CURSOR_STALE",
  });
  expect(result.stale).toMatchObject({
    ok: false,
    code: "CURSOR_STALE",
  });
  expect(result.postSelection).toMatchObject({
    ok: true,
    value: {
      source: { generationId: "b".repeat(64) },
      rows: [{ globalId: "item-new" }],
    },
  });
  expect(result.afterReopen).toMatchObject({
    ok: true,
    value: {
      source: { generationId: "b".repeat(64) },
      rows: [{ globalId: "item-new" }],
    },
  });
  expect(result.workerBridgeInactive).toMatchObject({
    ok: false,
    code: "RUNTIME_INACTIVE",
  });
  expect(result.workerBridgeCancellation).toBe(false);
});

test("dormant browse projection upgrades v1 and persists exact recommendation order", async ({
  page,
}) => {
  await page.goto("/favicon.svg");

  const result = await page.evaluate(async () => {
    const databaseName = `freed-library-core-browse-${crypto.randomUUID()}`;
    const legacyDatabase = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(databaseName, 1);
      request.onupgradeneeded = () => {
        const database = request.result;
        database.createObjectStore("generations", {
          keyPath: "generationId",
        });
        database.createObjectStore("feed_rows", {
          keyPath: ["generationId", "orderKey"],
        });
        database.createObjectStore("generation_batches", {
          keyPath: ["generationId", "batchIndex"],
        });
        database.createObjectStore("control", { keyPath: "key" });
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    legacyDatabase.close();

    const modulePath = "/src/lib/library-core-feed-reader-runtime.ts";
    const { createPwaLibraryCoreFeedReaderRuntime } = await import(modulePath);
    const runtime = createPwaLibraryCoreFeedReaderRuntime({
      databaseName,
      indexedDb: indexedDB,
      keyRange: IDBKeyRange,
      subtle: crypto.subtle,
    });
    const source = {
      generationId: "c".repeat(64),
      projectionRevision: 11,
      transitionSequence: 6,
    };
    const filter = {
      archivedOnly: false,
      authorId: null,
      feedUrl: null,
      platform: "x",
      savedOnly: false,
      schemaVersion: 1,
      showHidden: false,
      signals: [],
      socialContentFilter: "all",
      tags: [],
    };
    const row = (globalId: string, publishedAt: number) => ({
      archived: false,
      authorAvatarUrl: null,
      authorDisplayName: null,
      authorHandle: null,
      authorId: null,
      capturedAt: publishedAt,
      contentSignalTags: [],
      contentText: globalId,
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
      platform: "x",
      publishedAt,
      readAt: null,
      readingTimeMinutes: null,
      saved: false,
      sourceUrl: null,
      tags: [],
    });

    await runtime.beginBrowseGeneration({
      filter,
      rankingClockMs: 1_000,
      recommendationOrderSchemaVersion: 1,
      source,
      totalCount: 4,
    });
    await runtime.appendBrowseGenerationPage({
      source,
      batchIndex: 0,
      rows: [
        { priority: 40, row: row("source-first", 100), sourceSequence: 0 },
        { priority: 80, row: row("newer-high", 300), sourceSequence: 1 },
        { priority: 80, row: row("source-second", 200), sourceSequence: 3 },
        { priority: 80, row: row("source-earlier", 200), sourceSequence: 2 },
      ],
    });
    await runtime.finalizeBrowseGeneration(source);
    const firstPage = await runtime.readBrowseFeedPage({
      cancellationId: "browse-page-1",
      cursor: null,
      filter,
      limit: 2,
      queryId: "feed_browse_page_v1",
      rankingClockMs: 1_000,
      readerSessionId: "browse-session",
      recommendationOrderSchemaVersion: 1,
      schemaVersion: 1,
    });
    const firstValue = firstPage.ok ? firstPage.value : null;
    const secondPage = await runtime.readBrowseFeedPage({
      cancellationId: "browse-page-2",
      cursor: firstValue?.nextCursor ?? null,
      filter,
      limit: 2,
      queryId: "feed_browse_page_v1",
      rankingClockMs: 1_000,
      readerSessionId: "browse-session",
      recommendationOrderSchemaVersion: 1,
      schemaVersion: 1,
    });
    await runtime.quiesce();

    const orderedRows = await new Promise<
      Array<{ globalId: string; orderKey: string }>
    >((resolve, reject) => {
      const request = indexedDB.open(databaseName, 2);
      request.onsuccess = () => {
        const database = request.result;
        const transaction = database.transaction("browse_rows", "readonly");
        const rows: Array<{ globalId: string; orderKey: string }> = [];
        const cursorRequest = transaction.objectStore("browse_rows").openCursor();
        cursorRequest.onsuccess = () => {
          const cursor = cursorRequest.result;
          if (!cursor) return;
          rows.push(cursor.value);
          cursor.continue();
        };
        transaction.oncomplete = () => {
          database.close();
          resolve(rows);
        };
        transaction.onerror = () => reject(transaction.error);
      };
      request.onerror = () => reject(request.error);
    });

    await new Promise<void>((resolve, reject) => {
      const deletion = indexedDB.deleteDatabase(databaseName);
      deletion.onsuccess = () => resolve();
      deletion.onerror = () => reject(deletion.error);
      deletion.onblocked = () =>
        reject(new Error("browse test database deletion was blocked"));
    });
    return {
      orderedIds: orderedRows.map(({ globalId }) => globalId),
      uniqueOrderKeys: new Set(
        orderedRows.map(({ orderKey }) => orderKey),
      ).size,
      pages: [
        firstPage.ok
          ? firstPage.value.rows.map(({ globalId }) => globalId)
          : firstPage,
        secondPage.ok
          ? secondPage.value.rows.map(({ globalId }) => globalId)
          : secondPage,
      ],
    };
  });

  expect(result).toStrictEqual({
    orderedIds: [
      "newer-high",
      "source-earlier",
      "source-second",
      "source-first",
    ],
    pages: [
      ["newer-high", "source-earlier"],
      ["source-second", "source-first"],
    ],
    uniqueOrderKeys: 4,
  });
});

test("committed Automerge heads materialize one resumable bounded feed generation", async ({
  page,
}) => {
  await page.goto("/favicon.svg");

  const result = await page.evaluate(async () => {
    const client = await import("/src/lib/automerge.ts");
    const item = (
      globalId: string,
      publishedAt: number,
      userState: Record<string, unknown> = {},
    ) => ({
      author: {
        avatarUrl: "https://example.test/avatar.jpg",
        displayName: "Reader",
        handle: "reader",
        id: "x:reader",
      },
      capturedAt: publishedAt + 1,
      content: {
        linkPreview: { title: "Example" },
        mediaTypes: ["image"],
        mediaUrls: ["https://example.test/media.jpg"],
        text: `content ${globalId}`,
      },
      contentSignals: { tags: ["article"] },
      contentType: "post",
      engagement: { comments: 2, likes: 3 },
      eventCandidate: { confidence: 0.9, startsAt: publishedAt + 2 },
      globalId,
      location: { name: "Here" },
      platform: "x",
      preservedContent: { readingTime: 4 },
      publishedAt,
      sourceUrl: `https://example.test/${globalId}`,
      topics: [],
      userState: {
        archived: false,
        hidden: false,
        liked: false,
        saved: false,
        tags: [],
        ...userState,
      },
    });
    await client.initDoc();
    await client.docAddFeedItems([
      item("x:older", 100),
      item("x:hidden", 400, { hidden: true }),
      item("x:newer", 300, { saved: true }),
      item("x:archived", 500, { archived: true }),
    ]);
    const first = await client.materializeLibraryCoreFeedGeneration();
    const replay = await client.materializeLibraryCoreFeedGeneration();
    const browse = await client.materializeLibraryCoreFeedBrowseGeneration(
      { savedOnly: true },
      1_000,
    );
    const pageResult = await client.readLibraryCoreFeedPage({
      cancellationId: "materializer-cancellation",
      cursor: null,
      limit: 10,
      queryId: "feed_page_v1",
      readerSessionId: "materializer-reader",
      schemaVersion: 1,
    });
    const browsePageResult = await client.readLibraryCoreFeedBrowsePage({
      cancellationId: "browse-materializer-cancellation",
      cursor: null,
      filter: browse.filter,
      limit: 10,
      queryId: "feed_browse_page_v1",
      rankingClockMs: browse.rankingClockMs,
      readerSessionId: "browse-materializer-reader",
      recommendationOrderSchemaVersion: 1,
      schemaVersion: 1,
    });
    await client.quiescePwaAutomergeForFactoryReset();
    await client.clearLocalDocAfterPwaQuiesce();
    await new Promise<void>((resolve, reject) => {
      const deletion = indexedDB.deleteDatabase(
        "freed-library-core-feed-v1",
      );
      deletion.onsuccess = () => resolve();
      deletion.onerror = () => reject(deletion.error);
      deletion.onblocked = () =>
        reject(new Error("test database deletion was blocked"));
    });
    return { browse, browsePageResult, first, pageResult, replay };
  });

  expect(result.first).toStrictEqual(result.replay);
  expect(result.browse).toMatchObject({
    filter: { savedOnly: true, schemaVersion: 1 },
    rankingClockMs: 1_000,
    totalCount: 1,
  });
  expect(result.browse.source.generationId).not.toBe(
    result.first.source.generationId,
  );
  expect(result.browsePageResult).toMatchObject({
    ok: true,
    value: {
      filter: { savedOnly: true, schemaVersion: 1 },
      rankingClockMs: 1_000,
      rows: [{ globalId: "x:newer" }],
      totalCount: 1,
    },
  });
  expect(result.first).toMatchObject({ totalCount: 2 });
  expect(result.first.source.generationId).toMatch(/^[0-9a-f]{64}$/);
  expect(result.first.source.projectionRevision).toBeGreaterThan(0);
  expect(result.first.source.transitionSequence).toBeGreaterThanOrEqual(0);
  expect(result.pageResult).toMatchObject({
    ok: true,
    value: {
      rows: [
        { globalId: "x:newer" },
        { globalId: "x:older" },
      ],
      totalCount: 2,
    },
  });
});
