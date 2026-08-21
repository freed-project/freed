import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createHash, generateKeyPairSync, sign } from "node:crypto";
import sqlite3InitModule, {
  type Database,
  type Sqlite3Static,
} from "@sqlite.org/sqlite-wasm";
import {
  LIBRARY_CORE_NORMALIZED_SCHEMA_SHA256,
  LIBRARY_CORE_SQLITE_APPLICATION_ID,
  LIBRARY_CORE_SQLITE_QUERY_PROGRAMS,
  LIBRARY_CORE_SQLITE_SCHEMA_VERSION,
  LIBRARY_CORE_CHECKPOINT_PAGE_MAXIMUM_DECODED_BYTES,
  createLibraryCoreNormalizedCheckpointRecordV2,
  decodeLibraryCoreCanonicalBase64,
  decodeLibraryCoreCanonicalValue,
  digestLibraryCoreNormalizedCheckpointRecordsV2,
  encodeLibraryCoreNormalizedCheckpointRecordV2,
  isLibraryCoreOperationInstanceId,
  splitLibraryCoreContentV1,
  type LibraryCoreNormalizedCheckpointRecordV2,
  type LibraryCoreOperationInstanceId,
  type LibraryCoreFeedBrowseFilterV1,
  encodeLibraryCoreCanonicalValue,
  encodeLibraryCoreDigestInput,
  encodeLibraryCoreSignatureInput,
  finalizeLibraryCoreTransactionV1,
  FEED_ITEM_READ_ASSIGNMENT_TRANSACTION_MEMBER_SCHEMA,
  FEED_ITEM_CAPTURE_UPSERT_TRANSACTION_MEMBER_SCHEMA,
  RSS_FEED_REMOVE_KEEP_ITEMS_TRANSACTION_MEMBER_SCHEMA,
  RSS_FEED_TITLE_ASSIGNMENT_TRANSACTION_MEMBER_SCHEMA,
  RSS_FEED_UPSERT_TRANSACTION_MEMBER_SCHEMA,
  assembleLibraryCoreTransactionV1,
  type LibraryCoreCanonicalValue,
  type LibraryCoreDigestDomain,
  libraryCoreFollowerResultBodyV1,
  parseLibraryCoreFollowerResultEnvelopeV1,
} from "@freed/shared/library-core";
import { PwaLibraryCoreSqliteEngine } from "./library-core-sqlite-engine";

