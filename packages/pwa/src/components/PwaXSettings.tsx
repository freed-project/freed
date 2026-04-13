/**
 * PwaXSettings — Settings > Sources > X on the PWA
 *
 * X capture runs on Freed Desktop and syncs here via the relay.
 * Shows synced stats when X content is present; otherwise a download CTA.
 */

import { getWebsiteHostForChannel } from "@freed/shared";
import { usePlatform } from "@freed/ui/context";
import { useAppStore } from "../lib/store";

export function PwaXSettings() {
  const { releaseChannel } = usePlatform();
  const websiteGetUrl = `https://${getWebsiteHostForChannel(releaseChannel ?? "production")}/get`;
  // Return primitives so Zustand's reference-equality check never fires spuriously.
  // Returning a filtered array would create a new reference every render → infinite loop.
  const xCount = useAppStore((s) =>
    s.items.reduce((n, i) => n + (i.platform === "x" ? 1 : 0), 0),
  );
  const lastSync = useAppStore((s) => {
    let max = 0;
    for (const i of s.items) {
      if (i.platform === "x" && i.capturedAt > max) max = i.capturedAt;
    }
    return max > 0 ? max : null;
  });

  return (
    <div className="flex flex-col items-center gap-4 py-6 text-center">
      {/* X logo */}
      <svg className="h-10 w-10 text-[var(--theme-media-x)]" viewBox="0 0 24 24" fill="currentColor">
        <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-4.714-6.231-5.401 6.231H2.747l7.73-8.835L1.254 2.25H8.08l4.259 5.63 5.905-5.63zm-1.161 17.52h1.833L7.084 4.126H5.117L17.083 19.77z" />
      </svg>

      {xCount > 0 ? (
        <>
          <div>
            <p className="text-sm text-[var(--theme-text-secondary)]">Synced from Freed Desktop</p>
            <p className="mx-auto mt-1 max-w-[240px] text-xs leading-relaxed text-[var(--theme-text-soft)]">
              {xCount.toLocaleString()} posts synced
              {lastSync && (
                <> · last {new Date(lastSync).toLocaleString(undefined, {
                  month: "short",
                  day: "numeric",
                  hour: "numeric",
                  minute: "2-digit",
                })}</>
              )}
            </p>
          </div>
          <a
            href={websiteGetUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="theme-accent-button rounded-lg px-4 py-2 text-xs transition-colors"
          >
            Download the desktop app
          </a>
        </>
      ) : (
        <>
          <div>
            <p className="text-sm text-[var(--theme-text-secondary)]">X capture requires Freed Desktop</p>
            <p className="mx-auto mt-1 max-w-[240px] text-xs leading-relaxed text-[var(--theme-text-soft)]">
              Download Freed Desktop to connect your X account and sync your home timeline.
            </p>
          </div>
          <a
            href={websiteGetUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="theme-accent-button rounded-lg px-4 py-2 text-xs transition-colors"
          >
            Download the desktop app
          </a>
        </>
      )}
    </div>
  );
}
