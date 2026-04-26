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
  | "linkedin" // LinkedIn (DOM capture)
  | "saved"; // Manually saved URLs (bookmarks)

/** User-facing display names for each platform. */
export const PLATFORM_LABELS: Record<Platform, string> = {
  x: "X",
  rss: "RSS",
  youtube: "YouTube",
  reddit: "Reddit",
  mastodon: "Mastodon",
  github: "GitHub",
  facebook: "Facebook",
  instagram: "Instagram",
  linkedin: "LinkedIn",
  saved: "Saved",
};

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

export type MapMode = "friends" | "all_content";
export type MapTimeMode = "current" | "future" | "past";
export type TimeRangeKind = "event" | "travel" | "overlap";

/**
 * Inferred intent signals used for feed filtering and ranking.
 * These are not exclusive categories. A feed item can carry several signals.
 */
export type ContentSignal =
  | "event"
  | "essay"
  | "moment"
  | "life_update"
  | "announcement"
  | "recommendation"
  | "request"
  | "discussion"
  | "promotion"
  | "news";

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
  url?: string;
  source: LocationSource;
}

/**
 * Optional time window for location-bearing planning items.
 * Historical capture can omit this and continue behaving like a "current"
 * last-seen signal, while planning-oriented sources can attach future or
 * bounded windows.
 */
export interface TimeRange {
  startsAt: number;
  endsAt?: number;
  kind: TimeRangeKind;
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
 * Facebook group metadata for captured group posts
 */
export interface FbGroupInfo {
  id: string;
  name: string;
  url: string;
}

/**
 * Preserved article content for reader view
 * Used by capture-save and optionally by capture-rss for full articles
 *
 * Architecture note: `html` is device-local ONLY and must never be stored in
 * Automerge. Large HTML blobs balloon the CRDT history by 3-10x the raw size.
 * Store full HTML in the device content cache (Tauri FS / PWA Cache API) and
 * keep only `text` (short summary) in the synced document.
 */
export interface PreservedContent {
  /**
   * Extracted article HTML -- device-local only.
   * Present when the item has been fetched and cached on this device.
   * Never write this to Automerge; use the content cache layer instead.
   */
  html?: string;

  /** Plain text summary -- safe to sync via Automerge (keep < 10 KB) */
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

export type ContentSignalMethod = "rules" | "ai" | "manual";

export interface ContentSignals {
  version: number;
  method: ContentSignalMethod;
  inferredAt: number;
  scores: Partial<Record<ContentSignal, number>>;
  tags: ContentSignal[];
}

export interface ContentSignalBackfillSummary {
  version: number;
  total: number;
  scanned: number;
  updated: number;
  remaining: number;
  counts: Record<ContentSignal, number>;
  multiSignalCount: number;
  untaggedCount: number;
  samples: Partial<Record<ContentSignal, string[]>>;
}

/**
 * AI provider and model preferences (synced -- no secrets here)
 */
export interface AIPreferences {
  /** AI provider selection */
  provider: "none" | "ollama" | "openai" | "anthropic" | "gemini";

  /** Model identifier (e.g. "qwen2.5:1.5b", "gpt-4o-mini", "claude-haiku-4-5") */
  model: string;

  /** Ollama base URL (default: "http://localhost:11434") */
  ollamaUrl?: string;

  /** Summarize articles as they are cached (may incur API costs with frontier providers) */
  autoSummarize: boolean;

  /** Extract topics from summaries to feed the ranking algorithm */
  extractTopics: boolean;
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

  /** When item was archived (Unix ms) — used for 30-day pruning */
  archivedAt?: number;

  /** User-assigned tags */
  tags: string[];

  /** User highlights/annotations */
  highlights?: Highlight[];

  // ── Social engagement (outbox pattern) ──────────────────────────────────

  /** User has liked this item */
  liked?: boolean;

  /** When user expressed like intent (any device, Unix ms) */
  likedAt?: number;

  /**
   * When the like was confirmed on the source platform (desktop only writes this).
   * -1 = permanently failed after retries; >0 = success timestamp.
   */
  likedSyncedAt?: number;

  /**
   * When the seen-impression was confirmed on the source platform (desktop only writes this).
   * -1 = permanently failed; >0 = success timestamp.
   */
  seenSyncedAt?: number;
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

  /** Optional time window for planning-aware location playback. */
  timeRange?: TimeRange;

  /** RSS-specific source info (optional) */
  rssSource?: RssSourceInfo;

  /** Facebook group source info (optional) */
  fbGroup?: FbGroupInfo;

  /** Preserved article content for reader view (optional) */
  preservedContent?: PreservedContent;

  /** User interaction state */
  userState: UserState;

  /** Extracted/inferred topics */
  topics: string[];

