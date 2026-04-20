"use client";

import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
  type CSSProperties,
  type FocusEvent,
} from "react";
import { createPortal } from "react-dom";

interface TooltipProps {
  children: ReactNode;
  label: string;
  description?: string;
  shortcut?: string;
  side?: "top" | "bottom";
  className?: string;
  badge?: ReactNode;
}

interface TooltipPosition {
  left: number;
  top: number;
  arrowLeft: number;
  placement: "top" | "bottom";
  ready: boolean;
}

const TOOLTIP_OFFSET = 12;
const VIEWPORT_PADDING = 12;
const TOOLTIP_ARROW_INSET = 18;

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

export function Tooltip({
  children,
  label,
  description,
  shortcut,
  side = "bottom",
  className = "",
  badge,
}: TooltipProps) {
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [position, setPosition] = useState<TooltipPosition>({
    left: 0,
    top: 0,
    arrowLeft: TOOLTIP_ARROW_INSET,
    placement: side,
    ready: false,
  });
  const triggerRef = useRef<HTMLSpanElement | null>(null);
  const tooltipRef = useRef<HTMLDivElement | null>(null);
  const pointerDownRef = useRef(false);
  const suppressHoverRef = useRef(false);
  const tooltipId = useId();

  useEffect(() => {
    setMounted(true);
  }, []);

  const updatePosition = () => {
    if (!triggerRef.current || !tooltipRef.current) {
      return;
    }

    const triggerRect = triggerRef.current.getBoundingClientRect();
    const tooltipRect = tooltipRef.current.getBoundingClientRect();
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    const roomAbove = triggerRect.top - VIEWPORT_PADDING;
    const roomBelow = viewportHeight - triggerRect.bottom - VIEWPORT_PADDING;

    let placement: "top" | "bottom" = side;
    const fitsAbove = roomAbove >= tooltipRect.height + TOOLTIP_OFFSET;
    const fitsBelow = roomBelow >= tooltipRect.height + TOOLTIP_OFFSET;

    if (side === "top" && !fitsAbove && fitsBelow) {
      placement = "bottom";
    } else if (side === "bottom" && !fitsBelow && fitsAbove) {
      placement = "top";
    } else if (!fitsAbove && !fitsBelow) {
      placement = roomBelow >= roomAbove ? "bottom" : "top";
    }

    const desiredLeft = triggerRect.left + triggerRect.width / 2 - tooltipRect.width / 2;
    const maxLeft = Math.max(VIEWPORT_PADDING, viewportWidth - VIEWPORT_PADDING - tooltipRect.width);
    const left = clamp(desiredLeft, VIEWPORT_PADDING, maxLeft);

    const desiredTop =
      placement === "top"
        ? triggerRect.top - tooltipRect.height - TOOLTIP_OFFSET
        : triggerRect.bottom + TOOLTIP_OFFSET;
    const maxTop = Math.max(VIEWPORT_PADDING, viewportHeight - VIEWPORT_PADDING - tooltipRect.height);
    const top = clamp(desiredTop, VIEWPORT_PADDING, maxTop);

    const arrowLeft = clamp(
      triggerRect.left + triggerRect.width / 2 - left,
      TOOLTIP_ARROW_INSET,
      Math.max(TOOLTIP_ARROW_INSET, tooltipRect.width - TOOLTIP_ARROW_INSET),
    );

    setPosition((current) => {
      const next = {
        left: Math.round(left),
        top: Math.round(top),
        arrowLeft: Math.round(arrowLeft),
        placement,
        ready: true,
      };

      if (
        current.left === next.left &&
        current.top === next.top &&
        current.arrowLeft === next.arrowLeft &&
        current.placement === next.placement &&
        current.ready === next.ready
      ) {
        return current;
      }

      return next;
    });
  };

  useLayoutEffect(() => {
    if (!open) {
      return undefined;
    }

    let frameId = window.requestAnimationFrame(() => {
      updatePosition();
    });

    const closeTooltip = () => setOpen(false);
    const refreshPosition = () => {
      window.cancelAnimationFrame(frameId);
      frameId = window.requestAnimationFrame(() => {
        updatePosition();
      });
    };

    const resizeObserver =
      typeof ResizeObserver === "undefined"
        ? null
        : new ResizeObserver(() => {
            refreshPosition();
          });

    if (triggerRef.current) {
      resizeObserver?.observe(triggerRef.current);
    }
    if (tooltipRef.current) {
      resizeObserver?.observe(tooltipRef.current);
    }

    window.addEventListener("scroll", refreshPosition, true);
    window.addEventListener("resize", refreshPosition);
    window.addEventListener("blur", closeTooltip);
    return () => {
      window.cancelAnimationFrame(frameId);
      resizeObserver?.disconnect();
      window.removeEventListener("scroll", refreshPosition, true);
      window.removeEventListener("resize", refreshPosition);
      window.removeEventListener("blur", closeTooltip);
    };
  }, [badge, description, label, open, shortcut, side]);

  const openTooltip = () => {
    setPosition((current) => ({ ...current, placement: side, ready: false }));
    setOpen(true);
  };

  const closeTooltip = () => {
    setOpen(false);
  };

  const handlePointerEnter = () => {
    if (suppressHoverRef.current) {
      return;
    }

    openTooltip();
  };

  const handlePointerLeave = () => {
    suppressHoverRef.current = false;
    closeTooltip();
  };

  const handlePointerDown = () => {
    pointerDownRef.current = true;
    suppressHoverRef.current = true;
    closeTooltip();
  };

  const handleFocus = (event: FocusEvent<HTMLSpanElement>) => {
    if (!(event.target instanceof HTMLElement) || !event.target.matches(":focus-visible")) {
      return;
    }

    if (pointerDownRef.current) {
      return;
    }

    openTooltip();
  };

  const handleBlur = () => {
    pointerDownRef.current = false;
    suppressHoverRef.current = false;
    closeTooltip();
  };

  const tooltipStyle = {
    left: `${position.left}px`,
    top: `${position.top}px`,
    visibility: position.ready ? "visible" : "hidden",
    "--theme-tooltip-arrow-left": `${position.arrowLeft}px`,
  } as CSSProperties;

  return (
    <>
      <span
        ref={triggerRef}
        aria-describedby={open ? tooltipId : undefined}
        className={["relative inline-flex", className].filter(Boolean).join(" ")}
        onPointerEnter={handlePointerEnter}
        onPointerLeave={handlePointerLeave}
        onPointerDown={handlePointerDown}
        onFocus={handleFocus}
        onBlur={handleBlur}
      >
        {children}
      </span>
      {mounted && open
        ? createPortal(
            <div
              ref={tooltipRef}
              id={tooltipId}
              role="tooltip"
              className="theme-tooltip-panel"
              style={tooltipStyle}
            >
              {badge ? <span className="theme-tooltip-badge">{badge}</span> : null}
              <div className="theme-tooltip-body">
                <span className="theme-tooltip-label">
                  {label}
                  {shortcut ? <kbd className="theme-tooltip-shortcut">{shortcut}</kbd> : null}
                </span>
                {description ? (
                  <span className="theme-tooltip-description">{description}</span>
                ) : null}
              </div>
              <span
                className={`theme-tooltip-arrow ${position.placement === "top" ? "theme-tooltip-arrow-top" : "theme-tooltip-arrow-bottom"}`}
              />
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
