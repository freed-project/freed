import { webcrypto } from "node:crypto";
import { IDBFactory, IDBKeyRange } from "fake-indexeddb";
import { describe, expect, it } from "vitest";
import type { FeedItem } from "@freed/shared";
import {
  createLibraryCoreImmutableObjectKey,
  encodeLibraryCoreCanonicalValue,
  isLibraryCoreLowercaseHex64,
  isLibraryCoreOperationInstanceId,
  type LibraryCoreAcceptedAuthorityStateV1,
  type LibraryCoreCanonicalValue,
  type LibraryCoreCheckpointManifestV1,
  type LibraryCoreImmutableObjectReferenceV1,
  type LibraryCoreIntentResultEntryV1,
  type LibraryCoreLowercaseHex64,
  type LibraryCoreOperationInstanceId,
  type LibraryCorePortableCheckpointHeaderV1,
  type LibraryCorePortableCheckpointRecordV1,
  type LibraryCoreResultSegmentHeaderV1,
} from "@freed/shared/library-core";

import { requestResult, transactionDone } from "./library-core-indexeddb";
import { createPwaLibraryCorePortableCheckpointStore } from "./library-core-portable-checkpoint-store";

const ACTOR_TIPS_STORE = "portable_actor_tips";
const PWA_LIBRARY_CORE_INTENT_OVERLAY_TRANSACTION_LIMIT = 512;
const PWA_LIBRARY_CORE_INTENT_OVERLAY_OPERATION_LIMIT = 4_096;
const PWA_LIBRARY_CORE_INTENT_OVERLAY_CANONICAL_BYTE_LIMIT = 16_777_216;
const ACTOR_ENROLLMENTS_STORE = "portable_actor_enrollments";
const INTENT_OPERATIONS_STORE = "portable_intent_operations";
const INTENT_OVERLAY_STORE = "portable_intent_overlay_transactions";
const INTENT_TRANSACTIONS_STORE = "portable_intent_transactions";
const CONTROL_STORE = "portable_control";
const FEED_ROWS_STORE = "portable_feed_rows";
const MATERIALIZED_ROWS_STORE = "portable_materialized_rows";

function hex64(value: string): LibraryCoreLowercaseHex64 {
  if (!isLibraryCoreLowercaseHex64(value)) {
    throw new Error("test fixture requires a lowercase hex-64 value");
  }
  return value;
}

function operationId(value: string): LibraryCoreOperationInstanceId {
  if (!isLibraryCoreOperationInstanceId(value)) {
    throw new Error("test fixture requires an operation instance ID");
  }
  return value;
}

function item(saved = false): FeedItem {
  return {
    author: { displayName: "Ada", handle: "ada", id: "author:ada" },
    capturedAt: 1_780_000_000_000,
    content: { mediaTypes: [], mediaUrls: [], text: "bounded overlay" },
    contentType: "post",
    globalId: "x:overlay-item",
    platform: "x",
    publishedAt: 1_780_000_000_000,
    topics: [],
    userState: {
      archived: false,
      hidden: false,
      saved,
      ...(saved ? { savedAt: 1_780_000_000_100 } : {}),
      tags: [],
    },
  } as FeedItem;
}

function openDatabase(
  indexedDb: IDBFactory,
  name: string,
): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDb.open(name);
    request.addEventListener("success", () => resolve(request.result), {
      once: true,
    });
    request.addEventListener(
      "error",
      () => reject(request.error ?? new Error("test database open failed")),
      { once: true },
    );
  });
}

function makeStore(indexedDb: IDBFactory, name: string) {
  return createPwaLibraryCorePortableCheckpointStore({
    databaseName: name,
    indexedDb,
    keyRange: IDBKeyRange,
    now: () => 1_780_000_000_200,
    randomBytes(byteLength) {
      return new Uint8Array(byteLength).fill(7);
    },
    subtle: webcrypto.subtle as unknown as SubtleCrypto,
  });
}

async function createHistoricalV9Database(
  indexedDb: IDBFactory,
  name: string,
  transactionCount: number,
): Promise<void> {
  const database = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDb.open(name, 9);
    request.addEventListener("upgradeneeded", () => {
      request.result.createObjectStore(CONTROL_STORE, { keyPath: "key" });
      const intents = request.result.createObjectStore(
        INTENT_TRANSACTIONS_STORE,
        {
          keyPath: ["libraryId", "epochId", "actorId", "firstIntentSequence"],
        },
      );
      intents.createIndex(
        "by_actor_transaction_id",
        ["libraryId", "epochId", "actorId", "transactionId"],
        { unique: true },
      );
    });
    request.addEventListener("success", () => resolve(request.result), {
      once: true,
    });
    request.addEventListener(
      "error",
      () =>
        reject(request.error ?? new Error("historical database open failed")),
      { once: true },
    );
  });
  const transaction = database.transaction(
    INTENT_TRANSACTIONS_STORE,
    "readwrite",
  );
  const intents = transaction.objectStore(INTENT_TRANSACTIONS_STORE);
  for (let index = 0; index < transactionCount; index += 1) {
    intents.add({
      actorId: "historical-actor",
      canonicalEnvelopeBytes: 1,
      epochId: "historical-epoch",
      firstIntentSequence: index + 1,
      lastIntentSequence: index + 1,
      libraryId: "historical-library",
      operationCount: 1,
      operationIds: [`historical-operation-${index}`],
      transactionDigest: "b".repeat(64),
      transactionId: `historical-transaction-${index}`,
    });
  }
  await transactionDone(transaction);
  database.close();
}

