/**
 * MobileSyncTab — desktop-only settings section
 *
 * Provides QR code and URL for PWA mobile sync connection.
 * Rendered as an extra section in the shared SettingsPanel.
 */

import { useState, useEffect } from "react";
import {
  getSyncUrl,
  onStatusChange,
  type SyncStatus,
} from "../lib/sync";

export function MobileSyncTab() {
  const [syncUrl, setSyncUrl] = useState<string>("");
  const [clientCount, setClientCount] = useState(0);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    getSyncUrl().then(setSyncUrl);

    const unsubscribe = onStatusChange((status: SyncStatus) => {
      setClientCount(status.clientCount);
    });

    return unsubscribe;
  }, []);

  const handleCopyUrl = async () => {
    try {
      await navigator.clipboard.writeText(syncUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error("Failed to copy:", err);
    }
  };

  const qrCodeUrl = `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(
    syncUrl,
  )}&bgcolor=0a0a0a&color=fafafa`;

  return (
    <section id="mobile-sync-section">
      <h3 className="text-xs font-semibold text-[#71717a] uppercase tracking-wider mb-4">
        Mobile Sync
      </h3>

      {/* QR Code */}
      <div className="flex flex-col items-center p-4 bg-white/5 rounded-xl border border-[rgba(255,255,255,0.08)] mb-4">
        <p className="text-xs text-[#71717a] mb-3">
          Scan with your phone to connect Freed PWA
        </p>
        {syncUrl && (
          <img
            src={qrCodeUrl}
            alt="Sync QR Code"
            className="w-40 h-40 rounded-lg"
          />
        )}
        <p className="text-xs text-[#71717a] mt-3 text-center">
          Open <span className="text-[#8b5cf6]">freed.wtf/app</span> on
          your phone,
          <br />
          then scan this QR code
        </p>
      </div>

      {/* Sync URL */}
      <div className="mb-4">
        <label className="block text-xs text-[#71717a] mb-2">
          Or enter this URL manually:
        </label>
        <div className="flex gap-2">
          <input
            type="text"
            value={syncUrl}
            readOnly
            className="flex-1 px-3 py-2 bg-white/5 border border-[rgba(255,255,255,0.08)] rounded-lg text-sm text-[#a1a1aa] font-mono"
          />
          <button
            onClick={handleCopyUrl}
            className="px-3 py-2 bg-[#8b5cf6]/20 text-[#8b5cf6] rounded-lg hover:bg-[#8b5cf6]/30 transition-colors text-sm font-medium"
          >
            {copied ? "Copied!" : "Copy"}
          </button>
        </div>
      </div>

      {/* Connected Devices */}
      <div className="flex items-center justify-between p-3 bg-white/5 rounded-xl">
        <div className="flex items-center gap-2">
          <span
            className={`sync-dot ${
              clientCount > 0 ? "connected" : "disconnected"
            }`}
          />
          <span className="text-sm">Connected devices</span>
        </div>
        <span className="text-sm font-medium text-[#a1a1aa]">
          {clientCount}
        </span>
      </div>
    </section>
  );
}
