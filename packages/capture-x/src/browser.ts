/**
 * Browser-safe entry point for @freed/capture-x
 *
 * Re-exports only the pure, Node-free modules:
 *   - types (TypeScript-only, stripped at runtime)
 *   - endpoints (constants and query builders)
 *   - normalize (pure tweet → FeedItem converters)
 *
 * Explicitly omits auth.js and client.js, which depend on Node built-ins
 * (os, fs, path, better-sqlite3) and cannot be bundled into a browser renderer.
 *
 * Use this entry point from any browser/Tauri renderer context:
 *   import { X_API_BASE, tweetsToFeedItems } from "@freed/capture-x/browser";
 */

export * from "./types.js";

export {
  X_API_BASE,
  X_BEARER_TOKEN,
  COMMON_FEATURES,
  TIMELINE_FEATURES,
  HomeLatestTimeline,
  HomeTimeline,
  Following,
  UserTweets,
  TweetDetail,
  buildGraphQLUrl,
  buildRequestBody,
  getHomeLatestTimelineVariables,
  getFollowingVariables,
  getUserTweetsVariables,
} from "./endpoints.js";

export {
  extractMediaUrls,
  extractMediaTypes,
  extractLinkPreview,
  expandUrls,
  cleanTweetText,
  tweetToFeedItem,
  tweetsToFeedItems,
  deduplicateFeedItems,
} from "./normalize.js";
