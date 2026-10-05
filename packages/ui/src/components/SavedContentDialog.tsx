import { retainRenderedAnnotationSnapshot, type LibraryCoreHydratedAnnotations } from "@freed/shared/library-core";
/**
 * Saved Content dialog
 *
 * Quick-access dialog for saving a URL or managing existing saved items.
 * Import and export live in Settings > Saved Content.
 */

import { useEffect, useRef, useState } from "react";
import { getSavedItemNote, type FeedItem } from "@freed/shared";
import { BottomSheet } from "./BottomSheet.js";
import { toast } from "./Toast.js";
import {
  useAppStore,
  usePlatform,
  type SaveUrlPreview,
} from "../context/PlatformContext.js";

interface SavedContentDialogProps {
  open: boolean;
  initialUrl?: string;
  initialError?: string;
  editItem?: FeedItem | null;
  annotationSnapshot?: LibraryCoreHydratedAnnotations | null;
  onClose: () => void;
}

export function SavedContentDialog({
  open,
  initialUrl = "",
  initialError = "",
  editItem = null,
  annotationSnapshot = null,
  onClose,
}: SavedContentDialogProps) {
  const { saveUrl } = usePlatform();

  const handleClose = () => onClose();

  return (
    <BottomSheet open={open} onClose={handleClose} title={editItem ? "Edit Save" : "Save Content"} maxWidth="sm:max-w-lg" headerDivider={false}>
      {saveUrl && <SaveUrlTab initialUrl={initialUrl} initialError={initialError} editItem={editItem} annotationSnapshot={annotationSnapshot} open={open} onClose={handleClose} />}
    </BottomSheet>
  );
}

// ── Save URL tab ──────────────────────────────────────────────────────────────

