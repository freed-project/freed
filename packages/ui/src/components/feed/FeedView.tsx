import {
  useState,
  useMemo,
  useEffect,
  useLayoutEffect,
  useCallback,
  useRef,
  memo,
} from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { toast } from "../Toast.js";
import { buildFeedRows } from "./feed-presentation.js";
import { useFeedPresentation } from "./useFeedPresentation.js";
import { FeedList } from "./FeedList.js";
import { ReaderView } from "./ReaderView.js";
import { FeedItem as FeedItemCard } from "./FeedItem.js";
import { useReadOnScrollTracker } from "./useReadOnScrollTracker.js";
import { useBoundedFeedItems } from "./useBoundedFeedItems.js";
import {
  resolveBoundedReaderRankingClock,
  savedFeedRankingClockMs,
  type BoundedReaderRankingClock,
} from "./saved-feed-ranking-clock.js";
import {
  applySavedFeedPresentationPatch,
  prepareSavedFeedPresentationPatch,
  projectSavedFeedLikePresentation,
  resolveSavedFeedSelectionPin,
  type SavedFeedSelectionPin,
} from "./saved-feed-presentation-patch.js";
import { AddFeedDialog } from "../AddFeedDialog.js";
import { useAppStore, usePlatform } from "../../context/PlatformContext.js";
import { useSearchResults } from "../../hooks/useSearchResults.js";
import { useLibraryFacetSummary } from "../../hooks/useLibraryFacetSummary.js";
import { useLibraryItemDetail } from "../../hooks/useLibraryItemDetail.js";
import { useIsMobile } from "../../hooks/useIsMobile.js";
import { useIsMobileDevice } from "../../hooks/useIsMobileDevice.js";
import { type FeedItem } from "@freed/shared";
import { runFeedLayoutTransition } from "../../lib/view-transitions.js";
import {
  animationAwareScrollBehavior,
  resolveAnimationIntensity,
} from "../../lib/animation-preferences.js";
import { useDeviceDisplayPreferences } from "../../lib/device-display-preferences.js";

// ─── Compact sidebar panel for dual-column mode ────────────────────────────

const MIN_PANEL_WIDTH = 100;
const MAX_PANEL_WIDTH = 500;
const DEFAULT_PANEL_WIDTH = 150;
const NARROW_THRESHOLD = 150;
const COMPACT_CARD_GAP = 8;
const COMPACT_CARD_LEFT_PAD = 8;
const COMPACT_CARD_RIGHT_PAD = 4;
const COMPACT_PANEL_RESIZE_HANDLE_WIDTH = 16;
const EMPTY_FEED_ITEMS: FeedItem[] = [];

// Card geometry: all cards are square (width × width), including story tiles.
// Wrapper padding and row spacing match the nav-button radius token at 10px.
const CARD_H_PAD = COMPACT_CARD_LEFT_PAD + COMPACT_CARD_RIGHT_PAD;
const CARD_V_GAP = COMPACT_CARD_GAP;
const PAGED_FEED_PAGE_SIZE = 128;
const PAGED_FEED_RESIDENT_PAGE_LIMIT = 2;

interface CompactFeedPanelProps {
  storyGroups: ReadonlyMap<string, string>;
  items: FeedItem[];
  selectedId: string;
  selectionMoveDirection?: -1 | 0 | 1;
  onItemClick: (item: FeedItem) => void;
  markReadOnScroll: boolean;
  showReadInGrayscale: boolean;
  markItemsAsRead: (ids: string[]) => Promise<void>;
  width: number;
  leadingOffset?: string;
  onLoadMore?: () => void;
  hasMore?: boolean;
  onLoadPrevious?: () => void;
  hasPrevious?: boolean;
  boundedWindowStartIndex?: number;
}

