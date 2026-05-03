import { useRef, memo, useCallback, useEffect, useLayoutEffect, useMemo, useState } from "react";
import { useVirtualizer, useWindowVirtualizer } from "@tanstack/react-virtual";
import { FeedItem } from "./FeedItem.js";
import { FeedItemSkeleton } from "./FeedItemSkeleton.js";
import { useReadOnScrollTracker } from "./useReadOnScrollTracker.js";
import type { FeedItem as FeedItemType } from "@freed/shared";
import { useAppStore, usePlatform } from "../../context/PlatformContext.js";
import { useIsMobile } from "../../hooks/useIsMobile.js";
import {
  DESKTOP_FEED_CARD_HEIGHT_BY_DENSITY,
  useFeedCardDensity,
  type FeedCardDensity,
} from "../../lib/feed-card-density.js";

// ── Story grouping ────────────────────────────────────────────────────────────

const FEED_CARD_GAP = 8;
const DESKTOP_FEED_CARD_HORIZONTAL_GUTTER = 0;
const TILE_GAP = FEED_CARD_GAP;
const MIN_TILE_W = 80; // minimum tile width before a column wraps
// Tailwind max-w-2xl = 42rem = 672px.
const MAX_CONTENT_W = 672;
const ITEM_ROW_ESTIMATE_BY_DENSITY: Record<FeedCardDensity, number> = {
  compact: 172,
  comfortable: 220,
  expansive: 300,
};
const MAX_TILE_H_BY_DENSITY: Record<FeedCardDensity, number> = {
  compact: 220,
  comfortable: 288,
  expansive: 340,
};

/**
 * Height-to-width ratio for story tiles based on column count.
 *
 * - 1 col: 4:3 portrait — big hero tile (height is almost always capped anyway)
 * - 2 col: 2:3 landscape — two side-by-side tiles look better wide, not tall
 * - 3 col: 4:3 portrait — narrow columns read better in portrait
 */
function storyHeightRatio(numCols: number): number {
  return numCols === 2 ? 2 / 3 : 4 / 3;
}

type FeedRow =
  | { type: "item"; item: FeedItemType; itemIndex: number }
  | { type: "stories"; items: FeedItemType[]; itemIndices: number[]; numCols: number };

/**
 * Collapse consecutive story items into grid rows of up to `maxCols` wide,
 * avoiding orphan single-item tail rows where possible.
 *
 * For maxCols=3:
 *   N=1→[1]  N=2→[2]  N=3→[3]  N=4→[2,2]  N=5→[3,2]  N=7→[3,2,2]
 */
function buildRows(allItems: FeedItemType[], maxCols: number): FeedRow[] {
  const cols = Math.max(1, maxCols);
  const rows: FeedRow[] = [];
  let i = 0;

  while (i < allItems.length) {
    if (allItems[i].contentType !== "story") {
      rows.push({ type: "item", item: allItems[i], itemIndex: i });
      i++;
      continue;
    }

    // Collect the full run of consecutive stories.
    const runStart = i;
    while (i < allItems.length && allItems[i].contentType === "story") i++;
    const runLength = i - runStart;

    // Split the run into balanced rows of at most `cols` stories.
    let offset = runStart;
    let remaining = runLength;
    while (remaining > 0) {
      let rowSize: number;
      if (remaining <= cols) {
        rowSize = remaining;
      } else if (cols > 1 && remaining % cols === 1) {
        // Greedy fill would eventually leave a 1-item orphan row.
        // If only cols+1 remain, split evenly. Otherwise keep filling.
        rowSize = remaining === cols + 1 ? Math.ceil(remaining / 2) : cols;
      } else {
        rowSize = cols;
      }
      rows.push({
        type: "stories",
        items: allItems.slice(offset, offset + rowSize),
        itemIndices: Array.from({ length: rowSize }, (_, k) => offset + k),
        numCols: rowSize, // actual column count for this row's CSS grid
      });
      offset += rowSize;
      remaining -= rowSize;
    }
  }

  return rows;
}

const SKELETON_COUNT = 8;

