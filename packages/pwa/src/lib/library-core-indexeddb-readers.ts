import {
  CONTENT_SIGNAL_KEYS,
  FEED_SIGNAL_FILTER_PRESETS,
  calculatePriority,
  compileFriendAuthorIndex,
  extractLocationFromItem,
  hasSampleDataFingerprint,
  isLocationItemVisibleInTimeMode,
  mergeDefaultPreferences,
  type Account,
  type FeedItem,
  type FeedSignalMode,
  type FilterOptions,
  type Friend,
  type Person,
  type SavedContentSortMode,
  type UserPreferences,
} from "@freed/shared";
import {
  LIBRARY_CORE_FEED_PAGE_DEFAULT_LIMIT,
  LIBRARY_CORE_FEED_RECOMMENDATION_ORDER_SCHEMA_VERSION,
  LIBRARY_CORE_SAVED_ANALYTICS_DAILY_WINDOW_COUNT,
  LIBRARY_CORE_SAVED_ANALYTICS_HOURLY_WINDOW_COUNT,
  LIBRARY_CORE_SURFACE_ITEMS_MAXIMUM_MAP_ITEMS,
  LIBRARY_CORE_SURFACE_ITEMS_MAXIMUM_STORY_WALL_ITEMS,
  matchesLibraryCoreFeedBrowseFilterV1,
  normalizeLibraryCoreFeedBrowseFilterV1,
  parseLibraryCoreFeedBrowseFilterV1,
  projectLibraryCoreFeedCardV1,
  sha256LowerHex,
  type LibraryCoreFeedBrowseFilterInputV1,
  type LibraryCoreFeedBrowseFilterV1,
  type LibraryCoreFeedPageSourceV1,
} from "@freed/shared/library-core";
import type {
  BoundedFeedReader,
  PlatformConfig,
  ScanLibraryItems,
} from "@freed/ui/context";

import {
  createPwaLibraryCoreFeedReaderRuntime,
  type PwaLibraryCoreBrowseProjectedRowV1,
} from "./library-core-feed-reader-runtime";

const PROJECTION_PAGE_LIMIT = 128;
const MAXIMUM_SAFE_SORT_KEY = Number.MAX_SAFE_INTEGER;
const MAXIMUM_FRIEND_GRAPH_KEYS = 5_000;
const MAXIMUM_FRIEND_SAMPLE_ITEMS = 5;
const MAXIMUM_FRIEND_LOCATION_CANDIDATES = 8;
const DEFAULT_PERSON_TIMELINE_LIMIT = 50;
const MAXIMUM_PERSON_TIMELINE_LIMIT = 100;
const MAXIMUM_FACET_TAGS = 4_096;
const MAXIMUM_FACET_TAG_BYTES = 1_024;
const SOURCE_DOMAIN = "freed-pwa-library-core-indexeddb-read-model-v1";
const TIMELINE_CURSOR_PREFIX = "pwa-indexeddb-v1:";
const TEXT_ENCODER = new TextEncoder();

type LibraryFacetSummary = Awaited<
  ReturnType<NonNullable<PlatformConfig["readLibraryFacetSummary"]>>
>;
type LibraryFriendsGraphRequest = Parameters<
  NonNullable<PlatformConfig["readLibraryFriendsGraph"]>
>[0];
type LibraryFriendsGraph = Awaited<
  ReturnType<NonNullable<PlatformConfig["readLibraryFriendsGraph"]>>
>;
type LibraryFriendsGraphSocialActivity = LibraryFriendsGraph["social"][number];
type LibraryFriendsGraphRssActivity = LibraryFriendsGraph["rss"][number];
type LibraryFriendsGraphSampleItem =
  LibraryFriendsGraphSocialActivity["sampleItems"][number];
type LibraryFriendsGraphLocationCandidate =
  LibraryFriendsGraphSocialActivity["locationCandidates"][number];
type LibraryFriendsLocationItemRequest = Parameters<
  NonNullable<PlatformConfig["readLibraryFriendsLocationItem"]>
>[0];
type LibraryPersonTimelineRequest = Parameters<
  NonNullable<PlatformConfig["readLibraryPersonTimeline"]>
>[0];
type LibraryPersonTimelinePage = Awaited<
  ReturnType<NonNullable<PlatformConfig["readLibraryPersonTimeline"]>>
>;
type LibrarySavedAnalyticsRequest = Parameters<
  NonNullable<PlatformConfig["readLibrarySavedAnalytics"]>
>[0];
type LibrarySavedAnalytics = Awaited<
  ReturnType<NonNullable<PlatformConfig["readLibrarySavedAnalytics"]>>
