import { useState } from "react";
import { usePlatform } from "../context/PlatformContext.js";
import { BottomSheet } from "./BottomSheet.js";

interface AddFeedDialogProps {
  open: boolean;
  onClose: () => void;
}

export function AddFeedDialog({ open, onClose }: AddFeedDialogProps) {
  const { addRssFeed } = usePlatform();

  const handleClose = () => onClose();

  return (
    <BottomSheet open={open} onClose={handleClose} title="Add RSS Feed" maxWidth="sm:max-w-lg">
      {addRssFeed && <AddUrlTab onClose={handleClose} />}
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
