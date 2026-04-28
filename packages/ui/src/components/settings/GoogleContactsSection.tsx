import { useRef, useState } from "react";
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
      ? "bg-[rgb(var(--theme-feedback-success-rgb)/0.15)] text-[rgb(var(--theme-feedback-success-rgb))]"
      : tone === "warning"
        ? "bg-[rgb(var(--theme-feedback-warning-rgb)/0.15)] text-[rgb(var(--theme-feedback-warning-rgb))]"
        : tone === "error"
          ? "bg-[rgb(var(--theme-feedback-danger-rgb)/0.15)] text-[rgb(var(--theme-feedback-danger-rgb))]"
          : tone === "syncing"
            ? "bg-[rgb(var(--theme-accent-secondary-rgb)/0.18)] text-[var(--theme-accent-secondary)]"
            : "bg-[color:var(--theme-bg-muted)] text-[color:var(--theme-text-secondary)]";

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
  const [connectErrorMessage, setConnectErrorMessage] = useState<string | null>(null);
  const [showCancelConfirm, setShowCancelConfirm] = useState(false);
  const connectAbortRef = useRef<AbortController | null>(null);

  const isConnected = syncState.authStatus === "connected";
  const needsReconnect = syncState.authStatus === "reconnect_required";
  const isSyncing = syncState.syncStatus === "syncing";
  const errorMessage = connectErrorMessage ?? syncState.lastErrorMessage ?? null;

  const handleConnect = async () => {
    if (!googleContacts) return;
    if (connecting) {
      setShowCancelConfirm(true);
      return;
    }

    const abortController = new AbortController();
    connectAbortRef.current = abortController;
    setConnecting(true);
    try {
      await googleContacts.connect({ signal: abortController.signal });
      setConnectErrorMessage(null);
      await syncNow();
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        setConnectErrorMessage("Google Contacts connection canceled.");
        return;
      }
      setConnectErrorMessage(
        error instanceof Error ? error.message : "Google Contacts connection failed.",
      );
      // The platform connect() path is responsible for surfacing recoverable
      // auth errors in contact sync state. Keep the settings surface alive.
    } finally {
      if (connectAbortRef.current === abortController) {
        connectAbortRef.current = null;
        setConnecting(false);
      }
    }
  };

  const confirmCancelConnect = () => {
    connectAbortRef.current?.abort();
    connectAbortRef.current = null;
    setConnecting(false);
    setShowCancelConfirm(false);
    setConnectErrorMessage("Google Contacts connection canceled.");
  };

  const handleSync = async () => {
    setConnectErrorMessage(null);
    await syncNow();
  };

  const cachedCount = syncState.cachedContacts.length.toLocaleString();
  const pendingCount = syncState.pendingSuggestions.length.toLocaleString();
  const createdFriendCount = syncState.createdFriendCount.toLocaleString();

  return (
    <div className="space-y-4" data-testid="google-contacts-settings">
      <div className="theme-dialog-section rounded-xl p-4 space-y-4">
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <p className="text-sm font-semibold text-[color:var(--theme-text-primary)]">Google Contacts</p>
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
            <p className="text-xs text-[color:var(--theme-text-muted)]">
              Sync Google Contacts into the identity graph, review suggested merges, and add unmatched contacts as friends.
            </p>
          </div>
          {errorMessage && (
            <StatusPill label="Needs attention" tone="error" />
          )}
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="theme-card-soft rounded-xl px-3 py-2.5">
            <p className="text-[11px] uppercase tracking-wider text-[color:var(--theme-text-soft)]">Cached contacts</p>
            <p className="mt-1 text-base font-semibold text-[color:var(--theme-text-primary)]">{cachedCount}</p>
          </div>
          <div className="theme-card-soft rounded-xl px-3 py-2.5">
            <p className="text-[11px] uppercase tracking-wider text-[color:var(--theme-text-soft)]">Needs review</p>
            <p className="mt-1 text-base font-semibold text-[color:var(--theme-text-primary)]">{pendingCount}</p>
          </div>
          <div className="theme-card-soft rounded-xl px-3 py-2.5">
            <p className="text-[11px] uppercase tracking-wider text-[color:var(--theme-text-soft)]">Created friends</p>
            <p className="mt-1 text-base font-semibold text-[color:var(--theme-text-primary)]">{createdFriendCount}</p>
          </div>
        </div>

        <div className="space-y-1 text-xs text-[color:var(--theme-text-muted)]">
          <p>Last successful sync: <span className="text-[color:var(--theme-text-secondary)]">{formatSyncTime(syncState.lastSyncedAt)}</span></p>
          {errorMessage && (
            <p className="theme-feedback-text-danger">
              {errorMessage}
            </p>
          )}
        </div>

        <div className="flex flex-wrap gap-2">
          <button
            onClick={handleConnect}
            disabled={!googleContacts || isSyncing}
            className="btn-primary rounded-lg px-3 py-1.5 text-sm disabled:opacity-50"
          >
            {connecting ? "Cancel Connection" : needsReconnect || !isConnected ? "Reconnect Google" : "Reconnect"}
          </button>
          <button
            onClick={handleSync}
            disabled={!googleContacts || connecting || isSyncing}
            className="btn-secondary rounded-lg px-3 py-1.5 text-sm disabled:opacity-50"
          >
            {isSyncing ? "Syncing..." : "Sync Now"}
          </button>
          <button
            onClick={() => void openReview()}
            disabled={!googleContacts || connecting}
            className="btn-secondary rounded-lg px-3 py-1.5 text-sm disabled:opacity-50"
          >
            Review Matches
          </button>
        </div>
      </div>
      {showCancelConfirm && (
        <div
          className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/60 px-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="google-contacts-cancel-title"
        >
          <div className="theme-dialog-panel w-full max-w-sm rounded-2xl border border-[var(--theme-border-subtle)] bg-[var(--theme-bg-card)] p-4 shadow-2xl">
            <h2 id="google-contacts-cancel-title" className="text-sm font-semibold text-[color:var(--theme-text-primary)]">
              Cancel Google Contacts connection?
            </h2>
            <p className="mt-2 text-xs text-[color:var(--theme-text-muted)]">
              The browser sign-in attempt will stop and you can reconnect again from settings.
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                className="btn-secondary rounded-lg px-3 py-1.5 text-sm"
                onClick={() => setShowCancelConfirm(false)}
              >
                Keep Connecting
              </button>
              <button
                type="button"
                className="btn-primary rounded-lg px-3 py-1.5 text-sm"
                onClick={confirmCancelConnect}
              >
                Cancel Connection
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
