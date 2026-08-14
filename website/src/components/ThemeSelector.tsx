"use client";

import {
  useCallback,
  useEffect,
  useRef,
  type FocusEvent as ReactFocusEvent,
} from "react";
import type { ThemeId } from "@freed/shared/themes";
import { ThemePreviewButton } from "@freed/ui/components/ThemePreviewButton";
import { Tooltip } from "@freed/ui/components/Tooltip";
import { THEME_DEFINITIONS, useTheme } from "@/context/ThemeContext";

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

export default function ThemeSelector() {
  const { themeId, setThemeId, previewTheme, revertPreview } = useTheme();
  const orderedThemes = [...THEME_DEFINITIONS].sort(
    (a, b) => displayRank(a.id) - displayRank(b.id),
  );
  // Freed Desktop previews the complete theme on hover and focus. On the
  // website, a font change can reflow everything above this footer. Anchor the
  // real grid with scroll compensation so it never detaches from its footer or
  // moves out from under the pointer. A cloned fixed layer caused both defects.
  const gridRef = useRef<HTMLDivElement | null>(null);
  const anchorTopRef = useRef<number | null>(null);
  const anchorFrameRef = useRef<number | null>(null);
  const anchorRequestedRef = useRef(false);
  const anchorStableFramesRef = useRef(0);
  const committedThemeIdRef = useRef(themeId);
  const revertPreviewRef = useRef(revertPreview);
  const previousInlineScrollBehaviorRef = useRef<string | null>(null);

  committedThemeIdRef.current = themeId;
  revertPreviewRef.current = revertPreview;

  const stopSelectorAnchor = useCallback(() => {
    if (anchorFrameRef.current !== null) {
      window.cancelAnimationFrame(anchorFrameRef.current);
      anchorFrameRef.current = null;
    }

    anchorTopRef.current = null;
    anchorStableFramesRef.current = 0;

    if (previousInlineScrollBehaviorRef.current !== null) {
      const root = document.documentElement;
      const previousScrollBehavior = previousInlineScrollBehaviorRef.current;
      if (previousScrollBehavior) {
        root.style.scrollBehavior = previousScrollBehavior;
      } else {
        root.style.removeProperty("scroll-behavior");
      }
      previousInlineScrollBehaviorRef.current = null;
    }
  }, []);

  const keepSelectorAnchored = useCallback(function anchorFrame() {
    const grid = gridRef.current;
    const anchorTop = anchorTopRef.current;
    if (!grid || anchorTop === null) {
      stopSelectorAnchor();
      return;
    }

    const delta = grid.getBoundingClientRect().top - anchorTop;
    const scrollBeforeCorrection = window.scrollY;
    if (Math.abs(delta) > 0.25) {
      // The stylesheet enables smooth scrolling globally. startSelectorAnchor
      // temporarily overrides it so this correction lands before the next paint.
      window.scrollBy(0, delta);
    }

    const correctionApplied = Math.abs(window.scrollY - scrollBeforeCorrection) > 0.25;
    if (Math.abs(delta) <= 0.25 || !correctionApplied) {
      anchorStableFramesRef.current += 1;
    } else {
      anchorStableFramesRef.current = 0;
    }

    const root = document.documentElement;
    const committedThemeRestored = root.dataset.theme === committedThemeIdRef.current;
    const transitionFinished = root.dataset.themeTransition === undefined;
    if (
      !anchorRequestedRef.current
      && committedThemeRestored
      && transitionFinished
      && anchorStableFramesRef.current >= 3
    ) {
      stopSelectorAnchor();
      return;
    }

    anchorFrameRef.current = window.requestAnimationFrame(anchorFrame);
  }, [stopSelectorAnchor]);

  const startSelectorAnchor = useCallback(() => {
    anchorRequestedRef.current = true;
    anchorStableFramesRef.current = 0;

    if (anchorTopRef.current === null && gridRef.current) {
      anchorTopRef.current = gridRef.current.getBoundingClientRect().top;
      const root = document.documentElement;
      previousInlineScrollBehaviorRef.current = root.style.scrollBehavior;
      root.style.scrollBehavior = "auto";
    }

    if (anchorFrameRef.current === null) {
      anchorFrameRef.current = window.requestAnimationFrame(keepSelectorAnchored);
    }
  }, [keepSelectorAnchored]);

  const settleSelectorAnchor = useCallback(() => {
    anchorRequestedRef.current = false;
    anchorStableFramesRef.current = 0;
    if (anchorTopRef.current !== null && anchorFrameRef.current === null) {
      anchorFrameRef.current = window.requestAnimationFrame(keepSelectorAnchored);
    }
  }, [keepSelectorAnchored]);

  const activatePreview = useCallback((nextThemeId: ThemeId) => {
    startSelectorAnchor();
    previewTheme(nextThemeId);
  }, [previewTheme, startSelectorAnchor]);

  const clearPreview = useCallback(() => {
    revertPreview();
    settleSelectorAnchor();
  }, [revertPreview, settleSelectorAnchor]);

  const commitTheme = useCallback((nextThemeId: ThemeId) => {
    committedThemeIdRef.current = nextThemeId;
    setThemeId(nextThemeId);
    settleSelectorAnchor();
  }, [setThemeId, settleSelectorAnchor]);

  const handleBlurCapture = useCallback((event: ReactFocusEvent<HTMLDivElement>) => {
    if (event.relatedTarget && event.currentTarget.contains(event.relatedTarget)) {
      return;
    }

    clearPreview();
  }, [clearPreview]);

  useEffect(() => {
    const cancelPreviewForViewportChange = () => {
      anchorRequestedRef.current = false;
      stopSelectorAnchor();
      revertPreviewRef.current();
    };

    window.addEventListener("resize", cancelPreviewForViewportChange);
    window.addEventListener("wheel", cancelPreviewForViewportChange, { passive: true });
    window.addEventListener("touchmove", cancelPreviewForViewportChange, { passive: true });
    return () => {
      window.removeEventListener("resize", cancelPreviewForViewportChange);
      window.removeEventListener("wheel", cancelPreviewForViewportChange);
      window.removeEventListener("touchmove", cancelPreviewForViewportChange);
    };
  }, [stopSelectorAnchor]);

  useEffect(() => {
    return () => {
      anchorRequestedRef.current = false;
      stopSelectorAnchor();
      revertPreviewRef.current();
    };
  }, [stopSelectorAnchor]);

  return (
    <div>
      <h4 className="mb-4 font-semibold text-text-primary">Theme</h4>
      <div
        role="group"
        aria-label="Theme"
        className="website-theme-grid"
        data-theme-selector-layer="inline"
        ref={gridRef}
        onMouseLeave={clearPreview}
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
              onFocus={() => activatePreview(theme.id)}
              onClick={() => commitTheme(theme.id)}
              className="website-theme-swatch"
            />
          </Tooltip>
        ))}
      </div>
    </div>
  );
}
