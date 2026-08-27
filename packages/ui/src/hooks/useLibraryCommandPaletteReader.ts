import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  normalizeLibraryCoreFeedBrowseFilterV1,
  type BaseAppState,
  type FeedItem,
  type FilterOptions,
} from "@freed/shared";
import { LIBRARY_CORE_SCOPE_ACTION_SCHEMA_VERSION } from "@freed/shared/library-core";

import { usePlatform } from "../context/PlatformContext.js";
import { getFeedActionCounts } from "../lib/feed-action-scope.js";
import { useLibraryFacetSummary } from "./useLibraryFacetSummary.js";
import { useLibraryItemDetail } from "./useLibraryItemDetail.js";

interface ScopeCounts {
  readonly archivableCount: number;
  readonly unreadCount: number;
}

interface PaletteScanState extends ScopeCounts {
  readonly sourceVersion: number;
  readonly status: "idle" | "loading" | "ready" | "failed";
}

export interface UseLibraryCommandPaletteReaderOptions {
  readonly activeFilter: FilterOptions;
  readonly activeView: BaseAppState["activeView"];
  readonly commandScopeItems: FeedItem[];
  readonly enabled: boolean;
  readonly identityMode: "friends" | "all_content";
  readonly inputValue: string;
  readonly searchQuery: string;
  readonly selectedItemId: string | null;
  readonly sourceVersion: number;
}

export interface LibraryCommandPaletteReaderResult {
  readonly archivableScopeCount: number;
  readonly archivedUnsavedCount: number;
  readonly archiveScopeRead: () => Promise<void>;
  readonly markScopeRead: () => Promise<void>;
  readonly savedArchivedCount: number;
  readonly selectedItem: FeedItem | null;
  readonly tags: readonly string[];
  readonly unreadScopeCount: number;
}

const EMPTY_COUNTS: ScopeCounts = Object.freeze({
  archivableCount: 0,
  unreadCount: 0,
});
function emptyPaletteScan(
  status: PaletteScanState["status"],
  sourceVersion: number,
): PaletteScanState {
  return {
    ...EMPTY_COUNTS,
    sourceVersion,
    status,
  };
}

function useStableFilter(activeFilter: FilterOptions) {
  const candidate = normalizeLibraryCoreFeedBrowseFilterV1(activeFilter);
  const signature = JSON.stringify(candidate);
  const stable = useRef({
    input: activeFilter,
    normalized: candidate,
    signature,
  });
  if (stable.current.signature !== signature) {
    stable.current = {
      input: activeFilter,
      normalized: candidate,
      signature,
    };
  }
  return stable.current;
}

function compactScopeCounts(
  activeFilter: FilterOptions,
  identityMode: "friends" | "all_content",
  state: Pick<
    BaseAppState,
    | "archivableCountByPlatform"
    | "archivableFeedCounts"
    | "feedUnreadCounts"
    | "totalArchivableCount"
    | "totalUnreadCount"
    | "unreadCountByPlatform"
  >,
): ScopeCounts | null {
  const filter = normalizeLibraryCoreFeedBrowseFilterV1(activeFilter);
  if (
    identityMode !== "all_content" ||
    filter.archivedOnly ||
    filter.authorId !== null ||
    filter.savedOnly ||
    filter.showHidden ||
    filter.signals.length > 0 ||
    filter.socialContentFilter !== "all" ||
    filter.tags.length > 0
  ) {
    return null;
  }

  if (filter.feedUrl !== null) {
    if (filter.platform !== null && filter.platform !== "rss") return null;
    return {
      archivableCount: state.archivableFeedCounts[filter.feedUrl] ?? 0,
      unreadCount: state.feedUnreadCounts[filter.feedUrl] ?? 0,
    };
  }
  if (filter.platform !== null) {
    // The canonical RSS filter includes any row carrying rssSource, even when
    // its provider platform is not "rss". Platform aggregates cannot prove
    // that mixed-schema membership, so the bounded scanner owns this scope.
    if (filter.platform === "rss") return null;
    return {
      archivableCount: state.archivableCountByPlatform[filter.platform] ?? 0,
      unreadCount: state.unreadCountByPlatform[filter.platform] ?? 0,
    };
  }
  return {
    archivableCount: state.totalArchivableCount,
    unreadCount: state.totalUnreadCount,
  };
}

