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

// Light themes occupy the first row and dark themes occupy the second.
// THEME_DEFINITIONS serves other consumers, so this surface owns its order.
const THEME_DISPLAY_ORDER: readonly ThemeId[] = [
  "ember",
  "midas",
  "scriptorium",
  "starship",
  "dark-star",
  "neon",
];

function displayRank(id: ThemeId): number {
  const index = THEME_DISPLAY_ORDER.indexOf(id);
  return index === -1 ? THEME_DISPLAY_ORDER.length : index;
}

export default function ThemeSelector({ compact = false }: ThemeSelectorProps) {
  const { themeId, setThemeId, previewTheme, revertPreview } = useTheme();
  const orderedThemes = [...THEME_DEFINITIONS].sort(
    (a, b) => displayRank(a.id) - displayRank(b.id),
  );
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const inlineGridRef = useRef<HTMLDivElement | null>(null);
  const floatingGridRef = useRef<HTMLDivElement | null>(null);
  const ignoreNextInlineMouseLeaveRef = useRef(false);
  const [floatingRect, setFloatingRect] = useState<FloatingRect | null>(null);
  const [stableHeight, setStableHeight] = useState<number | null>(null);
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

  useEffect(() => {
    if (!wrapperRef.current || typeof ResizeObserver === "undefined") {
      return;
    }

    const recordHeight = () => {
      if (!wrapperRef.current) {
        return;
      }

      const nextHeight = Math.ceil(wrapperRef.current.getBoundingClientRect().height);
      setStableHeight((currentHeight) => {
        if (currentHeight !== null && currentHeight >= nextHeight) {
          return currentHeight;
        }

        return nextHeight;
      });
    };

    recordHeight();
    const observer = new ResizeObserver(recordHeight);
    observer.observe(wrapperRef.current);
    window.addEventListener("resize", recordHeight);

    return () => {
      observer.disconnect();
      window.removeEventListener("resize", recordHeight);
    };
  }, []);

  function activatePreview(nextThemeId: ThemeId) {
    if (compact && floatingRect === null) {
      const rect = wrapperRef.current?.getBoundingClientRect();
      if (rect) {
        // Theme previews can change page fonts and total document height. Keep
        // the interactive copy fixed at its captured viewport coordinates so
        // that global reflow cannot move the swatch out from under the pointer.
        ignoreNextInlineMouseLeaveRef.current = true;
        setFloatingRect({
          left: rect.left,
          top: rect.top,
          width: rect.width,
        });
      }
    }

    previewTheme(nextThemeId);
  }

  function clearPreview() {
    ignoreNextInlineMouseLeaveRef.current = false;
    setFloatingRect(null);
    revertPreview();
  }

  function commitTheme(nextThemeId: ThemeId) {
    ignoreNextInlineMouseLeaveRef.current = false;
    setFloatingRect(null);
    setThemeId(nextThemeId);
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

    return (
      inlineGridRef.current?.contains(nextTarget)
      || floatingGridRef.current?.contains(nextTarget)
      || false
    );
  }

  function handleMouseLeave(
    layer: "inline" | "floating",
    event: ReactMouseEvent<HTMLDivElement>,
  ) {
    if (layer === "inline" && ignoreNextInlineMouseLeaveRef.current) {
      ignoreNextInlineMouseLeaveRef.current = false;
      return;
    }

    if (!shouldKeepPreview(event)) {
      clearPreview();
    }
  }

  function handleBlurCapture(event: ReactFocusEvent<HTMLDivElement>) {
    if (!shouldKeepPreview(event)) {
      clearPreview();
    }
  }

  function handleButtonMouseLeave(
    layer: "inline" | "floating",
    event: ReactMouseEvent<HTMLButtonElement>,
  ) {
    if (layer === "inline" && ignoreNextInlineMouseLeaveRef.current) {
      ignoreNextInlineMouseLeaveRef.current = false;
      return;
    }

    const nextTarget = event.relatedTarget;
    if (
      nextTarget instanceof Element
      && nextTarget.closest(".theme-preview-button")
    ) {
      return;
    }

    clearPreview();
  }

  function renderSelectorContent(layer: "inline" | "floating") {
    return (
      <>
        <h4 className="mb-4 font-semibold text-text-primary">Theme</h4>
        <div
          ref={layer === "inline" ? inlineGridRef : floatingGridRef}
          role="group"
          aria-label="Theme"
          className="website-theme-grid"
          data-theme-selector-layer={layer}
          onMouseLeave={(event) => handleMouseLeave(layer, event)}
          onBlurCapture={handleBlurCapture}
        >
          {orderedThemes.map((theme) => (
            <Tooltip
              key={theme.id}
              side="top"
              label={theme.name}
              description={theme.description}
              className="items-center justify-center"
            >
              <ThemePreviewButton
                theme={theme}
                active={themeId === theme.id}
                variant="compact"
                onMouseEnter={() => activatePreview(theme.id)}
                onMouseLeave={(event) => handleButtonMouseLeave(layer, event)}
                onFocus={() => previewTheme(theme.id)}
                onClick={() => commitTheme(theme.id)}
                className="website-theme-swatch"
              />
            </Tooltip>
          ))}
        </div>
      </>
    );
  }

  return (
    <div
      ref={wrapperRef}
      className="relative"
      style={stableHeight ? { minHeight: `${stableHeight}px` } : undefined}
    >
      <div
        aria-hidden={isFloating || undefined}
        style={isFloating ? { visibility: "hidden" } : undefined}
      >
        {renderSelectorContent("inline")}
      </div>
      {isFloating && typeof document !== "undefined"
        ? createPortal(
          <div
            className="fixed z-[80]"
            style={{
              left: `${floatingRect.left}px`,
              top: `${floatingRect.top}px`,
              width: `${floatingRect.width}px`,
            }}
          >
            {renderSelectorContent("floating")}
          </div>,
          document.body,
        )
        : null}
    </div>
  );
}
