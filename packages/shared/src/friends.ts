/**
 * @freed/shared - Person/account identity resolution and CRM utilities
 *
 * Pure functions only. No React, no side effects, no Automerge imports.
 * Safe to call in hot render paths.
 */

import type { Account, FeedItem, Friend, Person, Platform } from "./types.js";

const DEFAULT_INTERVALS: Record<1 | 2 | 3 | 4 | 5, number | null> = {
  5: 7,
  4: 14,
  3: 30,
  2: 90,
  1: null,
};

const SOCIAL_PLATFORMS = new Set<Platform>([
  "x",
  "facebook",
  "instagram",
  "linkedin",
]);

export function effectiveInterval(
  careLevel: 1 | 2 | 3 | 4 | 5,
  overrideDays?: number
): number | null {
  if (overrideDays !== undefined) return overrideDays;
  return DEFAULT_INTERVALS[careLevel];
}

export function accountsForPerson(
  accounts: Record<string, Account>,
  personId: string
): Account[] {
  return Object.values(accounts).filter((account) => account.personId === personId);
}

export function socialAccountsForPerson(
  accounts: Record<string, Account>,
  personId: string
): Account[] {
  return accountsForPerson(accounts, personId).filter((account) => account.kind === "social");
}

export function contactAccountsForPerson(
  accounts: Record<string, Account>,
  personId: string
): Account[] {
  return accountsForPerson(accounts, personId).filter((account) => account.kind === "contact");
}

export function primaryContactAccountForPerson(
  accounts: Record<string, Account>,
  personId: string
): Account | null {
  return contactAccountsForPerson(accounts, personId)[0] ?? null;
}

export function socialAccountForAuthor(
  accounts: Record<string, Account>,
  platform: Platform,
  authorId: string
): Account | null {
  for (const account of Object.values(accounts)) {
    if (
      account.kind === "social" &&
      account.provider === platform &&
      account.externalId === authorId
    ) {
      return account;
    }
  }
  return null;
}

