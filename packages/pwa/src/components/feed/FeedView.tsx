import { useState, useMemo, useCallback } from "react";
import { FeedList } from "./FeedList";
import { ReaderView } from "./ReaderView";
import { PullToRefresh } from "../PullToRefresh";
import { useAppStore } from "../../lib/store";
import { toast } from "../Toast";
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

  const handleRefresh = useCallback(() => {
    toast.info("Open the desktop app to refresh feeds");
  }, []);

  return (
    <>
      <PullToRefresh onRefresh={handleRefresh}>
        <div className="p-3 sm:p-4 pb-20 sm:pb-4">
          <FeedList items={filteredItems} onItemClick={handleItemClick} />
        </div>
      </PullToRefresh>

      {selectedItem && (
        <ReaderView item={selectedItem} onClose={handleCloseReader} />
      )}
    </>
  );
}
