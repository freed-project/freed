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
  | "youtube" // YouTube authenticated capture, with optional manual RSS intake
  | "reddit" // Reddit (via RSS)
  | "mastodon" // Mastodon (via RSS)
  | "github" // GitHub (via Atom)
  | "facebook" // Facebook (DOM capture)
  | "instagram" // Instagram (DOM capture)
  | "linkedin" // LinkedIn (DOM capture)
  | "substack" // Substack (authenticated WebView + RSS)
  | "medium" // Medium (authenticated WebView + RSS)
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
  substack: "Substack",
  medium: "Medium",
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
  | "deadline"
  | "opportunity"
  | "how_to"
  | "reference"
  | "transaction"
  | "product_update"
  | "alert"
  | "deal"
  | "place"
  | "media"
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
 * Full HTML lives in the device content cache or content vault. Synchronized
 * Library records retain bounded text and metadata only.
 */
export interface PreservedContent {
  /** Bounded plain-text summary. */
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

export interface EventCandidate {
  version: number;
  method: ContentSignalMethod;
  detectedAt: number;
  confidence: number;
  title?: string;
  startsAt?: number;
  endsAt?: number;
  timezone?: string;
  locationName?: string;
  locationUrl?: string;
  evidence?: string;
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

/** Synchronized AI content-processing intent. */
export interface AIPreferences {
  /** Summarize articles as they are cached (may incur API costs with frontier providers) */
  autoSummarize: boolean;

  /** Extract topics from summaries to feed the ranking algorithm */
  extractTopics: boolean;
}

export type StoryWallLayoutPreset = "mosaic" | "timeline" | "magazine" | "map_year" | "filmstrip";
export type StoryWallPublishProvider = "none" | "github_pages";
export type StoryWallVisibilityDefault = "private_review" | "public";
export type StoryWallMotionLevel = "none" | "light" | "full";

export interface StoryWallStylePreferences {
  palette: string;
  typographyScale: number;
  mediaDensity: number;
  captionsEnabled: boolean;
  locationGroupingEnabled: boolean;
  dateGroupingEnabled: boolean;
  motionLevel: StoryWallMotionLevel;
}

export interface StoryWallPublishTarget {
  provider: StoryWallPublishProvider;
  repoName: string;
  branch: string;
  directory: string;
  pagesUrl?: string;
  lastPublishedAt?: number;
}

export interface StoryWallPreferences {
  enabled: boolean;
  selectedYears: number[];
  includedPlatforms: Platform[];
  includedAccountIds: string[];
  visibilityDefault: StoryWallVisibilityDefault;
  layoutPreset: StoryWallLayoutPreset;
  style: StoryWallStylePreferences;
  embedModeEnabled: boolean;
  publishTarget: StoryWallPublishTarget;
  featuredItemIds: string[];
  hiddenItemIds: string[];
  lastReviewedAt?: number;
}

export type FriendCandidateSuggestionKind = "connection_person" | "unlinked_account";

export type FriendCandidateConfidence = "high" | "medium";

export type FriendCandidateReasonCode =
  | "personal_updates"
  | "life_events"
  | "direct_requests"
  | "places_and_moments"
  | "multi_channel_identity"
  | "recent_activity"
  | "contact_overlap";

export interface FriendCandidateReason {
  code: FriendCandidateReasonCode;
  label: string;
  score: number;
}

export interface FriendCandidateSuggestion {
  id: string;
  kind: FriendCandidateSuggestionKind;
  personId?: string;
  accountIds: string[];
  displayName: string;
  score: number;
  confidence: FriendCandidateConfidence;
  reasons: FriendCandidateReason[];
  signalCounts: Partial<Record<ContentSignal, number>>;
  lastActivityAt?: number;
  sampleItemIds: string[];
}

export interface FriendSuggestionPreferences {
  dismissedSuggestionIds: string[];
}

export type LocalAIModelId =
  | "integrated-light"
  | "integrated-balanced"
  | "integrated-pro";

export type LocalAIPackTier = "light" | "balanced" | "pro";

export type LocalAIModelStatus =
  | "not_downloaded"
  | "downloading"
  | "paused"
  | "available"
  | "error"
  | "unsupported";

export interface LocalAIModelFileManifest {
  path: string;
  sourcePath?: string;
  sizeBytes: number;
  sha256?: string;
  sha1?: string;
  etag?: string;
  repo?: string;
  revision?: string;
}

export interface LocalAIModelManifestEntry {
  id: LocalAIModelId;
  tier: LocalAIPackTier;
  title: string;
  capability: string;
  description: string;
  repo: string;
  revision: string;
  sourceUrl: string;
  estimatedDownloadBytes: number;
  estimatedStorageBytes: number;
  hardwareNote: string;
  requiresWebGPU: boolean;
  wasmFallback: boolean;
  supportsSemanticSearch: boolean;
  supportsSummaries: boolean;
  supportsAssistant: boolean;
  files: LocalAIModelFileManifest[];
}

export interface LocalAIHardwareProfile {
  totalMemoryBytes?: number;
  availableMemoryBytes?: number;
  availableAppDataBytes?: number;
  os: string;
  arch: string;
  webGPUAvailable: boolean;
}

export interface LocalAIModelHealth {
  lastIndexedItemCount?: number;
  lastRunAt?: number;
  failureCount?: number;
}

export interface LocalAIModelInstallState {
  id: LocalAIModelId;
  status: LocalAIModelStatus;
  revision: string;
  downloadedBytes: number;
  totalBytes: number;
  storageBytes: number;
  installedAt?: number;
  updatedAt: number;
  lastError?: string;
  health?: LocalAIModelHealth;
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
 * Internal provenance marker for generated sample data.
 * Deletion tools must use this marker instead of ids, URLs, or copy patterns.
 */
export interface SampleDataFingerprint {
  marker: "freed.sample-data.v1";
  batchId: string;
  generatedAt: number;
  generatorVersion: number;
}

export interface SampleDataClearSummary {
  feeds: number;
  items: number;
  persons: number;
  accounts: number;
  total: number;
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

