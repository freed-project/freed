import { useState, useMemo, useEffect, useLayoutEffect, useCallback, useRef, memo } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { FeedList } from "./FeedList.js";
import { ReaderView } from "./ReaderView.js";
import { FeedItem as FeedItemCard } from "./FeedItem.js";
import { AddFeedDialog } from "../AddFeedDialog.js";
import { useAppStore, usePlatform } from "../../context/PlatformContext.js";
import { useSearchResults } from "../../hooks/useSearchResults.js";
import { useIsMobile } from "../../hooks/useIsMobile.js";
import type { FeedItem } from "@freed/shared";
import { getFilterLabel, getRetentionLabel } from "../../lib/feed-view-labels.js";

// ─── Compact sidebar panel for dual-column mode ────────────────────────────

const MIN_PANEL_WIDTH = 100;
const MAX_PANEL_WIDTH = 500;
const DEFAULT_PANEL_WIDTH = 150;
const NARROW_THRESHOLD = 150;

// Card geometry: all cards are square (width × width), including story tiles.
// Wrapper padding: px-2 (8px each side = 16px total), pb-2 (8px), first item gets pt-2 (8px).
const CARD_H_PAD = 16;
const CARD_V_GAP = 8;

type ViewTransitionLike = {
  finished: Promise<void>;
};

type ViewTransitionDocument = Document & {
  startViewTransition?: (update: () => void) => ViewTransitionLike;
};

interface CompactFeedPanelProps {
  items: FeedItem[];
  selectedId: string;
  selectionMoveDirection?: -1 | 0 | 1;
  onItemClick: (item: FeedItem) => void;
  width: number;
}

