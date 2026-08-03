import { describe, expect, it } from "vitest";

import {
  assertNonDestructiveMerge,
  evaluateDestructiveMergeGuard,
} from "./schema.js";
import type { FreedDoc } from "./schema.js";

/**
 * The exact policy of the destructive merge guard, including where it does not
 * look.
 *
 * This guard is the last thing between a peer carrying stale delete history and
 * a user's feed history. It has three live callers: the desktop worker, the PWA
 * worker, and the cloud sync merge path. Two tests in
 * `packages/pwa/src/lib/schema.test.ts` prove it fires on a catastrophic
 * deletion. Nothing pinned the thresholds that decide when it fires, and
 * nothing recorded what it cannot see.
 *
 * The thresholds are a deliberate policy, not an accident, so these tests state
 * them rather than argue with them. The blind spots are recorded for the same
 * reason: a guard whose limits are written down can be reasoned about, and one
 * whose limits are folklore cannot.
 */

const docWith = (globalIds: readonly string[]): FreedDoc =>
  ({
    feedItems: Object.fromEntries(
      globalIds.map((globalId) => [globalId, { globalId }]),
    ),
  }) as unknown as FreedDoc;

const ids = (prefix: string, count: number): string[] =>
  Array.from({ length: count }, (_, index) => `${prefix}-${index}`);

/** Shrinks a document to its first `keep` items, the shape a delete-heavy merge produces. */
const shrunk = (prefix: string, from: number, keep: number): FreedDoc =>
  docWith(ids(prefix, from).slice(0, keep));

describe("destructive merge guard thresholds", () => {
  it("blocks at exactly the 25 percent boundary", () => {
    // Inclusive. A comparison flipped to strictly-greater would let this pass.
    const report = evaluateDestructiveMergeGuard(
      docWith(ids("a", 1_000)),
      docWith([]),
      shrunk("a", 1_000, 750),
    );
    expect(report).toMatchObject({
      blocked: true,
      largestInputItemCount: 1_000,
      deletedItemCount: 250,
      deletedFraction: 0.25,
    });
  });

  it("allows a loss just under the boundary", () => {
    const report = evaluateDestructiveMergeGuard(
      docWith(ids("a", 1_000)),
      docWith([]),
      shrunk("a", 1_000, 751),
    );
    expect(report.blocked).toBe(false);
    expect(report.deletedItemCount).toBe(249);
  });

  it("needs at least 500 items on the larger side before it engages", () => {
    // The floor. Below it the guard never fires, whatever the loss.
    const justUnder = evaluateDestructiveMergeGuard(
      docWith(ids("a", 499)),
      docWith([]),
      docWith([]),
    );
    expect(justUnder).toMatchObject({ blocked: false, deletedFraction: 1 });

    const atFloor = evaluateDestructiveMergeGuard(
      docWith(ids("a", 500)),
      docWith([]),
      docWith([]),
    );
    expect(atFloor.blocked).toBe(true);
  });

  it("cannot reach its own 100-item floor at the default thresholds", () => {
    // Arithmetic, not opinion. To block, the larger input must be at least 500
    // and the loss at least 25 percent, so the smallest blocking loss is
    // 500 * 0.25 = 125. That is already above the 100-item floor, which means
    // `minDeletedItems` can never be the deciding condition at defaults.
    //
    // Found because a mutation deleting that condition from the guard left the
    // suite green. The first version of this test claimed to cover the floor
    // and actually exercised the fraction.
    const smallestBlockingLoss = 500 * 0.25;
    expect(smallestBlockingLoss).toBeGreaterThan(100);

    const atFloor = evaluateDestructiveMergeGuard(
      docWith(ids("a", 500)),
      docWith([]),
      shrunk("a", 500, 375),
    );
    expect(atFloor).toMatchObject({ blocked: true, deletedItemCount: 125 });

    // No shipping caller overrides the thresholds; the desktop worker, the PWA
    // worker, and the cloud merge path all pass only `source`. So this floor is
    // inert in production today.
  });

  it("honours the 100-item floor when a caller lowers the other thresholds", () => {
    // The option is not dead code, only unreachable at defaults. Loosening the
    // other two makes it bind, which is what keeps the condition load bearing.
    const options = { minLargestInputItems: 10, maxDeletedFraction: 0.1 };

    const underFloor = evaluateDestructiveMergeGuard(
      docWith(ids("a", 500)),
      docWith([]),
      shrunk("a", 500, 440),
      options,
    );
    expect(underFloor.deletedItemCount).toBe(60);
    expect(underFloor.deletedFraction).toBeGreaterThan(0.1);
    expect(underFloor.blocked).toBe(false);

    const overFloor = evaluateDestructiveMergeGuard(
      docWith(ids("a", 500)),
      docWith([]),
      shrunk("a", 500, 380),
      options,
    );
    expect(overFloor.deletedItemCount).toBe(120);
    expect(overFloor.blocked).toBe(true);
  });

  it("throws only when blocked, and returns the report otherwise", () => {
    // The positive control for the assert wrapper. Without it, a wrapper that
    // never threw would satisfy every allow-case above.
    expect(() =>
      assertNonDestructiveMerge(
        docWith(ids("a", 1_000)),
        docWith([]),
        shrunk("a", 1_000, 750),
      ),
    ).toThrow(/Freed blocked a sync merge/);

    expect(
      assertNonDestructiveMerge(
        docWith(ids("a", 1_000)),
        docWith([]),
        shrunk("a", 1_000, 751),
      ).blocked,
    ).toBe(false);
  });

  it("measures against the larger input, not the local one", () => {
    // A small local document merging with a large peer must be judged against
    // the peer, or a peer's history could be erased and called harmless.
    const report = evaluateDestructiveMergeGuard(
      docWith(ids("local", 10)),
      docWith(ids("peer", 1_000)),
      shrunk("peer", 1_000, 700),
    );
    expect(report.largestInputItemCount).toBe(1_000);
    expect(report.blocked).toBe(true);
  });
});

