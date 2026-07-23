export const FRIENDS_GALAXY_IDENTITY_DETAIL_FADE_START_SCALE = 0.58;
export const FRIENDS_GALAXY_IDENTITY_DETAIL_FADE_END_SCALE = 0.98;

const FADE_IN_TIME_CONSTANT_MS = 105;
const FADE_OUT_TIME_CONSTANT_MS = 135;
const MAX_FRAME_ADVANCE_MS = 48;
const SETTLED_OPACITY_EPSILON = 0.0025;
const CHANGED_OPACITY_EPSILON = 0.000001;

export interface FriendsGalaxyIdentityDetailFadeStep {
  opacity: number;
  targetOpacity: number;
  active: boolean;
  changed: boolean;
}

export function friendsGalaxyIdentityDetailTargetOpacity(scale: number): number {
  if (!Number.isFinite(scale) || scale <= FRIENDS_GALAXY_IDENTITY_DETAIL_FADE_START_SCALE) {
    return 0;
  }
  if (scale >= FRIENDS_GALAXY_IDENTITY_DETAIL_FADE_END_SCALE) return 1;
  const progress = (scale - FRIENDS_GALAXY_IDENTITY_DETAIL_FADE_START_SCALE) /
    (FRIENDS_GALAXY_IDENTITY_DETAIL_FADE_END_SCALE -
      FRIENDS_GALAXY_IDENTITY_DETAIL_FADE_START_SCALE);
  return progress * progress * (3 - 2 * progress);
}

export class FriendsGalaxyIdentityDetailFade {
  private readonly stepResult: FriendsGalaxyIdentityDetailFadeStep = {
    opacity: 0,
    targetOpacity: 0,
    active: false,
    changed: false,
  };
  private opacity = 0;
  private targetOpacity = 0;
  private lastFrameTimeMs = Number.NaN;
  private active = false;

  get currentOpacity(): number {
    return this.opacity;
  }

  get isActive(): boolean {
    return this.active;
  }

  restartFromHidden(): void {
    this.opacity = 0;
    this.targetOpacity = 0;
    this.lastFrameTimeMs = Number.NaN;
    this.active = false;
  }

  step(
    scale: number,
    timeMs: number,
    motionEnabled: boolean,
  ): FriendsGalaxyIdentityDetailFadeStep {
    const nextTarget = friendsGalaxyIdentityDetailTargetOpacity(scale);
    this.targetOpacity = nextTarget;
    if (!motionEnabled) {
      const changed = Math.abs(this.opacity - nextTarget) > CHANGED_OPACITY_EPSILON;
      this.opacity = nextTarget;
      this.lastFrameTimeMs = Number.isFinite(timeMs) ? timeMs : Number.NaN;
      this.active = false;
      return this.writeStep(changed);
    }
    if (!Number.isFinite(timeMs)) {
      this.active = Math.abs(this.opacity - nextTarget) > SETTLED_OPACITY_EPSILON;
      return this.writeStep(false);
    }
    if (!Number.isFinite(this.lastFrameTimeMs)) {
      this.lastFrameTimeMs = timeMs;
      this.active = Math.abs(this.opacity - nextTarget) > SETTLED_OPACITY_EPSILON;
      return this.writeStep(false);
    }
    const elapsedMs = Math.min(
      MAX_FRAME_ADVANCE_MS,
      Math.max(0, timeMs - this.lastFrameTimeMs),
    );
    this.lastFrameTimeMs = timeMs;
    if (elapsedMs === 0) {
      this.active = Math.abs(this.opacity - nextTarget) > SETTLED_OPACITY_EPSILON;
      return this.writeStep(false);
    }
    const previousOpacity = this.opacity;
    const timeConstantMs = nextTarget >= previousOpacity
      ? FADE_IN_TIME_CONSTANT_MS
      : FADE_OUT_TIME_CONSTANT_MS;
    const decay = Math.exp(-elapsedMs / timeConstantMs);
    this.opacity = nextTarget + (previousOpacity - nextTarget) * decay;
    if (Math.abs(this.opacity - nextTarget) <= SETTLED_OPACITY_EPSILON) {
      this.opacity = nextTarget;
      this.active = false;
    } else {
      this.active = true;
    }
    return this.writeStep(
      Math.abs(this.opacity - previousOpacity) > CHANGED_OPACITY_EPSILON,
    );
  }

  private writeStep(changed: boolean): FriendsGalaxyIdentityDetailFadeStep {
    this.stepResult.opacity = this.opacity;
    this.stepResult.targetOpacity = this.targetOpacity;
    this.stepResult.active = this.active;
    this.stepResult.changed = changed;
    return this.stepResult;
  }
}
