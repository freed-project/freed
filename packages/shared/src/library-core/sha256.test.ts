import { createHash, webcrypto } from "node:crypto";
import { describe, expect, it } from "vitest";

import { LibraryCoreSha256, sha256LowerHex } from "./sha256.js";

describe("Library Core synchronous SHA-256", () => {
  it("matches platform implementations for empty, block-edge, and bounded inputs", async () => {
    const inputs = [
      new Uint8Array(),
      new TextEncoder().encode("abc"),
      new Uint8Array(55).fill(0xa5),
      new Uint8Array(56).fill(0x5a),
      new Uint8Array(64).fill(0xff),
      new Uint8Array(4_000_000).fill(0x37),
    ];
    for (const input of inputs) {
      const expected = createHash("sha256").update(input).digest("hex");
      expect(sha256LowerHex(input)).toBe(expected);
      expect(
        Buffer.from(await webcrypto.subtle.digest("SHA-256", input)).toString(
          "hex",
        ),
      ).toBe(expected);
    }
  });

  it("preserves one digest across arbitrary incremental chunk boundaries", () => {
    const input = new Uint8Array(2_097_311);
    for (let index = 0; index < input.byteLength; index += 1) {
      input[index] = index % 251;
    }
    const expected = createHash("sha256").update(input).digest("hex");
    const state = new LibraryCoreSha256();
    let offset = 0;
    for (const byteLength of [1, 63, 64, 65, 1_048_576, 17]) {
      const end = Math.min(offset + byteLength, input.byteLength);
      state.update(input.subarray(offset, end));
      offset = end;
    }
    state.update(input.subarray(offset));

    expect(state.digestLowerHex()).toBe(expected);
    expect(state.digestLowerHex()).toBe(expected);
    expect(() => state.update(new Uint8Array([1]))).toThrow("finalized");
  });
});
