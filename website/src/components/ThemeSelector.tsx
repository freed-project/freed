"use client";

import {
  useEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import type { ThemeId } from "@freed/shared/themes";
import { ThemePreviewButton } from "@freed/ui/components/ThemePreviewButton";
import { Tooltip } from "@freed/ui/components/Tooltip";
import { THEME_DEFINITIONS, useTheme } from "@/context/ThemeContext";

interface ThemeSelectorProps {
  compact?: boolean;
}

interface FloatingRect {
  left: number;
  top: number;
  width: number;
}

export default function ThemeSelector({ compact = false }: ThemeSelectorProps) {
  const { themeId, setThemeId, previewTheme, revertPreview } = useTheme();
  const gapClassName = compact ? "gap-2" : "gap-3";
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const [floatingRect, setFloatingRect] = useState<FloatingRect | null>(null);
  const isFloating = compact && floatingRect !== null;

  useEffect(() => {
    if (!isFloating) {
      return;
    }

    function clearFloatingPreview() {
      setFloatingRect(null);
      revertPreview();
    }

    window.addEventListener("resize", clearFloatingPreview);
    window.addEventListener("scroll", clearFloatingPreview, true);
    return () => {
      window.removeEventListener("resize", clearFloatingPreview);
      window.removeEventListener("scroll", clearFloatingPreview, true);
    };
  }, [isFloating, revertPreview]);

  function activatePreview(themeId: ThemeId) {
    if (compact && floatingRect === null) {
      const rect = wrapperRef.current?.getBoundingClientRect();
      if (rect) {
        setFloatingRect({
          left: rect.left,
          top: rect.top,
          width: rect.width,
        });
      }
    }

    previewTheme(themeId);
  }

  function clearPreview() {
    setFloatingRect(null);
    revertPreview();
  }

  function commitTheme(themeId: ThemeId) {
    setFloatingRect(null);
    setThemeId(themeId);
  }

  function renderSelectorContent() {
    return (
      <>
        <h4 className="mb-4 text-text-primary font-semibold">Theme</h4>
        <div
          className={`flex flex-wrap items-center ${gapClassName}`}
          onMouseLeave={clearPreview}
          onBlurCapture={(event) => {
            const nextFocused = event.relatedTarget;
            if (nextFocused && event.currentTarget.contains(nextFocused)) {
              return;
            }

            clearPreview();
          }}
        >
          {THEME_DEFINITIONS.map((theme) => (
            <div
              key={theme.id}
              className="flex items-center"
              onMouseEnter={() => activatePreview(theme.id)}
            >
              <Tooltip
                side="top"
                label={theme.name}
                description={theme.description}
                className="h-[2.2rem] items-center sm:h-[2.4rem]"
              >
                <ThemePreviewButton
                  theme={theme}
                  active={themeId === theme.id}
                  variant="compact"
                  onFocus={() => previewTheme(theme.id)}
                  onClick={() => commitTheme(theme.id)}
                />
              </Tooltip>
            </div>
          ))}
        </div>
      </>
    );
  }

  return (
    <div ref={wrapperRef} className="relative">
      <div
        aria-hidden={isFloating || undefined}
        className="flex flex-col"
        style={isFloating ? { visibility: "hidden" } : undefined}
      >
        {renderSelectorContent()}
      </div>
      {isFloating && typeof document !== "undefined"
        ? createPortal(
          <div
            className="fixed z-[80]"
            style={{
              left: `${floatingRect!.left}px`,
              top: `${floatingRect!.top}px`,
              width: `${floatingRect!.width}px`,
            }}
          >
            <div className="flex flex-col">
              {renderSelectorContent()}
            </div>
          </div>,
          document.body,
        )
        : null}
    </div>
  );
}
