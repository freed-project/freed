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
      className="group flex w-full items-start gap-3 rounded-xl px-2 py-1.5 text-left transition-colors hover:bg-[rgb(var(--theme-control-accent-rgb)/0.08)]"
    >
      <div
        className={`relative mt-0.5 h-4.5 w-8 shrink-0 rounded-full border transition-colors ${
          checked
            ? "border-[color:rgb(var(--theme-control-accent-rgb)/0.42)] bg-[color:rgb(var(--theme-control-accent-rgb)/0.68)]"
            : "border-[var(--theme-border-subtle)] bg-[var(--theme-bg-muted)]"
        }`}
      >
        <div
          className={`absolute top-0.5 left-0.5 h-3.5 w-3.5 rounded-full border border-[rgb(var(--theme-control-accent-rgb)/0.12)] bg-[var(--theme-button-primary-text)] shadow transition-transform ${
            checked ? "translate-x-3.5" : "translate-x-0"
          }`}
        />
      </div>
      <div className="min-w-0">
        <p className="text-sm text-[var(--theme-text-secondary)] group-hover:text-[var(--theme-text-primary)] transition-colors">{label}</p>
        {description ? <p className="mt-0.5 text-xs text-[var(--theme-text-soft)]">{description}</p> : null}
      </div>
    </button>
  );
}
