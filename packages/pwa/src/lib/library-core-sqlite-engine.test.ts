import { catchUpLibraryCorePredecessorCheckpointV1 } from "@freed/sync/cloud/library-core";
import nativeHandoffCatchup from "../../../shared/src/library-core/native-handoff-catchup-vector-v1.json";
import nativeMissedTransfers from "../../../shared/src/library-core/native-missed-transfer-vector-v1.json";
import { preparePwaPredecessorCheckpointRead, requirePwaPredecessorCheckpointRead } from "./library-core-successor-proof";
import { LIBRARY_CORE_PENDING_PREFERENCE_SCHEMA_SQL, LIBRARY_CORE_PENDING_PREFERENCE_SCHEMA_SHA256, parseLibraryCoreActivateNormalizedCheckpointStageV2, createLibraryCoreShellPreferencesV1, LIBRARY_CORE_SHELL_PREFERENCE_PATHS } from "@freed/shared/library-core";
import { replacePwaProjectedSuccessorCheckpoint, preparePwaProjectedConsumerRecovery, importPwaProjectedOperationPage, catchUpPwaProjectedAcceptedResult, storePwaProjectedResultTransport, storePwaProjectedFollowerResult, commitPwaProjectedConsumerRecovery, installPwaProjectedFollowerEnrollment, migratePwaPendingPreferenceProjection, backfillPwaPendingPreferenceProjection, settlePwaPendingPreferenceProjection, preparePwaPendingPreferenceSettlement, enqueuePwaProjectedFollowerIntent, readPwaVisiblePreferenceSource, readPwaVisiblePreferenceValue, readPwaVisiblePreferenceScope, preparePwaPreferenceCheckpointVerification, replacePwaProjectedCheckpoint } from "./library-core-preference-projection";
import { readLibraryCoreShellPreferencesV1 } from "@freed/shared/library-core";
import preferenceValueVector from "../../../shared/src/library-core/preference-value-query-vector-v1.json";
import historicalNativePreferences from "../../../shared/src/library-core/historical-native-preference-vector-v1.json";
import nativeRecoveredBrowser from "../../../shared/src/library-core/native-recovered-browser-vector-v1.json";
import recoveredEnrollmentVector from "../../../shared/src/library-core/recovered-enrollment-vector-v1.json";
import { verifyPwaRecoveryArchive } from "./library-core-recovery-archive";
import { migratePwaLibraryRecoverySchema } from "./library-core-recovery-schema";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  CONTENT_SIGNAL_KEYS,
  normalizeLibraryCoreFeedBrowseFilterV1,
} from "@freed/shared";
import { createHash, createPrivateKey, createPublicKey, generateKeyPairSync, sign } from "node:crypto";
import sqlite3InitModule, {
  type Database,
  type Sqlite3Static,
} from "@sqlite.org/sqlite-wasm";
import {
  LIBRARY_CORE_PENDING_PREFERENCE_QUERY_PROGRAMS,
  LIBRARY_CORE_NORMALIZED_SCHEMA_SHA256,
  LIBRARY_CORE_SQLITE_APPLICATION_ID,
  LIBRARY_CORE_SQLITE_QUERY_PROGRAMS,
  LIBRARY_CORE_SQLITE_SCHEMA_VERSION,
  LIBRARY_CORE_CHECKPOINT_PAGE_MAXIMUM_DECODED_BYTES,
  LIBRARY_CORE_CHECKPOINT_RECORD_MAXIMUM_CANONICAL_BYTES,
  LIBRARY_CORE_NATIVE_EXPORT_MAXIMUM_RESPONSE_BYTES,
  LIBRARY_CORE_FRIENDS_IDENTITY_PAGE_MAXIMUM_RESPONSE_BYTES,
  createLibraryCoreNormalizedCheckpointRecordV2,
  parseLibraryCoreNormalizedCheckpointRecordV2,
  parseLibraryCoreNormalizedOperationImportPageV2,
  createLibraryCoreImmutableObjectKey,
  decodeLibraryCoreCanonicalBase64,
  decodeLibraryCoreCanonicalValue,
  digestLibraryCoreNormalizedCheckpointRecordsV2,
  digestLibraryCoreMediaBlobBytesV1,
  encodeLibraryCoreNormalizedCheckpointRecordV2,
  isLibraryCoreOperationInstanceId,
  isLibraryCoreLowercaseHex64,
  splitLibraryCoreContentV1,
  reassembleLibraryCoreContentV1,
  type LibraryCoreNormalizedCheckpointRecordV2,
  type LibraryCoreOperationInstanceId,
  type LibraryCoreLowercaseHex64,
  type LibraryCoreFeedBrowseFilterV1,
  encodeLibraryCoreCanonicalValue,
  encodeLibraryCoreDigestInput,
  encodeLibraryCoreSignatureInput,
  finalizeLibraryCoreTransactionV1,
  FEED_ITEM_READ_ASSIGNMENT_TRANSACTION_MEMBER_SCHEMA,
  FEED_ITEM_SAVED_ASSIGNMENT_TRANSACTION_MEMBER_SCHEMA,
  FEED_ITEM_ARCHIVE_ASSIGNMENT_TRANSACTION_MEMBER_SCHEMA,
  FEED_ITEM_CAPTURE_UPSERT_TRANSACTION_MEMBER_SCHEMA,
  FEED_ITEM_ANALYSIS_REPLACE_TRANSACTION_MEMBER_SCHEMA,
  FEED_ITEM_ANNOTATIONS_REPLACE_TRANSACTION_MEMBER_SCHEMA,
  FEED_ITEM_PRIORITY_ASSIGNMENT_TRANSACTION_MEMBER_SCHEMA,
  FRIEND_REPLACE_TRANSACTION_MEMBER_SCHEMA,
  RSS_FEED_REMOVE_KEEP_ITEMS_TRANSACTION_MEMBER_SCHEMA,
  RSS_FEED_TITLE_ASSIGNMENT_TRANSACTION_MEMBER_SCHEMA,
  RSS_FEED_UPSERT_TRANSACTION_MEMBER_SCHEMA,
  assembleLibraryCoreTransactionV1,
  constructLibraryCoreHistoricalPreferencesMemberV1,
  assembleLibraryCoreHistoricalPreferencesV1,
  PREFERENCES_LEAF_ASSIGNMENT_TRANSACTION_MEMBER_SCHEMA,
  encodeLibraryCoreOperationSignatureInput,
  type LibraryCoreCanonicalValue,
  type LibraryCoreDigestDomain,
  libraryCoreFollowerResultBodyV1,
  normalizedResultSegmentHeaderFromBodyV2,
  parseLibraryCoreFollowerResultEnvelopeV1,
  parseLibraryCoreNormalizedIntentTransportPublicationV2,
  parseLibraryCoreNormalizedOperationExportDescriptorV2,
  parseLibraryCoreNormalizedOperationExportPageV2,
  parseLibraryCoreNormalizedResultSegmentBodyV2,
  parseLibraryCoreNormalizedResultTransportImportV2,
  constructLibraryCoreActorEnrollmentBodyV1,
  constructLibraryCoreActorCapabilityCertificateV2,
  constructLibraryCoreActorCapabilityRequestV2,
  constructLibraryCoreActorRetirementCertificateV1,
  LIBRARY_CORE_PRIMARY_WRITER_OPERATION_TYPES_V2,
  decodeLibraryCoreFriendsDirectoryCursorV1,
  encodeLibraryCoreFriendsDirectoryCursorV1,
  type LibraryCoreFriendsDirectoryPageResponseV1,
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

  // Tier 1: finite shell settings cannot load growing collections or silently default failed reads.
  it("reads finite shell preferences without owning unrelated collections", async () => {
    const engine = new PwaLibraryCoreSqliteEngine(database, sqlite3.version.libVersion);
    engine.initialize(); database.exec(preferenceValueVector.setupSql);
    database.exec(preferenceValueVector.scopeOverflowSql);
    database.exec("INSERT INTO library_preferences(path,value_type,boolean_value,updated_at) VALUES ('v:$.display.showEngagementCounts','boolean',1,1);");
    database.exec("INSERT INTO library_preferences(path,value_type,text_value,updated_at) VALUES ('v:$.storyWall.publishTarget.pagesUrl','text','https://example.test/wall',1);");
    database.exec("INSERT INTO library_preferences(path,value_type,real_value,updated_at) VALUES ('v:$.weights.recency','real',0.25,1);");
    const calls: string[] = [];
    const runtime = { query: async <T extends import('@freed/shared/library-core').LibraryCoreSqliteQueryRequest>(request: T) => {
      calls.push(request.queryId); return engine.query(request);
    }, randomId: () => "shell-test" };
    const source = engine.query({ queryId: "preferences_revision_v1", schemaVersion: 1 }).source;
    const value = await readLibraryCoreShellPreferencesV1(runtime, source);
    expect(calls).toEqual(["preference_scope_v1"]);
    expect(value.display.showEngagementCounts).toBe(true);
    expect(value.display.reading.markReadOnScroll).toBe(true);
    expect(value.weights).toEqual({ recency: 0.25 });
    expect(value.storyWall.publishTarget.pagesUrl).toBe("https://example.test/wall");
    expect(Object.hasOwn(value.storyWall.publishTarget, "lastPublishedAt")).toBe(false);
    expect(Object.hasOwn(value, "fbCapture")).toBe(false);
    expect(Object.hasOwn(value, "friendSuggestions")).toBe(false);
    expect(Object.hasOwn(value.storyWall, "selectedYears")).toBe(false);
    expect(Object.hasOwn(value.xCapture, "whitelist")).toBe(false);
    expect(Object.isFrozen(value.display.reading)).toBe(true);
    await expect(readLibraryCoreShellPreferencesV1(runtime, { ...source, projectionRevision: 8, transitionSequence: 8 })).rejects.toThrow("CURSOR_STALE");
    database.exec("UPDATE library_preferences SET boolean_value=NULL,text_value='yes',value_type='text' WHERE path='v:$.display.showEngagementCounts';");
    await expect(readLibraryCoreShellPreferencesV1(runtime, source)).rejects.toThrow("unsupported value");
  });

  // Tier 1: selected settings share a source and an aggregate byte ceiling.
  it("reads a bounded preference scope atomically beyond the whole-tree limit", () => {
    const engine = new PwaLibraryCoreSqliteEngine(database, sqlite3.version.libVersion);
    engine.initialize(); database.exec(preferenceValueVector.setupSql);
    const request = { queryId: "preference_scope_v1" as const, schemaVersion: 1 as const,
      generationId: preferenceValueVector.generationId, sourceRevision: 7,
      paths: preferenceValueVector.cases.map(entry => entry.path) };
    const response = engine.query(request);
    expect(response.results.map(value => ({ path: value.path, kind: value.kind, rows: value.rows })))
      .toEqual(preferenceValueVector.cases.map(entry => ({ path: entry.path, kind: entry.kind, rows: entry.expectedRows })));
    expect(() => engine.query({ ...request, sourceRevision: 8 })).toThrow("CURSOR_STALE");
    expect(() => engine.query({ ...request, paths: [request.paths[0]!, request.paths[0]!] })).toThrow("duplicate");
    const paths = Array.from({ length: 64 }, (_, i) => ["weights", "topics", `topic_${i}`]);
    expect(engine.query({ ...request, paths }).results).toHaveLength(64);
    expect(() => engine.query({ ...request, paths: [...paths, ["missing"]] })).toThrow();
    database.exec(preferenceValueVector.scopeOverflowSql);
    expect(() => engine.query({ ...request, paths: Array.from({ length: 32 }, (_, i) => [`scope${i}`]) })).toThrow("byte bound");
    expect(engine.query(request)).toEqual(response);
  });

  // Tier 1: priority writes cannot impersonate preference changes; imports change the marker generation.
  it("reads preference revisions independently of item changes and generation replacement", () => {
    const engine = new PwaLibraryCoreSqliteEngine(database, sqlite3.version.libVersion);
    engine.initialize(); database.exec(preferenceValueVector.setupSql);
    for (const step of preferenceValueVector.preferenceRevisionSteps) {
      if (step.sql) database.exec(step.sql);
      const read = () => engine.query({ queryId: "preferences_revision_v1", schemaVersion: 1 });
      if (step.revision === null) expect(read).toThrow("source is inconsistent");
      else expect(read()).toEqual({ queryId: "preferences_revision_v1", schemaVersion: 1,
        revision: step.revision, source: { generationId: step.generationId, projectionRevision: 7, transitionSequence: 7 } });
    }
  });

  // Tier 1: identical native/browser SQL must read selected values beyond global snapshot bounds.
  it("reads scoped preference values beyond the whole-tree limit", () => {
    const engine = new PwaLibraryCoreSqliteEngine(database, sqlite3.version.libVersion);
    engine.initialize(); database.exec(preferenceValueVector.setupSql);
    expect(() => engine.query({ queryId: "preferences_snapshot_v1", schemaVersion: 1 })).toThrow("row bound");
    const request = { queryId: "preference_value_v1" as const, schemaVersion: 1 as const,
      generationId: preferenceValueVector.generationId, sourceRevision: preferenceValueVector.sourceRevision, path: ["weights", "topics"] };
    for (const entry of preferenceValueVector.cases) {
      const response = engine.query({ ...request, path: entry.path });
      expect(response.kind).toBe(entry.kind); expect(response.rows).toEqual(entry.expectedRows);
      expect(response.path).toEqual(entry.path); expect(response.source.projectionRevision).toBe(7);
    }
    const scope = { queryId: "ranking_weight_scope_v1" as const, schemaVersion: 1 as const,
      generationId: request.generationId, sourceRevision: 7, paths: preferenceValueVector.weightScope.paths };
    expect(engine.query(scope)).toEqual({ queryId: scope.queryId, schemaVersion: 1, paths: scope.paths,
      values: preferenceValueVector.weightScope.values, source: { generationId: request.generationId, projectionRevision: 7, transitionSequence: 7 } });
    const maximumPaths = Array.from({ length: 64 }, (_, i) => ["weights", "topics", `topic_${i}`]);
    expect(engine.query({ ...scope, paths: maximumPaths }).values).toEqual(Array.from({ length: 64 }, (_, i) => i));
    expect(() => engine.query({ ...scope, sourceRevision: 8 })).toThrow("CURSOR_STALE");
    expect(() => engine.query({ ...scope, paths: [...maximumPaths, ["weights", "recency"]] })).toThrow();
    expect(() => engine.query({ ...scope, paths: [["weights", "topics"]] })).toThrow();
    for (const fault of ["INSERT INTO library_preferences(path,value_type,boolean_value,updated_at) VALUES ('v:$.weights.recency','boolean',1,1);",
      "INSERT INTO library_preferences(path,value_type,text_value,updated_at) VALUES ('v:$.weights.recency','text','50',1);",
      "INSERT INTO library_preferences(path,value_type,updated_at) VALUES ('v:$.weights.recency','null',1);"]) {
      database.exec(fault);
      expect(() => engine.query(scope)).toThrow("not numeric");
      database.exec("DELETE FROM library_preferences WHERE path='v:$.weights.recency';");
    }
    // A wrapper-shaped group with an extra child is not a valid numeric value.
    database.exec("INSERT INTO library_preferences(path,value_type,integer_value,updated_at) VALUES ('v:$.weights.topics.fraction.extra','integer',1,1);");
    expect(() => engine.query(scope)).toThrow("not numeric");
    database.exec("DELETE FROM library_preferences WHERE path='v:$.weights.topics.fraction.extra';");
    // Tier 1: storage-query bounds include the array marker and all serialized values.
    // These retained-row fixtures test read limits, not fresh mutation admission.
    for (const boundary of preferenceValueVector.boundaries) {
      database.exec(boundary.setupSql);
      const query = () => engine.query({ ...request, path: boundary.path });
      if (!boundary.accepted) { expect(query, boundary.path.join("/")).toThrow(); continue; }
      const result = query();
      expect(result.rows).toHaveLength(boundary.rows);
      expect(result.rows.reduce((bytes, row) => bytes + (row.textValue?.length ?? 0), 0)).toBe(boundary.textBytes);
    }
    expect(() => engine.query({ ...request, sourceRevision: 8 })).toThrow("CURSOR_STALE");
    // Corrupt retained rows must not become partial current values in recovery.
    for (const invalid of preferenceValueVector.invalidArrayRows) {
      database.exec({ sql: "INSERT INTO library_preferences(path,value_type,integer_value,updated_at) VALUES (?1,'integer',3,1);", bind: [invalid.path] });
      expect(() => engine.query({ ...request, path: ["storyWall", "selectedYears"] }), invalid.reason).toThrow();
      database.exec({ sql: "DELETE FROM library_preferences WHERE path=?1;", bind: [invalid.path] });
    }

    database.exec("UPDATE library_preferences SET real_value=1e999 WHERE path='v:$.weights.topics.realSetting';");
    expect(() => engine.query({ ...request, path: ["weights", "topics", "realSetting"] })).toThrow("Preference value row is invalid");
    database.exec("DELETE FROM library_preferences WHERE path='v:$.storyWall.selectedYears[1]';");
    expect(() => engine.query({ ...request, path: ["storyWall", "selectedYears"] })).toThrow("completeness");
  });

  it("pages all Person account identities at one revision without a display limit", () => {
    const engine = new PwaLibraryCoreSqliteEngine(database, sqlite3.version.libVersion);
    engine.initialize();
    database.exec(`INSERT INTO library_meta (singleton_id, library_id, schema_version, authority_epoch, source_revision, updated_at) VALUES (1, '${"a".repeat(64)}', 1, 'epoch-1', 7, 100); INSERT INTO library_materialization_generation SELECT 1, library_id FROM library_meta; UPDATE library_change_state SET revision = 7 WHERE singleton_id = 1;
      INSERT INTO library_persons (id, name, relationship_status, care_level, created_at, updated_at) VALUES ('person-1', 'Ada', 'friend', 3, 1, 2);`);
    database.transaction(() => { for (let i = 0; i < 130; i++) database.exec({ sql: "INSERT INTO library_accounts (id, person_id, kind, provider, external_id, discovered_from, first_seen_at, last_seen_at, created_at, updated_at) VALUES (?1, 'person-1', 'social', 'instagram', ?1, 'manual_entry', 1, 2, 1, 2)", bind: [`account:${String(i).padStart(3, "0")}`] }); });
    const request = { queryId: "person_account_page_v1", schemaVersion: 1, personId: "person-1", limit: 64, cursor: null } as const;
    const first = engine.query(request), second = engine.query({ ...request, cursor: first.nextCursor }), third = engine.query({ ...request, cursor: second.nextCursor });
    expect(first.rows).toHaveLength(64); expect(second.rows).toHaveLength(64); expect(third.rows).toHaveLength(2);
    expect(third.nextCursor).toBeNull();
    expect(new Set([...first.rows, ...second.rows, ...third.rows].map(row => row.accountId)).size).toBe(130);
    expect(() => engine.query({ ...request, personId: "other", cursor: first.nextCursor })).toThrow("cursor");
    database.exec("UPDATE library_meta SET source_revision = 8; UPDATE library_change_state SET revision = 8;");
    expect(() => engine.query({ ...request, cursor: first.nextCursor })).toThrow("CURSOR_STALE");
  });

  it("reads full Account roots beyond display limits and refuses oversized roots", () => {
    const engine = new PwaLibraryCoreSqliteEngine(database, sqlite3.version.libVersion);
    engine.initialize();
    database.exec(`INSERT INTO library_meta (singleton_id, library_id, schema_version, authority_epoch, source_revision, updated_at) VALUES (1, '${"a".repeat(64)}', 1, 'epoch-1', 7, 100); INSERT INTO library_materialization_generation SELECT 1, library_id FROM library_meta; UPDATE library_change_state SET revision = 7 WHERE singleton_id = 1;
      INSERT INTO library_accounts (id, kind, provider, external_id, discovered_from, first_seen_at, last_seen_at, created_at, updated_at, follow_roster_active) VALUES ('account-1', 'social', 'instagram', 'one', 'manual_entry', 1, 2, 1, 2, 1);
      INSERT INTO library_account_follow_roles VALUES ('account-1', 'following');`);
    database.exec({ sql: "UPDATE library_accounts SET address = ?1 WHERE id = 'account-1'", bind: ["x".repeat(20000)] });
    const request = { queryId: "account_root_v1", schemaVersion: 1, accountId: "account-1" } as const;
    const result = engine.query(request);
    expect(result.account?.address).toHaveLength(20000);
    expect(result.account?.followRosterActive).toBe(true);
    expect(result.account?.followRosterRoles).toEqual(["following"]);
    expect(result.account).not.toHaveProperty("personId");
    expect(result.source.projectionRevision).toBe(7);
    database.exec({ sql: "UPDATE library_accounts SET address = ?1 WHERE id = 'account-1'", bind: ["x".repeat(65536)] });
    expect(() => engine.query(request)).toThrow("read bounds");
    expect(engine.query({ ...request, accountId: "missing" }).account).toBeNull();
  });

  it("reads complete Person roots beyond display bounds and rejects overflow without losing the source", () => {
    const engine = new PwaLibraryCoreSqliteEngine(database, sqlite3.version.libVersion);
    engine.initialize();
    database.exec(`INSERT INTO library_meta (singleton_id, library_id, schema_version, authority_epoch, source_revision, updated_at) VALUES (1, '${"a".repeat(64)}', 1, 'epoch-1', 7, 100); INSERT INTO library_materialization_generation SELECT 1, library_id FROM library_meta; UPDATE library_change_state SET revision = 7 WHERE singleton_id = 1; INSERT INTO library_persons (id, name, relationship_status, care_level, created_at, updated_at) VALUES ('person-1', 'Ada', 'friend', 3, 1, 2);`);
    database.transaction(() => {
      for (let i = 0; i < 4096; i++) database.exec({ sql: "INSERT INTO library_person_tags (person_id, tag) VALUES ('person-1', ?1)", bind: [`t${String(i).padStart(4, "0")}`] });
    });
    const request = { queryId: "person_root_v1", schemaVersion: 1, personId: "person-1" } as const;
    const result = engine.query(request);
    expect(result.person?.tags).toHaveLength(4096);
    expect(result.source.projectionRevision).toBe(7);
    expect(result.person).not.toHaveProperty("reachOutLog");
    database.exec("INSERT INTO library_person_tags (person_id, tag) VALUES ('person-1', 'overflow')");
    expect(() => engine.query(request)).toThrow("read bounds");
    database.exec("DELETE FROM library_person_tags WHERE tag = 'overflow'");
    database.exec({ sql: "UPDATE library_persons SET notes = ?1 WHERE id = 'person-1'", bind: ["x".repeat(65536)] });
    expect(() => engine.query(request)).toThrow("read bounds");
    expect(engine.query({ ...request, personId: "missing" }).person).toBeNull();
  });

  it("reports the failed schema check without repairing rejected staging rows", () => {
    const engine = new PwaLibraryCoreSqliteEngine(database, sqlite3.version.libVersion);
    engine.initialize();
    // Simulate an invalid retained database, not a product write path.
    database.exec(`PRAGMA ignore_check_constraints = ON;
      INSERT INTO library_checkpoint_stages
        (stage_id, library_id, authority_epoch, source_revision, expected_record_count, created_at)
      VALUES ('invalid-stage', 'library-1', 'epoch-1', 1, -1, 1000);
      PRAGMA ignore_check_constraints = OFF;`);
    expect(() => engine.initialize()).toThrow(
      "PWA Library SQLite quick check failed: CHECK constraint failed in library_checkpoint_stages",
    );
    expect(database.exec({
      sql: "SELECT expected_record_count FROM library_checkpoint_stages;",
      rowMode: 0,
      returnValue: "resultRows",
    })).toEqual([-1]);
  });

  function lowercaseHex64(value: string): LibraryCoreLowercaseHex64 {
    if (!isLibraryCoreLowercaseHex64(value)) {
      throw new TypeError("invalid test lowercase hexadecimal digest");
    }
    return value;
  }

  it("exports one descriptor-pinned bounded normalized checkpoint with lossless chunks", async () => {
    const engine = new PwaLibraryCoreSqliteEngine(
      database,
      sqlite3.version.libVersion,
    );
    engine.initialize();
    const libraryId = "a".repeat(64);
    const epochId = "b".repeat(64);
    const actorId = "c".repeat(64);
    const chunk = Uint8Array.from(
      { length: 65_536 },
      (_, index) => index % 251,
    );
    const contentDigest = digestLibraryCoreMediaBlobBytesV1(chunk);
    database.exec({
      sql: `INSERT INTO library_meta
              (singleton_id, library_id, schema_version, authority_epoch,
               source_revision, updated_at)
            VALUES (1, ?1, 1, ?2, 7, 100);`,
      bind: [libraryId, epochId],
    });
    database.exec({
      sql: `INSERT INTO library_authority_epochs
              (epoch_id, library_id, epoch_number, authority_key_id,
               authority_public_key, transition_certificate_digest,
               canonical_transition_certificate, accepted_manifest_generation,
               checkpoint_frontier_digest, materialized_state_digest, accepted_at)
            VALUES (?1, ?2, 1, ?3, ?4, ?5, '{}', 7, ?6, ?7, 100);`,
      bind: [
        epochId,
        libraryId,
        "d".repeat(64),
        "e".repeat(64),
        "f".repeat(64),
        "1".repeat(64),
        "2".repeat(64),
      ],
    });
    database.exec({
      sql: `INSERT INTO library_active_authority
              (active_key, library_id, epoch_id, writer_id,
               accepted_manifest_generation, activated_at)
            VALUES ('active', ?1, ?2, ?3, 7, 100);`,
      bind: [libraryId, epochId, actorId],
    });
    database.exec({
      sql: `INSERT INTO library_actors
              (actor_id, authority_epoch_id, actor_kind, public_key,
               enrollment_operation_id, enrollment_certificate_digest,
               canonical_enrollment_certificate, chain_genesis_digest,
               accepted_counter, accepted_operation_id, accepted_chain_digest,
               created_at, updated_at)
            VALUES (?1, ?2, 'desktop', ?3, 'enrollment', ?4, '{}', ?5,
                    0, NULL, ?5, 100, 100);`,
      bind: [actorId, epochId, "3".repeat(64), "4".repeat(64), "5".repeat(64)],
    });
    database.exec({
      sql: `INSERT INTO library_blobs
              (content_digest, byte_length, chunk_bytes, chunk_count, media_type)
            VALUES (?1, ?2, 65536, 1, 'application/octet-stream');`,
      bind: [contentDigest, chunk.byteLength],
    });
    database.exec({
      sql: `INSERT INTO library_blob_chunks
              (content_digest, chunk_index, chunk_digest, bytes)
            VALUES (?1, 0, ?1, ?3);`,
      bind: [contentDigest, chunk.byteLength, chunk],
    });

    const snapshot = engine.describeNormalizedCheckpointExport();
    expect(snapshot).toMatchObject({
      authorityEpoch: epochId,
      causalFrontierDigest: "1".repeat(64),
      itemCount: 0,
      libraryId,
      recordCount: 6,
      sourceRevision: 7,
      writerId: actorId,
    });
    const records: LibraryCoreNormalizedCheckpointRecordV2[] = [];
    let after = null;
    while (true) {
      const page = engine.exportPinnedNormalizedCheckpointPage({
        page: {
          after,
          maximumRecords: 2,
          maximumResponseBytes:
            LIBRARY_CORE_NATIVE_EXPORT_MAXIMUM_RESPONSE_BYTES,
        },
        snapshot,
      });
      expect(page.records.length).toBeLessThanOrEqual(2);
      expect(
        new TextEncoder().encode(JSON.stringify(page)).byteLength,
      ).toBeLessThanOrEqual(LIBRARY_CORE_NATIVE_EXPORT_MAXIMUM_RESPONSE_BYTES);
      for (const record of page.records) {
        expect(
          encodeLibraryCoreNormalizedCheckpointRecordV2(record).byteLength,
        ).toBeLessThanOrEqual(
          LIBRARY_CORE_CHECKPOINT_RECORD_MAXIMUM_CANONICAL_BYTES,
        );
        records.push(record);
      }
      after = page.nextCursor;
      if (page.done) break;
    }
    expect(records).toHaveLength(snapshot.recordCount);
    expect(
      records.every((record) => !record.registryKey.includes("shell")),
    ).toBe(true);
    expect(reassembleLibraryCoreContentV1(records)).toEqual(chunk);

    // Cross the audit's byte budget before its row limit. The refused next row
    // must become the first row of the following page, without loss or replay.
    const extraDigests: string[] = [];
    for (let index = 1; index <= 15; index += 1) {
      const extra = chunk.slice(); extra[0] = index;
      const digest = digestLibraryCoreMediaBlobBytesV1(extra);
      extraDigests.push(digest);
      database.exec({sql: `INSERT INTO library_blobs
        (content_digest,byte_length,chunk_bytes,chunk_count,media_type)
        VALUES (?,65536,65536,1,'application/octet-stream')`,bind:[digest]});
      database.exec({sql: `INSERT INTO library_blob_chunks
        (content_digest,chunk_index,chunk_digest,bytes) VALUES (?,0,?,?)`,bind:[digest,digest,extra]});
    }
    const auditSnapshot = engine.describeNormalizedCheckpointExport();
    const auditRecords: LibraryCoreNormalizedCheckpointRecordV2[] = [];
    let cursor: ReturnType<PwaLibraryCoreSqliteEngine["exportPinnedNormalizedCheckpointPage"]>["nextCursor"] = null;
    for (;;) {
      const page = engine.exportPinnedNormalizedCheckpointPage({snapshot:auditSnapshot,
        page:{after:cursor,maximumRecords:64,maximumResponseBytes:LIBRARY_CORE_NATIVE_EXPORT_MAXIMUM_RESPONSE_BYTES}});
      auditRecords.push(...page.records);
      if (page.done) break;
      cursor = page.nextCursor;
    }
    let auditPages = 0;
    const audited = await engine.auditNormalizedReplica({check() {},yieldControl:async () => { auditPages++; }});
    expect(auditSnapshot.recordCount).toBeLessThan(64);
    expect(auditPages).toBeGreaterThan(1);
    expect(audited.snapshot).toEqual(auditSnapshot);
    expect(audited.checkpointDigest).toBe(digestLibraryCoreNormalizedCheckpointRecordsV2(auditRecords));
    for (const digest of extraDigests) {
      database.exec({sql:"DELETE FROM library_blob_chunks WHERE content_digest=?",bind:[digest]});
      database.exec({sql:"DELETE FROM library_blobs WHERE content_digest=?",bind:[digest]});
    }
    expect(engine.describeNormalizedCheckpointExport()).toEqual(snapshot);

    database.exec({
      sql: `INSERT INTO library_intent_actors
              (actor_id, next_counter, previous_operation_id,
               previous_chain_digest)
            VALUES (?1, 1, NULL, ?2);`,
      bind: [actorId, "5".repeat(64)],
    });
    database.exec({
      sql: `INSERT INTO library_intent_transactions
              (transaction_id, transaction_digest, actor_id, intent_epoch,
               intent_epoch_id, member_count, first_counter, last_counter,
               previous_operation_id, previous_chain_digest,
               ending_operation_id, ending_chain_digest,
               canonical_member_bytes, canonical_transaction, state, created_at)
            VALUES ('transaction-1', ?1, ?2, 1, ?3, 1, 1, 1, NULL, ?4,
                    'operation-1', ?5, 2, X'7b7d', 'pending', 101);`,
      bind: ["6".repeat(64), actorId, epochId, "5".repeat(64), "7".repeat(64)],
    });
    expect(() => engine.describeNormalizedCheckpointExport()).toThrow(
      "unresolved local intents",
    );
    database.exec(
      "DELETE FROM library_intent_transactions; DELETE FROM library_intent_actors;",
    );

    database.exec(
      "UPDATE library_meta SET source_revision = 8 WHERE singleton_id = 1;",
    );
    expect(() =>
      engine.exportPinnedNormalizedCheckpointPage({
        page: {
          after: null,
          maximumRecords: 2,
          maximumResponseBytes:
            LIBRARY_CORE_NATIVE_EXPORT_MAXIMUM_RESPONSE_BYTES,
        },
        snapshot,
      }),
    ).toThrow("changed during export");
  });

  it("builds and activates a replay-safe normalized contact generation", () => {
    const engine = new PwaLibraryCoreSqliteEngine(
      database,
      sqlite3.version.libVersion,
    );
    engine.initialize();
    expect(
      engine.mutateDeviceContactSync({
        generationId: "contacts:1",
        mutationKind: "device_contact_generation_begin_v1",
        schemaVersion: 1,
        startedAt: 10,
      }),
    ).toMatchObject({ changed: true, stagedContactCount: 0 });
    const delta = {
      batchOrdinal: 0,
      contacts: [
        {
          emails: [{ type: "home", value: "person@example.com" }],
          name: { displayName: "Example Person" },
          organizations: [{ name: "Example" }],
          phones: [{ value: "+1 555 0100" }],
          photos: [{ default: true, url: "https://example.com/person.jpg" }],
          resourceName: "people/1",
        },
      ],
      deletedResourceNames: [],
      generationId: "contacts:1",
      mutationKind: "device_contact_delta_append_v1" as const,
      schemaVersion: 1 as const,
      updatedAt: 20,
    };
    expect(engine.mutateDeviceContactSync(delta)).toMatchObject({
      changed: true,
      stagedContactCount: 1,
    });
    expect(engine.mutateDeviceContactSync(delta)).toMatchObject({
      changed: false,
      stagedContactCount: 1,
    });
    expect(() =>
      engine.mutateDeviceContactSync({
        ...delta,
        contacts: [{ ...delta.contacts[0]!, name: { displayName: "Changed" } }],
      }),
    ).toThrow("delta replay changed");
    expect(
      engine.queryDeviceContacts({
        afterResourceName: null,
        generationId: "contacts:1",
        limit: 64,
        queryId: "device_contact_match_page_v1",
        schemaVersion: 1,
      }),
    ).toMatchObject({
      nextCursor: null,
      rows: [{ resourceName: "people/1" }],
    });
    database.exec(`
      INSERT INTO library_persons
        (id, name, relationship_status, care_level, created_at, updated_at)
      VALUES ('person:1', 'Example Person', 'friend', 3, 1, 1);
    `);
    expect(
      engine.mutateDeviceContactSync({
        generationId: "contacts:1",
        matchedAt: 30,
        matches: [
          {
            resourceName: "people/1",
            suggestion: {
              accountIds: [],
              confidence: "high",
              createdAt: 30,
              id: "google:people/1:person:person:1:accounts:",
              kind: "attach_accounts_to_person",
              label: "Example Person",
              personId: "person:1",
            },
          },
        ],
        mutationKind: "device_contact_match_append_v1",
        schemaVersion: 1,
      }),
    ).toMatchObject({ changed: true, matchedContactCount: 1 });
    expect(
      engine.mutateDeviceContactSync({
        activatedAt: 40,
        expectedContactCount: 1,
        generationId: "contacts:1",
        mutationKind: "device_contact_generation_activate_v1",
        nextSyncToken: "sync-token-1",
        schemaVersion: 1,
      }),
    ).toMatchObject({
      activeGenerationId: "contacts:1",
      changed: true,
      stagedContactCount: 1,
    });
    expect(
      database.exec({
        sql: `SELECT contact.resource_name, email.value, phone.value,
                     photo.url, organization.name, state.sync_token
              FROM library_device_contact_sync_state AS state
              JOIN library_device_contacts AS contact
                ON contact.generation_id = state.active_generation_id
              JOIN library_device_contact_emails AS email
                ON email.generation_id = contact.generation_id
               AND email.resource_name = contact.resource_name
              JOIN library_device_contact_phones AS phone
                ON phone.generation_id = contact.generation_id
               AND phone.resource_name = contact.resource_name
              JOIN library_device_contact_photos AS photo
                ON photo.generation_id = contact.generation_id
               AND photo.resource_name = contact.resource_name
              JOIN library_device_contact_organizations AS organization
                ON organization.generation_id = contact.generation_id
               AND organization.resource_name = contact.resource_name
              WHERE state.singleton_id = 1;`,
        rowMode: "array",
        returnValue: "resultRows",
      }),
    ).toEqual([
      [
        "people/1",
        "person@example.com",
        "+1 555 0100",
        "https://example.com/person.jpg",
        "Example",
        "sync-token-1",
      ],
    ]);
    expect(
      engine.queryDeviceContacts({
        queryId: "device_contact_status_v1",
        schemaVersion: 1,
      }),
    ).toMatchObject({
      activeContactCount: 1,
      pendingSuggestionCount: 1,
      syncToken: "sync-token-1",
    });
    expect(
      engine.queryDeviceContacts({
        cursor: null,
        limit: 50,
        queryId: "device_contact_suggestion_page_v1",
        schemaVersion: 1,
      }),
    ).toMatchObject({
      nextCursor: null,
      rows: [
        {
          contact: { resourceName: "people/1" },
          suggestion: { id: "google:people/1:person:person:1:accounts:" },
        },
      ],
    });
  });

  it("excludes contact Accounts from the bounded unmatched page", () => {
    const engine = new PwaLibraryCoreSqliteEngine(
      database,
      sqlite3.version.libVersion,
    );
    engine.initialize();
    engine.mutateDeviceContactSync({
      generationId: "contacts:unmatched",
      mutationKind: "device_contact_generation_begin_v1",
      schemaVersion: 1,
      startedAt: 10,
    });
    engine.mutateDeviceContactSync({
      batchOrdinal: 0,
      contacts: [
        {
          emails: [],
          name: { displayName: "Grace Hopper" },
          organizations: [],
          phones: [],
          photos: [],
          resourceName: "people/grace",
        },
      ],
      deletedResourceNames: [],
      generationId: "contacts:unmatched",
      mutationKind: "device_contact_delta_append_v1",
      schemaVersion: 1,
      updatedAt: 20,
    });
    engine.mutateDeviceContactSync({
      generationId: "contacts:unmatched",
      matchedAt: 30,
      matches: [{ resourceName: "people/grace", suggestion: null }],
      mutationKind: "device_contact_match_append_v1",
      schemaVersion: 1,
    });
    engine.mutateDeviceContactSync({
      activatedAt: 40,
      expectedContactCount: 1,
      generationId: "contacts:unmatched",
      mutationKind: "device_contact_generation_activate_v1",
      nextSyncToken: "sync-token",
      schemaVersion: 1,
    });
    const query = () =>
      engine.queryDeviceContacts({
        cursor: null,
        limit: 50,
        queryId: "device_contact_unmatched_page_v1",
        schemaVersion: 1,
      });
    expect(query()).toMatchObject({
      rows: [{ resourceName: "people/grace" }],
    });
    database.exec(`
      INSERT INTO library_persons
        (id, name, relationship_status, care_level, created_at, updated_at)
      VALUES ('person:grace', 'Grace Hopper', 'friend', 3, 50, 50);
      INSERT INTO library_accounts
        (id, person_id, kind, provider, external_id, first_seen_at, last_seen_at,
         discovered_from, created_at, updated_at)
      VALUES
        ('contact:google:people/grace', 'person:grace', 'contact', 'google_contacts',
         'people/grace', 50, 50, 'contact_import', 50, 50);
    `);
    expect(query()).toMatchObject({ rows: [] });
    expect(
      engine.queryDeviceContacts({
        queryId: "device_contact_status_v1",
        schemaVersion: 1,
      }),
    ).toMatchObject({ createdFriendCount: 1 });
  });

  it("replaces an interrupted building contact generation but rejects concurrency", () => {
    const engine = new PwaLibraryCoreSqliteEngine(
      database,
      sqlite3.version.libVersion,
    );
    engine.initialize();
    engine.mutateDeviceContactSync({
      generationId: "contacts:stale",
      mutationKind: "device_contact_generation_begin_v1",
      schemaVersion: 1,
      startedAt: 10,
    });
    expect(() =>
      engine.mutateDeviceContactSync({
        generationId: "contacts:concurrent",
        mutationKind: "device_contact_generation_begin_v1",
        schemaVersion: 1,
        startedAt: 20,
      }),
    ).toThrow("another device contact generation is building");
    engine.mutateDeviceContactSync({
      authStatus: "connected",
      errorCode: "network",
      errorMessage: "interrupted",
      mutationKind: "device_contact_status_set_v1",
      schemaVersion: 1,
      syncStartedAt: null,
      syncStatus: "error",
      updatedAt: 30,
    });
    expect(
      engine.mutateDeviceContactSync({
        generationId: "contacts:recovered",
        mutationKind: "device_contact_generation_begin_v1",
        schemaVersion: 1,
        startedAt: 40,
      }),
    ).toMatchObject({ changed: true });
    expect(
      database.exec({
        sql: "SELECT generation_id FROM library_device_contact_generations WHERE state = 'building';",
        rowMode: 0,
        returnValue: "resultRows",
      }),
    ).toEqual(["contacts:recovered"]);
  });

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

  it("freezes and pages a device-local scope action outside checkpoints", () => {
    const engine = new PwaLibraryCoreSqliteEngine(
      database,
      sqlite3.version.libVersion,
    );
    engine.initialize();
    const request = {
      action: "read" as const,
      filter: normalizeLibraryCoreFeedBrowseFilterV1({ platform: "rss" }),
      identityMode: "all_content" as const,
      query: null,
      schemaVersion: 1 as const,
    };
    expect(engine.beginScopeAction("stage:1", request, 10)).toEqual({
      memberCount: 0,
      stageId: "stage:1",
      state: "staging",
    });
    engine.appendScopeAction("stage:1", 0, ["item:1", "item:2"]);
    expect(engine.pageScopeAction("stage:1", -1)).toEqual({
      entityIds: [],
      nextOrdinal: -1,
      stageId: "stage:1",
    });
    expect(() => engine.appendScopeAction("stage:1", 0, ["item:3"])).toThrow(
      "append fence is stale",
    );
    expect(engine.finalizeScopeAction("stage:1", 2)).toMatchObject({
      memberCount: 2,
      state: "ready",
    });
    expect(engine.pageScopeAction("stage:1", -1)).toEqual({
      entityIds: ["item:1", "item:2"],
      nextOrdinal: 1,
      stageId: "stage:1",
    });
    engine.closeScopeAction("stage:1");
    expect(
      database.exec({
        sql: "SELECT count(*) FROM library_device_scope_actions;",
        rowMode: 0,
        returnValue: "resultRows",
      }),
    ).toEqual([0]);
  });

  it("atomically freezes the exact RSS Feed scope before signed removals", () => {
    const engine = new PwaLibraryCoreSqliteEngine(
      database,
      sqlite3.version.libVersion,
    );
    engine.initialize();
    database.exec(`
      INSERT INTO library_rss_feeds
        (url, title, enabled, track_unread, updated_at)
      VALUES
        ('https://z.example/feed', 'Z', 1, 0, 1),
        ('https://a.example/feed', 'A', 1, 0, 1);
    `);
    expect(
      engine.beginScopeAction(
        "rss-stage:1",
        { action: "rss_feeds_remove_keep_items", schemaVersion: 1 },
        10,
      ),
    ).toEqual({
      memberCount: 2,
      stageId: "rss-stage:1",
      state: "ready",
    });
    database.exec(`
      INSERT INTO library_rss_feeds
        (url, title, enabled, track_unread, updated_at)
      VALUES ('https://m.example/feed', 'M', 1, 0, 1);
    `);
    expect(engine.pageScopeAction("rss-stage:1", -1)).toEqual({
      entityIds: ["https://a.example/feed", "https://z.example/feed"],
      nextOrdinal: 1,
      stageId: "rss-stage:1",
    });
    engine.closeScopeAction("rss-stage:1");
  });

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
    identity: {
      readonly authorityEpoch: string;
      readonly libraryId: string;
      readonly sourceRevision: number;
    } = {
      authorityEpoch: "epoch-1",
      libraryId: "library-1",
      sourceRevision: 7,
    },
  ): void {
    engine.beginNormalizedCheckpointStage({
      authorityEpoch: identity.authorityEpoch,
      createdAt: 1_000,
      expectedRecordCount: records.length,
      libraryId: identity.libraryId,
      sourceRevision: identity.sourceRevision,
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

  it("verifies and activates authority-signed actor retirement records", async () => {
    const engine = new PwaLibraryCoreSqliteEngine(
      database,
      sqlite3.version.libVersion,
    );
    engine.initialize();
    const libraryId = "11".repeat(32);
    const epochId = "22".repeat(32);
    const actorId = "33".repeat(32);
    const capabilityId = "44".repeat(32);
    const retirementIdentity = "55".repeat(32);
    const authorityKeys = generateKeyPairSync("ed25519");
    const authorityPublicKey = authorityKeys.publicKey
      .export({ format: "der", type: "spki" })
      .subarray(-32)
      .toString("hex");
    const authorityKeyId = coreDigest("authority-key", {
      authority_public_key: authorityPublicKey,
      signature_algorithm: "ed25519",
    });
    const certificate = await constructLibraryCoreActorRetirementCertificateV1(
      {
        authority_key_id: authorityKeyId,
        authority_public_key: authorityPublicKey,
        epoch: 1,
        epoch_id: epochId,
        library_id: libraryId,
      } as never,
      {
        actor_id: actorId,
        capability_certificate_digest: capabilityId,
        capability_id: capabilityId,
        retirement_identity: retirementIdentity,
      } as never,
      "device_removed",
      1_234,
      {
        digest: coreDigest as never,
        async signAuthority(message) {
          return sign(null, message, authorityKeys.privateKey).toString("hex");
        },
      },
    );
    const canonicalCertificate = new TextDecoder().decode(
      encodeLibraryCoreCanonicalValue(certificate as never),
    );
    const header = createLibraryCoreNormalizedCheckpointRecordV2({
      registryKey: "00_checkpoint_header",
      primaryKey: "checkpoint",
      payload: {
        authorityEpoch: epochId,
        checkpointId: `${libraryId}:${epochId}:7`,
        createdAtMs: 1_234,
        libraryId,
        schemaVersion: 1,
        sourceRevision: 7,
      },
    });
    const records = [
      header,
      createLibraryCoreNormalizedCheckpointRecordV2({
        registryKey: "01_authority_epoch",
        primaryKey: epochId,
        payload: {
          acceptedAt: 1,
          acceptedManifestGeneration: 0,
          authorityKeyId,
          authorityPublicKey,
          canonicalTransitionCertificate: "{}",
          checkpointFrontierDigest: "66".repeat(32),
          epochNumber: 1,
          libraryId,
          materializedStateDigest: "77".repeat(32),
          transitionCertificateDigest: "88".repeat(32),
        },
      }),
      createLibraryCoreNormalizedCheckpointRecordV2({
        registryKey: "03_active_authority",
        primaryKey: "active",
        payload: {
          acceptedManifestGeneration: 0,
          activatedAt: 1,
          activeKey: "active",
          epochId,
          libraryId,
          writerId: "writer-1",
        },
      }),
      createLibraryCoreNormalizedCheckpointRecordV2({
        registryKey: "90_actor_state",
        primaryKey: actorId,
        payload: {
          acceptedChainDigest: "99".repeat(32),
          acceptedCounter: 0,
          acceptedOperationId: null,
          actorKind: "pwa",
          authorityEpochId: epochId,
          canonicalEnrollmentCertificate: "{}",
          chainGenesisDigest: "99".repeat(32),
          createdAt: 1,
          enrollmentCertificateDigest: "aa".repeat(32),
          enrollmentOperationId: "enroll-1",
          publicKey: "bb".repeat(32),
          retiredAt: 1_234,
          updatedAt: 1_234,
        },
      }),
      createLibraryCoreNormalizedCheckpointRecordV2({
        registryKey: "91_actor_capability",
        primaryKey: capabilityId,
        payload: {
          actorClass: "editor",
          actorId,
          canonicalCertificate: "{}",
          certificateDigest: capabilityId,
          certificateVersion: 2,
          issuanceIdentity: capabilityId,
          issuedAt: 1,
          retiredAt: 1_234,
          retirementCertificateDigest: certificate.certificate_digest,
          retirementIdentity,
          scopeId: null,
          scopeKind: null,
          scopeMode: "library_wide",
        },
      }),
      createLibraryCoreNormalizedCheckpointRecordV2({
        registryKey: "93_actor_retirement",
        primaryKey: retirementIdentity,
        payload: {
          actorId,
          authorityEpochId: epochId,
          canonicalCertificate,
          capabilityCertificateDigest: capabilityId,
          capabilityId,
          certificateDigest: certificate.certificate_digest,
          committedRevision: 6,
          reason: "device_removed",
          retiredAt: 1_234,
        },
      }),
    ];
    const identity = { authorityEpoch: epochId, libraryId, sourceRevision: 7 };
    stageRecords(engine, records, "signed-retirement", identity);
    await expect(
      engine.verifyNormalizedCheckpointActorRetirements("signed-retirement"),
    ).resolves.toBeUndefined();
    expect(
      engine.activateNormalizedCheckpointStage({
        followerReceipt: null,
        replaceExisting: false,
        stageId: "signed-retirement",
      }),
    ).toMatchObject({ recordCount: records.length, sourceRevision: 7 });
    expect(
      database.exec({
        sql: `SELECT canonical_certificate, certificate_digest, committed_revision
              FROM library_actor_retirements WHERE retirement_identity = ?1;`,
        bind: [retirementIdentity],
        rowMode: "array",
        returnValue: "resultRows",
      }),
    ).toEqual([[canonicalCertificate, certificate.certificate_digest, 6]]);

    const changed = records.map((record) =>
      record.registryKey === "93_actor_retirement"
        ? createLibraryCoreNormalizedCheckpointRecordV2({
            ...record,
            payload: { ...record.payload, reason: "key_compromised" },
          })
        : record,
    );
    stageRecords(engine, changed, "changed-retirement", identity);
    await expect(
      engine.verifyNormalizedCheckpointActorRetirements("changed-retirement"),
    ).rejects.toThrow(/certificate changed/);
  });

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
      "library_local_change_state",
      "library_local_invalidations",
      "library_device_contact_generations",
      "library_device_contact_sync_state",
      "library_device_contacts",
      "library_device_contact_delta_receipts",
      "library_device_contact_emails",
      "library_device_contact_phones",
      "library_device_contact_photos",
      "library_device_contact_organizations",
      "library_device_contact_suggestions",
      "library_device_contact_match_receipts",
      "library_device_contact_suggestion_accounts",
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

  it.each([
    { name: "accepted result receipts and segments", outcome: "accepted-ahead", resultDeliveries: ["receipt", "segment"], canonicalDeliveries: [], checkpointPhase: "none" },
    { name: "accepted result canonical receipt catch-up", outcome: "accepted-ahead", resultDeliveries: [], canonicalDeliveries: ["receipt-catch-up"], checkpointPhase: "none" },
    { name: "accepted result canonical operation page", outcome: "accepted-ahead", resultDeliveries: [], canonicalDeliveries: ["operation-page"], checkpointPhase: "none" },
    { name: "accepted result later frontier coverage", outcome: "accepted-ahead", resultDeliveries: [], canonicalDeliveries: ["later-coverage"], checkpointPhase: "none" },
    { name: "accepted checkpoint-covered result", outcome: "accepted-covered", resultDeliveries: [], canonicalDeliveries: [], checkpointPhase: "none" },
    { name: "rejected result and fresh projection", outcome: "rejected", resultDeliveries: ["receipt", "segment"], canonicalDeliveries: [], checkpointPhase: "none" },
    { name: "checkpoint restore rollback", outcome: "rejected", resultDeliveries: [], canonicalDeliveries: [], checkpointPhase: "restore" },
    { name: "checkpoint signed evidence tamper", outcome: "rejected", resultDeliveries: [], canonicalDeliveries: [], checkpointPhase: "evidence" },
    { name: "checkpoint atomic settlement and repeat", outcome: "rejected", resultDeliveries: [], canonicalDeliveries: [], checkpointPhase: "settlement" },
  ] as const)("verifies signed follower enrollment and $name", async ({ name, outcome, resultDeliveries, canonicalDeliveries, checkpointPhase }) => {
    // Every case receives beforeEach's fresh database and real signing keys.
    // Bound separate delivery workflows by the unchanged default test deadline.
    const fixtureId = name.replaceAll(" ", "-");
    const libraryId = "11".repeat(32);
    const epochId = "22".repeat(32);
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
    const authorityKeyId = coreDigest("authority-key", {
      authority_public_key: authorityPublicKey,
      signature_algorithm: "ed25519",
    });
    let followerNow=3500;
    const engine = new PwaLibraryCoreSqliteEngine(
      database,
      sqlite3.version.libVersion,
      { now:()=>followerNow },
    );
    engine.initialize();
    database.exec({
      sql: `INSERT INTO library_meta
              (singleton_id, library_id, schema_version, authority_epoch,
               source_revision, updated_at)
            VALUES (1, ?1, 1, ?2, 0, 1);`,
      bind: [libraryId, epochId],
    });
    database.exec({
      sql: `INSERT INTO library_authority_epochs
              (epoch_id, library_id, epoch_number, authority_key_id,
               authority_public_key, transition_certificate_digest,
               canonical_transition_certificate, accepted_manifest_generation,
               checkpoint_frontier_digest, materialized_state_digest,
               accepted_at)
            VALUES (?1, ?2, 1, ?3, ?4, ?5, '{}', 1, ?6, ?7, 1);`,
      bind: [
        epochId,
        libraryId,
        authorityKeyId,
        authorityPublicKey,
        "33".repeat(32),
        "44".repeat(32),
        "55".repeat(32),
      ],
    });
    database.exec({
      sql: `INSERT INTO library_active_authority
              (active_key, library_id, epoch_id, writer_id,
               accepted_manifest_generation, activated_at)
            VALUES ('active', ?1, ?2,
                    'primary:desktop',
                    1, 1);`,
      bind: [libraryId, epochId],
    });
    const enrollment = constructLibraryCoreActorEnrollmentBodyV1(
      {
        actor_incarnation_nonce: "66".repeat(32),
        actor_public_key: actorPublicKey,
        authority_key_id: authorityKeyId,
        created_at_ms: 1_000,
        epoch: 1,
        epoch_id: epochId,
        installation_incarnation: "77".repeat(32),
        library_id: libraryId,
        observed_frontier: [],
        operation_id: "actor-enrolled:test",
      },
      { digest: coreDigest },
    );
    const capabilityInput = {
      actor_class: "editor" as const,
      allowed_operation_types: LIBRARY_CORE_PRIMARY_WRITER_OPERATION_TYPES_V2,
      allowed_query_ids: [],
      scope: { mode: "library_wide" as const },
    };
    const signActorProof = async (message: Uint8Array) =>
      sign(null, message, actorKeys.privateKey).toString("hex");
    const request = await constructLibraryCoreActorCapabilityRequestV2(
      enrollment,
      capabilityInput,
      { digest: coreDigest, signActorProof },
    );
    const canonicalRequestBytes = encodeLibraryCoreCanonicalValue(
      request.request as unknown as LibraryCoreCanonicalValue,
    );
    const stored = await engine.storeFollowerActorRequest({
      canonicalRequestBytes,
      createdAt: 1_000,
    });
    expect(stored).toMatchObject({
      actorId: enrollment.body.actor_id,
      state: "pending",
    });
    const certificate = await constructLibraryCoreActorCapabilityCertificateV2(
      enrollment,
      capabilityInput,
      {
        digest: coreDigest,
        signActorProof,
        async signAuthorityCertificate(message) {
          return sign(null, message, authorityKeys.privateKey).toString("hex");
        },
      },
    );
    const canonicalCertificateBytes = encodeLibraryCoreCanonicalValue(
      certificate.certificate as unknown as LibraryCoreCanonicalValue,
    );
    // Signature verification yields. A replaced pending request must not let
    // the old response install an actor or report an enrollment that was lost.
    const pendingInstall = engine.installFollowerActorEnrollment({ canonicalCertificateBytes, enrolledAt: 1_100 });
    database.exec("UPDATE library_follower_actor_request SET created_at = 1001;");
    await expect(pendingInstall).rejects.toThrow(/changed during verification/);
    expect(database.selectValue("SELECT count(*) FROM library_actors;")).toBe(0);
    expect(database.selectValue("SELECT count(*) FROM library_actor_capabilities;")).toBe(0);
    expect(database.selectValue("SELECT enrollment_certificate_digest FROM library_follower_actor_request;")).toBeNull();
    database.exec("UPDATE library_follower_actor_request SET created_at = 1000;");
    const replacedAuthority = engine.installFollowerActorEnrollment({ canonicalCertificateBytes, enrolledAt: 1_100 });
    database.exec({ sql: "UPDATE library_authority_epochs SET authority_public_key = ?1;", bind: ["00".repeat(32)] });
    await expect(replacedAuthority).rejects.toThrow(/changed during verification/);
    expect(database.selectValue("SELECT count(*) FROM library_actors;")).toBe(0);
    expect(database.selectValue("SELECT count(*) FROM library_intent_actors;")).toBe(0);
    database.exec({ sql: "UPDATE library_authority_epochs SET authority_public_key = ?1;", bind: [authorityPublicKey] });
    const installed = await engine.installFollowerActorEnrollment({
      canonicalCertificateBytes,
      enrolledAt: 1_100,
    });
    expect(installed).toMatchObject({
      actorId: enrollment.body.actor_id,
      enrollmentCertificateDigest: certificate.certificate.certificate_digest,
    });
    expect(engine.followerActorEnrollmentContext().request?.state).toBe(
      "enrolled",
    );
    await expect(
      engine.installFollowerActorEnrollment({
        canonicalCertificateBytes,
        enrolledAt: 1_100,
      }),
    ).resolves.toEqual(installed);
    await expect(
      engine.installFollowerActorEnrollment({
        canonicalCertificateBytes,
        enrolledAt: 1_101,
      }),
    ).rejects.toThrow(/replay changed/);
    expect(engine.followerMutationContext()).toMatchObject({
      actor_id: enrollment.body.actor_id,
      next_actor_sequence: 1,
      previous_actor_chain_digest: certificate.actor_chain_genesis,
    });

    // Tier 1: dormant schema changes and cursor identity roll back together.
    const beforeMigrationContext = engine.followerMutationContext();
    expect(() => migratePwaPendingPreferenceProjection(database, sqlite3.capi, engine))
      .toThrow(/owned FULL transaction/);
    database.exec(`CREATE TEMP TRIGGER fail_preference_migration BEFORE UPDATE OF schema_version ON library_storage_meta
      WHEN NEW.schema_version=3 BEGIN SELECT RAISE(ABORT,'preference migration fault'); END;`);
    expect(() => database.transaction("IMMEDIATE", () =>
      migratePwaPendingPreferenceProjection(database, sqlite3.capi, engine)))
      .toThrow(/preference migration fault/);
    expect(database.selectValue("PRAGMA user_version;")).toBe(1);
    expect(database.selectValue("SELECT count(*) FROM sqlite_schema WHERE name='library_local_preference_projection';")).toBe(0);
    expect(database.selectValue("SELECT count(*) FROM sqlite_schema WHERE name='library_local_handoff';")).toBe(0);
    database.exec("DROP TRIGGER fail_preference_migration;");
    expect(() => database.transaction("IMMEDIATE", () => {
      migratePwaPendingPreferenceProjection(database, sqlite3.capi, engine);
      migratePwaPendingPreferenceProjection(database, sqlite3.capi, engine);
      expect(database.selectValue("PRAGMA user_version;")).toBe(3);
      expect(database.selectValue("SELECT target_counter FROM library_local_preference_projection;")).toBe(0);
      expect(engine.followerMutationContext()).toEqual(beforeMigrationContext);
      // The ordinary reader stays closed to schema3 until lifecycle activation.
      expect(() => engine.status()).toThrow(/identity is unsupported/);
      database.exec("DROP INDEX library_local_preference_replacement_lookup;");
      expect(() => migratePwaPendingPreferenceProjection(database, sqlite3.capi, engine))
        .toThrow(/catalog changed/);
      throw new Error("restore dormant migration fixture");
    })).toThrow("restore dormant migration fixture");
    expect(database.selectValue("PRAGMA user_version;")).toBe(1);
    expect(engine.followerMutationContext()).toEqual(beforeMigrationContext);

    // Enrollment and its new local projection commit together on a copied
    // signed fixture. This is WASM SQLite coverage, not OPFS crash acceptance.
    const enrollmentFile=`/${fixtureId}-preference-enrollment.sqlite`;
    sqlite3.capi.sqlite3_js_posix_create_file(enrollmentFile,sqlite3.capi.sqlite3_js_db_export(database.pointer!));
    const enrollmentDb=new sqlite3.oo1.DB(enrollmentFile,"w");
    try {
      enrollmentDb.exec("PRAGMA foreign_keys=ON; PRAGMA synchronous=FULL;");
      const enrollmentEngine=new PwaLibraryCoreSqliteEngine(enrollmentDb,sqlite3.version.libVersion);
      enrollmentDb.transaction("IMMEDIATE",()=>migratePwaPendingPreferenceProjection(enrollmentDb,sqlite3.capi,enrollmentEngine));
      enrollmentDb.exec(`DELETE FROM library_local_preference_projection;
        DELETE FROM library_intent_actors;
        UPDATE library_follower_actor_request SET enrollment_certificate_digest=NULL,
          canonical_enrollment_certificate=NULL,actor_chain_genesis=NULL,enrolled_at=NULL;
        CREATE TRIGGER preference_enrollment_fault BEFORE INSERT ON library_local_preference_projection
        BEGIN SELECT RAISE(ABORT,'preference enrollment fault'); END;`);
      const input={canonicalCertificateBytes,enrolledAt:1_100};
      await expect(installPwaProjectedFollowerEnrollment(enrollmentDb,sqlite3.capi,enrollmentEngine,input))
        .rejects.toThrow("preference enrollment fault");
      expect(enrollmentDb.selectValue("SELECT count(*) FROM library_intent_actors;")).toBe(0);
      expect(enrollmentDb.selectValue("SELECT enrollment_certificate_digest FROM library_follower_actor_request;")).toBeNull();
      expect(enrollmentDb.selectValue("SELECT count(*) FROM library_local_preference_projection;")).toBe(0);
      enrollmentDb.exec("DROP TRIGGER preference_enrollment_fault;");
      const pending=installPwaProjectedFollowerEnrollment(enrollmentDb,sqlite3.capi,enrollmentEngine,input);
      enrollmentDb.exec("UPDATE library_follower_actor_request SET created_at=1001;");
      await expect(pending).rejects.toThrow("changed during verification");
      expect(enrollmentDb.selectValue("SELECT count(*) FROM library_local_preference_projection;")).toBe(0);
      enrollmentDb.exec("UPDATE library_follower_actor_request SET created_at=1000;");
      expect(await installPwaProjectedFollowerEnrollment(enrollmentDb,sqlite3.capi,enrollmentEngine,input)).toEqual(installed);
      expect(await installPwaProjectedFollowerEnrollment(enrollmentDb,sqlite3.capi,enrollmentEngine,input)).toEqual(installed);
      expect(enrollmentDb.selectValue("SELECT target_counter FROM library_local_preference_projection;")).toBe(0);
      expect(enrollmentEngine.followerMutationContext()).toEqual(beforeMigrationContext);
    } finally {enrollmentDb.close();}

    // Reproduce older checkpoint replacement losing the local request while
    // retaining the same key and the Primary's already admitted certificate.
    database.exec("DELETE FROM library_intent_actors; DELETE FROM library_follower_actor_request;");
    // Native checkpoints key capabilities by certificate digest, whereas
    // fresh browser enrollment may key them by their issuance identity.
    database.exec("BEGIN; PRAGMA defer_foreign_keys = ON;");
    for (const table of ["library_actor_capabilities", "library_actor_capability_mutations"]) {
      database.exec({ sql: `UPDATE ${table} SET capability_id = ?1;`,
        bind: [certificate.certificate.certificate_digest] });
    }
    database.exec("COMMIT;");
    const laterEnrollment = constructLibraryCoreActorEnrollmentBodyV1({
      actor_incarnation_nonce: enrollment.body.actor_incarnation_nonce,
      actor_public_key: actorPublicKey, authority_key_id: authorityKeyId,
      created_at_ms: 2_000, epoch: 1, epoch_id: epochId,
      installation_incarnation: enrollment.body.installation_incarnation,
      library_id: libraryId, observed_frontier: [], operation_id: enrollment.body.operation_id,
    }, { digest: coreDigest });
    const laterRequest = await constructLibraryCoreActorCapabilityRequestV2(
      laterEnrollment, capabilityInput, { digest: coreDigest, signActorProof },
    );
    const laterInput = {
      canonicalRequestBytes: encodeLibraryCoreCanonicalValue(laterRequest.request as unknown as LibraryCoreCanonicalValue),
      createdAt: 2_000,
    };
    await engine.storeFollowerActorRequest(laterInput);
    database.exec({
      sql: `INSERT INTO library_authority_frontier
        (epoch_id, ordinal, actor_id, accepted_counter, accepted_operation_id, accepted_chain_digest)
        VALUES (?1, 0, ?2, 1, 'operation:checkpoint-test', ?3);`,
      bind: [epochId, "88".repeat(32), "99".repeat(32)],
    });
    const assertPending = () => expect(engine.followerActorEnrollmentContext().request).toMatchObject({
      state: "pending", enrollmentRequestDigest: laterRequest.request.certificate_digest,
    });
    const corruptCertificate = encodeLibraryCoreCanonicalValue({
      ...certificate.certificate, authority_signature: "00".repeat(64),
    } as unknown as LibraryCoreCanonicalValue);
    database.exec({ sql: "UPDATE library_actors SET canonical_enrollment_certificate = ?1;",
      bind: [new TextDecoder().decode(corruptCertificate)] });
    await expect(engine.storeFollowerActorRequest(laterInput)).rejects.toThrow();
    assertPending();
    database.exec({ sql: "UPDATE library_actors SET canonical_enrollment_certificate = ?1;",
      bind: [new TextDecoder().decode(canonicalCertificateBytes)] });
    database.exec({ sql: "UPDATE library_actors SET public_key = ?1;", bind: ["00".repeat(32)] });
    await expect(engine.storeFollowerActorRequest(laterInput)).rejects.toThrow(/unused active actor/);
    assertPending();
    database.exec({ sql: "UPDATE library_actors SET public_key = ?1;", bind: [actorPublicKey] });
    database.exec("UPDATE library_actors SET retired_at = 2100;");
    await expect(engine.storeFollowerActorRequest(laterInput)).rejects.toThrow(/unused active actor/);
    assertPending();
    database.exec("UPDATE library_actors SET retired_at = NULL;");
    database.exec("UPDATE library_actors SET accepted_counter = 1, accepted_operation_id = 'operation:existing-edit';");
    await expect(engine.storeFollowerActorRequest(laterInput)).rejects.toThrow(/unused active actor/);
    assertPending();
    database.exec("UPDATE library_actors SET accepted_counter = 0, accepted_operation_id = NULL;");
    database.exec({
      sql: "INSERT INTO library_intent_actors VALUES (?1, 1, NULL, ?2);",
      bind: [enrollment.body.actor_id, certificate.actor_chain_genesis],
    });
    await expect(engine.storeFollowerActorRequest(laterInput)).rejects.toThrow(/empty local intent history/);
    assertPending();
    database.exec("DELETE FROM library_intent_actors;");
    database.exec(`CREATE TEMP TRIGGER fail_recovery BEFORE INSERT ON library_intent_actors
      BEGIN SELECT RAISE(ABORT, 'recovery fault'); END;`);
    await expect(engine.storeFollowerActorRequest(laterInput)).rejects.toThrow(/recovery fault/);
    assertPending();
    database.exec("DROP TRIGGER fail_recovery;");
    const recovered = await engine.storeFollowerActorRequest(laterInput);
    expect(recovered).toMatchObject({ state: "enrolled", enrollmentRequestDigest: laterRequest.request.certificate_digest });
    expect(Array.from(recovered.canonicalRequestBytes)).toEqual(Array.from(laterInput.canonicalRequestBytes));
    expect(database.exec({ sql: "SELECT enrollment_certificate_digest FROM library_follower_actor_request;",
      rowMode: 0, returnValue: "resultRows" })).toEqual([certificate.certificate.certificate_digest]);
    expect(engine.followerMutationContext()).toMatchObject({
      actor_id: enrollment.body.actor_id, next_actor_sequence: 1,
      previous_actor_chain_digest: certificate.actor_chain_genesis,
    });
    await expect(engine.storeFollowerActorRequest(laterInput)).resolves.toEqual(recovered);
    const originalPreferenceBytes: Uint8Array[] = [];
    const originalPreferenceDigests: string[] = [];
    for (const sequence of [1,2]) {
      const tip = engine.followerMutationContext();
      const member = PREFERENCES_LEAF_ASSIGNMENT_TRANSACTION_MEMBER_SCHEMA.construct({
        actor_id:tip.actor_id, actor_sequence:tip.next_actor_sequence, causal_frontier:[],
        created_at_ms:3000+sequence, entity_id:"preferences", epoch:tip.epoch, epoch_id:tip.epoch_id,
        hlc_counter:0, hlc_wall_ms:3000+sequence, library_id:tip.library_id,
        operation_id:`preference-operation-${sequence}`, previous_actor_operation_id:tip.previous_actor_operation_id,
        transaction_id:`preference-transaction-${sequence}`, transaction_member_count:1, transaction_member_index:0,
        payload:{updates:{friendSuggestions:{dismissedSuggestionIds:sequence===1?["a"]:["a","b"]}}},
      }, {digest:coreDigest});
      const finalized = await finalizeLibraryCoreTransactionV1(
        assembleLibraryCoreTransactionV1([member],tip.previous_actor_chain_digest,{digest:coreDigest}), {
          digest:coreDigest, async signOperation(message) { return sign(null,message,actorKeys.privateKey).toString("hex"); },
        });
      const bytes = encodeLibraryCoreCanonicalValue(finalized.members[0]!.envelope as unknown as LibraryCoreCanonicalValue);
      await engine.commitFollowerIntent({envelopeBytes:[bytes]});
      originalPreferenceBytes.push(bytes);
      originalPreferenceDigests.push(finalized.members[0]!.envelope_digest);
    }
    const pendingTip = engine.followerMutationContext();
    const preferenceSequence = Number(database.selectValue("SELECT sequence FROM library_local_change_state;"));
    database.transaction("IMMEDIATE", () => migratePwaPendingPreferenceProjection(database, sqlite3.capi, engine));
    database.transaction("IMMEDIATE", () => migratePwaPendingPreferenceProjection(database, sqlite3.capi, engine));
    expect(database.selectValue("PRAGMA user_version;")).toBe(3);
    expect(database.selectValue("SELECT last_counter FROM library_local_preference_projection;")).toBe(0);
    expect(database.selectValue("SELECT previous_chain_digest FROM library_local_preference_projection;")).toBe(certificate.actor_chain_genesis);
    expect(() => new PwaLibraryCoreSqliteEngine(database, sqlite3.version.libVersion).initialize())
      .toThrow(/schema version is unsupported/);
    expect(database.selectValue("PRAGMA user_version;")).toBe(3);
    database.exec(`CREATE TEMP TRIGGER fail_preference_cursor BEFORE UPDATE ON library_local_preference_projection
      BEGIN SELECT RAISE(ABORT,'preference cursor fault'); END;`);
    await expect(backfillPwaPendingPreferenceProjection(database,engine)).rejects.toThrow(/preference cursor fault/);
    expect(database.selectValue("SELECT count(*) FROM library_local_preference_nodes;")).toBe(0);
    expect(database.selectValue("SELECT last_counter FROM library_local_preference_projection;")).toBe(0);
    expect(database.selectValue("SELECT sequence FROM library_local_change_state;")).toBe(preferenceSequence);
    database.exec("DROP TRIGGER fail_preference_cursor;");
    database.exec("UPDATE library_local_change_state SET sequence=9007199254740991;");
    await expect(backfillPwaPendingPreferenceProjection(database,engine)).rejects.toThrow();
    expect(database.selectValue("SELECT count(*) FROM library_local_preference_nodes;")).toBe(0);
    expect(database.selectValue("SELECT last_counter FROM library_local_preference_projection;")).toBe(0);
    database.exec({sql:"UPDATE library_local_change_state SET sequence=?1;",bind:[preferenceSequence]});

    let changedDuringVerification = false;
    const racingSubtle = new Proxy(crypto.subtle, { get(target,property) {
      if (property === "verify") return async (...args: Parameters<SubtleCrypto["verify"]>) => {
        const valid = await target.verify(...args);
        if (!changedDuringVerification) {
          changedDuringVerification = true;
          database.exec("UPDATE library_intent_transactions SET state='published' WHERE transaction_id='preference-transaction-1';");
        }
        return valid;
      };
      const value = Reflect.get(target,property,target);
      return typeof value === "function" ? value.bind(target) : value;
    }});
    await expect(backfillPwaPendingPreferenceProjection(database,engine,racingSubtle)).rejects.toThrow(/changed during verification/);
    expect(database.selectValue("SELECT count(*) FROM library_local_preference_nodes;")).toBe(0);
    database.exec("UPDATE library_intent_transactions SET state='pending' WHERE transaction_id='preference-transaction-1';");
    expect(await backfillPwaPendingPreferenceProjection(database,engine)).toBe(false);
    expect(database.selectValue("SELECT count(*) FROM library_local_preference_nodes;")).toBe(3);
    const corrupted = JSON.parse(new TextDecoder().decode(originalPreferenceBytes[1]!));
    corrupted.signature = (corrupted.signature.startsWith("0")?"1":"0")+corrupted.signature.slice(1);
    database.exec({sql:"UPDATE library_intent_members SET canonical_member=?1 WHERE transaction_id='preference-transaction-2';",
      bind:[encodeLibraryCoreCanonicalValue(corrupted as LibraryCoreCanonicalValue)]});
    await expect(backfillPwaPendingPreferenceProjection(database,engine)).rejects.toThrow();
    expect(database.selectValue("SELECT last_counter FROM library_local_preference_projection;")).toBe(1);
    database.exec({sql:"UPDATE library_intent_members SET canonical_member=?1 WHERE transaction_id='preference-transaction-2';",bind:[originalPreferenceBytes[1]!]});
    expect(await backfillPwaPendingPreferenceProjection(database,engine)).toBe(true);
    expect(await backfillPwaPendingPreferenceProjection(database,engine)).toBe(true);
    expect(database.selectValue("SELECT count(*) FROM library_local_preference_nodes;")).toBe(7);
    expect(engine.followerMutationContext()).toEqual(pendingTip);
    const retained = database.exec({sql:"SELECT canonical_member FROM library_intent_members ORDER BY actor_counter;",rowMode:0,returnValue:"resultRows"});
    expect(retained).toEqual(originalPreferenceBytes);
    expect(database.selectValue("SELECT sequence FROM library_local_change_state;")).toBe(preferenceSequence+2);
    expect(database.selectValue("SELECT count(*) FROM library_local_invalidations WHERE topic='preferences' AND reason='optimistic_added';")).toBe(2);

    // Outcome fixtures bind real signatures to retained transaction bytes. The
    // covered case supplies a canonical revision fixture, not checkpoint-import proof.
    const original = JSON.parse(new TextDecoder().decode(originalPreferenceBytes[0]!));
    const resultImportBase=sqlite3.capi.sqlite3_js_db_export(database.pointer!);
    {
      const rejected = outcome === "rejected";
      const unsigned = parseLibraryCoreFollowerResultEnvelopeV1({
        actor_id:pendingTip.actor_id, authoritative_source_revision:9, authority_key_id:authorityKeyId,
        canonical_operation_ids:rejected?[]:[original.operation_id], epoch:1, epoch_id:epochId,
        format:"freed_follower_result_v1", intent_epoch:1, intent_epoch_id:epochId, library_id:libraryId,
        original_result_digest:null, previous_result_digest:null, receipt_ids:rejected?[]:["ab".repeat(32)],
        rejection_reason:rejected?"capability_denied":null, replacement_fields:[], resolved_at_ms:4000,
        result_body_digest:"0".repeat(64), result_sequence:1, schema_version:1,
        signature:"0".repeat(128), signature_algorithm:"ed25519", status:rejected?"rejected":"accepted",
        transaction_digest:original.transaction_digest, transaction_id:original.transaction_id,
      });
      const digest = coreDigest("follower-result-body",libraryCoreFollowerResultBodyV1(unsigned));
      const signed = { ...unsigned, result_body_digest:digest,
        signature:sign(null,encodeLibraryCoreSignatureInput("follower-result-envelope",{result_body_digest:digest}),authorityKeys.privateKey).toString("hex") };
      const resultBytes = encodeLibraryCoreCanonicalValue(signed as unknown as LibraryCoreCanonicalValue);
      if(outcome!=="accepted-covered") {
      for(const delivery of resultDeliveries) {
      const receiptFile=`/${fixtureId}-projected-result-${outcome}-${delivery}.sqlite`;
      sqlite3.capi.sqlite3_js_posix_create_file(receiptFile,resultImportBase);
      const receiptDb=new sqlite3.oo1.DB(receiptFile,"w");
      try {
        receiptDb.exec("PRAGMA foreign_keys=ON; PRAGMA synchronous=FULL;");
        const revision=0;
        receiptDb.exec({sql:"UPDATE library_meta SET source_revision=?1;",bind:[revision]});
        receiptDb.exec({sql:"UPDATE library_change_state SET revision=?1;",bind:[revision]});
        const receiptEngine=new PwaLibraryCoreSqliteEngine(receiptDb,sqlite3.version.libVersion,{now:()=>5000});
        const sequence=Number(receiptDb.selectValue("SELECT sequence FROM library_local_change_state;"));
        const input={canonicalResultBytes:resultBytes};
        const body=parseLibraryCoreNormalizedResultSegmentBodyV2({actor_id:pendingTip.actor_id,
          canonical_result_bytes:resultBytes.byteLength,first_result_sequence:1,format:"freed_normalized_result_segment_v2",
          kind:"normalized_result_segment_body",last_result_sequence:1,library_id:libraryId,previous_segment_digest:null,
          protocol:"normalized_result_segments_v2",protocol_version:2,result_count:1,results:[signed],storage_epoch_id:epochId});
        const contentDigest="14".repeat(32);
        const publication=parseLibraryCoreNormalizedResultTransportImportV2({
          header:normalizedResultSegmentHeaderFromBodyV2(body,coreDigest("normalized-result-segment-body-v2",body)),
          receivedAt:5000,reference:{descriptor:{byteLength:resultBytes.byteLength,contentDigest,
            objectKey:createLibraryCoreImmutableObjectKey({actorId:pendingTip.actor_id,digest:contentDigest,epochId,
              firstSequence:1,kind:"result_segment",lastSequence:1,libraryId})},transportObjectId:"projected-result-object"},results:[signed],
        });
        const deliver=(value:typeof input)=>delivery==="receipt"
          ?storePwaProjectedFollowerResult(receiptDb,receiptEngine,value,sqlite3.capi)
          :storePwaProjectedResultTransport(receiptDb,receiptEngine,publication,sqlite3.capi);

        if(outcome!=="accepted-ahead") {
          receiptDb.exec(`CREATE TEMP TRIGGER projected_result_fault BEFORE INSERT ON library_local_invalidations
            WHEN NEW.topic='preferences' AND NEW.reason='optimistic_removed' BEGIN SELECT RAISE(ABORT,'projected result fault'); END;`);
          await expect(deliver(input)).rejects.toThrow("projected result fault");
          expect(receiptDb.selectValue("SELECT count(*) FROM library_intent_results;")).toBe(0);
          expect(receiptDb.selectValue("SELECT count(*) FROM library_intent_result_cursors;")).toBe(0);
          expect(receiptDb.selectValue("SELECT count(*) FROM library_result_transport_heads;")).toBe(0);
          expect(receiptDb.selectValue("SELECT count(*) FROM library_result_transport_segments;")).toBe(0);
          expect(receiptDb.selectValue("SELECT count(*) FROM library_local_preference_nodes;")).toBe(7);
          expect(receiptDb.selectValue("SELECT sequence FROM library_local_change_state;")).toBe(sequence);
          receiptDb.exec("DROP TRIGGER projected_result_fault;");
        }
        const suppliedBytes=Uint8Array.from(resultBytes);
        const pendingReceipt=deliver({canonicalResultBytes:suppliedBytes});
        suppliedBytes.fill(0);
        const receipt=await pendingReceipt;
        expect(receiptDb.selectValue("SELECT count(*) FROM library_local_preference_nodes;")).toBe(outcome==="accepted-ahead"?7:4);
        const settledSequence=receiptDb.selectValue("SELECT sequence FROM library_local_change_state;");
        expect(await deliver(input)).toEqual(receipt);
        expect(receiptDb.selectValue("SELECT sequence FROM library_local_change_state;")).toBe(settledSequence);
        expect(receiptEngine.followerMutationContext()).toEqual(pendingTip);
      } finally {receiptDb.close();}
      }
      }
      if(outcome==="accepted-ahead") {
        for (const delivery of canonicalDeliveries) {
        const laterCoverage = delivery === "later-coverage";
        const canonicalFile=`/${fixtureId}-projected-canonical-${delivery}.sqlite`;
        sqlite3.capi.sqlite3_js_posix_create_file(canonicalFile,resultImportBase);
        const canonicalDb=new sqlite3.oo1.DB(canonicalFile,"w");
        try {
          canonicalDb.exec("PRAGMA foreign_keys=ON; PRAGMA synchronous=FULL;");
          const writer="fe".repeat(32),placeholder="fc".repeat(32);
          // Accepted checkpoint writer catalog is synthetic; consumer operation,
          // authority result signature and canonical materialization are real.
          canonicalDb.exec({sql:`INSERT INTO library_actors(actor_id,authority_epoch_id,actor_kind,public_key,enrollment_operation_id,
            enrollment_certificate_digest,canonical_enrollment_certificate,chain_genesis_digest,accepted_counter,accepted_operation_id,accepted_chain_digest,created_at,updated_at)
            VALUES(?1,?2,'desktop',?3,'fixture-primary',?3,'{}',?3,0,NULL,?3,1,1);`,bind:[writer,epochId,placeholder]});
          canonicalDb.exec({sql:"UPDATE library_active_authority SET writer_id=?1;",bind:[writer]});
          canonicalDb.exec({sql:"INSERT INTO library_materialization_generation(singleton_id,generation_id) VALUES(1,?1);",bind:["ad".repeat(32)]});
          const canonicalEngine=new PwaLibraryCoreSqliteEngine(canonicalDb,sqlite3.version.libVersion,{now:()=>5000});
          const accepted={...unsigned,authoritative_source_revision:1,receipt_ids:[originalPreferenceDigests[0]!]};
          const acceptedDigest=coreDigest("follower-result-body",libraryCoreFollowerResultBodyV1(accepted));
          const acceptedBytes=encodeLibraryCoreCanonicalValue({...accepted,result_body_digest:acceptedDigest,
            signature:sign(null,encodeLibraryCoreSignatureInput("follower-result-envelope",{result_body_digest:acceptedDigest}),authorityKeys.privateKey).toString("hex"),
          } as unknown as LibraryCoreCanonicalValue);
          const acceptedInput={canonicalResultBytes:acceptedBytes};
          const records = [
            {canonicalRecordJson:new TextDecoder().decode(acceptedBytes),kind:"accepted_transaction",memberIndex:-1,recordDigest:acceptedDigest},
            {canonicalRecordJson:new TextDecoder().decode(originalPreferenceBytes[0]!),kind:"operation",memberIndex:0,recordDigest:originalPreferenceDigests[0]!},
          ].map(record=>({...record,sourceRevision:1,transactionDigest:accepted.transaction_digest,transactionId:accepted.transaction_id}));
          const operationInput=parseLibraryCoreNormalizedOperationImportPageV2({
            snapshot:{authorityEpoch:epochId,firstAvailableRevision:1,format:"freed_normalized_operation_export_v2",
              libraryId,operationCount:1,protocolVersion:2,sourceRevision:1,transactionCount:1,writerId:writer},
            receivedAt:5000,page:{canonicalRecordBytes:records.reduce((sum,record)=>sum+new TextEncoder().encode(record.canonicalRecordJson).byteLength,0),
              done:true,nextCursor:{kind:"operation",memberIndex:0,recordDigest:originalPreferenceDigests[0]!,sourceRevision:1},records},
          });
          const catchUp=()=>delivery==="receipt-catch-up"
            ?catchUpPwaProjectedAcceptedResult(canonicalDb,canonicalEngine,acceptedInput,sqlite3.capi)
            :importPwaProjectedOperationPage(canonicalDb,canonicalEngine,operationInput,sqlite3.capi);
          await storePwaProjectedFollowerResult(canonicalDb,canonicalEngine,acceptedInput,sqlite3.capi);
          if (laterCoverage) {
            // Seed a retained, authority-signed already-applied receipt at a
            // later frontier. Receipt admission itself is covered separately.
            const later = {...accepted,status:"already_applied" as const,authoritative_source_revision:2,original_result_digest:acceptedDigest};
            const digest=coreDigest("follower-result-body",libraryCoreFollowerResultBodyV1(later));
            const bytes=encodeLibraryCoreCanonicalValue({...later,result_body_digest:digest,
              signature:sign(null,encodeLibraryCoreSignatureInput("follower-result-envelope",{result_body_digest:digest}),authorityKeys.privateKey).toString("hex"),
            } as unknown as LibraryCoreCanonicalValue);
            canonicalDb.exec({sql:"UPDATE library_intent_results SET status='already_applied',authoritative_source_revision=2,result_digest=?1,canonical_result=?2;",bind:[digest,bytes]});
          }
          if (delivery === "operation-page") {
            canonicalDb.exec("UPDATE library_local_preference_projection SET last_counter=last_counter-1;");
            await expect(catchUp()).rejects.toThrow("requires completed backfill");
            expect(canonicalDb.selectValue("SELECT count(*) FROM library_operation_replication_stages;")).toBe(0);
            expect(canonicalDb.selectValue("SELECT source_revision FROM library_meta;")).toBe(0);
            canonicalDb.exec("UPDATE library_local_preference_projection SET last_counter=last_counter+1;");
          }
          const sequence=canonicalDb.selectValue("SELECT sequence FROM library_local_change_state;");
          if (!laterCoverage) {
          canonicalDb.exec(`CREATE TEMP TRIGGER canonical_preference_fault BEFORE INSERT ON library_local_invalidations
            WHEN NEW.topic='preferences' AND NEW.reason='optimistic_removed' BEGIN SELECT RAISE(ABORT,'canonical preference fault'); END;`);
          await expect(catchUp()).rejects.toThrow("canonical preference fault");
          expect(canonicalDb.selectValue("SELECT source_revision FROM library_meta;")).toBe(0);
          expect(canonicalDb.selectValue("SELECT count(*) FROM library_operations;")).toBe(0);
          expect(canonicalDb.selectValue("SELECT text_value FROM library_preferences WHERE path='v:$.friendSuggestions.dismissedSuggestionIds[0]';")).toBeUndefined();
          expect(canonicalDb.selectValue("SELECT count(*) FROM library_local_preference_nodes;")).toBe(7);
          expect(canonicalDb.selectValue("SELECT count(*) FROM library_operation_replication_stages;")).toBe(1);
          expect(canonicalDb.selectValue("SELECT sequence FROM library_local_change_state;")).toBe(sequence);
          canonicalDb.exec("DROP TRIGGER canonical_preference_fault;");
          }
          await catchUp();
          expect(canonicalDb.selectValue("SELECT source_revision FROM library_meta;")).toBe(1);
          expect(canonicalDb.selectValue("SELECT count(*) FROM library_operations;")).toBe(1);
          expect(canonicalDb.selectValue("SELECT text_value FROM library_preferences WHERE path='v:$.friendSuggestions.dismissedSuggestionIds[0]';")).toBe("a");
          const visible=readPwaVisiblePreferenceValue(canonicalDb,canonicalEngine,["friendSuggestions","dismissedSuggestionIds"],readPwaVisiblePreferenceSource(canonicalDb,canonicalEngine));
          expect(visible.rows.filter(row=>row.valueType==="text").map(row=>row.textValue)).toEqual(["a","b"]);
          expect(canonicalDb.selectValue("SELECT count(*) FROM library_local_preference_nodes;")).toBe(laterCoverage?7:4);
          expect(canonicalDb.selectValue("SELECT count(*) FROM library_operation_replication_stages;")).toBe(0);
          expect(canonicalDb.selectValue("SELECT sequence FROM library_local_change_state;")).toBe(Number(sequence)+(laterCoverage?0:1));
          const stored=canonicalDb.exec({sql:"SELECT canonical_member FROM library_intent_members ORDER BY actor_counter;",rowMode:0,returnValue:"resultRows"});
          expect(stored).toEqual(originalPreferenceBytes);
          const finalTip=canonicalEngine.followerMutationContext();
          await catchUp();
          expect(canonicalDb.selectValue("SELECT sequence FROM library_local_change_state;")).toBe(Number(sequence)+(laterCoverage?0:1));
          expect(canonicalEngine.followerMutationContext()).toEqual(finalTip);
          expect(canonicalDb.selectValue("SELECT count(*) FROM main.sqlite_schema WHERE name='canonical_verified_preference_results';")).toBe(0);
          if (laterCoverage) {
            const second=JSON.parse(new TextDecoder().decode(originalPreferenceBytes[1]!));
            const nextAccepted={...accepted,authoritative_source_revision:2,transaction_id:second.transaction_id,
              transaction_digest:second.transaction_digest,canonical_operation_ids:[second.operation_id],receipt_ids:[originalPreferenceDigests[1]!]};
            const digest=coreDigest("follower-result-body",libraryCoreFollowerResultBodyV1(nextAccepted));
            const bytes=encodeLibraryCoreCanonicalValue({...nextAccepted,result_body_digest:digest,
              signature:sign(null,encodeLibraryCoreSignatureInput("follower-result-envelope",{result_body_digest:digest}),authorityKeys.privateKey).toString("hex"),
            } as unknown as LibraryCoreCanonicalValue);
            const nextRecords=[
              {canonicalRecordJson:new TextDecoder().decode(bytes),kind:"accepted_transaction",memberIndex:-1,recordDigest:digest},
              {canonicalRecordJson:new TextDecoder().decode(originalPreferenceBytes[1]!),kind:"operation",memberIndex:0,recordDigest:originalPreferenceDigests[1]!},
            ].map(record=>({...record,sourceRevision:2,transactionDigest:second.transaction_digest,transactionId:second.transaction_id}));
            const nextInput=parseLibraryCoreNormalizedOperationImportPageV2({...operationInput,
              snapshot:{...operationInput.snapshot,firstAvailableRevision:2,sourceRevision:2},
              page:{canonicalRecordBytes:nextRecords.reduce((sum,record)=>sum+new TextEncoder().encode(record.canonicalRecordJson).byteLength,0),
                done:true,nextCursor:{kind:"operation",memberIndex:0,recordDigest:originalPreferenceDigests[1]!,sourceRevision:2},records:nextRecords},
            });
            const advance=()=>importPwaProjectedOperationPage(canonicalDb,canonicalEngine,nextInput,sqlite3.capi);
            canonicalDb.exec(`CREATE TEMP TRIGGER changed_covered_evidence AFTER UPDATE OF source_revision ON library_meta
              WHEN NEW.source_revision=2 BEGIN UPDATE library_intent_results SET authoritative_source_revision=99; END;`);
            await expect(advance()).rejects.toThrow("changed verified preference result evidence");
            expect(canonicalDb.selectValue("SELECT source_revision FROM library_meta;")).toBe(1);
            expect(canonicalDb.selectValue("SELECT authoritative_source_revision FROM library_intent_results;")).toBe(2);
            expect(canonicalDb.selectValue("SELECT count(*) FROM library_local_preference_nodes;")).toBe(7);
            expect(canonicalDb.selectValue("SELECT count(*) FROM main.sqlite_schema WHERE name='canonical_verified_preference_results';")).toBe(0);
            canonicalDb.exec("DROP TRIGGER changed_covered_evidence;");
            canonicalDb.exec(`CREATE TEMP TRIGGER later_coverage_fault BEFORE INSERT ON library_local_invalidations
              WHEN NEW.topic='preferences' AND NEW.reason='optimistic_removed' BEGIN SELECT RAISE(ABORT,'later coverage fault'); END;`);
            await expect(advance()).rejects.toThrow("later coverage fault");
            expect(canonicalDb.selectValue("SELECT source_revision FROM library_meta;")).toBe(1);
            expect(canonicalDb.selectValue("SELECT count(*) FROM library_local_preference_nodes;")).toBe(7);
            expect(canonicalDb.selectValue("SELECT sequence FROM library_local_change_state;")).toBe(sequence);
            expect(canonicalDb.selectValue("SELECT count(*) FROM main.sqlite_schema WHERE name='canonical_verified_preference_results';")).toBe(0);
            canonicalDb.exec("DROP TRIGGER later_coverage_fault;");
            await advance();
            expect(canonicalDb.selectValue("SELECT source_revision FROM library_meta;")).toBe(2);
            expect(canonicalDb.selectValue("SELECT count(*) FROM library_operations;")).toBe(2);
            expect(canonicalDb.selectValue("SELECT count(*) FROM library_local_preference_nodes WHERE transaction_id='preference-transaction-1';")).toBe(0);
            expect(canonicalDb.selectValue("SELECT count(*) FROM library_local_preference_nodes;")).toBe(4);
            expect(canonicalDb.selectValue("SELECT sequence FROM library_local_change_state;")).toBe(Number(sequence)+1);
            await advance();
            expect(canonicalDb.selectValue("SELECT sequence FROM library_local_change_state;")).toBe(Number(sequence)+1);
            expect(canonicalEngine.followerMutationContext()).toEqual(finalTip);
          }
        } finally {canonicalDb.close();}
        }
      }
      database.transaction("IMMEDIATE", () => {
        database.exec("DELETE FROM library_local_preference_nodes; DELETE FROM library_intent_results; UPDATE library_intent_transactions SET state='pending';");
        database.exec({sql:"UPDATE library_local_preference_projection SET last_counter=0,previous_operation_id=NULL,previous_chain_digest=?1;",bind:[certificate.actor_chain_genesis]});
        database.exec({sql:"UPDATE library_meta SET source_revision=?1;",bind:[outcome==="accepted-covered"?9:0]});
        database.exec({sql:"UPDATE library_intent_transactions SET state=?1 WHERE transaction_id=?2;",bind:[signed.status,original.transaction_id]});
        database.exec({sql:`INSERT INTO library_intent_results
          (transaction_id,actor_id,authority_epoch_id,intent_epoch_id,result_sequence,previous_result_digest,result_digest,status,authoritative_source_revision,canonical_result,received_at)
          VALUES (?1,?2,?3,?3,1,NULL,?4,?5,9,?6,4000);`,
          bind:[original.transaction_id,pendingTip.actor_id,epochId,digest,signed.status,resultBytes]});
      });
      // Authentic-looking typed metadata cannot replace the authority signature.
      const badResult = encodeLibraryCoreCanonicalValue({ ...signed,
        signature:(signed.signature.startsWith("0")?"1":"0")+signed.signature.slice(1) } as unknown as LibraryCoreCanonicalValue);
      database.exec({sql:"UPDATE library_intent_results SET canonical_result=?1;",bind:[badResult]});
      await expect(backfillPwaPendingPreferenceProjection(database,engine)).rejects.toThrow();
      expect(database.selectValue("SELECT last_counter FROM library_local_preference_projection;")).toBe(0);
      expect(database.selectValue("SELECT count(*) FROM library_local_preference_nodes;")).toBe(0);
      database.exec({sql:"UPDATE library_intent_results SET canonical_result=?1;",bind:[resultBytes]});
      expect(await backfillPwaPendingPreferenceProjection(database,engine)).toBe(false);
      expect(database.selectValue("SELECT count(*) FROM library_local_preference_nodes;")).toBe(outcome==="accepted-ahead"?3:0);
      expect(await backfillPwaPendingPreferenceProjection(database,engine)).toBe(true);
      expect(database.selectValue("SELECT count(*) FROM library_local_preference_nodes;")).toBe(outcome==="accepted-ahead"?7:4);
      expect(engine.followerMutationContext()).toEqual(pendingTip);
      const sequenceBeforeSettlement=Number(database.selectValue("SELECT sequence FROM library_local_change_state;"));
      expect(await settlePwaPendingPreferenceProjection(database,engine,original.transaction_id,sqlite3.capi)).toBe(false);
      expect(database.selectValue("SELECT sequence FROM library_local_change_state;")).toBe(sequenceBeforeSettlement);
      if (outcome==="accepted-ahead") {
        const proof=await preparePwaPreferenceCheckpointVerification(database,engine);
        expect(()=>proof.assertUnchanged(sqlite3.capi)).toThrow("owned write transaction");
        database.transaction("IMMEDIATE",()=>proof.assertUnchanged(sqlite3.capi));
        // Separate connections exercise data_version, which is not covered by
        // this connection's total_changes counter. This uses the WASM test VFS.
        const proofFile=`/${fixtureId}-preference-checkpoint-proof.sqlite`;
        sqlite3.capi.sqlite3_js_posix_create_file(proofFile,sqlite3.capi.sqlite3_js_db_export(database.pointer!));
        const proofReader=new sqlite3.oo1.DB(proofFile,"w");
        const proofWriter=new sqlite3.oo1.DB(proofFile,"w");
        try {
          proofReader.exec("PRAGMA foreign_keys=ON; PRAGMA synchronous=FULL;");
          const proofEngine=new PwaLibraryCoreSqliteEngine(proofReader,sqlite3.version.libVersion);
          const externalProof=await preparePwaPreferenceCheckpointVerification(proofReader,proofEngine);
          const ownChanges=proofReader.selectValue("SELECT total_changes();");
          proofWriter.exec("UPDATE library_intent_results SET received_at=4001;");
          expect(proofReader.selectValue("SELECT total_changes();")).toBe(ownChanges);
          expect(()=>proofReader.transaction("IMMEDIATE",()=>externalProof.assertUnchanged(sqlite3.capi))).toThrow("changed during verification");
        } finally {proofWriter.close();proofReader.close();}
        const beforeSchema=await preparePwaPreferenceCheckpointVerification(database,engine);
        database.exec("CREATE TEMP TABLE preference_proof_schema_probe(value INTEGER);");
        expect(()=>database.transaction("IMMEDIATE",()=>beforeSchema.assertUnchanged(sqlite3.capi))).toThrow("changed during verification");
        database.exec("DROP TABLE preference_proof_schema_probe;");
        database.exec("UPDATE library_intent_results SET received_at=4001;");
        expect(()=>database.transaction("IMMEDIATE",()=>proof.assertUnchanged(sqlite3.capi))).toThrow("changed during verification");
        database.exec("UPDATE library_intent_results SET received_at=4000;");
        let checkpointRace=false;
        const checkpointSubtle=new Proxy(crypto.subtle,{get(target,property){
          if (property==="verify") return async (...args:Parameters<SubtleCrypto["verify"]>)=>{
            expect(sqlite3.capi.sqlite3_get_autocommit(database.pointer!)).toBe(1);
            const valid=await target.verify(...args);
            if (!checkpointRace) {checkpointRace=true;database.exec("UPDATE library_intent_results SET received_at=4001;");}
            return valid;
          };
          const value=Reflect.get(target,property,target);return typeof value==="function"?value.bind(target):value;
        }});
        await expect(preparePwaPreferenceCheckpointVerification(database,engine,checkpointSubtle)).rejects.toThrow("changed during verification");
        database.exec("UPDATE library_intent_results SET received_at=4000;");
        database.exec("UPDATE library_intent_results SET authoritative_source_revision=1000000;");
        await expect(preparePwaPreferenceCheckpointVerification(database,engine)).rejects.toThrow("evidence changed");
        database.exec("UPDATE library_intent_results SET authoritative_source_revision=9;");
        database.exec("UPDATE library_meta SET source_revision=9;");
        database.exec("UPDATE library_intent_results SET authoritative_source_revision=10;");
        await expect(settlePwaPendingPreferenceProjection(database,engine,original.transaction_id,sqlite3.capi)).rejects.toThrow(/evidence changed/);
        expect(database.selectValue("SELECT count(*) FROM library_local_preference_nodes;")).toBe(7);
        database.exec("UPDATE library_intent_results SET authoritative_source_revision=9;");
        database.exec(`CREATE TEMP TRIGGER settlement_notification_fault BEFORE INSERT ON library_local_invalidations
          WHEN NEW.reason='optimistic_removed' BEGIN SELECT RAISE(ABORT,'settlement notification fault'); END;`);
        await expect(settlePwaPendingPreferenceProjection(database,engine,original.transaction_id,sqlite3.capi)).rejects.toThrow(/settlement notification fault/);
        expect(database.selectValue("SELECT count(*) FROM library_local_preference_nodes;")).toBe(7);
        expect(database.selectValue("SELECT sequence FROM library_local_change_state;")).toBe(sequenceBeforeSettlement);
        database.exec("DROP TRIGGER settlement_notification_fault;");
        const preparedSettlement=await preparePwaPendingPreferenceSettlement(database,engine,resultBytes);
        expect(()=>preparedSettlement.commit(sqlite3.capi)).toThrow(/owned write transaction/);
        expect(()=>database.transaction("IMMEDIATE",()=>{
          database.exec("UPDATE library_intent_results SET received_at=5000;");
          expect(preparedSettlement.commit(sqlite3.capi)).toBe(true);
          throw new Error("caller result commit fault");
        })).toThrow("caller result commit fault");
        expect(database.selectValue("SELECT received_at FROM library_intent_results;")).toBe(4000);
        expect(database.selectValue("SELECT count(*) FROM library_local_preference_nodes;")).toBe(7);
        expect(database.selectValue("SELECT sequence FROM library_local_change_state;")).toBe(sequenceBeforeSettlement);

        expect(await settlePwaPendingPreferenceProjection(database,engine,original.transaction_id,sqlite3.capi)).toBe(true);
        expect(await settlePwaPendingPreferenceProjection(database,engine,original.transaction_id,sqlite3.capi)).toBe(false);
        expect(database.selectValue("SELECT count(*) FROM library_local_preference_nodes;")).toBe(4);
        expect(database.selectValue("SELECT sequence FROM library_local_change_state;")).toBe(sequenceBeforeSettlement+1);
        const secondOriginal=JSON.parse(new TextDecoder().decode(originalPreferenceBytes[1]!));
        const rejected= parseLibraryCoreFollowerResultEnvelopeV1({...unsigned,
          transaction_id:secondOriginal.transaction_id, transaction_digest:secondOriginal.transaction_digest,
          status:"rejected", rejection_reason:"capability_denied", canonical_operation_ids:[],receipt_ids:[],
          result_sequence:2, previous_result_digest:digest,
        });
        const rejectionDigest=coreDigest("follower-result-body",libraryCoreFollowerResultBodyV1(rejected));
        const rejectionBytes=encodeLibraryCoreCanonicalValue({...rejected,result_body_digest:rejectionDigest,
          signature:sign(null,encodeLibraryCoreSignatureInput("follower-result-envelope",{result_body_digest:rejectionDigest}),authorityKeys.privateKey).toString("hex"),
        } as unknown as LibraryCoreCanonicalValue);
        const preparedRejection=await preparePwaPendingPreferenceSettlement(database,engine,rejectionBytes);
        const commitRejection=()=>{
          database.exec({sql:"UPDATE library_intent_transactions SET state='rejected' WHERE transaction_id=?1;",bind:[secondOriginal.transaction_id]});
          database.exec({sql:`INSERT INTO library_intent_results
            (transaction_id,actor_id,authority_epoch_id,intent_epoch_id,result_sequence,previous_result_digest,result_digest,status,authoritative_source_revision,canonical_result,received_at)
            VALUES (?1,?2,?3,?3,2,?4,?5,'rejected',9,?6,5000);`,
            bind:[secondOriginal.transaction_id,pendingTip.actor_id,epochId,digest,rejectionDigest,rejectionBytes]});
          expect(preparedRejection.commit(sqlite3.capi)).toBe(true);
        };
        expect(()=>database.transaction("IMMEDIATE",()=>{
          commitRejection(); throw new Error("rejection import fault");
        })).toThrow("rejection import fault");
        expect(database.selectValue("SELECT count(*) FROM library_intent_results;")).toBe(1);
        expect(database.selectValue("SELECT state FROM library_intent_transactions WHERE transaction_id='preference-transaction-2';")).toBe("pending");
        expect(database.selectValue("SELECT count(*) FROM library_local_preference_nodes;")).toBe(4);
        expect(database.selectValue("SELECT sequence FROM library_local_change_state;")).toBe(sequenceBeforeSettlement+1);
        database.transaction("IMMEDIATE",commitRejection);
        expect(database.transaction("IMMEDIATE",()=>preparedRejection.commit(sqlite3.capi))).toBe(false);
        expect(database.selectValue("SELECT count(*) FROM library_local_preference_nodes;")).toBe(0);
        expect(database.selectValue("SELECT sequence FROM library_local_change_state;")).toBe(sequenceBeforeSettlement+2);
      }
    }
    if (outcome === "rejected") {
    database.exec({sql:"INSERT OR IGNORE INTO library_materialization_generation(singleton_id,generation_id) VALUES(1,?1);",bind:["ab".repeat(32)]});
    const beforeFreshSource=readPwaVisiblePreferenceSource(database,engine);
    followerNow=6001;
    const freshTip=engine.followerMutationContext();
    const freshMember=PREFERENCES_LEAF_ASSIGNMENT_TRANSACTION_MEMBER_SCHEMA.construct({
      actor_id:freshTip.actor_id,actor_sequence:freshTip.next_actor_sequence,causal_frontier:[],created_at_ms:6000,
      entity_id:"preferences",epoch:freshTip.epoch,epoch_id:freshTip.epoch_id,hlc_counter:0,hlc_wall_ms:6000,
      library_id:freshTip.library_id,operation_id:"projected-operation-3",previous_actor_operation_id:freshTip.previous_actor_operation_id,
      transaction_id:"projected-transaction-3",transaction_member_count:1,transaction_member_index:0,
      payload:{updates:{friendSuggestions:{dismissedSuggestionIds:["c"]},display:{showEngagementCounts:false}}},
    },{digest:coreDigest});
    const freshFinalized=await finalizeLibraryCoreTransactionV1(assembleLibraryCoreTransactionV1([freshMember],freshTip.previous_actor_chain_digest,{digest:coreDigest}),{
      digest:coreDigest,async signOperation(message){return sign(null,message,actorKeys.privateKey).toString("hex");},
    });
    const freshIntent={envelopeBytes:[encodeLibraryCoreCanonicalValue(freshFinalized.members[0]!.envelope as unknown as LibraryCoreCanonicalValue)]};
    const sequenceBeforeFresh=Number(database.selectValue("SELECT sequence FROM library_local_change_state;"));
    const nodesBeforeFresh=Number(database.selectValue("SELECT count(*) FROM library_local_preference_nodes;"));
    database.exec("UPDATE library_local_preference_projection SET last_counter=last_counter-1;");
    expect(()=>readPwaVisiblePreferenceSource(database,engine)).toThrow();
    await expect(enqueuePwaProjectedFollowerIntent(database,engine,freshIntent,sqlite3.capi)).rejects.toThrow(/backfill is incomplete/);
    database.exec("UPDATE library_local_preference_projection SET last_counter=last_counter+1;");
    database.exec({sql:`INSERT INTO library_local_handoff
      (singleton_id,handoff_id,library_id,installation_role,phase,predecessor_epoch_id,target_writer_id,target_authority_public_key,canonical_readiness,created_at,updated_at)
      VALUES(1,?1,?2,'target','preparing',?3,?4,?5,X'7b7d',1,1);`,
      bind:["12".repeat(32),libraryId,epochId,freshTip.actor_id,freshTip.actor_public_key]});
    await expect(enqueuePwaProjectedFollowerIntent(database,engine,freshIntent,sqlite3.capi)).rejects.toThrow(/lifecycle/);
    database.exec("DELETE FROM library_local_handoff;");
    database.exec(`CREATE TEMP TRIGGER projected_cursor_fault BEFORE UPDATE OF last_counter ON library_local_preference_projection
      WHEN NEW.last_counter>OLD.last_counter BEGIN SELECT RAISE(ABORT,'projected cursor fault'); END;`);
    await expect(enqueuePwaProjectedFollowerIntent(database,engine,freshIntent,sqlite3.capi)).rejects.toThrow(/projected cursor fault/);
    expect(engine.followerMutationContext()).toEqual(freshTip);
    expect(database.selectValue("SELECT count(*) FROM library_intent_transactions WHERE transaction_id='projected-transaction-3';")).toBe(0);
    expect(database.selectValue("SELECT count(*) FROM library_local_preference_nodes;")).toBe(nodesBeforeFresh);
    expect(database.selectValue("SELECT sequence FROM library_local_change_state;")).toBe(sequenceBeforeFresh);
    database.exec("DROP TRIGGER projected_cursor_fault;");
    const freshReceipt=await enqueuePwaProjectedFollowerIntent(database,engine,freshIntent,sqlite3.capi);
    expect(await enqueuePwaProjectedFollowerIntent(database,engine,freshIntent,sqlite3.capi)).toEqual(freshReceipt);
    expect(engine.followerMutationContext().next_actor_sequence).toBe(freshTip.next_actor_sequence+1);
    expect(database.selectValue("SELECT count(*) FROM library_local_preference_nodes;")).toBe(nodesBeforeFresh+5);
    expect(database.selectValue("SELECT sequence FROM library_local_change_state;")).toBe(sequenceBeforeFresh+1);
    const selectedPath="$.friendSuggestions.dismissedSuggestionIds";
    const selected=database.exec({sql:LIBRARY_CORE_PENDING_PREFERENCE_QUERY_PROGRAMS.latest_node_v1,bind:[freshTip.actor_id,selectedPath],rowMode:"array",returnValue:"resultRows"});
    expect(selected).toHaveLength(1);
    expect(selected[0]![2]).toBe(freshTip.next_actor_sequence);
    const arrayNodes=database.exec({sql:LIBRARY_CORE_PENDING_PREFERENCE_QUERY_PROGRAMS.array_nodes_v1,bind:[selected[0]![0]!,selected[0]![1]!,selectedPath+"[",selectedPath+"\\"],rowMode:"array",returnValue:"resultRows"});
    expect(arrayNodes.map(row=>row[6])).toEqual(["c"]);
    const barrier=database.exec({sql:LIBRARY_CORE_PENDING_PREFERENCE_QUERY_PROGRAMS.replacement_barrier_v1,bind:[freshTip.actor_id,selectedPath],rowMode:0,returnValue:"resultRows"});
    expect(barrier).toEqual([freshTip.next_actor_sequence]);
    expect(readPwaVisiblePreferenceSource(database,engine)).toEqual({...beforeFreshSource,
      localSequence:beforeFreshSource.localSequence+1,actorCounter:beforeFreshSource.actorCounter+1});
    // Tier 1: visible reads bind canonical rows and pending intent effects to
    // the same local sequence, including edits which did not advance Primary.
    const visibleSource=readPwaVisiblePreferenceSource(database,engine);
    const replayEnrollment={
      canonicalCertificateBytes:Uint8Array.from(new TextEncoder().encode(String(database.selectValue("SELECT canonical_enrollment_certificate FROM library_follower_actor_request;")))),
      enrolledAt:Number(database.selectValue("SELECT enrolled_at FROM library_follower_actor_request;")),
    };
    const signedBeforeEnrollmentRetry=database.exec({sql:"SELECT hex(canonical_member) FROM library_intent_members ORDER BY actor_counter;",rowMode:"array",returnValue:"resultRows"});
    await installPwaProjectedFollowerEnrollment(database,sqlite3.capi,engine,replayEnrollment);
    expect(readPwaVisiblePreferenceSource(database,engine)).toEqual(visibleSource);
    expect(database.selectValue("SELECT count(*) FROM library_local_preference_nodes;")).toBe(nodesBeforeFresh+5);
    expect(database.exec({sql:"SELECT hex(canonical_member) FROM library_intent_members ORDER BY actor_counter;",rowMode:"array",returnValue:"resultRows"})).toEqual(signedBeforeEnrollmentRetry);
    const retainedProjection=database.exec({sql:"SELECT * FROM library_local_preference_projection;",rowMode:"array",returnValue:"resultRows"})[0]!;
    database.exec("DELETE FROM library_local_preference_projection;");
    await expect(installPwaProjectedFollowerEnrollment(database,sqlite3.capi,engine,replayEnrollment))
      .rejects.toThrow("cannot discard local edit history");
    // Restore the exact test cursor only; the adapter above provides no repair.
    database.exec({sql:"INSERT INTO library_local_preference_projection VALUES(?1,?2,?3,?4,?5,?6);",bind:retainedProjection});
    expect(readPwaVisiblePreferenceSource(database,engine)).toEqual(visibleSource);
    const shellScope=readPwaVisiblePreferenceScope(database,engine,LIBRARY_CORE_SHELL_PREFERENCE_PATHS,visibleSource);
    const shell=createLibraryCoreShellPreferencesV1(shellScope.results);
    expect(shell.display.showEngagementCounts).toBe(false);
    expect(shell.display.reading.markReadOnScroll).toBe(true);
    expect(shellScope.results.every(value=>JSON.stringify(value.source)===JSON.stringify(visibleSource))).toBe(true);
    expect(()=>readPwaVisiblePreferenceScope(database,engine,LIBRARY_CORE_SHELL_PREFERENCE_PATHS,beforeFreshSource)).toThrow("CURSOR_STALE");
    expect(()=>createLibraryCoreShellPreferencesV1(shellScope.results.slice(1))).toThrow("incomplete");
    expect(()=>createLibraryCoreShellPreferencesV1([...shellScope.results].reverse())).toThrow("reordered");
    expect(()=>readPwaVisiblePreferenceScope(database,engine,[["display"],["display"]],visibleSource)).toThrow("duplicate");
    const maximumPaths=Array.from({length:64},(_,index)=>["unassigned",String(index)]);
    expect(readPwaVisiblePreferenceScope(database,engine,maximumPaths,visibleSource).results).toHaveLength(64);
    expect(()=>readPwaVisiblePreferenceScope(database,engine,[...maximumPaths,["overflow"]],visibleSource)).toThrow();
    database.exec(preferenceValueVector.scopeOverflowSql);
    expect(()=>readPwaVisiblePreferenceScope(database,engine,Array.from({length:32},(_,index)=>[`scope${index}`]),visibleSource)).toThrow("byte bound");
    expect(createLibraryCoreShellPreferencesV1(readPwaVisiblePreferenceScope(database,engine,LIBRARY_CORE_SHELL_PREFERENCE_PATHS,visibleSource).results)).toEqual(shell);


    const visible=(path:readonly string[])=>readPwaVisiblePreferenceValue(database,engine,path,visibleSource);
    expect(()=>readPwaVisiblePreferenceValue(database,engine,["friendSuggestions","dismissedSuggestionIds"],beforeFreshSource)).toThrow("CURSOR_STALE");
    const visibleArray=visible(["friendSuggestions","dismissedSuggestionIds"]);
    expect(visibleArray.kind).toBe("value");
    expect(visibleArray.rows.map(row=>[row.path,row.integerValue,row.textValue])).toEqual([
      ["a:$._",1,null],["v:$._[0]",null,"c"],
    ]);
    expect(visible(["friendSuggestions"]).kind).toBe("object_group");
    expect(visible(["absentSetting"]).kind).toBe("absent");
    database.exec(`INSERT INTO library_preferences(path,value_type,integer_value,updated_at)
      VALUES('v:$.canonicalSetting','integer',42,1);
      INSERT INTO library_preferences(path,value_type,updated_at) VALUES('o:$.fraction','null',1);
      INSERT INTO library_preferences(path,value_type,text_value,updated_at) VALUES
      ('v:$.fraction.bits','text','3fe0000000000000',1),
      ('v:$.fraction.codec','text','ieee754_binary64_hex_v1',1);`);
    expect(visible(["canonicalSetting"]).rows[0]?.integerValue).toBe(42);
    expect(visible(["fraction"]).kind).toBe("value");
    expect(visible(["fraction"]).rows).toHaveLength(3);
    database.exec("INSERT INTO library_preferences(path,value_type,integer_value,updated_at) VALUES('v:$.fraction.extra','integer',1,1);");
    expect(visible(["fraction"]).kind).toBe("object_group");
    // An earlier canonical object child is hidden by the pending array assignment.
    database.exec("INSERT INTO library_preferences(path,value_type,text_value,updated_at) VALUES('v:$.friendSuggestions.dismissedSuggestionIds.old','text','hidden',1);");
    expect(visible(["friendSuggestions","dismissedSuggestionIds","old"]).kind).toBe("absent");
    database.exec({sql:"INSERT INTO library_preferences(path,value_type,text_value,updated_at) VALUES(?1,'text','literal',1);",
      bind:['v:$."雪.key"."quote\\"key"']});
    expect(visible(["雪.key",'quote"key']).rows[0]?.textValue).toBe("literal");
    database.exec({sql:`INSERT INTO library_local_preference_nodes
      (transaction_id,member_index,actor_id,actor_counter,path,node_kind,value_type,integer_value,updated_at)
      VALUES('projected-transaction-3',0,?1,?2,?3,'value','integer',9,6000);`,
      bind:[freshTip.actor_id,freshTip.next_actor_sequence,selectedPath+".invalid"]});
    expect(()=>visible(["friendSuggestions","dismissedSuggestionIds"])).toThrow("invalid object children");
    database.exec({sql:"DELETE FROM library_local_preference_nodes WHERE path=?1;",bind:[selectedPath+".invalid"]});
    // Actual logical export/stage/replacement; the Primary catalog rows below
    // are synthetic setup, while retained consumer operations keep real signatures.
    if (checkpointPhase !== "none") {
    const checkpointFile=`/${fixtureId}-preference-checkpoint-activation.sqlite`;
    sqlite3.capi.sqlite3_js_posix_create_file(checkpointFile,sqlite3.capi.sqlite3_js_db_export(database.pointer!));
    const replica=new sqlite3.oo1.DB(checkpointFile,"w");
    let donor:Database|undefined;
    try {
      replica.exec("PRAGMA foreign_keys=ON; PRAGMA synchronous=FULL;");
      const replicaEngine=new PwaLibraryCoreSqliteEngine(replica,sqlite3.version.libVersion);
      const writer="fe".repeat(32), capability="fd".repeat(32), placeholder="fc".repeat(32);
      replica.exec({sql:`INSERT INTO library_actors(actor_id,authority_epoch_id,actor_kind,public_key,enrollment_operation_id,
        enrollment_certificate_digest,canonical_enrollment_certificate,chain_genesis_digest,accepted_counter,accepted_operation_id,accepted_chain_digest,created_at,updated_at)
        VALUES(?1,?2,'desktop',?3,'fixture-primary',?3,'{}',?3,0,NULL,?3,1,1);`,bind:[writer,epochId,placeholder]});
      replica.exec({sql:`INSERT INTO library_actor_capabilities(capability_id,actor_id,certificate_version,actor_class,scope_mode,
        issuance_identity,retirement_identity,certificate_digest,canonical_certificate,issued_at)
        VALUES(?1,?2,2,'editor','library_wide',?3,?3,?3,'{}',1);`,bind:[capability,writer,placeholder]});
      replica.exec({sql:"UPDATE library_active_authority SET writer_id=?1;",bind:[writer]});
      replica.exec({sql:`INSERT INTO library_follower_checkpoint_receipt(singleton_id,library_id,authority_epoch_id,writer_actor_id,
        checkpoint_generation,source_revision,checkpoint_digest,manifest_object_key,manifest_transport_object_id,manifest_content_digest,control_revision,installed_at)
        SELECT 1,library_id,authority_epoch,?1,0,source_revision,?2,'old-manifest','old-object',?2,'old-control',1 FROM library_meta;`,bind:[writer,placeholder]});
      const donorFile=`/${fixtureId}-preference-checkpoint-donor.sqlite`;
      sqlite3.capi.sqlite3_js_posix_create_file(donorFile,sqlite3.capi.sqlite3_js_db_export(replica.pointer!));
      donor=new sqlite3.oo1.DB(donorFile,"w");
      donor.exec("PRAGMA foreign_keys=ON; DELETE FROM library_intent_transactions; DELETE FROM library_intent_actors; DELETE FROM library_follower_actor_request;");
      const donorEngine=new PwaLibraryCoreSqliteEngine(donor,sqlite3.version.libVersion);
      const descriptor=donorEngine.describeNormalizedCheckpointExport(), stageId="projected-checkpoint";
      replicaEngine.beginNormalizedCheckpointStage({authorityEpoch:descriptor.authorityEpoch,libraryId:descriptor.libraryId,
        sourceRevision:descriptor.sourceRevision,expectedRecordCount:descriptor.recordCount,stageId,createdAt:7000});
      let after:import('@freed/shared/library-core').LibraryCoreNormalizedCheckpointExportRequestV2["after"]=null;
      while (true) {
        const page=donorEngine.exportPinnedNormalizedCheckpointPage({snapshot:descriptor,page:{after,maximumRecords:128,maximumResponseBytes:1048576}});
        replicaEngine.appendNormalizedCheckpointStagePage({stageId,records:page.records});
        if (page.done) break;
        after=page.nextCursor;
      }
      const activation=parseLibraryCoreActivateNormalizedCheckpointStageV2({stageId,replaceExisting:true,followerReceipt:{checkpointGeneration:1,writerActorId:writer,
        manifestObjectKey:"new-manifest",manifestTransportObjectId:"new-object",manifestContentDigest:placeholder,controlRevision:"new-control",installedAt:7001}});
      const originalMembers=replica.exec({sql:"SELECT canonical_member FROM library_intent_members ORDER BY actor_counter;",rowMode:0,returnValue:"resultRows"});
      const originalTip=replicaEngine.followerMutationContext();
      const nodeCount=replica.selectValue("SELECT count(*) FROM library_local_preference_nodes;");
      if (checkpointPhase === "restore") {
      replica.exec("CREATE TEMP TRIGGER projected_restore_fault BEFORE INSERT ON library_local_preference_nodes BEGIN SELECT RAISE(ABORT,'projected restore fault'); END;");
      await expect(replacePwaProjectedCheckpoint(replica,replicaEngine,activation,sqlite3.capi)).rejects.toThrow("projected restore fault");
      expect(replica.selectValue("SELECT count(*) FROM library_local_preference_nodes;")).toBe(nodeCount);
      expect(replicaEngine.followerMutationContext()).toEqual(originalTip);
      expect(replica.selectValue("SELECT count(*) FROM sqlite_schema WHERE name LIKE 'checkpoint_retained_%' OR name='checkpoint_verified_preference_results';")).toBe(0);
      expect(replica.selectValue("SELECT count(*) FROM library_checkpoint_stages WHERE stage_id='projected-checkpoint';")).toBe(1);
      replica.exec("DROP TRIGGER projected_restore_fault;");
      }
      await replacePwaProjectedCheckpoint(replica,replicaEngine,activation,sqlite3.capi);
      expect(replica.selectValue("SELECT count(*) FROM library_local_preference_nodes;")).toBe(nodeCount);
      expect(replicaEngine.followerMutationContext()).toEqual(originalTip);
      expect(replica.exec({sql:"SELECT canonical_member FROM library_intent_members ORDER BY actor_counter;",rowMode:0,returnValue:"resultRows"})).toEqual(originalMembers);
      const restoredSource=readPwaVisiblePreferenceSource(replica,replicaEngine);
      expect(readPwaVisiblePreferenceValue(replica,replicaEngine,["display","showEngagementCounts"],restoredSource).rows[0]?.booleanValue).toBe(false);
      if (checkpointPhase !== "restore") {
      const newest=freshFinalized.members[0]!.envelope;
      const priorResult=replica.selectValue("SELECT result_digest FROM library_intent_results ORDER BY result_sequence DESC LIMIT 1;");
      expect(typeof priorResult).toBe("string");
      const rejectionBody=parseLibraryCoreFollowerResultEnvelopeV1({
        actor_id:freshTip.actor_id,authoritative_source_revision:descriptor.sourceRevision,authority_key_id:authorityKeyId,
        canonical_operation_ids:[],epoch:1,epoch_id:epochId,format:"freed_follower_result_v1",intent_epoch:1,intent_epoch_id:epochId,
        library_id:libraryId,original_result_digest:null,previous_result_digest:priorResult,receipt_ids:[],
        rejection_reason:"capability_denied",replacement_fields:[],resolved_at_ms:8000,result_body_digest:"0".repeat(64),
        result_sequence:3,schema_version:1,signature:"0".repeat(128),signature_algorithm:"ed25519",status:"rejected",
        transaction_digest:newest.transaction_digest,transaction_id:newest.transaction_id,
      });
      const rejectionDigest=coreDigest("follower-result-body",libraryCoreFollowerResultBodyV1(rejectionBody));
      const rejectionBytes=encodeLibraryCoreCanonicalValue({...rejectionBody,result_body_digest:rejectionDigest,
        signature:sign(null,encodeLibraryCoreSignatureInput("follower-result-envelope",{result_body_digest:rejectionDigest}),authorityKeys.privateKey).toString("hex"),
      } as unknown as LibraryCoreCanonicalValue);
      // Retained signed-result fixture: settlement is deliberately deferred to
      // checkpoint activation so the test can fault its final atomic boundary.
      replica.transaction("IMMEDIATE",()=>{
        replica.exec({sql:"UPDATE library_intent_transactions SET state='rejected' WHERE transaction_id=?1;",bind:[newest.transaction_id]});
        replica.exec({sql:`INSERT INTO library_intent_results(transaction_id,actor_id,authority_epoch_id,intent_epoch_id,result_sequence,
          previous_result_digest,result_digest,status,authoritative_source_revision,canonical_result,received_at)
          VALUES(?1,?2,?3,?3,3,?4,?5,'rejected',?6,?7,8000);`,
          bind:[newest.transaction_id,freshTip.actor_id,epochId,priorResult!,rejectionDigest,descriptor.sourceRevision,rejectionBytes]});
      });
      const stageAgain=(id:string)=>{
        replicaEngine.beginNormalizedCheckpointStage({authorityEpoch:descriptor.authorityEpoch,libraryId:descriptor.libraryId,
          sourceRevision:descriptor.sourceRevision,expectedRecordCount:descriptor.recordCount,stageId:id,createdAt:8000});
        let cursor:typeof after=null;
        while (true) {
          const page=donorEngine.exportPinnedNormalizedCheckpointPage({snapshot:descriptor,page:{after:cursor,maximumRecords:128,maximumResponseBytes:1048576}});
          replicaEngine.appendNormalizedCheckpointStagePage({stageId:id,records:page.records});
          if (page.done) break;
          cursor=page.nextCursor;
        }
      };
      const settledStage="projected-checkpoint-settlement";
      stageAgain(settledStage);
      const settlementActivation=parseLibraryCoreActivateNormalizedCheckpointStageV2({...activation,stageId:settledStage,
        followerReceipt:{...activation.followerReceipt!,checkpointGeneration:2,installedAt:8001}});
      const settlementSequence=replica.selectValue("SELECT sequence FROM library_local_change_state;");
      if (checkpointPhase === "evidence") {
      replica.exec(`CREATE TEMP TRIGGER projected_receipt_tamper AFTER INSERT ON library_intent_results
        WHEN NEW.transaction_id='projected-transaction-3' BEGIN UPDATE library_intent_results SET received_at=received_at+1 WHERE transaction_id=NEW.transaction_id; END;`);
      await expect(replacePwaProjectedCheckpoint(replica,replicaEngine,settlementActivation,sqlite3.capi)).rejects.toThrow("changed verified result evidence");
      expect(replica.selectValue("SELECT received_at FROM library_intent_results WHERE transaction_id='projected-transaction-3';")).toBe(8000);
      expect(replica.selectValue("SELECT count(*) FROM library_local_preference_nodes;")).toBe(nodeCount);
      replica.exec("DROP TRIGGER projected_receipt_tamper;");
      }
      if (checkpointPhase === "settlement") {
      replica.exec(`CREATE TEMP TRIGGER projected_settlement_fault BEFORE INSERT ON library_local_invalidations
        WHEN NEW.topic='preferences' AND NEW.reason='optimistic_removed' AND NEW.sequence>${Number(settlementSequence)} BEGIN SELECT RAISE(ABORT,'projected settlement fault'); END;`);
      await expect(replacePwaProjectedCheckpoint(replica,replicaEngine,settlementActivation,sqlite3.capi)).rejects.toThrow("projected settlement fault");
      expect(replica.selectValue("SELECT checkpoint_generation FROM library_follower_checkpoint_receipt;")).toBe(1);
      expect(replica.selectValue("SELECT count(*) FROM library_local_preference_nodes;")).toBe(nodeCount);
      expect(replica.selectValue("SELECT sequence FROM library_local_change_state;")).toBe(settlementSequence);
      expect(replicaEngine.followerMutationContext()).toEqual(originalTip);
      replica.exec("DROP TRIGGER projected_settlement_fault;");
      await replacePwaProjectedCheckpoint(replica,replicaEngine,settlementActivation,sqlite3.capi);
      expect(replica.selectValue("SELECT count(*) FROM library_local_preference_nodes;")).toBe(Number(nodeCount)-5);
      expect(replica.selectValue("SELECT count(*) FROM library_local_preference_nodes WHERE transaction_id='projected-transaction-3';")).toBe(0);
      expect(replica.selectValue("SELECT sequence FROM library_local_change_state;")).toBe(Number(settlementSequence)+1);
      expect(replica.exec({sql:"SELECT canonical_member FROM library_intent_members ORDER BY actor_counter;",rowMode:0,returnValue:"resultRows"})).toEqual(originalMembers);
      const settledSource=readPwaVisiblePreferenceSource(replica,replicaEngine);
      expect(readPwaVisiblePreferenceValue(replica,replicaEngine,["display","showEngagementCounts"],settledSource).kind).toBe("absent");
      stageAgain("projected-settlement-repeat");
      await replacePwaProjectedCheckpoint(replica,replicaEngine,parseLibraryCoreActivateNormalizedCheckpointStageV2({...activation,stageId:"projected-settlement-repeat",
        followerReceipt:{...activation.followerReceipt!,checkpointGeneration:3,installedAt:8002}}),sqlite3.capi);
      expect(replica.selectValue("SELECT sequence FROM library_local_change_state;")).toBe(Number(settlementSequence)+1);

      }
      }
    } finally {donor?.close();replica.close();}
    }




    }
  });

  it("stages split normalized operation pages and atomically applies one verified large transaction", async () => {
    const libraryId = "11".repeat(32);
    const epochId = "22".repeat(32);
    const actorId = "33".repeat(32);
    const chainGenesis = "44".repeat(32);
    const authorityKeyId = "55".repeat(32);
    const writerId = actorId;
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
    );
    engine.initialize();
    database.exec({
      sql: `INSERT INTO library_meta
              (singleton_id, library_id, schema_version, authority_epoch,
               source_revision, updated_at)
            VALUES (1, ?1, 1, ?2, 0, 1);`,
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
        authorityKeyId,
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
            VALUES ('active', ?1, ?2, ?3, 1, 1);`,
      bind: [libraryId, epochId, "primary:desktop"],
    });
    database.exec({
      sql: `INSERT INTO library_actors
              (actor_id, authority_epoch_id, actor_kind, public_key,
               enrollment_operation_id, enrollment_certificate_digest,
               canonical_enrollment_certificate, chain_genesis_digest,
               accepted_counter, accepted_operation_id, accepted_chain_digest,
               retired_at, created_at, updated_at)
            VALUES (?1, ?2, 'desktop', ?3, 'enroll-1', ?4, '{}', ?5,
                    0, NULL, ?5, NULL, 1, 1);`,
      bind: [actorId, epochId, actorPublicKey, "bb".repeat(32), chainGenesis],
    });

    const body = "x".repeat(65_536);
    const member = FEED_ITEM_CAPTURE_UPSERT_TRANSACTION_MEMBER_SCHEMA.construct(
      {
        actor_id: actorId,
        actor_sequence: 1,
        causal_frontier: [],
        created_at_ms: 2_000,
        entity_id: "saved:item:maximum-inline-body",
        epoch: 1,
        epoch_id: epochId,
        hlc_counter: 0,
        hlc_wall_ms: 2_000,
        library_id: libraryId,
        operation_id: "operation:maximum-inline-body",
        payload: {
          item: {
            author: {
              displayName: "Bounded Author",
              handle: "bounded",
              id: "author:bounded",
            },
            capturedAt: 2_000,
            content: {
              mediaTypes: [],
              mediaUrls: [],
              text: body,
            },
            contentType: "article",
            globalId: "saved:item:maximum-inline-body",
            platform: "saved",
            publishedAt: 2_000,
            topics: [],
            userState: {
              archived: false,
              hidden: false,
              saved: true,
              tags: [],
            },
          },
        },
        previous_actor_operation_id: null,
        transaction_id: "transaction:maximum-inline-body",
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
    const finalizedMember = finalized.members[0]!;
    const canonicalOperation = encodeLibraryCoreCanonicalValue(
      finalizedMember.envelope as unknown as LibraryCoreCanonicalValue,
      { maximumBytes: 131_072 },
    );
    expect(canonicalOperation.byteLength).toBeLessThanOrEqual(131_072);

    const signedResult = (
      sourceRevision: number,
      transactionId: string,
      transactionDigest: string,
      operationId: string,
      receiptId: string,
      resultSequence: number,
    ) => {
      const candidate = parseLibraryCoreFollowerResultEnvelopeV1({
        actor_id: actorId,
        authoritative_source_revision: sourceRevision,
        authority_key_id: authorityKeyId,
        canonical_operation_ids: [operationId],
        epoch: 1,
        epoch_id: epochId,
        format: "freed_follower_result_v1",
        intent_epoch: 1,
        intent_epoch_id: epochId,
        library_id: libraryId,
        original_result_digest: null,
        previous_result_digest: null,
        receipt_ids: [receiptId],
        rejection_reason: null,
        replacement_fields: [],
        resolved_at_ms: 3_000 + sourceRevision,
        result_body_digest: "0".repeat(64),
        result_sequence: resultSequence,
        schema_version: 1,
        signature: "0".repeat(128),
        signature_algorithm: "ed25519",
        status: "accepted",
        transaction_digest: transactionDigest,
        transaction_id: transactionId,
      });
      const digest = coreDigest(
        "follower-result-body",
        libraryCoreFollowerResultBodyV1(candidate),
      );
      const canonicalBytes = encodeLibraryCoreCanonicalValue({
        ...candidate,
        result_body_digest: digest,
        signature: sign(
          null,
          encodeLibraryCoreSignatureInput("follower-result-envelope", {
            result_body_digest: digest,
          }),
          authorityKeys.privateKey,
        ).toString("hex"),
      } as unknown as LibraryCoreCanonicalValue);
      return { canonicalBytes, digest };
    };
    const accepted = signedResult(
      1,
      finalizedMember.envelope.transaction_id,
      finalized.transaction_digest,
      finalizedMember.envelope.operation_id,
      finalizedMember.envelope_digest,
      1,
    );
    const gap = signedResult(
      2,
      "transaction:future-gap",
      "cc".repeat(32),
      "operation:future-gap",
      "dd".repeat(32),
      2,
    );
    const descriptor = parseLibraryCoreNormalizedOperationExportDescriptorV2({
      authorityEpoch: epochId,
      firstAvailableRevision: 1,
      format: "freed_normalized_operation_export_v2" as const,
      libraryId,
      operationCount: 1,
      protocolVersion: 2 as const,
      sourceRevision: 1,
      transactionCount: 1,
      writerId,
    });
    const record = (
      canonicalRecord: Uint8Array,
      kind: "accepted_transaction" | "operation",
      memberIndex: number,
      recordDigest: string,
      sourceRevision: number,
      transactionId: string,
      transactionDigest: string,
    ) => ({
      canonicalRecordJson: new TextDecoder().decode(canonicalRecord),
      kind,
      memberIndex,
      recordDigest,
      sourceRevision,
      transactionDigest,
      transactionId,
    });
    const page = (pageRecord: ReturnType<typeof record>, done: boolean) =>
      parseLibraryCoreNormalizedOperationExportPageV2({
        canonicalRecordBytes: new TextEncoder().encode(
          pageRecord.canonicalRecordJson,
        ).byteLength,
        done,
        nextCursor: {
          kind: pageRecord.kind,
          memberIndex: pageRecord.memberIndex,
          recordDigest: pageRecord.recordDigest,
          sourceRevision: pageRecord.sourceRevision,
        },
        records: [pageRecord],
      });
    const gapRecord = record(
      gap.canonicalBytes,
      "accepted_transaction",
      -1,
      gap.digest,
      2,
      "transaction:future-gap",
      "cc".repeat(32),
    );
    for (const invalidWriterSql of [
      "UPDATE library_actors SET retired_at = 2;",
      "UPDATE library_actors SET actor_kind = 'pwa';",
      `INSERT INTO library_actors
         SELECT '${"77".repeat(32)}', authority_epoch_id, actor_kind, public_key,
                'enroll-ambiguous', '${"78".repeat(32)}',
                canonical_enrollment_certificate, chain_genesis_digest,
                accepted_counter, accepted_operation_id, accepted_chain_digest,
                retired_at, created_at, updated_at FROM library_actors;`,
    ]) {
      database.exec("SAVEPOINT invalid_writer;");
      try {
        database.exec(invalidWriterSql);
        await expect(engine.importNormalizedOperationPage({
          page: page(gapRecord, false), receivedAt: 2_500,
          snapshot: { ...descriptor, sourceRevision: 2 },
        })).rejects.toThrow(/authority is unavailable/);
        expect(database.exec({
          sql: "SELECT count(*) FROM library_operation_replication_stages;",
          rowMode: "array", returnValue: "resultRows",
        })).toEqual([[0]]);
      } finally {
        database.exec("ROLLBACK TO invalid_writer; RELEASE invalid_writer;");
      }
    }
    const gapReceipt = await engine.importNormalizedOperationPage({
      page: page(gapRecord, false),
      receivedAt: 2_500,
      snapshot: {
        ...descriptor,
        operationCount: 2,
        sourceRevision: 2,
        transactionCount: 2,
      },
    });
    expect(gapReceipt).toMatchObject({
      appliedThroughRevision: 0,
      appliedTransactionCount: 0,
      stagedRecordCount: 1,
    });

    const resultRecord = record(
      accepted.canonicalBytes,
      "accepted_transaction",
      -1,
      accepted.digest,
      1,
      finalizedMember.envelope.transaction_id,
      finalized.transaction_digest,
    );
    expect(
      await engine.importNormalizedOperationPage({
        page: page(resultRecord, false),
        receivedAt: 2_600,
        snapshot: descriptor,
      }),
    ).toEqual({
      appliedThroughRevision: 0,
      appliedTransactionCount: 0,
      receivedAt: 2_600,
      stagedRecordCount: 1,
      stagedTransactionCount: 1,
    });
    // A later result exchange and a newer export snapshot can deliver the
    // exact same signed transaction. Neither changes its durable identity.
    await expect(engine.importNormalizedOperationPage({
      page: page(resultRecord, false), receivedAt: 2_601,
      snapshot: { ...descriptor, sourceRevision: 2, operationCount: 2, transactionCount: 2 },
    })).resolves.toMatchObject({ appliedThroughRevision: 0, appliedTransactionCount: 0 });
    expect(database.exec({
      sql: "SELECT received_at, snapshot_source_revision FROM library_operation_replication_stages WHERE source_revision = 1;",
      rowMode: "array", returnValue: "resultRows",
    })).toEqual([[2_600, descriptor.sourceRevision]]);
    const operationRecord = record(
      canonicalOperation,
      "operation",
      0,
      finalizedMember.envelope_digest,
      1,
      finalizedMember.envelope.transaction_id,
      finalized.transaction_digest,
    );
    const pageCountRows = database.exec({
      sql: "PRAGMA page_count;",
      rowMode: "array",
      returnValue: "resultRows",
    }) as number[][];
    const pageCount = pageCountRows[0]?.[0];
    expect(pageCount).toBeGreaterThan(0);
    expect(
      database.exec({
        sql: "PRAGMA freelist_count;",
        rowMode: "array",
        returnValue: "resultRows",
      }),
    ).toEqual([[0]]);
    database.exec(`PRAGMA max_page_count = ${pageCount};`);
    await expect(
      engine.importNormalizedOperationPage({
        page: page(operationRecord, true),
        receivedAt: 2_600,
        snapshot: descriptor,
      }),
    ).rejects.toThrow(/database or disk is full/);
    expect(
      database.exec({
        sql: `SELECT m.source_revision,
                     (SELECT count(*) FROM library_feed_items),
                     (SELECT count(*) FROM library_operations),
                     (SELECT count(*) FROM library_operation_replication_stages
                       WHERE source_revision = 1),
                     (SELECT count(*) FROM library_operation_replication_stage_members
                       WHERE source_revision = 1)
              FROM library_meta AS m WHERE m.singleton_id = 1;`,
        rowMode: "array",
        returnValue: "resultRows",
      }),
    ).toEqual([[0, 0, 0, 1, 0]]);
    database.exec("PRAGMA max_page_count = 1073741823;");

    database.exec(`CREATE TEMP TRIGGER fail_operation_replication_receipt
      BEFORE INSERT ON library_operation_replication_results
      BEGIN SELECT RAISE(ABORT, 'injected operation replication fault'); END;`);
    await expect(
      engine.importNormalizedOperationPage({
        page: page(operationRecord, true),
        receivedAt: 2_600,
        snapshot: descriptor,
      }),
    ).rejects.toThrow(/injected operation replication fault/);
    expect(
      database.exec({
        sql: `SELECT m.source_revision,
                     (SELECT count(*) FROM library_feed_items),
                     (SELECT count(*) FROM library_operations),
                     (SELECT count(*) FROM library_operation_replication_stage_members
                       WHERE source_revision = 1)
              FROM library_meta AS m WHERE m.singleton_id = 1;`,
        rowMode: "array",
        returnValue: "resultRows",
      }),
    ).toEqual([[0, 0, 0, 1]]);
    database.exec("DROP TRIGGER fail_operation_replication_receipt;");

    const verifySignature = crypto.subtle.verify.bind(crypto.subtle);
    const verificationRace = vi.spyOn(crypto.subtle, "verify").mockImplementationOnce(
      async (...args) => {
        const verified = await verifySignature(...args);
        database.exec("UPDATE library_actors SET retired_at = 3;");
        return verified;
      },
    );
    try {
      await expect(engine.importNormalizedOperationPage({
        page: page(operationRecord, true), receivedAt: 2_600, snapshot: descriptor,
      })).rejects.toThrow("normalized operation changed during verification");
      expect(database.exec({
        sql: `SELECT source_revision,
                     (SELECT count(*) FROM library_operations)
              FROM library_meta;`,
        rowMode: "array", returnValue: "resultRows",
      })).toEqual([[0, 0]]);
    } finally {
      verificationRace.mockRestore();
      database.exec("UPDATE library_actors SET retired_at = NULL;");
    }


    expect(
      await engine.importNormalizedOperationPage({
        page: page(operationRecord, true),
        receivedAt: 2_600,
        snapshot: descriptor,
      }),
    ).toEqual({
      appliedThroughRevision: 1,
      appliedTransactionCount: 1,
      receivedAt: 2_600,
      stagedRecordCount: 1,
      stagedTransactionCount: 1,
    });
    expect(
      database.exec({
        sql: `SELECT length(content_text), content_text,
                     (SELECT count(*) FROM library_replication_outbox),
                     (SELECT count(*) FROM library_operation_replication_results),
                     (SELECT count(*) FROM library_operation_replication_stages)
              FROM library_feed_items
              WHERE global_id = 'saved:item:maximum-inline-body';`,
        rowMode: "array",
        returnValue: "resultRows",
      }),
    ).toEqual([[65_536, body, 0, 1, 1]]);
    expect(
      await engine.importNormalizedOperationPage({
        page: page(resultRecord, false),
        receivedAt: 2_600,
        snapshot: descriptor,
      }),
    ).toMatchObject({
      appliedThroughRevision: 1,
      appliedTransactionCount: 0,
    });
    expect(
      await engine.importNormalizedOperationPage({
        page: page(operationRecord, true),
        receivedAt: 2_600,
        snapshot: descriptor,
      }),
    ).toMatchObject({
      appliedThroughRevision: 1,
      appliedTransactionCount: 0,
    });
    const changedDigestRecord = {
      ...operationRecord,
      recordDigest: "ee".repeat(32),
    };
    await expect(
      engine.importNormalizedOperationPage({
        page: page(changedDigestRecord, true),
        receivedAt: 2_600,
        snapshot: descriptor,
      }),
    ).rejects.toThrow(/replay changed/);
  });

  it.each(["saved", "archive"] as const)("atomically settles %s clearing with the complete Primary register and exact retries", async (assignment) => {
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
            VALUES ('active', ?1, ?2,
                    'primary:desktop',
                    1, 1);`,
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
    database.exec(`INSERT INTO library_actors
        (actor_id, authority_epoch_id, actor_kind, public_key,
         enrollment_operation_id, enrollment_certificate_digest,
         canonical_enrollment_certificate, chain_genesis_digest,
         accepted_counter, accepted_operation_id, accepted_chain_digest,
         retired_at, created_at, updated_at)
      SELECT '${"66".repeat(32)}', authority_epoch_id, 'desktop', public_key,
             'enroll-primary', '${"67".repeat(32)}', '{}', chain_genesis_digest,
             0, NULL, chain_genesis_digest, NULL, 1, 1
      FROM library_actors WHERE actor_kind = 'pwa';`);
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
      sql: `INSERT INTO library_follower_actor_request
              (singleton_id, library_id, authority_epoch_id, actor_id,
               actor_public_key, enrollment_request_digest,
               canonical_enrollment_request, created_at,
               enrollment_certificate_digest, canonical_enrollment_certificate,
               actor_chain_genesis, enrolled_at)
            VALUES (1, ?1, ?2, ?3, ?4, ?5, '{}', 1, ?6, '{}', ?7, 1);`,
      bind: [
        libraryId,
        epochId,
        actorId,
        publicKeyHex,
        "ab".repeat(32),
        "bb".repeat(32),
        chainGenesis,
      ],
    });
    database.exec({
      sql: `INSERT INTO library_actor_capability_mutations
              (capability_id, mutation_id)
            VALUES ('capability-1', 'feed_item_read_assignment'),
                   ('capability-1', 'feed_item_saved_assignment'),
                   ('capability-1', 'feed_item_archive_assignment');`,
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

    expect(engine.followerMutationContext()).toStrictEqual({
      actor_id: actorId,
      actor_public_key: publicKeyHex,
      epoch: 1,
      epoch_id: epochId,
      library_id: libraryId,
      next_actor_sequence: 1,
      observed_frontier: [],
      previous_actor_chain_digest: chainGenesis,
      previous_actor_operation_id: null,
      schema_version: 1,
    });

    const enrollmentRow = database.exec({ sql: "SELECT enrollment_certificate_digest, canonical_enrollment_certificate, actor_chain_genesis, enrolled_at FROM library_follower_actor_request;", rowMode: "array", returnValue: "resultRows" })[0]!;
    database.exec("UPDATE library_follower_actor_request SET enrollment_certificate_digest = NULL, canonical_enrollment_certificate = NULL, actor_chain_genesis = NULL, enrolled_at = NULL;");
    await expect(engine.commitFollowerIntent({ envelopeBytes })).rejects.toThrow(/mutation context/);
    expect(database.selectValue("SELECT count(*) FROM library_intent_transactions;")).toBe(0);
    database.exec({ sql: "UPDATE library_follower_actor_request SET enrollment_certificate_digest = ?1, canonical_enrollment_certificate = ?2, actor_chain_genesis = ?3, enrolled_at = ?4;", bind: enrollmentRow });
    database.exec({ sql: "UPDATE library_follower_actor_request SET actor_public_key = ?1;", bind: ["0".repeat(64)] });
    await expect(engine.commitFollowerIntent({ envelopeBytes })).rejects.toThrow(/mutation context/);
    database.exec({ sql: "UPDATE library_follower_actor_request SET actor_public_key = ?1;", bind: [publicKeyHex] });
    database.exec(`CREATE TEMP TRIGGER fail_final_intent_tip BEFORE UPDATE ON library_intent_actors
      BEGIN SELECT RAISE(ABORT, 'final intent tip fault'); END;`);
    await expect(engine.commitFollowerIntent({ envelopeBytes })).rejects.toThrow(/final intent tip fault/);
    expect(database.selectValue("SELECT count(*) FROM library_intent_transactions;")).toBe(0);
    expect(database.selectValue("SELECT count(*) FROM library_intent_members;")).toBe(0);
    expect(database.selectValue("SELECT count(*) FROM library_optimistic_fields;")).toBe(0);
    expect(database.selectValue("SELECT count(*) FROM library_intent_actors;")).toBe(0);
    database.exec("DROP TRIGGER fail_final_intent_tip;");
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
    expect(engine.followerMutationContext()).toMatchObject({
      actor_id: actorId,
      next_actor_sequence: 2,
      previous_actor_operation_id: "intent-operation-1",
    });
    expect(await engine.commitFollowerIntent({ envelopeBytes })).toEqual(first);
    database.exec("UPDATE library_follower_actor_request SET enrollment_certificate_digest = NULL, canonical_enrollment_certificate = NULL, actor_chain_genesis = NULL, enrolled_at = NULL;");
    expect(await engine.commitFollowerIntent({ envelopeBytes })).toEqual(first);
    database.exec({ sql: "UPDATE library_follower_actor_request SET enrollment_certificate_digest = ?1, canonical_enrollment_certificate = ?2, actor_chain_genesis = ?3, enrolled_at = ?4;", bind: enrollmentRow });

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
      engine.query({
        afterRevision: 0,
        cancellationId: "cancel-local-intent",
        cursor: null,
        limit: 512,
        queryId: "local_change_feed_v1",
        readerSessionId: "reader-local-intent",
        schemaVersion: 1,
      }),
    ).toMatchObject({
      nextCursor: null,
      queryId: "local_change_feed_v1",
      rows: [
        {
          entityId: "item-1",
          ordinal: 0,
          resetRequired: false,
          revision: 1,
          topic: "feed_item",
        },
      ],
      source: { projectionRevision: 1, transitionSequence: 1 },
    });
    expect(
      engine.query({
        entityIds: ["item-1"],
        queryId: "optimistic_fields_v1",
        schemaVersion: 1,
      }),
    ).toMatchObject({
      queryId: "optimistic_fields_v1",
      rows: [
        {
          entityId: "item-1",
          fieldPath: "read_at",
          value: 1_400,
          valueType: "integer",
        },
      ],
      source: { projectionRevision: 7, transitionSequence: 1 },
    });
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
    expect(engine.followerTransportContext()).toEqual({
      actorId,
      libraryId,
      nextIntentActorCounter: 1,
      nextResultSequence: 1,
      previousIntentSegmentDigest: null,
      previousResultSegmentDigest: null,
      schemaVersion: 2,
      storageEpochId: epochId,
    });
    expect(
      engine.pageFollowerTransport({
        actorId: lowercaseHex64(actorId),
        firstActorCounter: 1,
        limit: 128,
        schemaVersion: 2,
      }),
    ).toEqual({
      actorId,
      canonicalEnvelopes: envelopeBytes,
      done: true,
      firstActorCounter: 1,
      lastActorCounter: 1,
      schemaVersion: 2,
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
    const storedSegmentDigest = "13".repeat(32);
    const publication = parseLibraryCoreNormalizedIntentTransportPublicationV2({
      header: {
        actor_id: actorId,
        canonical_envelope_bytes: envelopeBytes[0]!.byteLength,
        first_actor_counter: 1,
        format: "freed_normalized_intent_segment_v2" as const,
        kind: "normalized_intent_segment_header" as const,
        last_actor_counter: 1,
        library_id: libraryId,
        previous_segment_digest: null,
        protocol: "normalized_intent_segments_v2" as const,
        protocol_version: 2 as const,
        record_count: 1,
        segment_digest: "12".repeat(32),
        storage_epoch_id: epochId,
      },
      publishedAt: 2_000,
      reference: {
        descriptor: {
          byteLength: 1_024,
          contentDigest: storedSegmentDigest,
          objectKey: createLibraryCoreImmutableObjectKey({
            actorId,
            digest: storedSegmentDigest,
            epochId,
            firstSequence: 1,
            kind: "intent_segment",
            lastSequence: 1,
            libraryId,
          }),
        },
        transportObjectId: "drive-intent-object-1",
      },
    });
    const publicationReceipt =
      engine.publishNormalizedFollowerIntentTransport(publication);
    expect(publicationReceipt).toEqual({
      actorId,
      firstActorCounter: 1,
      lastActorCounter: 1,
      newlyPublishedTransactionCount: 1,
      nextActorCounter: 2,
      publishedAt: 2_000,
      semanticSegmentDigest: "12".repeat(32),
      storedSegmentDigest,
    });
    expect(engine.followerTransportContext()).toMatchObject({
      nextIntentActorCounter: 2,
      previousIntentSegmentDigest: storedSegmentDigest,
    });
    expect(
      engine.pageFollowerTransport({
        actorId: lowercaseHex64(actorId),
        firstActorCounter: 2,
        limit: 128,
        schemaVersion: 2,
      }),
    ).toMatchObject({ canonicalEnvelopes: [], done: true });
    expect(
      engine.publishNormalizedFollowerIntentTransport(publication),
    ).toEqual(publicationReceipt);
    expect(() =>
      engine.publishNormalizedFollowerIntentTransport({
        ...publication,
        reference: {
          ...publication.reference,
          transportObjectId: "changed-object",
        },
      }),
    ).toThrow(/replay changed/);
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
      canonical_operation_ids: ["intent-operation-1"],
      epoch: 1,
      epoch_id: epochId,
      format: "freed_follower_result_v1",
      intent_epoch: 1,
      intent_epoch_id: epochId,
      library_id: libraryId,
      original_result_digest: null,
      previous_result_digest: null,
      receipt_ids: [finalized.members[0]!.envelope_digest],
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
    const resultEnvelope = parseLibraryCoreFollowerResultEnvelopeV1(
      decodeLibraryCoreCanonicalValue(canonicalResultBytes),
    );
    const resultBody = parseLibraryCoreNormalizedResultSegmentBodyV2({
      actor_id: actorId,
      canonical_result_bytes: canonicalResultBytes.byteLength,
      first_result_sequence: 1,
      format: "freed_normalized_result_segment_v2",
      kind: "normalized_result_segment_body",
      last_result_sequence: 1,
      library_id: libraryId,
      previous_segment_digest: null,
      protocol: "normalized_result_segments_v2",
      protocol_version: 2,
      result_count: 1,
      results: [resultEnvelope],
      storage_epoch_id: epochId,
    });
    const semanticResultDigest = coreDigest(
      "normalized-result-segment-body-v2",
      resultBody,
    );
    const storedResultDigest = "14".repeat(32);
    const resultPublication = parseLibraryCoreNormalizedResultTransportImportV2(
      {
        header: normalizedResultSegmentHeaderFromBodyV2(
          resultBody,
          semanticResultDigest,
        ),
        receivedAt: 2_100,
        reference: {
          descriptor: {
            byteLength: canonicalResultBytes.byteLength,
            contentDigest: storedResultDigest,
            objectKey: createLibraryCoreImmutableObjectKey({
              actorId,
              digest: storedResultDigest,
              epochId,
              firstSequence: 1,
              kind: "result_segment",
              lastSequence: 1,
              libraryId,
            }),
          },
          transportObjectId: "drive-result-object-1",
        },
        results: [resultEnvelope],
      },
    );
    database.exec(`CREATE TEMP TRIGGER fail_result_transport_receipt
      BEFORE INSERT ON library_result_transport_segments
      BEGIN SELECT RAISE(ABORT, 'injected result transport fault'); END;`);
    await expect(
      engine.importNormalizedFollowerResultTransport(resultPublication),
    ).rejects.toThrow(/injected result transport fault/);
    expect(
      database.exec({
        sql: `SELECT source_revision,
                     (SELECT count(*) FROM library_intent_results),
                     (SELECT count(*) FROM library_optimistic_fields)
              FROM library_meta WHERE singleton_id = 1;`,
        rowMode: "array",
        returnValue: "resultRows",
      }),
    ).toEqual([[7, 0, 1]]);
    database.exec("DROP TRIGGER fail_result_transport_receipt;");

    database.exec(`CREATE TEMP TRIGGER fail_operation_replication_result
      BEFORE INSERT ON library_operation_replication_results
      BEGIN SELECT RAISE(ABORT, 'injected operation apply fault'); END;`);
    await expect(
      engine.importNormalizedFollowerResultTransport(resultPublication),
    ).rejects.toThrow(/injected operation apply fault/);
    expect(
      database.exec({
        sql: `SELECT source_revision,
                     (SELECT count(*) FROM library_result_transport_segments),
                     (SELECT count(*) FROM library_intent_results),
                     (SELECT count(*) FROM library_optimistic_fields),
                     (SELECT count(*) FROM library_transactions),
                     (SELECT count(*) FROM library_operations),
                     (SELECT count(*) FROM library_operation_replication_results)
              FROM library_meta WHERE singleton_id = 1;`,
        rowMode: "array",
        returnValue: "resultRows",
      }),
    ).toEqual([[7, 1, 1, 1, 0, 0, 0]]);
    database.exec("DROP TRIGGER fail_operation_replication_result;");
    // The failed materialization leaves durable staging behind. A later direct
    // replay must retain the original receive time for the same signed result.
    await expect(engine.applyFollowerResult({ canonicalResultBytes })).resolves.toMatchObject({
      sourceRevision: 8,
      transactionId: "intent-transaction-1",
    });
    const transportReceipt =
      await engine.importNormalizedFollowerResultTransport(resultPublication);
    expect(transportReceipt).toEqual({
      acceptedTransactionCount: 1,
      actorId,
      firstResultSequence: 1,
      lastResultSequence: 1,
      nextResultSequence: 2,
      receivedAt: 2_100,
      rejectedTransactionCount: 0,
      resultCount: 1,
      semanticSegmentDigest: semanticResultDigest,
      storedSegmentDigest: storedResultDigest,
    });
    expect(engine.followerTransportContext()).toMatchObject({
      nextResultSequence: 2,
      previousResultSegmentDigest: storedResultDigest,
    });
    expect(
      await engine.importNormalizedFollowerResultTransport(resultPublication),
    ).toEqual(transportReceipt);
    await expect(
      engine.importNormalizedFollowerResultTransport({
        ...resultPublication,
        reference: {
          ...resultPublication.reference,
          transportObjectId: "changed-result-object",
        },
      }),
    ).rejects.toThrow(/replay changed/);
    expect(await engine.applyFollowerResult({ canonicalResultBytes })).toEqual({
      actorId,
      resultDigest,
      resultSequence: 1,
      sourceRevision: 8,
      status: "accepted",
      transactionId: "intent-transaction-1",
    });
    expect(
      database.exec({
        sql: `SELECT read_at, (SELECT count(*) FROM library_optimistic_fields),
                     (SELECT next_result_sequence FROM library_intent_result_cursors
                      WHERE actor_id = ?1),
                     (SELECT count(*) FROM library_transactions
                      WHERE transaction_id = 'intent-transaction-1'),
                     (SELECT count(*) FROM library_operations
                      WHERE transaction_id = 'intent-transaction-1'),
                     (SELECT count(*) FROM library_operation_replication_results
                      WHERE transaction_id = 'intent-transaction-1')
              FROM library_feed_items WHERE global_id = 'item-1';`,
        bind: [actorId],
        rowMode: "array",
        returnValue: "resultRows",
      }),
    ).toEqual([[1_400, 0, 2, 1, 1, 1]]);

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
      (assignment === "saved"
        ? FEED_ITEM_SAVED_ASSIGNMENT_TRANSACTION_MEMBER_SCHEMA
        : FEED_ITEM_ARCHIVE_ASSIGNMENT_TRANSACTION_MEMBER_SCHEMA).construct(
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
          payload: { assigned: false, assigned_at_ms: 1_600 },
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
    database.transaction("IMMEDIATE", () => migratePwaLibraryRecoverySchema(database, sqlite3.capi));
    // A synthetic incomplete lifecycle must fence fresh writes even with a valid enrolled actor.
    database.exec({ sql: `INSERT INTO library_local_handoff
      (singleton_id, handoff_id, library_id, installation_role, phase, predecessor_epoch_id,
       successor_epoch_id, target_writer_id, target_authority_public_key, canonical_readiness,
       canonical_authorization_body, expected_control_revision, created_at, updated_at)
      VALUES (1, ?1, ?2, 'consumer', 'recovery', ?3, ?4, ?5, ?6, X'7b7d', X'7b7d', 'control', 1, 1);`,
      bind: ["ab".repeat(32), libraryId, "cd".repeat(32), epochId, "66".repeat(32), authorityPublicKeyHex] });
    await expect(engine.commitFollowerIntent({ envelopeBytes })).rejects.toThrow(/resolved follower intent/);
    await expect(engine.commitFollowerIntent({ envelopeBytes: secondEnvelopeBytes })).rejects.toThrow(/recovery.*lifecycle/);
    expect(database.selectValue("SELECT next_counter FROM library_intent_actors;")).toBe(2);
    expect(database.selectValue("SELECT count(*) FROM library_intent_transactions;")).toBe(1);
    database.exec("DELETE FROM library_local_handoff;");
    await engine.commitFollowerIntent({ envelopeBytes: secondEnvelopeBytes });
    const unsignedSecondResult = parseLibraryCoreFollowerResultEnvelopeV1({
      actor_id: actorId,
      authoritative_source_revision: 9,
      authority_key_id: "55".repeat(32),
      canonical_operation_ids: ["intent-operation-2"],
      epoch: 1,
      epoch_id: epochId,
      format: "freed_follower_result_v1",
      intent_epoch: 1,
      intent_epoch_id: epochId,
      library_id: libraryId,
      original_result_digest: null,
      previous_result_digest: resultDigest,
      receipt_ids: [secondFinalized.members[0]!.envelope_digest],
      rejection_reason: null,
      // Exact native result shape, including the unaffected half of the register.
      replacement_fields: ["archived", "archived_at", "saved", "saved_at"].map((path) => ({
        boolean_value: path.endsWith("_at") ? null : false,
        entity_id: "item-1",
        entity_type: "FeedItem",
        field_path: path,
        integer_value: null,
        real_value: null,
        text_value: null,
        value_type: path.endsWith("_at") ? "null" : "boolean",
      })),
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
    for (const replacements of [
      unsignedSecondResult.replacement_fields.slice(1),
      [...unsignedSecondResult.replacement_fields, unsignedSecondResult.replacement_fields[0]!],
      [...unsignedSecondResult.replacement_fields, {
        ...unsignedSecondResult.replacement_fields[0]!, entity_id: "other-item",
      }],
    ]) {
      const malformed = { ...unsignedSecondResult, replacement_fields: replacements };
      const digest = coreDigest("follower-result-body", libraryCoreFollowerResultBodyV1(malformed));
      const malformedBytes = encodeLibraryCoreCanonicalValue({
        ...malformed, result_body_digest: digest,
        signature: sign(null, encodeLibraryCoreSignatureInput("follower-result-envelope", {
          result_body_digest: digest,
        }), authorityKeys.privateKey).toString("hex"),
      } as unknown as LibraryCoreCanonicalValue);
      await expect(engine.applyFollowerResult({ canonicalResultBytes: malformedBytes }))
        .rejects.toThrow(/replacement projection is incomplete|replacement field identity is duplicated/);
    }
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
    ).toEqual([[1_400, 8, 1, 2, "pending", 2]]);

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
          integer_value: 1_400,
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
    ).toEqual([[1_400, "rejected", currentEpochId, epochId, 0, 4]]);
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
            VALUES ('active', ?1, ?2,
                    'primary:desktop',
                    1, 1);`,
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
    database.exec(`INSERT INTO library_actors
        (actor_id, authority_epoch_id, actor_kind, public_key,
         enrollment_operation_id, enrollment_certificate_digest,
         canonical_enrollment_certificate, chain_genesis_digest,
         accepted_counter, accepted_operation_id, accepted_chain_digest,
         retired_at, created_at, updated_at)
      SELECT '${"66".repeat(32)}', authority_epoch_id, 'desktop', public_key,
             'enroll-primary', '${"67".repeat(32)}', '{}', chain_genesis_digest,
             0, NULL, chain_genesis_digest, NULL, 1, 1
      FROM library_actors WHERE actor_kind = 'pwa';`);
    database.exec({
      sql: `INSERT INTO library_actor_capabilities
              (capability_id, actor_id, certificate_version, actor_class,
               scope_mode, scope_kind, scope_id, issuance_identity,
               retirement_identity, certificate_digest, canonical_certificate,
               issued_at, retired_at)
            VALUES ('capture-capability', ?1, 2, 'agent', 'library_wide',
                    NULL, NULL, ?2, ?3, ?4, '{}', 1, NULL);`,
      bind: [actorId, "cc".repeat(32), "dd".repeat(32), "ee".repeat(32)],
    });
    database.exec({
      sql: `INSERT INTO library_actor_capability_mutations
              (capability_id, mutation_id)
            VALUES
              ('capture-capability', 'feed_item_analysis_replace'),
              ('capture-capability', 'feed_item_annotations_replace'),
              ('capture-capability', 'feed_item_capture_upsert'),
              ('capture-capability', 'feed_item_priority_assignment');`,
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
    // Provision this browser's local enrollment for this materialization fixture.
    database.exec(`INSERT INTO library_follower_actor_request
      (singleton_id, library_id, authority_epoch_id, actor_id, actor_public_key, enrollment_request_digest,
       canonical_enrollment_request, created_at, enrollment_certificate_digest, canonical_enrollment_certificate,
       actor_chain_genesis, enrolled_at)
      SELECT 1, meta.library_id, actor.authority_epoch_id, actor.actor_id, actor.public_key,
        actor.enrollment_certificate_digest, '{}', 1, actor.enrollment_certificate_digest,
        actor.canonical_enrollment_certificate, actor.chain_genesis_digest, 1
      FROM library_meta AS meta JOIN library_actors AS actor ON actor.authority_epoch_id = meta.authority_epoch
      WHERE actor.actor_kind = 'pwa';`);
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
      canonical_operation_ids: ["capture-operation-1"],
      epoch: 1,
      epoch_id: epochId,
      format: "freed_follower_result_v1",
      intent_epoch: 1,
      intent_epoch_id: epochId,
      library_id: libraryId,
      original_result_digest: null,
      previous_result_digest: null,
      receipt_ids: [finalized.members[0]!.envelope_digest],
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

    type FinalizedTestTransaction = Awaited<
      ReturnType<typeof finalizeLibraryCoreTransactionV1>
    >;
    const applyAcceptedTestTransaction = async (
      accepted: FinalizedTestTransaction,
      authoritativeSourceRevision: number,
      previousResultDigest: string,
      resultSequence: number,
      resolvedAtMs: number,
    ): Promise<string> => {
      await engine.commitFollowerIntent({
        envelopeBytes: accepted.members.map((value) =>
          encodeLibraryCoreCanonicalValue(
            value.envelope as unknown as LibraryCoreCanonicalValue,
          ),
        ),
      });
      const firstEnvelope = accepted.members[0]!.envelope;
      const unsignedAcceptedResult = parseLibraryCoreFollowerResultEnvelopeV1({
        actor_id: actorId,
        authoritative_source_revision: authoritativeSourceRevision,
        authority_key_id: "55".repeat(32),
        canonical_operation_ids: accepted.members.map(
          (value) => value.envelope.operation_id,
        ),
        epoch: 1,
        epoch_id: epochId,
        format: "freed_follower_result_v1",
        intent_epoch: 1,
        intent_epoch_id: epochId,
        library_id: libraryId,
        original_result_digest: null,
        previous_result_digest: previousResultDigest,
        receipt_ids: accepted.members.map((value) => value.envelope_digest),
        rejection_reason: null,
        replacement_fields: [],
        resolved_at_ms: resolvedAtMs,
        result_body_digest: "0".repeat(64),
        result_sequence: resultSequence,
        schema_version: 1,
        signature: "0".repeat(128),
        signature_algorithm: "ed25519",
        status: "accepted",
        transaction_digest: accepted.transaction_digest,
        transaction_id: firstEnvelope.transaction_id,
      });
      const acceptedResultDigest = coreDigest(
        "follower-result-body",
        libraryCoreFollowerResultBodyV1(unsignedAcceptedResult),
      );
      const acceptedResultBytes = encodeLibraryCoreCanonicalValue({
        ...unsignedAcceptedResult,
        result_body_digest: acceptedResultDigest,
        signature: sign(
          null,
          encodeLibraryCoreSignatureInput("follower-result-envelope", {
            result_body_digest: acceptedResultDigest,
          }),
          authorityKeys.privateKey,
        ).toString("hex"),
      } as unknown as LibraryCoreCanonicalValue);
      await engine.applyFollowerResult({
        canonicalResultBytes: acceptedResultBytes,
      });
      return acceptedResultDigest;
    };

    const annotationsMember =
      FEED_ITEM_ANNOTATIONS_REPLACE_TRANSACTION_MEMBER_SCHEMA.construct(
        {
          actor_id: actorId,
          actor_sequence: 2,
          causal_frontier: [],
          created_at_ms: 2_200,
          entity_id: item.globalId,
          epoch: 1,
          epoch_id: epochId,
          hlc_counter: 0,
          hlc_wall_ms: 2_200,
          library_id: libraryId,
          operation_id: "annotations-operation-1",
          payload: {
            assigned_at_ms: 2_200,
            highlights: [
              {
                createdAt: 2_000,
                note: "Remember",
                text: "Bounded passage",
                textBlobDigest: null,
              },
            ],
            tags: ["alpha", "research"],
          },
          previous_actor_operation_id: "capture-operation-1",
          transaction_id: "annotations-transaction-1",
          transaction_member_count: 1,
          transaction_member_index: 0,
        },
        { digest: coreDigest },
      );
    const annotationsAssembled = assembleLibraryCoreTransactionV1(
      [annotationsMember],
      finalized.members[0]!.envelope.actor_chain_digest,
      { digest: coreDigest },
    );
    const annotationsFinalized = await finalizeLibraryCoreTransactionV1(
      annotationsAssembled,
      {
        digest: coreDigest,
        async signOperation(message) {
          return sign(null, message, actorKeys.privateKey).toString("hex");
        },
      },
    );
    const annotationsResultDigest = await applyAcceptedTestTransaction(
      annotationsFinalized,
      2,
      resultDigest,
      2,
      2_250,
    );

    const analysisMember =
      FEED_ITEM_ANALYSIS_REPLACE_TRANSACTION_MEMBER_SCHEMA.construct(
        {
          actor_id: actorId,
          actor_sequence: 3,
          causal_frontier: [],
          created_at_ms: 2_201,
          entity_id: item.globalId,
          epoch: 1,
          epoch_id: epochId,
          hlc_counter: 0,
          hlc_wall_ms: 2_201,
          library_id: libraryId,
          operation_id: "analysis-operation-1",
          payload: {
            assigned_at_ms: 2_201,
            content_signals: {
              inferred_at_ms: 2_100,
              method: "rules",
              scores: [
                {
                  score_basis_points: 8_750,
                  signal: "event",
                  tagged: true,
                },
                {
                  score_basis_points: 2_500,
                  signal: "essay",
                  tagged: false,
                },
              ],
              version: 1,
            },
            event_candidate: {
              confidence_basis_points: 8_125,
              detected_at_ms: 2_110,
              ends_at_ms: 2_500,
              evidence: "Saturday at noon",
              evidence_blob_digest: null,
              location_name: "Library",
              location_url: null,
              method: "rules",
              starts_at_ms: 2_400,
              timezone: "America/Los_Angeles",
              title: "Meetup",
              version: 1,
            },
          },
          previous_actor_operation_id: "annotations-operation-1",
          transaction_id: "analysis-transaction-1",
          transaction_member_count: 1,
          transaction_member_index: 0,
        },
        { digest: coreDigest },
      );
    const analysisAssembled = assembleLibraryCoreTransactionV1(
      [analysisMember],
      annotationsFinalized.members[0]!.envelope.actor_chain_digest,
      { digest: coreDigest },
    );
    const analysisFinalized = await finalizeLibraryCoreTransactionV1(
      analysisAssembled,
      {
        digest: coreDigest,
        async signOperation(message) {
          return sign(null, message, actorKeys.privateKey).toString("hex");
        },
      },
    );
    const analysisResultDigest = await applyAcceptedTestTransaction(
      analysisFinalized,
      3,
      annotationsResultDigest,
      3,
      2_260,
    );
    expect(
      database.exec({
        sql: `SELECT
                (SELECT group_concat(tag, ',') FROM
                   (SELECT tag FROM library_feed_item_tags
                    WHERE global_id = 'captured-item-1'
                    ORDER BY tag COLLATE BINARY)),
                (SELECT text_value FROM library_feed_item_highlights
                 WHERE global_id = 'captured-item-1' AND ordinal = 0),
                (SELECT score FROM library_feed_item_signal_scores
                 WHERE global_id = 'captured-item-1' AND signal = 'event'),
                (SELECT tagged FROM library_feed_item_signal_scores
                 WHERE global_id = 'captured-item-1' AND signal = 'event'),
                (SELECT confidence FROM library_feed_item_events
                 WHERE global_id = 'captured-item-1'),
                (SELECT title FROM library_feed_item_events
                 WHERE global_id = 'captured-item-1');`,
        rowMode: "array",
        returnValue: "resultRows",
      }),
    ).toEqual([
      ["alpha,research", "Bounded passage", 0.875, 1, 0.8125, "Meetup"],
    ]);

    const itemUpdatedAtBeforePriority = database.exec({
      sql: `SELECT updated_at FROM library_feed_items
            WHERE global_id = 'captured-item-1';`,
      rowMode: 0,
      returnValue: "resultRows",
    })[0] as number;
    const priorityMember =
      FEED_ITEM_PRIORITY_ASSIGNMENT_TRANSACTION_MEMBER_SCHEMA.construct(
        {
          actor_id: actorId,
          actor_sequence: 4,
          causal_frontier: [],
          created_at_ms: 2_202,
          entity_id: item.globalId,
          epoch: 1,
          epoch_id: epochId,
          hlc_counter: 0,
          hlc_wall_ms: 2_202,
          library_id: libraryId,
          operation_id: "priority-operation-1",
          payload: {
            assigned_at_ms: 2_202,
            priority_basis_points: 8_125,
          },
          previous_actor_operation_id: "analysis-operation-1",
          transaction_id: "priority-transaction-1",
          transaction_member_count: 1,
          transaction_member_index: 0,
        },
        { digest: coreDigest },
      );
    const priorityAssembled = assembleLibraryCoreTransactionV1(
      [priorityMember],
      analysisFinalized.members[0]!.envelope.actor_chain_digest,
      { digest: coreDigest },
    );
    const priorityFinalized = await finalizeLibraryCoreTransactionV1(
      priorityAssembled,
      {
        digest: coreDigest,
        async signOperation(message) {
          return sign(null, message, actorKeys.privateKey).toString("hex");
        },
      },
    );
    const priorityResultDigest = await applyAcceptedTestTransaction(
      priorityFinalized,
      4,
      analysisResultDigest,
      4,
      2_270,
    );
    expect(
      database.exec({
        sql: `SELECT priority, priority_computed_at, updated_at
              FROM library_feed_items WHERE global_id = 'captured-item-1';`,
        rowMode: "array",
        returnValue: "resultRows",
      }),
    ).toEqual([[81.25, 2_202, itemUpdatedAtBeforePriority]]);

    const gapItem = {
      ...item,
      content: { ...item.content, text: "Must wait for revision two" },
      globalId: "captured-item-gap",
    };
    const gapMember =
      FEED_ITEM_CAPTURE_UPSERT_TRANSACTION_MEMBER_SCHEMA.construct(
        {
          actor_id: actorId,
          actor_sequence: 5,
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
          previous_actor_operation_id: "priority-operation-1",
          transaction_id: "capture-transaction-gap",
          transaction_member_count: 1,
          transaction_member_index: 0,
        },
        { digest: coreDigest },
      );
    const gapAssembled = assembleLibraryCoreTransactionV1(
      [gapMember],
      priorityFinalized.members[0]!.envelope.actor_chain_digest,
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
      authoritative_source_revision: 6,
      authority_key_id: "55".repeat(32),
      canonical_operation_ids: ["capture-operation-gap"],
      epoch: 1,
      epoch_id: epochId,
      format: "freed_follower_result_v1",
      intent_epoch: 1,
      intent_epoch_id: epochId,
      library_id: libraryId,
      original_result_digest: null,
      previous_result_digest: priorityResultDigest,
      receipt_ids: [gapFinalized.members[0]!.envelope_digest],
      rejection_reason: null,
      replacement_fields: [],
      resolved_at_ms: 2_300,
      result_body_digest: "0".repeat(64),
      result_sequence: 5,
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
    ).toEqual([[4, 4, 0, "accepted", 6]]);
  });

  it("atomically materializes an accepted signed Friend replacement", async () => {
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
      { now: () => 400 },
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
            VALUES ('active', ?1, ?2,
                    'primary:desktop',
                    1, 1);`,
      bind: [libraryId, epochId],
    });
    database.exec({
      sql: `INSERT INTO library_actors
              (actor_id, authority_epoch_id, actor_kind, public_key,
               enrollment_operation_id, enrollment_certificate_digest,
               canonical_enrollment_certificate, chain_genesis_digest,
               accepted_counter, accepted_operation_id, accepted_chain_digest,
               retired_at, created_at, updated_at)
            VALUES (?1, ?2, 'pwa', ?3, 'enroll-friend', ?4, '{}', ?5,
                    0, NULL, ?5, NULL, 1, 1);`,
      bind: [actorId, epochId, actorPublicKey, "bb".repeat(32), chainGenesis],
    });
    database.exec(`INSERT INTO library_actors
        (actor_id, authority_epoch_id, actor_kind, public_key,
         enrollment_operation_id, enrollment_certificate_digest,
         canonical_enrollment_certificate, chain_genesis_digest,
         accepted_counter, accepted_operation_id, accepted_chain_digest,
         retired_at, created_at, updated_at)
      SELECT '${"66".repeat(32)}', authority_epoch_id, 'desktop', public_key,
             'enroll-primary', '${"67".repeat(32)}', '{}', chain_genesis_digest,
             0, NULL, chain_genesis_digest, NULL, 1, 1
      FROM library_actors WHERE actor_kind = 'pwa';`);
    database.exec({
      sql: `INSERT INTO library_actor_capabilities
              (capability_id, actor_id, certificate_version, actor_class,
               scope_mode, scope_kind, scope_id, issuance_identity,
               retirement_identity, certificate_digest, canonical_certificate,
               issued_at, retired_at)
            VALUES ('friend-capability', ?1, 2, 'editor', 'library_wide',
                    NULL, NULL, ?2, ?3, ?4, '{}', 1, NULL);`,
      bind: [actorId, "cc".repeat(32), "dd".repeat(32), "ee".repeat(32)],
    });
    database.exec({
      sql: `INSERT INTO library_actor_capability_mutations
              (capability_id, mutation_id)
            VALUES ('friend-capability', 'friend_replace');`,
    });
    database.exec(`INSERT INTO library_persons
        (id, name, relationship_status, care_level, created_at, updated_at)
      VALUES ('person:friend', 'Before', 'friend', 3, 100, 100);
      INSERT INTO library_accounts
        (id, person_id, kind, provider, external_id, display_name,
         first_seen_at, last_seen_at, discovered_from, created_at, updated_at)
      VALUES
        ('account:keep', 'person:friend', 'social', 'instagram', 'keep', 'Keep',
         100, 200, 'captured_item', 100, 200),
        ('account:remove', 'person:friend', 'social', 'facebook', 'remove', 'Remove',
         100, 200, 'captured_item', 100, 200),
        ('contact:old', 'person:friend', 'contact', 'web_contact', 'old', 'Old',
         100, 200, 'contact_import', 100, 200);`);

    const person = {
      id: "person:friend",
      name: "After",
      relationshipStatus: "friend" as const,
      careLevel: 5,
      tags: ["family"],
      createdAt: 100,
      updatedAt: 300,
    };
    const accounts = [
      {
        id: "account:keep",
        personId: person.id,
        kind: "social" as const,
        provider: "instagram" as const,
        externalId: "keep",
        displayName: "Kept and updated",
        followRosterRoles: ["follower", "following"] as const,
        firstSeenAt: 100,
        lastSeenAt: 300,
        discoveredFrom: "captured_item" as const,
        createdAt: 100,
        updatedAt: 300,
      },
      {
        id: "contact:new",
        personId: person.id,
        kind: "contact" as const,
        provider: "web_contact" as const,
        externalId: "new",
        displayName: "New Contact",
        firstSeenAt: 300,
        lastSeenAt: 300,
        discoveredFrom: "contact_import" as const,
        createdAt: 300,
        updatedAt: 300,
      },
    ];
    const member = FRIEND_REPLACE_TRANSACTION_MEMBER_SCHEMA.construct(
      {
        actor_id: actorId,
        actor_sequence: 1,
        causal_frontier: [],
        created_at_ms: 300,
        entity_id: person.id,
        epoch: 1,
        epoch_id: epochId,
        hlc_counter: 0,
        hlc_wall_ms: 300,
        library_id: libraryId,
        operation_id: "friend-operation-1",
        payload: { accounts, person },
        previous_actor_operation_id: null,
        transaction_id: "friend-transaction-1",
        transaction_member_count: 1,
        transaction_member_index: 0,
      },
      { digest: coreDigest },
    );
    const finalized = await finalizeLibraryCoreTransactionV1(
      assembleLibraryCoreTransactionV1([member], chainGenesis, {
        digest: coreDigest,
      }),
      {
        digest: coreDigest,
        async signOperation(message) {
          return sign(null, message, actorKeys.privateKey).toString("hex");
        },
      },
    );
    // Provision this browser's local enrollment for this materialization fixture.
    database.exec(`INSERT INTO library_follower_actor_request
      (singleton_id, library_id, authority_epoch_id, actor_id, actor_public_key, enrollment_request_digest,
       canonical_enrollment_request, created_at, enrollment_certificate_digest, canonical_enrollment_certificate,
       actor_chain_genesis, enrolled_at)
      SELECT 1, meta.library_id, actor.authority_epoch_id, actor.actor_id, actor.public_key,
        actor.enrollment_certificate_digest, '{}', 1, actor.enrollment_certificate_digest,
        actor.canonical_enrollment_certificate, actor.chain_genesis_digest, 1
      FROM library_meta AS meta JOIN library_actors AS actor ON actor.authority_epoch_id = meta.authority_epoch
      WHERE actor.actor_kind = 'pwa';`);
    await engine.commitFollowerIntent({
      envelopeBytes: finalized.members.map(({ envelope }) =>
        encodeLibraryCoreCanonicalValue(
          envelope as unknown as LibraryCoreCanonicalValue,
        ),
      ),
    });
    const unsignedResult = parseLibraryCoreFollowerResultEnvelopeV1({
      actor_id: actorId,
      authoritative_source_revision: 1,
      authority_key_id: "55".repeat(32),
      canonical_operation_ids: ["friend-operation-1"],
      epoch: 1,
      epoch_id: epochId,
      format: "freed_follower_result_v1",
      intent_epoch: 1,
      intent_epoch_id: epochId,
      library_id: libraryId,
      original_result_digest: null,
      previous_result_digest: null,
      receipt_ids: [finalized.members[0]!.envelope_digest],
      rejection_reason: null,
      replacement_fields: [],
      resolved_at_ms: 500,
      result_body_digest: "0".repeat(64),
      result_sequence: 1,
      schema_version: 1,
      signature: "0".repeat(128),
      signature_algorithm: "ed25519",
      status: "accepted",
      transaction_digest: finalized.transaction_digest,
      transaction_id: "friend-transaction-1",
    });
    const resultDigest = coreDigest(
      "follower-result-body",
      libraryCoreFollowerResultBodyV1(unsignedResult),
    );
    await engine.applyFollowerResult({
      canonicalResultBytes: encodeLibraryCoreCanonicalValue({
        ...unsignedResult,
        result_body_digest: resultDigest,
        signature: sign(
          null,
          encodeLibraryCoreSignatureInput("follower-result-envelope", {
            result_body_digest: resultDigest,
          }),
          authorityKeys.privateKey,
        ).toString("hex"),
      } as unknown as LibraryCoreCanonicalValue),
    });

    expect(
      database.exec({
        sql: `SELECT name, care_level,
                     (SELECT group_concat(tag, ',') FROM library_person_tags
                      WHERE person_id = 'person:friend')
              FROM library_persons WHERE id = 'person:friend';`,
        rowMode: "array",
        returnValue: "resultRows",
      }),
    ).toEqual([["After", 5, "family"]]);
    expect(
      database.exec({
        sql: `SELECT id, person_id, display_name, last_seen_at
              FROM library_accounts
              WHERE id IN ('account:keep', 'account:remove', 'contact:old', 'contact:new')
              ORDER BY id;`,
        rowMode: "array",
        returnValue: "resultRows",
      }),
    ).toEqual([
      ["account:keep", "person:friend", "Kept and updated", 300],
      ["account:remove", null, "Remove", 200],
      ["contact:new", "person:friend", "New Contact", 300],
    ]);
    expect(
      database.exec({
        sql: `SELECT role FROM library_account_follow_roles
              WHERE account_id = 'account:keep' ORDER BY role;`,
        rowMode: 0,
        returnValue: "resultRows",
      }),
    ).toEqual(["follower", "following"]);
    expect(
      database.exec({
        sql: `SELECT topic, entity_id, reset_required
              FROM library_invalidations WHERE revision = 1 ORDER BY ordinal;`,
        rowMode: "array",
        returnValue: "resultRows",
      }),
    ).toEqual([
      ["person", "person:friend", 0],
      ["account", null, 1],
    ]);
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
            VALUES ('active', ?1, ?2,
                    'primary:desktop',
                    1, 1);`,
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
    database.exec(`INSERT INTO library_actors
        (actor_id, authority_epoch_id, actor_kind, public_key,
         enrollment_operation_id, enrollment_certificate_digest,
         canonical_enrollment_certificate, chain_genesis_digest,
         accepted_counter, accepted_operation_id, accepted_chain_digest,
         retired_at, created_at, updated_at)
      SELECT '${"66".repeat(32)}', authority_epoch_id, 'desktop', public_key,
             'enroll-primary', '${"67".repeat(32)}', '{}', chain_genesis_digest,
             0, NULL, chain_genesis_digest, NULL, 1, 1
      FROM library_actors WHERE actor_kind = 'pwa';`);
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
    // Provision this browser's local enrollment for this materialization fixture.
    database.exec(`INSERT INTO library_follower_actor_request
      (singleton_id, library_id, authority_epoch_id, actor_id, actor_public_key, enrollment_request_digest,
       canonical_enrollment_request, created_at, enrollment_certificate_digest, canonical_enrollment_certificate,
       actor_chain_genesis, enrolled_at)
      SELECT 1, meta.library_id, actor.authority_epoch_id, actor.actor_id, actor.public_key,
        actor.enrollment_certificate_digest, '{}', 1, actor.enrollment_certificate_digest,
        actor.canonical_enrollment_certificate, actor.chain_genesis_digest, 1
      FROM library_meta AS meta JOIN library_actors AS actor ON actor.authority_epoch_id = meta.authority_epoch
      WHERE actor.actor_kind = 'pwa';`);
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
      canonicalOperationId: "rss-upsert-operation",
      previousResultDigest: null,
      receiptId: upsertFinalized.members[0]!.envelope_digest,
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
      canonicalOperationId: "rss-title-operation",
      previousResultDigest: upsertResultDigest,
      receiptId: titleFinalized.members[0]!.envelope_digest,
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
      canonicalOperationId: "rss-remove-operation",
      previousResultDigest: titleResultDigest,
      receiptId: removeFinalized.members[0]!.envelope_digest,
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

  it("keeps selective content policy local and distinct from verified bytes", () => {
    const engine = new PwaLibraryCoreSqliteEngine(
      database,
      sqlite3.version.libVersion,
    );
    engine.initialize();
    const digest = "d".repeat(64);
    database.exec({
      sql: `INSERT INTO library_blobs
              (content_digest, byte_length, chunk_bytes, chunk_count, media_type)
            VALUES (?1, 5000000000, 65536, 0, 'video/mp4');`,
      bind: [digest],
    });
    expect(
      engine.readContentState({ contentDigest: digest, schemaVersion: 1 }),
    ).toMatchObject({
      availability: null,
      byteLength: 5_000_000_000,
      contentRevision: 0,
      policy: "metadata_only",
    });
    const mutation = {
      contentDigest: digest,
      policy: "pinned_offline" as const,
      schemaVersion: 1 as const,
      updatedAt: 100,
    };
    expect(engine.mutateContentPolicy(mutation)).toMatchObject({
      changed: true,
      contentRevision: 1,
      policy: "pinned_offline",
    });
    expect(engine.mutateContentPolicy(mutation).changed).toBe(false);
    expect(
      engine.readContentState({ contentDigest: digest, schemaVersion: 1 }),
    ).toMatchObject({
      availability: null,
      contentRevision: 1,
      policy: "pinned_offline",
      policyUpdatedAt: 100,
    });
    expect(
      database.exec({
        sql: `SELECT count(*) FROM library_checkpoint_export
              WHERE registry_key LIKE '%device_content%';`,
        rowMode: 0,
        returnValue: "resultRows",
      }),
    ).toEqual([0]);
  });

  it("publishes only range proofs that match canonical SQLite metadata", () => {
    const engine = new PwaLibraryCoreSqliteEngine(
      database,
      sqlite3.version.libVersion,
    );
    engine.initialize();
    const digest = "a".repeat(64);
    database.exec({
      sql: `INSERT INTO library_blobs
              (content_digest, byte_length, storage_layout, chunk_bytes,
               chunk_count, range_count, range_granularity,
               range_index_root_digest, rendition_id,
               cloud_availability_commitment, media_type)
            VALUES (?1, 10, 'authenticated_ranges', 0, 0, 2, 5, ?2,
                    'video', ?3, 'video/mp4');`,
      bind: [digest, "d".repeat(64), "e".repeat(64)],
    });
    database.exec({
      sql: `INSERT INTO library_content_ranges
              (content_digest, range_index, byte_offset, byte_length, range_digest)
            VALUES (?1, 0, 0, 5, ?2), (?1, 1, 5, 5, ?3);`,
      bind: [digest, "b".repeat(64), "c".repeat(64)],
    });
    expect(engine.readCanonicalContentRange(digest, 0)).toEqual({
      byteLength: 5,
      rangeContentDigest: "b".repeat(64),
    });
    const publication = {
      byteLength: 5,
      contentDigest: digest,
      rangeContentDigest: "b".repeat(64),
      rangeIndex: 0,
      schemaVersion: 1 as const,
      storageKey: "range-object-one",
      storageKind: "opfs" as const,
      verifiedAt: 50,
    };
    expect(engine.registerVerifiedContentRange(publication)).toMatchObject({
      changed: true,
      contentRevision: 1,
      hydrationState: "partially_cached",
      verifiedBytes: 5,
    });
    expect(engine.registerVerifiedContentRange(publication).changed).toBe(
      false,
    );
    expect(
      engine.readContentState({ contentDigest: digest, schemaVersion: 1 }),
    ).toMatchObject({
      availability: {
        completeDigestVerifiedAt: null,
        hydrationState: "partially_cached",
        storageKind: "opfs",
        verifiedBytes: 5,
      },
      contentRevision: 1,
    });
    expect(() =>
      engine.registerVerifiedContentRange({
        ...publication,
        rangeContentDigest: "f".repeat(64),
        storageKey: "untrusted-object",
      }),
    ).toThrow(/canonical metadata/);
    expect(
      database.exec({
        sql: "SELECT count(*) FROM library_device_content_ranges;",
        rowMode: 0,
        returnValue: "resultRows",
      }),
    ).toEqual([1]);
  });

  it("pages source-fenced hydration and least-recently-used eviction work", () => {
    const engine = new PwaLibraryCoreSqliteEngine(
      database,
      sqlite3.version.libVersion,
    );
    engine.initialize();
    const digest = "a".repeat(64);
    database.exec(`
      INSERT INTO library_meta
        (singleton_id, library_id, schema_version, authority_epoch, source_revision, updated_at)
      VALUES (1, '${"f".repeat(64)}', 1, 'epoch-1', 7, 1000);
      INSERT INTO library_materialization_generation
        (singleton_id, generation_id)
      VALUES (1, '${"e".repeat(64)}');
      UPDATE library_change_state SET revision = 7 WHERE singleton_id = 1;
    `);
    database.exec({
      sql: `INSERT INTO library_blobs
              (content_digest, byte_length, storage_layout, chunk_bytes,
               chunk_count, range_count, range_granularity,
               range_index_root_digest, rendition_id,
               cloud_availability_commitment, media_type)
            VALUES (?1, 10, 'authenticated_ranges', 0, 0, 2, 5, ?2,
                    'video', ?3, 'video/mp4');`,
      bind: [digest, "b".repeat(64), "c".repeat(64)],
    });
    database.exec({
      sql: `INSERT INTO library_content_ranges
              (content_digest, range_index, byte_offset, byte_length, range_digest)
            VALUES (?1, 0, 0, 5, ?2), (?1, 1, 5, 5, ?3);`,
      bind: [digest, "d".repeat(64), "9".repeat(64)],
    });
    engine.mutateContentPolicy({
      contentDigest: digest,
      policy: "complete_cache",
      schemaVersion: 1,
      updatedAt: 100,
    });
    engine.registerVerifiedContentRange({
      byteLength: 5,
      contentDigest: digest,
      rangeContentDigest: "d".repeat(64),
      rangeIndex: 0,
      schemaVersion: 1,
      storageKey: "range-zero",
      storageKind: "opfs",
      verifiedAt: 50,
    });
    const hydration = engine.pageHydrationCandidates({
      after: null,
      limit: 1,
      schemaVersion: 1,
      source: null,
    });
    expect(hydration).toMatchObject({
      next: null,
      rows: [
        {
          byteLength: 5,
          byteOffset: 5,
          contentDigest: digest,
          policy: "complete_cache",
          rangeContentDigest: "9".repeat(64),
          rangeIndex: 1,
        },
      ],
      source: { contentRevision: 2, sourceRevision: 7 },
    });
    const eviction = engine.pageEvictionCandidates({
      after: null,
      limit: 1,
      notAccessedAfter: 50,
      schemaVersion: 1,
      source: null,
    });
    expect(eviction).toMatchObject({
      next: null,
      rows: [
        {
          contentDigest: digest,
          lastAccessedAt: 50,
          policy: "complete_cache",
          verifiedBytes: 5,
        },
      ],
      source: { contentRevision: 2, sourceRevision: 7 },
    });
    engine.markContentAccessed(digest, 110_000);
    expect(
      engine.pageEvictionCandidates({
        after: null,
        limit: 1,
        notAccessedAfter: 50,
        schemaVersion: 1,
        source: eviction.source,
      }).rows,
    ).toEqual([]);
    engine.mutateContentPolicy({
      contentDigest: digest,
      policy: "partial_cache",
      schemaVersion: 1,
      updatedAt: 120_000,
    });
    expect(() =>
      engine.pageHydrationCandidates({
        after: hydration.next,
        limit: 1,
        schemaVersion: 1,
        source: hydration.source,
      }),
    ).toThrow(/source is stale/);
  });

  it("keeps Friends keyset pages exact across every sort and rejects missing anchors", () => {
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
      INSERT INTO library_persons
        (id, name, relationship_status, care_level, created_at, updated_at)
      VALUES
        ('person-1', 'Alex', 'friend', 5, 10, 100),
        ('person-2', 'alex', 'friend', 5, 20, 100),
        ('person-3', 'Blake', 'friend', 4, 30, 100),
        ('person-4', 'Casey', 'friend', 4, 40, 100);
      INSERT INTO library_person_reach_outs (person_id, reach_out_id, logged_at)
      VALUES
        ('person-1', 'reach-1', 500),
        ('person-2', 'reach-2', 500),
        ('person-3', 'reach-3', 300);
      INSERT INTO library_feed_items
        (global_id, platform, content_type, captured_at, published_at,
         author_id, author_handle, author_display_name, hidden, saved, archived,
         updated_at)
      VALUES
        ('item-1', 'x', 'post', 900, 900, 'author-1', 'author-1', 'Author 1', 0, 0, 0, 900),
        ('item-2', 'x', 'post', 900, 900, 'author-2', 'author-2', 'Author 2', 0, 0, 0, 900),
        ('item-3', 'x', 'post', 700, 700, 'author-3', 'author-3', 'Author 3', 0, 0, 0, 700);
      INSERT INTO library_person_feed_items (person_id, global_id, published_at)
      VALUES
        ('person-1', 'item-1', 900),
        ('person-2', 'item-2', 900),
        ('person-3', 'item-3', 700);
    `);
    expect(
      LIBRARY_CORE_SQLITE_QUERY_PROGRAMS.friends_directory_page_v1.sql,
    ).not.toContain(" OFFSET ");
    expect(
      LIBRARY_CORE_SQLITE_QUERY_PROGRAMS.friends_directory_page_v1.sql,
    ).toContain("cursor_row");

    const baseRequest = {
      cancellationId: operationId("cancel-friends-keyset"),
      cursor: null,
      filters: [],
      limit: 64,
      nowMs: 1_800_000_000_000,
      queryId: "friends_directory_page_v1" as const,
      readerSessionId: operationId("reader-friends-keyset"),
      schemaVersion: 1 as const,
      search: "",
    };
    for (const sort of [
      "name",
      "care_level",
      "last_contact",
      "recent_activity",
    ] as const) {
      const expected = engine
        .query({ ...baseRequest, sort })
        .rows.map((row) => row.id);
      const actual: string[] = [];
      let cursor: string | null = null;
      do {
        const page: LibraryCoreFriendsDirectoryPageResponseV1 = engine.query({
          ...baseRequest,
          cursor,
          limit: 1,
          sort,
        });
        actual.push(...page.rows.map((row) => row.id));
        cursor = page.nextCursor;
      } while (cursor !== null);
      expect(actual).toEqual(expected);
      expect(new Set(actual).size).toBe(actual.length);
    }

    // Searching the identity directory must not silently exclude connections.
    database.exec(`
      INSERT INTO library_persons
        (id, name, relationship_status, care_level, created_at, updated_at)
      VALUES
        ('search-1', 'Sela Current', 'friend', 5, 10, 100),
        ('search-2', 'Selma Shore', 'connection', 1, 10, 100),
        ('search-3', 'Ansel Threadbark', 'connection', 1, 10, 100);
      UPDATE library_persons SET bio = 'Enjoying himself quietly' WHERE id = 'person-4';
    `);
    const searched = engine.query({ ...baseRequest, search: "SEL", sort: "name" });
    expect(searched.totalCount).toBe(3);
    expect(searched.rows.map((row) => row.name)).toEqual([
      "Ansel Threadbark", "Sela Current", "Selma Shore",
    ]);
    expect(engine.query({ ...baseRequest, sort: "name" }).totalCount).toBe(5);

    const first = engine.query({ ...baseRequest, limit: 1, sort: "name" });
    const decoded = decodeLibraryCoreFriendsDirectoryCursorV1(
      first.nextCursor!,
    );
    expect(decoded.ok).toBe(true);
    if (!decoded.ok) return;
    const missingAnchor = encodeLibraryCoreFriendsDirectoryCursorV1({
      ...decoded.value,
      personId: "missing-person" as never,
    });
    expect(() =>
      engine.query({
        ...baseRequest,
        cursor: missingAnchor,
        limit: 1,
        sort: "name",
      }),
    ).toThrow("cursor row is missing");
  });

  it("reads bounded annotations and overlapping RSS counts from normalized rows", () => {
    const engine = new PwaLibraryCoreSqliteEngine(
      database,
      sqlite3.version.libVersion,
    );
    engine.initialize();
    database.exec(`
      INSERT INTO library_meta (singleton_id, library_id, schema_version, authority_epoch, source_revision, updated_at)
      VALUES (1, '${"a".repeat(64)}', 1, 'epoch-1', 7, 1000);
      INSERT INTO library_materialization_generation SELECT 1, library_id FROM library_meta;
      UPDATE library_change_state SET revision = 7 WHERE singleton_id = 1;
      INSERT INTO library_feed_items (global_id, platform, content_type, captured_at, published_at, author_id, author_handle, author_display_name, hidden, saved, archived, updated_at, rss_feed_url, read_at)
      VALUES ('rss-1', 'rss', 'article', 100, 100, 'a', 'a', 'Ada', 0, 0, 0, 100, NULL, NULL),
             ('rss-2', 'rss', 'article', 100, 100, 'a', 'a', 'Ada', 0, 0, 0, 100, 'https://example.com/feed', 100),
             ('substack-1', 'substack', 'article', 100, 100, 'a', 'a', 'Ada', 0, 0, 0, 100, 'https://example.com/feed', NULL),
             ('x-1', 'x', 'post', 100, 100, 'a', 'a', 'Ada', 0, 0, 0, 100, NULL, NULL);
      INSERT INTO library_feed_item_tags (global_id, tag) VALUES ('rss-1', 'favorite');
      INSERT INTO library_feed_item_highlights (global_id, ordinal, created_at, note, text_value, text_blob_digest)
      VALUES ('rss-1', 0, 123, 'Keep this', 'Quoted text', NULL);
    `);
    const summaryRequest = {
      queryId: "rss_item_summary_v1",
      schemaVersion: 1,
    } as const;
    expect(engine.query(summaryRequest)).toMatchObject({
      totalCount: 3,
      unreadCount: 2,
      source: { projectionRevision: 7 },
    });
    const request = {
      globalId: "rss-1",
      queryId: "item_annotations_v1",
      schemaVersion: 1,
    } as const;
    expect(engine.query(request)).toMatchObject({
      tags: ["favorite"],
      highlights: [
        {
          createdAt: 123,
          note: "Keep this",
          text: "Quoted text",
          textBlobDigest: null,
        },
      ],
      source: { projectionRevision: 7 },
    });
    database.exec({
      sql: "UPDATE library_feed_item_highlights SET note = ?1",
      bind: ["x".repeat(8193)],
    });
    expect(() => engine.query(request)).toThrow();
    database.exec(
      "DELETE FROM library_feed_items WHERE global_id = 'substack-1'",
    );
    expect(engine.query(summaryRequest)).toMatchObject({
      totalCount: 2,
      unreadCount: 1,
    });
    database.exec("DELETE FROM library_feed_items");
    expect(engine.query(summaryRequest)).toMatchObject({
      totalCount: 0,
      unreadCount: 0,
    });
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
        (url, title, site_url, last_fetched, image_url, enabled, poll_interval,
         track_unread, folder, sample_batch_id, sample_generated_at,
         sample_generator_version, updated_at)
      VALUES
        ('https://alpha.example/feed', 'Alpha', 'https://alpha.example', 150,
         NULL, 1, 15, 1, 'Research', 'sample-batch', 100, 1, 200),
        ('https://beta.example/feed', 'Beta', NULL, NULL,
         'https://beta.example/icon.png', 0, NULL, 1, NULL, NULL, NULL, NULL, 210);
      INSERT INTO library_feed_items
        (global_id, platform, content_type, captured_at, published_at,
         author_id, author_handle, author_display_name, author_avatar_url,
         rss_feed_url, content_text, link_url,
         hidden, saved, archived, updated_at)
      VALUES
        ('item-2', 'x', 'article', 200, 200, 'ada-remote', 'ada', 'Ada', NULL, NULL, 'newer', 'https://example.com/two', 0, 1, 0, 200),
        ('item-1', 'rss', 'article', 100, 100, 'alpha', 'grace', 'Grace', 'https://alpha.example/avatar.png', 'https://alpha.example/feed', 'older', 'https://example.com/one', 0, 0, 0, 100),
        ('hidden', 'saved', 'post', 300, 300, 'author-3', 'hidden', 'Hidden', NULL, NULL, 'nope', NULL, 1, 0, 0, 300);
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
         70, 220, 'capture', NULL, NULL, 70, 220),
        ('account-4', NULL, 'social', 'instagram', 'ada-instagram',
         'ada', 'Ada Lovelace', 80, 230, 'capture', NULL, NULL, 80, 230);
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
    database.exec({
      sql: `UPDATE library_feed_item_media
            SET blob_content_digest = ?1
            WHERE global_id = 'item-2' AND ordinal = 0;`,
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
      {
        friendName: "Ada",
        friendPersonId: "person-1",
        friendRelationshipStatus: "friend",
        globalId: "item-2",
        linkedAccountId: "account-1",
        locationName: "Observatory",
      },
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
      {
        globalId: "item-2",
        linkedAccountId: "account-1",
        linkedPersonId: "person-1",
        mediaUrls: ["https://example.com/image"],
      },
    ]);
    expect(storyCandidates.rows[0]).not.toHaveProperty("contentType");
    const scanRequest = {
      analysisVersion: null,
      cancellationId: operationId("cancel-scan-1"),
      cursor: null,
      limit: 2,
      priorityComputedBeforeMs: null,
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
      INSERT INTO library_feed_item_signals
        (global_id, version, method, inferred_at)
      VALUES
        ('item-1', 3, 'rules', 400),
        ('item-2', 2, 'rules', 400);
    `);
    const staleAnalysisScan = engine.query({
      ...scanRequest,
      analysisVersion: 3,
      cursor: null,
      limit: 64,
    });
    expect(staleAnalysisScan.rows.map((row) => row.globalId)).toEqual([
      "hidden",
      "item-2",
    ]);
    expect(staleAnalysisScan.nextCursor).toBeNull();
    database.exec(`
      INSERT INTO library_feed_item_topics (global_id, topic)
      VALUES ('item-2', 'sqlite');
      UPDATE library_feed_items
         SET priority_computed_at = 500,
             engagement_reposts = 7,
             engagement_views = 99
       WHERE global_id = 'item-2';
      UPDATE library_feed_items SET priority_computed_at = 700
       WHERE global_id = 'item-1';
    `);
    const stalePriorityScan = engine.query({
      ...scanRequest,
      cursor: null,
      limit: 64,
      priorityComputedBeforeMs: 600,
    });
    expect(stalePriorityScan.rows.map((row) => row.globalId)).toEqual([
      "hidden",
      "item-2",
    ]);
    expect(stalePriorityScan.rows[1]).toMatchObject({
      rankingCareLevel: 5,
      rankingEngagementReposts: 7,
      rankingEngagementViews: 99,
      topics: ["sqlite"],
    });
    // Tier 1: source-fenced time-only progress and full restart fallback.
    database.exec(`UPDATE library_feed_items SET priority_computed_at=published_at+604800000 WHERE global_id='item-1';
      UPDATE library_feed_items SET priority_computed_at=published_at+604800000-1 WHERE global_id='item-2';`);
    const timeRequest = { queryId: "priority_time_page_v1" as const, schemaVersion: 1 as const,
      cancellationId: operationId("cancel-time-page"), readerSessionId: operationId("reader-time-page"), limit: 64,
      priorityComputedBeforeMs: 604801000, generationId: stalePriorityScan.source.generationId,
      sourceRevision: stalePriorityScan.source.projectionRevision };
    const timePage = engine.query(timeRequest);
    expect(timePage.rows.map(row=>row.globalId)).toEqual(["hidden","item-2"]);
    database.exec(`UPDATE library_feed_items SET priority_computed_at=604801000 WHERE global_id IN ('hidden','item-2');`);
    expect(engine.query({...timeRequest,priorityComputedBeforeMs:604801001}).rows).toEqual([]);
    expect(engine.query({...scanRequest,limit:64,priorityComputedBeforeMs:604801001}).rows).toHaveLength(3);
    database.exec("UPDATE library_meta SET source_revision=source_revision+1; UPDATE library_change_state SET revision=revision+1;");
    expect(()=>engine.query(timeRequest)).toThrow("CURSOR_STALE");
    database.exec("UPDATE library_meta SET source_revision=source_revision-1; UPDATE library_change_state SET revision=revision-1;");
    const contentFetchRequest = {
      cancellationId: operationId("cancel-content-fetch-1"),
      cursor: null,
      limit: 1,
      queryId: "content_fetch_claim_v1" as const,
      readerSessionId: operationId("reader-content-fetch-1"),
      schemaVersion: 1 as const,
    };
    const contentFetch = engine.query(contentFetchRequest);
    expect(contentFetch.rows).toEqual([
      {
        capturedAt: 100,
        globalId: "item-1",
        linkUrl: "https://example.com/one",
        publishedAt: 100,
      },
    ]);
    expect(contentFetch.nextCursor).toBeNull();
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
        mediaBlobDigests: [blobDigest],
        preservedBody: { blobDigest, storage: "blob" },
      },
      queryId: "item_detail_v1",
      source: { projectionRevision: 7 },
    });
    database.exec(`
      INSERT INTO library_feed_items
        (global_id, platform, content_type, captured_at, published_at,
         author_id, author_handle, author_display_name, hidden, saved,
         archived, updated_at)
      VALUES
        ('account-picker-item', 'instagram', 'post', 240, 240,
         'ada-instagram', 'ada.lovelace', 'Ada Lovelace', 0, 0, 0, 240);
    `);
    const accountPickerRequest = {
      cancellationId: operationId("cancel-account-picker-1"),
      limit: 50,
      queryId: "account_picker_page_v1" as const,
      readerSessionId: operationId("reader-account-picker-1"),
      schemaVersion: 1 as const,
      search: "love",
    };
    expect(engine.query(accountPickerRequest)).toMatchObject({
      queryId: "account_picker_page_v1",
      rows: [
        {
          accountId: "account-4",
          authorId: "ada-instagram",
          displayName: "Ada Lovelace",
          platform: "instagram",
        },
      ],
      source: { projectionRevision: 7 },
    });
    expect(() =>
      engine.query({ ...accountPickerRequest, search: "lo" }),
    ).toThrow("request is invalid");
    database.exec(
      "UPDATE library_feed_items SET hidden = 1 WHERE global_id = 'account-picker-item';",
    );
    expect(engine.query(accountPickerRequest).rows).toEqual([]);
    database.exec(
      "UPDATE library_feed_items SET hidden = 0, published_at = 250 WHERE global_id = 'account-picker-item';",
    );
    expect(engine.query(accountPickerRequest).rows).toHaveLength(1);
    database.exec(
      "DELETE FROM library_feed_items WHERE global_id = 'account-picker-item';",
    );
    expect(engine.query(accountPickerRequest).rows).toEqual([]);
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
      linkedAccountCount: 2,
      linkedAccounts: [
        { id: "account-1", provider: "x" },
        { id: "account-3", provider: "rss" },
      ],
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
    const friendsDirectoryRequest = {
      cancellationId: operationId("cancel-friends-directory-1"),
      cursor: null,
      filters: [],
      limit: 1,
      nowMs: 1_800_000_000_000,
      queryId: "friends_directory_page_v1" as const,
      readerSessionId: operationId("reader-friends-directory-1"),
      schemaVersion: 1 as const,
      search: "",
      sort: "name" as const,
    };
    const firstFriendsDirectoryPage = engine.query(friendsDirectoryRequest);
    expect(firstFriendsDirectoryPage).toMatchObject({
      rows: [{ id: "person-1", name: "Ada", needsOutreach: true }],
      totalCount: 2,
    });
    expect(firstFriendsDirectoryPage.nextCursor).not.toBeNull();
    expect(
      engine
        .query({
          ...friendsDirectoryRequest,
          cursor: firstFriendsDirectoryPage.nextCursor,
        })
        .rows.map((row) => row.id),
    ).toEqual(["person-2"]);
    expect(
      engine.query({
        ...friendsDirectoryRequest,
        filters: ["no_contact"],
        limit: 32,
      }),
    ).toMatchObject({ rows: [{ id: "person-2" }], totalCount: 1 });
    expect(
      engine.query({
        ...friendsDirectoryRequest,
        limit: 32,
        search: "grace-remote",
      }),
    ).toMatchObject({ rows: [{ id: "person-2" }], totalCount: 1 });
    expect(() =>
      engine.query({
        ...friendsDirectoryRequest,
        cursor: firstFriendsDirectoryPage.nextCursor,
        search: "Grace",
      }),
    ).toThrow("cursor is invalid");
    expect(
      engine.query({
        cancellationId: operationId("cancel-person-picker-1"),
        limit: 12,
        queryId: "person_picker_page_v1",
        readerSessionId: operationId("reader-person-picker-1"),
        schemaVersion: 1,
        search: "Ad",
      }),
    ).toMatchObject({
      queryId: "person_picker_page_v1",
      rows: [
        {
          careLevel: 5,
          id: "person-1",
          name: "Ada",
          relationshipStatus: "friend",
        },
      ],
      source: { projectionRevision: 7 },
    });
    expect(
      engine.query({
        cancellationId: operationId("cancel-account-link-1"),
        entityId: "account-4",
        entityKind: "account",
        limit: 5,
        queryId: "account_link_candidates_v1",
        readerSessionId: operationId("reader-account-link-1"),
        schemaVersion: 1,
      }),
    ).toMatchObject({
      queryId: "account_link_candidates_v1",
      rows: [
        {
          accountDisplayName: "Ada Lovelace",
          accountExternalId: "ada-instagram",
          accountId: "account-4",
          accountProvider: "instagram",
          confidence: "high",
          personId: "person-1",
          personName: "Ada",
          score: 95,
        },
      ],
      source: { projectionRevision: 7 },
    });
    expect(
      engine.query({
        cancellationId: operationId("cancel-person-link-1"),
        entityId: "person-1",
        entityKind: "person",
        limit: 5,
        queryId: "account_link_candidates_v1",
        readerSessionId: operationId("reader-person-link-1"),
        schemaVersion: 1,
      }),
    ).toMatchObject({
      rows: [{ accountId: "account-4", personId: "person-1" }],
    });
    expect(
      engine.query({
        emails: [],
        names: ["ada", "ada lovelace"],
        queryId: "contact_match_v1",
        schemaVersion: 1,
      }),
    ).toMatchObject({
      accountIds: ["account-4"],
      confidence: "high",
      personId: "person-1",
      queryId: "contact_match_v1",
      source: { projectionRevision: 7 },
    });
    database.exec(`
      INSERT INTO library_feed_items
        (global_id, platform, content_type, captured_at, published_at,
         author_id, author_handle, author_display_name, hidden, saved,
         archived, updated_at)
      VALUES
        ('friend-candidate-item', 'instagram', 'post', 1799999999000,
         1799999999000, 'ada-instagram', 'ada', 'Ada Lovelace', 0, 0, 0,
         1799999999000);
      INSERT INTO library_feed_item_signal_scores (global_id, signal, score, tagged)
      VALUES
        ('friend-candidate-item', 'life_update', 0.95, 1),
        ('friend-candidate-item', 'event', 0.9, 1),
        ('friend-candidate-item', 'request', 0.9, 1),
        ('friend-candidate-item', 'place', 0.85, 1);
    `);
    const friendCandidateReviewRequest = {
      cancellationId: operationId("cancel-friend-candidate-review-1"),
      contactAccountIds: [] as string[],
      contactPersonIds: [] as string[],
      dismissedSuggestionIds: [] as string[],
      limit: 10,
      nowMs: 1_800_000_000_000,
      queryId: "friend_candidate_review_v1" as const,
      readerSessionId: operationId("reader-friend-candidate-review-1"),
      schemaVersion: 1 as const,
    };
    const friendCandidateReview = engine.query(friendCandidateReviewRequest);
    expect(friendCandidateReview).toMatchObject({
      queryId: "friend_candidate_review_v1",
      rows: [
        {
          accountIdsJson: '["account-4"]',
          confidence: "medium",
          displayName: "Ada Lovelace",
          kind: "unlinked_account",
          personId: null,
          sampleItemIdsJson: '["friend-candidate-item"]',
        },
      ],
      source: { projectionRevision: 7 },
    });
    expect(friendCandidateReview.rows[0]?.score).toBeGreaterThanOrEqual(60);
    expect(
      engine.query({
        ...friendCandidateReviewRequest,
        dismissedSuggestionIds: [friendCandidateReview.rows[0]!.id],
      }).rows,
    ).toEqual([]);
    database.exec(
      "DELETE FROM library_feed_items WHERE global_id = 'friend-candidate-item';",
    );
    expect(
      engine.query({
        queryId: "rss_feed_detail_v1",
        schemaVersion: 1,
        url: "https://alpha.example/feed",
      }),
    ).toMatchObject({
      feed: {
        enabled: true,
        folder: "Research",
        lastFetched: 150,
        pollInterval: 15,
        sampleBatchId: "sample-batch",
        siteUrl: "https://alpha.example",
        title: "Alpha",
        trackUnread: true,
        url: "https://alpha.example/feed",
      },
      queryId: "rss_feed_detail_v1",
      source: { projectionRevision: 7 },
    });
    expect(
      engine.query({
        queryId: "rss_feed_detail_v1",
        schemaVersion: 1,
        url: "https://missing.example/feed",
      }).feed,
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
        personName: "Ada",
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
    const maximumPersonName = "p".repeat(4_096);
    database.exec({
      sql: `INSERT INTO library_persons
              (id, name, relationship_status, care_level, created_at, updated_at)
            VALUES ('person-maximum', ?1, 'friend', 3, 1, 1);`,
      bind: [maximumPersonName],
    });
    const maximumHandle = "h".repeat(512);
    const maximumDisplayName = "d".repeat(512);
    const maximumAvatarUrl = "a".repeat(8_192);
    for (let index = 0; index < 130; index += 1) {
      const suffix = index.toLocaleString("en-US", {
        minimumIntegerDigits: 3,
        useGrouping: false,
      });
      const accountIdPrefix = `000-large-account-${suffix}-`;
      const externalIdPrefix = `external-${suffix}-`;
      database.exec({
        sql: `INSERT INTO library_accounts
                (id, person_id, kind, provider, external_id, handle,
                 display_name, avatar_url, first_seen_at, last_seen_at,
                 discovered_from, created_at, updated_at)
              VALUES (?1, 'person-maximum', 'social', 'x', ?2, ?3,
                      ?4, ?5, 1, 1, 'captured_item', 1, 1);`,
        bind: [
          `${accountIdPrefix}${"i".repeat(2_048 - accountIdPrefix.length)}`,
          `${externalIdPrefix}${"e".repeat(4_096 - externalIdPrefix.length)}`,
          maximumHandle,
          maximumDisplayName,
          maximumAvatarUrl,
        ],
      });
    }
    const maximumAccountPageRequest = {
      ...accountGraphRequest,
      cancellationId: operationId("cancel-account-maximum-page"),
      limit: 128,
      readerSessionId: operationId("reader-account-maximum-page"),
    };
    const maximumAccountFirstPage = engine.query(maximumAccountPageRequest);
    expect(maximumAccountFirstPage.nextCursor).not.toBeNull();
    expect(maximumAccountFirstPage.rows.length).toBeLessThan(128);
    expect(
      new TextEncoder().encode(JSON.stringify(maximumAccountFirstPage))
        .byteLength,
    ).toBeLessThanOrEqual(
      LIBRARY_CORE_FRIENDS_IDENTITY_PAGE_MAXIMUM_RESPONSE_BYTES,
    );
    const maximumAccountRows = [...maximumAccountFirstPage.rows];
    let maximumAccountCursor = maximumAccountFirstPage.nextCursor;
    while (maximumAccountCursor !== null) {
      const page = engine.query({
        ...maximumAccountPageRequest,
        cursor: maximumAccountCursor,
      });
      maximumAccountRows.push(...page.rows);
      maximumAccountCursor = page.nextCursor;
    }
    expect(maximumAccountRows).toHaveLength(134);
    expect(
      maximumAccountRows.find((row) => row.id.startsWith("000-large-account-")),
    ).toMatchObject({
      avatarUrl: maximumAvatarUrl,
      displayName: maximumDisplayName,
      handle: maximumHandle,
      personName: maximumPersonName,
    });
    const rssFeedGraphRequest = {
      cancellationId: operationId("cancel-rss-feed-graph-1"),
      cursor: null,
      limit: 1,
      queryId: "rss_feed_page_v1" as const,
      readerSessionId: operationId("reader-rss-feed-graph-1"),
      schemaVersion: 1 as const,
    };
    const firstRssFeedPage = engine.query(rssFeedGraphRequest);
    expect(firstRssFeedPage.rows).toMatchObject([
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
          cursor: firstRssFeedPage.nextCursor,
        })
        .rows.map((row) => row.url),
    ).toEqual(["https://beta.example/feed"]);
    const maximumTitle = "t".repeat(4_096);
    const maximumFolder = "f".repeat(4_096);
    const maximumSiteUrl = `https://example.com/${"s".repeat(4_076)}`;
    const maximumImageUrl = `https://example.com/${"i".repeat(4_076)}`;
    for (let index = 0; index < 130; index += 1) {
      const feedUrlPrefix = `https://000-large-${index.toLocaleString("en-US", { minimumIntegerDigits: 3, useGrouping: false })}.example/`;
      database.exec({
        sql: `INSERT INTO library_rss_feeds
                (url, title, site_url, image_url, enabled, track_unread,
                 folder, updated_at)
              VALUES (?1, ?2, ?3, ?4, 1, 1, ?5, 1);`,
        bind: [
          `${feedUrlPrefix}${"u".repeat(4_096 - feedUrlPrefix.length)}`,
          maximumTitle,
          maximumSiteUrl,
          maximumImageUrl,
          maximumFolder,
        ],
      });
    }
    const maximumPageRequest = {
      ...rssFeedGraphRequest,
      cancellationId: operationId("cancel-rss-feed-maximum-page"),
      limit: 128,
      readerSessionId: operationId("reader-rss-feed-maximum-page"),
    };
    const maximumFirstPage = engine.query(maximumPageRequest);
    expect(maximumFirstPage.nextCursor).not.toBeNull();
    expect(maximumFirstPage.rows.length).toBeLessThan(128);
    expect(
      new TextEncoder().encode(JSON.stringify(maximumFirstPage)).byteLength,
    ).toBeLessThanOrEqual(
      LIBRARY_CORE_FRIENDS_IDENTITY_PAGE_MAXIMUM_RESPONSE_BYTES,
    );
    const maximumRows = [...maximumFirstPage.rows];
    let maximumCursor = maximumFirstPage.nextCursor;
    while (maximumCursor !== null) {
      const page = engine.query({
        ...maximumPageRequest,
        cursor: maximumCursor,
      });
      maximumRows.push(...page.rows);
      maximumCursor = page.nextCursor;
    }
    expect(maximumRows).toHaveLength(132);
    expect(
      maximumRows.find((row) => row.url.startsWith("https://000-large-")),
    ).toMatchObject({
      folder: maximumFolder,
      imageUrl: maximumImageUrl,
      siteUrl: maximumSiteUrl,
      title: maximumTitle,
    });
    expect(
      engine.query({
        queryId: "persons_graph_v1",
        recentWindow: { startMs: 150, endMs: 250 },
        rssFeedUrls: ["https://alpha.example/feed"],
        schemaVersion: 1,
        sources: [{ authorId: "ada-remote", platform: "x" }],
      }),
    ).toMatchObject({
      rss: [
        {
          avatarGlobalId: "item-1",
          feedUrl: "https://alpha.example/feed",
          itemCount: 1,
          sampleItems: [{ globalId: "item-1", publishedAt: 100 }],
        },
      ],
      social: [
        {
          authorId: "ada-remote",
          itemCount: 1,
          platform: "x",
          recentCount: 1,
          sampleItems: [{ globalId: "item-2", publishedAt: 200 }],
          signalCounts: CONTENT_SIGNAL_KEYS.map((label) => ({
            count: 0,
            label,
          })),
        },
      ],
      totalItemCount: 3,
    });
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
        archivableCount: 0,
        contactAccountCount: 0,
        contactLinkedPersonCount: 0,
        enabledRssFeedCount: 131,
        friendPersonCount: 3,
        latestContactImportedAt: null,
        latestRssFeedFetchedAt: 150,
        platformCounts: [
          {
            archivableCount: 0,
            latestCapturedAt: 100,
            latestPublishedAt: 100,
            platform: "rss",
            totalCount: 1,
            unreadCount: 1,
          },
          {
            archivableCount: 0,
            latestCapturedAt: 300,
            latestPublishedAt: 300,
            platform: "saved",
            totalCount: 1,
            unreadCount: 1,
          },
          {
            archivableCount: 0,
            latestCapturedAt: 200,
            latestPublishedAt: 200,
            platform: "x",
            totalCount: 1,
            unreadCount: 1,
          },
        ],
        rssFeedCount: 132,
        sampleAccountCount: 0,
        sampleFeedCount: 1,
        sampleItemCount: 0,
        samplePersonCount: 0,
        savedArchivedCount: 0,
        savedCount: 1,
        savedPlatformCount: 1,
        socialAccountCount: 133,
        tags: ["favorite"],
        totalCount: 3,
        unreadCount: 3,
      },
    });
    expect(
      engine.query({
        authorId: null,
        feedUrl: "https://alpha.example/feed",
        platform: null,
        queryId: "filter_scope_summary_v1",
        schemaVersion: 1,
      }),
    ).toMatchObject({
      accountId: null,
      itemCount: 1,
      label: "Alpha",
      queryId: "filter_scope_summary_v1",
      source: { projectionRevision: 7 },
    });
    expect(
      engine.query({
        authorId: "ada-remote",
        feedUrl: null,
        platform: "x",
        queryId: "filter_scope_summary_v1",
        schemaVersion: 1,
      }),
    ).toMatchObject({
      accountId: "account-1",
      itemCount: 1,
      label: "Ada",
      queryId: "filter_scope_summary_v1",
      source: { projectionRevision: 7 },
    });
    expect(
      engine.query({
        authorId: null,
        feedUrl: "https://missing.example/feed",
        platform: null,
        queryId: "filter_scope_summary_v1",
        schemaVersion: 1,
      }),
    ).toMatchObject({ accountId: null, itemCount: 0, label: null });
    expect(() =>
      engine.query({
        authorId: "ada-remote",
        feedUrl: "https://alpha.example/feed",
        platform: "x",
        queryId: "filter_scope_summary_v1",
        schemaVersion: 1,
      }),
    ).toThrow(/filter scope summary request is invalid/);
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
        cursor: firstRssFeedPage.nextCursor,
      }),
    ).toThrow(/cursor is stale/);
  });

  it("pages compact provider media rows with request-bound cursors", () => {
    const engine = new PwaLibraryCoreSqliteEngine(
      database,
      sqlite3.version.libVersion,
    );
    engine.initialize();
    database.exec(`
      INSERT INTO library_meta
        (singleton_id, library_id, schema_version, authority_epoch, source_revision, updated_at)
      VALUES (1, '${"a".repeat(64)}', 1, 'epoch-1', 7, 1000);
      INSERT INTO library_materialization_generation (singleton_id, generation_id)
      VALUES (1, '${"a".repeat(64)}');
      UPDATE library_change_state SET revision = 7 WHERE singleton_id = 1;
      INSERT INTO library_feed_items
        (global_id, platform, content_type, captured_at, published_at,
         author_id, author_handle, author_display_name, source_url, link_url,
         fb_group_id, fb_group_name, fb_group_url, hidden, saved, archived, updated_at)
      VALUES
        ('facebook-1', 'facebook', 'video', 10, 10, 'author-1', 'one', 'One',
         'https://facebook.test/1', 'https://example.test/1', 'group-1', 'Group',
         'https://facebook.test/groups/1', 0, 1, 0, 10),
        ('facebook-2', 'facebook', 'video', 20, 20, 'author-2', 'two', 'Two',
         'https://facebook.test/2', 'https://example.test/2', NULL, NULL,
         NULL, 0, 0, 0, 20),
        ('facebook-hidden', 'facebook', 'video', 30, 30, 'author-3', 'three', 'Three',
         'https://facebook.test/3', NULL, NULL, NULL, NULL, 1, 1, 0, 30),
        ('saved-youtube', 'saved', 'article', 40, 40, 'author-4', 'four', 'Four',
         'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
         'https://www.youtube.com/watch?v=dQw4w9WgXcQ', NULL, NULL, NULL, 0, 1, 0, 40);
      INSERT INTO library_feed_item_media (global_id, ordinal, source_url, media_type)
      VALUES ('facebook-1', 0, 'https://example.test/1.mp4', 'video');
    `);
    const request = {
      cancellationId: operationId("cancel-provider-media-1"),
      cursor: null,
      limit: 1,
      provider: "facebook" as const,
      queryId: "provider_media_page_v1" as const,
      readerSessionId: operationId("reader-provider-media-1"),
      savedOnly: false,
      schemaVersion: 1 as const,
    };
    const first = engine.query(request);
    expect(first.rows).toMatchObject([
      {
        fbGroup: { id: "group-1", name: "Group" },
        globalId: "facebook-1",
        linkUrl: "https://example.test/1",
        mediaUrls: ["https://example.test/1.mp4"],
      },
    ]);
    expect(first.nextCursor).not.toBeNull();
    const second = engine.query({ ...request, cursor: first.nextCursor });
    expect(second.rows.map((row) => row.globalId)).toEqual(["facebook-2"]);
    expect(second.nextCursor).toBeNull();
    expect(
      engine
        .query({ ...request, limit: 2, savedOnly: true })
        .rows.map((row) => row.globalId),
    ).toEqual(["facebook-1"]);
    expect(() =>
      engine.query({ ...request, cursor: first.nextCursor, savedOnly: true }),
    ).toThrow(/cursor is stale/);
    expect(
      engine
        .query({
          ...request,
          limit: 2,
          provider: "youtube",
          savedOnly: true,
        })
        .rows.map((row) => row.globalId),
    ).toEqual(["saved-youtube"]);
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
    expect(database.exec({
      sql: "PRAGMA quick_check(1);", rowMode: 0, returnValue: "resultRows",
    })).toEqual(["ok"]);
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
    expect(engine.beginNormalizedCheckpointStage({ ...stage, createdAt: 2_000 })).toEqual(complete);
    expect(database.exec({
      sql: "SELECT created_at FROM library_checkpoint_stages WHERE stage_id = ?1;",
      bind: [stage.stageId], rowMode: 0, returnValue: "resultRows",
    })).toEqual([1_000]);
    expect(() =>
      engine.beginNormalizedCheckpointStage({ ...stage, sourceRevision: 8 }),
    ).toThrow(/replay changed its identity/);
    expect(
      engine.activateNormalizedCheckpointStage({
        followerReceipt: null,
        replaceExisting: false,
        stageId: stage.stageId,
      }),
    ).toMatchObject({
      checkpointDigest: digestLibraryCoreNormalizedCheckpointRecordsV2(records),
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

  it("authenticates native multi-transfer historical reads without selecting checkpoints", async () => {
    const engine = new PwaLibraryCoreSqliteEngine(database, sqlite3.version.libVersion, { capi: sqlite3.capi });
    engine.initialize();
    const v = nativeMissedTransfers;
    const first = v.readReferences[0]!;
    const records = (input: unknown[]) => input.map(parseLibraryCoreNormalizedCheckpointRecordV2);
    const initialReceipt = { checkpointGeneration: first.pointer.generation, controlRevision: first.controlRevision,
      installedAt: 2400, manifestContentDigest: lowercaseHex64(first.pointer.manifest.descriptor.contentDigest),
      manifestObjectKey: first.pointer.manifest.descriptor.objectKey,
      manifestTransportObjectId: first.pointer.manifest.transportObjectId, writerActorId: first.pointer.writerId };
    stageRecords(engine, records(v.baseline.records), "multi-baseline", v.baseline.descriptor);
    engine.activateNormalizedCheckpointStage({ stageId: "multi-baseline", replaceExisting: false, followerReceipt: initialReceipt });
    stageRecords(engine, records(v.successor.records), "multi-successor", v.successor.descriptor);
    const changes = database.changes(true);
    expect(await engine.preparePredecessorCheckpointRead("multi-successor")).toEqual(v.readReferences);
    expect(database.changes(true)).toBe(changes);
    expect(database.selectValue("SELECT authority_epoch FROM library_meta;")).toBe(v.baseline.descriptor.authorityEpoch);
    const pending = engine.preparePredecessorCheckpointRead("multi-successor");
    database.exec("UPDATE library_meta SET source_revision=source_revision+1;");
    await expect(pending).rejects.toThrow(/changed during verification/);
  });

  it("admits two native transfers only with intact historical checkpoints at activation", async () => {
    const engine = new PwaLibraryCoreSqliteEngine(database, sqlite3.version.libVersion, { capi: sqlite3.capi });
    engine.initialize();
    const v = nativeMissedTransfers, first = v.readReferences[0]!;
    const records = (input: unknown[]) => input.map(parseLibraryCoreNormalizedCheckpointRecordV2);
    const receipt = { checkpointGeneration: first.pointer.generation, controlRevision: first.controlRevision,
      installedAt: 2400, manifestContentDigest: lowercaseHex64(first.pointer.manifest.descriptor.contentDigest),
      manifestObjectKey: first.pointer.manifest.descriptor.objectKey,
      manifestTransportObjectId: first.pointer.manifest.transportObjectId, writerActorId: first.pointer.writerId };
    stageRecords(engine, records(v.baseline.records), "multi-baseline", v.baseline.descriptor);
    engine.activateNormalizedCheckpointStage({ stageId: "multi-baseline", replaceExisting: false, followerReceipt: receipt });
    stageRecords(engine, records(v.successor.records), "multi-successor", v.successor.descriptor);
    const finalEpoch = v.successor.records.find(record => record.registryKey === "01_authority_epoch" && record.primaryKey === v.successor.descriptor.authorityEpoch)!;
    const certificate = JSON.parse(String(finalEpoch.payload.canonicalTransitionCertificate));
    const activation = { stageId: "multi-successor", replaceExisting: true,
      followerReceipt: { ...receipt, writerActorId: certificate.certificate_body.target_writer_id } };
    await expect(engine.verifyNormalizedCheckpointSuccessor(activation)).rejects.toThrow(/historical target enrollment/);
    for (let index = 0; index < v.predecessors.length; index++) {
      const predecessor = v.predecessors[index]!;
      stageRecords(engine, records(predecessor.records), v.readReferences[index]!.pointer.manifest.descriptor.contentDigest, predecessor.descriptor);
    }
    await engine.verifyNormalizedCheckpointSuccessor(activation);
    const id = first.pointer.manifest.descriptor.contentDigest;
    const original = database.selectValue("SELECT record_canonical FROM library_checkpoint_stage_records WHERE stage_id=?1 AND registry_key='00_checkpoint_header';", [id]) as Uint8Array;
    const altered = new TextDecoder().decode(original).replace('"createdAtMs":', '"createdAtMs":1');
    database.exec({ sql: "UPDATE library_checkpoint_stage_records SET record_canonical=?1 WHERE stage_id=?2 AND registry_key='00_checkpoint_header';", bind: [Uint8Array.from(new TextEncoder().encode(altered)), id] });
    expect(() => engine.activateNormalizedCheckpointStage(activation)).toThrow();
    expect(database.selectValue("SELECT authority_epoch FROM library_meta;")).toBe(v.baseline.descriptor.authorityEpoch);
    database.exec({ sql: "UPDATE library_checkpoint_stage_records SET record_canonical=?1 WHERE stage_id=?2 AND registry_key='00_checkpoint_header';", bind: [original, id] });
    await engine.verifyNormalizedCheckpointSuccessor(activation);
    stageRecords(engine,records(v.baseline.records),"unrelated-staging",v.baseline.descriptor);
    const historicalCount = () => database.selectValue("SELECT count(*) FROM library_checkpoint_stages WHERE stage_id IN (?1,?2);",v.readReferences.map(ref => ref.pointer.manifest.descriptor.contentDigest));
    const historyRecords = v.predecessors.reduce((sum,entry) => sum + entry.records.length,0);
    const totalRecords = historyRecords + v.successor.records.length;
    expect(() => engine.activateNormalizedCheckpointStage(activation,(completed) => {
      if (completed === historyRecords) throw new Error("historical verification interrupted");
    })).toThrow("historical verification interrupted");
    expect(database.selectValue("SELECT authority_epoch FROM library_meta;")).toBe(v.baseline.descriptor.authorityEpoch);
    await engine.verifyNormalizedCheckpointSuccessor(activation);
    expect(historicalCount()).toBe(2);
    database.exec(`CREATE TEMP TRIGGER fail_historical_cleanup BEFORE DELETE ON library_checkpoint_stages
      WHEN OLD.stage_id='${v.readReferences[1]!.pointer.manifest.descriptor.contentDigest}'
      BEGIN SELECT RAISE(ABORT,'historical cleanup fault'); END;`);
    expect(() => engine.activateNormalizedCheckpointStage(activation)).toThrow(/historical cleanup fault/);
    expect(historicalCount()).toBe(2);
    expect(database.selectValue("SELECT authority_epoch FROM library_meta;")).toBe(v.baseline.descriptor.authorityEpoch);
    database.exec("DROP TRIGGER fail_historical_cleanup;");
    await engine.verifyNormalizedCheckpointSuccessor(activation);
    const progress: number[][] = [];
    engine.activateNormalizedCheckpointStage(activation,(completed,total) => progress.push([completed,total]));
    expect(progress).toEqual([[0,totalRecords],[historyRecords,totalRecords],[totalRecords,totalRecords]]);
    expect(historicalCount()).toBe(0);
    expect(database.selectValue("SELECT count(*) FROM library_checkpoint_stage_records WHERE stage_id IN (?1,?2);",v.readReferences.map(ref => ref.pointer.manifest.descriptor.contentDigest))).toBe(0);
    expect(database.selectValue("SELECT count(*) FROM library_checkpoint_stages WHERE stage_id='unrelated-staging';")).toBe(1);
    expect(database.selectValue("SELECT authority_epoch FROM library_meta;")).toBe(v.successor.descriptor.authorityEpoch);
    // Storage fixture for a still-retained old enrollment. This test exercises
    // continuation admission, not enrollment signature acceptance or reissue.
    database.exec({ sql: `INSERT INTO library_follower_actor_request
      (singleton_id,library_id,authority_epoch_id,actor_id,actor_public_key,enrollment_request_digest,canonical_enrollment_request,created_at)
      VALUES (1,?1,?2,?3,?4,?5,'{}',1);`, bind: [v.baseline.descriptor.libraryId,v.baseline.descriptor.authorityEpoch,
        "a".repeat(64),"b".repeat(64),"c".repeat(64)] });
    const retainedRequest = () => database.exec({ sql: "SELECT * FROM library_follower_actor_request;", rowMode: "array", returnValue: "resultRows" });
    const oldRequest = retainedRequest();
    const revision = v.successor.descriptor.sourceRevision + 1;
    const refreshed = records(v.successor.records).map(record => record.registryKey === "00_checkpoint_header"
      ? createLibraryCoreNormalizedCheckpointRecordV2({ ...record, payload: { ...record.payload,sourceRevision:revision,
        checkpointId:`${v.successor.descriptor.libraryId}:${v.successor.descriptor.authorityEpoch}:${revision}` } }) : record);
    const refresh = { ...activation,stageId:"multi-continuation", followerReceipt:{...activation.followerReceipt,checkpointGeneration:receipt.checkpointGeneration+1} };
    stageRecords(engine,refreshed,refresh.stageId,{...v.successor.descriptor,sourceRevision:revision});
    // Restart loses the in-memory proof but retained signed history is sufficient.
    const resumed = new PwaLibraryCoreSqliteEngine(database,sqlite3.version.libVersion,{capi:sqlite3.capi});
    expect(() => resumed.activateNormalizedCheckpointStage(refresh)).toThrow(/current verified proof/);
    await resumed.verifyNormalizedCheckpointSuccessor(refresh);
    database.exec("SAVEPOINT changed_history;");
    database.exec({sql:"UPDATE library_authority_epochs SET canonical_transition_certificate='{}' WHERE epoch_id=?1;",bind:[v.readReferences[1]!.pointer.storageEpoch]});
    expect(() => resumed.activateNormalizedCheckpointStage(refresh)).toThrow();
    expect(database.selectValue("SELECT source_revision FROM library_meta;")).toBe(v.successor.descriptor.sourceRevision);
    database.exec("ROLLBACK TO changed_history; RELEASE changed_history;");
    await resumed.verifyNormalizedCheckpointSuccessor(refresh);
    resumed.activateNormalizedCheckpointStage(refresh);
    expect(database.selectValue("SELECT source_revision FROM library_meta;")).toBe(revision);
    expect(retainedRequest()).toEqual(oldRequest);
  });

  it("imports the native signed predecessor before admitting a missed successor target", async () => {
    const engine = new PwaLibraryCoreSqliteEngine(database, sqlite3.version.libVersion, { capi: sqlite3.capi });
    engine.initialize();
    const v = nativeHandoffCatchup;
    const records = (input: unknown[]) => input.map(parseLibraryCoreNormalizedCheckpointRecordV2);
    const initialReceipt = {checkpointGeneration:0,controlRevision:"baseline",installedAt:2400,
      manifestContentDigest:lowercaseHex64("8".repeat(64)),manifestObjectKey:"baseline",manifestTransportObjectId:"baseline",writerActorId:v.baseline.writerId};
    stageRecords(engine,records(v.baselineRecords),"catchup-baseline",v.baseline);
    engine.activateNormalizedCheckpointStage({stageId:"catchup-baseline",replaceExisting:false,followerReceipt:initialReceipt});
    stageRecords(engine,records(v.successorRecords),"catchup-successor",v.successor);
    const successorActivation={stageId:"catchup-successor",replaceExisting:true,
      followerReceipt:{...initialReceipt,writerActorId:v.successor.writerId}};
    await expect(engine.verifyNormalizedCheckpointSuccessor(successorActivation)).rejects.toThrow("not enrolled");
    const proof=await engine.preparePredecessorCheckpointRead("catchup-successor");
    expect(proof).toEqual(v.expectedReadProof);
    if (!proof || !("pointer" in proof)) throw new Error("expected direct predecessor fixture");
    const pointer=proof.pointer;
    const activation={stageId:"catchup-predecessor",replaceExisting:true,followerReceipt:{
      checkpointGeneration:pointer.generation,controlRevision:proof!.controlRevision,installedAt:2401,
      manifestContentDigest:pointer.manifest.descriptor.contentDigest,manifestObjectKey:pointer.manifest.descriptor.objectKey,
      manifestTransportObjectId:pointer.manifest.transportObjectId,writerActorId:pointer.writerId,
    }};
    const wrong = records(v.predecessorRecords).map(record=>record.registryKey==="00_checkpoint_header"
      ? createLibraryCoreNormalizedCheckpointRecordV2({...record,payload:{...record.payload,createdAtMs:1}}):record);
    stageRecords(engine,wrong,activation.stageId,v.predecessor);
    await expect(engine.activateVerifiedPredecessorCheckpoint(activation,"catchup-successor"))
      .rejects.toThrow("digest differs from signed consent");
    expect(database.selectValue("SELECT source_revision FROM library_meta;")).toBe(v.baseline.sourceRevision);
    expect(database.selectValue("SELECT count(*) FROM library_checkpoint_stages;")).toBe(2);
    database.exec({sql:"DELETE FROM library_checkpoint_stages WHERE stage_id=?1;",bind:[activation.stageId]});
    // A replacement engine has no in-memory proof from the preparation attempt.
    const resumed = new PwaLibraryCoreSqliteEngine(database, sqlite3.version.libVersion, { capi: sqlite3.capi });
    await expect(resumed.activateVerifiedPredecessorCheckpoint(activation,"x".repeat(256))).rejects.toThrow();
    await expect(resumed.activateVerifiedPredecessorCheckpoint({ ...activation, followerReceipt: {
      ...activation.followerReceipt, controlRevision: "untrusted",
    } },"catchup-successor")).rejects.toThrow("receipt differs from signed consent");
    expect(database.selectValue("SELECT source_revision FROM library_meta;")).toBe(v.baseline.sourceRevision);
    const transport = v.predecessorTransport;
    const manifest = JSON.parse(transport.manifest);
    const objects = new Map<string, Uint8Array>([[pointer.manifest.transportObjectId, new TextEncoder().encode(transport.manifest)]]);
    transport.pagesHex.forEach((hex, index) => objects.set(manifest.pages[index].object.transportObjectId,
      Uint8Array.from(Buffer.from(hex, "hex"))));
    const readImmutable = vi.fn(async (reference: { transportObjectId: string }) => {
      const bytes = objects.get(reference.transportObjectId);
      if (!bytes) throw new Error("fixture immutable object is missing");
      return bytes;
    });
    const catchup = { adapter: { readImmutable }, subtle: crypto.subtle,
      successorStageId: "catchup-successor", installedAt: 2401, assertActive: () => {}, runtime: {
        prepare: (stageId: string) => resumed.preparePredecessorCheckpointRead(stageId),
        begin: async (request: Parameters<typeof resumed.beginNormalizedCheckpointStage>[0]) => resumed.beginNormalizedCheckpointStage(request),
        appendPage: async (request: Parameters<typeof resumed.appendNormalizedCheckpointStagePage>[0]) => resumed.appendNormalizedCheckpointStagePage(request),
        async activate(request: Parameters<typeof resumed.activateVerifiedPredecessorCheckpoint>[0], stageId: string) {
          const installed = await resumed.activateVerifiedPredecessorCheckpoint(request, stageId);
          expect(installed.checkpointDigest).toBe(proof!.checkpointDigest);
          throw new Error("commit response lost");
        },
      } };
    await expect(catchUpLibraryCorePredecessorCheckpointV1(catchup)).rejects.toThrow("commit response lost");
    expect(readImmutable).toHaveBeenCalledTimes(transport.pagesHex.length + 1);
    expect(database.selectValue("SELECT checkpoint_digest FROM library_follower_checkpoint_receipt;")).toBe(proof!.checkpointDigest);
    readImmutable.mockClear();
    // Durable enrollment readback skips the committed predecessor after response loss.
    await catchUpLibraryCorePredecessorCheckpointV1(catchup);
    expect(readImmutable).not.toHaveBeenCalled();
    await engine.verifyNormalizedCheckpointSuccessor(successorActivation);
    expect(engine.activateNormalizedCheckpointStage(successorActivation).authorityEpoch).toBe(v.successor.authorityEpoch);
    // This native checkpoint spans more than one 64-record audit page.
    expect(v.successor.recordCount).toBeGreaterThan(64);
    let pages = 0;
    await expect(engine.auditNormalizedReplica({
      check() { if (pages === 2) throw new Error("AUDIT_INTERRUPTED"); },
      yieldControl: async () => { pages += 1; },
    })).rejects.toThrow("AUDIT_INTERRUPTED");
    expect(pages).toBe(2);
    const describe = vi.spyOn(engine, "describeNormalizedCheckpointExport");
    const audited = await engine.auditNormalizedReplica({ check() {}, yieldControl: async () => {} });
    expect(describe).toHaveBeenCalledOnce();
    describe.mockRestore();
    expect(audited.snapshot).toEqual(v.successor);
    expect(audited.checkpointDigest).toBe(digestLibraryCoreNormalizedCheckpointRecordsV2(records(v.successorRecords)));
  });

  it("pins a verified direct successor at commit and preserves the old consumer enrollment", async () => {
    const handoffVector = recoveredEnrollmentVector;
    const engine = new PwaLibraryCoreSqliteEngine(database, sqlite3.version.libVersion, { capi: sqlite3.capi });
    engine.initialize();
    const pin = handoffVector.predecessor;
    const certificate = JSON.parse(handoffVector.canonicalCertificate);
    const targetId = certificate.certificate_body.target_writer_id;
    const consumerKey = generateKeyPairSync("ed25519");
    const consumerPublicKey = consumerKey.publicKey.export({ format: "der", type: "spki" }).subarray(-32).toString("hex");
    async function consumerRequest(epochId: string, epoch: number, keyId: string, nonce: string, createdAt: number,
      observedFrontier: ReturnType<PwaLibraryCoreSqliteEngine["followerActorEnrollmentContext"]>["authority"]["observed_frontier"] = []) {
      const enrollment = constructLibraryCoreActorEnrollmentBodyV1({
        actor_incarnation_nonce: nonce, actor_public_key: consumerPublicKey, authority_key_id: keyId,
        created_at_ms: createdAt, epoch, epoch_id: epochId, installation_incarnation: "7".repeat(64),
        library_id: pin.libraryId, observed_frontier: observedFrontier, operation_id: `consumer-enrollment:${createdAt}`,
      }, { digest: coreDigest });
      const signed = await constructLibraryCoreActorCapabilityRequestV2(enrollment, {
        actor_class: "editor", allowed_operation_types: LIBRARY_CORE_PRIMARY_WRITER_OPERATION_TYPES_V2,
        allowed_query_ids: [], scope: { mode: "library_wide" },
      }, { digest: coreDigest, signActorProof: async message => sign(null, message, consumerKey.privateKey).toString("hex") });
      return { enrollment, actorId: enrollment.body.actor_id, requestDigest: signed.request.certificate_digest,
        input: { canonicalRequestBytes: encodeLibraryCoreCanonicalValue(signed.request as unknown as LibraryCoreCanonicalValue), createdAt } };
    }
    const originalRequest = await consumerRequest(pin.epochId, pin.epoch, "a".repeat(64), "8".repeat(64), 1);
    const consumerId = originalRequest.actorId;
    const base = [checkpointHeader(), ...authorityRecords()].map(record => {
      const changed = JSON.parse(JSON.stringify(record).replaceAll("library-1", pin.libraryId).replaceAll("epoch-1", pin.epochId).replaceAll("actor-1", pin.writerId).replaceAll("writer-1", pin.writerId));
      if (changed.registryKey === "01_authority_epoch") {
        changed.payload.epochNumber = pin.epoch;
        changed.payload.authorityPublicKey = pin.authorityPublicKey;
        changed.payload.transitionCertificateDigest = pin.certificateDigest;
      }
      return createLibraryCoreNormalizedCheckpointRecordV2(changed);
    });
    const actorTemplate = base.find(row => row.registryKey === "90_actor_state")!;
    const capabilityTemplate = base.find(row => row.registryKey === "91_actor_capability")!;
    for (const [id, publicKey] of [[targetId, handoffVector.enrolledActorPublicKey], [consumerId, consumerPublicKey]]) {
      base.push(createLibraryCoreNormalizedCheckpointRecordV2({ ...actorTemplate, primaryKey: id!, payload: {
        ...actorTemplate.payload, acceptedCounter: 0, acceptedOperationId: null, acceptedChainDigest: "2".repeat(64),
        actorKind: "pwa", publicKey: publicKey!,
      } }));
      base.push(createLibraryCoreNormalizedCheckpointRecordV2({ ...capabilityTemplate, primaryKey: `cap-${id}`, payload: { ...capabilityTemplate.payload, actorId: id! } }));
      base.push(createLibraryCoreNormalizedCheckpointRecordV2({ registryKey: "92_actor_capability_mutation", primaryKey: [`cap-${id}`, "feed_item_read_assignment"], payload: { mutationId: "feed_item_read_assignment" } }));
    }
    const receipt = { checkpointGeneration: 7, controlRevision: "old-head", installedAt: 1000,
      manifestContentDigest: lowercaseHex64("8".repeat(64)), manifestObjectKey: "old-manifest", manifestTransportObjectId: "old-file", writerActorId: pin.writerId };
    stageRecords(engine, base, "before-successor", { libraryId: pin.libraryId, authorityEpoch: pin.epochId, sourceRevision: 7 });
    engine.activateNormalizedCheckpointStage({ stageId: "before-successor", replaceExisting: false, followerReceipt: receipt });
    database.exec({ sql: `INSERT INTO library_follower_actor_request (singleton_id, library_id, authority_epoch_id, actor_id, actor_public_key, enrollment_request_digest, canonical_enrollment_request, created_at)
      VALUES (1, ?1, ?2, ?3, ?4, ?5, ?6, 1);`, bind: [pin.libraryId, pin.epochId, consumerId, consumerPublicKey, originalRequest.requestDigest, new TextDecoder().decode(originalRequest.input.canonicalRequestBytes)] });
    const before = database.exec({ sql: "SELECT * FROM library_follower_actor_request;", rowMode: "array", returnValue: "resultRows" });
    // These opaque bytes exercise retention, not signature admission. The shared
    // certificate vector above supplies the independently verified authority proof.
    const bytes = new Uint8Array([123, 125]);
    const localRows = {
      library_intent_actors: { actor_id: consumerId, next_counter: 2,
        previous_operation_id: "offline-operation", previous_chain_digest: "6".repeat(64) },
      library_intent_transactions: { transaction_id: "offline-edit", transaction_digest: "5".repeat(64),
        actor_id: consumerId, intent_epoch: pin.epoch, intent_epoch_id: pin.epochId, member_count: 1,
        first_counter: 1, last_counter: 1, previous_operation_id: null, previous_chain_digest: "2".repeat(64),
        ending_operation_id: "offline-operation", ending_chain_digest: "6".repeat(64), canonical_member_bytes: 2,
        canonical_transaction: bytes, state: "pending", created_at: 3, published_at: null, resolved_at: null },
      library_intent_members: { transaction_id: "offline-edit", actor_id: consumerId, member_index: 0,
        operation_id: "offline-operation", actor_counter: 1, mutation_id: "feed_item_read_assignment",
        entity_type: "FeedItem", entity_id: "item-1", canonical_member: bytes, member_digest: "5".repeat(64) },
      library_optimistic_fields: { transaction_id: "offline-edit", member_index: 0, actor_id: consumerId,
        actor_counter: 1, entity_type: "FeedItem", entity_id: "item-1", field_path: "read_at",
        value_type: "integer", boolean_value: null, integer_value: 3, created_at: 3 },
    };
    for (const [table, row] of Object.entries(localRows)) {
      database.exec({ sql: `INSERT INTO ${table} (${Object.keys(row).join(",")})
        VALUES (${Object.keys(row).map(() => "?").join(",")});`, bind: Object.values(row) });
    }
    const snapshot = () => Object.fromEntries(Object.keys(localRows).map(table => [table,
      database.exec({ sql: `SELECT * FROM ${table};`, rowMode: "array", returnValue: "resultRows" })]));
    const oldEdits = snapshot();
    const nextEpoch = handoffVector.expected.epochId;
    const revision = Math.max(8, certificate.certificate_body.handoff_authorization.body.final_source_revision);
    const incoming = base.map(record => {
      if (record.registryKey === "00_checkpoint_header") return createLibraryCoreNormalizedCheckpointRecordV2({ ...record, payload: { ...record.payload, authorityEpoch: nextEpoch, sourceRevision: revision, checkpointId: `${pin.libraryId}:${nextEpoch}:${revision}` } });
      if (record.registryKey === "03_active_authority") return createLibraryCoreNormalizedCheckpointRecordV2({ ...record, payload: { ...record.payload, epochId: nextEpoch, writerId: "primary:desktop" } });
      if (record.registryKey === "90_actor_state" && record.primaryKey === targetId) return createLibraryCoreNormalizedCheckpointRecordV2({ ...record, payload: { ...record.payload, actorKind: "desktop", authorityEpochId: nextEpoch } });
      return record;
    });
    const oldEpoch = base.find(row => row.registryKey === "01_authority_epoch")!;
    incoming.push(createLibraryCoreNormalizedCheckpointRecordV2({ ...oldEpoch, primaryKey: nextEpoch, payload: { ...oldEpoch.payload,
      epochNumber: pin.epoch + 1, authorityPublicKey: handoffVector.expected.authorityPublicKey,
      authorityKeyId: handoffVector.expected.authorityKeyId, transitionCertificateDigest: handoffVector.expected.certificateDigest,
      canonicalTransitionCertificate: handoffVector.canonicalCertificate,
    } }));
    incoming.push(createLibraryCoreNormalizedCheckpointRecordV2({ registryKey: "02_authority_frontier", primaryKey: [nextEpoch, 0], payload: {
      actorId: pin.writerId, acceptedCounter: 2, acceptedOperationId: "operation-2", acceptedChainDigest: "3".repeat(64),
    } }));
    stageRecords(engine, incoming, "direct-successor", { libraryId: pin.libraryId, authorityEpoch: nextEpoch, sourceRevision: revision });
    const activation = { stageId: "direct-successor", replaceExisting: true, followerReceipt: { ...receipt, checkpointGeneration: 0, writerActorId: targetId } };
    // Actual successor importer/proof, with synthetic derived catalog and old
    // intent bytes. This proves preservation, not old signature admission.
    const preferenceSuccessorFile="/preference-successor-checkpoint.sqlite";
    sqlite3.capi.sqlite3_js_posix_create_file(preferenceSuccessorFile,sqlite3.capi.sqlite3_js_db_export(database.pointer!));
    const preferenceDb=new sqlite3.oo1.DB(preferenceSuccessorFile,"w");
    try {
      preferenceDb.exec("PRAGMA foreign_keys=ON; PRAGMA synchronous=FULL;");
      preferenceDb.transaction("IMMEDIATE",()=>migratePwaLibraryRecoverySchema(preferenceDb,sqlite3.capi));
      preferenceDb.exec(LIBRARY_CORE_PENDING_PREFERENCE_SCHEMA_SQL);
      preferenceDb.exec({sql:"UPDATE library_storage_meta SET schema_version=3,schema_sha256=?1;",bind:[LIBRARY_CORE_PENDING_PREFERENCE_SCHEMA_SHA256]});
      preferenceDb.exec(`PRAGMA user_version=3;
        INSERT INTO library_local_preference_projection SELECT 1,actor_id,next_counter-1,next_counter-1,previous_operation_id,previous_chain_digest FROM library_intent_actors;
        INSERT INTO library_local_preference_nodes(transaction_id,member_index,actor_id,actor_counter,path,node_kind,value_type,boolean_value,updated_at)
          SELECT transaction_id,member_index,actor_id,actor_counter,'$.display.showEngagementCounts','value','boolean',0,1 FROM library_intent_members;`);
      const successorEngine=new PwaLibraryCoreSqliteEngine(preferenceDb,sqlite3.version.libVersion,{capi:sqlite3.capi});
      const derived=()=>["library_local_preference_projection","library_local_preference_nodes"].map(table=>
        preferenceDb.exec({sql:`SELECT * FROM ${table};`,rowMode:"array",returnValue:"resultRows"}));
      const retainedDerived=derived();
      preferenceDb.exec(`CREATE TEMP TRIGGER restore_successor_preferences BEFORE INSERT ON library_local_preference_nodes
        BEGIN SELECT RAISE(ABORT,'successor preferences restore fault'); END;`);
      await expect(replacePwaProjectedSuccessorCheckpoint(preferenceDb,successorEngine,activation)).rejects.toThrow("successor preferences restore fault");
      expect(preferenceDb.selectValue("SELECT authority_epoch FROM library_meta;")).toBe(pin.epochId);
      expect(derived()).toEqual(retainedDerived);
      expect(preferenceDb.selectValue("SELECT count(*) FROM sqlite_schema WHERE name LIKE 'checkpoint_retained_%';")).toBe(0);
      preferenceDb.exec("DROP TRIGGER restore_successor_preferences;");
      expect((await replacePwaProjectedSuccessorCheckpoint(preferenceDb,successorEngine,activation)).authorityEpoch).toBe(nextEpoch);
      expect(derived()).toEqual(retainedDerived);
      expect(preferenceDb.selectValue("SELECT canonical_member FROM library_intent_members;")).toEqual(bytes);
      expect(()=>successorEngine.followerMutationContext()).toThrow("unavailable");
      expect(preferenceDb.selectValue("SELECT count(*) FROM sqlite_schema WHERE name LIKE 'checkpoint_retained_%';")).toBe(0);
      const continuation={...activation,stageId:"projected-successor-continuation",
        followerReceipt:{...activation.followerReceipt,checkpointGeneration:1}};
      stageRecords(successorEngine,incoming,continuation.stageId,{libraryId:pin.libraryId,authorityEpoch:nextEpoch,sourceRevision:revision});
      await replacePwaProjectedSuccessorCheckpoint(preferenceDb,successorEngine,continuation);
      expect(derived()).toEqual(retainedDerived);
      expect(preferenceDb.selectValue("SELECT checkpoint_generation FROM library_follower_checkpoint_receipt;")).toBe(1);
      expect(()=>successorEngine.followerMutationContext()).toThrow("unavailable");
    } finally {preferenceDb.close();}
    expect(() => engine.activateNormalizedCheckpointStage(activation)).toThrow(/verified proof/);
    // An offline consumer may have missed the target's predecessor enrollment.
    // A valid signed successor does not authorize skipping that local proof.
    database.exec("SAVEPOINT missing_successor_target;");
    database.exec({sql:"DELETE FROM library_actors WHERE actor_id=?1;",bind:[targetId]});
    await expect(engine.verifyNormalizedCheckpointSuccessor(activation))
      .rejects.toThrow("successor target is not enrolled in the accepted predecessor");
    expect(database.selectValue("SELECT authority_epoch FROM library_meta;")).toBe(pin.epochId);
    expect(snapshot()).toEqual(oldEdits);
    // This retention fixture starts beyond the vector's final source revision.
    // A read plan must refuse regression, even with a valid predecessor signature.
    await expect(preparePwaPredecessorCheckpointRead(database, activation.stageId, crypto.subtle))
      .rejects.toThrow("does not cover the selected source");
    database.exec({sql:"UPDATE library_meta SET source_revision=?1;",
      bind:[certificate.certificate_body.handoff_authorization.body.final_source_revision]});
    const readProof = await preparePwaPredecessorCheckpointRead(database, activation.stageId, crypto.subtle);
    expect(readProof?.pointer).toEqual(certificate.certificate_body.handoff_authorization.body.source_control);
    requirePwaPredecessorCheckpointRead(database, activation.stageId, readProof!);
    expect(() => requirePwaPredecessorCheckpointRead(database, activation.stageId, { ...readProof! })).toThrow("current verified binding");
    await expect(engine.verifyNormalizedCheckpointSuccessor(activation)).rejects.toThrow("not enrolled");
    const readRace = preparePwaPredecessorCheckpointRead(database, activation.stageId, crypto.subtle);
    database.exec("UPDATE library_meta SET source_revision=source_revision+1;");
    await expect(readRace).rejects.toThrow("changed during verification");
    expect(() => requirePwaPredecessorCheckpointRead(database, activation.stageId, readProof!)).toThrow("current verified binding");
    database.exec("ROLLBACK TO missing_successor_target; RELEASE missing_successor_target;");
    expect(await preparePwaPredecessorCheckpointRead(database, activation.stageId, crypto.subtle)).toBeNull();
    database.exec("SAVEPOINT retired_successor_target;");
    database.exec({sql:"UPDATE library_actors SET retired_at=1 WHERE actor_id=?1;",bind:[targetId]});
    await expect(preparePwaPredecessorCheckpointRead(database, activation.stageId, crypto.subtle))
      .rejects.toThrow("cannot replace a retired or conflicting target");
    database.exec("ROLLBACK TO retired_successor_target; RELEASE retired_successor_target;");
    expect(() => requirePwaPredecessorCheckpointRead(database, activation.stageId, readProof!)).toThrow("current verified binding");
    const pendingProof = engine.verifyNormalizedCheckpointSuccessor(activation);
    database.exec({ sql: "UPDATE library_actors SET public_key = ?1 WHERE actor_id = ?2;", bind: ["7".repeat(64), targetId] });
    await expect(pendingProof).rejects.toThrow(/changed during verification/);
    database.exec({ sql: "UPDATE library_actors SET public_key = ?1 WHERE actor_id = ?2;", bind: [handoffVector.enrolledActorPublicKey, targetId] });
    await engine.verifyNormalizedCheckpointSuccessor(activation);
    expect(() => engine.activateNormalizedCheckpointStage({ ...activation, followerReceipt: { ...activation.followerReceipt, writerActorId: pin.writerId } })).toThrow(/verified proof/);
    database.exec({ sql: "UPDATE library_actors SET public_key = ?1 WHERE actor_id = ?2;", bind: ["7".repeat(64), targetId] });
    expect(() => engine.activateNormalizedCheckpointStage(activation)).toThrow(/verified proof/);
    database.exec({ sql: "UPDATE library_actors SET public_key = ?1 WHERE actor_id = ?2;", bind: [handoffVector.enrolledActorPublicKey, targetId] });
    await engine.verifyNormalizedCheckpointSuccessor(activation);
    database.exec("CREATE TEMP TRIGGER fail_successor_receipt BEFORE INSERT ON library_follower_checkpoint_receipt BEGIN SELECT RAISE(ABORT, 'successor receipt fault'); END;");
    expect(() => engine.activateNormalizedCheckpointStage(activation)).toThrow(/successor receipt fault/);
    expect(database.exec({ sql: "SELECT authority_epoch FROM library_meta;", rowMode: 0, returnValue: "resultRows" })).toEqual([pin.epochId]);
    expect(database.exec({ sql: "SELECT * FROM library_follower_actor_request;", rowMode: "array", returnValue: "resultRows" })).toEqual(before);
    expect(snapshot()).toEqual(oldEdits);
    database.exec("DROP TRIGGER fail_successor_receipt;");
    expect(engine.activateNormalizedCheckpointStage(activation).authorityEpoch).toBe(nextEpoch);
    expect(snapshot()).toEqual(oldEdits);
    expect(() => engine.followerMutationContext()).toThrow(/context is unavailable/);
    expect(database.exec({ sql: "SELECT * FROM library_follower_actor_request;", rowMode: "array", returnValue: "resultRows" })).toEqual(before);
    const plan = engine.consumerRecoveryPlan();
    const archiveId = plan.recoveryId;
    const prepared = await consumerRequest(nextEpoch, pin.epoch + 1, handoffVector.expected.authorityKeyId, archiveId, 1000, plan.authority.observed_frontier);
    await engine.prepareConsumerRecovery(archiveId, prepared.input);
    expect(engine.consumerRecoveryStatus()).toMatchObject({ state: "prepared", plan: { preparedRequest: prepared.input } });
    const recoveryRows = () => database.exec({ sql: "SELECT * FROM library_local_recovery_rows ORDER BY table_key, row_ordinal;", rowMode: "array", returnValue: "resultRows" });
    const archived = recoveryRows();
    // A later checkpoint in the accepted successor must not force recovery first.
    const refreshedRevision = revision + 1;
    const refreshedIncoming = incoming.map(record => record.registryKey === "00_checkpoint_header"
      ? createLibraryCoreNormalizedCheckpointRecordV2({ ...record, payload: { ...record.payload,
        sourceRevision: refreshedRevision, checkpointId: `${pin.libraryId}:${nextEpoch}:${refreshedRevision}` } }) : record);
    const refresh = { ...activation, stageId: "pending-recovery-refresh", followerReceipt: { ...activation.followerReceipt, checkpointGeneration: 1 } };
    stageRecords(engine, refreshedIncoming, refresh.stageId, { libraryId: pin.libraryId, authorityEpoch: nextEpoch, sourceRevision: refreshedRevision });
    expect(() => engine.activateNormalizedCheckpointStage(refresh)).toThrow(/current verified proof/);
    await engine.verifyNormalizedCheckpointSuccessor(refresh);
    database.exec("UPDATE library_follower_actor_request SET created_at = 2;");
    expect(() => engine.activateNormalizedCheckpointStage(refresh)).toThrow(/current verified proof/);
    database.exec("UPDATE library_follower_actor_request SET created_at = 1;");
    await engine.verifyNormalizedCheckpointSuccessor(refresh);
    database.exec("CREATE TEMP TRIGGER fail_continuation BEFORE INSERT ON library_follower_checkpoint_receipt BEGIN SELECT RAISE(ABORT, 'continuation receipt fault'); END;");
    expect(() => engine.activateNormalizedCheckpointStage(refresh)).toThrow(/continuation receipt fault/);
    expect(snapshot()).toEqual(oldEdits);
    expect(database.selectValue("SELECT checkpoint_generation FROM library_follower_checkpoint_receipt;")).toBe(0);
    database.exec("DROP TRIGGER fail_continuation;");
    expect(engine.activateNormalizedCheckpointStage(refresh).authorityEpoch).toBe(nextEpoch);
    expect(snapshot()).toEqual(oldEdits);
    expect(database.exec({ sql: "SELECT * FROM library_follower_actor_request;", rowMode: "array", returnValue: "resultRows" })).toEqual(before);
    expect(() => engine.followerMutationContext()).toThrow(/context is unavailable/);
    const regressed = { ...refresh, stageId: "regressed-recovery-refresh", followerReceipt: { ...refresh.followerReceipt, checkpointGeneration: 0 } };
    stageRecords(engine, refreshedIncoming, regressed.stageId, { libraryId: pin.libraryId, authorityEpoch: nextEpoch, sourceRevision: refreshedRevision });
    await engine.verifyNormalizedCheckpointSuccessor(regressed);
    expect(() => engine.activateNormalizedCheckpointStage(regressed)).toThrow(/regress local history/);
    expect(snapshot()).toEqual(oldEdits);
    expect(database.selectValue("SELECT checkpoint_generation FROM library_follower_checkpoint_receipt;")).toBe(1);
    database.transaction("IMMEDIATE", () => verifyPwaRecoveryArchive(database, sqlite3.capi, archiveId, true));
    const corruptHistory = refreshedIncoming.map(record => record.registryKey === "01_authority_epoch" && record.primaryKey === pin.epochId
      ? createLibraryCoreNormalizedCheckpointRecordV2({ ...record, payload: { ...record.payload, transitionCertificateDigest: "f".repeat(64) } }) : record);
    const changedHistory = { ...refresh, stageId: "changed-historical-authority" };
    stageRecords(engine, corruptHistory, changedHistory.stageId, { libraryId: pin.libraryId, authorityEpoch: nextEpoch, sourceRevision: refreshedRevision });
    await engine.verifyNormalizedCheckpointSuccessor(changedHistory);
    expect(() => engine.activateNormalizedCheckpointStage(changedHistory)).toThrow(/changed the accepted authority/);
    database.transaction("IMMEDIATE", () => verifyPwaRecoveryArchive(database, sqlite3.capi, archiveId, true));
    // Resume the exact preparation after actual checkpoint activation, then prove
    // commit retry does not allocate another actor or rewrite archived bytes.
    expect(engine.consumerRecoveryStatus()).toMatchObject({ state: "prepared", plan: { preparedRequest: prepared.input } });
    expect(recoveryRows()).toEqual(archived);
    const resumed = new PwaLibraryCoreSqliteEngine(database, sqlite3.version.libVersion, { capi: sqlite3.capi });
    resumed.initialize();
    const projectedRecoveryFile="/projected-successor-recovery.sqlite";
    sqlite3.capi.sqlite3_js_posix_create_file(projectedRecoveryFile,sqlite3.capi.sqlite3_js_db_export(database.pointer!));
    await resumed.commitConsumerRecovery(archiveId, 1001);
    expect(resumed.consumerRecoveryStatus()).toMatchObject({ state: "following", plan: { recoveryId: archiveId } });
    expect(resumed.followerActorEnrollmentContext().request?.actorId).toBe(prepared.actorId);
    // Storing the new request still requires the Primary's enrollment response.
    expect(() => resumed.followerMutationContext()).toThrow(/context is unavailable/);
    expect(database.selectValue("SELECT count(*) FROM library_intent_transactions;")).toBe(0);
    expect(recoveryRows()).toEqual(archived);
    const changes = database.changes(true);
    await resumed.commitConsumerRecovery(archiveId, 1002);
    expect(database.changes(true)).toBe(changes);
    database.transaction("IMMEDIATE", () => verifyPwaRecoveryArchive(database, sqlite3.capi, archiveId, false));
    // This public test seed is the native handoff vector's successor authority.
    // Matching its public key prevents this fixture from silently signing for a
    // different authority when the native vector changes.
    const successorKey = createPrivateKey({ format: "der", type: "pkcs8", key: Buffer.concat([
      Buffer.from("302e020100300506032b657004220420", "hex"), Buffer.alloc(32, 99),
    ]) });
    expect(createPublicKey(successorKey).export({ format: "der", type: "spki" }).subarray(-32).toString("hex")).toBe(handoffVector.expected.authorityPublicKey);
    const capability = await constructLibraryCoreActorCapabilityCertificateV2(prepared.enrollment, {
      actor_class: "editor", allowed_operation_types: LIBRARY_CORE_PRIMARY_WRITER_OPERATION_TYPES_V2,
      allowed_query_ids: [], scope: { mode: "library_wide" },
    }, { digest: coreDigest,
      signActorProof: async message => sign(null, message, consumerKey.privateKey).toString("hex"),
      signAuthorityCertificate: async message => sign(null, message, successorKey).toString("hex"),
    });
    const enrollmentInput = {
      canonicalCertificateBytes: encodeLibraryCoreCanonicalValue(capability.certificate as unknown as LibraryCoreCanonicalValue),
      enrolledAt: 1100,
    };
    const recoveredPreferenceEnvelopes: Uint8Array[]=[];
    const projectedDb=new sqlite3.oo1.DB(projectedRecoveryFile,"w");
    try {
      projectedDb.exec("PRAGMA foreign_keys=ON; PRAGMA synchronous=FULL;");
      // Synthetic old derived state; handoff and successor enrollment signatures
      // are real. Production schema migration through handoff remains separate.
      projectedDb.exec(LIBRARY_CORE_PENDING_PREFERENCE_SCHEMA_SQL);
      projectedDb.exec({sql:"UPDATE library_storage_meta SET schema_version=3,schema_sha256=?1;",bind:[LIBRARY_CORE_PENDING_PREFERENCE_SCHEMA_SHA256]});
      projectedDb.exec(`PRAGMA user_version=3;
        INSERT INTO library_local_preference_projection
          SELECT 1,actor_id,next_counter-1,next_counter-1,previous_operation_id,previous_chain_digest FROM library_intent_actors;
        INSERT INTO library_local_preference_nodes
          (transaction_id,member_index,actor_id,actor_counter,path,node_kind,value_type,boolean_value,updated_at)
          SELECT transaction_id,member_index,actor_id,actor_counter,'$.display.showEngagementCounts','value','boolean',0,1 FROM library_intent_members;
        CREATE TEMP TRIGGER projected_recovery_fault AFTER INSERT ON library_local_invalidations
          WHEN NEW.topic='preferences' BEGIN SELECT RAISE(ABORT,'projected recovery fault'); END;`);
      const projectedEngine=new PwaLibraryCoreSqliteEngine(projectedDb,sqlite3.version.libVersion,{capi:sqlite3.capi});
      const archiveRows=()=>projectedDb.exec({sql:"SELECT table_key,row_ordinal,hex(canonical_row) FROM library_local_recovery_rows ORDER BY table_key,row_ordinal;",rowMode:"array",returnValue:"resultRows"});
      const originalArchive=archiveRows();
      // Rebuild preparation through schema3 admission after the verified
      // successor checkpoint. Derived rows remain local and outside the archive.
      projectedDb.exec(`DELETE FROM library_local_handoff; DELETE FROM library_local_recovery_rows; DELETE FROM library_local_recovery_archives;
        CREATE TEMP TRIGGER projected_archive_fault BEFORE INSERT ON library_local_recovery_rows
        BEGIN SELECT RAISE(ABORT,'projected archive fault'); END;`);
      await expect(preparePwaProjectedConsumerRecovery(projectedDb,sqlite3.capi,projectedEngine,archiveId,prepared.input))
        .rejects.toThrow("projected archive fault");
      expect(projectedDb.selectValue("SELECT count(*) FROM library_local_handoff;")).toBe(0);
      expect(projectedDb.selectValue("SELECT count(*) FROM library_local_recovery_archives;")).toBe(0);
      expect(projectedDb.selectValue("SELECT count(*) FROM library_local_preference_nodes;")).toBe(1);
      projectedDb.exec("DROP TRIGGER projected_archive_fault;");
      await preparePwaProjectedConsumerRecovery(projectedDb,sqlite3.capi,projectedEngine,archiveId,prepared.input);
      expect(archiveRows()).toEqual(originalArchive);
      expect(projectedDb.selectValue("SELECT count(*) FROM library_local_preference_nodes;")).toBe(1);
      const preparedChanges=projectedDb.changes(true);
      await preparePwaProjectedConsumerRecovery(projectedDb,sqlite3.capi,projectedEngine,archiveId,prepared.input);
      expect(projectedDb.changes(true)).toBe(preparedChanges);
      expect(archiveRows()).toEqual(originalArchive);
      expect(()=>projectedDb.transaction("IMMEDIATE",()=>verifyPwaRecoveryArchive(projectedDb,sqlite3.capi,archiveId,true)))
        .toThrow("identity is unsupported");
      const witness=projectedDb.selectValue("SELECT reenrollment_installation_witness FROM library_local_recovery_archives;");
      const racingCommit=commitPwaProjectedConsumerRecovery(projectedDb,sqlite3.capi,projectedEngine,archiveId,1001);
      projectedDb.exec({sql:"UPDATE library_local_recovery_archives SET reenrollment_installation_witness=?1;",bind:["ee".repeat(32)]});
      await expect(racingCommit).rejects.toThrow("changed before commit");
      projectedDb.exec({sql:"UPDATE library_local_recovery_archives SET reenrollment_installation_witness=?1;",bind:[witness!]});
      expect(archiveRows()).toEqual(originalArchive);
      const beforeSequence=Number(projectedDb.selectValue("SELECT sequence FROM library_local_change_state;"));
      await expect(commitPwaProjectedConsumerRecovery(projectedDb,sqlite3.capi,projectedEngine,archiveId,1001))
        .rejects.toThrow("projected recovery fault");
      expect(projectedDb.selectValue("SELECT count(*) FROM library_local_preference_nodes;")).toBe(1);
      expect(projectedDb.selectValue("SELECT count(*) FROM library_local_preference_projection;")).toBe(1);
      expect(projectedDb.selectValue("SELECT sequence FROM library_local_change_state;")).toBe(beforeSequence);
      expect(projectedDb.selectValue("SELECT reenrollment_committed_at FROM library_local_recovery_archives;")).toBeNull();
      projectedDb.exec("DROP TRIGGER projected_recovery_fault;");
      await commitPwaProjectedConsumerRecovery(projectedDb,sqlite3.capi,projectedEngine,archiveId,1001);
      expect(projectedDb.selectValue("SELECT count(*) FROM library_local_preference_nodes;")).toBe(0);
      expect(projectedDb.selectValue("SELECT count(*) FROM library_local_preference_projection;")).toBe(0);
      expect(()=>projectedEngine.followerMutationContext()).toThrow("unavailable");
      const afterSequence=projectedDb.selectValue("SELECT sequence FROM library_local_change_state;");
      expect(Number(afterSequence)).toBeGreaterThan(beforeSequence);
      await commitPwaProjectedConsumerRecovery(projectedDb,sqlite3.capi,projectedEngine,archiveId,1002);
      expect(projectedDb.selectValue("SELECT sequence FROM library_local_change_state;")).toBe(afterSequence);
      await installPwaProjectedFollowerEnrollment(projectedDb,sqlite3.capi,projectedEngine,enrollmentInput);
      const tip=projectedEngine.followerMutationContext();
      const member=PREFERENCES_LEAF_ASSIGNMENT_TRANSACTION_MEMBER_SCHEMA.construct({
        actor_id:tip.actor_id,actor_sequence:tip.next_actor_sequence,causal_frontier:tip.observed_frontier,created_at_ms:1200,
        entity_id:"preferences",epoch:tip.epoch,epoch_id:tip.epoch_id,hlc_counter:0,hlc_wall_ms:1200,
        library_id:tip.library_id,operation_id:"recovered-preference",previous_actor_operation_id:tip.previous_actor_operation_id,
        transaction_id:"recovered-preference-transaction",transaction_member_count:1,transaction_member_index:0,
        payload:{updates:{display:{showEngagementCounts:false}}},
      },{digest:coreDigest});
      const finalized=await finalizeLibraryCoreTransactionV1(assembleLibraryCoreTransactionV1([member],tip.previous_actor_chain_digest,{digest:coreDigest}),{
        digest:coreDigest,async signOperation(message){return sign(null,message,consumerKey.privateKey).toString("hex");},
      });
      const edit={envelopeBytes:[encodeLibraryCoreCanonicalValue(finalized.members[0]!.envelope as unknown as LibraryCoreCanonicalValue)]};
      recoveredPreferenceEnvelopes.push(Uint8Array.from(edit.envelopeBytes[0]!));
      await enqueuePwaProjectedFollowerIntent(projectedDb,projectedEngine,edit,sqlite3.capi);
      const newTip=projectedEngine.followerMutationContext(),newSequence=projectedDb.selectValue("SELECT sequence FROM library_local_change_state;");
      await commitPwaProjectedConsumerRecovery(projectedDb,sqlite3.capi,projectedEngine,archiveId,1201);
      expect(projectedEngine.followerMutationContext()).toEqual(newTip);
      expect(projectedDb.selectValue("SELECT sequence FROM library_local_change_state;")).toBe(newSequence);
      expect(projectedDb.selectValue("SELECT count(*) FROM library_local_preference_nodes;")).toBe(2);
      expect(archiveRows()).toEqual(originalArchive);
    } finally {projectedDb.close();}
    const installed = await resumed.installFollowerActorEnrollment(enrollmentInput);
    const enrolledChanges = database.changes(true);
    expect(await resumed.installFollowerActorEnrollment(enrollmentInput)).toEqual(installed);
    expect(database.changes(true)).toBe(enrolledChanges);
    expect(resumed.followerMutationContext()).toMatchObject({
      actor_id: prepared.actorId, actor_public_key: consumerPublicKey, epoch_id: nextEpoch,
      next_actor_sequence: 1, previous_actor_operation_id: null, previous_actor_chain_digest: capability.actor_chain_genesis,
    });
    expect(resumed.followerTransportContext()).toMatchObject({ actorId: prepared.actorId,
      storageEpochId: nextEpoch, nextIntentActorCounter: 1, nextResultSequence: 1,
      previousIntentSegmentDigest: null, previousResultSegmentDigest: null });
    expect(resumed.pageFollowerTransport({ actorId: lowercaseHex64(consumerId), firstActorCounter: 1, limit: 128, schemaVersion: 2 })).toMatchObject({ canonicalEnvelopes: [], lastActorCounter: null, done: true });
    expect(recoveryRows()).toEqual(archived);
    // Execute the actual schema2 migration after real successor enrollment,
    // with an authentic offline preference envelope pending in ordinary storage.
    expect(recoveredPreferenceEnvelopes).toHaveLength(1);
    await resumed.commitFollowerIntent({envelopeBytes:recoveredPreferenceEnvelopes});
    const migrationTip=resumed.followerMutationContext();
    database.exec(`CREATE TEMP TRIGGER recovered_preference_migration_fault BEFORE UPDATE OF schema_version ON library_storage_meta
      WHEN NEW.schema_version=3 BEGIN SELECT RAISE(ABORT,'recovered preference migration fault'); END;`);
    expect(()=>database.transaction("IMMEDIATE",()=>migratePwaPendingPreferenceProjection(database,sqlite3.capi,resumed)))
      .toThrow("recovered preference migration fault");
    expect(database.selectValue("PRAGMA user_version;")).toBe(2);
    expect(database.selectValue("SELECT count(*) FROM sqlite_schema WHERE name='library_local_preference_projection';")).toBe(0);
    expect(resumed.followerMutationContext()).toEqual(migrationTip);
    database.exec("DROP TRIGGER recovered_preference_migration_fault;");
    database.transaction("IMMEDIATE",()=>migratePwaPendingPreferenceProjection(database,sqlite3.capi,resumed));
    expect(await backfillPwaPendingPreferenceProjection(database,resumed)).toBe(true);
    expect(database.selectValue("SELECT count(*) FROM library_local_preference_nodes;")).toBe(2);
    expect(resumed.followerMutationContext()).toEqual(migrationTip);
    expect(database.selectValue("SELECT canonical_member FROM library_intent_members;")).toEqual(recoveredPreferenceEnvelopes[0]);
    expect(recoveryRows()).toEqual(archived);
    database.transaction("IMMEDIATE",()=>migratePwaPendingPreferenceProjection(database,sqlite3.capi,resumed));
    expect(await backfillPwaPendingPreferenceProjection(database,resumed)).toBe(true);
    expect(resumed.followerMutationContext()).toEqual(migrationTip);
    const vectorStart=preferenceValueVector.setupSql.indexOf("INSERT INTO library_preferences");
    expect(vectorStart).toBeGreaterThan(0);
    database.exec(preferenceValueVector.setupSql.slice(vectorStart));
    const visibleSource=readPwaVisiblePreferenceSource(database,resumed);
    const visibleScope=readPwaVisiblePreferenceScope(database,resumed,
      preferenceValueVector.cases.map(entry=>entry.path),visibleSource);
    expect(visibleScope).toEqual({source:visibleSource,results:preferenceValueVector.cases.map(entry=>({
      path:entry.path,kind:entry.kind,rows:entry.expectedRows,source:visibleSource,
    }))});
  });

  // Tier 1: authentic history requires an authority receipt before materialization;
  // fresh policy is not retroactively applied to the signed preference bytes.
  it("imports historical preferences only with the exact signed acceptance receipt", async () => {
    const libraryId = "11".repeat(32), epochId = "22".repeat(32), actorId = "33".repeat(32);
    const chainGenesis = "44".repeat(32), authorityKeyId = "55".repeat(32);
    const actorKeys = generateKeyPairSync("ed25519"), authorityKeys = generateKeyPairSync("ed25519");
    const publicKey = (keys: typeof actorKeys) => keys.publicKey.export({ format: "der", type: "spki" }).subarray(-32).toString("hex");
    const engine = new PwaLibraryCoreSqliteEngine(database, sqlite3.version.libVersion);
    engine.initialize();
    database.exec({ sql: "INSERT INTO library_meta VALUES (1,?1,1,?2,0,1);", bind: [libraryId, epochId] });
    database.exec({ sql: "INSERT INTO library_materialization_generation VALUES (1,?1);", bind: ["99".repeat(32)] });
    database.exec({ sql: `INSERT INTO library_authority_epochs
      (epoch_id,library_id,epoch_number,authority_key_id,authority_public_key,transition_certificate_digest,
       canonical_transition_certificate,accepted_manifest_generation,checkpoint_frontier_digest,materialized_state_digest,accepted_at)
      VALUES (?1,?2,1,?3,?4,?5,'{}',1,?6,?7,1);`,
      bind: [epochId, libraryId, authorityKeyId, publicKey(authorityKeys), "77".repeat(32), "88".repeat(32), "aa".repeat(32)] });
    database.exec({ sql: "INSERT INTO library_active_authority VALUES ('active',?1,?2,?3,1,1);", bind: [libraryId, epochId, actorId] });
    database.exec({ sql: `INSERT INTO library_actors
      (actor_id,authority_epoch_id,actor_kind,public_key,enrollment_operation_id,enrollment_certificate_digest,
       canonical_enrollment_certificate,chain_genesis_digest,accepted_counter,accepted_operation_id,accepted_chain_digest,retired_at,created_at,updated_at)
      VALUES (?1,?2,'desktop',?3,'enroll-history',?4,'{}',?5,0,NULL,?5,NULL,1,1);`,
      bind: [actorId, epochId, publicKey(actorKeys), "bb".repeat(32), chainGenesis] });
    const input = { actor_id: actorId, actor_sequence: 1, causal_frontier: [], created_at_ms: 2000,
      entity_id: "preferences", epoch: 1, epoch_id: epochId, hlc_counter: 0, hlc_wall_ms: 2000, library_id: libraryId,
      operation_id: "historical:preferences", payload: { updates: { display: { markReadOnScroll: false } } },
      previous_actor_operation_id: null, transaction_id: "historical:transaction", transaction_member_count: 1, transaction_member_index: 0 };
    expect(() => PREFERENCES_LEAF_ASSIGNMENT_TRANSACTION_MEMBER_SCHEMA.construct(input, { digest: coreDigest })).toThrow("unsupported fields");
    const assembled = assembleLibraryCoreHistoricalPreferencesV1([
      constructLibraryCoreHistoricalPreferencesMemberV1(input, { digest: coreDigest }),
    ], chainGenesis, { digest: coreDigest });
    const envelope = { ...assembled.members[0]!.signing_body, signature: sign(null,
      encodeLibraryCoreOperationSignatureInput({ operation_signing_body_digest: assembled.members[0]!.signing_body_digest }), actorKeys.privateKey).toString("hex") };
    const canonical = (value: unknown) => encodeLibraryCoreCanonicalValue(value as LibraryCoreCanonicalValue);
    const envelopeDigest = coreDigest("operation-envelope", envelope as unknown as LibraryCoreCanonicalValue);
    const result = (receiptId: string, corruptSignature = false) => {
      const unsigned = parseLibraryCoreFollowerResultEnvelopeV1({ actor_id: actorId, authoritative_source_revision: 1,
        authority_key_id: authorityKeyId, canonical_operation_ids: [input.operation_id], epoch: 1, epoch_id: epochId,
        format: "freed_follower_result_v1", intent_epoch: 1, intent_epoch_id: epochId, library_id: libraryId,
        original_result_digest: null, previous_result_digest: null, receipt_ids: [receiptId], rejection_reason: null,
        replacement_fields: [], resolved_at_ms: 3000, result_body_digest: "0".repeat(64), result_sequence: 1, schema_version: 1,
        signature: "0".repeat(128), signature_algorithm: "ed25519", status: "accepted", transaction_digest: assembled.transaction_digest,
        transaction_id: input.transaction_id });
      const digest = coreDigest("follower-result-body", libraryCoreFollowerResultBodyV1(unsigned));
      return { digest, bytes: canonical({ ...unsigned, result_body_digest: digest, signature: corruptSignature ? "00".repeat(64) : sign(null,
        encodeLibraryCoreSignatureInput("follower-result-envelope", { result_body_digest: digest }), authorityKeys.privateKey).toString("hex") }) };
    };
    const snapshot = parseLibraryCoreNormalizedOperationExportDescriptorV2({ authorityEpoch: epochId, firstAvailableRevision: 1,
      format: "freed_normalized_operation_export_v2", libraryId, operationCount: 1, protocolVersion: 2, sourceRevision: 1, transactionCount: 1, writerId: actorId });
    const importResult = (accepted: ReturnType<typeof result>) => {
      const records = [{ bytes: accepted.bytes, digest: accepted.digest, kind: "accepted_transaction", index: -1 },
        { bytes: canonical(envelope), digest: envelopeDigest, kind: "operation", index: 0 }].map(value => ({
          canonicalRecordJson: new TextDecoder().decode(value.bytes), kind: value.kind, memberIndex: value.index,
          recordDigest: value.digest, sourceRevision: 1, transactionDigest: assembled.transaction_digest, transactionId: input.transaction_id }));
      return engine.importNormalizedOperationPage({ snapshot, receivedAt: 4000, page: parseLibraryCoreNormalizedOperationExportPageV2({
        canonicalRecordBytes: records.reduce((sum, value) => sum + new TextEncoder().encode(value.canonicalRecordJson).length, 0),
        done: true, nextCursor: { kind: "operation", memberIndex: 0, recordDigest: envelopeDigest, sourceRevision: 1 }, records }) });
    };
    for (const invalid of [result("00".repeat(32)), result(envelopeDigest, true)]) {
      try {
        await expect(importResult(invalid)).rejects.toThrow(/signature|proof changed/);
        expect(database.selectValue("SELECT count(*) FROM library_preferences;")).toBe(0);
        expect(database.selectValue("SELECT accepted_counter FROM library_actors;")).toBe(0);
        expect(database.selectValue("SELECT source_revision FROM library_meta;")).toBe(0);
      } finally { database.exec("DELETE FROM library_operation_replication_stage_members; DELETE FROM library_operation_replication_stages;"); }
    }
    const accepted = result(envelopeDigest);
    await expect(importResult(accepted)).resolves.toMatchObject({ appliedThroughRevision: 1, appliedTransactionCount: 1 });
    await importResult(accepted);
    expect(database.exec({ sql: "SELECT path,value_type,boolean_value FROM library_preferences ORDER BY path;", rowMode: "array", returnValue: "resultRows" }))
      .toContainEqual(['v:$.display.markReadOnScroll', "boolean", 0]);
    expect(database.selectValue("SELECT accepted_counter FROM library_actors;")).toBe(1);
    expect(database.selectValue("SELECT count(*) FROM library_operations;")).toBe(1);
    expect(database.selectValue("SELECT canonical_envelope FROM library_operations;")).toEqual(canonical(envelope));
  });

  // Tier 1: these immutable bytes were accepted and exported by published native
  // source v26.9.1700-dev, before fresh preference policy became stricter.
  it.each([false, true])("imports native historical preference bytes at the exact frontier (persistent audit storage: %s)", async (persistentAuditTemporaryStorage) => {
    const fixture = historicalNativePreferences;
    const bytes = (value: string) => new TextEncoder().encode(value);
    let engine = new PwaLibraryCoreSqliteEngine(database, sqlite3.version.libVersion, { capi: sqlite3.capi, persistentAuditTemporaryStorage });
    engine.initialize();
    const baseline = fixture.baselineRecords.map(parseLibraryCoreNormalizedCheckpointRecordV2);
    expect(digestLibraryCoreNormalizedCheckpointRecordsV2(baseline)).toBe(fixture.baselineCheckpointDigest);
    stageRecords(engine, baseline, "published-native-preferences", fixture.baseline);
    engine.activateNormalizedCheckpointStage({ stageId: "published-native-preferences", replaceExisting: false,
      followerReceipt: { checkpointGeneration: 0, controlRevision: "synthetic-native-history", installedAt: 2100,
        manifestContentDigest: lowercaseHex64("8".repeat(64)), manifestObjectKey: "fixture", manifestTransportObjectId: "fixture",
        writerActorId: fixture.baseline.writerId } });
    // Current frontier semantics exclude enrollment without accepted work.
    // Preserve the published descriptor and authenticate the same checkpoint rows.
    expect(fixture.sourceCommit).toBe("17743c0e074b2b8ca27ff1c560a76854984410d7");
    expect(fixture.baseline.sourceRevision).toBe(0);
    expect(database.selectValue("SELECT max(accepted_counter) FROM library_actors;")).toBe(0);
    const carriedFrontier = fixture.baselineRecords.find(record => record.registryKey === "01_authority_epoch")!.payload.checkpointFrontierDigest;
    expect(carriedFrontier).not.toBe(fixture.baseline.causalFrontierDigest);
    expect(engine.describeNormalizedCheckpointExport()).toEqual({ ...fixture.baseline, causalFrontierDigest: carriedFrontier });
    for (const page of fixture.operationPages) {
      const input = parseLibraryCoreNormalizedOperationImportPageV2(page);
      await engine.importNormalizedOperationPage(input);
      if (!page.page.done) {
        expect(database.selectValue("SELECT source_revision FROM library_meta;")).toBe(0);
        expect(database.selectValue("SELECT count(*) FROM library_preferences;")).toBe(0);
        engine = new PwaLibraryCoreSqliteEngine(database, sqlite3.version.libVersion, { capi: sqlite3.capi, persistentAuditTemporaryStorage });
        engine.initialize();
      }
      await engine.importNormalizedOperationPage(input);
    }
    expect(database.selectValue("SELECT boolean_value FROM library_preferences WHERE path='v:$.display.markReadOnScroll';")).toBe(0);
    expect(database.selectValue("SELECT integer_value FROM library_preferences WHERE path='v:$.weights.topics.historical';")).toBe(3);
    expect(Array.from(database.selectValue("SELECT canonical_envelope FROM library_operations;") as Uint8Array)).toEqual(Array.from(bytes(fixture.envelopes[0]!)));
    expect(Array.from(database.selectValue("SELECT canonical_result FROM library_operation_replication_results;") as Uint8Array)).toEqual(Array.from(bytes(fixture.canonicalResultJson)));
    expect(database.selectValue("SELECT count(*) FROM library_operations;")).toBe(1);
    expect(database.selectValue("SELECT accepted_counter FROM library_actors;")).toBe(1);
    const snapshot = engine.describeNormalizedCheckpointExport();
    expect(snapshot).toEqual(fixture.expected);
    const records: LibraryCoreNormalizedCheckpointRecordV2[] = [];
    let after = null;
    for (let pageCount = 0; pageCount < 100; pageCount += 1) {
      const page = engine.exportPinnedNormalizedCheckpointPage({ snapshot, page: { after, maximumRecords: 3,
        maximumResponseBytes: LIBRARY_CORE_NATIVE_EXPORT_MAXIMUM_RESPONSE_BYTES } });
      records.push(...page.records);
      if (page.done) break;
      after = page.nextCursor;
    }
    expect(records).toHaveLength(fixture.expected.recordCount);
    expect(digestLibraryCoreNormalizedCheckpointRecordsV2(records)).toBe(fixture.expectedCheckpointDigest);
    const connectionSettings = () => ["temp_store", "main.cache_size", "temp.cache_size"]
      .map(name => database.selectValue(`PRAGMA ${name}`));
    database.exec("PRAGMA main.cache_size=-4096; PRAGMA temp.cache_size=-1024;");
    const priorSettings = connectionSettings();
    database.exec("CREATE TEMP TABLE audit_preserve(value TEXT); INSERT INTO audit_preserve VALUES ('retained');");
    if (persistentAuditTemporaryStorage) {
      await expect(engine.auditNormalizedReplica({ check() {}, yieldControl: async () => {} }))
        .rejects.toThrow("empty SQLite temporary schema");
    } else {
      expect((await engine.auditNormalizedReplica({ check() {}, yieldControl: async () => {} })).checkpointDigest)
        .toBe(fixture.expectedCheckpointDigest);
    }
    expect(database.selectValue("SELECT value FROM audit_preserve")).toBe("retained");
    expect(connectionSettings()).toEqual(priorSettings);
    database.exec("DROP TABLE audit_preserve;");
    const audit = await engine.auditNormalizedReplica({ check() {}, yieldControl: async () => {} });
    expect(audit.snapshot).toEqual(fixture.expected);
    expect(audit.checkpointDigest).toBe(fixture.expectedCheckpointDigest);
    let checkedRecords = 0;
    await expect(engine.auditNormalizedReplica({
      check() { if (++checkedRecords === 5) throw new Error("AUDIT_CANCELLED"); },
      yieldControl: async () => {},
    })).rejects.toThrow("AUDIT_CANCELLED");
    expect(checkedRecords).toBe(5);
    expect(connectionSettings()).toEqual(priorSettings);
    // A larger read would encounter a leaked progress callback after cancellation.
    expect(database.selectValue("WITH RECURSIVE n(x) AS (SELECT 1 UNION ALL SELECT x+1 FROM n WHERE x<2000) SELECT sum(x) FROM n"))
      .toBe(2001000);
    // Cancellation released its snapshot and left the same worker engine usable.
    expect(await engine.auditNormalizedReplica({ check() {}, yieldControl: async () => {} })).toEqual(audit);
    expect(connectionSettings()).toEqual(priorSettings);
  });

  it.each([2202, 3300])("converges with native recovered-actor signed edits with consumer enqueue clock %i", async (enqueuedAt) => {
    const fixture = nativeRecoveredBrowser;
    const bytes = (value: string) => Uint8Array.from(new TextEncoder().encode(value));
    let localNow = enqueuedAt;
    let engine = new PwaLibraryCoreSqliteEngine(database, sqlite3.version.libVersion, { capi: sqlite3.capi, now: () => localNow });
    engine.initialize();
    const records = fixture.baselineRecords.map(parseLibraryCoreNormalizedCheckpointRecordV2);
    stageRecords(engine, records, "native-recovered-baseline", fixture.baseline);
    engine.activateNormalizedCheckpointStage({ stageId: "native-recovered-baseline", replaceExisting: false,
      followerReceipt: { checkpointGeneration: 0, controlRevision: "native-fixture", installedAt: 2200,
        manifestContentDigest: lowercaseHex64("8".repeat(64)), manifestObjectKey: "fixture", manifestTransportObjectId: "fixture",
        writerActorId: fixture.baseline.writerId } });
    expect(engine.describeNormalizedCheckpointExport()).toEqual(fixture.baseline);
    await engine.storeFollowerActorRequest({
      canonicalRequestBytes: bytes(fixture.request.canonicalEnrollmentRequestJson),
      createdAt: fixture.request.createdAt,
    });
    // A checkpoint may deliver the grant before the response arrives. Its
    // physical capability ID is reusable only for the exact signed identity.
    database.exec({ sql: "UPDATE library_actor_capabilities SET canonical_certificate = '{}' WHERE actor_id = ?1;",
      bind: [fixture.request.actorId] });
    await expect(engine.installFollowerActorEnrollment({ canonicalCertificateBytes: bytes(fixture.certificate), enrolledAt: 2201 }))
      .rejects.toThrow(/stored identity changed/);
    expect(database.selectValue("SELECT enrollment_certificate_digest FROM library_follower_actor_request;")).toBeNull();
    expect(database.selectValue("SELECT count(*) FROM library_intent_actors;")).toBe(0);
    database.exec({ sql: "UPDATE library_actor_capabilities SET canonical_certificate = ?1 WHERE actor_id = ?2;",
      bind: [fixture.certificate, fixture.request.actorId] });
    database.exec({ sql: `INSERT INTO library_actor_capability_queries (capability_id, query_id)
        SELECT capability_id, 'unapproved_query' FROM library_actor_capabilities WHERE actor_id = ?1;`,
      bind: [fixture.request.actorId] });
    await expect(engine.installFollowerActorEnrollment({ canonicalCertificateBytes: bytes(fixture.certificate), enrolledAt: 2201 }))
      .rejects.toThrow(/stored permissions changed/);
    expect(database.selectValue("SELECT enrollment_certificate_digest FROM library_follower_actor_request;")).toBeNull();
    database.exec("DELETE FROM library_actor_capability_queries WHERE query_id = 'unapproved_query';");
    await engine.installFollowerActorEnrollment({ canonicalCertificateBytes: bytes(fixture.certificate), enrolledAt: 2201 });
    const envelopeBytes = fixture.envelopes.map(bytes);
    await engine.commitFollowerIntent({ envelopeBytes });
    expect(database.selectValue("SELECT count(*) FROM library_optimistic_fields;")).toBe(2);
    for (const page of fixture.operationPages) {
      const input = parseLibraryCoreNormalizedOperationImportPageV2(page);
      await engine.importNormalizedOperationPage(input);
      if (!page.page.done) {
        expect(database.selectValue("SELECT source_revision FROM library_meta;")).toBe(fixture.baseline.sourceRevision);
        expect(database.selectValue("SELECT count(*) FROM library_optimistic_fields;")).toBe(2);
        engine = new PwaLibraryCoreSqliteEngine(database, sqlite3.version.libVersion, { capi: sqlite3.capi, now: () => localNow });
        engine.initialize();
      }
      await engine.importNormalizedOperationPage(input);
    }
    // The Primary signed at 2203. A later consumer enqueue and a subsequent
    // local clock rollback cannot invalidate that exact authority result.
    localNow = enqueuedAt + (enqueuedAt === 3300 ? -100 : 100);
    for (const result of fixture.results) {
      const input = { canonicalResultBytes: bytes(result.canonicalResultJson) };
      expect(await engine.applyFollowerResult(input)).toMatchObject({ status: "accepted", actorId: fixture.request.actorId });
      await engine.applyFollowerResult(input);
    }
    expect(database.selectValue("SELECT resolved_at FROM library_intent_transactions;"))
      .toBe(Math.max(enqueuedAt, localNow));
    expect(database.selectValue("SELECT received_at FROM library_intent_results;"))
      .toBe(localNow);
    expect(Array.from(database.selectValue("SELECT canonical_result FROM library_intent_results;") as Uint8Array))
      .toEqual(Array.from(bytes(fixture.results[0]!.canonicalResultJson)));
    expect(database.selectValue("SELECT count(*) FROM library_optimistic_fields;")).toBe(0);
    expect(database.exec({ sql: "SELECT read_at FROM library_feed_items ORDER BY global_id;", rowMode: 0, returnValue: "resultRows" })).toEqual([900, 901]);
    const snapshot = engine.describeNormalizedCheckpointExport();
    expect(snapshot).toEqual(fixture.expected);
    const finalRecords: LibraryCoreNormalizedCheckpointRecordV2[] = [];
    let after = null;
    while (true) {
      const page = engine.exportPinnedNormalizedCheckpointPage({ snapshot, page: { after, maximumRecords: 3,
        maximumResponseBytes: LIBRARY_CORE_NATIVE_EXPORT_MAXIMUM_RESPONSE_BYTES } });
      finalRecords.push(...page.records);
      if (page.done) break;
      after = page.nextCursor;
    }
    expect(digestLibraryCoreNormalizedCheckpointRecordsV2(finalRecords)).toBe(fixture.expectedCheckpointDigest);
  });

  it("rolls back browser activation on unresolved references", () => {
    const engine = new PwaLibraryCoreSqliteEngine(
      database,
      sqlite3.version.libVersion,
    );
    engine.initialize();
    const header = checkpointHeader();
    const orphan = createLibraryCoreNormalizedCheckpointRecordV2({
      registryKey: "13_feed_item_tag",
      primaryKey: ["missing-item", "favorite"],
      payload: { tag: "favorite" },
    });
    stageRecords(engine, [header, ...authorityRecords(), orphan], "orphan");
    expect(() =>
      engine.activateNormalizedCheckpointStage({
        followerReceipt: null,
        replaceExisting: false,
        stageId: "orphan",
      }),
    ).toThrow(/unresolved foreign reference/);
    expect(
      database.exec({
        sql: "SELECT count(*) FROM library_feed_item_tags;",
        rowMode: 0,
        returnValue: "resultRows",
      }),
    ).toEqual([0]);
  });

  it.each(["same", "other-library", "other-epoch"])(
    "preserves enrollment and requires explicit authority recovery: %s",
    (identity) => {
      const sameEpoch = identity == "same";
      const engine = new PwaLibraryCoreSqliteEngine(
        database,
        sqlite3.version.libVersion,
      );
      engine.initialize();
      const records = [checkpointHeader(), ...authorityRecords()];
      stageRecords(engine, records, "original");
      engine.activateNormalizedCheckpointStage({
        followerReceipt: {
          checkpointGeneration: 8, controlRevision: "control-8", installedAt: 1_000,
          manifestContentDigest: lowercaseHex64("8".repeat(64)),
          manifestObjectKey: "manifest-8", manifestTransportObjectId: "drive-8",
          writerActorId: "actor-1",
        }, replaceExisting: false, stageId: "original",
      });
      database.exec(
        `INSERT INTO library_preferences (path, value_type, updated_at)
       VALUES ('v:$.old', 'null', 1);
       INSERT INTO library_follower_actor_request
         (singleton_id, library_id, authority_epoch_id, actor_id,
          actor_public_key, enrollment_request_digest,
          canonical_enrollment_request, created_at)
       VALUES (1, '${identity == "other-library" ? "old-library" : "library-1"}', '${identity == "other-epoch" ? "old-epoch" : "epoch-1"}', '${"a".repeat(64)}',
               '${"b".repeat(64)}', '${"c".repeat(64)}', '{}', 1);`,
      );
      const previousEnrollment = database.exec({
        sql: "SELECT * FROM library_follower_actor_request;",
        rowMode: "array",
        returnValue: "resultRows",
      });
      stageRecords(engine, records, "replacement");
      const activate = () => engine.activateNormalizedCheckpointStage({
        followerReceipt: {
          checkpointGeneration: 9,
          controlRevision: "control-revision-1",
          installedAt: 2_000,
          manifestContentDigest: lowercaseHex64("9".repeat(64)),
          manifestObjectKey: "manifest-key",
          manifestTransportObjectId: "drive-object-1",
          writerActorId: "actor-1",
        },
        replaceExisting: true,
        stageId: "replacement",
      });
      if (!sameEpoch) {
        expect(activate).toThrow("authority recovery");
        expect(database.exec({ sql: "SELECT * FROM library_follower_actor_request;",
          rowMode: "array", returnValue: "resultRows" })).toEqual(previousEnrollment);
        expect(database.exec({ sql: "SELECT count(*) FROM library_preferences;",
          rowMode: 0, returnValue: "resultRows" })).toEqual([1]);
        return;
      }
      const receipt = activate();
      expect(
        database.exec({
          sql: "SELECT count(*) FROM library_preferences;",
          rowMode: 0,
          returnValue: "resultRows",
        }),
      ).toEqual([0]);
      expect(
        database.exec({
          sql: "SELECT * FROM library_follower_actor_request;",
          rowMode: "array",
          returnValue: "resultRows",
        }),
      ).toEqual(sameEpoch ? previousEnrollment : []);
      expect(
        database.exec({
          sql: `SELECT checkpoint_generation, source_revision,
                     checkpoint_digest, writer_actor_id,
                     manifest_transport_object_id, control_revision
              FROM library_follower_checkpoint_receipt
              WHERE singleton_id = 1;`,
          rowMode: "array",
          returnValue: "resultRows",
        }),
      ).toEqual([
        [
          9,
          7,
          receipt.checkpointDigest,
          "actor-1",
          "drive-object-1",
          "control-revision-1",
        ],
      ]);
      expect(engine.readNormalizedCheckpointReceipt()).toEqual({
        receipt: {
          authorityEpoch: "epoch-1",
          checkpointDigest: receipt.checkpointDigest,
          checkpointGeneration: 9,
          controlRevision: "control-revision-1",
          installedAt: 2_000,
          libraryId: "library-1",
          manifestContentDigest: "9".repeat(64),
          manifestObjectKey: "manifest-key",
          manifestTransportObjectId: "drive-object-1",
          sourceRevision: 7,
          writerActorId: "actor-1",
        },
      });
    },
  );

  it.each([1, 2].flatMap((physicalVersion) => [false, true].flatMap((failActivation) =>
    (["pending", "published"] as const).map((state) => ({ physicalVersion, failActivation, state })),
  )))(
    "retains $state edits and settled history across checkpoints, physical $physicalVersion, fault: $failActivation",
    ({ physicalVersion, failActivation, state }) => {
      const engine = new PwaLibraryCoreSqliteEngine(
        database,
        sqlite3.version.libVersion,
      );
      engine.initialize();
      if (physicalVersion === 2) database.transaction("IMMEDIATE", () => migratePwaLibraryRecoverySchema(database, sqlite3.capi));
      const actorId = "a".repeat(64);
      const digest = "7".repeat(64);
      const records = [checkpointHeader(), ...authorityRecords()].map(
        (record) =>
          createLibraryCoreNormalizedCheckpointRecordV2(
            JSON.parse(
              JSON.stringify(record).replaceAll('"actor-1"', `"${actorId}"`),
            ),
          ),
      );
      stageRecords(engine, records, "original");
      engine.activateNormalizedCheckpointStage({
        followerReceipt: {
          checkpointGeneration: 9, controlRevision: "control-9", installedAt: 1_000,
          manifestContentDigest: lowercaseHex64("8".repeat(64)),
          manifestObjectKey: "manifest-9", manifestTransportObjectId: "drive-9",
          writerActorId: actorId,
        },
        replaceExisting: false,
        stageId: "original",
      });
      const blob = new Uint8Array([123, 125]);
      const localRows: Record<
        string,
        Record<string, string | number | Uint8Array | null>
      > = {
        ...(physicalVersion === 2 ? {
          library_local_recovery_archives: {
            recovery_id: "1".repeat(64), library_id: "library-1",
            predecessor_epoch_id: "older-epoch", successor_epoch_id: "epoch-1",
            actor_id: actorId, schema_sha256: LIBRARY_CORE_NORMALIZED_SCHEMA_SHA256,
            row_count: 0, archive_digest: "6".repeat(64), created_at: 1,
          },
        } : {}),
        library_follower_actor_request: {
          singleton_id: 1,
          library_id: "library-1",
          authority_epoch_id: "epoch-1",
          actor_id: actorId,
          actor_public_key: "f".repeat(64),
          enrollment_request_digest: "1".repeat(64),
          canonical_enrollment_request: "{}",
          created_at: 1,
          enrollment_certificate_digest: "1".repeat(64),
          canonical_enrollment_certificate: "{}",
          actor_chain_genesis: "2".repeat(64),
          enrolled_at: 2,
        },
        library_intent_actors: {
          actor_id: actorId,
          next_counter: 4,
          previous_operation_id: "rejected-3",
          previous_chain_digest: digest,
        },
        library_intent_transactions: {
          transaction_id: "rejected",
          transaction_digest: digest,
          actor_id: actorId,
          intent_epoch: 1,
          intent_epoch_id: "epoch-1",
          member_count: 1,
          first_counter: 3,
          last_counter: 3,
          previous_operation_id: "operation-2",
          previous_chain_digest: "3".repeat(64),
          ending_operation_id: "rejected-3",
          ending_chain_digest: digest,
          canonical_member_bytes: 2,
          canonical_transaction: blob,
          state: "rejected",
          created_at: 3,
          published_at: 4,
          resolved_at: 5,
        },
        library_intent_members: {
          transaction_id: "rejected",
          actor_id: actorId,
          member_index: 0,
          operation_id: "rejected-3",
          actor_counter: 3,
          mutation_id: "feed_item_read_assignment",
          entity_type: "FeedItem",
          entity_id: "item-1",
          canonical_member: blob,
          member_digest: digest,
        },
        library_intent_results: {
          transaction_id: "rejected",
          actor_id: actorId,
          authority_epoch_id: "epoch-1",
          intent_epoch_id: "epoch-1",
          result_sequence: 1,
          previous_result_digest: null,
          result_digest: digest,
          status: "rejected",
          authoritative_source_revision: 7,
          canonical_result: blob,
          received_at: 5,
        },
        library_intent_result_cursors: {
          actor_id: actorId,
          next_result_sequence: 2,
          previous_result_digest: digest,
        },
        library_intent_transport_heads: {
          actor_id: actorId,
          library_id: "library-1",
          storage_epoch_id: "epoch-1",
          next_actor_counter: 4,
          latest_segment_digest: digest,
        },
        library_intent_transport_segments: {
          actor_id: actorId,
          first_actor_counter: 1,
          last_actor_counter: 3,
          previous_segment_digest: null,
          semantic_segment_digest: digest,
          stored_segment_digest: digest,
          object_key: "intent-key",
          transport_object_id: "intent-object",
          published_at: 4,
          published_transaction_count: 1,
        },
        library_result_transport_heads: {
          actor_id: actorId,
          library_id: "library-1",
          storage_epoch_id: "epoch-1",
          next_result_sequence: 2,
          latest_segment_digest: digest,
        },
        library_result_transport_segments: {
          actor_id: actorId,
          first_result_sequence: 1,
          last_result_sequence: 1,
          previous_segment_digest: null,
          semantic_segment_digest: digest,
          stored_segment_digest: digest,
          object_key: "result-key",
          transport_object_id: "result-object",
          received_at: 5,
          result_count: 1,
          accepted_transaction_count: 0,
          rejected_transaction_count: 1,
        },
      };
      for (const [table, row] of Object.entries(localRows)) {
        database.exec({
          sql: `INSERT INTO ${table} (${Object.keys(row).join(",")}) VALUES (${Object.keys(
            row,
          )
            .map(() => "?")
            .join(",")});`,
          bind: Object.values(row),
        });
      }
      const pendingRows = {
        library_intent_transactions: {
          ...localRows.library_intent_transactions!, transaction_id: "pending-4",
          transaction_digest: "8".repeat(64), first_counter: 4, last_counter: 4,
          previous_operation_id: "rejected-3", previous_chain_digest: digest,
          ending_operation_id: "pending-operation-4", ending_chain_digest: "9".repeat(64),
          state, created_at: 6, published_at: state === "published" ? 7 : null, resolved_at: null,
        },
        library_intent_members: {
          ...localRows.library_intent_members!, transaction_id: "pending-4",
          operation_id: "pending-operation-4", actor_counter: 4, member_digest: "8".repeat(64),
        },
        library_optimistic_fields: {
          transaction_id: "pending-4", member_index: 0, actor_id: actorId, actor_counter: 4,
          entity_type: "FeedItem", entity_id: "item-1", field_path: "read_at",
          value_type: "integer", boolean_value: null, integer_value: 6, created_at: 6,
        },
      };
      for (const [table, row] of Object.entries(pendingRows)) {
        database.exec({ sql: `INSERT INTO ${table} (${Object.keys(row).join(",")})
          VALUES (${Object.keys(row).map(() => "?").join(",")});`, bind: Object.values(row) });
      }
      database.exec(`UPDATE library_intent_actors SET next_counter = 5,
        previous_operation_id = 'pending-operation-4', previous_chain_digest = '${"9".repeat(64)}';`);
      const snapshot = () =>
        Object.fromEntries(
          [...Object.keys(localRows), "library_optimistic_fields", "library_local_change_state",
            "library_local_invalidations"].map((table) => [
            table,
            database.exec({
              sql: `SELECT * FROM ${table};`,
              rowMode: "array",
              returnValue: "resultRows",
            }),
          ]),
        );
      const before = snapshot();
      stageRecords(engine, records, "next-checkpoint");
      if (failActivation) {
        database.exec(`CREATE TEMP TRIGGER fail_checkpoint_receipt BEFORE INSERT ON library_follower_checkpoint_receipt
        BEGIN SELECT RAISE(ABORT, 'injected checkpoint receipt fault'); END;`);
      }
      const activate = () =>
        engine.activateNormalizedCheckpointStage({
          followerReceipt: {
            checkpointGeneration: 10,
            controlRevision: "control-10",
            installedAt: 2000,
            manifestContentDigest: lowercaseHex64("9".repeat(64)),
            manifestObjectKey: "manifest-10",
            manifestTransportObjectId: "drive-10",
            writerActorId: actorId,
          },
          replaceExisting: true,
          stageId: "next-checkpoint",
        });
      if (!failActivation && state === "pending") {
        const originalChain = database.exec({
          sql: "SELECT accepted_chain_digest FROM library_actors WHERE actor_id = ?1;",
          bind: [actorId], rowMode: 0, returnValue: "resultRows",
        })[0] as string;
        const originalAuthority = database.exec({
          sql: "SELECT authority_public_key FROM library_authority_epochs WHERE epoch_id = 'epoch-1';",
          rowMode: 0, returnValue: "resultRows",
        })[0] as string;
        const refuse = (sql: string, value: string | number, original: string | number, message: string) => {
          database.exec({ sql, bind: [value] });
          try {
            expect(activate).toThrow(message);
            expect(database.exec({ sql: "SELECT name FROM sqlite_schema WHERE name LIKE 'checkpoint_retained_%';",
              rowMode: 0, returnValue: "resultRows" })).toEqual([]);
          } finally {
            database.exec({ sql, bind: [original] });
          }
          expect(snapshot()).toEqual(before);
        };
        refuse("UPDATE library_meta SET source_revision = ?1;", 8, 7, "regress local history");
        refuse("UPDATE library_follower_checkpoint_receipt SET checkpoint_generation = ?1;", 11, 9, "regress local history");
        refuse("UPDATE library_follower_actor_request SET authority_epoch_id = ?1;", "other-epoch", "epoch-1", "authority recovery");
        refuse("UPDATE library_actors SET accepted_chain_digest = ?1;", "e".repeat(64), originalChain, "retained actor chain");
        refuse("UPDATE library_authority_epochs SET authority_public_key = ?1;", "e".repeat(64), originalAuthority, "accepted authority");
      }
      if (failActivation)
        expect(activate).toThrow(/injected checkpoint receipt fault/);
      else expect(activate()).toMatchObject({ sourceRevision: 7 });
      expect(snapshot()).toEqual(before);
      expect(
        database.exec({
          sql: "SELECT name FROM sqlite_schema WHERE name LIKE 'checkpoint_retained_%';",
          rowMode: 0,
          returnValue: "resultRows",
        }),
      ).toEqual([]);
      expect(
        database.exec({
          sql: "PRAGMA foreign_key_check;",
          rowMode: "array",
          returnValue: "resultRows",
        }),
      ).toEqual([]);
      if (failActivation) {
        database.exec("DROP TRIGGER fail_checkpoint_receipt;");
        expect(activate()).toMatchObject({ sourceRevision: 7 });
        expect(snapshot()).toEqual(before);
      }
      if (!failActivation && state === "pending") {
        // Seed the already verified result boundary, then prove that only its
        // covered canonical checkpoint can remove the retained overlay.
        database.exec("UPDATE library_intent_transactions SET state = 'accepted', resolved_at = 8 WHERE transaction_id = 'pending-4';");
        const result = { ...localRows.library_intent_results!, transaction_id: "pending-4",
          result_sequence: 2, previous_result_digest: digest, result_digest: "8".repeat(64),
          status: "accepted", authoritative_source_revision: 8, received_at: 8 };
        database.exec({ sql: `INSERT INTO library_intent_results (${Object.keys(result).join(",")})
          VALUES (${Object.keys(result).map(() => "?").join(",")});`, bind: Object.values(result) });
        const advanced = records.map((record) => {
          if (record.registryKey === "00_checkpoint_header") return createLibraryCoreNormalizedCheckpointRecordV2({
            ...record, payload: { ...record.payload, checkpointId: "library-1:epoch-1:8", sourceRevision: 8 },
          });
          if (record.registryKey === "90_actor_state") return createLibraryCoreNormalizedCheckpointRecordV2({
            ...record, payload: { ...record.payload, acceptedCounter: 4,
              acceptedOperationId: "pending-operation-4", acceptedChainDigest: "9".repeat(64) },
          });
          return record;
        });
        stageRecords(engine, advanced, "covered-result", { libraryId: "library-1", authorityEpoch: "epoch-1", sourceRevision: 8 });
        expect(database.exec({ sql: "SELECT count(*) FROM library_optimistic_fields;",
          rowMode: 0, returnValue: "resultRows" })).toEqual([1]);
        engine.activateNormalizedCheckpointStage({
          followerReceipt: { checkpointGeneration: 11, controlRevision: "control-11", installedAt: 3_000,
            manifestContentDigest: lowercaseHex64("a".repeat(64)), manifestObjectKey: "manifest-11",
            manifestTransportObjectId: "drive-11", writerActorId: actorId },
          replaceExisting: true, stageId: "covered-result",
        });
        expect(database.exec({ sql: "SELECT count(*) FROM library_optimistic_fields;",
          rowMode: 0, returnValue: "resultRows" })).toEqual([0]);
        expect(database.exec({ sql: "SELECT next_counter FROM library_intent_actors;",
          rowMode: 0, returnValue: "resultRows" })).toEqual([5]);
        expect(database.exec({ sql: "SELECT state FROM library_intent_transactions WHERE transaction_id = 'pending-4';",
          rowMode: 0, returnValue: "resultRows" })).toEqual(["accepted"]);
      }
    },
  );

  it("preserves the accepted database when replacement has unresolved local work", () => {
    const engine = new PwaLibraryCoreSqliteEngine(
      database,
      sqlite3.version.libVersion,
    );
    engine.initialize();
    database.exec(
      `INSERT INTO library_preferences (path, value_type, updated_at)
         VALUES ('v:$.old', 'null', 1);
       INSERT INTO library_primary_intent_stage_transactions
         (transaction_id, transaction_digest, actor_id, intent_epoch,
          intent_epoch_id, member_count, first_counter, last_counter,
          received_count, canonical_member_bytes, created_at, updated_at)
         VALUES ('pending-1',
           'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
           'actor-local', 1, 'epoch-local', 1, 1, 1, 0, 0, 1, 1);`,
    );
    const records = [checkpointHeader(), ...authorityRecords()];
    stageRecords(engine, records, "pending-replacement");
    expect(() =>
      engine.activateNormalizedCheckpointStage({
        followerReceipt: null,
        replaceExisting: true,
        stageId: "pending-replacement",
      }),
    ).toThrow(/unresolved local operations/);
    expect(
      database.exec({
        sql: "SELECT path FROM library_preferences;",
        rowMode: 0,
        returnValue: "resultRows",
      }),
    ).toEqual(["v:$.old"]);
    expect(
      engine.beginNormalizedCheckpointStage({
        authorityEpoch: "epoch-1",
        createdAt: 1_000,
        expectedRecordCount: records.length,
        libraryId: "library-1",
        sourceRevision: 7,
        stageId: "pending-replacement",
      }).complete,
    ).toBe(true);
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
      engine.activateNormalizedCheckpointStage({
        followerReceipt: null,
        replaceExisting: false,
        stageId: "missing-authority",
      }),
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
    const receipt = engine.activateNormalizedCheckpointStage({
      followerReceipt: null,
      replaceExisting: false,
      stageId: "large-content",
    });
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

  it("authenticates a multi-gigabyte range map without hydrating media bytes", () => {
    const engine = new PwaLibraryCoreSqliteEngine(
      database,
      sqlite3.version.libVersion,
    );
    engine.initialize();
    const contentDigest = "a".repeat(64);
    const content = [
      createLibraryCoreNormalizedCheckpointRecordV2({
        registryKey: "b0_blob_descriptor",
        primaryKey: contentDigest,
        payload: {
          blobContentDigest: contentDigest,
          byteLength: 5_000_000_000,
          chunkBytes: 0,
          chunkCount: 0,
          cloudAvailabilityCommitment: "d".repeat(64),
          encoding: "identity",
          mediaType: "video/mp4",
          rangeCount: 2,
          rangeGranularity: 2_500_000_000,
          rangeIndexRootDigest:
            "add3359c5ff23df62183d1fd6e086763c2de356b292357cdf43cbb6967240b95",
          renditionId: "video-1080p",
          storageLayout: "authenticated_ranges",
        },
      }),
      createLibraryCoreNormalizedCheckpointRecordV2({
        registryKey: "b2_content_range",
        primaryKey: [contentDigest, 0],
        payload: {
          blobContentDigest: contentDigest,
          byteLength: 2_500_000_000,
          byteOffset: 0,
          rangeContentDigest: "b".repeat(64),
          rangeIndex: 0,
        },
      }),
      createLibraryCoreNormalizedCheckpointRecordV2({
        registryKey: "b2_content_range",
        primaryKey: [contentDigest, 1],
        payload: {
          blobContentDigest: contentDigest,
          byteLength: 2_500_000_000,
          byteOffset: 2_500_000_000,
          rangeContentDigest: "c".repeat(64),
          rangeIndex: 1,
        },
      }),
    ];
    const records = [checkpointHeader(), ...authorityRecords(), ...content];
    stageRecords(engine, records, "ranged-content");
    expect(
      engine.activateNormalizedCheckpointStage({
        followerReceipt: null,
        replaceExisting: false,
        stageId: "ranged-content",
      }).recordCount,
    ).toBe(records.length);
    expect(
      database.exec({
        sql: `SELECT
                (SELECT count(*) FROM library_blob_chunks),
                (SELECT count(*) FROM library_content_ranges),
                (SELECT byte_length FROM library_blobs WHERE content_digest = ?1);`,
        bind: [contentDigest],
        rowMode: "array",
        returnValue: "resultRows",
      }),
    ).toEqual([[0, 2, 5_000_000_000]]);

    const publication = {
      byteLength: 2_500_000_000,
      contentDigest,
      rangeContentDigest: "b".repeat(64),
      rangeIndex: 0,
      schemaVersion: 1 as const,
      storageKey: "large-range-one",
      storageKind: "opfs" as const,
      verifiedAt: 2_000,
    };
    engine.mutateContentPolicy({
      contentDigest,
      policy: "pinned_offline",
      schemaVersion: 1,
      updatedAt: 2_000,
    });
    engine.registerVerifiedContentRange(publication);
    stageRecords(engine, records, "ranged-content-exact-replacement");
    engine.activateNormalizedCheckpointStage({
      followerReceipt: null,
      replaceExisting: true,
      stageId: "ranged-content-exact-replacement",
    });
    expect(
      engine.readContentState({ contentDigest, schemaVersion: 1 }),
    ).toMatchObject({
      availability: { verifiedBytes: 2_500_000_000 },
      contentRevision: 2,
      policy: "pinned_offline",
    });

    const withoutContent = [checkpointHeader(), ...authorityRecords()];
    stageRecords(engine, withoutContent, "ranged-content-removed-replacement");
    engine.activateNormalizedCheckpointStage({
      followerReceipt: null,
      replaceExisting: true,
      stageId: "ranged-content-removed-replacement",
    });
    expect(
      database.exec({
        sql: `SELECT
                (SELECT count(*) FROM library_device_content_policies),
                (SELECT count(*) FROM library_device_content_ranges),
                (SELECT count(*) FROM library_device_content_availability),
                (SELECT revision FROM library_device_content_state);`,
        rowMode: "array",
        returnValue: "resultRows",
      }),
    ).toEqual([[0, 0, 0, 3]]);
  });
});
