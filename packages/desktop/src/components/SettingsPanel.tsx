import { useState, useEffect, useCallback } from "react";
import {
  getSyncUrl,
  onStatusChange,
  type SyncStatus,
} from "../lib/sync";
import { useAppStore } from "../lib/store";
import type { WeightPreferences } from "@freed/shared";

interface SettingsPanelProps {
  open: boolean;
  onClose: () => void;
}

function Slider({
  label,
  value,
  onChange,
  description,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  description?: string;
}) {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <label className="text-sm text-[#a1a1aa]">{label}</label>
        <span className="text-sm font-mono text-white tabular-nums w-8 text-right">
          {value}
        </span>
      </div>
      <input
        type="range"
        min={0}
        max={100}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full h-1.5 appearance-none rounded-full bg-white/10 accent-[#8b5cf6] cursor-pointer"
      />
      {description && (
        <p className="text-xs text-[#52525b]">{description}</p>
      )}
    </div>
  );
}

function Toggle({
  label,
  checked,
  onChange,
  description,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  description?: string;
}) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div>
        <p className="text-sm text-[#a1a1aa]">{label}</p>
        {description && (
          <p className="text-xs text-[#52525b] mt-0.5">{description}</p>
        )}
      </div>
      <button
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={`relative shrink-0 w-9 h-5 rounded-full transition-colors ${
          checked ? "bg-[#8b5cf6]" : "bg-white/10"
        }`}
      >
        <span
          className={`absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${
            checked ? "translate-x-4" : "translate-x-0"
          }`}
        />
      </button>
    </div>
  );
}

type Tab = "ranking" | "sync";

export function SettingsPanel({ open, onClose }: SettingsPanelProps) {
  const [tab, setTab] = useState<Tab>("ranking");
  const [syncUrl, setSyncUrl] = useState<string>("");
  const [clientCount, setClientCount] = useState(0);
  const [copied, setCopied] = useState(false);

  const preferences = useAppStore((s) => s.preferences);
  const updatePreferences = useAppStore((s) => s.updatePreferences);

  const [weights, setWeights] = useState<WeightPreferences>(
    () => preferences.weights,
  );
  const [display, setDisplay] = useState(() => preferences.display);

  useEffect(() => {
    if (!open) return;

    getSyncUrl().then(setSyncUrl);

    const unsubscribe = onStatusChange((status: SyncStatus) => {
      setClientCount(status.clientCount);
    });

    return unsubscribe;
  }, [open]);

  const handleWeightChange = useCallback(
    (key: keyof WeightPreferences | `platforms.${string}`, value: number) => {
      setWeights((prev) => {
        let next: WeightPreferences;
        if (key.startsWith("platforms.")) {
          const platform = key.slice("platforms.".length);
          next = { ...prev, platforms: { ...prev.platforms, [platform]: value } };
        } else {
          next = { ...prev, [key]: value };
        }
        updatePreferences({ weights: next });
        return next;
      });
    },
    [updatePreferences],
  );

  const handleDisplayChange = useCallback(
    (update: Partial<typeof display>) => {
      setDisplay((prev) => {
        const next = { ...prev, ...update };
        updatePreferences({ display: next });
        return next;
      });
    },
    [updatePreferences],
  );

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

  const platformWeights = weights.platforms ?? {};
  const qrCodeUrl = `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(
    syncUrl,
  )}&bgcolor=0a0a0a&color=fafafa`;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Panel */}
      <div className="relative w-full max-w-md mx-4 bg-[#141414] border border-[rgba(255,255,255,0.08)] rounded-2xl shadow-2xl max-h-[85vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[rgba(255,255,255,0.08)] shrink-0">
          <h2 className="text-xl font-semibold">Settings</h2>
          <button
            onClick={onClose}
            className="p-2 rounded-lg hover:bg-white/10 transition-colors text-[#71717a] hover:text-white"
            aria-label="Close settings"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 px-6 pt-4 pb-0 shrink-0">
          {(["ranking", "sync"] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`px-4 py-2 rounded-lg text-sm font-medium capitalize transition-colors ${
                tab === t
                  ? "bg-[#8b5cf6]/20 text-[#8b5cf6] border border-[#8b5cf6]/30"
                  : "text-[#71717a] hover:text-white hover:bg-white/5"
              }`}
            >
              {t === "ranking" ? "Ranking" : "Mobile Sync"}
            </button>
          ))}
        </div>

        {/* Content */}
        <div className="overflow-y-auto flex-1 px-6 py-5 space-y-6">
          {tab === "ranking" && (
            <>
              <section>
                <h3 className="text-xs font-semibold text-[#71717a] uppercase tracking-wider mb-4">
                  Ranking Weights
                </h3>
                <div className="space-y-5">
                  <Slider
                    label="Recency"
                    value={weights.recency}
                    onChange={(v) => handleWeightChange("recency", v)}
                    description="How much to prioritize newer content"
                  />
                  <Slider
                    label="X / Twitter"
                    value={platformWeights["x"] ?? 50}
                    onChange={(v) => handleWeightChange("platforms.x", v)}
                    description="Boost or suppress X posts"
                  />
                  <Slider
                    label="RSS"
                    value={platformWeights["rss"] ?? 50}
                    onChange={(v) => handleWeightChange("platforms.rss", v)}
                    description="Boost or suppress RSS articles"
                  />
                  <Slider
                    label="YouTube"
                    value={platformWeights["youtube"] ?? 50}
                    onChange={(v) => handleWeightChange("platforms.youtube", v)}
                    description="Boost or suppress YouTube videos"
                  />
                </div>
                <p className="mt-3 text-xs text-[#52525b]">
                  0 = never show · 50 = default · 100 = always prioritize
                </p>
              </section>

              <section>
                <h3 className="text-xs font-semibold text-[#71717a] uppercase tracking-wider mb-4">
                  Display
                </h3>
                <div className="space-y-5">
                  <Toggle
                    label="Compact mode"
                    checked={display.compactMode}
                    onChange={(v) => handleDisplayChange({ compactMode: v })}
                    description="Smaller cards with less whitespace"
                  />
                  <Toggle
                    label="Show engagement counts"
                    checked={display.showEngagementCounts}
                    onChange={(v) => handleDisplayChange({ showEngagementCounts: v })}
                    description="Show likes, reposts, and views on posts"
                  />
                </div>
              </section>
            </>
          )}

          {tab === "sync" && (
            <>
              <div>
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
              </div>

              <div className="pt-4 border-t border-[rgba(255,255,255,0.08)]">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-[#71717a]">Freed Desktop</span>
                  <span className="text-[#a1a1aa]">v0.1.0</span>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
