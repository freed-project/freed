"use client";

import { ThemePreviewButton } from "@freed/ui/components/ThemePreviewButton";
import { Tooltip } from "@freed/ui/components/Tooltip";
import { THEME_DEFINITIONS, useTheme } from "@/context/ThemeContext";

interface ThemeSelectorProps {
  compact?: boolean;
}

export default function ThemeSelector({ compact = false }: ThemeSelectorProps) {
  const { activeThemeId, setThemeId, previewTheme, revertPreview } = useTheme();
  const gapClassName = compact ? "gap-2" : "gap-3";

  return (
    <div className="flex flex-col">
      <h4 className="mb-4 text-text-primary font-semibold">Theme</h4>
      <div
        className={`flex flex-wrap items-center ${gapClassName}`}
        onMouseLeave={revertPreview}
        onBlurCapture={(event) => {
          const nextFocused = event.relatedTarget;
          if (nextFocused && event.currentTarget.contains(nextFocused)) {
            return;
          }

          revertPreview();
        }}
      >
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
              active={activeThemeId === theme.id}
              variant="compact"
              onMouseEnter={() => previewTheme(theme.id)}
              onFocus={() => previewTheme(theme.id)}
              onClick={() => setThemeId(theme.id)}
            />
          </Tooltip>
        ))}
      </div>
    </div>
  );
}
