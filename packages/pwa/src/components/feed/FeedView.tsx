import { useState, useMemo, useEffect, useCallback } from "react";
import { FeedList } from "./FeedList";
import { ReaderView } from "./ReaderView";
import { useAppStore } from "../../lib/store";
import { sortByPriority, filterFeedItems } from "@freed/shared";
import type { FeedItem } from "@freed/shared";

export function FeedView() {
  const items = useAppStore((s) => s.items);
  const activeFilter = useAppStore((s) => s.activeFilter);
  const markAsRead = useAppStore((s) => s.markAsRead);

  const filteredItems = useMemo(() => {
    const filtered = filterFeedItems(items, activeFilter);
    return sortByPriority(filtered);
  }, [items, activeFilter]);

  const [selectedItem, setSelectedItem] = useState<FeedItem | null>(null);
  const [focusedIndex, setFocusedIndex] = useState<number>(-1);

  const openItem = useCallback(
    (item: FeedItem) => {
      setSelectedItem(item);
      markAsRead(item.globalId);
    },
    [markAsRead],
  );

  const closeItem = useCallback(() => {
    setSelectedItem(null);
  }, []);

  // Keyboard navigation: j/k to move, Enter/o to open, Escape to close
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      // Don't intercept inside inputs or textareas
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement
      )
        return;

      if (selectedItem) {
        if (e.key === "Escape") closeItem();
        return;
      }

      if (e.key === "j" || e.key === "ArrowDown") {
        e.preventDefault();
        setFocusedIndex((prev) =>
          Math.min(prev + 1, filteredItems.length - 1),
        );
      } else if (e.key === "k" || e.key === "ArrowUp") {
        e.preventDefault();
        setFocusedIndex((prev) => Math.max(prev - 1, 0));
      } else if ((e.key === "Enter" || e.key === "o") && focusedIndex >= 0) {
        const item = filteredItems[focusedIndex];
        if (item) openItem(item);
      }
    };

    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [selectedItem, filteredItems, focusedIndex, openItem, closeItem]);

  // Reset focus when filter changes
  useEffect(() => {
    setFocusedIndex(-1);
  }, [activeFilter]);

  return (
    <>
      <FeedList
        items={filteredItems}
        onItemClick={openItem}
        focusedIndex={focusedIndex}
        onFocusChange={setFocusedIndex}
      />

      {selectedItem && (
        <ReaderView item={selectedItem} onClose={closeItem} />
      )}
    </>
  );
}
