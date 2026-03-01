import { useCallback, useRef, useState } from "react";
import { addRssFeed, importOPMLFeeds, exportFeedsAsOPML } from "../lib/capture";
import type { ImportProgress } from "../lib/capture";
import { parseOPML, readFileAsText } from "@freed/shared";
import type { OPMLFeedEntry } from "@freed/shared";
import { useAppStore } from "../lib/store";

// =============================================================================
// Types
// =============================================================================

type DialogTab = "url" | "manage" | "import" | "export";
type ImportPhase = "idle" | "preview" | "importing" | "complete";

interface AddFeedDialogProps {
  open: boolean;
  onClose: () => void;
}

// =============================================================================
// Main Dialog
// =============================================================================

export function AddFeedDialog({ open, onClose }: AddFeedDialogProps) {
  const [activeTab, setActiveTab] = useState<DialogTab>("url");

  if (!open) return null;

  const handleClose = () => {
    setActiveTab("url");
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={handleClose}
      />

      {/* Dialog — slides up from bottom on mobile */}
      <div className="relative w-full sm:max-w-lg sm:mx-4 bg-[#141414] border border-[rgba(255,255,255,0.08)] rounded-t-2xl sm:rounded-2xl shadow-2xl max-h-[85vh] flex flex-col">
        {/* Mobile drag indicator */}
        <div className="sm:hidden w-12 h-1 bg-white/20 rounded-full mx-auto mt-3" />

        {/* Header + Tabs */}
        <div className="px-6 pt-5 pb-0 flex-shrink-0">
          <h2 className="text-xl font-semibold mb-4">RSS Feeds</h2>
          <div className="flex gap-1 bg-white/5 rounded-xl p-1">
            {(
              [
                { id: "url", label: "Add URL" },
                { id: "manage", label: "Manage" },
                { id: "import", label: "Import" },
                { id: "export", label: "Export" },
              ] as const
            ).map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`
                  flex-1 px-3 py-2 text-sm font-medium rounded-lg transition-all
                  ${
                    activeTab === tab.id
                      ? "bg-[#8b5cf6]/20 text-[#8b5cf6]"
                      : "text-[#a1a1aa] hover:text-white"
                  }
                `}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>

        {/* Tab Content — scrollable */}
        <div className="p-6 overflow-y-auto flex-1 min-h-0">
          {activeTab === "url" && <AddUrlTab onClose={handleClose} />}
          {activeTab === "manage" && <ManageTab />}
          {activeTab === "import" && <ImportTab onClose={handleClose} />}
          {activeTab === "export" && <ExportTab />}
        </div>
      </div>
    </div>
  );
}

// =============================================================================
// Tab 1: Add URL (existing functionality)
// =============================================================================

function AddUrlTab({ onClose }: { onClose: () => void }) {
  const [url, setUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!url.trim()) return;

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
          <label htmlFor="feed-url" className="block text-sm text-[#a1a1aa] mb-2">
            Feed URL
          </label>
          <input
            id="feed-url"
            type="url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://example.com/feed.xml"
            className="w-full px-4 py-3 bg-white/5 border border-[rgba(255,255,255,0.08)] rounded-xl focus:outline-none focus:border-[#8b5cf6] text-white placeholder-[#71717a] transition-colors"
            disabled={loading}
            autoFocus
          />
        </div>

        {error && (
          <div className="mb-4 p-3 bg-red-500/20 border border-red-500/50 rounded-xl text-red-400 text-sm">
            {error}
          </div>
        )}

        <div className="flex gap-3 justify-end">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2.5 text-[#a1a1aa] hover:text-white transition-colors"
            disabled={loading}
          >
            Cancel
          </button>
          <button
            type="submit"
            className="btn-primary px-6 py-2.5 disabled:opacity-50 disabled:cursor-not-allowed"
            disabled={loading || !url.trim()}
          >
            {loading ? "Adding..." : "Add Feed"}
          </button>
        </div>
      </form>

      {/* Example feeds */}
      <div className="mt-6 pt-4 border-t border-[rgba(255,255,255,0.08)]">
        <p className="text-xs text-[#71717a] mb-3">Try these example feeds:</p>
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
              className="text-xs px-3 py-1.5 bg-white/5 hover:bg-[#8b5cf6]/20 hover:text-[#8b5cf6] rounded-lg text-[#a1a1aa] transition-colors"
            >
              {new URL(exampleUrl).hostname}
            </button>
          ))}
        </div>
      </div>
    </>
  );
}

// =============================================================================
// Tab 2: Manage Feeds
// =============================================================================