describe("PWA Library Core SQLite engine", () => {
  let sqlite3: Sqlite3Static;
  let database: Database;

  beforeEach(async () => {
    sqlite3 = await sqlite3InitModule();
    database = new sqlite3.oo1.DB(":memory:", "c");
  });

  afterEach(() => {
    if (database.isOpen()) database.close();
  });
  function operationId(value: string): LibraryCoreOperationInstanceId {
    if (!isLibraryCoreOperationInstanceId(value)) {
      throw new TypeError("invalid test operation instance ID");
    }
    return value;
  }

  function coreDigest(domain: string, value: unknown): string {
    return createHash("sha256")
      .update(
        encodeLibraryCoreDigestInput(
          domain as LibraryCoreDigestDomain,
          value as LibraryCoreCanonicalValue,
        ),
      )
      .digest("hex");
  }

  function checkpointHeader(): LibraryCoreNormalizedCheckpointRecordV2 {
    return createLibraryCoreNormalizedCheckpointRecordV2({
      registryKey: "00_checkpoint_header",
      primaryKey: "checkpoint",
      payload: {
        authorityEpoch: "epoch-1",
        checkpointId: "library-1:epoch-1:7",
        createdAtMs: 1_000,
        libraryId: "library-1",
        schemaVersion: 1,
        sourceRevision: 7,
      },
    });
  }

  function authorityRecords(): LibraryCoreNormalizedCheckpointRecordV2[] {
    return [
      createLibraryCoreNormalizedCheckpointRecordV2({
        registryKey: "01_authority_epoch",
        primaryKey: "epoch-1",
        payload: {
          acceptedAt: 400,
          acceptedManifestGeneration: 7,
          authorityKeyId: "a".repeat(64),
          authorityPublicKey: "b".repeat(64),
          canonicalTransitionCertificate: "{}",
          checkpointFrontierDigest: "c".repeat(64),
          epochNumber: 1,
          libraryId: "library-1",
          materializedStateDigest: "d".repeat(64),
          transitionCertificateDigest: "e".repeat(64),
        },
      }),
      createLibraryCoreNormalizedCheckpointRecordV2({
        registryKey: "02_authority_frontier",
        primaryKey: ["epoch-1", 0],
        payload: {
          acceptedChainDigest: "3".repeat(64),
          acceptedCounter: 2,
          acceptedOperationId: "operation-2",
          actorId: "actor-1",
        },
      }),
      createLibraryCoreNormalizedCheckpointRecordV2({
        registryKey: "03_active_authority",
        primaryKey: "active",
        payload: {
          acceptedManifestGeneration: 7,
          activatedAt: 400,
          activeKey: "active",
          epochId: "epoch-1",
          libraryId: "library-1",
          writerId: "writer-1",
        },
      }),
      createLibraryCoreNormalizedCheckpointRecordV2({
        registryKey: "90_actor_state",
        primaryKey: "actor-1",
        payload: {
          acceptedChainDigest: "3".repeat(64),
          acceptedCounter: 2,
          acceptedOperationId: "operation-2",
          actorKind: "desktop",
          authorityEpochId: "epoch-1",
          canonicalEnrollmentCertificate: "{}",
          chainGenesisDigest: "2".repeat(64),
          createdAt: 500,
          enrollmentCertificateDigest: "1".repeat(64),
          enrollmentOperationId: "enroll-1",
          publicKey: "f".repeat(64),
          retiredAt: null,
          updatedAt: 1_000,
        },
      }),
      createLibraryCoreNormalizedCheckpointRecordV2({
        registryKey: "91_actor_capability",
        primaryKey: "capability-1",
        payload: {
          actorClass: "editor",
          actorId: "actor-1",
          canonicalCertificate: "{}",
          certificateDigest: "4".repeat(64),
          certificateVersion: 2,
          issuanceIdentity: "5".repeat(64),
          issuedAt: 500,
          retiredAt: null,
          retirementCertificateDigest: null,
          retirementIdentity: "6".repeat(64),
          scopeId: null,
          scopeKind: null,
          scopeMode: "library_wide",
        },
      }),
      createLibraryCoreNormalizedCheckpointRecordV2({
        registryKey: "92_actor_capability_mutation",
        primaryKey: ["capability-1", "feed_item_read_assignment"],
        payload: { mutationId: "feed_item_read_assignment" },
      }),
    ];
  }

  function stageRecords(
    engine: PwaLibraryCoreSqliteEngine,
    records: readonly LibraryCoreNormalizedCheckpointRecordV2[],
    stageId: string,
    expectedCheckpointDigest = digestLibraryCoreNormalizedCheckpointRecordsV2(
      records,
    ),
  ): void {
    engine.beginNormalizedCheckpointStage({
      authorityEpoch: "epoch-1",
      createdAt: 1_000,
      expectedCheckpointDigest,
      expectedRecordCount: records.length,
      libraryId: "library-1",
      sourceRevision: 7,
      stageId,
    });
    let page: LibraryCoreNormalizedCheckpointRecordV2[] = [];
    let pageBytes = 0;
    for (const record of records) {
      const recordBytes =
        encodeLibraryCoreNormalizedCheckpointRecordV2(record).byteLength;
      if (
        page.length > 0 &&
        (page.length === 128 ||
          pageBytes + recordBytes >
            LIBRARY_CORE_CHECKPOINT_PAGE_MAXIMUM_DECODED_BYTES)
      ) {
        engine.appendNormalizedCheckpointStagePage({ records: page, stageId });
        page = [];
        pageBytes = 0;
      }
      page.push(record);
      pageBytes += recordBytes;
    }
    if (page.length > 0) {
      engine.appendNormalizedCheckpointStagePage({ records: page, stageId });
    }
  }

  it("installs and verifies the exact generated normalized schema", () => {
    const engine = new PwaLibraryCoreSqliteEngine(
      database,
      sqlite3.version.libVersion,
    );
    const status = engine.initialize();
    expect(status.schemaVersion).toBe(LIBRARY_CORE_SQLITE_SCHEMA_VERSION);
    expect(status.schemaSha256).toBe(LIBRARY_CORE_NORMALIZED_SCHEMA_SHA256);
    expect(status.connectionGeneration).toBe(1);
    expect(
      database.exec({
        sql: "PRAGMA application_id;",
        rowMode: 0,
        returnValue: "resultRows",
      }),
    ).toEqual([LIBRARY_CORE_SQLITE_APPLICATION_ID]);
    expect(
      database.exec({
        sql: "SELECT count(*) FROM sqlite_schema WHERE name = 'library_feed_items';",
        rowMode: 0,
        returnValue: "resultRows",
      }),
    ).toEqual([1]);
    for (const table of [
      "library_authority_epochs",
      "library_active_authority",
      "library_actor_capabilities",
      "library_transactions",
      "library_operations",
      "library_replication_outbox",
      "library_invalidations",
      "library_intent_transactions",
      "library_intent_members",
      "library_intent_results",
      "library_intent_result_cursors",
      "library_optimistic_fields",
    ]) {
      expect(
        database.exec({
          sql: "SELECT count(*) FROM sqlite_schema WHERE type = 'table' AND name = ?1;",
          bind: [table],
          rowMode: 0,
          returnValue: "resultRows",
        }),
      ).toEqual([1]);
    }
  });

  it("fails closed when durable schema identity is changed", () => {
    const first = new PwaLibraryCoreSqliteEngine(
      database,
      sqlite3.version.libVersion,
    );
    first.initialize();
    database.exec(
      "UPDATE library_storage_meta SET schema_sha256 = lower(hex(randomblob(32)));",
    );
    const second = new PwaLibraryCoreSqliteEngine(
      database,
      sqlite3.version.libVersion,
    );
    expect(() => second.initialize()).toThrow(/does not match this build/);
  });

  it("atomically commits verified follower intents, optimistic fields, and exact retries", async () => {
    const libraryId = "11".repeat(32);
    const epochId = "22".repeat(32);
    const actorId = "33".repeat(32);
    const chainGenesis = "44".repeat(32);
    const { privateKey, publicKey } = generateKeyPairSync("ed25519");
    const authorityKeys = generateKeyPairSync("ed25519");
    const publicKeyHex = publicKey
      .export({ format: "der", type: "spki" })
      .subarray(-32)
      .toString("hex");
    const authorityPublicKeyHex = authorityKeys.publicKey
      .export({ format: "der", type: "spki" })
      .subarray(-32)
      .toString("hex");
    const engine = new PwaLibraryCoreSqliteEngine(
      database,
      sqlite3.version.libVersion,
      { now: () => 2_000 },
    );
    engine.initialize();
    database.exec({
      sql: `INSERT INTO library_meta
              (singleton_id, library_id, schema_version, authority_epoch,
               source_revision, updated_at)
            VALUES (1, ?1, 1, ?2, 7, 1000);`,
      bind: [libraryId, epochId],
    });
    database.exec({
      sql: `INSERT INTO library_materialization_generation
              (singleton_id, generation_id) VALUES (1, ?1);`,
      bind: ["99".repeat(32)],
    });
    database.exec(
      "UPDATE library_change_state SET revision = 7 WHERE singleton_id = 1;",
    );
    database.exec({
      sql: `INSERT INTO library_authority_epochs
              (epoch_id, library_id, epoch_number, authority_key_id,
               authority_public_key, transition_certificate_digest,
               canonical_transition_certificate, accepted_manifest_generation,
               checkpoint_frontier_digest, materialized_state_digest, accepted_at)
            VALUES (?1, ?2, 1, ?3, ?4, ?5, '{}', 1, ?6, ?7, 1);`,
      bind: [
        epochId,
        libraryId,
        "55".repeat(32),
        authorityPublicKeyHex,
        "77".repeat(32),
        "88".repeat(32),
        "aa".repeat(32),
      ],
    });
    database.exec({
      sql: `INSERT INTO library_active_authority
              (active_key, library_id, epoch_id, writer_id,
               accepted_manifest_generation, activated_at)
            VALUES ('active', ?1, ?2, 'writer-1', 1, 1);`,
      bind: [libraryId, epochId],
    });
    database.exec({
      sql: `INSERT INTO library_actors
              (actor_id, authority_epoch_id, actor_kind, public_key,
               enrollment_operation_id, enrollment_certificate_digest,
               canonical_enrollment_certificate, chain_genesis_digest,
               accepted_counter, accepted_operation_id, accepted_chain_digest,
               retired_at, created_at, updated_at)
            VALUES (?1, ?2, 'pwa', ?3, 'enroll-1', ?4, '{}', ?5,
                    0, NULL, ?5, NULL, 1, 1);`,
      bind: [actorId, epochId, publicKeyHex, "bb".repeat(32), chainGenesis],
    });
    database.exec({
      sql: `INSERT INTO library_actor_capabilities
              (capability_id, actor_id, certificate_version, actor_class,
               scope_mode, scope_kind, scope_id, issuance_identity,
               retirement_identity, certificate_digest, canonical_certificate,
               issued_at, retired_at)
            VALUES ('capability-1', ?1, 2, 'editor', 'library_wide', NULL, NULL,
                    ?2, ?3, ?4, '{}', 1, NULL);`,
      bind: [actorId, "cc".repeat(32), "dd".repeat(32), "ee".repeat(32)],
    });
    database.exec({
      sql: `INSERT INTO library_actor_capability_mutations
              (capability_id, mutation_id)
            VALUES ('capability-1', 'feed_item_read_assignment');`,
    });
    database.exec({
      sql: `INSERT INTO library_feed_items
              (global_id, platform, content_type, captured_at, published_at,
               author_id, author_handle, author_display_name, hidden, saved,
               archived, updated_at)
            VALUES ('item-1', 'saved', 'article', 1, 1, 'author-1', 'ada',
                    'Ada', 0, 0, 0, 1);`,
    });
    const member =
      FEED_ITEM_READ_ASSIGNMENT_TRANSACTION_MEMBER_SCHEMA.construct(
        {
          actor_id: actorId,
          actor_sequence: 1,
          causal_frontier: [],
          created_at_ms: 1_500,
          entity_id: "item-1",
          epoch: 1,
          epoch_id: epochId,
          hlc_counter: 0,
          hlc_wall_ms: 1_500,
          library_id: libraryId,
          operation_id: "intent-operation-1",
          payload: { read_at_ms: 1_400 },
          previous_actor_operation_id: null,
          transaction_id: "intent-transaction-1",
          transaction_member_count: 1,
          transaction_member_index: 0,
        },
        { digest: coreDigest },
      );
    const assembled = assembleLibraryCoreTransactionV1([member], chainGenesis, {
      digest: coreDigest,
    });
    const finalized = await finalizeLibraryCoreTransactionV1(assembled, {
      digest: coreDigest,
      async signOperation(message) {
        return sign(null, message, privateKey).toString("hex");
      },
    });
    const envelopeBytes = finalized.members.map((value) =>
      encodeLibraryCoreCanonicalValue(
        value.envelope as unknown as LibraryCoreCanonicalValue,
      ),
    );

    const first = await engine.commitFollowerIntent({ envelopeBytes });
    expect(first).toEqual({
      actorId,
      firstCounter: 1,
      lastCounter: 1,
      memberCount: 1,
      optimisticFieldCount: 1,
      state: "pending",
      transactionId: "intent-transaction-1",
    });
    expect(await engine.commitFollowerIntent({ envelopeBytes })).toEqual(first);
    expect(
      database.exec({
        sql: `SELECT value_type, integer_value
              FROM library_optimistic_fields
              WHERE transaction_id = 'intent-transaction-1';`,
        rowMode: "array",
        returnValue: "resultRows",
      }),
    ).toEqual([["integer", 1_400]]);
    expect(
      database.exec({
        sql: `SELECT next_counter, previous_operation_id
              FROM library_intent_actors WHERE actor_id = ?1;`,
        bind: [actorId],
        rowMode: "array",
        returnValue: "resultRows",
      }),
    ).toEqual([[2, "intent-operation-1"]]);
    const intentPage = engine.pageFollowerIntents({
      actorId,
      cursor: null,
      limit: 128,
      schemaVersion: 1,
    });
    expect(intentPage).toEqual({
      actorId,
      done: true,
      nextCursor: {
        actorCounter: 1,
        operationId: "intent-operation-1",
        transactionId: "intent-transaction-1",
      },
      records: [
        {
          actorCounter: 1,
          actorId,
          canonicalEnvelopeJson: new TextDecoder().decode(envelopeBytes[0]),
          intentEpoch: 1,
          intentEpochId: epochId,
          memberCount: 1,
          memberIndex: 0,
          operationId: "intent-operation-1",
          state: "pending",
          transactionDigest: finalized.transaction_digest,
          transactionId: "intent-transaction-1",
        },
      ],
      schemaVersion: 1,
    });
    const publication = {
      actorId,
      publishedAt: 2_000,
      transactionDigest: finalized.transaction_digest,
      transactionId: "intent-transaction-1",
    };
    const publicationReceipt = engine.publishFollowerIntent(publication);
    expect(publicationReceipt).toEqual({
      actorId,
      publishedAt: 2_000,
      state: "published",
      transactionId: "intent-transaction-1",
    });
    expect(engine.publishFollowerIntent(publication)).toEqual(
      publicationReceipt,
    );
    expect(() =>
      engine.publishFollowerIntent({ ...publication, publishedAt: 2_001 }),
    ).toThrow(/identity was reused/);
    expect(
      engine.pageFollowerIntents({
        actorId,
        cursor: null,
        limit: 128,
        schemaVersion: 1,
      }).records[0]?.state,
    ).toBe("published");
    expect(() =>
      engine.pageFollowerIntents({
        actorId,
        cursor: {
          ...intentPage.nextCursor!,
          operationId: "different-operation",
        },
        limit: 128,
        schemaVersion: 1,
      }),
    ).toThrow(/does not name a stored member/);
    const intentPlan = database.exec({
      sql: `EXPLAIN QUERY PLAN
            SELECT member.actor_counter, member.operation_id,
                   member.transaction_id
            FROM library_intent_members AS member
            JOIN library_intent_transactions AS intent
              ON intent.transaction_id = member.transaction_id
             AND intent.actor_id = member.actor_id
            WHERE member.actor_id = ?1
              AND member.actor_counter > ?2
              AND intent.state IN ('pending', 'published')
            ORDER BY member.actor_counter
            LIMIT ?3;`,
      bind: [actorId, 0, 129],
      rowMode: "array",
      returnValue: "resultRows",
    });
    expect(intentPlan.map((row) => String(row[3])).join("\n")).toMatch(
      /library_intent_members_actor_page/,
    );
    expect(intentPlan.map((row) => String(row[3])).join("\n")).not.toMatch(
      /USE TEMP B-TREE/,
    );

    const unsignedResult = parseLibraryCoreFollowerResultEnvelopeV1({
      actor_id: actorId,
      authoritative_source_revision: 8,
      authority_key_id: "55".repeat(32),
      canonical_operation_ids: ["canonical-operation-1"],
      epoch: 1,
      epoch_id: epochId,
      format: "freed_follower_result_v1",
      intent_epoch: 1,
      intent_epoch_id: epochId,
      library_id: libraryId,
      original_result_digest: null,
      previous_result_digest: null,
      receipt_ids: ["receipt-1"],
      rejection_reason: null,
      replacement_fields: [
        {
          boolean_value: null,
          entity_id: "item-1",
          entity_type: "FeedItem",
          field_path: "read_at",
          integer_value: 1_400,
          real_value: null,
          text_value: null,
          value_type: "integer",
        },
      ],
      resolved_at_ms: 2_000,
      result_body_digest: "0".repeat(64),
      result_sequence: 1,
      schema_version: 1,
      signature: "0".repeat(128),
      signature_algorithm: "ed25519",
      status: "accepted",
      transaction_digest: finalized.transaction_digest,
      transaction_id: "intent-transaction-1",
    });
    const resultDigest = coreDigest(
      "follower-result-body",
      libraryCoreFollowerResultBodyV1(unsignedResult),
    );
    const canonicalResultBytes = encodeLibraryCoreCanonicalValue({
      ...unsignedResult,
      result_body_digest: resultDigest,
      signature: sign(
        null,
        encodeLibraryCoreSignatureInput("follower-result-envelope", {
          result_body_digest: resultDigest,
        }),
        authorityKeys.privateKey,
      ).toString("hex"),
    } as unknown as LibraryCoreCanonicalValue);
    const resultReceipt = await engine.applyFollowerResult({
      canonicalResultBytes,
    });
    expect(resultReceipt).toEqual({
      actorId,
      resultDigest,
      resultSequence: 1,
      sourceRevision: 8,
      status: "accepted",
      transactionId: "intent-transaction-1",
    });
    expect(await engine.applyFollowerResult({ canonicalResultBytes })).toEqual(
      resultReceipt,
    );
    expect(
      database.exec({
        sql: `SELECT read_at, (SELECT count(*) FROM library_optimistic_fields),
                     (SELECT next_result_sequence FROM library_intent_result_cursors
                      WHERE actor_id = ?1)
              FROM library_feed_items WHERE global_id = 'item-1';`,
        bind: [actorId],
        rowMode: "array",
        returnValue: "resultRows",
      }),
    ).toEqual([[1_400, 0, 2]]);

    const changedResult = new Uint8Array(canonicalResultBytes);
    changedResult[changedResult.byteLength - 2] =
      changedResult[changedResult.byteLength - 2] === 48 ? 49 : 48;
    await expect(
      engine.applyFollowerResult({ canonicalResultBytes: changedResult }),
    ).rejects.toThrow(/changed bytes|canonical/);

    const decoded = decodeLibraryCoreCanonicalValue(envelopeBytes[0]!);
    if (
      decoded === null ||
      typeof decoded !== "object" ||
      Array.isArray(decoded)
    ) {
      throw new Error("test follower envelope is not a record");
    }
    const changed = [
      encodeLibraryCoreCanonicalValue({
        ...decoded,
        created_at_ms: 1_501,
      }),
    ];
    await expect(
      engine.commitFollowerIntent({ envelopeBytes: changed }),
    ).rejects.toThrow(/reused with changed bytes/);

    database.exec(`CREATE TEMP TRIGGER fail_follower_optimistic_insert
      BEFORE INSERT ON library_optimistic_fields
      BEGIN SELECT RAISE(ABORT, 'injected optimistic fault'); END;`);
    const secondMember =
      FEED_ITEM_READ_ASSIGNMENT_TRANSACTION_MEMBER_SCHEMA.construct(
        {
          actor_id: actorId,
          actor_sequence: 2,
          causal_frontier: [],
          created_at_ms: 1_600,
          entity_id: "item-1",
          epoch: 1,
          epoch_id: epochId,
          hlc_counter: 0,
          hlc_wall_ms: 1_600,
          library_id: libraryId,
          operation_id: "intent-operation-2",
          payload: { read_at_ms: 1_600 },
          previous_actor_operation_id: "intent-operation-1",
          transaction_id: "intent-transaction-2",
          transaction_member_count: 1,
          transaction_member_index: 0,
        },
        { digest: coreDigest },
      );
    const secondAssembled = assembleLibraryCoreTransactionV1(
      [secondMember],
      finalized.members[0]!.envelope.actor_chain_digest,
      { digest: coreDigest },
    );
    const secondFinalized = await finalizeLibraryCoreTransactionV1(
      secondAssembled,
      {
        digest: coreDigest,
        async signOperation(message) {
          return sign(null, message, privateKey).toString("hex");
        },
      },
    );
    await expect(
      engine.commitFollowerIntent({
        envelopeBytes: secondFinalized.members.map((value) =>
          encodeLibraryCoreCanonicalValue(
            value.envelope as unknown as LibraryCoreCanonicalValue,
          ),
        ),
      }),
    ).rejects.toThrow(/injected optimistic fault/);
    expect(
      database.exec({
        sql: "SELECT count(*) FROM library_intent_transactions;",
        rowMode: 0,
        returnValue: "resultRows",
      }),
    ).toEqual([1]);
    expect(
      database.exec({
        sql: `SELECT next_counter FROM library_intent_actors
              WHERE actor_id = ?1;`,
        bind: [actorId],
        rowMode: 0,
        returnValue: "resultRows",
      }),
    ).toEqual([2]);

    database.exec("DROP TRIGGER fail_follower_optimistic_insert;");
    const secondEnvelopeBytes = secondFinalized.members.map((value) =>
      encodeLibraryCoreCanonicalValue(
        value.envelope as unknown as LibraryCoreCanonicalValue,
      ),
    );
    await engine.commitFollowerIntent({ envelopeBytes: secondEnvelopeBytes });
    const unsignedSecondResult = parseLibraryCoreFollowerResultEnvelopeV1({
      actor_id: actorId,
      authoritative_source_revision: 9,
      authority_key_id: "55".repeat(32),
      canonical_operation_ids: ["canonical-operation-2"],
      epoch: 1,
      epoch_id: epochId,
      format: "freed_follower_result_v1",
      intent_epoch: 1,
      intent_epoch_id: epochId,
      library_id: libraryId,
      original_result_digest: null,
      previous_result_digest: resultDigest,
      receipt_ids: ["receipt-2"],
      rejection_reason: null,
      replacement_fields: [
        {
          boolean_value: null,
          entity_id: "item-1",
          entity_type: "FeedItem",
          field_path: "read_at",
          integer_value: 1_600,
          real_value: null,
          text_value: null,
          value_type: "integer",
        },
      ],
      resolved_at_ms: 2_100,
      result_body_digest: "0".repeat(64),
      result_sequence: 2,
      schema_version: 1,
      signature: "0".repeat(128),
      signature_algorithm: "ed25519",
      status: "accepted",
      transaction_digest: secondFinalized.transaction_digest,
      transaction_id: "intent-transaction-2",
    });
    const secondResultDigest = coreDigest(
      "follower-result-body",
      libraryCoreFollowerResultBodyV1(unsignedSecondResult),
    );
    const secondResultBytes = encodeLibraryCoreCanonicalValue({
      ...unsignedSecondResult,
      result_body_digest: secondResultDigest,
      signature: sign(
        null,
        encodeLibraryCoreSignatureInput("follower-result-envelope", {
          result_body_digest: secondResultDigest,
        }),
        authorityKeys.privateKey,
      ).toString("hex"),
    } as unknown as LibraryCoreCanonicalValue);
    database.exec(`CREATE TEMP TRIGGER fail_follower_result_cursor
      BEFORE UPDATE OF next_result_sequence ON library_intent_result_cursors
      BEGIN SELECT RAISE(ABORT, 'injected result cursor fault'); END;`);
    await expect(
      engine.applyFollowerResult({ canonicalResultBytes: secondResultBytes }),
    ).rejects.toThrow(/injected result cursor fault/);
    expect(
      database.exec({
        sql: `SELECT read_at,
                     (SELECT source_revision FROM library_meta WHERE singleton_id = 1),
                     (SELECT count(*) FROM library_intent_results),
                     (SELECT count(*) FROM library_optimistic_fields
                      WHERE transaction_id = 'intent-transaction-2'),
                     (SELECT state FROM library_intent_transactions
                      WHERE transaction_id = 'intent-transaction-2'),
                     (SELECT next_result_sequence FROM library_intent_result_cursors
                      WHERE actor_id = ?1)
              FROM library_feed_items WHERE global_id = 'item-1';`,
        bind: [actorId],
        rowMode: "array",
        returnValue: "resultRows",
      }),
    ).toEqual([[1_400, 8, 1, 1, "pending", 2]]);

    database.exec("DROP TRIGGER fail_follower_result_cursor;");
    await engine.applyFollowerResult({
      canonicalResultBytes: secondResultBytes,
    });
    const thirdMember =
      FEED_ITEM_READ_ASSIGNMENT_TRANSACTION_MEMBER_SCHEMA.construct(
        {
          actor_id: actorId,
          actor_sequence: 3,
          causal_frontier: [],
          created_at_ms: 2_200,
          entity_id: "item-1",
          epoch: 1,
          epoch_id: epochId,
          hlc_counter: 0,
          hlc_wall_ms: 2_200,
          library_id: libraryId,
          operation_id: "intent-operation-3",
          payload: { read_at_ms: 2_200 },
          previous_actor_operation_id: "intent-operation-2",
          transaction_id: "intent-transaction-3",
          transaction_member_count: 1,
          transaction_member_index: 0,
        },
        { digest: coreDigest },
      );
    const thirdAssembled = assembleLibraryCoreTransactionV1(
      [thirdMember],
      secondFinalized.members[0]!.envelope.actor_chain_digest,
      { digest: coreDigest },
    );
    const thirdFinalized = await finalizeLibraryCoreTransactionV1(
      thirdAssembled,
      {
        digest: coreDigest,
        async signOperation(message) {
          return sign(null, message, privateKey).toString("hex");
        },
      },
    );
    await engine.commitFollowerIntent({
      envelopeBytes: thirdFinalized.members.map((value) =>
        encodeLibraryCoreCanonicalValue(
          value.envelope as unknown as LibraryCoreCanonicalValue,
        ),
      ),
    });
    const currentEpochId = "66".repeat(32);
    database.exec({
      sql: `INSERT INTO library_authority_epochs
              (epoch_id, library_id, epoch_number, authority_key_id,
               authority_public_key, transition_certificate_digest,
               canonical_transition_certificate, accepted_manifest_generation,
               checkpoint_frontier_digest, materialized_state_digest, accepted_at)
            VALUES (?1, ?2, 2, ?3, ?4, ?5, '{}', 2, ?6, ?7, 2200);`,
      bind: [
        currentEpochId,
        libraryId,
        "55".repeat(32),
        authorityPublicKeyHex,
        "67".repeat(32),
        "68".repeat(32),
        "69".repeat(32),
      ],
    });
    database.exec({
      sql: `UPDATE library_active_authority
            SET epoch_id = ?1, accepted_manifest_generation = 2,
                activated_at = 2200;`,
      bind: [currentEpochId],
    });
    database.exec({
      sql: `UPDATE library_meta SET authority_epoch = ?1, updated_at = 2200;`,
      bind: [currentEpochId],
    });
    const unsignedStaleResult = parseLibraryCoreFollowerResultEnvelopeV1({
      actor_id: actorId,
      authoritative_source_revision: 9,
      authority_key_id: "55".repeat(32),
      canonical_operation_ids: [],
      epoch: 2,
      epoch_id: currentEpochId,
      format: "freed_follower_result_v1",
      intent_epoch: 1,
      intent_epoch_id: epochId,
      library_id: libraryId,
      original_result_digest: null,
      previous_result_digest: secondResultDigest,
      receipt_ids: [],
      rejection_reason: "epoch_stale",
      replacement_fields: [
        {
          boolean_value: null,
          entity_id: "item-1",
          entity_type: "FeedItem",
          field_path: "read_at",
          integer_value: 1_600,
          real_value: null,
          text_value: null,
          value_type: "integer",
        },
      ],
      resolved_at_ms: 2_300,
      result_body_digest: "0".repeat(64),
      result_sequence: 3,
      schema_version: 1,
      signature: "0".repeat(128),
      signature_algorithm: "ed25519",
      status: "rejected",
      transaction_digest: thirdFinalized.transaction_digest,
      transaction_id: "intent-transaction-3",
    });
    const staleResultDigest = coreDigest(
      "follower-result-body",
      libraryCoreFollowerResultBodyV1(unsignedStaleResult),
    );
    const staleResultBytes = encodeLibraryCoreCanonicalValue({
      ...unsignedStaleResult,
      result_body_digest: staleResultDigest,
      signature: sign(
        null,
        encodeLibraryCoreSignatureInput("follower-result-envelope", {
          result_body_digest: staleResultDigest,
        }),
        authorityKeys.privateKey,
      ).toString("hex"),
    } as unknown as LibraryCoreCanonicalValue);
    const staleReceipt = await engine.applyFollowerResult({
      canonicalResultBytes: staleResultBytes,
    });
    expect(staleReceipt).toEqual({
      actorId,
      resultDigest: staleResultDigest,
      resultSequence: 3,
      sourceRevision: 9,
      status: "rejected",
      transactionId: "intent-transaction-3",
    });
    expect(
      database.exec({
        sql: `SELECT item.read_at, intent.state,
                     result.authority_epoch_id, result.intent_epoch_id,
                     (SELECT count(*) FROM library_optimistic_fields
                      WHERE transaction_id = intent.transaction_id),
                     (SELECT next_result_sequence FROM library_intent_result_cursors
                      WHERE actor_id = ?1)
              FROM library_feed_items AS item
              JOIN library_intent_transactions AS intent
                ON intent.transaction_id = 'intent-transaction-3'
              JOIN library_intent_results AS result
                ON result.transaction_id = intent.transaction_id
              WHERE item.global_id = 'item-1';`,
        bind: [actorId],
        rowMode: "array",
        returnValue: "resultRows",
      }),
    ).toEqual([[1_600, "rejected", currentEpochId, epochId, 0, 4]]);
  });

  it("materializes an accepted signed FeedItem capture through the generated program", async () => {
    const libraryId = "11".repeat(32);
    const epochId = "22".repeat(32);
    const actorId = "33".repeat(32);
    const chainGenesis = "44".repeat(32);
    const actorKeys = generateKeyPairSync("ed25519");
    const authorityKeys = generateKeyPairSync("ed25519");
    const actorPublicKey = actorKeys.publicKey
      .export({ format: "der", type: "spki" })
      .subarray(-32)
      .toString("hex");
    const authorityPublicKey = authorityKeys.publicKey
      .export({ format: "der", type: "spki" })
      .subarray(-32)
      .toString("hex");
    const engine = new PwaLibraryCoreSqliteEngine(
      database,
      sqlite3.version.libVersion,
      { now: () => 2_000 },
    );
    engine.initialize();
    database.exec({
      sql: `INSERT INTO library_meta
              (singleton_id, library_id, schema_version, authority_epoch,
               source_revision, updated_at)
            VALUES (1, ?1, 1, ?2, 0, 1000);`,
      bind: [libraryId, epochId],
    });
    database.exec({
      sql: `INSERT INTO library_materialization_generation
              (singleton_id, generation_id) VALUES (1, ?1);`,
      bind: ["99".repeat(32)],
    });
    database.exec({
      sql: `INSERT INTO library_authority_epochs
              (epoch_id, library_id, epoch_number, authority_key_id,
               authority_public_key, transition_certificate_digest,
               canonical_transition_certificate, accepted_manifest_generation,
               checkpoint_frontier_digest, materialized_state_digest, accepted_at)
            VALUES (?1, ?2, 1, ?3, ?4, ?5, '{}', 1, ?6, ?7, 1);
            `,
      bind: [
        epochId,
        libraryId,
        "55".repeat(32),
        authorityPublicKey,
        "77".repeat(32),
        "88".repeat(32),
        "aa".repeat(32),
      ],
    });
    database.exec({
      sql: `INSERT INTO library_active_authority
              (active_key, library_id, epoch_id, writer_id,
               accepted_manifest_generation, activated_at)
            VALUES ('active', ?1, ?2, 'writer-1', 1, 1);`,
      bind: [libraryId, epochId],
    });
    database.exec({
      sql: `INSERT INTO library_actors
              (actor_id, authority_epoch_id, actor_kind, public_key,
               enrollment_operation_id, enrollment_certificate_digest,
               canonical_enrollment_certificate, chain_genesis_digest,
               accepted_counter, accepted_operation_id, accepted_chain_digest,
               retired_at, created_at, updated_at)
            VALUES (?1, ?2, 'pwa', ?3, 'enroll-capture', ?4, '{}', ?5,
                    0, NULL, ?5, NULL, 1, 1);`,
      bind: [actorId, epochId, actorPublicKey, "bb".repeat(32), chainGenesis],
    });
    database.exec({
      sql: `INSERT INTO library_actor_capabilities
              (capability_id, actor_id, certificate_version, actor_class,
               scope_mode, scope_kind, scope_id, issuance_identity,
               retirement_identity, certificate_digest, canonical_certificate,
               issued_at, retired_at)
            VALUES ('capture-capability', ?1, 2, 'scraper', 'library_wide',
                    NULL, NULL, ?2, ?3, ?4, '{}', 1, NULL);`,
      bind: [actorId, "cc".repeat(32), "dd".repeat(32), "ee".repeat(32)],
    });
    database.exec({
      sql: `INSERT INTO library_actor_capability_mutations
              (capability_id, mutation_id)
            VALUES ('capture-capability', 'feed_item_capture_upsert');`,
    });
    const item = {
      author: { displayName: "Ada", handle: "ada", id: "author-1" },
      capturedAt: 1_500,
      content: {
        mediaTypes: ["image"],
        mediaUrls: ["https://example.com/image.jpg"],
        text: "A bounded capture",
      },
      contentType: "post",
      globalId: "captured-item-1",
      platform: "saved",
      publishedAt: 1_400,
      topics: ["sqlite"],
      userState: {
        archived: false,
        hidden: false,
        saved: false,
        tags: [],
      },
    };
    const member = FEED_ITEM_CAPTURE_UPSERT_TRANSACTION_MEMBER_SCHEMA.construct(
      {
        actor_id: actorId,
        actor_sequence: 1,
        causal_frontier: [],
        created_at_ms: 1_500,
        entity_id: item.globalId,
        epoch: 1,
        epoch_id: epochId,
        hlc_counter: 0,
        hlc_wall_ms: 1_500,
        library_id: libraryId,
        operation_id: "capture-operation-1",
        payload: { item },
        previous_actor_operation_id: null,
        transaction_id: "capture-transaction-1",
        transaction_member_count: 1,
        transaction_member_index: 0,
      },
      { digest: coreDigest },
    );
    const assembled = assembleLibraryCoreTransactionV1([member], chainGenesis, {
      digest: coreDigest,
    });
    const finalized = await finalizeLibraryCoreTransactionV1(assembled, {
      digest: coreDigest,
      async signOperation(message) {
        return sign(null, message, actorKeys.privateKey).toString("hex");
      },
    });
    const envelopeBytes = finalized.members.map((value) =>
      encodeLibraryCoreCanonicalValue(
        value.envelope as unknown as LibraryCoreCanonicalValue,
      ),
    );
    const intent = await engine.commitFollowerIntent({ envelopeBytes });
    expect(intent.optimisticFieldCount).toBe(0);
    expect(
      database.exec({
        sql: "SELECT count(*) FROM library_feed_items;",
        rowMode: 0,
        returnValue: "resultRows",
      }),
    ).toEqual([0]);

    const unsignedResult = parseLibraryCoreFollowerResultEnvelopeV1({
      actor_id: actorId,
      authoritative_source_revision: 1,
      authority_key_id: "55".repeat(32),
      canonical_operation_ids: ["canonical-capture-operation-1"],
      epoch: 1,
      epoch_id: epochId,
      format: "freed_follower_result_v1",
      intent_epoch: 1,
      intent_epoch_id: epochId,
      library_id: libraryId,
      original_result_digest: null,
      previous_result_digest: null,
      receipt_ids: ["capture-receipt-1"],
      rejection_reason: null,
      replacement_fields: [],
      resolved_at_ms: 2_100,
      result_body_digest: "0".repeat(64),
      result_sequence: 1,
      schema_version: 1,
      signature: "0".repeat(128),
      signature_algorithm: "ed25519",
      status: "accepted",
      transaction_digest: finalized.transaction_digest,
      transaction_id: "capture-transaction-1",
    });
    const resultDigest = coreDigest(
      "follower-result-body",
      libraryCoreFollowerResultBodyV1(unsignedResult),
    );
    const resultBytes = encodeLibraryCoreCanonicalValue({
      ...unsignedResult,
      result_body_digest: resultDigest,
      signature: sign(
        null,
        encodeLibraryCoreSignatureInput("follower-result-envelope", {
          result_body_digest: resultDigest,
        }),
        authorityKeys.privateKey,
      ).toString("hex"),
    } as unknown as LibraryCoreCanonicalValue);
    await engine.applyFollowerResult({ canonicalResultBytes: resultBytes });
    expect(
      database.exec({
        sql: `SELECT global_id, content_text, saved, archived, updated_at,
                     (SELECT source_url FROM library_feed_item_media
                      WHERE global_id = 'captured-item-1' AND ordinal = 0),
                     (SELECT topic FROM library_feed_item_topics
                      WHERE global_id = 'captured-item-1')
              FROM library_feed_items WHERE global_id = 'captured-item-1';`,
        rowMode: "array",
        returnValue: "resultRows",
      }),
    ).toEqual([
      [
        "captured-item-1",
        "A bounded capture",
        0,
        0,
        2_100,
        "https://example.com/image.jpg",
        "sqlite",
      ],
    ]);

    const gapItem = {
      ...item,
      content: { ...item.content, text: "Must wait for revision two" },
      globalId: "captured-item-gap",
    };
    const gapMember =
      FEED_ITEM_CAPTURE_UPSERT_TRANSACTION_MEMBER_SCHEMA.construct(
        {
          actor_id: actorId,
          actor_sequence: 2,
          causal_frontier: [],
          created_at_ms: 2_200,
          entity_id: gapItem.globalId,
          epoch: 1,
          epoch_id: epochId,
          hlc_counter: 0,
          hlc_wall_ms: 2_200,
          library_id: libraryId,
          operation_id: "capture-operation-gap",
          payload: { item: gapItem },
          previous_actor_operation_id: "capture-operation-1",
          transaction_id: "capture-transaction-gap",
          transaction_member_count: 1,
          transaction_member_index: 0,
        },
        { digest: coreDigest },
      );
    const gapAssembled = assembleLibraryCoreTransactionV1(
      [gapMember],
      finalized.members[0]!.envelope.actor_chain_digest,
      { digest: coreDigest },
    );
    const gapFinalized = await finalizeLibraryCoreTransactionV1(gapAssembled, {
      digest: coreDigest,
      async signOperation(message) {
        return sign(null, message, actorKeys.privateKey).toString("hex");
      },
    });
    await engine.commitFollowerIntent({
      envelopeBytes: gapFinalized.members.map((value) =>
        encodeLibraryCoreCanonicalValue(
          value.envelope as unknown as LibraryCoreCanonicalValue,
        ),
      ),
    });
    const unsignedGapResult = parseLibraryCoreFollowerResultEnvelopeV1({
      actor_id: actorId,
      authoritative_source_revision: 3,
      authority_key_id: "55".repeat(32),
      canonical_operation_ids: ["canonical-capture-operation-gap"],
      epoch: 1,
      epoch_id: epochId,
      format: "freed_follower_result_v1",
      intent_epoch: 1,
      intent_epoch_id: epochId,
      library_id: libraryId,
      original_result_digest: null,
      previous_result_digest: resultDigest,
      receipt_ids: ["capture-receipt-gap"],
      rejection_reason: null,
      replacement_fields: [],
      resolved_at_ms: 2_300,
      result_body_digest: "0".repeat(64),
      result_sequence: 2,
      schema_version: 1,
      signature: "0".repeat(128),
      signature_algorithm: "ed25519",
      status: "accepted",
      transaction_digest: gapFinalized.transaction_digest,
      transaction_id: "capture-transaction-gap",
    });
    const gapResultDigest = coreDigest(
      "follower-result-body",
      libraryCoreFollowerResultBodyV1(unsignedGapResult),
    );
    const gapResultBytes = encodeLibraryCoreCanonicalValue({
      ...unsignedGapResult,
      result_body_digest: gapResultDigest,
      signature: sign(
        null,
        encodeLibraryCoreSignatureInput("follower-result-envelope", {
          result_body_digest: gapResultDigest,
        }),
        authorityKeys.privateKey,
      ).toString("hex"),
    } as unknown as LibraryCoreCanonicalValue);
    await engine.applyFollowerResult({
      canonicalResultBytes: gapResultBytes,
    });
    expect(
      database.exec({
        sql: `SELECT
                (SELECT source_revision FROM library_meta WHERE singleton_id = 1),
                (SELECT revision FROM library_change_state WHERE singleton_id = 1),
                (SELECT count(*) FROM library_feed_items
                 WHERE global_id = 'captured-item-gap'),
                (SELECT state FROM library_intent_transactions
                 WHERE transaction_id = 'capture-transaction-gap'),
                (SELECT authoritative_source_revision FROM library_intent_results
                 WHERE transaction_id = 'capture-transaction-gap');`,
        rowMode: "array",
        returnValue: "resultRows",
      }),
    ).toEqual([[1, 1, 0, "accepted", 3]]);
  });

  it("materializes an accepted signed RSS lifecycle through generated programs", async () => {
    const libraryId = "11".repeat(32);
    const epochId = "22".repeat(32);
    const actorId = "33".repeat(32);
    const chainGenesis = "44".repeat(32);
    const actorKeys = generateKeyPairSync("ed25519");
    const authorityKeys = generateKeyPairSync("ed25519");
    const actorPublicKey = actorKeys.publicKey
      .export({ format: "der", type: "spki" })
      .subarray(-32)
      .toString("hex");
    const authorityPublicKey = authorityKeys.publicKey
      .export({ format: "der", type: "spki" })
      .subarray(-32)
      .toString("hex");
    const engine = new PwaLibraryCoreSqliteEngine(
      database,
      sqlite3.version.libVersion,
      { now: () => 1_000 },
    );
    engine.initialize();
    database.exec({
      sql: `INSERT INTO library_meta
              (singleton_id, library_id, schema_version, authority_epoch,
               source_revision, updated_at)
            VALUES (1, ?1, 1, ?2, 0, 1000);`,
      bind: [libraryId, epochId],
    });
    database.exec({
      sql: `INSERT INTO library_materialization_generation
              (singleton_id, generation_id) VALUES (1, ?1);`,
      bind: ["99".repeat(32)],
    });
    database.exec({
      sql: `INSERT INTO library_authority_epochs
              (epoch_id, library_id, epoch_number, authority_key_id,
               authority_public_key, transition_certificate_digest,
               canonical_transition_certificate, accepted_manifest_generation,
               checkpoint_frontier_digest, materialized_state_digest, accepted_at)
            VALUES (?1, ?2, 1, ?3, ?4, ?5, '{}', 1, ?6, ?7, 1);`,
      bind: [
        epochId,
        libraryId,
        "55".repeat(32),
        authorityPublicKey,
        "77".repeat(32),
        "88".repeat(32),
        "aa".repeat(32),
      ],
    });
    database.exec({
      sql: `INSERT INTO library_active_authority
              (active_key, library_id, epoch_id, writer_id,
               accepted_manifest_generation, activated_at)
            VALUES ('active', ?1, ?2, 'writer-1', 1, 1);`,
      bind: [libraryId, epochId],
    });
    database.exec({
      sql: `INSERT INTO library_actors
              (actor_id, authority_epoch_id, actor_kind, public_key,
               enrollment_operation_id, enrollment_certificate_digest,
               canonical_enrollment_certificate, chain_genesis_digest,
               accepted_counter, accepted_operation_id, accepted_chain_digest,
               retired_at, created_at, updated_at)
            VALUES (?1, ?2, 'pwa', ?3, 'enroll-rss', ?4, '{}', ?5,
                    0, NULL, ?5, NULL, 1, 1);`,
      bind: [actorId, epochId, actorPublicKey, "bb".repeat(32), chainGenesis],
    });
    database.exec({
      sql: `INSERT INTO library_actor_capabilities
              (capability_id, actor_id, certificate_version, actor_class,
               scope_mode, scope_kind, scope_id, issuance_identity,
               retirement_identity, certificate_digest, canonical_certificate,
               issued_at, retired_at)
            VALUES ('rss-capability', ?1, 2, 'editor', 'library_wide',
                    NULL, NULL, ?2, ?3, ?4, '{}', 1, NULL);`,
      bind: [actorId, "cc".repeat(32), "dd".repeat(32), "ee".repeat(32)],
    });
    database.exec(`INSERT INTO library_actor_capability_mutations
        (capability_id, mutation_id) VALUES
        ('rss-capability', 'rss_feed_upsert'),
        ('rss-capability', 'rss_feed_title_assignment'),
        ('rss-capability', 'rss_feed_remove_keep_items');`);

    const feedUrl = "https://example.com/feed.xml";
    const feed = {
      enabled: true,
      folder: "Reading",
      pollInterval: 900,
      siteUrl: "https://example.com",
      title: "Original title",
      trackUnread: true,
      url: feedUrl,
    };
    const upsertMember = RSS_FEED_UPSERT_TRANSACTION_MEMBER_SCHEMA.construct(
      {
        actor_id: actorId,
        actor_sequence: 1,
        causal_frontier: [],
        created_at_ms: 1_500,
        entity_id: feedUrl,
        epoch: 1,
        epoch_id: epochId,
        hlc_counter: 0,
        hlc_wall_ms: 1_500,
        library_id: libraryId,
        operation_id: "rss-upsert-operation",
        payload: { feed },
        previous_actor_operation_id: null,
        transaction_id: "rss-upsert-transaction",
        transaction_member_count: 1,
        transaction_member_index: 0,
      },
      { digest: coreDigest },
    );
    const upsertFinalized = await finalizeLibraryCoreTransactionV1(
      assembleLibraryCoreTransactionV1([upsertMember], chainGenesis, {
        digest: coreDigest,
      }),
      {
        digest: coreDigest,
        async signOperation(message) {
          return sign(null, message, actorKeys.privateKey).toString("hex");
        },
      },
    );
    await engine.commitFollowerIntent({
      envelopeBytes: upsertFinalized.members.map((value) =>
        encodeLibraryCoreCanonicalValue(
          value.envelope as unknown as LibraryCoreCanonicalValue,
        ),
      ),
    });

    const applyAccepted = async (input: {
      canonicalOperationId: string;
      previousResultDigest: string | null;
      receiptId: string;
      resolvedAt: number;
      resultSequence: number;
      sourceRevision: number;
      transactionDigest: string;
      transactionId: string;
    }): Promise<string> => {
      const unsigned = parseLibraryCoreFollowerResultEnvelopeV1({
        actor_id: actorId,
        authoritative_source_revision: input.sourceRevision,
        authority_key_id: "55".repeat(32),
        canonical_operation_ids: [input.canonicalOperationId],
        epoch: 1,
        epoch_id: epochId,
        format: "freed_follower_result_v1",
        intent_epoch: 1,
        intent_epoch_id: epochId,
        library_id: libraryId,
        original_result_digest: null,
        previous_result_digest: input.previousResultDigest,
        receipt_ids: [input.receiptId],
        rejection_reason: null,
        replacement_fields: [],
        resolved_at_ms: input.resolvedAt,
        result_body_digest: "0".repeat(64),
        result_sequence: input.resultSequence,
        schema_version: 1,
        signature: "0".repeat(128),
        signature_algorithm: "ed25519",
        status: "accepted",
        transaction_digest: input.transactionDigest,
        transaction_id: input.transactionId,
      });
      const digest = coreDigest(
        "follower-result-body",
        libraryCoreFollowerResultBodyV1(unsigned),
      );
      await engine.applyFollowerResult({
        canonicalResultBytes: encodeLibraryCoreCanonicalValue({
          ...unsigned,
          result_body_digest: digest,
          signature: sign(
            null,
            encodeLibraryCoreSignatureInput("follower-result-envelope", {
              result_body_digest: digest,
            }),
            authorityKeys.privateKey,
          ).toString("hex"),
        } as unknown as LibraryCoreCanonicalValue),
      });
      return digest;
    };

    const upsertResultDigest = await applyAccepted({
      canonicalOperationId: "canonical-rss-upsert",
      previousResultDigest: null,
      receiptId: "rss-upsert-receipt",
      resolvedAt: 2_000,
      resultSequence: 1,
      sourceRevision: 1,
      transactionDigest: upsertFinalized.transaction_digest,
      transactionId: "rss-upsert-transaction",
    });
    expect(
      database.exec({
        sql: `SELECT title, enabled, track_unread, folder, updated_at
              FROM library_rss_feeds WHERE url = ?1;`,
        bind: [feedUrl],
        rowMode: "array",
        returnValue: "resultRows",
      }),
    ).toEqual([["Original title", 1, 1, "Reading", 2_000]]);

    const titleMember =
      RSS_FEED_TITLE_ASSIGNMENT_TRANSACTION_MEMBER_SCHEMA.construct(
        {
          actor_id: actorId,
          actor_sequence: 2,
          causal_frontier: [],
          created_at_ms: 2_100,
          entity_id: feedUrl,
          epoch: 1,
          epoch_id: epochId,
          hlc_counter: 0,
          hlc_wall_ms: 2_100,
          library_id: libraryId,
          operation_id: "rss-title-operation",
          payload: { assigned_at_ms: 2_100, title: "Renamed title" },
          previous_actor_operation_id: "rss-upsert-operation",
          transaction_id: "rss-title-transaction",
          transaction_member_count: 1,
          transaction_member_index: 0,
        },
        { digest: coreDigest },
      );
    const titleFinalized = await finalizeLibraryCoreTransactionV1(
      assembleLibraryCoreTransactionV1(
        [titleMember],
        upsertFinalized.members[0]!.envelope.actor_chain_digest,
        { digest: coreDigest },
      ),
      {
        digest: coreDigest,
        async signOperation(message) {
          return sign(null, message, actorKeys.privateKey).toString("hex");
        },
      },
    );
    await engine.commitFollowerIntent({
      envelopeBytes: titleFinalized.members.map((value) =>
        encodeLibraryCoreCanonicalValue(
          value.envelope as unknown as LibraryCoreCanonicalValue,
        ),
      ),
    });
    const titleResultDigest = await applyAccepted({
      canonicalOperationId: "canonical-rss-title",
      previousResultDigest: upsertResultDigest,
      receiptId: "rss-title-receipt",
      resolvedAt: 2_200,
      resultSequence: 2,
      sourceRevision: 2,
      transactionDigest: titleFinalized.transaction_digest,
      transactionId: "rss-title-transaction",
    });
    expect(
      database.exec({
        sql: `SELECT title, updated_at,
                     (SELECT updated_at FROM library_field_clocks
                      WHERE entity_type = 'rss_feed' AND entity_id = ?1
                        AND field_path = 'title')
              FROM library_rss_feeds WHERE url = ?1;`,
        bind: [feedUrl],
        rowMode: "array",
        returnValue: "resultRows",
      }),
    ).toEqual([["Renamed title", 2_200, 2_100]]);

    const removeMember =
      RSS_FEED_REMOVE_KEEP_ITEMS_TRANSACTION_MEMBER_SCHEMA.construct(
        {
          actor_id: actorId,
          actor_sequence: 3,
          causal_frontier: [],
          created_at_ms: 2_300,
          entity_id: feedUrl,
          epoch: 1,
          epoch_id: epochId,
          hlc_counter: 0,
          hlc_wall_ms: 2_300,
          library_id: libraryId,
          operation_id: "rss-remove-operation",
          payload: { removed_at_ms: 2_300 },
          previous_actor_operation_id: "rss-title-operation",
          transaction_id: "rss-remove-transaction",
          transaction_member_count: 1,
          transaction_member_index: 0,
        },
        { digest: coreDigest },
      );
    const removeFinalized = await finalizeLibraryCoreTransactionV1(
      assembleLibraryCoreTransactionV1(
        [removeMember],
        titleFinalized.members[0]!.envelope.actor_chain_digest,
        { digest: coreDigest },
      ),
      {
        digest: coreDigest,
        async signOperation(message) {
          return sign(null, message, actorKeys.privateKey).toString("hex");
        },
      },
    );
    await engine.commitFollowerIntent({
      envelopeBytes: removeFinalized.members.map((value) =>
        encodeLibraryCoreCanonicalValue(
          value.envelope as unknown as LibraryCoreCanonicalValue,
        ),
      ),
    });
    await applyAccepted({
      canonicalOperationId: "canonical-rss-remove",
      previousResultDigest: titleResultDigest,
      receiptId: "rss-remove-receipt",
      resolvedAt: 2_400,
      resultSequence: 3,
      sourceRevision: 3,
      transactionDigest: removeFinalized.transaction_digest,
      transactionId: "rss-remove-transaction",
    });
    expect(
      database.exec({
        sql: `SELECT
                (SELECT count(*) FROM library_rss_feeds WHERE url = ?1),
                (SELECT deleted_at FROM library_tombstones
                 WHERE entity_type = 'rss_feed' AND entity_id = ?1),
                (SELECT source_revision FROM library_meta WHERE singleton_id = 1);`,
        bind: [feedUrl],
        rowMode: "array",
        returnValue: "resultRows",
      }),
    ).toEqual([[0, 2_300, 3]]);
    expect(
      database.exec({
        sql: `SELECT revision, ordinal, topic, entity_id, reset_required
              FROM library_invalidations ORDER BY revision, ordinal;`,
        rowMode: "array",
        returnValue: "resultRows",
      }),
    ).toEqual([
      [1, 0, "rss_feed", feedUrl, 0],
      [2, 0, "rss_feed", feedUrl, 0],
      [3, 0, "rss_feed", feedUrl, 0],
    ]);
  });

  it("refuses a foreign SQLite application identity before creating tables", () => {
    database.exec("PRAGMA application_id = 7;");
    const engine = new PwaLibraryCoreSqliteEngine(
      database,
      sqlite3.version.libVersion,
    );
    expect(() => engine.initialize()).toThrow(/identity is foreign/);
    expect(
      database.exec({
        sql: "SELECT count(*) FROM sqlite_schema WHERE type = 'table';",
        rowMode: 0,
        returnValue: "resultRows",
      }),
    ).toEqual([0]);
  });

  it("pages normalized feed rows through the bounded named query", () => {
    const engine = new PwaLibraryCoreSqliteEngine(
      database,
      sqlite3.version.libVersion,
    );
    engine.initialize();
    database.exec(`
      INSERT INTO library_meta
        (singleton_id, library_id, schema_version, authority_epoch, source_revision, updated_at)
      VALUES (1, '${"a".repeat(64)}', 1, 'epoch-1', 7, 1000);
      INSERT INTO library_materialization_generation
        (singleton_id, generation_id)
      VALUES (1, '${"a".repeat(64)}');
      UPDATE library_change_state SET revision = 7 WHERE singleton_id = 1;
      INSERT INTO library_rss_feeds
        (url, title, image_url, enabled, track_unread, updated_at)
      VALUES
        ('https://alpha.example/feed', 'Alpha', NULL, 1, 1, 200),
        ('https://beta.example/feed', 'Beta', 'https://beta.example/icon.png', 0, 1, 210);
      INSERT INTO library_feed_items
        (global_id, platform, content_type, captured_at, published_at,
         author_id, author_handle, author_display_name, author_avatar_url,
         rss_feed_url, content_text,
         hidden, saved, archived, updated_at)
      VALUES
        ('item-2', 'x', 'article', 200, 200, 'ada-remote', 'ada', 'Ada', NULL, NULL, 'newer', 0, 1, 0, 200),
        ('item-1', 'rss', 'article', 100, 100, 'alpha', 'grace', 'Grace', 'https://alpha.example/avatar.png', 'https://alpha.example/feed', 'older', 0, 0, 0, 100),
        ('hidden', 'saved', 'post', 300, 300, 'author-3', 'hidden', 'Hidden', NULL, NULL, 'nope', 1, 0, 0, 300);
      INSERT INTO library_feed_item_tags (global_id, tag) VALUES ('item-2', 'favorite');
      INSERT INTO library_feed_item_media (global_id, ordinal, source_url, media_type)
      VALUES ('item-2', 0, 'https://example.com/image', 'image');
      INSERT INTO library_persons
        (id, name, avatar_url, bio, relationship_status, care_level,
         reach_out_interval_days, notes, created_at, updated_at)
      VALUES
        ('person-1', 'Ada', 'https://example.com/ada', 'Mathematician',
         'friend', 5, 14, 'Write soon', 50, 200),
        ('person-2', 'Grace', NULL, NULL, 'friend', 4, NULL, NULL, 60, 210);
      INSERT INTO library_person_tags (person_id, tag)
      VALUES ('person-1', 'close'), ('person-1', 'science');
      INSERT INTO library_person_reach_outs
        (person_id, reach_out_id, logged_at, channel, notes)
      VALUES
        ('person-1', 'reach-2', 200, 'text', 'Latest'),
        ('person-1', 'reach-1', 100, NULL, NULL);
      INSERT INTO library_accounts
        (id, person_id, kind, provider, external_id, handle, display_name,
         first_seen_at, last_seen_at, discovered_from, follow_roster_active,
         follow_roster_synced_at, created_at, updated_at)
      VALUES
        ('account-1', 'person-1', 'social', 'x', 'ada-remote', 'ada', 'Ada',
         50, 200, 'capture', 1, 200, 50, 200),
        ('account-2', 'person-2', 'social', 'x', 'grace-remote', 'grace', 'Grace',
         60, 210, 'capture', NULL, NULL, 60, 210),
        ('account-3', 'person-1', 'rss', 'rss', 'alpha', 'alpha', 'Alpha',
         70, 220, 'capture', NULL, NULL, 70, 220);
      INSERT INTO library_account_follow_roles (account_id, role)
      VALUES ('account-1', 'following'), ('account-1', 'follower');
    `);
    const personPosition = {
      entityId: "person-1",
      graphX: 12.5,
      graphY: -8.25,
      mutationId: "person_graph_position_set_v1" as const,
      schemaVersion: 1 as const,
      updatedAt: 300,
    };
    expect(engine.mutateDeviceGraphLayout(personPosition)).toMatchObject({
      changed: true,
      mutationId: "person_graph_position_set_v1",
    });
    expect(engine.mutateDeviceGraphLayout(personPosition).changed).toBe(false);
    expect(
      engine.mutateDeviceGraphLayout({
        entityId: "person-1",
        mutationId: "person_graph_position_clear_v1",
        schemaVersion: 1,
      }).changed,
    ).toBe(true);
    expect(
      engine.mutateDeviceGraphLayout({
        entityId: "person-1",
        mutationId: "person_graph_position_clear_v1",
        schemaVersion: 1,
      }).changed,
    ).toBe(false);
    expect(engine.mutateDeviceGraphLayout(personPosition).changed).toBe(true);
    expect(
      engine.mutateDeviceGraphLayout({
        entityId: "account-1",
        graphX: -4.5,
        graphY: 6.75,
        mutationId: "account_graph_position_set_v1",
        schemaVersion: 1,
        updatedAt: 301,
      }).changed,
    ).toBe(true);
    expect(() =>
      engine.mutateDeviceGraphLayout({
        entityId: "missing",
        mutationId: "account_graph_position_clear_v1",
        schemaVersion: 1,
      }),
    ).toThrow("target is unavailable");
    expect(
      database.exec({
        sql: "SELECT source_revision FROM library_meta WHERE singleton_id = 1;",
        rowMode: 0,
        returnValue: "resultRows",
      }),
    ).toEqual([7]);
    expect(
      database.exec({
        sql: "SELECT count(*) FROM library_replication_outbox;",
        rowMode: 0,
        returnValue: "resultRows",
      }),
    ).toEqual([0]);
    const blobDigest = "7".repeat(64);
    const firstChunk = new Uint8Array(65_536).fill(11);
    const secondChunk = Uint8Array.from([21, 22, 23, 24, 25, 26, 27, 28]);
    database.exec({
      sql: `INSERT INTO library_blobs
              (content_digest, byte_length, chunk_bytes, chunk_count, media_type)
            VALUES (?1, ?2, 65536, 2, 'text/plain');`,
      bind: [blobDigest, firstChunk.byteLength + secondChunk.byteLength],
    });
    database.exec({
      sql: `INSERT INTO library_blob_chunks
              (content_digest, chunk_index, chunk_digest, bytes)
            VALUES (?1, 0, ?2, ?3), (?1, 1, ?4, ?5);`,
      bind: [
        blobDigest,
        "8".repeat(64),
        firstChunk,
        "9".repeat(64),
        secondChunk,
      ],
    });
    database.exec({
      sql: `UPDATE library_feed_items
            SET preserved_text_blob_digest = ?1
            WHERE global_id = 'item-2';`,
      bind: [blobDigest],
    });
    const request = {
      cancellationId: operationId("cancel-1"),
      cursor: null,
      limit: 1,
      queryId: "feed_page_v1" as const,
      readerSessionId: operationId("reader-1"),
      schemaVersion: 1 as const,
    };
    const first = engine.query(request);
    expect(first.totalCount).toBe(2);
    expect(first.rows.map((row) => row.globalId)).toEqual(["item-2"]);
    expect(first.rows[0]?.tags).toEqual(["favorite"]);
    expect(first.rows[0]?.mediaUrls).toEqual(["https://example.com/image"]);
    expect(first.nextCursor).not.toBeNull();
    const second = engine.query({
      ...request,
      cursor: first.nextCursor,
    });
    expect(second.rows.map((row) => row.globalId)).toEqual(["item-1"]);
    expect(second.nextCursor).toBeNull();
    const timelineRequest = {
      cancellationId: operationId("cancel-person-timeline-1"),
      cursor: null,
      limit: 1,
      personId: "person-1",
      queryId: "person_timeline_v1" as const,
      readerSessionId: operationId("reader-person-timeline-1"),
      schemaVersion: 1 as const,
    };
    const firstTimeline = engine.query(timelineRequest);
    expect(firstTimeline.totalCount).toBe(2);
    expect(firstTimeline.rows.map((row) => row.globalId)).toEqual(["item-2"]);
    expect(firstTimeline.nextCursor).not.toBeNull();
    expect(
      engine
        .query({
          ...timelineRequest,
          cursor: firstTimeline.nextCursor,
        })
        .rows.map((row) => row.globalId),
    ).toEqual(["item-1"]);
    expect(() =>
      engine.query({
        ...timelineRequest,
        cursor: firstTimeline.nextCursor,
        personId: "person-2",
      }),
    ).toThrow("different person");
    const accountTimeline = engine.query({
      accountId: "account-1",
      cancellationId: operationId("cancel-account-timeline-1"),
      cursor: null,
      limit: 10,
      queryId: "account_timeline_v1" as const,
      readerSessionId: operationId("reader-account-timeline-1"),
      schemaVersion: 1 as const,
    });
    expect(accountTimeline.totalCount).toBe(1);
    expect(accountTimeline.rows.map((row) => row.globalId)).toEqual(["item-2"]);
    const search = engine.query({
      cancellationId: operationId("cancel-search-1"),
      cursor: null,
      filter: {
        archivedOnly: false,
        authorId: null,
        feedUrl: null,
        platform: null,
        savedOnly: false,
        schemaVersion: 1,
        showHidden: false,
        signals: [],
        socialContentFilter: "all",
        tags: [],
      },
      friendsPredicateSchemaVersion: 1,
      identityMode: "friends",
      limit: 32,
      query: "Ada",
      queryId: "search_page_v1" as const,
      readerSessionId: operationId("reader-search-1"),
      recommendationOrderSchemaVersion: 1,
      schemaVersion: 1 as const,
    });
    expect(search.scannedRows).toBe(2);
    expect(search.rows.map((row) => row.card.globalId)).toEqual(["item-2"]);
    expect(search.rows[0]?.score).toBeGreaterThan(0);
    expect(search.nextCursor).toBeNull();
    database.exec(
      "UPDATE library_accounts SET person_id = 'person-2' WHERE id = 'account-1';",
    );
    expect(
      engine
        .query({
          ...timelineRequest,
          limit: 10,
          personId: "person-2",
        })
        .rows.map((row) => row.globalId),
    ).toEqual(["item-2"]);
    database.exec(
      "UPDATE library_accounts SET person_id = 'person-1' WHERE id = 'account-1';",
    );
    database.exec(`
      UPDATE library_feed_items
      SET location_name = 'Observatory', location_lat = 34.2, location_lng = -118.2
      WHERE global_id = 'item-2';
      UPDATE library_feed_items
      SET location_name = 'Library', location_lat = 34.1, location_lng = -118.1
      WHERE global_id = 'item-1';
      INSERT INTO library_feed_item_media (global_id, ordinal, source_url, media_type)
      VALUES ('item-1', 0, 'https://example.com/older-image', 'image');
    `);
    const mapMarkers = engine.query({
      cancellationId: operationId("cancel-map-1"),
      limit: 1,
      queryId: "map_markers_v1" as const,
      readerSessionId: operationId("reader-map-1"),
      schemaVersion: 1 as const,
    });
    expect(mapMarkers.hasMore).toBe(true);
    expect(mapMarkers.rows).toMatchObject([
      { globalId: "item-2", locationName: "Observatory" },
    ]);
    expect(mapMarkers.rows[0]).not.toHaveProperty("tags");
    expect(mapMarkers.rows[0]).not.toHaveProperty("mediaUrls");
    const storyCandidates = engine.query({
      cancellationId: operationId("cancel-story-wall-1"),
      limit: 1,
      queryId: "story_wall_candidates_v1" as const,
      readerSessionId: operationId("reader-story-wall-1"),
      schemaVersion: 1 as const,
    });
    expect(storyCandidates.hasMore).toBe(true);
    expect(storyCandidates.rows).toMatchObject([
      { globalId: "item-2", mediaUrls: ["https://example.com/image"] },
    ]);
    expect(storyCandidates.rows[0]).not.toHaveProperty("contentType");
    const scanRequest = {
      cancellationId: operationId("cancel-scan-1"),
      cursor: null,
      limit: 2,
      queryId: "background_item_page_v1" as const,
      readerSessionId: operationId("reader-scan-1"),
      schemaVersion: 1 as const,
    };
    const firstScan = engine.query(scanRequest);
    expect(firstScan.rows.map((row) => row.globalId)).toEqual([
      "hidden",
      "item-1",
    ]);
    expect(firstScan.nextCursor).not.toBeNull();
    const secondScan = engine.query({
      ...scanRequest,
      cursor: firstScan.nextCursor,
    });
    expect(secondScan.rows.map((row) => row.globalId)).toEqual(["item-2"]);
    expect(secondScan.nextCursor).toBeNull();
    database.exec(`
      INSERT INTO library_invalidations
        (revision, ordinal, topic, entity_id, reset_required)
      VALUES
        (1, 0, 'library', NULL, 1),
        (2, 0, 'feed_item', 'item-1', 0),
        (3, 0, 'feed_item', 'item-2', 0),
        (4, 0, 'preferences', NULL, 0),
        (5, 0, 'feed_item', 'hidden', 0),
        (6, 0, 'feed_item', 'item-1', 0),
        (7, 0, 'feed_item', 'item-2', 0);
    `);
    const changeRequest = {
      afterRevision: 0,
      cancellationId: operationId("cancel-changes-1"),
      cursor: null,
      limit: 4,
      queryId: "change_feed_v1" as const,
      readerSessionId: operationId("reader-changes-1"),
      schemaVersion: 1 as const,
    };
    const firstChanges = engine.query(changeRequest);
    expect(firstChanges.rows.map((row) => row.revision)).toEqual([1, 2, 3, 4]);
    expect(firstChanges.rows[0]).toMatchObject({
      entityId: null,
      resetRequired: true,
      topic: "library",
    });
    expect(firstChanges.nextCursor).not.toBeNull();
    expect(
      engine.query({
        globalId: "item-2",
        queryId: "item_detail_v1",
        schemaVersion: 1,
      }),
    ).toMatchObject({
      item: {
        card: { contentText: "newer", globalId: "item-2" },
        contentBody: { blobDigest: null, storage: "inline" },
        preservedBody: { blobDigest, storage: "blob" },
      },
      queryId: "item_detail_v1",
      source: { projectionRevision: 7 },
    });
    expect(
      engine.query({
        globalId: "missing",
        queryId: "item_detail_v1",
        schemaVersion: 1,
      }).item,
    ).toBeNull();
    expect(
      engine.query({
        personId: "person-1",
        queryId: "person_detail_v1",
        schemaVersion: 1,
      }),
    ).toMatchObject({
      person: {
        id: "person-1",
        name: "Ada",
        reachOuts: [
          { loggedAt: 200, notes: "Latest", reachOutId: "reach-2" },
          { loggedAt: 100, notes: null, reachOutId: "reach-1" },
        ],
        tags: ["close", "science"],
      },
      queryId: "person_detail_v1",
      source: { projectionRevision: 7 },
    });
    expect(
      engine.query({
        personId: "missing",
        queryId: "person_detail_v1",
        schemaVersion: 1,
      }).person,
    ).toBeNull();
    expect(
      engine.query({
        accountId: "account-1",
        queryId: "account_detail_v1",
        schemaVersion: 1,
      }),
    ).toMatchObject({
      account: {
        followRosterActive: true,
        followRosterRoles: ["follower", "following"],
        id: "account-1",
        personId: "person-1",
      },
      queryId: "account_detail_v1",
      source: { projectionRevision: 7 },
    });
    expect(
      engine.query({
        accountId: "missing",
        queryId: "account_detail_v1",
        schemaVersion: 1,
      }).account,
    ).toBeNull();
    const personGraphRequest = {
      cancellationId: operationId("cancel-person-graph-1"),
      cursor: null,
      limit: 1,
      queryId: "person_graph_page_v1" as const,
      readerSessionId: operationId("reader-person-graph-1"),
      schemaVersion: 1 as const,
    };
    const firstPersonGraphPage = engine.query(personGraphRequest);
    expect(firstPersonGraphPage.layoutRevision).toBe(4);
    expect(firstPersonGraphPage.rows.map((row) => row.id)).toEqual([
      "person-1",
    ]);
    expect(firstPersonGraphPage.rows[0]?.lastReachOutAt).toBe(200);
    expect(firstPersonGraphPage.rows[0]).toMatchObject({
      graphPinned: true,
      graphUpdatedAt: 300,
      graphX: 12.5,
      graphY: -8.25,
    });
    expect(
      engine.mutateDeviceGraphLayout({
        entityId: "account-2",
        graphX: 1,
        graphY: 2,
        mutationId: "account_graph_position_set_v1",
        schemaVersion: 1,
        updatedAt: 302,
      }).layoutRevision,
    ).toBe(5);
    expect(() =>
      engine.query({
        ...personGraphRequest,
        cursor: firstPersonGraphPage.nextCursor,
      }),
    ).toThrow("cursor is stale");
    const refreshedPersonGraphPage = engine.query(personGraphRequest);
    expect(
      engine
        .query({
          ...personGraphRequest,
          cursor: refreshedPersonGraphPage.nextCursor,
        })
        .rows.map((row) => row.id),
    ).toEqual(["person-2"]);
    const accountGraphRequest = {
      cancellationId: operationId("cancel-account-graph-1"),
      cursor: null,
      limit: 1,
      queryId: "account_graph_page_v1" as const,
      readerSessionId: operationId("reader-account-graph-1"),
      schemaVersion: 1 as const,
    };
    const firstAccountGraphPage = engine.query(accountGraphRequest);
    expect(firstAccountGraphPage.layoutRevision).toBe(5);
    expect(firstAccountGraphPage.rows).toMatchObject([
      {
        activityCount: 1,
        graphPinned: true,
        graphUpdatedAt: 301,
        graphX: -4.5,
        graphY: 6.75,
        id: "account-1",
        latestActivityAt: 200,
      },
    ]);
    expect(
      engine
        .query({
          ...accountGraphRequest,
          cursor: firstAccountGraphPage.nextCursor,
        })
        .rows.map((row) => row.id),
    ).toEqual(["account-2"]);
    const rssFeedGraphRequest = {
      cancellationId: operationId("cancel-rss-feed-graph-1"),
      cursor: null,
      limit: 1,
      queryId: "rss_feed_graph_page_v1" as const,
      readerSessionId: operationId("reader-rss-feed-graph-1"),
      schemaVersion: 1 as const,
    };
    const firstRssFeedGraphPage = engine.query(rssFeedGraphRequest);
    expect(firstRssFeedGraphPage.rows).toMatchObject([
      {
        activityCount: 1,
        enabled: true,
        imageUrl: "https://alpha.example/avatar.png",
        latestActivityAt: 100,
        title: "Alpha",
        url: "https://alpha.example/feed",
      },
    ]);
    expect(
      engine
        .query({
          ...rssFeedGraphRequest,
          cursor: firstRssFeedGraphPage.nextCursor,
        })
        .rows.map((row) => row.url),
    ).toEqual(["https://beta.example/feed"]);
    const inlineBody = engine.query({
      bodyKind: "content",
      globalId: "item-2",
      limitBytes: 3,
      offsetBytes: 1,
      queryId: "item_reader_body_v1",
      schemaVersion: 1,
    }).body;
    expect(inlineBody).toMatchObject({
      blobDigest: null,
      contentLength: 5,
      endOffset: 4,
      startOffset: 1,
      storage: "inline",
    });
    expect(
      new TextDecoder().decode(
        decodeLibraryCoreCanonicalBase64(inlineBody?.bytesBase64 ?? ""),
      ),
    ).toBe("ewe");
    const blobBody = engine.query({
      bodyKind: "preserved",
      globalId: "item-2",
      limitBytes: 6,
      offsetBytes: 65_534,
      queryId: "item_reader_body_v1",
      schemaVersion: 1,
    }).body;
    expect(blobBody).toMatchObject({
      blobDigest,
      contentLength: 65_544,
      endOffset: 65_540,
      startOffset: 65_534,
      storage: "blob",
    });
    expect(
      decodeLibraryCoreCanonicalBase64(blobBody?.bytesBase64 ?? ""),
    ).toEqual(Uint8Array.from([11, 11, 21, 22, 23, 24]));
    expect(
      engine.query({
        bodyKind: "preserved",
        globalId: "missing",
        limitBytes: 1,
        offsetBytes: 0,
        queryId: "item_reader_body_v1",
        schemaVersion: 1,
      }).body,
    ).toBeNull();
    expect(() =>
      engine.query({
        bodyKind: "content",
        globalId: "item-2",
        limitBytes: 1,
        offsetBytes: 6,
        queryId: "item_reader_body_v1",
        schemaVersion: 1,
      }),
    ).toThrow(/offset exceeds content length/);
    expect(
      engine.query({
        queryId: "library_facet_summary_v1",
        schemaVersion: 1,
      }),
    ).toMatchObject({
      queryId: "library_facet_summary_v1",
      source: { projectionRevision: 7 },
      summary: {
        archivedCount: 0,
        sampleItemCount: 0,
        savedArchivedCount: 0,
        savedCount: 1,
        savedPlatformCount: 1,
        tags: ["favorite"],
        totalCount: 3,
      },
    });
    const analyticsWindows = (count: number) =>
      Array.from({ length: count }, (_, index) => ({
        endMs: (index + 1) * 100,
        startMs: index * 100,
      }));
    expect(
      engine.query({
        dailyWindows: analyticsWindows(7),
        hourlyWindows: analyticsWindows(24),
        queryId: "saved_analytics_v2",
        schemaVersion: 2,
      }),
    ).toMatchObject({
      contentMix: [{ count: 1, label: "article" }],
      dailyCounts: [0, 0, 1, 0, 0, 0, 0],
      latestSavedAt: 200,
      queryId: "saved_analytics_v2",
      source: { projectionRevision: 7 },
      sourceCounts: [{ count: 1, label: "x" }],
      totalCount: 1,
    });
    database.exec(`
      INSERT INTO library_preferences
        (path, value_type, boolean_value, integer_value, real_value, text_value, updated_at)
      VALUES
        ('v:$.zeta', 'boolean', 1, NULL, NULL, NULL, 1),
        ('v:$.alpha', 'integer', NULL, 3, NULL, NULL, 2),
        ('v:$.realValue', 'real', NULL, NULL, 0.5, NULL, 3),
        ('v:$.textValue', 'text', NULL, NULL, NULL, 'neon', 4),
        ('v:$.nullValue', 'null', NULL, NULL, NULL, NULL, 5);
    `);
    expect(
      engine.query({
        queryId: "preferences_snapshot_v1",
        schemaVersion: 1,
      }),
    ).toMatchObject({
      queryId: "preferences_snapshot_v1",
      rows: [
        { integerValue: 3, path: "v:$.alpha", valueType: "integer" },
        { path: "v:$.nullValue", valueType: "null" },
        { path: "v:$.realValue", realValue: 0.5, valueType: "real" },
        { path: "v:$.textValue", textValue: "neon", valueType: "text" },
        { booleanValue: true, path: "v:$.zeta", valueType: "boolean" },
      ],
      source: { projectionRevision: 7 },
    });
    database.exec(`
      UPDATE library_meta SET source_revision = 8 WHERE singleton_id = 1;
      UPDATE library_change_state SET revision = 8 WHERE singleton_id = 1;
      INSERT INTO library_invalidations
        (revision, ordinal, topic, entity_id, reset_required)
      VALUES (8, 0, 'feed_item', 'item-1', 0);
    `);
    const secondChanges = engine.query({
      ...changeRequest,
      cursor: firstChanges.nextCursor,
    });
    expect(secondChanges.rows.map((row) => row.revision)).toEqual([5, 6, 7]);
    expect(secondChanges.source.projectionRevision).toBe(7);
    expect(secondChanges.nextCursor).toBeNull();
    expect(
      engine.query({ ...changeRequest, afterRevision: 7, cursor: null }).rows,
    ).toMatchObject([{ revision: 8, entityId: "item-1" }]);
    expect(() =>
      engine.query({ ...scanRequest, cursor: firstScan.nextCursor }),
    ).toThrow(/cursor is stale/);
    expect(() =>
      engine.query({
        ...personGraphRequest,
        cursor: firstPersonGraphPage.nextCursor,
      }),
    ).toThrow(/cursor is stale/);
    expect(() =>
      engine.query({
        ...accountGraphRequest,
        cursor: firstAccountGraphPage.nextCursor,
      }),
    ).toThrow(/cursor is stale/);
    expect(() =>
      engine.query({
        ...rssFeedGraphRequest,
        cursor: firstRssFeedGraphPage.nextCursor,
      }),
    ).toThrow(/cursor is stale/);
  });

  it("pages the ranked feed forward and backward through one indexed contract", () => {
    const engine = new PwaLibraryCoreSqliteEngine(
      database,
      sqlite3.version.libVersion,
    );
    engine.initialize();
    database.exec(`
      INSERT INTO library_meta
        (singleton_id, library_id, schema_version, authority_epoch, source_revision, updated_at)
      VALUES (1, '${"a".repeat(64)}', 1, 'epoch-1', 7, 1000);
      INSERT INTO library_materialization_generation
        (singleton_id, generation_id)
      VALUES (1, '${"a".repeat(64)}');
      UPDATE library_change_state SET revision = 7 WHERE singleton_id = 1;
      INSERT INTO library_feed_items
        (global_id, platform, content_type, captured_at, published_at,
         author_id, author_handle, author_display_name, rss_feed_url,
         priority, hidden, saved, archived, updated_at)
      VALUES
        ('a', 'x', 'post', 300, 300, 'ada', 'ada', 'Ada', NULL, 90.4, 0, 1, 0, 300),
        ('b', 'x', 'post', 300, 300, 'ada', 'ada', 'Ada', NULL, 90.4, 0, 0, 0, 300),
        ('c', 'saved', 'article', 400, 400, 'grace', 'grace', 'Grace', 'https://example.com/feed', 80, 0, 0, 0, 400),
        ('story', 'x', 'story', 500, 500, 'ada', 'ada', 'Ada', NULL, 95, 0, 0, 0, 500),
        ('hidden', 'x', 'post', 600, 600, 'ada', 'ada', 'Ada', NULL, 100, 1, 0, 0, 600),
        ('archived', 'x', 'post', 700, 700, 'ada', 'ada', 'Ada', NULL, 99, 0, 0, 1, 700);
      INSERT INTO library_feed_item_tags (global_id, tag)
      VALUES ('a', 'important');
      INSERT INTO library_feed_item_signal_scores (global_id, signal, score, tagged)
      VALUES ('a', 'essay', 1.0, 1);
      INSERT INTO library_persons
        (id, name, relationship_status, care_level, created_at, updated_at)
      VALUES
        ('person-ada', 'Ada', 'friend', 5, 1, 1),
        ('person-grace', 'Grace', 'connection', 3, 1, 1);
      INSERT INTO library_accounts
        (id, person_id, kind, provider, external_id, first_seen_at,
         last_seen_at, discovered_from, created_at, updated_at)
      VALUES
        ('account-ada', 'person-ada', 'social', 'x', 'ada', 1, 1, 'capture', 1, 1),
        ('account-grace', 'person-grace', 'social', 'saved', 'grace', 1, 1, 'capture', 1, 1);
    `);
    const program = LIBRARY_CORE_SQLITE_QUERY_PROGRAMS.feed_browse_page_v3;
    const planBindings = [
      0,
      0,
      null,
      null,
      null,
      "posts",
      0,
      "[]",
      "[]",
      "all_content",
      null,
      null,
      "",
      3,
    ];
    for (const sql of [program.sql, program.reverseSql]) {
      const details = database
        .exec({
          sql: `EXPLAIN QUERY PLAN ${sql}`,
          bind: planBindings,
          rowMode: "array",
          returnValue: "resultRows",
        })
        .map((row) => String((row as unknown[])[3]));
      expect(
        details.some((detail) =>
          detail.includes("library_feed_items_browse_rank_all"),
        ),
      ).toBe(true);
      expect(details.every((detail) => !detail.includes("TEMP B-TREE"))).toBe(
        true,
      );
    }
    const filter: LibraryCoreFeedBrowseFilterV1 = {
      archivedOnly: false,
      authorId: null,
      feedUrl: null,
      platform: null,
      savedOnly: false,
      schemaVersion: 1 as const,
      showHidden: false,
      signals: [] as const,
      socialContentFilter: "posts" as const,
      tags: [] as const,
    };
    const request = {
      cancellationId: operationId("cancel-browse-1"),
      cursor: null,
      direction: "next" as const,
      filter,
      friendsPredicateSchemaVersion: 1 as const,
      identityMode: "all_content" as const,
      limit: 2,
      queryId: "feed_browse_page_v3" as const,
      rankingClockMs: 1_000,
      readerSessionId: operationId("reader-browse-1"),
      recommendationOrderSchemaVersion: 1 as const,
      schemaVersion: 3 as const,
    };
    const first = engine.query(request);
    expect(first.totalCount).toBe(3);
    expect(first.rows.map((row) => row.globalId)).toEqual(["a", "b"]);
    expect(first.previousCursor).toBeNull();
    expect(first.nextCursor).not.toBeNull();
    const second = engine.query({ ...request, cursor: first.nextCursor });
    expect(second.rows.map((row) => row.globalId)).toEqual(["c"]);
    expect(second.nextCursor).toBeNull();
    expect(second.previousCursor).not.toBeNull();
    const previous = engine.query({
      ...request,
      cursor: second.previousCursor,
      direction: "previous",
    });
    expect(previous.rows.map((row) => row.globalId)).toEqual(["a", "b"]);
    expect(previous.nextCursor).not.toBeNull();
    expect(previous.previousCursor).toBeNull();

    const matching = (filterOverrides: Partial<typeof filter>) =>
      engine
        .query({
          ...request,
          filter: { ...filter, ...filterOverrides },
          limit: 10,
        })
        .rows.map((row) => row.globalId);
    expect(matching({ savedOnly: true })).toEqual(["a"]);
    expect(matching({ tags: ["important"] })).toEqual(["a"]);
    expect(matching({ signals: ["essay"] })).toEqual(["a"]);
    expect(matching({ platform: "rss" })).toEqual(["c"]);
    expect(matching({ showHidden: true })).toEqual(["hidden", "a", "b", "c"]);
    expect(matching({ archivedOnly: true })).toEqual(["archived"]);
    expect(matching({ socialContentFilter: "stories" })).toEqual(["story"]);
    expect(
      engine
        .query({ ...request, identityMode: "friends", limit: 10 })
        .rows.map((row) => row.globalId),
    ).toEqual(["a", "b"]);
    expect(() =>
      engine.query({
        ...request,
        cursor: first.nextCursor,
        identityMode: "friends",
      }),
    ).toThrow("cursor belongs to a different filter");
    expect(() =>
      engine.query({
        ...request,
        cursor: first.nextCursor,
        filter: { ...filter, savedOnly: true },
      }),
    ).toThrow("cursor belongs to a different filter");

    database.exec(
      "UPDATE library_meta SET source_revision = 8 WHERE singleton_id = 1; UPDATE library_change_state SET revision = 8 WHERE singleton_id = 1;",
    );
    expect(() =>
      engine.query({ ...request, cursor: first.nextCursor }),
    ).toThrow("browse cursor is stale");
  });

  it("runs every Saved order and both page directions through matching indexes", () => {
    const engine = new PwaLibraryCoreSqliteEngine(
      database,
      sqlite3.version.libVersion,
    );
    engine.initialize();
    database.exec(`
      INSERT INTO library_meta
        (singleton_id, library_id, schema_version, authority_epoch, source_revision, updated_at)
      VALUES (1, '${"a".repeat(64)}', 1, 'epoch-1', 12, 1000);
      INSERT INTO library_materialization_generation
        (singleton_id, generation_id)
      VALUES (1, '${"a".repeat(64)}');
      UPDATE library_change_state SET revision = 12 WHERE singleton_id = 1;
      INSERT INTO library_feed_items
        (global_id, platform, content_type, captured_at, published_at,
         author_id, author_handle, author_display_name, priority,
         preserved_reading_time, hidden, saved, saved_at, archived, updated_at)
      VALUES
        ('saved:a', 'saved', 'article', 50, 400, 'author', 'author', 'Author', 10, 5, 0, 1, 100, 0, 400),
        ('saved:b', 'saved', 'article', 60, 100, 'author', 'author', 'Author', 90, NULL, 0, 1, 300, 0, 300),
        ('saved:c', 'saved', 'article', 70, 300, 'author', 'author', 'Author', 90, 2, 0, 1, 200, 0, 300),
        ('saved:d', 'saved', 'article', 80, 300, 'author', 'author', 'Author', 90, 2, 0, 1, 200, 0, 300),
        ('saved:e', 'saved', 'article', 250, 0, 'author', 'author', 'Author', 20, 7, 0, 1, NULL, 0, 250),
        ('hidden', 'saved', 'article', 900, 900, 'author', 'author', 'Author', 100, 1, 1, 1, 900, 0, 900),
        ('unsaved', 'saved', 'article', 999, 999, 'author', 'author', 'Author', 100, 1, 0, 0, NULL, 0, 999);
    `);
    const program = LIBRARY_CORE_SQLITE_QUERY_PROGRAMS.saved_feed_page_v2;
    const expectedIndexes = {
      date_published: "library_feed_items_saved_date_published",
      date_saved: "library_feed_items_saved_date_saved",
      recommended: "library_feed_items_saved_recommended",
      shortest_read: "library_feed_items_saved_shortest_read",
    } as const;
    const planBindings = [
      0,
      null,
      null,
      null,
      "all",
      "[]",
      "[]",
      null,
      null,
      null,
      "",
      6,
    ];
    for (const [sortMode, indexName] of Object.entries(expectedIndexes)) {
      const variant =
        program.variants[sortMode as keyof typeof program.variants];
      for (const sql of [variant.sql, variant.reverseSql]) {
        const details = database
          .exec({
            sql: `EXPLAIN QUERY PLAN ${sql}`,
            bind: planBindings,
            rowMode: "array",
            returnValue: "resultRows",
          })
          .map((row) => String((row as unknown[])[3]));
        expect(details.some((detail) => detail.includes(indexName))).toBe(true);
        expect(details.every((detail) => !detail.includes("TEMP B-TREE"))).toBe(
          true,
        );
      }
    }
    const filter: LibraryCoreFeedBrowseFilterV1 = {
      archivedOnly: false,
      authorId: null,
      feedUrl: null,
      platform: null,
      savedOnly: true,
      schemaVersion: 1,
      showHidden: false,
      signals: [],
      socialContentFilter: "all",
      tags: [],
    };
    const request = {
      cancellationId: operationId("cancel-saved-v2"),
      cursor: null,
      direction: "next" as const,
      filter,
      limit: 10,
      queryId: "saved_feed_page_v2" as const,
      readerSessionId: operationId("reader-saved-v2"),
      schemaVersion: 2 as const,
      sortMode: "date_saved" as const,
    };
    const expectations = {
      date_published: ["saved:a", "saved:c", "saved:d", "saved:e", "saved:b"],
      date_saved: ["saved:b", "saved:e", "saved:c", "saved:d", "saved:a"],
      recommended: ["saved:c", "saved:d", "saved:b", "saved:e", "saved:a"],
      shortest_read: ["saved:c", "saved:d", "saved:a", "saved:e", "saved:b"],
    } as const;
    for (const [sortMode, expected] of Object.entries(expectations)) {
      const response = engine.query({
        ...request,
        sortMode: sortMode as keyof typeof expectations,
      });
      expect(response.totalCount).toBe(5);
      expect(response.rows.map((row) => row.globalId)).toEqual(expected);
    }
    const first = engine.query({ ...request, limit: 2 });
    const second = engine.query({
      ...request,
      cursor: first.nextCursor,
      limit: 2,
    });
    expect(second.rows.map((row) => row.globalId)).toEqual([
      "saved:c",
      "saved:d",
    ]);
    const previous = engine.query({
      ...request,
      cursor: second.previousCursor,
      direction: "previous",
      limit: 2,
    });
    expect(previous.rows.map((row) => row.globalId)).toEqual([
      "saved:b",
      "saved:e",
    ]);
    database.exec(
      "UPDATE library_meta SET source_revision = 13 WHERE singleton_id = 1; UPDATE library_change_state SET revision = 13 WHERE singleton_id = 1;",
    );
    expect(() =>
      engine.query({ ...request, cursor: first.nextCursor, limit: 2 }),
    ).toThrow("saved cursor is stale");
  });

  it("stages bounded normalized records idempotently and rejects changed replay", () => {
    const engine = new PwaLibraryCoreSqliteEngine(
      database,
      sqlite3.version.libVersion,
    );
    engine.initialize();
    const header = checkpointHeader();
    const records = [header, ...authorityRecords()];
    const stage = {
      authorityEpoch: "epoch-1",
      createdAt: 1_000,
      expectedCheckpointDigest:
        digestLibraryCoreNormalizedCheckpointRecordsV2(records),
      expectedRecordCount: records.length,
      libraryId: "library-1",
      sourceRevision: 7,
      stageId: "stage-1",
    };
    expect(engine.beginNormalizedCheckpointStage(stage)).toMatchObject({
      complete: false,
      stagedRecordCount: 0,
    });
    const complete = engine.appendNormalizedCheckpointStagePage({
      records,
      stageId: stage.stageId,
    });
    expect(complete.complete).toBe(true);
    expect(complete.stagedRecordCount).toBe(records.length);
    expect(complete.stagedCanonicalBytes).toBeGreaterThan(0);
    expect(
      engine.appendNormalizedCheckpointStagePage({
        records,
        stageId: stage.stageId,
      }),
    ).toEqual(complete);
    const changed = createLibraryCoreNormalizedCheckpointRecordV2({
      ...header,
      payload: { ...header.payload, createdAtMs: 1_001 },
    });
    expect(() =>
      engine.appendNormalizedCheckpointStagePage({
        records: [changed],
        stageId: stage.stageId,
      }),
    ).toThrow(/replay changed its bytes/);
    expect(engine.beginNormalizedCheckpointStage(stage)).toEqual(complete);
    expect(() =>
      engine.beginNormalizedCheckpointStage({ ...stage, sourceRevision: 8 }),
    ).toThrow(/replay changed its identity/);
    expect(
      engine.activateNormalizedCheckpointStage(stage.stageId),
    ).toMatchObject({
      checkpointDigest: stage.expectedCheckpointDigest,
      libraryId: stage.libraryId,
      recordCount: records.length,
      sourceRevision: stage.sourceRevision,
    });
    expect(
      database.exec({
        sql: "SELECT library_id FROM library_meta;",
        rowMode: 0,
        returnValue: "resultRows",
      }),
    ).toEqual(["library-1"]);
    expect(
      database.exec({
        sql: "SELECT revision FROM library_change_state;",
        rowMode: 0,
        returnValue: "resultRows",
      }),
    ).toEqual([7]);
    expect(
      database.exec({
        sql: `SELECT revision, topic, entity_id, reset_required
              FROM library_invalidations;`,
        rowMode: "array",
        returnValue: "resultRows",
      }),
    ).toEqual([[7, "library", null, 1]]);
    expect(
      engine.query({
        afterRevision: 0,
        cancellationId: operationId("cancel-reset-1"),
        cursor: null,
        limit: 1,
        queryId: "change_feed_v1",
        readerSessionId: operationId("reader-reset-1"),
        schemaVersion: 1,
      }),
    ).toMatchObject({
      nextCursor: null,
      rows: [{ resetRequired: true, revision: 7, topic: "library" }],
      source: { projectionRevision: 7 },
    });
  });

  it("rolls back browser activation on digest mismatch and unresolved references", () => {
    const engine = new PwaLibraryCoreSqliteEngine(
      database,
      sqlite3.version.libVersion,
    );
    engine.initialize();
    const header = checkpointHeader();
    stageRecords(engine, [header], "bad-digest", "a".repeat(64) as never);
    expect(() =>
      engine.activateNormalizedCheckpointStage("bad-digest"),
    ).toThrow(/digest does not match/);
    expect(
      database.exec({
        sql: "SELECT count(*) FROM library_meta;",
        rowMode: 0,
        returnValue: "resultRows",
      }),
    ).toEqual([0]);
    const orphan = createLibraryCoreNormalizedCheckpointRecordV2({
      registryKey: "13_feed_item_tag",
      primaryKey: ["missing-item", "favorite"],
      payload: { tag: "favorite" },
    });
    stageRecords(engine, [header, orphan], "orphan");
    expect(() => engine.activateNormalizedCheckpointStage("orphan")).toThrow(
      /unresolved foreign reference/,
    );
    expect(
      database.exec({
        sql: "SELECT count(*) FROM library_feed_item_tags;",
        rowMode: 0,
        returnValue: "resultRows",
      }),
    ).toEqual([0]);
  });

  it("refuses browser activation without accepted authority", () => {
    const engine = new PwaLibraryCoreSqliteEngine(
      database,
      sqlite3.version.libVersion,
    );
    engine.initialize();
    const records = [checkpointHeader()];
    stageRecords(engine, records, "missing-authority");
    expect(() =>
      engine.activateNormalizedCheckpointStage("missing-authority"),
    ).toThrow(/active authority/);
    expect(
      database.exec({
        sql: "SELECT count(*) FROM library_meta;",
        rowMode: 0,
        returnValue: "resultRows",
      }),
    ).toEqual([0]);
  });

  it("activates a multi-page content blob losslessly without a large SQLite row", () => {
    const engine = new PwaLibraryCoreSqliteEngine(
      database,
      sqlite3.version.libVersion,
    );
    engine.initialize();
    const original = Uint8Array.from(
      { length: 4_194_304 },
      (_, index) => (index * 31 + 17) % 251,
    );
    const content = splitLibraryCoreContentV1({
      bytes: original,
      mediaType: "application/octet-stream",
    });
    const records = [checkpointHeader(), ...authorityRecords(), ...content];
    stageRecords(engine, records, "large-content");
    const receipt = engine.activateNormalizedCheckpointStage("large-content");
    expect(receipt.recordCount).toBe(records.length);
    expect(
      database.exec({
        sql: `SELECT count(*), sum(length(bytes)), max(length(bytes))
              FROM library_blob_chunks;`,
        rowMode: "array",
        returnValue: "resultRows",
      }),
    ).toEqual([[64, original.byteLength, 65_536]]);
  });
});
