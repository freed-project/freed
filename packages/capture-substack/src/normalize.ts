import type { Account, Author, Content, FeedItem } from "@freed/shared";
import type { RawSubstackEntry, RawSubstackProfile } from "./types.js";

function clean(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function stableExternalId(profile: RawSubstackProfile): string | null {
  return clean(profile.id) ?? clean(profile.handle)?.replace(/^@/, "") ?? clean(profile.profileUrl) ?? null;
}

function stableEntryId(entry: RawSubstackEntry): string | null {
  return clean(entry.id) ?? clean(entry.url) ?? null;
}

function parseTimestamp(value: string | number | undefined, fallback: number): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
}

function profileHandle(profile: RawSubstackProfile | undefined): string {
  const handle = clean(profile?.handle)?.replace(/^@/, "");
  if (handle) return handle;
  const url = clean(profile?.profileUrl);
  if (url) {
    try {
      const parsed = new URL(url);
      const pathHandle = parsed.pathname.split("/").filter(Boolean)[0];
      if (pathHandle) return pathHandle;
      return parsed.hostname.replace(/\.substack\.com$/, "");
    } catch {
      return url;
    }
  }
  return "unknown";
}

function buildAuthor(entry: RawSubstackEntry): Author {
  const profile = entry.author;
  const handle = profileHandle(profile);
  return {
    id: `substack:${stableExternalId(profile ?? { handle }) ?? handle}`,
    handle,
    displayName: clean(profile?.displayName) ?? clean(entry.publicationTitle) ?? handle,
    ...(clean(profile?.avatarUrl) ? { avatarUrl: clean(profile?.avatarUrl) } : {}),
  };
}

function buildContent(entry: RawSubstackEntry): Content {
  const mediaUrls = entry.mediaUrls?.filter(Boolean) ?? [];
  const text = [entry.title, entry.text].map(clean).filter(Boolean).join("\n\n");
  const linkUrl = clean(entry.url) ?? clean(entry.publicationUrl);
  return {
    ...(text ? { text } : {}),
    mediaUrls,
    mediaTypes: mediaUrls.map(() => "image"),
    ...(linkUrl
      ? {
          linkPreview: {
            url: linkUrl,
            ...(clean(entry.title) ? { title: clean(entry.title) } : {}),
          },
        }
      : {}),
  };
}

export function substackEntryToFeedItem(entry: RawSubstackEntry): FeedItem | null {
  if (entry.kind === "follower" || entry.kind === "following" || entry.kind === "subscription") return null;
  const id = stableEntryId(entry);
  if (!id) return null;
  const capturedAt = entry.capturedAt ?? Date.now();
  const publishedAt = parseTimestamp(entry.publishedAt, capturedAt);
  const content = buildContent(entry);
  if (!content.text && !content.linkPreview && content.mediaUrls.length === 0) return null;

  return {
    globalId: `substack:${entry.kind}:${encodeURIComponent(id)}`,
    platform: "substack",
    contentType: entry.kind === "essay" ? "article" : "post",
    capturedAt,
    publishedAt,
    author: buildAuthor(entry),
    content,
    ...(entry.likeCount != null || entry.commentCount != null || entry.restackCount != null
      ? {
          engagement: {
            ...(entry.likeCount != null ? { likes: entry.likeCount } : {}),
            ...(entry.commentCount != null ? { comments: entry.commentCount } : {}),
            ...(entry.restackCount != null ? { reposts: entry.restackCount } : {}),
          },
        }
      : {}),
    sourceUrl: clean(entry.url),
    topics: entry.kind === "essay" ? ["essay"] : ["discussion"],
    userState: {
      hidden: false,
      saved: false,
      archived: false,
      tags: [],
    },
  };
}

export function substackEntriesToFeedItems(entries: RawSubstackEntry[]): FeedItem[] {
  return entries
    .map(substackEntryToFeedItem)
    .filter((item): item is FeedItem => item !== null);
}

export function substackProfilesToAccounts(profiles: RawSubstackProfile[]): Account[] {
  const now = Date.now();
  return profiles
    .filter((profile) => {
      const role = (profile as { role?: string }).role;
      return role !== "author" && role !== "subscriber";
    })
    .map((profile): Account | null => {
      const externalId = stableExternalId(profile);
      if (!externalId) return null;
      const handle = clean(profile.handle)?.replace(/^@/, "");
      return {
        id: `social:substack:${encodeURIComponent(externalId)}`,
        kind: "social",
        provider: "substack",
        externalId,
        ...(handle ? { handle } : {}),
        ...(clean(profile.displayName) ? { displayName: clean(profile.displayName) } : {}),
        ...(clean(profile.avatarUrl) ? { avatarUrl: clean(profile.avatarUrl) } : {}),
        ...(clean(profile.profileUrl) ? { profileUrl: clean(profile.profileUrl) } : {}),
        firstSeenAt: profile.firstSeenAt ?? now,
        lastSeenAt: profile.lastSeenAt ?? now,
        discoveredFrom: "follow_roster",
        createdAt: now,
        updatedAt: now,
      };
    })
    .filter((account): account is Account => account !== null);
}

export function deduplicateFeedItems(items: FeedItem[]): FeedItem[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    if (seen.has(item.globalId)) return false;
    seen.add(item.globalId);
    return true;
  });
}

export function deduplicateAccounts(accounts: Account[]): Account[] {
  const seen = new Set<string>();
  return accounts.filter((account) => {
    const key = `${account.provider}:${account.externalId}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
