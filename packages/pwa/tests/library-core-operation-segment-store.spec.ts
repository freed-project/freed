import { expect, test } from "@playwright/test";

test("PWA IndexedDB durably imports an exact operation tail after its checkpoint", async ({
  page,
}) => {
  await page.goto("/favicon.svg");

  const result = await page.evaluate(async () => {
    const { createPwaLibraryCorePortableCheckpointStore } =
      await import("/src/lib/library-core-portable-checkpoint-store.ts");
    const {
      encodeLibraryCoreCanonicalValue,
      importLibraryCoreOperationSegmentV1,
      prepareLibraryCoreOperationSegmentV1,
    } = await import("/src/lib/library-core-operation-segment-runtime.ts");
    const databaseName = `freed-library-core-tail-${crypto.randomUUID()}`;
    const hex = (pair: string) => pair.repeat(32);
    const frontier0 = hex("01");
    const frontier1 = hex("02");
    const manifestDigest = hex("aa");
    const manifestReference = {
      descriptor: {
        byteLength: 1,
        contentDigest: manifestDigest,
        objectKey: `freed-v2-manifest~library-1~eepoch-1~g1~${manifestDigest}.json`,
      },
      transportObjectId: "drive-manifest-1",
    };
    const checkpointPageDigest = hex("bb");
    const manifest = {
      causalFrontierDigest: frontier0,
      datasetSchemaId: "library_core_logical_checkpoint_v1",
      generation: 1,
      kind: "checkpoint_manifest",
      libraryId: "library-1",
      pages: [
        {
          firstRecordIdentity: "00:header",
          lastRecordIdentity: "00:header",
          object: {
            descriptor: {
              byteLength: 1,
              contentDigest: checkpointPageDigest,
              objectKey: `freed-v2-checkpoint~library-1~eepoch-1~g1~p0~${checkpointPageDigest}.fpage.gz`,
            },
            transportObjectId: "drive-page-1",
          },
          pageIndex: 0,
          recordCount: 1,
        },
      ],
      protocolVersion: 1,
      schemaVersion: 1,
      storageEpoch: "epoch-1",
      totalRecordCount: 1,
    } as const;
    const header = {
      anchor_kind: "accepted_authority",
      accepted_authority: null,
      canonical_codec_version: 1,
      collection_counts: {
        accepted_frontier: 0,
        actor_states: 0,
        blob_roots: 0,
        excluded_registry_keys: 0,
        field_clocks: 0,
        materialized_rows: 0,
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
        frontier_digest: frontier0,
        ingest_sequence: 10,
        materialized_digest: hex("03"),
      },
      promoted_receipt_digests: [],
      schema_version: 1,
      source_manifest_digest: hex("04"),
      source_transition_digest: hex("05"),
      transition_candidate_anchor: null,
    } as const;
    const store = createPwaLibraryCorePortableCheckpointStore({
      databaseName,
      indexedDb: indexedDB,
      keyRange: IDBKeyRange,
      subtle: crypto.subtle,
    });
    await store.beginImport({ manifest, manifestReference });
    await store.appendPage(0, [header]);
    await store.finalizeImport({ header, manifest, manifestReference });

    const canonicalEnvelope = (operationId: string, sequence: number) =>
      new TextDecoder().decode(
        encodeLibraryCoreCanonicalValue({
          actor_id: hex("10"),
          actor_sequence: sequence,
          epoch: 1,
          epoch_id: "epoch-1",
          library_id: "library-1",
          operation_id: operationId,
          payload: { read_at_ms: 1_783_000_000_000 + sequence },
        }),
      );
    const prepared = await prepareLibraryCoreOperationSegmentV1({
      baseFrontierDigest: frontier0,
      entries: [
        {
          canonicalEnvelopeJson: canonicalEnvelope("operation-11", 11),
          ingestSequence: 11,
          operationId: "operation-11",
        },
        {
          canonicalEnvelopeJson: canonicalEnvelope("operation-12", 12),
          ingestSequence: 12,
          operationId: "operation-12",
        },
      ],
      epoch: 1,
      epochId: "epoch-1",
      libraryId: "library-1",
      previousSegmentDigest: null,
      resultFrontierDigest: frontier1,
      schemaVersion: 1,
      subtle: crypto.subtle,
    });
    const reference = {
      descriptor: prepared.object.descriptor,
      transportObjectId: "drive-ops-1",
    };
    const adapter = {
      async readImmutable() {
        return prepared.object.source.slice();
      },
    };
    const imported = await importLibraryCoreOperationSegmentV1({
      adapter,
      expectedBaseFrontierDigest: frontier0,
      expectedFirstIngestSequence: 11,
      expectedPreviousSegmentDigest: null,
      libraryId: "library-1",
      reference,
      storageEpoch: "epoch-1",
      subtle: crypto.subtle,
      writer: store,
    });
    const replayed = await importLibraryCoreOperationSegmentV1({
      adapter,
      expectedBaseFrontierDigest: frontier0,
      expectedFirstIngestSequence: 11,
      expectedPreviousSegmentDigest: null,
      libraryId: "library-1",
      reference,
      storageEpoch: "epoch-1",
      subtle: crypto.subtle,
      writer: store,
    });
    const firstPage = await store.readSelectedOperationPage({
      afterIngestSequence: 10,
      limit: 1,
    });
    const secondPage = await store.readSelectedOperationPage({
      afterIngestSequence: firstPage.nextAfterIngestSequence ?? 10,
      limit: 1,
    });

    const duplicate = await prepareLibraryCoreOperationSegmentV1({
      baseFrontierDigest: frontier1,
      entries: [
        {
          canonicalEnvelopeJson: canonicalEnvelope("operation-12", 13),
          ingestSequence: 13,
          operationId: "operation-12",
        },
      ],
      epoch: 1,
      epochId: "epoch-1",
      libraryId: "library-1",
      previousSegmentDigest: prepared.header.segment_digest,
      resultFrontierDigest: hex("06"),
      schemaVersion: 1,
      subtle: crypto.subtle,
    });
    let duplicateRejected = false;
    try {
      await importLibraryCoreOperationSegmentV1({
        adapter: {
          async readImmutable() {
            return duplicate.object.source.slice();
          },
        },
        expectedBaseFrontierDigest: frontier1,
        expectedFirstIngestSequence: 13,
        expectedPreviousSegmentDigest: prepared.header.segment_digest,
        libraryId: "library-1",
        reference: {
          descriptor: duplicate.object.descriptor,
          transportObjectId: "drive-ops-duplicate",
        },
        storageEpoch: "epoch-1",
        subtle: crypto.subtle,
        writer: store,
      });
    } catch {
      duplicateRejected = true;
    }
    const afterFailure = await store.readSelectedOperationPage({
      afterIngestSequence: 10,
      limit: 128,
    });
    await store.quiesce();
    return {
      afterFailure: {
        count: afterFailure.entries.length,
        frontierDigest: afterFailure.frontierDigest,
        importedThroughIngestSequence:
          afterFailure.importedThroughIngestSequence,
      },
      duplicateRejected,
      firstPage: {
        ids: firstPage.entries.map((entry) => entry.operation_id),
        next: firstPage.nextAfterIngestSequence,
      },
      imported,
      replayed,
      secondPage: {
        ids: secondPage.entries.map((entry) => entry.operation_id),
        next: secondPage.nextAfterIngestSequence,
      },
    };
  });

  expect(result).toMatchObject({
    afterFailure: {
      count: 2,
      frontierDigest: "02".repeat(32),
      importedThroughIngestSequence: 12,
    },
    duplicateRejected: true,
    firstPage: { ids: ["operation-11"], next: 11 },
    imported: {
      firstIngestSequence: 11,
      importedOperationCount: 2,
      lastIngestSequence: 12,
    },
    replayed: {
      firstIngestSequence: 11,
      importedOperationCount: 2,
      lastIngestSequence: 12,
    },
    secondPage: { ids: ["operation-12"], next: null },
  });
});
