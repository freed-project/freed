import { type CSSProperties, type ChangeEvent } from "react";
import {
  FEED_CARD_DENSITY_LABELS,
  FEED_CARD_DENSITY_OPTIONS,
  type FeedCardDensity,
} from "../lib/feed-card-density.js";
import {
  formatInterfaceZoom,
  INTERFACE_ZOOM_MAX,
  INTERFACE_ZOOM_MIN,
  INTERFACE_ZOOM_STEP,
} from "../lib/interface-zoom.js";
import { Tooltip } from "./Tooltip.js";

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
}: {
  value: number;
  onChange: (value: number) => void;
  fullWidth?: boolean;
  style?: CSSProperties;
}) {
  const zoomLabel = formatInterfaceZoom(value);
  const handleChange = (event: ChangeEvent<HTMLInputElement>) => {
    onChange(Number(event.target.value));
  };

  return (
    <Tooltip
      label={`Interface zoom: ${zoomLabel}`}
      className={fullWidth ? "w-full" : undefined}
    >
      <div
        data-testid="interface-zoom-control"
        className="theme-toolbar-density-control theme-toolbar-zoom-control"
        style={{
          ...(fullWidth ? { width: "100%" } : {}),
          ...style,
        }}
        onPointerDown={(event) => event.stopPropagation()}
      >
        <span className="theme-toolbar-zoom-icon theme-toolbar-zoom-icon-small" aria-hidden="true">
          A
        </span>
        <input
          data-testid="interface-zoom-slider"
          className="theme-toolbar-density-slider theme-toolbar-zoom-slider"
          type="range"
          min={INTERFACE_ZOOM_MIN}
          max={INTERFACE_ZOOM_MAX}
          step={INTERFACE_ZOOM_STEP}
          value={value}
          onChange={handleChange}
          aria-label="Interface zoom"
          aria-valuemin={INTERFACE_ZOOM_MIN}
          aria-valuemax={INTERFACE_ZOOM_MAX}
          aria-valuetext={zoomLabel}
        />
        <span className="theme-toolbar-zoom-icon theme-toolbar-zoom-icon-large" aria-hidden="true">
          A
        </span>
      </div>
    </Tooltip>
  );
}
