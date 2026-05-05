import type { CSSProperties } from "react";

export const noDragRegionStyle = { WebkitAppRegion: "no-drag" } as CSSProperties;
export const dragRegionStyle = { WebkitAppRegion: "drag" } as CSSProperties;

export type PassiveDragRegionProps = {
  "data-tauri-drag-region"?: true;
  style?: CSSProperties;
};

export function getPassiveDragRegionProps(
  enabled: boolean | undefined,
  style?: CSSProperties,
): PassiveDragRegionProps {
  if (!enabled) {
    return style ? { style } : {};
  }

  return {
    "data-tauri-drag-region": true,
    style: {
      ...dragRegionStyle,
      cursor: "default",
      userSelect: "none",
      ...style,
    },
  };
}
