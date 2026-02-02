import { FeedItem } from "./FeedItem";
import type { FeedItem as FeedItemType } from "@freed/shared";

interface FeedListProps {
  items: FeedItemType[];
  onItemClick?: (item: FeedItemType) => void;
}

export function FeedList({ items, onItemClick }: FeedListProps) {
  if (items.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-64 text-center px-4">
        <div className="w-16 h-16 rounded-full bg-gradient-to-br from-[#3b82f6]/20 to-[#8b5cf6]/20 flex items-center justify-center mb-4">
          <span className="text-2xl">📡</span>
        </div>
        <p className="text-lg font-medium mb-2">No items yet</p>
        <p className="text-sm text-[#71717a] max-w-xs">
          Add an RSS feed or connect your X account to start capturing content
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3 sm:space-y-4 max-w-2xl mx-auto">
      {items.map((item) => (
        <FeedItem
          key={item.globalId}
          item={item}
          onClick={() => onItemClick?.(item)}
        />
      ))}
    </div>
  );
}
