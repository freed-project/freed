/**
 * Browser-safe entry point for @freed/capture-linkedin
 *
 * Re-exports only pure TypeScript modules (types, selectors, normalize,
 * rate-limit). Does NOT export anything that depends on Node.js or Playwright.
 * This is the module that Tauri's renderer process imports.
 */

export type { RawLiPost, LinkedInScrapeOptions, RateLimitState } from "./types.js";

export {
  SELECTOR_VERSION,
  SELECTORS,
  parseEngagementCount,
  extractHashtags,
  parseRelativeTimestamp,
  extractUrn,
  extractProfileHandle,
} from "./selectors.js";

export {
  liPostToFeedItem,
  liPostsToFeedItems,
  deduplicateFeedItems,
} from "./normalize.js";

export {
  MIN_INTERVAL_MS,
  INTERVAL_JITTER_MS,
  ERROR_COOLDOWN_MS,
  EXTENDED_COOLDOWN_MS,
  createRateLimitState,
  checkRateLimit,
  recordSuccess,
  recordError,
  formatWaitTime,
} from "./rate-limit.js";
