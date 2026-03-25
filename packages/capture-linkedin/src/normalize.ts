/**
 * LinkedIn post normalization — RawLiPost → FeedItem
 *
 * Converts DOM-scraped LinkedIn data into the canonical FeedItem format.
 */

import type { FeedItem, Author, Content, Engagement } from "@freed/shared";
import type { RawLiPost } from "./types.js";
import { extractProfileHandle, parseRelativeTimestamp } from "./selectors.js";

// =============================================================================
// Author extraction
// =============================================================================

function buildAuthor(post: RawLiPost): Author {
  const handle = extractProfileHandle(post.authorProfileUrl);
  return {
    id: `li:${handle}`,
    handle,
    displayName: post.authorName ?? "LinkedIn User",
    ...(post.authorAvatarUrl ? { avatarUrl: post.authorAvatarUrl } : {}),
    ...(post.authorHeadline ? { bio: post.authorHeadline } : {}),
  };
}

// =============================================================================
// Content extraction
// =============================================================================

function buildContent(post: RawLiPost): Content {
  const mediaTypes = post.mediaUrls.map((url): "image" | "video" => {
    if (post.hasVideo && post.mediaUrls.indexOf(url) === 0) return "video";
    return "image";
  });

  const content: Content = {
    mediaUrls: post.mediaUrls,
    mediaTypes: post.hasVideo
      ? ["video", ...mediaTypes.slice(1)]
      : mediaTypes,
  };

  if (post.text) {
    content.text = post.text;
  }

  if (post.articleUrl && post.articleTitle) {
    content.linkPreview = {
      url: post.articleUrl,
      title: post.articleTitle,
    };
  } else if (post.articleUrl) {
    content.linkPreview = { url: post.articleUrl };
  }

  return content;
}

// =============================================================================
// Timestamp extraction
// =============================================================================

function extractTimestamp(post: RawLiPost): number {
  if (post.timestampIso) {
    const parsed = Date.parse(post.timestampIso);
    if (!isNaN(parsed)) return parsed;
  }
  if (post.timestampRelative) {
    const approx = parseRelativeTimestamp(post.timestampRelative);
    if (approx !== null) return approx;
  }
  return Date.now();
}

// =============================================================================
// Engagement extraction
// =============================================================================

function buildEngagement(post: RawLiPost): Engagement | undefined {
  if (
    post.reactionCount == null &&
    post.commentCount == null &&
    post.repostCount == null
  ) {
    return undefined;
  }
  return {
    ...(post.reactionCount != null ? { likes: post.reactionCount } : {}),
    ...(post.commentCount != null ? { comments: post.commentCount } : {}),
    ...(post.repostCount != null ? { reposts: post.repostCount } : {}),
  };
}

// =============================================================================
// Main normalizer
// =============================================================================

/**
 * Convert a raw LinkedIn post to a Freed FeedItem.
 * Returns null if the post lacks a usable identifier (can't be deduplicated).
 */
export function liPostToFeedItem(post: RawLiPost): FeedItem | null {
  if (!post.urn && !post.url) return null;

  // globalId: "li:urn:li:activity:123" or "li:<encodedUrl>"
  const globalId = post.urn
    ? `li:${post.urn}`
    : `li:${encodeURIComponent(post.url ?? "")}`;

  const publishedAt = extractTimestamp(post);
  const author = buildAuthor(post);
  const content = buildContent(post);
  const engagement = buildEngagement(post);

  const topics = post.hashtags.slice(0, 10);

  const contentType =
    post.postType === "article" ? "post"
    : post.postType === "shared" ? "post"
    : "post";

  return {
    globalId,
    platform: "linkedin",
    contentType,
    capturedAt: Date.now(),
    publishedAt,
    author,
    content,
    ...(engagement !== undefined ? { engagement } : {}),
    sourceUrl: post.url ?? undefined,
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
export function liPostsToFeedItems(posts: RawLiPost[]): FeedItem[] {
  return posts
    .map(liPostToFeedItem)
    .filter((item): item is FeedItem => item !== null);
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
