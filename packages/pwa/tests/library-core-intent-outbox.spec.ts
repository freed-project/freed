import path from "node:path";

import { expect, test } from "@playwright/test";

test("PWA intent outbox commits whole signed transactions and advances only on exact publication evidence", async ({
  page,
}) => {
  const sharedModuleUrl = `/@fs${path.resolve(
    process.cwd(),
    "../shared/src/library-core/index.ts",
  )}`;

  await page.goto("/favicon.svg");
  const result = await page.evaluate(async (sharedModuleUrl) => {
    const shared = await import(sharedModuleUrl);
    const { createPwaLibraryCorePortableCheckpointStore } =
      await import("/src/lib/library-core-portable-checkpoint-store.ts");
    const hex = (pair: string) => pair.repeat(32);
    const libraryId = hex("11");
    const epochId = hex("22");
    const actorId = hex("33");
    const actorChainGenesis = hex("44");
    const signature = "55".repeat(64);
    const digest = (domain: string, value: unknown) =>
      shared.sha256LowerHex(shared.encodeLibraryCoreDigestInput(domain, value));
    const databaseName = `freed-library-core-intents-${crypto.randomUUID()}`;
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.open(databaseName, 4);
      request.addEventListener("upgradeneeded", () => {
        request.result.createObjectStore("portable_control", {
          keyPath: "key",
        });
      });
      request.addEventListener(
        "success",
        () => {
          request.result.close();
          resolve();
        },
        { once: true },
      );
      request.addEventListener(
        "error",
        () => reject(request.error ?? new Error("v4 database setup failed")),
        { once: true },
      );
    });
    const store = createPwaLibraryCorePortableCheckpointStore({
      databaseName,
      indexedDb: indexedDB,
      keyRange: IDBKeyRange,
      subtle: crypto.subtle,
    });

    const finalize = async ({
      count,
      firstSequence,
      previousChainDigest,
      previousOperationId,
      readAtOffset = 0,
      transactionId,
    }: {
      count: number;
      firstSequence: number;
      previousChainDigest: string;
      previousOperationId: string | null;
      readAtOffset?: number;
      transactionId: string;
    }) => {
      const members = Array.from({ length: count }, (_, index) => {
        const sequence = firstSequence + index;
        return shared.FEED_ITEM_READ_ASSIGNMENT_TRANSACTION_MEMBER_SCHEMA.construct(
          {
            actor_id: actorId,
            actor_sequence: sequence,
            causal_frontier: [],
            created_at_ms: 1_783_000_000_000 + sequence,
            entity_id: `item-${sequence.toLocaleString("en-US", {
              useGrouping: false,
            })}`,
            epoch: 1,
            epoch_id: epochId,
            hlc_counter: index,
            hlc_wall_ms: 1_783_000_000_000 + sequence,
            library_id: libraryId,
            operation_id: `read-item-${sequence.toLocaleString("en-US", {
              useGrouping: false,
            })}`,
            payload: {
              read_at_ms: 1_783_000_000_000 + sequence + readAtOffset,
            },
            previous_actor_operation_id:
              index === 0
                ? previousOperationId
                : `read-item-${(sequence - 1).toLocaleString("en-US", {
                    useGrouping: false,
                  })}`,
            transaction_id: transactionId,
            transaction_member_count: count,
            transaction_member_index: index,
          },
          { digest },
        );
      });
      const assembled = shared.assembleLibraryCoreTransactionV1(
        members,
        previousChainDigest,
        { digest },
      );
      return shared.finalizeLibraryCoreTransactionV1(assembled, {
        digest,
        async signOperation() {
          return signature;
        },
      });
    };

    const first = await finalize({
      count: 2,
      firstSequence: 1,
      previousChainDigest: actorChainGenesis,
      previousOperationId: null,
      transactionId: "tx-read-1-2",
    });
    const firstReceipt = await store.enqueueIntentTransaction(first);
    const replayReceipt = await store.enqueueIntentTransaction(first);
    let changedRetryError = "";
    try {
      await store.enqueueIntentTransaction(
        await finalize({
          count: 2,
          firstSequence: 1,
          previousChainDigest: actorChainGenesis,
          previousOperationId: null,
          readAtOffset: 1,
          transactionId: "tx-read-1-2",
        }),
      );
    } catch (error) {
      changedRetryError =
        error instanceof Error ? error.message : String(error);
    }

    const second = await finalize({
      count: 1,
      firstSequence: 3,
      previousChainDigest: first.members.at(-1)!.envelope.actor_chain_digest,
      previousOperationId: "read-item-2",
      transactionId: "tx-read-3",
    });
    const secondReceipt = await store.enqueueIntentTransaction(second);
    const fullCandidate = await store.readUnpublishedIntentSegmentCandidate({
      actorId,
      epochId,
      libraryId,
    });
    const boundedCandidate = await store.readUnpublishedIntentSegmentCandidate({
      actorId,
      epochId,
      libraryId,
      maximumOperations: 2,
    });
    if (!boundedCandidate) throw new Error("bounded candidate missing");
    const bodyDigest = digest("intent-segment-body", boundedCandidate.body);
    const header = shared.intentSegmentHeaderFromBodyV1(
      boundedCandidate.body,
      bodyDigest,
    );
    const storedContentDigest = hex("aa");
    const segmentReference = {
      descriptor: {
        byteLength: 1_024,
        contentDigest: storedContentDigest,
        objectKey: shared.createLibraryCoreImmutableObjectKey({
          actorId,
          digest: storedContentDigest,
          firstSequence: boundedCandidate.body.first_intent_sequence,
          kind: "intent_segment",
          lastSequence: boundedCandidate.body.last_intent_sequence,
          libraryId,
        }),
      },
      transportObjectId: "drive-intent-segment-1",
    };
    const publishedHead = shared.parseLibraryCoreIntentHeadV1({
      actor_id: actorId,
      epoch_id: epochId,
      latest_segment: segmentReference,
      latest_segment_digest: storedContentDigest,
      library_id: libraryId,
      next_intent_sequence: boundedCandidate.body.last_intent_sequence + 1,
      protocol: "intent_head_v1",
      protocol_version: 1,
      schema_version: 1,
    });
    const publishedHeadDigest = shared.sha256LowerHex(
      shared.encodeLibraryCoreCanonicalValue(publishedHead),
    );
    let staleReadbackError = "";
    try {
      await store.recordIntentSegmentPublication({
        entries: boundedCandidate.body.entries,
        expectedHeadDigest: boundedCandidate.expectedHeadDigest,
        header,
        publishedHead,
        readBackHeadDigest: hex("bb"),
        segmentReference,
      });
    } catch (error) {
      staleReadbackError =
        error instanceof Error ? error.message : String(error);
    }
    const publication = await store.recordIntentSegmentPublication({
      entries: boundedCandidate.body.entries,
      expectedHeadDigest: boundedCandidate.expectedHeadDigest,
      header,
      publishedHead,
      readBackHeadDigest: publishedHeadDigest,
      segmentReference,
    });
    const publicationReplay = await store.recordIntentSegmentPublication({
      entries: boundedCandidate.body.entries,
      expectedHeadDigest: boundedCandidate.expectedHeadDigest,
      header,
      publishedHead,
      readBackHeadDigest: publishedHeadDigest,
      segmentReference,
    });
    const remaining = await store.readUnpublishedIntentSegmentCandidate({
      actorId,
      epochId,
      libraryId,
    });
    await store.quiesce();
    const reopened = createPwaLibraryCorePortableCheckpointStore({
      databaseName,
      indexedDb: indexedDB,
      keyRange: IDBKeyRange,
      subtle: crypto.subtle,
    });
    const afterRestart = await reopened.readUnpublishedIntentSegmentCandidate({
      actorId,
      epochId,
      libraryId,
    });
    await reopened.quiesce();
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.deleteDatabase(databaseName);
      request.addEventListener("success", () => resolve(), { once: true });
      request.addEventListener(
        "error",
        () => reject(request.error ?? new Error("database delete failed")),
        { once: true },
      );
    });

    return {
      afterRestart: afterRestart?.body,
      boundedBody: boundedCandidate.body,
      changedRetryError,
      firstReceipt,
      fullBody: fullCandidate?.body,
      publication,
      publicationReplay,
      remainingBody: remaining?.body,
      replayReceipt,
      secondReceipt,
      staleReadbackError,
    };
  }, sharedModuleUrl);

  expect(result.firstReceipt).toMatchObject({
    firstIntentSequence: 1,
    lastIntentSequence: 2,
    operationCount: 2,
    status: "enqueued",
  });
  expect(result.replayReceipt.status).toBe("already_enqueued");
  expect(result.secondReceipt).toMatchObject({
    firstIntentSequence: 3,
    lastIntentSequence: 3,
    status: "enqueued",
  });
  expect(result.changedRetryError).toMatch(/different bytes/);
  expect(result.fullBody).toMatchObject({
    first_intent_sequence: 1,
    last_intent_sequence: 3,
    operation_count: 3,
  });
  expect(result.boundedBody).toMatchObject({
    first_intent_sequence: 1,
    last_intent_sequence: 2,
    operation_count: 2,
  });
  expect(result.staleReadbackError).toMatch(/readback head/);
  expect(result.publication).toMatchObject({
    firstIntentSequence: 1,
    lastIntentSequence: 2,
    operationCount: 2,
    status: "recorded",
  });
  expect(result.publicationReplay.status).toBe("already_recorded");
  expect(result.remainingBody).toMatchObject({
    first_intent_sequence: 3,
    last_intent_sequence: 3,
    operation_count: 1,
    previous_segment_digest: "aa".repeat(32),
  });
  expect(result.afterRestart).toEqual(result.remainingBody);
});
