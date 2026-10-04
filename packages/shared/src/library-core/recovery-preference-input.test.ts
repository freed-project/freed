import type { LibraryCoreCanonicalValue } from "./canonical-codec.js";
import { expect, it } from "vitest";
import { sameLibraryCoreRecoveryPreferenceScopeV1, snapshotLibraryCoreRecoveryPreferencePatchesV1 } from "./recovery-preference-input.js";

it("snapshots every ordered patch, including empty groups, repeated paths and encoded numeric values", () => {
  const patches = [
    { display: { reading: {}, showEngagementCounts: false }, weights: { topics: { "a.b": { bits: "3fc0000000000000", codec: "ieee754_binary64_hex_v1" } } } },
    { display: { showEngagementCounts: true } },
  ];
  const result = snapshotLibraryCoreRecoveryPreferencePatchesV1(patches);
  const named = JSON.parse('{"weights":{"topics":{"__proto__":{"bits":"3fc0000000000000","codec":"ieee754_binary64_hex_v1"}}}}');
  expect(snapshotLibraryCoreRecoveryPreferencePatchesV1([named])[0]).toEqual(named);
  patches[0]!.display.showEngagementCounts = true;
  expect(result[0]).toMatchObject({ display: { reading: {}, showEngagementCounts: false } });
  expect(result[1]).toEqual({ display: { showEngagementCounts: true } });
  expect(sameLibraryCoreRecoveryPreferenceScopeV1(result[0]!, { display: { reading: {}, showEngagementCounts: true }, weights: { topics: { "a.b": 2 } } })).toBe(true);
  const changedPatches: LibraryCoreCanonicalValue[] = [
    { display: { showEngagementCounts: false }, weights: { topics: { "a.b": 2 } } },
    { display: { reading: {}, showEngagementCounts: false }, weights: { topics: { a: { b: 2 } } } },
    { display: { reading: false, showEngagementCounts: false }, weights: { topics: { "a.b": 2 } } },
  ];
  for (const changed of changedPatches) expect(sameLibraryCoreRecoveryPreferenceScopeV1(result[0]!, changed)).toBe(false);
  expect(sameLibraryCoreRecoveryPreferenceScopeV1({ storyWall: { selectedYears: [2020, 2021] } }, { storyWall: { selectedYears: [] } })).toBe(true);
});

it("refuses unsupported members, fractional raw values, count overflow and aggregate byte overflow", () => {
  for (const patches of [[], Array(2), [{ display: { unknown: true } }], [{ weights: { topics: { alpha: 0.125 } } }], Array(257).fill({ display: {} })])
    expect(() => snapshotLibraryCoreRecoveryPreferencePatchesV1(patches)).toThrow();
  const patch = { xCapture: { whitelist: Object.fromEntries(Array.from({ length: 30 }, (_, i) => [`account:${i}`, { note: "a".repeat(8192) }])) } };
  expect(snapshotLibraryCoreRecoveryPreferencePatchesV1([patch])).toHaveLength(1);
  expect(() => snapshotLibraryCoreRecoveryPreferencePatchesV1(Array(18).fill(patch))).toThrow("byte bound");
});
