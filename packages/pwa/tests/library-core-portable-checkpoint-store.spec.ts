import { expect, test } from "@playwright/test";

test("dormant IndexedDB store atomically stages and pages a complete portable checkpoint", async ({
  page,
}) => {
  await page.goto("/favicon.svg");

  const result = await page.evaluate(async () => {
    const storeModulePath =
      "/src/lib/library-core-portable-checkpoint-store.ts";
    const { createPwaLibraryCorePortableCheckpointStore } = await import(
      storeModulePath
    );
    const databaseName = `freed-library-core-portable-${crypto.randomUUID()}`;
    const hex = (pair: string) => pair.repeat(32);
    const frontierDigest = hex("11");
    const materializedDigest = hex("22");
    const generationDigest = hex("aa");
    const libraryId = hex("01");
    const epochId = hex("02");
    const descriptor = {
      byteLength: 1,
      contentDigest: generationDigest,
      objectKey: `freed-v2-manifest~${libraryId}~e${epochId}~g1~${generationDigest}.json`,
    };
    const manifestReference = {
      descriptor,
      transportObjectId: "drive-manifest-1",
    };
    const pageReference = (generation: number, pageIndex: number) => {
      const contentDigest = (pageIndex === 0 ? "cc" : "dd").repeat(32);
      return {
        descriptor: {
          byteLength: 1,
          contentDigest,
          objectKey: `freed-v2-checkpoint~${libraryId}~e${epochId}~g${generation}~p${pageIndex}~${contentDigest}.fpage.gz`,
        },
        transportObjectId: `drive-page-${generation}-${pageIndex}`,
      };
    };
    const manifest = {
      causalFrontierDigest: frontierDigest,
      datasetSchemaId: "library_core_logical_checkpoint_v1",
      generation: 1,
      kind: "checkpoint_manifest",
      libraryId,
      pages: [
        {
          firstRecordIdentity: "00:header",
          lastRecordIdentity: "03:0000000",
          object: pageReference(1, 0),
          pageIndex: 0,
          recordCount: 2,
        },
        {
          firstRecordIdentity: "03:0000001",
          lastRecordIdentity: "03:0000001",
          object: pageReference(1, 1),
          pageIndex: 1,
          recordCount: 1,
        },
      ],
      protocolVersion: 1,
      schemaVersion: 1,
      storageEpoch: epochId,
      totalRecordCount: 3,
    } as const;
    const header = {
      anchor_kind: "accepted_authority",
      accepted_authority: {
        authority_key_id: hex("03"),
        authority_public_key: hex("04"),
        epoch: 1,
        epoch_id: epochId,
        library_id: libraryId,
        observed_frontier: [],
      },
      canonical_codec_version: 1,
      collection_counts: {
        accepted_frontier: 0,
        actor_states: 0,
        blob_roots: 0,
        excluded_registry_keys: 0,
        field_clocks: 0,
        materialized_rows: 2,
        quarantined_frontier: 0,
        receipt_records: 0,
        relationships: 0,
        tombstones: 0,
      },
      epoch: 1,
      epoch_id: epochId,
      field_registry_version: 1,
      format: "freed_logical_checkpoint_v1",
      kind: "logical_checkpoint_header",
      library_id: libraryId,
      materializer_position: {
        frontier_digest: frontierDigest,
        ingest_sequence: 0,
        materialized_digest: materializedDigest,
      },
      promoted_receipt_digests: [],
      schema_version: 1,
      source_manifest_digest: hex("33"),
      source_transition_digest: hex("44"),
      transition_candidate_anchor: null,
    } as const;
    const entry = (ordinal: number) =>
      ({
        collection: "materialized_rows",
        kind: "logical_checkpoint_entry",
        ordinal,
        value: {
          primary_key: `item-${ordinal}`,
          registry_key: "10_feed_items",
          row: { globalId: `item-${ordinal}`, saved: ordinal === 0 },
        },
      }) as const;
    const page0 = [header, entry(0)] as const;
    const page1 = [entry(1)] as const;
    let store = createPwaLibraryCorePortableCheckpointStore({
      databaseName,
      indexedDb: indexedDB,
      keyRange: IDBKeyRange,
      subtle: crypto.subtle,
    });

    const firstBegin = await store.beginImport({
      manifest,
      manifestReference,
    });
    await store.appendPage(0, page0);
    await store.quiesce();

    store = createPwaLibraryCorePortableCheckpointStore({
      databaseName,
      indexedDb: indexedDB,
      keyRange: IDBKeyRange,
      subtle: crypto.subtle,
    });
    let changedManifestLocatorRejected = false;
    try {
      await store.beginImport({
        manifest,
        manifestReference: {
          ...manifestReference,
          transportObjectId: "substituted-drive-manifest",
        },
      });
    } catch {
      changedManifestLocatorRejected = true;
    }
    const resumedBegin = await store.beginImport({
      manifest,
      manifestReference,
    });
    await store.appendPage(0, page0);
    let changedReplayRejected = false;
    try {
      await store.appendPage(0, [header, entry(1)]);
    } catch {
      changedReplayRejected = true;
    }
    let incompleteFinalizeRejected = false;
    try {
      await store.finalizeImport({
        header,
        manifest,
        manifestReference,
      });
    } catch {
      incompleteFinalizeRejected = true;
    }
    let duplicateTransactionRejected = false;
    try {
      await store.appendPage(1, [entry(0)]);
    } catch {
      duplicateTransactionRejected = true;
    }
    await store.appendPage(1, page1);
    const receipt = await store.finalizeImport({
      header,
      manifest,
      manifestReference,
    });
    const firstEnrollment = await store.preparePwaActorEnrollmentRequest();
    const firstPage = await store.readSelectedCollectionPage({
      afterOrdinal: null,
      collection: "materialized_rows",
      limit: 1,
    });
    const secondPage = await store.readSelectedCollectionPage({
      afterOrdinal: firstPage.nextOrdinal,
      collection: "materialized_rows",
      limit: 1,
    });
    const alreadyComplete = await store.beginImport({
      manifest,
      manifestReference,
    });
    await store.quiesce();

    let nowMs = 1_783_100_000_000;
    const reopened = createPwaLibraryCorePortableCheckpointStore({
      databaseName,
      indexedDb: indexedDB,
      keyRange: IDBKeyRange,
      now: () => nowMs,
      subtle: crypto.subtle,
    });
    const reopenedEnrollment =
      await reopened.preparePwaActorEnrollmentRequest();
    const reopenedPage = await reopened.readSelectedCollectionPage({
      afterOrdinal: null,
      collection: "materialized_rows",
      limit: 2,
    });
    const feedRequest = (
      readerSessionId: string,
      cancellationId: string,
      cursor: string | null,
      limit: number,
    ) => ({
      cancellationId,
      cursor,
      limit,
      queryId: "feed_page_v1",
      readerSessionId,
      schemaVersion: 1,
    });
    const cancelableFeedPage = await reopened.readSelectedFeedPage(
      feedRequest("cancelable-feed", "cancel-feed-page", null, 1),
    );
    const canceledFeedSession = reopened.cancelSelectedFeedReader(
      "cancelable-feed",
      "cancel-feed-page",
    );
    const canceledFeedResume =
      cancelableFeedPage.ok && cancelableFeedPage.value.nextCursor
        ? await reopened.readSelectedFeedPage(
            feedRequest(
              "cancelable-feed",
              "cancel-feed-resume",
              cancelableFeedPage.value.nextCursor,
              1,
            ),
          )
        : null;
    const completeFeedPage = await reopened.readSelectedFeedPage(
      feedRequest("expiring-feed", "expiring-feed-page", null, 2),
    );
    nowMs += 60_000;
    const expiredFeedResume =
      completeFeedPage.ok && completeFeedPage.value.nextCursor
        ? await reopened.readSelectedFeedPage(
            feedRequest(
              "expiring-feed",
              "expiring-feed-resume",
              completeFeedPage.value.nextCursor,
              2,
            ),
          )
        : null;

    const abortedDigest = hex("bb");
    const abortedReference = {
      descriptor: {
        byteLength: 1,
        contentDigest: abortedDigest,
        objectKey: `freed-v2-manifest~${libraryId}~e${epochId}~g2~${abortedDigest}.json`,
      },
      transportObjectId: "drive-manifest-2",
    };
    const abortedManifest = {
      ...manifest,
      generation: 2,
      pages: [
        {
          firstRecordIdentity: "00:header",
          lastRecordIdentity: "03:0000000",
          object: pageReference(2, 0),
          pageIndex: 0,
          recordCount: 2,
        },
      ],
      totalRecordCount: 2,
    } as const;
    await reopened.beginImport({
      manifest: abortedManifest,
      manifestReference: abortedReference,
    });
    await reopened.abortImport(new Error("test abort"));
    const selectedAfterAbort = await reopened.readSelectedCollectionPage({
      afterOrdinal: null,
      collection: "materialized_rows",
      limit: 2,
    });
    await reopened.quiesce();

    const databaseEvidence = await new Promise<{
      generationCount: number;
      privateKeyExtractable: boolean;
      privateKeyType: string;
    }>((resolve, reject) => {
      const request = indexedDB.open(databaseName);
      request.onsuccess = () => {
        const database = request.result;
        const transaction = database.transaction(
          ["portable_generations", "portable_pwa_actor_identities"],
          "readonly",
        );
        const count = transaction.objectStore("portable_generations").count();
        const identity = transaction
          .objectStore("portable_pwa_actor_identities")
          .get(libraryId);
        transaction.oncomplete = () => {
          const privateKey = identity.result.actorPrivateKey as CryptoKey;
          database.close();
          resolve({
            generationCount: count.result,
            privateKeyExtractable: privateKey.extractable,
            privateKeyType: privateKey.type,
          });
        };
        count.onerror = () => reject(count.error);
        identity.onerror = () => reject(identity.error);
      };
      request.onerror = () => reject(request.error);
    });
    await new Promise<void>((resolve, reject) => {
      const deletion = indexedDB.deleteDatabase(databaseName);
      deletion.onsuccess = () => resolve();
      deletion.onerror = () => reject(deletion.error);
      deletion.onblocked = () =>
        reject(new Error("portable checkpoint database deletion was blocked"));
    });

    return {
      alreadyComplete,
      canceledFeedResume,
      canceledFeedSession,
      changedReplayRejected,
      changedManifestLocatorRejected,
      completeFeedPage,
      duplicateTransactionRejected,
      expiredFeedResume,
      firstBegin,
      firstPage,
      databaseEvidence,
      enrollment: firstEnrollment
        ? {
            actorId: firstEnrollment.actorId,
            byteLength: firstEnrollment.immutableObject.source.byteLength,
            objectKey: firstEnrollment.immutableObject.descriptor.objectKey,
            request: firstEnrollment.request,
            stableAfterReopen:
              reopenedEnrollment?.immutableObject.descriptor.contentDigest ===
              firstEnrollment.immutableObject.descriptor.contentDigest,
          }
        : null,
      incompleteFinalizeRejected,
      receipt,
      reopenedPage,
      resumedBegin,
      secondPage,
      selectedAfterAbort,
    };
  });

  expect(result).toMatchObject({
    alreadyComplete: "already_complete",
    canceledFeedResume: {
      code: "CURSOR_STALE",
      ok: false,
    },
    canceledFeedSession: true,
    changedReplayRejected: true,
    changedManifestLocatorRejected: true,
    duplicateTransactionRejected: true,
    completeFeedPage: {
      ok: true,
      value: {
        rows: [
          {
            globalId: "item-0",
          },
          {
            globalId: "item-1",
          },
        ],
        source: {
          transitionSequence: 0,
        },
        totalCount: 2,
      },
    },
    expiredFeedResume: {
      code: "CURSOR_STALE",
      ok: false,
    },
    firstBegin: "import",
    firstPage: {
      entries: [{ ordinal: 0, value: { row: { globalId: "item-0" } } }],
      nextOrdinal: 0,
    },
    databaseEvidence: {
      generationCount: 1,
      privateKeyExtractable: false,
      privateKeyType: "private",
    },
    enrollment: {
      byteLength: expect.any(Number),
      objectKey: expect.stringContaining("freed-v2-enrollment-request"),
      request: {
        certificate_body: {
          actor_enrollment_body: {
            operation_type: "actor_enrolled",
          },
        },
      },
      stableAfterReopen: true,
    },
    incompleteFinalizeRejected: true,
    receipt: {
      frontierDigest: "11".repeat(32),
      ingestSequence: 0,
      libraryId: "01".repeat(32),
      materializedDigest: "22".repeat(32),
      recordCount: 3,
      storageEpoch: "02".repeat(32),
    },
    reopenedPage: {
      entries: [{ ordinal: 0 }, { ordinal: 1 }],
      nextOrdinal: null,
    },
    resumedBegin: "import",
    secondPage: {
      entries: [{ ordinal: 1, value: { row: { globalId: "item-1" } } }],
      nextOrdinal: null,
    },
    selectedAfterAbort: {
      entries: [{ ordinal: 0 }, { ordinal: 1 }],
      generationId: "aa".repeat(32),
    },
  });
});

