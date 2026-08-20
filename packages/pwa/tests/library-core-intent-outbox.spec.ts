import path from "node:path";

import { expect, test } from "@playwright/test";

test("PWA intent outbox commits whole signed transactions and advances only on exact publication evidence", async ({
  page,
}) => {
  const sharedModuleUrl = `/@fs${path.resolve(
    process.cwd(),
    "../shared/src/library-core/index.ts",
  )}`;
  const syncModuleUrl = `/@fs${path.resolve(
    process.cwd(),
    "../sync/src/cloud/index.ts",
  )}`;

  await page.goto("/favicon.svg");
  const result = await page.evaluate(
    async ({ sharedModuleUrl, syncModuleUrl }) => {
      const shared = await import(sharedModuleUrl);
      const sync = await import(syncModuleUrl);
      const { createPwaLibraryCorePortableCheckpointStore } =
        await import("/src/lib/library-core-portable-checkpoint-store.ts");
      const hex = (pair: string) => pair.repeat(32);
      const signature = "55".repeat(64);
      const digest = (domain: string, value: unknown) =>
        shared.sha256LowerHex(
          shared.encodeLibraryCoreDigestInput(domain, value),
        );
      const databaseName = `freed-library-core-intents-${crypto.randomUUID()}`;
      const store = createPwaLibraryCorePortableCheckpointStore({
        databaseName,
        indexedDb: indexedDB,
        keyRange: IDBKeyRange,
        subtle: crypto.subtle,
      });
      await store.bootstrapFeaturePreviewAuthority();
      const database = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open(databaseName);
        request.addEventListener("success", () => resolve(request.result), {
          once: true,
        });
        request.addEventListener(
          "error",
          () => reject(request.error ?? new Error("preview database open failed")),
          { once: true },
        );
      });
      const identityRead = database.transaction(
        [
          "portable_control",
          "portable_generations",
          "portable_actor_tips",
          "portable_pwa_actor_identities",
        ],
        "readonly",
      );
      const selected = await new Promise<{ generationId: string }>((resolve, reject) => {
        const request = identityRead
          .objectStore("portable_control")
          .get("selected_portable_generation");
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      const generation = await new Promise<{
        libraryId: string;
        storageEpoch: string;
      }>((resolve, reject) => {
        const request = identityRead
          .objectStore("portable_generations")
          .get(selected.generationId);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      const identity = await new Promise<{ actorId: string }>((resolve, reject) => {
        const request = identityRead
          .objectStore("portable_pwa_actor_identities")
          .get(generation.libraryId);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      const actorTip = await new Promise<{ acceptedChainDigest: string }>((resolve, reject) => {
        const request = identityRead
          .objectStore("portable_actor_tips")
          .get([selected.generationId, identity.actorId]);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      await new Promise<void>((resolve, reject) => {
        identityRead.oncomplete = () => resolve();
        identityRead.onerror = () => reject(identityRead.error);
        identityRead.onabort = () => reject(identityRead.error);
      });
      database.close();
      const libraryId = generation.libraryId as string;
      const epochId = generation.storageEpoch as string;
      const actorId = identity.actorId as string;
      const actorChainGenesis = actorTip.acceptedChainDigest as string;

      const finalize = async ({
        count,
        firstSequence,
        previousChainDigest,
        previousOperationId,
        readAtOffset = 0,
        transactionEpochId = epochId,
        transactionId,
      }: {
        count: number;
        firstSequence: number;
        previousChainDigest: string;
        previousOperationId: string | null;
        readAtOffset?: number;
        transactionEpochId?: string;
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
              epoch_id: transactionEpochId,
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
      const pendingActorsBeforePublication =
        await store.readPendingIntentActors({
          epochId,
          libraryId,
        });
      const fullCandidate = await store.readUnpublishedIntentSegmentCandidate({
        actorId,
        epochId,
        libraryId,
      });
      const boundedCandidate =
        await store.readUnpublishedIntentSegmentCandidate({
          actorId,
          epochId,
          libraryId,
          maximumOperations: 2,
        });
      if (!boundedCandidate) throw new Error("bounded candidate missing");
      let remoteHead = boundedCandidate.expectedHead;
      let remoteHeadBytes = shared.encodeLibraryCoreCanonicalValue(remoteHead);
      let remoteRevision = '"intent-head-r1"';
      const publicationEvidence =
        await sync.publishLibraryCoreIntentCandidateV1({
          adapter: {
            async compareAndSwapControl() {
              throw new Error("control CAS is not part of intent publication");
            },
            async compareAndSwapIntentHead({ bytes, expectedRevision }) {
              if (expectedRevision !== remoteRevision) {
                return {
                  current: {
                    bytes: remoteHeadBytes,
                    head: remoteHead,
                    revision: remoteRevision,
                  },
                  status: "conflict",
                };
              }
              remoteHeadBytes = bytes;
              remoteHead = shared.parseLibraryCoreIntentHeadV1(
                shared.decodeLibraryCoreCanonicalValue(bytes),
              );
              remoteRevision = '"intent-head-r2"';
              return { status: "committed" };
            },
            async putImmutable(object) {
              return {
                transportObjectId: `drive-${object.descriptor.contentDigest}`,
              };
            },
            async readControl() {
              throw new Error("control read is not part of intent publication");
            },
            async readImmutable() {
              throw new Error(
                "immutable read is not part of intent publication",
              );
            },
            async readIntentHead() {
              return {
                bytes: remoteHeadBytes,
                head: remoteHead,
                revision: remoteRevision,
              };
            },
            async verifyImmutable(receipt) {
              return receipt.descriptor;
            },
          },
          candidate: boundedCandidate,
          subtle: crypto.subtle,
        });
      if (publicationEvidence.status === "conflict") {
        throw new Error("unexpected intent-head conflict");
      }
      let staleReadbackError = "";
      try {
        await store.recordIntentSegmentPublication({
          ...publicationEvidence,
          readBackHeadDigest: hex("bb"),
        });
      } catch (error) {
        staleReadbackError =
          error instanceof Error ? error.message : String(error);
      }
      const publication =
        await store.recordIntentSegmentPublication(publicationEvidence);
      const publicationReplay =
        await store.recordIntentSegmentPublication(publicationEvidence);
      const remaining = await store.readUnpublishedIntentSegmentCandidate({
        actorId,
        epochId,
        libraryId,
      });
      const pendingActorsAfterPublication = await store.readPendingIntentActors(
        {
          epochId,
          libraryId,
        },
      );
      const preparedResult = await sync.prepareLibraryCoreResultSegmentV1({
        actorId,
        entries: boundedCandidate.body.entries.map((entry, index) => ({
          actorId,
          intentOperationId: entry.operation_id,
          intentSequence: entry.intent_sequence,
          providerReceiptDigest: null,
          resultOperationId: `accepted-${entry.operation_id}`,
          resultSequence: index + 1,
          status: "accepted" as const,
        })),
        epochId,
        libraryId,
        previousSegmentDigest: null,
        subtle: crypto.subtle,
      });
      const resultReference = {
        descriptor: preparedResult.object.descriptor,
        transportObjectId: "drive-result-segment-1",
      };
      const importResult = () =>
        sync.importLibraryCoreResultSegmentV1({
          actorId,
          adapter: {
            async readImmutable() {
              return preparedResult.object.source.slice();
            },
          },
          expectedFirstResultSequence: 1,
          expectedPreviousSegmentDigest: null,
          libraryId,
          reference: resultReference,
          storageEpoch: epochId,
          subtle: crypto.subtle,
          writer: store,
        });
      await importResult();
      await importResult();
      const resultCursor = await store.readResultImportCursor({
        actorId,
        epochId,
        libraryId,
      });
      const acceptedResult = await store.readIntentResult({
        actorId,
        epochId,
        intentOperationId: boundedCandidate.body.entries[0]!.operation_id,
        libraryId,
      });
      const replacementEpochId = hex("66");
      let replacementEpochError = "";
      try {
        await store.enqueueIntentTransaction(
          await finalize({
            count: 1,
            firstSequence: 1,
            previousChainDigest: actorChainGenesis,
            previousOperationId: null,
            transactionEpochId: replacementEpochId,
            transactionId: "tx-replacement-epoch-1",
          }),
        );
      } catch (error) {
        replacementEpochError =
          error instanceof Error ? error.message : String(error);
      }
      const originalEpochActors = await store.readIntentActors({
        epochId,
        libraryId,
      });
      const replacementEpochActors = await store.readIntentActors({
        epochId: replacementEpochId,
        libraryId,
      });
      await store.quiesce();
      const reopened = createPwaLibraryCorePortableCheckpointStore({
        databaseName,
        indexedDb: indexedDB,
        keyRange: IDBKeyRange,
        subtle: crypto.subtle,
      });
      const afterRestart = await reopened.readUnpublishedIntentSegmentCandidate(
        {
          actorId,
          epochId,
          libraryId,
        },
      );
      const acceptedAfterRestart = await reopened.readIntentResult({
        actorId,
        epochId,
        intentOperationId: boundedCandidate.body.entries[0]!.operation_id,
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
        acceptedResult,
        actorId,
        epochId,
        resultCursor,
        resultReferenceDigest: resultReference.descriptor.contentDigest,
        acceptedAfterRestart,
        boundedBody: boundedCandidate.body,
        changedRetryError,
        firstReceipt,
        fullBody: fullCandidate?.body,
        libraryId,
        publication,
        publicationReplay,
        originalEpochActors,
        pendingActorsAfterPublication,
        pendingActorsBeforePublication,
        remainingBody: remaining?.body,
        replayReceipt,
        replacementEpochActors,
        replacementEpochError,
        secondReceipt,
        staleReadbackError,
      };
    },
    { sharedModuleUrl, syncModuleUrl },
  );

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
  expect(result.pendingActorsBeforePublication).toEqual([
    {
      actorId: result.actorId,
      epochId: result.epochId,
      libraryId: result.libraryId,
    },
  ]);
  expect(result.pendingActorsAfterPublication).toEqual([
    {
      actorId: result.actorId,
      epochId: result.epochId,
      libraryId: result.libraryId,
    },
  ]);
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
  expect(result.acceptedResult).toMatchObject({
    intentOperationId: "read-item-1",
    providerReceiptDigest: null,
    resultOperationId: "accepted-read-item-1",
    resultSequence: 1,
    status: "accepted",
  });
  expect(result.resultCursor).toEqual({
    latestSegmentDigest: result.resultReferenceDigest,
    nextResultSequence: 3,
  });
  expect(result.acceptedAfterRestart).toEqual(result.acceptedResult);
  expect(result.remainingBody).toMatchObject({
    first_intent_sequence: 3,
    last_intent_sequence: 3,
    operation_count: 1,
    previous_segment_digest: result.publication.storedContentDigest,
  });
  expect(result.afterRestart).toEqual(result.remainingBody);
  expect(result.replacementEpochError).toMatch(/active enrolled capability/);
  expect(result.originalEpochActors).toEqual([
    {
      actorId: result.actorId,
      epochId: result.epochId,
      libraryId: result.libraryId,
    },
  ]);
  expect(result.replacementEpochActors).toEqual([]);
});
