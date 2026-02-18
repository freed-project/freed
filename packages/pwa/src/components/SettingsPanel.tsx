import { useState, useCallback } from "react";
import { useAppStore } from "../lib/store";
import type { UserPreferences, WeightPreferences } from "@freed/shared";

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

export function SettingsPanel({ open, onClose }: SettingsPanelProps) {
  const preferences = useAppStore((s) => s.preferences);
  const updatePreferences = useAppStore((s) => s.updatePreferences);

  // Local draft state — applied immediately on change
  const [weights, setWeights] = useState<WeightPreferences>(
    () => preferences.weights,
  );
  const [display, setDisplay] = useState(() => preferences.display);

  // Sync local draft with store when opened
  // (use key prop on parent instead of resetting here for simplicity)

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

  const handleReadingChange = useCallback(
    (update: Partial<typeof display.reading>) => {
      setDisplay((prev) => {
        const next = {
          ...prev,
          reading: { ...prev.reading, ...update },
        };
        updatePreferences({ display: next });
        return next;
      });
    },
    [updatePreferences],
  );

  if (!open) return null;

  const platformWeights = weights.platforms ?? {};

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Panel */}
      <div className="relative w-full sm:max-w-md sm:mx-4 bg-[#141414] border border-[rgba(255,255,255,0.08)] rounded-t-2xl sm:rounded-2xl shadow-2xl max-h-[85vh] flex flex-col">
        {/* Mobile drag handle */}
        <div className="sm:hidden w-12 h-1 bg-white/20 rounded-full mx-auto mt-4 mb-1 shrink-0" />

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[rgba(255,255,255,0.08)] shrink-0">
          <h2 className="text-lg font-semibold">Settings</h2>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-white/10 text-[#71717a] hover:text-white transition-colors"
            aria-label="Close settings"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Scrollable content */}
        <div className="overflow-y-auto flex-1 px-6 py-5 space-y-8">

          {/* Ranking */}
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
                description="Boost or suppress X posts in your feed"
              />
              <Slider
                label="RSS"
                value={platformWeights["rss"] ?? 50}
                onChange={(v) => handleWeightChange("platforms.rss", v)}
                description="Boost or suppress RSS articles in your feed"
              />
              <Slider
                label="YouTube"
                value={platformWeights["youtube"] ?? 50}
                onChange={(v) => handleWeightChange("platforms.youtube", v)}
                description="Boost or suppress YouTube videos in your feed"
              />
            </div>
            <p className="mt-3 text-xs text-[#52525b]">
              0 = never show · 50 = default · 100 = always prioritize
            </p>
          </section>

          {/* Display */}
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

          {/* Reading */}
          <section>
            <h3 className="text-xs font-semibold text-[#71717a] uppercase tracking-wider mb-4">
              Reading
            </h3>
            <div className="space-y-5">
              <Toggle
                label="Focus mode"
                checked={display.reading.focusMode}
                onChange={(v) => handleReadingChange({ focusMode: v })}
                description="Bold word beginnings to aid reading speed"
              />
              {display.reading.focusMode && (
                <div className="space-y-2">
                  <p className="text-sm text-[#a1a1aa]">Focus intensity</p>
                  <div className="flex gap-2">
                    {(["light", "normal", "strong"] as const).map((level) => (
                      <button
                        key={level}
                        onClick={() => handleReadingChange({ focusIntensity: level })}
                        className={`flex-1 py-1.5 rounded-lg text-sm capitalize transition-colors ${
                          display.reading.focusIntensity === level
                            ? "bg-[#8b5cf6]/20 text-[#8b5cf6] border border-[#8b5cf6]/30"
                            : "bg-white/5 text-[#71717a] hover:text-white"
                        }`}
                      >
                        {level}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </section>

          {/* About */}
          <section className="pb-2">
            <h3 className="text-xs font-semibold text-[#71717a] uppercase tracking-wider mb-3">
              About
            </h3>
            <p className="text-xs text-[#52525b] leading-relaxed">
              Freed is a local-first feed reader. Your data lives on your device
              and syncs between your own devices. We never see your content.
            </p>
            <p className="text-xs text-[#3f3f46] mt-2">
              MIT Licensed · freed.wtf
            </p>
          </section>
        </div>
      </div>
    </div>
  );
}
