/**
 * @freed/shared - Person/account identity resolution and CRM utilities
 *
 * Pure functions only. No React, storage access, or side effects.
 * Safe to call in hot render paths.
 */

import type { Account, FeedItem, Person, Platform } from "./types.js";
import { isValidDiscoveredSocialFeedAuthor } from "./social-account-validity.js";

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
  "substack",
  "medium",
]);

function profileUrlFromAuthorId(item: FeedItem): string | undefined {
  try {
    const url = new URL(item.author.id);
    const hostname = url.hostname.toLowerCase();
    const parts = url.pathname.split("/").filter(Boolean);
    if (item.platform === "substack") {
      if (hostname.endsWith(".substack.com") && parts.length === 0) {
        return `${url.origin}/`;
      }
      if (hostname === "substack.com" || hostname === "www.substack.com") {
        const handle = parts.find((part) => part.startsWith("@"));
        return handle ? `https://substack.com/${handle.toLowerCase()}` : undefined;
      }
    }
    if (
      item.platform === "medium" &&
      (hostname === "medium.com" || hostname.endsWith(".medium.com"))
    ) {
      const handle = parts.find((part) => part.startsWith("@"));
      return handle ? `https://medium.com/${handle.toLowerCase()}` : undefined;
    }
  } catch {
    return undefined;
  }
  return undefined;
}

function inferredSocialProfileUrl(item: FeedItem): string | undefined {
  const authorProfileUrl = profileUrlFromAuthorId(item);
  if (authorProfileUrl) return authorProfileUrl;
  const handle = item.author.handle?.replace(/^@/, "").trim();
  if (!handle || handle === "unknown") return undefined;

  if (item.platform === "instagram") {
    return `https://www.instagram.com/${handle}/`;
  }

  if (item.platform === "facebook") {
    const facebookHandle = handle.replace(/^fb:/, "");
    return facebookHandle && facebookHandle !== "unknown"
      ? `https://www.facebook.com/${facebookHandle}`
      : undefined;
  }

  if (item.platform === "substack") {
    return `https://substack.com/@${handle}`;
  }

  if (item.platform === "medium") {
    return `https://medium.com/@${handle}`;
  }

  return undefined;
}

function effectiveInterval(
  careLevel: 1 | 2 | 3 | 4 | 5,
  overrideDays?: number
): number | null {
  if (overrideDays !== undefined) return overrideDays;
  return DEFAULT_INTERVALS[careLevel];
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
    const account = discoveredSocialAccountFromItem(item);
    if (!account) continue;
    const key = `${item.platform}:${item.author.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    missing.push(account);
  }

  return missing;
}

export function discoveredSocialAccountFromItem(item: FeedItem): Account | null {
  if (!SOCIAL_PLATFORMS.has(item.platform)) return null;
  if (!isValidDiscoveredSocialFeedAuthor(item)) return null;
  const profileUrl = inferredSocialProfileUrl(item);
  return {
    id: `social:${item.platform}:${item.author.id}`,
    kind: "social",
    provider: item.platform,
    externalId: item.author.id,
    handle: item.author.handle,
    displayName: item.author.displayName,
    avatarUrl: item.author.avatarUrl,
    ...(profileUrl ? { profileUrl } : {}),
    firstSeenAt: item.publishedAt,
    lastSeenAt: item.publishedAt,
    discoveredFrom: item.contentType === "story" ? "story_author" : "captured_item",
    createdAt: item.capturedAt,
    updatedAt: item.capturedAt,
  };
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
