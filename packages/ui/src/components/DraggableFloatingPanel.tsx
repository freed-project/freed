import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type PointerEvent,
  type ReactNode,
} from "react";

type Position = { x: number; y: number };
type DragState = Position & {
  pointerId: number;
  width: number;
  height: number;
};

export type DraggableFloatingPanelProps = {
  children: ReactNode;
  className?: string;
  dataTestId?: string;
  initialEdge?: "top" | "bottom";
  margin?: number;
};

function clampPosition(
  position: Position,
  width: number,
  height: number,
  margin: number,
): Position {
  const maxX = Math.max(margin, window.innerWidth - width - margin);
  const maxY = Math.max(margin, window.innerHeight - height - margin);
  return {
    x: Math.min(maxX, Math.max(margin, position.x)),
    y: Math.min(maxY, Math.max(margin, position.y)),
  };
}

function defaultPosition(
  width: number,
  height: number,
  margin: number,
  edge: "top" | "bottom",
): Position {
  return clampPosition(
    {
      x: Math.round((window.innerWidth - width) / 2),
      y: edge === "top" ? margin : window.innerHeight - height - margin,
    },
    width,
    height,
    margin,
  );
}

export function DraggableFloatingPanel({
  children,
  className = "",
  dataTestId,
  initialEdge = "bottom",
  margin = 16,
}: DraggableFloatingPanelProps) {
  const panelRef = useRef<HTMLDivElement | null>(null);
  const dragStateRef = useRef<DragState | null>(null);
  const [position, setPosition] = useState<Position | null>(null);
  const [dragging, setDragging] = useState(false);

  useLayoutEffect(() => {
    const panel = panelRef.current;
    if (!panel) return;
    const rect = panel.getBoundingClientRect();
    setPosition(defaultPosition(rect.width, rect.height, margin, initialEdge));
  }, [initialEdge, margin]);

  useEffect(() => {
    const handleResize = () => {
      const panel = panelRef.current;
      if (!panel) return;
      const rect = panel.getBoundingClientRect();
      setPosition((current) =>
        clampPosition(
          current ?? defaultPosition(rect.width, rect.height, margin, initialEdge),
          rect.width,
          rect.height,
          margin,
        ),
      );
    };
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, [initialEdge, margin]);

  const finishDrag = (event: PointerEvent<HTMLDivElement>) => {
    const dragState = dragStateRef.current;
    if (!dragState || dragState.pointerId !== event.pointerId) return;
    dragStateRef.current = null;
    setDragging(false);
    try {
      panelRef.current?.releasePointerCapture(event.pointerId);
    } catch {
      // The browser may already have released pointer capture.
    }
  };

  return (
    <div
      ref={panelRef}
      className={`fixed z-[140] touch-none select-none ${dragging ? "cursor-grabbing" : "cursor-grab"} ${className}`}
      data-testid={dataTestId}
      style={
        position
          ? { left: `${position.x}px`, top: `${position.y}px` }
          : {
              left: "50%",
              [initialEdge]: `${margin}px`,
              transform: "translateX(-50%)",
            }
      }
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        if (
          event.target instanceof Element &&
          event.target.closest("a, button, input, select, textarea")
        ) {
          return;
        }
        const panel = panelRef.current;
        if (!panel) return;
        const rect = panel.getBoundingClientRect();
        dragStateRef.current = {
          pointerId: event.pointerId,
          x: event.clientX - rect.left,
          y: event.clientY - rect.top,
          width: rect.width,
          height: rect.height,
        };
        panel.setPointerCapture(event.pointerId);
        setDragging(true);
        event.preventDefault();
      }}
      onPointerMove={(event) => {
        const dragState = dragStateRef.current;
        if (!dragState || dragState.pointerId !== event.pointerId) return;
        setPosition(
          clampPosition(
            { x: event.clientX - dragState.x, y: event.clientY - dragState.y },
            dragState.width,
            dragState.height,
            margin,
          ),
        );
      }}
      onPointerUp={finishDrag}
      onPointerCancel={finishDrag}
      onLostPointerCapture={finishDrag}
    >
      {children}
    </div>
  );
}
