/**
 * Tweet normalization - Convert X/Twitter API responses to FeedItem
 */

import type {
  FeedItem,
  MediaType,
  Content,
  Author,
  Engagement,
} from "@freed/shared";
import type {
  XTweetResult,
  XMediaEntity,
  XUrlEntity,
  XCardBindingValue,
} from "./types.js";

// =============================================================================
// Media Extraction
// =============================================================================

/**
 * Extract media URLs from a tweet
 */
export function extractMediaUrls(tweet: XTweetResult): string[] {
  const urls: string[] = [];

  // Check extended_entities first (has full media info)
  const media =
    tweet.legacy.extended_entities?.media || tweet.legacy.entities.media;

  if (media) {
    for (const item of media) {
      if (item.type === "photo") {
        // Get highest quality image
        urls.push(item.media_url_https + ":large");
      } else if (item.type === "video" || item.type === "animated_gif") {
        // Get highest bitrate video variant
        if (item.video_info?.variants) {
          const mp4Variants = item.video_info.variants
            .filter((v) => v.content_type === "video/mp4" && v.bitrate)
            .sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0));

          if (mp4Variants.length > 0) {
            urls.push(mp4Variants[0].url);
          }
        }
      }
    }
  }

  return urls;
}

/**
 * Extract media types from a tweet
 */
export function extractMediaTypes(tweet: XTweetResult): MediaType[] {
  const types: MediaType[] = [];

  const media =
    tweet.legacy.extended_entities?.media || tweet.legacy.entities.media;

  if (media) {
    for (const item of media) {
      if (item.type === "photo") {
        types.push("image");
      } else if (item.type === "video" || item.type === "animated_gif") {
        types.push("video");
      }
    }
  }

  // Check for link cards
  if (
    tweet.card ||
    (tweet.legacy.entities.urls && tweet.legacy.entities.urls.length > 0)
  ) {
    if (!types.includes("link")) {
      types.push("link");
    }
  }

  return types;
}

// =============================================================================
// Link Preview Extraction
// =============================================================================

/**
 * Extract link preview from tweet card or URL entities
 */
export function extractLinkPreview(
  tweet: XTweetResult,
): Content["linkPreview"] | undefined {
  // Try to get from card first
  if (tweet.card?.legacy) {
    const card = tweet.card.legacy;
    const bindings = card.binding_values.reduce(
      (acc, b) => {
        if (b.value.string_value) {
          acc[b.key] = b.value.string_value;
        } else if (b.value.image_value) {
          acc[b.key] = b.value.image_value.url;
        }
        return acc;
      },
      {} as Record<string, string>,
    );

    return {
      url: bindings.url || card.url,
      title: bindings.title,
      description: bindings.description,
    };
  }

  // Fall back to URL entities
  const urls = tweet.legacy.entities.urls;
  if (urls && urls.length > 0) {
    // Filter out media URLs
    const nonMediaUrls = urls.filter(
      (u) =>
        !u.expanded_url.includes("twitter.com/") &&
        !u.expanded_url.includes("x.com/"),
    );

    if (nonMediaUrls.length > 0) {
      return {
        url: nonMediaUrls[0].expanded_url,
        title: undefined,
        description: undefined,
      };
    }
  }

  return undefined;
}

// =============================================================================
// Text Processing
// =============================================================================

/**
 * Expand t.co URLs in tweet text
 */
export function expandUrls(text: string, urls: XUrlEntity[]): string {
  let expanded = text;

  // Sort by index descending to replace from end to start
  const sortedUrls = [...urls].sort((a, b) => b.indices[0] - a.indices[0]);

  for (const url of sortedUrls) {
    expanded =
      expanded.slice(0, url.indices[0]) +
      url.expanded_url +
      expanded.slice(url.indices[1]);
  }

  return expanded;
}

/**
 * Clean tweet text for display
 */
export function cleanTweetText(tweet: XTweetResult): string {
  let text = tweet.legacy.full_text;

  // Check for note tweet (longer tweets)
  if (tweet.note_tweet?.note_tweet_results?.result?.text) {
    text = tweet.note_tweet.note_tweet_results.result.text;
  }

  // Expand URLs
  if (tweet.legacy.entities.urls) {
    text = expandUrls(text, tweet.legacy.entities.urls);
  }

  // Remove trailing media URLs (they're displayed separately)
  const mediaUrls = tweet.legacy.entities.media?.map((m) => m.url) || [];
  for (const mediaUrl of mediaUrls) {
    text = text.replace(mediaUrl, "").trim();
  }

  return text.trim();
}

// =============================================================================
// Main Normalization
// =============================================================================

/**
 * Convert an X tweet to a FREED FeedItem
 */
export function tweetToFeedItem(tweet: XTweetResult): FeedItem {
  // Handle retweets - use the original tweet data
  const isRetweet = !!tweet.legacy.retweeted_status_result?.result;
  const displayTweet = isRetweet
    ? tweet.legacy.retweeted_status_result!.result
    : tweet;

  // Handle quoted tweets
  const isQuote =
    tweet.legacy.is_quote_status && !!tweet.quoted_status_result?.result;

  // Build author info
  const author: Author = {
    id: displayTweet.core.user_results.result.rest_id,
    handle: displayTweet.core.user_results.result.legacy.screen_name,
    displayName: displayTweet.core.user_results.result.legacy.name,
    avatarUrl:
      displayTweet.core.user_results.result.legacy.profile_image_url_https.replace(
        "_normal",
        "_bigger",
      ), // Get larger avatar
  };

  // Build content
  const content: Content = {
    text: cleanTweetText(displayTweet),
    mediaUrls: extractMediaUrls(displayTweet),
    mediaTypes: extractMediaTypes(displayTweet),
    linkPreview: extractLinkPreview(displayTweet),
  };

  // Build engagement (captured for user-controlled ranking)
  const engagement: Engagement = {
    likes: displayTweet.legacy.favorite_count,
    reposts: displayTweet.legacy.retweet_count,
    comments: displayTweet.legacy.reply_count,
    views: displayTweet.views?.count
      ? parseInt(displayTweet.views.count)
      : undefined,
  };

  // Parse timestamp
  const publishedAt = new Date(displayTweet.legacy.created_at).getTime();

  // Extract topics from hashtags
  const topics =
    displayTweet.legacy.entities.hashtags?.map((h) => h.text.toLowerCase()) ||
    [];

  return {
    globalId: `x:${displayTweet.rest_id}`,
    platform: "x",
    contentType: "post",
    capturedAt: Date.now(),
    publishedAt,
    author,
    content,
    engagement,
    userState: {
      hidden: false,
      bookmarked: false,
    },
    topics,
  };
}

/**
 * Convert multiple tweets to FeedItems, filtering out tombstones
 */
export function tweetsToFeedItems(tweets: XTweetResult[]): FeedItem[] {
  return tweets
    .filter((t) => t.__typename !== "TweetTombstone")
    .map(tweetToFeedItem);
}

/**
 * Deduplicate feed items by globalId
 */
export function deduplicateFeedItems(items: FeedItem[]): FeedItem[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    if (seen.has(item.globalId)) return false;
    seen.add(item.globalId);
    return true;
  });
}
