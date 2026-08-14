import { describe, expect, it } from "vitest";
import { encodeLibraryCoreCanonicalValue } from "./canonical-codec.js";
import {
  intentSegmentBodyFromRecordsV1,
  intentSegmentHeaderFromBodyV1,
  libraryCoreIntentSegmentRecordIdentityV1,
  parseLibraryCoreIntentHeadV1,
  parseLibraryCoreIntentSegmentBodyV1,
  parseLibraryCoreIntentSegmentEntryV1,
} from "./intent-segment-contracts.js";

const DIGEST = "11".repeat(32);
const STORED_DIGEST = "22".repeat(32);
const LIBRARY_ID = "library-1";
const EPOCH_ID = "epoch-1";
const ACTOR_ID = "pwa-1";

function entry(sequence: number) {
  return {
    canonical_envelope: {
      actor_id: ACTOR_ID,
      actor_sequence: sequence,
      epoch_id: EPOCH_ID,
      library_id: LIBRARY_ID,
      operation_id: `operation-${sequence.toLocaleString("en-US", {
        useGrouping: false,
      })}`,
      schema_version: 1,
      signature: "33".repeat(64),
      transaction_id: "transaction-1",
      transaction_member_count: 2,
      transaction_member_index: sequence - 1,
    },
    intent_sequence: sequence,
    kind: "intent_segment_entry",
    operation_id: `operation-${sequence.toLocaleString("en-US", {
      useGrouping: false,
    })}`,
  } as const;
}

function body() {
  const entries = [entry(1), entry(2)];
  const canonicalEnvelopeBytes = entries.reduce(
    (total, value) =>
      total +
      encodeLibraryCoreCanonicalValue(value.canonical_envelope).byteLength,
    0,
  );
  return parseLibraryCoreIntentSegmentBodyV1({
    actor_id: ACTOR_ID,
    canonical_envelope_bytes: canonicalEnvelopeBytes,
    entries,
    epoch_id: EPOCH_ID,
    first_intent_sequence: 1,
    format: "freed_intent_segment_v1",
    kind: "intent_segment_body",
    last_intent_sequence: 2,
    library_id: LIBRARY_ID,
    operation_count: 2,
    previous_segment_digest: null,
    protocol: "intent_segments_v1",
    protocol_version: 1,
    schema_version: 1,
  });
}

describe("Library Core PWA intent segment contract", () => {
  it("binds contiguous actor sequences, immutable segment identity, and the mutable actor head", () => {
    const parsedBody = body();
    const header = intentSegmentHeaderFromBodyV1(parsedBody, DIGEST);

    expect(
      intentSegmentBodyFromRecordsV1(header, parsedBody.entries),
    ).toStrictEqual(parsedBody);
    expect(libraryCoreIntentSegmentRecordIdentityV1(header)).toBe("header");
    expect(
      libraryCoreIntentSegmentRecordIdentityV1(parsedBody.entries[1]!),
    ).toBe("intent:2:operation-2");

    expect(
      parseLibraryCoreIntentHeadV1({
        actor_id: ACTOR_ID,
        epoch_id: EPOCH_ID,
        latest_segment: {
          descriptor: {
            byteLength: 512,
            contentDigest: STORED_DIGEST,
            objectKey: `freed-v2-intents~${LIBRARY_ID}~e${EPOCH_ID}~${ACTOR_ID}~s1-2~${STORED_DIGEST}.fseg.gz`,
          },
          transportObjectId: "drive-intent-segment-1",
        },
        latest_segment_digest: STORED_DIGEST,
        library_id: LIBRARY_ID,
        next_intent_sequence: 3,
        protocol: "intent_head_v1",
        protocol_version: 1,
        schema_version: 1,
      }),
    ).toMatchObject({
      actor_id: ACTOR_ID,
      epoch_id: EPOCH_ID,
      next_intent_sequence: 3,
    });
  });

  it("fails closed on identity drift, gaps, changed counts, and inconsistent head references", () => {
    expect(() =>
      parseLibraryCoreIntentSegmentEntryV1({
        ...entry(1),
        intent_sequence: 2,
      }),
    ).toThrow(/identity/);
    expect(() =>
      parseLibraryCoreIntentSegmentBodyV1({
        ...body(),
        entries: [entry(1), entry(3)],
      }),
    ).toThrow(/reordered/);
    expect(() =>
      parseLibraryCoreIntentSegmentBodyV1({
        ...body(),
        entries: [entry(1)],
        last_intent_sequence: 1,
        operation_count: 1,
        canonical_envelope_bytes: encodeLibraryCoreCanonicalValue(
          entry(1).canonical_envelope,
        ).byteLength,
      }),
    ).toThrow(/complete contiguous transactions/);
    expect(() =>
      parseLibraryCoreIntentSegmentBodyV1({
        ...body(),
        operation_count: 3,
      }),
    ).toThrow(/sequence or byte bounds/);
    expect(() =>
      parseLibraryCoreIntentHeadV1({
        actor_id: ACTOR_ID,
        epoch_id: EPOCH_ID,
        latest_segment: null,
        latest_segment_digest: null,
        library_id: LIBRARY_ID,
        next_intent_sequence: 2,
        protocol: "intent_head_v1",
        protocol_version: 1,
        schema_version: 1,
      }),
    ).toThrow(/empty intent head/);
    expect(() =>
      parseLibraryCoreIntentHeadV1({
        actor_id: ACTOR_ID,
        epoch_id: EPOCH_ID,
        latest_segment: {
          descriptor: {
            byteLength: 512,
            contentDigest: STORED_DIGEST,
            objectKey: `freed-v2-intents~${LIBRARY_ID}~e${EPOCH_ID}~other-actor~s1-2~${STORED_DIGEST}.fseg.gz`,
          },
          transportObjectId: "drive-intent-segment-1",
        },
        latest_segment_digest: STORED_DIGEST,
        library_id: LIBRARY_ID,
        next_intent_sequence: 3,
        protocol: "intent_head_v1",
        protocol_version: 1,
        schema_version: 1,
      }),
    ).toThrow(/does not match/);
  });
});
