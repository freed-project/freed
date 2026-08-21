import { describe, expect, it } from "vitest";

import {
  createLibraryCoreOperationInstanceId,
  LIBRARY_CORE_ENTITY_ID_CODEC_V1,
  LIBRARY_CORE_MAX_ENTITY_ID_UTF8_BYTES,
  isLibraryCoreEd25519PublicKeyHex,
  isLibraryCoreEd25519SignatureHex,
  isLibraryCoreLowercaseHex64,
  isLibraryCoreNonnegativeSafeInteger,
  isLibraryCoreOperationInstanceId,
} from "./protocol-scalars.js";

describe("Library Core protocol scalar codecs", () => {
  it("accepts only exact lowercase fixed-width hexadecimal strings", () => {
    const hex64 = "ab".repeat(32);

    expect(isLibraryCoreLowercaseHex64(hex64)).toBe(true);
    for (const invalid of [
      "",
      "a".repeat(63),
      "a".repeat(65),
      "A".repeat(64),
      "g".repeat(64),
      `${hex64} `,
      new Uint8Array(64),
    ]) {
      expect(isLibraryCoreLowercaseHex64(invalid)).toBe(false);
    }
  });

  it("closes the exact lowercase Ed25519 public-key and signature encodings", () => {
    expect(isLibraryCoreEd25519PublicKeyHex("ab".repeat(32))).toBe(true);
    expect(isLibraryCoreEd25519SignatureHex("cd".repeat(64))).toBe(true);

    for (const invalid of [
      "",
      "a".repeat(63),
      "A".repeat(64),
      "g".repeat(64),
      new Uint8Array(32),
    ]) {
      expect(isLibraryCoreEd25519PublicKeyHex(invalid)).toBe(false);
    }
    for (const invalid of [
      "",
      "a".repeat(127),
      "a".repeat(129),
      "A".repeat(128),
      "g".repeat(128),
      new Uint8Array(64),
    ]) {
      expect(isLibraryCoreEd25519SignatureHex(invalid)).toBe(false);
    }
  });

  it("enforces the bounded ASCII operation-instance ID codec", () => {
    expect(isLibraryCoreOperationInstanceId("a")).toBe(true);
    expect(isLibraryCoreOperationInstanceId(`a${"b".repeat(127)}`)).toBe(true);

    for (const invalid of [
      "",
      ".starts-with-punctuation",
      "a".repeat(129),
      "contains space",
      "contains/slash",
      "unicode-😀",
      42,
    ]) {
      expect(isLibraryCoreOperationInstanceId(invalid)).toBe(false);
    }
  });

  it("constructs operation identities through the shared bounded codec", () => {
    expect(createLibraryCoreOperationInstanceId("pwa-query", "abc-123")).toBe(
      "pwa-query:abc-123",
    );
    expect(() =>
      createLibraryCoreOperationInstanceId("bad prefix", "id"),
    ).toThrow("operation identity is invalid");
  });

  it("accepts only nonempty Unicode-scalar entity IDs within 4,096 UTF-8 bytes", () => {
    expect(LIBRARY_CORE_MAX_ENTITY_ID_UTF8_BYTES).toBe(4_096);
    expect(LIBRARY_CORE_ENTITY_ID_CODEC_V1).toMatchObject({
      codecId: "library_core_entity_id_v1",
      codecVersion: 1,
      maximumUtf8Bytes: 4_096,
    });
    expect(Object.isFrozen(LIBRARY_CORE_ENTITY_ID_CODEC_V1)).toBe(true);
    for (const accepted of [
      "x:1",
      "rss:https://example.com/你好",
      "😀".repeat(1_024),
      "a".repeat(4_096),
    ]) {
      expect(LIBRARY_CORE_ENTITY_ID_CODEC_V1.validate(accepted)).toBe(true);
    }

    for (const invalid of [
      "",
      "a".repeat(4_097),
      `${"😀".repeat(1_024)}a`,
      "\ud800",
      "\udc00",
      `valid\ud800invalid`,
      42,
      new Uint8Array([1]),
    ]) {
      expect(LIBRARY_CORE_ENTITY_ID_CODEC_V1.validate(invalid)).toBe(false);
    }
  });

  it("accepts only nonnegative safe integers and rejects negative zero", () => {
    for (const accepted of [0, 1, Number.MAX_SAFE_INTEGER]) {
      expect(isLibraryCoreNonnegativeSafeInteger(accepted)).toBe(true);
    }
    for (const invalid of [
      -0,
      -1,
      0.5,
      Number.MAX_SAFE_INTEGER + 1,
      Number.NaN,
      Number.POSITIVE_INFINITY,
      "1",
      1n,
    ]) {
      expect(isLibraryCoreNonnegativeSafeInteger(invalid)).toBe(false);
    }
  });
});
