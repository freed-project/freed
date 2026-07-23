import {
  canonicalEssayProviderProfileUrl,
  canonicalEssayProviderUrl,
  essayActivityGlobalId,
  essayProviderGlobalId,
  type Account,
  type Author,
  type Content,
  type FeedItem,
  type FollowRosterRole,
} from "@freed/shared";
import type { RawSubstackEntry, RawSubstackProfile } from "./types.js";

const MAX_TEXT_CHARS = 40_000;
const MAX_MEDIA_URLS = 12;

function clean(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function bounded(value: string | undefined, maxChars = MAX_TEXT_CHARS): string | undefined {
  const normalized = clean(value);
  return normalized ? normalized.slice(0, maxChars) : undefined;
}

const canonicalUrl = canonicalEssayProviderUrl;

function normalizeHandle(value: string | undefined): string | undefined {
  return clean(value)?.replace(/^@/, "").toLowerCase();
}

function stableExternalId(profile: RawSubstackProfile): string | null {
  const explicitId = clean(profile.id);
  if (explicitId) {
    return canonicalEssayProviderProfileUrl("substack", explicitId) ?? explicitId;
  }
  return canonicalEssayProviderProfileUrl("substack", profile.profileUrl) ??
    normalizeHandle(profile.handle) ??
    null;
}

function parseTimestamp(value: string | number | undefined, fallback: number): number {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    return value < 1_000_000_000_000 ? Math.round(value * 1_000) : Math.round(value);
  }
  if (typeof value === "string") {
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
}

function normalizeCount(value: number | undefined): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? Math.floor(value)
    : undefined;
}

function profileHandle(profile: RawSubstackProfile | undefined): string {
  const handle = normalizeHandle(profile?.handle);
  if (handle) return handle;
  const url = clean(profile?.profileUrl);
  if (url) {
    try {
      const parsed = new URL(url);
      const pathHandle = parsed.pathname.split("/").filter(Boolean)[0];
      if (pathHandle) return pathHandle.replace(/^@/, "").toLowerCase();
      return parsed.hostname.replace(/\.substack\.com$/, "").toLowerCase();
    } catch {
      return url;
    }
  }
  return "unknown";
}

function inferredEssayAuthor(entry: RawSubstackEntry): RawSubstackProfile | undefined {
  if (entry.author || entry.kind !== "essay") return entry.author;
  const value = canonicalUrl(entry.url);
  if (!value) return undefined;
  try {
    const url = new URL(value);
    const hostname = url.hostname.toLowerCase();
    if (hostname === "substack.com" || hostname === "www.substack.com") {
      const handle = url.pathname
        .split("/")
        .filter(Boolean)
        .find((part) => part.startsWith("@"))
        ?.replace(/^@/, "")
        .toLowerCase();
      return handle
        ? { id: `https://substack.com/@${handle}`, handle, profileUrl: `https://substack.com/@${handle}` }
        : undefined;
    }
    if (!hostname.endsWith(".substack.com")) return undefined;
    const handle = hostname.slice(0, -".substack.com".length).split(".").pop();
    if (!handle || ["api", "cdn", "images", "on", "support", "www"].includes(handle)) {
      return undefined;
    }
    return { id: `${url.origin}/`, handle, profileUrl: `${url.origin}/` };
  } catch {
    return undefined;
  }
}

function buildAuthor(entry: RawSubstackEntry): Author {
  const profile = inferredEssayAuthor(entry);
  const handle = profileHandle(profile);
  const externalId = stableExternalId(profile ?? { handle }) ?? handle;
  const avatarUrl = canonicalUrl(profile?.avatarUrl);
  return {
    id: externalId,
    handle,
    displayName: clean(profile?.displayName) ?? clean(entry.publicationTitle) ?? handle,
    ...(avatarUrl ? { avatarUrl } : {}),
  };
}

function activityText(entry: RawSubstackEntry): string | undefined {
  if (entry.kind === "restack" || entry.kind === "like") {
    return bounded(entry.activityLabel, 4_000) ??
      (entry.kind === "restack" ? "Restacked an essay" : "Liked an essay");
  }
  return bounded(entry.text);
}

function entryGlobalId(entry: RawSubstackEntry): string | null {
  const explicitId = clean(entry.id);
  const explicitUrl = canonicalUrl(explicitId);
  const targetUrl = canonicalUrl(entry.url) ?? explicitUrl;
  if (entry.kind === "essay") {
    return essayProviderGlobalId("substack", targetUrl) ??
      (explicitId ? `substack:essay:${encodeURIComponent(explicitId)}` : null);
  }
  if (entry.kind === "note") {
    const noteId = explicitUrl ?? explicitId ?? targetUrl;
    return noteId ? `substack:note:${encodeURIComponent(noteId)}` : null;
  }
  if (explicitId && !explicitUrl) {
    return `substack:${entry.kind}:${encodeURIComponent(explicitId)}`;
  }
  const author = entry.author;
  const identityText = activityText(entry);
  return essayActivityGlobalId("substack", entry.kind, {
    ...(targetUrl ? { targetUrl } : {}),
    ...(author ? { authorId: stableExternalId(author) ?? undefined } : {}),
    ...(entry.publishedAt !== undefined ? { publishedAt: entry.publishedAt } : {}),
    ...(identityText ? { text: identityText } : {}),
  }) ?? null;
}

