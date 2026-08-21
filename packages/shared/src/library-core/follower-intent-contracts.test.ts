import { describe, expect, it } from "vitest";
import { parseLibraryCoreFollowerIntentCommitV1 } from "./follower-intent-contracts.js";

describe("follower intent commit contract", () => {
  it("snapshots bounded signed envelope bytes", () => {
    const bytes = Uint8Array.from([1, 2, 3]);
    const parsed = parseLibraryCoreFollowerIntentCommitV1({
      envelopeBytes: [bytes],
    });
    bytes[0] = 9;
    expect(parsed.envelopeBytes[0]).toEqual(Uint8Array.from([1, 2, 3]));
    expect(Object.isFrozen(parsed)).toBe(true);
    expect(Object.isFrozen(parsed.envelopeBytes)).toBe(true);
  });

  it("rejects aliases, sparse arrays, unknown fields, and oversized members", () => {
    const sparse: Uint8Array[] = [];
    sparse.length = 1;
    expect(() =>
      parseLibraryCoreFollowerIntentCommitV1({ envelopeBytes: sparse }),
    ).toThrow(/Uint8Array/);
    expect(() =>
      parseLibraryCoreFollowerIntentCommitV1({
        envelopeBytes: [Uint8Array.of(1)],
        sql: "SELECT 1",
      }),
    ).toThrow(/field set/);
    expect(() =>
      parseLibraryCoreFollowerIntentCommitV1({
        envelopeBytes: [new Uint8Array(131_073)],
      }),
    ).toThrow(/131,072/);
  });
});