interface FeedListProps {
  items: FeedItemType[];
  onItemClick?: (item: FeedItemType) => void;
  focusedIndex?: number;
  focusMoveDirection?: -1 | 0 | 1;
  onFocusChange?: (index: number) => void;
  /** Called when user clicks "Add Feed" from the empty state */
  onAddFeed?: () => void;
  /** Whether any feeds are subscribed — controls empty state message */
  hasFeedsSubscribed?: boolean;
  /** Called when user bookmarks/unbookmarks an item */
  onItemSave?: (item: FeedItemType) => void;
  /** Called when user archives an item from the feed card */
  onItemArchive?: (item: FeedItemType) => void;
  /** Called when user clicks the like button on an item */
  onItemLike?: (item: FeedItemType) => void;
  /** Called when user clicks the comment link on an item */
  onOpenCommentUrl?: (url: string) => void;
  /** True when a search query is active — changes the empty state message */
  isSearching?: boolean;
  /** The active search query text — used in the empty state message */
  searchQuery?: string;
}

/**
 * Memoized per-row adapter. Keeps handler references stable so FeedItem's
 * React.memo can bail out when focusedIndex changes on unrelated rows —
 * otherwise every mousemove re-renders the entire visible window.
 */
interface FeedItemRowProps {
  item: FeedItemType;
  index: number;
  focused: boolean;
  showEngagement: boolean;
  showReadInGrayscale: boolean;
  density: FeedCardDensity;
  onItemClick?: (item: FeedItemType) => void;
  onFocusChange?: (index: number) => void;
  onItemSave?: (item: FeedItemType) => void;
  onItemArchive?: (item: FeedItemType) => void;
  onItemLike?: (item: FeedItemType) => void;
  onOpenCommentUrl?: (url: string) => void;
  fixedHeight?: number;
}

const FeedItemRow = memo(function FeedItemRow({
  item,
  index,
  focused,
  showEngagement,
  showReadInGrayscale,
  density,
  onItemClick,
  onFocusChange,
  onItemSave,
  onItemArchive,
  onItemLike,
  onOpenCommentUrl,
  fixedHeight,
}: FeedItemRowProps) {
  const handleClick = useCallback(() => onItemClick?.(item), [item, onItemClick]);
  const handleMouseEnter = useCallback(() => onFocusChange?.(index), [index, onFocusChange]);
  const handleSave = useCallback(
    (e: React.MouseEvent) => { e.stopPropagation(); onItemSave?.(item); },
    [item, onItemSave],
  );
  const handleArchive = useCallback(
    (e: React.MouseEvent) => { e.stopPropagation(); onItemArchive?.(item); },
    [item, onItemArchive],
  );
  const handleLike = useCallback(
    (e: React.MouseEvent) => { e.stopPropagation(); onItemLike?.(item); },
    [item, onItemLike],
  );

  return (
    <FeedItem
      item={item}
      onClick={handleClick}
      focused={focused}
      showEngagement={showEngagement}
      showReadInGrayscale={showReadInGrayscale}
      density={density}
      onMouseEnter={handleMouseEnter}
      onSave={onItemSave ? handleSave : undefined}
      onArchive={onItemArchive ? handleArchive : undefined}
      onLike={onItemLike ? handleLike : undefined}
      onOpenCommentUrl={onOpenCommentUrl}
      fixedHeight={fixedHeight}
    />
  );
});

interface StoryGroupRowProps {
  storyItems: FeedItemType[];
  itemIndices: number[];
  /** Number of equal-width CSS columns for this row's grid. */
  numCols: number;
  /** Explicit tile height in pixels. */
  tileHeight: number;
  showEngagement: boolean;
  showReadInGrayscale: boolean;
  density: FeedCardDensity;
  onItemClick?: (item: FeedItemType) => void;
  onItemSave?: (item: FeedItemType) => void;
  onItemArchive?: (item: FeedItemType) => void;
}

const StoryGroupRow = memo(function StoryGroupRow({
  storyItems,
  numCols,
  tileHeight,
  showEngagement,
  showReadInGrayscale,
  density,
  onItemClick,
  onItemSave,
  onItemArchive,
}: StoryGroupRowProps) {
  return (
    <div
      className="grid"
      style={{ gap: `${TILE_GAP}px`, gridTemplateColumns: `repeat(${numCols}, 1fr)` }}
    >
      {storyItems.map((item) => (
        <FeedItem
          key={item.globalId}
          item={item}
          onClick={() => onItemClick?.(item)}
          focused={false}
          showEngagement={showEngagement}
          showReadInGrayscale={showReadInGrayscale}
          density={density}
          storyHeight={tileHeight}
          onSave={onItemSave ? (e) => { e.stopPropagation(); onItemSave(item); } : undefined}
          onArchive={onItemArchive ? (e) => { e.stopPropagation(); onItemArchive(item); } : undefined}
        />
      ))}
    </div>
  );
});

