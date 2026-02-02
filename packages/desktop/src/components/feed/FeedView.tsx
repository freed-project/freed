import { useState, useMemo } from "react";
import { FeedList } from "./FeedList";
import { ReaderView } from "./ReaderView";
import { useAppStore } from "../../lib/store";
import { sortByPriority, filterFeedItems } from "@freed/shared";
import type { FeedItem } from "@freed/shared";

export function FeedView() {
  // Select raw state (stable references)
  const items = useAppStore((s) => s.items);
  const activeFilter = useAppStore((s) => s.activeFilter);
  
  // Memoize filtering/sorting to avoid infinite loops
  const filteredItems = useMemo(() => {
    const filtered = filterFeedItems(items, activeFilter);
    return sortByPriority(filtered);
  }, [items, activeFilter]);

  const [selectedItem, setSelectedItem] = useState<FeedItem | null>(null);

  const handleItemClick = (item: FeedItem) => {
    setSelectedItem(item);
  };

  const handleCloseReader = () => {
    setSelectedItem(null);
  };

  return (
    <>
      <div className="h-full overflow-auto p-4">
        <FeedList items={filteredItems} onItemClick={handleItemClick} />
      </div>

      {selectedItem && (
        <ReaderView item={selectedItem} onClose={handleCloseReader} />
      )}
    </>
  );
}
