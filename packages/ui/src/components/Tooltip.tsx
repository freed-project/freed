"use client";

import {
  useEffect,
  useId,
  useRef,
  useState,
  type ReactNode,
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
}

const TOOLTIP_OFFSET = 12;

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
  const [position, setPosition] = useState<TooltipPosition>({ left: 0, top: 0 });
  const triggerRef = useRef<HTMLSpanElement | null>(null);
  const tooltipId = useId();

  useEffect(() => {
    setMounted(true);
  }, []);

  const updatePosition = () => {
    if (!triggerRef.current) {
      return;
    }

    const rect = triggerRef.current.getBoundingClientRect();
    setPosition({
      left: rect.left + rect.width / 2,
      top: side === "top" ? rect.top - TOOLTIP_OFFSET : rect.bottom + TOOLTIP_OFFSET,
    });
  };

  useEffect(() => {
    if (!open) {
      return undefined;
    }

    updatePosition();
    const closeTooltip = () => setOpen(false);
    const refreshPosition = () => updatePosition();
    window.addEventListener("scroll", refreshPosition, true);
    window.addEventListener("resize", refreshPosition);
    window.addEventListener("blur", closeTooltip);
    return () => {
      window.removeEventListener("scroll", refreshPosition, true);
      window.removeEventListener("resize", refreshPosition);
      window.removeEventListener("blur", closeTooltip);
    };
  }, [open, side]);

  return (
    <>
      <span
        ref={triggerRef}
        aria-describedby={open ? tooltipId : undefined}
        className={["relative inline-flex", className].filter(Boolean).join(" ")}
        onMouseEnter={() => {
          updatePosition();
          setOpen(true);
        }}
        onMouseLeave={() => setOpen(false)}
        onFocus={() => {
          updatePosition();
          setOpen(true);
        }}
        onBlur={() => setOpen(false)}
      >
        {children}
      </span>
      {mounted && open
        ? createPortal(
            <div
              id={tooltipId}
              role="tooltip"
              className="theme-tooltip-panel"
              style={{
                left: position.left,
                top: position.top,
                transform:
                  side === "top"
                    ? "translate(-50%, calc(-100% - 2px))"
                    : "translate(-50%, 2px)",
              }}
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
                className={`theme-tooltip-arrow ${side === "top" ? "theme-tooltip-arrow-top" : "theme-tooltip-arrow-bottom"}`}
              />
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
