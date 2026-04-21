"use client";

import {
  useEffect,
  useRef,
  useState,
  type FocusEvent as ReactFocusEvent,
  type MouseEvent as ReactMouseEvent,
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
  const floatingLayerRef = useRef<HTMLDivElement | null>(null);
  const ignoreNextInlineMouseLeaveRef = useRef(false);
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
        ignoreNextInlineMouseLeaveRef.current = true;
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
    ignoreNextInlineMouseLeaveRef.current = false;
    setFloatingRect(null);
    revertPreview();
  }

  function commitTheme(themeId: ThemeId) {
    ignoreNextInlineMouseLeaveRef.current = false;
    setFloatingRect(null);
    setThemeId(themeId);
  }

  function shouldKeepPreview(
    event:
      | ReactFocusEvent<HTMLDivElement>
      | ReactMouseEvent<HTMLDivElement>,
  ) {
    const nextTarget = event.relatedTarget;
    if (!(nextTarget instanceof Node)) {
      return false;
    }

    if (event.currentTarget.contains(nextTarget)) {
      return true;
    }

    return floatingLayerRef.current?.contains(nextTarget) ?? false;
  }

  function handleMouseLeave(
    layer: "inline" | "floating",
    event: ReactMouseEvent<HTMLDivElement>,
  ) {
    if (layer === "inline" && ignoreNextInlineMouseLeaveRef.current) {
      ignoreNextInlineMouseLeaveRef.current = false;
      return;
    }

    if (shouldKeepPreview(event)) {
      return;
    }

    clearPreview();
  }

  function handleBlurCapture(event: ReactFocusEvent<HTMLDivElement>) {
    if (shouldKeepPreview(event)) {
      return;
    }

    clearPreview();
  }

  function renderSelectorContent(layer: "inline" | "floating") {
    return (
      <>
        <h4 className="mb-4 text-text-primary font-semibold">Theme</h4>
        <div
          className={`flex flex-wrap items-center ${gapClassName}`}
          onMouseLeave={(event) => handleMouseLeave(layer, event)}
          onBlurCapture={handleBlurCapture}
        >
          {THEME_DEFINITIONS.map((theme) => (
            <div key={theme.id} className="flex items-center">
              <Tooltip
                side="top"
                label={theme.name}
                description={theme.description}
              >
                <ThemePreviewButton
                  theme={theme}
                  active={themeId === theme.id}
                  variant="compact"
                  onMouseEnter={() => activatePreview(theme.id)}
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
        {renderSelectorContent("inline")}
      </div>
      {isFloating && typeof document !== "undefined"
        ? createPortal(
          <div
            ref={floatingLayerRef}
            className="fixed z-[80]"
            style={{
              left: `${floatingRect!.left}px`,
              top: `${floatingRect!.top}px`,
              width: `${floatingRect!.width}px`,
            }}
          >
            <div className="flex flex-col">
              {renderSelectorContent("floating")}
            </div>
          </div>,
          document.body,
        )
        : null}
    </div>
  );
}
