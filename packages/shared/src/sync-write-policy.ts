import type {
  Account,
  AIPreferences,
  Author,
  Content,
  ContentSignal,
  ContentSignals,
  DesktopClientRegistration,
  DisplayPreferences,
  DocumentMeta,
  Engagement,
  EventCandidate,
  FacebookCapturePreferences,
  FbGroupInfo,
  FeedItem,
  FriendSuggestionPreferences,
  Highlight,
  LinkPreview,
  Location,
  Person,
  PreservedContent,
  ReachOutLog,
  ReadingEnhancements,
  RssFeed,
  RssSourceInfo,
  SampleDataFingerprint,
  StoryWallPreferences,
  StoryWallPublishTarget,
  StoryWallStylePreferences,
  SyncPreferences,
  TimeRange,
  UlyssesPreferences,
  UserPreferences,
  UserState,
  WeightPreferences,
  XAccount,
  XCapturePreferences,
} from "./types.js";

/**
 * Every field on a synchronized schema type must have an explicit write
 * disposition. The mapped type makes schema additions fail typecheck until
 * their ownership is classified.
 */
export type SyncWriteDisposition =
  | "sync"
  | "positive-sync"
  | "device-local"
  | "compatibility-only"
  | "nested";

export type ExhaustiveSyncWritePolicy<T extends object> = {
  readonly [K in keyof T]-?: SyncWriteDisposition;
};

export const WEIGHT_PREFERENCES_WRITE_POLICY = {
  recency: "sync",
  platforms: "nested",
  topics: "nested",
  authors: "nested",
} as const satisfies ExhaustiveSyncWritePolicy<WeightPreferences>;

export const ULYSSES_PREFERENCES_WRITE_POLICY = {
  enabled: "sync",
  blockedPlatforms: "nested",
  allowedPaths: "nested",
} as const satisfies ExhaustiveSyncWritePolicy<UlyssesPreferences>;

export const SYNC_PREFERENCES_WRITE_POLICY = {
  cloudProvider: "compatibility-only",
  autoBackup: "compatibility-only",
  backupFrequency: "compatibility-only",
} as const satisfies ExhaustiveSyncWritePolicy<SyncPreferences>;

export const READING_ENHANCEMENTS_WRITE_POLICY = {
  focusMode: "sync",
  focusIntensity: "sync",
  markReadOnScroll: "sync",
  showReadInGrayscale: "sync",
  dualColumnMode: "device-local",
} as const satisfies ExhaustiveSyncWritePolicy<ReadingEnhancements>;

export const DISPLAY_PREFERENCES_WRITE_POLICY = {
  itemsPerPage: "compatibility-only",
  compactMode: "compatibility-only",
  themeId: "sync",
  showEngagementCounts: "sync",
  animationIntensity: "sync",
  reading: "nested",
  sidebarWidth: "device-local",
  sidebarMode: "device-local",
  friendsSidebarWidth: "device-local",
  friendsSidebarOpen: "device-local",
  friendsMode: "device-local",
  friendAvatarTint: "compatibility-only",
  debugPanelWidth: "device-local",
  mapMode: "device-local",
  mapTimeMode: "device-local",
  feedSignalMode: "device-local",
  feedSignalModes: "device-local",
  savedContentSortMode: "device-local",
  archivePruneDays: "sync",
} as const satisfies ExhaustiveSyncWritePolicy<DisplayPreferences>;

export const X_ACCOUNT_WRITE_POLICY = {
  id: "sync",
  handle: "sync",
  displayName: "sync",
  avatarUrl: "sync",
  addedAt: "sync",
  note: "sync",
} as const satisfies ExhaustiveSyncWritePolicy<XAccount>;

export const X_CAPTURE_PREFERENCES_WRITE_POLICY = {
  mode: "sync",
  whitelist: "nested",
  blacklist: "nested",
  includeRetweets: "sync",
  includeReplies: "sync",
} as const satisfies ExhaustiveSyncWritePolicy<XCapturePreferences>;

