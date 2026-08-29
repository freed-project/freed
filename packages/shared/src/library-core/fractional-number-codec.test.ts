import { describe, expect, it } from "vitest";

import {
  decodeLibraryCoreFractionalNumbersV1,
  encodeLibraryCoreFractionalNumbersV1,
} from "./fractional-number-codec.js";
import {
  decodeLibraryCoreCanonicalValue,
  encodeLibraryCoreCanonicalValue,
} from "./canonical-codec.js";

describe("Library Core fractional number codec", () => {
  it("preserves finite binary64 values while leaving safe integers canonical", () => {
    const source = {
      confidence: 0.875,
      coordinates: { lat: 48.8566, lng: -0 },
      count: 17,
    };

    const encoded = encodeLibraryCoreFractionalNumbersV1(source);
    expect(() => encodeLibraryCoreCanonicalValue(encoded)).not.toThrow();
    expect(decodeLibraryCoreFractionalNumbersV1(encoded)).toEqual(source);
    expect(
      decodeLibraryCoreFractionalNumbersV1(
        decodeLibraryCoreCanonicalValue(
          encodeLibraryCoreCanonicalValue(encoded),
        ),
      ),
    ).toEqual(source);
    expect(
      Object.is(
        (
          decodeLibraryCoreFractionalNumbersV1(encoded) as typeof source
        ).coordinates.lng,
        -0,
      ),
    ).toBe(true);
  });

  it("rejects nonfinite values and invalid decoded wrappers", () => {
    expect(() => encodeLibraryCoreFractionalNumbersV1(Infinity)).toThrow(
      "must be finite",
    );
    expect(() =>
      encodeLibraryCoreFractionalNumbersV1({
        bits: "3ff0000000000000",
        codec: "ieee754_binary64_hex_v1",
      }),
    ).toThrow("reserved binary64 wrapper");
    expect(() =>
      decodeLibraryCoreFractionalNumbersV1({
        bits: "7ff0000000000000",
        codec: "ieee754_binary64_hex_v1",
      }),
    ).toThrow("must decode to finite numbers");
  });
});
