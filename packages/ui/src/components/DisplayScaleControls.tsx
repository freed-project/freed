import {
  useEffect,
  useState,
  type CSSProperties,
  type ChangeEvent,
  type PointerEvent,
} from "react";
import {
  FEED_CARD_DENSITY_LABELS,
  FEED_CARD_DENSITY_OPTIONS,
  type FeedCardDensity,
} from "../lib/feed-card-density.js";
import {
  INTERFACE_ZOOM_DEFAULT,
  formatInterfaceZoom,
  INTERFACE_ZOOM_MAX,
  INTERFACE_ZOOM_MIN,
  INTERFACE_ZOOM_STEP,
  normalizeInterfaceZoom,
} from "../lib/interface-zoom.js";
import { Tooltip } from "./Tooltip.js";

const INTERFACE_ZOOM_BUTTON_STEP = 10;

function getNextInterfaceZoom(value: number, direction: -1 | 1): number {
  const currentZoom = normalizeInterfaceZoom(value);
  const nextZoom = direction < 0
    ? Math.ceil(currentZoom / INTERFACE_ZOOM_BUTTON_STEP) * INTERFACE_ZOOM_BUTTON_STEP
      - INTERFACE_ZOOM_BUTTON_STEP
    : Math.floor(currentZoom / INTERFACE_ZOOM_BUTTON_STEP) * INTERFACE_ZOOM_BUTTON_STEP
      + INTERFACE_ZOOM_BUTTON_STEP;
  return normalizeInterfaceZoom(nextZoom);
}

export function FeedCardDensitySlider({
  value,
  onChange,
  fullWidth = false,
  style,
}: {
  value: FeedCardDensity;
  onChange: (value: FeedCardDensity) => void;
  fullWidth?: boolean;
  style?: CSSProperties;
}) {
  const valueIndex = Math.max(0, FEED_CARD_DENSITY_OPTIONS.indexOf(value));
  const handleChange = (event: ChangeEvent<HTMLInputElement>) => {
    const next = FEED_CARD_DENSITY_OPTIONS[Number(event.target.value)] ?? "comfortable";
    onChange(next);
  };

  return (
    <Tooltip
      label={FEED_CARD_DENSITY_LABELS[value]}
      className={fullWidth ? "w-full" : undefined}
    >
      <div
        data-testid="feed-card-density-control"
        className="theme-toolbar-density-control"
        style={{
          ...(fullWidth ? { width: "100%" } : {}),
          ...style,
        }}
        onPointerDown={(event) => event.stopPropagation()}
      >
        <span className="theme-toolbar-density-icon theme-toolbar-density-icon-compact" aria-hidden="true">
          <span />
          <span />
          <span />
        </span>
        <input
          data-testid="feed-card-density-slider"
          className="theme-toolbar-density-slider"
          type="range"
          min={0}
          max={2}
          step={1}
          value={valueIndex}
          onChange={handleChange}
          aria-label="Card density"
          aria-valuetext={FEED_CARD_DENSITY_LABELS[value]}
        />
        <span className="theme-toolbar-density-icon theme-toolbar-density-icon-expansive" aria-hidden="true">
          <span />
          <span />
          <span />
        </span>
      </div>
    </Tooltip>
  );
}

export function InterfaceZoomSlider({
  value,
  onChange,
  fullWidth = false,
  style,
  dragStabilization = "control",
  onDragStart,
  onDragEnd,
}: {
  value: number;
  onChange: (value: number) => void;
  fullWidth?: boolean;
  style?: CSSProperties;
  dragStabilization?: "control" | "parent";
  onDragStart?: (baselineZoom: number) => void;
  onDragEnd?: () => void;
}) {
  const [dragBaselineZoom, setDragBaselineZoom] = useState<number | null>(null);
  const zoomLabel = formatInterfaceZoom(value);
  const defaultStop =
    ((INTERFACE_ZOOM_DEFAULT - INTERFACE_ZOOM_MIN) / (INTERFACE_ZOOM_MAX - INTERFACE_ZOOM_MIN)) * 100;
  const handleChange = (event: ChangeEvent<HTMLInputElement>) => {
    onChange(Number(event.target.value));
  };
  const handlePointerDown = (event: PointerEvent<HTMLDivElement>) => {
    event.stopPropagation();
    const baselineZoom = normalizeInterfaceZoom(value);
    setDragBaselineZoom(baselineZoom);
    onDragStart?.(baselineZoom);
  };
  const currentZoom = normalizeInterfaceZoom(value);
  const smallerZoom = getNextInterfaceZoom(currentZoom, -1);
  const largerZoom = getNextInterfaceZoom(currentZoom, 1);
  const dragScale = dragBaselineZoom === null ? 1 : dragBaselineZoom / currentZoom;
  const triggerStyle = dragBaselineZoom === null || dragStabilization === "parent"
    ? undefined
    : ({
        transform: `scale(${dragScale})`,
        transformOrigin: "left center",
      } as CSSProperties);

  useEffect(() => {
    if (dragBaselineZoom === null || typeof window === "undefined") {
      return undefined;
    }

    const endDrag = () => {
      setDragBaselineZoom(null);
      onDragEnd?.();
    };
    window.addEventListener("pointerup", endDrag);
    window.addEventListener("pointercancel", endDrag);
    window.addEventListener("blur", endDrag);
    return () => {
      window.removeEventListener("pointerup", endDrag);
      window.removeEventListener("pointercancel", endDrag);
      window.removeEventListener("blur", endDrag);
    };
  }, [dragBaselineZoom, onDragEnd]);

  return (
    <Tooltip
      label={`Zoom: ${zoomLabel}`}
      className={fullWidth ? "w-full" : undefined}
      triggerStyle={triggerStyle}
    >
      <div
        data-testid="interface-zoom-control"
        className="theme-toolbar-density-control theme-toolbar-zoom-control"
        style={{
          ["--interface-zoom-default-stop" as string]: `${defaultStop}%`,
          ...(fullWidth ? { width: "100%" } : {}),
          ...style,
        }}
        onPointerDown={handlePointerDown}
      >
        <button
          type="button"
          data-testid="interface-zoom-decrease"
          className="theme-toolbar-zoom-step"
          onClick={() => onChange(smallerZoom)}
          disabled={smallerZoom === currentZoom}
          aria-label="Decrease zoom"
        >
          <span className="theme-toolbar-zoom-icon theme-toolbar-zoom-icon-small" aria-hidden="true">
            A
          </span>
        </button>
        <input
          data-testid="interface-zoom-slider"
          className="theme-toolbar-density-slider theme-toolbar-zoom-slider"
          type="range"
          min={INTERFACE_ZOOM_MIN}
          max={INTERFACE_ZOOM_MAX}
          step={INTERFACE_ZOOM_STEP}
          value={value}
          onChange={handleChange}
          aria-label="Zoom"
          aria-valuemin={INTERFACE_ZOOM_MIN}
          aria-valuemax={INTERFACE_ZOOM_MAX}
          aria-valuetext={zoomLabel}
        />
        <button
          type="button"
          data-testid="interface-zoom-increase"
          className="theme-toolbar-zoom-step"
          onClick={() => onChange(largerZoom)}
          disabled={largerZoom === currentZoom}
          aria-label="Increase zoom"
        >
          <span className="theme-toolbar-zoom-icon theme-toolbar-zoom-icon-large" aria-hidden="true">
            A
          </span>
        </button>
      </div>
    </Tooltip>
  );
}