export const FB_GROUP_INFO_WRITE_POLICY = {
  id: "sync",
  name: "sync",
  url: "sync",
} as const satisfies ExhaustiveSyncWritePolicy<FbGroupInfo>;

export const FACEBOOK_CAPTURE_PREFERENCES_WRITE_POLICY = {
  knownGroups: "device-local",
  excludedGroupIds: "nested",
} as const satisfies ExhaustiveSyncWritePolicy<FacebookCapturePreferences>;

export const FRIEND_SUGGESTION_PREFERENCES_WRITE_POLICY = {
  dismissedSuggestionIds: "nested",
} as const satisfies ExhaustiveSyncWritePolicy<FriendSuggestionPreferences>;

export const AI_PREFERENCES_WRITE_POLICY = {
  provider: "device-local",
  model: "device-local",
  ollamaUrl: "device-local",
  autoSummarize: "sync",
  extractTopics: "sync",
} as const satisfies ExhaustiveSyncWritePolicy<AIPreferences>;

export const STORY_WALL_STYLE_WRITE_POLICY = {
  palette: "sync",
  typographyScale: "sync",
  mediaDensity: "sync",
  captionsEnabled: "sync",
  locationGroupingEnabled: "sync",
  dateGroupingEnabled: "sync",
  motionLevel: "sync",
} as const satisfies ExhaustiveSyncWritePolicy<StoryWallStylePreferences>;

export const STORY_WALL_PUBLISH_TARGET_WRITE_POLICY = {
  provider: "sync",
  repoName: "sync",
  branch: "sync",
  directory: "sync",
  pagesUrl: "sync",
  lastPublishedAt: "sync",
  lastError: "device-local",
  status: "device-local",
} as const satisfies ExhaustiveSyncWritePolicy<StoryWallPublishTarget>;

export const STORY_WALL_PREFERENCES_WRITE_POLICY = {
  enabled: "sync",
  selectedYears: "nested",
  includedPlatforms: "nested",
  includedAccountIds: "nested",
  visibilityDefault: "sync",
  layoutPreset: "sync",
  style: "nested",
  embedModeEnabled: "sync",
  publishTarget: "nested",
  featuredItemIds: "nested",
  hiddenItemIds: "nested",
  lastReviewedAt: "sync",
} as const satisfies ExhaustiveSyncWritePolicy<StoryWallPreferences>;

export const USER_PREFERENCES_WRITE_POLICY = {
  weights: "nested",
  ulysses: "nested",
  sync: "compatibility-only",
  display: "nested",
  xCapture: "nested",
  fbCapture: "nested",
  friendSuggestions: "nested",
  ai: "nested",
  storyWall: "nested",
} as const satisfies ExhaustiveSyncWritePolicy<UserPreferences>;

export const REACH_OUT_LOG_WRITE_POLICY = {
  loggedAt: "sync",
  channel: "sync",
  notes: "sync",
} as const satisfies ExhaustiveSyncWritePolicy<ReachOutLog>;

export const SAMPLE_DATA_FINGERPRINT_WRITE_POLICY = {
  marker: "sync",
  batchId: "sync",
  generatedAt: "sync",
  generatorVersion: "sync",
} as const satisfies ExhaustiveSyncWritePolicy<SampleDataFingerprint>;

export const PERSON_WRITE_POLICY = {
  id: "sync",
  name: "sync",
  avatarUrl: "sync",
  bio: "sync",
  relationshipStatus: "sync",
  careLevel: "sync",
  reachOutIntervalDays: "sync",
  reachOutLog: "nested",
  tags: "nested",
  notes: "sync",
  graphX: "device-local",
  graphY: "device-local",
  graphPinned: "device-local",
  graphUpdatedAt: "device-local",
  sampleDataFingerprint: "nested",
  createdAt: "sync",
  updatedAt: "sync",
} as const satisfies ExhaustiveSyncWritePolicy<Person>;

