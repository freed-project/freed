/**
 * Saved Content dialog
 *
 * Quick-access dialog for saving a URL or managing existing saved items.
 * Import and export live in Settings > Saved Content.
 */

import { useEffect, useState } from "react";
import { BottomSheet } from "./BottomSheet.js";
import { toast } from "./Toast.js";
import { useAppStore, usePlatform } from "../context/PlatformContext.js";

interface SavedContentDialogProps {
  open: boolean;
  initialUrl?: string;
  onClose: () => void;
}

export function SavedContentDialog({
  open,
  initialUrl = "",
  onClose,
}: SavedContentDialogProps) {
  const { saveUrl } = usePlatform();

  const handleClose = () => onClose();

  return (
    <BottomSheet open={open} onClose={handleClose} title="Save Content" maxWidth="sm:max-w-lg" headerDivider={false}>
      {saveUrl && <SaveUrlTab initialUrl={initialUrl} open={open} onClose={handleClose} />}
    </BottomSheet>
  );
}

// ── Save URL tab ──────────────────────────────────────────────────────────────

function SaveUrlTab({
  initialUrl,
  open,
  onClose,
}: {
  initialUrl: string;
  open: boolean;
  onClose: () => void;
}) {
  const { saveUrl } = usePlatform();
  const setFilter = useAppStore((s) => s.setFilter);
  const setActiveView = useAppStore((s) => s.setActiveView);
  const setSelectedItem = useAppStore((s) => s.setSelectedItem);
  const setSelectedPerson = useAppStore((s) => s.setSelectedPerson);
  const setSelectedAccount = useAppStore((s) => s.setSelectedAccount);
  const [url, setUrl] = useState(initialUrl);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (open) {
      setUrl(initialUrl);
    }
  }, [initialUrl, open]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = url.trim();
    if (!trimmed || !saveUrl) return;

    setLoading(true);
    try {
      const saved = await saveUrl(trimmed);
      setUrl("");
      toast.success("Saved to library");
      setActiveView("feed");
      setFilter({ savedOnly: true });
      setSelectedPerson(null);
      setSelectedAccount(null);
      setSelectedItem(saved.globalId);
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
