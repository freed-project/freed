/**
 * @freed/capture-rss - RSS/Atom feed capture package
 * 
 * Captures content from RSS and Atom feeds with conditional GET support.
 */

// Re-export types
export * from './types.js'

// Re-export parser
export {
  fetchFeed,
  fetchFeeds,
  validateFeed,
  getFeedMetadata
} from './parser.js'

// Re-export OPML utilities
export {
  parseOPML,
  generateOPML,
  validateOPML,
  getOPMLStats,
  mergeOPML,
  opmlFeedsToRssFeeds
} from './opml.js'

// Re-export discovery
export {
  discoverFeed,
  discoverAllFeeds,
  detectPlatform,
  resolveUrl
} from './discovery.js'

// Re-export normalization
export {
  rssItemToFeedItem,
  feedToFeedItems,
  feedToRssFeed,
  deduplicateFeedItems
} from './normalize.js'
