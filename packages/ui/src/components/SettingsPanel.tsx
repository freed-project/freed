import { useState, useCallback, useRef } from "react";
import { useAppStore, usePlatform } from "../context/PlatformContext.js";
import { BottomSheet } from "./BottomSheet.js";
import { useDebugStore } from "../lib/debug-store.js";

interface SettingsPanelProps {
  open: boolean;
  onClose: () => void;
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

type UpdateCheckState =
  | { status: "idle" }
  | { status: "checking" }
  | { status: "up-to-date" }
  | { status: "available"; version: string }
  | { status: "error" };

export function SettingsPanel({ open, onClose }: SettingsPanelProps) {
  const {
    SettingsExtraSections,
    checkForUpdates,
    applyUpdate,
    headerDragRegion,
    factoryReset,
    activeCloudProviderLabel,
  } = usePlatform();
  const preferences = useAppStore((s) => s.preferences);
  const toggleDebug = useDebugStore((s) => s.toggle);
  const updatePreferences = useAppStore((s) => s.updatePreferences);

  const [display, setDisplay] = useState(() => preferences.display);
  const [updateState, setUpdateState] = useState<UpdateCheckState>({ status: "idle" });
  const fadeTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const [showResetConfirm, setShowResetConfirm] = useState(false);
  const [deleteFromCloud, setDeleteFromCloud] = useState(false);
  const [resetting, setResetting] = useState(false);

  const handleCheckForUpdates = useCallback(async () => {
    if (!checkForUpdates) return;
    setUpdateState({ status: "checking" });
    try {
      const version = await checkForUpdates();
      const next: UpdateCheckState = version
        ? { status: "available", version }
        : { status: "up-to-date" };
      setUpdateState(next);
      if (next.status === "up-to-date") {
        clearTimeout(fadeTimer.current);
        fadeTimer.current = setTimeout(() => setUpdateState({ status: "idle" }), 4000);
      }
    } catch {
      setUpdateState({ status: "error" });
      clearTimeout(fadeTimer.current);
      fadeTimer.current = setTimeout(() => setUpdateState({ status: "idle" }), 4000);
    }
  }, [checkForUpdates]);

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

  const handleReset = useCallback(async () => {
    if (!factoryReset) return;
    setResetting(true);
    try {
      await factoryReset(deleteFromCloud);
    } catch {
      setResetting(false);
      setShowResetConfirm(false);
    }
  }, [factoryReset, deleteFromCloud]);

  return (
    <BottomSheet open={open} onClose={onClose} title="Settings">
      <div className="space-y-8">
        {/* Display */}
        <section>
          <h3 className="text-xs font-semibold text-[#71717a] uppercase tracking-wider mb-4">
            Display
          </h3>
          <div className="space-y-5">
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
                      className={`flex-1 py-1.5 rounded-lg text-sm capitalize transition-colors border ${
                        display.reading.focusIntensity === level
                          ? "bg-[#8b5cf6]/20 text-[#8b5cf6] border-[#8b5cf6]/30"
                          : "bg-white/5 text-[#71717a] hover:text-white border-transparent"
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

        {/* Platform-specific sections (e.g. Mobile Sync on desktop) */}
        {SettingsExtraSections && <SettingsExtraSections />}

        {/* Updates */}
        <section>
          <h3 className="text-xs font-semibold text-[#71717a] uppercase tracking-wider mb-4">
            Updates
          </h3>
          <div className="space-y-3">
            <p className="text-xs text-[#52525b]">
              Current version:{" "}
              <span className="text-sm font-bold font-mono">v{__APP_VERSION__}</span>
            </p>
            {checkForUpdates && (
              <div className="flex items-center gap-3">
                <button
                  onClick={handleCheckForUpdates}
                  disabled={updateState.status === "checking"}
                  className="text-sm px-3 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-[#a1a1aa] hover:text-white transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {updateState.status === "checking" ? (
                    <span className="flex items-center gap-2">
                      <span className="w-3 h-3 border-2 border-[#8b5cf6] border-t-transparent rounded-full animate-spin" />
                      Checking&hellip;
                    </span>
                  ) : (
                    "Check for updates"
                  )}
                </button>
                {updateState.status === "up-to-date" && (
                  <span className="text-xs text-green-400">You're up to date</span>
                )}
                {updateState.status === "available" && (
                  <span className="flex items-center gap-2">
                    <span className="text-xs text-[#8b5cf6]">Update available</span>
                    {applyUpdate && (
                      <button
                        onClick={applyUpdate}
                        className="text-xs font-semibold px-2.5 py-1 rounded-md bg-[#8b5cf6] text-white hover:bg-[#7c3aed] transition-colors"
                      >
                        {headerDragRegion ? "Install & Restart" : "Reload"}
                      </button>
                    )}
                  </span>
                )}
                {updateState.status === "error" && (
                  <span className="text-xs text-red-400">Check failed</span>
                )}
              </div>
            )}
          </div>
        </section>

        {/* Developer */}
        <section>
          <h3 className="text-xs font-semibold text-[#71717a] uppercase tracking-wider mb-4">
            Developer
          </h3>
          <button
            onClick={() => { onClose(); setTimeout(toggleDebug, 150); }}
            className="w-full flex items-center justify-between px-3 py-2.5 rounded-xl bg-white/5 hover:bg-white/10 transition-colors text-left"
          >
            <div>
              <p className="text-sm text-[#a1a1aa]">Open Debug Panel</p>
              <p className="text-xs text-[#52525b] mt-0.5">Sync diagnostics, event log, document inspector</p>
            </div>
            <span className="text-[10px] font-mono text-[#52525b] shrink-0 ml-3">⌘⇧D</span>
          </button>
        </section>

        {/* Danger Zone */}
        {factoryReset && (
          <section>
            <h3 className="text-xs font-semibold text-red-400/60 uppercase tracking-wider mb-4">
              Danger Zone
            </h3>
            <button
              onClick={() => setShowResetConfirm(true)}
              className="w-full flex items-center justify-between px-3 py-2.5 rounded-xl bg-red-500/5 hover:bg-red-500/10 border border-red-500/10 hover:border-red-500/20 transition-colors text-left"
            >
              <div>
                <p className="text-sm text-red-400">Reset this device</p>
                <p className="text-xs text-red-400/50 mt-0.5">
                  Wipes all local data and restarts fresh
                </p>
              </div>
              <svg className="w-4 h-4 text-red-400/40 shrink-0 ml-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
            </button>
          </section>
        )}

        {/* Footer */}
        <div className="pb-2 text-center">
          <a
            href="https://freed.wtf"
            target="_blank"
            rel="noopener noreferrer"
            className="text-sm font-medium text-[#8b5cf6] hover:text-[#a78bfa] transition-colors"
          >
            freed.wtf
          </a>
        </div>
      </div>

      {/* Factory reset confirmation overlay */}
      {showResetConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
          <div className="w-full max-w-sm bg-[#18181b] border border-[rgba(255,255,255,0.1)] rounded-2xl p-6 shadow-2xl">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-full bg-red-500/15 flex items-center justify-center flex-shrink-0">
                <svg className="w-5 h-5 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                </svg>
              </div>
              <div>
                <p className="text-sm font-semibold text-white">Reset this device?</p>
                <p className="text-xs text-[#71717a] mt-0.5">
                  Clears all local data on this device only.
                  {!deleteFromCloud && " Cloud sync will re-download your data on next launch."}
                </p>
              </div>
            </div>

            {activeCloudProviderLabel?.() && (
              <label className="flex items-start gap-3 mb-5 cursor-pointer group">
                <input
                  type="checkbox"
                  checked={deleteFromCloud}
                  onChange={(e) => setDeleteFromCloud(e.target.checked)}
                  className="mt-0.5 w-4 h-4 rounded border-[rgba(255,255,255,0.2)] bg-white/5 text-red-500 focus:ring-red-500 focus:ring-offset-0"
                />
                <div>
                  <p className="text-sm text-[#a1a1aa] group-hover:text-white transition-colors">
                    Also delete from {activeCloudProviderLabel()}
                  </p>
                  <p className="text-xs text-[#52525b] mt-0.5">
                    Permanently removes your cloud backup
                  </p>
                </div>
              </label>
            )}

            <div className="flex gap-3">
              <button
                onClick={() => { setShowResetConfirm(false); setDeleteFromCloud(false); }}
                disabled={resetting}
                className="flex-1 py-2.5 rounded-xl bg-white/5 hover:bg-white/10 text-[#a1a1aa] hover:text-white transition-colors text-sm disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={handleReset}
                disabled={resetting}
                className="flex-1 py-2.5 rounded-xl bg-red-500/20 hover:bg-red-500/30 text-red-400 hover:text-red-300 transition-colors text-sm font-medium disabled:opacity-50"
              >
                {resetting ? (
                  <span className="flex items-center justify-center gap-2">
                    <span className="w-3 h-3 border-2 border-red-400 border-t-transparent rounded-full animate-spin" />
                    Resetting&hellip;
                  </span>
                ) : (
                  "Reset Device"
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </BottomSheet>
  );
}
