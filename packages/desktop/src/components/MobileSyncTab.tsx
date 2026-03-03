/**
 * MobileSyncTab — desktop-only settings section
 *
 * Displays a QR code containing the sync WebSocket URL + pairing token.
 * The QR is rendered locally (no external service) so the user's LAN IP
 * and token are never sent to a third party.
 */

import { useState, useEffect, useCallback } from "react";
import QRCode from "react-qr-code";
import {
  getSyncUrl,
  resetPairingToken,
  onStatusChange,
  type SyncStatus,
} from "../lib/sync";

export function MobileSyncTab() {
  const [syncUrl, setSyncUrl] = useState<string>("");
  const [clientCount, setClientCount] = useState(0);
  const [copied, setCopied] = useState(false);
  const [resetting, setResetting] = useState(false);

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

  const handleResetPairing = useCallback(async () => {
    setResetting(true);
    try {
      const newUrl = await resetPairingToken();
      setSyncUrl(newUrl);
    } catch (err) {
      console.error("Failed to reset pairing token:", err);
    } finally {
      setResetting(false);
    }
  }, []);

  return (
    <section id="mobile-sync-section">
      <h3 className="text-xs font-semibold text-[#71717a] uppercase tracking-wider mb-4">
        Mobile Sync
      </h3>

      {/* QR Code — rendered locally, never sent to a third party */}
      <div className="flex flex-col items-center p-4 bg-white/5 rounded-xl border border-[rgba(255,255,255,0.08)] mb-4">
        <p className="text-xs text-[#71717a] mb-3">
          Scan with your phone to connect Freed PWA
        </p>
        {syncUrl && (
          <div className="p-3 bg-white rounded-lg">
            <QRCode
              value={syncUrl}
              size={160}
              bgColor="#ffffff"
              fgColor="#0a0a0a"
            />
          </div>
        )}
        <p className="text-xs text-[#71717a] mt-3 text-center">
          Open <span className="text-[#8b5cf6]">freed.wtf/app</span> on your
          phone,
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
      <div className="flex items-center justify-between p-3 bg-white/5 rounded-xl mb-4">
        <div className="flex items-center gap-2">
          <span
            className={`sync-dot ${
              clientCount > 0 ? "connected" : "disconnected"
            }`}
          />
          <span className="text-sm">Connected devices</span>
        </div>
        <span className="text-sm font-medium text-[#a1a1aa]">{clientCount}</span>
      </div>

      {/* Reset Pairing */}
      <div className="p-3 bg-white/5 rounded-xl border border-[rgba(255,255,255,0.08)]">
        <p className="text-xs text-[#71717a] mb-2">
          Rotate the pairing token if you suspect an unauthorized device has
          connected. Paired phones will need to rescan the QR code.
        </p>
        <button
          onClick={handleResetPairing}
          disabled={resetting}
          className="w-full px-3 py-2 bg-red-500/10 text-red-400 border border-red-500/20 rounded-lg hover:bg-red-500/20 transition-colors text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {resetting ? "Rotating…" : "Reset Pairing Token"}
        </button>
      </div>
    </section>
  );
}
