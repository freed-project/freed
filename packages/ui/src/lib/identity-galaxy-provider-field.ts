export interface ProviderGalaxyPoint {
  x: number;
  y: number;
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

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}

export function providerGalaxySeed(provider: string): number {
  return seededUnit(`provider-galaxy:${provider}`);
}

export function providerGalaxyArmCount(provider: string): number {
  return 3 + Math.floor(providerGalaxySeed(provider) * 2.999);
}

export function providerGalaxyLocalPoint(
  provider: string,
  armIndex: number,
  progress: number,
  radiusX: number,
  radiusY: number,
  angularOffset = 0,
): ProviderGalaxyPoint {
  const armCount = providerGalaxyArmCount(provider);
  const seed = providerGalaxySeed(provider);
  const normalizedProgress = clamp(progress, 0, 1);
  const radialProgress = 0.1 + Math.sqrt(normalizedProgress) * 0.78;
  const spiralAngle =
    seed * Math.PI * 2 +
    (armIndex % armCount) * (Math.PI * 2 / armCount) +
    normalizedProgress * Math.PI * 2.35 +
    Math.sin(normalizedProgress * Math.PI * 5 + seed * Math.PI * 2) * 0.055 +
    angularOffset;
  return {
    x: Math.cos(spiralAngle) * radiusX * radialProgress,
    y: Math.sin(spiralAngle) * radiusY * radialProgress,
  };
}

export function providerGalaxyNodePoint(
  provider: string,
  index: number,
  count: number,
  radiusX: number,
  radiusY: number,
): ProviderGalaxyPoint {
  const armCount = providerGalaxyArmCount(provider);
  const armIndex = index % armCount;
  const indexInArm = Math.floor(index / armCount);
  const armPopulation = Math.max(1, Math.ceil((Math.max(1, count) - armIndex) / armCount));
  const progress = (indexInArm + 0.34) / (armPopulation + 0.34);
  const angularJitter = (seededUnit(`${provider}:node:${index}:angle`) - 0.5) * 0.16;
  const radialJitter = (seededUnit(`${provider}:node:${index}:radius`) - 0.5) * 0.055;
  const point = providerGalaxyLocalPoint(
    provider,
    armIndex,
    clamp(progress + radialJitter, 0.015, 0.985),
    radiusX,
    radiusY,
    angularJitter,
  );
  return point;
}
