/**
 * MobileSyncTab — desktop-only settings section
 *
 * Displays a QR code containing the sync WebSocket URL + pairing token.
 * The QR is rendered locally (no external service) so the user's LAN IP
 * and token are never sent to a third party.
 *
 * For situations where QR scanning is impractical, the IP address and
 * 43-character pairing token are shown as separate copyable fields so
 * the user can transcribe them manually.
 */

import { useState, useEffect, useCallback } from "react";
import QRCode from "react-qr-code";
import {
  getSyncUrl,
  resetPairingToken,
  onStatusChange,
  type SyncStatus,
} from "../lib/sync";

/** Parse the LAN IP from a ws://ip:port?t=token URL. */
function parseIp(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return "";
  }
}

/** Parse the 43-character pairing token from the ?t= query param. */
function parseToken(url: string): string {
  try {
    return new URL(url).searchParams.get("t") ?? "";
  } catch {
    return "";
  }
}

export function MobileSyncTab() {
  const [syncUrl, setSyncUrl] = useState<string>("");
  const [clientCount, setClientCount] = useState(0);
  const [resetting, setResetting] = useState(false);

  // Independent copy-flash state for each copyable field
  const [copiedIp, setCopiedIp] = useState(false);
  const [copiedToken, setCopiedToken] = useState(false);
  const [copiedUrl, setCopiedUrl] = useState(false);

  useEffect(() => {
    getSyncUrl().then(setSyncUrl);

    const unsubscribe = onStatusChange((status: SyncStatus) => {
      setClientCount(status.clientCount);
    });

    return unsubscribe;
  }, []);

  const makeCopyHandler = (text: string, setFlash: (v: boolean) => void) =>
    async () => {
      try {
        await navigator.clipboard.writeText(text);
        setFlash(true);
        setTimeout(() => setFlash(false), 2000);
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

  const ip = parseIp(syncUrl);
  const token = parseToken(syncUrl);

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

      {/* Manual entry fields — IP and token shown separately for transcription */}
      <div className="mb-4 p-3 bg-white/5 rounded-xl border border-[rgba(255,255,255,0.08)]">
        <p className="text-xs font-medium text-[#71717a] uppercase tracking-wider mb-3">
          Manual Entry
        </p>

        {/* IP address */}
        <div className="mb-3">
          <label className="block text-xs text-[#71717a] mb-1.5">
            Desktop IP address
          </label>
          <div className="flex gap-2">
            <input
              type="text"
              value={ip}
              readOnly
              aria-label="Desktop IP address"
              className="flex-1 px-3 py-2 bg-white/5 border border-[rgba(255,255,255,0.08)] rounded-lg text-sm text-[#a1a1aa] font-mono tracking-wide"
            />
            <button
              onClick={makeCopyHandler(ip, setCopiedIp)}
              className="px-3 py-2 bg-[#8b5cf6]/20 text-[#8b5cf6] rounded-lg hover:bg-[#8b5cf6]/30 transition-colors text-sm font-medium min-w-[68px]"
            >
              {copiedIp ? "Copied!" : "Copy"}
            </button>
          </div>
        </div>

        {/* Pairing token */}
        <div className="mb-3">
          <label className="block text-xs text-[#71717a] mb-1.5">
            Pairing token{" "}
            <span className="text-[#52525b]">(43 characters)</span>
          </label>
          <div className="flex gap-2">
            <input
              type="text"
              value={token}
              readOnly
              aria-label="Pairing token"
              className="flex-1 px-3 py-2 bg-white/5 border border-[rgba(255,255,255,0.08)] rounded-lg text-sm text-[#a1a1aa] font-mono tracking-wide min-w-0"
            />
            <button
              onClick={makeCopyHandler(token, setCopiedToken)}
              className="px-3 py-2 bg-[#8b5cf6]/20 text-[#8b5cf6] rounded-lg hover:bg-[#8b5cf6]/30 transition-colors text-sm font-medium min-w-[68px]"
            >
              {copiedToken ? "Copied!" : "Copy"}
            </button>
          </div>
        </div>

        {/* Full URL — for power users or browser-based paste */}
        <div>
          <label className="block text-xs text-[#71717a] mb-1.5">
            Full URL{" "}
            <span className="text-[#52525b]">(IP + port + token combined)</span>
          </label>
          <div className="flex gap-2">
            <input
              type="text"
              value={syncUrl}
              readOnly
              aria-label="Full sync URL"
              className="flex-1 px-3 py-2 bg-white/5 border border-[rgba(255,255,255,0.08)] rounded-lg text-xs text-[#52525b] font-mono min-w-0"
            />
            <button
              onClick={makeCopyHandler(syncUrl, setCopiedUrl)}
              className="px-3 py-2 bg-[#8b5cf6]/20 text-[#8b5cf6] rounded-lg hover:bg-[#8b5cf6]/30 transition-colors text-sm font-medium min-w-[68px]"
            >
              {copiedUrl ? "Copied!" : "Copy"}
            </button>
          </div>
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
          connected. Paired phones will need to rescan the QR code or re-enter
          the new token.
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
