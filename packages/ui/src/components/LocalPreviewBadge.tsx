import { useEffect, useLayoutEffect, useRef, useState, type PointerEvent } from "react";

type LocalPreviewBadgeProps = {
  label: string | null;
};

type BadgePosition = {
  x: number;
  y: number;
};

type DragState = {
  pointerId: number;
  offsetX: number;
  offsetY: number;
  width: number;
  height: number;
};

const PREVIEW_BADGE_MARGIN = 16;

function clampPosition(position: BadgePosition, width: number, height: number): BadgePosition {
  const maxX = Math.max(PREVIEW_BADGE_MARGIN, window.innerWidth - width - PREVIEW_BADGE_MARGIN);
  const maxY = Math.max(PREVIEW_BADGE_MARGIN, window.innerHeight - height - PREVIEW_BADGE_MARGIN);

  return {
    x: Math.min(maxX, Math.max(PREVIEW_BADGE_MARGIN, position.x)),
    y: Math.min(maxY, Math.max(PREVIEW_BADGE_MARGIN, position.y)),
  };
}

function defaultPosition(width: number, height: number): BadgePosition {
  return clampPosition(
    {
      x: Math.round((window.innerWidth - width) / 2),
      y: Math.round(window.innerHeight - height - PREVIEW_BADGE_MARGIN),
    },
    width,
    height,
  );
}

export function LocalPreviewBadge({ label }: LocalPreviewBadgeProps) {
  const badgeRef = useRef<HTMLDivElement | null>(null);
  const dragStateRef = useRef<DragState | null>(null);
  const [position, setPosition] = useState<BadgePosition | null>(null);
  const [dragging, setDragging] = useState(false);

  useLayoutEffect(() => {
    if (!label) {
      setPosition(null);
      return;
    }

    const badge = badgeRef.current;
    if (!badge) return;

    const rect = badge.getBoundingClientRect();
    const nextPosition = defaultPosition(rect.width, rect.height);

    setPosition(nextPosition);
  }, [label]);

  useEffect(() => {
    if (!label) return;

    const handleResize = () => {
      const badge = badgeRef.current;
      if (!badge) return;

      const rect = badge.getBoundingClientRect();
      setPosition((current) => clampPosition(current ?? defaultPosition(rect.width, rect.height), rect.width, rect.height));
    };

    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, [label]);

  if (!label) {
    return null;
  }

  const handlePointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;

    const badge = badgeRef.current;
    if (!badge) return;

    const rect = badge.getBoundingClientRect();
    dragStateRef.current = {
      pointerId: event.pointerId,
      offsetX: event.clientX - rect.left,
      offsetY: event.clientY - rect.top,
      width: rect.width,
      height: rect.height,
    };

    badge.setPointerCapture(event.pointerId);
    setDragging(true);
    event.preventDefault();
  };

  const handlePointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const dragState = dragStateRef.current;
    if (!dragState || dragState.pointerId !== event.pointerId) return;

    setPosition(
      clampPosition(
        {
          x: event.clientX - dragState.offsetX,
          y: event.clientY - dragState.offsetY,
        },
        dragState.width,
        dragState.height,
      ),
    );
  };

  const finishDrag = (event: PointerEvent<HTMLDivElement>) => {
    const dragState = dragStateRef.current;
    if (!dragState || dragState.pointerId !== event.pointerId) return;

    dragStateRef.current = null;
    setDragging(false);

    const badge = badgeRef.current;
    if (!badge) return;

    try {
      badge.releasePointerCapture(event.pointerId);
    } catch {
      // Ignore browsers that already released capture.
    }
  };

  return (
    <div
      ref={badgeRef}
      className={`fixed z-[140] max-w-[min(32rem,calc(100vw-2rem))] touch-none select-none ${dragging ? "cursor-grabbing" : "cursor-grab"}`}
      style={
        position
          ? { left: `${position.x}px`, top: `${position.y}px` }
          : { left: "50%", bottom: `${PREVIEW_BADGE_MARGIN}px`, transform: "translateX(-50%)" }
      }
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={finishDrag}
      onPointerCancel={finishDrag}
      onLostPointerCapture={finishDrag}
    >
      <div className="theme-floating-panel flex items-center gap-3 rounded-2xl px-3 py-2 shadow-2xl shadow-black/30">
        <div className="rounded-full bg-[color:color-mix(in_srgb,var(--theme-accent-secondary)_20%,transparent)] px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--theme-accent-secondary)]">
          Local preview
        </div>
        <p className="min-w-0 truncate font-mono text-xs text-[var(--theme-text-primary)]">
          {label}
        </p>
      </div>
    </div>
  );
}
