import { FeedItem } from "./FeedItem";
import type { FeedItem as FeedItemType } from "@freed/shared";

interface FeedListProps {
  items: FeedItemType[];
  onItemClick?: (item: FeedItemType) => void;
}

export function FeedList({ items, onItemClick }: FeedListProps) {
  if (items.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-64 text-white/55">
        <p className="text-lg mb-2">No items yet</p>
        <p className="text-sm">Start capturing content to see it here</p>
      </div>
    );
  }

  return (
    <div className="space-y-4 max-w-2xl mx-auto">
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
