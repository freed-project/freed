/**
 * Browser-safe entry point for @freed/capture-facebook
 *
 * Re-exports only the pure, Node-free modules:
 *   - types (TypeScript-only, stripped at runtime)
 *   - normalize (pure RawFbPost -> FeedItem converters)
 *   - selectors (CSS selectors and parsing helpers)
 *   - rate-limit (pure state machine)
 *   - mbasic-parser (DOMParser-based parser for mbasic.facebook.com)
 *
 * Explicitly omits index.ts, session.ts, and scraper.ts which depend on
 * playwright-core and cannot be bundled into a browser renderer.
 *
 * Use this entry point from any browser/Tauri renderer context:
 *   import { fbPostsToFeedItems, parseMbasicFeed } from "@freed/capture-facebook/browser";
 */

export type {
  FacebookCookies,
  FacebookScrapeOptions,
  RawFbPost,
  RateLimitState,
} from "./types.js";

export {
  SELECTORS,
  SELECTOR_VERSION,
  extractPostId,
  extractHashtags,
  parseEngagementCount,
} from "./selectors.js";

export {
  fbPostToFeedItem,
  fbPostsToFeedItems,
  deduplicateFeedItems,
} from "./normalize.js";

export {
  createRateLimitState,
  checkRateLimit,
  recordSuccess,
  recordError,
  formatWaitTime,
} from "./rate-limit.js";

export {
  parseMbasicFeed,
} from "./mbasic-parser.js";