function buildContent(entry: RawSubstackEntry): Content {
  const mediaUrls = Array.from(new Set((entry.mediaUrls ?? []).map(canonicalUrl).filter((url): url is string => !!url))).slice(0, MAX_MEDIA_URLS);
  const title = bounded(entry.title, 500);
  const body = entry.kind === "essay" ? undefined : activityText(entry);
  const text = entry.kind === "essay"
    ? ""
    : [title, body && body !== title ? body : undefined].filter(Boolean).join("\n\n");
  const linkUrl = canonicalUrl(entry.url) ?? canonicalUrl(entry.publicationUrl);
  return {
    ...(text ? { text } : {}),
    mediaUrls,
    mediaTypes: mediaUrls.map(() => "image"),
    ...(linkUrl
      ? {
          linkPreview: {
            url: linkUrl,
            ...(title ? { title } : {}),
          },
        }
      : {}),
  };
}

export function substackEntryToFeedItem(entry: RawSubstackEntry): FeedItem | null {
  if (entry.kind === "follower" || entry.kind === "following" || entry.kind === "subscription") return null;
  const globalId = entryGlobalId(entry);
  if (!globalId) return null;
  const capturedAt = parseTimestamp(entry.capturedAt, Date.now());
  const publishedAt = parseTimestamp(entry.publishedAt, capturedAt);
  const content = buildContent(entry);
  if (!content.text && !content.linkPreview && content.mediaUrls.length === 0) return null;

  const sourceUrl = canonicalUrl(entry.url);
  const likes = normalizeCount(entry.likeCount);
  const comments = normalizeCount(entry.commentCount);
  const reposts = normalizeCount(entry.restackCount);
  return {
    globalId,
    platform: "substack",
    contentType: entry.kind === "essay" ? "article" : "post",
    capturedAt,
    publishedAt,
    author: buildAuthor(entry),
    content,
    ...(likes !== undefined || comments !== undefined || reposts !== undefined
      ? {
          engagement: {
            ...(likes !== undefined ? { likes } : {}),
            ...(comments !== undefined ? { comments } : {}),
            ...(reposts !== undefined ? { reposts } : {}),
          },
        }
      : {}),
    ...(sourceUrl ? { sourceUrl } : {}),
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
    .filter((profile): profile is RawSubstackProfile & { role: FollowRosterRole } =>
      profile.role === "follower" ||
      profile.role === "following" ||
      profile.role === "subscription",
    )
    .map((profile): Account | null => {
      const externalId = stableExternalId(profile);
      if (!externalId) return null;
      const handle = normalizeHandle(profile.handle);
      const profileUrl = canonicalEssayProviderProfileUrl("substack", profile.profileUrl);
      const avatarUrl = canonicalUrl(profile.avatarUrl);
      const firstSeenAt = parseTimestamp(profile.firstSeenAt, now);
      const lastSeenAt = parseTimestamp(profile.lastSeenAt, now);
      return {
        id: `social:substack:${externalId}`,
        kind: "social",
        provider: "substack",
        externalId,
        ...(handle ? { handle } : {}),
        ...(clean(profile.displayName) ? { displayName: clean(profile.displayName) } : {}),
        ...(avatarUrl ? { avatarUrl } : {}),
        ...(profileUrl ? { profileUrl } : {}),
        firstSeenAt,
        lastSeenAt,
        discoveredFrom: "follow_roster",
        followRosterRoles: [profile.role],
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

function preferredDisplayName(existing: Account, incoming: Account): string | undefined {
  const candidates = [existing, incoming]
    .map((account) => ({
      value: clean(account.displayName),
      handle: normalizeHandle(account.handle),
    }))
    .filter((candidate): candidate is { value: string; handle: string | undefined } =>
      Boolean(candidate.value),
    );
  return candidates.sort((left, right) => {
    const leftScore = (normalizeHandle(left.value) === left.handle ? 0 : 1_000) + left.value.length;
    const rightScore = (normalizeHandle(right.value) === right.handle ? 0 : 1_000) + right.value.length;
    return rightScore - leftScore;
  })[0]?.value;
}

export function deduplicateAccounts(accounts: Account[]): Account[] {
  const deduplicated = new Map<string, Account>();
  for (const account of accounts) {
    const key = `${account.provider}:${account.externalId}`;
    const existing = deduplicated.get(key);
    if (!existing) {
      deduplicated.set(key, account);
      continue;
    }
    const roles = Array.from(
      new Set([...(existing.followRosterRoles ?? []), ...(account.followRosterRoles ?? [])]),
    );
    const displayName = preferredDisplayName(existing, account);
    deduplicated.set(key, {
      ...existing,
      ...(!existing.handle && account.handle ? { handle: account.handle } : {}),
      ...(displayName ? { displayName } : {}),
      ...(!existing.avatarUrl && account.avatarUrl ? { avatarUrl: account.avatarUrl } : {}),
      ...(!existing.profileUrl && account.profileUrl ? { profileUrl: account.profileUrl } : {}),
      firstSeenAt: Math.min(existing.firstSeenAt, account.firstSeenAt),
      lastSeenAt: Math.max(existing.lastSeenAt, account.lastSeenAt),
      ...(roles.length > 0 ? { followRosterRoles: roles } : {}),
    });
  }
  return [...deduplicated.values()];
}
