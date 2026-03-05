import { useState } from "react";
import { useAppStore, usePlatform } from "../context/PlatformContext.js";
import { BottomSheet } from "./BottomSheet.js";

type DialogTab = "url" | "manage";

interface AddFeedDialogProps {
  open: boolean;
  onClose: () => void;
}

export function AddFeedDialog({ open, onClose }: AddFeedDialogProps) {
  const { addRssFeed } = usePlatform();

  const availableTabs: { id: DialogTab; label: string }[] = [
    ...(addRssFeed ? [{ id: "url" as const, label: "Add URL" }] : []),
    { id: "manage" as const, label: "Manage" },
  ];

  const defaultTab: DialogTab = addRssFeed ? "url" : "manage";
  const [activeTab, setActiveTab] = useState<DialogTab>(defaultTab);

  const handleClose = () => {
    setActiveTab(defaultTab);
    onClose();
  };

  return (
    <BottomSheet open={open} onClose={handleClose} title="RSS Feeds" maxWidth="sm:max-w-lg">
      {availableTabs.length > 1 && (
        <div className="pb-4 flex-shrink-0">
          <div className="flex gap-0.5 bg-white/[0.04] rounded-xl p-1">
            {availableTabs.map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`flex-1 py-2 px-3 text-sm font-medium rounded-lg transition-all whitespace-nowrap ${
                  activeTab === tab.id
                    ? "bg-[#8b5cf6]/20 text-[#8b5cf6]"
                    : "text-[#a1a1aa] hover:text-white"
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>
      )}

      {activeTab === "url" && addRssFeed && <AddUrlTab onClose={handleClose} />}
      {activeTab === "manage" && <ManageTab />}
    </BottomSheet>
  );
}

function AddUrlTab({ onClose }: { onClose: () => void }) {
  const { addRssFeed } = usePlatform();
  const [url, setUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!url.trim() || !addRssFeed) return;

    setLoading(true);
    setError(null);

    try {
      await addRssFeed(url.trim());
      setUrl("");
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to add feed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <form onSubmit={handleSubmit}>
        <div className="mb-4">
          <label htmlFor="feed-url" className="block text-sm text-[#a1a1aa] mb-2">
            Feed URL
          </label>
          <input
            id="feed-url"
            type="url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://example.com/feed.xml"
            className="w-full px-4 py-3 bg-white/5 border border-[rgba(255,255,255,0.08)] rounded-xl focus:outline-none focus:border-[#8b5cf6] text-white placeholder-[#71717a] transition-colors"
            disabled={loading}
            autoFocus
          />
        </div>

        {error && (
          <div className="mb-4 p-3 bg-red-500/20 border border-red-500/50 rounded-xl text-red-400 text-sm">
            {error}
          </div>
        )}

        <div className="flex justify-end">
          <button
            type="submit"
            className="btn-primary px-6 py-2.5 disabled:opacity-50 disabled:cursor-not-allowed"
            disabled={loading || !url.trim()}
          >
            {loading ? "Adding..." : "Add Feed"}
          </button>
        </div>
      </form>

      <div className="mt-6 pt-4 border-t border-[rgba(255,255,255,0.08)]">
        <p className="text-xs text-[#71717a] mb-3">Try these example feeds:</p>
        <div className="flex flex-wrap gap-2">
          {[
            "https://simonwillison.net/atom/everything/",
            "https://www.theverge.com/rss/index.xml",
            "https://hnrss.org/frontpage",
          ].map((exampleUrl) => (
            <button
              key={exampleUrl}
              type="button"
              onClick={() => setUrl(exampleUrl)}
              className="text-xs px-3 py-1.5 bg-white/5 hover:bg-[#8b5cf6]/20 hover:text-[#8b5cf6] rounded-lg text-[#a1a1aa] transition-colors"
            >
              {new URL(exampleUrl).hostname}
            </button>
          ))}
        </div>
      </div>
    </>
  );
}

function ManageTab() {
  const feeds = useAppStore((s) => s.feeds);
  const removeFeed = useAppStore((s) => s.removeFeed);
  const removeAllFeeds = useAppStore((s) => s.removeAllFeeds);
  const feedList = Object.values(feeds);
  const [removing, setRemoving] = useState<string | null>(null);
  const [showRemoveAll, setShowRemoveAll] = useState(false);
  const [includeItems, setIncludeItems] = useState(false);
  const [removingAll, setRemovingAll] = useState(false);

  const handleRemove = async (url: string) => {
    setRemoving(url);
    try {
      await removeFeed(url);
    } finally {
      setRemoving(null);
    }
  };

  const handleRemoveAll = async () => {
    setRemovingAll(true);
    try {
      await removeAllFeeds(includeItems);
    } finally {
      setRemovingAll(false);
      setShowRemoveAll(false);
      setIncludeItems(false);
    }
  };

  if (feedList.length === 0) {
    return (
      <div className="text-center py-8">
        <p className="text-sm text-[#71717a]">No feeds subscribed yet.</p>
        <p className="text-xs text-[#52525b] mt-1">Add a feed URL to get started.</p>
      </div>
    );
  }

  return (
    <>
      <div className="space-y-2">
        {feedList.map((feed) => (
          <div
            key={feed.url}
            className="flex items-center gap-3 px-3 py-2.5 rounded-xl bg-white/[0.03] border border-[rgba(255,255,255,0.05)]"
          >
            {feed.imageUrl ? (
              <img src={feed.imageUrl} alt="" className="w-8 h-8 rounded-md flex-shrink-0 object-cover" />
            ) : (
              <div className="w-8 h-8 rounded-md bg-[#8b5cf6]/10 flex items-center justify-center flex-shrink-0">
                <span className="text-sm">📡</span>
              </div>
            )}
            <div className="flex-1 min-w-0">
              <p className="text-sm text-white truncate">{feed.title}</p>
              <p className="text-xs text-[#52525b] truncate">{feed.url}</p>
            </div>
            <button
              onClick={() => handleRemove(feed.url)}
              disabled={removing === feed.url}
              className="flex-shrink-0 p-1.5 rounded-lg hover:bg-red-500/20 text-[#71717a] hover:text-red-400 transition-colors disabled:opacity-50"
              aria-label={`Remove ${feed.title}`}
            >
              {removing === feed.url ? (
                <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
              ) : (
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                </svg>
              )}
            </button>
          </div>
        ))}
      </div>

      <div className="mt-4 pt-4 border-t border-[rgba(255,255,255,0.06)]">
        <button
          onClick={() => setShowRemoveAll(true)}
          className="text-xs text-red-400/70 hover:text-red-400 transition-colors"
        >
          Remove all {feedList.length.toLocaleString()} feeds&hellip;
        </button>
      </div>

      {showRemoveAll && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
          <div className="w-full max-w-sm bg-[#18181b] border border-[rgba(255,255,255,0.1)] rounded-2xl p-6 shadow-2xl">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-full bg-red-500/15 flex items-center justify-center flex-shrink-0">
                <svg className="w-5 h-5 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                </svg>
              </div>
              <div>
                <p className="text-sm font-semibold text-white">Remove all feeds?</p>
                <p className="text-xs text-[#71717a] mt-0.5">
                  This will unsubscribe from all {feedList.length.toLocaleString()} feeds on every synced device.
                </p>
              </div>
            </div>

            <label className="flex items-start gap-3 mb-5 cursor-pointer group">
              <input
                type="checkbox"
                checked={includeItems}
                onChange={(e) => setIncludeItems(e.target.checked)}
                className="mt-0.5 w-4 h-4 rounded border-[rgba(255,255,255,0.2)] bg-white/5 text-red-500 focus:ring-red-500 focus:ring-offset-0"
              />
              <div>
                <p className="text-sm text-[#a1a1aa] group-hover:text-white transition-colors">
                  Also delete all articles and reading history
                </p>
                <p className="text-xs text-[#52525b] mt-0.5">Cannot be undone</p>
              </div>
            </label>

            <div className="flex gap-3">
              <button
                onClick={() => { setShowRemoveAll(false); setIncludeItems(false); }}
                disabled={removingAll}
                className="flex-1 py-2.5 rounded-xl bg-white/5 hover:bg-white/10 text-[#a1a1aa] hover:text-white transition-colors text-sm disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={handleRemoveAll}
                disabled={removingAll}
                className="flex-1 py-2.5 rounded-xl bg-red-500/20 hover:bg-red-500/30 text-red-400 hover:text-red-300 transition-colors text-sm font-medium disabled:opacity-50"
              >
                {removingAll ? (
                  <span className="flex items-center justify-center gap-2">
                    <span className="w-3 h-3 border-2 border-red-400 border-t-transparent rounded-full animate-spin" />
                    Removing&hellip;
                  </span>
                ) : (
                  "Remove All"
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
