import { describe, expect, it, vi } from "vitest";
import { FriendsGalaxySourceScheduler } from "../../src/lib/friends-galaxy-source-scheduler.js";

describe("Friends Galaxy structural source updates", () => {
  it("admits isolated sources immediately and bounds a sustained burst", () => {
    vi.useFakeTimers();
    try {
      const flushed: number[] = [];
      const scheduler = new FriendsGalaxySourceScheduler<number>({
        flush: (value) => flushed.push(value),
        now: () => Date.now(),
        quietMs: 600,
        maxWaitMs: 2_000,
      });

      scheduler.request(1);
      expect(flushed).toEqual([1]);
      for (let revision = 2; revision <= 9; revision += 1) {
        vi.advanceTimersByTime(250);
        scheduler.request(revision);
      }
      vi.advanceTimersByTime(250);
      expect(flushed).toEqual([1, 9]);

      vi.advanceTimersByTime(700);
      scheduler.request(10);
      expect(flushed).toEqual([1, 9, 10]);
      scheduler.dispose();
    } finally {
      vi.useRealTimers();
    }
  });
});
