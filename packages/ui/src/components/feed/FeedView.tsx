import { useState, useMemo, useEffect, useCallback } from "react";
import { FeedList } from "./FeedList.js";
import { ReaderView } from "./ReaderView.js";
import { AddFeedDialog } from "../AddFeedDialog.js";
import { useAppStore, usePlatform } from "../../context/PlatformContext.js";
import { useSearchResults } from "../../hooks/useSearchResults.js";
import type { FeedItem, RssFeed, FilterOptions } from "@freed/shared";

const PLATFORM_LABELS: Record<string, string> = {
  x: "X",
  rss: "RSS",
  youtube: "YouTube",
  reddit: "Reddit",
  mastodon: "Mastodon",
  github: "GitHub",
  facebook: "Facebook",
  instagram: "Instagram",
  saved: "Saved",
};

/** Human-readable label for the scope currently active in the sidebar. */
function getFilterLabel(filter: FilterOptions, feeds: Record<string, RssFeed>): string {
  if (filter.savedOnly) return "Saved";
  if (filter.archivedOnly) return "Archived";
  if (filter.feedUrl) return feeds[filter.feedUrl]?.title ?? "this feed";
  if (filter.platform) return PLATFORM_LABELS[filter.platform] ?? filter.platform;
  return "All Sources";
}

export function FeedView() {
  const { addRssFeed } = usePlatform();
  const canAddFeeds = !!addRssFeed;
  const items = useAppStore((s) => s.items);
  const feeds = useAppStore((s) => s.feeds);
  const activeFilter = useAppStore((s) => s.activeFilter);
  const searchQuery = useAppStore((s) => s.searchQuery);
  const markAsRead = useAppStore((s) => s.markAsRead);
  const toggleSaved = useAppStore((s) => s.toggleSaved);
  const toggleArchived = useAppStore((s) => s.toggleArchived);

  const handleItemSave = useCallback(
    (item: FeedItem) => toggleSaved(item.globalId),
    [toggleSaved],
  );
  // Only offer archive action on non-archived views; archived view shows the item already
  const handleItemArchive = useCallback(
    (item: FeedItem) => toggleArchived(item.globalId),
    [toggleArchived],
  );

  const [addFeedOpen, setAddFeedOpen] = useState(false);

  // useSearchResults handles both the search and the normal ranked+filtered path.
  // When searchQuery is empty it behaves identically to the previous useMemo.
  const { filteredItems, isSearching, resultCount } = useSearchResults(items, searchQuery, activeFilter);

  const scopeLabel = useMemo(() => getFilterLabel(activeFilter, feeds), [activeFilter, feeds]);

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
        if (e.key === "Escape") closeItem();
        return;
      }

      if (e.key === "j" || e.key === "ArrowDown") {
        e.preventDefault();
        setFocusedIndex((prev) => Math.min(prev + 1, filteredItems.length - 1));
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

  // Reset keyboard focus when the active filter or search query changes.
  useEffect(() => {
    setFocusedIndex(-1);
  }, [activeFilter, searchQuery]);

  return (
    <div className="h-full flex flex-col">
      {/* Search results banner — only shown when actively searching */}
      {isSearching && (
        <div className="flex-shrink-0 px-4 py-2 border-b border-white/5 flex items-center justify-between">
          <p className="text-xs text-[#71717a]">
            {resultCount > 0 ? (
              <>
                <span className="text-white/60 font-medium">{resultCount.toLocaleString()}</span>
                {" "}result{resultCount !== 1 ? "s" : ""} in{" "}
                <span className="text-white/60 font-medium">{scopeLabel}</span>
              </>
            ) : (
              <>
                No results in <span className="text-white/60 font-medium">{scopeLabel}</span>
              </>
            )}
          </p>
        </div>
      )}

      <FeedList
        items={filteredItems}
        onItemClick={openItem}
        focusedIndex={focusedIndex}
        onFocusChange={setFocusedIndex}
        onAddFeed={canAddFeeds ? () => setAddFeedOpen(true) : undefined}
        hasFeedsSubscribed={Object.keys(feeds).length > 0}
        onItemSave={handleItemSave}
        onItemArchive={activeFilter.archivedOnly ? undefined : handleItemArchive}
        isSearching={isSearching}
        searchQuery={searchQuery}
      />

      {selectedItem && (
        <ReaderView item={selectedItem} onClose={closeItem} />
      )}

      <AddFeedDialog open={addFeedOpen} onClose={() => setAddFeedOpen(false)} />
    </div>
  );
}
