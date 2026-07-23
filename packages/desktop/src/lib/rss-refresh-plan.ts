import type { RssFeed } from "@freed/shared";

export const SCHEDULED_RSS_STALE_AFTER_MS = 2 * 60 * 60 * 1000;
export const SCHEDULED_RSS_MAX_FEEDS = 80;

export interface RssRefreshPlanOptions {
  staleAfterMs?: number;
  maxFeeds?: number;
  now?: number;
  respectRetryWindow?: boolean;
}

function lastFetchedAt(feed: RssFeed): number {
  return typeof feed.lastFetched === "number" && Number.isFinite(feed.lastFetched)
    ? feed.lastFetched
    : 0;
}

function isRetryWindowOpen(feed: RssFeed, now: number): boolean {
  return (
    typeof feed.nextFetchAfter !== "number" ||
    !Number.isFinite(feed.nextFetchAfter) ||
    feed.nextFetchAfter <= now
  );
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
  const now = options.now ?? Date.now();
  const eligible = options.respectRetryWindow === false
    ? enabled
    : enabled.filter((feed) => isRetryWindowOpen(feed, now));

  if (options.staleAfterMs === undefined) {
    return eligible.slice().sort(compareFeedsForRefresh).slice(0, maxFeeds);
  }

  const due = eligible.filter((feed) => {
    const fetchedAt = lastFetchedAt(feed);
    return fetchedAt === 0 || now - fetchedAt >= options.staleAfterMs!;
  });

  return due.slice().sort(compareFeedsForRefresh).slice(0, maxFeeds);
}
