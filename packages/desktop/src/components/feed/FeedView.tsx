import { useState, useMemo } from "react";
import { FeedList } from "./FeedList";
import { ReaderView } from "./ReaderView";
import { useAppStore } from "../../lib/store";
import { sortByPriority, filterFeedItems } from "@freed/shared";
import type { FeedItem } from "@freed/shared";

export function FeedView() {
  const items = useAppStore((s) => s.items);
  const activeFilter = useAppStore((s) => s.activeFilter);

  const filteredItems = useMemo(() => {
    const filtered = filterFeedItems(items, activeFilter);
    return sortByPriority(filtered);
  }, [items, activeFilter]);

  const [selectedItem, setSelectedItem] = useState<FeedItem | null>(null);

  return (
    <>
      <FeedList
        items={filteredItems}
        onItemClick={(item) => setSelectedItem(item)}
      />

      {selectedItem && (
        <ReaderView item={selectedItem} onClose={() => setSelectedItem(null)} />
      )}
    </>
  );
}
