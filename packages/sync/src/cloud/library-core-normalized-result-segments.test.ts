import {
  decodeLibraryCoreCanonicalValue,
  encodeLibraryCoreCanonicalValue,
  type LibraryCoreCanonicalValue,
  type LibraryCoreImmutableObjectReferenceV1,
  type LibraryCoreLowercaseHex64,
} from "@freed/shared/library-core";
import { describe, expect, it } from "vitest";
import {
  importLibraryCoreNormalizedResultSegmentV2,
  prepareLibraryCoreNormalizedResultSegmentV2,
} from "./library-core-normalized-result-segments.js";
import { decodeLibraryCoreWireObjectV1 } from "./library-core-wire-object.js";

const DIGEST_A = "a".repeat(64) as LibraryCoreLowercaseHex64;
const DIGEST_B = "b".repeat(64) as LibraryCoreLowercaseHex64;
const DIGEST_C = "c".repeat(64) as LibraryCoreLowercaseHex64;

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

describe("normalized result segments v2", () => {
  it("round trips exact signed result records without a legacy summary wrapper", async () => {
    const canonicalResults = [
      encodeLibraryCoreCanonicalValue(result(1, null, DIGEST_A)),
      encodeLibraryCoreCanonicalValue(result(2, DIGEST_A, DIGEST_B)),
    ];
    const prepared = await prepareLibraryCoreNormalizedResultSegmentV2({
      actorId: "actor-1",
      canonicalResults,
      libraryId: "library-1",
      previousSegmentDigest: null,
      storageEpochId: "epoch-1",
      subtle: crypto.subtle,
    });
    const records = await decodeLibraryCoreWireObjectV1(
      prepared.object.source,
      {
        kind: "results",
        maximumDecodedBytes: 1_180_180,
        maximumRecordBytes: 131_072,
        maximumRecords: 129,
        recordIdentity(value) {
          const record = value as Record<string, LibraryCoreCanonicalValue>;
          return record.kind === "normalized_result_segment_header"
            ? "header"
            : `result:${String(record.result_sequence)}`;
        },
      },
    );
    expect(records).toHaveLength(3);
    expect(records[1]).toEqual(
      decodeLibraryCoreCanonicalValue(canonicalResults[0]!),
    );
    expect(records[1]).not.toHaveProperty("canonical_result_json");

    const reference: LibraryCoreImmutableObjectReferenceV1 = {
      descriptor: prepared.object.descriptor,
      transportObjectId: "transport-1",
    };
    const appended: Uint8Array[][] = [];
    await importLibraryCoreNormalizedResultSegmentV2({
      actorId: "actor-1",
      adapter: {
        async readImmutable() {
          return prepared.object.source;
        },
      },
      expectedFirstResultSequence: 1,
      expectedPreviousSegmentDigest: null,
      libraryId: "library-1",
      reference,
      storageEpochId: "epoch-1",
      subtle: crypto.subtle,
      writer: {
        async appendNormalizedResultSegment(input) {
          appended.push(input.canonicalResults.map((bytes) => bytes.slice()));
        },
      },
    });
    expect(appended).toEqual([canonicalResults]);
  });

  it("rejects a segment that does not extend the expected transport chain", async () => {
    const prepared = await prepareLibraryCoreNormalizedResultSegmentV2({
      actorId: "actor-1",
      canonicalResults: [
        encodeLibraryCoreCanonicalValue(result(1, null, DIGEST_A)),
      ],
      libraryId: "library-1",
      previousSegmentDigest: null,
      storageEpochId: "epoch-1",
      subtle: crypto.subtle,
    });
    const reference: LibraryCoreImmutableObjectReferenceV1 = {
      descriptor: prepared.object.descriptor,
      transportObjectId: "transport-1",
    };
    await expect(
      importLibraryCoreNormalizedResultSegmentV2({
        actorId: "actor-1",
        adapter: {
          async readImmutable() {
            return prepared.object.source;
          },
        },
        expectedFirstResultSequence: 2,
        expectedPreviousSegmentDigest: DIGEST_B,
        libraryId: "library-1",
        reference,
        storageEpochId: "epoch-1",
        subtle: crypto.subtle,
        writer: {
          async appendNormalizedResultSegment() {
            throw new Error("must not write a mismatched result segment");
          },
        },
      }),
    ).rejects.toThrow(/authority or segment chain/);
  });
});
