export interface GalaxyLabViewportProjection {
  viewProjection: ArrayLike<number>;
  width: number;
  height: number;
}

export function projectGalaxyLabWorldPoint(
  target: Float32Array,
  projection: GalaxyLabViewportProjection,
  worldX: number,
  worldY: number,
  worldZ: number,
  marginPixels = 0,
): boolean {
  const matrix = projection.viewProjection;
  const clipX = matrix[0]! * worldX + matrix[4]! * worldY + matrix[8]! * worldZ + matrix[12]!;
  const clipY = matrix[1]! * worldX + matrix[5]! * worldY + matrix[9]! * worldZ + matrix[13]!;
  const clipW = matrix[3]! * worldX + matrix[7]! * worldY + matrix[11]! * worldZ + matrix[15]!;
  if (!Number.isFinite(clipW) || clipW <= 0.0001) return false;

  const width = Math.max(1, projection.width);
  const height = Math.max(1, projection.height);
  const screenX = (clipX / clipW + 1) * width * 0.5;
  const screenY = (1 - clipY / clipW) * height * 0.5;
  target[0] = screenX;
  target[1] = screenY;
  return screenX >= -marginPixels && screenX <= width + marginPixels &&
    screenY >= -marginPixels && screenY <= height + marginPixels;
}
