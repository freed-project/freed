/**
 * Library Import/Export dialog
 *
 * Import tab: folder picker (accepts .md files), progress bar, summary.
 * Export tab: single button that triggers zip download.
 *
 * Receives importMarkdown and exportMarkdown via PlatformConfig so it can
 * be rendered by both desktop and (future) platforms.
 */

import { useEffect, useState, useRef } from "react";
import type { ImportSummary, ProgressFn } from "./LibraryDialog.types.js";

export type { ImportSummary, ProgressFn };

interface LibraryDialogProps {
  onClose: () => void;
  initialTab?: Tab;
  /**
   * Platform-provided import handler.
   * When undefined the Import tab shows a "not available" message.
   */
  importMarkdown?: (files: FileList, onProgress: ProgressFn) => Promise<ImportSummary>;
  /**
   * Platform-provided export handler.
   * When undefined the Export tab shows a "not available" message.
   */
  exportMarkdown?: () => Promise<void>;
}

type Tab = "import" | "export";

export function LibraryDialog({
  onClose,
  initialTab = "import",
  importMarkdown,
  exportMarkdown,
}: LibraryDialogProps) {
  const [tab, setTab] = useState<Tab>(initialTab);
  const [importing, setImporting] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [summary, setSummary] = useState<ImportSummary | null>(null);
  const [progress, setProgress] = useState<{ current: number; total: number } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setTab(initialTab);
    setSummary(null);
    setProgress(null);
  }, [initialTab]);

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0 || !importMarkdown) return;

    setImporting(true);
    setSummary(null);
    setProgress({ current: 0, total: files.length });

    try {
      const result = await importMarkdown(files, (p) => {
        setProgress({ current: p.current, total: p.total });
      });
      setSummary(result);
    } finally {
      setImporting(false);
      setProgress(null);
      // Reset input so the same folder can be re-selected
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const handleExport = async () => {
    if (!exportMarkdown || exporting) return;
    setExporting(true);
    try {
      await exportMarkdown();
    } finally {
      setExporting(false);
    }
  };

  const percent = progress
    ? Math.round((progress.current / Math.max(1, progress.total)) * 100)
    : 0;

  return (
    <div
      className="fixed inset-0 z-[200] flex items-start justify-center overflow-y-auto p-4 sm:items-center"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      {/* Backdrop */}
      <div className="theme-elevated-overlay absolute inset-0" />

      {/* Dialog */}
      <div className="relative z-10 my-auto flex max-h-[calc(100dvh-2rem)] w-full max-w-md flex-col overflow-hidden rounded-2xl border border-[var(--theme-border-subtle)] bg-[var(--theme-bg-elevated)] shadow-2xl shadow-black/40">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-[var(--theme-border-subtle)] px-5 py-4">
          <h2 className="text-base font-semibold text-[var(--theme-text-primary)]">Library</h2>
          <button
            onClick={onClose}
            className="rounded-lg p-1.5 text-[var(--theme-text-muted)] transition-colors hover:bg-[var(--theme-bg-muted)] hover:text-[var(--theme-text-secondary)]"
            aria-label="Close"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Tabs */}
        <div className="flex px-5 pt-4 gap-1">
          {(["import", "export"] as Tab[]).map((t) => (
            <button
              key={t}
              onClick={() => { setTab(t); setSummary(null); }}
              className={`px-4 py-1.5 text-sm font-medium rounded-lg transition-colors capitalize ${
                tab === t
                  ? "theme-accent-button"
                  : "text-[var(--theme-text-muted)] hover:bg-[var(--theme-bg-muted)] hover:text-[var(--theme-text-secondary)]"
              }`}
            >
              {t}
            </button>
          ))}
        </div>

        {/* Tab content */}
        <div className="overflow-y-auto px-5 py-5">
          {tab === "import" ? (
            <div>
              <p className="mb-4 text-sm text-[var(--theme-text-muted)]">
                Import a Freed Markdown archive. Select a folder of <code className="rounded bg-[var(--theme-bg-muted)] px-1 text-[var(--theme-accent-secondary)]">.md</code> files exported from Freed or another read-later app.
              </p>

              {importMarkdown ? (
                <>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".md"
                    multiple
                    className="hidden"
                    onChange={handleFileChange}
                  />
                  <button
                    onClick={() => fileInputRef.current?.click()}
                    disabled={importing}
                    className="w-full rounded-xl border border-dashed border-[var(--theme-border-quiet)] py-2.5 text-sm text-[var(--theme-text-secondary)] transition-colors hover:border-[var(--theme-border-strong)] hover:bg-[rgb(var(--theme-accent-secondary-rgb)/0.06)] hover:text-[var(--theme-accent-secondary)] disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {importing ? "Importing..." : "Select Markdown files"}
                  </button>

                  {/* Progress bar */}
                  {importing && progress && (
                    <div className="mt-4">
                      <div className="mb-1.5 flex justify-between text-xs text-[var(--theme-text-muted)]">
                        <span>{progress.current} / {progress.total} files</span>
                        <span>{percent}%</span>
                      </div>
                      <div className="h-1.5 overflow-hidden rounded-full bg-[var(--theme-bg-muted)]">
                        <div
                          className="h-full rounded-full bg-[var(--theme-accent-secondary)] transition-all duration-300"
                          style={{ width: `${percent}%` }}
                        />
                      </div>
                    </div>
                  )}

                  {/* Summary */}
                  {summary && !importing && (
                    <div className="mt-4 rounded-xl border border-[var(--theme-border-subtle)] bg-[var(--theme-bg-card)] p-3">
                      <p className="mb-2 text-sm font-medium text-[var(--theme-text-primary)]">Import complete</p>
                      <div className="flex gap-4 text-sm">
                        <span className="text-emerald-400">
                          {summary.imported} imported
                        </span>
                        {summary.skipped > 0 && (
                          <span className="text-[var(--theme-text-muted)]">
                            {summary.skipped} skipped
                          </span>
                        )}
                        {summary.errors.length > 0 && (
                          <span className="text-red-400">
                            {summary.errors.length} errors
                          </span>
                        )}
                      </div>
                      {summary.errors.length > 0 && (
                        <details className="mt-2">
                          <summary className="cursor-pointer text-xs text-[var(--theme-text-muted)]">
                            Show errors
                          </summary>
                          <ul className="mt-1 space-y-0.5 max-h-32 overflow-y-auto">
                            {summary.errors.map((err, i) => (
                              <li key={i} className="text-xs text-red-400 font-mono">
                                {err}
                              </li>
                            ))}
                          </ul>
                        </details>
                      )}
                    </div>
                  )}
                </>
              ) : (
                <div className="py-4 text-center text-sm text-[var(--theme-text-soft)]">
                  Import is only available in the desktop app.
                </div>
              )}
            </div>
          ) : (
            <div>
              <p className="mb-4 text-sm text-[var(--theme-text-muted)]">
                Download your entire library as a zip archive of Freed Markdown files. Includes full article text where available.
              </p>

              {exportMarkdown ? (
                <button
                  onClick={handleExport}
                  disabled={exporting}
                  className="theme-accent-button flex w-full items-center justify-center gap-2 rounded-xl py-2.5 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {exporting ? (
                    <>
                      <div className="h-4 w-4 animate-spin rounded-full border border-[rgb(var(--theme-accent-secondary-rgb)/0.3)] border-t-[var(--theme-accent-secondary)]" />
                      Preparing export...
                    </>
                  ) : (
                    <>
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                      </svg>
                      Download library as zip
                    </>
                  )}
                </button>
              ) : (
                <div className="py-4 text-center text-sm text-[var(--theme-text-soft)]">
                  Export is only available in the desktop app.
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
