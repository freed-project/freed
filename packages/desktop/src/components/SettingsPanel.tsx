import { useState, useEffect } from "react";
import {
  getSyncUrl,
  onStatusChange,
  type SyncStatus,
} from "../lib/sync";

interface SettingsPanelProps {
  open: boolean;
  onClose: () => void;
}

export function SettingsPanel({ open, onClose }: SettingsPanelProps) {
  const [syncUrl, setSyncUrl] = useState<string>("");
  const [clientCount, setClientCount] = useState(0);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!open) return;

    // Get sync URL
    getSyncUrl().then(setSyncUrl);

    // Subscribe to status updates
    const unsubscribe = onStatusChange((status: SyncStatus) => {
      setClientCount(status.clientCount);
    });

    return unsubscribe;
  }, [open]);

  const handleCopyUrl = async () => {
    try {
      await navigator.clipboard.writeText(syncUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error("Failed to copy:", err);
    }
  };

  if (!open) return null;

  // Generate a simple QR code using a data URL
  // For a real implementation, use a library like qrcode
  const qrCodeUrl = `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(
    syncUrl
  )}&bgcolor=0a0a0a&color=fafafa`;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Panel */}
      <div className="relative w-full max-w-md mx-4 bg-[#141414] border border-[rgba(255,255,255,0.08)] rounded-2xl p-6 shadow-2xl">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-xl font-semibold">Settings</h2>
          <button
            onClick={onClose}
            className="p-2 rounded-lg hover:bg-white/10 transition-colors"
          >
            <svg
              className="w-5 h-5"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </button>
        </div>

        {/* Sync Section */}
        <div className="space-y-6">
          <div>
            <h3 className="text-sm font-medium text-[#a1a1aa] mb-3">
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
          </div>

          {/* Version Info */}
          <div className="pt-4 border-t border-[rgba(255,255,255,0.08)]">
            <div className="flex items-center justify-between text-sm">
              <span className="text-[#71717a]">Freed Desktop</span>
              <span className="text-[#a1a1aa]">v0.1.0</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