export const ACCOUNT_WRITE_POLICY = {
  id: "sync",
  personId: "sync",
  kind: "sync",
  provider: "sync",
  externalId: "sync",
  handle: "sync",
  displayName: "sync",
  avatarUrl: "sync",
  profileUrl: "sync",
  email: "sync",
  phone: "sync",
  address: "sync",
  importedAt: "sync",
  firstSeenAt: "sync",
  lastSeenAt: "sync",
  discoveredFrom: "sync",
  followRosterActive: "sync",
  followRosterSyncedAt: "sync",
  graphX: "device-local",
  graphY: "device-local",
  graphPinned: "device-local",
  graphUpdatedAt: "device-local",
  sampleDataFingerprint: "nested",
  createdAt: "sync",
  updatedAt: "sync",
} as const satisfies ExhaustiveSyncWritePolicy<Account>;

export const RSS_FEED_WRITE_POLICY = {
  url: "sync",
  title: "sync",
  siteUrl: "sync",
  lastFetched: "sync",
  lastFetchAttemptedAt: "device-local",
  nextFetchAfter: "device-local",
  consecutiveFailures: "device-local",
  lastFetchError: "device-local",
  etag: "compatibility-only",
  lastModified: "compatibility-only",
  imageUrl: "sync",
  enabled: "sync",
  pollInterval: "sync",
  trackUnread: "sync",
  folder: "sync",
  sampleDataFingerprint: "nested",
} as const satisfies ExhaustiveSyncWritePolicy<RssFeed>;

export const AUTHOR_WRITE_POLICY = {
  id: "sync",
  handle: "sync",
  displayName: "sync",
  avatarUrl: "sync",
} as const satisfies ExhaustiveSyncWritePolicy<Author>;

export const LINK_PREVIEW_WRITE_POLICY = {
  url: "sync",
  title: "sync",
  description: "sync",
} as const satisfies ExhaustiveSyncWritePolicy<LinkPreview>;

export const CONTENT_WRITE_POLICY = {
  text: "sync",
  mediaUrls: "nested",
  mediaTypes: "nested",
  linkPreview: "nested",
} as const satisfies ExhaustiveSyncWritePolicy<Content>;

export const ENGAGEMENT_WRITE_POLICY = {
  likes: "sync",
  reposts: "sync",
  comments: "sync",
  views: "sync",
} as const satisfies ExhaustiveSyncWritePolicy<Engagement>;

type Coordinates = NonNullable<Location["coordinates"]>;

export const LOCATION_COORDINATES_WRITE_POLICY = {
  lat: "sync",
  lng: "sync",
} as const satisfies ExhaustiveSyncWritePolicy<Coordinates>;

export const LOCATION_WRITE_POLICY = {
  name: "sync",
  coordinates: "nested",
  url: "sync",
  source: "sync",
} as const satisfies ExhaustiveSyncWritePolicy<Location>;

export const TIME_RANGE_WRITE_POLICY = {
  startsAt: "sync",
  endsAt: "sync",
  kind: "sync",
} as const satisfies ExhaustiveSyncWritePolicy<TimeRange>;

export const RSS_SOURCE_INFO_WRITE_POLICY = {
  feedUrl: "sync",
  feedTitle: "sync",
  siteUrl: "sync",
} as const satisfies ExhaustiveSyncWritePolicy<RssSourceInfo>;

export const PRESERVED_CONTENT_WRITE_POLICY = {
  html: "compatibility-only",
  text: "sync",
  author: "sync",
  publishedAt: "sync",
  wordCount: "sync",
  readingTime: "sync",
  preservedAt: "sync",
} as const satisfies ExhaustiveSyncWritePolicy<PreservedContent>;

export const HIGHLIGHT_WRITE_POLICY = {
  text: "sync",
  note: "sync",
  createdAt: "sync",
} as const satisfies ExhaustiveSyncWritePolicy<Highlight>;

