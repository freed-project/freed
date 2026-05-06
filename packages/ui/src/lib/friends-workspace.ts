import {
  extractLocationFromItem,
  isDue,
  lastReachOutAt,
  type Account,
  type FeedItem,
  type Friend,
  type Person,
  type Platform,
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

export interface FriendsWorkspaceIndexes {
  socialAccountsByPerson: Map<string, Account[]>;
  primaryContactByPerson: Map<string, Account>;
  feedItemsBySourceKey: Map<string, FeedItem[]>;
}

export interface FriendOverviewBuildOptions {
  now?: number;
  indexes?: FriendsWorkspaceIndexes;
}

function sourceKey(platform: string, authorId: string): string {
  return `${platform}:${authorId}`;
}

export function buildFriendsWorkspaceIndexes(
  accounts: Record<string, Account>,
  feedItems: Record<string, FeedItem>,
): FriendsWorkspaceIndexes {
  const socialAccountsByPerson = new Map<string, Account[]>();
  const primaryContactByPerson = new Map<string, Account>();
  const feedItemsBySourceKey = new Map<string, FeedItem[]>();

  for (const account of Object.values(accounts)) {
    if (!account.personId) continue;
    if (account.kind === "social") {
      const bucket = socialAccountsByPerson.get(account.personId);
      if (bucket) {
        bucket.push(account);
      } else {
        socialAccountsByPerson.set(account.personId, [account]);
      }
      continue;
    }
    if (account.kind === "contact" && !primaryContactByPerson.has(account.personId)) {
      primaryContactByPerson.set(account.personId, account);
    }
  }

  for (const item of Object.values(feedItems)) {
    const key = sourceKey(item.platform, item.author.id);
    const bucket = feedItemsBySourceKey.get(key);
    if (bucket) {
      bucket.push(item);
    } else {
      feedItemsBySourceKey.set(key, [item]);
    }
  }

  for (const bucket of feedItemsBySourceKey.values()) {
    bucket.sort((left, right) => right.publishedAt - left.publishedAt);
  }

  return {
    socialAccountsByPerson,
    primaryContactByPerson,
    feedItemsBySourceKey,
  };
}

export function friendFromPersonWithIndexes(
  person: Person,
  indexes: Pick<FriendsWorkspaceIndexes, "socialAccountsByPerson" | "primaryContactByPerson">,
): Friend {
  const socialSources = (indexes.socialAccountsByPerson.get(person.id) ?? []).map((account) => ({
    platform: account.provider as Platform,
    authorId: account.externalId,
    handle: account.handle,
    displayName: account.displayName,
    avatarUrl: account.avatarUrl,
    profileUrl: account.profileUrl,
  }));

  const primaryContact = indexes.primaryContactByPerson.get(person.id);
  const contact: Friend["contact"] = primaryContact
    ? {
        importedFrom:
          primaryContact.provider === "google_contacts"
            ? "google"
            : primaryContact.provider === "macos_contacts"
              ? "macos"
              : primaryContact.provider === "ios_contacts"
                ? "ios"
                : primaryContact.provider === "android_contacts"
                  ? "android"
                  : "web",
        name: primaryContact.displayName ?? person.name,
        phone: primaryContact.phone,
        email: primaryContact.email,
        address: primaryContact.address,
        nativeId: primaryContact.externalId,
        importedAt: primaryContact.importedAt ?? primaryContact.createdAt,
      }
    : undefined;

  return {
    ...person,
    sources: socialSources,
    ...(contact ? { contact } : {}),
  };
}

export function buildFriendsById(
  persons: Person[],
  indexes: Pick<FriendsWorkspaceIndexes, "socialAccountsByPerson" | "primaryContactByPerson">,
): Record<string, Friend> {
  return Object.fromEntries(
    persons.map((person) => [person.id, friendFromPersonWithIndexes(person, indexes)]),
  );
}

function feedItemsForFriendFromIndexes(
  friend: Friend,
  indexes: Pick<FriendsWorkspaceIndexes, "feedItemsBySourceKey">,
): FeedItem[] {
  const items: FeedItem[] = [];
  for (const source of friend.sources) {
    const bucket = indexes.feedItemsBySourceKey.get(sourceKey(source.platform, source.authorId));
    if (bucket) items.push(...bucket);
  }
  if (items.length <= 1) return items;
  return items.sort((left, right) => right.publishedAt - left.publishedAt);
}

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
        if (entry.friend.careLevel < 5) return false;
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
  optionsOrNow: FriendOverviewBuildOptions | number = Date.now()
): FriendOverviewEntry[] {
  const options = typeof optionsOrNow === "number" ? { now: optionsOrNow } : optionsOrNow;
  const now = options.now ?? Date.now();
  const indexes = options.indexes ?? buildFriendsWorkspaceIndexes({}, feedItems);

  return Object.values(friends).map((friend) => {
    const items = feedItemsForFriendFromIndexes(friend, indexes);
    const latestPost = items[0]?.publishedAt ?? null;
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
