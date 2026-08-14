"use client";

import type { FocusEvent } from "react";
import { ThemePreviewButton } from "@freed/ui/components/ThemePreviewButton";
import { Tooltip } from "@freed/ui/components/Tooltip";
import { THEME_DEFINITIONS, useTheme } from "@/context/ThemeContext";

// Light themes on the first row, dark themes on the second. THEME_DEFINITIONS
// is ordered for other consumers, so the grid carries its own order instead.
const THEME_DISPLAY_ORDER: readonly string[] = [
  "ember",
  "midas",
  "scriptorium",
  "starship",
  "dark-star",
  "neon",
];

// Fixed row slots. Hovering a swatch previews the theme and restyles the
// button, so content-sized rows would let one swatch resize its own row and
// shove the other row down. Reserving the slot and centring inside it makes
// that shift impossible regardless of what any hover or active state does.
const THEME_GRID_CLASS =
  "grid w-fit grid-cols-[repeat(3,max-content)] [grid-auto-rows:1.5rem] items-center gap-2";

function displayRank(id: string): number {
  const index = THEME_DISPLAY_ORDER.indexOf(id);
  // A theme added later but not placed here sorts to the end rather than vanishing.
  return index === -1 ? THEME_DISPLAY_ORDER.length : index;
}

export default function ThemeSelector() {
  const { themeId, setThemeId, previewTheme, revertPreview } = useTheme();
  const orderedThemes = [...THEME_DEFINITIONS].sort(
    (a, b) => displayRank(a.id) - displayRank(b.id),
  );

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
        className={THEME_GRID_CLASS}
        onMouseLeave={revertPreview}
        onBlurCapture={handleBlur}
      >
        {orderedThemes.map((theme) => (
          <Tooltip
            key={theme.id}
            side="top"
            label={theme.name}
            description={theme.description}
            className="items-center"
          >
            <ThemePreviewButton
              theme={theme}
              active={themeId === theme.id}
              variant="compact"
              onMouseEnter={() => previewTheme(theme.id)}
              onFocus={() => previewTheme(theme.id)}
              onClick={() => setThemeId(theme.id)}
              className="website-theme-swatch"
            />
          </Tooltip>
        ))}
      </div>
    </div>
  );
}
