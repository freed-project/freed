import type { RssFeed } from "@freed/shared";

export const SCHEDULED_RSS_STALE_AFTER_MS = 2 * 60 * 60 * 1000;
export const SCHEDULED_RSS_MAX_FEEDS = 80;

export interface RssRefreshPlanOptions {
  staleAfterMs?: number;
  maxFeeds?: number;
  now?: number;
}

function lastFetchedAt(feed: RssFeed): number {
  return typeof feed.lastFetched === "number" && Number.isFinite(feed.lastFetched)
    ? feed.lastFetched
    : 0;
}

function compareFeedsForRefresh(left: RssFeed, right: RssFeed): number {
  return (
    lastFetchedAt(left) - lastFetchedAt(right) ||
    (left.title || left.url).localeCompare(right.title || right.url) ||
    left.url.localeCompare(right.url)
  );
}

export function selectRssFeedsForRefresh(
  feeds: RssFeed[],
  options: RssRefreshPlanOptions = {},
): RssFeed[] {
  const enabled = feeds.filter((feed) => feed.enabled);
  const maxFeeds = options.maxFeeds ?? enabled.length;
  if (maxFeeds <= 0) return [];

  if (options.staleAfterMs === undefined) {
    return enabled.slice().sort(compareFeedsForRefresh).slice(0, maxFeeds);
  }

  const now = options.now ?? Date.now();
  const due = enabled.filter((feed) => {
    const fetchedAt = lastFetchedAt(feed);
    return fetchedAt === 0 || now - fetchedAt >= options.staleAfterMs!;
  });

  return due.slice().sort(compareFeedsForRefresh).slice(0, maxFeeds);
}
