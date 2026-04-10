/**
 * SavedSection - settings pane for saved content overview + Markdown import/export.
 */

import { useCallback, useMemo, useRef, useState } from "react";
import { useAppStore, usePlatform } from "../../context/PlatformContext.js";
import { toast } from "../Toast.js";
import type { ImportPhase, ImportProgress, ImportSummary } from "../LibraryDialog.types.js";
import {
  DurationSelect,
  VolumeBars,
  formatHealthRelative,
  type HealthChartRange,
} from "../ProviderHealthSummary.js";
import type { FeedItem } from "@freed/shared";

type SavedTab = "overview" | "import" | "export";

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
    <div className="mb-5 flex gap-0.5 rounded-xl bg-[var(--theme-bg-muted)] p-1">
      {tabs.map((tab) => (
        <button
          key={tab.id}
          onClick={() => onChange(tab.id)}
          className={`flex-1 py-1.5 px-3 text-sm font-medium rounded-lg transition-all whitespace-nowrap ${
            active === tab.id
              ? "theme-accent-button"
              : "text-[var(--theme-text-secondary)] hover:text-[var(--theme-text-primary)]"
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
    { id: "overview" as const, label: "Overview" },
    ...(importMarkdown ? [{ id: "import" as const, label: "Import" }] : []),
    // Export tab always shown; ExportPane renders a desktop-app CTA when exportMarkdown is unavailable.
    { id: "export" as const, label: "Export" },
  ];

  const [activeTab, setActiveTab] = useState<SavedTab>("overview");

  return (
    <div>
      {availableTabs.length > 1 && (
        <TabBar tabs={availableTabs} active={activeTab} onChange={setActiveTab} />
      )}
      {activeTab === "overview" && <OverviewPane />}
      {activeTab === "import" && importMarkdown && <ImportPane />}
      {activeTab === "export" && <ExportPane />}
    </div>
  );
}

function getSavedTimestamp(item: FeedItem): number {
  return item.userState.savedAt ?? item.capturedAt;
}

function getSavedSourceLabel(item: FeedItem): string {
  const source = item.content.linkPreview?.url ?? item.sourceUrl ?? item.author.handle;
  if (!source) return "Unknown";
  try {
    return new URL(source).hostname.replace(/^www\./, "");
  } catch {
    return source;
  }
}

function buildDailyBuckets(savedItems: FeedItem[]) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  return Array.from({ length: 7 }, (_, index) => {
    const bucketStart = new Date(today);
    bucketStart.setDate(today.getDate() - (6 - index));
    const bucketEnd = new Date(bucketStart);
    bucketEnd.setDate(bucketStart.getDate() + 1);

    const count = savedItems.reduce((sum, item) => {
      const savedAt = getSavedTimestamp(item);
      return savedAt >= bucketStart.getTime() && savedAt < bucketEnd.getTime() ? sum + 1 : sum;
    }, 0);

    return {
      dateKey: bucketStart.toISOString().slice(0, 10),
      attempts: count,
      successes: count,
      failures: 0,
      itemsSeen: count,
      itemsAdded: count,
      bytesMoved: 0,
    };
  });
}

function buildHourlyBuckets(savedItems: FeedItem[]) {
  const now = new Date();
  now.setMinutes(0, 0, 0);

  return Array.from({ length: 24 }, (_, index) => {
    const bucketStart = new Date(now);
    bucketStart.setHours(now.getHours() - (23 - index));
    const bucketEnd = new Date(bucketStart);
    bucketEnd.setHours(bucketStart.getHours() + 1);

    const count = savedItems.reduce((sum, item) => {
      const savedAt = getSavedTimestamp(item);
      return savedAt >= bucketStart.getTime() && savedAt < bucketEnd.getTime() ? sum + 1 : sum;
    }, 0);

    return {
      hourKey: bucketStart.toISOString().slice(0, 13),
      attempts: count,
      successes: count,
      failures: 0,
      itemsSeen: count,
      itemsAdded: count,
      bytesMoved: 0,
    };
  });
}

// ── Overview pane ─────────────────────────────────────────────────────────────

function OverviewPane() {
  const items = useAppStore((s) => s.items);
  const [selectedRange, setSelectedRange] = useState<HealthChartRange>("daily");

  const savedItems = useMemo(
    () =>
      items
        .filter((item) => item.platform === "saved")
        .sort((a, b) => getSavedTimestamp(b) - getSavedTimestamp(a)),
    [items],
  );

  if (savedItems.length === 0) {
    return (
      <div className="text-center py-8">
        <p className="text-sm text-[var(--theme-text-muted)]">No saved items yet.</p>
        <p className="mt-1 text-xs text-[var(--theme-text-soft)]">Save a URL to get started.</p>
      </div>
    );
  }

  const dailyBuckets = useMemo(() => buildDailyBuckets(savedItems), [savedItems]);
  const hourlyBuckets = useMemo(() => buildHourlyBuckets(savedItems), [savedItems]);
  const activeBuckets = selectedRange === "hourly" ? hourlyBuckets : dailyBuckets;
  const rangeLabel = selectedRange === "hourly" ? "24h" : "7d";
  const savedInRange = activeBuckets.reduce((sum, bucket) => sum + bucket.itemsSeen, 0);
  const latestSavedAt = getSavedTimestamp(savedItems[0]);

  const topSources = useMemo(() => {
    const sourceCounts = new Map<string, number>();
    for (const item of savedItems) {
      const source = getSavedSourceLabel(item);
      sourceCounts.set(source, (sourceCounts.get(source) ?? 0) + 1);
    }
    return [...sourceCounts.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, 5);
  }, [savedItems]);

  const contentMix = useMemo(() => {
    const typeCounts = new Map<string, number>();
    for (const item of savedItems) {
      typeCounts.set(item.contentType, (typeCounts.get(item.contentType) ?? 0) + 1);
    }
    return [...typeCounts.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  }, [savedItems]);

  const sourceCount = topSources.length;
  const maxSourceCount = Math.max(...topSources.map(([, count]) => count), 1);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-sm text-[var(--theme-text-primary)]">Saved overview</p>
          <p className="mt-1 text-xs text-[var(--theme-text-muted)]">
            Track how much you have saved recently, plus where it is coming from.
          </p>
        </div>
        <DurationSelect
          value={selectedRange}
          onChange={setSelectedRange}
          ariaLabel="Saved content duration"
        />
      </div>

      <VolumeBars
        buckets={activeBuckets}
        metric="itemsSeen"
        title={selectedRange === "hourly" ? "Saved Per Hour" : "Saved Per Day"}
      />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <div className="rounded-xl border border-[var(--theme-border-subtle)] bg-[var(--theme-bg-card)] p-4">
          <p className="text-xs uppercase tracking-widest text-[var(--theme-text-soft)]">Total Saved</p>
          <p className="mt-2 text-2xl font-semibold text-[var(--theme-text-primary)]">
            {savedItems.length.toLocaleString()}
          </p>
        </div>
        <div className="rounded-xl border border-[var(--theme-border-subtle)] bg-[var(--theme-bg-card)] p-4">
          <p className="text-xs uppercase tracking-widest text-[var(--theme-text-soft)]">Saved ({rangeLabel})</p>
          <p className="mt-2 text-2xl font-semibold text-[var(--theme-text-primary)]">
            {savedInRange.toLocaleString()}
          </p>
        </div>
        <div className="rounded-xl border border-[var(--theme-border-subtle)] bg-[var(--theme-bg-card)] p-4">
          <p className="text-xs uppercase tracking-widest text-[var(--theme-text-soft)]">Latest Save</p>
          <p className="mt-2 text-sm font-medium text-[var(--theme-text-primary)]">
            {formatHealthRelative(latestSavedAt)}
          </p>
        </div>
        <div className="rounded-xl border border-[var(--theme-border-subtle)] bg-[var(--theme-bg-card)] p-4">
          <p className="text-xs uppercase tracking-widest text-[var(--theme-text-soft)]">Top Sources</p>
          <p className="mt-2 text-2xl font-semibold text-[var(--theme-text-primary)]">
            {sourceCount.toLocaleString()}
          </p>
        </div>
      </div>

      <div className="grid gap-3 xl:grid-cols-[1.4fr_1fr]">
        <div className="rounded-xl border border-[var(--theme-border-subtle)] bg-[var(--theme-bg-card)] p-4">
          <p className="text-xs uppercase tracking-widest text-[var(--theme-text-soft)]">Top Sources</p>
          <div className="mt-4 space-y-3">
            {topSources.map(([source, count]) => (
              <div key={source} className="space-y-1.5">
                <div className="flex items-center justify-between gap-3 text-sm">
                  <span className="truncate text-[var(--theme-text-primary)]">{source}</span>
                  <span className="shrink-0 text-[var(--theme-text-secondary)]">{count.toLocaleString()}</span>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-[var(--theme-bg-muted)]">
                  <div
                    className="h-full rounded-full bg-[var(--theme-accent-secondary)]"
                    style={{ width: `${Math.max(10, Math.round((count / maxSourceCount) * 100))}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-xl border border-[var(--theme-border-subtle)] bg-[var(--theme-bg-card)] p-4">
          <p className="text-xs uppercase tracking-widest text-[var(--theme-text-soft)]">Content Mix</p>
          <div className="mt-4 space-y-3">
            {contentMix.map(([contentType, count]) => (
              <div key={contentType} className="flex items-center justify-between gap-3 text-sm">
                <span className="capitalize text-[var(--theme-text-primary)]">{contentType}</span>
                <span className="text-[var(--theme-text-secondary)]">{count.toLocaleString()}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
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
        <p className="mb-4 text-sm text-[var(--theme-text-muted)]">
          Import Freed Markdown archive files. Select a folder to import its entire
          structure, or pick individual{" "}
          <code className="rounded bg-[var(--theme-bg-muted)] px-1 text-[var(--theme-accent-secondary)]">.md</code> files.
          Subfolder names become searchable tags.
        </p>

        <div className="flex gap-3">
          <button
            onClick={() => folderInputRef.current?.click()}
            className="flex flex-1 flex-col items-center gap-2 rounded-xl border border-dashed border-[var(--theme-border-quiet)] py-4 text-sm text-[var(--theme-text-secondary)] transition-colors hover:border-[var(--theme-border-strong)] hover:bg-[rgb(var(--theme-accent-secondary-rgb)/0.06)] hover:text-[var(--theme-accent-secondary)]"
          >
            <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V7z" />
            </svg>
            Select Folder
          </button>

          <button
            onClick={() => filesInputRef.current?.click()}
            className="flex flex-1 flex-col items-center gap-2 rounded-xl border border-dashed border-[var(--theme-border-quiet)] py-4 text-sm text-[var(--theme-text-secondary)] transition-colors hover:border-[var(--theme-border-strong)] hover:bg-[rgb(var(--theme-accent-secondary-rgb)/0.06)] hover:text-[var(--theme-accent-secondary)]"
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
        <p className="text-lg font-semibold text-[var(--theme-text-primary)]">Import complete</p>
        <div className="flex justify-center gap-6 mt-3">
          <div className="text-center">
            <p className="text-2xl font-bold text-green-400">{summary?.imported.toLocaleString()}</p>
              <p className="text-xs text-[var(--theme-text-muted)]">imported</p>
          </div>
          {(summary?.skipped ?? 0) > 0 && (
            <div className="text-center">
              <p className="text-2xl font-bold text-[var(--theme-text-secondary)]">{summary!.skipped.toLocaleString()}</p>
              <p className="text-xs text-[var(--theme-text-muted)]">skipped</p>
            </div>
          )}
          {(summary?.errors.length ?? 0) > 0 && (
            <div className="text-center">
              <p className="text-2xl font-bold text-red-400">{summary!.errors.length.toLocaleString()}</p>
              <p className="text-xs text-[var(--theme-text-muted)]">errors</p>
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
        <button onClick={reset} className="px-4 py-2.5 text-sm text-[var(--theme-text-secondary)] transition-colors hover:text-[var(--theme-text-primary)]">
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
          <p className="text-sm text-[var(--theme-text-secondary)]">Export requires Freed Desktop</p>
          <p className="mx-auto mt-1 max-w-[240px] text-xs leading-relaxed text-[var(--theme-text-soft)]">
            Download Freed Desktop to export your library as Markdown files.
          </p>
        </div>
        <a
          href="https://freed.wtf/get"
          target="_blank"
          rel="noopener noreferrer"
          className="theme-accent-button rounded-lg px-4 py-2 text-xs transition-colors"
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
      <div className="rounded-xl bg-[var(--theme-bg-card)] p-4">
        <p className="text-sm text-[var(--theme-text-primary)]">
          <span className="font-semibold">{totalCount.toLocaleString()}</span>{" "}
          item{totalCount !== 1 ? "s" : ""} total
          {savedCount < totalCount && (
            <span className="text-[var(--theme-text-muted)]"> · {savedCount.toLocaleString()} saved</span>
          )}
        </p>
        <p className="mt-1 text-xs text-[var(--theme-text-muted)]">
          Exported as Freed Markdown with YAML frontmatter. Full article text included where cached.
        </p>
      </div>

      <button
        onClick={handleExport}
        disabled={exporting || totalCount === 0}
        className="theme-accent-button flex w-full items-center justify-center gap-2 rounded-xl py-2.5 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50"
      >
        {exporting ? (
          <>
            <span className="h-4 w-4 animate-spin rounded-full border border-[rgb(var(--theme-accent-secondary-rgb)/0.3)] border-t-[var(--theme-accent-secondary)]" />
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
      <div className="flex items-center justify-between text-xs text-[var(--theme-text-muted)]">
        <span className="font-medium text-[var(--theme-text-secondary)]">{phaseLabel}</span>
        <span>{fractionLabel}</span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-[var(--theme-bg-muted)]">
        <div
          className="h-full rounded-full bg-[var(--theme-accent-secondary)] transition-all duration-200"
          style={{ width: `${percent}%` }}
        />
      </div>
      {(progress.imported > 0 || progress.skipped > 0) && (
        <div className="flex gap-4 text-xs text-[var(--theme-text-muted)]">
          <span className="text-emerald-400">{progress.imported.toLocaleString()} new</span>
          {progress.skipped > 0 && <span>{progress.skipped.toLocaleString()} skipped</span>}
        </div>
      )}
    </div>
  );
}
