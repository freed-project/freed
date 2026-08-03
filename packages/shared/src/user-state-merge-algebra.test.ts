import { describe, expect, it } from "vitest";

import {
  LIBRARY_CORE_SAVED_ARCHIVED_EXCLUSION_IS_PER_DEVICE_ONLY,
  LIBRARY_CORE_USER_STATE_MERGE_ALGEBRA,
} from "./library-core/user-state-merge-algebra.js";
import {
  deduplicateDocFeedItems,
  mergeFeedItemInto,
  type FreedDoc,
} from "./schema.js";
import type { FeedItem, UserState } from "./types.js";

/**
 * `mergeUserState` is the de facto field algebra for every synchronized
 * user-state leaf, and until now nothing held it to a stated rule. These are
 * characterization tests: they pin what the shipping code already does so a
 * change to convergence has to be deliberate and visible in a diff.
 */

const SHARED_STORY_URL = "https://example.com/story";

const item = (globalId: string, userState: Partial<UserState>): FeedItem =>
  ({
    globalId,
    platform: "rss",
    sourceId: "source-1",
    url: `https://example.com/${globalId}`,
    publishedAt: 1,
    author: { id: "author-1", displayName: "Author" },
    content: {
      text: "same story",
      mediaUrls: [],
      mediaTypes: [],
      linkPreview: { url: SHARED_STORY_URL },
    },
    topics: [],
    userState: {
      hidden: false,
      saved: false,
      archived: false,
      tags: [],
      ...userState,
    },
  }) as unknown as FeedItem;

/** Merge `right` into `left` through the shipping entry point. */
const merged = (
  left: Partial<UserState>,
  right: Partial<UserState>,
): UserState => {
  const keeper = item("keeper", left);
  mergeFeedItemInto(keeper, item("duplicate", right));
  return keeper.userState;
};

