import { useState } from "react";
import { usePlatform } from "../../context/PlatformContext.js";
import { useContactSyncContext } from "../../context/ContactSyncContext.js";

function formatSyncTime(timestamp: number | null): string {
  if (!timestamp) return "Never";
  return new Date(timestamp).toLocaleString();
}

function StatusPill({
  label,
  tone,
}: {
  label: string;
  tone: "neutral" | "success" | "warning" | "error" | "syncing";
}) {
  const toneClass =
    tone === "success"
      ? "bg-green-500/15 text-green-300"
      : tone === "warning"
        ? "bg-amber-500/15 text-amber-300"
        : tone === "error"
          ? "bg-red-500/15 text-red-300"
          : tone === "syncing"
            ? "bg-[#8b5cf6]/20 text-[#c4b5fd]"
            : "bg-white/5 text-[#a1a1aa]";

  return (
    <span className={`inline-flex items-center rounded-full px-2 py-1 text-[11px] font-medium ${toneClass}`}>
      {label}
    </span>
  );
}

export function GoogleContactsSection() {
  const { googleContacts } = usePlatform();
  const { syncState, syncNow, openReview } = useContactSyncContext();
  const [connecting, setConnecting] = useState(false);

  const isConnected = syncState.authStatus === "connected";
  const needsReconnect = syncState.authStatus === "reconnect_required";
  const isSyncing = syncState.syncStatus === "syncing";

  const handleConnect = async () => {
    if (!googleContacts) return;
    setConnecting(true);
    try {
      await googleContacts.connect();
      await syncNow();
    } finally {
      setConnecting(false);
    }
  };

  const handleSync = async () => {
    await syncNow();
  };

  const cachedCount = syncState.cachedContacts.length.toLocaleString();
  const pendingCount = syncState.pendingMatches.length.toLocaleString();
  const autoLinkedCount = syncState.autoLinkedCount.toLocaleString();
  const autoCreatedCount = syncState.autoCreatedCount.toLocaleString();

  return (
    <div className="space-y-4" data-testid="google-contacts-settings">
      <div className="rounded-xl bg-white/[0.03] border border-[rgba(255,255,255,0.06)] p-4 space-y-4">
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <p className="text-sm font-semibold text-white">Google Contacts</p>
              {isSyncing ? (
                <StatusPill label="Syncing" tone="syncing" />
              ) : needsReconnect ? (
                <StatusPill label="Reconnect required" tone="warning" />
              ) : isConnected ? (
                <StatusPill label="Connected" tone="success" />
              ) : (
                <StatusPill label="Not connected" tone="neutral" />
              )}
            </div>
            <p className="text-xs text-[#71717a]">
              Sync contact matches into Friends, auto-link obvious matches, and review the ambiguous ones.
            </p>
          </div>
          {syncState.lastErrorMessage && (
            <StatusPill label="Needs attention" tone="error" />
          )}
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="rounded-xl bg-white/[0.03] border border-[rgba(255,255,255,0.05)] px-3 py-2.5">
            <p className="text-[11px] uppercase tracking-wider text-[#52525b]">Cached contacts</p>
            <p className="mt-1 text-base font-semibold text-white">{cachedCount}</p>
          </div>
          <div className="rounded-xl bg-white/[0.03] border border-[rgba(255,255,255,0.05)] px-3 py-2.5">
            <p className="text-[11px] uppercase tracking-wider text-[#52525b]">Needs review</p>
            <p className="mt-1 text-base font-semibold text-white">{pendingCount}</p>
          </div>
          <div className="rounded-xl bg-white/[0.03] border border-[rgba(255,255,255,0.05)] px-3 py-2.5">
            <p className="text-[11px] uppercase tracking-wider text-[#52525b]">Auto-linked</p>
            <p className="mt-1 text-base font-semibold text-white">{autoLinkedCount}</p>
          </div>
          <div className="rounded-xl bg-white/[0.03] border border-[rgba(255,255,255,0.05)] px-3 py-2.5">
            <p className="text-[11px] uppercase tracking-wider text-[#52525b]">Auto-created</p>
            <p className="mt-1 text-base font-semibold text-white">{autoCreatedCount}</p>
          </div>
        </div>

        <div className="space-y-1 text-xs text-[#71717a]">
          <p>Last successful sync: <span className="text-[#a1a1aa]">{formatSyncTime(syncState.lastSyncedAt)}</span></p>
          {syncState.lastErrorMessage && (
            <p className="text-red-300">
              {syncState.lastErrorMessage}
            </p>
          )}
        </div>

        <div className="flex flex-wrap gap-2">
          <button
            onClick={handleConnect}
            disabled={!googleContacts || connecting || isSyncing}
            className="text-sm px-3 py-1.5 rounded-lg bg-[#8b5cf6] hover:bg-[#7c3aed] text-white transition-colors disabled:opacity-50"
          >
            {connecting ? "Connecting..." : needsReconnect || !isConnected ? "Reconnect Google" : "Reconnect"}
          </button>
          <button
            onClick={handleSync}
            disabled={!googleContacts || connecting || isSyncing}
            className="text-sm px-3 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-[#a1a1aa] hover:text-white transition-colors disabled:opacity-50"
          >
            {isSyncing ? "Syncing..." : "Sync Now"}
          </button>
          <button
            onClick={() => void openReview()}
            disabled={!googleContacts || connecting}
            className="text-sm px-3 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-[#a1a1aa] hover:text-white transition-colors disabled:opacity-50"
          >
            Review Matches
          </button>
        </div>
      </div>
    </div>
  );
}
