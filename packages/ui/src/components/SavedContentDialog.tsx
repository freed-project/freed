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
    <BottomSheet open={open} onClose={handleClose} title="Save content" maxWidth="sm:max-w-lg">
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
        <label htmlFor="save-url-input" className="block text-sm text-[#a1a1aa] mb-2">
          Article or page URL
        </label>
        <input
          id="save-url-input"
          type="url"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://example.com/article"
          className="w-full px-4 py-3 bg-white/5 border border-[rgba(255,255,255,0.08)] rounded-xl focus:outline-none focus:border-[#8b5cf6] text-white placeholder-[#71717a] transition-colors"
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

// ── Manage tab ────────────────────────────────────────────────────────────────

function ManageTab() {
  const items = useAppStore((s) => s.items);
  const removeItem = useAppStore((s) => s.removeItem);
  const [removing, setRemoving] = useState<string | null>(null);

  const savedItems = items.filter((item) => item.platform === "saved");

  if (savedItems.length === 0) {
    return (
      <div className="text-center py-8">
        <p className="text-sm text-[#71717a]">No saved items yet.</p>
        <p className="text-xs text-[#52525b] mt-1">Save a URL to get started.</p>
      </div>
    );
  }

  const handleRemove = async (globalId: string) => {
    setRemoving(globalId);
    try {
      await removeItem(globalId);
    } finally {
      setRemoving(null);
    }
  };

  return (
    <div className="space-y-2 max-h-80 overflow-y-auto -mx-1 px-1">
      {savedItems.map((item) => {
        const title =
          item.content.linkPreview?.title ??
          item.content.text?.slice(0, 60) ??
          item.globalId;
        const urlDisplay =
          item.content.linkPreview?.url ?? item.author.handle;
        return (
          <div
            key={item.globalId}
            className="flex items-center gap-3 px-3 py-2.5 rounded-xl bg-white/[0.03] border border-[rgba(255,255,255,0.05)]"
          >
            <div className="flex-1 min-w-0">
              <p className="text-sm text-white truncate">{title}</p>
              <p className="text-xs text-[#52525b] truncate">{urlDisplay}</p>
            </div>
            <button
              onClick={() => handleRemove(item.globalId)}
              disabled={removing === item.globalId}
              className="flex-shrink-0 p-1.5 rounded-lg hover:bg-red-500/20 text-[#71717a] hover:text-red-400 transition-colors disabled:opacity-50"
              aria-label={`Remove ${title}`}
            >
              {removing === item.globalId ? (
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
        );
      })}
    </div>
  );
}
