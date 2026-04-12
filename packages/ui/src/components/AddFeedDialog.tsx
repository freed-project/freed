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
          <label htmlFor="feed-url" className="mb-2 block text-sm text-[var(--theme-text-secondary)]">
            Feed URL
          </label>
          <input
            id="feed-url"
            type="url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://example.com/feed.xml"
            className="w-full rounded-xl border border-[var(--theme-border-subtle)] bg-[var(--theme-bg-input)] px-4 py-3 text-[var(--theme-text-primary)] placeholder-[var(--theme-text-muted)] transition-colors focus:outline-none focus:border-[var(--theme-border-strong)]"
            disabled={loading}
            autoFocus
          />
        </div>

        {error && (
          <div className="theme-feedback-panel-danger mb-4 rounded-xl p-3 text-sm theme-feedback-text-danger">
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

      <div className="mt-6 border-t border-[var(--theme-border-subtle)] pt-4">
        <p className="mb-3 text-xs text-[var(--theme-text-muted)]">Try these example feeds:</p>
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
              className="rounded-lg bg-[var(--theme-bg-muted)] px-3 py-1.5 text-xs text-[var(--theme-text-secondary)] transition-colors hover:bg-[rgb(var(--theme-accent-secondary-rgb)/0.14)] hover:text-[var(--theme-accent-secondary)]"
            >
              {new URL(exampleUrl).hostname}
            </button>
          ))}
        </div>
      </div>
    </>
  );
}
