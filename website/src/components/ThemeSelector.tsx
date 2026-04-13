"use client";

import { ThemePreviewButton } from "@freed/ui/components/ThemePreviewButton";
import { Tooltip } from "@freed/ui/components/Tooltip";
import { THEME_DEFINITIONS, useTheme } from "@/context/ThemeContext";

interface ThemeSelectorProps {
  compact?: boolean;
}

export default function ThemeSelector({ compact = false }: ThemeSelectorProps) {
  const { themeId, setThemeId } = useTheme();
  const gapClassName = compact ? "gap-2" : "gap-3";

  return (
    <div className="flex flex-col">
      <h4 className="mb-4 text-text-primary font-semibold">Theme</h4>
      <div className={`flex flex-wrap items-center ${gapClassName}`}>
        {THEME_DEFINITIONS.map((theme) => (
          <Tooltip
            key={theme.id}
            side="top"
            label={theme.name}
            description={theme.description}
            className="h-[2.2rem] items-center sm:h-[2.4rem]"
          >
            <ThemePreviewButton
              theme={theme}
              active={themeId === theme.id}
              variant="compact"
              onClick={() => setThemeId(theme.id)}
            />
          </Tooltip>
        ))}
      </div>
    </div>
  );
}
