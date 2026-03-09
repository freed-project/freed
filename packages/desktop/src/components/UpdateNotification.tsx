import type { Update } from "@tauri-apps/plugin-updater";

/**
 * Extracts "What's New" bullet points from our structured release note markdown.
 * Falls back to stripping all markdown syntax for a plain-text preview.
 */
function parseReleaseNotes(body: string): string[] {
  // Try to find the "### What's New" section
  const whatsNewMatch = body.match(/###\s+What's New\s*\n([\s\S]*?)(?=\n###|\n##|$)/i);
  if (whatsNewMatch) {
    return whatsNewMatch[1]
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l.startsWith("- "))
      .map((l) =>
        l
          .replace(/^- /, "")
          // Strip inline markdown links: [text](url) → text
          .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
          // Strip bold/italic
          .replace(/\*\*([^*]+)\*\*/g, "$1")
          .replace(/\*([^*]+)\*/g, "$1")
          // Strip inline code
          .replace(/`([^`]+)`/g, "$1")
          .trim(),
      )
      .filter(Boolean)
      .slice(0, 3);
  }

  // Fallback: strip all markdown and return the first meaningful line
  const stripped = body
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/^>\s+/gm, "")
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !l.startsWith("**") && !l.match(/^\*+$/))
    .slice(0, 2);

  return stripped;
}

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
  onInstall,
  onRelaunch,
  onDismiss,
}: {
  state: UpdateState;
  onInstall: () => void;
  onRelaunch: () => void;
  onDismiss: () => void;
}) {
  if (state.phase === "idle") return null;

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
          {state.update.body && (() => {
            const notes = parseReleaseNotes(state.update.body);
            return notes.length > 0 ? (
              <ul className="mt-1 space-y-0.5">
                {notes.map((note, i) => (
                  <li key={i} className="text-xs text-text-muted flex gap-1.5">
                    <span className="text-glow-purple shrink-0">+</span>
                    <span className="line-clamp-1">{note}</span>
                  </li>
                ))}
              </ul>
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