test("portable database upgrade builds the bounded feed index from authenticated v3 rows", async ({
  page,
}) => {
  await page.goto("/favicon.svg");
  const result = await page.evaluate(async () => {
    const databaseName = `freed-library-core-portable-v3-${crypto.randomUUID()}`;
    const generationId = "ab".repeat(32);
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.open(databaseName, 3);
      request.onupgradeneeded = () => {
        const database = request.result;
        database.createObjectStore("portable_generations", {
          keyPath: "generationId",
        });
        database.createObjectStore("portable_control", { keyPath: "key" });
        database.createObjectStore("portable_materialized_rows", {
          keyPath: ["generationId", "registryKey", "primaryKey"],
        });
      };
      request.onsuccess = () => {
        const database = request.result;
        const transaction = database.transaction(
          [
            "portable_generations",
            "portable_control",
            "portable_materialized_rows",
          ],
          "readwrite",
        );
        transaction.objectStore("portable_generations").add({
          authenticatedFrontierDigest: "11".repeat(32),
          authenticatedThroughIngestSequence: 7,
          checkpointFrontierDigest: "10".repeat(32),
          frontierDigest: "11".repeat(32),
          generationId,
          header: null,
          headerDigest: null,
          importedThroughIngestSequence: 7,
          latestAuthenticatedSegmentDigest: "12".repeat(32),
          latestOperationSegmentDigest: "12".repeat(32),
          libraryId: "library-upgrade",
          manifestGeneration: 1,
          manifestObjectKey: "manifest-upgrade",
          manifestPageCount: 1,
          manifestStoredByteLength: 1,
          manifestTransportObjectId: "drive-manifest-upgrade",
          nextPageIndex: 1,
          selectionSequence: 1,
          status: "complete",
          storageEpoch: "epoch-upgrade",
          totalRecordCount: 2,
          writtenRecordCount: 2,
        });
        transaction.objectStore("portable_control").add({
          generationId,
          key: "selected_portable_generation",
          selectionSequence: 1,
        });
        const rows = transaction.objectStore("portable_materialized_rows");
        rows.add({
          generationId,
          primaryKey: JSON.stringify("visible-item"),
          registryKey: "feedItems",
          row: {
            globalId: "visible-item",
            publishedAt: 500,
            userState: { hidden: false },
          },
        });
        rows.add({
          generationId,
          primaryKey: JSON.stringify("hidden-item"),
          registryKey: "feedItems",
          row: {
            globalId: "hidden-item",
            publishedAt: 900,
            userState: { hidden: true },
          },
        });
        transaction.oncomplete = () => {
          database.close();
          resolve();
        };
        transaction.onerror = () => reject(transaction.error);
      };
      request.onerror = () => reject(request.error);
    });

    const { createPwaLibraryCorePortableCheckpointStore } =
      await import("/src/lib/library-core-portable-checkpoint-store.ts");
    const store = createPwaLibraryCorePortableCheckpointStore({
      databaseName,
      indexedDb: indexedDB,
      keyRange: IDBKeyRange,
      subtle: crypto.subtle,
    });
    const feed = await store.readSelectedFeedPage({
      cancellationId: "upgrade-feed-page",
      cursor: null,
      limit: 10,
      queryId: "feed_page_v1",
      readerSessionId: "upgrade-feed-reader",
      schemaVersion: 1,
    });
    await store.quiesce();
    await new Promise<void>((resolve, reject) => {
      const deletion = indexedDB.deleteDatabase(databaseName);
      deletion.onsuccess = () => resolve();
      deletion.onerror = () => reject(deletion.error);
    });
    return feed;
  });

  expect(result).toMatchObject({
    ok: true,
    value: {
      rows: [{ globalId: "visible-item" }],
      source: { transitionSequence: 7 },
      totalCount: 1,
    },
  });
});

