import { useRef, useCallback, useEffect, type ReactNode } from "react";
import { createPortal } from "react-dom";

interface BottomSheetProps {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  /** Dialog title rendered in the header bar */
  title: string;
  /** Tailwind max-width override for the panel (default: "sm:max-w-md") */
  maxWidth?: string;
  /** Whether to show the divider line under the header */
  headerDivider?: boolean;
}

const DISMISS_THRESHOLD = 100;
const RESISTANCE = 0.45;

/**
 * Mobile-first bottom sheet with swipe-to-dismiss.
 * Renders as a bottom sheet on mobile (items-end) and a centered dialog on
 * desktop (sm:items-center). The drag handle is functional on touch devices.
 */
export function BottomSheet({
  open,
  onClose,
  children,
  title,
  maxWidth = "sm:max-w-md",
  headerDivider = true,
}: BottomSheetProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const dragState = useRef<{ startY: number; currentY: number } | null>(null);

  // Lock body scroll while open
  useEffect(() => {
    if (open) {
      document.body.style.overflow = "hidden";
    }
    return () => {
      document.body.style.overflow = "";
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [open, onClose]);

  const applyTransform = useCallback((dy: number) => {
    if (!panelRef.current) return;
    panelRef.current.style.transform = dy > 0 ? `translateY(${dy}px)` : "";
    panelRef.current.style.transition = dy === 0 ? "transform 0.25s ease" : "none";
  }, []);

  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    const panel = panelRef.current;
    if (!panel) return;

    // Only initiate drag when the scrollable content is at the top
    const scrollable = panel.querySelector("[data-bottom-sheet-scroll]");
    if (scrollable && scrollable.scrollTop > 0) return;

    dragState.current = {
      startY: e.touches[0].clientY,
      currentY: e.touches[0].clientY,
    };
  }, []);

  const handleTouchMove = useCallback(
    (e: React.TouchEvent) => {
      if (!dragState.current) return;

      const clientY = e.touches[0].clientY;
      const rawDy = clientY - dragState.current.startY;

      // Only allow downward drag
      if (rawDy <= 0) {
        applyTransform(0);
        return;
      }

      dragState.current.currentY = clientY;
      applyTransform(rawDy * RESISTANCE);
    },
    [applyTransform],
  );

  const handleTouchEnd = useCallback(() => {
    if (!dragState.current) return;

    const rawDy = dragState.current.currentY - dragState.current.startY;
    dragState.current = null;

    if (rawDy > DISMISS_THRESHOLD) {
      // Slide out, then close
      applyTransform(window.innerHeight);
      setTimeout(onClose, 250);
    } else {
      applyTransform(0);
    }
  }, [applyTransform, onClose]);

  if (!open) return null;

  return createPortal(
    // Container spans 100lvh (full physical screen) so the panel background
    // bleeds behind the Safari address bar. --keyboard-height drives a
    // translateY that lifts the sheet above the software keyboard without
    // shrinking the container (which would lose the bleed).
    <div
      className="fixed inset-x-0 top-0 z-[140] flex items-end sm:items-center justify-center"
      style={{
        height: '100lvh',
        transform: 'translateY(calc(-1 * var(--keyboard-height, 0px)))',
      }}
    >
      {/* Backdrop */}
      <div
        className="theme-elevated-overlay absolute inset-0"
        onClick={onClose}
      />

      {/* Panel — max-height uses --visual-viewport-height (above keyboard + address
          bar) so the panel never overflows upward off-screen when the keyboard opens.
          85vh (≈ 85lvh on Safari) was the prior value; it allowed ~724 px panels
          even when only ~432 px of screen was visible, causing content to fly off
          the top edge. */}
      <div
        ref={panelRef}
        className={`theme-dialog-shell relative flex w-full ${maxWidth} flex-col rounded-t-[28px] sm:mx-4 sm:rounded-[28px]`}
        style={{ maxHeight: 'calc(var(--visual-viewport-height, 100dvh) * 0.85)' }}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
      >
        {/* Drag handle — mobile only, now functional */}
        <div className="sm:hidden mx-auto mb-1 mt-4 h-1 w-12 shrink-0 cursor-grab rounded-full bg-white/20 active:cursor-grabbing" />

        {/* Header */}
        <div className={`flex shrink-0 items-center justify-between px-6 py-4 ${headerDivider ? "theme-dialog-divider border-b" : ""}`}>
          <h2 className="text-lg font-semibold">{title}</h2>
          <button
            onClick={onClose}
            className="hidden rounded-lg p-1.5 text-[var(--theme-text-muted)] transition-colors hover:bg-[var(--theme-bg-muted)] hover:text-[var(--theme-text-primary)] sm:block"
            aria-label="Close dialog"
          >
            <svg
              className="w-5 h-5"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </button>
        </div>

        {/* Scrollable content — padding-bottom accounts for:
            · 1.5rem  : aesthetic spacing (replaces pb-6)
            · 100lvh - 100dvh : Safari address bar height (positive when bar is
              visible, zero when hidden or in standalone mode)
            · env(safe-area-inset-bottom) : home indicator in standalone PWA */}
        <div
          data-bottom-sheet-scroll
          className="overflow-y-auto flex-1 px-6"
          style={{ paddingBottom: 'calc(1.5rem + 100lvh - 100dvh + env(safe-area-inset-bottom, 0px))' }}
        >
          {children}
        </div>
      </div>
    </div>,
    document.body,
  );
}