const CompactFeedPanel = memo(function CompactFeedPanel({
  items,
  selectedId,
  selectionMoveDirection = 0,
  onItemClick,
  width,
}: CompactFeedPanelProps) {
  const parentRef = useRef<HTMLDivElement>(null);
  const scrollAnchorRef = useRef<{ index: number; offset: number } | null>(null);
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
    scrollAnchorRef.current = { index: Math.min(idx, items.length - 1), offset };
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

  const virtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => parentRef.current,
    estimateSize: estimateItemSize,
    overscan: 3,
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
        newStart += items[i]?.contentType === "story" ? storyItemHeight : itemHeight;
      }
    }

    const el = parentRef.current;
    if (el) el.scrollTop = newStart + anchor.offset;
  }); // intentionally no deps: only fires work when anchor ref is set

  // Auto-scroll to the selected item on selection change.
  const selectedIndex = useMemo(
    () => items.findIndex((it) => it.globalId === selectedId),
    [items, selectedId],
  );
  const didInitialScroll = useRef(false);
  useLayoutEffect(() => {
    if (selectedIndex < 0) return;
    const behavior = didInitialScroll.current ? "smooth" : "auto";

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
    const scrollPadding = CARD_V_GAP;
    const lookaheadStart =
      lookaheadIndex === 0
        ? 0
        : firstItemHeight + (lookaheadIndex - 1) * itemHeight;
    const lookaheadSize = lookaheadIndex === 0 ? firstItemHeight : itemHeight;
    const lookaheadEnd = lookaheadStart + lookaheadSize;
    const visibleTop = el.scrollTop;
    const visibleBottom = visibleTop + el.clientHeight;

    if (selectionMoveDirection > 0) {
      const nextTop = lookaheadEnd - (el.clientHeight - scrollPadding);
      if (lookaheadEnd > visibleBottom - scrollPadding) {
        el.scrollTo({ top: Math.max(0, nextTop), behavior });
      }
    } else {
      const nextTop = lookaheadStart - scrollPadding;
      if (lookaheadStart < visibleTop + scrollPadding) {
        el.scrollTo({ top: Math.max(0, nextTop), behavior });
      }
    }

    didInitialScroll.current = true;
  }, [
    firstItemHeight,
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
      className="shrink-0 min-h-0 overflow-y-auto minimal-scroll bg-[var(--theme-bg-root)]"
      style={{ width }}
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
              <div className={`px-2 pb-2${vi.index === 0 ? " pt-2" : ""}`}>
                <FeedItemCard
                  item={item}
                  compact
                  narrow={width < NARROW_THRESHOLD}
                  selected={item.globalId === selectedId}
                  onClick={() => onItemClick(item)}
                  storyHeight={item.contentType === "story" ? storyTileH : undefined}
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
  const { addRssFeed } = usePlatform();
  const canAddFeeds = !!addRssFeed;
  const items = useAppStore((s) => s.items);
  const feeds = useAppStore((s) => s.feeds);
  const activeFilter = useAppStore((s) => s.activeFilter);
  const searchQuery = useAppStore((s) => s.searchQuery);
  const selectedItemId = useAppStore((s) => s.selectedItemId);
  const setSelectedItem = useAppStore((s) => s.setSelectedItem);
  const markAsRead = useAppStore((s) => s.markAsRead);
  const toggleSaved = useAppStore((s) => s.toggleSaved);
  const toggleArchived = useAppStore((s) => s.toggleArchived);
  const toggleLiked = useAppStore((s) => s.toggleLiked);
  const deleteAllArchived = useAppStore((s) => s.deleteAllArchived);
  const archivePruneDays = useAppStore((s) => s.preferences.display.archivePruneDays);

  const handleItemSave = useCallback(
    (item: FeedItem) => toggleSaved(item.globalId),
    [toggleSaved],
  );
  // Only offer archive action on non-archived views; archived view shows the item already
  const handleItemArchive = useCallback(
    (item: FeedItem) => toggleArchived(item.globalId),
    [toggleArchived],
  );
  const handleItemLike = useCallback(
    (item: FeedItem) => toggleLiked?.(item.globalId),
    [toggleLiked],
  );

  const { openUrl } = usePlatform();
  const handleOpenCommentUrl = useCallback((url: string) => {
    if (openUrl) {
      openUrl(url);
    } else {
      window.open(url, "_blank", "noopener,noreferrer");
    }
  }, [openUrl]);

  // Archive toolbar confirm-to-delete state.
  // First click arms the button; second click executes. Auto-resets after 3s.
  const [deleteConfirmArmed, setDeleteConfirmArmed] = useState(false);
  const deleteConfirmTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleDeleteArchivedClick = useCallback(() => {
    if (!deleteConfirmArmed) {
      setDeleteConfirmArmed(true);
      deleteConfirmTimerRef.current = setTimeout(() => setDeleteConfirmArmed(false), 3000);
      return;
    }
    if (deleteConfirmTimerRef.current) clearTimeout(deleteConfirmTimerRef.current);
    setDeleteConfirmArmed(false);
    void deleteAllArchived();
  }, [deleteConfirmArmed, deleteAllArchived]);

  // Reset confirm state whenever the archived view is left.
  useEffect(() => {
    if (!activeFilter.archivedOnly) {
      if (deleteConfirmTimerRef.current) clearTimeout(deleteConfirmTimerRef.current);
      setDeleteConfirmArmed(false);
    }
  }, [activeFilter.archivedOnly]);

  const [addFeedOpen, setAddFeedOpen] = useState(false);

  // useSearchResults handles both the search and the normal ranked+filtered path.
  // When searchQuery is empty it behaves identically to the previous useMemo.
  const { filteredItems, isSearching, resultCount } = useSearchResults(items, searchQuery, activeFilter);

  const scopeLabel = useMemo(() => getFilterLabel(activeFilter, feeds), [activeFilter, feeds]);
  const dualColumnMode = useAppStore((s) => s.preferences.display.reading.dualColumnMode);
  const isMobile = useIsMobile();
  const showDualColumn = dualColumnMode && !!selectedItemId && !isMobile;

  const runFeedLayoutTransition = useCallback((update: () => void) => {
    if (typeof window === "undefined" || window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      update();
      return;
    }

    const doc = document as ViewTransitionDocument;
    if (!doc.startViewTransition) {
      update();
      return;
    }

    document.documentElement.classList.add("feed-layout-transition");

    try {
      const transition = doc.startViewTransition(() => {
        update();
      });

      void transition.finished.finally(() => {
        document.documentElement.classList.remove("feed-layout-transition");
      });
    } catch {
      document.documentElement.classList.remove("feed-layout-transition");
      update();
    }
  }, []);

  // Store only the ID so the rendered item stays in sync with the store.
  // Holding the full FeedItem in state would freeze userState (saved, archived,
  // tags) at the moment the user clicked, making toolbar toggles appear broken.
  const selectedItem = useMemo(
    () => (selectedItemId ? filteredItems.find((i) => i.globalId === selectedItemId) ?? null : null),
    [filteredItems, selectedItemId],
  );
  const [focusedIndex, setFocusedIndex] = useState<number>(-1);
  const [keyboardFocusDirection, setKeyboardFocusDirection] = useState<-1 | 0 | 1>(0);
  const [compactSelectionDirection, setCompactSelectionDirection] = useState<-1 | 0 | 1>(0);

  const openItem = useCallback(
    (item: FeedItem) => {
      const selectItem = () => {
        setSelectedItem(item.globalId);
        markAsRead(item.globalId);
      };

      if (dualColumnMode && !isMobile && !selectedItemId) {
        runFeedLayoutTransition(selectItem);
        return;
      }

      selectItem();
    },
    [dualColumnMode, isMobile, markAsRead, runFeedLayoutTransition, selectedItemId, setSelectedItem],
  );

  const openItemDirect = useCallback((item: FeedItem) => {
    setCompactSelectionDirection(0);
    openItem(item);
  }, [openItem]);

  const closeItem = useCallback(() => {
    setCompactSelectionDirection(0);
    if (dualColumnMode && !isMobile && selectedItemId) {
      runFeedLayoutTransition(() => {
        setSelectedItem(null);
      });
      return;
    }
    setSelectedItem(null);
  }, [dualColumnMode, isMobile, runFeedLayoutTransition, selectedItemId, setSelectedItem]);

  // Keyboard navigation: j/k to move, Enter/o to open, Escape to close.
  // The HTMLInputElement guard means j/k won't fire while the search bar is focused.
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement
      )
        return;

      if (selectedItem) {
        if (showDualColumn && (e.key === "ArrowDown" || e.key === "ArrowUp")) {
          e.preventDefault();
          const currentIndex = filteredItems.findIndex((item) => item.globalId === selectedItem.globalId);
          if (currentIndex < 0) return;

          const direction = e.key === "ArrowDown" ? 1 : -1;
          const nextIndex = Math.max(0, Math.min(currentIndex + direction, filteredItems.length - 1));
          if (nextIndex === currentIndex) return;

          setCompactSelectionDirection(direction);
          setFocusedIndex(nextIndex);
          openItem(filteredItems[nextIndex]);
          return;
        }

        if (e.key === "Escape") closeItem();
        return;
      }

      if (e.key === "j" || e.key === "ArrowDown") {
        e.preventDefault();
        setKeyboardFocusDirection(1);
        setFocusedIndex((prev) => Math.min(prev + 1, filteredItems.length - 1));
      } else if (e.key === "k" || e.key === "ArrowUp") {
        e.preventDefault();
        setKeyboardFocusDirection(-1);
        setFocusedIndex((prev) => Math.max(prev - 1, 0));
      } else if ((e.key === "Enter" || e.key === "o") && focusedIndex >= 0) {
        const item = filteredItems[focusedIndex];
        if (item) openItemDirect(item);
      }
    };

    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [selectedItem, showDualColumn, filteredItems, focusedIndex, openItem, openItemDirect, closeItem]);

  // Reset keyboard focus when the active filter or search query changes.
  useEffect(() => {
    setCompactSelectionDirection(0);
    setKeyboardFocusDirection(0);
    setFocusedIndex(-1);
  }, [activeFilter, searchQuery]);

  const handleFocusChange = useCallback((index: number) => {
    setKeyboardFocusDirection(0);
    setFocusedIndex(index);
  }, []);

  // ─── Dual-column drag-resize ───────────────────────────────────────────────

  const [panelWidth, setPanelWidth] = useState(DEFAULT_PANEL_WIDTH);
  const isDraggingRef = useRef(false);
  const dragStartXRef = useRef(0);
  const dragStartWidthRef = useRef(0);

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
    const clamped = Math.max(MIN_PANEL_WIDTH, Math.min(MAX_PANEL_WIDTH, dragStartWidthRef.current + dx));
    setPanelWidth(clamped);
  }, []);

  const handleDragEnd = useCallback(() => {
    if (!isDraggingRef.current) return;
    isDraggingRef.current = false;
    document.body.style.cursor = "";
    document.body.style.userSelect = "";
  }, []);

  // ─── Layout decision ────────────────────────────────────────────────────────

  if (showDualColumn && selectedItem) {
    return (
      <div className="h-full flex flex-col overflow-hidden">
        {/* Archive retention toolbar — only shown in the archived view */}
        {activeFilter.archivedOnly && (
          <div className="flex-shrink-0 px-4 py-2 border-b border-[var(--theme-header-border)] flex items-center justify-between gap-4">
            <p className="text-xs text-[var(--theme-text-soft)]">{getRetentionLabel(archivePruneDays ?? 30)}</p>
            {(archivePruneDays ?? 30) > 0 && (
              <button
                onClick={handleDeleteArchivedClick}
                className={`text-xs px-3 py-1 rounded-lg transition-colors border whitespace-nowrap ${
                  deleteConfirmArmed
                    ? "bg-red-500/20 text-red-400 border-red-500/30 hover:bg-red-500/30"
                    : "bg-[var(--theme-bg-muted)] text-[var(--theme-text-muted)] border-transparent hover:bg-[var(--theme-bg-card-hover)] hover:text-[var(--theme-text-primary)]"
                }`}
              >
                {deleteConfirmArmed ? "Confirm delete?" : "Delete archived content now"}
              </button>
            )}
          </div>
        )}
        <div className="flex-1 flex overflow-hidden">
          <CompactFeedPanel
            items={filteredItems}
            selectedId={selectedItem.globalId}
            selectionMoveDirection={compactSelectionDirection}
            onItemClick={openItemDirect}
            width={panelWidth}
          />
          {/* Draggable column separator -- zero visible width, padding provides the hit area */}
          <div
            className="w-0 px-0.5 shrink-0 cursor-col-resize hover:bg-[color:rgb(var(--theme-accent-secondary-rgb)/0.2)] active:bg-[color:rgb(var(--theme-accent-secondary-rgb)/0.3)] transition-colors -mx-0.5 z-10"
            onPointerDown={handleDragStart}
            onPointerMove={handleDragMove}
            onPointerUp={handleDragEnd}
            onPointerCancel={handleDragEnd}
            role="separator"
            aria-orientation="vertical"
            aria-label="Resize sidebar"
          />
          <ReaderView item={selectedItem} onClose={closeItem} dualColumn onOpenUrl={handleOpenCommentUrl} />
        </div>
        <AddFeedDialog open={addFeedOpen} onClose={() => setAddFeedOpen(false)} />
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col">
      {/* Archive retention toolbar — only shown in the archived view */}
      {activeFilter.archivedOnly && (
        <div className="flex-shrink-0 px-4 py-2 border-b border-[var(--theme-header-border)] flex items-center justify-between gap-4">
          <p className="text-xs text-[var(--theme-text-soft)]">{getRetentionLabel(archivePruneDays ?? 30)}</p>
          {(archivePruneDays ?? 30) > 0 && (
            <button
              onClick={handleDeleteArchivedClick}
              className={`text-xs px-3 py-1 rounded-lg transition-colors border whitespace-nowrap ${
                deleteConfirmArmed
                  ? "bg-red-500/20 text-red-400 border-red-500/30 hover:bg-red-500/30"
                  : "bg-[var(--theme-bg-muted)] text-[var(--theme-text-muted)] border-transparent hover:bg-[var(--theme-bg-card-hover)] hover:text-[var(--theme-text-primary)]"
              }`}
            >
              {deleteConfirmArmed ? "Confirm delete?" : "Delete archived content now"}
            </button>
          )}
        </div>
      )}

      {/* Search results banner — only shown when actively searching */}
      {isSearching && (
        <div className="flex-shrink-0 px-4 py-2 border-b border-[var(--theme-header-border)] flex items-center justify-between">
          <p className="text-xs text-[var(--theme-text-muted)]">
            {resultCount > 0 ? (
              <>
                <span className="font-medium text-[var(--theme-text-secondary)]">{resultCount.toLocaleString()}</span>
                {" "}result{resultCount !== 1 ? "s" : ""} in{" "}
                <span className="font-medium text-[var(--theme-text-secondary)]">{scopeLabel}</span>
              </>
            ) : (
              <>
                No results in <span className="font-medium text-[var(--theme-text-secondary)]">{scopeLabel}</span>
              </>
            )}
          </p>
        </div>
      )}

      <FeedList
        items={filteredItems}
        onItemClick={openItemDirect}
        focusedIndex={focusedIndex}
        focusMoveDirection={keyboardFocusDirection}
        onFocusChange={handleFocusChange}
        onAddFeed={canAddFeeds ? () => setAddFeedOpen(true) : undefined}
        hasFeedsSubscribed={Object.keys(feeds).length > 0}
        onItemSave={handleItemSave}
        onItemArchive={activeFilter.archivedOnly ? undefined : handleItemArchive}
        onItemLike={toggleLiked ? handleItemLike : undefined}
        onOpenCommentUrl={handleOpenCommentUrl}
        isSearching={isSearching}
        searchQuery={searchQuery}
      />

      {selectedItem && (
        <ReaderView item={selectedItem} onClose={closeItem} onOpenUrl={handleOpenCommentUrl} />
      )}

      <AddFeedDialog open={addFeedOpen} onClose={() => setAddFeedOpen(false)} />
    </div>
  );
}
