import { useState, useCallback, useRef } from "react";
import { useAppStore, usePlatform } from "../context/PlatformContext";
import { BottomSheet } from "./BottomSheet";

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
  const { SettingsExtraSections, checkForUpdates, applyUpdate, headerDragRegion } = usePlatform();
  const preferences = useAppStore((s) => s.preferences);
  const updatePreferences = useAppStore((s) => s.updatePreferences);

  const [display, setDisplay] = useState(() => preferences.display);
  const [updateState, setUpdateState] = useState<UpdateCheckState>({
    status: "idle",
  });
  const fadeTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

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
        fadeTimer.current = setTimeout(
          () => setUpdateState({ status: "idle" }),
          4000,
        );
      }
    } catch {
      setUpdateState({ status: "error" });
      clearTimeout(fadeTimer.current);
      fadeTimer.current = setTimeout(
        () => setUpdateState({ status: "idle" }),
        4000,
      );
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
                      onClick={() =>
                        handleReadingChange({ focusIntensity: level })
                      }
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
              <span className="text-sm font-bold font-mono">
                v{__APP_VERSION__}
              </span>
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
                  <span className="text-xs text-green-400">
                    You're up to date
                  </span>
                )}
                {updateState.status === "available" && (
                  <span className="flex items-center gap-2">
                    <span className="text-xs text-[#8b5cf6]">
                      Update available
                    </span>
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
    </BottomSheet>
  );
}
