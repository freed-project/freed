import type { GoogleContact, ContactMatch, Friend, FeedItem } from "./types.js";

function normalize(s: string | undefined): string {
  return (s ?? "").toLowerCase().trim().replace(/\s+/g, " ");
}

function splitHandle(handle: string): string[] {
  // Split on . _ - and return title-cased parts
  return handle
    .split(/[._\-]/)
    .filter(Boolean)
    .map(p => p.charAt(0).toUpperCase() + p.slice(1).toLowerCase());
}

function getContactNames(c: GoogleContact): Set<string> {
  const names = new Set<string>();
  if (c.name.displayName) names.add(normalize(c.name.displayName));
  if (c.name.givenName && c.name.familyName) {
    names.add(normalize(`${c.name.givenName} ${c.name.familyName}`));
    names.add(normalize(`${c.name.familyName} ${c.name.givenName}`));
  }
  if (c.name.givenName) names.add(normalize(c.name.givenName));
  return names;
}

export function matchContacts(
  contacts: GoogleContact[],
  friends: Record<string, Friend>,
  feedItems: FeedItem[]
): ContactMatch[] {
  const friendList = Object.values(friends);

  // Build author map: authorId -> { displayName, handle }
  const authorMap = new Map<string, { displayName: string; handle?: string }>();
  for (const item of feedItems) {
    if (item.author?.id && item.author?.displayName && !authorMap.has(item.author.id)) {
      authorMap.set(item.author.id, {
        displayName: item.author.displayName,
        handle: item.author.handle,
      });
    }
  }

  const results: ContactMatch[] = [];

  for (const contact of contacts) {
    const contactNames = getContactNames(contact);
    const contactEmails = new Set(contact.emails.map(e => e.value.toLowerCase()));

    let matchedFriend: Friend | null = null;
    let confidence: "high" | "medium" = "medium";
    const matchedAuthorIds: string[] = [];

    // Match against existing friends
    for (const friend of friendList) {
      const friendName = normalize(friend.name);

      // Email match (high confidence)
      if (friend.contact?.email && contactEmails.has(friend.contact.email.toLowerCase())) {
        matchedFriend = friend;
        confidence = "high";
        break;
      }

      // Exact name match (high confidence)
      if (contactNames.has(friendName)) {
        matchedFriend = friend;
        confidence = "high";
        break;
      }

      // Handle-to-name match (medium confidence)
      for (const source of friend.sources ?? []) {
        if (source.handle) {
          const parts = splitHandle(source.handle);
          const reconstructed = normalize(parts.join(" "));
          if (contactNames.has(reconstructed)) {
            matchedFriend = friend;
            confidence = "medium";
          }
        }
      }
    }

    // Match against unlinked feed authors
    for (const [authorId, author] of authorMap) {
      // Skip if already linked to a friend
      const alreadyLinked = friendList.some(f =>
        f.sources?.some(s => s.authorId === authorId)
      );
      if (alreadyLinked) continue;

      const authorName = normalize(author.displayName);
      if (contactNames.has(authorName)) {
        matchedAuthorIds.push(authorId);
        if (confidence !== "high") confidence = "high";
      } else if (author.handle) {
        const parts = splitHandle(author.handle);
        if (contactNames.has(normalize(parts.join(" ")))) {
          matchedAuthorIds.push(authorId);
          if (confidence !== "high") confidence = "medium";
        }
      }
    }

    results.push({
      contact,
      friend: matchedFriend,
      authorIds: matchedAuthorIds,
      confidence,
    });
  }

  // Sort: high confidence first, then alphabetically by contact display name
  return results.sort((a, b) => {
    if (a.confidence !== b.confidence) {
      return a.confidence === "high" ? -1 : 1;
    }
    const nameA = a.contact.name.displayName ?? "";
    const nameB = b.contact.name.displayName ?? "";
    return nameA.localeCompare(nameB);
  });
}
