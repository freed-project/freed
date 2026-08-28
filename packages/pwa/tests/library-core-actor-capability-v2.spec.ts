import { generateKeyPairSync, sign } from "node:crypto";
import path from "node:path";

import { expect, test } from "@playwright/test";

import { constructLibraryCoreActorCapabilityCertificateV2 } from "../../shared/src/library-core/actor-capability-certificate-v2";
import { constructLibraryCoreActorEnrollmentBodyV1 } from "../../shared/src/library-core/actor-enrollment-contracts";
import { constructLibraryCoreActorEnrollmentCertificateV1 } from "../../shared/src/library-core/actor-enrollment-certificate";
import {
  encodeLibraryCoreCanonicalValue,
  encodeLibraryCoreDigestInput,
} from "../../shared/src/library-core/canonical-codec";
import {
  FEED_ITEM_READ_ASSIGNMENT_TRANSACTION_MEMBER_SCHEMA,
  FEED_ITEM_SAVED_ASSIGNMENT_TRANSACTION_MEMBER_SCHEMA,
} from "../../shared/src/library-core/operation-envelope-contracts";
import { finalizeLibraryCoreTransactionV1 } from "../../shared/src/library-core/operation-envelope-finalization";
import { assembleLibraryCoreTransactionV1 } from "../../shared/src/library-core/operation-transaction-contracts";
import { sha256LowerHex } from "../../shared/src/library-core/sha256";

function publicKeyHex(
  key: ReturnType<typeof generateKeyPairSync>["publicKey"],
) {
  const der = key.export({ format: "der", type: "spki" });
  return der.subarray(der.byteLength - 32).toString("hex");
}