export const USER_STATE_WRITE_POLICY = {
  hidden: "sync",
  readAt: "sync",
  saved: "sync",
  savedAt: "sync",
  archived: "sync",
  archivedAt: "sync",
  tags: "nested",
  highlights: "nested",
  liked: "sync",
  likedAt: "sync",
  likedSyncedAt: "positive-sync",
  seenSyncedAt: "positive-sync",
} as const satisfies ExhaustiveSyncWritePolicy<UserState>;

export const CONTENT_SIGNAL_SCORE_WRITE_POLICY = {
  event: true,
  deadline: true,
  opportunity: true,
  how_to: true,
  reference: true,
  transaction: true,
  product_update: true,
  alert: true,
  deal: true,
  place: true,
  media: true,
  essay: true,
  moment: true,
  life_update: true,
  announcement: true,
  recommendation: true,
  request: true,
  discussion: true,
  promotion: true,
  news: true,
} as const satisfies Record<ContentSignal, true>;

export const CONTENT_SIGNALS_WRITE_POLICY = {
  version: "sync",
  method: "sync",
  inferredAt: "sync",
  scores: "nested",
  tags: "nested",
} as const satisfies ExhaustiveSyncWritePolicy<ContentSignals>;

export const EVENT_CANDIDATE_WRITE_POLICY = {
  version: "sync",
  method: "sync",
  detectedAt: "sync",
  confidence: "sync",
  title: "sync",
  startsAt: "sync",
  endsAt: "sync",
  timezone: "sync",
  locationName: "sync",
  locationUrl: "sync",
  evidence: "sync",
} as const satisfies ExhaustiveSyncWritePolicy<EventCandidate>;

export const FEED_ITEM_WRITE_POLICY = {
  globalId: "sync",
  platform: "sync",
  contentType: "sync",
  capturedAt: "sync",
  publishedAt: "sync",
  author: "nested",
  content: "nested",
  engagement: "nested",
  location: "nested",
  timeRange: "nested",
  rssSource: "nested",
  fbGroup: "nested",
  preservedContent: "nested",
  userState: "nested",
  topics: "nested",
  contentSignals: "nested",
  eventCandidate: "nested",
  priority: "sync",
  priorityComputedAt: "sync",
  sourceUrl: "sync",
  sampleDataFingerprint: "nested",
} as const satisfies ExhaustiveSyncWritePolicy<FeedItem>;

export const DOCUMENT_META_WRITE_POLICY = {
  documentId: "sync",
  deviceId: "compatibility-only",
  lastSync: "compatibility-only",
  version: "sync",
} as const satisfies ExhaustiveSyncWritePolicy<DocumentMeta>;

export const DESKTOP_CLIENT_REGISTRATION_WRITE_POLICY = {
  id: "sync",
  registeredAt: "sync",
} as const satisfies ExhaustiveSyncWritePolicy<DesktopClientRegistration>;

type NestedPolicyKeys<P> = {
  [K in keyof P]-?: P[K] extends "nested" ? K : never;
}[keyof P];

type NestedSanitizers<P> = {
  [K in Extract<NestedPolicyKeys<P>, string>]: (value: unknown) => unknown;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function sanitizeByPolicy<
  T extends object,
  P extends ExhaustiveSyncWritePolicy<T>,
>(
  input: Partial<T>,
  policy: P,
  nestedSanitizers: NestedSanitizers<P>,
  preserveUndefined: boolean = false,
): Partial<T> {
  const source = input as Record<string, unknown>;
  const result: Record<string, unknown> = {};
  const nested = nestedSanitizers as Record<string, (value: unknown) => unknown>;

  for (const key of Object.keys(policy)) {
    if (!Object.prototype.hasOwnProperty.call(source, key)) continue;
    const value = source[key];
    const disposition = policy[key as keyof P];

    if (disposition === "sync") {
      if (value !== undefined || preserveUndefined) result[key] = value;
      continue;
    }

    if (disposition === "positive-sync") {
      if (typeof value === "number" && Number.isFinite(value) && value > 0) {
        result[key] = value;
      }
      continue;
    }

    if (disposition !== "nested") continue;
    if (value === undefined) {
      if (preserveUndefined) result[key] = undefined;
      continue;
    }
    const sanitized = nested[key](value);
    if (sanitized !== undefined) result[key] = sanitized;
  }

  return result as Partial<T>;
}

function sanitizeNestedObject<T extends object>(
  value: unknown,
  sanitizer: (input: Partial<T>) => Partial<T>,
): Partial<T> | undefined {
  if (!isRecord(value)) return undefined;
  const sanitized = sanitizer(value as Partial<T>);
  if (Object.keys(value).length > 0 && Object.keys(sanitized).length === 0) {
    return undefined;
  }
  return sanitized;
}

function sanitizeStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  return value.filter((entry): entry is string => typeof entry === "string");
}

