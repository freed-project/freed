export const FRIENDS_GALAXY_DECORATIVE_STAR_MIN_SCALE = 0.55;
export const FRIENDS_GALAXY_DECORATIVE_STAR_REFERENCE_SCALE = 0.24;
export const FRIENDS_GALAXY_DECORATIVE_STAR_MAX_SCALE = 2.1;
export const FRIENDS_GALAXY_DECORATIVE_STAR_SCALE_SLOPE = 1.875;

export function friendsGalaxyDecorativeStarScale(cameraScale: number): number {
  const scale = Number.isFinite(cameraScale) ? Math.max(0, cameraScale) : 0;
  return Math.min(
    FRIENDS_GALAXY_DECORATIVE_STAR_MAX_SCALE,
    FRIENDS_GALAXY_DECORATIVE_STAR_MIN_SCALE +
      scale * FRIENDS_GALAXY_DECORATIVE_STAR_SCALE_SLOPE,
  );
}
