import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  isFriendAuthoredItem,
  matchesLibraryCoreFeedBrowseFilterV1,
  normalizeLibraryCoreFeedBrowseFilterV1,
  type Account,
  type BaseAppState,
  type FeedItem,
  type FilterOptions,
  type Friend,
  type Person,
} from "@freed/shared";

import { usePlatform } from "../context/PlatformContext.js";
import {
  collectArchivableFeedActionIds,
  collectUnreadFeedActionIds,
  getFeedActionCounts,
} from "../lib/feed-action-scope.js";
import { useLibraryFacetSummary } from "./useLibraryFacetSummary.js";

interface ScopeCounts {
  readonly archivableCount: number;
  readonly unreadCount: number;
}

interface PaletteScanState extends ScopeCounts {
  readonly archivedUnsavedCount: number;
  readonly savedArchivedCount: number;
  readonly sourceVersion: number;
  readonly status: "idle" | "loading" | "ready" | "failed";
  readonly tags: readonly string[];
}

interface ItemDetailState {
  readonly item: FeedItem | null;
  readonly key: string;
  readonly status: "loading" | "ready" | "failed";
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
const MAXIMUM_PALETTE_TAGS = 4_096;
const MAXIMUM_PALETTE_TAG_BYTES = 1_024;
const MAXIMUM_PALETTE_TAG_SET_BYTES = 8 * 1_048_576;
const TAG_ENCODER = new TextEncoder();
function emptyPaletteScan(
  status: PaletteScanState["status"],
  sourceVersion: number,
): PaletteScanState {
  return {
    ...EMPTY_COUNTS,
    archivedUnsavedCount: 0,
    savedArchivedCount: 0,
    sourceVersion,
    status,
    tags: [],
  };
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

function itemMatchesScope(
  item: FeedItem,
  filter: ReturnType<typeof normalizeLibraryCoreFeedBrowseFilterV1>,
  identityMode: "friends" | "all_content",
  persons: Record<string, Person>,
  accounts: Record<string, Account>,
  friends: Record<string, Friend>,
): boolean {
  return (
    (identityMode !== "friends" ||
      isFriendAuthoredItem(item, persons, accounts, friends)) &&
    matchesLibraryCoreFeedBrowseFilterV1(item, filter)
  );
}

function collectScopeActionIds(
  state: BaseAppState,
  filter: ReturnType<typeof normalizeLibraryCoreFeedBrowseFilterV1>,
  identityMode: "friends" | "all_content",
  kind: "archive" | "read",
): string[] {
  const ids: string[] = [];
  for (const item of state.items) {
    if (
      !itemMatchesScope(
        item,
        filter,
        identityMode,
        state.persons,
        state.accounts,
        state.friends,
      )
    ) {
      continue;
    }
    if (item.userState.hidden || item.userState.archived) continue;
    const eligible =
      kind === "read"
        ? !item.userState.readAt
        : item.userState.readAt && !item.userState.saved;
    if (eligible) {
      ids.push(item.globalId);
    }
  }
  return ids;
}

/**
 * Supply command-palette Library facts without mounting the Desktop corpus.
 *
 * Bulk execution scans bounded SQLite pages and retains only the matching
 * entity IDs needed for the mutation. Missing or failed readers fail closed.
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
    readLibraryFacetSummary,
    readLibraryItemDetail,
    scanLibraryItems,
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
  const normalizedFilter = useMemo(
    () => normalizeLibraryCoreFeedBrowseFilterV1(activeFilter),
    [activeFilter],
  );
  const compactCounts = useMemo(
    () => compactScopeCounts(activeFilter, identityMode, compactInputs),
    [activeFilter, compactInputs, identityMode],
  );
  const scanReaderAvailable = Boolean(scanLibraryItems);
  const libraryFacets = useLibraryFacetSummary(
    sourceVersion,
    enabled && Boolean(readLibraryFacetSummary),
  );
  const inputHasQuery = inputValue.trim().length > 0;
  const committedSearchHasQuery = searchQuery.trim().length > 0;
  const queryIsCommitted = inputValue.trim() === searchQuery.trim();
  const normalizedFilterSignature = JSON.stringify(normalizedFilter);
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
  const scanComplexScope = Boolean(
    activeView === "feed" && !inputHasQuery && compactCounts === null,
  );
  const scanNeedsFacets = !readLibraryFacetSummary;
  const scanNeeded =
    enabled && scanReaderAvailable && (scanComplexScope || scanNeedsFacets);
  const [paletteScan, setPaletteScan] = useState<PaletteScanState>(() =>
    emptyPaletteScan("idle", sourceVersion),
  );
  const detailKey = `${sourceVersion}:${selectedItemId ?? ""}`;
  const [itemDetail, setItemDetail] = useState<ItemDetailState>({
    item: null,
    key: "",
    status: "loading",
  });

  useEffect(() => {
    if (!scanNeeded || !scanLibraryItems) {
      setPaletteScan(emptyPaletteScan("idle", sourceVersion));
      return;
    }

    let cancelled = false;
    let unreadCount = 0;
    let archivableCount = 0;
    let archivedUnsavedCount = 0;
    let savedArchivedCount = 0;
    let tagBytes = 0;
    const tags = new Set<string>();
    const graphSnapshot = store.getState();
    setPaletteScan(emptyPaletteScan("loading", sourceVersion));
    void (async () => {
      await scanLibraryItems((page) => {
        if (cancelled) return "stop";
        for (const item of page) {
          if (scanNeedsFacets) {
            for (const tag of item.userState.tags ?? []) {
              if (!tags.has(tag)) {
                const encodedBytes = TAG_ENCODER.encode(tag).byteLength;
                if (
                  tags.size >= MAXIMUM_PALETTE_TAGS ||
                  encodedBytes > MAXIMUM_PALETTE_TAG_BYTES ||
                  tagBytes + encodedBytes > MAXIMUM_PALETTE_TAG_SET_BYTES
                ) {
                  throw new Error("SearchJump tag set exceeds its bounded contract");
                }
                tagBytes += encodedBytes;
              }
              tags.add(tag);
            }
            if (item.userState.archived) {
              if (item.userState.saved) savedArchivedCount += 1;
              else archivedUnsavedCount += 1;
            }
          }
          if (
            item.userState.hidden ||
            !scanComplexScope ||
            item.userState.archived ||
            !itemMatchesScope(
              item,
              normalizedFilter,
              identityMode,
              graphSnapshot.persons,
              graphSnapshot.accounts,
              graphSnapshot.friends,
            )
          ) {
            continue;
          }
          if (!item.userState.readAt) unreadCount += 1;
          else if (!item.userState.saved) archivableCount += 1;
        }
        return "continue";
      });
      if (!cancelled) {
        setPaletteScan({
          archivableCount,
          archivedUnsavedCount,
          savedArchivedCount,
          sourceVersion,
          status: "ready",
          tags: Array.from(tags).sort(),
          unreadCount,
        });
      }
    })()
      .catch(() => {
        if (!cancelled) {
          setPaletteScan(emptyPaletteScan("failed", sourceVersion));
        }
      });
    return () => {
      cancelled = true;
    };
  }, [
    identityMode,
    normalizedFilter,
    scanLibraryItems,
    scanComplexScope,
    scanNeedsFacets,
    scanNeeded,
    sourceVersion,
    store,
  ]);

  useEffect(() => {
    if (!enabled || !selectedItemId || !readLibraryItemDetail) {
      if (!enabled || !selectedItemId) {
        setItemDetail({ item: null, key: "", status: "loading" });
      }
      return;
    }
    let cancelled = false;
    setItemDetail({ item: null, key: detailKey, status: "loading" });
    void readLibraryItemDetail(selectedItemId)
      .then((item) => {
        if (!cancelled) {
          setItemDetail({
            item,
            key: detailKey,
            status: "ready",
          });
        }
      })
      .catch(() => {
        if (!cancelled) {
          setItemDetail({ item: null, key: detailKey, status: "failed" });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [detailKey, enabled, readLibraryItemDetail, selectedItemId]);

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
    itemDetail.key === detailKey &&
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
      if (!matchesCurrentScope(currentState)) return;
      if (inputHasQuery) {
        const ids =
          kind === "read"
            ? collectUnreadFeedActionIds(commandScopeItems)
            : collectArchivableFeedActionIds(commandScopeItems);
        if (kind === "read") await currentState.markItemsAsRead(ids);
        else await currentState.archiveItems(ids);
        return;
      }
      if (!scanLibraryItems) return;

      const ids: string[] = [];
      await scanLibraryItems((page) => {
        if (latestQueryFenceKey.current !== queryFenceKey) return "stop";
        const state = store.getState();
        if (!matchesCurrentScope(state)) return "stop";
        ids.push(
          ...collectScopeActionIds(
            { ...state, items: [...page] },
            normalizedFilter,
            identityMode,
            kind,
          ),
        );
        return "continue";
      });
      if (latestQueryFenceKey.current !== queryFenceKey) return;
      const state = store.getState();
      if (!matchesCurrentScope(state)) return;
      if (kind === "read") await state.markItemsAsRead(ids);
      else await state.archiveItems(ids);
    },
    [
      activeView,
      commandScopeItems,
      identityMode,
      inputHasQuery,
      normalizedFilter,
      normalizedFilterSignature,
      queryFenceKey,
      queryIsCommitted,
      scanLibraryItems,
      sourceVersion,
      store,
    ],
  );

  return {
    archivableScopeCount: scopeCounts.archivableCount,
    archivedUnsavedCount: scanNeedsFacets && paletteScanReady
      ? paletteScan.archivedUnsavedCount
      : Math.max(
          0,
          libraryFacets.archivedCount - libraryFacets.savedArchivedCount,
        ),
    archiveScopeRead: () => runScopeAction("archive"),
    markScopeRead: () => runScopeAction("read"),
    savedArchivedCount: scanNeedsFacets && paletteScanReady
      ? paletteScan.savedArchivedCount
      : libraryFacets.savedArchivedCount,
    selectedItem,
    tags: scanNeedsFacets && paletteScanReady
      ? paletteScan.tags
      : libraryFacets.tags,
    unreadScopeCount: scopeCounts.unreadCount,
  };
}
