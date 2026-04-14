/**
 * Saved Content dialog
 *
 * Quick-access dialog for saving a URL or managing existing saved items.
 * Import and export live in Settings > Saved Content.
 */

import { useState } from "react";
import { BottomSheet } from "./BottomSheet.js";
import { toast } from "./Toast.js";
import { useAppStore, usePlatform } from "../context/PlatformContext.js";

interface SavedContentDialogProps {
  open: boolean;
  onClose: () => void;
}

export function SavedContentDialog({ open, onClose }: SavedContentDialogProps) {
  const { saveUrl } = usePlatform();

  const handleClose = () => onClose();

  return (
    <BottomSheet open={open} onClose={handleClose} title="Save Content" maxWidth="sm:max-w-lg" headerDivider={false}>
      {saveUrl && <SaveUrlTab onClose={handleClose} />}
    </BottomSheet>
  );
}

// ── Save URL tab ──────────────────────────────────────────────────────────────

function SaveUrlTab({ onClose }: { onClose: () => void }) {
  const { saveUrl } = usePlatform();
  const setFilter = useAppStore((s) => s.setFilter);
  const [url, setUrl] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = url.trim();
    if (!trimmed || !saveUrl) return;

    setLoading(true);
    try {
      await saveUrl(trimmed);
      setUrl("");
      toast.success("Saved to library");
      setFilter({ savedOnly: true });
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save URL");
    } finally {
      setLoading(false);
    }
  };

  return (
    <form onSubmit={handleSubmit}>
      <div className="mb-4">
        <label htmlFor="save-url-input" className="mb-2 block text-sm text-[var(--theme-text-secondary)]">
          Article or page URL
        </label>
        <input
          id="save-url-input"
          type="url"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://example.com/article"
          className="w-full rounded-xl border border-[var(--theme-border-subtle)] bg-[var(--theme-bg-input)] px-4 py-3 text-[var(--theme-text-primary)] placeholder-[var(--theme-text-muted)] transition-colors focus:outline-none focus:border-[var(--theme-border-strong)]"
          disabled={loading}
          autoFocus
        />
      </div>
      <div className="flex justify-end">
        <button
          type="submit"
          className="btn-primary px-6 py-2.5 disabled:opacity-50 disabled:cursor-not-allowed"
          disabled={loading || !url.trim()}
        >
          {loading ? (
            <span className="flex items-center gap-2">
              <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              Saving...
            </span>
          ) : (
            "Save"
          )}
        </button>
      </div>
    </form>
  );
}
