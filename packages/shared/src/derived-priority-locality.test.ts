import * as A from "@automerge/automerge";
import { describe, expect, it } from "vitest";

import { LIBRARY_CORE_FIELD_REGISTRY } from "./library-core/field-registry.js";
import {
  addFeedItem,
  deduplicateDocFeedItems,
  mergeFeedItemInto,
  updateFeedItem,
} from "./schema.js";
import type { FreedDoc } from "./schema.js";
import type { FeedItem } from "./types.js";
import { FEED_ITEM_WRITE_POLICY } from "./sync-write-policy.js";

/**
 * `priority` and `priorityComputedAt` are declared device-local twice and
 * written by a path that consults neither declaration.
 *
 * `FEED_ITEM_WRITE_POLICY` marks both `device-local`, and the Library Core
 * field registry marks them `device-local` with `legacy-derived` locality. Both
 * sanitized write paths honour that: `addFeedItem` and `updateFeedItem` strip
 * them. `mergeFeedItemInto` assigns them directly on the Automerge object,
 * consulting no policy, and it is reached from `deduplicateDocFeedItems` and
 * all three provider capture reconcilers.
 *
 * The important qualifier, measured rather than assumed: merge **propagates**
 * these fields but never **originates** them. With neither side carrying a
 * value, nothing is written. So this is legacy data being kept alive and spread
 * from a duplicate onto its keeper, not new device-local data being minted.
 *
 * Recorded as it ships. See
 * https://github.com/freed-project/freed/issues/1339.
 */

const DERIVED_LEAVES = ["priority", "priorityComputedAt"] as const;

const item = (globalId: string, overrides: Record<string, unknown> = {}): FeedItem =>
  JSON.parse(
    JSON.stringify({
      globalId,
      platform: "rss",
      sourceId: "source",
      url: `https://example.com/${globalId}`,
      publishedAt: 1,
      capturedAt: 1,
      author: { id: "author", displayName: "Author" },
      content: {
        text: "text",
        mediaUrls: [],
        mediaTypes: [],
        linkPreview: { url: "https://example.com/story" },
      },
      topics: [],
      userState: { hidden: false, saved: false, archived: false, tags: [] },
      ...overrides,
    }),
  ) as FeedItem;

const emptyDoc = (): FreedDoc =>
  A.from({
    feedItems: {},
    persons: {},
    accounts: {},
    rssFeeds: {},
    preferences: {},
    meta: {},
  } as never) as unknown as FreedDoc;

const feedItemsOf = (doc: unknown): Record<string, Record<string, unknown>> =>
  (doc as { feedItems: Record<string, Record<string, unknown>> }).feedItems;

describe("derived priority is declared device-local", () => {
  it("is declared device-local in both registries that describe it", () => {
    // Two independent declarations. If they ever disagree, the disagreement is
    // itself the finding, so both are asserted rather than one.
    for (const leaf of DERIVED_LEAVES) {
      expect(FEED_ITEM_WRITE_POLICY[leaf]).toBe("device-local");

      const entry = LIBRARY_CORE_FIELD_REGISTRY.find(
        (candidate) =>
          candidate.registryKey === `library-core-v1:feedItems.{globalId}.${leaf}`,
      );
      expect(entry).toBeDefined();
      expect(entry).toMatchObject({ currentLocality: "legacy-derived" });
    }
  });

  it.each(DERIVED_LEAVES)("addFeedItem strips %s", (leaf) => {
    const doc = A.change(emptyDoc() as never, (draft: never) => {
      addFeedItem(draft as unknown as FreedDoc, item("a", { [leaf]: 7 }));
    });
    expect(feedItemsOf(doc).a?.[leaf]).toBeUndefined();
  });

  it.each(DERIVED_LEAVES)("updateFeedItem strips %s", (leaf) => {
    let doc = A.change(emptyDoc() as never, (draft: never) => {
      addFeedItem(draft as unknown as FreedDoc, item("a"));
    });
    doc = A.change(doc, (draft: never) => {
      updateFeedItem(draft as unknown as FreedDoc, "a", { [leaf]: 7 } as never);
    });
    expect(feedItemsOf(doc).a?.[leaf]).toBeUndefined();
  });

  it("addFeedItem still stores an ordinary synchronized field", () => {
    // The positive control. A writer that dropped everything would satisfy the
    // four assertions above without honouring any policy.
    const doc = A.change(emptyDoc() as never, (draft: never) => {
      addFeedItem(draft as unknown as FreedDoc, item("a", { sourceUrl: "https://example.com/s" }));
    });
    expect(feedItemsOf(doc).a?.sourceUrl).toBe("https://example.com/s");
  });
});

describe("merge writes those leaves without consulting either declaration", () => {
  it("propagates a value from the source onto the target", () => {
    const keeper = item("keeper");
    mergeFeedItemInto(
      keeper,
      item("duplicate", { priority: 5, priorityComputedAt: 700 }),
    );
    expect(keeper).toMatchObject({ priority: 5, priorityComputedAt: 700 });
  });

  it("never originates a value when neither side carries one", () => {
    // The qualifier that keeps this honest. Merge spreads legacy data; it does
    // not mint new device-local data.
    const keeper = item("keeper");
    mergeFeedItemInto(keeper, item("duplicate"));
    for (const leaf of DERIVED_LEAVES) {
      expect(keeper).not.toHaveProperty(leaf);
    }
  });

  it("collapses a zero priority to absent rather than storing it", () => {
    const keeper = item("keeper", { priority: 0 });
    mergeFeedItemInto(keeper, item("duplicate", { priority: 0 }));
    expect(keeper).not.toHaveProperty("priority");
  });

  it("reaches the document through the shipping deduplication path", () => {
    // Reachability is the point. A direct call to an internal helper would
    // prove much less than the path a real document takes.
    let doc = A.change(emptyDoc() as never, (draft: never) => {
      addFeedItem(draft as unknown as FreedDoc, item("keeper"));
      addFeedItem(draft as unknown as FreedDoc, item("duplicate"));
    });

    // Both were stripped on the way in, which is what makes the next step the
    // only way these leaves can appear at all.
    for (const stored of Object.values(feedItemsOf(doc))) {
      expect(stored.priority).toBeUndefined();
    }

    doc = A.change(doc, (draft: never) => {
      const carrier = {
        ...JSON.parse(JSON.stringify(feedItemsOf(draft).duplicate)),
        priority: 9,
        priorityComputedAt: 1_500,
      };
      mergeFeedItemInto(
        feedItemsOf(draft).keeper as unknown as FeedItem,
        carrier as FeedItem,
      );
    });
    doc = A.change(doc, (draft: never) => {
      deduplicateDocFeedItems(draft as unknown as FreedDoc);
    });

    const survivors = Object.values(feedItemsOf(doc));
    expect(survivors).toHaveLength(1);
    expect(survivors[0]).toMatchObject({
      priority: 9,
      priorityComputedAt: 1_500,
    });
  });
});
