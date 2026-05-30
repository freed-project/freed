import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  buildStoryWallManifest,
  estimateStoryWallPublishSize,
  PLATFORM_LABELS,
  selectableStoryWallYears,
  selectStoryWallItems,
  type Platform,
  type StoryWallLayoutPreset,
type StoryWallPreferences,
} from "@freed/shared";
import { useAppStore, usePlatform, type StoryWallArchiveSummary } from "../../context/PlatformContext.js";

type StoryWallPreferenceUpdate = Partial<Omit<StoryWallPreferences, "style" | "publishTarget">> & {
  style?: Partial<StoryWallPreferences["style"]>;
  publishTarget?: Partial<StoryWallPreferences["publishTarget"]>;
};

const PLATFORM_OPTIONS: Platform[] = ["instagram", "facebook", "x", "rss", "saved"];
const LAYOUT_OPTIONS: Array<{ id: StoryWallLayoutPreset; label: string }> = [
  { id: "mosaic", label: "Mosaic" },
  { id: "timeline", label: "Timeline" },
  { id: "magazine", label: "Magazine" },
  { id: "map_year", label: "Map year" },
  { id: "filmstrip", label: "Filmstrip" },
];
const PALETTE_OPTIONS = ["paper", "midnight", "gallery", "garden", "mono"];
const GITHUB_TOKEN_PROVIDER = "github_story_wall";

function formatCount(value: number): string {
  return value.toLocaleString();
}

function formatBytes(value: number): string {
  return new Intl.NumberFormat(undefined, {
    style: "unit",
    unit: "megabyte",
    maximumFractionDigits: 1,
  }).format(value / 1_000_000);
}

function mergeStoryWallPreference(
  current: StoryWallPreferences,
  update: StoryWallPreferenceUpdate,
): StoryWallPreferences {
  return {
    ...current,
    ...update,
    style: {
      ...current.style,
      ...update.style,
    },
    publishTarget: {
      ...current.publishTarget,
      ...update.publishTarget,
    },
  };
}

