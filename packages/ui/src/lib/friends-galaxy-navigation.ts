import {
  friendsGalaxyCameraFrameState,
  writeFriendsGalaxyFocusedTransform,
  writeFriendsGalaxyFramedTransform,
  type FriendsGalaxyCameraFrameState,
} from "./friends-galaxy-camera.js";
import {
  applyFriendsGalaxyPinch,
  applyFriendsGalaxyResistedZoomAt,
} from "./friends-galaxy-gesture.js";
import type { FriendsGalaxyRendererScene } from "./friends-galaxy-renderer.js";
import { findFriendsGalaxySceneNodeIndex } from "./friends-galaxy-scene-interaction-index.js";
import type {
  FriendsGalaxyTransform,
  FriendsGalaxyViewportInsets,
} from "./friends-galaxy-viewport.js";

const EMPTY_VIEWPORT_INSETS: FriendsGalaxyViewportInsets = {
  top: 0,
  right: 0,
  bottom: 0,
  left: 0,
};

function finiteExtent(value: number): number {
  return Number.isFinite(value) && value > 0 ? value : 1;
}

function normalizedInsets(
  insets: FriendsGalaxyViewportInsets,
): FriendsGalaxyViewportInsets {
  return {
    top: Number.isFinite(insets.top) ? Math.max(0, insets.top) : 0,
    right: Number.isFinite(insets.right) ? Math.max(0, insets.right) : 0,
    bottom: Number.isFinite(insets.bottom) ? Math.max(0, insets.bottom) : 0,
    left: Number.isFinite(insets.left) ? Math.max(0, insets.left) : 0,
  };
}

function interactionCenterX(
  width: number,
  insets: FriendsGalaxyViewportInsets,
): number {
  return insets.left + Math.max(1, width - insets.left - insets.right) * 0.5;
}

function interactionCenterY(
  height: number,
  insets: FriendsGalaxyViewportInsets,
): number {
  return insets.top + Math.max(1, height - insets.top - insets.bottom) * 0.5;
}

export class FriendsGalaxyNavigationController {
  private readonly transformValue: FriendsGalaxyTransform = {
    x: 0,
    y: 0,
    scale: 1,
  };
  private scene: FriendsGalaxyRendererScene;
  private width = 1;
  private height = 1;
  private insets: FriendsGalaxyViewportInsets = EMPTY_VIEWPORT_INSETS;
  private frameValue: FriendsGalaxyCameraFrameState;

  constructor(
    scene: FriendsGalaxyRendererScene,
    width = 1,
    height = 1,
    insets: FriendsGalaxyViewportInsets = EMPTY_VIEWPORT_INSETS,
  ) {
    this.scene = scene;
    this.width = finiteExtent(width);
    this.height = finiteExtent(height);
    this.insets = normalizedInsets(insets);
    this.frameValue = this.buildFrame();
    this.fit(true);
  }

  get transform(): Readonly<FriendsGalaxyTransform> {
    return this.transformValue;
  }

  get frame(): FriendsGalaxyCameraFrameState {
    return this.frameValue;
  }

  resize(
    width: number,
    height: number,
    insets: FriendsGalaxyViewportInsets = this.insets,
  ): void {
    const previousCenterX = interactionCenterX(this.width, this.insets);
    const previousCenterY = interactionCenterY(this.height, this.insets);
    const previousScale = Math.max(0.0001, this.transformValue.scale);
    const worldX = (previousCenterX - this.transformValue.x) / previousScale;
    const worldY = (previousCenterY - this.transformValue.y) / previousScale;
    this.width = finiteExtent(width);
    this.height = finiteExtent(height);
    this.insets = normalizedInsets(insets);
    this.frameValue = this.buildFrame();
    const scale = Math.max(
      this.frameValue.outwardZoomEnvelope.target,
      Math.min(this.frameValue.scaleLimits.maximum, previousScale),
    );
    this.transformValue.scale = scale;
    this.transformValue.x = interactionCenterX(this.width, this.insets) - worldX * scale;
    this.transformValue.y = interactionCenterY(this.height, this.insets) - worldY * scale;
  }

  replaceScene(scene: FriendsGalaxyRendererScene, preserveCamera = true): void {
    const centerX = interactionCenterX(this.width, this.insets);
    const centerY = interactionCenterY(this.height, this.insets);
    const previousScale = Math.max(0.0001, this.transformValue.scale);
    const worldX = (centerX - this.transformValue.x) / previousScale;
    const worldY = (centerY - this.transformValue.y) / previousScale;
    this.scene = scene;
    this.frameValue = this.buildFrame();
    if (!preserveCamera) {
      this.fit(true);
      return;
    }
    const scale = Math.max(
      this.frameValue.outwardZoomEnvelope.target,
      Math.min(this.frameValue.scaleLimits.maximum, previousScale),
    );
    this.transformValue.scale = scale;
    this.transformValue.x = centerX - worldX * scale;
    this.transformValue.y = centerY - worldY * scale;
  }

