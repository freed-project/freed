import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import {
  buildStoryWallManifest,
  estimateStoryWallPublishSize,
  PLATFORM_LABELS,
  selectableStoryWallYears,
  selectStoryWallItems,
  type FeedItem,
  type Platform,
  type StoryWallLayoutPreset,
  type StoryWallPreferences,
} from "@freed/shared";
import { useAppStore, usePlatform, type StoryWallArchiveSummary } from "../../context/PlatformContext.js";

type StoryWallPreferenceUpdate = Partial<Omit<StoryWallPreferences, "style" | "publishTarget">> & {
  style?: Partial<StoryWallPreferences["style"]>;
  publishTarget?: Partial<StoryWallPreferences["publishTarget"]>;
};

interface StoryWallPaletteDefinition {
  label: string;
  accent: string;
  surface: string;
  media: string;
  tint: string;
}

const PLATFORM_OPTIONS: Platform[] = ["instagram", "facebook", "x", "rss", "saved"];
const LAYOUT_OPTIONS: Array<{ id: StoryWallLayoutPreset; label: string }> = [
  { id: "mosaic", label: "Mosaic" },
  { id: "timeline", label: "Timeline" },
  { id: "magazine", label: "Magazine" },
  { id: "map_year", label: "Map year" },
  { id: "filmstrip", label: "Filmstrip" },
];
const PALETTE_OPTIONS: Record<string, StoryWallPaletteDefinition> = {
  paper: {
    label: "Paper",
    accent: "var(--theme-control-accent)",
    surface: "color-mix(in oklab, var(--theme-bg-surface) 90%, var(--theme-bg-primary) 10%)",
    media: "var(--theme-bg-muted)",
    tint: "rgb(var(--theme-accent-secondary-rgb) / 0.1)",
  },
  midnight: {
    label: "Midnight",
    accent: "var(--theme-accent-secondary)",
    surface: "color-mix(in oklab, var(--theme-bg-elevated) 88%, black 12%)",
    media: "color-mix(in oklab, var(--theme-bg-muted) 78%, black 22%)",
    tint: "rgb(var(--theme-accent-primary-rgb) / 0.14)",
  },
  gallery: {
    label: "Gallery",
    accent: "var(--theme-media-instagram)",
    surface: "color-mix(in oklab, var(--theme-bg-surface) 86%, var(--theme-media-instagram) 14%)",
    media: "color-mix(in oklab, var(--theme-bg-muted) 84%, var(--theme-media-instagram) 16%)",
    tint: "color-mix(in oklab, var(--theme-media-instagram) 18%, transparent)",
  },
  garden: {
    label: "Garden",
    accent: "rgb(var(--theme-feedback-success-rgb))",
    surface: "color-mix(in oklab, var(--theme-bg-surface) 86%, rgb(var(--theme-feedback-success-rgb)) 14%)",
    media: "color-mix(in oklab, var(--theme-bg-muted) 84%, rgb(var(--theme-feedback-success-rgb)) 16%)",
    tint: "rgb(var(--theme-feedback-success-rgb) / 0.14)",
  },
  mono: {
    label: "Mono",
    accent: "var(--theme-text-secondary)",
    surface: "color-mix(in oklab, var(--theme-bg-surface) 92%, var(--theme-text-primary) 8%)",
    media: "color-mix(in oklab, var(--theme-bg-muted) 92%, var(--theme-text-primary) 8%)",
    tint: "color-mix(in oklab, var(--theme-text-primary) 9%, transparent)",
  },
};
const GITHUB_TOKEN_PROVIDER = "github_story_wall";
const INSTAGRAM_EXPORT_URL = "https://accountscenter.instagram.com/info_and_permissions/dyi/";
const PREVIEW_ITEM_LIMIT = 12;

