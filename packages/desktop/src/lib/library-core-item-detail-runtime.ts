import {
  CONTENT_SIGNAL_KEYS,
  extractLocationFromItem,
  isLocationItemVisibleInTimeMode,
  type ContentSignal,
  type FeedItem,
} from "@freed/shared";
import {
  readLibraryCoreNormalizedFacetSummaryV1,
  readLibraryCoreNormalizedAccountTimelineV1,
  readLibraryCoreNormalizedItemDetailV1,
  readLibraryCoreNormalizedPersonTimelineV1,
  readLibraryCoreNormalizedSavedAnalyticsV1,
  readLibraryCoreNormalizedSurfaceItemsV1,
} from "@freed/shared/library-core";
import { queryNormalizedLibrary } from "./library-core-normalized-query-client";
import { querySqliteItems, readSqliteItems } from "./sqlite-library";

const ITEM_SCAN_PAGE_LIMIT = 64;
const MAXIMUM_FRIEND_GRAPH_KEYS = 5_000;
const MAXIMUM_FRIEND_SAMPLE_ITEMS = 5;
const MAXIMUM_FRIEND_LOCATION_CANDIDATES = 8;
let activeItemScan: Promise<void> | null = null;

export const LIBRARY_CORE_ITEM_DETAIL_READER_DISABLED_KEY =
  "freed.libraryCore.itemDetailReaderV1.disabled";
export const LIBRARY_CORE_FRIENDS_READER_DISABLED_KEY =
  "freed.libraryCore.friendsReaderV1.disabled";
export const LIBRARY_CORE_SAVED_ANALYTICS_READER_DISABLED_KEY =
  "freed.libraryCore.savedAnalyticsReaderV1.disabled";

export interface LibraryCoreFacetSummary {
  readonly archivedCount: number;
  readonly sampleItemCount: number;
  readonly savedArchivedCount: number;
  readonly savedCount: number;
  readonly savedPlatformCount: number;
  readonly tags: readonly string[];
  readonly totalCount: number;
}

export interface LibraryFriendsSource {
  readonly platform: string;
  readonly authorId: string;
}

export interface LibraryFriendsRecentWindow {
  readonly startMs: number;
  readonly endMs: number;
}

export interface LibraryFriendsGraphRequest {
  readonly sources: readonly LibraryFriendsSource[];
  readonly rssFeedUrls: readonly string[];
  readonly recentWindow: LibraryFriendsRecentWindow;
}

export interface LibraryFriendsGraphSampleItem {
  readonly globalId: string;
  readonly publishedAt: number;
}

export interface LibraryFriendsGraphSignalCount {
  readonly label: ContentSignal;
  readonly count: number;
}

export interface LibraryFriendsGraphLocationCandidate {
  readonly effectiveAt: number;
  readonly globalId: string;
  readonly publishedAt: number;
}

export interface LibraryFriendsGraphSocialActivity {
  readonly platform: string;
  readonly authorId: string;
  readonly itemCount: number;
  readonly latestActivityAt: number;
  readonly hasLocation: boolean;
  readonly locationCandidateCount: number;
  readonly locationCandidates: readonly LibraryFriendsGraphLocationCandidate[];
  readonly avatarGlobalId: string | null;
  readonly avatarPublishedAt: number | null;
  readonly avatarUrl: string | null;
  readonly sampleItems: readonly LibraryFriendsGraphSampleItem[];
  readonly recentCount: number;
  readonly signalCounts: readonly LibraryFriendsGraphSignalCount[];
}

export interface LibraryFriendsGraphRssActivity {
  readonly feedUrl: string;
  readonly itemCount: number;
  readonly latestActivityAt: number;
  readonly hasLocation: boolean;
  readonly locationCandidateCount: number;
  readonly locationCandidates: readonly LibraryFriendsGraphLocationCandidate[];
  readonly avatarGlobalId: string | null;
  readonly avatarPublishedAt: number | null;
  readonly avatarUrl: string | null;
  readonly sampleItems: readonly LibraryFriendsGraphSampleItem[];
}

export interface LibraryFriendsGraph {
  readonly sourceToken: string;
  readonly totalItemCount: number;
  readonly social: readonly LibraryFriendsGraphSocialActivity[];
  readonly rss: readonly LibraryFriendsGraphRssActivity[];
}

export type LibraryFriendsLocationOwner =
  | {
      readonly kind: "social";
      readonly platform: string;
      readonly authorId: string;
    }
  | { readonly kind: "rss"; readonly feedUrl: string };

