/**
 * Browser-safe entry point for @freed/capture-instagram
 *
 * Re-exports only the pure, Node-free modules:
 *   - types (TypeScript-only, stripped at runtime)
 *   - normalize (pure RawIgPost -> FeedItem converters)
 *   - selectors (CSS selectors and parsing helpers)
 *   - rate-limit (pure state machine)
 *
 * Explicitly omits index.ts, session.ts, and scraper.ts which depend on
 * playwright-core and cannot be bundled into a browser renderer.
 *
 * Use this entry point from any browser/Tauri renderer context:
 *   import { igPostsToFeedItems } from "@freed/capture-instagram/browser";
 */

export type {
  InstagramCookies,
  InstagramScrapeOptions,
  RawIgPost,
  RateLimitState,
} from "./types.js";

export {
  SELECTORS,
  SELECTOR_VERSION,
  extractShortcode,
  extractHashtags,
  parseEngagementCount,
} from "./selectors.js";

export {
  igPostToFeedItem,
  igPostsToFeedItems,
  deduplicateFeedItems,
} from "./normalize.js";

export {
  createRateLimitState,
  checkRateLimit,
  recordSuccess,
  recordError,
  formatWaitTime,
} from "./rate-limit.js";
