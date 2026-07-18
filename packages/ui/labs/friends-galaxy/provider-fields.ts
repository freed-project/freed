import {
  providerGalaxyArmCount,
  providerGalaxySeed,
} from "../../src/lib/identity-galaxy-provider-field.js";
import type { GalaxyLabFieldStyle } from "./backend.js";
import { friendsGalaxyHexToRgb } from "../../src/lib/friends-galaxy-palette.js";
import type {
  GalaxyLabFixture,
  GalaxyLabPalette,
  GalaxyLabProvider,
} from "./scene-fixture.js";

const PROVIDER_FIELD_INSTANCE_FLOATS = 12;
export const GALAXY_LAB_PROVIDER_FIELD_CULL_SCALE = 1.5;

export interface GalaxyLabProviderFields {
  instanceData: Float32Array;
  count: number;
}

function fieldStyleCode(style: GalaxyLabFieldStyle): number {
  if (style === "rings") return 1;
  if (style === "nebula-rings") return 2;
  return 0;
}

function sceneIsLight(palette: GalaxyLabPalette): boolean {
  const [red, green, blue] = friendsGalaxyHexToRgb(palette.background);
  return red * 0.2126 + green * 0.7152 + blue * 0.0722 > 0.58;
}

function writeField(
  target: Float32Array,
  index: number,
  field: {
    x: number;
    y: number;
    z: number;
    halfWidth: number;
    halfHeight: number;
    color: string;
    alpha: number;
    seed: number;
    arms: number;
    style: GalaxyLabFieldStyle;
  },
): void {
  const offset = index * PROVIDER_FIELD_INSTANCE_FLOATS;
  const [red, green, blue] = friendsGalaxyHexToRgb(field.color);
  target[offset] = field.x;
  target[offset + 1] = field.y;
  target[offset + 2] = field.z;
  target[offset + 3] = field.halfWidth;
  target[offset + 4] = field.halfHeight;
  target[offset + 5] = red;
  target[offset + 6] = green;
  target[offset + 7] = blue;
  target[offset + 8] = field.alpha;
  target[offset + 9] = field.seed;
  target[offset + 10] = field.arms;
  target[offset + 11] = fieldStyleCode(field.style);
}

function identityFieldBounds(fixture: GalaxyLabFixture): {
  centerX: number;
  centerY: number;
  halfWidth: number;
  halfHeight: number;
} {
  let minX = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (let index = 0; index < fixture.personCount; index += 1) {
    minX = Math.min(minX, fixture.scene.positions[index * 3]!);
    maxX = Math.max(maxX, fixture.scene.positions[index * 3]!);
    minY = Math.min(minY, fixture.scene.positions[index * 3 + 1]!);
    maxY = Math.max(maxY, fixture.scene.positions[index * 3 + 1]!);
  }
  return {
    centerX: (minX + maxX) * 0.5,
    centerY: (minY + maxY) * 0.5,
    halfWidth: Math.max(1, (maxX - minX) * 0.68),
    halfHeight: Math.max(1, (maxY - minY) * 0.72),
  };
}

export function createGalaxyLabProviderFields(
  fixture: GalaxyLabFixture,
  palette: GalaxyLabPalette,
  style: GalaxyLabFieldStyle,
): GalaxyLabProviderFields {
  const count = fixture.atlas.regions.length + 1;
  const instanceData = new Float32Array(count * PROVIDER_FIELD_INSTANCE_FLOATS);
  const light = sceneIsLight(palette);
  const identityBounds = identityFieldBounds(fixture);
  writeField(instanceData, 0, {
    x: identityBounds.centerX,
    y: identityBounds.centerY,
    z: -310,
    halfWidth: identityBounds.halfWidth,
    halfHeight: identityBounds.halfHeight,
    color: palette.friend,
    alpha: light ? 0.065 : 0.16,
    seed: 0.618,
    arms: 6,
    style,
  });

  fixture.atlas.regions.forEach((region, index) => {
    const provider = region.provider as GalaxyLabProvider;
    writeField(instanceData, index + 1, {
      x: region.x,
      y: -region.y,
      z: -250,
      halfWidth: region.radiusX * 1.32,
      halfHeight: region.radiusY * 1.38,
      color: palette.providers[provider] ?? palette.account,
      alpha: light ? 0.13 : 0.34,
      seed: providerGalaxySeed(provider),
      arms: providerGalaxyArmCount(provider),
      style,
    });
  });

  return { instanceData, count };
}

export const GALAXY_LAB_PROVIDER_FIELD_INSTANCE_STRIDE =
  PROVIDER_FIELD_INSTANCE_FLOATS * Float32Array.BYTES_PER_ELEMENT;
