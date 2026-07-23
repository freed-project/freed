export interface FriendsGalaxyClientRect {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

export interface FriendsGalaxyCanvasPoint {
  x: number;
  y: number;
}

export interface FriendsGalaxyViewportInsets {
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
  readonly left: number;
}

export interface FriendsGalaxyViewportGeometry {
  readonly canvasClientLeft: number;
  readonly canvasClientTop: number;
  readonly canvasWidth: number;
  readonly canvasHeight: number;
  readonly interactionLeft: number;
  readonly interactionTop: number;
  readonly interactionWidth: number;
  readonly interactionHeight: number;
  readonly interactionCenterX: number;
  readonly interactionCenterY: number;
  readonly insets: FriendsGalaxyViewportInsets;
}

export interface FriendsGalaxyTransform {
  x: number;
  y: number;
  scale: number;
}

function finite(value: number, fallback: number): number {
  return Number.isFinite(value) ? value : fallback;
}

function boundedRange(
  start: number,
  end: number,
  extent: number,
): readonly [number, number] {
  const boundedStart = Math.max(0, Math.min(extent - 1, start));
  const boundedEnd = Math.max(boundedStart + 1, Math.min(extent, end));
  return [boundedStart, boundedEnd];
}

export function friendsGalaxyViewportGeometry(
  canvasRect: FriendsGalaxyClientRect,
  interactionRect: FriendsGalaxyClientRect,
): FriendsGalaxyViewportGeometry {
  const canvasClientLeft = finite(canvasRect.left, 0);
  const canvasClientTop = finite(canvasRect.top, 0);
  const canvasWidth = Math.max(1, finite(canvasRect.width, 1));
  const canvasHeight = Math.max(1, finite(canvasRect.height, 1));
  const interactionClientLeft = finite(interactionRect.left, canvasClientLeft);
  const interactionClientTop = finite(interactionRect.top, canvasClientTop);
  const interactionClientWidth = Math.max(
    1,
    finite(interactionRect.width, canvasWidth),
  );
  const interactionClientHeight = Math.max(
    1,
    finite(interactionRect.height, canvasHeight),
  );
  const [interactionLeft, interactionRight] = boundedRange(
    interactionClientLeft - canvasClientLeft,
    interactionClientLeft - canvasClientLeft + interactionClientWidth,
    canvasWidth,
  );
  const [interactionTop, interactionBottom] = boundedRange(
    interactionClientTop - canvasClientTop,
    interactionClientTop - canvasClientTop + interactionClientHeight,
    canvasHeight,
  );

  return {
    canvasClientLeft,
    canvasClientTop,
    canvasWidth,
    canvasHeight,
    interactionLeft,
    interactionTop,
    interactionWidth: interactionRight - interactionLeft,
    interactionHeight: interactionBottom - interactionTop,
    interactionCenterX: (interactionLeft + interactionRight) * 0.5,
    interactionCenterY: (interactionTop + interactionBottom) * 0.5,
    insets: {
      top: interactionTop,
      right: canvasWidth - interactionRight,
      bottom: canvasHeight - interactionBottom,
      left: interactionLeft,
    },
  };
}

export function reanchorFriendsGalaxyTransformToInteraction(
  target: FriendsGalaxyTransform,
  previous: FriendsGalaxyViewportGeometry,
  next: FriendsGalaxyViewportGeometry,
): FriendsGalaxyTransform {
  const scale = Math.max(0.0001, target.scale);
  const worldX = (previous.interactionCenterX - target.x) / scale;
  const worldY = (previous.interactionCenterY - target.y) / scale;
  target.x = next.interactionCenterX - worldX * scale;
  target.y = next.interactionCenterY - worldY * scale;
  return target;
}

export function writeFriendsGalaxyCanvasPoint(
  target: FriendsGalaxyCanvasPoint,
  geometry: FriendsGalaxyViewportGeometry,
  clientX: number,
  clientY: number,
): FriendsGalaxyCanvasPoint {
  target.x = clientX - geometry.canvasClientLeft;
  target.y = clientY - geometry.canvasClientTop;
  return target;
}
