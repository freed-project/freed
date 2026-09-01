import type { FeedItem } from "@freed/shared";
import type { LibraryCoreChangeFeedRowV1 } from "@freed/shared/library-core";
import { describe, expect, it } from "vitest";

import { libraryMutationEventsFromChangeFeed } from "./library-core-change-feed-runtime";

const row = (
  topic: string,
  entityId: string | null,
  ordinal: number,
  resetRequired = false,
): LibraryCoreChangeFeedRowV1 => ({
  entityId: entityId as never,
  ordinal,
  resetRequired,
  revision: 7,
  topic,
});

describe("Desktop Library Core change-feed runtime", () => {
  it("turns canonical identities into bounded query reruns without a corpus event", () => {
    const item = { globalId: "item-1" } as FeedItem;
    expect(
      libraryMutationEventsFromChangeFeed(
        [
          row("feed_item", "item-1", 0),
          row("feed_item", "item-1", 1),
          row("preferences", "preferences", 2),
          row("rss_feed", "feed-1", 3),
        ],
        [item, { globalId: "foreign-item" } as FeedItem],
        "MARK_AS_READ",
      ),
    ).toEqual([
      {
        source: "item_patch",
        mutation: "MARK_AS_READ",
        changedItemIds: ["item-1"],
        changedItems: [item],
        requiresFullScan: false,
      },
      {
        source: "preferences_patch",
        mutation: "MARK_AS_READ",
        changedItemIds: null,
        changedItems: [],
        requiresFullScan: false,
      },
      {
        source: "feeds_patch",
        mutation: "MARK_AS_READ",
        changedItemIds: null,
        changedItems: [],
        requiresFullScan: false,
      },
    ]);
  });

  it("fails broad and reset invalidations into one bounded query reset", () => {
    expect(
      libraryMutationEventsFromChangeFeed(
        [row("person", "person-1", 0), row("account", null, 1, true)],
        [],
      ),
    ).toEqual([
      {
        source: "state_update",
        mutation: undefined,
        changedItemIds: null,
        requiresFullScan: true,
      },
    ]);
  });
});
