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
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/50 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Dialog */}
      <div className="relative w-full max-w-md mx-4 bg-glass-card border border-glass-border rounded-xl p-6 shadow-2xl">
        <h2 className="text-xl font-semibold mb-4">Add RSS Feed</h2>

        <form onSubmit={handleSubmit}>
          <div className="mb-4">
            <label
              htmlFor="feed-url"
              className="block text-sm text-white/55 mb-2"
            >
              Feed URL
            </label>
            <input
              id="feed-url"
              type="url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://example.com/feed.xml"
              className="w-full px-4 py-2 bg-glass-input border border-glass-border rounded-lg focus:outline-none focus:border-accent text-white placeholder-white/35"
              disabled={loading}
              autoFocus
            />
          </div>

          {error && (
            <div className="mb-4 p-3 bg-red-500/20 border border-red-500/50 rounded-lg text-red-400 text-sm">
              {error}
            </div>
          )}

          <div className="flex gap-3 justify-end">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-white/70 hover:text-white transition-colors"
              disabled={loading}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="glass-button px-4 py-2 bg-accent/20 text-accent hover:bg-accent/30"
              disabled={loading || !url.trim()}
            >
              {loading ? "Adding..." : "Add Feed"}
            </button>
          </div>
        </form>

        {/* Example feeds */}
        <div className="mt-6 pt-4 border-t border-glass-border">
          <p className="text-xs text-white/35 mb-2">Try these example feeds:</p>
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
                className="text-xs px-2 py-1 bg-white/5 hover:bg-white/10 rounded text-white/55 hover:text-white truncate max-w-[200px]"
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
