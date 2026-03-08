import type { ReactNode } from "react";

interface TooltipProps {
  /** The element the tooltip is attached to */
  children: ReactNode;
  /** Tooltip text */
  label: string;
  /** Optional keyboard shortcut hint shown after the label */
  shortcut?: string;
  /** Placement relative to the trigger. Default: "bottom" */
  side?: "top" | "bottom";
  /** Extra classes on the outer wrapper */
  className?: string;
}

/**
 * Lightweight animated tooltip using pure CSS (group-hover).
 *
 * Wrap any interactive element. The tooltip fades/scales in after a short
 * delay and positions itself above or below the trigger via absolute
 * positioning. No JS timers, no portals, no layout thrash.
 */
export function Tooltip({
  children,
  label,
  shortcut,
  side = "bottom",
  className = "",
}: TooltipProps) {
  const isTop = side === "top";

  return (
    <div className={`relative group/tip ${className}`}>
      {children}
      <div
        role="tooltip"
        className={`
          pointer-events-none absolute left-1/2 -translate-x-1/2 z-[100]
          px-2.5 py-1 rounded-lg
          bg-[#1c1c1c] border border-white/[0.08]
          shadow-xl shadow-black/50
          text-[11px] font-medium text-[#d4d4d8] whitespace-nowrap
          opacity-0 scale-95
          group-hover/tip:opacity-100 group-hover/tip:scale-100
          transition-all duration-150 delay-75
          origin-center
          ${isTop ? "bottom-full mb-2" : "top-full mt-2"}
        `}
      >
        {/* Caret arrow */}
        <span
          className={`
            absolute left-1/2 -translate-x-1/2 w-2 h-2
            bg-[#1c1c1c] border-white/[0.08] rotate-45
            ${isTop
              ? "top-full -mt-1 border-r border-b"
              : "bottom-full -mb-1 border-l border-t"
            }
          `}
        />
        <span className="relative">
          {label}
          {shortcut && (
            <kbd className="ml-1.5 px-1 py-0.5 rounded bg-white/[0.06] text-[10px] text-[#71717a] font-mono">
              {shortcut}
            </kbd>
          )}
        </span>
      </div>
    </div>
  );
}
