import { useState } from "react";
import { addRssFeed } from "../lib/capture";

interface AddFeedDialogProps {
  open: boolean;
  onClose: () => void;
}

export function AddFeedDialog({ open, onClose }: AddFeedDialogProps) {
  const [url, setUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!open) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!url.trim()) return;

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
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Dialog - slides up from bottom on mobile */}
      <div className="relative w-full sm:max-w-md sm:mx-4 bg-[#141414] border border-[rgba(255,255,255,0.08)] rounded-t-2xl sm:rounded-2xl p-6 shadow-2xl">
        {/* Mobile drag indicator */}
        <div className="sm:hidden w-12 h-1 bg-white/20 rounded-full mx-auto mb-4" />
        
        <h2 className="text-xl font-semibold mb-4">Add RSS Feed</h2>

        <form onSubmit={handleSubmit}>
          <div className="mb-4">
            <label
              htmlFor="feed-url"
              className="block text-sm text-[#a1a1aa] mb-2"
            >
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

          <div className="flex gap-3 justify-end">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2.5 text-[#a1a1aa] hover:text-white transition-colors"
              disabled={loading}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="btn-primary px-6 py-2.5 disabled:opacity-50 disabled:cursor-not-allowed"
              disabled={loading || !url.trim()}
            >
              {loading ? "Adding..." : "Add Feed"}
            </button>
          </div>
        </form>

        {/* Example feeds */}
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
      </div>
    </div>
  );
}
