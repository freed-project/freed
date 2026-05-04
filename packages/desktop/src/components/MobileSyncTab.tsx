/**
 * MobileSyncTab, desktop-only settings section
 *
 * Three tabs:
 *   1. Cloud Sync, manage Google Drive / Dropbox connections
 *   2. Scan QR, QR code for LAN pairing (rendered locally)
 *   3. Manual, copyable IP + pairing token for manual entry
 *
 * If a VPN or multiple network interfaces are detected, an interface
 * picker lets the user regenerate the QR with the correct IP.
 */

import { useState, useEffect, useCallback } from "react";
import { getPwaHostForChannel } from "@freed/shared";
import type { CloudProvider } from "@freed/ui/components/CloudProviderCard";
import { usePlatform } from "@freed/ui/context";
import { invoke } from "@tauri-apps/api/core";
import QRCode from "react-qr-code";
import {
  getSyncUrl,
  getAllLocalIPs,
  resetPairingToken,
  onStatusChange,
  type SyncStatus,
  type NetworkInterface,
} from "../lib/sync";
import { useCloudProviders } from "../hooks/useCloudProviders";
import { CloudProviderCard } from "./CloudProviderCard";
import { DesktopSnapshotsSection } from "./DesktopSnapshotsSection";

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
  const { releaseChannel } = usePlatform();
  const [activeTab, setActiveTab] = useState<Tab>("cloud");
  const [syncUrl, setSyncUrl] = useState<string>("");
  const [clientCount, setClientCount] = useState(0);
  const [resetting, setResetting] = useState(false);
  const [mdnsActive, setMdnsActive] = useState<boolean | null>(null);

  const { providers, connect, cancelConnect, disconnect } = useCloudProviders();
  const [cancelProvider, setCancelProvider] = useState<CloudProvider | null>(null);
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
  const pwaHost = getPwaHostForChannel(releaseChannel ?? "production");

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
  const cancelProviderLabel = cancelProvider === "gdrive" ? "Google Drive" : "Dropbox";

  return (
    <>
      <section id="mobile-sync-section">
      <h3 className="mb-4 text-xs font-semibold uppercase tracking-wider text-[var(--theme-text-muted)]">
        Mobile Sync
      </h3>

      {/* Tab selector, Cloud first, then QR, then Manual */}
      <div className="mb-5 flex gap-1.5 rounded-xl bg-[var(--theme-bg-muted)] p-1">
        {(["cloud", "qr", "manual"] as Tab[]).map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`flex-1 py-1.5 rounded-lg text-xs font-medium transition-colors ${
              activeTab === tab
                ? "theme-accent-button"
                : "text-[var(--theme-text-muted)] hover:text-[var(--theme-text-primary)]"
            }`}
          >
            {tab === "cloud" ? "Cloud Sync" : tab === "qr" ? "Scan QR" : "Manual"}
          </button>
        ))}
      </div>

      {/* Cloud Sync tab */}
      {activeTab === "cloud" && (
        <div className="space-y-3 mb-4">
          {(["dropbox", "gdrive"] as const).map((provider) => (
            <CloudProviderCard
              key={provider}
              provider={provider}
              state={providers[provider]}
              onConnect={connect}
              onCancelConnect={setCancelProvider}
              onDisconnect={disconnect}
            />
          ))}
          <p className="pt-1 text-center text-xs text-[var(--theme-text-muted)]">
            Connecting both providers lets the desktop bridge mobile clients
            using different cloud accounts.
          </p>
        </div>
      )}

      {/* QR Code tab, rendered locally, never sent to a third party */}
      {activeTab === "qr" && (
        <>
        <div className="mb-4 flex flex-col items-center rounded-xl border border-[var(--theme-border-subtle)] bg-[var(--theme-bg-card)] p-4">
        <p className="mb-3 text-xs text-[var(--theme-text-muted)]">
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
        <p className="mt-3 text-center text-xs text-[var(--theme-text-muted)]">
          Open <span className="text-[var(--theme-accent-secondary)]">{pwaHost}</span> on your
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
                      ? "border-[var(--theme-border-strong)] bg-[rgb(var(--theme-accent-secondary-rgb)/0.16)] text-[var(--theme-accent-secondary)]"
                      : "border-transparent bg-[var(--theme-bg-muted)] text-[var(--theme-text-secondary)] hover:bg-[var(--theme-bg-card-hover)]"
                  }`}
                >
                  <span className="font-mono">{iface.ip}</span>
                  <span className="ml-2 text-[var(--theme-text-soft)]">
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
      <div className="mb-4 rounded-xl border border-[var(--theme-border-subtle)] bg-[var(--theme-bg-card)] p-3">
        <p className="mb-3 text-xs font-medium uppercase tracking-wider text-[var(--theme-text-muted)]">
          Manual Entry
        </p>

        {/* IP address */}
        <div className="mb-3">
          <label className="mb-1.5 block text-xs text-[var(--theme-text-muted)]">
            Desktop IP address
          </label>
          <div className="flex gap-2">
            <input
              type="text"
              value={ip}
              readOnly
              aria-label="Desktop IP address"
              className="flex-1 rounded-lg border border-[var(--theme-border-subtle)] bg-[var(--theme-bg-input)] px-3 py-2 font-mono text-sm tracking-wide text-[var(--theme-text-secondary)]"
            />
            <button
              onClick={makeCopyHandler(ip, setCopiedIp)}
              className="theme-accent-button min-w-[68px] rounded-lg px-3 py-2 text-sm font-medium transition-colors"
            >
              {copiedIp ? "Copied!" : "Copy"}
            </button>
          </div>
        </div>

        {/* Pairing token */}
        <div className="mb-3">
          <label className="mb-1.5 block text-xs text-[var(--theme-text-muted)]">
            Pairing token{" "}
            <span className="text-[var(--theme-text-soft)]">(43 characters)</span>
          </label>
          <div className="flex gap-2">
            <input
              type="text"
              value={token}
              readOnly
              aria-label="Pairing token"
              className="min-w-0 flex-1 rounded-lg border border-[var(--theme-border-subtle)] bg-[var(--theme-bg-input)] px-3 py-2 font-mono text-sm tracking-wide text-[var(--theme-text-secondary)]"
            />
            <button
              onClick={makeCopyHandler(token, setCopiedToken)}
              className="theme-accent-button min-w-[68px] rounded-lg px-3 py-2 text-sm font-medium transition-colors"
            >
              {copiedToken ? "Copied!" : "Copy"}
            </button>
          </div>
        </div>

        {/* Full URL, for power users or browser-based paste */}
        <div>
          <label className="mb-1.5 block text-xs text-[var(--theme-text-muted)]">
            Full URL{" "}
            <span className="text-[var(--theme-text-soft)]">(IP + port + token combined)</span>
          </label>
          <div className="flex gap-2">
            <input
              type="text"
              value={syncUrl}
              readOnly
              aria-label="Full sync URL"
              className="min-w-0 flex-1 rounded-lg border border-[var(--theme-border-subtle)] bg-[var(--theme-bg-input)] px-3 py-2 font-mono text-xs text-[var(--theme-text-soft)]"
            />
            <button
              onClick={makeCopyHandler(syncUrl, setCopiedUrl)}
              className="theme-accent-button min-w-[68px] rounded-lg px-3 py-2 text-sm font-medium transition-colors"
            >
              {copiedUrl ? "Copied!" : "Copy"}
            </button>
          </div>
        </div>
      </div>
      )}

      {/* LAN-only: connected devices, token rotation, and mDNS are irrelevant for cloud sync */}
      {activeTab !== "cloud" && (
        <>
          <div className="mb-4 flex items-center justify-between rounded-xl bg-[var(--theme-bg-muted)] p-3">
            <div className="flex items-center gap-2">
              <span
                className={`sync-dot ${
                  clientCount > 0 ? "connected" : "disconnected"
                }`}
              />
              <span className="text-sm">Connected devices</span>
            </div>
            <span className="text-sm font-medium text-[var(--theme-text-secondary)]">{clientCount}</span>
          </div>

          <div className="rounded-xl border border-[var(--theme-border-subtle)] bg-[var(--theme-bg-card)] p-3">
            <p className="mb-2 text-xs text-[var(--theme-text-muted)]">
              Rotate the pairing token if you suspect an unauthorized device has
              connected. Paired phones will need to rescan the QR code or re-enter
              the new token.
            </p>
            <button
              onClick={handleResetPairing}
              disabled={resetting}
              className="w-full px-3 py-2 bg-red-500/10 text-red-400 border border-red-500/20 rounded-lg hover:bg-red-500/20 transition-colors text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {resetting ? "Rotating..." : "Reset Pairing Token"}
            </button>
          </div>

          {mdnsActive !== null && (
            <div className="mt-3 flex items-center justify-between rounded-xl bg-[var(--theme-bg-muted)] p-3">
              <div className="flex items-center gap-2">
                <span
                  className={`inline-block w-2 h-2 rounded-full ${
                    mdnsActive ? "bg-green-400" : "bg-[#71717a]"
                  }`}
                />
                <span className="text-sm text-[var(--theme-text-secondary)]">mDNS discovery</span>
              </div>
              <span className="text-xs text-[var(--theme-text-muted)]">
                {mdnsActive ? "_freed-sync._tcp.local" : "unavailable"}
              </span>
            </div>
          )}
        </>
      )}
      </section>
      {cancelProvider && (
        <div
          className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/60 px-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="cloud-provider-cancel-title"
        >
          <div className="theme-dialog-panel w-full max-w-sm rounded-2xl border border-[var(--theme-border-subtle)] bg-[var(--theme-bg-card)] p-4 shadow-2xl">
            <h2 id="cloud-provider-cancel-title" className="text-sm font-semibold text-[color:var(--theme-text-primary)]">
              Cancel {cancelProviderLabel} connection?
            </h2>
            <p className="mt-2 text-xs text-[color:var(--theme-text-muted)]">
              The browser sign-in attempt will stop and you can reconnect again from settings.
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                className="btn-secondary rounded-lg px-3 py-1.5 text-sm"
                onClick={() => setCancelProvider(null)}
              >
                Keep Connecting
              </button>
              <button
                type="button"
                className="btn-primary rounded-lg px-3 py-1.5 text-sm"
                onClick={() => {
                  cancelConnect(cancelProvider);
                  setCancelProvider(null);
                }}
              >
                Cancel Connection
              </button>
            </div>
          </div>
        </div>
      )}
      <DesktopSnapshotsSection />
    </>
  );
}
