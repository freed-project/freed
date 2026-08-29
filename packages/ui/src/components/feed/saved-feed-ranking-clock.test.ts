import { describe, expect, it } from "vitest";
import type { SavedContentSortMode } from "@freed/shared";
import {
  resolveBoundedReaderRankingClock,
  savedFeedRankingClockMs,
} from "./saved-feed-ranking-clock";

describe("Saved SQLite ranking clock", () => {
  it.each<[SavedContentSortMode, number]>([
    ["date_saved", 0],
    ["date_published", 0],
    ["recommended", 123_456],
    ["shortest_read", 0],
  ])("uses the required ranking clock for %s", (sortMode, expected) => {
    expect(savedFeedRankingClockMs(sortMode, 123_456)).toBe(expected);
  });

  it("retains one clock for a source identity and advances on a new fence", () => {
    const current = resolveBoundedReaderRankingClock(null, "saved:1", 10);
    expect(resolveBoundedReaderRankingClock(current, "saved:1", 20)).toBe(
      current,
    );
    expect(
      resolveBoundedReaderRankingClock(current, "saved:2", 20),
    ).toEqual({ identity: "saved:2", rankingClockMs: 20 });
  });
});
