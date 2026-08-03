import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  FEED_ITEM_MERGE_NON_IDEMPOTENT_FIELD,
  FEED_ITEM_MERGE_EMPTY_PASS_MEASUREMENT,
} from "./library-core/feed-item-merge-idempotency.js";
import { mergeFeedItemInto } from "./schema.js";
import type { FeedItem } from "./types.js";

/**
 * `mergeFeedItemInto` runs from deduplication and from all three provider
 * capture reconcilers, so the same source really is merged into the same target
 * repeatedly. Nothing held it to idempotency until now.
 */

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

const item = (globalId: string, over: Record<string, unknown> = {}): FeedItem =>
  clone({
    globalId,
    platform: "rss",
    sourceId: "source-1",
    url: `https://example.com/${globalId}`,
    publishedAt: 100,
    capturedAt: 200,
    author: {
      id: "author-1",
      displayName: "Author",
      avatarUrl: "https://example.com/a.png",
    },
    content: {
      text: "body text",
      mediaUrls: ["https://example.com/m1"],
      mediaTypes: ["image"],
      linkPreview: { url: "https://example.com/story", title: "Title" },
    },
    topics: ["topic-a"],
    engagement: { likes: 3, comments: 1 },
    priority: 5,
    priorityComputedAt: 900,
    location: { name: "Location", url: "https://example.com/loc" },
    preservedContent: {
      text: "preserved",
      preservedAt: 1,
      wordCount: 2,
      readingTime: 1,
    },
    userState: {
      hidden: false,
      saved: false,
      archived: false,
      tags: ["tag-a"],
      highlights: [{ text: "h1", note: "n1", createdAt: 10 }],
    },
    ...over,
  }) as unknown as FeedItem;

/** A source that differs from the base item on every merge rule at once. */
const contrastingSource = (): FeedItem =>
  item("duplicate", {
    publishedAt: 50,
    capturedAt: 150,
    author: {
      id: "author-1",
      displayName: "A Much Longer Author Name",
      avatarUrl: "https://example.com/a-much-longer-avatar.png",
    },
    content: {
      text: "a considerably longer body text than the target carries",
      mediaUrls: ["https://example.com/m2"],
      mediaTypes: ["video"],
      linkPreview: { url: "https://example.com/story", title: "A Longer Title" },
    },
    topics: ["topic-b"],
    engagement: { likes: 9, views: 4 },
    priority: 7,
    priorityComputedAt: 1_500,
    location: { name: "Real Place", coordinates: { lat: 1, lng: 2 } },
    userState: {
      hidden: false,
      saved: false,
      archived: false,
      tags: ["tag-b"],
      highlights: [{ text: "h2", note: "n2", createdAt: 20 }],
    },
  });

/**
 * Every leaf path where two merge results differ.
 *
 * Deliberately a diff rather than an exclusion list. An earlier version of this
 * file compared two copies with the known clock field deleted from both, and a
 * mutation proved that approach worthless: widening the deletion to also drop
 * `topics` hid a real `topics` regression and the suite still passed. With a
 * diff there is nothing to widen. The assertion states the exact set of moving
 * paths, so any new one has to be added here in a reviewable line.
 */
const differingPaths = (
  left: unknown,
  right: unknown,
  prefix = "",
): string[] => {
  if (Object.is(left, right)) return [];
  const bothObjects =
    typeof left === "object" &&
    left !== null &&
    typeof right === "object" &&
    right !== null &&
    Array.isArray(left) === Array.isArray(right);
  if (!bothObjects) return [prefix || "<root>"];

  const keys = new Set([
    ...Object.keys(left as Record<string, unknown>),
    ...Object.keys(right as Record<string, unknown>),
  ]);
  const paths: string[] = [];
  for (const key of [...keys].sort()) {
    paths.push(
      ...differingPaths(
        (left as Record<string, unknown>)[key],
        (right as Record<string, unknown>)[key],
        prefix ? `${prefix}.${key}` : key,
      ),
    );
  }
  return paths;
};

