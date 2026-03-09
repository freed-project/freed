/**
 * Library Import/Export dialog
 *
 * Import tab: folder picker (accepts .md files), progress bar, summary.
 * Export tab: single button that triggers zip download.
 *
 * Receives importMarkdown and exportMarkdown via PlatformConfig so it can
 * be rendered by both desktop and (future) platforms.
 */

import { useState, useRef } from "react";
import type { ImportSummary, ProgressFn } from "./LibraryDialog.types.js";

export type { ImportSummary, ProgressFn };

interface LibraryDialogProps {
  onClose: () => void;
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
  importMarkdown,
  exportMarkdown,
}: LibraryDialogProps) {
  const [tab, setTab] = useState<Tab>("import");
  const [importing, setImporting] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [summary, setSummary] = useState<ImportSummary | null>(null);
  const [progress, setProgress] = useState<{ current: number; total: number } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

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
      className="fixed inset-0 z-[200] flex items-center justify-center"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/60" />

      {/* Dialog */}
      <div className="relative z-10 w-full max-w-md mx-4 bg-[#161616] border border-[rgba(255,255,255,0.1)] rounded-2xl shadow-2xl shadow-black/80 overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-[rgba(255,255,255,0.08)]">
          <h2 className="text-base font-semibold text-[#fafafa]">Library</h2>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-white/10 transition-colors text-[#71717a] hover:text-[#a1a1aa]"
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
                  ? "bg-[#8b5cf6]/20 text-[#8b5cf6]"
                  : "text-[#71717a] hover:text-[#a1a1aa] hover:bg-white/5"
              }`}
            >
              {t}
            </button>
          ))}
        </div>

        {/* Tab content */}
        <div className="px-5 py-5">
          {tab === "import" ? (
            <div>
              <p className="text-sm text-[#71717a] mb-4">
                Import a Freed Markdown archive. Select a folder of <code className="text-[#8b5cf6] bg-white/5 px-1 rounded">.md</code> files exported from Freed or another read-later app.
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
                    className="w-full py-2.5 rounded-xl border border-dashed border-[rgba(255,255,255,0.15)] text-[#a1a1aa] text-sm hover:border-[#8b5cf6]/50 hover:text-[#8b5cf6] hover:bg-[#8b5cf6]/5 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {importing ? "Importing..." : "Select Markdown files"}
                  </button>

                  {/* Progress bar */}
                  {importing && progress && (
                    <div className="mt-4">
                      <div className="flex justify-between text-xs text-[#71717a] mb-1.5">
                        <span>{progress.current} / {progress.total} files</span>
                        <span>{percent}%</span>
                      </div>
                      <div className="h-1.5 bg-white/5 rounded-full overflow-hidden">
                        <div
                          className="h-full bg-[#8b5cf6] rounded-full transition-all duration-300"
                          style={{ width: `${percent}%` }}
                        />
                      </div>
                    </div>
                  )}

                  {/* Summary */}
                  {summary && !importing && (
                    <div className="mt-4 p-3 rounded-xl bg-white/5 border border-[rgba(255,255,255,0.08)]">
                      <p className="text-sm font-medium text-[#fafafa] mb-2">Import complete</p>
                      <div className="flex gap-4 text-sm">
                        <span className="text-emerald-400">
                          {summary.imported} imported
                        </span>
                        {summary.skipped > 0 && (
                          <span className="text-[#71717a]">
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
                          <summary className="text-xs text-[#71717a] cursor-pointer">
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
                <div className="py-4 text-center text-sm text-[#52525b]">
                  Import is only available in the desktop app.
                </div>
              )}
            </div>
          ) : (
            <div>
              <p className="text-sm text-[#71717a] mb-4">
                Download your entire library as a zip archive of Freed Markdown files. Includes full article text where available.
              </p>

              {exportMarkdown ? (
                <button
                  onClick={handleExport}
                  disabled={exporting}
                  className="w-full py-2.5 rounded-xl bg-[#8b5cf6]/20 text-[#8b5cf6] text-sm font-medium hover:bg-[#8b5cf6]/30 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                >
                  {exporting ? (
                    <>
                      <div className="w-4 h-4 border border-[#8b5cf6]/30 border-t-[#8b5cf6] rounded-full animate-spin" />
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
                <div className="py-4 text-center text-sm text-[#52525b]">
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