function ManageTab() {
  const feeds = useAppStore((s) => s.feeds);
  const removeFeed = useAppStore((s) => s.removeFeed);
  const feedList = Object.values(feeds);
  const [removing, setRemoving] = useState<string | null>(null);

  const handleRemove = async (url: string) => {
    setRemoving(url);
    try {
      await removeFeed(url);
    } finally {
      setRemoving(null);
    }
  };

  if (feedList.length === 0) {
    return (
      <div className="text-center py-8">
        <p className="text-sm text-[#71717a]">No feeds subscribed yet.</p>
        <p className="text-xs text-[#52525b] mt-1">Add a feed URL to get started.</p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {feedList.map((feed) => (
        <div
          key={feed.url}
          className="flex items-center gap-3 px-3 py-2.5 rounded-xl bg-white/[0.03] border border-[rgba(255,255,255,0.05)]"
        >
          {feed.imageUrl ? (
            <img src={feed.imageUrl} alt="" className="w-8 h-8 rounded-md flex-shrink-0 object-cover" />
          ) : (
            <div className="w-8 h-8 rounded-md bg-[#8b5cf6]/10 flex items-center justify-center flex-shrink-0">
              <span className="text-sm">📡</span>
            </div>
          )}
          <div className="flex-1 min-w-0">
            <p className="text-sm text-white truncate">{feed.title}</p>
            <p className="text-xs text-[#52525b] truncate">{feed.url}</p>
          </div>
          <button
            onClick={() => handleRemove(feed.url)}
            disabled={removing === feed.url}
            className="flex-shrink-0 p-1.5 rounded-lg hover:bg-red-500/20 text-[#71717a] hover:text-red-400 transition-colors disabled:opacity-50"
            aria-label={`Remove ${feed.title}`}
          >
            {removing === feed.url ? (
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
      ))}
    </div>
  );
}

// =============================================================================
// Tab 3: Import OPML
// =============================================================================

function ImportTab({ onClose }: { onClose: () => void }) {
  const [phase, setPhase] = useState<ImportPhase>("idle");
  const [parsedFeeds, setParsedFeeds] = useState<OPMLFeedEntry[]>([]);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [progress, setProgress] = useState<ImportProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isDragOver, setIsDragOver] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const existingFeeds = useAppStore((s) => s.feeds);
  const existingUrls = new Set(Object.values(existingFeeds).map((f) => f.url));

  // -- File handling --

  const handleFile = useCallback(
    async (file: File) => {
      setError(null);
      try {
        const xml = await readFileAsText(file);
        const feeds = parseOPML(xml);
        setParsedFeeds(feeds);

        // Auto-select all feeds not already subscribed
        const autoSelected = new Set<number>();
        feeds.forEach((f, i) => {
          if (!existingUrls.has(f.url)) autoSelected.add(i);
        });
        setSelected(autoSelected);
        setPhase("preview");
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to parse OPML");
      }
    },
    [existingUrls],
  );

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragOver(false);
      const file = e.dataTransfer.files[0];
      if (file) handleFile(file);
    },
    [handleFile],
  );

  const handleFileInput = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) handleFile(file);
    },
    [handleFile],
  );

  // -- Selection --

  const toggleFeed = (index: number) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  };

  const toggleAll = () => {
    const selectableIndices = parsedFeeds
      .map((f, i) => (!existingUrls.has(f.url) ? i : -1))
      .filter((i) => i >= 0);

    if (selected.size === selectableIndices.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(selectableIndices));
    }
  };

  // -- Import --

  const handleImport = async () => {
    const feedsToImport = parsedFeeds.filter((_, i) => selected.has(i));
    if (feedsToImport.length === 0) return;

    setPhase("importing");
    const result = await importOPMLFeeds(feedsToImport, (p) =>
      setProgress({ ...p }),
    );
    setProgress(result);
    setPhase("complete");
  };

  // -- Reset --

  const handleReset = () => {
    setPhase("idle");
    setParsedFeeds([]);
    setSelected(new Set());
    setProgress(null);
    setError(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  // -- Computed --

  const newCount = parsedFeeds.filter((f) => !existingUrls.has(f.url)).length;
  const duplicateCount = parsedFeeds.length - newCount;
  const folders = [...new Set(parsedFeeds.map((f) => f.folder).filter(Boolean))];

  // ---- Render by phase ----

  if (phase === "idle") {
    return (
      <>
        {/* Drop zone */}
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setIsDragOver(true);
          }}
          onDragLeave={() => setIsDragOver(false)}
          onDrop={handleDrop}
          onClick={() => fileInputRef.current?.click()}
          className={`
            flex flex-col items-center justify-center gap-3 p-8 rounded-xl border-2 border-dashed cursor-pointer transition-all
            ${
              isDragOver
                ? "border-[#8b5cf6] bg-[#8b5cf6]/10"
                : "border-[rgba(255,255,255,0.12)] hover:border-[rgba(255,255,255,0.25)] bg-white/[0.02]"
            }
          `}
        >
          <svg
            className="w-10 h-10 text-[#71717a]"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={1.5}
              d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"
            />
          </svg>
          <div className="text-center">
            <p className="text-sm text-white">
              Drop an OPML file here or{" "}
              <span className="text-[#8b5cf6]">browse</span>
            </p>
            <p className="text-xs text-[#71717a] mt-1">
              Supports .opml and .xml files
            </p>
          </div>
          <input
            ref={fileInputRef}
            type="file"
            accept=".opml,.xml,application/xml,text/xml"
            onChange={handleFileInput}
            className="hidden"
          />
        </div>

        {error && (
          <div className="mt-4 p-3 bg-red-500/20 border border-red-500/50 rounded-xl text-red-400 text-sm">
            {error}
          </div>
        )}

        <p className="mt-4 text-xs text-[#71717a] leading-relaxed">
          OPML is a standard format used by most RSS readers to export and import
          feed subscriptions. You can export from Feedly, Inoreader, NetNewsWire,
          and others.
        </p>
      </>
    );
  }

  if (phase === "preview") {
    return (
      <>
        {/* Summary bar */}
        <div className="flex items-center gap-3 mb-4">
          <div className="flex-1 min-w-0">
            <p className="text-sm text-white">
              <span className="font-semibold">{parsedFeeds.length}</span> feed
              {parsedFeeds.length !== 1 ? "s" : ""} found
              {duplicateCount > 0 && (
                <span className="text-[#71717a]">
                  {" "}
                  · {duplicateCount} already subscribed
                </span>
              )}
            </p>
            {folders.length > 0 && (
              <p className="text-xs text-[#71717a] mt-0.5 truncate">
                Folders: {folders.join(", ")}
              </p>
            )}
          </div>
          <button
            onClick={handleReset}
            className="text-xs text-[#a1a1aa] hover:text-white transition-colors px-2 py-1"
          >
            Change file
          </button>
        </div>

        {/* Select all toggle */}
        {newCount > 0 && (
          <button
            onClick={toggleAll}
            className="mb-3 text-xs text-[#8b5cf6] hover:text-[#a78bfa] transition-colors"
          >
            {selected.size === newCount ? "Deselect all" : "Select all"}
          </button>
        )}

        {/* Feed list */}
        <div className="space-y-1 max-h-64 overflow-y-auto -mx-1 px-1">
          {parsedFeeds.map((feed, i) => {
            const isExisting = existingUrls.has(feed.url);
            const isSelected = selected.has(i);

            return (
              <label
                key={feed.url + i}
                className={`
                  flex items-center gap-3 px-3 py-2.5 rounded-lg transition-colors cursor-pointer
                  ${isExisting ? "opacity-50 cursor-default" : isSelected ? "bg-white/5" : "hover:bg-white/[0.03]"}
                `}
              >
                <input
                  type="checkbox"
                  checked={isSelected}
                  onChange={() => !isExisting && toggleFeed(i)}
                  disabled={isExisting}
                  className="w-4 h-4 rounded border-[rgba(255,255,255,0.2)] bg-white/5 text-[#8b5cf6] focus:ring-[#8b5cf6] focus:ring-offset-0 disabled:opacity-40"
                />
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-white truncate">{feed.title}</p>
                  <p className="text-xs text-[#71717a] truncate">{feed.url}</p>
                </div>
                {feed.folder && (
                  <span className="flex-shrink-0 text-[10px] px-2 py-0.5 bg-white/5 rounded-full text-[#a1a1aa]">
                    {feed.folder}
                  </span>
                )}
                {isExisting && (
                  <span className="flex-shrink-0 text-[10px] px-2 py-0.5 bg-green-500/10 text-green-400 rounded-full">
                    subscribed
                  </span>
                )}
              </label>
            );
          })}
        </div>

        {/* Actions */}
        <div className="flex gap-3 justify-end mt-4 pt-4 border-t border-[rgba(255,255,255,0.08)]">
          <button
            onClick={handleReset}
            className="px-4 py-2.5 text-[#a1a1aa] hover:text-white transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleImport}
            className="btn-primary px-6 py-2.5 disabled:opacity-50 disabled:cursor-not-allowed"
            disabled={selected.size === 0}
          >
            Import {selected.size} feed{selected.size !== 1 ? "s" : ""}
          </button>
        </div>
      </>
    );
  }

  if (phase === "importing" && progress) {
    const pct = Math.round((progress.completed / progress.total) * 100);

    return (
      <div className="flex flex-col items-center gap-4 py-4">
        {/* Progress ring / bar */}
        <div className="w-full bg-white/5 rounded-full h-2 overflow-hidden">
          <div
            className="h-full bg-[#8b5cf6] rounded-full transition-all duration-300"
            style={{ width: `${pct}%` }}
          />
        </div>

        <div className="text-center">
          <p className="text-sm text-white">
            Subscribing to feeds... {progress.completed}/{progress.total}
          </p>
          {progress.current && (
            <p className="text-xs text-[#71717a] mt-1 truncate max-w-xs">
              {progress.current}
            </p>
          )}
        </div>
      </div>
    );
  }

  if (phase === "complete" && progress) {
    return (
      <div className="flex flex-col gap-4 py-2">
        {/* Success icon */}
        <div className="flex justify-center">
          <div className="w-12 h-12 rounded-full bg-green-500/20 flex items-center justify-center">
            <svg
              className="w-6 h-6 text-green-400"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M5 13l4 4L19 7"
              />
            </svg>
          </div>
        </div>

        {/* Results summary */}
        <div className="text-center">
          <p className="text-lg font-semibold text-white">Import Complete</p>
          <div className="flex justify-center gap-4 mt-3 text-sm">
            <div className="text-center">
              <p className="text-lg font-bold text-green-400">{progress.added}</p>
              <p className="text-xs text-[#71717a]">added</p>
            </div>
            {progress.skipped > 0 && (
              <div className="text-center">
                <p className="text-lg font-bold text-[#a1a1aa]">
                  {progress.skipped}
                </p>
                <p className="text-xs text-[#71717a]">skipped</p>
              </div>
            )}
            {progress.failed.length > 0 && (
              <div className="text-center">
                <p className="text-lg font-bold text-red-400">
                  {progress.failed.length}
                </p>
                <p className="text-xs text-[#71717a]">failed</p>
              </div>
            )}
          </div>
        </div>

        {/* Failed feed details */}
        {progress.failed.length > 0 && (
          <div className="bg-red-500/10 border border-red-500/20 rounded-xl p-3">
            <p className="text-xs text-red-400 font-medium mb-2">
              Failed to subscribe:
            </p>
            {progress.failed.map(({ url, error }) => (
              <p key={url} className="text-xs text-[#71717a] truncate">
                {url} — {error}
              </p>
            ))}
          </div>
        )}

        {progress.added > 0 && (
          <p className="text-xs text-[#71717a] text-center">
            Fetching items in the background...
          </p>
        )}

        {/* Actions */}
        <div className="flex gap-3 justify-center mt-2">
          <button
            onClick={handleReset}
            className="px-4 py-2.5 text-[#a1a1aa] hover:text-white transition-colors text-sm"
          >
            Import More
          </button>
          <button
            onClick={onClose}
            className="btn-primary px-6 py-2.5 text-sm"
          >
            Done
          </button>
        </div>
      </div>
    );
  }

  return null;
}

