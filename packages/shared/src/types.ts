/**
 * @freed/shared - Core type definitions for Freed
 *
 * "Their algorithms optimize for profit. Optimize yours for life."
 */

// =============================================================================
// Platform Types
// =============================================================================

/**
 * Supported content platforms
 */
export type Platform =
  | "x" // X/Twitter
  | "rss" // Generic RSS/Atom
  | "youtube" // YouTube (via RSS)
  | "reddit" // Reddit (via RSS)
  | "mastodon" // Mastodon (via RSS)
  | "github" // GitHub (via Atom)
  | "facebook" // Facebook (DOM capture)
  | "instagram" // Instagram (DOM capture)
  | "linkedin" // LinkedIn (DOM capture, future)
  | "saved"; // Manually saved URLs (bookmarks)

/**
 * Content type classification
 */
export type ContentType = "post" | "story" | "article" | "video" | "podcast";

/**
 * Media type classification
 */
export type MediaType = "image" | "video" | "link";

/**
 * Location source type
 */
export type LocationSource =
  | "geo_tag"
  | "check_in"
  | "sticker"
  | "text_extraction";

// =============================================================================
// Feed Item
// =============================================================================

/**
 * Author information
 */
export interface Author {
  id: string;
  handle: string;
  displayName: string;
  avatarUrl?: string;
}

/**
 * Content structure
 */
export interface Content {
  text?: string;
  mediaUrls: string[];
  mediaTypes: MediaType[];
  linkPreview?: LinkPreview;
}

/**
 * Link preview information
 */
export interface LinkPreview {
  url: string;
  title?: string;
  description?: string;
}

/**
 * Engagement metrics (captured for user-controlled ranking, hidden by default in UI)
 */
export interface Engagement {
  likes?: number;
  reposts?: number;
  comments?: number;
  views?: number;
}

/**
 * Location information
 */
export interface Location {
  name: string;
  coordinates?: { lat: number; lng: number };
  source: LocationSource;
}

/**
 * RSS-specific source information
 */
export interface RssSourceInfo {
  feedUrl: string;
  feedTitle: string;
  siteUrl: string;
}

/**
 * Preserved article content for reader view
 * Used by capture-save and optionally by capture-rss for full articles
 */
export interface PreservedContent {
  /** Extracted article HTML */
  html: string;

  /** Plain text version */
  text: string;

  /** Extracted author */
  author?: string;

  /** Publication date */
  publishedAt?: number;

  /** Word count */
  wordCount: number;

  /** Estimated reading time in minutes */
  readingTime: number;

  /** When content was preserved */
  preservedAt: number;
}

/**
 * User interaction state
 */
export interface UserState {
  /** Hide from feed */
  hidden: boolean;

  /** Read timestamp */
  readAt?: number;

  /** Saved for later */
  saved: boolean;

  /** When item was saved */
  savedAt?: number;

  /** Archived (removed from active queue, kept in library) */
  archived: boolean;

  /** User-assigned tags */
  tags: string[];

  /** User highlights/annotations */
  highlights?: Highlight[];
}

/**
 * Text highlight/annotation
 */
export interface Highlight {
  /** Highlighted text */
  text: string;

  /** Optional note */
  note?: string;

  /** When highlight was created */
  createdAt: number;
}

/**
 * Core feed item - represents any captured content
 */
export interface FeedItem {
  /** Unique identifier: "platform:id" (e.g., "x:123" or "rss:https://...") */
  globalId: string;

  /** Source platform */
  platform: Platform;

  /** Content type classification */
  contentType: ContentType;

  /** When Freed captured this item (Unix timestamp) */
  capturedAt: number;

  /** Original publish timestamp (Unix timestamp) */
  publishedAt: number;

  /** Author information */
  author: Author;

  /** Content data */
  content: Content;

  /** Engagement metrics (optional, for user-controlled ranking) */
  engagement?: Engagement;

  /** Location information (optional) */
  location?: Location;

  /** RSS-specific source info (optional) */
  rssSource?: RssSourceInfo;

  /** Preserved article content for reader view (optional) */
  preservedContent?: PreservedContent;

  /** User interaction state */
  userState: UserState;

  /** Extracted/inferred topics */
  topics: string[];

  /** Pre-computed priority score (0-100), calculated by Desktop/OpenClaw */
  priority?: number;

  /** When priority was last calculated (Unix timestamp) */
  priorityComputedAt?: number;
}

// =============================================================================
// X/Twitter Capture
// =============================================================================

/**
 * X capture mode
 * - mirror: Capture from everyone you follow on X
 * - whitelist: Only capture from explicitly listed accounts
 * - mirror_blacklist: Mirror follows but exclude blacklisted accounts
 */
export type XCaptureMode = "mirror" | "whitelist" | "mirror_blacklist";

/**
 * An X account for whitelist/blacklist
 */
export interface XAccount {
  /** User ID (rest_id) */
  id: string;

  /** Username/handle (without @) */
  handle: string;

  /** Display name */
  displayName?: string;

  /** Avatar URL */
  avatarUrl?: string;

  /** When this account was added */
  addedAt: number;

