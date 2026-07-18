import type { GalaxyLabTransform } from "./scene-fixture.js";
import type { GalaxyLabViewportGeometry } from "./viewport-geometry.js";

export type GalaxyLabContextRequestSource =
  "keyboard" | "long-press" | "pointer";

export interface GalaxyLabContextTarget {
  readonly nodeId: string;
  readonly source: GalaxyLabContextRequestSource;
  readonly canvasX: number;
  readonly canvasY: number;
  readonly interactionX: number;
  readonly interactionY: number;
  readonly worldX: number;
  readonly worldY: number;
}

export type GalaxyLabKeyboardCommand =
  | { readonly type: "clear" }
  | { readonly type: "context-menu" }
  | { readonly type: "details" }
  | { readonly type: "fit" }
  | { readonly type: "pan"; readonly deltaX: number; readonly deltaY: number }
  | { readonly type: "zoom"; readonly ratio: number };

export interface GalaxyLabKeyboardInput {
  readonly key: string;
  readonly altKey?: boolean;
  readonly ctrlKey?: boolean;
  readonly metaKey?: boolean;
  readonly shiftKey?: boolean;
}

export interface GalaxyLabLongPressActivation {
  readonly pointerId: number;
  readonly x: number;
  readonly y: number;
}

const CONTEXT_EDGE_INSET = 10;
const KEYBOARD_ZOOM_RATIO = 1.18;
const LONG_PRESS_DURATION_MS = 480;
const LONG_PRESS_MOVEMENT_PX = 4;

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}

export function galaxyLabContextTarget(
  nodeId: string,
  source: GalaxyLabContextRequestSource,
  canvasX: number,
  canvasY: number,
  transform: GalaxyLabTransform,
  geometry: GalaxyLabViewportGeometry,
): GalaxyLabContextTarget | null {
  if (!nodeId) return null;
  const horizontalInset = Math.min(
    CONTEXT_EDGE_INSET,
    geometry.interactionWidth * 0.5,
  );
  const verticalInset = Math.min(
    CONTEXT_EDGE_INSET,
    geometry.interactionHeight * 0.5,
  );
  const minimumX = geometry.interactionLeft + horizontalInset;
  const maximumX =
    geometry.interactionLeft + geometry.interactionWidth - horizontalInset;
  const minimumY = geometry.interactionTop + verticalInset;
  const maximumY =
    geometry.interactionTop + geometry.interactionHeight - verticalInset;
  const anchorX = clamp(canvasX, minimumX, maximumX);
  const anchorY = clamp(canvasY, minimumY, maximumY);
  const scale = Math.max(0.0001, transform.scale);
  return {
    nodeId,
    source,
    canvasX: anchorX,
    canvasY: anchorY,
    interactionX: anchorX - geometry.interactionLeft,
    interactionY: anchorY - geometry.interactionTop,
    worldX: (canvasX - transform.x) / scale,
    worldY: (canvasY - transform.y) / scale,
  };
}

export function galaxyLabKeyboardCommand(
  input: GalaxyLabKeyboardInput,
): GalaxyLabKeyboardCommand | null {
  if (input.altKey || input.ctrlKey || input.metaKey) return null;
  const panStep = input.shiftKey ? 120 : 56;
  switch (input.key) {
    case "ArrowLeft":
      return { type: "pan", deltaX: panStep, deltaY: 0 };
    case "ArrowRight":
      return { type: "pan", deltaX: -panStep, deltaY: 0 };
    case "ArrowUp":
      return { type: "pan", deltaX: 0, deltaY: panStep };
    case "ArrowDown":
      return { type: "pan", deltaX: 0, deltaY: -panStep };
    case "+":
    case "=":
      return { type: "zoom", ratio: KEYBOARD_ZOOM_RATIO };
    case "-":
    case "_":
      return { type: "zoom", ratio: 1 / KEYBOARD_ZOOM_RATIO };
    case "Home":
    case "0":
      return { type: "fit" };
    case "Escape":
      return { type: "clear" };
    case "Enter":
      return { type: "details" };
    case "ContextMenu":
      return { type: "context-menu" };
    case "F10":
      return input.shiftKey ? { type: "context-menu" } : null;
    default:
      return null;
  }
}

export class GalaxyLabLongPressTracker {
  private pointerIdValue: number | null = null;
  private startX = 0;
  private startY = 0;
  private startedAt = 0;
  private activated = false;

  get isPending(): boolean {
    return this.pointerIdValue !== null && !this.activated;
  }

  get isActivated(): boolean {
    return this.pointerIdValue !== null && this.activated;
  }

  get durationMs(): number {
    return LONG_PRESS_DURATION_MS;
  }

  isTracking(pointerId: number): boolean {
    return pointerId === this.pointerIdValue;
  }

  begin(pointerId: number, x: number, y: number, nowMs: number): void {
    this.pointerIdValue = pointerId;
    this.startX = x;
    this.startY = y;
    this.startedAt = nowMs;
    this.activated = false;
  }

  move(pointerId: number, x: number, y: number): boolean {
    if (pointerId !== this.pointerIdValue || this.activated) return false;
    const deltaX = x - this.startX;
    const deltaY = y - this.startY;
    if (
      deltaX * deltaX + deltaY * deltaY >
      LONG_PRESS_MOVEMENT_PX * LONG_PRESS_MOVEMENT_PX
    ) {
      this.cancel();
      return false;
    }
    return true;
  }

  activate(nowMs: number): GalaxyLabLongPressActivation | null {
    if (
      this.pointerIdValue === null ||
      this.activated ||
      nowMs - this.startedAt < LONG_PRESS_DURATION_MS
    ) {
      return null;
    }
    this.activated = true;
    return {
      pointerId: this.pointerIdValue,
      x: this.startX,
      y: this.startY,
    };
  }

  release(pointerId: number): void {
    if (pointerId === this.pointerIdValue) this.cancel();
  }

  cancel(): void {
    this.pointerIdValue = null;
    this.activated = false;
  }
}
