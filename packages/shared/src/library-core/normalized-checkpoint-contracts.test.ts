import { describe, expect, it } from "vitest";
import { encodeLibraryCoreCanonicalValue } from "./canonical-codec.js";
import {
  createLibraryCoreNormalizedCheckpointRecordV2,
  libraryCoreNormalizedCheckpointRecordIdentityV2,
  parseLibraryCoreNormalizedCheckpointRecordV2,
  reassembleLibraryCoreContentV1,
  splitLibraryCoreContentV1,
} from "./normalized-checkpoint-contracts.js";
import {
  LIBRARY_CORE_CHECKPOINT_RECORD_MAXIMUM_CANONICAL_BYTES,
  LIBRARY_CORE_CHECKPOINT_RECORD_REGISTRY,
} from "./sqlite-contract.generated.js";

describe("normalized SQLite checkpoint contract", () => {
  it("has stable registry plus typed primary-key identity and no shell record", () => {
    expect(
      LIBRARY_CORE_CHECKPOINT_RECORD_REGISTRY.some(
        (entry) =>
          entry.registryKey.includes("shell") || entry.payload.includes("shell"),
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

  it(
    "represents a legal maximum-sized item as bounded content records",
    () => {
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
                readonly [key: string]: import("./canonical-codec.js").LibraryCoreCanonicalValue;
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
    },
    15_000,
  );

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
    expect(parseLibraryCoreNormalizedCheckpointRecordV2(record)).toEqual(record);
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
        payload: { ...record.payload, score: { bits: "nope", codec: "ieee754_binary64_hex_v1" } },
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
