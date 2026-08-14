import { describe, expect, it } from "vitest";

import {
  RECENCY_HORIZON_HOURS,
  calculatePriority,
  calculateStaticPriority,
  effectivePriority,
  isPriorityTimeInvariant,
  recencyScoreFor,
} from "./ranking.js";
import type { FeedItem, WeightPreferences } from "./types.js";

const HOUR = 60 * 60 * 1000;
const NOW = 1_780_000_000_000;

function makeItem(overrides: Partial<FeedItem> = {}): FeedItem {
  return {
    globalId: "x:1",
    platform: "x",
    author: { id: "author-1", name: "Author", handle: "author" },
    content: { text: "hello", mediaUrls: [], mediaTypes: [] },
    publishedAt: NOW - HOUR,
    capturedAt: NOW,
    contentType: "post",
    topics: [],
    userState: { hidden: false, saved: false, archived: false, tags: [] },
    ...overrides,
  } as unknown as FeedItem;
}

const prefs: WeightPreferences = {
  recency: 50,
  authors: { "author-1": 70 },
  platforms: { x: 60 },
  topics: { tech: 80 },
} as unknown as WeightPreferences;

// The decomposition exists so feed ordering can be an index scan instead of a
// full-corpus rank and sort. That only holds if the stored static component and
// the live formula agree EXACTLY. If they can drift, the index silently
// disagrees with what the UI shows, which is worse than no index.
describe("priority decomposition", () => {
  it("reproduces calculatePriority exactly across ages and item shapes", () => {
    const items = [
      makeItem(),
      makeItem({ userState: { hidden: false, saved: true, archived: false, tags: [] } } as Partial<FeedItem>),
      makeItem({ topics: ["tech"] } as Partial<FeedItem>),
      makeItem({ topics: ["tech", "unknown-topic"] } as Partial<FeedItem>),
      makeItem({ engagement: { likes: 100, reposts: 5, replies: 3 } } as unknown as Partial<FeedItem>),
      makeItem({ platform: "facebook" } as Partial<FeedItem>),
      makeItem({ author: { id: "unknown", name: "U", handle: "u" } } as unknown as Partial<FeedItem>),
    ];
    const ages = [0, 1, 24, 100, 167, 168, 169, 24 * 30, 24 * 400];

    for (const base of items) {
      for (const ageHours of ages) {
        const item = { ...base, publishedAt: NOW - ageHours * HOUR } as FeedItem;
        const direct = calculatePriority(item, prefs, NOW);
        const viaStatic = effectivePriority(
          calculateStaticPriority(item, prefs),
          item.publishedAt,
          NOW,
        );
        expect(viaStatic).toBe(direct);
      }
    }
  });

  it("makes the static component independent of the clock", () => {
    const item = makeItem({ publishedAt: NOW - 3 * HOUR } as Partial<FeedItem>);
    const a = calculateStaticPriority(item, prefs);
    const b = calculateStaticPriority(item, prefs);
    // Static terms take no `now` argument at all, so this is structural rather
    // than incidental, but pin it: a regression that folded recency back in
    // would be invisible until the index went stale.
    expect(a).toEqual(b);
  });

  it("zeroes the recency term at the horizon and stays there", () => {
    expect(recencyScoreFor(NOW - 0, NOW)).toBe(100);
    expect(recencyScoreFor(NOW - RECENCY_HORIZON_HOURS * HOUR, NOW)).toBe(0);
    expect(recencyScoreFor(NOW - 2 * RECENCY_HORIZON_HOURS * HOUR, NOW)).toBe(0);
    expect(recencyScoreFor(NOW - 400 * 24 * HOUR, NOW)).toBe(0);
  });

  it("reports time-invariance exactly at the horizon boundary", () => {
    const justInside = NOW - (RECENCY_HORIZON_HOURS - 1) * HOUR;
    const atHorizon = NOW - RECENCY_HORIZON_HOURS * HOUR;
    expect(isPriorityTimeInvariant(justInside, NOW)).toBe(false);
    expect(isPriorityTimeInvariant(atHorizon, NOW)).toBe(true);
  });

  it("holds priority constant past the horizon as the clock advances", () => {
    // This is the property the index depends on: for the ~98.5% of the corpus
    // older than 7 days, priority does not change, so a stored sort key stays
    // correct without recomputation.
    const item = makeItem({ publishedAt: NOW - 30 * 24 * HOUR } as Partial<FeedItem>);
    const statics = calculateStaticPriority(item, prefs);
    const atNow = effectivePriority(statics, item.publishedAt, NOW);
    const aDayLater = effectivePriority(statics, item.publishedAt, NOW + 24 * HOUR);
    const aYearLater = effectivePriority(statics, item.publishedAt, NOW + 365 * 24 * HOUR);
    expect(aDayLater).toBe(atNow);
    expect(aYearLater).toBe(atNow);
  });

  it("still changes within the horizon, so the hot window must be recomputed", () => {
    const item = makeItem({ publishedAt: NOW - 1 * HOUR } as Partial<FeedItem>);
    const statics = calculateStaticPriority(item, prefs);
    const atNow = effectivePriority(statics, item.publishedAt, NOW);
    const later = effectivePriority(statics, item.publishedAt, NOW + 48 * HOUR);
    expect(later).toBeLessThan(atNow);
  });
});