describe("mergeFeedItemInto idempotency", () => {
  // The merge stamps a wall clock, so real time makes these assertions depend
  // on whether two calls straddle a millisecond. The first draft of this file
  // did exactly that and failed intermittently. Controlling the clock turns a
  // flaky observation into two exact ones.
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("is completely idempotent once the clock is held still", () => {
    // The strongest form of the property. With time frozen there is no
    // difference at all, which proves the single exception below is entirely
    // clock driven rather than an accumulation hiding behind one.
    const once = item("keeper");
    mergeFeedItemInto(once, contrastingSource());

    const many = item("keeper");
    for (let pass = 0; pass < 10; pass += 1) {
      mergeFeedItemInto(many, contrastingSource());
    }

    expect(differingPaths(many, once)).toStrictEqual([]);
  });

  it("differs in exactly one clock field once time advances", () => {
    const once = item("keeper");
    mergeFeedItemInto(once, contrastingSource());

    const twice = item("keeper");
    mergeFeedItemInto(twice, contrastingSource());
    vi.advanceTimersByTime(1_000);
    mergeFeedItemInto(twice, contrastingSource());

    expect(differingPaths(twice, once)).toStrictEqual([
      FEED_ITEM_MERGE_NON_IDEMPOTENT_FIELD,
    ]);
  });

  it("merging an already-merged item into itself moves only that field", () => {
    const merged = item("keeper");
    mergeFeedItemInto(merged, contrastingSource());

    const settled = clone(merged);
    vi.advanceTimersByTime(1_000);
    mergeFeedItemInto(merged, clone(settled));

    expect(differingPaths(merged, settled)).toStrictEqual([
      FEED_ITEM_MERGE_NON_IDEMPOTENT_FIELD,
    ]);
  });

  it("guards the differ itself", () => {
    // A differ that returns nothing would make every assertion above vacuous.
    expect(differingPaths({ a: 1 }, { a: 1 })).toStrictEqual([]);
    expect(differingPaths({ a: 1 }, { a: 2 })).toStrictEqual(["a"]);
    expect(differingPaths({ a: { b: 1 } }, { a: { b: 2 } })).toStrictEqual(["a.b"]);
    expect(differingPaths({ a: 1 }, {})).toStrictEqual(["a"]);
    expect(differingPaths({ a: [1, 2] }, { a: [1, 3] })).toStrictEqual(["a.1"]);
  });

  it("pins the item-level rules, which idempotency alone does not", () => {
    // Idempotency is necessary but not sufficient. Flipping `priority` from
    // max to min stays perfectly idempotent and is still wrong, so the rules
    // themselves need pinning.
    const merged = item("keeper");
    mergeFeedItemInto(merged, contrastingSource());
    const view = merged as unknown as Record<string, never>;

    // Timestamps take the earlier value; the item is as old as its oldest copy.
    expect(view.publishedAt).toBe(50);
    expect(view.capturedAt).toBe(150);

    // Ranking takes the strongest claim and the most recent computation.
    expect(view.priority).toBe(7);
    expect(view.priorityComputedAt).toBe(1_500);

    // Longest wins for free text, on the theory that a truncated copy is worse.
    expect((view.content as Record<string, unknown>).text).toBe(
      "a considerably longer body text than the target carries",
    );
    expect((view.author as Record<string, unknown>).displayName).toBe(
      "A Much Longer Author Name",
    );
    expect((view.author as Record<string, unknown>).avatarUrl).toBe(
      "https://example.com/a-much-longer-avatar.png",
    );

    // Collections union rather than replace.
    expect(view.topics).toStrictEqual(["topic-a", "topic-b"]);
    expect((view.content as Record<string, unknown>).mediaUrls).toStrictEqual([
      "https://example.com/m1",
      "https://example.com/m2",
    ]);

    // Counters take a max per counter, never a sum.
    expect(view.engagement).toStrictEqual({ likes: 9, comments: 1, views: 4 });

    // Location fills gaps but treats the literal placeholder "Location" as
    // absent, so a real place name can replace it.
    expect(view.location).toStrictEqual({
      name: "Real Place",
      url: "https://example.com/loc",
      coordinates: { lat: 1, lng: 2 },
    });

    // Fill-if-absent leaves an existing value alone.
    expect((view.preservedContent as Record<string, unknown>).text).toBe("preserved");
  });

  it("records the measured cost of a semantically empty pass", () => {
    // A magnitude, so the tradeoff can be argued with a number attached.
    expect(FEED_ITEM_MERGE_EMPTY_PASS_MEASUREMENT.items).toBe(200);
    expect(
      FEED_ITEM_MERGE_EMPTY_PASS_MEASUREMENT.changeBytesPerItemPerPass,
    ).toBeGreaterThan(FEED_ITEM_MERGE_EMPTY_PASS_MEASUREMENT.savedBytesPerItemPerPass);
  });
});
