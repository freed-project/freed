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
