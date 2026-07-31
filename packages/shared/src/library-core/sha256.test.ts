import { createHash, webcrypto } from "node:crypto";
import { describe, expect, it } from "vitest";

import { sha256LowerHex } from "./sha256.js";

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
});