const PANEL_CLASS = "theme-dialog-section rounded-xl p-4";
const CARD_CLASS = "theme-card-soft rounded-xl p-4";
const INPUT_CLASS = "theme-input w-full rounded-lg px-3 py-2 text-sm focus:outline-none";
const SELECT_CLASS = "theme-input theme-select w-full rounded-lg px-3 py-2 text-sm focus:outline-none";

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
      className={`rounded-lg border px-3 py-2 text-sm font-medium transition-colors ${
        active
          ? "border-[color:var(--theme-border-strong)] bg-[rgb(var(--theme-control-accent-rgb)/0.16)] text-[var(--theme-text-primary)]"
          : "border-[color:var(--theme-border-subtle)] bg-[var(--theme-bg-input)] text-[var(--theme-text-secondary)] hover:border-[color:var(--theme-border-strong)] hover:bg-[var(--theme-bg-card-hover)] hover:text-[var(--theme-text-primary)]"
      }`}
    >
      {children}
    </button>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className={CARD_CLASS}>
      <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--theme-text-muted)]">{label}</div>
      <div className="mt-1 text-2xl font-semibold text-[var(--theme-text-primary)]">{value}</div>
    </div>
  );
}

function previewPaletteStyle(paletteId: string): CSSProperties {
  const palette = PALETTE_OPTIONS[paletteId] ?? PALETTE_OPTIONS.paper;
  return {
    background: `linear-gradient(135deg, ${palette.tint}, transparent 54%), ${palette.surface}`,
    borderColor: "color-mix(in oklab, var(--theme-border-subtle) 66%, transparent)",
  };
}

function previewMediaStyle(paletteId: string): CSSProperties {
  const palette = PALETTE_OPTIONS[paletteId] ?? PALETTE_OPTIONS.paper;
  return {
    background: `linear-gradient(135deg, ${palette.tint}, transparent 58%), ${palette.media}`,
  };
}

function previewGridClass(layout: StoryWallLayoutPreset, mediaDensity: number): string {
  const compact = mediaDensity >= 0.78;
  const airy = mediaDensity <= 0.45;
  if (layout === "timeline") return "grid gap-3";
  if (layout === "filmstrip") return "flex gap-3 overflow-x-auto pb-1";
  if (layout === "magazine") {
    return compact
      ? "grid gap-3 sm:grid-cols-2 2xl:grid-cols-4"
      : "grid gap-4 sm:grid-cols-2 xl:grid-cols-3";
  }
  if (layout === "map_year") return "grid gap-3 sm:grid-cols-2 xl:grid-cols-3";
  if (airy) return "grid gap-4 sm:grid-cols-2 xl:grid-cols-3";
  if (compact) return "grid gap-2 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-5";
  return "grid gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4";
}

function previewItemClass(layout: StoryWallLayoutPreset, index: number): string {
  if (layout === "timeline") return "grid gap-3 rounded-xl sm:grid-cols-[minmax(160px,220px)_1fr]";
  if (layout === "filmstrip") return "w-[min(14rem,64vw)] shrink-0";
  if (layout === "magazine" && index === 0) return "sm:col-span-2";
  return "";
}

function mediaAspectClass(layout: StoryWallLayoutPreset): string {
  if (layout === "timeline") return "aspect-[16/9]";
  if (layout === "filmstrip") return "aspect-[4/5]";
  if (layout === "magazine") return "aspect-[16/10]";
  if (layout === "map_year") return "aspect-[4/3]";
  return "aspect-[4/3]";
}

function previewFontScaleStyle(scale: number): CSSProperties {
  return { fontSize: `${Math.min(Math.max(scale, 0.85), 1.25).toFixed(2)}rem` };
}

function PreviewTile({
  item,
  layout,
  palette,
  captionsEnabled,
  featured,
  index,
  typographyScale,
}: {
  item: FeedItem;
  layout: StoryWallLayoutPreset;
  palette: string;
  captionsEnabled: boolean;
  featured: boolean;
  index: number;
  typographyScale: number;
}) {
  const year = new Date(item.publishedAt || item.capturedAt).getFullYear();
  const title = item.content.text || item.author.displayName || PLATFORM_LABELS[item.platform];
  const subtitle = `${PLATFORM_LABELS[item.platform]} ${year.toLocaleString(undefined, { useGrouping: false })}`;
  const mediaUrl = item.content.mediaUrls.find((url) => typeof url === "string" && url.trim().length > 0);

  if (!mediaUrl) return null;

  return (
    <article
      data-testid="story-wall-preview-tile"
      className={`theme-card-soft overflow-hidden rounded-xl transition-colors ${
        featured ? "ring-2 ring-[color:var(--theme-control-accent)]" : ""
      } ${previewItemClass(layout, index)}`}
      style={previewPaletteStyle(palette)}
    >
      <img
        src={mediaUrl}
        alt=""
        className={`${mediaAspectClass(layout)} w-full object-cover`}
        loading="lazy"
        style={previewMediaStyle(palette)}
      />
      <div className="space-y-1 p-2.5" style={previewFontScaleStyle(typographyScale)}>
        {captionsEnabled ? (
          <div className="line-clamp-2 text-[0.92em] font-medium leading-snug text-[var(--theme-text-primary)]">
            {title}
          </div>
        ) : null}
        <div className="text-[0.74em] font-semibold uppercase tracking-[0.08em] text-[var(--theme-text-muted)]">
          {subtitle}
        </div>
      </div>
    </article>
  );
}

