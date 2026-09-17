import { encodeLibraryCoreCanonicalValue, type LibraryCoreNormalizedOperationSegmentV2 } from "@freed/shared/library-core";

export const operationAnchor = { libraryId: "1".repeat(64), storageEpoch: "2".repeat(64), writerId: "3".repeat(64), checkpointDigest: "4".repeat(64), checkpointRevision: 0 };
export function operationSegmentFixture(): LibraryCoreNormalizedOperationSegmentV2 {
  // Syntax fixture only. Native importer tests independently verify signatures.
  const result = {
    actor_id: operationAnchor.writerId, authoritative_source_revision: 1, authority_key_id: "5".repeat(64),
    canonical_operation_ids: ["operation-1"], epoch: 1, epoch_id: operationAnchor.storageEpoch,
    format: "freed_follower_result_v1", intent_epoch: 1, intent_epoch_id: operationAnchor.storageEpoch,
    library_id: operationAnchor.libraryId, original_result_digest: null, previous_result_digest: null,
    receipt_ids: ["receipt-1"], rejection_reason: null, replacement_fields: [], resolved_at_ms: 2,
    result_body_digest: "6".repeat(64), result_sequence: 1, schema_version: 1,
    signature: "7".repeat(128), signature_algorithm: "ed25519", status: "accepted",
    transaction_digest: "8".repeat(64), transaction_id: "transaction-1",
  };
  const canonical = encodeLibraryCoreCanonicalValue(result);
  const record = { canonicalRecordJson: new TextDecoder().decode(canonical), kind: "accepted_transaction" as const,
    memberIndex: -1, recordDigest: result.result_body_digest as never, sourceRevision: 1,
    transactionDigest: result.transaction_digest as never, transactionId: result.transaction_id as never };
  return { ...operationAnchor, format: "freed_normalized_operation_segment_v2", protocolVersion: 2,
    segmentIndex: 1, previous: null,
    snapshot: { authorityEpoch: operationAnchor.storageEpoch as never, firstAvailableRevision: 1,
      format: "freed_normalized_operation_export_v2", libraryId: operationAnchor.libraryId as never,
      operationCount: 1, protocolVersion: 2, sourceRevision: 1, transactionCount: 1, writerId: operationAnchor.writerId as never },
    page: { canonicalRecordBytes: canonical.byteLength, done: false,
      nextCursor: { kind: record.kind, memberIndex: -1, recordDigest: record.recordDigest, sourceRevision: 1 }, records: [record] },
  };
}

