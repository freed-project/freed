"use client";

import type { FocusEvent } from "react";
import { ThemePreviewButton } from "@freed/ui/components/ThemePreviewButton";
import { Tooltip } from "@freed/ui/components/Tooltip";
import { THEME_DEFINITIONS, useTheme } from "@/context/ThemeContext";

export default function ThemeSelector() {
  const { themeId, setThemeId, previewTheme, revertPreview } = useTheme();

  function handleBlur(event: FocusEvent<HTMLDivElement>) {
    if (
      event.relatedTarget
      && event.currentTarget.contains(event.relatedTarget)
    ) {
      return;
    }

    revertPreview();
  }

  return (
    <div>
      <h4 className="mb-4 font-semibold text-text-primary">Theme</h4>
      <div
        role="group"
        aria-label="Theme"
        className="grid grid-cols-2 gap-2"
        onMouseLeave={revertPreview}
        onBlurCapture={handleBlur}
      >
        {THEME_DEFINITIONS.map((theme) => (
          <Tooltip
            key={theme.id}
            side="top"
            label={theme.name}
            description={theme.description}
            className="w-full min-w-0"
          >
            <span className="relative block w-full min-w-0">
              <ThemePreviewButton
                theme={theme}
                active={themeId === theme.id}
                variant="compact"
                onMouseEnter={() => previewTheme(theme.id)}
                onFocus={() => previewTheme(theme.id)}
                onClick={() => setThemeId(theme.id)}
                className="website-theme-grid-button"
              />
              <span
                aria-hidden="true"
                className="website-theme-grid-label pointer-events-none absolute inset-y-0 flex min-w-0 items-center truncate text-xs font-medium"
                style={{ fontFamily: theme.previewDisplayFont }}
              >
                {theme.name}
              </span>
            </span>
          </Tooltip>
        ))}
      </div>
    </div>
  );
}