function ArchiveInstructionsModal({
  archiveBusy,
  canImport,
  onClose,
  onChooseFile,
  onOpenAccountsCenter,
}: {
  archiveBusy: boolean;
  canImport: boolean;
  onClose: () => void;
  onChooseFile: () => void;
  onOpenAccountsCenter: () => void;
}) {
  return (
    <div className="fixed inset-0 z-[420] flex items-center justify-center bg-black/45 px-4 py-6">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="story-wall-archive-title"
        className="theme-dialog-shell theme-menu-shell w-full max-w-2xl p-5 shadow-2xl shadow-black/40"
        data-testid="story-wall-archive-modal"
      >
        <div className="theme-dialog-divider flex items-start justify-between gap-4 border-b pb-4">
          <div className="space-y-1">
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--theme-control-accent)]">
              Instagram archive
            </p>
            <h2 id="story-wall-archive-title" className="text-xl font-semibold text-[var(--theme-text-primary)]">
              Export your stories first
            </h2>
            <p className="text-sm leading-6 text-[var(--theme-text-secondary)]">
              Instagram does not expose years of archived stories through a normal API. Export your information, then import the ZIP here.
            </p>
          </div>
          <button type="button" className="btn-secondary rounded-lg px-3 py-1.5 text-sm" onClick={onClose}>
            Close
          </button>
        </div>

        <div className="space-y-4 py-4">
          <ol className="space-y-3 text-sm leading-6 text-[var(--theme-text-secondary)]">
            <li className="theme-card-soft rounded-xl px-3 py-2.5">
              <span className="font-semibold text-[var(--theme-text-primary)]">1.</span> Open Instagram Accounts Center and choose <span className="font-medium text-[var(--theme-text-primary)]">Your information and permissions</span>.
            </li>
            <li className="theme-card-soft rounded-xl px-3 py-2.5">
              <span className="font-semibold text-[var(--theme-text-primary)]">2.</span> Choose <span className="font-medium text-[var(--theme-text-primary)]">Download your information</span>, then pick the Instagram profile you want to archive.
            </li>
            <li className="theme-card-soft rounded-xl px-3 py-2.5">
              <span className="font-semibold text-[var(--theme-text-primary)]">3.</span> Select stories, posts, reels, and media. Use the widest date range you want on the wall.
            </li>
            <li className="theme-card-soft rounded-xl px-3 py-2.5">
              <span className="font-semibold text-[var(--theme-text-primary)]">4.</span> Request a ZIP export. When Instagram says it is ready, download the ZIP without extracting it.
            </li>
            <li className="theme-card-soft rounded-xl px-3 py-2.5">
              <span className="font-semibold text-[var(--theme-text-primary)]">5.</span> Come back here and choose that ZIP. Freed stores imported media in your local vault before anything is published.
            </li>
          </ol>
          <div className="rounded-xl bg-[rgb(var(--theme-feedback-warning-rgb)/0.12)] p-3 text-sm leading-6 text-[var(--theme-text-secondary)]">
            Privacy check: importing is local. Publishing later can make media public, depending on the destination repo and host settings.
          </div>
        </div>

        <div className="theme-dialog-divider flex flex-col gap-2 border-t pt-4 sm:flex-row sm:justify-end">
          <button type="button" className="btn-secondary rounded-lg px-4 py-2 text-sm" onClick={onOpenAccountsCenter}>
            Open Accounts Center
          </button>
          <button
            type="button"
            className="btn-primary rounded-lg px-4 py-2 text-sm"
            onClick={onChooseFile}
            disabled={archiveBusy || !canImport}
          >
            {archiveBusy ? "Importing" : "Choose ZIP"}
          </button>
        </div>
      </div>
    </div>
  );
}