export function FeedList({
  items,
  onItemClick,
  focusedIndex = -1,
  focusMoveDirection = 0,
  onFocusChange,
  onAddFeed,
  hasFeedsSubscribed = false,
  onItemSave,
  onItemArchive,
  onItemLike,
  onOpenCommentUrl,
  isSearching = false,
  searchQuery = "",
}: FeedListProps) {
  // Desktop in-element scroll container
  const parentRef = useRef<HTMLDivElement>(null);
  // Mobile window-scroll container (used to compute scrollMargin for the virtualizer)
  const windowListRef = useRef<HTMLDivElement>(null);

  const isMobile = useIsMobile();
  const feedCardHorizontalGutter = isMobile
    ? FEED_CARD_GAP
    : DESKTOP_FEED_CARD_HORIZONTAL_GUTTER;
  const { FeedEmptyState } = usePlatform();
  const isLoading = useAppStore((s) => s.isLoading);
  const activeFilter = useAppStore((s) => s.activeFilter);

  // Reset scroll position when the user switches sources/filters in the sidebar.
  const filterKeyRef = useRef<string>("");
  useEffect(() => {
    const key = JSON.stringify(activeFilter);
    if (filterKeyRef.current && filterKeyRef.current !== key) {
      if (isMobile) {
        window.scrollTo({ top: 0 });
      } else {
        parentRef.current?.scrollTo({ top: 0 });
      }
    }
    filterKeyRef.current = key;
  }, [activeFilter, isMobile]);
  const showEngagementCounts = useAppStore(
    (s) => s.preferences.display.showEngagementCounts,
  );
  const markItemsAsRead = useAppStore((s) => s.markItemsAsRead);
  const markReadOnScroll = useAppStore(
    (s) => s.preferences.display.reading.markReadOnScroll,
  );
  const showReadInGrayscale = useAppStore(
    (s) => s.preferences.display.reading.showReadInGrayscale,
  );
  const [cardDensity] = useFeedCardDensity();
  const desktopFeedCardHeight = DESKTOP_FEED_CARD_HEIGHT_BY_DENSITY[cardDensity];

  // Track scroll container width so story group rows are sized correctly.
  // 600 is a safe non-zero starting guess; the ResizeObserver corrects it
  // after the first render.
  const [containerWidth, setContainerWidth] = useState(600);

  // We must set up the ResizeObserver AFTER the scroll container is in the DOM.
  // `parentRef.current` is null during early-return paths (loading skeleton,
  // empty state), so we use a polling-style layout effect that checks every
  // render whether the ref is now available and, if so, starts observing.
  // Once connected the observer fires on every resize (sidebar ↔ full-width).
  useEffect(() => {
    const el = parentRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      setContainerWidth(entry.contentRect.width);
    });
    ro.observe(el);
    // Fire once immediately so the width is captured before any scroll event.
    setContainerWidth(el.getBoundingClientRect().width);
    return () => ro.disconnect();
  }); // intentionally no dep array — re-runs every render, but the RefObject
      // only changes when the ref target mounts/unmounts so the observer is
      // reconnected at most a handful of times.

  // Max grid columns based on current container width (capped at 3).
  // Inner width = containerWidth minus the feed-card gutter on each side.
  const maxCols = useMemo(() => {
    const inner = Math.max(Math.min(containerWidth, MAX_CONTENT_W) - feedCardHorizontalGutter * 2, 0);
    return Math.max(1, Math.min(3, Math.floor((inner + TILE_GAP) / (MIN_TILE_W + TILE_GAP))));
  }, [containerWidth, feedCardHorizontalGutter]);

  // Preprocess items into virtual rows, collapsing consecutive stories into grids.
  const rows = useMemo(() => buildRows(items, maxCols), [items, maxCols]);

  // Map item index → row index for focusedIndex highlighting.
  const itemIndexToRowIndex = useMemo(() => {
    const map = new Map<number, number>();
    rows.forEach((row, ri) => {
      if (row.type === "item") {
        map.set(row.itemIndex, ri);
      } else {
        row.itemIndices.forEach((ii) => map.set(ii, ri));
      }
    });
    return map;
  }, [rows]);

  const estimateDesktopRowSize = useCallback(
    (index: number) =>
      desktopFeedCardHeight + FEED_CARD_GAP + (index === 0 ? FEED_CARD_GAP : 0),
    [desktopFeedCardHeight],
  );

  // Mobile keeps measured variable rows. Desktop uses a fixed contract so the
  // virtualizer never corrects row offsets while the user is scrolling.
  const estimateRowSize = useCallback(
    (index: number) => {
      if (!isMobile) return estimateDesktopRowSize(index);
      const row = rows[index];
      if (!row || row.type !== "stories") return ITEM_ROW_ESTIMATE_BY_DENSITY[cardDensity];
      const inner = Math.max(Math.min(containerWidth, MAX_CONTENT_W) - feedCardHorizontalGutter * 2, 0);
      const nc = row.numCols;
      const tileWidth = nc > 1 ? (inner - (nc - 1) * TILE_GAP) / nc : inner;
      const tileHeight = Math.min(tileWidth * storyHeightRatio(nc), MAX_TILE_H_BY_DENSITY[cardDensity]);
      return Math.round(tileHeight + FEED_CARD_GAP + (index === 0 ? FEED_CARD_GAP : 0));
    },
    [cardDensity, estimateDesktopRowSize, isMobile, rows, containerWidth, feedCardHorizontalGutter],
  );

  const listKey = useMemo(
    () => JSON.stringify({ activeFilter, searchQuery: searchQuery.trim() }),
    [activeFilter, searchQuery],
  );
  const getReadScrollMetrics = useCallback((scrollSource: "element" | "window", virtualizer: {
    options?: { scrollMargin?: number };
  }) => ({
    rawScrollTop: scrollSource === "window"
      ? window.scrollY
      : (parentRef.current?.scrollTop ?? 0),
    viewportHeight: scrollSource === "window"
      ? window.innerHeight
      : (parentRef.current?.clientHeight ?? 0),
    scrollMargin: scrollSource === "window"
      ? (virtualizer.options?.scrollMargin ?? 0)
      : 0,
  }), []);
  const processReadOnScroll = useReadOnScrollTracker({
    surface: isMobile ? "mobile-feed" : "primary-feed",
    listKey,
    rows,
    items,
    markReadOnScroll,
    getScrollMetrics: getReadScrollMetrics,
    markItemsAsRead,
  });

  const elementVirtualizer = useVirtualizer({
    count: isMobile ? 0 : rows.length,
    getScrollElement: () => (isMobile ? null : parentRef.current),
    estimateSize: estimateRowSize,
    overscan: 5,
    onChange: (instance) => {
      if (!isMobile) processReadOnScroll(instance, "element");
    },
  });

  const windowVirtualizer = useWindowVirtualizer({
    count: isMobile ? rows.length : 0,
    estimateSize: estimateRowSize,
    overscan: 5,
    // Distance from window top to the list container. Accounts for the sticky
    // header so items are offset correctly as window.scrollY changes.
    scrollMargin: windowListRef.current?.offsetTop ?? 0,
    onChange: (instance) => {
      if (isMobile) processReadOnScroll(instance, "window");
    },
  });

  useEffect(() => {
    elementVirtualizer.measure();
    windowVirtualizer.measure();
  }, [cardDensity]);

  useLayoutEffect(() => {
    if (isMobile || focusMoveDirection === 0 || focusedIndex < 0) return;

    const container = parentRef.current;
    if (!container) return;

    const focusedRowIndex = itemIndexToRowIndex.get(focusedIndex);
    if (focusedRowIndex === undefined) return;

    const lookaheadRowIndex =
      focusMoveDirection > 0
        ? Math.min(focusedRowIndex + 1, rows.length - 1)
        : Math.max(focusedRowIndex - 1, 0);
    const scrollPadding = 16;
    const lookaheadRow = container.querySelector(
      `[data-feed-row-index="${lookaheadRowIndex}"]`,
    ) as HTMLElement | null;

    if (!lookaheadRow) {
      elementVirtualizer.scrollToIndex(lookaheadRowIndex, {
        align: focusMoveDirection > 0 ? "end" : "start",
      });
      return;
    }

    const containerRect = container.getBoundingClientRect();
    const rowRect = lookaheadRow.getBoundingClientRect();

    if (focusMoveDirection > 0) {
      const overflow = rowRect.bottom - (containerRect.bottom - scrollPadding);
      if (overflow > 0) {
        container.scrollBy({ top: overflow, behavior: "auto" });
      }
      return;
    }

    const overflow = containerRect.top + scrollPadding - rowRect.top;
    if (overflow > 0) {
      container.scrollBy({ top: -overflow, behavior: "auto" });
    }
  }, [
    elementVirtualizer,
    focusMoveDirection,
    focusedIndex,
    isMobile,
    itemIndexToRowIndex,
    rows.length,
  ]);

  // Show shimmer placeholders while the doc is loading from IndexedDB.
  // Once isLoading flips false, items will populate and we drop into the
  // normal virtualizer path (or the empty state if the library is genuinely empty).
  if (isLoading && items.length === 0) {
    return (
      <div className="flex-1 min-h-0 overflow-auto overscroll-none minimal-scroll">
        <div
          className="max-w-2xl mx-auto"
          style={{
            paddingInline: `${feedCardHorizontalGutter}px`,
            paddingTop: `${FEED_CARD_GAP}px`,
            paddingBottom: `${FEED_CARD_GAP}px`,
          }}
        >
          {Array.from({ length: SKELETON_COUNT }, (_, i) => (
            <div key={i} style={{ marginTop: i === 0 ? 0 : `${FEED_CARD_GAP}px` }}>
              <FeedItemSkeleton fixedHeight={isMobile ? undefined : desktopFeedCardHeight} />
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (items.length === 0) {
    // Search returned no results — custom empty state.
    if (isSearching) {
      return (
        <div className="flex flex-col items-center justify-center flex-1 min-h-0 overflow-auto text-center px-6 py-12">
          <div className="theme-icon-well-info mb-4 flex h-16 w-16 items-center justify-center rounded-full border bg-[radial-gradient(circle_at_top,var(--theme-bg-card-hover),transparent_72%),linear-gradient(135deg,rgb(var(--theme-accent-primary-rgb)/0.12),rgb(var(--theme-accent-secondary-rgb)/0.1))]">
            <svg className="theme-icon-action h-7 w-7" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
          </div>
          <p className="text-lg font-medium mb-2">No results</p>
          <p className="max-w-xs text-sm text-[var(--theme-text-muted)]">
            Nothing matched{searchQuery ? <> &ldquo;<span className="text-[var(--theme-text-secondary)]">{searchQuery}</span>&rdquo;</> : ""}.
            Try a different term, or switch to <span className="text-[var(--theme-text-secondary)]">All Sources</span> in the sidebar to search everywhere.
          </p>
        </div>
      );
    }

    if (FeedEmptyState) {
      return (
        <div className="flex flex-col items-center justify-center flex-1 min-h-0 overflow-auto text-center px-6 py-12">
          <FeedEmptyState />
        </div>
      );
    }

    return (
      <div className="flex flex-col items-center justify-center flex-1 min-h-0 overflow-auto text-center px-6 py-12">
        <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full border border-[var(--theme-border-subtle)] bg-[radial-gradient(circle_at_top,var(--theme-bg-card-hover),transparent_72%),linear-gradient(135deg,rgb(var(--theme-accent-primary-rgb)/0.16),rgb(var(--theme-accent-secondary-rgb)/0.14))]">
          <span className="text-2xl">📡</span>
        </div>
        {hasFeedsSubscribed ? (
          <>
            <p className="text-lg font-medium mb-2">All caught up!</p>
            <p className="text-sm text-[var(--theme-text-muted)]">No new items to show.</p>
          </>
        ) : (
          <>
            <p className="text-lg font-medium mb-2">Welcome to Freed</p>
            <p className="mb-6 max-w-xs text-sm text-[var(--theme-text-muted)]">
              Add RSS feeds to start reading.
            </p>
            {onAddFeed && (
              <button
                onClick={onAddFeed}
                className="theme-accent-button flex items-center gap-2 rounded-xl px-5 py-2.5 text-sm font-medium transition-colors"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                </svg>
                Add your first feed
              </button>
            )}
          </>
        )}
      </div>
    );
  }

  // Mobile: window scroll — feed items flow in the document. The address bar
  // collapses naturally and content scrolls behind it.
  if (isMobile) {
    return (
      // paddingBottom ensures the last item can scroll fully above the address
      // bar. calc(100lvh - 100dvh) = the height of the address-bar zone;
      // safe-area-inset-bottom covers the home indicator in standalone mode.
      <div
        ref={windowListRef}
        style={{ paddingBottom: 'calc(100lvh - 100dvh + env(safe-area-inset-bottom, 0px))' }}
      >
        <div
          style={{ height: windowVirtualizer.getTotalSize() }}
          className="relative w-full"
        >
          {windowVirtualizer.getVirtualItems().map((virtualItem) => {
            const row = rows[virtualItem.index];
            if (!row) return null;
            return (
              <div
                key={virtualItem.key}
                data-feed-row-index={virtualItem.index}
                data-index={virtualItem.index}
                ref={windowVirtualizer.measureElement}
                style={{
                  position: "absolute",
                  top: 0,
                  left: 0,
                  width: "100%",
                  // Subtract scrollMargin so item positions are relative to the
                  // list container's top, not the window's origin.
                  transform: `translateY(${virtualItem.start - windowVirtualizer.options.scrollMargin}px)`,
                }}
              >
                <div
                  className="mx-auto w-full max-w-2xl max-[959px]:max-w-none"
                  style={{
                    paddingInline: `${FEED_CARD_GAP}px`,
                    paddingBottom: `${FEED_CARD_GAP}px`,
                    paddingTop: virtualItem.index === 0 ? `${FEED_CARD_GAP}px` : undefined,
                  }}
                >
                  {row.type === "stories" ? (() => {
                    const inner = Math.max(Math.min(containerWidth, MAX_CONTENT_W) - feedCardHorizontalGutter * 2, 0);
                    const nc = row.numCols;
                    const tw = nc > 1 ? (inner - (nc - 1) * TILE_GAP) / nc : inner;
                    const th = Math.round(Math.min(tw * storyHeightRatio(nc), MAX_TILE_H_BY_DENSITY[cardDensity]));
                    return (
                      <StoryGroupRow
                        storyItems={row.items}
                        itemIndices={row.itemIndices}
                        numCols={nc}
                        tileHeight={th}
                        showEngagement={showEngagementCounts}
                        showReadInGrayscale={showReadInGrayscale}
                        density={cardDensity}
                        onItemClick={onItemClick}
                        onItemSave={onItemSave}
                        onItemArchive={onItemArchive}
                      />
                    );
                  })() : (
                    <FeedItemRow
                      item={row.item}
                      index={row.itemIndex}
                      focused={itemIndexToRowIndex.get(focusedIndex) === virtualItem.index}
                      showEngagement={showEngagementCounts}
                      showReadInGrayscale={showReadInGrayscale}
                      density={cardDensity}
                      onItemClick={onItemClick}
                      onFocusChange={onFocusChange}
                      onItemSave={onItemSave}
                      onItemLike={onItemLike}
                      onOpenCommentUrl={onOpenCommentUrl}
                    />
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  // Desktop: in-element scroll with fixed layout.
  return (
    <div
      ref={parentRef}
      data-testid="feed-list-scroll-container"
      className="theme-scroll-fade-y flex-1 min-h-0 overflow-auto overscroll-none minimal-scroll"
    >
      <div
        style={{ height: elementVirtualizer.getTotalSize() }}
        className="relative w-full"
      >
        {elementVirtualizer.getVirtualItems().map((virtualItem) => {
          const row = rows[virtualItem.index];
          if (!row) return null;
          return (
            <div
              key={virtualItem.key}
              data-feed-row-index={virtualItem.index}
              data-index={virtualItem.index}
              style={{
                position: "absolute",
                top: 0,
                left: 0,
                width: "100%",
                transform: `translateY(${virtualItem.start}px)`,
              }}
            >
              <div
                className="mx-auto w-full max-w-2xl max-[959px]:max-w-none"
                style={{
                  paddingInline: `${feedCardHorizontalGutter}px`,
                  paddingBottom: `${FEED_CARD_GAP}px`,
                  paddingTop: virtualItem.index === 0 ? `${FEED_CARD_GAP}px` : undefined,
                }}
              >
                {row.type === "stories" ? (() => {
                  return (
                    <StoryGroupRow
                      storyItems={row.items}
                      itemIndices={row.itemIndices}
                      numCols={row.numCols}
                      tileHeight={desktopFeedCardHeight}
                      showEngagement={showEngagementCounts}
                      showReadInGrayscale={showReadInGrayscale}
                      density={cardDensity}
                      onItemClick={onItemClick}
                      onItemSave={onItemSave}
                      onItemArchive={onItemArchive}
                    />
                  );
                })() : (
                  <FeedItemRow
                    item={row.item}
                    index={row.itemIndex}
                    focused={itemIndexToRowIndex.get(focusedIndex) === virtualItem.index}
                    showEngagement={showEngagementCounts}
                    showReadInGrayscale={showReadInGrayscale}
                    density={cardDensity}
                    onItemClick={onItemClick}
                    onFocusChange={onFocusChange}
                    onItemSave={onItemSave}
                    onItemArchive={onItemArchive}
                    onItemLike={onItemLike}
                    onOpenCommentUrl={onOpenCommentUrl}
                    fixedHeight={desktopFeedCardHeight}
                  />
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
