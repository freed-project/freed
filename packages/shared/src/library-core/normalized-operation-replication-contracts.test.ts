import { describe, expect, it } from "vitest";
import { encodeLibraryCoreCanonicalValue } from "./canonical-codec.js";
import {
  parseLibraryCoreNormalizedOperationExportDescriptorV2,
  parseLibraryCoreNormalizedOperationExportPageV2,
  parseLibraryCoreNormalizedOperationImportPageV2,
} from "./normalized-operation-replication-contracts.js";

const textDecoder = new TextDecoder();
const LIBRARY_ID = "1".repeat(64);
const EPOCH_ID = "2".repeat(64);
const ACTOR_ID = "3".repeat(64);
const WRITER_ID = "4".repeat(64);
const TRANSACTION_DIGEST = "5".repeat(64);
const RESULT_DIGEST = "6".repeat(64);
const ENVELOPE_DIGEST = "7".repeat(64);

function canonicalJson(value: Record<string, unknown>): string {
  return textDecoder.decode(
    encodeLibraryCoreCanonicalValue(value as never, {
      maximumBytes: 131_072,
    }),
  );
}

function operation() {
  return {
    actor_chain_digest: "8".repeat(64),
    actor_id: ACTOR_ID,
    actor_sequence: 1,
    blob_references: [],
    causal_frontier: [],
    created_at_ms: 1,
    entity_id: "item-1",
    entity_type: "FeedItem",
    epoch: 1,
    epoch_id: EPOCH_ID,
    hlc_counter: 0,
    hlc_wall_ms: 1,
    library_id: LIBRARY_ID,
    operation_id: "operation-1",
    operation_type: "feed_item_read_assignment",
    payload: { read_at_ms: 1 },
    payload_digest: "9".repeat(64),
    previous_actor_chain_digest: "a".repeat(64),
    previous_actor_operation_id: null,
    schema_version: 1,
    signature: "b".repeat(128),
    signature_algorithm: "ed25519",
    transaction_digest: TRANSACTION_DIGEST,
    transaction_id: "transaction-1",
    transaction_member_count: 1,
    transaction_member_index: 0,
  } as const;
}

function acceptedResult() {
  return {
    actor_id: ACTOR_ID,
    authoritative_source_revision: 1,
    authority_key_id: "c".repeat(64),
    canonical_operation_ids: ["operation-1"],
    epoch: 1,
    epoch_id: EPOCH_ID,
    format: "freed_follower_result_v1",
    intent_epoch: 1,
    intent_epoch_id: EPOCH_ID,
    library_id: LIBRARY_ID,
    original_result_digest: null,
    previous_result_digest: null,
    receipt_ids: ["receipt-1"],
    rejection_reason: null,
    replacement_fields: [],
    resolved_at_ms: 2,
    result_body_digest: RESULT_DIGEST,
    result_sequence: 1,
    schema_version: 1,
    signature: "d".repeat(128),
    signature_algorithm: "ed25519",
    status: "accepted",
    transaction_digest: TRANSACTION_DIGEST,
    transaction_id: "transaction-1",
  } as const;
}

describe("normalized operation replication v2 contracts", () => {
  it("parses a bounded accepted result followed by its exact operation", () => {
    const resultJson = canonicalJson(acceptedResult());
    const operationJson = canonicalJson(operation());
    const records = [
      {
        canonicalRecordJson: resultJson,
        kind: "accepted_transaction",
        memberIndex: -1,
        recordDigest: RESULT_DIGEST,
        sourceRevision: 1,
        transactionDigest: TRANSACTION_DIGEST,
        transactionId: "transaction-1",
      },
      {
        canonicalRecordJson: operationJson,
        kind: "operation",
        memberIndex: 0,
        recordDigest: ENVELOPE_DIGEST,
        sourceRevision: 1,
        transactionDigest: TRANSACTION_DIGEST,
        transactionId: "transaction-1",
      },
    ] as const;
    const parsed = parseLibraryCoreNormalizedOperationExportPageV2({
      canonicalRecordBytes: resultJson.length + operationJson.length,
      done: true,
      nextCursor: {
        kind: "operation",
        memberIndex: 0,
        recordDigest: ENVELOPE_DIGEST,
        sourceRevision: 1,
      },
      records,
    });

    expect(parsed.records.map((record) => record.kind)).toEqual([
      "accepted_transaction",
      "operation",
    ]);
    expect(parsed.canonicalRecordBytes).toBe(
      resultJson.length + operationJson.length,
    );
  });

  it("rejects record identity drift and unsupported export versions", () => {
    const operationJson = canonicalJson(operation());
    expect(() =>
      parseLibraryCoreNormalizedOperationExportPageV2({
        canonicalRecordBytes: operationJson.length,
        done: true,
        nextCursor: {
          kind: "operation",
          memberIndex: 0,
          recordDigest: ENVELOPE_DIGEST,
          sourceRevision: 1,
        },
        records: [
          {
            canonicalRecordJson: operationJson,
            kind: "operation",
            memberIndex: 1,
            recordDigest: ENVELOPE_DIGEST,
            sourceRevision: 1,
            transactionDigest: TRANSACTION_DIGEST,
            transactionId: "transaction-1",
          },
        ],
      }),
    ).toThrow(/identity/);

    expect(() =>
      parseLibraryCoreNormalizedOperationExportDescriptorV2({
        authorityEpoch: EPOCH_ID,
        firstAvailableRevision: 1,
        format: "freed_normalized_operation_export_v1",
        libraryId: LIBRARY_ID,
        operationCount: 1,
        protocolVersion: 1,
        sourceRevision: 1,
        transactionCount: 1,
        writerId: WRITER_ID,
      }),
    ).toThrow(/version/);
  });

  it("binds an import page to one exact authority snapshot and receive time", () => {
    const resultJson = canonicalJson(acceptedResult());
    const imported = parseLibraryCoreNormalizedOperationImportPageV2({
      page: {
        canonicalRecordBytes: resultJson.length,
        done: false,
        nextCursor: {
          kind: "accepted_transaction",
          memberIndex: -1,
          recordDigest: RESULT_DIGEST,
          sourceRevision: 1,
        },
        records: [
          {
            canonicalRecordJson: resultJson,
            kind: "accepted_transaction",
            memberIndex: -1,
            recordDigest: RESULT_DIGEST,
            sourceRevision: 1,
            transactionDigest: TRANSACTION_DIGEST,
            transactionId: "transaction-1",
          },
        ],
      },
      receivedAt: 10,
      snapshot: {
        authorityEpoch: EPOCH_ID,
        firstAvailableRevision: 1,
        format: "freed_normalized_operation_export_v2",
        libraryId: LIBRARY_ID,
        operationCount: 1,
        protocolVersion: 2,
        sourceRevision: 1,
        transactionCount: 1,
        writerId: WRITER_ID,
      },
    });
    expect(imported.receivedAt).toBe(10);
    expect(imported.page.records[0]?.sourceRevision).toBe(1);
    expect(() =>
      parseLibraryCoreNormalizedOperationImportPageV2({
        ...imported,
        snapshot: { ...imported.snapshot, firstAvailableRevision: 2 },
      }),
    ).toThrow(/snapshot/);
  });
});
