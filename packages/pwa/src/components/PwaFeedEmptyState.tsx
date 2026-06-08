import { useAppStore } from "../lib/store";
import { useDebugStore } from "@freed/ui/lib/debug-store";
import { SampleDataTestingSection } from "@freed/ui/components/SampleDataTestingSection";

const openSyncSettings = () =>
  window.dispatchEvent(new CustomEvent("freed:open-settings", { detail: { scrollTo: "sync" } }));

function isMergeBlocked(message?: string): boolean {
  return message?.includes("blocked a sync merge") ?? false;
}

function SyncSpinner() {
  return (
    <div
      aria-label="Syncing"
      className="mb-4 h-10 w-10 animate-spin rounded-full border-2 border-[rgb(var(--theme-accent-secondary-rgb)/0.24)] border-t-[var(--theme-accent-secondary)]"
    />
  );
}

export function PwaFeedEmptyState() {
  const syncConnected = useAppStore((s) => s.syncConnected);
  const isSyncing = useAppStore((s) => s.isSyncing);
  const activeFilter = useAppStore((s) => s.activeFilter);
  const feeds = useAppStore((s) => s.feeds);
  const cloudProviders = useDebugStore((s) => s.cloudProviders);
  const cloudState = cloudProviders?.gdrive ?? cloudProviders?.dropbox ?? null;
  const cloudError = cloudState?.error;
  const syncBlocked = syncConnected && isMergeBlocked(cloudError);
  const cloudStage = cloudState?.stage;
  const cloudTransferRunning =
    syncConnected &&
    !syncBlocked &&
    (isSyncing ||
      cloudState?.status === "connecting" ||
      cloudStage === "auth" ||
      cloudStage === "download" ||
      cloudStage === "merge" ||
      cloudStage === "upload");

  // Per-feed view: a specific feed is selected but has no items yet.
  // `lastFetched` is absent until Freed Desktop polls the feed.
  const activeFeed = activeFilter.feedUrl ? feeds[activeFilter.feedUrl] : null;
  const isPendingSync = activeFeed != null && !activeFeed.lastFetched;

  if (isPendingSync) {
    // Display hostname when the title is still the raw URL sentinel
    const displayName =
      activeFeed.title === activeFeed.url
        ? new URL(activeFeed.url).hostname
        : activeFeed.title;

    return (
      <>
        <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full border border-[var(--theme-border-subtle)] bg-[radial-gradient(circle_at_top,var(--theme-bg-card-hover),transparent_72%),linear-gradient(135deg,rgb(var(--theme-accent-primary-rgb)/0.16),rgb(var(--theme-accent-secondary-rgb)/0.14))]">
          <span className="text-2xl">📡</span>
        </div>
        <p className="text-lg font-medium mb-2">Waiting for Freed Desktop</p>
        <p className="max-w-xs text-sm leading-relaxed text-[var(--theme-text-muted)]">
          Items from{" "}
          <span className="font-medium text-[var(--theme-text-primary)]">{displayName}</span> will
          appear here after Freed Desktop syncs and fetches the feed.
        </p>
        {!syncConnected && (
          <>
            <p className="mt-3 max-w-xs text-xs text-[var(--theme-text-soft)]">
              Open Freed Desktop and make sure it's connected to start receiving content.
            </p>
            <button
              onClick={openSyncSettings}
              className="theme-accent-button mt-4 flex items-center gap-2 rounded-xl px-5 py-2.5 text-sm font-medium transition-colors"
            >
              <svg
                className="w-4 h-4"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1"
                />
              </svg>
              Connect Freed Desktop
            </button>
          </>
        )}
        <SampleDataTestingSection />
      </>
    );
  }

  return (
    <>
      {cloudTransferRunning && <SyncSpinner />}
      <p className="text-lg font-medium mb-2">
        {syncBlocked ? "Sync is blocked" : syncConnected ? "Waiting for content..." : "No content yet"}
      </p>
      <p className="max-w-xs text-sm text-[var(--theme-text-muted)]">
        {syncBlocked
          ? "Open Sync settings to choose how to recover your Google Drive library."
          : syncConnected
          ? "Freed Desktop is connected. New feed content will appear here once fetched."
          : "Connect to Freed Desktop to sync your feeds."}
      </p>
      {(syncBlocked || !syncConnected) && (
      <button
        onClick={openSyncSettings}
        className="theme-accent-button mt-4 flex items-center gap-2 rounded-xl px-5 py-2.5 text-sm font-medium transition-colors"
      >
        <svg
          className="w-4 h-4"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1"
          />
        </svg>
        {syncBlocked ? "Open Sync settings" : "Connect"}
      </button>
      )}
      <SampleDataTestingSection />
    </>
  );
}