export interface LibraryFriendsLocationItemRequest extends LibraryFriendsGraphLocationCandidate {
  readonly owner: LibraryFriendsLocationOwner;
  readonly referenceTimeMs: number;
  readonly sourceToken: string;
}

export type LibraryPersonTimelineRequest =
  | Readonly<{ accountId: string; cursor?: string | null; limit?: number }>
  | Readonly<{ cursor?: string | null; limit?: number; personId: string }>;

export interface LibraryPersonTimelinePage {
  readonly items: readonly FeedItem[];
  readonly totalCount: number;
  readonly nextCursor: string | null;
}

export interface LibraryCoreSavedAnalyticsWindow {
  readonly endMs: number;
  readonly startMs: number;
}

export interface LibraryCoreSavedAnalyticsRequest {
  readonly dailyWindows: readonly LibraryCoreSavedAnalyticsWindow[];
  readonly hourlyWindows: readonly LibraryCoreSavedAnalyticsWindow[];
}

export interface LibraryCoreSavedAnalyticsLabeledCount {
  readonly count: number;
  readonly label: string;
}

export interface LibraryCoreSavedAnalytics {
  readonly contentMix: readonly LibraryCoreSavedAnalyticsLabeledCount[];
  readonly dailyCounts: readonly number[];
  readonly hourlyCounts: readonly number[];
  readonly latestSavedAt: number | null;
  readonly sourceCounts: readonly LibraryCoreSavedAnalyticsLabeledCount[];
  readonly totalCount: number;
}

export type LibraryCoreSurface = "map" | "story_wall";
const NORMALIZED_READER_RUNTIME = Object.freeze({
  query: queryNormalizedLibrary,
  randomId: () => crypto.randomUUID(),
});

export interface LibraryCoreItemScanPage {
  readonly items: readonly FeedItem[];
  readonly done: boolean;
}

export interface LibraryCoreItemScanSession {
  nextPage(): Promise<LibraryCoreItemScanPage>;
  close(): Promise<void>;
}

function assertFriendsRequest(request: LibraryFriendsGraphRequest): void {
  const count = request.sources.length + request.rssFeedUrls.length;
  if (
    count > MAXIMUM_FRIEND_GRAPH_KEYS ||
    request.recentWindow.endMs < request.recentWindow.startMs
  ) {
    throw new Error("Library Core Friends graph request is invalid");
  }
}

async function scanSqlitePages(
  query: Parameters<typeof querySqliteItems>[0],
  visit: (item: FeedItem) => void | "stop" | Promise<void | "stop">,
): Promise<void> {
  let offset: number | null = 0;
  while (offset !== null) {
    const page = await querySqliteItems({
      ...query,
      offset,
      limit: 128,
      includeTotalCount: false,
    });
    for (const item of page.items) {
      if ((await visit(item)) === "stop") return;
    }
    offset = page.nextOffset;
  }
}

export async function readLibraryCoreItemDetail(
  globalId: string,
): Promise<FeedItem | null> {
  return readLibraryCoreNormalizedItemDetailV1(
    NORMALIZED_READER_RUNTIME,
    globalId,
  );
}

export async function readLibraryCoreFacetSummary(): Promise<LibraryCoreFacetSummary> {
  return readLibraryCoreNormalizedFacetSummaryV1(NORMALIZED_READER_RUNTIME);
}

