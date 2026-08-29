import {
  compareUtf8Binary,
  friendCandidateActivitySourceKey,
  isDue,
  lastReachOutAt,
  type Friend,
} from "@freed/shared";

export type FriendOverviewFilter =
  | "need_outreach"
  | "no_contact"
  | "close_friends"
  | "recently_active"
  | "has_location";

export type FriendOverviewSort =
  | "recent_activity"
  | "care_level"
  | "last_contact"
  | "name";

export interface FriendOverviewEntry {
  friend: Friend;
  avatarUrlCandidates: string[];
  lastPostAt: number | null;
  lastContactAt: number | null;
  needsOutreach: boolean;
  hasLocation: boolean;
  isRecentlyActive: boolean;
}

export interface FriendSourceActivitySummary {
  avatarUrl: string | null;
  avatarPublishedAt: number | null;
  avatarGlobalId: string | null;
  hasLocation: boolean;
  latestActivityAt: number;
}

const RECENT_ACTIVITY_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

export function friendActivitySourceKey(
  platform: string,
  authorId: string,
): string {
  return friendCandidateActivitySourceKey(platform, authorId);
}

/** Build the exact Friends overview from compact SQLite activity aggregates. */
export function buildFriendOverviewEntriesFromActivity(
  friends: Record<string, Friend>,
  activityBySourceKey: Readonly<Record<string, FriendSourceActivitySummary>>,
  now = Date.now(),
): FriendOverviewEntry[] {
  return Object.values(friends).map((friend) => {
    let latestPost: number | null = null;
    let hasLocation = false;
    const avatarCandidates: Array<{
      globalId: string;
      publishedAt: number;
      url: string;
    }> = [];
    for (const source of friend.sources) {
      const activity = activityBySourceKey[
        friendActivitySourceKey(source.platform, source.authorId)
      ];
      if (!activity) continue;
      if (activity.latestActivityAt > (latestPost ?? 0)) {
        latestPost = activity.latestActivityAt;
      }
      if (activity.hasLocation) hasLocation = true;
      if (
        activity.avatarUrl !== null &&
        activity.avatarPublishedAt !== null &&
        activity.avatarGlobalId !== null
      ) {
        avatarCandidates.push({
          globalId: activity.avatarGlobalId,
          publishedAt: activity.avatarPublishedAt,
          url: activity.avatarUrl,
        });
      }
    }
    avatarCandidates.sort(
      (left, right) =>
        right.publishedAt - left.publishedAt ||
        compareUtf8Binary(left.globalId, right.globalId),
    );
    const latestContact = lastReachOutAt(friend);
    return {
      friend,
      avatarUrlCandidates: avatarCandidates.map((candidate) => candidate.url),
      lastPostAt: latestPost,
      lastContactAt: latestContact,
      needsOutreach: isDue(friend, now),
      hasLocation,
      isRecentlyActive:
        latestPost !== null && now - latestPost <= RECENT_ACTIVITY_WINDOW_MS,
    };
  });
}