  /** Local or AI-inferred content intent signals */
  contentSignals?: ContentSignals;

  /** Pre-computed priority score (0-100), calculated by Desktop/OpenClaw */
  priority?: number;

  /** When priority was last calculated (Unix timestamp) */
  priorityComputedAt?: number;

  /** Original URL on the source platform (for linking + seen-sync via WebView) */
  sourceUrl?: string;
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

/**
 * Facebook capture preferences
 */
export interface FacebookCapturePreferences {
  /** Joined groups discovered from the groups directory */
  knownGroups: Record<string, FbGroupInfo>;

  /** Groups to hide from future captures */
  excludedGroupIds: Record<string, true>;
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
 * Visual theme identifiers shared across website, desktop, and PWA.
 */
export type ThemeId =
  | "neon"
  | "midas"
  | "ember"
  | "scriptorium";

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

  /**
   * Mark items as read when they scroll past in the feed list.
   * When false, items are only marked read when explicitly opened.
   */
  markReadOnScroll: boolean;

  /**
   * Desaturate read items in feed views.
   * When false, read items keep full color.
   */
  showReadInGrayscale: boolean;

  /** Two-column reader layout: compact card thumbnail on left, article on right */
  dualColumnMode: boolean;
}

export type SidebarMode = "expanded" | "compact" | "closed";
export type FeedSignalMode = "all" | "inspiring" | "events" | "personal" | "conversation" | "news";

export interface DisplayPreferences {
  /** Items per page */
  itemsPerPage: number;

  /** Compact mode */
  compactMode: boolean;

  /** Active visual theme */
  themeId: ThemeId;

  /** Show engagement counts (default: false - opt-in only) */
  showEngagementCounts: boolean;

  /** Reading enhancements */
  reading: ReadingEnhancements;

  /** Sidebar width in pixels (default: 256, min: 180, max: 480) */
  sidebarWidth?: number;

  /** Desktop sidebar mode (default: expanded) */
  sidebarMode?: SidebarMode;

  /** Friends workspace sidebar width in pixels (default: 360, min: 280, max: 520) */
  friendsSidebarWidth?: number;

  /** Friends workspace detail rail visibility (default: true) */
  friendsSidebarOpen?: boolean;

  /** Saved Friends workspace display mode. Unset defaults to all content. */
  friendsMode?: MapMode;

  /** @deprecated Friend avatar tint is now derived from the active theme. */
  friendAvatarTint?: string;

  /** Debug panel width in pixels (default: 320, min: 280, max: 600) */
  debugPanelWidth?: number;

  /** Saved map display mode. Unset means compute a default from available data. */
  mapMode?: MapMode;

  /** Saved map time filter. Unset means default to the current view. */
  mapTimeMode?: MapTimeMode;

  /** Saved unified feed signal filter mode. Unset means show all items. */
  feedSignalMode?: FeedSignalMode;

  /** Saved unified feed signal filter modes. Empty means show all items. */
  feedSignalModes?: FeedSignalMode[];

