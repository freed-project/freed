"use client";

import {
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { ThemePreviewButton } from "@freed/ui/components/ThemePreviewButton";
import { Tooltip } from "@freed/ui/components/Tooltip";
import { THEME_DEFINITIONS, useTheme } from "@/context/ThemeContext";

interface ThemeSelectorProps {
  compact?: boolean;
}

interface LockedRect {
  height: number;
  left: number;
  top: number;
  width: number;
}

export default function ThemeSelector({ compact = false }: ThemeSelectorProps) {
  const { activeThemeId, themeId, setThemeId, previewTheme, revertPreview } = useTheme();
  const gapClassName = compact ? "gap-2" : "gap-3";
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const [pointerPreviewThemeId, setPointerPreviewThemeId] = useState<string | null>(null);
  const [lockedRect, setLockedRect] = useState<LockedRect | null>(null);
  const shouldLockPosition = compact && pointerPreviewThemeId !== null && activeThemeId !== themeId;

  useLayoutEffect(() => {
    if (!shouldLockPosition) {
      setLockedRect(null);
      return;
    }

    const wrapper = wrapperRef.current;
    if (!wrapper) {
      return;
    }

    const rect = wrapper.getBoundingClientRect();
    setLockedRect({
      height: rect.height,
      left: rect.left,
      top: rect.top,
      width: rect.width,
    });
  }, [shouldLockPosition]);

  function clearPointerPreview() {
    setPointerPreviewThemeId(null);
    revertPreview();
  }

  return (
    <div
      ref={wrapperRef}
      className="relative"
      style={lockedRect ? { height: `${lockedRect.height}px` } : undefined}
    >
      <div
        className="flex flex-col"
        style={lockedRect ? {
          left: `${lockedRect.left}px`,
          position: "fixed",
          top: `${lockedRect.top}px`,
          width: `${lockedRect.width}px`,
          zIndex: 40,
        } : undefined}
      >
        <h4 className="mb-4 text-text-primary font-semibold">Theme</h4>
        <div
          className={`flex flex-wrap items-center ${gapClassName}`}
          onMouseLeave={clearPointerPreview}
          onBlurCapture={(event) => {
            const nextFocused = event.relatedTarget;
            if (nextFocused && event.currentTarget.contains(nextFocused)) {
              return;
            }

            clearPointerPreview();
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
                active={themeId === theme.id}
                variant="compact"
                onMouseEnter={() => {
                  setPointerPreviewThemeId(theme.id);
                  previewTheme(theme.id);
                }}
                onFocus={() => previewTheme(theme.id)}
                onClick={() => {
                  setPointerPreviewThemeId(null);
                  setThemeId(theme.id);
                }}
              />
            </Tooltip>
          ))}
        </div>
      </div>
    </div>
  );
}
