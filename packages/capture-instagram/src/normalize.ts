/**
 * Instagram post normalization — RawIgPost → FeedItem
 */

import type { FeedItem, Author, Content, Engagement, Location } from "@freed/shared";
import type { RawIgPost } from "./types.js";

// =============================================================================
// Author
// =============================================================================

function buildAuthor(post: RawIgPost): Author {
  const handle = post.authorHandle ?? "unknown";
  return {
    id: `ig:${handle}`,
    handle,
    displayName: post.authorDisplayName ?? handle,
    ...(post.authorAvatarUrl ? { avatarUrl: post.authorAvatarUrl } : {}),
  };
}

// =============================================================================
// Content
// =============================================================================

function buildContent(post: RawIgPost): Content {
  const mediaTypes = post.mediaUrls.map((): "image" | "video" => "image");
  const allMediaTypes: ("image" | "video" | "link")[] =
    post.isVideo ? ["video", ...mediaTypes.slice(1)] : mediaTypes;

  return {
    ...(post.caption ? { text: post.caption } : {}),
    mediaUrls: post.mediaUrls,
    mediaTypes: allMediaTypes,
  };
}

// =============================================================================
// Timestamp
// =============================================================================

function extractTimestamp(post: RawIgPost): number {
  if (post.timestampIso) {
    const parsed = Date.parse(post.timestampIso);
    if (!isNaN(parsed)) return parsed;
  }
  return Date.now();
}

// =============================================================================
// Location
// =============================================================================

function buildLocation(post: RawIgPost): Location | undefined {
  if (!post.location) return undefined;
  return {
    name: post.location,
    source: "geo_tag",
  };
}

// =============================================================================
// Engagement
// =============================================================================

function buildEngagement(post: RawIgPost): Engagement | undefined {
  if (post.likeCount == null && post.commentCount == null) return undefined;
  return {
    ...(post.likeCount != null ? { likes: post.likeCount } : {}),
    ...(post.commentCount != null ? { comments: post.commentCount } : {}),
  };
}

// =============================================================================
// Main normalizer
// =============================================================================

/**
 * Convert a raw Instagram post to a Freed FeedItem.
 * Returns null if the post lacks a shortcode (can't be deduplicated).
 */
function contentHash(handle: string, text: string): string {
  const seed = (handle || "") + "||" + (text || "").slice(0, 120);
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = (hash << 5) - hash + seed.charCodeAt(i);
    hash |= 0;
  }
  return "h" + Math.abs(hash).toString(36);
}

export function igPostToFeedItem(post: RawIgPost): FeedItem | null {
  // Must have some content to be worth keeping
  if (!post.shortcode && !post.url && !post.caption && post.mediaUrls.length === 0) return null;

  const slug = post.shortcode
    ?? (post.url ? encodeURIComponent(post.url) : null)
    ?? contentHash(post.authorHandle ?? "", post.caption ?? "");

  const globalId = `ig:${slug}`;
  const publishedAt = extractTimestamp(post);
  const author = buildAuthor(post);
  const content = buildContent(post);
  const engagement = buildEngagement(post);
  const location = buildLocation(post);
  const topics = post.hashtags.slice(0, 10);

  const contentType =
    post.postType === "reel" || post.postType === "video"
      ? "video"
      : post.postType === "story"
      ? "story"
      : "post";

  return {
    globalId,
    platform: "instagram",
    contentType,
    capturedAt: Date.now(),
    publishedAt,
    author,
    content,
    ...(engagement !== undefined ? { engagement } : {}),
    ...(location !== undefined ? { location } : {}),
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
export function igPostsToFeedItems(posts: RawIgPost[]): FeedItem[] {
  return posts.map(igPostToFeedItem).filter((item): item is FeedItem => item !== null);
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
