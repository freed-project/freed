import { describe, expect, it } from "vitest";
import {
  collectUnreadIdsFromRows,
  getListViewportMetrics,
  getNewlyPassedRowEnd,
  getRemainingUnreadIds,
  hasReachedListBottom,
  type ReadTrackRow,
} from "./read-on-scroll";

type TestItem = {
  globalId: string;
  userState: {
    readAt?: number;
  };
};

function item(globalId: string, readAt?: number): TestItem {
  return { globalId, userState: { readAt } };
}

describe("read-on-scroll helpers", () => {
  it("collects unread ids only from the newly passed rows", () => {
    const rows: Array<ReadTrackRow<TestItem>> = [
      { type: "item", item: item("a") },
      { type: "stories", items: [item("b"), item("c", 1)] },
      { type: "item", item: item("d") },
    ];

    expect(collectUnreadIdsFromRows(rows, 0, 1)).toEqual(["a", "b"]);
    expect(collectUnreadIdsFromRows(rows, 2, 1)).toEqual([]);
  });

  it("advances the passed-row boundary when the first visible row moves down", () => {
    const virtualRows = [
      { index: 2, end: 660 },
      { index: 3, end: 880 },
      { index: 4, end: 1100 },
    ];

    expect(getNewlyPassedRowEnd(virtualRows, 600, 10, -1)).toBe(1);
    expect(getNewlyPassedRowEnd(virtualRows, 600, 10, 1)).toBeNull();
    expect(getNewlyPassedRowEnd([], 9999, 5, 2)).toBe(4);
  });

  it("returns the remaining unread ids when finishing a list", () => {
    expect(
      getRemainingUnreadIds([
        item("a"),
        item("b", 1),
        item("c"),
      ]),
    ).toEqual(["a", "c"]);
  });

  it("normalizes window scroll positions against the list offset", () => {
    expect(getListViewportMetrics(480, 300, 120)).toEqual({
      scrollTop: 360,
      viewportBottom: 660,
    });
    expect(getListViewportMetrics(80, 300, 120)).toEqual({
      scrollTop: 0,
      viewportBottom: 300,
    });
  });

  it("treats the list as complete only when the viewport reaches the bottom", () => {
    expect(hasReachedListBottom(3, 999, 1000)).toBe(true);
    expect(hasReachedListBottom(3, 900, 1000)).toBe(false);
    expect(hasReachedListBottom(0, 1000, 1000)).toBe(false);
  });
});