export async function readLibraryCoreFriendsGraph(
  request: LibraryFriendsGraphRequest,
): Promise<LibraryFriendsGraph> {
  assertFriendsRequest(request);
  interface SocialAccumulator {
    itemCount: number;
    latestActivityAt: number;
    recentCount: number;
    avatarUrl: string | null;
    avatarGlobalId: string | null;
    avatarPublishedAt: number | null;
    sampleItems: LibraryFriendsGraphSampleItem[];
    locationCandidates: LibraryFriendsGraphLocationCandidate[];
    signalCounts: Map<ContentSignal, number>;
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
  if (request.sources.length > 0) {
    await scanSqlitePages(
      {
        authorKeys: request.sources,
        showHidden: true,
        includeTotalCount: false,
      },
      (item) => {
        if (item.userState.hidden) return;
        const accumulator = socialAccumulators.get(
          socialKey(item.platform, item.author.id),
        );
        if (!accumulator) return;
        accumulator.itemCount += 1;
        accumulator.latestActivityAt = Math.max(
          accumulator.latestActivityAt,
          item.publishedAt,
        );
        if (
          item.publishedAt >= request.recentWindow.startMs &&
          item.publishedAt < request.recentWindow.endMs
        ) {
          accumulator.recentCount += 1;
        }
        if (accumulator.sampleItems.length < MAXIMUM_FRIEND_SAMPLE_ITEMS) {
          accumulator.sampleItems.push({
            globalId: item.globalId,
            publishedAt: item.publishedAt,
          });
        }
        if (
          item.author.avatarUrl &&
          (accumulator.avatarPublishedAt === null ||
            item.publishedAt > accumulator.avatarPublishedAt)
        ) {
          accumulator.avatarUrl = item.author.avatarUrl;
          accumulator.avatarGlobalId = item.globalId;
          accumulator.avatarPublishedAt = item.publishedAt;
        }
        if (
          extractLocationFromItem(item) &&
          accumulator.locationCandidates.length <
            MAXIMUM_FRIEND_LOCATION_CANDIDATES
        ) {
          accumulator.locationCandidates.push({
            effectiveAt: item.timeRange?.startsAt ?? item.publishedAt,
            globalId: item.globalId,
            publishedAt: item.publishedAt,
          });
        }
        for (const signal of item.contentSignals?.tags ?? []) {
          accumulator.signalCounts.set(
            signal,
            (accumulator.signalCounts.get(signal) ?? 0) + 1,
          );
        }
      },
    );
  }
  const social = request.sources.map(
    (source): LibraryFriendsGraphSocialActivity => {
      const accumulator = socialAccumulators.get(
        socialKey(source.platform, source.authorId),
      )!;
      return {
        ...source,
        itemCount: accumulator.itemCount,
        latestActivityAt: accumulator.latestActivityAt,
        hasLocation: accumulator.locationCandidates.length > 0,
        locationCandidateCount: accumulator.locationCandidates.length,
        locationCandidates: accumulator.locationCandidates,
        avatarGlobalId: accumulator.avatarGlobalId,
        avatarPublishedAt: accumulator.avatarPublishedAt,
        avatarUrl: accumulator.avatarUrl,
        sampleItems: accumulator.sampleItems,
        recentCount: accumulator.recentCount,
        signalCounts: CONTENT_SIGNAL_KEYS.map((label) => ({
          label,
          count: accumulator.signalCounts.get(label) ?? 0,
        })),
      };
    },
  );

  interface RssAccumulator {
    itemCount: number;
    latestActivityAt: number;
    avatarUrl: string | null;
    avatarGlobalId: string | null;
    avatarPublishedAt: number | null;
    sampleItems: LibraryFriendsGraphSampleItem[];
    locationCandidates: LibraryFriendsGraphLocationCandidate[];
  }
  const rssAccumulators = new Map<string, RssAccumulator>(
    request.rssFeedUrls.map((feedUrl) => [
      feedUrl,
      {
        itemCount: 0,
        latestActivityAt: 0,
        avatarUrl: null,
        avatarGlobalId: null,
        avatarPublishedAt: null,
        sampleItems: [],
        locationCandidates: [],
      },
    ]),
  );
  if (rssAccumulators.size > 0) {
    await scanSqlitePages({ platform: "rss", showHidden: true }, (item) => {
      const feedUrl = item.rssSource?.feedUrl;
      const accumulator = feedUrl ? rssAccumulators.get(feedUrl) : undefined;
      if (!accumulator || item.userState.hidden) return;
      accumulator.itemCount += 1;
      accumulator.latestActivityAt = Math.max(
        accumulator.latestActivityAt,
        item.publishedAt,
      );
      if (accumulator.sampleItems.length < MAXIMUM_FRIEND_SAMPLE_ITEMS) {
        accumulator.sampleItems.push({
          globalId: item.globalId,
          publishedAt: item.publishedAt,
        });
      }
      if (
        item.author.avatarUrl &&
        (accumulator.avatarPublishedAt === null ||
          item.publishedAt > accumulator.avatarPublishedAt)
      ) {
        accumulator.avatarUrl = item.author.avatarUrl;
        accumulator.avatarGlobalId = item.globalId;
        accumulator.avatarPublishedAt = item.publishedAt;
      }
      if (
        extractLocationFromItem(item) &&
        accumulator.locationCandidates.length <
          MAXIMUM_FRIEND_LOCATION_CANDIDATES
      ) {
        accumulator.locationCandidates.push({
          effectiveAt: item.timeRange?.startsAt ?? item.publishedAt,
          globalId: item.globalId,
          publishedAt: item.publishedAt,
        });
      }
    });
  }
  const rss = request.rssFeedUrls.map(
    (feedUrl): LibraryFriendsGraphRssActivity => {
      const accumulator = rssAccumulators.get(feedUrl)!;
      return {
        feedUrl,
        itemCount: accumulator.itemCount,
        latestActivityAt: accumulator.latestActivityAt,
        hasLocation: accumulator.locationCandidates.length > 0,
        locationCandidateCount: accumulator.locationCandidates.length,
        locationCandidates: accumulator.locationCandidates,
        avatarGlobalId: accumulator.avatarGlobalId,
        avatarPublishedAt: accumulator.avatarPublishedAt,
        avatarUrl: accumulator.avatarUrl,
        sampleItems: accumulator.sampleItems,
      };
    },
  );

  const totalItemCount = (
    await querySqliteItems({ showHidden: true, limit: 1 })
  ).totalCount;
  return { sourceToken: "sqlite", totalItemCount, social, rss };
}

export async function readLibraryCoreFriendsLocationItem(
  request: LibraryFriendsLocationItemRequest,
): Promise<FeedItem | null> {
  const item = (await readSqliteItems([request.globalId]))[0] ?? null;
  if (!item) return null;
  const ownerMatches =
    request.owner.kind === "social"
      ? item.platform === request.owner.platform &&
        item.author.id === request.owner.authorId
      : item.platform === "rss" &&
        item.rssSource?.feedUrl === request.owner.feedUrl;
  const effectiveAt = item.timeRange?.startsAt ?? item.publishedAt;
  if (
    request.sourceToken !== "sqlite" ||
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
  )
    throw new Error("SQLite Friends location item is inconsistent");
  return item;
}

export async function readLibraryCorePersonTimeline(
  request: LibraryPersonTimelineRequest,
): Promise<LibraryPersonTimelinePage> {
  return "accountId" in request
    ? readLibraryCoreNormalizedAccountTimelineV1(
        NORMALIZED_READER_RUNTIME,
        request,
      )
    : readLibraryCoreNormalizedPersonTimelineV1(
        NORMALIZED_READER_RUNTIME,
        request,
      );
}

export async function readLibraryCoreSavedAnalytics(
  request: LibraryCoreSavedAnalyticsRequest,
): Promise<LibraryCoreSavedAnalytics> {
  return readLibraryCoreNormalizedSavedAnalyticsV1(
    NORMALIZED_READER_RUNTIME,
    request,
  );
}

export async function readLibraryCoreSurfaceItems(
  surface: LibraryCoreSurface,
): Promise<readonly FeedItem[]> {
  return readLibraryCoreNormalizedSurfaceItemsV1(
    NORMALIZED_READER_RUNTIME,
    surface,
  );
}

export async function openLibraryCoreItemScanSession(): Promise<LibraryCoreItemScanSession> {
  let offset: number | null = 0;
  let closed = false;
  return {
    async nextPage(): Promise<LibraryCoreItemScanPage> {
      if (closed) throw new Error("Library Core item scan session is closed");
      if (offset === null) return { items: [], done: true };
      const page = await querySqliteItems({
        offset,
        limit: ITEM_SCAN_PAGE_LIMIT,
        showHidden: true,
        includeTotalCount: false,
      });
      offset = page.nextOffset;
      return { items: page.items, done: offset === null };
    },
    async close(): Promise<void> {
      closed = true;
    },
  };
}

export interface LibraryCoreItemScanFilter {
  readonly hasLinkPreview?: boolean;
  readonly missingPreservedText?: boolean;
}

async function scanLibraryCoreItemsExclusive(
  visitPage: (items: readonly FeedItem[]) => void | Promise<void>,
  filter: LibraryCoreItemScanFilter,
): Promise<void> {
  let offset: number | null = 0;
  try {
    for (;;) {
      const page = await querySqliteItems({
        ...filter,
        offset: offset ?? 0,
        limit: ITEM_SCAN_PAGE_LIMIT,
        showHidden: true,
        includeTotalCount: false,
      });
      await visitPage(page.items);
      offset = page.nextOffset;
      if (offset === null) return;
    }
  } finally {
    /* The native query owns no persistent cursor. */
  }
}

export async function scanLibraryCoreItems(
  visitPage: (items: readonly FeedItem[]) => void | Promise<void>,
  filter: LibraryCoreItemScanFilter = {},
): Promise<void> {
  while (activeItemScan !== null) {
    try {
      await activeItemScan;
    } catch {
      /* A failed consumer cannot block the next scan. */
    }
  }
  const current = scanLibraryCoreItemsExclusive(visitPage, filter);
  activeItemScan = current;
  try {
    await current;
  } finally {
    if (activeItemScan === current) activeItemScan = null;
  }
}