  /** Days to keep archived items before pruning (default: 30, 0 = never prune) */
  archivePruneDays: number;
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
  fbCapture: FacebookCapturePreferences;
  /** AI summarization + topic extraction preferences (no API keys here) */
  ai: AIPreferences;
}

// =============================================================================
// Identity Graph
// =============================================================================

export type RelationshipStatus = "connection" | "friend";

export type AccountKind = "social" | "contact";

export type ContactAccountProvider =
  | "google_contacts"
  | "manual_contact"
  | "macos_contacts"
  | "ios_contacts"
  | "android_contacts"
  | "web_contact";

export type AccountProvider = Platform | ContactAccountProvider;

export type AccountDiscoveredFrom =
  | "captured_item"
  | "story_author"
  | "contact_import"
  | "manual_entry"
  | "follow_roster";

/**
 * Legacy social-profile shape preserved only for migration from the old
 * Friend document model.
 */
export interface LegacyFriendSource {
  platform: Platform;
  authorId: string;
  handle?: string;
  displayName?: string;
  avatarUrl?: string;
  profileUrl?: string;
}

/**
 * Legacy contact shape preserved only for migration from the old Friend
 * document model.
 */
export interface LegacyDeviceContact {
  importedFrom: "macos" | "ios" | "android" | "web" | "google";
  name: string;
  phone?: string;
  email?: string;
  address?: string;
  nativeId?: string;
  importedAt: number;
}

/**
 * A single reach-out event logged by the user.
 */
export interface ReachOutLog {
  loggedAt: number;
  channel?: "phone" | "text" | "email" | "in_person" | "other";
  notes?: string;
}

/**
 * Canonical same-human identity. Accounts carry channel-specific data.
 */
export interface Person {
  id: string;
  name: string;
  avatarUrl?: string;
  bio?: string;
  relationshipStatus: RelationshipStatus;
  /**
   * Relationship priority: 5 = closest (nudge weekly), 1 = acquaintance (never nudged).
   * Drives effectiveInterval() in the identity helpers.
   */
  careLevel: 1 | 2 | 3 | 4 | 5;
  reachOutIntervalDays?: number;
  /** Most recent reach-out entries first; capped at 20 */
  reachOutLog?: ReachOutLog[];
  tags?: string[];
  notes?: string;
  graphX?: number;
  graphY?: number;
  graphPinned?: boolean;
  graphUpdatedAt?: number;
  createdAt: number;
  updatedAt: number;
}

/**
 * Every attached node in the identity graph: social profile or contact record.
 * When personId is absent, the account is still an orphan connection.
 */
export interface Account {
  id: string;
  personId?: string;
  kind: AccountKind;
  provider: AccountProvider;
  externalId: string;
  handle?: string;
  displayName?: string;
  avatarUrl?: string;
  profileUrl?: string;
  email?: string;
  phone?: string;
  address?: string;
  importedAt?: number;
  firstSeenAt: number;
  lastSeenAt: number;
  discoveredFrom: AccountDiscoveredFrom;
  graphX?: number;
  graphY?: number;
  graphPinned?: boolean;
  graphUpdatedAt?: number;
  createdAt: number;
  updatedAt: number;
}

/** @deprecated Use Person plus Account queries. */
export type Friend = Person & {
  sources: LegacyFriendSource[];
  contact?: LegacyDeviceContact;
};

/** @deprecated Use Account. */
export type FriendSource = LegacyFriendSource;

/** @deprecated Use contact Accounts instead. */
export type DeviceContact = LegacyDeviceContact;

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
      themeId: "scriptorium",
      showEngagementCounts: false, // Hidden by default
      reading: {
        focusMode: false,
        focusIntensity: "normal",
        markReadOnScroll: true,
        showReadInGrayscale: true,
        dualColumnMode: true,
      },
      friendsSidebarOpen: true,
      friendsMode: "all_content",
      mapTimeMode: "current",
      feedSignalMode: "all",
      feedSignalModes: [],
      archivePruneDays: 30,
    },
    xCapture: {
      mode: "mirror", // Default: capture from everyone you follow
      whitelist: {},
      blacklist: {},
      includeRetweets: true,
      includeReplies: false,
    },
    fbCapture: {
      knownGroups: {},
      excludedGroupIds: {},
    },
    ai: {
      provider: "none",
      model: "",
      autoSummarize: false,
      extractTopics: false,
    },
  };
}

// =============================================================================
// Google Contacts
// =============================================================================

/**
 * A contact record from the Google People API.
 */
export interface GoogleContact {
  resourceName: string;
  etag?: string;
  name: {
    displayName?: string;
    givenName?: string;
    familyName?: string;
    middleName?: string;
  };
  emails: Array<{ value: string; type?: string }>;
  phones: Array<{ value: string; type?: string }>;
  photos: Array<{ url: string; default?: boolean }>;
  organizations: Array<{ name?: string; title?: string }>;
  metadata?: { deleted?: boolean };
}

/**
 * A pairing of a Google contact with a matched Person or unlinked author.
 */
export interface ContactMatch {
  contact: GoogleContact;
  person?: Person | null;
  /** @deprecated Use person. */
  friend?: Friend | null;
  authorIds: string[];
  confidence: "high" | "medium";
}

export interface IdentitySuggestion {
  id: string;
  kind: "merge_accounts" | "attach_accounts_to_person";
  confidence: "high" | "medium";
  accountIds: string[];
  personId?: string;
  label: string;
  reason?: string;
  createdAt: number;
}

/**
 * Persisted state for the Google Contacts sync cycle.
 */
export interface ContactSyncState {
  authStatus: "connected" | "reconnect_required";
  syncStatus: "idle" | "syncing" | "error";
  syncToken: string | null;
  lastSyncedAt: number | null;
  lastErrorCode?: "missing_token" | "auth" | "network" | "unknown";
  lastErrorMessage?: string;
  cachedContacts: GoogleContact[];
  pendingSuggestions: IdentitySuggestion[];
  dismissedSuggestionIds: string[];
  createdFriendCount: number;
  /** @deprecated Use pendingSuggestions. */
  pendingMatches?: IdentitySuggestion[];
  /** @deprecated Use dismissedSuggestionIds. */
  dismissedMatches?: string[];
  /** @deprecated Suggestion auto-linking was removed. */
  autoLinkedCount?: number;
  /** @deprecated Use createdFriendCount. */
  autoCreatedCount?: number;
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
