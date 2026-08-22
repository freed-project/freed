import {
  decodeLibraryCoreCanonicalValue,
  encodeLibraryCoreCanonicalValue,
  parseLibraryCoreNormalizedIntentHeadV2,
  parseLibraryCoreNormalizedResultHeadV2,
  type LibraryCoreCanonicalValue,
  type LibraryCoreNormalizedIntentHeadV2,
  type LibraryCoreNormalizedResultHeadV2,
} from "@freed/shared/library-core";
import { describe, expect, it } from "vitest";
import {
  publishLibraryCoreNormalizedIntentSegmentV2,
  publishLibraryCoreNormalizedResultSegmentV2,
  type LibraryCoreNormalizedHeadPublicationAdapterV2,
} from "./library-core-normalized-segment-publication.js";

const ACTOR_ID = "a".repeat(64);
const LIBRARY_ID = "b".repeat(64);
const EPOCH_ID = "c".repeat(64);
const RESULT_DIGEST = "d".repeat(64);

function bytes(value: LibraryCoreCanonicalValue): Uint8Array {
  return encodeLibraryCoreCanonicalValue(value);
}

function publicationAdapter<
  Head extends LibraryCoreNormalizedIntentHeadV2 | LibraryCoreNormalizedResultHeadV2,
>(
  initialHead: Head,
  responseLoss = false,
): LibraryCoreNormalizedHeadPublicationAdapterV2<Head> {
  let current = {
    bytes: bytes(initialHead as unknown as LibraryCoreCanonicalValue),
    head: initialHead,
    revision: "revision-1",
  };
  let stored:
    | Readonly<{
        descriptor: Parameters<
          LibraryCoreNormalizedHeadPublicationAdapterV2<Head>["putImmutable"]
        >[0]["descriptor"];
        source: Uint8Array;
      }>
    | undefined;
  return {
    async compareAndSwapHead(input) {
      if (input.expectedRevision !== current.revision) {
        return { current, status: "conflict" } as const;
      }
      current = {
        bytes: input.bytes,
        head: decodeLibraryCoreCanonicalValue(input.bytes) as unknown as Head,
        revision: "revision-2",
      };
      if (responseLoss) throw new Error("simulated response loss");
      return { status: "committed" } as const;
    },
    async putImmutable(object) {
      stored = object;
      return { transportObjectId: "transport-1" };
    },
    async readHead() {
      return current;
    },
    async verifyImmutable(input) {
      if (
        stored === undefined ||
        input.transportObjectId !== "transport-1" ||
        input.descriptor !== stored.descriptor
      ) {
        throw new Error("immutable verification changed");
      }
      return input.descriptor;
    },
  };
}

function intentEnvelope() {
  return {
    actor_chain_digest: "1".repeat(64),
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
    payload_digest: "e".repeat(64),
    previous_actor_chain_digest: "0".repeat(64),
    previous_actor_operation_id: null,
    schema_version: 1,
    signature: "f".repeat(128),
    signature_algorithm: "ed25519",
    transaction_digest: "9".repeat(64),
    transaction_id: "transaction-1",
    transaction_member_count: 1,
    transaction_member_index: 0,
  } as const;
}

function resultEnvelope() {
  return {
    actor_id: ACTOR_ID,
    authoritative_source_revision: 1,
    authority_key_id: "1".repeat(64),
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
    resolved_at_ms: 1,
    result_body_digest: RESULT_DIGEST,
    result_sequence: 1,
    schema_version: 1,
    signature: "2".repeat(128),
    signature_algorithm: "ed25519",
    status: "accepted",
    transaction_digest: "3".repeat(64),
    transaction_id: "transaction-1",
  } as const;
}

describe("normalized segment publication v2", () => {
  it("publishes one bounded intent page against the exact actor head", async () => {
    const head = parseLibraryCoreNormalizedIntentHeadV2({
      actor_id: ACTOR_ID,
      latest_segment: null,
      latest_segment_digest: null,
      library_id: LIBRARY_ID,
      next_actor_counter: 1,
      protocol: "normalized_intent_head_v2",
      protocol_version: 2,
      storage_epoch_id: EPOCH_ID,
    });
    const published = await publishLibraryCoreNormalizedIntentSegmentV2({
      adapter: publicationAdapter(head),
      canonicalEnvelopes: [
        encodeLibraryCoreCanonicalValue(intentEnvelope()),
      ],
      subtle: crypto.subtle,
    });
    expect(published.status).toBe("committed");
    expect(published.publishedHead.next_actor_counter).toBe(2);
    expect(published.segmentReference.descriptor.objectKey).toContain("~s1-1~");
  });

  it("recovers an exact result-head commit after response loss", async () => {
    const head = parseLibraryCoreNormalizedResultHeadV2({
      actor_id: ACTOR_ID,
      latest_segment: null,
      latest_segment_digest: null,
      library_id: LIBRARY_ID,
      next_result_sequence: 1,
      protocol: "normalized_result_head_v2",
      protocol_version: 2,
      storage_epoch_id: EPOCH_ID,
    });
    const published = await publishLibraryCoreNormalizedResultSegmentV2({
      adapter: publicationAdapter(head, true),
      canonicalResults: [encodeLibraryCoreCanonicalValue(resultEnvelope())],
      subtle: crypto.subtle,
    });
    expect(published.status).toBe("recovered_after_response_loss");
    expect(published.publishedHead.next_result_sequence).toBe(2);
  });
});
