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
    const descriptor = {
      byteLength: 1,
      contentDigest: generationDigest,
      objectKey: `freed-v2-manifest~library-1~eepoch-1~g1~${generationDigest}.json`,
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
          objectKey: `freed-v2-checkpoint~library-1~eepoch-1~g${generation}~p${pageIndex}~${contentDigest}.fpage.gz`,
        },
        transportObjectId: `drive-page-${generation}-${pageIndex}`,
      };
    };
    const manifest = {
      causalFrontierDigest: frontierDigest,
      datasetSchemaId: "library_core_logical_checkpoint_v1",
      generation: 1,
      kind: "checkpoint_manifest",
      libraryId: "library-1",
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
      storageEpoch: "epoch-1",
      totalRecordCount: 3,
    } as const;
    const header = {
      anchor_kind: "accepted_authority",
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
      epoch_id: "epoch-1",
      field_registry_version: 1,
      format: "freed_logical_checkpoint_v1",
      kind: "logical_checkpoint_header",
      library_id: "library-1",
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
          registry_key: "feedItems",
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

    const reopened = createPwaLibraryCorePortableCheckpointStore({
      databaseName,
      indexedDb: indexedDB,
      keyRange: IDBKeyRange,
      subtle: crypto.subtle,
    });
    const reopenedPage = await reopened.readSelectedCollectionPage({
      afterOrdinal: null,
      collection: "materialized_rows",
      limit: 2,
    });

    const abortedDigest = hex("bb");
    const abortedReference = {
      descriptor: {
        byteLength: 1,
        contentDigest: abortedDigest,
        objectKey: `freed-v2-manifest~library-1~eepoch-1~g2~${abortedDigest}.json`,
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

    const generationCount = await new Promise<number>((resolve, reject) => {
      const request = indexedDB.open(databaseName, 3);
      request.onsuccess = () => {
        const database = request.result;
        const transaction = database.transaction(
          "portable_generations",
          "readonly",
        );
        const count = transaction.objectStore("portable_generations").count();
        count.onsuccess = () => resolve(count.result);
        count.onerror = () => reject(count.error);
        transaction.oncomplete = () => database.close();
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
      changedReplayRejected,
      changedManifestLocatorRejected,
      duplicateTransactionRejected,
      firstBegin,
      firstPage,
      generationCount,
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
    changedReplayRejected: true,
    changedManifestLocatorRejected: true,
    duplicateTransactionRejected: true,
    firstBegin: "import",
    firstPage: {
      entries: [{ ordinal: 0, value: { row: { globalId: "item-0" } } }],
      nextOrdinal: 0,
    },
    generationCount: 1,
    incompleteFinalizeRejected: true,
    receipt: {
      frontierDigest: "11".repeat(32),
      ingestSequence: 0,
      libraryId: "library-1",
      materializedDigest: "22".repeat(32),
      recordCount: 3,
      storageEpoch: "epoch-1",
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