>;
type LibrarySurface = Parameters<
  NonNullable<PlatformConfig["readLibrarySurfaceItems"]>
>[0];

interface LibraryReadModelState {
  readonly preferences: UserPreferences;
  readonly persons: Record<string, Person>;
  readonly accounts: Record<string, Account>;
  readonly friends: Record<string, Friend>;
}

export interface PwaLibraryCoreIndexedDbReadersOptions {
  readonly databaseName: string;
  readonly indexedDb: IDBFactory;
  readonly keyRange: typeof IDBKeyRange;
  readonly subtle: SubtleCrypto;
  readonly scanItems: ScanLibraryItems;
  readonly readItem: (globalId: string) => Promise<FeedItem | null>;
  readonly getState: () => LibraryReadModelState;
  readonly getSourceRevision: () => number;
  readonly randomId?: () => string;
}

type ProjectionOrder =
  | Readonly<{ kind: "timeline" }>
  | Readonly<{ kind: "saved"; sortMode: SavedContentSortMode }>;

interface TimelineCursor {
  readonly sourceToken: string;
  readonly publishedAt: number;
  readonly capturedAt: number;
  readonly globalId: string;
}

interface SocialAccumulator {
  itemCount: number;
  latestActivityAt: number;
  recentCount: number;
  avatarUrl: string | null;
  avatarGlobalId: string | null;
  avatarPublishedAt: number | null;
  sampleItems: LibraryFriendsGraphSampleItem[];
  locationCandidates: LibraryFriendsGraphLocationCandidate[];
  signalCounts: Map<string, number>;
}

interface RssAccumulator {
  itemCount: number;
  latestActivityAt: number;
  avatarUrl: string | null;
  avatarGlobalId: string | null;
  avatarPublishedAt: number | null;
  sampleItems: LibraryFriendsGraphSampleItem[];
  locationCandidates: LibraryFriendsGraphLocationCandidate[];
}

function checkedFilter(
  input: LibraryCoreFeedBrowseFilterInputV1,
): LibraryCoreFeedBrowseFilterV1 {
  const parsed = parseLibraryCoreFeedBrowseFilterV1(
    normalizeLibraryCoreFeedBrowseFilterV1(input),
  );
  if (!parsed.ok) throw new Error(parsed.error);
  return parsed.value;
}

function compareTimelineItems(left: FeedItem, right: FeedItem): number {
  return (
    right.publishedAt - left.publishedAt ||
    right.capturedAt - left.capturedAt ||
    (left.globalId < right.globalId
      ? -1
      : left.globalId > right.globalId
        ? 1
        : 0)
  );
}

function compareItemToTimelineCursor(
  item: FeedItem,
  cursor: TimelineCursor,
): number {
  return (
    cursor.publishedAt - item.publishedAt ||
    cursor.capturedAt - item.capturedAt ||
    (item.globalId < cursor.globalId
      ? -1
      : item.globalId > cursor.globalId
        ? 1
        : 0)
  );
}

function insertBounded<T>(
  values: T[],
  candidate: T,
  maximum: number,
  compare: (left: T, right: T) => number,
): void {
  let low = 0;
  let high = values.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (compare(values[middle]!, candidate) <= 0) low = middle + 1;
    else high = middle;
  }
  values.splice(low, 0, candidate);
  if (values.length > maximum) values.pop();
}

function compareGraphSampleItems(
  left: LibraryFriendsGraphSampleItem,
  right: LibraryFriendsGraphSampleItem,
): number {
  return (
    right.publishedAt - left.publishedAt ||
    (left.globalId < right.globalId
      ? -1
      : left.globalId > right.globalId
        ? 1
        : 0)
  );
}

function compareGraphLocationCandidates(
  left: LibraryFriendsGraphLocationCandidate,
  right: LibraryFriendsGraphLocationCandidate,
): number {
  return (
    right.publishedAt - left.publishedAt ||
    (left.globalId < right.globalId
      ? -1
      : left.globalId > right.globalId
        ? 1
        : 0)
  );
}

function encodeTimelineCursor(cursor: TimelineCursor): string {
  return `${TIMELINE_CURSOR_PREFIX}${JSON.stringify([
    cursor.sourceToken,
    cursor.publishedAt,
    cursor.capturedAt,
    cursor.globalId,
  ])}`;
}

