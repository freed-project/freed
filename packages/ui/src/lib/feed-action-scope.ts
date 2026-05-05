import type { FeedItem } from "@freed/shared";

export interface FeedActionScope {
  unreadItemIds: string[];
  archivableItemIds: string[];
  unreadCount: number;
  archivableCount: number;
}

export interface FeedArchiveCounts {
  archivedCount: number;
  savedArchivedCount: number;
}

const actionScopeCache = new WeakMap<readonly FeedItem[], FeedActionScope>();
const archiveCountsCache = new WeakMap<readonly FeedItem[], FeedArchiveCounts>();

export function getFeedActionScope(items: readonly FeedItem[]): FeedActionScope {
  const cached = actionScopeCache.get(items);
  if (cached) return cached;

  const unreadItemIds: string[] = [];
  const archivableItemIds: string[] = [];

  for (const item of items) {
    if (item.userState.hidden || item.userState.archived) continue;
    if (!item.userState.readAt) {
      unreadItemIds.push(item.globalId);
      continue;
    }
    if (!item.userState.saved) {
      archivableItemIds.push(item.globalId);
    }
  }

  const scope = {
    unreadItemIds,
    archivableItemIds,
    unreadCount: unreadItemIds.length,
    archivableCount: archivableItemIds.length,
  };
  actionScopeCache.set(items, scope);
  return scope;
}

export function getFeedArchiveCounts(items: readonly FeedItem[]): FeedArchiveCounts {
  const cached = archiveCountsCache.get(items);
  if (cached) return cached;

  let archivedCount = 0;
  let savedArchivedCount = 0;
  for (const item of items) {
    if (!item.userState.archived) continue;
    if (item.userState.saved) {
      savedArchivedCount += 1;
    } else {
      archivedCount += 1;
    }
  }

  const counts = { archivedCount, savedArchivedCount };
  archiveCountsCache.set(items, counts);
  return counts;
}