interface LocalActorEvidence {
  readonly actorId: LibraryCoreOperationInstanceId;
  readonly enrollmentCertificateDigest: LibraryCoreLowercaseHex64;
  readonly operations: readonly Readonly<{
    actorChainDigest: LibraryCoreLowercaseHex64;
    operationId: LibraryCoreOperationInstanceId;
    sequence: number;
    transactionDigest: LibraryCoreLowercaseHex64;
    transactionId: LibraryCoreOperationInstanceId;
  }>[];
}

async function readLocalActorEvidence(
  indexedDb: IDBFactory,
  name: string,
  generationId: string,
): Promise<LocalActorEvidence> {
  const database = await openDatabase(indexedDb, name);
  const transaction = database.transaction(
    [ACTOR_TIPS_STORE, INTENT_OPERATIONS_STORE],
    "readonly",
  );
  const tips = (await requestResult(
    transaction.objectStore(ACTOR_TIPS_STORE).getAll(),
  )) as Array<{
    actorId: LibraryCoreOperationInstanceId;
    enrollmentCertificateDigest: LibraryCoreLowercaseHex64;
    generationId: string;
  }>;
  const actor = tips.find((tip) => tip.generationId === generationId)!;
  const operations = (await requestResult(
    transaction.objectStore(INTENT_OPERATIONS_STORE).getAll(),
  )) as Array<{
    actorId: LibraryCoreOperationInstanceId;
    entry: {
      canonical_envelope: {
        actor_chain_digest: LibraryCoreLowercaseHex64;
      };
      intent_sequence: number;
      operation_id: LibraryCoreOperationInstanceId;
    };
    transactionDigest: LibraryCoreLowercaseHex64;
    transactionId: LibraryCoreOperationInstanceId;
  }>;
  await transactionDone(transaction);
  database.close();
  return {
    actorId: actor.actorId,
    enrollmentCertificateDigest: actor.enrollmentCertificateDigest,
    operations: operations
      .filter((operation) => operation.actorId === actor.actorId)
      .sort(
        (left, right) =>
          left.entry.intent_sequence - right.entry.intent_sequence,
      )
      .map((operation) => ({
        actorChainDigest: operation.entry.canonical_envelope.actor_chain_digest,
        operationId: operation.entry.operation_id,
        sequence: operation.entry.intent_sequence,
        transactionDigest: operation.transactionDigest,
        transactionId: operation.transactionId,
      })),
  };
}

async function copyActorEnrollment(
  indexedDb: IDBFactory,
  name: string,
  actorId: LibraryCoreOperationInstanceId,
  fromGenerationId: string,
  toGenerationId: string,
): Promise<void> {
  const database = await openDatabase(indexedDb, name);
  const transaction = database.transaction(
    ACTOR_ENROLLMENTS_STORE,
    "readwrite",
  );
  const enrollments = transaction.objectStore(ACTOR_ENROLLMENTS_STORE);
  const enrollment = (await requestResult(
    enrollments.get([fromGenerationId, actorId]),
  )) as Record<string, unknown> | undefined;
  if (!enrollment) throw new Error("test actor enrollment is missing");
  enrollments.put({ ...enrollment, generationId: toGenerationId });
  await transactionDone(transaction);
  database.close();
}

async function countSelectedFeedRows(
  indexedDb: IDBFactory,
  name: string,
  generationId: string,
): Promise<number> {
  const database = await openDatabase(indexedDb, name);
  const transaction = database.transaction(FEED_ROWS_STORE, "readonly");
  const count = await requestResult(
    transaction
      .objectStore(FEED_ROWS_STORE)
      .count(IDBKeyRange.bound([generationId], [generationId, []])),
  );
  await transactionDone(transaction);
  database.close();
  return count;
}

async function selectCheckpoint(input: {
  readonly acceptedSequence: number;
  readonly actor: LocalActorEvidence;
  readonly authority: LibraryCoreAcceptedAuthorityStateV1;
  readonly digestDigit: string;
  readonly generation: number;
  readonly item: FeedItem;
  readonly store: ReturnType<typeof makeStore>;
}): Promise<
  Readonly<{
    manifest: LibraryCoreCheckpointManifestV1;
    manifestReference: LibraryCoreImmutableObjectReferenceV1;
  }>