type StoryWallViewVariant = "workspace" | "settings";

interface StoryWallViewProps {
  variant?: StoryWallViewVariant;
}

export function StoryWallView({ variant = "workspace" }: StoryWallViewProps = {}) {
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
  const [archiveGuideOpen, setArchiveGuideOpen] = useState(false);
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
  const selectedPalette = PALETTE_OPTIONS[storyWall.style.palette] ? storyWall.style.palette : "paper";
  const isSettings = variant === "settings";

  useEffect(() => {
    let cancelled = false;
    const loadArchiveSummaries = async () => {
      if (!platform.getStoryWallArchiveSummaries) return;
      try {
        const summaries = await platform.getStoryWallArchiveSummaries();
        if (!cancelled) setArchiveSummaries(summaries);
      } catch {
        if (!cancelled) setArchiveSummaries([]);
      }
    };
    void loadArchiveSummaries();
    return () => {
      cancelled = true;
    };
  }, [platform]);

  useEffect(() => {
    let cancelled = false;
    const loadSavedTokenState = async () => {
      if (!platform.secureStorage) return;
      try {
        const token = await platform.secureStorage.getApiKey(GITHUB_TOKEN_PROVIDER);
        if (!cancelled) setHasSavedToken(!!token);
      } catch {
        if (!cancelled) setHasSavedToken(false);
      }
    };
    void loadSavedTokenState();
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

  const openArchivePicker = () => {
    setArchiveGuideOpen(false);
    window.setTimeout(() => archiveInputRef.current?.click(), 0);
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
    <div className={isSettings ? "bg-transparent" : "h-full overflow-auto bg-transparent"}>
      <div className={isSettings ? "flex w-full flex-col gap-5" : "mx-auto flex w-full max-w-7xl flex-col gap-5 px-4 py-5 lg:px-6"}>
        {!isSettings ? (
          <header className="theme-dialog-divider flex flex-col gap-4 border-b pb-5 lg:flex-row lg:items-end lg:justify-between">
            <div className="max-w-3xl space-y-2">
              <div className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--theme-control-accent)]">
                Story Wall
              </div>
              <h1 className="text-3xl font-semibold leading-tight text-[var(--theme-text-primary)]">
                Your year, rebuilt from your own archive
              </h1>
              <p className="text-sm leading-6 text-[var(--theme-text-secondary)]">
                Start with Freed history, import an Instagram archive for older stories, then publish a static memory wall you control. Older Instagram stories require an archive import. Future captured stories can update the wall after you connect and publish.
              </p>
            </div>
          </header>
        ) : null}

        {!storyWall.enabled ? (
          <section className={PANEL_CLASS} data-testid="story-wall-disabled-gate">
            <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_18rem] lg:items-start">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--theme-control-accent)]">
                  Private setup
                </p>
                <h2 className="mt-2 text-xl font-semibold leading-tight text-[var(--theme-text-primary)]">
                  Build a Story Wall from your own media
                </h2>
                <p className="mt-3 max-w-3xl text-sm leading-6 text-[var(--theme-text-secondary)]">
                  Start with photos and videos already in Freed, import older Instagram stories from an archive export, then review the wall before anything is published.
                </p>
                <div className="mt-4 grid gap-3 md:grid-cols-3">
                  <div className="border-t border-[color:var(--theme-border-subtle)] pt-3">
                    <div className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--theme-text-muted)]">Source</div>
                    <p className="mt-1 text-sm text-[var(--theme-text-secondary)]">Real media from Freed history or imported archives.</p>
                  </div>
                  <div className="border-t border-[color:var(--theme-border-subtle)] pt-3">
                    <div className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--theme-text-muted)]">Review</div>
                    <p className="mt-1 text-sm text-[var(--theme-text-secondary)]">Nothing publishes until you enable, preview, and choose a target.</p>
                  </div>
                  <div className="border-t border-[color:var(--theme-border-subtle)] pt-3">
                    <div className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--theme-text-muted)]">History</div>
                    <p className="mt-1 text-sm text-[var(--theme-text-secondary)]">Older Instagram stories need an archive export.</p>
                  </div>
                </div>
                {archiveMessage ? (
                  <p className="mt-3 text-sm text-[var(--theme-text-secondary)]">{archiveMessage}</p>
                ) : null}
              </div>
              <div className="lg:border-l lg:border-[color:var(--theme-border-subtle)] lg:pl-5">
                <div className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--theme-text-muted)]">
                  Start
                </div>
                <div className="mt-3 grid gap-2">
                  <button
                    type="button"
                    className="btn-primary rounded-lg px-4 py-2 text-sm"
                    onClick={() => persistStoryWall({ enabled: true })}
                  >
                    Enable Story Wall
                  </button>
                  <button
                    type="button"
                    className="btn-secondary rounded-lg px-3 py-2 text-sm"
                    onClick={() => setArchiveGuideOpen(true)}
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
                </div>
              </div>
            </div>
          </section>
        ) : (
          <>
            <section className="grid gap-3 md:grid-cols-4">
              <Stat label="Memories selected" value={formatCount(selectedItems.length)} />
              <Stat label="Media in preview" value={formatCount(manifest.totalMedia)} />
              <Stat label="Archive vault" value={formatCount(archiveTotal)} />
              <Stat label="Publish size" value={formatBytes(estimatedSize + archiveBytes)} />
            </section>

            <section className="grid gap-5 xl:grid-cols-[360px_1fr]">
              <aside className="space-y-4">
            <div className={PANEL_CLASS}>
              <h2 className="text-base font-semibold text-[var(--theme-text-primary)]">Start</h2>
              <div className="mt-3 grid gap-2">
                <ToggleButton active={storyWall.enabled} onClick={() => persistStoryWall({ enabled: true })}>
                  Use existing Freed history
                </ToggleButton>
                <button
                  type="button"
                  className="btn-secondary rounded-lg px-3 py-2 text-sm"
                  onClick={() => setArchiveGuideOpen(true)}
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

            <div className={PANEL_CLASS}>
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

            <div className={PANEL_CLASS}>
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
                  <div key={summary.provider} className="theme-card-soft flex items-center justify-between gap-3 rounded-lg px-3 py-2">
                    <span>{PLATFORM_LABELS[summary.provider]} vault</span>
                    <span>{formatCount(summary.fileCount)} files</span>
                  </div>
                ))}
              </div>
            </div>

            <div className={PANEL_CLASS}>
              <h2 className="text-base font-semibold text-[var(--theme-text-primary)]">Style</h2>
              <label className="mt-3 block text-xs font-semibold uppercase tracking-[0.14em] text-[var(--theme-text-muted)]">
                Layout
              </label>
              <select
                data-testid="story-wall-layout-select"
                className={SELECT_CLASS}
                value={storyWall.layoutPreset}
                onChange={(event) => persistStoryWall({ layoutPreset: event.currentTarget.value as StoryWallLayoutPreset })}
              >
                {LAYOUT_OPTIONS.map((option) => (
                  <option key={option.id} value={option.id}>{option.label}</option>
                ))}
              </select>
              <label className="mt-3 block text-xs font-semibold uppercase tracking-[0.14em] text-[var(--theme-text-muted)]">
                Palette
              </label>
              <select
                data-testid="story-wall-palette-select"
                className={SELECT_CLASS}
                value={selectedPalette}
                onChange={(event) => persistStoryWall({ style: { palette: event.currentTarget.value } })}
              >
                {Object.entries(PALETTE_OPTIONS).map(([id, palette]) => (
                  <option key={id} value={id}>{palette.label}</option>
                ))}
              </select>
              <label className="mt-3 block text-xs font-semibold uppercase tracking-[0.14em] text-[var(--theme-text-muted)]">
                Type scale
              </label>
              <input
                data-testid="story-wall-type-scale"
                className="w-full accent-[var(--theme-control-accent)]"
                type="range"
                min="0.85"
                max="1.25"
                step="0.05"
                value={storyWall.style.typographyScale}
                onChange={(event) => persistStoryWall({ style: { typographyScale: Number(event.currentTarget.value) } })}
              />
              <label className="mt-3 block text-xs font-semibold uppercase tracking-[0.14em] text-[var(--theme-text-muted)]">
                Media density
              </label>
              <input
                data-testid="story-wall-density"
                className="w-full accent-[var(--theme-control-accent)]"
                type="range"
                min="0.3"
                max="0.95"
                step="0.05"
                value={storyWall.style.mediaDensity}
                onChange={(event) => persistStoryWall({ style: { mediaDensity: Number(event.currentTarget.value) } })}
              />
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
            <div
              className={PANEL_CLASS}
              data-testid="story-wall-preview"
              data-layout={storyWall.layoutPreset}
              data-palette={selectedPalette}
              data-density={storyWall.style.mediaDensity.toFixed(2)}
              style={previewPaletteStyle(selectedPalette)}
            >
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
              <div className={`mt-4 max-h-[min(52vh,34rem)] overflow-y-auto pr-1 ${previewGridClass(storyWall.layoutPreset, storyWall.style.mediaDensity)}`}>
                {selectedItems.slice(0, PREVIEW_ITEM_LIMIT).map((item, index) => (
                  <div key={item.globalId} className="space-y-2">
                    <PreviewTile
                      item={item}
                      layout={storyWall.layoutPreset}
                      palette={selectedPalette}
                      captionsEnabled={storyWall.style.captionsEnabled}
                      featured={featuredIds.has(item.globalId)}
                      index={index}
                      typographyScale={storyWall.style.typographyScale}
                    />
                    <div className="grid grid-cols-2 gap-2">
                      <button
                        type="button"
                        className="btn-secondary rounded-lg px-2 py-1.5 text-xs"
                        onClick={() => toggleFeatured(item.globalId)}
                      >
                        {featuredIds.has(item.globalId) ? "Unfeature" : "Feature"}
                      </button>
                      <button
                        type="button"
                        className="btn-secondary rounded-lg px-2 py-1.5 text-xs"
                        onClick={() => hideItem(item.globalId)}
                      >
                        Hide
                      </button>
                    </div>
                  </div>
                ))}
              </div>
              {selectedItems.length === 0 ? (
                <div className="theme-card-soft mt-4 rounded-xl border-dashed p-8 text-center text-sm text-[var(--theme-text-secondary)]">
                  No media-backed memories yet. Import an archive or connect a social account with photos or videos.
                </div>
              ) : null}
            </div>

            <div className={PANEL_CLASS}>
              <div className="flex flex-col gap-4 lg:flex-row lg:items-end">
                <div className="grid flex-1 gap-3 sm:grid-cols-3">
                  <label className="block">
                    <span className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--theme-text-muted)]">Repo</span>
                    <input
                      className={INPUT_CLASS}
                      value={storyWall.publishTarget.repoName}
                      onChange={(event) => persistStoryWall({ publishTarget: { repoName: event.currentTarget.value } })}
                    />
                  </label>
                  <label className="block">
                    <span className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--theme-text-muted)]">Branch</span>
                    <input
                      className={INPUT_CLASS}
                      value={storyWall.publishTarget.branch}
                      onChange={(event) => persistStoryWall({ publishTarget: { branch: event.currentTarget.value } })}
                    />
                  </label>
                  <label className="block">
                    <span className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--theme-text-muted)]">Folder</span>
                    <input
                      className={INPUT_CLASS}
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
                <span className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--theme-text-muted)]">
                  GitHub token {hasSavedToken ? "saved" : ""}
                </span>
                <input
                  type="password"
                  className={INPUT_CLASS}
                  placeholder={hasSavedToken ? "Use saved token" : "Paste a fine grained token for this repo"}
                  value={githubToken}
                  onChange={(event) => setGithubToken(event.currentTarget.value)}
                />
              </label>
              <div className="mt-4 rounded-xl bg-[rgb(var(--theme-feedback-warning-rgb)/0.12)] p-3 text-sm text-[var(--theme-text-secondary)]">
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
          </>
        )}
      </div>
      {archiveGuideOpen ? (
        <ArchiveInstructionsModal
          archiveBusy={archiveBusy}
          canImport={Boolean(platform.importInstagramStoryWallArchive)}
          onClose={() => setArchiveGuideOpen(false)}
          onChooseFile={openArchivePicker}
          onOpenAccountsCenter={() => platform.openUrl?.(INSTAGRAM_EXPORT_URL)}
        />
      ) : null}
    </div>
  );
}
