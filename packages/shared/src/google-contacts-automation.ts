import type { ContactMatch, DeviceContact, FeedItem, FriendSource, GoogleContact } from "./types.js";

function sourceKey(source: FriendSource): string {
  return `${source.platform}:${source.authorId}`;
}

export function createDeviceContactFromGoogleContact(
  contact: GoogleContact,
  importedAt: number,
): DeviceContact {
  const deviceContact: DeviceContact = {
    importedFrom: "google",
    name: contact.name.displayName ?? contact.name.givenName ?? "",
    nativeId: contact.resourceName,
    importedAt,
  };
  const phone = contact.phones[0]?.value;
  const email = contact.emails[0]?.value;
  if (phone) deviceContact.phone = phone;
  if (email) deviceContact.email = email;
  return deviceContact;
}

export function buildFriendSourcesFromAuthorIds(
  items: FeedItem[],
  authorIds: string[],
): FriendSource[] {
  const seen = new Set<string>();
  const sources: FriendSource[] = [];

  for (const authorId of authorIds) {
    const item = items.find((entry) => entry.author.id === authorId);
    if (!item) continue;

    const source: FriendSource = {
      platform: item.platform,
      authorId: item.author.id,
    };
    if (item.author.handle) source.handle = item.author.handle;
    if (item.author.displayName) source.displayName = item.author.displayName;
    if (item.author.avatarUrl) source.avatarUrl = item.author.avatarUrl;
    const key = sourceKey(source);
    if (seen.has(key)) continue;
    seen.add(key);
    sources.push(source);
  }

  return sources;
}

export function mergeFriendSources(
  existing: FriendSource[],
  additions: FriendSource[],
): FriendSource[] {
  const merged = [...existing];
  const seen = new Set(existing.map(sourceKey));

  for (const source of additions) {
    const key = sourceKey(source);
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(source);
  }

  return merged;
}

export function shouldAutoProcessMatch(match: ContactMatch): boolean {
  return match.confidence === "high" && (Boolean(match.friend) || match.authorIds.length > 0);
}
