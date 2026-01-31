/**
 * @freed/shared - Core type definitions for FREED
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
  | 'x'           // X/Twitter
  | 'rss'         // Generic RSS/Atom
  | 'youtube'     // YouTube (via RSS)
  | 'reddit'      // Reddit (via RSS)
  | 'mastodon'    // Mastodon (via RSS)
  | 'github'      // GitHub (via Atom)
  | 'facebook'    // Facebook (DOM capture)
  | 'instagram'   // Instagram (DOM capture)
  | 'linkedin'    // LinkedIn (DOM capture, future)

/**
 * Content type classification
 */
export type ContentType = 'post' | 'story' | 'article' | 'video' | 'podcast'

/**
 * Media type classification
 */
export type MediaType = 'image' | 'video' | 'link'

/**
 * Location source type
 */
export type LocationSource = 'geo_tag' | 'check_in' | 'sticker' | 'text_extraction'

// =============================================================================
// Feed Item
// =============================================================================

/**
 * Author information
 */
export interface Author {
  id: string
  handle: string
  displayName: string
  avatarUrl?: string
}

/**
 * Content structure
 */
export interface Content {
  text?: string
  mediaUrls: string[]
  mediaTypes: MediaType[]
  linkPreview?: LinkPreview
}

/**
 * Link preview information
 */
export interface LinkPreview {
  url: string
  title?: string
  description?: string
}

/**
 * Engagement metrics (captured for user-controlled ranking, hidden by default in UI)
 */
export interface Engagement {
  likes?: number
  reposts?: number
  comments?: number
  views?: number
}

/**
 * Location information
 */
export interface Location {
  name: string
  coordinates?: { lat: number; lng: number }
  source: LocationSource
}

/**
 * RSS-specific source information
 */
export interface RssSourceInfo {
  feedUrl: string
  feedTitle: string
  siteUrl: string
}

/**
 * User interaction state
 */
export interface UserState {
  hidden: boolean
  bookmarked: boolean
  readAt?: number
}

/**
 * Core feed item - represents any captured content
 */
export interface FeedItem {
  /** Unique identifier: "platform:id" (e.g., "x:123" or "rss:https://...") */
  globalId: string
  
  /** Source platform */
  platform: Platform
  
  /** Content type classification */
  contentType: ContentType
  
  /** When FREED captured this item (Unix timestamp) */
  capturedAt: number
  
  /** Original publish timestamp (Unix timestamp) */
  publishedAt: number
  
  /** Author information */
  author: Author
  
  /** Content data */
  content: Content
  
  /** Engagement metrics (optional, for user-controlled ranking) */
  engagement?: Engagement
  
  /** Location information (optional) */
  location?: Location
  
  /** RSS-specific source info (optional) */
  rssSource?: RssSourceInfo
  
  /** User interaction state */
  userState: UserState
  
  /** Extracted/inferred topics */
  topics: string[]
}

// =============================================================================
// RSS Feed
// =============================================================================

/**
 * RSS feed subscription
 */
export interface RssFeed {
  /** Feed URL */
  url: string
  
  /** Feed title */
  title: string
  
  /** Website URL */
  siteUrl?: string
  
  /** Last successful fetch timestamp */
  lastFetched?: number
  
  /** ETag for conditional GET */
  etag?: string
  
  /** Last-Modified header for conditional GET */
  lastModified?: string
  
  /** Feed image URL */
  imageUrl?: string
  
  /** Whether this feed is enabled */
  enabled: boolean
  
  /** Custom poll interval in minutes (overrides default) */
  pollInterval?: number
}

// =============================================================================
// User Preferences
// =============================================================================

/**
 * Feed weighting preferences
 */
export interface WeightPreferences {
  /** Recency weight (0-100): How much to prioritize new content */
  recency: number
  
  /** Platform weights: Platform -> weight multiplier */
  platforms: Record<string, number>
  
  /** Topic weights: Topic -> weight multiplier */
  topics: Record<string, number>
  
  /** Author weights: Author ID -> weight multiplier */
  authors: Record<string, number>
}

/**
 * Ulysses mode preferences (feed blocking)
 */
export interface UlyssesPreferences {
  /** Whether Ulysses mode is enabled */
  enabled: boolean
  
  /** Platforms to block feeds on */
  blockedPlatforms: string[]
  
  /** Allowed paths per platform (e.g., /messages, /notifications) */
  allowedPaths: Record<string, string[]>
}

/**
 * Sync preferences
 */
export interface SyncPreferences {
  /** Cloud backup provider */
  cloudProvider?: 'gdrive' | 'icloud' | 'dropbox'
  
  /** Whether auto-backup is enabled */
  autoBackup: boolean
  
  /** Backup frequency */
  backupFrequency?: 'hourly' | 'daily' | 'manual'
}

/**
 * Display preferences
 */
export interface DisplayPreferences {
  /** Items per page */
  itemsPerPage: number
  
  /** Compact mode */
  compactMode: boolean
  
  /** Show engagement counts (default: false - opt-in only) */
  showEngagementCounts: boolean
}

/**
 * Complete user preferences
 */
export interface UserPreferences {
  weights: WeightPreferences
  ulysses: UlyssesPreferences
  sync: SyncPreferences
  display: DisplayPreferences
}

// =============================================================================
// Document Metadata
// =============================================================================

/**
 * Document metadata
 */
export interface DocumentMeta {
  /** Unique device identifier */
  deviceId: string
  
  /** Last sync timestamp */
  lastSync: number
  
  /** Document version for migrations */
  version: number
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
      authors: {}
    },
    ulysses: {
      enabled: false,
      blockedPlatforms: [],
      allowedPaths: {
        x: ['/messages', '/notifications', '/compose', '/settings', '/i/'],
        facebook: ['/messages', '/notifications', '/settings', '/marketplace'],
        instagram: ['/direct', '/accounts', '/explore/tags']
      }
    },
    sync: {
      autoBackup: false
    },
    display: {
      itemsPerPage: 20,
      compactMode: false,
      showEngagementCounts: false // Hidden by default
    }
  }
}

/**
 * Create default document metadata
 */
export function createDefaultMeta(): DocumentMeta {
  return {
    deviceId: crypto.randomUUID(),
    lastSync: 0,
    version: 1
  }
}
