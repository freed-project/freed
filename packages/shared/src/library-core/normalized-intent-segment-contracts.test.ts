import { describe, expect, it } from "vitest";
import { encodeLibraryCoreCanonicalValue } from "./canonical-codec.js";
import {
  parseLibraryCoreNormalizedIntentSegmentBodyV2,
  type LibraryCoreNormalizedIntentEnvelopeRecordV2,
} from "./normalized-intent-segment-contracts.js";

const ACTOR_ID = "a".repeat(64);
const LIBRARY_ID = "b".repeat(64);
const EPOCH_ID = "c".repeat(64);
const TRANSACTION_DIGEST = "d".repeat(64);

function envelope(input: {
  actorChainDigest: string;
  actorSequence: number;
  memberCount: number;
  memberIndex: number;
  operationId: string;
  previousActorChainDigest: string;
  previousOperationId: string | null;
  transactionId?: string;
}): LibraryCoreNormalizedIntentEnvelopeRecordV2 {
  return {
    actor_chain_digest: input.actorChainDigest,
    actor_id: ACTOR_ID,
    actor_sequence: input.actorSequence,
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
    operation_id: input.operationId,
    operation_type: "feed_item_read_assignment",
    payload: { read_at_ms: 1 },
    payload_digest: "e".repeat(64),
    previous_actor_chain_digest: input.previousActorChainDigest,
    previous_actor_operation_id: input.previousOperationId,
    schema_version: 1,
    signature: "f".repeat(128),
    signature_algorithm: "ed25519",
    transaction_digest: TRANSACTION_DIGEST,
    transaction_id: input.transactionId ?? "transaction-1",
    transaction_member_count: input.memberCount,
    transaction_member_index: input.memberIndex,
  } as unknown as LibraryCoreNormalizedIntentEnvelopeRecordV2;
}

function body(envelopes: readonly LibraryCoreNormalizedIntentEnvelopeRecordV2[]) {
  return {
    actor_id: ACTOR_ID,
    canonical_envelope_bytes: envelopes.reduce(
      (total, value) => total + encodeLibraryCoreCanonicalValue(value).byteLength,
      0,
    ),
    envelopes,
    first_actor_counter: envelopes[0]!.actor_sequence,
    format: "freed_normalized_intent_segment_v2",
    kind: "normalized_intent_segment_body",
    last_actor_counter: envelopes.at(-1)!.actor_sequence,
    library_id: LIBRARY_ID,
    previous_segment_digest: "9".repeat(64),
    protocol: "normalized_intent_segments_v2",
    protocol_version: 2,
    record_count: envelopes.length,
    storage_epoch_id: EPOCH_ID,
  };
}

describe("normalized intent segment v2 contracts", () => {
  it("accepts a bounded middle slice of one larger atomic transaction", () => {
    const first = envelope({
      actorChainDigest: "1".repeat(64),
      actorSequence: 10,
      memberCount: 4,
      memberIndex: 1,
      operationId: "operation-10",
      previousActorChainDigest: "0".repeat(64),
      previousOperationId: "operation-9",
    });
    const second = envelope({
      actorChainDigest: "2".repeat(64),
      actorSequence: 11,
      memberCount: 4,
      memberIndex: 2,
      operationId: "operation-11",
      previousActorChainDigest: first.actor_chain_digest,
      previousOperationId: first.operation_id,
    });

    const parsed = parseLibraryCoreNormalizedIntentSegmentBodyV2(
      body([first, second]),
    );
    expect(parsed.first_actor_counter).toBe(10);
    expect(parsed.envelopes.map((value) => value.transaction_member_index)).toEqual([
      1, 2,
    ]);
  });

  it("rejects a transaction switch before the prior transaction is complete", () => {
    const first = envelope({
      actorChainDigest: "1".repeat(64),
      actorSequence: 10,
      memberCount: 4,
      memberIndex: 1,
      operationId: "operation-10",
      previousActorChainDigest: "0".repeat(64),
      previousOperationId: "operation-9",
    });
    const second = envelope({
      actorChainDigest: "2".repeat(64),
      actorSequence: 11,
      memberCount: 1,
      memberIndex: 0,
      operationId: "operation-11",
      previousActorChainDigest: first.actor_chain_digest,
      previousOperationId: first.operation_id,
      transactionId: "transaction-2",
    });

    expect(() =>
      parseLibraryCoreNormalizedIntentSegmentBodyV2(body([first, second])),
    ).toThrow(/transaction boundary/);
  });

  it("rejects an actor-chain discontinuity inside one transport page", () => {
    const first = envelope({
      actorChainDigest: "1".repeat(64),
      actorSequence: 10,
      memberCount: 4,
      memberIndex: 1,
      operationId: "operation-10",
      previousActorChainDigest: "0".repeat(64),
      previousOperationId: "operation-9",
    });
    const second = envelope({
      actorChainDigest: "2".repeat(64),
      actorSequence: 11,
      memberCount: 4,
      memberIndex: 2,
      operationId: "operation-11",
      previousActorChainDigest: "8".repeat(64),
      previousOperationId: first.operation_id,
    });

    expect(() =>
      parseLibraryCoreNormalizedIntentSegmentBodyV2(body([first, second])),
    ).toThrow(/actor chain/);
  });
});
