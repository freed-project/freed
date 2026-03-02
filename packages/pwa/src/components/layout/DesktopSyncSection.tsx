/**
 * DesktopSyncSection — PWA-specific sidebar widget
 *
 * Shows desktop sync connection status and provides connect/disconnect
 * actions. Only rendered in the PWA deployment target.
 */

import { useState } from "react";
import { useAppStore } from "../../lib/store";
import { disconnect, clearStoredRelayUrl } from "../../lib/sync";
import { SyncConnectDialog } from "../SyncConnectDialog";

export function DesktopSyncSection() {
  const syncConnected = useAppStore((s) => s.syncConnected);
  const [showSyncDialog, setShowSyncDialog] = useState(false);

  const handleDisconnectSync = () => {
    clearStoredRelayUrl();
    disconnect();
  };

  return (
    <>
      <div className="flex-shrink-0 mb-6 p-3 rounded-xl bg-white/5 border border-[rgba(255,255,255,0.08)]">
        <div className="flex items-center justify-between mb-2">
          <span className="text-sm font-medium">Desktop Sync</span>
          <div className="flex items-center gap-2">
            <span
              className={`sync-dot ${syncConnected ? "connected" : "disconnected"}`}
            />
            <span className="text-xs text-[#71717a]">
              {syncConnected ? "Connected" : "Offline"}
            </span>
          </div>
        </div>
        {syncConnected ? (
          <button
            onClick={handleDisconnectSync}
            className="w-full text-xs px-3 py-2 bg-red-500/20 text-red-400 rounded-lg hover:bg-red-500/30 transition-colors"
          >
            Disconnect
          </button>
        ) : (
          <button
            onClick={() => setShowSyncDialog(true)}
            className="w-full text-xs px-3 py-2 bg-[#8b5cf6]/20 text-[#8b5cf6] rounded-lg hover:bg-[#8b5cf6]/30 transition-colors"
          >
            Connect to Desktop
          </button>
        )}
      </div>

      <SyncConnectDialog
        open={showSyncDialog}
        onClose={() => setShowSyncDialog(false)}
      />
    </>
  );
}
