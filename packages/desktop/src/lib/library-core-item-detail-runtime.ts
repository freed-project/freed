import { type ContentSignal, type FeedItem } from "@freed/shared";
import {
  readLibraryCoreNormalizedFacetSummaryV1,
  readLibraryCoreNormalizedAccountTimelineV1,
  readLibraryCoreNormalizedItemDetailV1,
  readLibraryCoreNormalizedMapCandidatesV1,
  readLibraryCoreNormalizedPersonTimelineV1,
  readLibraryCoreNormalizedSavedAnalyticsV1,
  readLibraryCoreNormalizedStoryWallCandidatesV1,
  readLibraryCoreNormalizedPersonsGraphV1,
  readLibraryCoreNormalizedFriendsLocationItemV1,
  scanLibraryCoreNormalizedBackgroundItemsV1,
  scanLibraryCoreContentFetchCandidatesV1,
  type LibraryCoreContentFetchCandidateV1,
  type LibraryCoreFacetSummaryV1,
} from "@freed/shared/library-core";
import { queryNormalizedLibrary } from "./library-core-normalized-query-client";

let activeItemScan: Promise<void> | null = null;

export const LIBRARY_CORE_ITEM_DETAIL_READER_DISABLED_KEY =
  "freed.libraryCore.itemDetailReaderV1.disabled";
export const LIBRARY_CORE_FRIENDS_READER_DISABLED_KEY =
  "freed.libraryCore.friendsReaderV1.disabled";
export const LIBRARY_CORE_SAVED_ANALYTICS_READER_DISABLED_KEY =
  "freed.libraryCore.savedAnalyticsReaderV1.disabled";

export type LibraryCoreFacetSummary = LibraryCoreFacetSummaryV1;

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

const NORMALIZED_READER_RUNTIME = Object.freeze({
  query: queryNormalizedLibrary,
  randomId: () => crypto.randomUUID(),
});

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
  return readLibraryCoreNormalizedPersonsGraphV1(
    NORMALIZED_READER_RUNTIME,
    request,
  );
}

export async function readLibraryCoreFriendsLocationItem(
  request: LibraryFriendsLocationItemRequest,
): Promise<FeedItem | null> {
  return readLibraryCoreNormalizedFriendsLocationItemV1(
    NORMALIZED_READER_RUNTIME,
    request,
  );
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

export async function readLibraryCoreStoryWallCandidates() {
  return readLibraryCoreNormalizedStoryWallCandidatesV1(
    NORMALIZED_READER_RUNTIME,
  );
}

export async function readLibraryCoreMapCandidates() {
  return readLibraryCoreNormalizedMapCandidatesV1(NORMALIZED_READER_RUNTIME);
}

export async function scanLibraryCoreBackgroundItems(
  visitPage: (
    items: readonly FeedItem[],
  ) => "continue" | "stop" | Promise<"continue" | "stop">,
): Promise<void> {
  return scanLibraryCoreNormalizedBackgroundItemsV1(
    NORMALIZED_READER_RUNTIME,
    visitPage,
  );
}

export async function scanLibraryCoreContentFetchCandidates(
  visitPage: (
    rows: readonly LibraryCoreContentFetchCandidateV1[],
  ) => void | Promise<void>,
): Promise<void> {
  return scanLibraryCoreContentFetchCandidatesV1(
    NORMALIZED_READER_RUNTIME,
    visitPage,
  );
}

export interface LibraryCoreItemScanFilter {
  readonly hasLinkPreview?: boolean;
  readonly missingPreservedText?: boolean;
}

async function scanLibraryCoreItemsExclusive(
  visitPage: (items: readonly FeedItem[]) => void | Promise<void>,
  filter: LibraryCoreItemScanFilter,
): Promise<void> {
  await scanLibraryCoreNormalizedBackgroundItemsV1(
    NORMALIZED_READER_RUNTIME,
    async (items) => {
      const selected = items.filter(
        (item) =>
          (filter.hasLinkPreview === undefined ||
            Boolean(item.content.linkPreview) === filter.hasLinkPreview) &&
          (filter.missingPreservedText === undefined ||
            !Boolean(item.preservedContent?.text) ===
              filter.missingPreservedText),
      );
      if (selected.length > 0) await visitPage(selected);
      return "continue" as const;
    },
  );
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
