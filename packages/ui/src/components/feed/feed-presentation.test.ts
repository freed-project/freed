import { describe, expect, it } from "vitest";
import type { FeedItem } from "@freed/shared";
import { buildFeedRows, presentFeed } from "./feed-presentation.js";

function fixture(pattern: string, prefix = ""): FeedItem[] {
  return [...pattern].map(
    (kind, i) =>
      ({
        globalId: `${prefix}${i}`,
        contentType: kind === "s" ? "story" : "article",
      }) as FeedItem,
  );
}
const ids = (items: FeedItem[]) => items.map((item) => item.globalId);

describe("bounded story presentation", () => {
  it("packs nearby stories while preserving ordinary article order", () => {
    const source = fixture("asasa");
    const plan = presentFeed(source);
    expect(ids(plan.items)).toEqual(["0", "1", "3", "2", "4"]);
    expect(ids(source)).toEqual(["0", "1", "2", "3", "4"]);
    expect(
      buildFeedRows(plan.items, 3, plan.groupById).map((row) => row.type),
    ).toEqual(["item", "stories", "item", "item"]);
  });

  it("preserves every item and both relative orders with a hard displacement bound", () => {
    // Exhaust every story/article mixture of twelve items. This catches chained
    // pulling that bounds the story but lets displaced articles drift farther.
    for (let mask = 0; mask < 4096; mask++) {
      const source = fixture(
        Array.from({ length: 12 }, (_, i) =>
          mask & (1 << i) ? "s" : "a",
        ).join(""),
      );
      const result = presentFeed(source).items;
      expect(new Set(ids(result)).size).toBe(source.length);
      for (const kind of ["story", "article"]) {
        expect(ids(result.filter((item) => item.contentType === kind))).toEqual(
          ids(source.filter((item) => item.contentType === kind)),
        );
      }
      result.forEach((item, i) =>
        expect(Math.abs(Number(item.globalId) - i)).toBeLessThanOrEqual(2),
      );
    }
  });

  it("does not pull across three articles or chase stories outside the neighborhood", () => {
    expect(ids(presentFeed(fixture("saaas")).items)).toEqual([
      "0",
      "1",
      "2",
      "3",
      "4",
    ]);
    expect(ids(presentFeed(fixture("sssssas")).items)).toEqual([
      "0",
      "1",
      "2",
      "3",
      "4",
      "5",
      "6",
    ]);
  });

  it("keeps retained groups closed across append, prepend, eviction and patches", () => {
    const source = fixture("asasa");
    const previous = presentFeed(source);
    const appended = [...source, ...fixture("ssas", "next")];
    const next = presentFeed(appended, previous);
    expect(ids(next.items).slice(0, source.length)).toEqual(
      ids(previous.items),
    );
    expect(next.groupById.get("1")).toBe(previous.groupById.get("1"));
    const shifted = presentFeed(appended.slice(2), next);
    expect(ids(shifted.items)).toEqual(
      ids(next.items).filter((id) => id !== "0" && id !== "1"),
    );
    const patched = appended.map(
      (item) => ({ ...item, userState: { readAt: 123 } }) as FeedItem,
    );
    expect(
      presentFeed(patched, next).items.every(
        (item) => item.userState.readAt === 123,
      ),
    ).toBe(true);
    const prepended = presentFeed(
      [...fixture("sas", "before"), ...appended],
      next,
    );
    expect(ids(prepended.items).slice(3)).toEqual(ids(next.items));
  });

  it("does not rebalance an existing story row when a page adds another story", () => {
    const source = fixture("sss");
    const first = presentFeed(source);
    const next = presentFeed([...source, ...fixture("s", "next")], first);
    expect(
      buildFeedRows(next.items, 3, next.groupById).map((row) => row.key),
    ).toEqual(['["0","1","2"]', '["next0"]']);
  });

  it("rebuilds for a changed rank and keeps exact order when disabled", () => {
    const source = fixture("asasa");
    const first = presentFeed(source);
    const reversed = [...source].reverse();
    expect(ids(presentFeed(reversed, first).items)).toEqual(
      ids(presentFeed(reversed).items),
    );
    expect(presentFeed(source, first, false).items).toBe(source);
  });

  it("balances uninterrupted runs and maps indices for every width", () => {
    const source = fixture("sssssss");
    const plan = presentFeed(source);
    expect(
      buildFeedRows(plan.items, 3, plan.groupById).map(
        (row) => row.type === "stories" && row.numCols,
      ),
    ).toEqual([3, 2, 2]);
    for (const columns of [1, 2, 3]) {
      const rows = buildFeedRows(plan.items, columns, plan.groupById);
      expect(
        rows.flatMap((row) =>
          row.type === "stories" ? row.itemIndices : [row.itemIndex],
        ),
      ).toEqual([0, 1, 2, 3, 4, 5, 6]);
    }
  });
});
