import {
  decodeLibraryCoreCanonicalValue,
  encodeLibraryCoreCanonicalValue,
  type LibraryCoreCanonicalValue,
  type LibraryCoreImmutableObjectReferenceV1,
  type LibraryCoreLowercaseHex64,
} from "@freed/shared/library-core";
import { describe, expect, it } from "vitest";
import {
  importLibraryCoreNormalizedIntentSegmentV2,
  prepareLibraryCoreNormalizedIntentSegmentV2,
} from "./library-core-normalized-intent-segments.js";
import { decodeLibraryCoreWireObjectV1 } from "./library-core-wire-object.js";

const ACTOR_ID = "a".repeat(64);
const LIBRARY_ID = "b".repeat(64);
const EPOCH_ID = "c".repeat(64);
const TRANSACTION_DIGEST = "d".repeat(64);
const PREVIOUS_SEGMENT_DIGEST = "9".repeat(
  64,
) as LibraryCoreLowercaseHex64;

function envelope(input: {
  actorChainDigest: string;
  actorSequence: number;
  memberIndex: number;
  operationId: string;
  previousActorChainDigest: string;
  previousOperationId: string;
}) {
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
    transaction_id: "transaction-1",
    transaction_member_count: 4,
    transaction_member_index: input.memberIndex,
  } as const;
}

describe("normalized intent segments v2", () => {
  it("round trips an exact partial transaction without a legacy entry wrapper", async () => {
    const first = envelope({
      actorChainDigest: "1".repeat(64),
      actorSequence: 10,
      memberIndex: 1,
      operationId: "operation-10",
      previousActorChainDigest: "0".repeat(64),
      previousOperationId: "operation-9",
    });
    const second = envelope({
      actorChainDigest: "2".repeat(64),
      actorSequence: 11,
      memberIndex: 2,
      operationId: "operation-11",
      previousActorChainDigest: first.actor_chain_digest,
      previousOperationId: first.operation_id,
    });
    const canonicalEnvelopes = [
      encodeLibraryCoreCanonicalValue(first),
      encodeLibraryCoreCanonicalValue(second),
    ];
    const prepared = await prepareLibraryCoreNormalizedIntentSegmentV2({
      actorId: ACTOR_ID,
      canonicalEnvelopes,
      libraryId: LIBRARY_ID,
      previousSegmentDigest: PREVIOUS_SEGMENT_DIGEST,
      storageEpochId: EPOCH_ID,
      subtle: crypto.subtle,
    });
    const records = await decodeLibraryCoreWireObjectV1(
      prepared.object.source,
      {
        kind: "intents",
        maximumDecodedBytes: 1_180_180,
        maximumRecordBytes: 131_072,
        maximumRecords: 129,
        recordIdentity(value) {
          const record = value as Record<string, LibraryCoreCanonicalValue>;
          return record.kind === "normalized_intent_segment_header"
            ? "header"
            : `intent:${String(record.actor_sequence)}`;
        },
      },
    );
    expect(records).toHaveLength(3);
    expect(records[1]).toEqual(
      decodeLibraryCoreCanonicalValue(canonicalEnvelopes[0]!),
    );
    expect(records[1]).not.toHaveProperty("canonical_envelope");

    const reference: LibraryCoreImmutableObjectReferenceV1 = {
      descriptor: prepared.object.descriptor,
      transportObjectId: "transport-1",
    };
    const staged: Uint8Array[][] = [];
    await importLibraryCoreNormalizedIntentSegmentV2({
      actorId: ACTOR_ID,
      adapter: {
        async readImmutable() {
          return prepared.object.source;
        },
      },
      expectedFirstActorCounter: 10,
      expectedPreviousSegmentDigest: PREVIOUS_SEGMENT_DIGEST,
      libraryId: LIBRARY_ID,
      reference,
      storageEpochId: EPOCH_ID,
      subtle: crypto.subtle,
      writer: {
        async stageNormalizedIntentSegment(input) {
          staged.push(input.canonicalEnvelopes.map((bytes) => bytes.slice()));
          expect(input.envelopes.map((value) => value.transaction_member_index)).toEqual([
            1, 2,
          ]);
        },
      },
    });
    expect(staged).toEqual([canonicalEnvelopes]);
  });

  it("rejects an immutable object whose stored bytes changed", async () => {
    const value = envelope({
      actorChainDigest: "1".repeat(64),
      actorSequence: 10,
      memberIndex: 1,
      operationId: "operation-10",
      previousActorChainDigest: "0".repeat(64),
      previousOperationId: "operation-9",
    });
    const prepared = await prepareLibraryCoreNormalizedIntentSegmentV2({
      actorId: ACTOR_ID,
      canonicalEnvelopes: [encodeLibraryCoreCanonicalValue(value)],
      libraryId: LIBRARY_ID,
      previousSegmentDigest: PREVIOUS_SEGMENT_DIGEST,
      storageEpochId: EPOCH_ID,
      subtle: crypto.subtle,
    });
    const reference: LibraryCoreImmutableObjectReferenceV1 = {
      descriptor: prepared.object.descriptor,
      transportObjectId: "transport-1",
    };
    const changed = prepared.object.source.slice();
    changed[changed.byteLength - 1] ^= 1;
    await expect(
      importLibraryCoreNormalizedIntentSegmentV2({
        actorId: ACTOR_ID,
        adapter: {
          async readImmutable() {
            return changed;
          },
        },
        expectedFirstActorCounter: 10,
        expectedPreviousSegmentDigest: PREVIOUS_SEGMENT_DIGEST,
        libraryId: LIBRARY_ID,
        reference,
        storageEpochId: EPOCH_ID,
        subtle: crypto.subtle,
        writer: {
          async stageNormalizedIntentSegment() {
            throw new Error("must not stage changed bytes");
          },
        },
      }),
    ).rejects.toThrow(/descriptor/);
  });
});
