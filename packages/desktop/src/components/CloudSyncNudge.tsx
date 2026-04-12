/**
 * CloudSyncNudge — session-persistent toast that appears whenever no cloud
 * provider is connected.
 *
 * Shown on every app launch until the user connects at least one provider.
 * Dismissing it hides it for the current session only; it reappears on the
 * next launch if still unconfigured. Clicking "Set up" opens the unified
 * Settings dialog pre-scrolled to the Sync section.
 */

import { useState, useCallback } from "react";
import { getCloudToken } from "../lib/sync";

/** Returns true when at least one cloud provider has a stored token. */
export function hasAnyCloudProvider(): boolean {
  return !!(getCloudToken("gdrive") || getCloudToken("dropbox"));
}

export function CloudSyncNudge() {
  const [dismissed, setDismissed] = useState(false);

  const handleDismiss = useCallback(() => setDismissed(true), []);
  const handleSetUp = useCallback(() => {
    window.dispatchEvent(
      new CustomEvent("freed:open-settings", { detail: { scrollTo: "sync" } }),
    );
  }, []);

  if (dismissed || hasAnyCloudProvider()) return null;

  return (
    <div className="fixed bottom-4 left-1/2 z-40 flex w-[calc(100%-2rem)] max-w-sm -translate-x-1/2 items-center gap-3 rounded-xl border border-[var(--theme-border-subtle)] bg-[color-mix(in_oklab,var(--theme-bg-surface)_92%,transparent)] px-4 py-3 text-sm shadow-[var(--theme-header-shadow)] backdrop-blur-sm">
      {/* Cloud icon */}
      <svg
        className="h-4 w-4 flex-shrink-0 text-[var(--theme-accent-secondary)]"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={1.5}
          d="M3 15a4 4 0 004 4h9a5 5 0 10-.1-9.999 5.002 5.002 0 10-9.78 2.096A4.001 4.001 0 003 15z"
        />
      </svg>

      <p className="flex-1 leading-snug text-[var(--theme-text-secondary)]">
        No cloud sync, your feed won't reach mobile.
      </p>

      <button
        onClick={handleSetUp}
        className="whitespace-nowrap text-xs font-medium text-[var(--theme-accent-secondary)] transition-colors hover:text-[var(--theme-text-primary)]"
      >
        Set up
      </button>

      <button
        onClick={handleDismiss}
        aria-label="Dismiss"
        className="text-[var(--theme-text-soft)] transition-colors hover:text-[var(--theme-text-muted)]"
      >
        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>
    </div>
  );
}
