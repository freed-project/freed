import type { Update } from "@tauri-apps/plugin-updater";
import { RELEASE_CHANNEL_LABELS, type ReleaseChannel } from "@freed/shared";
import { UpdateProgressBar } from "@freed/ui/components/UpdateProgressBar";
import { extractUpdatePreviewLine } from "../lib/update-release-preview";

export type UpdateState =
  | { phase: "idle" }
  | { phase: "available"; update: Update }
  | { phase: "downloading"; percent: number }
  | { phase: "ready" }
  | { phase: "error"; message: string };

/**
 * Controlled update toast — all state lives in App.tsx.
 * Renders nothing when phase is "idle".
 */
export function UpdateNotification({
  state,
  releaseChannel,
  onInstall,
  onRelaunch,
  onDismiss,
}: {
  state: UpdateState;
  releaseChannel: ReleaseChannel;
  onInstall: () => void;
  onRelaunch: () => void;
  onDismiss: () => void;
}) {
  if (state.phase === "idle") return null;

  return (
    <div className="fixed bottom-4 right-4 z-[120] max-w-sm animate-slide-up">
      <div className="rounded-2xl bg-[var(--freed-surface)] p-4 shadow-lg border border-[rgba(139,92,246,0.3)]">
        <div className="flex items-start gap-3">
          <div className="shrink-0 mt-0.5">
            <UpdateIcon phase={state.phase} />
          </div>

          <div className="flex-1 min-w-0">
            <UpdateContent
              state={state}
              releaseChannel={releaseChannel}
              onInstall={onInstall}
              onRelaunch={onRelaunch}
            />
          </div>

          {state.phase !== "downloading" && (
            <button
              onClick={onDismiss}
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
          <UpdateProgressBar
            percent={state.percent}
            trackClassName="mt-3 h-1.5 overflow-hidden rounded-full bg-[rgba(255,255,255,0.08)]"
            fillClassName="h-full rounded-full bg-gradient-to-r from-[var(--glow-blue)] to-[var(--glow-purple)]"
          />
        )}
      </div>
    </div>
  );
}

function UpdateIcon({ phase }: { phase: UpdateState["phase"] }) {
  if (phase === "error") {
    return (
      <div className="theme-icon-well-danger flex h-8 w-8 items-center justify-center rounded-full">
        <span className="theme-icon-danger text-sm font-bold">!</span>
      </div>
    );
  }
  if (phase === "ready") {
    return (
      <div className="theme-icon-well-success flex h-8 w-8 items-center justify-center rounded-full">
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
          <path d="M3 8l3.5 3.5L13 5" stroke="var(--theme-icon-success)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </div>
    );
  }
  return (
    <div className="theme-icon-well-info flex h-8 w-8 items-center justify-center rounded-full">
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
        <path d="M8 2v8M4 7l4 4 4-4" stroke="var(--theme-icon-info)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M2 13h12" stroke="var(--theme-icon-info)" strokeWidth="1.5" strokeLinecap="round" />
      </svg>
    </div>
  );
}

function UpdateContent({
  state,
  releaseChannel,
  onInstall,
  onRelaunch,
}: {
  state: UpdateState;
  releaseChannel: ReleaseChannel;
  onInstall: () => void;
  onRelaunch: () => void;
}) {
  switch (state.phase) {
    case "available":
      return (
        <>
          <p className="text-sm font-medium text-text-primary">
            Update available on {RELEASE_CHANNEL_LABELS[releaseChannel]}, v{state.update.version}
          </p>
          {state.update.body && (() => {
            const preview = extractUpdatePreviewLine(state.update.body);
            return preview ? (
              <p className="mt-1 text-xs text-text-muted line-clamp-1">
                {preview}
              </p>
            ) : null;
          })()}
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
