import {
  compareUtf8Binary,
  extractLocationFromItem,
  friendCandidateActivitySourceKey,
  type FeedItem,
} from "@freed/shared";

export interface IdentityGraphActivitySummary {
  itemCount: number;
  latestActivityAt: number;
  sampleItemIds: string[];
  hasLocation: boolean;
  avatarUrl: string | null;
  avatarPublishedAt: number | null;
  avatarGlobalId: string | null;
}

export interface IdentityGraphActivitySummaries {
  social: Record<string, IdentityGraphActivitySummary>;
  rss: Record<string, IdentityGraphActivitySummary>;
  buildMs: number;
  itemCount: number;
}

export interface CompactIdentityGraphActivitySample {
  globalId: string;
  publishedAt: number;
}

export interface CompactIdentityGraphSocialActivity {
  platform: string;
  authorId: string;
  itemCount: number;
  latestActivityAt: number;
  sampleItems: readonly CompactIdentityGraphActivitySample[];
  hasLocation: boolean;
  avatarUrl: string | null;
  avatarPublishedAt: number | null;
  avatarGlobalId: string | null;
}

export interface CompactIdentityGraphRssActivity {
  feedUrl: string;
  itemCount: number;
  latestActivityAt: number;
  sampleItems: readonly CompactIdentityGraphActivitySample[];
  hasLocation: boolean;
  avatarUrl: string | null;
  avatarPublishedAt: number | null;
  avatarGlobalId: string | null;
}

export interface CompactIdentityGraphActivity {
  totalItemCount: number;
  social: readonly CompactIdentityGraphSocialActivity[];
  rss: readonly CompactIdentityGraphRssActivity[];
}

const MAX_SAMPLE_ITEM_IDS = 3;
const sampleItemsBySummary = new WeakMap<
  IdentityGraphActivitySummary,
  CompactIdentityGraphActivitySample[]
>();

function nowMs(): number {
  if (typeof performance !== "undefined" && typeof performance.now === "function") {
    return performance.now();
  }
  return Date.now();
}

export function socialActivitySummaryKey(provider: string, externalId: string): string {
  return friendCandidateActivitySourceKey(provider, externalId);
}

function emptySummary(): IdentityGraphActivitySummary {
  const summary: IdentityGraphActivitySummary = {
    itemCount: 0,
    latestActivityAt: 0,
    sampleItemIds: [],
    hasLocation: false,
    avatarUrl: null,
    avatarPublishedAt: null,
    avatarGlobalId: null,
  };
  sampleItemsBySummary.set(summary, []);
  return summary;
}

function addItemToSummary(summary: IdentityGraphActivitySummary, item: FeedItem): void {
  summary.itemCount += 1;
  summary.latestActivityAt = Math.max(summary.latestActivityAt, item.publishedAt);
  const samples = sampleItemsBySummary.get(summary);
  if (samples && !samples.some((sample) => sample.globalId === item.globalId)) {
    samples.push({ globalId: item.globalId, publishedAt: item.publishedAt });
    samples.sort(
      (left, right) =>
        right.publishedAt - left.publishedAt ||
        compareUtf8Binary(left.globalId, right.globalId),
    );
    samples.splice(MAX_SAMPLE_ITEM_IDS);
    summary.sampleItemIds = samples.map((sample) => sample.globalId);
  }
  if (!summary.hasLocation && extractLocationFromItem(item)) {
    summary.hasLocation = true;
  }
  if (
    item.author.avatarUrl &&
    (summary.avatarPublishedAt === null ||
      item.publishedAt > summary.avatarPublishedAt ||
      (item.publishedAt === summary.avatarPublishedAt &&
        summary.avatarGlobalId !== null &&
        compareUtf8Binary(item.globalId, summary.avatarGlobalId) < 0))
  ) {
    summary.avatarUrl = item.author.avatarUrl;
    summary.avatarPublishedAt = item.publishedAt;
    summary.avatarGlobalId = item.globalId;
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

/** Adapt compact row-store activity without constructing FeedItem stand-ins. */
export function buildIdentityGraphActivitySummariesFromCompact(
  activity: CompactIdentityGraphActivity,
): IdentityGraphActivitySummaries {
  const startedAt = nowMs();
  const social: Record<string, IdentityGraphActivitySummary> = {};
  const rss: Record<string, IdentityGraphActivitySummary> = {};
  for (const entry of activity.social) {
    social[socialActivitySummaryKey(entry.platform, entry.authorId)] = {
      itemCount: entry.itemCount,
      latestActivityAt: entry.latestActivityAt,
      sampleItemIds: entry.sampleItems
        .slice(0, MAX_SAMPLE_ITEM_IDS)
        .map((sample) => sample.globalId),
      hasLocation: entry.hasLocation,
      avatarUrl: entry.avatarUrl,
      avatarPublishedAt: entry.avatarPublishedAt,
      avatarGlobalId: entry.avatarGlobalId,
    };
  }
  for (const entry of activity.rss) {
    rss[entry.feedUrl] = {
      itemCount: entry.itemCount,
      latestActivityAt: entry.latestActivityAt,
      sampleItemIds: entry.sampleItems
        .slice(0, MAX_SAMPLE_ITEM_IDS)
        .map((sample) => sample.globalId),
      hasLocation: entry.hasLocation,
      avatarUrl: entry.avatarUrl,
      avatarPublishedAt: entry.avatarPublishedAt,
      avatarGlobalId: entry.avatarGlobalId,
    };
  }
  return {
    social,
    rss,
    buildMs: nowMs() - startedAt,
    itemCount: activity.totalItemCount,
  };
}