function sanitizeNumberArray(value: unknown): number[] | undefined {
  if (!Array.isArray(value)) return undefined;
  return value.filter((entry): entry is number => typeof entry === "number");
}

function sanitizeNumberRecord(value: unknown): Record<string, number> | undefined {
  if (!isRecord(value)) return undefined;
  return Object.fromEntries(
    Object.entries(value).filter((entry): entry is [string, number] => typeof entry[1] === "number"),
  );
}

function sanitizeStringArrayRecord(value: unknown): Record<string, string[]> | undefined {
  if (!isRecord(value)) return undefined;
  return Object.fromEntries(
    Object.entries(value).flatMap(([key, entry]) => {
      const sanitized = sanitizeStringArray(entry);
      return sanitized === undefined ? [] : [[key, sanitized]];
    }),
  );
}

function sanitizeTrueRecord(value: unknown): Record<string, true> | undefined {
  if (!isRecord(value)) return undefined;
  return Object.fromEntries(
    Object.entries(value).filter((entry): entry is [string, true] => entry[1] === true),
  );
}

function sanitizeObjectRecord<T extends object>(
  value: unknown,
  sanitizer: (input: Partial<T>) => Partial<T>,
): Record<string, Partial<T>> | undefined {
  if (!isRecord(value)) return undefined;
  const sanitizedEntries: Array<[string, Partial<T>]> = [];
  for (const [key, entry] of Object.entries(value)) {
    const sanitized = sanitizeNestedObject(entry, sanitizer);
    if (sanitized !== undefined) sanitizedEntries.push([key, sanitized]);
  }
  return Object.fromEntries(sanitizedEntries);
}

function sanitizeObjectArray<T extends object>(
  value: unknown,
  sanitizer: (input: Partial<T>) => Partial<T>,
): Array<Partial<T>> | undefined {
  if (!Array.isArray(value)) return undefined;
  const result: Array<Partial<T>> = [];
  for (const entry of value) {
    const sanitized = sanitizeNestedObject(entry, sanitizer);
    if (sanitized !== undefined) result.push(sanitized);
  }
  return result;
}

function sanitizeWeightPreferencesWrite(
  updates: Partial<WeightPreferences>,
): Partial<WeightPreferences> {
  return sanitizeByPolicy(updates, WEIGHT_PREFERENCES_WRITE_POLICY, {
    platforms: sanitizeNumberRecord,
    topics: sanitizeNumberRecord,
    authors: sanitizeNumberRecord,
  });
}

function sanitizeUlyssesPreferencesWrite(
  updates: Partial<UlyssesPreferences>,
): Partial<UlyssesPreferences> {
  return sanitizeByPolicy(updates, ULYSSES_PREFERENCES_WRITE_POLICY, {
    blockedPlatforms: sanitizeStringArray,
    allowedPaths: sanitizeStringArrayRecord,
  });
}

function sanitizeReadingEnhancementsWrite(
  updates: Partial<ReadingEnhancements>,
): Partial<ReadingEnhancements> {
  return sanitizeByPolicy(updates, READING_ENHANCEMENTS_WRITE_POLICY, {});
}