describe("feed item user state merge algebra", () => {
  it("declares a rule for every leaf mergeUserState actually touches", () => {
    // Guard the guard. If a leaf is added to mergeUserState without a rule
    // here, this list stops describing the function it claims to describe.
    expect(Object.keys(LIBRARY_CORE_USER_STATE_MERGE_ALGEBRA).sort()).toStrictEqual([
      "archived",
      "archivedAt",
      "hidden",
      "liked",
      "likedAt",
      "likedSyncedAt",
      "readAt",
      "saved",
      "savedAt",
      "seenSyncedAt",
      "tags",
    ]);
  });

  describe("boolean_or", () => {
    it.each([
      ["hidden"],
      ["saved"],
      ["archived"],
    ] as const)("%s is true when either side is true", (leaf) => {
      expect(merged({ [leaf]: true }, { [leaf]: false })[leaf]).toBe(true);
      expect(merged({ [leaf]: false }, { [leaf]: true })[leaf]).toBe(true);
      expect(merged({ [leaf]: false }, { [leaf]: false })[leaf]).toBe(false);
    });
  });

  it("liked collapses a false result to absent rather than false", () => {
    expect(merged({ liked: true }, {}).liked).toBe(true);
    expect(merged({}, { liked: true }).liked).toBe(true);
    // The distinction that makes this rule its own case: `false` is not stored.
    expect(merged({ liked: false }, { liked: false })).not.toHaveProperty("liked");
  });

  describe("timestamp_min", () => {
    it.each([
      ["readAt"],
      ["savedAt"],
      ["archivedAt"],
    ] as const)("%s keeps the earlier time and prefers a defined value", (leaf) => {
      expect(merged({ [leaf]: 500 }, { [leaf]: 100 })[leaf]).toBe(100);
      expect(merged({ [leaf]: 100 }, { [leaf]: 500 })[leaf]).toBe(100);
      expect(merged({ [leaf]: 500 }, {})[leaf]).toBe(500);
      expect(merged({}, { [leaf]: 500 })[leaf]).toBe(500);
    });
  });

  describe("synced_timestamp", () => {
    it("keeps the later receipt when both are positive", () => {
      expect(merged({ seenSyncedAt: 100 }, { seenSyncedAt: 500 }).seenSyncedAt).toBe(500);
      expect(merged({ seenSyncedAt: 500 }, { seenSyncedAt: 100 }).seenSyncedAt).toBe(500);
    });

    it("lets a real receipt beat a non-positive pending marker", () => {
      // This is the whole reason it is not plain `max`: a pending or failed
      // marker must never mask a receipt that actually happened.
      expect(merged({ seenSyncedAt: 0 }, { seenSyncedAt: 300 }).seenSyncedAt).toBe(300);
      expect(merged({ seenSyncedAt: 300 }, { seenSyncedAt: -1 }).seenSyncedAt).toBe(300);
    });

    it("keeps the smaller marker when neither side has a receipt", () => {
      expect(merged({ seenSyncedAt: 0 }, { seenSyncedAt: -5 }).seenSyncedAt).toBe(-5);
    });
  });

  describe("liked_intent_pair", () => {
    it("lets the later like carry its own receipt", () => {
      // The pairing exists so a receipt cannot outlive the like it belongs to.
      const result = merged(
        { liked: true, likedAt: 100, likedSyncedAt: 150 },
        { liked: true, likedAt: 900, likedSyncedAt: 950 },
      );
      expect(result.likedAt).toBe(900);
      expect(result.likedSyncedAt).toBe(950);
    });

    it("does not take the later receipt when the earlier like wins", () => {
      const result = merged(
        { liked: true, likedAt: 900, likedSyncedAt: 950 },
        { liked: true, likedAt: 100, likedSyncedAt: 150 },
      );
      expect(result.likedAt).toBe(900);
      expect(result.likedSyncedAt).toBe(950);
    });

    it("falls back to per-leaf rules when the like times agree", () => {
      const result = merged(
        { liked: true, likedAt: 100, likedSyncedAt: 150 },
        { liked: true, likedAt: 100, likedSyncedAt: 900 },
      );
      expect(result.likedAt).toBe(100);
      expect(result.likedSyncedAt).toBe(900);
    });
  });

  it("unions tags without reordering the ones already present", () => {
    expect(merged({ tags: ["b", "a"] }, { tags: ["a", "c"] }).tags).toStrictEqual([
      "b",
      "a",
      "c",
    ]);
  });
});

describe("saved and archived converge independently", () => {
  it("produces an item that is both saved and archived", () => {
    // Not a bug report. `toggleSaved` clears archive state and `toggleArchived`
    // refuses to run on a saved item, so the exclusion holds on one device.
    // Merge does not enforce it, and the product repairs the result instead.
    expect(merged({ saved: true, savedAt: 100 }, { archived: true, archivedAt: 200 }))
      .toMatchObject({ saved: true, archived: true });
    expect(merged({ archived: true, archivedAt: 200 }, { saved: true, savedAt: 100 }))
      .toMatchObject({ saved: true, archived: true });
    expect(LIBRARY_CORE_SAVED_ARCHIVED_EXCLUSION_IS_PER_DEVICE_ONLY).toBe(true);
  });

  it("reaches that state through the shipping deduplication entry point", () => {
    // Reachability matters more than the unit result: this is the path real
    // documents take, not a direct call to an internal helper.
    const doc = {
      feedItems: {
        keeper: item("keeper", { saved: true, savedAt: 100 }),
        duplicate: item("duplicate", { archived: true, archivedAt: 200 }),
      },
    } as unknown as FreedDoc;

    expect(deduplicateDocFeedItems(doc)).toBe(1);

    const survivors = Object.values(doc.feedItems) as FeedItem[];
    expect(survivors).toHaveLength(1);
    expect(survivors[0]?.userState).toMatchObject({ saved: true, archived: true });
  });
});
