import { describe, expect, it } from "vitest";
import { encodeLibraryCoreCanonicalValue } from "./canonical-codec.js";
import {
  createLibraryCoreNormalizedCheckpointRecordV2,
  createLibraryCoreNormalizedCheckpointDigestAccumulatorV2,
  digestLibraryCoreNormalizedCheckpointRecordsV2,
  encodeLibraryCoreNormalizedCheckpointRecordV2,
  libraryCoreNormalizedCheckpointRecordIdentityV2,
  parseLibraryCoreNormalizedCheckpointRecordV2,
  parseLibraryCoreNormalizedCheckpointExportDescriptorV2,
  parseLibraryCoreNormalizedCheckpointExportPageV2,
  reassembleLibraryCoreContentV1,
  splitLibraryCoreContentV1,
} from "./normalized-checkpoint-contracts.js";
import {
  LIBRARY_CORE_CHECKPOINT_RECORD_MAXIMUM_CANONICAL_BYTES,
  LIBRARY_CORE_CHECKPOINT_RECORD_REGISTRY,
} from "./sqlite-contract.generated.js";

describe("normalized SQLite checkpoint contract", () => {
  it("closes and verifies the native pinned export boundary", () => {
    const libraryId = "ab".repeat(32);
    const authorityEpoch = "cd".repeat(32);
    const record = createLibraryCoreNormalizedCheckpointRecordV2({
      registryKey: "00_checkpoint_header",
      primaryKey: "checkpoint",
      payload: {
        authorityEpoch,
        checkpointId: `${libraryId}:${authorityEpoch}:7`,
        createdAtMs: 1_000,
        libraryId,
        schemaVersion: 1,
        sourceRevision: 7,
      },
    });
    expect(
      parseLibraryCoreNormalizedCheckpointExportDescriptorV2({
        format: "freed_normalized_checkpoint_export_v2",
        protocolVersion: 2,
        libraryId,
        authorityEpoch,
        writerId: "ef".repeat(32),
        sourceRevision: 7,
        causalFrontierDigest: "12".repeat(32),
        recordCount: 1,
        itemCount: 0,
      }),
    ).toMatchObject({ sourceRevision: 7, recordCount: 1 });
    expect(
      parseLibraryCoreNormalizedCheckpointExportPageV2({
        records: [record],
        nextCursor: {
          registryKey: "00_checkpoint_header",
          primaryKeyJson: '"checkpoint"',
        },
        done: true,
        canonicalRecordBytes:
          encodeLibraryCoreNormalizedCheckpointRecordV2(record).byteLength,
      }),
    ).toMatchObject({ done: true, records: [record] });
  });

  it("matches the native normalized checkpoint digest vector", () => {
    const header = createLibraryCoreNormalizedCheckpointRecordV2({
      registryKey: "00_checkpoint_header",
      primaryKey: "checkpoint",
      payload: {
        authorityEpoch: "epoch-1",
        checkpointId: "library-1:epoch-1:7",
        createdAtMs: 1_000,
        libraryId: "library-1",
        schemaVersion: 1,
        sourceRevision: 7,
      },
    });
    expect(digestLibraryCoreNormalizedCheckpointRecordsV2([header])).toBe(
      "ce8a03cfece925243956fa104b7b583139da09036a14a1d7615a8994891d4104",
    );
    const accumulator =
      createLibraryCoreNormalizedCheckpointDigestAccumulatorV2();
    accumulator.push(header);
    expect(accumulator.finish()).toEqual({
      canonicalBytes:
        encodeLibraryCoreNormalizedCheckpointRecordV2(header).byteLength,
      checkpointDigest:
        "ce8a03cfece925243956fa104b7b583139da09036a14a1d7615a8994891d4104",
      recordCount: 1,
    });
  });

  it("has stable registry plus typed primary-key identity and no shell record", () => {
    expect(
      LIBRARY_CORE_CHECKPOINT_RECORD_REGISTRY.some(
        (entry) =>
          entry.registryKey.includes("shell") ||
          entry.payload.includes("shell"),
      ),
    ).toBe(false);
    const record = createLibraryCoreNormalizedCheckpointRecordV2({
      registryKey: "13_feed_item_tag",
      primaryKey: ["item:one", "favorite"],
      payload: { tag: "favorite" },
    });
    expect(libraryCoreNormalizedCheckpointRecordIdentityV2(record)).toBe(
      '13_feed_item_tag:["item:one","favorite"]',
    );
  });

  it("represents a legal maximum-sized item as bounded content records", () => {
    const bytes = Uint8Array.from(
      { length: 4_194_304 },
      (_, index) => (index * 31 + 17) % 251,
    );
    const records = splitLibraryCoreContentV1({
      bytes,
      mediaType: "application/json",
    });
    expect(records).toHaveLength(65);
    expect(
      records.every(
        (record) =>
          encodeLibraryCoreCanonicalValue(
            record as unknown as {
              readonly [
                key: string
              ]: import("./canonical-codec.js").LibraryCoreCanonicalValue;
            },
          ).byteLength <=
          LIBRARY_CORE_CHECKPOINT_RECORD_MAXIMUM_CANONICAL_BYTES,
      ),
    ).toBe(true);
    expect(
      records.some(
        (record) => String(record.registryKey) === "00_library_shell",
      ),
    ).toBe(false);
    expect(reassembleLibraryCoreContentV1(records)).toEqual(bytes);
  }, 15_000);

  it("keeps maximum metadata rows below the logical wire-record ceiling", () => {
    const records = [
      createLibraryCoreNormalizedCheckpointRecordV2({
        registryKey: "30_person",
        primaryKey: "person:maximum-metadata",
        payload: {
          avatarUrl: null,
          bio: "p".repeat(65_000),
          careLevel: 5,
          createdAt: 1,
          name: "Maximum Metadata",
          notes: null,
          reachOutIntervalDays: null,
          relationshipStatus: "friend",
          sampleBatchId: null,
          sampleGeneratedAt: null,
          sampleGeneratorVersion: null,
          updatedAt: 2,
        },
      }),
      createLibraryCoreNormalizedCheckpointRecordV2({
        registryKey: "40_account",
        primaryKey: "account:maximum-metadata",
        payload: {
          address: "a".repeat(64_000),
          avatarUrl: null,
          createdAt: 1,
          discoveredFrom: "manual_entry",
          displayName: null,
          email: null,
          externalId: "maximum-metadata",
          firstSeenAt: 1,
          followRosterActive: null,
          followRosterSyncedAt: null,
          handle: null,
          importedAt: null,
          kind: "contact",
          lastSeenAt: 2,
          personId: null,
          phone: null,
          profileUrl: null,
          provider: "manual_contact",
          sampleBatchId: null,
          sampleGeneratedAt: null,
          sampleGeneratorVersion: null,
          updatedAt: 2,
        },
      }),
    ];
    for (const record of records) {
      expect(
        encodeLibraryCoreCanonicalValue(
          record as unknown as {
            readonly [
              key: string
            ]: import("./canonical-codec.js").LibraryCoreCanonicalValue;
          },
        ).byteLength,
      ).toBeLessThanOrEqual(
        LIBRARY_CORE_CHECKPOINT_RECORD_MAXIMUM_CANONICAL_BYTES,
      );
    }
  });

  it("encodes fractional SQLite values as exact canonical binary64 wrappers", () => {
    const record = createLibraryCoreNormalizedCheckpointRecordV2({
      registryKey: "16_feed_item_signal_score",
      primaryKey: ["item:one", "essay"],
      payload: { score: 0.75, signal: "essay", tagged: true },
    });
    expect(record.payload.score).toEqual({
      bits: "3fe8000000000000",
      codec: "ieee754_binary64_hex_v1",
    });
    expect(parseLibraryCoreNormalizedCheckpointRecordV2(record)).toEqual(
      record,
    );
  });

  it("rejects malformed and nonfinite binary64 wrappers", () => {
    const record = createLibraryCoreNormalizedCheckpointRecordV2({
      registryKey: "16_feed_item_signal_score",
      primaryKey: ["item:one", "essay"],
      payload: { score: 0.75, signal: "essay", tagged: true },
    });
    expect(() =>
      parseLibraryCoreNormalizedCheckpointRecordV2({
        ...record,
        payload: {
          ...record.payload,
          score: { bits: "nope", codec: "ieee754_binary64_hex_v1" },
        },
      }),
    ).toThrow(/identity is invalid/);
    expect(() =>
      parseLibraryCoreNormalizedCheckpointRecordV2({
        ...record,
        payload: {
          ...record.payload,
          score: { bits: "7ff0000000000000", codec: "ieee754_binary64_hex_v1" },
        },
      }),
    ).toThrow(/must be finite/);
  });

  it("rejects missing chunks, changed bytes, unknown fields, and shell keys", () => {
    const records = splitLibraryCoreContentV1({
      bytes: new Uint8Array(65_537).fill(7),
      mediaType: "text/plain",
    });
    expect(() => reassembleLibraryCoreContentV1(records.slice(0, -1))).toThrow(
      /incomplete/,
    );
    expect(() =>
      parseLibraryCoreNormalizedCheckpointRecordV2({
        ...records[0],
        extra: true,
      }),
    ).toThrow(/unknown or missing/);
    expect(() =>
      parseLibraryCoreNormalizedCheckpointRecordV2({
        ...records[0],
        registryKey: "00_library_shell",
      }),
    ).toThrow(/unsupported/);
  });
});
