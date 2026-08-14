import { describe, expect, it } from "vitest";
import { encodeLibraryCoreCanonicalValue } from "./canonical-codec.js";
import {
  operationSegmentBodyFromRecordsV1,
  operationSegmentHeaderFromBodyV1,
  parseLibraryCoreOperationSegmentBodyV1,
} from "./operation-segment-contracts.js";
import type { LibraryCoreLowercaseHex64 } from "./protocol-scalars.js";

const DIGEST = "ab".repeat(32) as LibraryCoreLowercaseHex64;

function entry(sequence: number) {
  return {
    canonical_envelope: {
      epoch: 1,
      epoch_id: "epoch-1",
      library_id: "library-1",
      operation_id: `operation-${sequence}`,
      value: sequence,
    },
    ingest_sequence: sequence,
    kind: "operation_segment_entry",
    operation_id: `operation-${sequence}`,
  } as const;
}

function body() {
  const entries = [entry(11), entry(12)] as const;
  return parseLibraryCoreOperationSegmentBodyV1({
    base_frontier_digest: "01".repeat(32),
    canonical_envelope_bytes: entries.reduce(
      (total, value) =>
        total +
        encodeLibraryCoreCanonicalValue(value.canonical_envelope).byteLength,
      0,
    ),
    entries,
    epoch: 1,
    epoch_id: "epoch-1",
    first_ingest_sequence: 11,
    format: "freed_operation_segment_v1",
    kind: "operation_segment_body",
    last_ingest_sequence: 12,
    library_id: "library-1",
    operation_count: 2,
    previous_segment_digest: null,
    protocol: "op_segments_v1",
    protocol_version: 1,
    result_frontier_digest: "02".repeat(32),
    schema_version: 1,
  });
}

describe("Library Core operation segment contract", () => {
  it("round trips one closed contiguous segment body and header", () => {
    const parsed = body();
    const header = operationSegmentHeaderFromBodyV1(parsed, DIGEST);
    expect(operationSegmentBodyFromRecordsV1(header, parsed.entries)).toEqual(
      parsed,
    );
    expect(header).toMatchObject({
      first_ingest_sequence: 11,
      last_ingest_sequence: 12,
      operation_count: 2,
      segment_digest: DIGEST,
    });
  });

  it("rejects gaps, envelope identity drift, and declared byte drift", () => {
    const parsed = body();
    expect(() =>
      parseLibraryCoreOperationSegmentBodyV1({
        ...parsed,
        entries: [
          parsed.entries[0],
          { ...parsed.entries[1], ingest_sequence: 13 },
        ],
      }),
    ).toThrow(/contiguous/);
    expect(() =>
      parseLibraryCoreOperationSegmentBodyV1({
        ...parsed,
        entries: [
          parsed.entries[0],
          {
            ...parsed.entries[1],
            canonical_envelope: {
              ...parsed.entries[1]!.canonical_envelope,
              library_id: "other-library",
            },
          },
        ],
      }),
    ).toThrow(/library and epoch/);
    expect(() =>
      parseLibraryCoreOperationSegmentBodyV1({
        ...parsed,
        canonical_envelope_bytes: parsed.canonical_envelope_bytes + 1,
      }),
    ).toThrow(/count and bytes/);
  });
});
