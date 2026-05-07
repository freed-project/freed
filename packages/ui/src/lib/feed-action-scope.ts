import type { FeedItem } from "@freed/shared";

interface FeedActionCounts {
  unreadCount: number;
  archivableCount: number;
}

export interface FeedArchiveCounts {
  archivedCount: number;
  savedArchivedCount: number;
}

const actionCountsCache = new WeakMap<readonly FeedItem[], FeedActionCounts>();
const archiveCountsCache = new WeakMap<readonly FeedItem[], FeedArchiveCounts>();

export function getFeedActionCounts(items: readonly FeedItem[]): FeedActionCounts {
  const cached = actionCountsCache.get(items);
  if (cached) return cached;

  let unreadCount = 0;
  let archivableCount = 0;

  for (const item of items) {
    if (item.userState.hidden || item.userState.archived) continue;
    if (!item.userState.readAt) {
      unreadCount += 1;
      continue;
    }
    if (!item.userState.saved) {
      archivableCount += 1;
    }
  }

  const counts = { unreadCount, archivableCount };
  actionCountsCache.set(items, counts);
  return counts;
}

export function collectUnreadFeedActionIds(items: readonly FeedItem[]): string[] {
  const ids: string[] = [];
  for (const item of items) {
    if (item.userState.hidden || item.userState.archived || item.userState.readAt) continue;
    ids.push(item.globalId);
  }
  return ids;
}

export function collectArchivableFeedActionIds(items: readonly FeedItem[]): string[] {
  const ids: string[] = [];
  for (const item of items) {
    if (item.userState.hidden || item.userState.archived || !item.userState.readAt || item.userState.saved) {
      continue;
    }
    ids.push(item.globalId);
  }
  return ids;
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
