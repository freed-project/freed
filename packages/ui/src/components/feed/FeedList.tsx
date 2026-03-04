import { useRef, memo, useCallback } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { FeedItem } from "./FeedItem.js";
import type { FeedItem as FeedItemType } from "@freed/shared";
import { useAppStore, usePlatform } from "../../context/PlatformContext.js";

interface FeedListProps {
  items: FeedItemType[];
  onItemClick?: (item: FeedItemType) => void;
  focusedIndex?: number;
  onFocusChange?: (index: number) => void;
  /** Called when user clicks "Add Feed" from the empty state */
  onAddFeed?: () => void;
  /** Whether any feeds are subscribed — controls empty state message */
  hasFeedsSubscribed?: boolean;
  /** Called when user bookmarks/unbookmarks an item */
  onItemSave?: (item: FeedItemType) => void;
  /** Called when user archives an item from the feed card */
  onItemArchive?: (item: FeedItemType) => void;
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
  onItemClick?: (item: FeedItemType) => void;
  onFocusChange?: (index: number) => void;
  onItemSave?: (item: FeedItemType) => void;
  onItemArchive?: (item: FeedItemType) => void;
}

const FeedItemRow = memo(function FeedItemRow({
  item,
  index,
  focused,
  showEngagement,
  onItemClick,
  onFocusChange,
  onItemSave,
  onItemArchive,
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

  return (
    <FeedItem
      item={item}
      onClick={handleClick}
      focused={focused}
      showEngagement={showEngagement}
      onMouseEnter={handleMouseEnter}
      onSave={onItemSave ? handleSave : undefined}
      onArchive={onItemArchive ? handleArchive : undefined}
    />
  );
});

export function FeedList({
  items,
  onItemClick,
  focusedIndex = -1,
  onFocusChange,
  onAddFeed,
  hasFeedsSubscribed = false,
  onItemSave,
  onItemArchive,
  isSearching = false,
  searchQuery = "",
}: FeedListProps) {
  const parentRef = useRef<HTMLDivElement>(null);
  const { FeedEmptyState } = usePlatform();
  const showEngagementCounts = useAppStore(
    (s) => s.preferences.display.showEngagementCounts,
  );

  const virtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 220,
    overscan: 5,
    measureElement: (el) => el.getBoundingClientRect().height,
  });

  if (items.length === 0) {
    // Search returned no results — custom empty state.
    if (isSearching) {
      return (
        <div className="flex flex-col items-center justify-center flex-1 min-h-0 overflow-auto text-center px-6 py-12">
          <div className="w-16 h-16 rounded-full bg-gradient-to-br from-[#3b82f6]/20 to-[#8b5cf6]/20 flex items-center justify-center mb-4">
            <svg className="w-7 h-7 text-[#3b82f6]/60" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
          </div>
          <p className="text-lg font-medium mb-2">No results</p>
          <p className="text-sm text-[#71717a] max-w-xs">
            Nothing matched{searchQuery ? <> &ldquo;<span className="text-white/60">{searchQuery}</span>&rdquo;</> : ""}.
            Try a different term, or switch to <span className="text-white/60">All Sources</span> in the sidebar to search everywhere.
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
        <div className="w-16 h-16 rounded-full bg-gradient-to-br from-[#3b82f6]/20 to-[#8b5cf6]/20 flex items-center justify-center mb-4">
          <span className="text-2xl">📡</span>
        </div>
        {hasFeedsSubscribed ? (
          <>
            <p className="text-lg font-medium mb-2">All caught up!</p>
            <p className="text-sm text-[#71717a]">No new items to show.</p>
          </>
        ) : (
          <>
            <p className="text-lg font-medium mb-2">Welcome to Freed</p>
            <p className="text-sm text-[#71717a] mb-6 max-w-xs">
              Add RSS feeds to start reading.
            </p>
            {onAddFeed && (
              <button
                onClick={onAddFeed}
                className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-[#8b5cf6]/20 text-[#8b5cf6] hover:bg-[#8b5cf6]/30 transition-colors font-medium text-sm"
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

  return (
    <div ref={parentRef} className="flex-1 min-h-0 overflow-auto overscroll-none minimal-scroll">
      <div
        style={{ height: virtualizer.getTotalSize() }}
        className="relative w-full"
      >
        {virtualizer.getVirtualItems().map((virtualItem) => (
          <div
            key={virtualItem.key}
            data-index={virtualItem.index}
            ref={virtualizer.measureElement}
            style={{
              position: "absolute",
              top: 0,
              left: 0,
              width: "100%",
              transform: `translateY(${virtualItem.start}px)`,
            }}
            className={`px-3 sm:px-4 pb-3 sm:pb-4 max-w-2xl mx-auto${virtualItem.index === 0 ? " pt-3 sm:pt-4" : ""}`}
          >
            <FeedItemRow
              item={items[virtualItem.index]}
              index={virtualItem.index}
              focused={virtualItem.index === focusedIndex}
              showEngagement={showEngagementCounts}
              onItemClick={onItemClick}
              onFocusChange={onFocusChange}
              onItemSave={onItemSave}
              onItemArchive={onItemArchive}
            />
          </div>
        ))}
      </div>
    </div>
  );
}