> {
  const generationId = hex64(input.digestDigit.repeat(64));
  const pageDigest = hex64(input.digestDigit.repeat(64));
  const checkpointDigest = hex64(input.digestDigit.repeat(64));
  const acceptedOperation =
    input.acceptedSequence === 0
      ? undefined
      : input.actor.operations.find(
          (operation) => operation.sequence === input.acceptedSequence,
        );
  if (input.acceptedSequence > 0 && !acceptedOperation) {
    throw new Error("test checkpoint has no matching local actor operation");
  }
  const header = {
    accepted_authority: input.authority,
    anchor_kind: "accepted_authority",
    canonical_codec_version: 1,
    collection_counts: {
      accepted_frontier: 0,
      actor_states: 1,
      blob_roots: 0,
      excluded_registry_keys: 0,
      field_clocks: 0,
      materialized_rows: 2,
      quarantined_frontier: 0,
      receipt_records: 0,
      relationships: 0,
      tombstones: 0,
    },
    epoch: input.authority.epoch,
    epoch_id: operationId(input.authority.epoch_id),
    field_registry_version: 1,
    format: "freed_logical_checkpoint_v1",
    kind: "logical_checkpoint_header",
    library_id: operationId(input.authority.library_id),
    materializer_position: {
      frontier_digest: checkpointDigest,
      ingest_sequence: input.acceptedSequence,
      materialized_digest: checkpointDigest,
    },
    promoted_receipt_digests: [],
    schema_version: 1,
    source_manifest_digest: checkpointDigest,
    source_transition_digest: checkpointDigest,
    transition_candidate_anchor: null,
  } satisfies LibraryCorePortableCheckpointHeaderV1;
  const records = [
    header,
    {
      collection: "materialized_rows",
      kind: "logical_checkpoint_entry",
      ordinal: 0,
      value: {
        primary_key: "shell",
        registry_key: "00_library_shell",
        row: {},
      },
    },
    {
      collection: "materialized_rows",
      kind: "logical_checkpoint_entry",
      ordinal: 1,
      value: {
        primary_key: input.item.globalId,
        registry_key: "10_feed_items",
        row: input.item as unknown as LibraryCoreCanonicalValue,
      },
    },
    {
      collection: "actor_states",
      kind: "logical_checkpoint_entry",
      ordinal: 0,
      value: {
        accepted_chain_digest:
          acceptedOperation?.actorChainDigest ??
          input.actor.enrollmentCertificateDigest,
        accepted_operation_id: acceptedOperation?.operationId ?? null,
        accepted_sequence: input.acceptedSequence,
        actor_id: input.actor.actorId,
        enrollment_certificate_digest: input.actor.enrollmentCertificateDigest,
        retired: false,
        retirement_certificate_digest: null,
      },
    },
  ] as const satisfies readonly LibraryCorePortableCheckpointRecordV1[];
  const manifest = {
    causalFrontierDigest: checkpointDigest,
    datasetSchemaId: "library_core_logical_checkpoint_v1",
    generation: input.generation,
    kind: "checkpoint_manifest",
    libraryId: operationId(input.authority.library_id),
    pages: [
      {
        firstRecordIdentity: "00:header",
        lastRecordIdentity: "07:actor",
        object: {
          descriptor: {
            byteLength: 1,
            contentDigest: pageDigest,
            objectKey: createLibraryCoreImmutableObjectKey({
              digest: pageDigest,
              epochId: input.authority.epoch_id,
              generation: input.generation,
              kind: "checkpoint_page",
              libraryId: input.authority.library_id,
              pageIndex: 0,
            }),
          },
          transportObjectId: `page-${input.generation}`,
        },
        pageIndex: 0,
        recordCount: records.length,
      },
    ],
    protocolVersion: 1,
    schemaVersion: 1,
    storageEpoch: operationId(input.authority.epoch_id),
    totalRecordCount: records.length,
  } satisfies LibraryCoreCheckpointManifestV1;
  const manifestReference = {
    descriptor: {
      byteLength: 1,
      contentDigest: generationId,
      objectKey: createLibraryCoreImmutableObjectKey({
        digest: generationId,
        epochId: input.authority.epoch_id,
        generation: input.generation,
        kind: "checkpoint_manifest",
        libraryId: input.authority.library_id,
      }),
    },
    transportObjectId: `manifest-${input.generation}`,
  } satisfies LibraryCoreImmutableObjectReferenceV1;
  const disposition = await input.store.beginImport({
    manifest,
    manifestReference,
  });
  if (disposition !== "already_complete") {
    await input.store.appendPage(0, records);
    await input.store.finalizeImport({ header, manifest, manifestReference });
  }
  return Object.freeze({ manifest, manifestReference });
}

function acceptedResult(input: {
  readonly actor: LocalActorEvidence;
  readonly authority: LibraryCoreAcceptedAuthorityStateV1;
  readonly operationIndex: number;
  readonly status?: "accepted" | "provider_failed";
}) {
  const operation = input.actor.operations[input.operationIndex]!;
  const status = input.status ?? "accepted";
  const entry = {
    actor_id: input.actor.actorId,
    intent_operation_id: operation.operationId,
    intent_sequence: operation.sequence,
    kind: "result_segment_entry",
    provider_receipt_digest:
      status === "accepted" ? null : hex64("f".repeat(64)),
    result_operation_id: operationId(`result:${operation.operationId}`),
    result_sequence: 1,
    status,
  } satisfies LibraryCoreIntentResultEntryV1;
  const digest = hex64("d".repeat(64));
  const header = {
    actor_id: input.actor.actorId,
    canonical_entry_bytes: encodeLibraryCoreCanonicalValue(
      entry as unknown as LibraryCoreCanonicalValue,
    ).byteLength,
    epoch_id: operationId(input.authority.epoch_id),
    first_result_sequence: 1,
    format: "freed_result_segment_v1",
    kind: "result_segment_header",
    last_result_sequence: 1,
    library_id: operationId(input.authority.library_id),
    previous_segment_digest: null,
    protocol: "result_segments_v1",
    protocol_version: 1,
    result_count: 1,
    schema_version: 1,
    segment_digest: digest,
  } satisfies LibraryCoreResultSegmentHeaderV1;
  const reference = {
    descriptor: {
      byteLength: 1,
      contentDigest: digest,
      objectKey: createLibraryCoreImmutableObjectKey({
        actorId: input.actor.actorId,
        digest,
        epochId: input.authority.epoch_id,
        firstSequence: 1,
        kind: "result_segment",
        lastSequence: 1,
        libraryId: input.authority.library_id,
      }),
    },
    transportObjectId: "result-1",
  } satisfies LibraryCoreImmutableObjectReferenceV1;
  return { entries: [entry], header, reference } as const;
}

