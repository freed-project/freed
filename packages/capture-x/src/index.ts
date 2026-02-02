/**
 * @freed/capture-x - X/Twitter capture package
 *
 * Captures posts from X/Twitter using their internal GraphQL API.
 */

// Re-export types
export * from "./types.js";

// Re-export client
export { XClient } from "./client.js";

// Re-export auth utilities
export {
  extractCookies,
  extractCookiesAuto,
  validateCookies,
  parseCookieString,
  type SupportedBrowser,
} from "./auth.js";

// Re-export normalization
export {
  tweetToFeedItem,
  tweetsToFeedItems,
  deduplicateFeedItems,
  extractMediaUrls,
  extractMediaTypes,
  extractLinkPreview,
  cleanTweetText,
} from "./normalize.js";

// Re-export endpoint definitions
export {
  X_API_BASE,
  X_BEARER_TOKEN,
  HomeLatestTimeline,
  HomeTimeline,
  Following,
  UserTweets,
  TweetDetail,
} from "./endpoints.js";
