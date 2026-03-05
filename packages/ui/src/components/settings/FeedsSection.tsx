/**
 * FeedsSection — settings pane for RSS feed management + OPML import/export.
 *
 * Extracted from AddFeedDialog so the full I/O surface lives inside the
 * unified Settings experience. AddFeedDialog now only handles the quick
 * "Add URL" + "Manage" flow.
 */

import { useCallback, useRef, useState } from "react";
import { parseOPML, readFileAsText } from "@freed/shared";
import type { OPMLFeedEntry, ImportProgress } from "@freed/shared";
import { useAppStore, usePlatform } from "../../context/PlatformContext.js";

type FeedTab = "add" | "manage" | "import" | "export";
type ImportPhase = "idle" | "preview" | "importing" | "complete";

// ── Shared tab bar ────────────────────────────────────────────────────────────

function TabBar({
  tabs,
  active,
  onChange,
}: {
  tabs: { id: FeedTab; label: string }[];
  active: FeedTab;
  onChange: (id: FeedTab) => void;
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

export function FeedsSection() {
  const { addRssFeed, importOPMLFeeds, exportFeedsAsOPML } = usePlatform();

  const availableTabs: { id: FeedTab; label: string }[] = [
    ...(addRssFeed ? [{ id: "add" as const, label: "Add URL" }] : []),
    { id: "manage" as const, label: "Manage" },
    ...(importOPMLFeeds ? [{ id: "import" as const, label: "Import OPML" }] : []),
    ...(exportFeedsAsOPML ? [{ id: "export" as const, label: "Export OPML" }] : []),
  ];

  const defaultTab: FeedTab = addRssFeed ? "add" : "manage";
  const [activeTab, setActiveTab] = useState<FeedTab>(defaultTab);

  return (
    <div>
      {availableTabs.length > 1 && (
        <TabBar tabs={availableTabs} active={activeTab} onChange={setActiveTab} />
      )}
      {activeTab === "add" && addRssFeed && <AddUrlPane />}
      {activeTab === "manage" && <ManagePane />}
      {activeTab === "import" && importOPMLFeeds && <ImportPane />}
      {activeTab === "export" && exportFeedsAsOPML && <ExportPane />}
    </div>
  );
}

// ── Add URL pane ───────────────────────────────────────────────────────────────

function AddUrlPane() {
  const { addRssFeed } = usePlatform();
  const [url, setUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!url.trim() || !addRssFeed) return;

    setLoading(true);
    setError(null);
    setSuccess(false);
    try {
      await addRssFeed(url.trim());
      setUrl("");
      setSuccess(true);
      setTimeout(() => setSuccess(false), 3000);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to add feed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label htmlFor="settings-feed-url" className="block text-sm text-[#a1a1aa] mb-2">
          Feed URL
        </label>
        <input
          id="settings-feed-url"
          type="url"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://example.com/feed.xml"
          className="w-full px-4 py-3 bg-white/5 border border-[rgba(255,255,255,0.08)] rounded-xl focus:outline-none focus:border-[#8b5cf6] text-white placeholder-[#71717a] transition-colors"
          disabled={loading}
        />
      </div>

      {error && (
        <div className="p-3 bg-red-500/20 border border-red-500/50 rounded-xl text-red-400 text-sm">
          {error}
        </div>
      )}
      {success && (
        <div className="p-3 bg-green-500/10 border border-green-500/20 rounded-xl text-green-400 text-sm">
          Feed added successfully
        </div>
      )}

      <div className="flex justify-end">
        <button
          type="submit"
          disabled={loading || !url.trim()}
          className="btn-primary px-6 py-2.5 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {loading ? "Adding..." : "Add Feed"}
        </button>
      </div>

      <div className="pt-3 border-t border-[rgba(255,255,255,0.06)]">
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
    </form>
  );
}

// ── Manage pane ───────────────────────────────────────────────────────────────

function ManagePane() {
  const feeds = useAppStore((s) => s.feeds);
  const removeFeed = useAppStore((s) => s.removeFeed);
  const removeAllFeeds = useAppStore((s) => s.removeAllFeeds);
  const feedList = Object.values(feeds);
  const [removing, setRemoving] = useState<string | null>(null);
  const [showRemoveAll, setShowRemoveAll] = useState(false);
  const [includeItems, setIncludeItems] = useState(false);
  const [removingAll, setRemovingAll] = useState(false);

  const handleRemove = async (url: string) => {
    setRemoving(url);
    try {
      await removeFeed(url);
    } finally {
      setRemoving(null);
    }
  };

  const handleRemoveAll = async () => {
    setRemovingAll(true);
    try {
      await removeAllFeeds(includeItems);
    } finally {
      setRemovingAll(false);
      setShowRemoveAll(false);
      setIncludeItems(false);
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
    <>
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
                <svg className="w-4 h-4 text-[#8b5cf6]/60" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M6 5c7.18 0 13 5.82 13 13M6 11a7 7 0 017 7M6 17a1 1 0 110-2 1 1 0 010 2z" />
                </svg>
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

      <div className="mt-4 pt-4 border-t border-[rgba(255,255,255,0.06)]">
        <button
          onClick={() => setShowRemoveAll(true)}
          className="text-xs text-red-400/70 hover:text-red-400 transition-colors"
        >
          Remove all {feedList.length.toLocaleString()} feeds&hellip;
        </button>
      </div>

      {showRemoveAll && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
          <div className="w-full max-w-sm bg-[#18181b] border border-[rgba(255,255,255,0.1)] rounded-2xl p-6 shadow-2xl">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-full bg-red-500/15 flex items-center justify-center flex-shrink-0">
                <svg className="w-5 h-5 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                </svg>
              </div>
              <div>
                <p className="text-sm font-semibold text-white">Remove all feeds?</p>
                <p className="text-xs text-[#71717a] mt-0.5">
                  Unsubscribes from all {feedList.length.toLocaleString()} feeds on every synced device.
                </p>
              </div>
            </div>

            <label className="flex items-start gap-3 mb-5 cursor-pointer group">
              <input
                type="checkbox"
                checked={includeItems}
                onChange={(e) => setIncludeItems(e.target.checked)}
                className="mt-0.5 w-4 h-4 rounded border-[rgba(255,255,255,0.2)] bg-white/5 text-red-500 focus:ring-red-500 focus:ring-offset-0"
              />
              <div>
                <p className="text-sm text-[#a1a1aa] group-hover:text-white transition-colors">
                  Also delete all articles and reading history
                </p>
                <p className="text-xs text-[#52525b] mt-0.5">Cannot be undone</p>
              </div>
            </label>

            <div className="flex gap-3">
              <button
                onClick={() => { setShowRemoveAll(false); setIncludeItems(false); }}
                disabled={removingAll}
                className="flex-1 py-2.5 rounded-xl bg-white/5 hover:bg-white/10 text-[#a1a1aa] hover:text-white transition-colors text-sm disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={handleRemoveAll}
                disabled={removingAll}
                className="flex-1 py-2.5 rounded-xl bg-red-500/20 hover:bg-red-500/30 text-red-400 hover:text-red-300 transition-colors text-sm font-medium disabled:opacity-50"
              >
                {removingAll ? (
                  <span className="flex items-center justify-center gap-2">
                    <span className="w-3 h-3 border-2 border-red-400 border-t-transparent rounded-full animate-spin" />
                    Removing&hellip;
                  </span>
                ) : (
                  "Remove All"
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

// ── Import pane (OPML) ────────────────────────────────────────────────────────

function ImportPane() {
  const { importOPMLFeeds } = usePlatform();
  const [phase, setPhase] = useState<ImportPhase>("idle");
  const [parsedFeeds, setParsedFeeds] = useState<OPMLFeedEntry[]>([]);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [progress, setProgress] = useState<ImportProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isDragOver, setIsDragOver] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const existingFeeds = useAppStore((s) => s.feeds);
  const existingUrls = new Set(Object.values(existingFeeds).map((f) => f.url));

  const handleFile = useCallback(
    async (file: File) => {
      setError(null);
      try {
        const xml = await readFileAsText(file);
        const feeds = parseOPML(xml);
        setParsedFeeds(feeds);
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
    // existingUrls is computed on each render; the callback only needs to close
    // over the current set at call time, so the array dep is intentionally omitted.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [existingFeeds],
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

  const toggleFeed = (index: number) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  };

  const toggleAll = () => {
    const selectable = parsedFeeds
      .map((f, i) => (!existingUrls.has(f.url) ? i : -1))
      .filter((i) => i >= 0);
    if (selected.size === selectable.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(selectable));
    }
  };

  const handleImport = async () => {
    const feedsToImport = parsedFeeds.filter((_, i) => selected.has(i));
    if (feedsToImport.length === 0 || !importOPMLFeeds) return;
    setPhase("importing");
    const result = await importOPMLFeeds(feedsToImport, (p) => setProgress({ ...p }));
    setProgress(result);
    setPhase("complete");
  };

  const handleReset = () => {
    setPhase("idle");
    setParsedFeeds([]);
    setSelected(new Set());
    setProgress(null);
    setError(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const newCount = parsedFeeds.filter((f) => !existingUrls.has(f.url)).length;
  const duplicateCount = parsedFeeds.length - newCount;
  const folders = [...new Set(parsedFeeds.map((f) => f.folder).filter(Boolean))];

  if (phase === "idle") {
    return (
      <>
        <div
          onDragOver={(e) => { e.preventDefault(); setIsDragOver(true); }}
          onDragLeave={() => setIsDragOver(false)}
          onDrop={handleDrop}
          onClick={() => fileInputRef.current?.click()}
          className={`flex flex-col items-center justify-center gap-3 p-8 rounded-xl border-2 border-dashed cursor-pointer transition-all ${
            isDragOver
              ? "border-[#8b5cf6] bg-[#8b5cf6]/10"
              : "border-[rgba(255,255,255,0.12)] hover:border-[rgba(255,255,255,0.25)] bg-white/[0.02]"
          }`}
        >
          <svg className="w-10 h-10 text-[#71717a]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
          </svg>
          <div className="text-center">
            <p className="text-sm text-white">
              Drop an OPML file here or <span className="text-[#8b5cf6]">browse</span>
            </p>
            <p className="text-xs text-[#71717a] mt-1">Supports .opml and .xml files</p>
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
          OPML is a standard format used by most RSS readers. Export from Feedly,
          Inoreader, NetNewsWire, and others, then drop the file here.
        </p>
      </>
    );
  }

  if (phase === "preview") {
    return (
      <>
        <div className="flex items-center gap-3 mb-4">
          <div className="flex-1 min-w-0">
            <p className="text-sm text-white">
              <span className="font-semibold">{parsedFeeds.length.toLocaleString()}</span>{" "}
              feed{parsedFeeds.length !== 1 ? "s" : ""} found
              {duplicateCount > 0 && (
                <span className="text-[#71717a]"> · {duplicateCount.toLocaleString()} already subscribed</span>
              )}
            </p>
            {folders.length > 0 && (
              <p className="text-xs text-[#71717a] mt-0.5 truncate">
                Folders: {folders.join(", ")}
              </p>
            )}
          </div>
          <button onClick={handleReset} className="text-xs text-[#a1a1aa] hover:text-white transition-colors px-2 py-1">
            Change file
          </button>
        </div>

        {newCount > 0 && (
          <button onClick={toggleAll} className="mb-3 text-xs text-[#8b5cf6] hover:text-[#a78bfa] transition-colors">
            {selected.size === newCount ? "Deselect all" : "Select all"}
          </button>
        )}

        <div className="space-y-1 max-h-64 overflow-y-auto -mx-1 px-1">
          {parsedFeeds.map((feed, i) => {
            const isExisting = existingUrls.has(feed.url);
            const isSelected = selected.has(i);
            return (
              <label
                key={feed.url + i}
                className={`flex items-center gap-3 px-3 py-2.5 rounded-lg transition-colors cursor-pointer ${
                  isExisting ? "opacity-50 cursor-default" : isSelected ? "bg-white/5" : "hover:bg-white/[0.03]"
                }`}
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

        <div className="flex gap-3 justify-end mt-4 pt-4 border-t border-[rgba(255,255,255,0.08)]">
          <button onClick={handleReset} className="px-4 py-2.5 text-[#a1a1aa] hover:text-white transition-colors text-sm">
            Change file
          </button>
          <button
            onClick={handleImport}
            disabled={selected.size === 0}
            className="btn-primary px-6 py-2.5 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Import {selected.size.toLocaleString()} feed{selected.size !== 1 ? "s" : ""}
          </button>
        </div>
      </>
    );
  }

  if (phase === "importing" && progress) {
    const pct = Math.round((progress.completed / progress.total) * 100);
    return (
      <div className="flex flex-col items-center gap-4 py-4">
        <div className="w-full bg-white/5 rounded-full h-2 overflow-hidden">
          <div className="h-full bg-[#8b5cf6] rounded-full transition-all duration-300" style={{ width: `${pct}%` }} />
        </div>
        <div className="text-center">
          <p className="text-sm text-white">
            Subscribing... {progress.completed.toLocaleString()}/{progress.total.toLocaleString()}
          </p>
          {progress.current && (
            <p className="text-xs text-[#71717a] mt-1 truncate max-w-xs">{progress.current}</p>
          )}
        </div>
      </div>
    );
  }

  if (phase === "complete" && progress) {
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
          <div className="flex justify-center gap-4 mt-3">
            <div className="text-center">
              <p className="text-lg font-bold text-green-400">{progress.added.toLocaleString()}</p>
              <p className="text-xs text-[#71717a]">added</p>
            </div>
            {progress.skipped > 0 && (
              <div className="text-center">
                <p className="text-lg font-bold text-[#a1a1aa]">{progress.skipped.toLocaleString()}</p>
                <p className="text-xs text-[#71717a]">skipped</p>
              </div>
            )}
            {progress.failed.length > 0 && (
              <div className="text-center">
                <p className="text-lg font-bold text-red-400">{progress.failed.length.toLocaleString()}</p>
                <p className="text-xs text-[#71717a]">failed</p>
              </div>
            )}
          </div>
        </div>
        {progress.failed.length > 0 && (
          <div className="bg-red-500/10 border border-red-500/20 rounded-xl p-3">
            <p className="text-xs text-red-400 font-medium mb-2">Failed to subscribe:</p>
            {progress.failed.map((f: { url: string; error: string }) => (
              <p key={f.url} className="text-xs text-[#71717a] truncate">
                {f.url} — {f.error}
              </p>
            ))}
          </div>
        )}
        {progress.added > 0 && (
          <p className="text-xs text-[#71717a] text-center">Fetching items in the background...</p>
        )}
        <div className="flex justify-center">
          <button onClick={handleReset} className="px-4 py-2.5 text-[#a1a1aa] hover:text-white transition-colors text-sm">
            Import more
          </button>
        </div>
      </div>
    );
  }

  return null;
}

// ── Export pane (OPML) ────────────────────────────────────────────────────────

function ExportPane() {
  const { exportFeedsAsOPML } = usePlatform();
  const feeds = useAppStore((s) => s.feeds);
  const feedList = Object.values(feeds);
  const folders = [...new Set(feedList.map((f) => f.folder).filter(Boolean))];

  if (feedList.length === 0) {
    return (
      <div className="text-center py-6">
        <p className="text-sm text-[#71717a]">No feed subscriptions to export.</p>
        <p className="text-xs text-[#71717a] mt-1">Add some feeds first, then come back here.</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="bg-white/[0.03] rounded-xl p-4 flex items-center justify-between">
        <div>
          <p className="text-sm text-white">
            <span className="font-semibold">{feedList.length.toLocaleString()}</span>{" "}
            feed{feedList.length !== 1 ? "s" : ""}
          </p>
          {folders.length > 0 && (
            <p className="text-xs text-[#71717a] mt-0.5">
              in {folders.length.toLocaleString()} folder{folders.length !== 1 ? "s" : ""}
            </p>
          )}
        </div>
        <svg className="w-8 h-8 text-[#71717a]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
        </svg>
      </div>

      <div className="max-h-48 overflow-y-auto space-y-1">
        {feedList.map((feed) => (
          <div key={feed.url} className="flex items-center gap-2 px-3 py-2 rounded-lg">
            <svg className="w-3.5 h-3.5 text-[#8b5cf6]/60 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 5c7.18 0 13 5.82 13 13M6 11a7 7 0 017 7M6 17a1 1 0 110-2 1 1 0 010 2z" />
            </svg>
            <span className="text-sm text-white truncate flex-1">{feed.title}</span>
            {feed.folder && (
              <span className="flex-shrink-0 text-[10px] px-2 py-0.5 bg-white/5 rounded-full text-[#a1a1aa]">
                {feed.folder}
              </span>
            )}
          </div>
        ))}
      </div>

      <button
        onClick={() => exportFeedsAsOPML?.()}
        className="btn-primary w-full py-3 text-sm font-medium"
      >
        Download OPML
      </button>

      <p className="text-xs text-[#71717a] text-center">
        Compatible with Feedly, Inoreader, NetNewsWire, and other RSS readers.
      </p>
    </div>
  );
}