describe("PWA Library Core local intent overlay", () => {
  it("keeps an accepted edit visible across a newer checkpoint, response loss, and restart until exact actor-tip containment", async () => {
    const indexedDb = new IDBFactory();
    const name = "overlay-convergence";
    const store = makeStore(indexedDb, name);
    await store.bootstrapFeaturePreviewAuthority();
    const bootstrap = (await store.readSelectedCheckpointReceipt())!;
    const authority = (await store.readSelectedAcceptedAuthorityState())!;

    await store.enqueueFeedItemCaptures([item(false)]);
    let actor = await readLocalActorEvidence(
      indexedDb,
      name,
      bootstrap.generationId,
    );
    await selectCheckpoint({
      acceptedSequence: 1,
      actor,
      authority,
      digestDigit: "1",
      generation: 1,
      item: item(false),
      store,
    });
    await copyActorEnrollment(
      indexedDb,
      name,
      actor.actorId,
      bootstrap.generationId,
      "1".repeat(64),
    );
    expect((await store.readIntentOverlayReceipt()).transactionCount).toBe(0);

    await store.enqueueUserStateAssignment({
      assigned: true,
      assignedAtMs: 1_780_000_000_100,
      entityId: item().globalId,
      field: "saved",
    });
    actor = await readLocalActorEvidence(indexedDb, name, "1".repeat(64));
    await selectCheckpoint({
      acceptedSequence: 1,
      actor,
      authority,
      digestDigit: "2",
      generation: 2,
      item: item(false),
      store,
    });
    expect(
      (
        await store.readSelectedMaterializedRow(
          "10_feed_items",
          item().globalId,
        )
      )?.userState,
    ).toMatchObject({ saved: true });
    expect(await store.readIntentOverlayReceipt()).toMatchObject({
      acceptedPendingOperationCount: 0,
      operationCount: 1,
      transactionCount: 1,
      unresolvedOperationCount: 1,
    });

    const result = acceptedResult({ actor, authority, operationIndex: 1 });
    await store.appendResultSegment(result);
    await store.appendResultSegment(result);
    expect(await store.readIntentOverlayReceipt()).toMatchObject({
      acceptedPendingOperationCount: 1,
      operationCount: 1,
      transactionCount: 1,
      unresolvedOperationCount: 0,
    });

    const migrationDatabase = await openDatabase(indexedDb, name);
    const migrationTransaction = migrationDatabase.transaction(
      [CONTROL_STORE, INTENT_OVERLAY_STORE],
      "readwrite",
    );
    migrationTransaction.objectStore(INTENT_OVERLAY_STORE).clear();
    migrationTransaction.objectStore(CONTROL_STORE).put({
      canonicalEnvelopeBytes: 0,
      key: "intent_overlay_backfill_v10",
      operationCount: 0,
      status: "pending",
      transactionCount: 0,
    });
    await transactionDone(migrationTransaction);
    migrationDatabase.close();
    await store.quiesce();
    const restarted = makeStore(indexedDb, name);
    await restarted.reapplySelectedIntentOverlay();
    expect(await restarted.readIntentOverlayReceipt()).toMatchObject({
      acceptedPendingOperationCount: 1,
      operationCount: 1,
      transactionCount: 1,
    });
    expect(
      (
        await restarted.readSelectedMaterializedRow(
          "10_feed_items",
          item().globalId,
        )
      )?.userState,
    ).toMatchObject({ saved: true });
    await selectCheckpoint({
      acceptedSequence: 2,
      actor,
      authority,
      digestDigit: "3",
      generation: 3,
      item: item(true),
      store: restarted,
    });
    expect(await restarted.readIntentOverlayReceipt()).toMatchObject({
      operationCount: 0,
      transactionCount: 0,
    });
  });

  it("keeps provider failure overlaid because no signed canonical rejection status exists", async () => {
    const indexedDb = new IDBFactory();
    const name = "overlay-provider-failure";
    const store = makeStore(indexedDb, name);
    await store.bootstrapFeaturePreviewAuthority();
    const selected = (await store.readSelectedCheckpointReceipt())!;
    const authority = (await store.readSelectedAcceptedAuthorityState())!;
    await store.enqueueFeedItemCaptures([item(false)]);
    const actor = await readLocalActorEvidence(
      indexedDb,
      name,
      selected.generationId,
    );
    await store.appendResultSegment(
      acceptedResult({
        actor,
        authority,
        operationIndex: 0,
        status: "provider_failed",
      }),
    );
    expect(await store.readIntentOverlayReceipt()).toMatchObject({
      acceptedPendingOperationCount: 1,
      operationCount: 1,
      transactionCount: 1,
    });
  });

  it("reapplies pending edits before reselecting a cached older generation", async () => {
    const indexedDb = new IDBFactory();
    const name = "overlay-cached-reselection";
    const store = makeStore(indexedDb, name);
    await store.bootstrapFeaturePreviewAuthority();
    const bootstrap = (await store.readSelectedCheckpointReceipt())!;
    const authority = (await store.readSelectedAcceptedAuthorityState())!;
    await store.enqueueFeedItemCaptures([item(false)]);
    let actor = await readLocalActorEvidence(
      indexedDb,
      name,
      bootstrap.generationId,
    );
    await selectCheckpoint({
      acceptedSequence: 1,
      actor,
      authority,
      digestDigit: "1",
      generation: 1,
      item: item(false),
      store,
    });
    await copyActorEnrollment(
      indexedDb,
      name,
      actor.actorId,
      bootstrap.generationId,
      hex64("1".repeat(64)),
    );
    await store.enqueueUserStateAssignment({
      assigned: true,
      assignedAtMs: 1_780_000_000_100,
      entityId: item().globalId,
      field: "saved",
    });
    actor = await readLocalActorEvidence(indexedDb, name, "1".repeat(64));
    await selectCheckpoint({
      acceptedSequence: 1,
      actor,
      authority,
      digestDigit: "2",
      generation: 2,
      item: item(false),
      store,
    });

    await selectCheckpoint({
      acceptedSequence: 1,
      actor,
      authority,
      digestDigit: "1",
      generation: 1,
      item: item(false),
      store,
    });

    expect((await store.readSelectedCheckpointReceipt())?.generationId).toBe(
      "1".repeat(64),
    );
    expect(
      (
        await store.readSelectedMaterializedRow(
          "10_feed_items",
          item().globalId,
        )
      )?.userState,
    ).toMatchObject({ saved: true });
    expect(await store.readIntentOverlayReceipt()).toMatchObject({
      operationCount: 1,
      transactionCount: 1,
    });
  });

  it("fails closed when pending overlay evidence belongs to another Library", async () => {
    const indexedDb = new IDBFactory();
    const name = "overlay-library-fence";
    const store = makeStore(indexedDb, name);
    await store.bootstrapFeaturePreviewAuthority();
    const selected = (await store.readSelectedCheckpointReceipt())!;
    const authority = (await store.readSelectedAcceptedAuthorityState())!;
    await store.enqueueFeedItemCaptures([item(false)]);
    const actor = await readLocalActorEvidence(
      indexedDb,
      name,
      selected.generationId,
    );
    const database = await openDatabase(indexedDb, name);
    const transaction = database.transaction(INTENT_OVERLAY_STORE, "readwrite");
    const overlays = transaction.objectStore(INTENT_OVERLAY_STORE);
    const overlay = (await requestResult(overlays.openCursor()))!;
    overlays.put({ ...overlay.value, libraryId: "another-library" });
    overlay.delete();
    await transactionDone(transaction);
    database.close();

    await expect(
      selectCheckpoint({
        acceptedSequence: 0,
        actor,
        authority,
        digestDigit: "5",
        generation: 5,
        item: item(false),
        store,
      }),
    ).rejects.toThrow(/another Library/);
    await store.abortImport();
    expect((await store.readSelectedCheckpointReceipt())?.generationId).toBe(
      selected.generationId,
    );
  });

  it("fails closed instead of carrying unresolved intents into a new epoch", async () => {
    const indexedDb = new IDBFactory();
    const name = "overlay-epoch-fence";
    const store = makeStore(indexedDb, name);
    await store.bootstrapFeaturePreviewAuthority();
    const selected = (await store.readSelectedCheckpointReceipt())!;
    const authority = (await store.readSelectedAcceptedAuthorityState())!;
    await store.enqueueFeedItemCaptures([item(false)]);
    const actor = await readLocalActorEvidence(
      indexedDb,
      name,
      selected.generationId,
    );
    const nextAuthority = {
      ...authority,
      epoch: authority.epoch + 1,
      epoch_id: hex64("9".repeat(64)),
      observed_frontier: [],
    } satisfies LibraryCoreAcceptedAuthorityStateV1;
    await expect(
      selectCheckpoint({
        acceptedSequence: 0,
        actor,
        authority: nextAuthority,
        digestDigit: "4",
        generation: 4,
        item: item(false),
        store,
      }),
    ).rejects.toThrow(/epoch transition has unresolved local intents/);
    await store.abortImport();
    expect((await store.readSelectedCheckpointReceipt())!.generationId).toBe(
      selected.generationId,
    );
  });

  it("rejects admission at the fixed overlay transaction bound", async () => {
    const indexedDb = new IDBFactory();
    const name = "overlay-bound";
    const store = makeStore(indexedDb, name);
    await store.bootstrapFeaturePreviewAuthority();
    const selected = (await store.readSelectedCheckpointReceipt())!;
    await store.enqueueFeedItemCaptures([item(false)]);
    const actor = await readLocalActorEvidence(
      indexedDb,
      name,
      selected.generationId,
    );
    const database = await openDatabase(indexedDb, name);
    const transaction = database.transaction(INTENT_OVERLAY_STORE, "readwrite");
    const overlays = transaction.objectStore(INTENT_OVERLAY_STORE);
    for (
      let index = 1;
      index < PWA_LIBRARY_CORE_INTENT_OVERLAY_TRANSACTION_LIMIT;
      index += 1
    ) {
      overlays.add({
        actorId: `bounded-actor-${index}`,
        canonicalEnvelopeBytes: 1,
        enqueuedAtMs: index,
        epochId: `bounded-epoch-${index}`,
        firstIntentSequence: 1,
        lastIntentSequence: 1,
        libraryId: `bounded-library-${index}`,
        operationCount: 1,
        operationIds: [`bounded-operation-${index}`],
        transactionDigest: "a".repeat(64),
        transactionId: `bounded-transaction-${index}`,
      });
    }
    await transactionDone(transaction);
    database.close();
    await expect(
      store.enqueueUserStateAssignment({
        assigned: true,
        assignedAtMs: 1_780_000_000_100,
        entityId: item().globalId,
        field: "saved",
      }),
    ).rejects.toThrow(/local intent overlay exceeds its 512 transaction/);
    expect((await store.readIntentOverlayReceipt()).transactionCount).toBe(1);
    expect(actor.operations).toHaveLength(1);
  });

  it.each(["operations", "bytes"] as const)(
    "rejects admission at the fixed overlay %s bound",
    async (bound) => {
      const indexedDb = new IDBFactory();
      const name = `overlay-${bound}-bound`;
      const store = makeStore(indexedDb, name);
      await store.bootstrapFeaturePreviewAuthority();
      await store.enqueueFeedItemCaptures([item(false)]);
      const existing = await store.readIntentOverlayReceipt();
      const database = await openDatabase(indexedDb, name);
      const transaction = database.transaction(
        INTENT_OVERLAY_STORE,
        "readwrite",
      );
      transaction.objectStore(INTENT_OVERLAY_STORE).add({
        actorId: "bounded-actor",
        canonicalEnvelopeBytes:
          bound === "bytes"
            ? PWA_LIBRARY_CORE_INTENT_OVERLAY_CANONICAL_BYTE_LIMIT -
              existing.canonicalEnvelopeBytes
            : 1,
        enqueuedAtMs: 1,
        epochId: "bounded-epoch",
        firstIntentSequence: 1,
        lastIntentSequence: 1,
        libraryId: "bounded-library",
        operationCount:
          bound === "operations"
            ? PWA_LIBRARY_CORE_INTENT_OVERLAY_OPERATION_LIMIT -
              existing.operationCount
            : 1,
        operationIds: ["bounded-operation"],
        transactionDigest: "a".repeat(64),
        transactionId: "bounded-transaction",
      });
      await transactionDone(transaction);
      database.close();
      await expect(
        store.enqueueUserStateAssignment({
          assigned: true,
          assignedAtMs: 1_780_000_000_100,
          entityId: item().globalId,
          field: "saved",
        }),
      ).rejects.toThrow(/local intent overlay exceeds/);
    },
  );

  it("backfills v9 in bounded passes and records overflow without a partial overlay", async () => {
    const indexedDb = new IDBFactory();
    const name = "overlay-v9-overflow";
    await createHistoricalV9Database(
      indexedDb,
      name,
      PWA_LIBRARY_CORE_INTENT_OVERLAY_TRANSACTION_LIMIT * 2,
    );
    const store = makeStore(indexedDb, name);
    for (const transactionCount of [128, 256, 384, 512]) {
      await expect(store.reapplySelectedIntentOverlay()).resolves.toEqual({
        canonicalEnvelopeBytes: transactionCount,
        countsAreLowerBounds: true,
        operationCount: transactionCount,
        schemaVersion: 1,
        status: "backfill_pending",
        transactionCount,
      });
    }
    await expect(store.reapplySelectedIntentOverlay()).resolves.toEqual({
      canonicalEnvelopeBytes: 513,
      countsAreLowerBounds: true,
      operationCount: 513,
      schemaVersion: 1,
      status: "overflow",
      transactionCount: 513,
    });

    const database = await openDatabase(indexedDb, name);
    const transaction = database.transaction(
      [CONTROL_STORE, INTENT_OVERLAY_STORE, INTENT_TRANSACTIONS_STORE],
      "readonly",
    );
    const [marker, overlayCount, historicalCount] = await Promise.all([
      requestResult(
        transaction
          .objectStore(CONTROL_STORE)
          .get("intent_overlay_backfill_v10"),
      ),
      requestResult(transaction.objectStore(INTENT_OVERLAY_STORE).count()),
      requestResult(transaction.objectStore(INTENT_TRANSACTIONS_STORE).count()),
    ]);
    await transactionDone(transaction);
    database.close();
    expect(marker).toMatchObject({
      canonicalEnvelopeBytes: 513,
      countsAreLowerBounds: true,
      operationCount: 513,
      status: "overflow",
      transactionCount: 513,
    });
    expect(overlayCount).toBe(0);
    expect(historicalCount).toBe(1_024);
  });

  it("advances bounded backfill across repeated imports of the unchanged selected checkpoint", async () => {
    const indexedDb = new IDBFactory();
    const name = "overlay-selected-recovery-progress";
    const store = makeStore(indexedDb, name);
    await store.bootstrapFeaturePreviewAuthority();
    const bootstrap = (await store.readSelectedCheckpointReceipt())!;
    const authority = (await store.readSelectedAcceptedAuthorityState())!;
    await store.enqueueFeedItemCaptures([item(false)]);
    const actor = await readLocalActorEvidence(
      indexedDb,
      name,
      bootstrap.generationId,
    );
    const checkpoint = await selectCheckpoint({
      acceptedSequence: 1,
      actor,
      authority,
      digestDigit: "1",
      generation: 1,
      item: item(false),
      store,
    });
    await copyActorEnrollment(
      indexedDb,
      name,
      actor.actorId,
      bootstrap.generationId,
      hex64("1".repeat(64)),
    );

    const database = await openDatabase(indexedDb, name);
    const transaction = database.transaction(
      [
        CONTROL_STORE,
        INTENT_OPERATIONS_STORE,
        INTENT_OVERLAY_STORE,
        INTENT_TRANSACTIONS_STORE,
      ],
      "readwrite",
    );
    const operations = transaction.objectStore(INTENT_OPERATIONS_STORE);
    const baseOperation = (await requestResult(
      operations.get([
        authority.library_id,
        authority.epoch_id,
        actor.actorId,
        1,
      ]),
    )) as Record<string, unknown> & {
      entry: Record<string, unknown> & {
        canonical_envelope: Record<string, unknown>;
      };
    };
    const intents = transaction.objectStore(INTENT_TRANSACTIONS_STORE);
    for (let sequence = 2; sequence <= 301; sequence += 1) {
      const operationId = `historical-operation-${sequence}`;
      const transactionId = `historical-transaction-${sequence}`;
      const transactionDigest = "b".repeat(64);
      intents.add({
        actorId: actor.actorId,
        canonicalEnvelopeBytes: 1,
        epochId: authority.epoch_id,
        firstIntentSequence: sequence,
        lastIntentSequence: sequence,
        libraryId: authority.library_id,
        operationCount: 1,
        operationIds: [operationId],
        transactionDigest,
        transactionId,
      });
      operations.add({
        ...baseOperation,
        entry: {
          ...baseOperation.entry,
          canonical_envelope: {
            ...baseOperation.entry.canonical_envelope,
            actor_sequence: sequence,
            operation_id: operationId,
          },
          intent_sequence: sequence,
          operation_id: operationId,
        },
        intentSequence: sequence,
        transactionDigest,
        transactionId,
      });
    }
    transaction.objectStore(INTENT_OVERLAY_STORE).clear();
    transaction.objectStore(CONTROL_STORE).put({
      canonicalEnvelopeBytes: 0,
      key: "intent_overlay_backfill_v10",
      operationCount: 0,
      status: "pending",
      transactionCount: 0,
    });
    await transactionDone(transaction);
    database.close();

    await expect(store.beginImport(checkpoint)).resolves.toBe(
      "already_complete",
    );
    expect(await store.readIntentOverlayRecoveryState()).toMatchObject({
      status: "backfill_pending",
      transactionCount: 127,
    });
    await expect(
      store.enqueueUserStateAssignment({
        assigned: true,
        assignedAtMs: 1_780_000_000_100,
        entityId: item().globalId,
        field: "saved",
      }),
    ).rejects.toThrow(/intent capability changed before durable admission/);

    await expect(store.beginImport(checkpoint)).resolves.toBe(
      "already_complete",
    );
    expect(await store.readIntentOverlayRecoveryState()).toMatchObject({
      status: "backfill_pending",
      transactionCount: 255,
    });
    await expect(store.beginImport(checkpoint)).resolves.toBe(
      "already_complete",
    );
    expect(await store.readIntentOverlayRecoveryState()).toMatchObject({
      status: "ready",
    });
    expect(await store.readIntentOverlayReceipt()).toMatchObject({
      operationCount: 300,
      transactionCount: 300,
    });
    expect((await store.readSelectedCheckpointReceipt())?.generationId).toBe(
      "1".repeat(64),
    );
  });

  it("retries an overflow marker against a candidate checkpoint that contains the historical actor tip", async () => {
    const indexedDb = new IDBFactory();
    const name = "overlay-overflow-retry";
    const store = makeStore(indexedDb, name);
    await store.bootstrapFeaturePreviewAuthority();
    const selected = (await store.readSelectedCheckpointReceipt())!;
    const authority = (await store.readSelectedAcceptedAuthorityState())!;
    await store.enqueueFeedItemCaptures([item(false)]);
    let actor = await readLocalActorEvidence(
      indexedDb,
      name,
      selected.generationId,
    );

    const database = await openDatabase(indexedDb, name);
    const transaction = database.transaction(
      [
        CONTROL_STORE,
        INTENT_OPERATIONS_STORE,
        INTENT_OVERLAY_STORE,
        INTENT_TRANSACTIONS_STORE,
      ],
      "readwrite",
    );
    const intents = transaction.objectStore(INTENT_TRANSACTIONS_STORE);
    const operations = transaction.objectStore(INTENT_OPERATIONS_STORE);
    for (
      let sequence = 2;
      sequence <= PWA_LIBRARY_CORE_INTENT_OVERLAY_TRANSACTION_LIMIT + 1;
      sequence += 1
    ) {
      const operationId = `historical-operation-${sequence}`;
      const transactionId = `historical-transaction-${sequence}`;
      const transactionDigest = "b".repeat(64);
      intents.add({
        actorId: actor.actorId,
        canonicalEnvelopeBytes: 1,
        epochId: authority.epoch_id,
        firstIntentSequence: sequence,
        lastIntentSequence: sequence,
        libraryId: authority.library_id,
        operationCount: 1,
        operationIds: [operationId],
        transactionDigest,
        transactionId,
      });
      operations.add({
        actorId: actor.actorId,
        entry: {
          canonical_envelope: { actor_chain_digest: "c".repeat(64) },
          intent_sequence: sequence,
          kind: "intent_segment_entry",
          operation_id: operationId,
        },
        envelopeDigest: "e".repeat(64),
        epochId: authority.epoch_id,
        intentSequence: sequence,
        libraryId: authority.library_id,
        publishedStoredDigest: null,
        transactionDigest,
        transactionId,
      });
    }
    transaction.objectStore(INTENT_OVERLAY_STORE).clear();
    transaction.objectStore(CONTROL_STORE).put({
      canonicalEnvelopeBytes:
        PWA_LIBRARY_CORE_INTENT_OVERLAY_TRANSACTION_LIMIT + 1,
      countsAreLowerBounds: true,
      key: "intent_overlay_backfill_v10",
      operationCount: PWA_LIBRARY_CORE_INTENT_OVERLAY_TRANSACTION_LIMIT + 1,
      status: "overflow",
      transactionCount: PWA_LIBRARY_CORE_INTENT_OVERLAY_TRANSACTION_LIMIT + 1,
    });
    await transactionDone(transaction);
    database.close();
    actor = await readLocalActorEvidence(
      indexedDb,
      name,
      selected.generationId,
    );

    await expect(store.reapplySelectedIntentOverlay()).resolves.toMatchObject({
      countsAreLowerBounds: true,
      status: "overflow",
      transactionCount: 513,
    });
    expect(
      await store.readSelectedMaterializedRow("10_feed_items", item().globalId),
    ).toMatchObject({ globalId: item().globalId });
    await expect(
      store.enqueueUserStateAssignment({
        assigned: true,
        assignedAtMs: 1_780_000_000_100,
        entityId: item().globalId,
        field: "saved",
      }),
    ).rejects.toThrow(/intent capability changed before durable admission/);
    await selectCheckpoint({
      acceptedSequence: 0,
      actor,
      authority,
      digestDigit: "5",
      generation: 5,
      item: item(false),
      store,
    });
    expect((await store.readSelectedCheckpointReceipt())?.generationId).toBe(
      selected.generationId,
    );
    expect(await store.readIntentOverlayRecoveryState()).toMatchObject({
      status: "backfill_pending",
      transactionCount: 128,
    });

    await selectCheckpoint({
      acceptedSequence: PWA_LIBRARY_CORE_INTENT_OVERLAY_TRANSACTION_LIMIT + 1,
      actor,
      authority,
      digestDigit: "6",
      generation: 6,
      item: item(false),
      store,
    });
    expect(await store.readIntentOverlayReceipt()).toMatchObject({
      operationCount: 0,
      transactionCount: 0,
    });
  });

  it("merges an overlaid read assignment with an earlier canonical checkpoint timestamp", async () => {
    const indexedDb = new IDBFactory();
    const name = "overlay-read-minimum";
    const store = makeStore(indexedDb, name);
    await store.bootstrapFeaturePreviewAuthority();
    const bootstrap = (await store.readSelectedCheckpointReceipt())!;
    const authority = (await store.readSelectedAcceptedAuthorityState())!;
    await store.enqueueFeedItemCaptures([item(false)]);
    let actor = await readLocalActorEvidence(
      indexedDb,
      name,
      bootstrap.generationId,
    );
    await selectCheckpoint({
      acceptedSequence: 1,
      actor,
      authority,
      digestDigit: "1",
      generation: 1,
      item: item(false),
      store,
    });
    await copyActorEnrollment(
      indexedDb,
      name,
      actor.actorId,
      bootstrap.generationId,
      hex64("1".repeat(64)),
    );
    await store.enqueueReadAssignments({
      entityIds: [item().globalId],
      readAtMs: 1_780_000_000_200,
    });
    actor = await readLocalActorEvidence(indexedDb, name, "1".repeat(64));
    const canonicalItem = {
      ...item(false),
      userState: {
        ...item(false).userState,
        readAt: 1_780_000_000_100,
      },
    } satisfies FeedItem;

    await selectCheckpoint({
      acceptedSequence: 1,
      actor,
      authority,
      digestDigit: "2",
      generation: 2,
      item: canonicalItem,
      store,
    });

    expect(
      (
        await store.readSelectedMaterializedRow(
          "10_feed_items",
          item().globalId,
        )
      )?.userState,
    ).toMatchObject({ readAt: 1_780_000_000_100 });
  });

  it("deletes stale feed projections for local and replayed archive assignments", async () => {
    const indexedDb = new IDBFactory();
    const name = "overlay-archive-projection";
    const store = makeStore(indexedDb, name);
    await store.bootstrapFeaturePreviewAuthority();
    const bootstrap = (await store.readSelectedCheckpointReceipt())!;
    const authority = (await store.readSelectedAcceptedAuthorityState())!;
    await store.enqueueFeedItemCaptures([item(false)]);
    let actor = await readLocalActorEvidence(
      indexedDb,
      name,
      bootstrap.generationId,
    );
    await selectCheckpoint({
      acceptedSequence: 1,
      actor,
      authority,
      digestDigit: "1",
      generation: 1,
      item: item(false),
      store,
    });
    await copyActorEnrollment(
      indexedDb,
      name,
      actor.actorId,
      bootstrap.generationId,
      hex64("1".repeat(64)),
    );
    await store.enqueueUserStateAssignment({
      assigned: true,
      assignedAtMs: 1_780_000_000_100,
      entityId: item().globalId,
      field: "archived",
    });
    expect(await countSelectedFeedRows(indexedDb, name, "1".repeat(64))).toBe(
      0,
    );

    actor = await readLocalActorEvidence(indexedDb, name, "1".repeat(64));
    await selectCheckpoint({
      acceptedSequence: 1,
      actor,
      authority,
      digestDigit: "2",
      generation: 2,
      item: item(false),
      store,
    });

    expect(await countSelectedFeedRows(indexedDb, name, "2".repeat(64))).toBe(
      0,
    );
    expect(
      (
        await store.readSelectedMaterializedRow(
          "10_feed_items",
          item().globalId,
        )
      )?.userState,
    ).toMatchObject({ archived: true });
  });

  it("uses the targeted RSS membership index to remove only matching materialized items", async () => {
    const indexedDb = new IDBFactory();
    const name = "overlay-rss-index";
    const store = makeStore(indexedDb, name);
    await store.bootstrapFeaturePreviewAuthority();
    const selected = (await store.readSelectedCheckpointReceipt())!;
    const feedUrl = "https://example.test/feed.xml";
    const rssItem = {
      ...item(false),
      globalId: "rss:overlay-item",
      platform: "rss",
      rssSource: {
        feedTitle: "Bounded Feed",
        feedUrl,
        siteUrl: "https://example.test",
      },
    } satisfies FeedItem;
    await store.enqueueRssFeedUpsert({
      enabled: true,
      title: "Bounded Feed",
      trackUnread: false,
      url: feedUrl,
    });
    await store.enqueueFeedItemCaptures([rssItem]);

    const database = await openDatabase(indexedDb, name);
    const transaction = database.transaction(MATERIALIZED_ROWS_STORE);
    expect(
      Array.from(transaction.objectStore(MATERIALIZED_ROWS_STORE).indexNames),
    ).toContain("by_generation_rss_feed");
    await transactionDone(transaction);
    database.close();

    await store.enqueueRssFeedRemove({
      includeItems: true,
      removedAtMs: 1_780_000_000_200,
      url: feedUrl,
    });
    expect(
      await store.readSelectedMaterializedRow(
        "10_feed_items",
        rssItem.globalId,
      ),
    ).toBeNull();
    expect(
      await countSelectedFeedRows(indexedDb, name, selected.generationId),
    ).toBe(0);
  });
});
