/**
 * RSS/Atom specific types
 */

// =============================================================================
// Parsed Feed Types
// =============================================================================

/**
 * A parsed RSS/Atom feed
 */
export interface ParsedFeed {
  title: string;
  description?: string;
  link?: string;
  feedUrl: string;
  language?: string;
  lastBuildDate?: string;
  image?: {
    url: string;
    title?: string;
    link?: string;
  };
  items: ParsedFeedItem[];
}

/**
 * A parsed RSS/Atom feed item
 */
export interface ParsedFeedItem {
  title?: string;
  link?: string;
  guid?: string;
  pubDate?: string;
  creator?: string;
  content?: string;
  contentSnippet?: string;
  summary?: string;
  categories?: string[];
  enclosure?: {
    url: string;
    type?: string;
    length?: string;
  };
  "media:content"?: MediaContent | MediaContent[];
  "media:thumbnail"?: MediaThumbnail;
}

/**
 * Media RSS content
 */
export interface MediaContent {
  $: {
    url: string;
    type?: string;
    medium?: string;
    width?: string;
    height?: string;
  };
}

/**
 * Media RSS thumbnail
 */
export interface MediaThumbnail {
  $: {
    url: string;
    width?: string;
    height?: string;
  };
}

// =============================================================================
// Fetch Types
// =============================================================================

/**
 * Options for fetching a feed
 */
export interface FetchOptions {
  /** ETag from previous fetch for conditional GET */
  etag?: string;
  /** Last-Modified header from previous fetch */
  lastModified?: string;
  /** Request timeout in milliseconds */
  timeout?: number;
  /** Custom user agent */
  userAgent?: string;
}

/**
 * Result of fetching a feed
 */
export interface FetchResult {
  /** Whether the feed was unchanged (304 response) */
  unchanged: boolean;
  /** Parsed feed data (undefined if unchanged) */
  feed?: ParsedFeed;
  /** ETag header from response */
  etag?: string;
  /** Last-Modified header from response */
  lastModified?: string;
}

// =============================================================================
// OPML Types
// =============================================================================

/**
 * An OPML document
 */
export interface OPMLDocument {
  opml: {
    head?: {
      title?: string;
      dateCreated?: string;
      ownerName?: string;
    };
    body: {
      outline: OPMLOutline | OPMLOutline[];
    };
  };
}

/**
 * An OPML outline element
 */
export interface OPMLOutline {
  "@_text"?: string;
  "@_title"?: string;
  "@_type"?: string;
  "@_xmlUrl"?: string;
  "@_htmlUrl"?: string;
  "@_description"?: string;
  "@_category"?: string;
  outline?: OPMLOutline | OPMLOutline[];
}

/**
 * A feed extracted from OPML
 */
export interface OPMLFeed {
  url: string;
  title: string;
  siteUrl?: string;
  description?: string;
  category?: string;
}

// =============================================================================
// Discovery Types
// =============================================================================

/**
 * A discovered feed
 */
export interface DiscoveredFeed {
  url: string;
  title?: string;
  type: "rss" | "atom" | "json";
}

/**
 * Platform-specific feed patterns
 */
export interface PlatformPattern {
  match: RegExp;
  transform: (url: string, match: RegExpMatchArray) => string;
}