test("preview authority persists fractional captures in the current materialized projection", async ({
  page,
}) => {
  await page.goto("/favicon.svg");

  const result = await page.evaluate(async () => {
    const { createPwaLibraryCorePortableCheckpointStore } = await import(
      "/src/lib/library-core-portable-checkpoint-store.ts"
    );
    const databaseName = `freed-library-core-preview-${crypto.randomUUID()}`;
    const store = createPwaLibraryCorePortableCheckpointStore({
      databaseName,
      indexedDb: indexedDB,
      keyRange: IDBKeyRange,
      subtle: crypto.subtle,
    });
    const baseItem = {
      author: {
        displayName: "Map Friend",
        handle: "map-friend",
        id: "person-1",
      },
      capturedAt: 1_786_000_000_000,
      content: {
        mediaTypes: [],
        mediaUrls: [],
        text: "A fractional location",
      },
      contentType: "post",
      globalId: "preview:fractional-item",
      location: {
        coordinates: { lat: 37.7749, lng: -122.4194 },
        name: "San Francisco",
        source: "explicit",
      },
      platform: "test",
      publishedAt: 1_786_000_000_000,
      topics: [],
      userState: {
        archived: true,
        hidden: false,
        saved: false,
        tags: [],
      },
    };

    const bootstrap = await store.bootstrapFeaturePreviewAuthority();
    await store.enqueueFeedItemCaptures([baseItem]);
    const hiddenFeed = await store.readSelectedFeedPage({
      cancellationId: "hidden-feed",
      cursor: null,
      limit: 10,
      queryId: "feed_page_v1",
      readerSessionId: "hidden-reader",
      schemaVersion: 1,
    });
    const hiddenMaterialized = await store.readSelectedMaterializedPage({
      cursor: null,
      limit: 10,
    });

    await store.enqueueFeedItemCaptures([
      {
        ...baseItem,
        userState: { ...baseItem.userState, archived: false },
      },
    ]);
    const visibleFeed = await store.readSelectedFeedPage({
      cancellationId: "visible-feed",
      cursor: null,
      limit: 10,
      queryId: "feed_page_v1",
      readerSessionId: "visible-reader",
      schemaVersion: 1,
    });
    const visibleMaterialized = await store.readSelectedMaterializedPage({
      cursor: null,
      limit: 10,
    });
    await store.quiesce();
    await new Promise<void>((resolve, reject) => {
      const deletion = indexedDB.deleteDatabase(databaseName);
      deletion.onsuccess = () => resolve();
      deletion.onerror = () => reject(deletion.error);
    });

    const captureRow = visibleMaterialized.entries.find(
      (entry) => entry.primaryKey === JSON.stringify(baseItem.globalId),
    )?.row as typeof baseItem | undefined;
    return {
      bootstrap,
      hiddenFeedCount: hiddenFeed.ok ? hiddenFeed.value.totalCount : null,
      hiddenMaterializedCount: hiddenMaterialized.entries.length,
      latitude: captureRow?.location.coordinates.lat,
      longitude: captureRow?.location.coordinates.lng,
      visibleFeedCount: visibleFeed.ok ? visibleFeed.value.totalCount : null,
    };
  });

  expect(result).toEqual({
    bootstrap: "created",
    hiddenFeedCount: 0,
    hiddenMaterializedCount: 2,
    latitude: 37.7749,
    longitude: -122.4194,
    visibleFeedCount: 1,
  });
});
