import { generateKeyPairSync, sign } from "node:crypto";
import { expect, test } from "@playwright/test";

import {
  constructLibraryCoreActorEnrollmentBodyV1,
} from "../../shared/src/library-core/actor-enrollment-contracts";
import {
  constructLibraryCoreActorEnrollmentCertificateV1,
} from "../../shared/src/library-core/actor-enrollment-certificate";
import {
  encodeLibraryCoreCanonicalValue,
  encodeLibraryCoreDigestInput,
} from "../../shared/src/library-core/canonical-codec";
import {
  FEED_ITEM_READ_ASSIGNMENT_TRANSACTION_MEMBER_SCHEMA,
} from "../../shared/src/library-core/operation-envelope-contracts";
import {
  finalizeLibraryCoreTransactionV1,
} from "../../shared/src/library-core/operation-envelope-finalization";
import {
  assembleLibraryCoreTransactionV1,
} from "../../shared/src/library-core/operation-transaction-contracts";
import { sha256LowerHex } from "../../shared/src/library-core/sha256";

function publicKeyHex(key: ReturnType<typeof generateKeyPairSync>["publicKey"]) {
  const der = key.export({ format: "der", type: "spki" });
  return der.subarray(der.byteLength - 32).toString("hex");
}

test("PWA admits only enrolled signed operations and atomically materializes read state", async ({
  page,
}) => {
  const authority = generateKeyPairSync("ed25519");
  const actor = generateKeyPairSync("ed25519");
  const digest = (domain: Parameters<typeof encodeLibraryCoreDigestInput>[0], value: unknown) =>
    sha256LowerHex(encodeLibraryCoreDigestInput(domain, value as never));
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
  const enrollmentBody = constructLibraryCoreActorEnrollmentBodyV1(
    {
      actor_incarnation_nonce: hex("33"),
      actor_public_key: publicKeyHex(actor.publicKey),
      authority_key_id: authorityKeyId,
      created_at_ms: 1_783_000_000_000,
      epoch: 1,
      epoch_id: epochId,
      installation_incarnation: hex("44"),
      library_id: libraryId,
      observed_frontier: [],
      operation_id: "enroll-desktop-writer",
    },
    { digest },
  );
  const enrollment = await constructLibraryCoreActorEnrollmentCertificateV1(
    enrollmentBody,
    {
      digest,
      signActorProof: async (value) => signHex(value, actor.privateKey),
      signAuthorityCertificate: async (value) =>
        signHex(value, authority.privateKey),
    },
  );
  const member = FEED_ITEM_READ_ASSIGNMENT_TRANSACTION_MEMBER_SCHEMA.construct(
    {
      actor_id: enrollmentBody.body.actor_id,
      actor_sequence: 1,
      causal_frontier: [],
      created_at_ms: 1_783_000_000_100,
      entity_id: "item-1",
      epoch: 1,
      epoch_id: epochId,
      hlc_counter: 0,
      hlc_wall_ms: 1_783_000_000_100,
      library_id: libraryId,
      operation_id: "read-item-1",
      payload: { read_at_ms: 1_783_000_000_050 },
      previous_actor_operation_id: null,
      transaction_id: "tx-read-item-1",
      transaction_member_count: 1,
      transaction_member_index: 0,
    },
    { digest },
  );
  const assembled = assembleLibraryCoreTransactionV1(
    [member],
    enrollment.actor_chain_genesis,
    { digest },
  );
  const finalized = await finalizeLibraryCoreTransactionV1(assembled, {
    digest,
    signOperation: async (value) => signHex(value, actor.privateKey),
  });
  const secondMember =
    FEED_ITEM_READ_ASSIGNMENT_TRANSACTION_MEMBER_SCHEMA.construct(
      {
        actor_id: enrollmentBody.body.actor_id,
        actor_sequence: 2,
        causal_frontier: [],
        created_at_ms: 1_783_000_000_200,
        entity_id: "item-1",
        epoch: 1,
        epoch_id: epochId,
        hlc_counter: 0,
        hlc_wall_ms: 1_783_000_000_200,
        library_id: libraryId,
        operation_id: "read-item-1-corrupt",
        payload: { read_at_ms: 1_783_000_000_025 },
        previous_actor_operation_id: "read-item-1",
        transaction_id: "tx-read-item-1-corrupt",
        transaction_member_count: 1,
        transaction_member_index: 0,
      },
      { digest },
    );
  const secondAssembled = assembleLibraryCoreTransactionV1(
    [secondMember],
    finalized.members[0]!.envelope.actor_chain_digest,
    { digest },
  );
  const secondFinalized = await finalizeLibraryCoreTransactionV1(
    secondAssembled,
    {
      digest,
      signOperation: async (value) => signHex(value, actor.privateKey),
    },
  );
  const unknownCausalMember =
    FEED_ITEM_READ_ASSIGNMENT_TRANSACTION_MEMBER_SCHEMA.construct(
      {
        actor_id: enrollmentBody.body.actor_id,
        actor_sequence: 2,
        causal_frontier: [
          {
            actor_id: hex("99"),
            chain_digest: hex("98"),
            operation_id: "unknown-causal-operation",
            sequence: 1,
          },
        ],
        created_at_ms: 1_783_000_000_300,
        entity_id: "item-1",
        epoch: 1,
        epoch_id: epochId,
        hlc_counter: 0,
        hlc_wall_ms: 1_783_000_000_300,
        library_id: libraryId,
        operation_id: "read-item-1-unknown-causal",
        payload: { read_at_ms: 1_783_000_000_010 },
        previous_actor_operation_id: "read-item-1",
        transaction_id: "tx-read-item-1-unknown-causal",
        transaction_member_count: 1,
        transaction_member_index: 0,
      },
      { digest },
    );
  const unknownCausalFinalized = await finalizeLibraryCoreTransactionV1(
    assembleLibraryCoreTransactionV1(
      [unknownCausalMember],
      finalized.members[0]!.envelope.actor_chain_digest,
      { digest },
    ),
    {
      digest,
      signOperation: async (value) => signHex(value, actor.privateKey),
    },
  );
  const certificateBytes = encodeLibraryCoreCanonicalValue(
    enrollment.certificate as never,
  );
  const canonicalEnvelopeJson = new TextDecoder().decode(
    encodeLibraryCoreCanonicalValue(
      finalized.members[0]!.envelope as never,
    ),
  );
  const fixture = {
    actorChainGenesis: enrollment.actor_chain_genesis,
    actorId: enrollmentBody.body.actor_id,
    authorityKeyId,
    authorityPublicKey,
    canonicalEnvelopeJson,
    secondCanonicalEnvelopeJson: new TextDecoder().decode(
      encodeLibraryCoreCanonicalValue(
        secondFinalized.members[0]!.envelope as never,
      ),
    ),
    unknownCausalEnvelopeJson: new TextDecoder().decode(
      encodeLibraryCoreCanonicalValue(
        unknownCausalFinalized.members[0]!.envelope as never,
      ),
    ),
    certificateBytes: Array.from(certificateBytes),
    enrollmentCertificateDigest: enrollment.certificate.certificate_digest,
    epochId,
    libraryId,
  };

  await page.goto("/favicon.svg");
  const result = await page.evaluate(async (fixture) => {
    const { createPwaLibraryCorePortableCheckpointStore } =
      await import("/src/lib/library-core-portable-checkpoint-store.ts");
    const {
      importLibraryCoreOperationSegmentV1,
      prepareLibraryCoreOperationSegmentV1,
    } = await import("/src/lib/library-core-operation-segment-runtime.ts");
    const databaseName = `freed-library-core-auth-${crypto.randomUUID()}`;
    const hex = (pair: string) => pair.repeat(32);
    const frontier0 = hex("01");
    const frontier1 = hex("02");
    const manifestDigest = hex("aa");
    const manifestReference = {
      descriptor: {
        byteLength: 1,
        contentDigest: manifestDigest,
        objectKey: `freed-v2-manifest~${fixture.libraryId}~e${fixture.epochId}~g1~${manifestDigest}.json`,
      },
      transportObjectId: "drive-manifest-auth",
    };
    const manifest = {
      causalFrontierDigest: frontier0,
      datasetSchemaId: "library_core_logical_checkpoint_v1",
      generation: 1,
      kind: "checkpoint_manifest",
      libraryId: fixture.libraryId,
      pages: [
        {
          firstRecordIdentity: "00:header",
          lastRecordIdentity: `06:${fixture.actorId}`,
          object: {
            descriptor: {
              byteLength: 1,
              contentDigest: hex("bb"),
              objectKey: `freed-v2-checkpoint~${fixture.libraryId}~e${fixture.epochId}~g1~p0~${hex("bb")}.fpage.gz`,
            },
            transportObjectId: "drive-page-auth",
          },
          pageIndex: 0,
          recordCount: 3,
        },
      ],
      protocolVersion: 1,
      schemaVersion: 1,
      storageEpoch: fixture.epochId,
      totalRecordCount: 3,
    } as const;
    const header = {
      anchor_kind: "accepted_authority",
      canonical_codec_version: 1,
      collection_counts: {
        accepted_frontier: 0,
        actor_states: 1,
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
        frontier_digest: frontier0,
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
        registry_key: "feedItems",
        row: {
          globalId: "item-1",
          userState: { readAt: null, saved: false },
        },
      },
    } as const;
    const actorState = {
      collection: "actor_states",
      kind: "logical_checkpoint_entry",
      ordinal: 0,
      value: {
        accepted_chain_digest: fixture.actorChainGenesis,
        accepted_operation_id: null,
        accepted_sequence: 0,
        actor_id: fixture.actorId,
        enrollment_certificate_digest: fixture.enrollmentCertificateDigest,
        retired: false,
        retirement_certificate_digest: null,
      },
    } as const;
    const store = createPwaLibraryCorePortableCheckpointStore({
      databaseName,
      indexedDb: indexedDB,
      keyRange: IDBKeyRange,
      subtle: crypto.subtle,
    });
    await store.beginImport({ manifest, manifestReference });
    await store.appendPage(0, [header, materializedRow, actorState]);
    await store.finalizeImport({ header, manifest, manifestReference });
    const authorityState = {
      authority_key_id: fixture.authorityKeyId,
      authority_public_key: fixture.authorityPublicKey,
      epoch: 1,
      epoch_id: fixture.epochId,
      library_id: fixture.libraryId,
      observed_frontier: [],
    } as const;
    const installed = await store.installActorEnrollment({
      acceptedAuthorityState: authorityState,
      certificateBytes: new Uint8Array(fixture.certificateBytes),
    });
    const replayedEnrollment = await store.installActorEnrollment({
      acceptedAuthorityState: authorityState,
      certificateBytes: new Uint8Array(fixture.certificateBytes),
    });
    const prepared = await prepareLibraryCoreOperationSegmentV1({
      baseFrontierDigest: frontier0,
      entries: [
        {
          canonicalEnvelopeJson: fixture.canonicalEnvelopeJson,
          ingestSequence: 1,
          operationId: "read-item-1",
        },
      ],
      epoch: 1,
      epochId: fixture.epochId,
      libraryId: fixture.libraryId,
      previousSegmentDigest: null,
      resultFrontierDigest: frontier1,
      schemaVersion: 1,
      subtle: crypto.subtle,
    });
    const reference = {
      descriptor: prepared.object.descriptor,
      transportObjectId: "drive-authenticated-ops",
    };
    const imported = await importLibraryCoreOperationSegmentV1({
      adapter: {
        async readImmutable() {
          return prepared.object.source.slice();
        },
      },
      expectedBaseFrontierDigest: frontier0,
      expectedFirstIngestSequence: 1,
      expectedPreviousSegmentDigest: null,
      libraryId: fixture.libraryId,
      reference,
      storageEpoch: fixture.epochId,
      subtle: crypto.subtle,
      writer: {
        appendOperationSegment: (input) =>
          store.appendAuthenticatedOperationSegment(input),
      },
    });
    const replayed = await importLibraryCoreOperationSegmentV1({
      adapter: {
        async readImmutable() {
          return prepared.object.source.slice();
        },
      },
      expectedBaseFrontierDigest: frontier0,
      expectedFirstIngestSequence: 1,
      expectedPreviousSegmentDigest: null,
      libraryId: fixture.libraryId,
      reference,
      storageEpoch: fixture.epochId,
      subtle: crypto.subtle,
      writer: {
        appendOperationSegment: (input) =>
          store.appendAuthenticatedOperationSegment(input),
      },
    });
    const page = await store.readSelectedAuthenticatedOperationPage({
      afterIngestSequence: 0,
      limit: 128,
    });
    const readState = await store.readSelectedReadState("item-1");
    const row = await store.readSelectedMaterializedRow(
      "feedItems",
      "item-1",
    );

    const corruptedEnvelope = JSON.parse(
      fixture.secondCanonicalEnvelopeJson,
    ) as Record<string, unknown>;
    corruptedEnvelope.signature = "00".repeat(64);
    const corrupted = await prepareLibraryCoreOperationSegmentV1({
      baseFrontierDigest: frontier1,
      entries: [
        {
          canonicalEnvelopeJson: JSON.stringify(corruptedEnvelope),
          ingestSequence: 2,
          operationId: "read-item-1-corrupt",
        },
      ],
      epoch: 1,
      epochId: fixture.epochId,
      libraryId: fixture.libraryId,
      previousSegmentDigest: prepared.header.segment_digest,
      resultFrontierDigest: hex("06"),
      schemaVersion: 1,
      subtle: crypto.subtle,
    });
    let corruptRejected = false;
    try {
      await importLibraryCoreOperationSegmentV1({
        adapter: {
          async readImmutable() {
            return corrupted.object.source.slice();
          },
        },
        expectedBaseFrontierDigest: frontier1,
        expectedFirstIngestSequence: 2,
        expectedPreviousSegmentDigest: prepared.header.segment_digest,
        libraryId: fixture.libraryId,
        reference: {
          descriptor: corrupted.object.descriptor,
          transportObjectId: "drive-corrupt-ops",
        },
        storageEpoch: fixture.epochId,
        subtle: crypto.subtle,
        writer: {
          appendOperationSegment: (input) =>
            store.appendAuthenticatedOperationSegment(input),
        },
      });
    } catch {
      corruptRejected = true;
    }
    const unknownCausal = await prepareLibraryCoreOperationSegmentV1({
      baseFrontierDigest: frontier1,
      entries: [
        {
          canonicalEnvelopeJson: fixture.unknownCausalEnvelopeJson,
          ingestSequence: 2,
          operationId: "read-item-1-unknown-causal",
        },
      ],
      epoch: 1,
      epochId: fixture.epochId,
      libraryId: fixture.libraryId,
      previousSegmentDigest: prepared.header.segment_digest,
      resultFrontierDigest: hex("07"),
      schemaVersion: 1,
      subtle: crypto.subtle,
    });
    let unknownCausalRejected = false;
    try {
      await importLibraryCoreOperationSegmentV1({
        adapter: {
          async readImmutable() {
            return unknownCausal.object.source.slice();
          },
        },
        expectedBaseFrontierDigest: frontier1,
        expectedFirstIngestSequence: 2,
        expectedPreviousSegmentDigest: prepared.header.segment_digest,
        libraryId: fixture.libraryId,
        reference: {
          descriptor: unknownCausal.object.descriptor,
          transportObjectId: "drive-unknown-causal-ops",
        },
        storageEpoch: fixture.epochId,
        subtle: crypto.subtle,
        writer: {
          appendOperationSegment: (input) =>
            store.appendAuthenticatedOperationSegment(input),
        },
      });
    } catch {
      unknownCausalRejected = true;
    }
    const pageAfterFailure =
      await store.readSelectedAuthenticatedOperationPage({
        afterIngestSequence: 0,
        limit: 128,
      });
    const stateAfterFailure = await store.readSelectedReadState("item-1");
    await store.quiesce();
    await new Promise<void>((resolve, reject) => {
      const deletion = indexedDB.deleteDatabase(databaseName);
      deletion.onsuccess = () => resolve();
      deletion.onerror = () => reject(deletion.error);
    });
    return {
      corruptRejected,
      imported,
      installed,
      page: {
        count: page.entries.length,
        frontier: page.frontierDigest,
      },
      pageAfterFailure: {
        count: pageAfterFailure.entries.length,
        frontier: pageAfterFailure.frontierDigest,
      },
      readState,
      replayed,
      replayedEnrollment,
      rowReadAt:
        (row?.userState as Record<string, unknown> | undefined)?.readAt ??
        null,
      stateAfterFailure,
      unknownCausalRejected,
    };
  }, fixture);

  expect(result).toMatchObject({
    corruptRejected: true,
    imported: {
      importedOperationCount: 1,
      lastIngestSequence: 1,
    },
    installed: "installed",
    page: {
      count: 1,
      frontier: "02".repeat(32),
    },
    pageAfterFailure: {
      count: 1,
      frontier: "02".repeat(32),
    },
    readState: {
      entityId: "item-1",
      readAtMs: 1_783_000_000_050,
      sourceOperationId: "read-item-1",
    },
    replayed: {
      importedOperationCount: 1,
      lastIngestSequence: 1,
    },
    replayedEnrollment: "already_installed",
    rowReadAt: 1_783_000_000_050,
    stateAfterFailure: {
      readAtMs: 1_783_000_000_050,
      sourceOperationId: "read-item-1",
    },
    unknownCausalRejected: true,
  });
});
