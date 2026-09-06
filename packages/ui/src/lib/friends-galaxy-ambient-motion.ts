export const FRIENDS_GALAXY_AMBIENT_MOTION_PROFILE =
  "Depth drift and selective stellar scintillation";

export const FRIENDS_GALAXY_FIELD_AMBIENT_MOTION_PROFILE =
  "Cosmic field flow, depth drift, and selective stellar scintillation";

export function friendsGalaxyAmbientMotionTimeSeconds(
  timeMs: number,
  enabled: boolean,
  _cameraInMotion: boolean,
): number {
  // Camera gestures must not reset the stars' drift or scintillation phase.
  if (!enabled || !Number.isFinite(timeMs)) return -1;
  return Math.max(0, timeMs) / 1_000;
}
