import { createHash, webcrypto } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  encodeLibraryCoreCanonicalValue,
  type LibraryCoreCanonicalValue,
  type LibraryCoreImmutableObjectReferenceV1,
} from "@freed/shared/library-core";
import type { LibraryCoreImmutableReadAdapterV1 } from "./library-core-immutable-publication.js";
import {
  importLibraryCoreIntentSegmentV1,
  prepareLibraryCoreIntentSegmentV1,
} from "./library-core-intent-segments.js";

const subtle = webcrypto.subtle as unknown as SubtleCrypto;
const textDecoder = new TextDecoder();

function canonicalEnvelope(sequence: number): string {
  return textDecoder.decode(
    encodeLibraryCoreCanonicalValue({
      actor_id: "pwa-1",
      actor_sequence: sequence,
      epoch_id: "epoch-1",
      library_id: "library-1",
      operation_id: `operation-${sequence.toLocaleString("en-US", {
        useGrouping: false,
      })}`,
      schema_version: 1,
      signature: "33".repeat(64),
      transaction_id: "transaction-1",
      transaction_member_count: 2,
      transaction_member_index: sequence - 1,
    } as LibraryCoreCanonicalValue),
  );
}

describe("Library Core PWA intent wire segments", () => {
  it("prepares and imports one exact bounded actor tail", async () => {
    const prepared = await prepareLibraryCoreIntentSegmentV1({
      actorId: "pwa-1",
      entries: [1, 2].map((sequence) => ({
        canonicalEnvelopeJson: canonicalEnvelope(sequence),
        intentSequence: sequence,
        operationId: `operation-${sequence.toLocaleString("en-US", {
          useGrouping: false,
        })}`,
      })),
      epochId: "epoch-1",
      libraryId: "library-1",
      previousSegmentDigest: null,
      schemaVersion: 1,
      subtle,
    });
    const reference = {
      descriptor: prepared.object.descriptor,
      transportObjectId: "drive-intent-segment-1",
    } satisfies LibraryCoreImmutableObjectReferenceV1;
    const receipt = await importLibraryCoreIntentSegmentV1({
      actorId: "pwa-1",
      adapter: {
        async readImmutable() {
          return prepared.object.source.slice();
        },
      },
      expectedFirstIntentSequence: 1,
      expectedPreviousSegmentDigest: null,
      libraryId: "library-1",
      reference,
      storageEpoch: "epoch-1",
      subtle,
      writer: {
        async appendIntentSegment(input) {
          expect(input.entries.map((entry) => entry.intent_sequence)).toEqual([
            1, 2,
          ]);
          return {
            actorId: input.header.actor_id,
            firstIntentSequence: input.header.first_intent_sequence,
            importedOperationCount: input.header.operation_count,
            lastIntentSequence: input.header.last_intent_sequence,
            segmentDigest: input.header.segment_digest,
          };
        },
      },
    });

    expect(receipt).toMatchObject({
      actorId: "pwa-1",
      firstIntentSequence: 1,
      importedOperationCount: 2,
      lastIntentSequence: 2,
    });
    expect(prepared.object.descriptor).toMatchObject({
      byteLength: prepared.object.source.byteLength,
      contentDigest: createHash("sha256")
        .update(prepared.object.source)
        .digest("hex"),
      objectKey: expect.stringContaining(
        "freed-v2-intents~library-1~eepoch-1~pwa-1~s1-2~",
      ),
    });
  });

  it("rejects identity drift, changed stored bytes, and a stale actor head", async () => {
    await expect(
      prepareLibraryCoreIntentSegmentV1({
        actorId: "other-actor",
        entries: [
          {
            canonicalEnvelopeJson: canonicalEnvelope(1),
            intentSequence: 1,
            operationId: "operation-1",
          },
        ],
        epochId: "epoch-1",
        libraryId: "library-1",
        previousSegmentDigest: null,
        schemaVersion: 1,
        subtle,
      }),
    ).rejects.toThrow(/identity boundary/);

    const prepared = await prepareLibraryCoreIntentSegmentV1({
      actorId: "pwa-1",
      entries: [1, 2].map((sequence) => ({
        canonicalEnvelopeJson: canonicalEnvelope(sequence),
        intentSequence: sequence,
        operationId: `operation-${sequence.toLocaleString("en-US", {
          useGrouping: false,
        })}`,
      })),
      epochId: "epoch-1",
      libraryId: "library-1",
      previousSegmentDigest: null,
      schemaVersion: 1,
      subtle,
    });
    const reference = {
      descriptor: prepared.object.descriptor,
      transportObjectId: "drive-intent-segment-1",
    };
    const changed = prepared.object.source.slice();
    changed[changed.byteLength - 1] ^= 1;
    const rejectingWriter = {
      async appendIntentSegment() {
        throw new Error("writer must not receive invalid bytes");
      },
    };
    await expect(
      importLibraryCoreIntentSegmentV1({
        actorId: "pwa-1",
        adapter: {
          async readImmutable() {
            return changed;
          },
        } satisfies LibraryCoreImmutableReadAdapterV1,
        expectedFirstIntentSequence: 1,
        expectedPreviousSegmentDigest: null,
        libraryId: "library-1",
        reference,
        storageEpoch: "epoch-1",
        subtle,
        writer: rejectingWriter,
      }),
    ).rejects.toThrow(/bytes/);
    await expect(
      importLibraryCoreIntentSegmentV1({
        actorId: "pwa-1",
        adapter: {
          async readImmutable() {
            return prepared.object.source.slice();
          },
        },
        expectedFirstIntentSequence: 2,
        expectedPreviousSegmentDigest: null,
        libraryId: "library-1",
        reference,
        storageEpoch: "epoch-1",
        subtle,
        writer: rejectingWriter,
      }),
    ).rejects.toThrow(/expected actor head/);
  });
});
