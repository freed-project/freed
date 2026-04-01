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
      className="flex w-full items-start gap-3 text-left group"
    >
      <div
        className={`relative mt-0.5 h-4.5 w-8 shrink-0 rounded-full transition-colors ${
          checked ? "bg-[#8b5cf6]" : "bg-[#27272a]"
        }`}
      >
        <div
          className={`absolute top-0.5 left-0.5 h-3.5 w-3.5 rounded-full bg-white shadow transition-transform ${
            checked ? "translate-x-3.5" : "translate-x-0"
          }`}
        />
      </div>
      <div className="min-w-0">
        <p className="text-sm text-[#a1a1aa] group-hover:text-[#fafafa] transition-colors">{label}</p>
        {description ? <p className="text-xs text-[#52525b] mt-0.5">{description}</p> : null}
      </div>
    </button>
  );
}
