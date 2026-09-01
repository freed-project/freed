import type { FeedItem } from "@freed/shared";
import type { LibraryCoreChangeFeedRowV1 } from "@freed/shared/library-core";

import type {
  LibraryMutationEvent,
  LibraryMutationRequest,
} from "./library-types";

/**
 * Convert one bounded canonical SQLite invalidation page into renderer events.
 *
 * The change feed supplies identities only. FeedItem rows in the result must
 * come from bounded point queries for those exact identities.
 */
export function libraryMutationEventsFromChangeFeed(
  rows: readonly LibraryCoreChangeFeedRowV1[],
  changedItems: readonly FeedItem[],
  mutation?: LibraryMutationRequest["type"],
): readonly LibraryMutationEvent[] {
  if (rows.length === 0) return [];

  const feedItemIds: string[] = [
    ...new Set(
      rows.flatMap((row) =>
        row.topic === "feed_item" && row.entityId !== null
          ? [row.entityId]
          : [],
      ),
    ),
  ];
  const feedItemIdSet = new Set<string>(feedItemIds);
  const queriedItems = changedItems.filter((item) =>
    feedItemIdSet.has(item.globalId),
  );
  const events: LibraryMutationEvent[] = [];

  if (
    rows.some(
      (row) =>
        row.resetRequired ||
        !["feed_item", "preferences", "rss_feed"].includes(row.topic) ||
        (row.topic === "feed_item" && row.entityId === null),
    )
  ) {
    events.push({
      source: "state_update",
      mutation,
      changedItemIds: null,
      requiresFullScan: true,
    });
  }
  if (feedItemIds.length > 0) {
    events.push({
      source: "item_patch",
      mutation,
      changedItemIds: feedItemIds,
      changedItems: queriedItems,
      requiresFullScan: false,
    });
  }
  if (rows.some((row) => row.topic === "preferences")) {
    events.push({
      source: "preferences_patch",
      mutation,
      changedItemIds: null,
      changedItems: [],
      requiresFullScan: false,
    });
  }
  if (rows.some((row) => row.topic === "rss_feed")) {
    events.push({
      source: "feeds_patch",
      mutation,
      changedItemIds: null,
      changedItems: [],
      requiresFullScan: false,
    });
  }
  return events;
}
