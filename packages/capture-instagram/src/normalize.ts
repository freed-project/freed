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
    avatarUrl: post.authorAvatarUrl ?? undefined,
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
    text: post.caption ?? undefined,
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
    likes: post.likeCount ?? undefined,
    comments: post.commentCount ?? undefined,
  };
}

// =============================================================================
// Main normalizer
// =============================================================================

/**
 * Convert a raw Instagram post to a Freed FeedItem.
 * Returns null if the post lacks a shortcode (can't be deduplicated).
 */
export function igPostToFeedItem(post: RawIgPost): FeedItem | null {
  if (!post.shortcode && !post.url) return null;

  const globalId = `ig:${post.shortcode ?? encodeURIComponent(post.url ?? "")}`;
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
