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
  initialError?: string;
  onClose: () => void;
}

export function SavedContentDialog({
  open,
  initialUrl = "",
  initialError = "",
  onClose,
}: SavedContentDialogProps) {
  const { saveUrl } = usePlatform();

  const handleClose = () => onClose();

  return (
    <BottomSheet open={open} onClose={handleClose} title="Save Content" maxWidth="sm:max-w-lg" headerDivider={false}>
      {saveUrl && <SaveUrlTab initialUrl={initialUrl} initialError={initialError} open={open} onClose={handleClose} />}
    </BottomSheet>
  );
}

// ── Save URL tab ──────────────────────────────────────────────────────────────

function SaveUrlTab({
  initialUrl,
  initialError,
  open,
  onClose,
}: {
  initialUrl: string;
  initialError: string;
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
  const [error, setError] = useState(initialError);

  useEffect(() => {
    if (open) {
      setUrl(initialUrl);
      setError(initialError);
    }
  }, [initialError, initialUrl, open]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = url.trim();
    if (!trimmed || !saveUrl) return;

    let parsed: URL;
    try {
      parsed = new URL(trimmed);
    } catch {
      setError("Invalid URL");
      return;
    }

    if (!["http:", "https:"].includes(parsed.protocol)) {
      setError("Only http and https URLs are supported");
      return;
    }

    const stableUrl = parsed.toString();
    setError("");
    setUrl("");
    toast.success("Saved to library");
    onClose();

    void saveUrl(stableUrl)
      .then((saved) => {
        setActiveView("feed");
        setFilter({ savedOnly: true });
        setSelectedPerson(null);
        setSelectedAccount(null);
        setSelectedItem(saved.globalId);
      })
      .catch((err) => {
        const message = err instanceof Error ? err.message : "Failed to save URL";
        toast.error(message);
        window.dispatchEvent(
          new CustomEvent("freed:save-content-details-error", {
            detail: {
              initialUrl: stableUrl,
              errorMessage: message,
            },
          }),
        );
      });
  };

  return (
    <form onSubmit={handleSubmit} noValidate>
      <div className="mb-4">
        <label htmlFor="save-url-input" className="mb-2 block text-sm text-[var(--theme-text-secondary)]">
          Article or page URL
        </label>
        <input
          id="save-url-input"
          type="url"
          value={url}
          onChange={(e) => {
            setUrl(e.target.value);
            if (error) setError("");
          }}
          placeholder="https://example.com/article"
          className="w-full rounded-xl border border-[var(--theme-border-subtle)] bg-[var(--theme-bg-input)] px-4 py-3 text-[var(--theme-text-primary)] placeholder-[var(--theme-text-muted)] transition-colors focus:outline-none focus:border-[var(--theme-border-strong)]"
          autoFocus
        />
        {error && (
          <p className="mt-2 rounded-lg border border-amber-500/25 bg-amber-500/10 px-3 py-2 text-sm text-amber-200">
            {error}
          </p>
        )}
      </div>
      <div className="flex justify-end">
        <button
          type="submit"
          className="btn-primary px-6 py-2.5 disabled:opacity-50 disabled:cursor-not-allowed"
          disabled={!url.trim()}
        >
          Save
        </button>
      </div>
    </form>
  );
}
