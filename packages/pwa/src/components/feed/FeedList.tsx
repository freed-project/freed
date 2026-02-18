import { useRef } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { FeedItem } from "./FeedItem";
import type { FeedItem as FeedItemType } from "@freed/shared";
import { useAppStore } from "../../lib/store";

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
}

export function FeedList({
  items,
  onItemClick,
  focusedIndex = -1,
  onFocusChange,
  onAddFeed,
  hasFeedsSubscribed = false,
  onItemSave,
}: FeedListProps) {
  const parentRef = useRef<HTMLDivElement>(null);
  const compactMode = useAppStore((s) => s.preferences.display.compactMode);
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
    return (
      <div className="flex flex-col items-center justify-center h-full min-h-64 text-center px-6 py-12">
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
              Add RSS feeds or connect the desktop app to start reading.
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
    <div ref={parentRef} className="h-full overflow-auto overscroll-none">
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
            className="px-3 sm:px-4 pb-3 sm:pb-4 max-w-2xl mx-auto"
          >
            <FeedItem
              item={items[virtualItem.index]}
              onClick={() => onItemClick?.(items[virtualItem.index])}
              compact={compactMode}
              showEngagement={showEngagementCounts}
              focused={virtualItem.index === focusedIndex}
              onMouseEnter={() => onFocusChange?.(virtualItem.index)}
              onSave={onItemSave ? (e) => { e.stopPropagation(); onItemSave(items[virtualItem.index]); } : undefined}
            />
          </div>
        ))}
      </div>
    </div>
  );
}
