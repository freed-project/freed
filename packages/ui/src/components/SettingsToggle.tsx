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
    <label className="flex items-start gap-3 cursor-pointer group">
      <div className="relative shrink-0 mt-0.5">
        <input
          type="checkbox"
          checked={checked}
          onChange={(event) => onChange(event.target.checked)}
          className="sr-only peer"
        />
        <div className="w-8 h-4.5 bg-[#27272a] rounded-full peer peer-checked:bg-[#8b5cf6] transition-colors" />
        <div className="absolute top-0.5 left-0.5 w-3.5 h-3.5 bg-white rounded-full shadow transition-transform peer-checked:translate-x-3.5" />
      </div>
      <div>
        <p className="text-sm text-[#a1a1aa] group-hover:text-[#fafafa] transition-colors">{label}</p>
        {description ? <p className="text-xs text-[#52525b] mt-0.5">{description}</p> : null}
      </div>
    </label>
  );
}
