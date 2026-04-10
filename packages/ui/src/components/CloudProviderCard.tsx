/**
 * CloudProviderCard — canonical card for a single cloud sync provider.
 *
 * Single source of truth for provider icons, labels, detail copy, and card
 * layout. Used by both the PWA (SyncConnectDialog) and the desktop
 * (CloudSyncSetupDialog, MobileSyncTab). Do not duplicate this inline anywhere.
 */

// ─── Types ────────────────────────────────────────────────────────────────────

/** Supported cloud sync providers. Mirrors packages/sync/src/cloud/types.ts. */
export type CloudProvider = "gdrive" | "dropbox";

export type ProviderState =
  | { status: "idle" }
  | { status: "connecting" }
  | { status: "connected" }
  | { status: "error"; error: string };

export type CloudProviderStatus = Record<CloudProvider, ProviderState>;

// ─── Provider metadata ────────────────────────────────────────────────────────

const PROVIDER_META: Record<
  CloudProvider,
  { name: string; detail: string; icon: React.ReactNode }
> = {
  dropbox: {
    name: "Dropbox",
    detail: "~1–4 s sync · /Apps/Freed/",
    icon: (
      <svg className="w-6 h-6 flex-shrink-0" viewBox="0 0 24 24" fill="#0061FF">
        <path d="M6 2L0 6l6 4-6 4 6 4 6-4-6-4 6-4L6 2zM18 2l-6 4 6 4-6 4 6 4 6-4-6-4 6-4-6-4zM12 14l-6 4 6 4 6-4-6-4z" />
      </svg>
    ),
  },
  gdrive: {
    name: "Google Drive",
    detail: "~5 s sync · app data folder",
    icon: (
      <svg className="w-6 h-6 flex-shrink-0" viewBox="0 0 87.3 78" fill="none">
        <path d="M6.6 66.85l3.85 6.65c.8 1.4 1.95 2.5 3.3 3.3L27.5 53H0c0 1.55.4 3.1 1.2 4.5z" fill="#0066DA" />
        <path d="M43.65 25L29.9 1.2C28.55 2 27.4 3.1 26.6 4.5L1.2 48.5A9.06 9.06 0 000 53h27.5z" fill="#00AC47" />
        <path d="M73.55 76.8c1.35-.8 2.5-1.9 3.3-3.3l1.6-2.75 7.65-13.25c.8-1.4 1.2-2.95 1.2-4.5H59.8l5.85 11.2z" fill="#EA4335" />
        <path d="M43.65 25L57.4 1.2C56.05.4 54.5 0 52.9 0H34.4c-1.6 0-3.15.45-4.5 1.2z" fill="#00832D" />
        <path d="M59.8 53H27.5L13.75 76.8c1.35.8 2.9 1.2 4.5 1.2h50.8c1.6 0 3.15-.4 4.5-1.2z" fill="#2684FC" />
        <path d="M73.4 26.5l-12.65-21.9c-.8-1.4-1.95-2.5-3.3-3.3L43.65 25 59.8 53h27.45c0-1.55-.4-3.1-1.2-4.5z" fill="#FFBA00" />
      </svg>
    ),
  },
};

// ─── Component ────────────────────────────────────────────────────────────────

interface CloudProviderCardProps {
  provider: CloudProvider;
  state: ProviderState;
  onConnect: (provider: CloudProvider) => void;
  /** If provided, a Disconnect button is shown when connected. */
  onDisconnect?: (provider: CloudProvider) => void;
}

export function CloudProviderCard({
  provider,
  state,
  onConnect,
  onDisconnect,
}: CloudProviderCardProps) {
  const meta = PROVIDER_META[provider];
  const isConnected = state.status === "connected";
  const isConnecting = state.status === "connecting";
  const error = state.status === "error" ? state.error : undefined;

  const isIdle = !isConnected && !isConnecting;

  return (
    <div
      role={isIdle ? "button" : undefined}
      tabIndex={isIdle ? 0 : undefined}
      onClick={isIdle ? () => onConnect(provider) : undefined}
      onKeyDown={isIdle ? (e) => e.key === "Enter" && onConnect(provider) : undefined}
      className={`flex items-center gap-3 p-3 rounded-xl border transition-colors ${
        isConnected
          ? "bg-green-500/5 border-green-500/20"
          : isIdle
            ? "cursor-pointer border-[var(--theme-border-subtle)] bg-[var(--theme-bg-card)] hover:border-[var(--theme-border-strong)] hover:bg-[var(--theme-bg-card-hover)]"
            : "border-[var(--theme-border-subtle)] bg-[var(--theme-bg-card)]"
      }`}
    >
      {meta.icon}

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <p className="text-sm font-medium text-[var(--theme-text-primary)]">{meta.name}</p>
          {isConnected && (
            <span className="inline-flex items-center gap-1 text-xs text-green-400">
              <span className="w-1.5 h-1.5 rounded-full bg-green-400 inline-block" />
              Connected
            </span>
          )}
        </div>
        <p className="mt-0.5 text-xs text-[var(--theme-text-muted)]">{meta.detail}</p>
        {error && <p className="text-xs text-red-400 mt-1">{error}</p>}
      </div>

      {isConnected && onDisconnect ? (
        <button
          onClick={(e) => { e.stopPropagation(); onDisconnect(provider); }}
          className="flex-shrink-0 rounded-lg bg-[var(--theme-bg-muted)] px-2.5 py-1 text-xs text-[var(--theme-text-muted)] transition-colors hover:bg-red-500/10 hover:text-red-400"
        >
          Disconnect
        </button>
      ) : (
        <span
          className={`flex-shrink-0 text-xs px-2.5 py-1 rounded-lg transition-colors ${
            isConnected
              ? "bg-green-500/10 text-green-400 border border-green-500/20"
              : isConnecting
                ? "opacity-50 text-[var(--theme-accent-secondary)]"
                : "theme-accent-tag"
          }`}
        >
          {isConnecting ? "Opening…" : isConnected ? "Connected" : "Connect"}
        </span>
      )}
    </div>
  );
}
