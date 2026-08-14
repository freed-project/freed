import { createHash, webcrypto } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  encodeLibraryCoreCanonicalValue,
  type LibraryCoreCanonicalValue,
  type LibraryCoreImmutableObjectReferenceV1,
  type LibraryCoreLowercaseHex64,
} from "@freed/shared/library-core";
import type { LibraryCoreImmutableReadAdapterV1 } from "./library-core-immutable-publication.js";
import {
  importLibraryCoreOperationSegmentV1,
  prepareLibraryCoreOperationSegmentV1,
} from "./library-core-operation-segments.js";

const subtle = webcrypto.subtle as unknown as SubtleCrypto;
const BASE_FRONTIER = "01".repeat(32) as LibraryCoreLowercaseHex64;
const RESULT_FRONTIER = "02".repeat(32) as LibraryCoreLowercaseHex64;
const textDecoder = new TextDecoder();

function canonicalEnvelope(sequence: number): string {
  return textDecoder.decode(
    encodeLibraryCoreCanonicalValue({
      actor_id: "10".repeat(32),
      actor_sequence: sequence,
      epoch: 1,
      epoch_id: "epoch-1",
      library_id: "library-1",
      operation_id: `operation-${sequence}`,
      payload: { read_at_ms: 1_783_000_000_000 + sequence },
    } as LibraryCoreCanonicalValue),
  );
}

function digest(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

describe("Library Core operation segments", () => {
  it("rejects an oversized outbox batch before decoding its entries", async () => {
    await expect(
      prepareLibraryCoreOperationSegmentV1({
        baseFrontierDigest: BASE_FRONTIER,
        entries: Array.from({ length: 1_001 }, (_, index) => ({
          canonicalEnvelopeJson: "not canonical JSON",
          ingestSequence: index + 1,
          operationId: `operation-${index + 1}`,
        })),
        epoch: 1,
        epochId: "epoch-1",
        libraryId: "library-1",
        previousSegmentDigest: null,
        resultFrontierDigest: RESULT_FRONTIER,
        schemaVersion: 1,
        subtle,
      }),
    ).rejects.toThrow(/1 through 1,000 outbox entries/);
  });

  it("prepares and imports an exact bounded outbox tail", async () => {
    const prepared = await prepareLibraryCoreOperationSegmentV1({
      baseFrontierDigest: BASE_FRONTIER,
      entries: [
        {
          canonicalEnvelopeJson: canonicalEnvelope(11),
          ingestSequence: 11,
          operationId: "operation-11",
        },
        {
          canonicalEnvelopeJson: canonicalEnvelope(12),
          ingestSequence: 12,
          operationId: "operation-12",
        },
      ],
      epoch: 1,
      epochId: "epoch-1",
      libraryId: "library-1",
      previousSegmentDigest: null,
      resultFrontierDigest: RESULT_FRONTIER,
      schemaVersion: 1,
      subtle,
    });
    const reference = {
      descriptor: prepared.object.descriptor,
      transportObjectId: "drive-operation-segment-1",
    } satisfies LibraryCoreImmutableObjectReferenceV1;
    let appended = false;
    const receipt = await importLibraryCoreOperationSegmentV1({
      adapter: {
        async readImmutable() {
          return prepared.object.source.slice();
        },
      },
      expectedBaseFrontierDigest: BASE_FRONTIER,
      expectedFirstIngestSequence: 11,
      expectedPreviousSegmentDigest: null,
      libraryId: "library-1",
      reference,
      storageEpoch: "epoch-1",
      subtle,
      writer: {
        async appendOperationSegment(input) {
          appended = true;
          expect(input.entries.map((entry) => entry.ingest_sequence)).toEqual([
            11, 12,
          ]);
          return {
            firstIngestSequence: input.header.first_ingest_sequence,
            importedOperationCount: input.header.operation_count,
            lastIngestSequence: input.header.last_ingest_sequence,
            resultFrontierDigest: input.header.result_frontier_digest,
            segmentDigest: input.header.segment_digest,
          };
        },
      },
    });
    expect(appended).toBe(true);
    expect(receipt).toMatchObject({
      firstIngestSequence: 11,
      importedOperationCount: 2,
      lastIngestSequence: 12,
      resultFrontierDigest: RESULT_FRONTIER,
    });
    expect(prepared.object.descriptor).toMatchObject({
      byteLength: prepared.object.source.byteLength,
      contentDigest: digest(prepared.object.source),
    });
  });

  it("rejects changed stored bytes and a tail attached at the wrong sequence", async () => {
    const prepared = await prepareLibraryCoreOperationSegmentV1({
      baseFrontierDigest: BASE_FRONTIER,
      entries: [
        {
          canonicalEnvelopeJson: canonicalEnvelope(11),
          ingestSequence: 11,
          operationId: "operation-11",
        },
      ],
      epoch: 1,
      epochId: "epoch-1",
      libraryId: "library-1",
      previousSegmentDigest: null,
      resultFrontierDigest: RESULT_FRONTIER,
      schemaVersion: 1,
      subtle,
    });
    const reference = {
      descriptor: prepared.object.descriptor,
      transportObjectId: "drive-operation-segment-1",
    };
    const changed = prepared.object.source.slice();
    changed[changed.byteLength - 1] ^= 1;
    const adapter = {
      async readImmutable() {
        return changed;
      },
    } satisfies LibraryCoreImmutableReadAdapterV1;
    const writer = {
      async appendOperationSegment() {
        throw new Error("writer must not receive invalid bytes");
      },
    };
    await expect(
      importLibraryCoreOperationSegmentV1({
        adapter,
        expectedBaseFrontierDigest: BASE_FRONTIER,
        expectedFirstIngestSequence: 11,
        expectedPreviousSegmentDigest: null,
        libraryId: "library-1",
        reference,
        storageEpoch: "epoch-1",
        subtle,
        writer,
      }),
    ).rejects.toThrow(/stored bytes/);
    await expect(
      importLibraryCoreOperationSegmentV1({
        adapter: {
          async readImmutable() {
            return prepared.object.source.slice();
          },
        },
        expectedBaseFrontierDigest: BASE_FRONTIER,
        expectedFirstIngestSequence: 12,
        expectedPreviousSegmentDigest: null,
        libraryId: "library-1",
        reference,
        storageEpoch: "epoch-1",
        subtle,
        writer,
      }),
    ).rejects.toThrow(/expected checkpoint tail/);
  });
});
