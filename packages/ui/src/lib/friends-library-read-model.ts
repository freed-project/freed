import type { Account } from "@freed/shared";
import { compareUtf8Binary } from "@freed/shared";
import type {
  LibraryFriendsGraph,
  LibraryFriendsGraphRequest,
  LibraryFriendsSource,
  LibraryFriendsGraphSocialActivity,
} from "../context/PlatformContext.js";
import { socialActivitySummaryKey } from "./identity-graph-activity-summary.js";

const FRIEND_SUGGESTION_WINDOW_MS = 45 * 24 * 60 * 60 * 1_000;
export interface FriendsActivityReadModel {
  readonly socialActivityBySourceKey: Readonly<
    Record<string, LibraryFriendsGraphSocialActivity>
  >;
}

export interface FriendSourceActivityEvidence {
  readonly firstSeenAt: number;
  readonly lastSeenAt: number;
  readonly discoveredFrom: "captured_item" | "story_author";
}

/** Convert compact SQLite activity into source provenance for Friend writes. */
export function buildFriendSourceActivityEvidence({
  activityBySourceKey,
}: {
  activityBySourceKey: Readonly<
    Record<string, LibraryFriendsGraphSocialActivity>
  >;
}): ReadonlyMap<string, FriendSourceActivityEvidence> {
  const evidence = new Map<string, FriendSourceActivityEvidence>();
  for (const [key, summary] of Object.entries(activityBySourceKey)) {
    if (summary.itemCount <= 0) continue;
    evidence.set(key, {
      firstSeenAt: summary.latestActivityAt,
      lastSeenAt: summary.latestActivityAt,
      discoveredFrom: "captured_item",
    });
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

/** Build one deterministic request for the compact Friends overview. */
export function createLibraryFriendsGraphRequest(
  visibleSources: readonly LibraryFriendsSource[],
  referenceTimeMs = Date.now(),
): LibraryFriendsGraphRequest {
  const sources = new Map<string, { platform: string; authorId: string }>();
  for (const source of visibleSources) {
    const platform = source.platform;
    const authorId = source.authorId;
    if (!platform.trim() || !authorId.trim()) continue;
    const key = socialActivitySummaryKey(platform, authorId);
    if (!sources.has(key)) sources.set(key, { platform, authorId });
  }
  return {
    sources: [...sources.values()].sort(
      (left, right) =>
        compareUtf8Binary(left.platform, right.platform) ||
        compareUtf8Binary(left.authorId, right.authorId),
    ),
    rssFeedUrls: [],
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
  const socialActivityBySourceKey: Record<
    string,
    LibraryFriendsGraphSocialActivity
  > = {};
  for (const activity of graph.social) {
    const key = socialActivitySummaryKey(activity.platform, activity.authorId);
    socialActivityBySourceKey[key] = activity;
  }
  return {
    socialActivityBySourceKey,
  };
}
