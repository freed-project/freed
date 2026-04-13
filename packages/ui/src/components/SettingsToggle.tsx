import type { ReactNode } from "react";

interface SettingsToggleProps {
  label: string;
  checked: boolean;
  onChange: (nextChecked: boolean) => void;
  description?: ReactNode;
}

export function SettingsToggle({
  label,
  checked,
  onChange,
  description,
}: SettingsToggleProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className="group flex w-full items-center gap-3 rounded-xl px-2 py-2 text-left transition-colors hover:bg-[rgb(var(--theme-control-accent-rgb)/0.08)]"
    >
      <div
        aria-hidden="true"
        className={`relative flex h-5 w-9 shrink-0 items-center rounded-full border px-[2px] transition-colors ${
          checked
            ? "border-[color:rgb(var(--theme-control-accent-rgb)/0.42)] bg-[color:rgb(var(--theme-control-accent-rgb)/0.68)]"
            : "border-[var(--theme-border-subtle)] bg-[var(--theme-bg-muted)]"
        }`}
      >
        <span
          className={`block h-4 w-4 rounded-full border border-[rgb(var(--theme-control-accent-rgb)/0.12)] bg-[var(--theme-button-primary-text)] shadow-[0_1px_3px_rgb(0_0_0_/_0.22)] transition-transform ${
            checked ? "translate-x-4" : "translate-x-0"
          }`}
        />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-sm text-[var(--theme-text-secondary)] transition-colors group-hover:text-[var(--theme-text-primary)]">{label}</p>
        {description ? <p className="mt-0.5 text-xs text-[var(--theme-text-soft)]">{description}</p> : null}
      </div>
    </button>
  );
}
