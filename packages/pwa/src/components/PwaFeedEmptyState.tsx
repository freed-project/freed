import { useState } from "react";
import { useAppStore } from "../lib/store";
import { SyncConnectDialog } from "./SyncConnectDialog";

export function PwaFeedEmptyState() {
  const syncConnected = useAppStore((s) => s.syncConnected);
  const activeFilter = useAppStore((s) => s.activeFilter);
  const feeds = useAppStore((s) => s.feeds);
  const [showConnect, setShowConnect] = useState(false);

  // Per-feed view: a specific feed is selected but has no items yet.
  // `lastFetched` is absent on stub entries added from the PWA — a reliable
  // signal that the desktop hasn't polled this feed yet.
  const activeFeed = activeFilter.feedUrl ? feeds[activeFilter.feedUrl] : null;
  const isPendingSync = activeFeed != null && !activeFeed.lastFetched;

  if (isPendingSync) {
    // Display hostname when the title is still the raw URL sentinel
    const displayName =
      activeFeed.title === activeFeed.url
        ? new URL(activeFeed.url).hostname
        : activeFeed.title;

    return (
      <>
        <div className="w-16 h-16 rounded-full bg-gradient-to-br from-[#3b82f6]/20 to-[#8b5cf6]/20 flex items-center justify-center mb-4">
          <span className="text-2xl">📡</span>
        </div>
        <p className="text-lg font-medium mb-2">Subscribed!</p>
        <p className="text-sm text-[#71717a] max-w-xs leading-relaxed">
          Items from{" "}
          <span className="text-white font-medium">{displayName}</span> will
          appear here after your desktop app syncs and fetches the feed.
        </p>
        {!syncConnected && (
          <>
            <p className="text-xs text-[#52525b] mt-3 max-w-xs">
              Open your desktop app and make sure it's connected to start
              receiving content.
            </p>
            <button
              onClick={() => setShowConnect(true)}
              className="mt-4 flex items-center gap-2 px-5 py-2.5 rounded-xl bg-[#8b5cf6]/20 text-[#8b5cf6] hover:bg-[#8b5cf6]/30 transition-colors font-medium text-sm"
            >
              <svg
                className="w-4 h-4"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1"
                />
              </svg>
              Connect desktop
            </button>
          </>
        )}
        <SyncConnectDialog
          open={showConnect}
          onClose={() => setShowConnect(false)}
        />
      </>
    );
  }

  return (
    <>
      <p className="text-lg font-medium mb-2">
        {syncConnected ? "Waiting for content..." : "No content yet"}
      </p>
      <p className="text-sm text-[#71717a] max-w-xs">
        {syncConnected
          ? "Your desktop app is connected. New feed content will appear here once fetched."
          : "Connect to your desktop app to sync your feeds."}
      </p>
      {!syncConnected && (
        <button
          onClick={() => setShowConnect(true)}
          className="mt-4 flex items-center gap-2 px-5 py-2.5 rounded-xl bg-[#8b5cf6]/20 text-[#8b5cf6] hover:bg-[#8b5cf6]/30 transition-colors font-medium text-sm"
        >
          <svg
            className="w-4 h-4"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1"
            />
          </svg>
          Connect
        </button>
      )}
      <SyncConnectDialog
        open={showConnect}
        onClose={() => setShowConnect(false)}
      />
    </>
  );
}