function SaveUrlTab({
  initialUrl,
  initialError,
  editItem,
  annotationSnapshot,
  open,
  onClose,
}: {
  initialUrl: string;
  initialError: string;
  editItem: FeedItem | null;
  annotationSnapshot: LibraryCoreHydratedAnnotations | null;
  open: boolean;
  onClose: () => void;
}) {
  const { previewSaveUrl, saveUrl, updateSavedContent } = usePlatform();
  const setFilter = useAppStore((s) => s.setFilter);
  const setActiveView = useAppStore((s) => s.setActiveView);
  const activeFilter = useAppStore((s) => s.activeFilter);
  const activeView = useAppStore((s) => s.activeView);
  const setSelectedItem = useAppStore((s) => s.setSelectedItem);
  const setSelectedPerson = useAppStore((s) => s.setSelectedPerson);
  const setSelectedAccount = useAppStore((s) => s.setSelectedAccount);
  const [url, setUrl] = useState(initialUrl);
  const [notes, setNotes] = useState("");
  const [error, setError] = useState(initialError);
  const [preview, setPreview] = useState<SaveUrlPreview | null>(null);
  const [isPreviewing, setIsPreviewing] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const notesEditedRef = useRef(false);

  useEffect(() => {
    if (open) {
      const existingNote = getSavedItemNote(annotationSnapshot?.highlights ? [...annotationSnapshot.highlights] : editItem?.userState.highlights);
      setUrl(initialUrl);
      setNotes(existingNote);
      setError(initialError);
      setPreview(null);
      setIsPreviewing(false);
      setIsSubmitting(false);
      notesEditedRef.current = existingNote.length > 0;
    }
  }, [editItem, annotationSnapshot, initialError, initialUrl, open]);

  useEffect(() => {
    setPreview(null);
    setIsPreviewing(false);
    if (!open || !previewSaveUrl) return;
    let stableUrl: string;
    try {
      const parsed = new URL(url.trim());
      if (!["http:", "https:"].includes(parsed.protocol)) return;
      stableUrl = parsed.toString();
    } catch {
      return;
    }

    // Match the platform update predicate exactly, including its URL fallback.
    const currentUrl = editItem?.sourceUrl ?? editItem?.content.linkPreview?.url ?? "";
    if (editItem && stableUrl === currentUrl) return;

    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      setIsPreviewing(true);
      setPreview(null);
      void previewSaveUrl(stableUrl, controller.signal)
        .then((preview) => {
          if (controller.signal.aborted) return;
          setPreview(preview);
          if (!notesEditedRef.current && preview.suggestedNote) {
            setNotes(preview.suggestedNote);
          }
        })
        .catch(() => undefined)
        .finally(() => {
          if (!controller.signal.aborted) setIsPreviewing(false);
        });
    }, 350);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [open, previewSaveUrl, url, editItem]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    let originalAnnotations: LibraryCoreHydratedAnnotations | undefined;
    if (editItem) {
      try { originalAnnotations = retainRenderedAnnotationSnapshot(annotationSnapshot, editItem.globalId); }
      catch (error) { setError(error instanceof Error ? error.message : "Annotations are unavailable for editing"); return; }
    }
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
    const noteBytes = new TextEncoder().encode(notes).byteLength;
    if (noteBytes > 8_192) {
      setError(`Notes must be ${Number(8_192).toLocaleString()} bytes or fewer`);
      return;
    }
    setError("");
    setIsSubmitting(true);
    const previousFilter = activeFilter;
    const previousView = activeView;
    setActiveView("feed");
    setFilter({ savedOnly: true });
    setSelectedPerson(null);
    setSelectedAccount(null);
    try {
      const saved = editItem && updateSavedContent
        ? await updateSavedContent(editItem, {
            annotationSnapshot: originalAnnotations,
            url: stableUrl,
            notes,
            ...(preview?.url === stableUrl ? { preview } : {}),
          })
        : await saveUrl(stableUrl, {
            notes,
            ...(preview?.url === stableUrl ? { preview } : {}),
          });
      toast.success(editItem ? "Save updated" : "Saved to library");
      setSelectedItem(saved.globalId);
      onClose();
    } catch (err) {
      setActiveView(previousView);
      setFilter(previousFilter);
      const message = err instanceof Error ? err.message : "Failed to save URL";
      setError(message);
      toast.error(message);
    } finally {
      setIsSubmitting(false);
    }
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
        {isPreviewing && (
          <div role="status" aria-label="Reading URL details" className="mt-2 flex items-center gap-2 text-sm text-[var(--theme-text-muted)]">
            <span aria-hidden="true" className="h-4 w-4 animate-spin rounded-full border border-[var(--theme-border-strong)] border-t-[var(--theme-accent-secondary)]" />
            Reading URL details
          </div>
        )}
        {error && (
          <p className="mt-2 rounded-lg border border-amber-500/25 bg-amber-500/10 px-3 py-2 text-sm text-amber-200">
            {error}
          </p>
        )}
      </div>
      <div className="mb-4">
        <label htmlFor="save-notes-input" className="mb-2 block text-sm text-[var(--theme-text-secondary)]">
          Notes
        </label>
        <textarea
          id="save-notes-input"
          value={notes}
          onChange={(event) => {
            notesEditedRef.current = true;
            setNotes(event.target.value);
            if (error) setError("");
          }}
          placeholder="Notes will be auto-populated from the URL when available."
          rows={4}
          className="w-full resize-y rounded-xl border border-[var(--theme-border-subtle)] bg-[var(--theme-bg-input)] px-4 py-3 text-[var(--theme-text-primary)] placeholder-[var(--theme-text-muted)] transition-colors focus:border-[var(--theme-border-strong)] focus:outline-none"
        />
      </div>
      <div className="flex justify-end">
        <button
          type="submit"
          className="btn-primary px-6 py-2.5 disabled:opacity-50 disabled:cursor-not-allowed"
          disabled={!url.trim() || isSubmitting}
        >
          {isSubmitting ? "Saving..." : editItem ? "Update save" : "Save"}
        </button>
      </div>
    </form>
  );
}