  /** Compact local or AI-inferred event metadata. */
  eventCandidate?: EventCandidate;

  /** Pre-computed priority score (0-100), calculated by Desktop/OpenClaw */
  priority?: number;

  /** When priority was last calculated (Unix timestamp) */
  priorityComputedAt?: number;

  /** Original URL on the source platform (for linking + seen-sync via WebView) */
  sourceUrl?: string;

  /** Internal marker for generated sample data. */
  sampleDataFingerprint?: SampleDataFingerprint;
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

  /** Internal marker for generated sample data. */
  sampleDataFingerprint?: SampleDataFingerprint;
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
 * Reading enhancement intensity
 */
export type ReadingIntensity = "light" | "normal" | "strong";

/**
 * Global interface animation intensity
 */
export type AnimationIntensity = "none" | "light" | "detailed";

/**
 * Visual theme identifiers shared across website, desktop, and PWA.
 */
export type ThemeId =
  | "neon"
  | "midas"
  | "ember"
  | "scriptorium"
  | "starship"
  | "dark-star";

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

}

export type SidebarMode = "expanded" | "compact" | "closed";
export type FeedSignalMode = "all" | "inspiring" | "events" | "personal" | "conversation" | "news";
export type SavedContentSortMode = "date_saved" | "date_published" | "recommended" | "shortest_read";

export interface DisplayPreferences {
  /** Show engagement counts (default: false - opt-in only) */
  showEngagementCounts: boolean;

  /** Global interface animation intensity (default: detailed) */
  animationIntensity: AnimationIntensity;

  /** Reading enhancements */
  reading: ReadingEnhancements;

