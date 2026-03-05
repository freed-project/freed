/**
 * SavedSection — settings pane for saved content management + Markdown import/export.
 */

import { useCallback, useRef, useState } from "react";
import { useAppStore, usePlatform } from "../../context/PlatformContext.js";
import { toast } from "../Toast.js";
import type { ImportPhase, ImportProgress, ImportSummary } from "../LibraryDialog.types.js";

type SavedTab = "manage" | "import" | "export";

const PHASE_LABELS: Record<ImportPhase, string> = {
  scanning: "Scanning files",
  writing: "Writing to library",
  caching: "Caching content",
  fetching: "Queuing for fetch",
};

// ── Shared tab bar ────────────────────────────────────────────────────────────

function TabBar({
  tabs,
  active,
  onChange,
}: {
  tabs: { id: SavedTab; label: string }[];
  active: SavedTab;
  onChange: (id: SavedTab) => void;
}) {
  return (
    <div className="flex gap-0.5 bg-white/[0.04] rounded-xl p-1 mb-5">
      {tabs.map((tab) => (
        <button
          key={tab.id}
          onClick={() => onChange(tab.id)}
          className={`flex-1 py-1.5 px-3 text-sm font-medium rounded-lg transition-all whitespace-nowrap ${
            active === tab.id
              ? "bg-[#8b5cf6]/20 text-[#8b5cf6]"
              : "text-[#a1a1aa] hover:text-white"
          }`}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}

// ── Root section component ─────────────────────────────────────────────────────

export function SavedSection() {
  const { importMarkdown } = usePlatform();

  const availableTabs: { id: SavedTab; label: string }[] = [
    { id: "manage" as const, label: "Manage" },
    ...(importMarkdown ? [{ id: "import" as const, label: "Import" }] : []),
    // Export tab always shown; ExportPane renders a desktop-app CTA when exportMarkdown is unavailable.
    { id: "export" as const, label: "Export" },
  ];

  const [activeTab, setActiveTab] = useState<SavedTab>("manage");

  return (
    <div>
      {availableTabs.length > 1 && (
        <TabBar tabs={availableTabs} active={activeTab} onChange={setActiveTab} />
      )}
      {activeTab === "manage" && <ManagePane />}
      {activeTab === "import" && importMarkdown && <ImportPane />}
      {activeTab === "export" && <ExportPane />}
    </div>
  );
}

// ── Manage pane ───────────────────────────────────────────────────────────────

function ManagePane() {
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
        const urlDisplay = item.content.linkPreview?.url ?? item.author.handle;
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

// ── Import pane (Markdown) ────────────────────────────────────────────────────

type ImportState = "idle" | "importing" | "complete";

function ImportPane() {
  const { importMarkdown } = usePlatform();
  const folderInputRef = useRef<HTMLInputElement>(null);
  const filesInputRef = useRef<HTMLInputElement>(null);

  const [state, setState] = useState<ImportState>("idle");
  const [progress, setProgress] = useState<ImportProgress | null>(null);
  const [summary, setSummary] = useState<ImportSummary | null>(null);
  const [error, setError] = useState<string | null>(null);

  const runImport = useCallback(
    async (files: FileList) => {
      if (!importMarkdown || files.length === 0) return;
      setState("importing");
      setSummary(null);
      setError(null);

      try {
        const result = await importMarkdown(files, (p) => setProgress({ ...p }));
        setSummary(result);
        setState("complete");
        if (result.imported > 0) {
          toast.success(`Imported ${result.imported.toLocaleString()} item${result.imported !== 1 ? "s" : ""}`);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Import failed");
        setState("idle");
      } finally {
        setProgress(null);
        if (folderInputRef.current) folderInputRef.current.value = "";
        if (filesInputRef.current) filesInputRef.current.value = "";
      }
    },
    [importMarkdown],
  );

  const handleFolderChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) runImport(e.target.files);
  };
  const handleFilesChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) runImport(e.target.files);
  };

  const reset = () => {
    setState("idle");
    setSummary(null);
    setError(null);
    setProgress(null);
  };

  if (state === "idle") {
    return (
      <>
        <p className="text-sm text-[#71717a] mb-4">
          Import Freed Markdown archive files. Select a folder to import its entire
          structure, or pick individual{" "}
          <code className="text-[#8b5cf6] bg-white/5 px-1 rounded">.md</code> files.
          Subfolder names become searchable tags.
        </p>

        <div className="flex gap-3">
          <button
            onClick={() => folderInputRef.current?.click()}
            className="flex-1 flex flex-col items-center gap-2 py-4 rounded-xl border border-dashed border-[rgba(255,255,255,0.15)] text-[#a1a1aa] text-sm hover:border-[#8b5cf6]/50 hover:text-[#8b5cf6] hover:bg-[#8b5cf6]/5 transition-colors"
          >
            <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V7z" />
            </svg>
            Select Folder
          </button>

          <button
            onClick={() => filesInputRef.current?.click()}
            className="flex-1 flex flex-col items-center gap-2 py-4 rounded-xl border border-dashed border-[rgba(255,255,255,0.15)] text-[#a1a1aa] text-sm hover:border-[#8b5cf6]/50 hover:text-[#8b5cf6] hover:bg-[#8b5cf6]/5 transition-colors"
          >
            <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
            </svg>
            Select Files
          </button>
        </div>

        {/* @ts-expect-error webkitdirectory is valid but not in React's type defs */}
        <input ref={folderInputRef} type="file" webkitdirectory="" className="hidden" onChange={handleFolderChange} />
        <input ref={filesInputRef} type="file" accept=".md" multiple className="hidden" onChange={handleFilesChange} />

        {error && (
          <div className="mt-4 p-3 bg-red-500/20 border border-red-500/50 rounded-xl text-red-400 text-sm">
            {error}
          </div>
        )}
      </>
    );
  }

  if (state === "importing") {
    const pct = progress
      ? Math.round((progress.current / Math.max(1, progress.total)) * 100)
      : 0;
    return (
      <div className="py-2">
        <ProgressBar progress={progress} percent={pct} />
      </div>
    );
  }

  // complete
  return (
    <div className="flex flex-col gap-4 py-2">
      <div className="flex justify-center">
        <div className="w-12 h-12 rounded-full bg-green-500/20 flex items-center justify-center">
          <svg className="w-6 h-6 text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
          </svg>
        </div>
      </div>

      <div className="text-center">
        <p className="text-lg font-semibold text-white">Import complete</p>
        <div className="flex justify-center gap-6 mt-3">
          <div className="text-center">
            <p className="text-2xl font-bold text-green-400">{summary?.imported.toLocaleString()}</p>
            <p className="text-xs text-[#71717a]">imported</p>
          </div>
          {(summary?.skipped ?? 0) > 0 && (
            <div className="text-center">
              <p className="text-2xl font-bold text-[#a1a1aa]">{summary!.skipped.toLocaleString()}</p>
              <p className="text-xs text-[#71717a]">skipped</p>
            </div>
          )}
          {(summary?.errors.length ?? 0) > 0 && (
            <div className="text-center">
              <p className="text-2xl font-bold text-red-400">{summary!.errors.length.toLocaleString()}</p>
              <p className="text-xs text-[#71717a]">errors</p>
            </div>
          )}
        </div>
      </div>

      {(summary?.errors.length ?? 0) > 0 && (
        <details className="bg-red-500/10 border border-red-500/20 rounded-xl p-3">
          <summary className="text-xs text-red-400 font-medium cursor-pointer">
            Show {summary!.errors.length.toLocaleString()} error{summary!.errors.length !== 1 ? "s" : ""}
          </summary>
          <ul className="mt-2 space-y-0.5 max-h-32 overflow-y-auto">
            {summary!.errors.map((err, i) => (
              <li key={i} className="text-xs text-red-400 font-mono truncate">{err}</li>
            ))}
          </ul>
        </details>
      )}

      <div className="flex justify-center">
        <button onClick={reset} className="px-4 py-2.5 text-[#a1a1aa] hover:text-white transition-colors text-sm">
          Import more
        </button>
      </div>
    </div>
  );
}

// ── Export pane (Markdown zip) ────────────────────────────────────────────────

function ExportPane() {
  const { exportMarkdown } = usePlatform();
  const items = useAppStore((s) => s.items);
  const [exporting, setExporting] = useState(false);

  // Export is a desktop-only capability. Show a CTA on the PWA.
  if (!exportMarkdown) {
    return (
      <div className="flex flex-col items-center gap-4 py-6 text-center">
        <svg className="w-10 h-10 text-[#3f3f46]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
        </svg>
        <div>
          <p className="text-sm text-[#a1a1aa]">Export requires the desktop app</p>
          <p className="text-xs text-[#52525b] mt-1 leading-relaxed max-w-[240px] mx-auto">
            Download Freed Desktop to export your library as Markdown files.
          </p>
        </div>
        <a
          href="https://freed.wtf/get"
          target="_blank"
          rel="noopener noreferrer"
          className="text-xs px-4 py-2 rounded-lg bg-[#8b5cf6]/20 text-[#8b5cf6] hover:bg-[#8b5cf6]/30 transition-colors"
        >
          Download the desktop app
        </a>
      </div>
    );
  }

  const savedCount = items.filter((item) => item.platform === "saved").length;
  const totalCount = items.length;

  const handleExport = async () => {
    if (!exportMarkdown || exporting) return;
    setExporting(true);
    try {
      await exportMarkdown();
      toast.success("Library exported");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Export failed");
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="bg-white/[0.03] rounded-xl p-4">
        <p className="text-sm text-white">
          <span className="font-semibold">{totalCount.toLocaleString()}</span>{" "}
          item{totalCount !== 1 ? "s" : ""} total
          {savedCount < totalCount && (
            <span className="text-[#71717a]"> · {savedCount.toLocaleString()} saved</span>
          )}
        </p>
        <p className="text-xs text-[#71717a] mt-1">
          Exported as Freed Markdown with YAML frontmatter. Full article text included where cached.
        </p>
      </div>

      <button
        onClick={handleExport}
        disabled={exporting || totalCount === 0}
        className="w-full py-2.5 rounded-xl bg-[#8b5cf6]/20 text-[#8b5cf6] text-sm font-medium hover:bg-[#8b5cf6]/30 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
      >
        {exporting ? (
          <>
            <span className="w-4 h-4 border border-[#8b5cf6]/30 border-t-[#8b5cf6] rounded-full animate-spin" />
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
    </div>
  );
}

// ── Shared progress bar ───────────────────────────────────────────────────────

function ProgressBar({ progress, percent }: { progress: ImportProgress | null; percent: number }) {
  if (!progress) return null;

  const phaseLabel = PHASE_LABELS[progress.phase] ?? progress.phase;
  const fractionLabel =
    progress.phase === "writing"
      ? `batch ${progress.current} of ${progress.total}`
      : `${progress.current.toLocaleString()} / ${progress.total.toLocaleString()}`;

  return (
    <div className="mt-4 space-y-2">
      <div className="flex items-center justify-between text-xs text-[#71717a]">
        <span className="font-medium text-[#a1a1aa]">{phaseLabel}</span>
        <span>{fractionLabel}</span>
      </div>
      <div className="h-1.5 bg-white/5 rounded-full overflow-hidden">
        <div
          className="h-full bg-[#8b5cf6] rounded-full transition-all duration-200"
          style={{ width: `${percent}%` }}
        />
      </div>
      {(progress.imported > 0 || progress.skipped > 0) && (
        <div className="flex gap-4 text-xs text-[#71717a]">
          <span className="text-emerald-400">{progress.imported.toLocaleString()} new</span>
          {progress.skipped > 0 && <span>{progress.skipped.toLocaleString()} skipped</span>}
        </div>
      )}
    </div>
  );
}