/**
 * Supply command-palette Library facts without mounting the Desktop corpus.
 *
 * Complex scope counts use the same filtered bounded SQLite feed reader as the
 * visible Feed. Bulk execution stays behind one platform-owned SQLite action
 * boundary, so React never retains the resolved entity set.
 */
export function useLibraryCommandPaletteReader({
  activeFilter,
  activeView,
  commandScopeItems,
  enabled,
  identityMode,
  inputValue,
  searchQuery,
  selectedItemId,
  sourceVersion,
}: UseLibraryCommandPaletteReaderOptions): LibraryCommandPaletteReaderResult {
  const platform = usePlatform();
  const {
    executeLibraryScopeAction,
    openBoundedFeedReader,
    openBoundedFriendsFeedReader,
    readLibraryFacetSummary,
    store,
  } = platform;
  const archivableCountByPlatform = store(
    (state) => state.archivableCountByPlatform,
  );
  const archivableFeedCounts = store((state) => state.archivableFeedCounts);
  const feedUnreadCounts = store((state) => state.feedUnreadCounts);
  const totalArchivableCount = store((state) => state.totalArchivableCount);
  const totalUnreadCount = store((state) => state.totalUnreadCount);
  const unreadCountByPlatform = store((state) => state.unreadCountByPlatform);
  const compactInputs = useMemo(
    () => ({
      archivableCountByPlatform,
      archivableFeedCounts,
      feedUnreadCounts,
      totalArchivableCount,
      totalUnreadCount,
      unreadCountByPlatform,
    }),
    [
      archivableCountByPlatform,
      archivableFeedCounts,
      feedUnreadCounts,
      totalArchivableCount,
      totalUnreadCount,
      unreadCountByPlatform,
    ],
  );
  const stableFilter = useStableFilter(activeFilter);
  const normalizedFilter = stableFilter.normalized;
  const normalizedFilterSignature = stableFilter.signature;
  const compactCounts = useMemo(
    () => compactScopeCounts(activeFilter, identityMode, compactInputs),
    [activeFilter, compactInputs, identityMode],
  );
  const openScopeReader =
    identityMode === "friends"
      ? openBoundedFriendsFeedReader
      : openBoundedFeedReader;
  const libraryFacets = useLibraryFacetSummary(
    sourceVersion,
    enabled && Boolean(readLibraryFacetSummary),
  );
  const inputHasQuery = inputValue.trim().length > 0;
  const committedSearchHasQuery = searchQuery.trim().length > 0;
  const queryIsCommitted = inputValue.trim() === searchQuery.trim();
  const queryFenceKey = JSON.stringify([
    sourceVersion,
    inputValue,
    searchQuery,
    activeView,
    identityMode,
    normalizedFilterSignature,
  ]);
  const latestQueryFenceKey = useRef(queryFenceKey);
  latestQueryFenceKey.current = queryFenceKey;
  const readComplexScope = Boolean(
    activeView === "feed" && !inputHasQuery && compactCounts === null,
  );
  const scopeReadNeeded = enabled && Boolean(openScopeReader) && readComplexScope;
  const [paletteScan, setPaletteScan] = useState<PaletteScanState>(() =>
    emptyPaletteScan("idle", sourceVersion),
  );
  const itemDetail = useLibraryItemDetail(
    selectedItemId,
    sourceVersion,
    enabled,
  );

  useEffect(() => {
    if (!scopeReadNeeded || !openScopeReader) {
      setPaletteScan(emptyPaletteScan("idle", sourceVersion));
      return;
    }

    let cancelled = false;
    let reader: Awaited<ReturnType<typeof openScopeReader>> | null = null;
    let readerClosed = false;
    const closeReader = async () => {
      if (!reader || readerClosed) return;
      readerClosed = true;
      await reader.close();
    };
    let unreadCount = 0;
    let archivableCount = 0;
    setPaletteScan(emptyPaletteScan("loading", sourceVersion));
    void (async () => {
      reader = await openScopeReader(stableFilter.input, Date.now());
      while (!cancelled) {
        const page = await reader.readNext();
        if (page.length === 0) break;
        const counts = getFeedActionCounts(page);
        unreadCount += counts.unreadCount;
        archivableCount += counts.archivableCount;
      }
      if (!cancelled) {
        setPaletteScan({
          archivableCount,
          sourceVersion,
          status: "ready",
          unreadCount,
        });
      }
    })()
      .catch(() => {
        if (!cancelled) {
          setPaletteScan(emptyPaletteScan("failed", sourceVersion));
        }
      })
      .finally(() => {
        void closeReader();
      });
    return () => {
      cancelled = true;
      void closeReader();
    };
  }, [
    normalizedFilter,
    normalizedFilterSignature,
    openScopeReader,
    scopeReadNeeded,
    stableFilter,
    sourceVersion,
  ]);

  const paletteScanIsCurrent = paletteScan.sourceVersion === sourceVersion;
  const paletteScanReady =
    paletteScanIsCurrent && paletteScan.status === "ready";

  const searchCounts = useMemo(
    () => getFeedActionCounts(commandScopeItems),
    [commandScopeItems],
  );
  let scopeCounts = EMPTY_COUNTS;
  if (activeView === "feed") {
    if (!queryIsCommitted) {
      scopeCounts = EMPTY_COUNTS;
    } else if (inputHasQuery) {
      scopeCounts = committedSearchHasQuery ? searchCounts : EMPTY_COUNTS;
    } else if (compactCounts) {
      scopeCounts = compactCounts;
    } else if (paletteScanReady) {
      scopeCounts = paletteScan;
    }
  }

  const selectedItem =
    selectedItemId &&
    itemDetail.status === "ready"
      ? itemDetail.item
      : null;

  const runScopeAction = useCallback(
    async (kind: "archive" | "read") => {
      if (
        latestQueryFenceKey.current !== queryFenceKey ||
        !queryIsCommitted
      ) {
        return;
      }
      const matchesCurrentScope = (state: BaseAppState) =>
        (state.libraryItemVersion ?? state.searchCorpusVersion) === sourceVersion &&
        state.activeView === activeView &&
        JSON.stringify(normalizeLibraryCoreFeedBrowseFilterV1(state.activeFilter)) ===
          normalizedFilterSignature;
      const currentState = store.getState();
      if (!matchesCurrentScope(currentState) || !executeLibraryScopeAction) return;
      await executeLibraryScopeAction({
        action: kind,
        filter: normalizedFilter,
        identityMode,
        query: inputHasQuery ? searchQuery.trim() : null,
        schemaVersion: LIBRARY_CORE_SCOPE_ACTION_SCHEMA_VERSION,
      });
    },
    [
      activeView,
      executeLibraryScopeAction,
      identityMode,
      inputHasQuery,
      normalizedFilter,
      normalizedFilterSignature,
      queryFenceKey,
      queryIsCommitted,
      searchQuery,
      sourceVersion,
      store,
    ],
  );

  return {
    archivableScopeCount: scopeCounts.archivableCount,
    archivedUnsavedCount: Math.max(
      0,
      libraryFacets.archivedCount - libraryFacets.savedArchivedCount,
    ),
    archiveScopeRead: () => runScopeAction("archive"),
    markScopeRead: () => runScopeAction("read"),
    savedArchivedCount: libraryFacets.savedArchivedCount,
    selectedItem,
    tags: libraryFacets.tags,
    unreadScopeCount: scopeCounts.unreadCount,
  };
}