  fit(initial = false): void {
    writeFriendsGalaxyFramedTransform(
      this.transformValue,
      this.scene.atlas.bounds,
      this.frameValue,
      this.width,
      this.height,
      this.insets,
      initial,
    );
  }

  focusNode(nodeId: string, minimumScale = 0.92): boolean {
    const nodeIndex = findFriendsGalaxySceneNodeIndex(
      this.scene.scene,
      this.scene.interactionIndex,
      nodeId,
    );
    if (nodeIndex === null) return false;
    const offset = nodeIndex * 3;
    const requestedScale = Number.isFinite(minimumScale)
      ? Math.max(0, minimumScale)
      : 0.92;
    const scale = Math.min(
      this.frameValue.scaleLimits.maximum,
      Math.max(this.transformValue.scale, requestedScale),
    );
    writeFriendsGalaxyFocusedTransform(
      this.transformValue,
      this.scene.scene.positions[offset]!,
      -this.scene.scene.positions[offset + 1]!,
      this.scene.scene.positions[offset + 2]!,
      scale,
      this.width,
      this.height,
      this.insets,
    );
    return true;
  }

  panBy(deltaX: number, deltaY: number): boolean {
    if (!Number.isFinite(deltaX) || !Number.isFinite(deltaY)) return false;
    if (deltaX === 0 && deltaY === 0) return false;
    this.transformValue.x += deltaX;
    this.transformValue.y += deltaY;
    return true;
  }

  zoomAt(viewportX: number, viewportY: number, scaleRatio: number): boolean {
    return this.zoomBetween(
      viewportX,
      viewportY,
      viewportX,
      viewportY,
      scaleRatio,
    );
  }

  zoomBetween(
    previousViewportX: number,
    previousViewportY: number,
    nextViewportX: number,
    nextViewportY: number,
    scaleRatio: number,
  ): boolean {
    if (
      !Number.isFinite(previousViewportX) ||
      !Number.isFinite(previousViewportY) ||
      !Number.isFinite(nextViewportX) ||
      !Number.isFinite(nextViewportY) ||
      !Number.isFinite(scaleRatio) ||
      scaleRatio <= 0
    ) return false;
    if (
      scaleRatio === 1 &&
      previousViewportX === nextViewportX &&
      previousViewportY === nextViewportY
    ) return false;
    const previousX = this.transformValue.x;
    const previousY = this.transformValue.y;
    const previousScale = this.transformValue.scale;
    const worldX = (previousViewportX - this.transformValue.x) / previousScale;
    const worldY = (previousViewportY - this.transformValue.y) / previousScale;
    applyFriendsGalaxyResistedZoomAt(
      this.transformValue,
      previousViewportX,
      previousViewportY,
      scaleRatio,
      this.frameValue.outwardZoomEnvelope.target,
      this.frameValue.outwardZoomEnvelope.resistance,
      this.frameValue.scaleLimits.maximum,
    );
    this.transformValue.x = nextViewportX - worldX * this.transformValue.scale;
    this.transformValue.y = nextViewportY - worldY * this.transformValue.scale;
    return this.transformValue.scale !== previousScale ||
      this.transformValue.x !== previousX ||
      this.transformValue.y !== previousY;
  }

  pinch(
    previousFirstX: number,
    previousFirstY: number,
    previousSecondX: number,
    previousSecondY: number,
    nextFirstX: number,
    nextFirstY: number,
    nextSecondX: number,
    nextSecondY: number,
  ): boolean {
    return applyFriendsGalaxyPinch(
      this.transformValue,
      previousFirstX,
      previousFirstY,
      previousSecondX,
      previousSecondY,
      nextFirstX,
      nextFirstY,
      nextSecondX,
      nextSecondY,
      this.frameValue.outwardZoomEnvelope.target,
      this.frameValue.outwardZoomEnvelope.resistance,
      this.frameValue.scaleLimits.maximum,
    );
  }

  private buildFrame(): FriendsGalaxyCameraFrameState {
    return friendsGalaxyCameraFrameState(
      this.scene.atlas.bounds,
      this.scene.scene.bounds.minZ,
      this.scene.scene.bounds.maxZ,
      this.width,
      this.height,
      this.insets,
    );
  }
}