test("PWA persists mixed v1 and v2 enrollments and denies stale, retired, changed, and out-of-scope work with zero writes", async ({
  page,
}) => {
  const authority = generateKeyPairSync("ed25519");
  const legacyActor = generateKeyPairSync("ed25519");
  const capabilityActor = generateKeyPairSync("ed25519");
  const retiredActor = generateKeyPairSync("ed25519");
  const digest = (
    domain: Parameters<typeof encodeLibraryCoreDigestInput>[0],
    value: unknown,
  ) => sha256LowerHex(encodeLibraryCoreDigestInput(domain, value as never));
  const signHex = (
    value: Uint8Array,
    privateKey: ReturnType<typeof generateKeyPairSync>["privateKey"],
  ) => sign(null, value, privateKey).toString("hex");
  const hex = (pair: string) => pair.repeat(32);
  const libraryId = hex("11");
  const epochId = hex("22");
  const authorityPublicKey = publicKeyHex(authority.publicKey);
  const authorityKeyId = digest("authority-key", {
    authority_public_key: authorityPublicKey,
    signature_algorithm: "ed25519",
  });
  const enrollmentBody = (
    actor: typeof legacyActor,
    nonce: string,
    operationId: string,
  ) =>
    constructLibraryCoreActorEnrollmentBodyV1(
      {
        actor_incarnation_nonce: hex(nonce),
        actor_public_key: publicKeyHex(actor.publicKey),
        authority_key_id: authorityKeyId,
        created_at_ms: 1_783_100_000_000,
        epoch: 1,
        epoch_id: epochId,
        installation_incarnation: hex("44"),
        library_id: libraryId,
        observed_frontier: [],
        operation_id: operationId,
      },
      { digest },
    );
  const legacyBody = enrollmentBody(legacyActor, "31", "enroll-legacy");
  const capabilityBody = enrollmentBody(
    capabilityActor,
    "32",
    "enroll-capability",
  );
  const retiredBody = enrollmentBody(retiredActor, "33", "enroll-retired");
  const legacyCertificate =
    await constructLibraryCoreActorEnrollmentCertificateV1(legacyBody, {
      digest,
      signActorProof: async (value) => signHex(value, legacyActor.privateKey),
      signAuthorityCertificate: async (value) =>
        signHex(value, authority.privateKey),
    });
  const capabilityCertificate =
    await constructLibraryCoreActorCapabilityCertificateV2(
      capabilityBody,
      {
        actor_class: "editor",
        allowed_operation_types: ["feed_item_saved_assignment"],
        scope: { mode: "library_wide" },
      },
      {
        digest,
        signActorProof: async (value) =>
          signHex(value, capabilityActor.privateKey),
        signAuthorityCertificate: async (value) =>
          signHex(value, authority.privateKey),
      },
    );
  const changedCapabilityCertificate =
    await constructLibraryCoreActorCapabilityCertificateV2(
      capabilityBody,
      {
        actor_class: "editor",
        allowed_operation_types: ["feed_item_read_assignment"],
        scope: { mode: "library_wide" },
      },
      {
        digest,
        signActorProof: async (value) =>
          signHex(value, capabilityActor.privateKey),
        signAuthorityCertificate: async (value) =>
          signHex(value, authority.privateKey),
      },
    );
  const retiredCertificate =
    await constructLibraryCoreActorCapabilityCertificateV2(
      retiredBody,
      {
        actor_class: "agent",
        allowed_operation_types: ["feed_item_read_assignment"],
        scope: { mode: "library_wide" },
      },
      {
        digest,
        signActorProof: async (value) =>
          signHex(value, retiredActor.privateKey),
        signAuthorityCertificate: async (value) =>
          signHex(value, authority.privateKey),
      },
    );
  const deniedMember =
    FEED_ITEM_READ_ASSIGNMENT_TRANSACTION_MEMBER_SCHEMA.construct(
      {
        actor_id: capabilityBody.body.actor_id,
        actor_sequence: 1,
        causal_frontier: [],
        created_at_ms: 1_783_100_000_100,
        entity_id: "item-1",
        epoch: 1,
        epoch_id: epochId,
        hlc_counter: 0,
        hlc_wall_ms: 1_783_100_000_100,
        library_id: libraryId,
        operation_id: "read-denied-by-capability",
        payload: { read_at_ms: 1_783_100_000_100 },
        previous_actor_operation_id: null,
        transaction_id: "tx-read-denied-by-capability",
        transaction_member_count: 1,
        transaction_member_index: 0,
      },
      { digest },
    );
  const deniedTransaction = await finalizeLibraryCoreTransactionV1(
    assembleLibraryCoreTransactionV1(
      [deniedMember],
      capabilityCertificate.actor_chain_genesis,
      { digest },
    ),
    {
      digest,
      signOperation: async (value) =>
        signHex(value, capabilityActor.privateKey),
    },
  );
  const allowedMember =
    FEED_ITEM_SAVED_ASSIGNMENT_TRANSACTION_MEMBER_SCHEMA.construct(
      {
        actor_id: capabilityBody.body.actor_id,
        actor_sequence: 1,
        causal_frontier: [],
        created_at_ms: 1_783_100_000_200,
        entity_id: "item-1",
        epoch: 1,
        epoch_id: epochId,
        hlc_counter: 0,
        hlc_wall_ms: 1_783_100_000_200,
        library_id: libraryId,
        operation_id: "saved-allowed-by-capability",
        payload: {
          assigned: true,
          assigned_at_ms: 1_783_100_000_200,
        },
        previous_actor_operation_id: null,
        transaction_id: "tx-saved-allowed-by-capability",
        transaction_member_count: 1,
        transaction_member_index: 0,
      },
      { digest },
    );
  const allowedTransaction = await finalizeLibraryCoreTransactionV1(
    assembleLibraryCoreTransactionV1(
      [allowedMember],
      capabilityCertificate.actor_chain_genesis,
      { digest },
    ),
    {
      digest,
      signOperation: async (value) =>
        signHex(value, capabilityActor.privateKey),
    },
  );
  const actors = [
    {
      actorId: legacyBody.body.actor_id,
      chainGenesis: legacyCertificate.actor_chain_genesis,
      certificateDigest: legacyCertificate.certificate.certificate_digest,
      retired: false,
    },
    {
      actorId: capabilityBody.body.actor_id,
      chainGenesis: capabilityCertificate.actor_chain_genesis,
      certificateDigest: capabilityCertificate.certificate.certificate_digest,
      retired: false,
    },
    {
      actorId: retiredBody.body.actor_id,
      chainGenesis: retiredCertificate.actor_chain_genesis,
      certificateDigest: retiredCertificate.certificate.certificate_digest,
      retired: true,
    },
  ].sort((left, right) => left.actorId.localeCompare(right.actorId));
  const sharedModuleUrl = `/@fs${path.resolve(
    process.cwd(),
    "../shared/src/library-core/index.ts",
  )}`;
  const fixture = {
    allowedCanonicalEnvelopeJson: new TextDecoder().decode(
      encodeLibraryCoreCanonicalValue(
        allowedTransaction.members[0]!.envelope as never,
      ),
    ),
    actors,
    authorityKeyId,
    authorityPublicKey,
    capabilityActorId: capabilityBody.body.actor_id,
    capabilityCertificateDigest:
      capabilityCertificate.certificate.certificate_digest,
    capabilityChainGenesis: capabilityCertificate.actor_chain_genesis,
    capabilityBytes: Array.from(
      encodeLibraryCoreCanonicalValue(
        capabilityCertificate.certificate as never,
      ),
    ),
    changedCapabilityBytes: Array.from(
      encodeLibraryCoreCanonicalValue(
        changedCapabilityCertificate.certificate as never,
      ),
    ),
    deniedCanonicalEnvelopeJson: new TextDecoder().decode(
      encodeLibraryCoreCanonicalValue(
        deniedTransaction.members[0]!.envelope as never,
      ),
    ),
    epochId,
    legacyActorId: legacyBody.body.actor_id,
    legacyBytes: Array.from(
      encodeLibraryCoreCanonicalValue(legacyCertificate.certificate as never),
    ),
    libraryId,
    retiredActorId: retiredBody.body.actor_id,
    retiredBytes: Array.from(
      encodeLibraryCoreCanonicalValue(retiredCertificate.certificate as never),
    ),
    sharedModuleUrl,
  };

  await page.goto("/favicon.svg");
  const result = await page.evaluate(async (fixture) => {
    const shared = await import(fixture.sharedModuleUrl);
    const { createPwaLibraryCorePortableCheckpointStore } =
      await import("/src/lib/library-core-portable-checkpoint-store.ts");
    const {
      importLibraryCoreOperationSegmentV1,
      prepareLibraryCoreOperationSegmentV1,
    } = await import("/src/lib/library-core-operation-segment-runtime.ts");
    const hex = (pair: string) => pair.repeat(32);
    const databaseName = `freed-library-core-capability-${crypto.randomUUID()}`;
    let raceMutation: (() => Promise<void>) | null = null;
    const racingSubtle = new Proxy(crypto.subtle, {
      get(target, property) {
        if (property === "verify") {
          return async (...arguments_: Parameters<SubtleCrypto["verify"]>) => {
            const mutation = raceMutation;
            raceMutation = null;
            if (mutation) await mutation();
            return target.verify(...arguments_);
          };
        }
        const value = Reflect.get(target, property, target);
        return typeof value === "function" ? value.bind(target) : value;
      },
    }) as SubtleCrypto;
    const mutateCapabilityTip = async (
      patch: (tip: Record<string, unknown>) => Record<string, unknown>,
    ) => {
      const database = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open(databaseName);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      const transaction = database.transaction(
        "portable_actor_tips",
        "readwrite",
      );
      const store = transaction.objectStore("portable_actor_tips");
      const records = await new Promise<Record<string, unknown>[]>(
        (resolve, reject) => {
          const request = store.getAll();
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(request.error);
        },
      );
      const tip = records.find(
        (record) => record.actorId === fixture.capabilityActorId,
      );
      if (!tip) throw new Error("capability actor tip is absent");
      store.put(patch(tip));
      await new Promise<void>((resolve, reject) => {
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error);
        transaction.onabort = () => reject(transaction.error);
      });
      database.close();
    };
    const mutateSelectedGeneration = async (
      patch: (generation: Record<string, unknown>) => Record<string, unknown>,
    ) => {
      const database = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open(databaseName);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      const transaction = database.transaction(
        "portable_generations",
        "readwrite",
      );
      const store = transaction.objectStore("portable_generations");
      const records = await new Promise<Record<string, unknown>[]>(
        (resolve, reject) => {
          const request = store.getAll();
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(request.error);
        },
      );
      const generation = records.find((record) => record.status === "complete");
      if (!generation) throw new Error("selected generation is absent");
      store.put(patch(generation));
      await new Promise<void>((resolve, reject) => {
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error);
        transaction.onabort = () => reject(transaction.error);
      });
      database.close();
      return generation;
    };
    const manifestDigest = hex("aa");
    const manifestReference = {
      descriptor: {
        byteLength: 1,
        contentDigest: manifestDigest,
        objectKey: `freed-v2-manifest~${fixture.libraryId}~e${fixture.epochId}~g1~${manifestDigest}.json`,
      },
      transportObjectId: "drive-manifest-capability",
    };
    const manifest = {
      causalFrontierDigest: hex("01"),
      datasetSchemaId: "library_core_logical_checkpoint_v1",
      generation: 1,
      kind: "checkpoint_manifest",
      libraryId: fixture.libraryId,
      pages: [
        {
          firstRecordIdentity: "00:header",
          lastRecordIdentity: `06:${fixture.actors.at(-1)!.actorId}`,
          object: {
            descriptor: {
              byteLength: 1,
              contentDigest: hex("bb"),
              objectKey: `freed-v2-checkpoint~${fixture.libraryId}~e${fixture.epochId}~g1~p0~${hex("bb")}.fpage.gz`,
            },
            transportObjectId: "drive-page-capability",
          },
          pageIndex: 0,
          recordCount: 5,
        },
      ],
      protocolVersion: 1,
      schemaVersion: 1,
      storageEpoch: fixture.epochId,
      totalRecordCount: 5,
    } as const;
    const authorityState = {
      authority_key_id: fixture.authorityKeyId,
      authority_public_key: fixture.authorityPublicKey,
      epoch: 1,
      epoch_id: fixture.epochId,
      library_id: fixture.libraryId,
      observed_frontier: [],
    } as const;
    const header = {
      anchor_kind: "accepted_authority",
      accepted_authority: authorityState,
      canonical_codec_version: 1,
      collection_counts: {
        accepted_frontier: 0,
        actor_states: 3,
        blob_roots: 0,
        excluded_registry_keys: 0,
        field_clocks: 0,
        materialized_rows: 1,
        quarantined_frontier: 0,
        receipt_records: 0,
        relationships: 0,
        tombstones: 0,
      },
      epoch: 1,
      epoch_id: fixture.epochId,
      field_registry_version: 1,
      format: "freed_logical_checkpoint_v1",
      kind: "logical_checkpoint_header",
      library_id: fixture.libraryId,
      materializer_position: {
        frontier_digest: hex("01"),
        ingest_sequence: 0,
        materialized_digest: hex("03"),
      },
      promoted_receipt_digests: [],
      schema_version: 1,
      source_manifest_digest: hex("04"),
      source_transition_digest: hex("05"),
      transition_candidate_anchor: null,
    } as const;
    const materializedRow = {
      collection: "materialized_rows",
      kind: "logical_checkpoint_entry",
      ordinal: 0,
      value: {
        primary_key: "item-1",
        registry_key: "10_feed_items",
        row: {
          globalId: "item-1",
          publishedAt: 200,
          userState: { readAt: null, saved: false },
        },
      },
    } as const;
    const actorRows = fixture.actors.map((actor, ordinal) => ({
      collection: "actor_states" as const,
      kind: "logical_checkpoint_entry" as const,
      ordinal,
      value: {
        accepted_chain_digest: actor.chainGenesis,
        accepted_operation_id: null,
        accepted_sequence: 0,
        actor_id: actor.actorId,
        enrollment_certificate_digest: actor.certificateDigest,
        retired: actor.retired,
        retirement_certificate_digest: actor.retired ? hex("99") : null,
      },
    }));
    let store = createPwaLibraryCorePortableCheckpointStore({
      databaseName,
      indexedDb: indexedDB,
      keyRange: IDBKeyRange,
      subtle: racingSubtle,
    });
    await store.beginImport({ manifest, manifestReference });
    await store.appendPage(0, [header, materializedRow, ...actorRows]);
    await store.finalizeImport({ header, manifest, manifestReference });
    const legacyInstalled = await store.installActorEnrollment({
      acceptedAuthorityState: authorityState,
      certificateBytes: new Uint8Array(fixture.legacyBytes),
    });
    const mutableCapabilityBytes = new Uint8Array(fixture.capabilityBytes);
    raceMutation = async () => {
      mutableCapabilityBytes.fill(0);
    };
    const capabilityInstalled = await store.installActorEnrollment({
      acceptedAuthorityState: authorityState,
      certificateBytes: mutableCapabilityBytes,
    });
    const certificateInputWasMutated = mutableCapabilityBytes.every(
      (byte) => byte === 0,
    );
    let changedError = "";
    try {
      await store.installActorEnrollment({
        acceptedAuthorityState: authorityState,
        certificateBytes: new Uint8Array(fixture.changedCapabilityBytes),
      });
    } catch (error) {
      changedError = error instanceof Error ? error.message : String(error);
    }
    let retiredError = "";
    try {
      await store.installActorEnrollment({
        acceptedAuthorityState: authorityState,
        certificateBytes: new Uint8Array(fixture.retiredBytes),
      });
    } catch (error) {
      retiredError = error instanceof Error ? error.message : String(error);
    }
    let staleError = "";
    try {
      await store.installActorEnrollment({
        acceptedAuthorityState: {
          ...authorityState,
          epoch: 2,
          epoch_id: hex("77"),
        },
        certificateBytes: new Uint8Array(fixture.legacyBytes),
      });
    } catch (error) {
      staleError = error instanceof Error ? error.message : String(error);
    }
    await store.quiesce();
    store = createPwaLibraryCorePortableCheckpointStore({
      databaseName,
      indexedDb: indexedDB,
      keyRange: IDBKeyRange,
      subtle: racingSubtle,
    });
    const capabilityAfterRestart = await store.installActorEnrollment({
      acceptedAuthorityState: authorityState,
      certificateBytes: new Uint8Array(fixture.capabilityBytes),
    });
    const localMember =
      shared.FEED_ITEM_READ_ASSIGNMENT_TRANSACTION_MEMBER_SCHEMA.construct(
        {
          actor_id: fixture.capabilityActorId,
          actor_sequence: 1,
          causal_frontier: [],
          created_at_ms: 1_783_100_000_100,
          entity_id: "item-1",
          epoch: 1,
          epoch_id: fixture.epochId,
          hlc_counter: 0,
          hlc_wall_ms: 1_783_100_000_100,
          library_id: fixture.libraryId,
          operation_id: "local-read-denied-by-capability",
          payload: { read_at_ms: 1_783_100_000_100 },
          previous_actor_operation_id: null,
          transaction_id: "tx-local-read-denied-by-capability",
          transaction_member_count: 1,
          transaction_member_index: 0,
        },
        {
          digest: (domain: string, value: unknown) =>
            shared.sha256LowerHex(
              shared.encodeLibraryCoreDigestInput(domain, value),
            ),
        },
      );
    const localDeniedTransaction =
      await shared.finalizeLibraryCoreTransactionV1(
        shared.assembleLibraryCoreTransactionV1(
          [localMember],
          fixture.capabilityChainGenesis,
          {
            digest: (domain: string, value: unknown) =>
              shared.sha256LowerHex(
                shared.encodeLibraryCoreDigestInput(domain, value),
              ),
          },
        ),
        {
          digest: (domain: string, value: unknown) =>
            shared.sha256LowerHex(
              shared.encodeLibraryCoreDigestInput(domain, value),
            ),
          async signOperation() {
            return "55".repeat(64);
          },
        },
      );
    let localScopeError = "";
    try {
      await store.enqueueIntentTransaction(localDeniedTransaction);
    } catch (error) {
      localScopeError = error instanceof Error ? error.message : String(error);
    }
    const intentActorsAfterLocalDenial = await store.readIntentActors({
      epochId: fixture.epochId,
      libraryId: fixture.libraryId,
    });
    const allowedMember =
      shared.FEED_ITEM_SAVED_ASSIGNMENT_TRANSACTION_MEMBER_SCHEMA.construct(
        {
          actor_id: fixture.capabilityActorId,
          actor_sequence: 1,
          causal_frontier: [],
          created_at_ms: 1_783_100_000_200,
          entity_id: "item-1",
          epoch: 1,
          epoch_id: fixture.epochId,
          hlc_counter: 0,
          hlc_wall_ms: 1_783_100_000_200,
          library_id: fixture.libraryId,
          operation_id: "saved-allowed-by-capability",
          payload: {
            assigned: true,
            assigned_at_ms: 1_783_100_000_200,
          },
          previous_actor_operation_id: null,
          transaction_id: "tx-saved-allowed-by-capability",
          transaction_member_count: 1,
          transaction_member_index: 0,
        },
        {
          digest: (domain: string, value: unknown) =>
            shared.sha256LowerHex(
              shared.encodeLibraryCoreDigestInput(domain, value),
            ),
        },
      );
    const allowedTransaction = await shared.finalizeLibraryCoreTransactionV1(
      shared.assembleLibraryCoreTransactionV1(
        [allowedMember],
        fixture.capabilityChainGenesis,
        {
          digest: (domain: string, value: unknown) =>
            shared.sha256LowerHex(
              shared.encodeLibraryCoreDigestInput(domain, value),
            ),
        },
      ),
      {
        digest: (domain: string, value: unknown) =>
          shared.sha256LowerHex(
            shared.encodeLibraryCoreDigestInput(domain, value),
          ),
        async signOperation() {
          return "55".repeat(64);
        },
      },
    );
    let admittedGenerationSnapshot: Record<string, unknown> | null = null;
    raceMutation = async () => {
      admittedGenerationSnapshot = await mutateSelectedGeneration(
        (generation) => ({
          ...generation,
          header: {
            ...(generation.header as Record<string, unknown>),
            accepted_authority: {
              ...authorityState,
              observed_frontier: [
                {
                  actor_id: hex("91"),
                  chain_digest: hex("92"),
                  operation_id: "authority-race",
                  sequence: 1,
                },
              ],
            },
          },
          headerDigest: hex("93"),
        }),
      );
    };
    let generationAuthorityRaceError = "";
    let generationAuthorityRaceReceiptReturned = false;
    try {
      await store.enqueueIntentTransaction(allowedTransaction);
      generationAuthorityRaceReceiptReturned = true;
    } catch (error) {
      generationAuthorityRaceError =
        error instanceof Error ? error.message : String(error);
    }
    const intentActorsAfterGenerationAuthorityRace =
      await store.readIntentActors({
        epochId: fixture.epochId,
        libraryId: fixture.libraryId,
      });
    if (!admittedGenerationSnapshot) {
      throw new Error(
        "generation authority race did not mutate the checkpoint",
      );
    }
    const generationToRestore = admittedGenerationSnapshot;
    await mutateSelectedGeneration(() => generationToRestore);
    const allowedReceipt =
      await store.enqueueIntentTransaction(allowedTransaction);
    const allowedPrepared = await prepareLibraryCoreOperationSegmentV1({
      baseFrontierDigest: hex("01"),
      entries: [
        {
          canonicalEnvelopeJson: fixture.allowedCanonicalEnvelopeJson,
          ingestSequence: 1,
          operationId: "saved-allowed-by-capability",
        },
      ],
      epoch: 1,
      epochId: fixture.epochId,
      libraryId: fixture.libraryId,
      previousSegmentDigest: null,
      resultFrontierDigest: hex("02"),
      schemaVersion: 1,
      subtle: crypto.subtle,
    });
    let callerEnvelopeWasMutated = false;
    const importAllowed = (mutateEnvelopeDuringVerification = false) =>
      importLibraryCoreOperationSegmentV1({
        adapter: {
          async readImmutable() {
            return allowedPrepared.object.source.slice();
          },
        },
        expectedBaseFrontierDigest: hex("01"),
        expectedFirstIngestSequence: 1,
        expectedPreviousSegmentDigest: null,
        libraryId: fixture.libraryId,
        reference: {
          descriptor: allowedPrepared.object.descriptor,
          transportObjectId: "drive-allowed-capability-operation",
        },
        storageEpoch: fixture.epochId,
        subtle: crypto.subtle,
        writer: {
          appendOperationSegment: (input) => {
            if (mutateEnvelopeDuringVerification) {
              raceMutation = async () => {
                const envelope = input.entries[0]!.canonical_envelope as Record<
                  string,
                  unknown
                >;
                const payload = envelope.payload as Record<string, unknown>;
                payload.assigned = false;
                callerEnvelopeWasMutated = true;
              };
            }
            return store.appendAuthenticatedOperationSegment(input);
          },
        },
      });
    const authenticatedOperationCount = async () => {
      const database = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open(databaseName);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      const transaction = database.transaction(
        "portable_authenticated_operations",
        "readonly",
      );
      const count = await new Promise<number>((resolve, reject) => {
        const request = transaction
          .objectStore("portable_authenticated_operations")
          .count();
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      database.close();
      return count;
    };
    const runAdmissionRace = async (mutation: () => Promise<void>) => {
      raceMutation = mutation;
      let error = "";
      let receiptReturned = false;
      try {
        await importAllowed();
        receiptReturned = true;
      } catch (cause) {
        error = cause instanceof Error ? cause.message : String(cause);
      }
      return {
        authenticatedOperationCount: await authenticatedOperationCount(),
        error,
        receiptReturned,
      };
    };
    const retireTip = () =>
      mutateCapabilityTip((tip) => ({ ...tip, retired: true }));
    const changeTip = () =>
      mutateCapabilityTip((tip) => ({
        ...tip,
        enrollmentCertificateDigest: hex("88"),
      }));
    const restoreTip = () =>
      mutateCapabilityTip((tip) => ({
        ...tip,
        enrollmentCertificateDigest: fixture.capabilityCertificateDigest,
        retired: false,
      }));
    const freshRetirementRace = await runAdmissionRace(retireTip);
    await restoreTip();
    const freshChangedTipRace = await runAdmissionRace(changeTip);
    await restoreTip();
    const allowedImported = await importAllowed(true);
    const replayRetirementRace = await runAdmissionRace(retireTip);
    await restoreTip();
    const replayChangedTipRace = await runAdmissionRace(changeTip);
    await restoreTip();
    const prepared = await prepareLibraryCoreOperationSegmentV1({
      baseFrontierDigest: hex("02"),
      entries: [
        {
          canonicalEnvelopeJson: fixture.deniedCanonicalEnvelopeJson,
          ingestSequence: 2,
          operationId: "read-denied-by-capability",
        },
      ],
      epoch: 1,
      epochId: fixture.epochId,
      libraryId: fixture.libraryId,
      previousSegmentDigest: allowedPrepared.header.segment_digest,
      resultFrontierDigest: hex("03"),
      schemaVersion: 1,
      subtle: crypto.subtle,
    });
    let importedScopeError = "";
    try {
      await importLibraryCoreOperationSegmentV1({
        adapter: {
          async readImmutable() {
            return prepared.object.source.slice();
          },
        },
        expectedBaseFrontierDigest: hex("02"),
        expectedFirstIngestSequence: 2,
        expectedPreviousSegmentDigest: allowedPrepared.header.segment_digest,
        libraryId: fixture.libraryId,
        reference: {
          descriptor: prepared.object.descriptor,
          transportObjectId: "drive-denied-capability-operation",
        },
        storageEpoch: fixture.epochId,
        subtle: crypto.subtle,
        writer: {
          appendOperationSegment: (input) =>
            store.appendAuthenticatedOperationSegment(input),
        },
      });
    } catch (error) {
      importedScopeError =
        error instanceof Error ? error.message : String(error);
    }
    const intentActorsAfterDenial = await store.readIntentActors({
      epochId: fixture.epochId,
      libraryId: fixture.libraryId,
    });
    await store.quiesce();
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(databaseName);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const read = database.transaction(
      ["portable_actor_enrollments", "portable_authenticated_operations"],
      "readonly",
    );
    type StoredEnrollment = Record<string, unknown> & {
      actorId: string;
      schemaVersion?: number;
    };
    const storedEnrollments = await new Promise<StoredEnrollment[]>(
      (resolve, reject) => {
        const request = read.objectStore("portable_actor_enrollments").getAll();
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      },
    );
    const authenticatedCount = await new Promise<number>((resolve, reject) => {
      const request = read
        .objectStore("portable_authenticated_operations")
        .count();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const authenticatedRecords = await new Promise<
      Array<Record<string, unknown>>
    >((resolve, reject) => {
      const request = read
        .objectStore("portable_authenticated_operations")
        .getAll();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    await new Promise<void>((resolve, reject) => {
      read.oncomplete = () => resolve();
      read.onerror = () => reject(read.error);
      read.onabort = () => reject(read.error);
    });
    const capabilityRecord = storedEnrollments.find(
      (record) => record.actorId === fixture.capabilityActorId,
    );
    const legacyRecord = storedEnrollments.find(
      (record) => record.actorId === fixture.legacyActorId,
    );
    if (!capabilityRecord || !legacyRecord) {
      throw new Error("mixed enrollment records were not preserved");
    }
    database.close();
    const writeEnrollment = async (record: StoredEnrollment) => {
      const target = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open(databaseName);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      const transaction = target.transaction(
        "portable_actor_enrollments",
        "readwrite",
      );
      transaction.objectStore("portable_actor_enrollments").put(record);
      await new Promise<void>((resolve, reject) => {
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error);
        transaction.onabort = () => reject(transaction.error);
      });
      target.close();
    };
    const exerciseMalformedEnrollment = async (record: StoredEnrollment) => {
      await writeEnrollment(record);
      store = createPwaLibraryCorePortableCheckpointStore({
        databaseName,
        indexedDb: indexedDB,
        keyRange: IDBKeyRange,
        subtle: racingSubtle,
      });
      let localError = "";
      let importedError = "";
      let importedReceiptReturned = false;
      try {
        await store.enqueueIntentTransaction(localDeniedTransaction);
      } catch (error) {
        localError = error instanceof Error ? error.message : String(error);
      }
      try {
        await importLibraryCoreOperationSegmentV1({
          adapter: {
            async readImmutable() {
              return prepared.object.source.slice();
            },
          },
          expectedBaseFrontierDigest: hex("02"),
          expectedFirstIngestSequence: 2,
          expectedPreviousSegmentDigest: allowedPrepared.header.segment_digest,
          libraryId: fixture.libraryId,
          reference: {
            descriptor: prepared.object.descriptor,
            transportObjectId: "drive-malformed-capability-operation",
          },
          storageEpoch: fixture.epochId,
          subtle: crypto.subtle,
          writer: {
            appendOperationSegment: (input) =>
              store.appendAuthenticatedOperationSegment(input),
          },
        });
        importedReceiptReturned = true;
      } catch (error) {
        importedError = error instanceof Error ? error.message : String(error);
      }
      const intentActors = await store.readIntentActors({
        epochId: fixture.epochId,
        libraryId: fixture.libraryId,
      });
      const operationCount = await authenticatedOperationCount();
      await store.quiesce();
      return {
        importedError,
        importedReceiptReturned,
        intentActors,
        localError,
        operationCount,
      };
    };
    const strippedSchemaVersion = { ...capabilityRecord };
    delete strippedSchemaVersion.schemaVersion;
    const strippedSchemaResult = await exerciseMalformedEnrollment(
      strippedSchemaVersion as StoredEnrollment,
    );
    const hybridRecord = { ...capabilityRecord };
    delete hybridRecord.canonicalCertificateBytes;
    const hybridResult = await exerciseMalformedEnrollment(
      hybridRecord as StoredEnrollment,
    );
    await writeEnrollment(capabilityRecord);
    const changedCapabilityRecord = {
      ...capabilityRecord,
      capability: {
        ...(capabilityRecord.capability as Record<string, unknown>),
        allowed_operation_types: [
          "feed_item_read_assignment",
          "feed_item_saved_assignment",
        ],
      },
    };
    await writeEnrollment(changedCapabilityRecord);
    store = createPwaLibraryCorePortableCheckpointStore({
      databaseName,
      indexedDb: indexedDB,
      keyRange: IDBKeyRange,
      subtle: racingSubtle,
    });
    let changedPersistedError = "";
    try {
      await store.enqueueIntentTransaction(localDeniedTransaction);
    } catch (error) {
      changedPersistedError =
        error instanceof Error ? error.message : String(error);
    }
    const intentActorsAfterChangedPersistence = await store.readIntentActors({
      epochId: fixture.epochId,
      libraryId: fixture.libraryId,
    });
    await store.quiesce();
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.deleteDatabase(databaseName);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
    return {
      authenticatedCount,
      allowedImported,
      allowedReceipt,
      capabilityAfterRestart,
      capabilityInstalled,
      callerEnvelopeWasMutated,
      certificateInputWasMutated,
      storedCertificateBytes: Array.from(
        capabilityRecord.canonicalCertificateBytes as Uint8Array,
      ),
      capabilitySchemaVersion: capabilityRecord.schemaVersion,
      changedError,
      changedPersistedError,
      enrollmentCount: storedEnrollments.length,
      importedScopeError,
      persistedAssignedValue:
        (
          (authenticatedRecords[0]!.entry as Record<string, unknown>)
            .canonical_envelope as Record<string, unknown>
        ).payload &&
        (
          (
            (authenticatedRecords[0]!.entry as Record<string, unknown>)
              .canonical_envelope as Record<string, unknown>
          ).payload as Record<string, unknown>
        ).assigned,
      freshChangedTipRace,
      freshRetirementRace,
      generationAuthorityRaceError,
      generationAuthorityRaceReceiptReturned,
      intentActorsAfterChangedPersistence,
      intentActorsAfterDenial,
      intentActorsAfterGenerationAuthorityRace,
      intentActorsAfterLocalDenial,
      legacyHasSchemaVersion: Object.prototype.hasOwnProperty.call(
        legacyRecord,
        "schemaVersion",
      ),
      legacyInstalled,
      localScopeError,
      hybridResult,
      replayChangedTipRace,
      replayRetirementRace,
      retiredError,
      staleError,
      strippedSchemaResult,
    };
  }, fixture);

  expect(result).toMatchObject({
    authenticatedCount: 1,
    allowedImported: {
      firstIngestSequence: 1,
      lastIngestSequence: 1,
    },
    allowedReceipt: {
      operationCount: 1,
      status: "enqueued",
    },
    capabilityAfterRestart: "already_installed",
    capabilityInstalled: "installed",
    callerEnvelopeWasMutated: true,
    certificateInputWasMutated: true,
    capabilitySchemaVersion: 2,
    enrollmentCount: 2,
    intentActorsAfterLocalDenial: [],
    legacyHasSchemaVersion: false,
    legacyInstalled: "installed",
  });
  expect(result.storedCertificateBytes).toEqual(fixture.capabilityBytes);
  expect(result.persistedAssignedValue).toBe(true);
  expect(result.changedError).toMatch(/active checkpoint actor/);
  expect(result.retiredError).toMatch(/active checkpoint actor/);
  expect(result.staleError).toMatch(/accepted authority/);
  expect(result.localScopeError).toMatch(/capability denies/);
  expect(result.generationAuthorityRaceError).toMatch(
    /capability changed before durable admission/,
  );
  expect(result.generationAuthorityRaceReceiptReturned).toBe(false);
  expect(result.intentActorsAfterGenerationAuthorityRace).toEqual([]);
  expect(result.importedScopeError).toMatch(/capability denies/);
  for (const race of [
    result.freshRetirementRace,
    result.freshChangedTipRace,
    result.replayRetirementRace,
    result.replayChangedTipRace,
  ]) {
    expect(race.error).toMatch(/changed.*verification/);
    expect(race.receiptReturned).toBe(false);
  }
  expect(result.freshRetirementRace.authenticatedOperationCount).toBe(0);
  expect(result.freshChangedTipRace.authenticatedOperationCount).toBe(0);
  expect(result.replayRetirementRace.authenticatedOperationCount).toBe(1);
  expect(result.replayChangedTipRace.authenticatedOperationCount).toBe(1);
  for (const malformed of [result.strippedSchemaResult, result.hybridResult]) {
    expect(malformed.localError).toMatch(/unsupported schema or shape/);
    expect(malformed.importedError).toMatch(/unsupported schema or shape/);
    expect(malformed.importedReceiptReturned).toBe(false);
    expect(malformed.operationCount).toBe(1);
    expect(malformed.intentActors).toEqual(result.intentActorsAfterDenial);
  }
  expect(result.changedPersistedError).toMatch(/verified certificate/);
  expect(result.intentActorsAfterDenial).toHaveLength(1);
  expect(result.intentActorsAfterChangedPersistence).toEqual(
    result.intentActorsAfterDenial,
  );
});

test("IndexedDB v8 to v9 preserves legacy enrollment bytes and makes the rollback boundary explicit", async ({
  page,
}) => {
  await page.goto("/favicon.svg");
  const result = await page.evaluate(async () => {
    const { createPwaLibraryCorePortableCheckpointStore } =
      await import("/src/lib/library-core-portable-checkpoint-store.ts");
    const hex = (pair: string) => pair.repeat(32);
    const databaseName = `freed-library-core-v8-migration-${crypto.randomUUID()}`;
    const legacyRecord = {
      actorChainGenesis: hex("11"),
      actorId: hex("22"),
      actorPublicKey: hex("33"),
      certificateDigest: hex("44"),
      generationId: hex("55"),
    };
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.open(databaseName, 8);
      request.onupgradeneeded = () => {
        request.result
          .createObjectStore("portable_actor_enrollments", {
            keyPath: ["generationId", "actorId"],
          })
          .add(legacyRecord);
      };
      request.onsuccess = () => {
        request.result.close();
        resolve();
      };
      request.onerror = () => reject(request.error);
    });
    const before = JSON.stringify(legacyRecord);
    const store = createPwaLibraryCorePortableCheckpointStore({
      databaseName,
      indexedDb: indexedDB,
      keyRange: IDBKeyRange,
      subtle: crypto.subtle,
    });
    await store.readIntentActors({ epochId: hex("66"), libraryId: hex("77") });
    await store.quiesce();
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(databaseName);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const read = database.transaction("portable_actor_enrollments", "readonly");
    const migrated = await new Promise<Record<string, unknown>>(
      (resolve, reject) => {
        const request = read
          .objectStore("portable_actor_enrollments")
          .get([legacyRecord.generationId, legacyRecord.actorId]);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      },
    );
    await new Promise<void>((resolve, reject) => {
      read.oncomplete = () => resolve();
      read.onerror = () => reject(read.error);
      read.onabort = () => reject(read.error);
    });
    const version = database.version;
    database.close();
    let rollbackErrorName = "";
    await new Promise<void>((resolve) => {
      const request = indexedDB.open(databaseName, 8);
      request.onsuccess = () => {
        request.result.close();
        resolve();
      };
      request.onerror = () => {
        rollbackErrorName = request.error?.name ?? "unknown";
        resolve();
      };
    });
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.deleteDatabase(databaseName);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
    return {
      after: JSON.stringify(migrated),
      before,
      rollbackErrorName,
      version,
    };
  });

  expect(result.version).toBe(9);
  expect(result.after).toBe(result.before);
  expect(result.rollbackErrorName).toBe("VersionError");
});
