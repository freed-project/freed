/**
 * DebugPanel — in-app sync diagnostics overlay
 *
 * Three tabs: Connection, Events, Document.
 * Opened via Cmd/Ctrl+Shift+D, 5-tap on the sync indicator, or Settings → Developer.
 *
 * Responsive rendering:
 *   Mobile  (< sm): overlay bottom-sheet — AppShell renders this conditionally
 *   Desktop (sm+):  right-edge push drawer — AppShell renders this always (width-animates open/closed)
 */

import { useEffect, useState, type ReactNode } from "react";
import { useDebugStore, type SyncEvent, type SyncEventKind, type CloudSyncStatus, type FpsSnapshot } from "../lib/debug-store";
import { useFpsMonitor } from "../lib/perf-monitor";

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
  connected:          { badge: "bg-green-500/20 text-green-400 border-green-500/30",    dot: "bg-green-400",    label: "connected" },
  disconnected:       { badge: "bg-red-500/20 text-red-400 border-red-500/30",          dot: "bg-red-400",      label: "disconnected" },
  reconnecting:       { badge: "bg-yellow-500/20 text-yellow-400 border-yellow-500/30", dot: "bg-yellow-400",   label: "reconnecting" },
  sent:               { badge: "bg-blue-500/20 text-blue-400 border-blue-500/30",        dot: "bg-blue-400",     label: "sent" },
  received:           { badge: "bg-cyan-500/20 text-cyan-400 border-cyan-500/30",        dot: "bg-cyan-400",     label: "received" },
  merge_ok:           { badge: "bg-green-500/20 text-green-400 border-green-500/30",    dot: "bg-green-400",    label: "merge ok" },
  merge_err:          { badge: "bg-red-500/20 text-red-400 border-red-500/30",          dot: "bg-red-400",      label: "merge err" },
  init:               { badge: "bg-purple-500/20 text-purple-400 border-purple-500/30", dot: "bg-purple-400",   label: "init" },
  change:             { badge: "bg-[#52525b]/40 text-[#a1a1aa] border-[#52525b]/30",    dot: "bg-[#71717a]",    label: "change" },
  error:              { badge: "bg-red-500/20 text-red-400 border-red-500/30",          dot: "bg-red-400",      label: "error" },
  mixed_content_warn: { badge: "bg-orange-500/20 text-orange-400 border-orange-500/30", dot: "bg-orange-400",   label: "mixed content" },
  camera_started:     { badge: "bg-[#52525b]/40 text-[#a1a1aa] border-[#52525b]/30",   dot: "bg-[#71717a]",    label: "camera" },
  camera_denied:      { badge: "bg-red-500/20 text-red-400 border-red-500/30",          dot: "bg-red-400",      label: "cam denied" },
  qr_decoded:         { badge: "bg-purple-500/20 text-purple-400 border-purple-500/30", dot: "bg-purple-400",   label: "qr decoded" },
  connect_attempt:    { badge: "bg-blue-500/20 text-blue-400 border-blue-500/30",        dot: "bg-blue-400",     label: "connecting" },
  connect_timeout:    { badge: "bg-red-500/20 text-red-400 border-red-500/30",          dot: "bg-red-400",      label: "timeout" },
};

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function EventRow({ event }: { event: SyncEvent }) {
  const style = KIND_STYLES[event.kind];
  return (
    <div className="flex items-start gap-2.5 py-2 border-b border-white/5 last:border-0">
      <span className="text-[10px] text-[#52525b] tabular-nums shrink-0 mt-0.5 font-mono">
        {formatTs(event.ts)}
      </span>
      <span className={`shrink-0 mt-0.5 text-[10px] px-1.5 py-0.5 rounded border font-mono ${style.badge}`}>
        {style.label}
      </span>
      <div className="flex-1 min-w-0">
        {event.detail && (
          <p className="text-xs text-[#a1a1aa] truncate font-mono">{event.detail}</p>
        )}
        {event.bytes !== undefined && (
          <p className="text-[10px] text-[#52525b] font-mono">{formatBytes(event.bytes)}</p>
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
  idle:       { dot: "bg-[#52525b]",  label: "Not connected", labelColor: "text-[#71717a]" },
  connecting: { dot: "bg-yellow-400 animate-pulse", label: "Connecting…",    labelColor: "text-yellow-400" },
  connected:  { dot: "bg-green-400",  label: "Connected",     labelColor: "text-green-400" },
  error:      { dot: "bg-red-400",    label: "Error",         labelColor: "text-red-400" },
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
    <div className="bg-white/5 rounded-xl p-3">
      <div className="flex items-center gap-2 mb-1">
        <span className="shrink-0 opacity-70">{icon}</span>
        <p className="text-[10px] text-[#52525b] uppercase tracking-wider">{name}</p>
      </div>
      <div className="flex items-center gap-1.5">
        <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${s.dot}`} />
        <span className={`text-xs font-medium ${s.labelColor}`}>{s.label}</span>
      </div>
      {error && (
        <p className="text-[10px] text-red-400 font-mono mt-1 break-all leading-snug">{error}</p>
      )}
    </div>
  );
}

// Minimal inline SVG icons for Dropbox and Google Drive
const DropboxIcon = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" className="text-[#0061FF]">
    <path d="M6 2L0 6l6 4 6-4zm12 0l-6 4 6 4 6-4zM0 14l6 4 6-4-6-4zm18-4l-6 4 6 4 6-4zM6 19.5L12 23l6-3.5-6-4z"/>
  </svg>
);

const GDriveIcon = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none">
    <path d="M4.5 20L9 12 0 12z" fill="#4285F4"/>
    <path d="M19.5 20L15 12l9 0z" fill="#FBBC04"/>
    <path d="M9 12L4.5 20h15L15 12z" fill="#34A853"/>
    <path d="M12 2L9 12h6z" fill="#EA4335"/>
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
  const relayUrl = connectAttempt?.detail ?? "—";
  const isWsPlain = relayUrl.startsWith("ws://");
  const mixedContentRisk = proto === "https:" && isWsPlain;

  return (
    <div className="space-y-5">

      {/* ── Cloud Sync ─────────────────────────────────────────────────────── */}
      <div>
        <p className="text-[10px] text-[#52525b] uppercase tracking-widest mb-2 px-0.5">
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
        <p className="text-[10px] text-[#52525b] uppercase tracking-widest mb-2 px-0.5">
          Local Sync
        </p>

        <div className="space-y-2">
          {/* Mixed content warning */}
          {mixedContentRisk && (
            <div className="p-3 bg-orange-500/15 border border-orange-500/40 rounded-xl">
              <p className="text-xs font-semibold text-orange-400 mb-1">HTTPS → ws:// Mixed Content</p>
              <p className="text-xs text-orange-300/80">
                This page is served over HTTPS. Safari and Chrome block plain{" "}
                <code className="font-mono">ws://</code> connections from HTTPS pages — this is
                almost certainly why sync fails on iPhone. The desktop relay works, but the
                browser kills the socket silently.
              </p>
            </div>
          )}

          {/* Status grid */}
          <div className="grid grid-cols-2 gap-2">
            <div className="bg-white/5 rounded-xl p-3">
              <p className="text-[10px] text-[#52525b] uppercase tracking-wider mb-1">Status</p>
              <div className="flex items-center gap-2">
                <span className={`w-2 h-2 rounded-full shrink-0 ${isConnected ? "bg-green-400" : "bg-[#52525b]"}`} />
                <span className={`text-sm font-medium ${isConnected ? "text-green-400" : "text-[#71717a]"}`}>
                  {isConnected ? "Connected" : "Offline"}
                </span>
              </div>
            </div>

            <div className="bg-white/5 rounded-xl p-3">
              <p className="text-[10px] text-[#52525b] uppercase tracking-wider mb-1">Reconnects</p>
              <p className="text-sm font-medium text-[#a1a1aa] font-mono">{reconnects}</p>
            </div>

            <div className="bg-white/5 rounded-xl p-3">
              <p className="text-[10px] text-[#52525b] uppercase tracking-wider mb-1">Page Protocol</p>
              <p className={`text-sm font-medium font-mono ${proto === "https:" ? "text-orange-400" : "text-green-400"}`}>
                {proto || "—"}
              </p>
            </div>

            <div className="bg-white/5 rounded-xl p-3">
              <p className="text-[10px] text-[#52525b] uppercase tracking-wider mb-1">Doc Size</p>
              <p className="text-sm font-medium text-[#a1a1aa] font-mono">
                {docSnapshot ? formatBytes(docSnapshot.binarySize) : "—"}
              </p>
            </div>
          </div>

          {/* Relay URL */}
          <div className="bg-white/5 rounded-xl p-3">
            <p className="text-[10px] text-[#52525b] uppercase tracking-wider mb-1">Relay URL</p>
            <p className="text-xs text-[#a1a1aa] font-mono break-all">{relayUrl}</p>
          </div>

          {/* Transfer stats */}
          <div className="grid grid-cols-2 gap-2">
            <div className="bg-white/5 rounded-xl p-3">
              <p className="text-[10px] text-[#52525b] uppercase tracking-wider mb-1">Last Sent</p>
              <p className="text-xs text-blue-400 font-mono">{lastSent ? formatBytes(lastSent.bytes ?? 0) : "—"}</p>
              {lastSent && <p className="text-[10px] text-[#52525b] font-mono mt-0.5">{formatRelative(lastSent.ts)}</p>}
            </div>
            <div className="bg-white/5 rounded-xl p-3">
              <p className="text-[10px] text-[#52525b] uppercase tracking-wider mb-1">Last Received</p>
              <p className="text-xs text-cyan-400 font-mono">{lastReceived ? formatBytes(lastReceived.bytes ?? 0) : "—"}</p>
              {lastReceived && <p className="text-[10px] text-[#52525b] font-mono mt-0.5">{formatRelative(lastReceived.ts)}</p>}
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
      .map((e) => `[${formatTs(e.ts)}] ${e.kind}${e.detail ? ` — ${e.detail}` : ""}${e.bytes !== undefined ? ` (${formatBytes(e.bytes)})` : ""}`)
      .join("\n");
    await navigator.clipboard.writeText(text);
  };

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between mb-3 shrink-0">
        <p className="text-xs text-[#52525b]">{events.length} events (last 200)</p>
        <div className="flex gap-2">
          <button
            onClick={copyAll}
            className="text-xs px-2.5 py-1 rounded-lg bg-white/5 hover:bg-white/10 text-[#71717a] hover:text-white transition-colors"
          >
            Copy All
          </button>
          <button
            onClick={clearEvents}
            className="text-xs px-2.5 py-1 rounded-lg bg-white/5 hover:bg-red-500/20 text-[#71717a] hover:text-red-400 transition-colors"
          >
            Clear
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto min-h-0">
        {events.length === 0 ? (
          <p className="text-xs text-[#52525b] text-center py-8">No events yet. Try connecting.</p>
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
      <p className="text-xs text-[#52525b] text-center py-8">
        Document not yet initialized.
      </p>
    );
  }

  return (
    <div className="space-y-4">
      {/* Summary grid */}
      <div className="grid grid-cols-2 gap-2">
        <div className="bg-white/5 rounded-xl p-3">
          <p className="text-[10px] text-[#52525b] uppercase tracking-wider mb-1">Device ID</p>
          <p className="text-xs text-[#a1a1aa] font-mono">...{docSnapshot.deviceId.slice(-8)}</p>
        </div>
        <div className="bg-white/5 rounded-xl p-3">
          <p className="text-[10px] text-[#52525b] uppercase tracking-wider mb-1">Doc Size</p>
          <p className="text-xs text-[#a1a1aa] font-mono">{formatBytes(docSnapshot.binarySize)}</p>
        </div>
        <div className="bg-white/5 rounded-xl p-3">
          <p className="text-[10px] text-[#52525b] uppercase tracking-wider mb-1">Feed Items</p>
          <p className="text-sm font-semibold text-white font-mono">{docSnapshot.itemCount.toLocaleString()}</p>
        </div>
        <div className="bg-white/5 rounded-xl p-3">
          <p className="text-[10px] text-[#52525b] uppercase tracking-wider mb-1">RSS Feeds</p>
          <p className="text-sm font-semibold text-white font-mono">{docSnapshot.feedCount}</p>
        </div>
      </div>

      <div className="bg-white/5 rounded-xl p-3">
        <p className="text-[10px] text-[#52525b] uppercase tracking-wider mb-1">Snapshot Taken</p>
        <p className="text-xs text-[#a1a1aa] font-mono">{new Date(docSnapshot.savedAt).toLocaleTimeString()}</p>
      </div>

      {/* Actions */}
      <div className="space-y-2">
        <button
          onClick={copyJson}
          className="w-full py-2.5 rounded-xl bg-[#8b5cf6]/20 text-[#8b5cf6] hover:bg-[#8b5cf6]/30 text-sm font-medium transition-colors border border-[#8b5cf6]/20"
        >
          {copied ? "Copied!" : "Copy Doc as JSON"}
        </button>
        <button
          onClick={downloadBinary}
          className="w-full py-2.5 rounded-xl bg-white/5 text-[#a1a1aa] hover:bg-white/10 hover:text-white text-sm font-medium transition-colors"
        >
          Download .automerge Binary
        </button>
      </div>

      <p className="text-[10px] text-[#52525b] text-center">
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
        stroke="#8b5cf6"
        strokeWidth="1.5"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      <line
        x1="0" y1={budgetY.toFixed(1)}
        x2={W} y2={budgetY.toFixed(1)}
        stroke="#ef4444"
        strokeWidth="0.75"
        strokeDasharray="3 2"
      />
    </svg>
  );
}

function FpsDisplay({ fps }: { fps: number }) {
  const color =
    fps >= 55 ? "text-green-400" : fps >= 30 ? "text-yellow-400" : "text-red-400";
  return (
    <div className="text-center">
      <p className={`text-4xl font-bold font-mono tabular-nums ${color}`}>
        {fps.toLocaleString()}
      </p>
      <p className="text-[10px] text-[#52525b] uppercase tracking-widest mt-0.5">fps</p>
    </div>
  );
}

function StatCell({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="bg-white/5 rounded-xl p-3">
      <p className="text-[10px] text-[#52525b] uppercase tracking-wider mb-1">{label}</p>
      <p className="text-sm font-semibold text-white font-mono tabular-nums">{value}</p>
      {sub && <p className="text-[10px] text-[#52525b] font-mono mt-0.5">{sub}</p>}
    </div>
  );
}

function PerformanceTabContent({ snap }: { snap: FpsSnapshot | null }) {
  const resetPerfSnapshot = useDebugStore((s) => s.resetPerfSnapshot);

  if (!snap) {
    return (
      <p className="text-xs text-[#52525b] text-center py-8">
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
          <p className="text-[10px] text-[#52525b] uppercase tracking-wider">
            Frame Times (2s)
          </p>
          <div className="flex items-center gap-2">
            <span className="flex items-center gap-1">
              <span className="inline-block w-3 border-t border-[#8b5cf6]" />
              <span className="text-[9px] text-[#52525b]">actual</span>
            </span>
            <span className="flex items-center gap-1">
              <span className="inline-block w-3 border-t border-dashed border-red-400" />
              <span className="text-[9px] text-[#52525b]">32 ms</span>
            </span>
          </div>
        </div>
        <div className="bg-white/5 rounded-xl p-2">
          <Sparkline frameTimes={snap.frameTimes} />
        </div>
      </div>

      {/* Reset button */}
      <button
        onClick={resetPerfSnapshot}
        className="w-full py-2 rounded-xl bg-white/5 text-[#71717a] hover:bg-white/10 hover:text-white text-xs font-medium transition-colors"
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

// ---------------------------------------------------------------------------
// Shared panel chrome — header + tabs + scrollable content + footer
// ---------------------------------------------------------------------------

type Tab = "connection" | "events" | "document" | "performance";

const TABS: { id: Tab; label: string }[] = [
  { id: "connection", label: "Connection" },
  { id: "events", label: "Events" },
  { id: "document", label: "Document" },
  { id: "performance", label: "Perf" },
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
      {/* Header — subtle bg tint creates section rhythm without a hard border line */}
      <div className="flex items-center justify-between px-5 py-4 bg-white/[0.03] shrink-0">
        <div className="flex items-center gap-2.5">
          <span className="text-xs font-mono px-2 py-0.5 rounded bg-[#8b5cf6]/20 text-[#8b5cf6] border border-[#8b5cf6]/30">
            DEBUG
          </span>
          <h2 className="text-sm font-semibold text-white">Sync Diagnostics</h2>
        </div>
        <button
          onClick={onClose}
          className="p-1.5 rounded-lg hover:bg-white/10 text-[#71717a] hover:text-white transition-colors"
          aria-label="Close debug panel"
        >
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
            <path d="M1 1l12 12M13 1L1 13" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
        </button>
      </div>

      {/* Tabs — active underline provides visual separation; no additional border needed */}
      <div className="flex shrink-0">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`flex-1 py-2.5 text-xs font-medium transition-colors ${
              tab === t.id
                ? "text-[#8b5cf6] border-b-2 border-[#8b5cf6]"
                : "text-[#71717a] hover:text-white"
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
      </div>

      {/* Footer — subtle bg tint mirrors the header */}
      <div className="px-5 py-3 bg-white/[0.03] shrink-0">
        <p className="text-[10px] text-[#52525b] text-center font-mono">
          Esc to close · Cmd+Shift+D to toggle · window.__freed in DevTools
        </p>
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// Main panel — variant-aware root
// ---------------------------------------------------------------------------

type PanelVariant = "overlay" | "drawer";

export function DebugPanel({ variant = "overlay" }: { variant?: PanelVariant }) {
  const toggle = useDebugStore((s) => s.toggle);
  const [tab, setTab] = useState<Tab>("connection");

  const content = <PanelContent tab={tab} setTab={setTab} onClose={toggle} />;

  if (variant === "drawer") {
    // Desktop: fills the width-animated wrapper in AppShell.
    // Border is here (not on the wrapper) so it's clipped when width is 0.
    return (
      <div className="w-full h-full bg-[#111111] border-l border-white/[0.06] flex flex-col">
        {content}
      </div>
    );
  }

  // Mobile overlay: bottom-sheet anchored to the viewport
  return (
    <div className="fixed inset-0 z-[200] flex items-end bg-black/60 backdrop-blur-sm">
      <div
        className="w-full bg-[#111111] border border-[rgba(255,255,255,0.1)] rounded-t-2xl shadow-2xl flex flex-col"
        style={{ maxHeight: "85vh" }}
      >
        {content}
      </div>
    </div>
  );
}
