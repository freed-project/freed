import type { FeedItem } from "@freed/shared";
import type { DocState, FeedItemPatch } from "./automerge-types";

export type ItemIndex = Map<string, number>;

interface CountState {
  feedUnreadCounts: Record<string, number>;
  feedTotalCounts: Record<string, number>;
  unreadCountByPlatform: Record<string, number>;
  itemCountByPlatform: Record<string, number>;
  archivableCountByPlatform: Record<string, number>;
  archivableFeedCounts: Record<string, number>;
  totalUnreadCount: number;
  totalItemCount: number;
  totalArchivableCount: number;
}

export function createItemIndex(items: FeedItem[]): ItemIndex {
  return new Map(items.map((item, index) => [item.globalId, index]));
}

function cloneCountState(state: DocState): CountState {
  return {
    feedUnreadCounts: { ...state.feedUnreadCounts },
    feedTotalCounts: { ...state.feedTotalCounts },
    unreadCountByPlatform: { ...state.unreadCountByPlatform },
    itemCountByPlatform: { ...state.itemCountByPlatform },
    archivableCountByPlatform: { ...state.archivableCountByPlatform },
    archivableFeedCounts: { ...state.archivableFeedCounts },
    totalUnreadCount: state.totalUnreadCount,
    totalItemCount: state.totalItemCount,
    totalArchivableCount: state.totalArchivableCount,
  };
}

function bumpCount(record: Record<string, number>, key: string, delta: 1 | -1): void {
  const next = (record[key] ?? 0) + delta;
  if (next <= 0) {
    delete record[key];
    return;
  }
  record[key] = next;
}

function applyItemContribution(counts: CountState, item: FeedItem, delta: 1 | -1): void {
  if (item.userState.hidden || item.userState.archived) return;

  counts.totalItemCount += delta;
  bumpCount(counts.itemCountByPlatform, item.platform, delta);

  const feedUrl = item.rssSource?.feedUrl;
  if (feedUrl) {
    bumpCount(counts.feedTotalCounts, feedUrl, delta);
  }

  if (!item.userState.readAt) {
    counts.totalUnreadCount += delta;
    bumpCount(counts.unreadCountByPlatform, item.platform, delta);
    if (feedUrl) {
      bumpCount(counts.feedUnreadCounts, feedUrl, delta);
    }
    return;
  }

  if (!item.userState.saved) {
    counts.totalArchivableCount += delta;
    bumpCount(counts.archivableCountByPlatform, item.platform, delta);
    if (feedUrl) {
      bumpCount(counts.archivableFeedCounts, feedUrl, delta);
    }
  }
}

function countContributionKey(item: FeedItem): string {
  const userState = item.userState;
  if (userState.hidden || userState.archived) return "excluded";
  return [
    item.platform,
    item.rssSource?.feedUrl ?? "",
    userState.readAt ? "read" : "unread",
    userState.saved ? "saved" : "unsaved",
  ].join("|");
}

function countContributionChanged(previous: FeedItem, next: FeedItem): boolean {
  return countContributionKey(previous) !== countContributionKey(next);
}

function applyCountState(state: DocState, counts: CountState): DocState {
  return {
    ...state,
    ...counts,
  };
}

function priorityValue(item: FeedItem): number {
  return item.priority ?? 0;
}

function orderTimestamp(item: FeedItem): number {
  return item.publishedAt || item.capturedAt;
}

function comparePriorityOrder(left: FeedItem, right: FeedItem): number {
  const priorityDelta = priorityValue(right) - priorityValue(left);
  if (priorityDelta !== 0) return priorityDelta;

  const timeDelta = orderTimestamp(right) - orderTimestamp(left);
  if (timeDelta !== 0) return timeDelta;

  return left.globalId.localeCompare(right.globalId);
}

function mergePriorityOrderedItems(existingItems: FeedItem[], addedItems: FeedItem[]): FeedItem[] {
  if (addedItems.length === 0) return existingItems;

  const orderedAddedItems = [...addedItems].sort(comparePriorityOrder);
  const merged: FeedItem[] = [];
  let addedIndex = 0;

  for (const existingItem of existingItems) {
    while (
      addedIndex < orderedAddedItems.length &&
      comparePriorityOrder(orderedAddedItems[addedIndex], existingItem) < 0
    ) {
      merged.push(orderedAddedItems[addedIndex]);
      addedIndex += 1;
    }
    merged.push(existingItem);
  }

  while (addedIndex < orderedAddedItems.length) {
    merged.push(orderedAddedItems[addedIndex]);
    addedIndex += 1;
  }

  return merged;
}

