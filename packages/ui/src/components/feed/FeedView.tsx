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
import { FeedList } from "./FeedList.js";
import { ReaderView } from "./ReaderView.js";
import { FeedItem as FeedItemCard } from "./FeedItem.js";
import { useReadOnScrollTracker } from "./useReadOnScrollTracker.js";
import { buildReadTrackListKey } from "./read-on-scroll.js";
import { useBoundedFeedItems } from "./useBoundedFeedItems.js";
import {
  resolveBoundedReaderRankingClock,
  savedFeedRankingClockMs,
  type BoundedReaderRankingClock,
} from "./saved-feed-fallback-order.js";
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
import { useIsMobile } from "../../hooks/useIsMobile.js";
import { useIsMobileDevice } from "../../hooks/useIsMobileDevice.js";
import {
  discoveredSocialAccountFromItem,
  type FeedItem,
} from "@freed/shared";
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

interface CompactBoundedWindowAnchor {
  readonly itemId: string;
  readonly offset: number;
  readonly windowStartIndex: number;
}

const CompactFeedPanel = memo(function CompactFeedPanel({
  items,
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
  const scrollAnchorRef = useRef<{ index: number; offset: number } | null>(
    null,
  );
  const pendingBoundedAnchorRef = useRef<CompactBoundedWindowAnchor | null>(
    null,
  );
  const previousBoundedWindowStartRef = useRef(boundedWindowStartIndex);
  const boundedWindowDidShift =
    boundedWindowStartIndex !== previousBoundedWindowStartRef.current;
  const prevWidthRef = useRef(width);

  const cardHeight = width - CARD_H_PAD;
  const itemHeight = cardHeight + CARD_V_GAP;
  const firstItemHeight = itemHeight + CARD_V_GAP;
  // Story tiles use the same square dimensions as regular cards in the sidebar.
  const storyTileH = cardHeight;
  const storyItemHeight = storyTileH + CARD_V_GAP;

  // Capture the top-visible item before the width change propagates to layout.
  // Runs during render (synchronously) so we can read the pre-update scroll state.
  if (prevWidthRef.current !== width && parentRef.current && items.length > 0) {
    const scrollTop = parentRef.current.scrollTop;
    const oldCard = prevWidthRef.current - CARD_H_PAD;
    const oldItem = oldCard + CARD_V_GAP;
    const oldFirst = oldItem + CARD_V_GAP;

    let idx: number;
    let offset: number;
    if (scrollTop < oldFirst) {
      idx = 0;
      offset = scrollTop;
    } else {
      const past = scrollTop - oldFirst;
      idx = 1 + Math.floor(past / oldItem);
      offset = scrollTop - (oldFirst + (idx - 1) * oldItem);
    }
    scrollAnchorRef.current = {
      index: Math.min(idx, items.length - 1),
      offset,
    };
    prevWidthRef.current = width;
  }

  const estimateItemSize = useCallback(
    (index: number) => {
      const isStory = items[index]?.contentType === "story";
      const baseH = isStory ? storyItemHeight : itemHeight;
      return index === 0 ? baseH + CARD_V_GAP : baseH;
    },
    [items, itemHeight, storyItemHeight],
  );
  const readListKey = useMemo(() => buildReadTrackListKey(items), [items]);
  const getReadScrollMetrics = useCallback(
    () => ({
      rawScrollTop: parentRef.current?.scrollTop ?? 0,
      viewportHeight: parentRef.current?.clientHeight ?? 0,
      scrollMargin: 0,
    }),
    [],
  );
  const processReadOnScroll = useReadOnScrollTracker({
    surface: "compact-feed",
    listKey: readListKey,
    rows: items,
    items,
    markReadOnScroll,
    getScrollMetrics: getReadScrollMetrics,
    markItemsAsRead,
  });
  // Pin the top-visible card before the resident window shifts so the restore
  // below can put it back under the same pixel.
  const captureBoundedAnchor = useCallback(
    (
      virtualItems: readonly { index: number; start: number; end: number }[],
    ) => {
      const scrollTop = parentRef.current?.scrollTop ?? 0;
      const firstVisible =
        virtualItems.find((virtualItem) => virtualItem.end > scrollTop) ??
        virtualItems[0];
      const anchorItem = firstVisible ? items[firstVisible.index] : undefined;
      if (!firstVisible || !anchorItem) return;
      pendingBoundedAnchorRef.current = {
        itemId: anchorItem.globalId,
        offset: Math.max(0, scrollTop - firstVisible.start),
        windowStartIndex: boundedWindowStartIndex,
      };
    },
    [boundedWindowStartIndex, items],
  );
  const requestBoundedWindowShift = useCallback(
    (
      virtualItems: readonly { index: number; start: number; end: number }[],
    ) => {
      if (items.length === 0 || virtualItems.length === 0) return;
      const finalVisible = virtualItems[virtualItems.length - 1];
      if (
        hasMore &&
        onLoadMore &&
        finalVisible &&
        finalVisible.index >= Math.max(0, items.length - 5)
      ) {
        captureBoundedAnchor(virtualItems);
        onLoadMore();
        return;
      }
      const firstRendered = virtualItems[0];
      if (hasPrevious && onLoadPrevious && firstRendered.index <= 4) {
        captureBoundedAnchor(virtualItems);
        onLoadPrevious();
      }
    },
    [
      captureBoundedAnchor,
      hasMore,
      hasPrevious,
      items.length,
      onLoadMore,
      onLoadPrevious,
    ],
  );

  const virtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => parentRef.current,
    estimateSize: estimateItemSize,
    overscan: 3,
    onChange: (instance) => {
      processReadOnScroll(instance, "element");
      requestBoundedWindowShift(instance.getVirtualItems());
    },
  });

  // Restore scroll after DOM updates with new card sizes (runs before paint).
  useLayoutEffect(() => {
    const anchor = scrollAnchorRef.current;
    if (!anchor) return;
    scrollAnchorRef.current = null;

    virtualizer.measure();

    // Estimate scroll position based on item types (story vs regular).
    let newStart = 0;
    if (anchor.index > 0) {
      newStart = firstItemHeight; // first item
      for (let i = 1; i < anchor.index; i++) {
        newStart +=
          items[i]?.contentType === "story" ? storyItemHeight : itemHeight;
      }
    }

    const el = parentRef.current;
    if (el) el.scrollTop = newStart + anchor.offset;
  }); // intentionally no deps: only fires work when anchor ref is set

  useLayoutEffect(() => {
    const previousWindowStart = previousBoundedWindowStartRef.current;
    previousBoundedWindowStartRef.current = boundedWindowStartIndex;
    if (boundedWindowStartIndex === previousWindowStart) return;

    const anchor = pendingBoundedAnchorRef.current;
    pendingBoundedAnchorRef.current = null;
    if (!anchor || anchor.windowStartIndex !== previousWindowStart) return;
    const anchorIndex = items.findIndex(
      (item) => item.globalId === anchor.itemId,
    );
    if (anchorIndex < 0) return;

    virtualizer.measure();
    virtualizer.scrollToIndex(anchorIndex, { align: "start" });
    if (anchor.offset > 0) {
      parentRef.current?.scrollBy({ top: anchor.offset });
    }
  }, [boundedWindowStartIndex, items, virtualizer]);

  // Auto-scroll to the selected item on selection change.
  const selectedIndex = useMemo(
    () => items.findIndex((it) => it.globalId === selectedId),
    [items, selectedId],
  );
  const didInitialScroll = useRef(false);
  useLayoutEffect(() => {
    if (boundedWindowDidShift) return;
    if (selectedIndex < 0) return;
    const behavior = animationAwareScrollBehavior(
      didInitialScroll.current ? "smooth" : "auto",
    );

    if (selectionMoveDirection === 0) {
      virtualizer.scrollToIndex(selectedIndex, {
        align: "center",
        behavior,
      });
      didInitialScroll.current = true;
      return;
    }

    const el = parentRef.current;
    if (!el) return;

    const lookaheadIndex =
      selectionMoveDirection > 0
        ? Math.min(selectedIndex + 1, items.length - 1)
        : Math.max(selectedIndex - 1, 0);
    virtualizer.scrollToIndex(lookaheadIndex, {
      align: selectionMoveDirection > 0 ? "end" : "start",
      behavior,
    });

    didInitialScroll.current = true;
  }, [
    firstItemHeight,
    boundedWindowDidShift,
    itemHeight,
    items.length,
    selectedIndex,
    selectionMoveDirection,
    virtualizer,
  ]);

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
          const item = items[vi.index];
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
                  paddingLeft: `${COMPACT_CARD_LEFT_PAD}px`,
                  paddingRight: `${COMPACT_CARD_RIGHT_PAD}px`,
                  paddingBottom: `${COMPACT_CARD_GAP}px`,
                  paddingTop:
                    vi.index === 0 ? `${COMPACT_CARD_GAP}px` : undefined,
                }}
              >
                <FeedItemCard
                  item={item}
                  compact
                  narrow={width < NARROW_THRESHOLD}
                  selected={item.globalId === selectedId}
                  showReadInGrayscale={showReadInGrayscale}
                  onClick={() => onItemClick(item)}
                  storyHeight={
                    item.contentType === "story" ? storyTileH : undefined
                  }
                />
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
    upsertLibraryAccount,
  } = platform;
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
  const setActiveView = useAppStore((s) => s.setActiveView);
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
        let accountId = scope.accountId;
        if (!accountId) {
          const draft = discoveredSocialAccountFromItem(item);
          if (!draft) return;
          if (!upsertLibraryAccount) {
            throw new Error("SQLite Account mutation is unavailable");
          }
          await upsertLibraryAccount(draft);
          accountId = draft.id;
        }

        setSelectedItem(null);
        setSelectedAccount(accountId);
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
      upsertLibraryAccount,
    ],
  );

  const [addFeedOpen, setAddFeedOpen] = useState(false);
  const [readerOrderIds, setReaderOrderIds] = useState<string[] | null>(null);
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
  const boundedFeedStatusIsCurrent =
    renderedReaderIdentityRef.current === boundedReaderIdentity;
  useLayoutEffect(() => {
    renderedReaderIdentityRef.current = boundedReaderIdentity;
  }, [boundedReaderIdentity]);
  const activeBoundedFeedReader = useMemo(() => {
    if (savedBoundedFeedEligible) {
      if (!openBoundedSavedFeedReader) return undefined;
      return (filter: typeof activeFilter, rankingClockMs: number) =>
        openBoundedSavedFeedReader(filter, savedContentSortMode, rankingClockMs);
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
    [markItemsAsRead, patchBoundedItems],
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
  const visibleItems = useMemo(() => {
    if (boundedFeedReadyIsCurrent) return boundedFeed.items;
    return isSearching ? filteredItems : EMPTY_FEED_ITEMS;
  }, [
    boundedFeed.items,
    boundedFeedReadyIsCurrent,
    filteredItems,
    isSearching,
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
  const [keyboardFocusDirection, setKeyboardFocusDirection] = useState<
    -1 | 0 | 1
  >(0);
  const [compactSelectionDirection, setCompactSelectionDirection] = useState<
    -1 | 0 | 1
  >(0);
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
        eligible: Boolean(boundedFeedEligible && boundedFeedReadyIsCurrent),
        readerIdentity: boundedReaderIdentity,
        residentSelectedItem,
        selectedItemId,
      }),
    );
  }, [
    boundedReaderIdentity,
    boundedFeedEligible,
    boundedFeedReadyIsCurrent,
    residentSelectedItem,
    selectedItemId,
  ]);
  const currentSelectedItemPin =
    selectedItemPin?.readerIdentity === boundedReaderIdentity &&
    selectedItemPin.selectedItemId === selectedItemId
      ? selectedItemPin.item
      : null;
  const selectedItem =
    residentSelectedItem ??
    (boundedFeedEligible ? currentSelectedItemPin : null);
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
      current?.readerIdentity === boundedReaderIdentity &&
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
    patchBoundedItems,
    pagedBoundedFeedEligible,
    savedFeedPresentationPatch,
    savedFeedVersion,
    selectedItemId,
  ]);
  const readerItems = useMemo(() => {
    const itemById = new Map(visibleItems.map((item) => [item.globalId, item]));
    const stableItems = readerOrderIds
      ? readerOrderIds
          .map((id) => itemById.get(id))
          .filter((item): item is FeedItem => Boolean(item))
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
      currentSelectedItemPin?.globalId === selectedItemId &&
      !residentItems.some((item) => item.globalId === selectedItemId)
        ? currentSelectedItemPin
        : null;
    return pinnedSelection
      ? [pinnedSelection, ...residentItems]
      : residentItems;
  }, [
    readerOrderIds,
    boundedFeedEligible,
    currentSelectedItemPin,
    selectedItemId,
    visibleItems,
  ]);

  const openItem = useCallback(
    (item: FeedItem) => {
      const selectItem = () => {
        const readAt = Date.now();
        patchBoundedItems((candidate) =>
          candidate.globalId === item.globalId && !candidate.userState.readAt
            ? {
                ...candidate,
                userState: { ...candidate.userState, readAt },
              }
            : candidate,
        );
        setSelectedItem(item.globalId);
        markAsRead(item.globalId);
      };

      if (showDualColumn && !selectedItemId) {
        setReaderOrderIds(visibleItems.map((candidate) => candidate.globalId));
        runFeedLayoutTransition(selectItem);
        return;
      }

      selectItem();
    },
    [
      markAsRead,
      patchBoundedItems,
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

  const closeItem = useCallback(() => {
    setCompactSelectionDirection(0);
    setReaderOrderIds(null);
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
          if (nextIndex === currentIndex) return;

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
    setReaderOrderIds(null);
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
                  selectedId={selectedItem.globalId}
                  selectionMoveDirection={compactSelectionDirection}
                  onItemClick={openItemDirect}
                  markReadOnScroll={markReadOnScroll}
                  showReadInGrayscale={showReadInGrayscale}
                  markItemsAsRead={markBoundedItemsAsRead}
                  width={panelWidth}
                  onLoadMore={loadMoreBoundedItems}
                  hasMore={
                    boundedFeedReadyIsCurrent && boundedFeed.hasMore
                  }
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
      <FeedList
        items={visibleItems}
        onItemClick={openItemDirect}
        focusedIndex={focusedIndex}
        focusMoveDirection={keyboardFocusDirection}
        onFocusChange={handleFocusChange}
        onAddFeed={canAddFeeds ? () => setAddFeedOpen(true) : undefined}
        hasFeedsSubscribed={libraryFacets.rssFeedCount > 0}
        onItemSave={handleItemSave}
        onItemArchive={
          activeFilter.archivedOnly ? undefined : handleItemArchive
        }
        onItemLike={toggleLiked ? handleItemLike : undefined}
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

      {selectedItem && (
        <ReaderView
          item={selectedItem}
          onClose={closeItem}
          onOpenUrl={handleOpenCommentUrl}
          onOpenAuthorInFriends={openAuthorInFriends}
        />
      )}

      <AddFeedDialog open={addFeedOpen} onClose={() => setAddFeedOpen(false)} />
    </div>
  );
}