const CompactFeedPanel = memo(function CompactFeedPanel({
  items,
  storyGroups,
  selectedId,
  selectionMoveDirection = 0,
  onItemClick,
  markReadOnScroll,
  showReadInGrayscale,
  markItemsAsRead,
  width,
  leadingOffset,
  onLoadMore,
  hasMore = false,
  onLoadPrevious,
  hasPrevious = false,
  boundedWindowStartIndex = 0,
}: CompactFeedPanelProps) {
  const parentRef = useRef<HTMLDivElement>(null);
  const cardHeight = width - CARD_H_PAD;
  const columns = Math.max(
    1,
    Math.min(3, Math.floor((cardHeight + CARD_V_GAP) / 88)),
  );
  // The reader receives the same flattened display sequence as keyboard
  // navigation. Resizing only changes geometry; it never ranks that sequence.
  const rows = useMemo(
    () => buildFeedRows(items, columns, storyGroups),
    [items, columns, storyGroups],
  );
  const rowHeight = useCallback(
    (index: number) => {
      const row = rows[index];
      if (row.type === "item" || row.numCols === 1) return cardHeight;
      const tileWidth =
        (cardHeight - (row.numCols - 1) * CARD_V_GAP) / row.numCols;
      return Math.min(cardHeight, (tileWidth * 4) / 3);
    },
    [rows, cardHeight],
  );
  const estimateItemSize = useCallback(
    (index: number) =>
      rowHeight(index) + CARD_V_GAP + (index === 0 ? CARD_V_GAP : 0),
    [rowHeight],
  );
  const layoutKey = JSON.stringify([width, rows.map((row) => row.key)]);
  const readListKey = JSON.stringify([boundedWindowStartIndex, layoutKey]);
  const getScrollMetrics = useCallback(
    () => ({
      rawScrollTop: parentRef.current?.scrollTop ?? 0,
      viewportHeight: parentRef.current?.clientHeight ?? 0,
    }),
    [],
  );
  const processReadOnScroll = useReadOnScrollTracker({
    surface: "compact-feed",
    listKey: readListKey,
    layoutKey,
    rows,
    items,
    markReadOnScroll,
    getScrollMetrics,
    markItemsAsRead,
  });
  const committedLayoutKey = useRef(layoutKey);
  const restoringAnchor = useRef(false);
  const virtualizer = useVirtualizer({
    count: rows.length,
    getItemKey: (index) => rows[index].key,
    getScrollElement: () => parentRef.current,
    estimateSize: estimateItemSize,
    overscan: 3,
    onChange: (instance) => {
      if (restoringAnchor.current || committedLayoutKey.current !== layoutKey) return;
      processReadOnScroll(instance, "element");
      const visible = instance.getVirtualItems();
      if (!visible.length) return;
      if (
        hasMore &&
        visible[visible.length - 1].index >= Math.max(0, rows.length - 5)
      ) {
        onLoadMore?.();
      } else if (hasPrevious && visible[0].index <= 4) {
        onLoadPrevious?.();
      }
    },
  });
  const anchorRef = useRef<{ id: string; offset: number } | null>(null);
  // Cleanup captures old geometry; setup restores against the newly packed
  // rows. This covers width changes, page shifts and optimistic removals.
  useLayoutEffect(() => {
    restoringAnchor.current = true;
    committedLayoutKey.current = layoutKey;
    virtualizer.measure();
    const anchor = anchorRef.current;
    if (anchor && parentRef.current) {
      let start = 0;
      for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        const members = row.type === "item" ? [row.item] : row.items;
        if (members.some((item) => item.globalId === anchor.id)) {
          parentRef.current.scrollTop =
            start + Math.min(anchor.offset, estimateItemSize(i) - 1);
          break;
        }
        start += estimateItemSize(i);
      }
    }
    restoringAnchor.current = false;
    processReadOnScroll(virtualizer, "element");
    return () => {
      const scrollTop = parentRef.current?.scrollTop ?? 0;
      let start = 0;
      for (let i = 0; i < rows.length; i++) {
        const end = start + estimateItemSize(i);
        if (end > scrollTop) {
          const row = rows[i];
          anchorRef.current = {
            id: row.type === "item" ? row.item.globalId : row.items[0].globalId,
            offset: scrollTop - start,
          };
          break;
        }
        start = end;
      }
    };
  }, [layoutKey, width, virtualizer]);

  const didInitialScroll = useRef(false);
  useLayoutEffect(() => {
    const selectedIndex = rows.findIndex((row) =>
      row.type === "item"
        ? row.item.globalId === selectedId
        : row.items.some((item) => item.globalId === selectedId),
    );
    if (selectedIndex < 0) return;
    virtualizer.scrollToIndex(selectedIndex, {
      align: selectionMoveDirection === 0 ? "center" : "auto",
      behavior: animationAwareScrollBehavior(
        didInitialScroll.current ? "smooth" : "auto",
      ),
    });
    didInitialScroll.current = true;
    // Only a selection move should recenter the reader, never a page append.
  }, [selectedId, selectionMoveDirection, virtualizer]);

  return (
    <div
      ref={parentRef}
      data-testid="compact-feed-panel-scroll-container"
      className="theme-scroll-fade-y shrink-0 min-h-0 overflow-y-auto overflow-x-visible minimal-scroll bg-transparent"
      style={{ width, marginInlineStart: leadingOffset }}
    >
      <div
        style={{ height: virtualizer.getTotalSize() }}
        className="relative w-full"
      >
        {virtualizer.getVirtualItems().map((vi) => {
          const row = rows[vi.index];
          const members = row.type === "item" ? [row.item] : row.items;
          return (
            <div
              key={vi.key}
              data-compact-panel-index={vi.index}
              data-index={vi.index}
              style={{
                position: "absolute",
                top: 0,
                left: 0,
                width: "100%",
                transform: `translateY(${vi.start}px)`,
              }}
            >
              <div
                style={{
                  paddingLeft: COMPACT_CARD_LEFT_PAD,
                  paddingRight: COMPACT_CARD_RIGHT_PAD,
                  paddingBottom: CARD_V_GAP,
                  paddingTop: vi.index === 0 ? CARD_V_GAP : undefined,
                }}
              >
                <div
                  style={{
                    display: "grid",
                    gap: CARD_V_GAP,
                    gridTemplateColumns: `repeat(${members.length}, minmax(0, 1fr))`,
                  }}
                >
                  {members.map((item) => (
                    <FeedItemCard
                      key={item.globalId}
                      item={item}
                      compact
                      narrow={cardHeight / members.length < NARROW_THRESHOLD}
                      selected={item.globalId === selectedId}
                      showReadInGrayscale={showReadInGrayscale}
                      onClick={() => onItemClick(item)}
                      storyHeight={rowHeight(vi.index)}
                    />
                  ))}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
});

// ─── Helpers ────────────────────────────────────────────────────────────────

export function FeedView() {
  const platform = usePlatform();
  const {
    addRssFeed,
    openBoundedFeedReader,
    openBoundedFriendsFeedReader,
    openBoundedSavedFeedReader,
    openUrl,
    queryLibraryCore,
    readLibraryAccountDetail,
  } = platform;
  const readOnly = platform.interactionMode === "read-only";
  const canAddFeeds = !!addRssFeed;
  const activeFilter = useAppStore((s) => s.activeFilter);
  const searchQuery = useAppStore((s) => s.searchQuery);
  const searchCorpusVersion = useAppStore((s) => s.searchCorpusVersion);
  const libraryItemVersion = useAppStore(
    (state) => state.libraryItemVersion ?? state.searchCorpusVersion,
  );
  const savedFeedVersion = useAppStore(
    (state) => state.savedFeedVersion ?? state.searchCorpusVersion,
  );
  const savedFeedPresentationPatch = useAppStore(
    (state) => state.savedFeedPresentationPatch ?? null,
  );
  const acknowledgeSavedFeedPresentationPatch = useAppStore(
    (state) => state.acknowledgeSavedFeedPresentationPatch,
  );
  const isInitialized = useAppStore((s) => s.isInitialized);
  const selectedItemId = useAppStore((s) => s.selectedItemId);
  const setSelectedItem = useAppStore((s) => s.setSelectedItem);
  const setSelectedAccount = useAppStore((s) => s.setSelectedAccount);
  const setSelectedPerson = useAppStore((s) => s.setSelectedPerson);
  const setActiveView = useAppStore((s) => s.setActiveView);
  const setVisibleFeedTotalCount = useAppStore(
    (s) => s.setVisibleFeedTotalCount,
  );
  const markAsRead = useAppStore((s) => s.markAsRead);
  const markItemsAsRead = useAppStore((s) => s.markItemsAsRead);
  const toggleSaved = useAppStore((s) => s.toggleSaved);
  const toggleArchived = useAppStore((s) => s.toggleArchived);
  const toggleLiked = useAppStore((s) => s.toggleLiked);
  const libraryFacets = useLibraryFacetSummary(searchCorpusVersion);
  const [deviceDisplay] = useDeviceDisplayPreferences();
  const friendsMode = deviceDisplay.friendsMode;
  const savedContentSortMode = deviceDisplay.savedContentSortMode;

  const handleOpenCommentUrl = useCallback(
    (url: string) => {
      if (openUrl) {
        openUrl(url);
      } else {
        window.open(url, "_blank", "noopener,noreferrer");
      }
    },
    [openUrl],
  );
  const openAuthorInFriends = useCallback(
    async (item: FeedItem) => {
      try {
        if (!queryLibraryCore) {
          throw new Error("SQLite author lookup is unavailable");
        }
        const scope = await queryLibraryCore({
          authorId: item.author.id,
          feedUrl: null,
          platform: item.platform,
          queryId: "filter_scope_summary_v1",
          schemaVersion: 1,
        });
        const accountId = scope.accountId;
        if (!accountId) {
          throw new Error("No Library account is associated with this author");
        }
        const account = await readLibraryAccountDetail?.(accountId);
        setSelectedItem(null);
        // Each selection action clears the other kind of selection.
        if (account?.personId) setSelectedPerson(account.personId);
        else setSelectedAccount(accountId);
        setActiveView("friends");
      } catch {
        toast.error("Freed could not open this author from the Library.");
      }
    },
    [
      queryLibraryCore,
      setActiveView,
      setSelectedAccount,
      setSelectedItem,
      readLibraryAccountDetail,
      setSelectedPerson,
    ],
  );

  const [addFeedOpen, setAddFeedOpen] = useState(false);
  const readerGroupWindow = useRef<ReadonlyMap<string, string>>(new Map());
  const [readerWindow, setReaderWindow] = useState<readonly FeedItem[] | null>(
    null,
  );
  const savedBoundedFeedEligible =
    Boolean(openBoundedSavedFeedReader) &&
    isInitialized &&
    searchQuery.trim() === "" &&
    friendsMode === "all_content" &&
    activeFilter.savedOnly;
  const ordinaryBoundedFeedEligible =
    Boolean(openBoundedFeedReader) &&
    isInitialized &&
    searchQuery.trim() === "" &&
    friendsMode === "all_content" &&
    !activeFilter.savedOnly;
  const friendsBoundedFeedEligible =
    Boolean(openBoundedFriendsFeedReader) &&
    isInitialized &&
    searchQuery.trim() === "" &&
    friendsMode === "friends" &&
    !activeFilter.savedOnly;
  const pagedBoundedFeedEligible =
    savedBoundedFeedEligible || friendsBoundedFeedEligible;
  const boundedFeedEligible =
    pagedBoundedFeedEligible || ordinaryBoundedFeedEligible;
  const boundedFeedSourceVersion = savedBoundedFeedEligible
    ? savedFeedVersion
    : libraryItemVersion;
  const boundedReaderIdentity = JSON.stringify({
    filter: activeFilter,
    kind: savedBoundedFeedEligible
      ? "saved"
      : friendsBoundedFeedEligible
        ? "friends"
        : "ordinary",
    sortMode: savedBoundedFeedEligible ? savedContentSortMode : null,
    sourceVersion: boundedFeedSourceVersion,
  });
  const boundedSelectionIdentity = JSON.stringify({
    filter: activeFilter,
    kind: savedBoundedFeedEligible
      ? "saved"
      : friendsBoundedFeedEligible
        ? "friends"
        : "ordinary",
    sortMode: savedBoundedFeedEligible ? savedContentSortMode : null,
  });
  const boundedReaderRankingClockRef = useRef<BoundedReaderRankingClock | null>(
    null,
  );
  boundedReaderRankingClockRef.current = resolveBoundedReaderRankingClock(
    boundedReaderRankingClockRef.current,
    boundedReaderIdentity,
    Date.now(),
  );
  const identityRankingClockMs =
    boundedReaderRankingClockRef.current.rankingClockMs;
  const boundedReaderRankingClockMs = savedBoundedFeedEligible
    ? savedFeedRankingClockMs(savedContentSortMode, identityRankingClockMs)
    : identityRankingClockMs;
  const renderedReaderIdentityRef = useRef(boundedReaderIdentity);
  const renderedSelectionIdentityRef = useRef(boundedSelectionIdentity);
  const boundedFeedStatusIsCurrent =
    renderedReaderIdentityRef.current === boundedReaderIdentity;
  const boundedFeedPresentationMatchesSelection =
    renderedSelectionIdentityRef.current === boundedSelectionIdentity;
  useLayoutEffect(() => {
    renderedReaderIdentityRef.current = boundedReaderIdentity;
    renderedSelectionIdentityRef.current = boundedSelectionIdentity;
  }, [boundedReaderIdentity, boundedSelectionIdentity]);
  const activeBoundedFeedReader = useMemo(() => {
    if (savedBoundedFeedEligible) {
      if (!openBoundedSavedFeedReader) return undefined;
      return (filter: typeof activeFilter, rankingClockMs: number) =>
        openBoundedSavedFeedReader(
          filter,
          savedContentSortMode,
          rankingClockMs,
        );
    }
    if (friendsBoundedFeedEligible) return openBoundedFriendsFeedReader;
    return openBoundedFeedReader;
  }, [
    openBoundedFeedReader,
    openBoundedFriendsFeedReader,
    openBoundedSavedFeedReader,
    friendsBoundedFeedEligible,
    savedBoundedFeedEligible,
    savedContentSortMode,
  ]);
  const {
    feed: boundedFeed,
    retry: retryBoundedFeed,
    loadMore: loadMoreBoundedItems,
    loadPrevious: loadPreviousBoundedItems,
    patchItems: patchBoundedItems,
  } = useBoundedFeedItems({
    activeFilter,
    eligible: boundedFeedEligible,
    maxPageItems: PAGED_FEED_PAGE_SIZE,
    maxResidentPages: PAGED_FEED_RESIDENT_PAGE_LIMIT,
    openReader: activeBoundedFeedReader,
    rankingClockMs: boundedReaderRankingClockMs,
    sourceVersion: boundedFeedSourceVersion,
  });
  const boundedFeedReadyIsCurrent =
    boundedFeedStatusIsCurrent && boundedFeed.status === "ready";
  const boundedFeedPresentationIsAvailable =
    boundedFeedPresentationMatchesSelection &&
    boundedFeed.items.length > 0 &&
    (boundedFeed.status === "ready" || boundedFeed.status === "loading");
  const handleItemSave = useCallback(
    (item: FeedItem) => {
      patchBoundedItems((candidate) => {
        if (candidate.globalId !== item.globalId) return candidate;
        const saved = !candidate.userState.saved;
        if (activeFilter.savedOnly && !saved) return null;
        return {
          ...candidate,
          userState: { ...candidate.userState, saved },
        };
      });
      return toggleSaved(item.globalId);
    },
    [activeFilter.savedOnly, patchBoundedItems, toggleSaved],
  );
  // Only offer archive action on non-archived views; archived view shows the item already.
  const handleItemArchive = useCallback(
    (item: FeedItem) => {
      patchBoundedItems((candidate) =>
        candidate.globalId === item.globalId ? null : candidate,
      );
      return toggleArchived(item.globalId);
    },
    [patchBoundedItems, toggleArchived],
  );
  const handleItemLike = useCallback(
    (item: FeedItem) => {
      patchBoundedItems((candidate) =>
        candidate.globalId === item.globalId
          ? projectSavedFeedLikePresentation(candidate, Date.now())
          : candidate,
      );
      return toggleLiked?.(item.globalId);
    },
    [patchBoundedItems, toggleLiked],
  );
  const markBoundedItemsAsRead = useCallback(
    async (ids: string[]) => {
      if (readOnly) return;
      if (ids.length > 0) {
        const readIds = new Set(ids);
        const readAt = Date.now();
        patchBoundedItems((candidate) =>
          readIds.has(candidate.globalId) && !candidate.userState.readAt
            ? {
                ...candidate,
                userState: { ...candidate.userState, readAt },
              }
            : candidate,
        );
      }
      await markItemsAsRead(ids);
    },
    [markItemsAsRead, patchBoundedItems, readOnly],
  );

  // Search is a separate bounded SQLite window. Ordinary browsing comes from
  // the feed query above and never falls back to a renderer-held corpus.
  const { filteredItems, isSearching } = useSearchResults(
    searchQuery,
    activeFilter,
    searchCorpusVersion,
    friendsMode,
    libraryItemVersion,
  );
  const rankedItems = useMemo(() => {
    if (boundedFeedPresentationIsAvailable) return boundedFeed.items;
    return isSearching ? filteredItems : EMPTY_FEED_ITEMS;
  }, [
    boundedFeed.items,
    boundedFeedPresentationIsAvailable,
    filteredItems,
    isSearching,
  ]);
  const [feedColumns, setFeedColumns] = useState(3);
  const presentation = useFeedPresentation(
    rankedItems,
    JSON.stringify([boundedSelectionIdentity, searchQuery]),
    feedColumns > 1,
  );
  const visibleItems = presentation.items;
  useEffect(() => {
    if (boundedFeedPresentationIsAvailable) {
      setVisibleFeedTotalCount(boundedFeed.totalCount);
      return;
    }
    setVisibleFeedTotalCount(0);
  }, [
    boundedFeed.totalCount,
    boundedFeedPresentationIsAvailable,
    setVisibleFeedTotalCount,
  ]);

  const dualColumnMode = deviceDisplay.dualColumnMode;
  const markReadOnScroll = useAppStore(
    (s) => s.preferences.display.reading.markReadOnScroll,
  );
  const showReadInGrayscale = useAppStore(
    (s) => s.preferences.display.reading.showReadInGrayscale,
  );
  const animationIntensity = useAppStore((s) =>
    resolveAnimationIntensity(s.preferences.display.animationIntensity),
  );
  const isMobileViewport = useIsMobile();
  const isMobileDevice = useIsMobileDevice();
  const autoCollapseReaderRail = !isMobileDevice && isMobileViewport;
  const canShowInlineReader = !isMobileDevice;
  const showInlineReader = !!selectedItemId && canShowInlineReader;
  const showDualColumn =
    dualColumnMode && canShowInlineReader && !autoCollapseReaderRail;
  const desktopSidebarMode = deviceDisplay.sidebarMode;
  const compactRailLeadingOffset =
    !isMobileDevice && desktopSidebarMode !== "closed"
      ? `-${COMPACT_CARD_LEFT_PAD}px`
      : undefined;

  const [focusedIndex, setFocusedIndex] = useState<number>(-1);
  const previousVisibleItems = useRef(visibleItems);
  useLayoutEffect(() => {
    if (previousVisibleItems.current !== visibleItems) {
      const focusedId = previousVisibleItems.current[focusedIndex]?.globalId;
      if (focusedId)
        setFocusedIndex(
          visibleItems.findIndex((item) => item.globalId === focusedId),
        );
      previousVisibleItems.current = visibleItems;
    }
  }, [visibleItems, focusedIndex]);
  const [keyboardFocusDirection, setKeyboardFocusDirection] = useState<
    -1 | 0 | 1
  >(0);
  const [compactSelectionDirection, setCompactSelectionDirection] = useState<
    -1 | 0 | 1
  >(0);
  const pendingReaderMoveRef = useRef<{
    readonly direction: -1 | 1;
    readonly selectedItemId: string;
  } | null>(null);
  const previousWindowStartRef = useRef(boundedFeed.windowStartIndex);
  useLayoutEffect(() => {
    const previousWindowStart = previousWindowStartRef.current;
    previousWindowStartRef.current = boundedFeed.windowStartIndex;
    const shift = boundedFeed.windowStartIndex - previousWindowStart;
    if (shift === 0) return;
    setFocusedIndex((current) => {
      if (current < 0) return current;
      // A restored leading page shifts every resident row down by its length.
      if (shift < 0) return current - shift;
      return current < shift ? -1 : current - shift;
    });
  }, [boundedFeed.windowStartIndex]);
  // The store keeps only the selection ID. Paged bounded feeds additionally
  // pin one compact card so page eviction cannot dismiss the reader.
  const [selectedItemPin, setSelectedItemPin] =
    useState<SavedFeedSelectionPin | null>(null);
  const residentSelectedItem = useMemo(
    () =>
      selectedItemId
        ? (visibleItems.find((item) => item.globalId === selectedItemId) ??
          null)
        : null,
    [selectedItemId, visibleItems],
  );
  useLayoutEffect(() => {
    setSelectedItemPin((current) =>
      resolveSavedFeedSelectionPin({
        current,
        eligible: boundedFeedEligible,
        readerIdentity: boundedSelectionIdentity,
        residentSelectedItem,
        selectedItemId,
      }),
    );
  }, [
    boundedSelectionIdentity,
    boundedFeedEligible,
    residentSelectedItem,
    selectedItemId,
  ]);
  const currentSelectedItemPin =
    selectedItemPin?.readerIdentity === boundedSelectionIdentity &&
    selectedItemPin.selectedItemId === selectedItemId
      ? selectedItemPin.item
      : null;
  // A cold deep link can name an item outside the resident feed pages. Read
  // exactly that row without expanding the bounded feed or selecting a neighbor.
  const selectedItemDetail = useLibraryItemDetail(
    selectedItemId,
    libraryItemVersion,
  );
  const selectedItem =
    residentSelectedItem ??
    (boundedFeedEligible ? currentSelectedItemPin : null) ??
    selectedItemDetail.item;
  useEffect(() => {
    const patch = savedFeedPresentationPatch;
    if (
      !pagedBoundedFeedEligible ||
      !boundedFeedStatusIsCurrent ||
      !patch ||
      patch.sourceVersion !== savedFeedVersion ||
      boundedFeed.status === "loading" ||
      boundedFeed.status === "idle"
    ) {
      return;
    }

    const prepared = prepareSavedFeedPresentationPatch(patch);
    if (boundedFeed.status === "ready") {
      patchBoundedItems((item) =>
        applySavedFeedPresentationPatch(item, prepared),
      );
    }
    setSelectedItemPin((current) =>
      current?.readerIdentity === boundedSelectionIdentity &&
      current.selectedItemId === selectedItemId
        ? {
            ...current,
            item: applySavedFeedPresentationPatch(current.item, prepared),
          }
        : current,
    );
    acknowledgeSavedFeedPresentationPatch?.(
      patch.sourceVersion,
      patch.revision,
    );
  }, [
    acknowledgeSavedFeedPresentationPatch,
    boundedFeed.status,
    boundedFeedStatusIsCurrent,
    boundedReaderIdentity,
    boundedSelectionIdentity,
    patchBoundedItems,
    pagedBoundedFeedEligible,
    savedFeedPresentationPatch,
    savedFeedVersion,
    selectedItemId,
  ]);
  const readerItems = useMemo(() => {
    const itemById = new Map(visibleItems.map((item) => [item.globalId, item]));
    const stableItems = readerWindow
      ? readerWindow.map((item) => itemById.get(item.globalId) ?? item)
      : [];
    const stableIds = new Set(stableItems.map((item) => item.globalId));
    const residentItems =
      stableItems.length === 0
        ? visibleItems
        : [
            ...stableItems,
            ...visibleItems.filter((item) => !stableIds.has(item.globalId)),
          ];
    const pinnedSelection =
      boundedFeedEligible &&
      selectedItem?.globalId === selectedItemId &&
      !residentItems.some((item) => item.globalId === selectedItemId)
        ? selectedItem
        : null;
    return pinnedSelection
      ? [pinnedSelection, ...residentItems]
      : residentItems;
  }, [
    readerWindow,
    boundedFeedEligible,
    selectedItem,
    selectedItemId,
    visibleItems,
  ]);

  const readerStoryGroups = useMemo(() => {
    const groups = new Map<string, string>();
    for (const item of readerItems) {
      const group = readerWindow
        ? (readerGroupWindow.current.get(item.globalId) ??
          presentation.groupById.get(item.globalId))
        : presentation.groupById.get(item.globalId);
      if (group) groups.set(item.globalId, group);
    }
    return groups;
  }, [readerItems, readerWindow, presentation.groupById]);

  const openItem = useCallback(
    (item: FeedItem) => {
      const selectItem = () => {
        if (!readOnly) {
          const readAt = Date.now();
          patchBoundedItems((candidate) =>
            candidate.globalId === item.globalId && !candidate.userState.readAt
              ? {
                  ...candidate,
                  userState: { ...candidate.userState, readAt },
                }
              : candidate,
          );
        }
        setSelectedItem(item.globalId);
        if (readOnly) platform.onReadOnlyItemOpened?.(item);
        if (!readOnly) markAsRead(item.globalId);
      };

      if (showDualColumn && !selectedItemId) {
        // Opening the rail pins exactly the bounded window the user can see.
        // SQLite mutations may refresh the underlying reader while the rail is
        // open. Retaining this visible window prevents those refreshes from
        // collapsing keyboard navigation to the selected row alone.
        readerGroupWindow.current = presentation.groupById;
        setReaderWindow([...visibleItems]);
        runFeedLayoutTransition(selectItem);
        return;
      }

      selectItem();
    },
    [
      markAsRead,
      patchBoundedItems,
      platform.onReadOnlyItemOpened,
      presentation.groupById,
      readOnly,
      runFeedLayoutTransition,
      selectedItemId,
      setSelectedItem,
      showDualColumn,
      visibleItems,
    ],
  );

  const openItemDirect = useCallback(
    (item: FeedItem) => {
      setCompactSelectionDirection(0);
      openItem(item);
    },
    [openItem],
  );

  useLayoutEffect(() => {
    const pending = pendingReaderMoveRef.current;
    if (!pending) return;
    const currentIndex = readerItems.findIndex(
      (item) => item.globalId === pending.selectedItemId,
    );
    if (currentIndex < 0) return;
    const nextItem = readerItems[currentIndex + pending.direction];
    if (!nextItem) return;

    pendingReaderMoveRef.current = null;
    setCompactSelectionDirection(pending.direction);
    setFocusedIndex(currentIndex + pending.direction);
    openItem(nextItem);
  }, [openItem, readerItems]);

  const closeItem = useCallback(() => {
    setCompactSelectionDirection(0);
    setReaderWindow(null);
    if (showDualColumn && selectedItemId) {
      runFeedLayoutTransition(() => {
        setSelectedItem(null);
      });
      return;
    }
    setSelectedItem(null);
  }, [
    runFeedLayoutTransition,
    selectedItemId,
    setSelectedItem,
    showDualColumn,
  ]);

  // Keyboard navigation: j/k to move, Enter/o to open, Escape to close.
  // The HTMLInputElement guard means j/k won't fire while the search bar is focused.
  useLayoutEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      const isReaderArrowKey =
        !!selectedItemId &&
        showDualColumn &&
        (e.key === "ArrowDown" || e.key === "ArrowUp");
      if (
        !isReaderArrowKey &&
        (e.target instanceof HTMLInputElement ||
          e.target instanceof HTMLTextAreaElement)
      )
        return;

      if (selectedItemId) {
        if (showDualColumn && (e.key === "ArrowDown" || e.key === "ArrowUp")) {
          e.preventDefault();
          const currentIndex = readerItems.findIndex(
            (item) => item.globalId === selectedItemId,
          );
          if (currentIndex < 0) return;

          const direction = e.key === "ArrowDown" ? 1 : -1;
          const nextIndex = Math.max(
            0,
            Math.min(currentIndex + direction, readerItems.length - 1),
          );
          if (nextIndex === currentIndex) {
            const canLoadNext =
              direction > 0 &&
              boundedFeed.windowStartIndex + readerItems.length <
                boundedFeed.totalCount;
            const canLoadPrevious =
              direction < 0 && boundedFeed.windowStartIndex > 0;
            if (canLoadNext) {
              pendingReaderMoveRef.current = {
                direction,
                selectedItemId,
              };
              if (boundedFeed.hasMore) loadMoreBoundedItems();
            } else if (canLoadPrevious) {
              pendingReaderMoveRef.current = {
                direction,
                selectedItemId,
              };
              if (boundedFeed.hasPrevious) loadPreviousBoundedItems();
            }
            return;
          }

          const nextItem = readerItems[nextIndex];
          if (!nextItem) return;

          setCompactSelectionDirection(direction);
          setFocusedIndex(nextIndex);
          openItem(nextItem);
          return;
        }

        if (e.key === "Escape") closeItem();
        return;
      }

      if (e.key === "j" || e.key === "ArrowDown") {
        e.preventDefault();
        setKeyboardFocusDirection(1);
        setFocusedIndex((prev) => Math.min(prev + 1, visibleItems.length - 1));
      } else if (e.key === "k" || e.key === "ArrowUp") {
        e.preventDefault();
        setKeyboardFocusDirection(-1);
        setFocusedIndex((prev) => Math.max(prev - 1, 0));
      } else if ((e.key === "Enter" || e.key === "o") && focusedIndex >= 0) {
        const item = visibleItems[focusedIndex];
        if (item) openItemDirect(item);
      }
    };

    document.addEventListener("keydown", handleKey, { capture: true });
    return () =>
      document.removeEventListener("keydown", handleKey, { capture: true });
  }, [
    selectedItemId,
    showDualColumn,
    visibleItems,
    readerItems,
    boundedFeed.hasMore,
    boundedFeed.hasPrevious,
    boundedFeed.totalCount,
    boundedFeed.windowStartIndex,
    loadMoreBoundedItems,
    loadPreviousBoundedItems,
    focusedIndex,
    openItem,
    openItemDirect,
    closeItem,
  ]);

  // Reset keyboard focus when the active filter or search query changes.
  useEffect(() => {
    setCompactSelectionDirection(0);
    setKeyboardFocusDirection(0);
    setFocusedIndex(-1);
    setReaderWindow(null);
  }, [activeFilter, searchQuery, savedContentSortMode]);

  const handleFocusChange = useCallback((index: number) => {
    setKeyboardFocusDirection(0);
    setFocusedIndex(index);
  }, []);

  // ─── Dual-column drag-resize ───────────────────────────────────────────────

  const [panelWidth, setPanelWidth] = useState(DEFAULT_PANEL_WIDTH);
  const [railMounted, setRailMounted] = useState(showDualColumn);
  const [railExpanded, setRailExpanded] = useState(showDualColumn);
  const isDraggingRef = useRef(false);
  const dragStartXRef = useRef(0);
  const dragStartWidthRef = useRef(0);
  const previousShowDualColumnRef = useRef(showDualColumn);
  const railMotionDisabled = animationIntensity === "none";

  useEffect(() => {
    const wasShowingDualColumn = previousShowDualColumnRef.current;
    previousShowDualColumnRef.current = showDualColumn;

    if (showDualColumn) {
      setRailMounted(true);

      if (
        railMotionDisabled ||
        wasShowingDualColumn ||
        typeof window === "undefined"
      ) {
        setRailExpanded(true);
        return;
      }

      setRailExpanded(false);
      const frameId = window.requestAnimationFrame(() => {
        setRailExpanded(true);
      });

      return () => window.cancelAnimationFrame(frameId);
    }

    setRailExpanded(false);

    if (railMotionDisabled) {
      setRailMounted(false);
    }
  }, [railMotionDisabled, showDualColumn]);

  useLayoutEffect(() => {
    if (typeof document === "undefined") return;
    document.documentElement.style.setProperty(
      "--freed-reader-rail-width",
      showDualColumn ? `${panelWidth}px` : "0px",
    );
  }, [panelWidth, showDualColumn]);

  const railTransition =
    railMotionDisabled || isDraggingRef.current
      ? "none"
      : animationIntensity === "light"
        ? "width 140ms ease-out, margin-inline-start 140ms ease-out, opacity 120ms ease-out"
        : "width 220ms ease, margin-inline-start 220ms ease, opacity 180ms ease";
  const railWidth = railExpanded
    ? panelWidth + COMPACT_PANEL_RESIZE_HANDLE_WIDTH
    : 0;
  const railSlotStyle = {
    width: `${railWidth}px`,
    marginInlineStart: railExpanded ? compactRailLeadingOffset : undefined,
    opacity: railExpanded ? 1 : 0,
    pointerEvents: railExpanded ? undefined : "none",
    transition: railTransition,
  } satisfies React.CSSProperties;
  const railContentStyle = {
    width: `${panelWidth + COMPACT_PANEL_RESIZE_HANDLE_WIDTH}px`,
    // Keep the rail inside both sidebar frame gaps while primary content spans
    // the full height below the toolbar.
    height:
      "calc(100% - var(--feed-card-gap, 8px) - var(--feed-card-gap, 8px))",
    marginTop: "var(--feed-card-gap, 8px)",
  } satisfies React.CSSProperties;

  const handleRailTransitionEnd = useCallback(
    (e: React.TransitionEvent<HTMLDivElement>) => {
      if (e.target !== e.currentTarget || e.propertyName !== "width") return;
      if (!showDualColumn && !railExpanded) {
        setRailMounted(false);
      }
    },
    [railExpanded, showDualColumn],
  );

  const handleDragStart = useCallback(
    (e: React.PointerEvent) => {
      e.preventDefault();
      isDraggingRef.current = true;
      dragStartXRef.current = e.clientX;
      dragStartWidthRef.current = panelWidth;
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
    },
    [panelWidth],
  );

  const handleDragMove = useCallback((e: React.PointerEvent) => {
    if (!isDraggingRef.current) return;
    const dx = e.clientX - dragStartXRef.current;
    const clamped = Math.max(
      MIN_PANEL_WIDTH,
      Math.min(MAX_PANEL_WIDTH, dragStartWidthRef.current + dx),
    );
    setPanelWidth(clamped);
  }, []);

  const handleDragEnd = useCallback(() => {
    if (!isDraggingRef.current) return;
    isDraggingRef.current = false;
    document.body.style.cursor = "";
    document.body.style.userSelect = "";
  }, []);

  // ─── Layout decision ────────────────────────────────────────────────────────

  if (showInlineReader && selectedItem) {
    return (
      <div className="h-full flex flex-col overflow-hidden">
        <div className="flex-1 flex overflow-y-hidden overflow-x-visible">
          {railMounted ? (
            <div
              data-testid="compact-feed-panel-rail"
              className="flex-none overflow-hidden"
              style={railSlotStyle}
              onTransitionEnd={handleRailTransitionEnd}
            >
              <div className="flex" style={railContentStyle}>
                <CompactFeedPanel
                  items={readerItems}
                  storyGroups={readerStoryGroups}
                  selectedId={selectedItem.globalId}
                  selectionMoveDirection={compactSelectionDirection}
                  onItemClick={openItemDirect}
                  markReadOnScroll={markReadOnScroll}
                  showReadInGrayscale={showReadInGrayscale}
                  markItemsAsRead={markBoundedItemsAsRead}
                  width={panelWidth}
                  onLoadMore={loadMoreBoundedItems}
                  hasMore={boundedFeedReadyIsCurrent && boundedFeed.hasMore}
                  onLoadPrevious={loadPreviousBoundedItems}
                  hasPrevious={
                    boundedFeedReadyIsCurrent && boundedFeed.hasPrevious
                  }
                  boundedWindowStartIndex={boundedFeed.windowStartIndex}
                />
                <div
                  className="theme-resize-gap-handle w-4 shrink-0 self-stretch"
                  onPointerDown={handleDragStart}
                  onPointerMove={handleDragMove}
                  onPointerUp={handleDragEnd}
                  onPointerCancel={handleDragEnd}
                  role="separator"
                  aria-orientation="vertical"
                  aria-label="Resize sidebar"
                />
              </div>
            </div>
          ) : null}
          <ReaderView
            item={selectedItem}
            onClose={closeItem}
            dualColumn={showDualColumn}
            inline
            onOpenUrl={handleOpenCommentUrl}
            onOpenAuthorInFriends={openAuthorInFriends}
          />
        </div>
        <AddFeedDialog
          open={addFeedOpen}
          onClose={() => setAddFeedOpen(false)}
        />
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col">
      {!selectedItem &&
      boundedFeedEligible &&
      boundedFeedStatusIsCurrent &&
      boundedFeed.status === "failed" ? (
        <div
          role="alert"
          className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center"
        >
          <p>Unable to load this feed.</p>
          <button
            type="button"
            className="theme-accent-button rounded-xl px-5 py-2.5 text-sm font-medium"
            onClick={retryBoundedFeed}
          >
            Try again
          </button>
        </div>
      ) : (
        !selectedItem && (
          <FeedList
            items={visibleItems}
            storyGroups={presentation.groupById}
            onColumnsChange={setFeedColumns}
            onItemClick={openItemDirect}
            focusedIndex={focusedIndex}
            focusMoveDirection={keyboardFocusDirection}
            onFocusChange={handleFocusChange}
            onAddFeed={canAddFeeds ? () => setAddFeedOpen(true) : undefined}
            hasFeedsSubscribed={libraryFacets.rssFeedCount > 0}
            onItemSave={readOnly ? undefined : handleItemSave}
            onItemArchive={
              readOnly || activeFilter.archivedOnly
                ? undefined
                : handleItemArchive
            }
            onItemLike={!readOnly && toggleLiked ? handleItemLike : undefined}
            onOpenCommentUrl={handleOpenCommentUrl}
            isSearching={isSearching}
            loading={
              boundedFeedEligible &&
              (!boundedFeedStatusIsCurrent || boundedFeed.status === "loading")
            }
            searchQuery={searchQuery}
            onLoadMore={loadMoreBoundedItems}
            hasMore={boundedFeedReadyIsCurrent && boundedFeed.hasMore}
            onLoadPrevious={loadPreviousBoundedItems}
            hasPrevious={boundedFeedReadyIsCurrent && boundedFeed.hasPrevious}
            boundedWindowStartIndex={boundedFeed.windowStartIndex}
            markItemsAsReadOverride={markBoundedItemsAsRead}
          />
        )
      )}

      {selectedItem && (
        <ReaderView
          item={selectedItem}
          inline
          onClose={closeItem}
          onOpenUrl={handleOpenCommentUrl}
          onOpenAuthorInFriends={openAuthorInFriends}
        />
      )}

      <AddFeedDialog open={addFeedOpen} onClose={() => setAddFeedOpen(false)} />
    </div>
  );
}