  /** Days to keep archived items before pruning (default: 30, 0 = never prune) */
  archivePruneDays: number;
}

/**
 * Complete user preferences
 */
export interface UserPreferences {
  weights: WeightPreferences;
  ulysses: UlyssesPreferences;
  display: DisplayPreferences;
  xCapture: XCapturePreferences;
  fbCapture: FacebookCapturePreferences;
  /** Review-only friend candidate preferences. Suggestions never auto-promote. */
  friendSuggestions: FriendSuggestionPreferences;
  /** AI summarization + topic extraction preferences (no API keys here) */
  ai: AIPreferences;
  /** Owner-controlled public memory wall preferences. Media files stay device-local until publish. */
  storyWall: StoryWallPreferences;
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

export type FollowRosterRole = "follower" | "following" | "subscription";

/** Social-profile projection attached to a bounded Friend view model. */
export interface FriendSource {
  platform: Platform;
  authorId: string;
  handle?: string;
  displayName?: string;
  avatarUrl?: string;
  profileUrl?: string;
}

/** Contact projection attached to a bounded Friend view model. */
export interface DeviceContact {
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
   * Drives the bounded Friends outreach interval policy.
   */
  careLevel: 1 | 2 | 3 | 4 | 5;
  reachOutIntervalDays?: number;
  /** Most recent reach-out entries first; capped at 20 */
  reachOutLog?: ReachOutLog[];
  tags?: string[];
  notes?: string;
  /** Internal marker for generated sample data. */
  sampleDataFingerprint?: SampleDataFingerprint;
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
  /** Whether this account has been observed in a provider follow roster capture. */
  followRosterActive?: boolean;
  /** Last complete or partial provider roster capture that observed this account. */
  followRosterSyncedAt?: number;
  /** Provider relationship directions observed across partial roster captures. */
  followRosterRoles?: FollowRosterRole[];
  /** Internal marker for generated sample data. */
  sampleDataFingerprint?: SampleDataFingerprint;
  createdAt: number;
  updatedAt: number;
}

/** Bounded selected-Friend view model assembled from Person and Account rows. */
export type Friend = Person & {
  sources: FriendSource[];
  contact?: DeviceContact;
};

// =============================================================================
// Library client registration
// =============================================================================

/**
 * One Freed Desktop installation registered with a synchronized Library.
 *
 * This is intentionally durable coordination metadata, not online presence.
 * Runtime heartbeats, connection status, and provider scheduling remain local.
 */
export interface DesktopClientRegistration {
  /** Stable, device-local installation identifier. */
  id: string;

