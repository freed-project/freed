import type {
  Account,
  ContactMatch,
  DeviceContact,
  FeedItem,
  FriendSource,
  GoogleContact,
} from "./types.js";

function accountKey(account: Pick<Account, "provider" | "externalId">): string {
  return `${account.provider}:${account.externalId}`;
}

export function createContactAccountFromGoogleContact(
  contact: GoogleContact,
  importedAt: number,
  personId?: string,
): Account {
  return {
    id: `contact:google:${contact.resourceName}`,
    personId,
    kind: "contact",
    provider: "google_contacts",
    externalId: contact.resourceName,
    displayName: contact.name.displayName ?? contact.name.givenName ?? "",
    avatarUrl: contact.photos[0]?.url,
    email: contact.emails[0]?.value,
    phone: contact.phones[0]?.value,
    importedAt,
    firstSeenAt: importedAt,
    lastSeenAt: importedAt,
    discoveredFrom: "contact_import",
    createdAt: importedAt,
    updatedAt: importedAt,
  };
}

export function buildSocialAccountsFromAuthorIds(
  items: FeedItem[],
  authorIds: string[],
  discoveredAt: number = Date.now(),
  personId?: string,
): Account[] {
  const seen = new Set<string>();
  const accounts: Account[] = [];

  for (const authorId of authorIds) {
    const item = items.find((entry) => entry.author.id === authorId);
    if (!item) continue;

    const account: Account = {
      id: `social:${item.platform}:${item.author.id}`,
      personId,
      kind: "social",
      provider: item.platform,
      externalId: item.author.id,
      handle: item.author.handle,
      displayName: item.author.displayName,
      avatarUrl: item.author.avatarUrl,
      firstSeenAt: item.publishedAt,
      lastSeenAt: item.publishedAt,
      discoveredFrom: item.contentType === "story" ? "story_author" : "captured_item",
      createdAt: discoveredAt,
      updatedAt: discoveredAt,
    };

    const key = accountKey(account);
    if (seen.has(key)) continue;
    seen.add(key);
    accounts.push(account);
  }

  return accounts;
}

export function mergeAccounts(
  existing: Account[],
  additions: Account[],
): Account[] {
  const merged = [...existing];
  const seen = new Set(existing.map(accountKey));

  for (const account of additions) {
    const key = accountKey(account);
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(account);
  }

  return merged;
}

/** @deprecated Use buildSocialAccountsFromAuthorIds. */
export function buildFriendSourcesFromAuthorIds(
  items: FeedItem[],
  authorIds: string[],
): FriendSource[] {
  return buildSocialAccountsFromAuthorIds(items, authorIds).map((account) => ({
    platform: account.provider as FriendSource["platform"],
    authorId: account.externalId,
    handle: account.handle,
    displayName: account.displayName,
    avatarUrl: account.avatarUrl,
    profileUrl: account.profileUrl,
  }));
}

/** @deprecated Use createContactAccountFromGoogleContact. */
export function createDeviceContactFromGoogleContact(
  contact: GoogleContact,
  importedAt: number,
): DeviceContact {
  return {
    importedFrom: "google",
    name: contact.name.displayName ?? contact.name.givenName ?? "",
    phone: contact.phones[0]?.value,
    email: contact.emails[0]?.value,
    address: undefined,
    nativeId: contact.resourceName,
    importedAt,
  };
}

/** @deprecated Use mergeAccounts. */
export function mergeFriendSources(
  existing: FriendSource[],
  additions: FriendSource[],
): FriendSource[] {
  const merged = [...existing];
  const seen = new Set(existing.map((source) => `${source.platform}:${source.authorId}`));

  for (const source of additions) {
    const key = `${source.platform}:${source.authorId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(source);
  }

  return merged;
}

/** @deprecated Automatic processing was removed, but legacy callers still use the confidence gate. */
export function shouldAutoProcessMatch(match: ContactMatch): boolean {
  return match.confidence === "high";
}
