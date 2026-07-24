export const FRIENDS_GALAXY_SETTLED_STAR_VERTEX_COUNT = 4;
export const FRIENDS_GALAXY_MOTION_STAR_VERTEX_COUNT =
  FRIENDS_GALAXY_SETTLED_STAR_VERTEX_COUNT;
export const FRIENDS_GALAXY_MOTION_BACKGROUND_STAR_CAP = 50_000;

export interface FriendsGalaxyStarGeometry {
  settled: Float32Array;
  motion: Float32Array;
}

export function createFriendsGalaxyStarGeometry(): FriendsGalaxyStarGeometry {
  const settled = new Float32Array([
    -1, -1,
    1, -1,
    -1, 1,
    1, 1,
  ]);
  return {
    settled,
    motion: settled.slice(),
  };
}

export function friendsGalaxyMotionBackgroundStarCount(residentCount: number): number {
  const normalizedCount = Number.isFinite(residentCount)
    ? Math.max(0, Math.floor(residentCount))
    : 0;
  return Math.min(FRIENDS_GALAXY_MOTION_BACKGROUND_STAR_CAP, normalizedCount);
}