export function buildDiscoveredAccountsFromItems(
  items: FeedItem[],
  existingAccounts: Record<string, Account>
): Account[] {
  const missing: Account[] = [];
  const seen = new Set(
    Object.values(existingAccounts)
      .filter((account) => account.kind === "social")
      .map((account) => `${account.provider}:${account.externalId}`)
  );

  for (const item of items) {
    if (!SOCIAL_PLATFORMS.has(item.platform)) continue;
    const key = `${item.platform}:${item.author.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    missing.push({
      id: `social:${item.platform}:${item.author.id}`,
      kind: "social",
      provider: item.platform,
      externalId: item.author.id,
      handle: item.author.handle,
      displayName: item.author.displayName,
      avatarUrl: item.author.avatarUrl,
      firstSeenAt: item.publishedAt,
      lastSeenAt: item.publishedAt,
      discoveredFrom: item.contentType === "story" ? "story_author" : "captured_item",
      createdAt: item.capturedAt,
      updatedAt: item.capturedAt,
    });
  }

  return missing;
}

export function personForAuthor(
  persons: Record<string, Person>,
  accounts: Record<string, Account>,
  platform: Platform,
  authorId: string
): Person | null {
  const account = socialAccountForAuthor(accounts, platform, authorId);
  if (!account?.personId) return null;
  return persons[account.personId] ?? null;
}

function legacySourceKeys(friend: Pick<Friend, "sources">): Set<string> {
  return new Set(friend.sources.map((source) => `${source.platform}:${source.authorId}`));
}

function asPerson(person: Person | Friend): Person {
  return "sources" in person ? personFromLegacyFriend(person) : person;
}

export function feedItemsForPerson(
  feedItems: Record<string, FeedItem>,
  accounts: Record<string, Account>,
  person: Person
): FeedItem[] {
  const socialKeys = new Set(
    socialAccountsForPerson(accounts, person.id).map(
      (account) => `${account.provider}:${account.externalId}`
    )
  );

  return Object.values(feedItems).filter((item) =>
    socialKeys.has(`${item.platform}:${item.author.id}`)
  );
}

export function feedItemsForFriend(
  feedItems: Record<string, FeedItem>,
  friend: Friend,
  accounts?: Record<string, Account>
): FeedItem[] {
  if (!accounts) {
    const sourceKeys = legacySourceKeys(friend);
    return Object.values(feedItems).filter((item) =>
      sourceKeys.has(`${item.platform}:${item.author.id}`)
    );
  }
  return feedItemsForPerson(feedItems, accounts, asPerson(friend));
}

export function lastPostAt(
  feedItems: Record<string, FeedItem>,
  accounts: Record<string, Account> | Person | Friend,
  person?: Person | Friend
): number | null {
  const items = person
    ? feedItemsForPerson(feedItems, accounts as Record<string, Account>, asPerson(person))
    : feedItemsForFriend(feedItems, accounts as Friend);
  if (items.length === 0) return null;
  return Math.max(...items.map((item) => item.publishedAt));
}

export function recentPostCount(
  feedItems: Record<string, FeedItem>,
  accounts: Record<string, Account> | Person | Friend,
  person?: Person | Friend,
  windowMs: number = 7 * 24 * 60 * 60 * 1000
): number {
  const cutoff = Date.now() - windowMs;
  const items = person
    ? feedItemsForPerson(feedItems, accounts as Record<string, Account>, asPerson(person))
    : feedItemsForFriend(feedItems, accounts as Friend);
  return items.filter(
    (item) => item.publishedAt >= cutoff
  ).length;
}

export function lastReachOutAt(person: Person): number | null {
  if (!person.reachOutLog || person.reachOutLog.length === 0) return null;
  return person.reachOutLog[0].loggedAt;
}

export function isDue(person: Person, now: number = Date.now()): boolean {
  if (person.relationshipStatus !== "friend") return false;

  const interval = effectiveInterval(person.careLevel, person.reachOutIntervalDays);
  if (interval === null) return false;

  const lastContact = lastReachOutAt(person);
  if (lastContact === null) {
    const daysSinceAdded = (now - person.createdAt) / (1000 * 60 * 60 * 24);
    return daysSinceAdded > interval;
  }

  const daysSince = (now - lastContact) / (1000 * 60 * 60 * 24);
  return daysSince > interval;
}

export function isInReconnectZone(person: Person, now: number = Date.now()): boolean {
  return person.relationshipStatus === "friend" && person.careLevel >= 4 && isDue(person, now);
}

export function nodeRadius(
  person: Person | Friend,
  feedItems: Record<string, FeedItem>,
  accounts?: Record<string, Account>
): number {
  const BASE: Record<1 | 2 | 3 | 4 | 5, number> = {
    1: 16,
    2: 20,
    3: 24,
    4: 28,
    5: 32,
  };
  const base = BASE[person.careLevel];
  const activity = accounts
    ? recentPostCount(feedItems, accounts, person)
    : recentPostCount(feedItems, person as Friend);
  const scaled = base * Math.log2(activity + 2);
  return Math.min(scaled, 48);
}

export function nodeOpacity(
  person: Person | Friend,
  feedItems: Record<string, FeedItem>,
  accounts?: Record<string, Account>,
  now: number = Date.now()
): number {
  const last = accounts
    ? lastPostAt(feedItems, accounts, person)
    : lastPostAt(feedItems, person as Friend);
  if (last === null) return 0.5;

  const hours = (now - last) / (1000 * 60 * 60);
  if (hours < 24) return 1.0;
  if (hours < 24 * 7) return 0.85;
  if (hours < 24 * 30) return 0.7;
  return 0.5;
}

export function friendForAuthor(
  friends: Record<string, Friend>,
  platform: Platform,
  authorId: string
): Friend | null {
  for (const friend of Object.values(friends)) {
    for (const source of friend.sources) {
      if (source.platform === platform && source.authorId === authorId) {
        return friend;
      }
    }
  }
  return null;
}

/** @deprecated Use feedItemsForPerson. */
export const personFromLegacyFriend = (friend: Friend): Person => ({
  id: friend.id,
  name: friend.name,
  avatarUrl: friend.avatarUrl,
  bio: friend.bio,
  relationshipStatus: friend.relationshipStatus ?? "friend",
  careLevel: friend.careLevel,
  reachOutIntervalDays: friend.reachOutIntervalDays,
  reachOutLog: friend.reachOutLog,
  tags: friend.tags,
  notes: friend.notes,
  createdAt: friend.createdAt,
  updatedAt: friend.updatedAt,
});

export function accountsFromLegacyFriend(friend: Friend): Account[] {
  const socialAccounts: Account[] = friend.sources.map((source) => ({
    id: `social:${source.platform}:${source.authorId}`,
    personId: friend.id,
    kind: "social",
    provider: source.platform,
    externalId: source.authorId,
    handle: source.handle,
    displayName: source.displayName,
    avatarUrl: source.avatarUrl,
    profileUrl: source.profileUrl,
    firstSeenAt: friend.createdAt,
    lastSeenAt: friend.updatedAt,
    discoveredFrom: "captured_item",
    createdAt: friend.createdAt,
    updatedAt: friend.updatedAt,
  }));

  if (!friend.contact) return socialAccounts;

  const contactProvider: Account["provider"] =
    friend.contact.importedFrom === "google"
      ? "google_contacts"
      : friend.contact.importedFrom === "macos"
        ? "macos_contacts"
        : friend.contact.importedFrom === "ios"
          ? "ios_contacts"
          : friend.contact.importedFrom === "android"
            ? "android_contacts"
            : "web_contact";

  return socialAccounts.concat({
    id: `contact:${contactProvider}:${friend.contact.nativeId ?? friend.id}`,
    personId: friend.id,
    kind: "contact",
    provider: contactProvider,
    externalId: friend.contact.nativeId ?? friend.contact.name,
    displayName: friend.contact.name,
    email: friend.contact.email,
    phone: friend.contact.phone,
    address: friend.contact.address,
    importedAt: friend.contact.importedAt,
    firstSeenAt: friend.contact.importedAt,
    lastSeenAt: friend.updatedAt,
    discoveredFrom: "contact_import",
    createdAt: friend.createdAt,
    updatedAt: friend.updatedAt,
  });
}
