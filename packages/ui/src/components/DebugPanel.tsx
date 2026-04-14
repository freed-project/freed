/**
 * DebugPanel - in-app sync diagnostics overlay
 *
 * Three tabs: Connection, Events, Document.
 * Opened via Cmd/Ctrl+Shift+D, 5-tap on the sync indicator, or Settings → Developer.
 *
 * Responsive rendering:
 *   Mobile  (< sm): overlay bottom-sheet - AppShell renders this conditionally
 *   Desktop (sm+):  right-edge push drawer - AppShell renders this always (width-animates open/closed)
 */

import { useEffect, useState, type ReactNode } from "react";
import { useDebugStore, type SyncEvent, type SyncEventKind, type CloudSyncStatus, type FpsSnapshot, type HealthProviderId, type RssFeedHealthSnapshot } from "../lib/debug-store";
import { useFpsMonitor } from "../lib/perf-monitor";
import { useAppStore, usePlatform } from "../context/PlatformContext.js";
import {
  ProviderHealthSummary,
  VolumeBars,
  DurationSelect,
  formatHealthRelative,
  type HealthChartRange,
} from "./ProviderHealthSummary.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatTs(ts: number): string {
  const d = new Date(ts);
  return d.toLocaleTimeString([], { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function formatRelative(ts: number): string {
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 5) return "just now";
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  return `${Math.floor(s / 3600)}h ago`;
}

// Colour coding by event kind
const KIND_STYLES: Record<SyncEventKind, { badge: string; dot: string; label: string }> = {
  connected:          { badge: "theme-status-pill-success", dot: "bg-[rgb(var(--theme-feedback-success-rgb))]", label: "connected" },
  disconnected:       { badge: "theme-status-pill-danger", dot: "bg-[rgb(var(--theme-feedback-danger-rgb))]", label: "disconnected" },
  reconnecting:       { badge: "theme-status-pill-warning", dot: "bg-[rgb(var(--theme-feedback-warning-rgb))]", label: "reconnecting" },
  sent:               { badge: "theme-status-pill-info", dot: "bg-[rgb(var(--theme-feedback-info-rgb))]", label: "sent" },
  received:           { badge: "theme-status-pill-info", dot: "bg-[rgb(var(--theme-feedback-info-rgb))]", label: "received" },
  merge_ok:           { badge: "theme-status-pill-success", dot: "bg-[rgb(var(--theme-feedback-success-rgb))]", label: "merge ok" },
  merge_err:          { badge: "theme-status-pill-danger", dot: "bg-[rgb(var(--theme-feedback-danger-rgb))]", label: "merge err" },
  init:               { badge: "theme-status-pill-info", dot: "bg-[rgb(var(--theme-feedback-info-rgb))]", label: "init" },
  change:             { badge: "border-[var(--theme-border-subtle)] bg-[var(--theme-bg-card-hover)] text-[var(--theme-text-muted)]",    dot: "bg-[var(--theme-text-soft)]",    label: "change" },
  error:              { badge: "theme-status-pill-danger", dot: "bg-[rgb(var(--theme-feedback-danger-rgb))]", label: "error" },
  mixed_content_warn: { badge: "theme-status-pill-warning", dot: "bg-[rgb(var(--theme-feedback-warning-rgb))]", label: "mixed content" },
  camera_started:     { badge: "border-[var(--theme-border-subtle)] bg-[var(--theme-bg-card-hover)] text-[var(--theme-text-muted)]",   dot: "bg-[var(--theme-text-soft)]",    label: "camera" },
  camera_denied:      { badge: "theme-status-pill-danger", dot: "bg-[rgb(var(--theme-feedback-danger-rgb))]", label: "cam denied" },
  qr_decoded:         { badge: "theme-status-pill-info", dot: "bg-[rgb(var(--theme-feedback-info-rgb))]", label: "qr decoded" },
  connect_attempt:    { badge: "theme-status-pill-info", dot: "bg-[rgb(var(--theme-feedback-info-rgb))]", label: "connecting" },
  connect_timeout:    { badge: "theme-status-pill-danger", dot: "bg-[rgb(var(--theme-feedback-danger-rgb))]", label: "timeout" },
};

const EMPTY_PROVIDER_SYNC_COUNTS: Partial<Record<HealthProviderId, number>> = {};
const DEBUG_CARD_CLASS = "theme-card-soft rounded-xl p-3";
const DEBUG_LABEL_CLASS = "mb-1 text-[10px] uppercase tracking-wider text-[var(--theme-text-soft)]";
const DEBUG_BUTTON_CLASS = "btn-secondary px-2.5 py-1 text-xs";

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function EventRow({ event }: { event: SyncEvent }) {
  const style = KIND_STYLES[event.kind];
  return (
    <div className="flex items-start gap-2.5 border-b border-[var(--theme-border-subtle)] py-2 last:border-0">
      <span className="mt-0.5 shrink-0 font-mono text-[10px] tabular-nums text-[var(--theme-text-soft)]">
        {formatTs(event.ts)}
      </span>
      <span className={`shrink-0 mt-0.5 text-[10px] px-1.5 py-0.5 rounded border font-mono ${style.badge}`}>
        {style.label}
      </span>
      <div className="flex-1 min-w-0">
        {event.detail && (
          <p className="truncate font-mono text-xs text-[var(--theme-text-muted)]">{event.detail}</p>
        )}
        {event.bytes !== undefined && (
          <p className="font-mono text-[10px] text-[var(--theme-text-soft)]">{formatBytes(event.bytes)}</p>
        )}
      </div>
    </div>
  );
}

// ─── Cloud sync status helpers ────────────────────────────────────────────────

const CLOUD_STATUS_STYLES: Record<
  CloudSyncStatus,
  { dot: string; label: string; labelColor: string }
> = {
  idle:       { dot: "bg-[var(--theme-text-soft)]",  label: "Not connected", labelColor: "text-[var(--theme-text-muted)]" },
  connecting: { dot: "bg-[rgb(var(--theme-feedback-warning-rgb))] animate-pulse", label: "Connecting…", labelColor: "theme-feedback-text-warning" },
  connected:  { dot: "bg-[rgb(var(--theme-feedback-success-rgb))]", label: "Connected", labelColor: "theme-feedback-text-success" },
  error:      { dot: "bg-[rgb(var(--theme-feedback-danger-rgb))]", label: "Error", labelColor: "theme-feedback-text-danger" },
};

function CloudProviderRow({
  name,
  icon,
  status,
  error,
}: {
  name: string;
  icon: ReactNode;
  status: CloudSyncStatus;
  error?: string;
}) {
  const s = CLOUD_STATUS_STYLES[status];
  return (
    <div className={DEBUG_CARD_CLASS}>
      <div className="flex items-center gap-2 mb-1">
        <span className="shrink-0 opacity-70">{icon}</span>
        <p className={DEBUG_LABEL_CLASS}>{name}</p>
      </div>
      <div className="flex items-center gap-1.5">
        <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${s.dot}`} />
        <span className={`text-xs font-medium ${s.labelColor}`}>{s.label}</span>
      </div>
      {error && (
        <p className="theme-feedback-text-danger mt-1 break-all font-mono text-[10px] leading-snug">{error}</p>
      )}
    </div>
  );
}

// Minimal inline SVG icons for Dropbox and Google Drive
const DropboxIcon = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" className="theme-icon-media">
    <path d="M6 2L0 6l6 4 6-4zm12 0l-6 4 6 4 6-4zM0 14l6 4 6-4-6-4zm18-4l-6 4 6 4 6-4zM6 19.5L12 23l6-3.5-6-4z"/>
  </svg>
);

const GDriveIcon = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" className="theme-icon-media">
    <path d="M4.5 20L9 12 0 12z" />
    <path d="M19.5 20L15 12l9 0z" opacity="0.64" />
    <path d="M9 12L4.5 20h15L15 12z" opacity="0.8" />
    <path d="M12 2L9 12h6z" opacity="0.92" />
  </svg>
);

function ConnectionTab() {
  const events = useDebugStore((s) => s.events);
  const docSnapshot = useDebugStore((s) => s.docSnapshot);
  const cloudProviders = useDebugStore((s) => s.cloudProviders);
  const [, setTick] = useState(0);

  // Re-render every second so relative timestamps stay fresh
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, []);

  const lastConnected = events.find((e) => e.kind === "connected");
  const lastDisconnected = events.find((e) => e.kind === "disconnected");
  const lastSent = events.find((e) => e.kind === "sent");
  const lastReceived = events.find((e) => e.kind === "received");
  const reconnects = events.filter((e) => e.kind === "reconnecting").length;
  const connectAttempt = events.find((e) => e.kind === "connect_attempt");
  const isConnected = lastConnected && (!lastDisconnected || lastConnected.ts > lastDisconnected.ts);

  const proto = typeof window !== "undefined" ? window.location.protocol : "";
  const relayUrl = connectAttempt?.detail ?? "-";
  const isWsPlain = relayUrl.startsWith("ws://");
  const mixedContentRisk = proto === "https:" && isWsPlain;

  return (
    <div className="space-y-5">

      {/* ── Cloud Sync ─────────────────────────────────────────────────────── */}
      <div>
        <p className="mb-2 px-0.5 text-[10px] uppercase tracking-widest text-[var(--theme-text-soft)]">
          Cloud Sync
        </p>
        <div className="grid grid-cols-2 gap-2">
          <CloudProviderRow
            name="Dropbox"
            icon={<DropboxIcon />}
            status={cloudProviders?.dropbox.status ?? "idle"}
            error={cloudProviders?.dropbox.error}
          />
          <CloudProviderRow
            name="Google Drive"
            icon={<GDriveIcon />}
            status={cloudProviders?.gdrive.status ?? "idle"}
            error={cloudProviders?.gdrive.error}
          />
        </div>
      </div>

      {/* ── Local Sync ─────────────────────────────────────────────────────── */}
      <div>
        <p className="mb-2 px-0.5 text-[10px] uppercase tracking-widest text-[var(--theme-text-soft)]">
          Local Sync
        </p>

        <div className="space-y-2">
          {/* Mixed content warning */}
          {mixedContentRisk && (
            <div className="theme-feedback-panel-warning rounded-xl p-3">
              <p className="theme-feedback-text-warning mb-1 text-xs font-semibold">HTTPS → ws:// Mixed Content</p>
              <p className="theme-feedback-text-warning-muted text-xs">
                This page is served over HTTPS. Safari and Chrome block plain{" "}
                <code className="font-mono">ws://</code> connections from HTTPS pages - this is
                almost certainly why sync fails on iPhone. The desktop relay works, but the
                browser kills the socket silently.
              </p>
            </div>
          )}

          {/* Status grid */}
          <div className="grid grid-cols-2 gap-2">
            <div className={DEBUG_CARD_CLASS}>
              <p className={DEBUG_LABEL_CLASS}>Status</p>
              <div className="flex items-center gap-2">
                <span className={`h-2 w-2 shrink-0 rounded-full ${isConnected ? "bg-[rgb(var(--theme-feedback-success-rgb))]" : "bg-[var(--theme-text-soft)]"}`} />
                <span className={`text-sm font-medium ${isConnected ? "theme-feedback-text-success" : "text-[var(--theme-text-muted)]"}`}>
                  {isConnected ? "Connected" : "Offline"}
                </span>
              </div>
            </div>

            <div className={DEBUG_CARD_CLASS}>
              <p className={DEBUG_LABEL_CLASS}>Reconnects</p>
              <p className="font-mono text-sm font-medium text-[var(--theme-text-muted)]">{reconnects.toLocaleString()}</p>
            </div>

            <div className={DEBUG_CARD_CLASS}>
              <p className={DEBUG_LABEL_CLASS}>Page Protocol</p>
              <p className={`font-mono text-sm font-medium ${proto === "https:" ? "theme-feedback-text-warning" : "theme-feedback-text-success"}`}>
                {proto || "-"}
              </p>
            </div>

            <div className={DEBUG_CARD_CLASS}>
              <p className={DEBUG_LABEL_CLASS}>Doc Size</p>
              <p className="font-mono text-sm font-medium text-[var(--theme-text-muted)]">
                {docSnapshot ? formatBytes(docSnapshot.binarySize) : "-"}
              </p>
            </div>
          </div>

          {/* Relay URL */}
          <div className={DEBUG_CARD_CLASS}>
            <p className={DEBUG_LABEL_CLASS}>Relay URL</p>
            <p className="break-all font-mono text-xs text-[var(--theme-text-muted)]">{relayUrl}</p>
          </div>

          {/* Transfer stats */}
          <div className="grid grid-cols-2 gap-2">
            <div className={DEBUG_CARD_CLASS}>
              <p className={DEBUG_LABEL_CLASS}>Last Sent</p>
              <p className="theme-feedback-text-info font-mono text-xs">{lastSent ? formatBytes(lastSent.bytes ?? 0) : "-"}</p>
              {lastSent && <p className="mt-0.5 font-mono text-[10px] text-[var(--theme-text-soft)]">{formatRelative(lastSent.ts)}</p>}
            </div>
            <div className={DEBUG_CARD_CLASS}>
              <p className={DEBUG_LABEL_CLASS}>Last Received</p>
              <p className="theme-feedback-text-info font-mono text-xs">{lastReceived ? formatBytes(lastReceived.bytes ?? 0) : "-"}</p>
              {lastReceived && <p className="mt-0.5 font-mono text-[10px] text-[var(--theme-text-soft)]">{formatRelative(lastReceived.ts)}</p>}
            </div>
          </div>
        </div>
      </div>

    </div>
  );
}

function EventsTab() {
  const events = useDebugStore((s) => s.events);
  const clearEvents = useDebugStore((s) => s.clearEvents);

  const copyAll = async () => {
    const text = events
      .map((e) => `[${formatTs(e.ts)}] ${e.kind}${e.detail ? ` - ${e.detail}` : ""}${e.bytes !== undefined ? ` (${formatBytes(e.bytes)})` : ""}`)
      .join("\n");
    await navigator.clipboard.writeText(text);
  };

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between mb-3 shrink-0">
        <p className="text-xs text-[var(--theme-text-soft)]">{events.length.toLocaleString()} events (last 200)</p>
        <div className="flex gap-2">
          <button
            onClick={copyAll}
            className={DEBUG_BUTTON_CLASS}
          >
            Copy All
          </button>
          <button
            onClick={clearEvents}
            className="theme-feedback-button-danger px-2.5 py-1 text-xs"
          >
            Clear
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto min-h-0">
        {events.length === 0 ? (
          <p className="py-8 text-center text-xs text-[var(--theme-text-soft)]">No events yet. Try connecting.</p>
        ) : (
          events.map((e) => <EventRow key={e.id} event={e} />)
        )}
      </div>
    </div>
  );
}

function DocumentTab() {
  const docSnapshot = useDebugStore((s) => s.docSnapshot);
  const [copied, setCopied] = useState(false);

  const copyJson = async () => {
    const json = window.__freed?.getDocJson?.();
    if (!json) return;
    await navigator.clipboard.writeText(json);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const downloadBinary = () => {
    const binary = window.__freed?.getDocBinary?.();
    if (!binary) return;
    // Ensure we have a plain ArrayBuffer to satisfy Blob's type constraint
    const blob = new Blob([binary.buffer instanceof ArrayBuffer ? binary.buffer : new Uint8Array(binary).buffer], { type: "application/octet-stream" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `freed-doc-${Date.now()}.automerge`;
    a.click();
    URL.revokeObjectURL(url);
  };

  if (!docSnapshot) {
    return (
      <p className="py-8 text-center text-xs text-[var(--theme-text-soft)]">
        Document not yet initialized.
      </p>
    );
  }

  return (
    <div className="space-y-4">
      {/* Summary grid */}
      <div className="grid grid-cols-2 gap-2">
        <div className={DEBUG_CARD_CLASS}>
          <p className={DEBUG_LABEL_CLASS}>Device ID</p>
          <p className="font-mono text-xs text-[var(--theme-text-muted)]">...{docSnapshot.deviceId.slice(-8)}</p>
        </div>
        <div className={DEBUG_CARD_CLASS}>
          <p className={DEBUG_LABEL_CLASS}>Doc Size</p>
          <p className="font-mono text-xs text-[var(--theme-text-muted)]">{formatBytes(docSnapshot.binarySize)}</p>
        </div>
        <div className={DEBUG_CARD_CLASS}>
          <p className={DEBUG_LABEL_CLASS}>Feed Items</p>
          <p className="font-mono text-sm font-semibold text-[var(--theme-text-primary)]">{docSnapshot.itemCount.toLocaleString()}</p>
        </div>
        <div className={DEBUG_CARD_CLASS}>
          <p className={DEBUG_LABEL_CLASS}>RSS Feeds</p>
          <p className="font-mono text-sm font-semibold text-[var(--theme-text-primary)]">{docSnapshot.feedCount.toLocaleString()}</p>
        </div>
      </div>

      <div className={DEBUG_CARD_CLASS}>
        <p className={DEBUG_LABEL_CLASS}>Snapshot Taken</p>
        <p className="font-mono text-xs text-[var(--theme-text-muted)]">{new Date(docSnapshot.savedAt).toLocaleTimeString()}</p>
      </div>

      {/* Actions */}
      <div className="space-y-2">
        <button
          onClick={copyJson}
          className="btn-primary w-full py-2.5 text-sm"
        >
          {copied ? "Copied!" : "Copy Doc as JSON"}
        </button>
        <button
          onClick={downloadBinary}
          className="btn-secondary w-full py-2.5 text-sm"
        >
          Download .automerge Binary
        </button>
      </div>

      <p className="text-center text-[10px] text-[var(--theme-text-soft)]">
        Or run <code className="font-mono">window.__freed.getDocJson()</code> in DevTools
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// PerformanceTab
// ---------------------------------------------------------------------------

/** Inline SVG sparkline: renders frame times as a 120×32 polyline. */
function Sparkline({ frameTimes }: { frameTimes: number[] }) {
  if (frameTimes.length < 2) return null;
  const W = 120;
  const H = 32;
  const max = Math.max(...frameTimes, 33.3); // floor at 30fps frame time
  const pts = frameTimes
    .map((t, i) => {
      const x = (i / (frameTimes.length - 1)) * W;
      const y = H - Math.min((t / max) * H, H);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
  // 32ms budget line (30fps)
  const budgetY = H - Math.min((32 / max) * H, H);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-8" preserveAspectRatio="none">
      <polyline
        points={pts}
        fill="none"
        stroke="rgb(var(--theme-feedback-info-rgb))"
        strokeWidth="1.5"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      <line
        x1="0" y1={budgetY.toFixed(1)}
        x2={W} y2={budgetY.toFixed(1)}
        stroke="rgb(var(--theme-feedback-danger-rgb))"
        strokeWidth="0.75"
        strokeDasharray="3 2"
      />
    </svg>
  );
}

function FpsDisplay({ fps }: { fps: number }) {
  const color =
    fps >= 55
      ? "theme-feedback-text-success"
      : fps >= 30
        ? "theme-feedback-text-warning"
        : "theme-feedback-text-danger";
  return (
    <div className="text-center">
      <p className={`text-4xl font-bold font-mono tabular-nums ${color}`}>
        {fps.toLocaleString()}
      </p>
      <p className="mt-0.5 text-[10px] uppercase tracking-widest text-[var(--theme-text-soft)]">fps</p>
    </div>
  );
}

function StatCell({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className={DEBUG_CARD_CLASS}>
      <p className={DEBUG_LABEL_CLASS}>{label}</p>
      <p className="font-mono text-sm font-semibold tabular-nums text-[var(--theme-text-primary)]">{value}</p>
      {sub && <p className="mt-0.5 font-mono text-[10px] text-[var(--theme-text-soft)]">{sub}</p>}
    </div>
  );
}

function PerformanceTabContent({ snap }: { snap: FpsSnapshot | null }) {
  const resetPerfSnapshot = useDebugStore((s) => s.resetPerfSnapshot);

  if (!snap) {
    return (
      <p className="py-8 text-center text-xs text-[var(--theme-text-soft)]">
        Measuring… one moment.
      </p>
    );
  }

  return (
    <div className="space-y-4">
      {/* Big FPS number */}
      <FpsDisplay fps={snap.fps} />

      {/* Stats grid */}
      <div className="grid grid-cols-2 gap-2">
        <StatCell
          label="Frame Time"
          value={`${snap.frameTimeMs.toFixed(1)} ms`}
          sub="last frame"
        />
        <StatCell
          label="p95 Frame"
          value={`${snap.p95Ms.toFixed(1)} ms`}
          sub="2s window"
        />
        <StatCell
          label="Dropped"
          value={snap.droppedFrames.toLocaleString()}
          sub="> 32 ms each"
        />
        <StatCell
          label="Long Tasks"
          value={snap.longTasks.toLocaleString()}
          sub={snap.worstLongTaskMs > 0 ? `worst ${snap.worstLongTaskMs.toFixed(0)} ms` : "> 50 ms each"}
        />
      </div>

      {/* Sparkline */}
      <div>
        <div className="flex items-center justify-between mb-1">
          <p className="text-[10px] uppercase tracking-wider text-[var(--theme-text-soft)]">
            Frame Times (2s)
          </p>
          <div className="flex items-center gap-2">
            <span className="flex items-center gap-1">
              <span className="inline-block w-3 border-t border-[rgb(var(--theme-feedback-info-rgb))]" />
              <span className="text-[9px] text-[var(--theme-text-soft)]">actual</span>
            </span>
            <span className="flex items-center gap-1">
              <span className="inline-block w-3 border-t border-dashed border-[rgb(var(--theme-feedback-danger-rgb))]" />
              <span className="text-[9px] text-[var(--theme-text-soft)]">32 ms</span>
            </span>
          </div>
        </div>
        <div className="theme-card-soft rounded-xl p-2">
          <Sparkline frameTimes={snap.frameTimes} />
        </div>
      </div>

      {/* Reset button */}
      <button
        onClick={resetPerfSnapshot}
        className="btn-secondary w-full py-2 text-xs"
      >
        Reset Counters
      </button>
    </div>
  );
}

function PerformanceTab() {
  const perfSnapshot = useDebugStore((s) => s.perfSnapshot);
  useFpsMonitor(true);

  return <PerformanceTabContent snap={perfSnapshot} />;
}

function HealthTab() {
  const health = useDebugStore((s) => s.health);
  const removeFeed = useAppStore((s) => s.removeFeed);
  const providerSyncCounts = useAppStore(
    (s) =>
      ((s as unknown as {
        providerSyncCounts?: Partial<Record<HealthProviderId, number>>;
      }).providerSyncCounts ?? EMPTY_PROVIDER_SYNC_COUNTS) as Partial<Record<HealthProviderId, number>>,
  );
  const {
    retryCloudProvider,
    reconnectCloudProvider,
    forgetRssFeedHealth,
    syncRssNow,
    XSettingsContent,
    FacebookSettingsContent,
    InstagramSettingsContent,
    LinkedInSettingsContent,
  } = usePlatform();
  const [feedRangeByUrl, setFeedRangeByUrl] = useState<Record<string, HealthChartRange>>({});
  const [pendingRemoval, setPendingRemoval] = useState<RssFeedHealthSnapshot | null>(null);
  const [includeItems, setIncludeItems] = useState(false);
  const [removingFeed, setRemovingFeed] = useState(false);
  const [pendingProviderAction, setPendingProviderAction] = useState<
    Partial<Record<HealthProviderId, "sync" | "reconnect">>
  >({});

  if (!health) {
    return (
      <p className="py-8 text-center text-xs text-[var(--theme-text-soft)]">
        Health snapshots are loading.
      </p>
    );
  }

  const providerOrder: HealthProviderId[] = [
    "rss",
    "x",
    "facebook",
    "instagram",
    "linkedin",
    "gdrive",
    "dropbox",
  ];
  const providerSettingsContent: Partial<
    Record<HealthProviderId, typeof XSettingsContent>
  > = {
    x: XSettingsContent,
    facebook: FacebookSettingsContent,
    instagram: InstagramSettingsContent,
    linkedin: LinkedInSettingsContent,
  };

  const copySnapshot = async () => {
    await navigator.clipboard.writeText(JSON.stringify(health, null, 2));
  };

  const confirmRemoval = async () => {
    if (!pendingRemoval) return;
    setRemovingFeed(true);
    try {
      await removeFeed(pendingRemoval.feedUrl, { includeItems });
      if (forgetRssFeedHealth) {
        await forgetRssFeedHealth(pendingRemoval.feedUrl);
      }
      setPendingRemoval(null);
      setIncludeItems(false);
    } finally {
      setRemovingFeed(false);
    }
  };

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <p className="text-[10px] uppercase tracking-widest text-[var(--theme-text-soft)]">
          Provider Health
        </p>
        <button
          onClick={copySnapshot}
          className={DEBUG_BUTTON_CLASS}
        >
          Copy Snapshot
        </button>
      </div>

      <div className="space-y-3">
        {providerOrder.map((provider) => {
          const snapshot = health.providers[provider];
          const ProviderSettingsContent = providerSettingsContent[provider];
          const providerSyncing = (providerSyncCounts[provider] ?? 0) > 0;
          const pendingAction = pendingProviderAction[provider];
          const actions =
            provider === "rss" ? (
              syncRssNow ? (
                <button
                  onClick={() => {
                    void syncRssNow();
                  }}
                  disabled={providerSyncing}
                  className={`${DEBUG_BUTTON_CLASS} inline-flex items-center gap-2 disabled:opacity-50`}
                >
                  {providerSyncing ? (
                    <>
                      <span className="w-3 h-3 border border-current border-t-transparent rounded-full animate-spin" />
                      Syncing
                    </>
                  ) : (
                    "Sync Now"
                  )}
                </button>
              ) : null
            ) : (provider === "gdrive" || provider === "dropbox") ? (
              <>
                {retryCloudProvider && (
                  <button
                    onClick={() => {
                      setPendingProviderAction((current) => ({
                        ...current,
                        [provider]: "sync",
                      }));
                      void retryCloudProvider(provider).finally(() => {
                        setPendingProviderAction((current) => {
                          const next = { ...current };
                          delete next[provider];
                          return next;
                        });
                      });
                    }}
                    disabled={pendingAction === "sync"}
                    className={`${DEBUG_BUTTON_CLASS} inline-flex items-center gap-2 disabled:opacity-50`}
                  >
                    {pendingAction === "sync" ? (
                      <>
                        <span className="w-3 h-3 border border-current border-t-transparent rounded-full animate-spin" />
                        Syncing
                      </>
                    ) : (
                      "Sync Now"
                    )}
                  </button>
                )}
                {reconnectCloudProvider && (
                  <button
                    onClick={() => {
                      setPendingProviderAction((current) => ({
                        ...current,
                        [provider]: "reconnect",
                      }));
                      void reconnectCloudProvider(provider).finally(() => {
                        setPendingProviderAction((current) => {
                          const next = { ...current };
                          delete next[provider];
                          return next;
                        });
                      });
                    }}
                    disabled={pendingAction === "reconnect"}
                    className={`${DEBUG_BUTTON_CLASS} inline-flex items-center gap-2 disabled:opacity-50`}
                  >
                    {pendingAction === "reconnect" ? (
                      <>
                        <span className="w-3 h-3 border border-current border-t-transparent rounded-full animate-spin" />
                        Reconnecting
                      </>
                    ) : (
                      "Reconnect"
                    )}
                  </button>
                )}
              </>
            ) : null;

          return (
            <div key={provider} className="space-y-2">
              {ProviderSettingsContent ? (
                <ProviderSettingsContent surface="debug-card" />
              ) : (
                <ProviderHealthSummary
                  snapshot={snapshot}
                  showRecentAttempts
                  actions={actions}
                />
              )}
            </div>
          );
        })}
      </div>

      <div className="space-y-3">
        <p className="text-[10px] uppercase tracking-widest text-[var(--theme-text-soft)]">
          Failing RSS Feeds
        </p>
        {health.failingRssFeeds.length === 0 ? (
          <p className="text-xs text-[var(--theme-text-muted)]">No failing feeds right now.</p>
        ) : (
          health.failingRssFeeds.map((feed) => {
            const selectedRange = feedRangeByUrl[feed.feedUrl] ?? "daily";
            const bars = selectedRange === "hourly" ? feed.hourlyBuckets : feed.dailyBuckets;
            return (
              <div key={feed.feedUrl} className="theme-feedback-panel-warning space-y-3 rounded-xl p-3">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-sm text-[var(--theme-text-primary)]">{feed.feedTitle}</p>
                    <p className="break-all text-xs text-[var(--theme-text-muted)]">{feed.feedUrl}</p>
                    <p className="theme-feedback-text-warning mt-1 text-xs">
                      Failing for {feed.outageSince ? formatHealthRelative(feed.outageSince) : "a while"}
                    </p>
                    {feed.lastError && (
                      <p className="theme-feedback-text-warning-muted mt-1 text-xs">{feed.lastError}</p>
                    )}
                    <p className="mt-1 text-[11px] text-[var(--theme-text-muted)]">
                      Last success {formatHealthRelative(feed.lastSuccessfulAt)}
                    </p>
                  </div>
                  <div className="flex flex-col gap-2">
                    <DurationSelect
                      value={selectedRange}
                      onChange={(nextRange) => {
                        setFeedRangeByUrl((current) => ({
                          ...current,
                          [feed.feedUrl]: nextRange,
                        }));
                      }}
                      ariaLabel={`${feed.feedTitle} duration`}
                    />
                    <button
                      onClick={() => setPendingRemoval(feed)}
                      className="theme-feedback-button-danger px-2.5 py-1 text-xs"
                    >
                      Unsubscribe
                    </button>
                  </div>
                </div>
                <VolumeBars
                  buckets={bars}
                  metric="itemsSeen"
                  title={selectedRange === "hourly" ? "Pulled Per Hour" : "Pulled Per Day"}
                />
              </div>
            );
          })
        )}
      </div>

      {pendingRemoval && (
        <div className="theme-elevated-overlay fixed inset-0 z-[260] flex items-start justify-center overflow-y-auto p-4 sm:items-center">
          <div className="theme-dialog-shell my-auto max-h-[calc(100dvh-2rem)] w-full max-w-sm overflow-y-auto p-5 space-y-4">
            <div>
              <p className="text-sm font-semibold text-[var(--theme-text-primary)]">Unsubscribe failing feed?</p>
              <p className="mt-1 text-xs text-[var(--theme-text-muted)]">{pendingRemoval.feedTitle}</p>
              <p className="mt-1 break-all text-xs text-[var(--theme-text-soft)]">{pendingRemoval.feedUrl}</p>
            </div>
            <label className="flex items-start gap-3 text-sm text-[var(--theme-text-muted)]">
              <input
                type="checkbox"
                checked={includeItems}
                onChange={(event) => setIncludeItems(event.target.checked)}
                className="mt-0.5"
              />
              <span>Also delete articles and reading history for this feed</span>
            </label>
            <div className="flex gap-3">
              <button
                onClick={() => {
                  setPendingRemoval(null);
                  setIncludeItems(false);
                }}
                className="btn-secondary flex-1 py-2 text-sm"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  void confirmRemoval();
                }}
                disabled={removingFeed}
                className="theme-feedback-button-danger flex-1 py-2 text-sm disabled:opacity-50"
              >
                {removingFeed ? "Removing..." : "Unsubscribe"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Shared panel chrome - header + tabs + scrollable content + footer
// ---------------------------------------------------------------------------

type Tab = "connection" | "events" | "document" | "performance" | "health";

const TABS: { id: Tab; label: string }[] = [
  { id: "connection", label: "Connection" },
  { id: "events", label: "Events" },
  { id: "document", label: "Document" },
  { id: "performance", label: "Perf" },
  { id: "health", label: "Health" },
];

function PanelContent({
  tab,
  setTab,
  onClose,
}: {
  tab: Tab;
  setTab: (t: Tab) => void;
  onClose: () => void;
}) {
  return (
    <>
      {/* Header - subtle bg tint creates section rhythm without a hard border line */}
      <div className="theme-dialog-divider flex shrink-0 items-center justify-between px-5 py-4">
        <div className="flex items-center gap-2.5">
          <span className="theme-status-pill-info rounded px-2 py-0.5 font-mono text-xs">
            DEBUG
          </span>
          <h2 className="text-sm font-semibold text-[var(--theme-text-primary)]">Sync Diagnostics</h2>
        </div>
        <button
          onClick={onClose}
          className="rounded-lg p-1.5 text-[var(--theme-text-muted)] transition-colors hover:bg-[var(--theme-bg-card-hover)] hover:text-[var(--theme-text-primary)]"
          aria-label="Close debug panel"
        >
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
            <path d="M1 1l12 12M13 1L1 13" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
        </button>
      </div>

      {/* Tabs - active underline provides visual separation; no additional border needed */}
      <div className="theme-dialog-divider flex shrink-0">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`flex-1 py-2.5 text-xs font-medium transition-colors ${
              tab === t.id
                ? "border-b-2 border-[var(--theme-accent-secondary)] text-[var(--theme-accent-secondary)]"
                : "text-[var(--theme-text-muted)] hover:text-[var(--theme-text-primary)]"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto min-h-0 p-5">
        {tab === "connection" && <ConnectionTab />}
        {tab === "events" && <EventsTab />}
        {tab === "document" && <DocumentTab />}
        {tab === "performance" && <PerformanceTab />}
        {tab === "health" && <HealthTab />}
      </div>

      {/* Footer - subtle bg tint mirrors the header */}
      <div className="theme-dialog-divider shrink-0 px-5 py-3">
        <p className="text-center font-mono text-[10px] text-[var(--theme-text-soft)]">
          Esc to close · Cmd+Shift+D to toggle · window.__freed in DevTools
        </p>
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// Main panel - variant-aware root
// ---------------------------------------------------------------------------

type PanelVariant = "overlay" | "drawer";

export function DebugPanel({ variant = "overlay" }: { variant?: PanelVariant }) {
  const toggle = useDebugStore((s) => s.toggle);
  const [tab, setTab] = useState<Tab>("connection");

  const content = <PanelContent tab={tab} setTab={setTab} onClose={toggle} />;

  if (variant === "drawer") {
    return (
      <div
        data-testid="debug-panel-surface"
        className="theme-floating-panel app-theme-shell flex h-full w-full flex-col overflow-hidden"
      >
        {content}
      </div>
    );
  }

  // Mobile overlay: bottom-sheet anchored to the viewport
  return (
    <div className="theme-elevated-overlay fixed inset-0 z-[200] flex items-end">
      <div
        className="theme-dialog-shell flex w-full flex-col rounded-t-2xl"
        style={{ maxHeight: "85vh" }}
      >
        {content}
      </div>
    </div>
  );
}
