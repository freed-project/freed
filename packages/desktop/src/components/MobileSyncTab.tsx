/**
 * MobileSyncTab — desktop-only settings section
 *
 * Three tabs:
 *   1. Cloud Sync — manage Google Drive / Dropbox connections
 *   2. Scan QR — QR code for LAN pairing (rendered locally)
 *   3. Manual — copyable IP + pairing token for manual entry
 *
 * If a VPN or multiple network interfaces are detected, an interface
 * picker lets the user regenerate the QR with the correct IP.
 */

import { useState, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import QRCode from "react-qr-code";
import {
  getSyncUrl,
  getAllLocalIPs,
  resetPairingToken,
  onStatusChange,
  getCloudToken,
  clearCloudProvider,
  initiateDesktopOAuth,
  storeCloudToken,
  startCloudSync,
  type SyncStatus,
  type NetworkInterface,
  type CloudProvider,
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

/** Heuristic: does this interface look like a VPN tunnel? */
function looksLikeVpn(iface: NetworkInterface): boolean {
  const name = iface.interface.toLowerCase();
  return (
    name.startsWith("utun") ||
    name.startsWith("tun") ||
    name.startsWith("tap") ||
    name.startsWith("wg") || // WireGuard
    name.startsWith("ppp")
  );
}

type Tab = "cloud" | "qr" | "manual";

export function MobileSyncTab() {
  const [activeTab, setActiveTab] = useState<Tab>("cloud");
  const [syncUrl, setSyncUrl] = useState<string>("");
  const [clientCount, setClientCount] = useState(0);
  const [resetting, setResetting] = useState(false);
  const [mdnsActive, setMdnsActive] = useState<boolean | null>(null);

  // Cloud sync provider state
  const [cloudStatus, setCloudStatus] = useState<Record<CloudProvider, "idle" | "connecting" | "connected" | "error">>({
    gdrive: getCloudToken("gdrive") ? "connected" : "idle",
    dropbox: getCloudToken("dropbox") ? "connected" : "idle",
  });

  const handleCloudConnect = useCallback(async (provider: CloudProvider) => {
    setCloudStatus((prev) => ({ ...prev, [provider]: "connecting" }));
    try {
      const token = await initiateDesktopOAuth(provider);
      storeCloudToken(provider, token);
      startCloudSync(provider, token).catch(console.error);
      setCloudStatus((prev) => ({ ...prev, [provider]: "connected" }));
    } catch {
      setCloudStatus((prev) => ({ ...prev, [provider]: "error" }));
    }
  }, []);

  const handleCloudDisconnect = useCallback((provider: CloudProvider) => {
    clearCloudProvider(provider);
    setCloudStatus((prev) => ({ ...prev, [provider]: "idle" }));
  }, []);
  const [allIPs, setAllIPs] = useState<NetworkInterface[]>([]);
  const [showIPPicker, setShowIPPicker] = useState(false);

  // Independent copy-flash state for each copyable field
  const [copiedIp, setCopiedIp] = useState(false);
  const [copiedToken, setCopiedToken] = useState(false);
  const [copiedUrl, setCopiedUrl] = useState(false);

  useEffect(() => {
    getSyncUrl().then(setSyncUrl);
    getAllLocalIPs().then(setAllIPs);
    invoke<boolean>("get_mdns_active")
      .then(setMdnsActive)
      .catch(() => setMdnsActive(false));

    const unsubscribe = onStatusChange((status: SyncStatus) => {
      setClientCount(status.clientCount);
    });

    return unsubscribe;
  }, []);

  const hasVpn = allIPs.some(looksLikeVpn);
  const multipleIPs = allIPs.length > 1;

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

  /** Switch to a different interface IP while preserving the port and token. */
  const handleSelectInterface = (iface: NetworkInterface) => {
    if (!syncUrl) return;
    try {
      const current = new URL(syncUrl);
      current.hostname = iface.ip;
      setSyncUrl(current.toString());
    } catch {
      // Fallback: use the raw url from the interface (no token)
      setSyncUrl(iface.url);
    }
    setShowIPPicker(false);
  };

  const ip = parseIp(syncUrl);
  const token = parseToken(syncUrl);

  return (
    <section id="mobile-sync-section">
      <h3 className="text-xs font-semibold text-[#71717a] uppercase tracking-wider mb-4">
        Mobile Sync
      </h3>

      {/* Tab selector — Cloud first, then QR, then Manual */}
      <div className="flex gap-1.5 mb-5 p-1 bg-white/5 rounded-xl">
        {(["cloud", "qr", "manual"] as Tab[]).map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`flex-1 py-1.5 rounded-lg text-xs font-medium transition-colors ${
              activeTab === tab
                ? "bg-[#8b5cf6]/20 text-[#8b5cf6]"
                : "text-[#71717a] hover:text-white"
            }`}
          >
            {tab === "cloud" ? "Cloud Sync" : tab === "qr" ? "Scan QR" : "Manual"}
          </button>
        ))}
      </div>

      {/* Cloud Sync tab */}
      {activeTab === "cloud" && (
        <div className="space-y-3 mb-4">
          {(["dropbox", "gdrive"] as CloudProvider[]).map((provider) => {
            const status = cloudStatus[provider];
            const isConnected = status === "connected";
            const isConnecting = status === "connecting";
            const label = provider === "gdrive" ? "Google Drive" : "Dropbox";
            const detail =
              provider === "gdrive"
                ? "~5 s sync · app data folder"
                : "~1–4 s sync · /Apps/Freed/";

            return (
              <div
                key={provider}
                className={`flex items-center gap-3 p-3 rounded-xl border ${
                  isConnected
                    ? "bg-green-500/5 border-green-500/20"
                    : "bg-white/5 border-[rgba(255,255,255,0.08)]"
                }`}
              >
                <span
                  className={`w-2 h-2 rounded-full flex-shrink-0 ${
                    isConnected ? "bg-green-400" : "bg-[#52525b]"
                  }`}
                />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-white">{label}</p>
                  <p className="text-xs text-[#71717a]">{detail}</p>
                </div>
                {isConnected ? (
                  <button
                    onClick={() => handleCloudDisconnect(provider)}
                    className="text-xs px-2.5 py-1 rounded-lg bg-white/5 text-[#71717a] hover:text-red-400 hover:bg-red-500/10 transition-colors"
                  >
                    Disconnect
                  </button>
                ) : (
                  <button
                    onClick={() => handleCloudConnect(provider)}
                    disabled={isConnecting}
                    className="text-xs px-2.5 py-1 rounded-lg bg-[#8b5cf6]/20 text-[#8b5cf6] hover:bg-[#8b5cf6]/30 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {isConnecting ? "Opening…" : "Connect"}
                  </button>
                )}
              </div>
            );
          })}

          <p className="text-xs text-[#71717a] text-center pt-1">
            Connecting both providers lets the desktop bridge mobile clients
            using different cloud accounts.
          </p>
        </div>
      )}

      {/* QR Code tab — rendered locally, never sent to a third party */}
      {activeTab === "qr" && (
        <>
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
          Open <span className="text-[#8b5cf6]">app.freed.wtf</span> on your
          phone,
          <br />
          then scan this QR code
        </p>
      </div>

      {/* VPN / multi-interface warning with IP picker */}
      {(hasVpn || multipleIPs) && (
        <div className="mb-4 p-3 bg-orange-500/10 border border-orange-500/30 rounded-xl">
          <p className="text-xs font-semibold text-orange-400 mb-1">
            {hasVpn ? "VPN detected" : "Multiple network interfaces"}
          </p>
          <p className="text-xs text-orange-300/80 mb-2">
            {hasVpn
              ? "A VPN may encode the wrong IP in the QR code. If your phone can't connect, pick the correct interface below."
              : "Multiple network adapters found. If the QR code doesn't work, try a different IP."}
          </p>
          <button
            onClick={() => setShowIPPicker((v) => !v)}
            className="text-xs text-orange-400 hover:text-orange-300 transition-colors"
          >
            {showIPPicker ? "Hide interfaces ↑" : "Show all interfaces ↓"}
          </button>

          {showIPPicker && (
            <div className="mt-2 space-y-1.5">
              {allIPs.map((iface) => (
                <button
                  key={iface.url}
                  onClick={() => handleSelectInterface(iface)}
                  className={`w-full flex items-center justify-between px-3 py-2 rounded-lg text-xs transition-colors border ${
                    ip === iface.ip
                      ? "bg-[#8b5cf6]/20 border-[#8b5cf6]/30 text-[#8b5cf6]"
                      : "bg-white/5 border-transparent text-[#a1a1aa] hover:bg-white/10"
                  }`}
                >
                  <span className="font-mono">{iface.ip}</span>
                  <span className="text-[#52525b] ml-2">
                    {iface.interface}
                    {looksLikeVpn(iface) && " (VPN)"}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}
        </>
      )}

      {/* Manual entry tab */}
      {activeTab === "manual" && (
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
      )}

      {/* Connected Devices — always visible */}
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

      {/* mDNS status — visible to future native clients */}
      {mdnsActive !== null && (
        <div className="flex items-center justify-between p-3 bg-white/5 rounded-xl mt-3">
          <div className="flex items-center gap-2">
            <span
              className={`inline-block w-2 h-2 rounded-full ${
                mdnsActive ? "bg-green-400" : "bg-[#71717a]"
              }`}
            />
            <span className="text-sm text-[#a1a1aa]">mDNS discovery</span>
          </div>
          <span className="text-xs text-[#71717a]">
            {mdnsActive ? "_freed-sync._tcp.local" : "unavailable"}
          </span>
        </div>
      )}
    </section>
  );
}
