export interface FriendsGalaxyBackgroundField {
  positions: Float32Array;
  brightness: Float32Array;
}

function hashValue(value: string): number {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = Math.imul(31, hash) + value.charCodeAt(index) | 0;
  }
  return Math.abs(hash);
}

function seededUnit(value: string): number {
  return (hashValue(value) % 10_000) / 10_000;
}

export function createFriendsGalaxyBackgroundField(
  starCount: number,
  seed = "friends-galaxy",
): FriendsGalaxyBackgroundField {
  const safeCount = Number.isFinite(starCount)
    ? Math.max(0, Math.floor(starCount))
    : 0;
  const positions = new Float32Array(safeCount * 3);
  const brightness = new Float32Array(safeCount);
  for (let index = 0; index < safeCount; index += 1) {
    const key = `${seed ? `${seed}:` : ""}background:${index}`;
    const radius = 1_800 + Math.sqrt(seededUnit(`${key}:radius`)) * 7_600;
    const angle = seededUnit(`${key}:angle`) * Math.PI * 2;
    positions[index * 3] = Math.cos(angle) * radius;
    positions[index * 3 + 1] = Math.sin(angle) * radius * 0.68;
    positions[index * 3 + 2] = -260 - seededUnit(`${key}:depth`) * 1_300;
    brightness[index] = 0.2 + seededUnit(`${key}:brightness`) * 0.8;
  }
  return { positions, brightness };
}
