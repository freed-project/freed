/**
 * Facebook post normalization — RawFbPost → FeedItem
 *
 * Converts DOM-scraped Facebook data into the canonical FeedItem format.
 */

import type { FeedItem, Author, Content, Engagement, Location } from "@freed/shared";
import type { RawFbPost } from "./types.js";

// =============================================================================
// Author extraction
// =============================================================================

/**
 * Derive a stable author ID from the Facebook profile URL.
 * e.g. "https://www.facebook.com/john.doe" → "john.doe"
 * e.g. "https://www.facebook.com/profile.php?id=123" → "123"
 */
function extractAuthorId(profileUrl: string | null): string {
  if (!profileUrl) return "unknown";
  try {
    const url = new URL(profileUrl);
    // Profile ID from profile.php?id=XXX
    const id = url.searchParams.get("id");
    if (id) return id;
    // Handle from pathname: /john.doe or /john.doe/
    const parts = url.pathname.split("/").filter(Boolean);
    if (parts.length > 0 && !parts[0].includes(".php")) {
      return parts[0];
    }
  } catch {
    // ignore malformed URLs
  }
  return "unknown";
}

function buildAuthor(post: RawFbPost): Author {
  return {
    id: `fb:${extractAuthorId(post.authorProfileUrl)}`,
    handle: extractAuthorId(post.authorProfileUrl),
    displayName: post.authorName ?? "Unknown",
    avatarUrl: post.authorAvatarUrl ?? undefined,
  };
}

// =============================================================================
// Content extraction
// =============================================================================

function buildContent(post: RawFbPost): Content {
  const mediaTypes = post.mediaUrls.map((url): "image" | "video" => {
    if (post.hasVideo && post.mediaUrls.indexOf(url) === 0) return "video";
    return "image";
  });

  return {
    text: post.text ?? undefined,
    mediaUrls: post.mediaUrls,
    mediaTypes: post.hasVideo
      ? ["video", ...mediaTypes.slice(1)]
      : mediaTypes,
  };
}

// =============================================================================
// Timestamp extraction
// =============================================================================

function extractTimestamp(post: RawFbPost): number {
  if (post.timestampSeconds) {
    return post.timestampSeconds * 1000; // Convert seconds → ms
  }
  if (post.timestampIso) {
    const parsed = Date.parse(post.timestampIso);
    if (!isNaN(parsed)) return parsed;
  }
  return Date.now();
}

// =============================================================================
// Location extraction
// =============================================================================

function buildLocation(post: RawFbPost): Location | undefined {
  if (!post.location) return undefined;
  return {
    name: post.location,
    source: "check_in",
  };
}

// =============================================================================
// Engagement extraction
// =============================================================================

function buildEngagement(post: RawFbPost): Engagement | undefined {
  if (post.likeCount == null && post.commentCount == null && post.shareCount == null) {
    return undefined;
  }
  return {
    likes: post.likeCount ?? undefined,
    comments: post.commentCount ?? undefined,
    reposts: post.shareCount ?? undefined,
  };
}

// =============================================================================
// Main normalizer
// =============================================================================

/**
 * Convert a raw Facebook post to a Freed FeedItem.
 * Returns null if the post lacks a usable ID (can't be deduplicated).
 */
export function fbPostToFeedItem(post: RawFbPost): FeedItem | null {
  if (!post.id && !post.url) return null;

  const globalId = `fb:${post.id ?? encodeURIComponent(post.url ?? "")}`;
  const publishedAt = extractTimestamp(post);
  const author = buildAuthor(post);
  const content = buildContent(post);
  const engagement = buildEngagement(post);
  const location = buildLocation(post);

  const topics = post.hashtags.slice(0, 10);

  const contentType =
    post.postType === "reel" ? "video" : post.postType === "story" ? "story" : "post";

  return {
    globalId,
    platform: "facebook",
    contentType,
    capturedAt: Date.now(),
    publishedAt,
    author,
    content,
    engagement,
    location,
    topics,
    userState: {
      hidden: false,
      saved: false,
      archived: false,
      tags: [],
    },
  };
}

/**
 * Normalize multiple raw posts, filtering out nulls.
 */
export function fbPostsToFeedItems(posts: RawFbPost[]): FeedItem[] {
  return posts.map(fbPostToFeedItem).filter((item): item is FeedItem => item !== null);
}

/**
 * Deduplicate by globalId.
 */
export function deduplicateFeedItems(items: FeedItem[]): FeedItem[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    if (seen.has(item.globalId)) return false;
    seen.add(item.globalId);
    return true;
  });
}