function ToggleButton({
  active,
  children,
  onClick,
}: {
  active: boolean;
  children: ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-md border px-3 py-2 text-sm transition-colors ${
        active
          ? "border-[var(--theme-accent-secondary)] bg-[color:color-mix(in_srgb,var(--theme-accent-secondary)_15%,transparent)] text-[var(--theme-text-primary)]"
          : "theme-border theme-surface text-[var(--theme-text-secondary)] hover:text-[var(--theme-text-primary)]"
      }`}
    >
      {children}
    </button>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="theme-surface theme-border rounded-lg border px-4 py-3">
      <div className="text-xs uppercase tracking-wide text-[var(--theme-text-muted)]">{label}</div>
      <div className="mt-1 text-xl font-semibold text-[var(--theme-text-primary)]">{value}</div>
    </div>
  );
}

function PreviewTile({
  title,
  subtitle,
  mediaUrl,
  featured,
}: {
  title: string;
  subtitle: string;
  mediaUrl?: string;
  featured: boolean;
}) {
  return (
    <article
      className={`theme-surface theme-border overflow-hidden rounded-lg border ${
        featured ? "ring-2 ring-[var(--theme-accent-secondary)]" : ""
      }`}
    >
      {mediaUrl ? (
        <img src={mediaUrl} alt="" className="aspect-[4/5] w-full object-cover" loading="lazy" />
      ) : (
        <div className="flex aspect-[4/5] items-center justify-center bg-[var(--theme-bg-muted)] text-sm text-[var(--theme-text-muted)]">
          Text memory
        </div>
      )}
      <div className="space-y-1 p-3">
        <div className="line-clamp-2 text-sm font-medium text-[var(--theme-text-primary)]">{title}</div>
        <div className="text-xs text-[var(--theme-text-muted)]">{subtitle}</div>
      </div>
    </article>
  );
}

export function StoryWallView() {
  const items = useAppStore((s) => s.items);
  const accounts = useAppStore((s) => s.accounts);
  const preferences = useAppStore((s) => s.preferences);
  const updatePreferences = useAppStore((s) => s.updatePreferences);
  const platform = usePlatform();
  const archiveInputRef = useRef<HTMLInputElement | null>(null);
  const storyWall = preferences.storyWall;
  const [archiveSummaries, setArchiveSummaries] = useState<StoryWallArchiveSummary[]>([]);
  const [archiveBusy, setArchiveBusy] = useState(false);
  const [archiveMessage, setArchiveMessage] = useState<string | null>(null);
  const [githubToken, setGithubToken] = useState("");
  const [hasSavedToken, setHasSavedToken] = useState(false);
  const [publishBusy, setPublishBusy] = useState(false);
  const [publishMessage, setPublishMessage] = useState<string | null>(null);

  const availableYears = useMemo(() => selectableStoryWallYears(items), [items]);
  const selectedItems = useMemo(
    () => selectStoryWallItems(items, storyWall, accounts),
    [accounts, items, storyWall],
  );
  const manifest = useMemo(
    () => buildStoryWallManifest(items, storyWall),
    [items, storyWall],
  );
  const estimatedSize = useMemo(() => estimateStoryWallPublishSize(manifest), [manifest]);
  const featuredIds = useMemo(() => new Set(storyWall.featuredItemIds), [storyWall.featuredItemIds]);
  const archiveTotal = archiveSummaries.reduce((sum, summary) => sum + summary.fileCount, 0);
  const archiveBytes = archiveSummaries.reduce((sum, summary) => sum + summary.byteSize, 0);

  useEffect(() => {
    let cancelled = false;
    void platform.getStoryWallArchiveSummaries?.().then((summaries) => {
      if (!cancelled) setArchiveSummaries(summaries);
    });
    return () => {
      cancelled = true;
    };
  }, [platform]);

  useEffect(() => {
    let cancelled = false;
    void platform.secureStorage?.getApiKey(GITHUB_TOKEN_PROVIDER).then((token) => {
      if (cancelled) return;
      setHasSavedToken(!!token);
    });
    return () => {
      cancelled = true;
    };
  }, [platform.secureStorage]);

  const persistStoryWall = (update: StoryWallPreferenceUpdate) => {
    const next = mergeStoryWallPreference(storyWall, update);
    void updatePreferences({ storyWall: next });
  };

  const toggleYear = (year: number) => {
    const years = new Set(storyWall.selectedYears);
    if (years.has(year)) years.delete(year);
    else years.add(year);
    persistStoryWall({ selectedYears: Array.from(years).sort((a, b) => b - a), enabled: true });
  };

  const togglePlatform = (provider: Platform) => {
    const providers = new Set(storyWall.includedPlatforms);
    if (providers.has(provider)) providers.delete(provider);
    else providers.add(provider);
    persistStoryWall({ includedPlatforms: Array.from(providers) });
  };

  const toggleFeatured = (id: string) => {
    const ids = new Set(storyWall.featuredItemIds);
    if (ids.has(id)) ids.delete(id);
    else ids.add(id);
    persistStoryWall({ featuredItemIds: Array.from(ids) });
  };

  const hideItem = (id: string) => {
    const ids = new Set(storyWall.hiddenItemIds);
    ids.add(id);
    persistStoryWall({ hiddenItemIds: Array.from(ids) });
  };

  const handleArchiveImport = async (files: FileList | null) => {
    if (!files || files.length === 0 || !platform.importInstagramStoryWallArchive) return;
    setArchiveBusy(true);
    setArchiveMessage(null);
    try {
      const summary = await platform.importInstagramStoryWallArchive(files);
      setArchiveMessage(
        `Imported ${formatCount(summary.imported)} media files from ${formatCount(summary.filesScanned)} archive files.`,
      );
      const summaries = await platform.getStoryWallArchiveSummaries?.();
      if (summaries) setArchiveSummaries(summaries);
      persistStoryWall({ enabled: true });
    } catch (error) {
      setArchiveMessage(error instanceof Error ? error.message : "Archive import failed.");
    } finally {
      setArchiveBusy(false);
      if (archiveInputRef.current) archiveInputRef.current.value = "";
    }
  };

  const handlePublish = async () => {
    if (!platform.publishStoryWall) {
      setPublishMessage("Publishing is available in Freed Desktop.");
      return;
    }
    setPublishBusy(true);
    setPublishMessage(null);
    try {
      const savedToken = await platform.secureStorage?.getApiKey(GITHUB_TOKEN_PROVIDER);
      const token = githubToken.trim() || savedToken;
      if (!token) {
        setPublishMessage("Add a GitHub token before publishing.");
        return;
      }
      if (githubToken.trim() && platform.secureStorage) {
        await platform.secureStorage.setApiKey(GITHUB_TOKEN_PROVIDER, githubToken.trim());
        setHasSavedToken(true);
        setGithubToken("");
      }
      persistStoryWall({
        enabled: true,
        lastReviewedAt: Date.now(),
        publishTarget: { status: "publishing" },
      });
      const result = await platform.publishStoryWall({
        token,
        repoName: storyWall.publishTarget.repoName || "freed-story-wall",
        branch: storyWall.publishTarget.branch || "main",
        directory: storyWall.publishTarget.directory || "docs",
        manifest,
      });
      persistStoryWall({
        publishTarget: {
          status: "published",
          pagesUrl: result.pagesUrl,
          lastPublishedAt: Date.now(),
          lastError: undefined,
        },
      });
      setPublishMessage(`Published to ${result.pagesUrl}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Publish failed.";
      persistStoryWall({
        publishTarget: { status: "error", lastError: message },
      });
      setPublishMessage(message);
    } finally {
      setPublishBusy(false);
    }
  };

  return (
    <div className="h-full overflow-auto bg-[var(--theme-bg-primary)]">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-5 px-4 py-5 lg:px-6">
        <header className="flex flex-col gap-4 border-b border-[var(--theme-border-subtle)] pb-5 lg:flex-row lg:items-end lg:justify-between">
          <div className="max-w-3xl space-y-2">
            <div className="text-xs font-semibold uppercase tracking-wide text-[var(--theme-accent-secondary)]">
              Story Wall
            </div>
            <h1 className="text-3xl font-semibold text-[var(--theme-text-primary)]">Your year, rebuilt from your own archive</h1>
            <p className="text-sm leading-6 text-[var(--theme-text-secondary)]">
              Start with Freed history, import an Instagram archive for older stories, then publish a static memory wall you control. Older Instagram stories require an archive import. Future captured stories can update the wall after you connect and publish.
            </p>
          </div>
          <button
            type="button"
            className="btn-primary rounded-lg px-4 py-2 text-sm"
            onClick={() => persistStoryWall({ enabled: true })}
          >
            {storyWall.enabled ? "Enabled" : "Enable Story Wall"}
          </button>
        </header>

        <section className="grid gap-3 md:grid-cols-4">
          <Stat label="Memories selected" value={formatCount(selectedItems.length)} />
          <Stat label="Media in preview" value={formatCount(manifest.totalMedia)} />
          <Stat label="Archive vault" value={formatCount(archiveTotal)} />
          <Stat label="Publish size" value={formatBytes(estimatedSize + archiveBytes)} />
        </section>

        <section className="grid gap-5 xl:grid-cols-[360px_1fr]">
          <aside className="space-y-4">
            <div className="theme-surface theme-border rounded-lg border p-4">
              <h2 className="text-base font-semibold text-[var(--theme-text-primary)]">Start</h2>
              <div className="mt-3 grid gap-2">
                <ToggleButton active={storyWall.enabled} onClick={() => persistStoryWall({ enabled: true })}>
                  Use existing Freed history
                </ToggleButton>
                <button
                  type="button"
                  className="btn-secondary rounded-md px-3 py-2 text-sm"
                  onClick={() => archiveInputRef.current?.click()}
                  disabled={archiveBusy || !platform.importInstagramStoryWallArchive}
                >
                  {archiveBusy ? "Importing" : "Import Instagram archive"}
                </button>
                <input
                  ref={archiveInputRef}
                  type="file"
                  accept=".zip,application/zip"
                  multiple
                  className="hidden"
                  onChange={(event) => void handleArchiveImport(event.currentTarget.files)}
                />
                <ToggleButton active={storyWall.publishTarget.provider === "github_pages"} onClick={() => persistStoryWall({ publishTarget: { provider: "github_pages" } })}>
                  Publish to GitHub Pages
                </ToggleButton>
              </div>
              {archiveMessage ? (
                <p className="mt-3 text-sm text-[var(--theme-text-secondary)]">{archiveMessage}</p>
              ) : null}
            </div>

            <div className="theme-surface theme-border rounded-lg border p-4">
              <h2 className="text-base font-semibold text-[var(--theme-text-primary)]">Years</h2>
              <div className="mt-3 flex flex-wrap gap-2">
                {availableYears.length > 0 ? availableYears.map((year) => (
                  <ToggleButton key={year} active={storyWall.selectedYears.includes(year)} onClick={() => toggleYear(year)}>
                    {year.toLocaleString(undefined, { useGrouping: false })}
                  </ToggleButton>
                )) : (
                  <p className="text-sm text-[var(--theme-text-secondary)]">No dated memories yet.</p>
                )}
              </div>
            </div>

            <div className="theme-surface theme-border rounded-lg border p-4">
              <h2 className="text-base font-semibold text-[var(--theme-text-primary)]">Sources</h2>
              <div className="mt-3 flex flex-wrap gap-2">
                {PLATFORM_OPTIONS.map((provider) => (
                  <ToggleButton
                    key={provider}
                    active={storyWall.includedPlatforms.includes(provider)}
                    onClick={() => togglePlatform(provider)}
                  >
                    {PLATFORM_LABELS[provider]}
                  </ToggleButton>
                ))}
              </div>
              <div className="mt-4 space-y-2 text-sm text-[var(--theme-text-secondary)]">
                {archiveSummaries.map((summary) => (
                  <div key={summary.provider} className="flex items-center justify-between gap-3">
                    <span>{PLATFORM_LABELS[summary.provider]} vault</span>
                    <span>{formatCount(summary.fileCount)} files</span>
                  </div>
                ))}
              </div>
            </div>

            <div className="theme-surface theme-border rounded-lg border p-4">
              <h2 className="text-base font-semibold text-[var(--theme-text-primary)]">Style</h2>
              <label className="mt-3 block text-xs font-medium uppercase tracking-wide text-[var(--theme-text-muted)]">
                Layout
              </label>
              <select
                className="mt-1 w-full rounded-md border border-[var(--theme-border-subtle)] bg-[var(--theme-bg-primary)] px-3 py-2 text-sm text-[var(--theme-text-primary)]"
                value={storyWall.layoutPreset}
                onChange={(event) => persistStoryWall({ layoutPreset: event.currentTarget.value as StoryWallLayoutPreset })}
              >
                {LAYOUT_OPTIONS.map((option) => (
                  <option key={option.id} value={option.id}>{option.label}</option>
                ))}
              </select>
              <label className="mt-3 block text-xs font-medium uppercase tracking-wide text-[var(--theme-text-muted)]">
                Palette
              </label>
              <select
                className="mt-1 w-full rounded-md border border-[var(--theme-border-subtle)] bg-[var(--theme-bg-primary)] px-3 py-2 text-sm text-[var(--theme-text-primary)]"
                value={storyWall.style.palette}
                onChange={(event) => persistStoryWall({ style: { palette: event.currentTarget.value } })}
              >
                {PALETTE_OPTIONS.map((palette) => (
                  <option key={palette} value={palette}>{palette}</option>
                ))}
              </select>
              <label className="mt-3 flex items-center gap-2 text-sm text-[var(--theme-text-secondary)]">
                <input
                  type="checkbox"
                  checked={storyWall.style.captionsEnabled}
                  onChange={(event) => persistStoryWall({ style: { captionsEnabled: event.currentTarget.checked } })}
                />
                Show captions
              </label>
              <label className="mt-2 flex items-center gap-2 text-sm text-[var(--theme-text-secondary)]">
                <input
                  type="checkbox"
                  checked={storyWall.embedModeEnabled}
                  onChange={(event) => persistStoryWall({ embedModeEnabled: event.currentTarget.checked })}
                />
                Generate embed script
              </label>
            </div>
          </aside>

          <main className="space-y-4">
            <div className="theme-surface theme-border rounded-lg border p-4">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                <div>
                  <h2 className="text-base font-semibold text-[var(--theme-text-primary)]">Preview</h2>
                  <p className="mt-1 text-sm text-[var(--theme-text-secondary)]">
                    Feature memories before publishing, or hide anything that should stay private.
                  </p>
                </div>
                <div className="text-sm text-[var(--theme-text-muted)]">
                  {formatCount(storyWall.hiddenItemIds.length)} hidden
                </div>
              </div>
              <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                {selectedItems.slice(0, 24).map((item) => (
                  <div key={item.globalId} className="space-y-2">
                    <PreviewTile
                      title={item.content.text || item.author.displayName || PLATFORM_LABELS[item.platform]}
                      subtitle={`${PLATFORM_LABELS[item.platform]} ${new Date(item.publishedAt || item.capturedAt).getFullYear().toLocaleString(undefined, { useGrouping: false })}`}
                      mediaUrl={item.content.mediaUrls[0]}
                      featured={featuredIds.has(item.globalId)}
                    />
                    <div className="flex gap-2">
                      <button
                        type="button"
                        className="btn-secondary flex-1 rounded-md px-2 py-1.5 text-xs"
                        onClick={() => toggleFeatured(item.globalId)}
                      >
                        {featuredIds.has(item.globalId) ? "Unfeature" : "Feature"}
                      </button>
                      <button
                        type="button"
                        className="btn-secondary flex-1 rounded-md px-2 py-1.5 text-xs"
                        onClick={() => hideItem(item.globalId)}
                      >
                        Hide
                      </button>
                    </div>
                  </div>
                ))}
              </div>
              {selectedItems.length === 0 ? (
                <div className="mt-4 rounded-lg border border-dashed border-[var(--theme-border-subtle)] p-8 text-center text-sm text-[var(--theme-text-secondary)]">
                  Choose a source or import an archive to start a wall.
                </div>
              ) : null}
            </div>

            <div className="theme-surface theme-border rounded-lg border p-4">
              <div className="flex flex-col gap-4 lg:flex-row lg:items-end">
                <div className="grid flex-1 gap-3 sm:grid-cols-3">
                  <label className="block">
                    <span className="text-xs font-medium uppercase tracking-wide text-[var(--theme-text-muted)]">Repo</span>
                    <input
                      className="mt-1 w-full rounded-md border border-[var(--theme-border-subtle)] bg-[var(--theme-bg-primary)] px-3 py-2 text-sm text-[var(--theme-text-primary)]"
                      value={storyWall.publishTarget.repoName}
                      onChange={(event) => persistStoryWall({ publishTarget: { repoName: event.currentTarget.value } })}
                    />
                  </label>
                  <label className="block">
                    <span className="text-xs font-medium uppercase tracking-wide text-[var(--theme-text-muted)]">Branch</span>
                    <input
                      className="mt-1 w-full rounded-md border border-[var(--theme-border-subtle)] bg-[var(--theme-bg-primary)] px-3 py-2 text-sm text-[var(--theme-text-primary)]"
                      value={storyWall.publishTarget.branch}
                      onChange={(event) => persistStoryWall({ publishTarget: { branch: event.currentTarget.value } })}
                    />
                  </label>
                  <label className="block">
                    <span className="text-xs font-medium uppercase tracking-wide text-[var(--theme-text-muted)]">Folder</span>
                    <input
                      className="mt-1 w-full rounded-md border border-[var(--theme-border-subtle)] bg-[var(--theme-bg-primary)] px-3 py-2 text-sm text-[var(--theme-text-primary)]"
                      value={storyWall.publishTarget.directory}
                      onChange={(event) => persistStoryWall({ publishTarget: { directory: event.currentTarget.value } })}
                    />
                  </label>
                </div>
                <button
                  type="button"
                  className="btn-primary rounded-lg px-4 py-2 text-sm"
                  onClick={() => void handlePublish()}
                  disabled={publishBusy}
                >
                  {publishBusy ? "Publishing" : "Publish now"}
                </button>
              </div>
              <label className="mt-4 block">
                <span className="text-xs font-medium uppercase tracking-wide text-[var(--theme-text-muted)]">
                  GitHub token {hasSavedToken ? "saved" : ""}
                </span>
                <input
                  type="password"
                  className="mt-1 w-full rounded-md border border-[var(--theme-border-subtle)] bg-[var(--theme-bg-primary)] px-3 py-2 text-sm text-[var(--theme-text-primary)]"
                  placeholder={hasSavedToken ? "Use saved token" : "Paste a fine grained token for this repo"}
                  value={githubToken}
                  onChange={(event) => setGithubToken(event.currentTarget.value)}
                />
              </label>
              <div className="mt-4 rounded-lg bg-[rgb(var(--theme-feedback-warning-rgb)/0.12)] p-3 text-sm text-[var(--theme-text-secondary)]">
                Privacy review: the published site is public unless you protect the destination repo or host. Review hidden items, captions, locations, and account filters before publishing.
              </div>
              {publishMessage ? (
                <p className="mt-3 text-sm text-[var(--theme-text-secondary)]">{publishMessage}</p>
              ) : null}
              {storyWall.publishTarget.pagesUrl ? (
                <p className="mt-3 text-sm text-[var(--theme-text-secondary)]">
                  Latest site: {storyWall.publishTarget.pagesUrl}
                </p>
              ) : null}
            </div>
          </main>
        </section>
      </div>
    </div>
  );
}
