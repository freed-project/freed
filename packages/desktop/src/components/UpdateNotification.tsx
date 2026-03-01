import { useState, useEffect, useCallback } from "react";
import { check, type Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";

type UpdateState =
  | { phase: "idle" }
  | { phase: "available"; update: Update }
  | { phase: "downloading"; percent: number }
  | { phase: "ready" }
  | { phase: "error"; message: string };

const CHECK_INTERVAL_MS = 30 * 60 * 1000; // 30 minutes

export function UpdateNotification() {
  const [state, setState] = useState<UpdateState>({ phase: "idle" });
  const [dismissed, setDismissed] = useState(false);

  const checkForUpdate = useCallback(async () => {
    try {
      const update = await check();
      if (update) {
        setState({ phase: "available", update });
      }
    } catch {
      // Silently ignore check failures (offline, endpoint down, etc.)
    }
  }, []);

  useEffect(() => {
    // Initial check after a short delay so it doesn't block startup
    const initial = setTimeout(checkForUpdate, 5_000);
    const interval = setInterval(checkForUpdate, CHECK_INTERVAL_MS);
    return () => {
      clearTimeout(initial);
      clearInterval(interval);
    };
  }, [checkForUpdate]);

  const handleDownloadAndInstall = useCallback(async () => {
    if (state.phase !== "available") return;
    const { update } = state;

    try {
      let totalBytes = 0;
      let downloadedBytes = 0;
      setState({ phase: "downloading", percent: 0 });

      await update.downloadAndInstall((event) => {
        switch (event.event) {
          case "Started":
            totalBytes = event.data.contentLength ?? 0;
            break;
          case "Progress":
            downloadedBytes += event.data.chunkLength;
            setState({
              phase: "downloading",
              percent: totalBytes > 0 ? (downloadedBytes / totalBytes) * 100 : 0,
            });
            break;
          case "Finished":
            setState({ phase: "ready" });
            break;
        }
      });
    } catch (err) {
      setState({
        phase: "error",
        message: err instanceof Error ? err.message : "Update failed",
      });
    }
  }, [state]);

  const handleRelaunch = useCallback(async () => {
    await relaunch();
  }, []);

  if (state.phase === "idle" || dismissed) return null;

  return (
    <div className="fixed bottom-4 right-4 z-50 max-w-sm animate-slide-up">
      <div className="glass-card p-4 shadow-lg border border-[rgba(139,92,246,0.3)]">
        <div className="flex items-start gap-3">
          <div className="shrink-0 mt-0.5">
            <UpdateIcon phase={state.phase} />
          </div>

          <div className="flex-1 min-w-0">
            <UpdateContent
              state={state}
              onInstall={handleDownloadAndInstall}
              onRelaunch={handleRelaunch}
            />
          </div>

          {state.phase !== "downloading" && (
            <button
              onClick={() => setDismissed(true)}
              className="shrink-0 text-text-muted hover:text-text-primary transition-colors"
              aria-label="Dismiss"
            >
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                <path
                  d="M1 1l12 12M13 1L1 13"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                />
              </svg>
            </button>
          )}
        </div>

        {state.phase === "downloading" && (
          <div className="mt-3 h-1.5 rounded-full bg-[rgba(255,255,255,0.08)] overflow-hidden">
            <div
              className="h-full rounded-full bg-gradient-to-r from-[var(--glow-blue)] to-[var(--glow-purple)] transition-[width] duration-300"
              style={{ width: `${state.percent}%` }}
            />
          </div>
        )}
      </div>
    </div>
  );
}

function UpdateIcon({ phase }: { phase: UpdateState["phase"] }) {
  if (phase === "error") {
    return (
      <div className="w-8 h-8 rounded-full bg-red-500/20 flex items-center justify-center">
        <span className="text-red-400 text-sm font-bold">!</span>
      </div>
    );
  }
  if (phase === "ready") {
    return (
      <div className="w-8 h-8 rounded-full bg-green-500/20 flex items-center justify-center">
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
          <path d="M3 8l3.5 3.5L13 5" stroke="#22c55e" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </div>
    );
  }
  return (
    <div className="w-8 h-8 rounded-full bg-[rgba(139,92,246,0.2)] flex items-center justify-center">
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
        <path d="M8 2v8M4 7l4 4 4-4" stroke="var(--glow-purple)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M2 13h12" stroke="var(--glow-purple)" strokeWidth="1.5" strokeLinecap="round" />
      </svg>
    </div>
  );
}

function UpdateContent({
  state,
  onInstall,
  onRelaunch,
}: {
  state: UpdateState;
  onInstall: () => void;
  onRelaunch: () => void;
}) {
  switch (state.phase) {
    case "available":
      return (
        <>
          <p className="text-sm font-medium text-text-primary">
            Update available &mdash; v{state.update.version}
          </p>
          {state.update.body && (
            <p className="text-xs text-text-muted mt-0.5 line-clamp-2">
              {state.update.body}
            </p>
          )}
          <button
            onClick={onInstall}
            className="mt-2 text-xs font-semibold px-3 py-1.5 rounded-md bg-gradient-to-r from-[var(--glow-blue)] to-[var(--glow-purple)] text-white hover:brightness-110 transition-all"
          >
            Download &amp; Install
          </button>
        </>
      );
    case "downloading":
      return (
        <p className="text-sm text-text-secondary">
          Downloading... {Math.round(state.percent)}%
        </p>
      );
    case "ready":
      return (
        <>
          <p className="text-sm font-medium text-text-primary">
            Update installed
          </p>
          <p className="text-xs text-text-muted mt-0.5">
            Restart to apply the update.
          </p>
          <button
            onClick={onRelaunch}
            className="mt-2 text-xs font-semibold px-3 py-1.5 rounded-md bg-gradient-to-r from-[var(--glow-blue)] to-[var(--glow-purple)] text-white hover:brightness-110 transition-all"
          >
            Restart Now
          </button>
        </>
      );
    case "error":
      return (
        <p className="text-sm text-red-400">
          Update failed: {state.message}
        </p>
      );
    default:
      return null;
  }
}
