import type { FriendsGalaxyTransform } from "./friends-galaxy-viewport.js";

export const FRIENDS_GALAXY_FIT_ANIMATION_DURATION_MS = 420;

export interface FriendsGalaxyCameraAnimationStep {
  transform: FriendsGalaxyTransform;
  active: boolean;
  finished: boolean;
}

function finiteTransform(transform: FriendsGalaxyTransform): boolean {
  return Number.isFinite(transform.x) && Number.isFinite(transform.y) &&
    Number.isFinite(transform.scale) && transform.scale > 0;
}

function transformChanged(
  source: FriendsGalaxyTransform,
  target: FriendsGalaxyTransform,
): boolean {
  return Math.abs(source.x - target.x) > 0.0001 ||
    Math.abs(source.y - target.y) > 0.0001 ||
    Math.abs(Math.log(source.scale / target.scale)) > 0.000001;
}

function easeInOutCubic(progress: number): number {
  return progress < 0.5
    ? 4 * progress * progress * progress
    : 1 - Math.pow(-2 * progress + 2, 3) / 2;
}

export class FriendsGalaxyCameraFitAnimation {
  private readonly stepResult: FriendsGalaxyCameraAnimationStep = {
    transform: { x: 0, y: 0, scale: 1 },
    active: false,
    finished: false,
  };
  private sourceCenterX = 0;
  private sourceCenterY = 0;
  private targetCenterX = 0;
  private targetCenterY = 0;
  private sourceLogScale = 0;
  private targetLogScale = 0;
  private targetX = 0;
  private targetY = 0;
  private targetScale = 1;
  private viewportCenterX = 0;
  private viewportCenterY = 0;
  private startTimeMs = 0;
  private active = false;

  get isActive(): boolean {
    return this.active;
  }

  start(
    source: FriendsGalaxyTransform,
    target: FriendsGalaxyTransform,
    viewportCenterX: number,
    viewportCenterY: number,
    startTimeMs: number,
    reducedMotion: boolean,
  ): boolean {
    this.cancel();
    if (
      reducedMotion || !finiteTransform(source) || !finiteTransform(target) ||
      !Number.isFinite(viewportCenterX) || !Number.isFinite(viewportCenterY) ||
      !Number.isFinite(startTimeMs) || !transformChanged(source, target)
    ) return false;

    this.viewportCenterX = viewportCenterX;
    this.viewportCenterY = viewportCenterY;
    this.sourceCenterX = (viewportCenterX - source.x) / source.scale;
    this.sourceCenterY = (viewportCenterY - source.y) / source.scale;
    this.targetCenterX = (viewportCenterX - target.x) / target.scale;
    this.targetCenterY = (viewportCenterY - target.y) / target.scale;
    this.sourceLogScale = Math.log(source.scale);
    this.targetLogScale = Math.log(target.scale);
    this.targetX = target.x;
    this.targetY = target.y;
    this.targetScale = target.scale;
    this.startTimeMs = startTimeMs;
    this.active = true;
    this.writeTransform(source.x, source.y, source.scale, true, false);
    return true;
  }

  step(timeMs: number): FriendsGalaxyCameraAnimationStep {
    if (!this.active || !Number.isFinite(timeMs)) {
      this.stepResult.active = false;
      this.stepResult.finished = false;
      return this.stepResult;
    }
    const progress = Math.max(0, Math.min(
      1,
      (timeMs - this.startTimeMs) / FRIENDS_GALAXY_FIT_ANIMATION_DURATION_MS,
    ));
    const eased = easeInOutCubic(progress);
    const scale = Math.exp(
      this.sourceLogScale + (this.targetLogScale - this.sourceLogScale) * eased,
    );
    const centerX = this.sourceCenterX +
      (this.targetCenterX - this.sourceCenterX) * eased;
    const centerY = this.sourceCenterY +
      (this.targetCenterY - this.sourceCenterY) * eased;
    const finished = progress >= 1;
    if (finished) {
      this.active = false;
      return this.writeTransform(
        this.targetX,
        this.targetY,
        this.targetScale,
        false,
        true,
      );
    }
    return this.writeTransform(
      this.viewportCenterX - centerX * scale,
      this.viewportCenterY - centerY * scale,
      scale,
      this.active,
      false,
    );
  }

  cancel(): void {
    this.active = false;
  }

  private writeTransform(
    x: number,
    y: number,
    scale: number,
    active: boolean,
    finished: boolean,
  ): FriendsGalaxyCameraAnimationStep {
    this.stepResult.transform.x = x;
    this.stepResult.transform.y = y;
    this.stepResult.transform.scale = scale;
    this.stepResult.active = active;
    this.stepResult.finished = finished;
    return this.stepResult;
  }
}