  /** Optional note about why this account is listed */
  note?: string;
}

/**
 * X capture preferences
 */
export interface XCapturePreferences {
  /** Capture mode */
  mode: XCaptureMode;

  /** Whitelist: accounts to capture (used when mode is 'whitelist') */
  whitelist: Record<string, XAccount>;

  /** Blacklist: accounts to exclude (used when mode is 'mirror_blacklist') */
  blacklist: Record<string, XAccount>;

  /** Include retweets in capture */
  includeRetweets: boolean;

  /** Include replies in capture */
  includeReplies: boolean;
}

// =============================================================================
// RSS Feed
// =============================================================================

/**
 * RSS feed subscription
 */
export interface RssFeed {
  /** Feed URL */
  url: string;

  /** Feed title */
  title: string;

  /** Website URL */
  siteUrl?: string;

  /** Last successful fetch timestamp */
  lastFetched?: number;

  /** ETag for conditional GET */
  etag?: string;

  /** Last-Modified header for conditional GET */
  lastModified?: string;

  /** Feed image URL */
  imageUrl?: string;

  /** Whether this feed is enabled */
  enabled: boolean;

  /** Custom poll interval in minutes (overrides default) */
  pollInterval?: number;

  /** Track unread count for this feed (default: false) */
  trackUnread: boolean;

  /** User-assigned folder/category */
  folder?: string;
}

// =============================================================================
// User Preferences
// =============================================================================

/**
 * Feed weighting preferences
 */
export interface WeightPreferences {
  /** Recency weight (0-100): How much to prioritize new content */
  recency: number;

  /** Platform weights: Platform -> weight multiplier */
  platforms: Record<string, number>;

  /** Topic weights: Topic -> weight multiplier */
  topics: Record<string, number>;

  /** Author weights: Author ID -> weight multiplier */
  authors: Record<string, number>;
}

/**
 * Ulysses mode preferences (feed blocking)
 */
export interface UlyssesPreferences {
  /** Whether Ulysses mode is enabled */
  enabled: boolean;

  /** Platforms to block feeds on */
  blockedPlatforms: string[];

  /** Allowed paths per platform (e.g., /messages, /notifications) */
  allowedPaths: Record<string, string[]>;
}

/**
 * Sync preferences
 */
export interface SyncPreferences {
  /** Cloud backup provider */
  cloudProvider?: "gdrive" | "icloud" | "dropbox";

  /** Whether auto-backup is enabled */
  autoBackup: boolean;

  /** Backup frequency */
  backupFrequency?: "hourly" | "daily" | "manual";
}

/**
 * Reading enhancement intensity
 */
export type ReadingIntensity = "light" | "normal" | "strong";

/**
 * Reading enhancements configuration
 */
export interface ReadingEnhancements {
  /**
   * Focus mode: bolds word beginnings to create fixation points
   * Aids reading speed and focus for some users
   */
  focusMode: boolean;

  /** Focus mode intensity */
  focusIntensity: ReadingIntensity;
}

/**
 * Display preferences
 */
export interface DisplayPreferences {
  /** Items per page */
  itemsPerPage: number;

  /** Compact mode */
  compactMode: boolean;

  /** Show engagement counts (default: false - opt-in only) */
  showEngagementCounts: boolean;

  /** Reading enhancements */
  reading: ReadingEnhancements;
}

/**
 * Complete user preferences
 */
export interface UserPreferences {
  weights: WeightPreferences;
  ulysses: UlyssesPreferences;
  sync: SyncPreferences;
  display: DisplayPreferences;
  xCapture: XCapturePreferences;
}

// =============================================================================
// Document Metadata
// =============================================================================

/**
 * Document metadata
 */
export interface DocumentMeta {
  /** Unique device identifier */
  deviceId: string;

  /** Last sync timestamp */
  lastSync: number;

  /** Document version for migrations */
  version: number;
}

// =============================================================================
// Defaults
// =============================================================================

/**
 * Create default user preferences
 */
export function createDefaultPreferences(): UserPreferences {
  return {
    weights: {
      recency: 50,
      platforms: {},
      topics: {},
      authors: {},
    },
    ulysses: {
      enabled: false,
      blockedPlatforms: [],
      allowedPaths: {
        x: ["/messages", "/notifications", "/compose", "/settings", "/i/"],
        facebook: ["/messages", "/notifications", "/settings", "/marketplace"],
        instagram: ["/direct", "/accounts", "/explore/tags"],
      },
    },
    sync: {
      autoBackup: false,
    },
    display: {
      itemsPerPage: 20,
      compactMode: false,
      showEngagementCounts: false, // Hidden by default
      reading: {
        focusMode: false,
        focusIntensity: "normal",
      },
    },
    xCapture: {
      mode: "mirror", // Default: capture from everyone you follow
      whitelist: {},
      blacklist: {},
      includeRetweets: true,
      includeReplies: false,
    },
  };
}

/**
 * Create default document metadata
 */
export function createDefaultMeta(): DocumentMeta {
  return {
    deviceId: crypto.randomUUID(),
    lastSync: 0,
    version: 1,
  };
}