// =============================================================================
// Tab 3: Export OPML
// =============================================================================

function ExportTab() {
  const feeds = useAppStore((s) => s.feeds);
  const feedList = Object.values(feeds);
  const folders = [
    ...new Set(feedList.map((f) => f.folder).filter(Boolean)),
  ];

  return (
    <div className="flex flex-col gap-4">
      {feedList.length === 0 ? (
        <div className="text-center py-6">
          <p className="text-sm text-[#71717a]">
            No feed subscriptions to export.
          </p>
          <p className="text-xs text-[#71717a] mt-1">
            Add some feeds first, then come back here.
          </p>
        </div>
      ) : (
        <>
          {/* Feed stats */}
          <div className="bg-white/[0.03] rounded-xl p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-white">
                  <span className="font-semibold">{feedList.length}</span> feed
                  {feedList.length !== 1 ? "s" : ""}
                </p>
                {folders.length > 0 && (
                  <p className="text-xs text-[#71717a] mt-0.5">
                    in {folders.length} folder{folders.length !== 1 ? "s" : ""}
                  </p>
                )}
              </div>
              <svg
                className="w-8 h-8 text-[#71717a]"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={1.5}
                  d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
                />
              </svg>
            </div>
          </div>

          {/* Feed list preview */}
          <div className="max-h-48 overflow-y-auto space-y-1">
            {feedList.map((feed) => (
              <div
                key={feed.url}
                className="flex items-center gap-2 px-3 py-2 rounded-lg"
              >
                <span className="text-xs text-[#8b5cf6]">📡</span>
                <span className="text-sm text-white truncate flex-1">
                  {feed.title}
                </span>
                {feed.folder && (
                  <span className="flex-shrink-0 text-[10px] px-2 py-0.5 bg-white/5 rounded-full text-[#a1a1aa]">
                    {feed.folder}
                  </span>
                )}
              </div>
            ))}
          </div>

          {/* Download button */}
          <button
            onClick={exportFeedsAsOPML}
            className="btn-primary w-full py-3 text-sm font-medium"
          >
            Download OPML
          </button>

          <p className="text-xs text-[#71717a] text-center">
            Compatible with Feedly, Inoreader, NetNewsWire, and other RSS
            readers.
          </p>
        </>
      )}
    </div>
  );
}
