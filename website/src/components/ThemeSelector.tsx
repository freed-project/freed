"use client";

import { THEME_DEFINITIONS, useTheme } from "@/context/ThemeContext";

interface ThemeSelectorProps {
  compact?: boolean;
}

export default function ThemeSelector({ compact = false }: ThemeSelectorProps) {
  const { themeId, setThemeId } = useTheme();

  return (
    <label className="flex flex-col gap-2">
      <span className="text-xs font-semibold uppercase tracking-[0.18em] text-text-muted">
        Theme
      </span>
      <select
        value={themeId}
        onChange={(event) => setThemeId(event.target.value as typeof themeId)}
        className={`rounded-xl border border-freed-border bg-freed-surface/70 text-text-primary focus:outline-none focus:border-glow-purple ${
          compact ? "px-3 py-2 text-sm" : "px-4 py-3 text-sm"
        }`}
      >
        {THEME_DEFINITIONS.map((theme) => (
          <option key={theme.id} value={theme.id}>
            {theme.name}
          </option>
        ))}
      </select>
    </label>
  );
}
