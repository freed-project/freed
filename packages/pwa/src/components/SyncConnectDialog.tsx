import { useState } from "react";
import { connect, storeRelayUrl } from "../lib/sync";

interface SyncConnectDialogProps {
  open: boolean;
  onClose: () => void;
}

export function SyncConnectDialog({ open, onClose }: SyncConnectDialogProps) {
  const [url, setUrl] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);

  if (!open) return null;

  const handleConnect = async () => {
    if (!url.trim()) return;

    // Validate URL format
    try {
      const parsed = new URL(url.trim());
      if (parsed.protocol !== "ws:" && parsed.protocol !== "wss:") {
        throw new Error("URL must start with ws:// or wss://");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Invalid URL format");
      return;
    }

    setError(null);
    setConnecting(true);

    try {
      storeRelayUrl(url.trim());
      connect(url.trim());

      // Wait a moment to see if connection succeeds
      await new Promise((resolve) => setTimeout(resolve, 1000));

      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to connect");
    } finally {
      setConnecting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Dialog */}
      <div className="relative w-full sm:max-w-md sm:mx-4 bg-[#141414] border border-[rgba(255,255,255,0.08)] rounded-t-2xl sm:rounded-2xl p-6 shadow-2xl">
        {/* Mobile drag indicator */}
        <div className="sm:hidden w-12 h-1 bg-white/20 rounded-full mx-auto mb-4" />

        <h2 className="text-xl font-semibold mb-2">Connect to Desktop</h2>
        <p className="text-sm text-[#71717a] mb-6">
          Enter the sync URL from your FREED desktop app to sync your feeds
          across devices.
        </p>

        <div className="mb-4">
          <label
            htmlFor="sync-url"
            className="block text-sm text-[#a1a1aa] mb-2"
          >
            Sync URL
          </label>
          <input
            id="sync-url"
            type="url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="ws://192.168.1.x:8765"
            className="w-full px-4 py-3 bg-white/5 border border-[rgba(255,255,255,0.08)] rounded-xl focus:outline-none focus:border-[#8b5cf6] text-white placeholder-[#71717a] font-mono text-sm transition-colors"
            disabled={connecting}
            autoFocus
          />
          <p className="mt-2 text-xs text-[#71717a]">
            Find this in your desktop app: Settings → Mobile Sync
          </p>
        </div>

        {error && (
          <div className="mb-4 p-3 bg-red-500/20 border border-red-500/50 rounded-xl text-red-400 text-sm">
            {error}
          </div>
        )}

        <div className="flex gap-3 justify-end">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2.5 text-[#a1a1aa] hover:text-white transition-colors"
            disabled={connecting}
          >
            Cancel
          </button>
          <button
            onClick={handleConnect}
            className="btn-primary px-6 py-2.5 disabled:opacity-50"
            disabled={connecting || !url.trim()}
          >
            {connecting ? "Connecting..." : "Connect"}
          </button>
        </div>
      </div>
    </div>
  );
}