export function applyItemPatchesToState(
  state: DocState,
  patches: FeedItemPatch[],
  itemIndex: ItemIndex,
  options: {
    orderedItemIds?: string[];
    preservePriorityOrder?: boolean;
    searchCorpusVersion?: number;
    docItemCount?: number;
  } = {},
): { state: DocState; itemIndex: ItemIndex } {
  if (patches.length === 0 && !options.orderedItemIds) {
    const metadataChanged =
      options.searchCorpusVersion !== undefined || options.docItemCount !== undefined;
    return metadataChanged
      ? {
          state: {
            ...state,
            searchCorpusVersion: options.searchCorpusVersion ?? state.searchCorpusVersion,
            docItemCount: options.docItemCount ?? state.docItemCount,
          },
          itemIndex,
        }
      : { state, itemIndex };
  }

  let nextItems: FeedItem[] | null = null;
  let counts: CountState | null = null;
  let indexNeedsRebuild = false;
  const priorityOrderedAdditions: FeedItem[] = [];
  let addedDocItemCount = 0;

  const ensureItems = () => {
    nextItems ??= state.items.slice();
    return nextItems;
  };
  const ensureCounts = () => {
    counts ??= cloneCountState(state);
    return counts;
  };

  for (const patch of patches) {
    const item = patch.item;
    const existingIndex = itemIndex.get(item.globalId);

    if (existingIndex === undefined) {
      if (item.userState.hidden) continue;
      addedDocItemCount += 1;
      if (options.preservePriorityOrder) {
        ensureItems();
        priorityOrderedAdditions.push(item);
        indexNeedsRebuild = true;
      } else {
        const items = ensureItems();
        items.push(item);
        itemIndex.set(item.globalId, items.length - 1);
      }
      applyItemContribution(ensureCounts(), item, 1);
      continue;
    }

    const items = ensureItems();
    const previous = items[existingIndex];
    if (!previous) continue;

    const countChanged = countContributionChanged(previous, item);
    if (countChanged) {
      applyItemContribution(ensureCounts(), previous, -1);
    }

    if (item.userState.hidden) {
      items.splice(existingIndex, 1);
      itemIndex.delete(item.globalId);
      indexNeedsRebuild = true;
      continue;
    }

    items[existingIndex] = item;
    if (countChanged) {
      applyItemContribution(ensureCounts(), item, 1);
    }
  }

  if (priorityOrderedAdditions.length > 0) {
    nextItems = mergePriorityOrderedItems(ensureItems(), priorityOrderedAdditions);
    indexNeedsRebuild = true;
  }

  const itemsForOrdering = nextItems as FeedItem[] | null;
  if (itemsForOrdering && options.orderedItemIds) {
    const itemById = new Map<string, FeedItem>(
      itemsForOrdering.map((item) => [item.globalId, item]),
    );
    const reorderedItems: FeedItem[] = [];
    for (const globalId of options.orderedItemIds) {
      const item = itemById.get(globalId);
      if (!item) continue;
      reorderedItems.push(item);
      itemById.delete(globalId);
    }
    if (reorderedItems.length > 0) {
      nextItems = [...reorderedItems, ...itemById.values()];
      indexNeedsRebuild = true;
    }
  }

  if (!nextItems) {
    const docItemCount = options.docItemCount ??
      (addedDocItemCount > 0 ? state.docItemCount + addedDocItemCount : state.docItemCount);
    return {
      state: {
        ...state,
        searchCorpusVersion: options.searchCorpusVersion ?? state.searchCorpusVersion,
        docItemCount,
      },
      itemIndex,
    };
  }
  const nextIndex = indexNeedsRebuild ? createItemIndex(nextItems) : itemIndex;
  const docItemCount = options.docItemCount ??
    (addedDocItemCount > 0 ? state.docItemCount + addedDocItemCount : state.docItemCount);
  const metadataState = {
    searchCorpusVersion: options.searchCorpusVersion ?? state.searchCorpusVersion,
    docItemCount,
  };
  return {
    state: counts
      ? applyCountState({ ...state, ...metadataState, items: nextItems }, counts)
      : { ...state, ...metadataState, items: nextItems },
    itemIndex: nextIndex,
  };
}
