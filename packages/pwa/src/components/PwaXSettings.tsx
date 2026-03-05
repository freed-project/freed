/**
 * PwaXSettings — Settings > Sources > X on the PWA
 *
 * X capture runs on Freed Desktop and syncs to the PWA via the relay.
 * This page shows synced stats when X content is present, and always
 * offers a link to download the desktop app.
 */

import { useAppStore } from "../lib/store";
import type { FeedItem } from "@freed/shared";

export function PwaXSettings() {
  const xItems = useAppStore((s: { items: FeedItem[] }) =>
    s.items.filter((i) => i.platform === "x"),
  );

  const lastSync = xItems.length
    ? Math.max(...xItems.map((i) => i.capturedAt))
    : null;

  return (
    <div className="space-y-4">
      {xItems.length > 0 && (
        <div className="grid grid-cols-2 gap-3">
          <div className="px-4 py-3 rounded-xl bg-white/5">
            <p className="text-xs text-[#52525b] mb-1">Posts synced</p>
            <p className="text-xl font-semibold tabular-nums">
              {xItems.length.toLocaleString()}
            </p>
          </div>
          <div className="px-4 py-3 rounded-xl bg-white/5">
            <p className="text-xs text-[#52525b] mb-1">Last sync</p>
            <p className="text-sm font-medium">
              {new Date(lastSync!).toLocaleString(undefined, {
                month: "short",
                day: "numeric",
                hour: "numeric",
                minute: "2-digit",
              })}
            </p>
          </div>
        </div>
      )}

      <div className="flex items-start gap-3 px-4 py-3.5 rounded-xl bg-white/5">
        <div className="mt-0.5 shrink-0 w-8 h-8 rounded-lg bg-[#8b5cf6]/15 flex items-center justify-center">
          <svg className="w-4 h-4 text-[#8b5cf6]" viewBox="0 0 24 24" fill="currentColor">
            <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-4.714-6.231-5.401 6.231H2.747l7.73-8.835L1.254 2.25H8.08l4.259 5.63 5.905-5.63zm-1.161 17.52h1.833L7.084 4.126H5.117L17.083 19.77z" />
          </svg>
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium mb-1">
            {xItems.length > 0
              ? "Connected via Freed Desktop"
              : "X capture requires Freed Desktop"}
          </p>
          <p className="text-xs text-[#71717a] leading-relaxed">
            {xItems.length > 0
              ? "Your X timeline is captured on the desktop app and synced here automatically."
              : "Install Freed on your Mac to connect your X account and sync your home timeline. Posts show up here automatically."}
          </p>
        </div>
      </div>

      {xItems.length === 0 && (
        <a
          href="https://freed.wtf/get"
          target="_blank"
          rel="noreferrer"
          className="flex items-center justify-center gap-2 w-full px-4 py-2.5 rounded-xl bg-[#8b5cf6]/15 text-[#8b5cf6] hover:bg-[#8b5cf6]/25 transition-colors text-sm font-medium"
        >
          Download Freed for Mac
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
          </svg>
        </a>
      )}
    </div>
  );
}
