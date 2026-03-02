import { useAppStore } from "../lib/store";

export function PwaFeedEmptyState() {
  const syncConnected = useAppStore((s) => s.syncConnected);

  return (
    <>
      <p className="text-lg font-medium mb-2">
        {syncConnected ? "Waiting for content..." : "Connect to your desktop app"}
      </p>
      <p className="text-sm text-[#71717a] max-w-xs">
        {syncConnected
          ? "Your desktop app is connected. New feed content will appear here once fetched."
          : "The PWA syncs content from your Freed desktop app. Open the desktop app and connect to start reading."}
      </p>
    </>
  );
}
