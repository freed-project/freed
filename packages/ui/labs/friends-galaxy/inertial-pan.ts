const MAX_SAMPLE_GAP_MS = 90;
const MAX_FRAME_GAP_MS = 120;
const DECAY_TIME_CONSTANT_MS = 260;
const MIN_START_SPEED = 0.06;
const STOP_SPEED = 0.015;
const MAX_SPEED = 3.2;

export interface GalaxyLabInertialPanStep {
  deltaX: number;
  deltaY: number;
  active: boolean;
  finished: boolean;
}

export class GalaxyLabInertialPan {
  private readonly stepResult: GalaxyLabInertialPanStep = {
    deltaX: 0,
    deltaY: 0,
    active: false,
    finished: false,
  };
  private velocityX = 0;
  private velocityY = 0;
  private lastSampleTimeMs = 0;
  private lastFrameTimeMs = 0;
  private active = false;

  get isActive(): boolean {
    return this.active;
  }

  get currentVelocityX(): number {
    return this.velocityX;
  }

  get currentVelocityY(): number {
    return this.velocityY;
  }

  begin(timeMs: number): void {
    this.active = false;
    this.velocityX = 0;
    this.velocityY = 0;
    this.lastSampleTimeMs = Number.isFinite(timeMs) ? timeMs : 0;
    this.lastFrameTimeMs = 0;
  }

  sample(deltaX: number, deltaY: number, timeMs: number): void {
    if (
      !Number.isFinite(deltaX) ||
      !Number.isFinite(deltaY) ||
      !Number.isFinite(timeMs)
    ) return;
    const elapsedMs = timeMs - this.lastSampleTimeMs;
    this.lastSampleTimeMs = timeMs;
    if (elapsedMs <= 0 || elapsedMs > MAX_SAMPLE_GAP_MS) {
      this.velocityX = 0;
      this.velocityY = 0;
      return;
    }
    const nextVelocityX = deltaX / elapsedMs;
    const nextVelocityY = deltaY / elapsedMs;
    const blend = Math.max(0.4, Math.min(0.85, elapsedMs / 24));
    this.velocityX += (nextVelocityX - this.velocityX) * blend;
    this.velocityY += (nextVelocityY - this.velocityY) * blend;
    this.capVelocity();
  }

  start(
    releaseTimeMs: number,
    frameTimeMs: number,
    reducedMotion: boolean,
  ): boolean {
    this.active = false;
    if (
      reducedMotion ||
      !Number.isFinite(releaseTimeMs) ||
      !Number.isFinite(frameTimeMs) ||
      releaseTimeMs - this.lastSampleTimeMs > MAX_SAMPLE_GAP_MS ||
      this.speedSquared() < MIN_START_SPEED * MIN_START_SPEED
    ) {
      this.velocityX = 0;
      this.velocityY = 0;
      return false;
    }
    this.active = true;
    this.lastFrameTimeMs = frameTimeMs;
    return true;
  }

  step(timeMs: number): GalaxyLabInertialPanStep {
    if (!this.active || !Number.isFinite(timeMs)) {
      return this.writeStep(0, 0, false, false);
    }
    const elapsedMs = timeMs - this.lastFrameTimeMs;
    if (elapsedMs <= 0) {
      return this.writeStep(0, 0, true, false);
    }
    if (elapsedMs > MAX_FRAME_GAP_MS) {
      this.cancel();
      return this.writeStep(0, 0, false, true);
    }
    this.lastFrameTimeMs = timeMs;
    const decay = Math.exp(-elapsedMs / DECAY_TIME_CONSTANT_MS);
    const distanceScale = DECAY_TIME_CONSTANT_MS * (1 - decay);
    const deltaX = this.velocityX * distanceScale;
    const deltaY = this.velocityY * distanceScale;
    this.velocityX *= decay;
    this.velocityY *= decay;
    if (this.speedSquared() < STOP_SPEED * STOP_SPEED) {
      this.cancel();
      return this.writeStep(deltaX, deltaY, false, true);
    }
    return this.writeStep(deltaX, deltaY, true, false);
  }

  cancel(): void {
    this.active = false;
    this.velocityX = 0;
    this.velocityY = 0;
    this.lastFrameTimeMs = 0;
  }

  private capVelocity(): void {
    const speedSquared = this.speedSquared();
    if (speedSquared <= MAX_SPEED * MAX_SPEED) return;
    const scale = MAX_SPEED / Math.sqrt(speedSquared);
    this.velocityX *= scale;
    this.velocityY *= scale;
  }

  private speedSquared(): number {
    return this.velocityX * this.velocityX + this.velocityY * this.velocityY;
  }

  private writeStep(
    deltaX: number,
    deltaY: number,
    active: boolean,
    finished: boolean,
  ): GalaxyLabInertialPanStep {
    this.stepResult.deltaX = deltaX;
    this.stepResult.deltaY = deltaY;
    this.stepResult.active = active;
    this.stepResult.finished = finished;
    return this.stepResult;
  }
}
