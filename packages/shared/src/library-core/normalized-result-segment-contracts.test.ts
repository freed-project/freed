import { describe, expect, it } from "vitest";
import { encodeLibraryCoreCanonicalValue } from "./canonical-codec.js";
import { createLibraryCoreImmutableObjectKey } from "./immutable-transport-contracts.js";
import {
  normalizedResultSegmentBodyFromRecordsV2,
  normalizedResultSegmentHeaderFromBodyV2,
  parseLibraryCoreNormalizedResultHeadV2,
  parseLibraryCoreNormalizedResultSegmentBodyV2,
  parseLibraryCoreNormalizedResultTransportImportV2,
} from "./normalized-result-segment-contracts.js";

const DIGEST_A = "a".repeat(64);
const DIGEST_B = "b".repeat(64);
const DIGEST_C = "c".repeat(64);

function result(sequence: number, previous: string | null, digest: string) {
  return {
    actor_id: "actor-1",
    authoritative_source_revision: sequence,
    authority_key_id: DIGEST_A,
    canonical_operation_ids: [`operation-${sequence.toLocaleString("en-US", { useGrouping: false })}`],
    epoch: 1,
    epoch_id: "epoch-1",
    format: "freed_follower_result_v1",
    intent_epoch: 1,
    intent_epoch_id: "epoch-1",
    library_id: "library-1",
    original_result_digest: null,
    previous_result_digest: previous,
    receipt_ids: [`receipt-${sequence.toLocaleString("en-US", { useGrouping: false })}`],
    rejection_reason: null,
    replacement_fields: [],
    resolved_at_ms: sequence,
    result_body_digest: digest,
    result_sequence: sequence,
    schema_version: 1,
    signature: "d".repeat(128),
    signature_algorithm: "ed25519",
    status: "accepted",
    transaction_digest: DIGEST_C,
    transaction_id: `transaction-${sequence.toLocaleString("en-US", { useGrouping: false })}`,
  } as const;
}

describe("normalized result segment v2 contracts", () => {
  it("keeps signed result envelopes as the direct bounded records", () => {
    const results = [result(1, null, DIGEST_A), result(2, DIGEST_A, DIGEST_B)];
    const canonicalResultBytes = results.reduce(
      (total, value) =>
        total + encodeLibraryCoreCanonicalValue(value).byteLength,
      0,
    );
    const body = parseLibraryCoreNormalizedResultSegmentBodyV2({
      actor_id: "actor-1",
      canonical_result_bytes: canonicalResultBytes,
      first_result_sequence: 1,
      format: "freed_normalized_result_segment_v2",
      kind: "normalized_result_segment_body",
      last_result_sequence: 2,
      library_id: "library-1",
      previous_segment_digest: null,
      protocol: "normalized_result_segments_v2",
      protocol_version: 2,
      result_count: 2,
      results,
      storage_epoch_id: "epoch-1",
    });
    const header = normalizedResultSegmentHeaderFromBodyV2(body, DIGEST_C);

    expect(normalizedResultSegmentBodyFromRecordsV2(header, results)).toEqual(
      body,
    );
    expect(header).not.toHaveProperty("results");
    expect(results[0]).not.toHaveProperty("canonical_result_json");

    const storedDigest = "e".repeat(64);
    const reference = {
      descriptor: {
        byteLength: canonicalResultBytes,
        contentDigest: storedDigest,
        objectKey: createLibraryCoreImmutableObjectKey({
          actorId: "actor-1",
          digest: storedDigest,
          epochId: "epoch-1",
          firstSequence: 1,
          kind: "result_segment" as const,
          lastSequence: 2,
          libraryId: "library-1",
        }),
      },
      transportObjectId: "transport-1",
    };
    expect(
      parseLibraryCoreNormalizedResultTransportImportV2({
        header,
        receivedAt: 100,
        reference,
        results,
      }),
    ).toMatchObject({ header, receivedAt: 100, reference, results });
    expect(() =>
      parseLibraryCoreNormalizedResultTransportImportV2({
        header,
        receivedAt: 100,
        reference: {
          ...reference,
          descriptor: {
            ...reference.descriptor,
            objectKey: "changed",
          },
        },
        results,
      }),
    ).toThrow(/invalid/);
  });

  it("binds a head to the exact Library, epoch, actor, range, and digest", () => {
    const objectKey = createLibraryCoreImmutableObjectKey({
      actorId: "actor-1",
      digest: DIGEST_A,
      epochId: "epoch-1",
      firstSequence: 1,
      kind: "result_segment",
      lastSequence: 2,
      libraryId: "library-1",
    });
    expect(
      parseLibraryCoreNormalizedResultHeadV2({
        actor_id: "actor-1",
        latest_segment: {
          descriptor: {
            byteLength: 100,
            contentDigest: DIGEST_A,
            objectKey,
          },
          transportObjectId: "transport-1",
        },
        latest_segment_digest: DIGEST_A,
        library_id: "library-1",
        next_result_sequence: 3,
        protocol: "normalized_result_head_v2",
        protocol_version: 2,
        storage_epoch_id: "epoch-1",
      }).next_result_sequence,
    ).toBe(3);
  });

  it("rejects a reordered logical result chain", () => {
    const results = [result(1, null, DIGEST_A), result(2, DIGEST_C, DIGEST_B)];
    const canonicalResultBytes = results.reduce(
      (total, value) =>
        total + encodeLibraryCoreCanonicalValue(value).byteLength,
      0,
    );
    expect(() =>
      parseLibraryCoreNormalizedResultSegmentBodyV2({
        actor_id: "actor-1",
        canonical_result_bytes: canonicalResultBytes,
        first_result_sequence: 1,
        format: "freed_normalized_result_segment_v2",
        kind: "normalized_result_segment_body",
        last_result_sequence: 2,
        library_id: "library-1",
        previous_segment_digest: null,
        protocol: "normalized_result_segments_v2",
        protocol_version: 2,
        result_count: 2,
        results,
        storage_epoch_id: "epoch-1",
      }),
    ).toThrow(/identity boundary/);
  });
});