function sanitizeDisplayPreferencesWrite(
  updates: Partial<DisplayPreferences>,
): Partial<DisplayPreferences> {
  return sanitizeByPolicy(updates, DISPLAY_PREFERENCES_WRITE_POLICY, {
    reading: (value) => sanitizeNestedObject(value, sanitizeReadingEnhancementsWrite),
  });
}

function sanitizeXAccountWrite(updates: Partial<XAccount>): Partial<XAccount> {
  return sanitizeByPolicy(updates, X_ACCOUNT_WRITE_POLICY, {});
}

function sanitizeXCapturePreferencesWrite(
  updates: Partial<XCapturePreferences>,
): Partial<XCapturePreferences> {
  return sanitizeByPolicy(updates, X_CAPTURE_PREFERENCES_WRITE_POLICY, {
    whitelist: (value) => sanitizeObjectRecord(value, sanitizeXAccountWrite),
    blacklist: (value) => sanitizeObjectRecord(value, sanitizeXAccountWrite),
  });
}

function sanitizeFbGroupInfoWrite(updates: Partial<FbGroupInfo>): Partial<FbGroupInfo> {
  return sanitizeByPolicy(updates, FB_GROUP_INFO_WRITE_POLICY, {});
}

function sanitizeFacebookCapturePreferencesWrite(
  updates: Partial<FacebookCapturePreferences>,
): Partial<FacebookCapturePreferences> {
  return sanitizeByPolicy(updates, FACEBOOK_CAPTURE_PREFERENCES_WRITE_POLICY, {
    excludedGroupIds: sanitizeTrueRecord,
  });
}

function sanitizeFriendSuggestionPreferencesWrite(
  updates: Partial<FriendSuggestionPreferences>,
): Partial<FriendSuggestionPreferences> {
  return sanitizeByPolicy(updates, FRIEND_SUGGESTION_PREFERENCES_WRITE_POLICY, {
    dismissedSuggestionIds: sanitizeStringArray,
  });
}

function sanitizeAIPreferencesWrite(
  updates: Partial<AIPreferences>,
): Partial<AIPreferences> {
  return sanitizeByPolicy(updates, AI_PREFERENCES_WRITE_POLICY, {});
}

function sanitizeStoryWallStyleWrite(
  updates: Partial<StoryWallStylePreferences>,
): Partial<StoryWallStylePreferences> {
  return sanitizeByPolicy(updates, STORY_WALL_STYLE_WRITE_POLICY, {});
}

function sanitizeStoryWallPublishTargetWrite(
  updates: Partial<StoryWallPublishTarget>,
): Partial<StoryWallPublishTarget> {
  return sanitizeByPolicy(updates, STORY_WALL_PUBLISH_TARGET_WRITE_POLICY, {});
}

function sanitizeStoryWallPreferencesWrite(
  updates: Partial<StoryWallPreferences>,
): Partial<StoryWallPreferences> {
  return sanitizeByPolicy(updates, STORY_WALL_PREFERENCES_WRITE_POLICY, {
    selectedYears: sanitizeNumberArray,
    includedPlatforms: sanitizeStringArray,
    includedAccountIds: sanitizeStringArray,
    style: (value) => sanitizeNestedObject(value, sanitizeStoryWallStyleWrite),
    publishTarget: (value) => sanitizeNestedObject(value, sanitizeStoryWallPublishTargetWrite),
    featuredItemIds: sanitizeStringArray,
    hiddenItemIds: sanitizeStringArray,
  });
}

export function sanitizeUserPreferenceWrite(
  updates: Partial<UserPreferences>,
): Partial<UserPreferences> {
  return sanitizeByPolicy(updates, USER_PREFERENCES_WRITE_POLICY, {
    weights: (value) => sanitizeNestedObject(value, sanitizeWeightPreferencesWrite),
    ulysses: (value) => sanitizeNestedObject(value, sanitizeUlyssesPreferencesWrite),
    display: (value) => sanitizeNestedObject(value, sanitizeDisplayPreferencesWrite),
    xCapture: (value) => sanitizeNestedObject(value, sanitizeXCapturePreferencesWrite),
    fbCapture: (value) => sanitizeNestedObject(value, sanitizeFacebookCapturePreferencesWrite),
    friendSuggestions: (value) => sanitizeNestedObject(value, sanitizeFriendSuggestionPreferencesWrite),
    ai: (value) => sanitizeNestedObject(value, sanitizeAIPreferencesWrite),
    storyWall: (value) => sanitizeNestedObject(value, sanitizeStoryWallPreferencesWrite),
  });
}

