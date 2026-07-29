import { describe, expect, it } from "vitest";

import { FEED_ITEM_READ_ASSIGNMENT_PAYLOAD_SCHEMA } from "./operation-payload-contracts.js";

describe("Library Core operation payload contracts", () => {
  it("snapshots the exact feed-item read assignment payload", () => {
    const input = { read_at_ms: 1_783_000_000_000 };
    const result = FEED_ITEM_READ_ASSIGNMENT_PAYLOAD_SCHEMA.validate(input);

    expect(result).toStrictEqual({
      ok: true,
      value: { read_at_ms: 1_783_000_000_000 },
    });
    if (!result.ok) throw new Error(result.reason);
    expect(Object.isFrozen(result.value)).toBe(true);
    expect(result.value).not.toBe(input);

    input.read_at_ms = 1;
    expect(result.value.read_at_ms).toBe(1_783_000_000_000);
  });

  it("rejects noncanonical shapes and unsafe read timestamps", () => {
    const accessor = Object.defineProperty({}, "read_at_ms", {
      enumerable: true,
      get: () => 1,
    });
    const symbol = { read_at_ms: 1 };
    Object.defineProperty(symbol, Symbol("extra"), { value: true });

    for (const invalid of [
      null,
      [],
      new Date(),
      {},
      { read_at_ms: 1, extra: true },
      { read_at_ms: -0 },
      { read_at_ms: -1 },
      { read_at_ms: 1.5 },
      { read_at_ms: Number.MAX_SAFE_INTEGER + 1 },
      { read_at_ms: "1" },
      accessor,
      symbol,
    ]) {
      expect(
        FEED_ITEM_READ_ASSIGNMENT_PAYLOAD_SCHEMA.validate(invalid),
      ).toMatchObject({ ok: false, code: "invalid" });
    }
  });
});
