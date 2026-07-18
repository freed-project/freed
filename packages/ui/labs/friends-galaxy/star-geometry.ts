export const GALAXY_LAB_SETTLED_STAR_VERTEX_COUNT = 4;
export const GALAXY_LAB_MOTION_STAR_VERTEX_COUNT = 8;

export interface GalaxyLabStarGeometry {
  settled: Float32Array;
  motion: Float32Array;
}

export function createGalaxyLabStarGeometry(): GalaxyLabStarGeometry {
  const diagonal = Math.SQRT1_2;
  return {
    settled: new Float32Array([
      -1, -1,
      1, -1,
      -1, 1,
      1, 1,
    ]),
    motion: new Float32Array([
      -1, 0,
      -diagonal, -diagonal,
      -diagonal, diagonal,
      0, -1,
      0, 1,
      diagonal, -diagonal,
      diagonal, diagonal,
      1, 0,
    ]),
  };
}
