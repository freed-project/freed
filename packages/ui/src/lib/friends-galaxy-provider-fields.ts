import type { IdentityGraphAtlasRegion } from "./identity-graph-atlas.js";
import {
  providerGalaxyArmCount,
  providerGalaxySeed,
} from "./identity-galaxy-provider-field.js";
import {
  friendsGalaxyColorIsLight,
  friendsGalaxyHexToRgb,
  type FriendsGalaxyStarPalette,
} from "./friends-galaxy-palette.js";

export type FriendsGalaxyFieldStyle = "nebula-rings" | "nebula" | "rings";

export const FRIENDS_GALAXY_PROVIDER_FIELD_CULL_SCALE = 1.5;
export const FRIENDS_GALAXY_PROVIDER_FIELD_INSTANCE_FLOATS = 12;
export const FRIENDS_GALAXY_PROVIDER_FIELD_INSTANCE_STRIDE =
  FRIENDS_GALAXY_PROVIDER_FIELD_INSTANCE_FLOATS * Float32Array.BYTES_PER_ELEMENT;

export interface FriendsGalaxyProviderFieldGeometryInput {
  positions: Float32Array;
  personCount: number;
  regions: readonly IdentityGraphAtlasRegion[];
}

export interface FriendsGalaxyProviderFields {
  instanceData: Float32Array;
  providerKeys: readonly string[];
  count: number;
}

function fieldStyleCode(style: FriendsGalaxyFieldStyle): number {
  if (style === "rings") return 1;
  if (style === "nebula-rings") return 2;
  return 0;
}

function boundedPersonCount(positions: Float32Array, personCount: number): number {
  const requestedCount = Number.isFinite(personCount)
    ? Math.max(0, Math.floor(personCount))
    : 0;
  return Math.min(requestedCount, Math.floor(positions.length / 3));
}

function identityFieldBounds(
  positions: Float32Array,
  personCount: number,
): {
  centerX: number;
  centerY: number;
  halfWidth: number;
  halfHeight: number;
} {
  const count = boundedPersonCount(positions, personCount);
  if (count === 0) {
    return { centerX: 0, centerY: 0, halfWidth: 1, halfHeight: 1 };
  }

  let minX = positions[0]!;
  let maxX = minX;
  let minY = positions[1]!;
  let maxY = minY;
  for (let index = 1; index < count; index += 1) {
    minX = Math.min(minX, positions[index * 3]!);
    maxX = Math.max(maxX, positions[index * 3]!);
    minY = Math.min(minY, positions[index * 3 + 1]!);
    maxY = Math.max(maxY, positions[index * 3 + 1]!);
  }
  return {
    centerX: (minX + maxX) * 0.5,
    centerY: (minY + maxY) * 0.5,
    halfWidth: Math.max(1, (maxX - minX) * 0.68),
    halfHeight: Math.max(1, (maxY - minY) * 0.72),
  };
}

function writeFieldGeometry(
  target: Float32Array,
  index: number,
  field: {
    x: number;
    y: number;
    z: number;
    halfWidth: number;
    halfHeight: number;
    seed: number;
    arms: number;
  },
): void {
  const offset = index * FRIENDS_GALAXY_PROVIDER_FIELD_INSTANCE_FLOATS;
  target[offset] = field.x;
  target[offset + 1] = field.y;
  target[offset + 2] = field.z;
  target[offset + 3] = field.halfWidth;
  target[offset + 4] = field.halfHeight;
  target[offset + 9] = field.seed;
  target[offset + 10] = field.arms;
}

function writeFieldPresentation(
  target: Float32Array,
  index: number,
  color: string,
  alpha: number,
  styleCode: number,
): void {
  const offset = index * FRIENDS_GALAXY_PROVIDER_FIELD_INSTANCE_FLOATS;
  const [red, green, blue] = friendsGalaxyHexToRgb(color);
  target[offset + 5] = red;
  target[offset + 6] = green;
  target[offset + 7] = blue;
  target[offset + 8] = alpha;
  target[offset + 11] = styleCode;
}

export function createFriendsGalaxyProviderFields(
  input: FriendsGalaxyProviderFieldGeometryInput,
): FriendsGalaxyProviderFields {
  const providerKeys = input.regions.map((region) => region.provider);
  const count = providerKeys.length + 1;
  const instanceData = new Float32Array(
    count * FRIENDS_GALAXY_PROVIDER_FIELD_INSTANCE_FLOATS,
  );
  const identityBounds = identityFieldBounds(input.positions, input.personCount);
  writeFieldGeometry(instanceData, 0, {
    x: identityBounds.centerX,
    y: identityBounds.centerY,
    z: -310,
    halfWidth: identityBounds.halfWidth,
    halfHeight: identityBounds.halfHeight,
    seed: 0.618,
    arms: 6,
  });

  input.regions.forEach((region, index) => {
    writeFieldGeometry(instanceData, index + 1, {
      x: region.x,
      y: -region.y,
      z: -250,
      halfWidth: region.radiusX * 1.32,
      halfHeight: region.radiusY * 1.38,
      seed: providerGalaxySeed(region.provider),
      arms: providerGalaxyArmCount(region.provider),
    });
  });

  return { instanceData, providerKeys, count };
}

export function writeFriendsGalaxyProviderFieldPresentation(
  fields: FriendsGalaxyProviderFields,
  palette: FriendsGalaxyStarPalette,
  style: FriendsGalaxyFieldStyle,
): void {
  const expectedLength = fields.count * FRIENDS_GALAXY_PROVIDER_FIELD_INSTANCE_FLOATS;
  if (
    fields.count !== fields.providerKeys.length + 1 ||
    fields.instanceData.length !== expectedLength
  ) {
    throw new Error("Friends Galaxy provider field storage is malformed.");
  }
  const light = friendsGalaxyColorIsLight(palette.background);
  const styleCode = fieldStyleCode(style);
  writeFieldPresentation(
    fields.instanceData,
    0,
    palette.friend,
    light ? 0.065 : 0.16,
    styleCode,
  );

  fields.providerKeys.forEach((provider, index) => {
    const providerColor = palette.providers[
      provider as keyof FriendsGalaxyStarPalette["providers"]
    ];
    writeFieldPresentation(
      fields.instanceData,
      index + 1,
      providerColor ?? palette.account,
      light ? 0.13 : 0.34,
      styleCode,
    );
  });
}
