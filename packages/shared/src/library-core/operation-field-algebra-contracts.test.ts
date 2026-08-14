import { describe, expect, it } from "vitest";

import { FEED_ITEM_READ_AT_FIELD_ALGEBRA } from "./operation-field-algebra-contracts.js";

const merge = (current: unknown, incoming: unknown): number => {
  const result = FEED_ITEM_READ_AT_FIELD_ALGEBRA.merge(current, incoming);
  if (!result.ok) throw new Error(result.reason);
  return result.value;
};

describe("Library Core operation field algebra contracts", () => {
  it("uses absence as identity and keeps the earliest read assignment", () => {
    expect(merge(undefined, 20)).toBe(20);
    expect(merge(20, 30)).toBe(20);
    expect(merge(30, 20)).toBe(20);
    expect(merge(20, 20)).toBe(20);
    expect(FEED_ITEM_READ_AT_FIELD_ALGEBRA).toMatchObject({
      algebraId: "minimum_present_nonnegative_safe_integer_v1",
      fieldRegistryKey:
        "library-core-v1:feedItems.{globalId}.userState.readAt",
    });
    expect(Object.isFrozen(FEED_ITEM_READ_AT_FIELD_ALGEBRA)).toBe(true);
  });

  it("is associative across replay and reordering", () => {
    const left = merge(merge(undefined, 30), merge(20, 40));
    const right = merge(merge(30, 20), 40);

    expect(left).toBe(20);
    expect(right).toBe(20);
  });

  it("fails closed on malformed current or incoming state", () => {
    for (const [current, incoming] of [
      [-1, 1],
      [0.5, 1],
      ["1", 1],
      [undefined, -0],
      [undefined, -1],
      [undefined, Number.MAX_SAFE_INTEGER + 1],
      [undefined, Number.NaN],
    ]) {
      expect(
        FEED_ITEM_READ_AT_FIELD_ALGEBRA.merge(current, incoming),
      ).toMatchObject({ ok: false, code: "invalid" });
    }
  });
});