  /** First time this installation registered with the library. */
  registeredAt: number;
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
    display: {
      showEngagementCounts: false, // Hidden by default
      animationIntensity: "detailed",
      reading: {
        focusMode: false,
        focusIntensity: "normal",
        markReadOnScroll: true,
        showReadInGrayscale: true,
      },
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
      excludedGroupIds: {},
    },
    friendSuggestions: {
      dismissedSuggestionIds: [],
    },
    ai: {
      autoSummarize: false,
      extractTopics: false,
    },
    storyWall: {
      enabled: false,
      selectedYears: [],
      includedPlatforms: ["instagram", "facebook", "x", "rss", "saved"],
      includedAccountIds: [],
      visibilityDefault: "private_review",
      layoutPreset: "mosaic",
      style: {
        palette: "paper",
        typographyScale: 1,
        mediaDensity: 0.7,
        captionsEnabled: true,
        locationGroupingEnabled: true,
        dateGroupingEnabled: true,
        motionLevel: "light",
      },
      embedModeEnabled: true,
      publishTarget: {
        provider: "github_pages",
        repoName: "freed-story-wall",
        branch: "main",
        directory: "docs",
      },
      featuredItemIds: [],
      hiddenItemIds: [],
    },
  };
}

/**
 * Merge persisted preferences with current defaults.
 */
export function mergeDefaultPreferences(
  preferences?: Partial<UserPreferences> | null,
): UserPreferences {
  const defaults = createDefaultPreferences();
  if (!preferences) {
    return defaults;
  }

  const display = preferences.display as Partial<DisplayPreferences> | undefined;
  const reading = display?.reading as Partial<ReadingEnhancements> | undefined;
  const weights = preferences.weights as Partial<WeightPreferences> | undefined;
  const ulysses = preferences.ulysses as Partial<UlyssesPreferences> | undefined;
  const xCapture = preferences.xCapture as Partial<XCapturePreferences> | undefined;
  const fbCapture = preferences.fbCapture as Partial<FacebookCapturePreferences> | undefined;
  const friendSuggestions = preferences.friendSuggestions as Partial<FriendSuggestionPreferences> | undefined;
  const ai = preferences.ai as Partial<AIPreferences> | undefined;
  const storyWall = preferences.storyWall as Partial<StoryWallPreferences> | undefined;
  const storyWallStyle = storyWall?.style as Partial<StoryWallStylePreferences> | undefined;
  const storyWallPublishTarget = storyWall?.publishTarget as Partial<StoryWallPublishTarget> | undefined;

  return {
    ...defaults,
    ...preferences,
    weights: {
      ...defaults.weights,
      ...weights,
      platforms: {
        ...defaults.weights.platforms,
        ...(weights?.platforms ?? {}),
      },
      topics: {
        ...defaults.weights.topics,
        ...(weights?.topics ?? {}),
      },
      authors: {
        ...defaults.weights.authors,
        ...(weights?.authors ?? {}),
      },
    },
    ulysses: {
      ...defaults.ulysses,
      ...ulysses,
      allowedPaths: {
        ...defaults.ulysses.allowedPaths,
        ...(ulysses?.allowedPaths ?? {}),
      },
    },
    display: {
      ...defaults.display,
      ...display,
      reading: {
        ...defaults.display.reading,
        ...reading,
      },
    },
    xCapture: {
      ...defaults.xCapture,
      ...xCapture,
      whitelist: {
        ...defaults.xCapture.whitelist,
        ...(xCapture?.whitelist ?? {}),
      },
      blacklist: {
        ...defaults.xCapture.blacklist,
        ...(xCapture?.blacklist ?? {}),
      },
    },
    fbCapture: {
      ...defaults.fbCapture,
      ...fbCapture,
      excludedGroupIds: {
        ...defaults.fbCapture.excludedGroupIds,
        ...(fbCapture?.excludedGroupIds ?? {}),
      },
    },
    friendSuggestions: {
      ...defaults.friendSuggestions,
      ...friendSuggestions,
      dismissedSuggestionIds: [
        ...(friendSuggestions?.dismissedSuggestionIds ?? defaults.friendSuggestions.dismissedSuggestionIds),
      ],
    },
    ai: {
      ...defaults.ai,
      ...ai,
    },
    storyWall: {
      ...defaults.storyWall,
      ...storyWall,
      selectedYears: [
        ...(storyWall?.selectedYears ?? defaults.storyWall.selectedYears),
      ],
      includedPlatforms: [
        ...(storyWall?.includedPlatforms ?? defaults.storyWall.includedPlatforms),
      ],
      includedAccountIds: [
        ...(storyWall?.includedAccountIds ?? defaults.storyWall.includedAccountIds),
      ],
      style: {
        ...defaults.storyWall.style,
        ...storyWallStyle,
      },
      publishTarget: {
        ...defaults.storyWall.publishTarget,
        ...storyWallPublishTarget,
      },
      featuredItemIds: [
        ...(storyWall?.featuredItemIds ?? defaults.storyWall.featuredItemIds),
      ],
      hiddenItemIds: [
        ...(storyWall?.hiddenItemIds ?? defaults.storyWall.hiddenItemIds),
      ],
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
  personId: string | null;
  accountIds: string[];
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
