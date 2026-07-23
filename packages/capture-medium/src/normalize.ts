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
import type { RawMediumEntry, RawMediumProfile } from "./types.js";

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

function stableExternalId(profile: RawMediumProfile): string | null {
  const explicitId = clean(profile.id);
  if (explicitId) {
    return canonicalEssayProviderProfileUrl("medium", explicitId) ?? explicitId;
  }
  return canonicalEssayProviderProfileUrl("medium", profile.profileUrl) ??
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

function profileHandle(profile: RawMediumProfile | undefined): string {
  const handle = normalizeHandle(profile?.handle);
  if (handle) return handle;
  const url = clean(profile?.profileUrl);
  if (url) {
    try {
      const parsed = new URL(url);
      const handleFromPath = parsed.pathname.split("/").filter(Boolean).find((part) => part.startsWith("@"));
      if (handleFromPath) return handleFromPath.replace(/^@/, "");
      const fallback = parsed.pathname.split("/").filter(Boolean)[0];
      if (fallback) return fallback;
    } catch {
      return url;
    }
  }
  return "unknown";
}

function inferredStoryAuthor(entry: RawMediumEntry): RawMediumProfile | undefined {
  if (entry.author || entry.kind !== "story") return entry.author;
  const value = canonicalUrl(entry.url);
  if (!value) return undefined;
  try {
    const url = new URL(value);
    if (url.hostname !== "medium.com" && !url.hostname.endsWith(".medium.com")) {
      return undefined;
    }
    const handle = url.pathname
      .split("/")
      .filter(Boolean)
      .find((part) => part.startsWith("@"))
      ?.replace(/^@/, "")
      .toLowerCase();
    return handle
      ? { id: `https://medium.com/@${handle}`, handle, profileUrl: `https://medium.com/@${handle}` }
      : undefined;
  } catch {
    return undefined;
  }
}

function buildAuthor(entry: RawMediumEntry): Author {
  const profile = inferredStoryAuthor(entry);
  const handle = profileHandle(profile);
  const externalId = stableExternalId(profile ?? { handle }) ?? handle;
  const avatarUrl = canonicalUrl(profile?.avatarUrl);
  return {
    id: externalId,
    handle,
    displayName: clean(profile?.displayName) ?? handle,
    ...(avatarUrl ? { avatarUrl } : {}),
  };
}

function activityText(entry: RawMediumEntry): string | undefined {
  if (entry.kind === "clap") {
    return bounded(entry.activityLabel, 4_000) ?? "Clapped for a story";
  }
  return bounded(entry.text);
}

function entryGlobalId(entry: RawMediumEntry): string | null {
  const explicitId = clean(entry.id);
  const explicitUrl = canonicalUrl(explicitId);
  const targetUrl = canonicalUrl(entry.url) ?? explicitUrl;
  if (entry.kind === "story") {
    return essayProviderGlobalId("medium", targetUrl) ??
      (explicitId ? `medium:story:${encodeURIComponent(explicitId)}` : null);
  }
  if (explicitId && !explicitUrl) {
    return `medium:${entry.kind}:${encodeURIComponent(explicitId)}`;
  }
  const author = entry.author;
  const identityText = activityText(entry);
  return essayActivityGlobalId("medium", entry.kind, {
    ...(targetUrl ? { targetUrl } : {}),
    ...(author ? { authorId: stableExternalId(author) ?? undefined } : {}),
    ...(entry.publishedAt !== undefined ? { publishedAt: entry.publishedAt } : {}),
    ...(identityText ? { text: identityText } : {}),
  }) ?? null;
}

function buildContent(entry: RawMediumEntry): Content {
  const mediaUrls = Array.from(new Set((entry.mediaUrls ?? []).map(canonicalUrl).filter((url): url is string => !!url))).slice(0, MAX_MEDIA_URLS);
  const title = bounded(entry.title, 500);
  const body = entry.kind === "story" ? undefined : activityText(entry);
  const text = entry.kind === "story"
    ? ""
    : [title, body && body !== title ? body : undefined].filter(Boolean).join("\n\n");
  const linkUrl = canonicalUrl(entry.url);
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

export function mediumEntryToFeedItem(entry: RawMediumEntry): FeedItem | null {
  if (entry.kind === "follower" || entry.kind === "following") return null;
  const globalId = entryGlobalId(entry);
  if (!globalId) return null;
  const capturedAt = parseTimestamp(entry.capturedAt, Date.now());
  const publishedAt = parseTimestamp(entry.publishedAt, capturedAt);
  const content = buildContent(entry);
  if (!content.text && !content.linkPreview && content.mediaUrls.length === 0) return null;

  const sourceUrl = canonicalUrl(entry.url);
  const likes = normalizeCount(entry.clapCount);
  const comments = normalizeCount(entry.responseCount);
  return {
    globalId,
    platform: "medium",
    contentType: entry.kind === "story" ? "article" : "post",
    capturedAt,
    publishedAt,
    author: buildAuthor(entry),
    content,
    ...(likes !== undefined || comments !== undefined
      ? {
          engagement: {
            ...(likes !== undefined ? { likes } : {}),
            ...(comments !== undefined ? { comments } : {}),
          },
        }
      : {}),
    ...(sourceUrl ? { sourceUrl } : {}),
    topics: entry.kind === "story" ? ["essay"] : ["discussion"],
    userState: {
      hidden: false,
      saved: false,
      archived: false,
      tags: [],
    },
  };
}

export function mediumEntriesToFeedItems(entries: RawMediumEntry[]): FeedItem[] {
  return entries
    .map(mediumEntryToFeedItem)
    .filter((item): item is FeedItem => item !== null);
}

export function mediumProfilesToAccounts(profiles: RawMediumProfile[]): Account[] {
  const now = Date.now();
  return profiles
    .filter((profile): profile is RawMediumProfile & { role: FollowRosterRole } =>
      profile.role === "follower" ||
      profile.role === "following" ||
      profile.role === "subscription")
    .map((profile): Account | null => {
      const externalId = stableExternalId(profile);
      if (!externalId) return null;
      const handle = normalizeHandle(profile.handle);
      const profileUrl = canonicalEssayProviderProfileUrl("medium", profile.profileUrl);
      const avatarUrl = canonicalUrl(profile.avatarUrl);
      const firstSeenAt = parseTimestamp(profile.firstSeenAt, now);
      const lastSeenAt = parseTimestamp(profile.lastSeenAt, now);
      return {
        id: `social:medium:${externalId}`,
        kind: "social",
        provider: "medium",
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