describe("destructive merge guard blind spots", () => {
  it("counts items, so churn that nets to zero is invisible", () => {
    // Every original item is gone and the guard reports no loss, because the
    // replacements restore the count. A peer that pruned heavily while also
    // capturing heavily produces exactly this shape.
    // https://github.com/freed-project/freed/issues/1334
    const report = evaluateDestructiveMergeGuard(
      docWith(ids("original", 5_000)),
      docWith(ids("replacement", 5_000)),
      docWith(ids("replacement", 5_000)),
    );

    expect(report.blocked).toBe(false);
    expect(report.deletedItemCount).toBe(0);
    expect(report.deletedFraction).toBe(0);

    // Stated explicitly: not one original identifier survived.
    const survivors = Object.keys(
      (docWith(ids("replacement", 5_000)) as unknown as {
        feedItems: Record<string, unknown>;
      }).feedItems,
    ).filter((id) => id.startsWith("original-"));
    expect(survivors).toHaveLength(0);
  });

  it("lets a quarter of a real-sized library go on a single merge", () => {
    // The fraction is proportional, so the absolute loss it permits grows with
    // the library. At the ~17,000 item corpus this program targets, that is
    // over four thousand items in one merge, silently.
    const report = evaluateDestructiveMergeGuard(
      docWith(ids("a", 17_000)),
      docWith([]),
      shrunk("a", 17_000, 12_751),
    );
    expect(report.blocked).toBe(false);
    expect(report.deletedItemCount).toBe(4_249);
    expect(report.deletedFraction).toBeCloseTo(0.2499, 4);
  });

  it("reports a readable message only when it blocks", () => {
    const blocked = evaluateDestructiveMergeGuard(
      docWith(ids("a", 1_000)),
      docWith([]),
      shrunk("a", 1_000, 750),
      { source: "cloud restore" },
    );
    expect(blocked.message).toContain("cloud restore");
    expect(blocked.message).toContain("250");

    const allowed = evaluateDestructiveMergeGuard(
      docWith(ids("a", 1_000)),
      docWith([]),
      shrunk("a", 1_000, 751),
    );
    expect(allowed.message).toBe("Sync merge passed destructive merge guard.");
  });
});