function decodeTimelineCursor(
  value: string | null | undefined,
  sourceToken: string,
): TimelineCursor | null {
  if (value === null || value === undefined) return null;
  if (!value.startsWith(TIMELINE_CURSOR_PREFIX)) {
    throw new Error("PWA Library person timeline cursor is invalid");
  }
  let decoded: unknown;
  try {
    decoded = JSON.parse(value.slice(TIMELINE_CURSOR_PREFIX.length));
  } catch {
    throw new Error("PWA Library person timeline cursor is invalid");
  }
  if (
    !Array.isArray(decoded) ||
    decoded.length !== 4 ||
    decoded[0] !== sourceToken ||
    !Number.isSafeInteger(decoded[1]) ||
    (decoded[1] as number) < 0 ||
    !Number.isSafeInteger(decoded[2]) ||
    (decoded[2] as number) < 0 ||
    typeof decoded[3] !== "string" ||
    decoded[3].length === 0
  ) {
    throw new Error("PWA Library person timeline cursor is stale or invalid");
  }
  return Object.freeze({
    sourceToken,
    publishedAt: decoded[1] as number,
    capturedAt: decoded[2] as number,
    globalId: decoded[3],
  });
}

function validAnalyticsWindows(
  windows: readonly Readonly<{ startMs: number; endMs: number }>[],
  count: number,
): boolean {
  return (
    windows.length === count &&
    windows.every(
      (window) =>
        Number.isSafeInteger(window.startMs) &&
        Number.isSafeInteger(window.endMs) &&
        window.startMs >= 0 &&
        window.endMs >= window.startMs,
    )
  );
}

function incrementCount(counts: Map<string, number>, label: string): void {
  counts.set(label, (counts.get(label) ?? 0) + 1);
}

function sortedCounts(
  counts: Map<string, number>,
): Array<{ label: string; count: number }> {
  return [...counts]
    .map(([label, count]) => ({ label, count }))
    .sort(
      (left, right) =>
        right.count - left.count || left.label.localeCompare(right.label),
    );
}

function projectionOrderValues(
  item: FeedItem,
  order: ProjectionOrder,
  state: LibraryReadModelState,
  rankingWeights: UserPreferences["weights"],
  rankingClockMs: number,
): Pick<PwaLibraryCoreBrowseProjectedRowV1, "priority" | "sourceSequence"> & {
  readonly publishedAt: number;
} {
  if (order.kind === "timeline") {
    return {
      priority: 0,
      publishedAt: item.publishedAt,
      sourceSequence: MAXIMUM_SAFE_SORT_KEY - item.capturedAt,
    };
  }

  if (order.sortMode === "date_saved") {
    return {
      priority: 0,
      publishedAt: item.userState.savedAt ?? item.capturedAt,
      sourceSequence: 0,
    };
  }
  if (order.sortMode === "date_published") {
    return {
      priority: 0,
      publishedAt: item.publishedAt || item.capturedAt,
      sourceSequence: 0,
    };
  }
  if (order.sortMode === "recommended") {
    return {
      priority: calculatePriority(
        item,
        rankingWeights,
        rankingClockMs,
        { persons: state.persons, accounts: state.accounts },
      ),
      publishedAt: item.publishedAt,
      sourceSequence: 0,
    };
  }
  const readingTime = item.preservedContent?.readingTime;
  const hasReadingTime =
    Number.isSafeInteger(readingTime) && (readingTime ?? -1) >= 0;
  return {
    priority: hasReadingTime ? 1 : 0,
    publishedAt: hasReadingTime ? MAXIMUM_SAFE_SORT_KEY - readingTime! : 0,
    sourceSequence: 0,
  };
}

class PwaLibraryCoreIndexedDbReaders {
  readonly #options: PwaLibraryCoreIndexedDbReadersOptions;
  readonly #feedRuntime: ReturnType<
    typeof createPwaLibraryCoreFeedReaderRuntime
  >;
  readonly #randomId: () => string;
  #projectionTail: Promise<void> = Promise.resolve();

