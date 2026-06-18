import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import {
  formatShortcutForDisplay,
  formatShortcutForDisplayParts,
  shortcutFromKeyboardEvent,
  type ClipboardSaveShortcutConfig,
  type ClipboardSaveShortcutStatus,
} from "../lib/clipboard-save-shortcut";

interface DesktopShortcutsSettingsSectionProps {
  config: ClipboardSaveShortcutConfig | null;
  status: ClipboardSaveShortcutStatus;
  setConfig: (next: ClipboardSaveShortcutConfig) => Promise<void>;
  resetConfig: () => Promise<void>;
}

function statusText(status: ClipboardSaveShortcutStatus): string {
  switch (status.status) {
    case "loading":
      return "Loading shortcut settings";
    case "active":
      return "Registered system wide";
    case "disabled":
      return status.message ?? "Shortcut disabled";
    case "conflict":
    case "error":
      return status.message ?? "Shortcut unavailable";
  }
}

function statusClass(status: ClipboardSaveShortcutStatus): string {
  switch (status.status) {
    case "active":
      return "theme-feedback-text-success";
    case "conflict":
    case "error":
      return "theme-feedback-text-danger";
    default:
      return "text-text-muted";
  }
}

function ShortcutKeycaps({ keys }: { keys: string[] }) {
  return (
    <span className="flex flex-nowrap items-center justify-center gap-1.5">
      {keys.map((key, index) => (
        <kbd
          key={`${key}-${index}`}
          className="min-w-8 rounded-md border border-[var(--theme-border-subtle)] bg-[var(--theme-bg-input)] px-2 py-1 text-center font-sans text-xs font-semibold leading-none text-text-primary shadow-[inset_0_1px_0_rgb(255_255_255_/_0.04)]"
        >
          {key}
        </kbd>
      ))}
    </span>
  );
}

export function DesktopShortcutsSettingsSection({
  config,
  status,
  setConfig,
  resetConfig,
}: DesktopShortcutsSettingsSectionProps) {
  const [recording, setRecording] = useState(false);
  const recorderRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (recording) {
      recorderRef.current?.focus();
    }
  }, [recording]);

  const handleKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (!recording || !config) return;
    event.preventDefault();
    event.stopPropagation();

    if (event.key === "Escape") {
      setRecording(false);
      return;
    }

    const shortcut = shortcutFromKeyboardEvent(event.nativeEvent);
    if (!shortcut) return;
    setRecording(false);
    void setConfig({
      enabled: true,
      shortcut,
    });
  };

  const disabled = !config;
  const shortcutLabel = config
    ? formatShortcutForDisplay(config.shortcut)
    : "Loading";
  const shortcutKeys = config
    ? formatShortcutForDisplayParts(config.shortcut)
    : [];

  return (
    <div className="space-y-4">
      <div data-testid="settings-shortcuts-save-content-card" className="theme-card-soft rounded-2xl p-4 sm:p-5">
        <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
          <div className="min-w-0">
            <p className="text-sm font-semibold text-text-primary">Save Content</p>
            <p className="mt-1 text-xs text-text-muted">
              Opens Save Content and fills the URL field when your clipboard holds a link.
            </p>
          </div>
          <button
            ref={recorderRef}
            type="button"
            aria-label={
              recording
                ? "Record Save Content shortcut. Press shortcut"
                : `Record Save Content shortcut. Current shortcut ${config?.enabled ? shortcutLabel : "Disabled"}`
            }
            onClick={() => setRecording(true)}
            onKeyDown={handleKeyDown}
            disabled={disabled}
            className="theme-input flex min-h-11 w-fit min-w-56 items-center justify-center rounded-xl px-4 py-2 text-center text-sm text-text-primary focus:outline-none focus:ring-2 focus:ring-[var(--theme-accent-secondary)] disabled:cursor-not-allowed disabled:opacity-50"
          >
            {recording ? "Press shortcut" : config?.enabled ? (
              <ShortcutKeycaps keys={shortcutKeys} />
            ) : "Disabled"}
          </button>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-2">
          <button
            type="button"
            className="btn-secondary px-3 py-2 text-sm"
            disabled={disabled || !config.enabled}
            onClick={() => {
              if (!config) return;
              void setConfig({ ...config, enabled: false });
            }}
          >
            Disable
          </button>
          <button
            type="button"
            className="btn-secondary px-3 py-2 text-sm"
            disabled={disabled}
            onClick={() => {
              void resetConfig();
            }}
          >
            Reset to default
          </button>
          <p className={`text-xs ${statusClass(status)}`}>{statusText(status)}</p>
        </div>
      </div>
    </div>
  );
}
