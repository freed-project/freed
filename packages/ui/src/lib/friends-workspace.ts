import {
  extractLocationFromItem,
  feedItemsForFriend,
  isDue,
  lastPostAt,
  lastReachOutAt,
  type FeedItem,
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
  items: FeedItem[];
  lastPostAt: number | null;
  lastContactAt: number | null;
  needsOutreach: boolean;
  hasLocation: boolean;
  isRecentlyActive: boolean;
}

const RECENT_ACTIVITY_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

function matchesQuery(friend: Friend, query: string): boolean {
  if (!query) return true;
  const normalized = query.trim().toLowerCase();
  if (!normalized) return true;

  if (friend.name.toLowerCase().includes(normalized)) return true;
  if (friend.bio?.toLowerCase().includes(normalized)) return true;
  return friend.sources.some((source) =>
    source.handle?.toLowerCase().includes(normalized)
    || source.displayName?.toLowerCase().includes(normalized)
    || source.authorId.toLowerCase().includes(normalized)
  );
}

function matchesFilters(entry: FriendOverviewEntry, filters: Set<FriendOverviewFilter>): boolean {
  if (filters.size === 0) return true;
  for (const filter of filters) {
    switch (filter) {
      case "need_outreach":
        if (!entry.needsOutreach) return false;
        break;
      case "no_contact":
        if (entry.lastContactAt !== null) return false;
        break;
      case "close_friends":
        if (entry.friend.careLevel < 4) return false;
        break;
      case "recently_active":
        if (!entry.isRecentlyActive) return false;
        break;
      case "has_location":
        if (!entry.hasLocation) return false;
        break;
    }
  }
  return true;
}

function compareNullableDesc(a: number | null, b: number | null): number {
  if (a === b) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return b - a;
}

function sortEntries(entries: FriendOverviewEntry[], sort: FriendOverviewSort): FriendOverviewEntry[] {
  const next = [...entries];
  next.sort((a, b) => {
    switch (sort) {
      case "care_level":
        return b.friend.careLevel - a.friend.careLevel
          || compareNullableDesc(a.lastPostAt, b.lastPostAt)
          || a.friend.name.localeCompare(b.friend.name);
      case "last_contact":
        return compareNullableDesc(a.lastContactAt, b.lastContactAt)
          || compareNullableDesc(a.lastPostAt, b.lastPostAt)
          || a.friend.name.localeCompare(b.friend.name);
      case "name":
        return a.friend.name.localeCompare(b.friend.name);
      case "recent_activity":
      default:
        return compareNullableDesc(a.lastPostAt, b.lastPostAt)
          || b.friend.careLevel - a.friend.careLevel
          || a.friend.name.localeCompare(b.friend.name);
    }
  });
  return next;
}

export function buildFriendOverviewEntries(
  friends: Record<string, Friend>,
  feedItems: Record<string, FeedItem>,
  now: number = Date.now()
): FriendOverviewEntry[] {
  return Object.values(friends).map((friend) => {
    const items = feedItemsForFriend(feedItems, friend).sort((a, b) => b.publishedAt - a.publishedAt);
    const latestPost = lastPostAt(feedItems, friend);
    const latestContact = lastReachOutAt(friend);
    const hasLocation = items.some((item) => extractLocationFromItem(item));
    const isRecentlyActive = latestPost !== null && now - latestPost <= RECENT_ACTIVITY_WINDOW_MS;

    return {
      friend,
      items,
      lastPostAt: latestPost,
      lastContactAt: latestContact,
      needsOutreach: isDue(friend, now),
      hasLocation,
      isRecentlyActive,
    };
  });
}

export function filterAndSortFriendOverview(
  entries: FriendOverviewEntry[],
  query: string,
  filters: Set<FriendOverviewFilter>,
  sort: FriendOverviewSort
): FriendOverviewEntry[] {
  const filtered = entries.filter((entry) =>
    matchesQuery(entry.friend, query) && matchesFilters(entry, filters)
  );
  return sortEntries(filtered, sort);
}
