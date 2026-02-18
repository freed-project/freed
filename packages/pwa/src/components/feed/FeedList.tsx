import { useRef } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { FeedItem } from "./FeedItem";
import type { FeedItem as FeedItemType } from "@freed/shared";
import { useAppStore } from "../../lib/store";

interface FeedListProps {
  items: FeedItemType[];
  onItemClick?: (item: FeedItemType) => void;
}

export function FeedList({ items, onItemClick }: FeedListProps) {
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
      <div className="flex flex-col items-center justify-center h-64 text-center px-4">
        <div className="w-16 h-16 rounded-full bg-gradient-to-br from-[#3b82f6]/20 to-[#8b5cf6]/20 flex items-center justify-center mb-4">
          <span className="text-2xl">📡</span>
        </div>
        <p className="text-lg font-medium mb-2">No items yet</p>
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
            />
          </div>
        ))}
      </div>
    </div>
  );
}