  constructor(options: PwaLibraryCoreIndexedDbReadersOptions) {
    this.#options = options;
    this.#randomId = options.randomId ?? (() => crypto.randomUUID());
    this.#feedRuntime = createPwaLibraryCoreFeedReaderRuntime({
      databaseName: options.databaseName,
      indexedDb: options.indexedDb,
      keyRange: options.keyRange,
      subtle: options.subtle,
    });
  }

  openFeedReader(
    filter: LibraryCoreFeedBrowseFilterInputV1,
    rankingClockMs: number,
  ): Promise<BoundedFeedReader> {
    return this.#queueProjection(() =>
      this.#openProjectedReader(filter, rankingClockMs, { kind: "timeline" }),
    );
  }

  openFriendsFeedReader(
    filter: LibraryCoreFeedBrowseFilterInputV1,
    rankingClockMs: number,
  ): Promise<BoundedFeedReader> {
    return this.#queueProjection(() => {
      const state = this.#options.getState();
      const friendAuthors = compileFriendAuthorIndex(
        state.persons,
        state.accounts,
        state.friends,
      );
      return this.#openProjectedReader(
        filter,
        rankingClockMs,
        { kind: "timeline" },
        (item) => friendAuthors.has(item.platform, item.author.id),
        state,
      );
    });
  }

  openSavedFeedReader(
    filter: LibraryCoreFeedBrowseFilterInputV1,
    sortMode: SavedContentSortMode,
    rankingClockMs: number,
  ): Promise<BoundedFeedReader> {
    return this.#queueProjection(() =>
      this.#openProjectedReader(
        { ...filter, savedOnly: true },
        rankingClockMs,
        { kind: "saved", sortMode },
      ),
    );
  }

  async readFacetSummary(): Promise<LibraryFacetSummary> {
    const sourceRevision = this.#options.getSourceRevision();
    const tags = new Set<string>();
    const savedPlatforms = new Set<string>();
    let archivedCount = 0;
    let sampleItemCount = 0;
    let savedArchivedCount = 0;
    let savedCount = 0;
    let totalCount = 0;
    await this.#scanAtRevision(sourceRevision, (items) => {
      for (const item of items) {
        totalCount += 1;
        if (item.userState.archived) archivedCount += 1;
        if (hasSampleDataFingerprint(item)) sampleItemCount += 1;
        if (item.userState.saved) {
          savedCount += 1;
          savedPlatforms.add(item.platform);
          if (item.userState.archived) savedArchivedCount += 1;
        }
        for (const tag of item.userState.tags) {
          if (TEXT_ENCODER.encode(tag).byteLength > MAXIMUM_FACET_TAG_BYTES) {
            throw new Error("PWA Library facet tag exceeds its byte bound");
          }
          tags.add(tag);
          if (tags.size > MAXIMUM_FACET_TAGS) {
            throw new Error("PWA Library facet tags exceed their count bound");
          }
        }
      }
      return "continue";
    });
    return Object.freeze({
      archivedCount,
      sampleItemCount,
      savedArchivedCount,
      savedCount,
      savedPlatformCount: savedPlatforms.size,
      tags: Object.freeze(
        [...tags].sort((left, right) => left.localeCompare(right)),
      ),
      totalCount,
    });
  }

  async readFeedSignalCounts(
    filterInput: FilterOptions,
  ): Promise<Readonly<Record<FeedSignalMode, number>>> {
    const sourceRevision = this.#options.getSourceRevision();
    const base = checkedFilter(filterInput);
    const filters = new Map<FeedSignalMode, LibraryCoreFeedBrowseFilterV1>(
      FEED_SIGNAL_FILTER_PRESETS.map((preset) => [
        preset.mode,
        Object.freeze({
          ...base,
          signals: Object.freeze(
            preset.mode === "all" ? [] : [...preset.signals],
          ),
        }),
      ]),
    );
    const counts: Record<FeedSignalMode, number> = {
      all: 0,
      inspiring: 0,
      events: 0,
      personal: 0,
      conversation: 0,
      news: 0,
    };
    await this.#scanAtRevision(sourceRevision, (items) => {
      for (const item of items) {
        for (const preset of FEED_SIGNAL_FILTER_PRESETS) {
          if (
            matchesLibraryCoreFeedBrowseFilterV1(
              item,
              filters.get(preset.mode)!,
            )
          ) {
            counts[preset.mode] += 1;
          }
        }
      }
      return "continue" as const;
    });
    return Object.freeze(counts);
  }

  async readSavedAnalytics(
    request: LibrarySavedAnalyticsRequest,
  ): Promise<LibrarySavedAnalytics> {
    const sourceRevision = this.#options.getSourceRevision();
    if (
      !validAnalyticsWindows(
        request.dailyWindows,
        LIBRARY_CORE_SAVED_ANALYTICS_DAILY_WINDOW_COUNT,
      ) ||
      !validAnalyticsWindows(
        request.hourlyWindows,
        LIBRARY_CORE_SAVED_ANALYTICS_HOURLY_WINDOW_COUNT,
      )
    ) {
      throw new Error("PWA Library saved analytics windows are invalid");
    }
    const sourceCounts = new Map<string, number>();
    const contentMix = new Map<string, number>();
    const dailyCounts = request.dailyWindows.map(() => 0);
    const hourlyCounts = request.hourlyWindows.map(() => 0);
    let latestSavedAt: number | null = null;
    let totalCount = 0;
    await this.#scanAtRevision(sourceRevision, (items) => {
      for (const item of items) {
        if (!item.userState.saved) continue;
        totalCount += 1;
        incrementCount(sourceCounts, item.platform);
        incrementCount(contentMix, item.contentType);
        const savedAt =
          item.userState.savedAt ?? item.userState.readAt ?? item.capturedAt;
        latestSavedAt = Math.max(latestSavedAt ?? 0, savedAt);
        request.dailyWindows.forEach((window, index) => {
          if (savedAt >= window.startMs && savedAt < window.endMs) {
            dailyCounts[index]! += 1;
          }
        });
        request.hourlyWindows.forEach((window, index) => {
          if (savedAt >= window.startMs && savedAt < window.endMs) {
            hourlyCounts[index]! += 1;
          }
        });
      }
      return "continue";
    });
    return Object.freeze({
      contentMix: Object.freeze(sortedCounts(contentMix)),
      dailyCounts: Object.freeze(dailyCounts),
      hourlyCounts: Object.freeze(hourlyCounts),
      latestSavedAt,
      sourceCounts: Object.freeze(sortedCounts(sourceCounts)),
      totalCount,
    });
  }

  async readFriendsGraph(
    request: LibraryFriendsGraphRequest,
  ): Promise<LibraryFriendsGraph> {
    const sourceRevision = this.#options.getSourceRevision();
    if (
      request.sources.length + request.rssFeedUrls.length >
        MAXIMUM_FRIEND_GRAPH_KEYS ||
      request.recentWindow.startMs < 0 ||
      request.recentWindow.endMs < request.recentWindow.startMs
    ) {
      throw new Error("PWA Library Friends graph request is invalid");
    }
    const socialKey = (platform: string, authorId: string) =>
      JSON.stringify([platform, authorId]);
    const socialAccumulators = new Map<string, SocialAccumulator>();
    for (const source of request.sources) {
      socialAccumulators.set(socialKey(source.platform, source.authorId), {
        itemCount: 0,
        latestActivityAt: 0,
        recentCount: 0,
        avatarUrl: null,
        avatarGlobalId: null,
        avatarPublishedAt: null,
        sampleItems: [],
        locationCandidates: [],
        signalCounts: new Map(),
      });
    }
    const rssAccumulators = new Map<string, RssAccumulator>();
    for (const feedUrl of request.rssFeedUrls) {
      rssAccumulators.set(feedUrl, {
        itemCount: 0,
        latestActivityAt: 0,
        avatarUrl: null,
        avatarGlobalId: null,
        avatarPublishedAt: null,
        sampleItems: [],
        locationCandidates: [],
      });
    }
    let totalItemCount = 0;
    await this.#scanAtRevision(sourceRevision, (items) => {
      for (const item of items) {
        totalItemCount += 1;
        if (item.userState.hidden) continue;
        const social = socialAccumulators.get(
          socialKey(item.platform, item.author.id),
        );
        if (social) {
          social.itemCount += 1;
          social.latestActivityAt = Math.max(
            social.latestActivityAt,
            item.publishedAt,
          );
          if (
            item.publishedAt >= request.recentWindow.startMs &&
            item.publishedAt < request.recentWindow.endMs
          ) {
            social.recentCount += 1;
          }
          insertBounded(
            social.sampleItems,
            { globalId: item.globalId, publishedAt: item.publishedAt },
            MAXIMUM_FRIEND_SAMPLE_ITEMS,
            compareGraphSampleItems,
          );
          if (
            item.author.avatarUrl &&
            (social.avatarPublishedAt === null ||
              item.publishedAt > social.avatarPublishedAt ||
              (item.publishedAt === social.avatarPublishedAt &&
                item.globalId < (social.avatarGlobalId ?? "\uffff")))
          ) {
            social.avatarUrl = item.author.avatarUrl;
            social.avatarGlobalId = item.globalId;
            social.avatarPublishedAt = item.publishedAt;
          }
          if (extractLocationFromItem(item)) {
            insertBounded(
              social.locationCandidates,
              {
                effectiveAt: item.timeRange?.startsAt ?? item.publishedAt,
                globalId: item.globalId,
                publishedAt: item.publishedAt,
              },
              MAXIMUM_FRIEND_LOCATION_CANDIDATES,
              compareGraphLocationCandidates,
            );
          }
          for (const signal of item.contentSignals?.tags ?? []) {
            social.signalCounts.set(
              signal,
              (social.signalCounts.get(signal) ?? 0) + 1,
            );
          }
        }

        const feedUrl = item.rssSource?.feedUrl;
        const rss = feedUrl ? rssAccumulators.get(feedUrl) : undefined;
        if (rss) {
          rss.itemCount += 1;
          rss.latestActivityAt = Math.max(
            rss.latestActivityAt,
            item.publishedAt,
          );
          insertBounded(
            rss.sampleItems,
            { globalId: item.globalId, publishedAt: item.publishedAt },
            MAXIMUM_FRIEND_SAMPLE_ITEMS,
            compareGraphSampleItems,
          );
          if (
            item.author.avatarUrl &&
            (rss.avatarPublishedAt === null ||
              item.publishedAt > rss.avatarPublishedAt ||
              (item.publishedAt === rss.avatarPublishedAt &&
                item.globalId < (rss.avatarGlobalId ?? "\uffff")))
          ) {
            rss.avatarUrl = item.author.avatarUrl;
            rss.avatarGlobalId = item.globalId;
            rss.avatarPublishedAt = item.publishedAt;
          }
          if (extractLocationFromItem(item)) {
            insertBounded(
              rss.locationCandidates,
              {
                effectiveAt: item.timeRange?.startsAt ?? item.publishedAt,
                globalId: item.globalId,
                publishedAt: item.publishedAt,
              },
              MAXIMUM_FRIEND_LOCATION_CANDIDATES,
              compareGraphLocationCandidates,
            );
          }
        }
      }
      return "continue";
    });

    const social = request.sources.map(
      (source): LibraryFriendsGraphSocialActivity => {
        const accumulator = socialAccumulators.get(
          socialKey(source.platform, source.authorId),
        )!;
        return Object.freeze({
          ...source,
          itemCount: accumulator.itemCount,
          latestActivityAt: accumulator.latestActivityAt,
          hasLocation: accumulator.locationCandidates.length > 0,
          locationCandidateCount: accumulator.locationCandidates.length,
          locationCandidates: Object.freeze(accumulator.locationCandidates),
          avatarGlobalId: accumulator.avatarGlobalId,
          avatarPublishedAt: accumulator.avatarPublishedAt,
          avatarUrl: accumulator.avatarUrl,
          sampleItems: Object.freeze(accumulator.sampleItems),
          recentCount: accumulator.recentCount,
          signalCounts: Object.freeze(
            CONTENT_SIGNAL_KEYS.map((label) =>
              Object.freeze({
                label,
                count: accumulator.signalCounts.get(label) ?? 0,
              }),
            ),
          ),
        });
      },
    );
    const rss = request.rssFeedUrls.map(
      (feedUrl): LibraryFriendsGraphRssActivity => {
        const accumulator = rssAccumulators.get(feedUrl)!;
        return Object.freeze({
          feedUrl,
          itemCount: accumulator.itemCount,
          latestActivityAt: accumulator.latestActivityAt,
          hasLocation: accumulator.locationCandidates.length > 0,
          locationCandidateCount: accumulator.locationCandidates.length,
          locationCandidates: Object.freeze(accumulator.locationCandidates),
          avatarGlobalId: accumulator.avatarGlobalId,
          avatarPublishedAt: accumulator.avatarPublishedAt,
          avatarUrl: accumulator.avatarUrl,
          sampleItems: Object.freeze(accumulator.sampleItems),
        });
      },
    );
    return Object.freeze({
      sourceToken: this.#sourceToken(sourceRevision),
      totalItemCount,
      social: Object.freeze(social),
      rss: Object.freeze(rss),
    });
  }

  async readPersonTimeline(
    request: LibraryPersonTimelineRequest,
  ): Promise<LibraryPersonTimelinePage> {
    const sourceRevision = this.#options.getSourceRevision();
    const limit = request.limit ?? DEFAULT_PERSON_TIMELINE_LIMIT;
    if (
      !Number.isSafeInteger(limit) ||
      limit < 1 ||
      limit > MAXIMUM_PERSON_TIMELINE_LIMIT ||
      request.sources.length === 0 ||
      request.sources.length > MAXIMUM_FRIEND_GRAPH_KEYS
    ) {
      throw new Error("PWA Library person timeline request is invalid");
    }
    const sourceToken = this.#sourceToken(sourceRevision);
    const cursor = decodeTimelineCursor(request.cursor, sourceToken);
    const sourceKeys = new Set(
      request.sources.map((source) =>
        JSON.stringify([source.platform, source.authorId]),
      ),
    );
    const retained: FeedItem[] = [];
    let totalCount = 0;
    let afterCursorCount = 0;
    await this.#scanAtRevision(sourceRevision, (items) => {
      for (const item of items) {
        if (
          item.userState.hidden ||
          !sourceKeys.has(JSON.stringify([item.platform, item.author.id]))
        ) {
          continue;
        }
        totalCount += 1;
        if (cursor && compareItemToTimelineCursor(item, cursor) <= 0) continue;
        afterCursorCount += 1;
        insertBounded(retained, item, limit, compareTimelineItems);
      }
      return "continue";
    });
    const finalItem = retained.at(-1);
    return Object.freeze({
      items: Object.freeze(retained),
      totalCount,
      nextCursor:
        finalItem && afterCursorCount > retained.length
          ? encodeTimelineCursor({
              sourceToken,
              publishedAt: finalItem.publishedAt,
              capturedAt: finalItem.capturedAt,
              globalId: finalItem.globalId,
            })
          : null,
    });
  }

  async readFriendsLocationItem(
    request: LibraryFriendsLocationItemRequest,
  ): Promise<FeedItem | null> {
    const sourceRevision = this.#options.getSourceRevision();
    if (request.sourceToken !== this.#sourceToken(sourceRevision)) {
      throw new Error("PWA Library Friends location source is stale");
    }
    const item = await this.#options.readItem(request.globalId);
    this.#assertSourceRevision(sourceRevision);
    if (!item) return null;
    const ownerMatches =
      request.owner.kind === "social"
        ? item.platform === request.owner.platform &&
          item.author.id === request.owner.authorId
        : item.platform === "rss" &&
          item.rssSource?.feedUrl === request.owner.feedUrl;
    const effectiveAt = item.timeRange?.startsAt ?? item.publishedAt;
    if (
      !ownerMatches ||
      item.publishedAt !== request.publishedAt ||
      effectiveAt !== request.effectiveAt ||
      item.userState.hidden ||
      !isLocationItemVisibleInTimeMode(
        item,
        "current",
        request.referenceTimeMs,
      ) ||
      extractLocationFromItem(item) === null
    ) {
      throw new Error("PWA Library Friends location item is inconsistent");
    }
    return item;
  }

  async readSurfaceItems(
    surface: LibrarySurface,
  ): Promise<readonly FeedItem[]> {
    const sourceRevision = this.#options.getSourceRevision();
    const maximum =
      surface === "map"
        ? LIBRARY_CORE_SURFACE_ITEMS_MAXIMUM_MAP_ITEMS
        : LIBRARY_CORE_SURFACE_ITEMS_MAXIMUM_STORY_WALL_ITEMS;
    const retained: FeedItem[] = [];
    await this.#scanAtRevision(sourceRevision, (items) => {
      for (const item of items) {
        if (item.userState.hidden) continue;
        const matches =
          surface === "map"
            ? extractLocationFromItem(item) !== null
            : !item.userState.archived && item.content.mediaUrls.length > 0;
        if (!matches) continue;
        insertBounded(retained, item, maximum, compareTimelineItems);
      }
      return "continue";
    });
    return Object.freeze(retained);
  }

  async quiesce(): Promise<void> {
    await this.#projectionTail.catch(() => undefined);
    await this.#feedRuntime.quiesce();
  }

  #queueProjection<T>(task: () => Promise<T>): Promise<T> {
    const result = this.#projectionTail.then(task, task);
    this.#projectionTail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  async #scanAtRevision(
    sourceRevision: number,
    visit: Parameters<ScanLibraryItems>[0],
  ): Promise<void> {
    await this.#options.scanItems(visit);
    this.#assertSourceRevision(sourceRevision);
  }

  #assertSourceRevision(sourceRevision: number): void {
    if (this.#options.getSourceRevision() !== sourceRevision) {
      throw new Error("PWA Library changed during its bounded read");
    }
  }

  async #openProjectedReader(
    filterInput: LibraryCoreFeedBrowseFilterInputV1,
    rankingClockMs: number,
    order: ProjectionOrder,
    additionalPredicate: (item: FeedItem) => boolean = () => true,
    capturedState = this.#options.getState(),
  ): Promise<BoundedFeedReader> {
    if (!Number.isSafeInteger(rankingClockMs) || rankingClockMs < 0) {
      throw new Error("PWA Library ranking clock is invalid");
    }
    const filter = checkedFilter(filterInput);
    const sourceRevision = this.#options.getSourceRevision();
    const source = this.#projectionSource(
      sourceRevision,
      filter,
      order,
      rankingClockMs,
    );
    const rankingWeights = mergeDefaultPreferences(
      capturedState.preferences,
    ).weights;
    const matches = (item: FeedItem) =>
      additionalPredicate(item) &&
      matchesLibraryCoreFeedBrowseFilterV1(item, filter);
    let totalCount = 0;
    await this.#options.scanItems((items) => {
      for (const item of items) {
        if (matches(item)) totalCount += 1;
      }
      return "continue";
    });
    if (this.#options.getSourceRevision() !== sourceRevision) {
      throw new Error("PWA Library changed while its bounded reader opened");
    }

    await this.#feedRuntime.beginBrowseGeneration({
      filter,
      rankingClockMs,
      recommendationOrderSchemaVersion:
        LIBRARY_CORE_FEED_RECOMMENDATION_ORDER_SCHEMA_VERSION,
      source,
      totalCount,
    });
    let batchIndex = 0;
    let rows: PwaLibraryCoreBrowseProjectedRowV1[] = [];
    const flush = async () => {
      if (rows.length === 0) return;
      const page = Object.freeze(rows);
      rows = [];
      await this.#feedRuntime.appendBrowseGenerationPage({
        batchIndex,
        rows: page,
        source,
      });
      batchIndex += 1;
    };
    await this.#options.scanItems(async (items) => {
      for (const item of items) {
        if (!matches(item)) continue;
        const orderValues = projectionOrderValues(
          item,
          order,
          capturedState,
          rankingWeights,
          rankingClockMs,
        );
        const projected = projectLibraryCoreFeedCardV1({
          ...item,
          publishedAt: orderValues.publishedAt,
        });
        rows.push(
          Object.freeze({
            priority: orderValues.priority,
            row: projected,
            sourceSequence: orderValues.sourceSequence,
          }),
        );
        if (rows.length === PROJECTION_PAGE_LIMIT) await flush();
      }
      return "continue" as const;
    });
    await flush();
    await this.#feedRuntime.finalizeBrowseGeneration(source);
    if (this.#options.getSourceRevision() !== sourceRevision) {
      throw new Error("PWA Library changed while its bounded reader opened");
    }

    const readerSessionId = this.#randomId();
    let cursor: string | null = null;
    let exhausted = totalCount === 0;
    let closed = false;
    let lastCancellationId = this.#randomId();
    return Object.freeze({
      totalCount,
      readNext: async () => {
        if (closed || exhausted) {
          return Object.freeze([]);
        }
        if (this.#options.getSourceRevision() !== sourceRevision) {
          throw new Error("PWA Library bounded reader source is stale");
        }
        lastCancellationId = this.#randomId();
        const page = await this.#feedRuntime.readBrowseFeedPage({
          cancellationId: lastCancellationId,
          cursor,
          filter,
          limit: LIBRARY_CORE_FEED_PAGE_DEFAULT_LIMIT,
          queryId: "feed_browse_page_v1",
          rankingClockMs,
          readerSessionId,
          recommendationOrderSchemaVersion:
            LIBRARY_CORE_FEED_RECOMMENDATION_ORDER_SCHEMA_VERSION,
          schemaVersion: 1,
        });
        if (!page.ok) throw new Error(page.message);
        cursor = page.value.nextCursor;
        exhausted = cursor === null;
        const items = await Promise.all(
          page.value.rows.map((row) => this.#options.readItem(row.globalId)),
        );
        if (
          this.#options.getSourceRevision() !== sourceRevision ||
          items.some(
            (item, index) =>
              !item || item.globalId !== page.value.rows[index]?.globalId,
          )
        ) {
          throw new Error("PWA Library bounded reader source is stale");
        }
        return Object.freeze(items as FeedItem[]);
      },
      close: async () => {
        this.#feedRuntime.cancelReader(readerSessionId, lastCancellationId);
        closed = true;
        cursor = null;
      },
    });
  }

  #projectionSource(
    sourceRevision: number,
    filter: LibraryCoreFeedBrowseFilterV1,
    order: ProjectionOrder,
    rankingClockMs: number,
  ): LibraryCoreFeedPageSourceV1 {
    const generationId = sha256LowerHex(
      TEXT_ENCODER.encode(
        JSON.stringify([
          SOURCE_DOMAIN,
          sourceRevision,
          filter,
          order,
          rankingClockMs,
          this.#randomId(),
        ]),
      ),
    );
    return Object.freeze({
      generationId,
      projectionRevision: 1,
      transitionSequence: sourceRevision,
    });
  }

  #sourceToken(sourceRevision: number): string {
    return `pwa-indexeddb:${sourceRevision.toLocaleString("en-US", {
      useGrouping: false,
    })}`;
  }
}

export function createPwaLibraryCoreIndexedDbReaders(
  options: PwaLibraryCoreIndexedDbReadersOptions,
): PwaLibraryCoreIndexedDbReaders {
  return new PwaLibraryCoreIndexedDbReaders(options);
}
