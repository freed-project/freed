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

function applyCountState(state: DocState, counts: CountState): DocState {
  return {
    ...state,
    ...counts,
  };
}

export function applyItemPatchesToState(
  state: DocState,
  patches: FeedItemPatch[],
  itemIndex: ItemIndex,
): { state: DocState; itemIndex: ItemIndex } {
  if (patches.length === 0) return { state, itemIndex };

  let nextItems: FeedItem[] | null = null;
  let counts: CountState | null = null;
  let indexNeedsRebuild = false;

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
      const items = ensureItems();
      items.push(item);
      itemIndex.set(item.globalId, items.length - 1);
      applyItemContribution(ensureCounts(), item, 1);
      continue;
    }

    const items = ensureItems();
    const previous = items[existingIndex];
    if (!previous) continue;

    applyItemContribution(ensureCounts(), previous, -1);
    if (item.userState.hidden) {
      items.splice(existingIndex, 1);
      itemIndex.delete(item.globalId);
      indexNeedsRebuild = true;
      continue;
    }

    items[existingIndex] = item;
    applyItemContribution(ensureCounts(), item, 1);
  }

  if (!nextItems || !counts) return { state, itemIndex };
  const nextIndex = indexNeedsRebuild ? createItemIndex(nextItems) : itemIndex;
  return {
    state: applyCountState({ ...state, items: nextItems }, counts),
    itemIndex: nextIndex,
  };
}