export function sanitizeReachOutLogWrite(updates: Partial<ReachOutLog>): Partial<ReachOutLog> {
  return sanitizeByPolicy(updates, REACH_OUT_LOG_WRITE_POLICY, {});
}

function sanitizeSampleDataFingerprintWrite(
  updates: Partial<SampleDataFingerprint>,
): Partial<SampleDataFingerprint> {
  return sanitizeByPolicy(updates, SAMPLE_DATA_FINGERPRINT_WRITE_POLICY, {});
}

export function sanitizePersonWrite(
  updates: Partial<Person>,
  options: { preserveUndefined?: boolean } = {},
): Partial<Person> {
  return sanitizeByPolicy(
    updates,
    PERSON_WRITE_POLICY,
    {
      reachOutLog: (value) => sanitizeObjectArray(value, sanitizeReachOutLogWrite),
      tags: sanitizeStringArray,
      sampleDataFingerprint: (value) => sanitizeNestedObject(value, sanitizeSampleDataFingerprintWrite),
    },
    options.preserveUndefined,
  );
}

export function sanitizeAccountWrite(
  updates: Partial<Account>,
  options: { preserveUndefined?: boolean } = {},
): Partial<Account> {
  return sanitizeByPolicy(
    updates,
    ACCOUNT_WRITE_POLICY,
    {
      sampleDataFingerprint: (value) => sanitizeNestedObject(value, sanitizeSampleDataFingerprintWrite),
    },
    options.preserveUndefined,
  );
}

export function sanitizeRssFeedWrite(
  updates: Partial<RssFeed>,
): Partial<RssFeed> {
  return sanitizeByPolicy(updates, RSS_FEED_WRITE_POLICY, {
    sampleDataFingerprint: (value) => sanitizeNestedObject(value, sanitizeSampleDataFingerprintWrite),
  });
}

function sanitizeAuthorWrite(updates: Partial<Author>): Partial<Author> {
  return sanitizeByPolicy(updates, AUTHOR_WRITE_POLICY, {});
}

function sanitizeLinkPreviewWrite(updates: Partial<LinkPreview>): Partial<LinkPreview> {
  return sanitizeByPolicy(updates, LINK_PREVIEW_WRITE_POLICY, {});
}

function sanitizeContentWrite(updates: Partial<Content>): Partial<Content> {
  return sanitizeByPolicy(updates, CONTENT_WRITE_POLICY, {
    mediaUrls: sanitizeStringArray,
    mediaTypes: sanitizeStringArray,
    linkPreview: (value) => sanitizeNestedObject(value, sanitizeLinkPreviewWrite),
  });
}

function sanitizeEngagementWrite(updates: Partial<Engagement>): Partial<Engagement> {
  return sanitizeByPolicy(updates, ENGAGEMENT_WRITE_POLICY, {});
}

function sanitizeCoordinatesWrite(updates: Partial<Coordinates>): Partial<Coordinates> {
  return sanitizeByPolicy(updates, LOCATION_COORDINATES_WRITE_POLICY, {});
}

function sanitizeLocationWrite(updates: Partial<Location>): Partial<Location> {
  return sanitizeByPolicy(updates, LOCATION_WRITE_POLICY, {
    coordinates: (value) => sanitizeNestedObject(value, sanitizeCoordinatesWrite),
  });
}

function sanitizeTimeRangeWrite(updates: Partial<TimeRange>): Partial<TimeRange> {
  return sanitizeByPolicy(updates, TIME_RANGE_WRITE_POLICY, {});
}

