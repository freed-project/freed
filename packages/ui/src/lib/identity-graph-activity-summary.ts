import { extractLocationFromItem, type FeedItem } from "@freed/shared";

export interface IdentityGraphActivitySummary {
  itemCount: number;
  latestActivityAt: number;
  sampleItemIds: string[];
  hasLocation: boolean;
  avatarUrl: string | null;
}

export interface IdentityGraphActivitySummaries {
  social: Record<string, IdentityGraphActivitySummary>;
  rss: Record<string, IdentityGraphActivitySummary>;
  buildMs: number;
  itemCount: number;
}

const MAX_SAMPLE_ITEM_IDS = 3;

function nowMs(): number {
  if (typeof performance !== "undefined" && typeof performance.now === "function") {
    return performance.now();
  }
  return Date.now();
}

export function socialActivitySummaryKey(provider: string, externalId: string): string {
  return `${provider}:${externalId}`;
}

function emptySummary(): IdentityGraphActivitySummary {
  return {
    itemCount: 0,
    latestActivityAt: 0,
    sampleItemIds: [],
    hasLocation: false,
    avatarUrl: null,
  };
}

function addItemToSummary(summary: IdentityGraphActivitySummary, item: FeedItem): void {
  summary.itemCount += 1;
  if (item.publishedAt >= summary.latestActivityAt) {
    summary.latestActivityAt = item.publishedAt;
    if (!summary.sampleItemIds.includes(item.globalId)) {
      summary.sampleItemIds.unshift(item.globalId);
      summary.sampleItemIds = summary.sampleItemIds.slice(0, MAX_SAMPLE_ITEM_IDS);
    }
  } else if (summary.sampleItemIds.length < MAX_SAMPLE_ITEM_IDS && !summary.sampleItemIds.includes(item.globalId)) {
    summary.sampleItemIds.push(item.globalId);
  }
  if (!summary.hasLocation && extractLocationFromItem(item)) {
    summary.hasLocation = true;
  }
  if (!summary.avatarUrl && item.author.avatarUrl) {
    summary.avatarUrl = item.author.avatarUrl;
  }
}

export function buildIdentityGraphActivitySummaries(
  feedItems: Record<string, FeedItem>,
): IdentityGraphActivitySummaries {
  const startedAt = nowMs();
  const social: Record<string, IdentityGraphActivitySummary> = {};
  const rss: Record<string, IdentityGraphActivitySummary> = {};
  let itemCount = 0;

  for (const item of Object.values(feedItems)) {
    itemCount += 1;
    if (item.platform === "rss" && item.rssSource?.feedUrl) {
      const key = item.rssSource.feedUrl;
      const summary = rss[key] ?? emptySummary();
      addItemToSummary(summary, item);
      rss[key] = summary;
      continue;
    }

    if (!item.author?.id) continue;
    const key = socialActivitySummaryKey(item.platform, item.author.id);
    const summary = social[key] ?? emptySummary();
    addItemToSummary(summary, item);
    social[key] = summary;
  }

  return {
    social,
    rss,
    buildMs: nowMs() - startedAt,
    itemCount,
  };
}
