import type {
  Account,
  FeedItem,
  FriendCandidateActivityAggregate,
  RssFeed,
} from "@freed/shared";
import { compareUtf8Binary } from "@freed/shared";
import type {
  LibraryFriendsGraph,
  LibraryFriendsGraphRequest,
  LibraryFriendsGraphSocialActivity,
} from "../context/PlatformContext.js";
import {
  buildIdentityGraphActivitySummariesFromCompact,
  socialActivitySummaryKey,
  type IdentityGraphActivitySummaries,
} from "./identity-graph-activity-summary.js";

const FRIEND_SUGGESTION_WINDOW_MS = 45 * 24 * 60 * 60 * 1_000;
export interface FriendsActivityReadModel {
  readonly candidateActivityBySourceKey: Readonly<
    Record<string, FriendCandidateActivityAggregate>
  >;
  readonly graphActivitySummaries: IdentityGraphActivitySummaries;
  readonly socialActivityBySourceKey: Readonly<
    Record<string, LibraryFriendsGraphSocialActivity>
  >;
}

export interface FriendSourceActivityEvidence {
  readonly firstSeenAt: number;
  readonly lastSeenAt: number;
  readonly discoveredFrom: "captured_item" | "story_author";
}

/**
 * Preserve native summaries for registered sources while an open Friend editor
 * supplements only authors that the graph request could not know about.
 */
export function buildFriendSourceActivityEvidence({
  accounts,
  nativeActivityBySourceKey,
  compatibilityItems,
}: {
  accounts: Readonly<Record<string, Account>>;
  nativeActivityBySourceKey: Readonly<
    Record<string, LibraryFriendsGraphSocialActivity>
  > | null;
  compatibilityItems: Readonly<Record<string, FeedItem>>;
}): ReadonlyMap<string, FriendSourceActivityEvidence> {
  const evidence = new Map<string, FriendSourceActivityEvidence>();
  const nativeSourceKeys = new Set<string>();
  if (nativeActivityBySourceKey) {
    const existingAccountBySource = new Map<string, Account>();
    for (const account of Object.values(accounts)) {
      if (account.kind !== "social") continue;
      existingAccountBySource.set(
        socialActivitySummaryKey(account.provider, account.externalId),
        account,
      );
    }
    for (const [key, summary] of Object.entries(nativeActivityBySourceKey)) {
      nativeSourceKeys.add(key);
      if (summary.itemCount <= 0) continue;
      const existingAccount = existingAccountBySource.get(key);
      evidence.set(key, {
        firstSeenAt: summary.latestActivityAt,
        lastSeenAt: summary.latestActivityAt,
        discoveredFrom:
          existingAccount?.discoveredFrom === "story_author"
            ? "story_author"
            : "captured_item",
      });
    }
  }

  const discoveryItemIdBySource = new Map<string, string>();
  for (const item of Object.values(compatibilityItems)) {
    const key = socialActivitySummaryKey(item.platform, item.author.id);
    if (nativeSourceKeys.has(key)) continue;
    const current = evidence.get(key);
    const discoveryItemId = discoveryItemIdBySource.get(key);
    const replacesDiscovery =
      !current ||
      item.publishedAt < current.firstSeenAt ||
      (item.publishedAt === current.firstSeenAt &&
        (!discoveryItemId ||
          compareUtf8Binary(item.globalId, discoveryItemId) < 0));
    evidence.set(key, {
      firstSeenAt: current
        ? Math.min(current.firstSeenAt, item.publishedAt)
        : item.publishedAt,
      lastSeenAt: current
        ? Math.max(current.lastSeenAt, item.publishedAt)
        : item.publishedAt,
      discoveredFrom: replacesDiscovery
        ? item.contentType === "story"
          ? "story_author"
          : "captured_item"
        : current.discoveredFrom,
    });
    if (replacesDiscovery) discoveryItemIdBySource.set(key, item.globalId);
  }
  return evidence;
}

export function friendSourceAccountProvenance(
  activity: FriendSourceActivityEvidence | null,
  now: number,
): Pick<Account, "firstSeenAt" | "lastSeenAt" | "discoveredFrom"> {
  return activity
    ? {
        firstSeenAt: activity.firstSeenAt,
        lastSeenAt: activity.lastSeenAt,
        discoveredFrom: activity.discoveredFrom,
      }
    : {
        firstSeenAt: now,
        lastSeenAt: now,
        discoveredFrom: "manual_entry",
      };
}

/** Keep archived activity while matching native readers' hidden-row exclusion. */
export function buildVisibleFriendsFallbackItems(
  items: readonly FeedItem[],
): Record<string, FeedItem> {
  const visible: Record<string, FeedItem> = {};
  for (const item of items) {
    if (!item.userState.hidden) visible[item.globalId] = item;
  }
  return visible;
}

/** Build one deterministic request for the compact Friends overview. */
export function createLibraryFriendsGraphRequest(
  accounts: Readonly<Record<string, Account>>,
  feeds: Readonly<Record<string, RssFeed>>,
  referenceTimeMs = Date.now(),
): LibraryFriendsGraphRequest {
  const sources = new Map<string, { platform: string; authorId: string }>();
  for (const account of Object.values(accounts)) {
    if (account.kind !== "social") continue;
    const platform = account.provider;
    const authorId = account.externalId;
    if (!platform.trim() || !authorId.trim()) continue;
    const key = socialActivitySummaryKey(platform, authorId);
    if (!sources.has(key)) sources.set(key, { platform, authorId });
  }
  const rssFeedUrls = [
    ...new Set(
      Object.values(feeds)
        .map((feed) => feed.url)
        .filter((feedUrl) => feedUrl.trim().length > 0),
    ),
  ].sort(compareUtf8Binary);
  return {
    sources: [...sources.values()].sort(
      (left, right) =>
        compareUtf8Binary(left.platform, right.platform) ||
        compareUtf8Binary(left.authorId, right.authorId),
    ),
    rssFeedUrls,
    recentWindow: {
      startMs: referenceTimeMs - FRIEND_SUGGESTION_WINDOW_MS,
      endMs: referenceTimeMs,
    },
  };
}

/** Adapt native SQLite aggregates to the existing Friends product contracts. */
export function buildFriendsActivityReadModel(
  graph: LibraryFriendsGraph,
): FriendsActivityReadModel {
  const candidateActivityBySourceKey: Record<
    string,
    FriendCandidateActivityAggregate
  > = {};
  const socialActivityBySourceKey: Record<
    string,
    LibraryFriendsGraphSocialActivity
  > = {};
  for (const activity of graph.social) {
    const key = socialActivitySummaryKey(activity.platform, activity.authorId);
    const signalCounts: FriendCandidateActivityAggregate["signalCounts"] = {};
    for (const signal of activity.signalCounts) {
      signalCounts[signal.label] = signal.count;
    }
    candidateActivityBySourceKey[key] = {
      itemCount: activity.itemCount,
      latestActivityAt: activity.latestActivityAt,
      recentCount: activity.recentCount,
      sampleItemIds: activity.sampleItems.map((sample) => sample.globalId),
      signalCounts,
    };
    socialActivityBySourceKey[key] = activity;
  }
  return {
    candidateActivityBySourceKey,
    graphActivitySummaries:
      buildIdentityGraphActivitySummariesFromCompact(graph),
    socialActivityBySourceKey,
  };
}