function sanitizeRssSourceInfoWrite(updates: Partial<RssSourceInfo>): Partial<RssSourceInfo> {
  return sanitizeByPolicy(updates, RSS_SOURCE_INFO_WRITE_POLICY, {});
}

function sanitizePreservedContentWrite(
  updates: Partial<PreservedContent>,
): Partial<PreservedContent> {
  return sanitizeByPolicy(updates, PRESERVED_CONTENT_WRITE_POLICY, {});
}

function sanitizeHighlightWrite(updates: Partial<Highlight>): Partial<Highlight> {
  return sanitizeByPolicy(updates, HIGHLIGHT_WRITE_POLICY, {});
}

function sanitizeUserStateWrite(
  updates: Partial<UserState>,
): Partial<UserState> {
  return sanitizeByPolicy(updates, USER_STATE_WRITE_POLICY, {
    tags: sanitizeStringArray,
    highlights: (value) => sanitizeObjectArray(value, sanitizeHighlightWrite),
  });
}

function sanitizeContentSignalScores(
  value: unknown,
): Partial<Record<ContentSignal, number>> | undefined {
  if (!isRecord(value)) return undefined;
  const result: Partial<Record<ContentSignal, number>> = {};
  for (const signal of Object.keys(CONTENT_SIGNAL_SCORE_WRITE_POLICY) as ContentSignal[]) {
    const score = value[signal];
    if (typeof score === "number") result[signal] = score;
  }
  return result;
}

function sanitizeContentSignalArray(value: unknown): ContentSignal[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const allowed = new Set<unknown>(Object.keys(CONTENT_SIGNAL_SCORE_WRITE_POLICY));
  return value.filter((entry): entry is ContentSignal => allowed.has(entry));
}

function sanitizeContentSignalsWrite(
  updates: Partial<ContentSignals>,
): Partial<ContentSignals> {
  return sanitizeByPolicy(updates, CONTENT_SIGNALS_WRITE_POLICY, {
    scores: sanitizeContentSignalScores,
    tags: sanitizeContentSignalArray,
  });
}

function sanitizeEventCandidateWrite(
  updates: Partial<EventCandidate>,
): Partial<EventCandidate> {
  return sanitizeByPolicy(updates, EVENT_CANDIDATE_WRITE_POLICY, {});
}

export function sanitizeFeedItemWrite(
  updates: Partial<FeedItem>,
): Partial<FeedItem> {
  return sanitizeByPolicy(updates, FEED_ITEM_WRITE_POLICY, {
    author: (value) => sanitizeNestedObject(value, sanitizeAuthorWrite),
    content: (value) => sanitizeNestedObject(value, sanitizeContentWrite),
    engagement: (value) => sanitizeNestedObject(value, sanitizeEngagementWrite),
    location: (value) => sanitizeNestedObject(value, sanitizeLocationWrite),
    timeRange: (value) => sanitizeNestedObject(value, sanitizeTimeRangeWrite),
    rssSource: (value) => sanitizeNestedObject(value, sanitizeRssSourceInfoWrite),
    fbGroup: (value) => sanitizeNestedObject(value, sanitizeFbGroupInfoWrite),
    preservedContent: (value) => sanitizeNestedObject(value, sanitizePreservedContentWrite),
    userState: (value) => sanitizeNestedObject(value, sanitizeUserStateWrite),
    topics: sanitizeStringArray,
    contentSignals: (value) => sanitizeNestedObject(value, sanitizeContentSignalsWrite),
    eventCandidate: (value) => sanitizeNestedObject(value, sanitizeEventCandidateWrite),
    sampleDataFingerprint: (value) => sanitizeNestedObject(value, sanitizeSampleDataFingerprintWrite),
  });
}

export function sanitizeDesktopClientRegistrationWrite(
  updates: Partial<DesktopClientRegistration>,
): Partial<DesktopClientRegistration> {
  return sanitizeByPolicy(updates, DESKTOP_CLIENT_REGISTRATION_WRITE_POLICY, {});
}
