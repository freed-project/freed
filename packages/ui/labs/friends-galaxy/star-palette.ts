import { hexToRgb } from "./backend.js";
import type { GalaxyLabPalette } from "./scene-fixture.js";
import {
  FRIENDS_GALAXY_STAR_PALETTE_ROLE_COUNT,
  FriendsGalaxyStarColorRole,
} from "../../src/lib/friends-galaxy-star-instances.js";

export const GALAXY_LAB_STAR_PALETTE_FLOAT_OFFSET = 20;
export const GALAXY_LAB_STAR_PALETTE_FLOAT_COUNT =
  FRIENDS_GALAXY_STAR_PALETTE_ROLE_COUNT * 4;

export interface GalaxyLabStarPaletteState {
  clearColor: readonly [number, number, number];
  lightSurface: boolean;
}

export function writeGalaxyLabStarPaletteUniforms(
  target: Float32Array,
  palette: GalaxyLabPalette,
): GalaxyLabStarPaletteState {
  const requiredLength =
    GALAXY_LAB_STAR_PALETTE_FLOAT_OFFSET + GALAXY_LAB_STAR_PALETTE_FLOAT_COUNT;
  if (target.length < requiredLength) {
    throw new Error("Friends Galaxy star palette uniform storage is too small.");
  }
  const clearColor = hexToRgb(palette.background);
  const luminance =
    clearColor[0] * 0.2126 + clearColor[1] * 0.7152 + clearColor[2] * 0.0722;
  const lightSurface = luminance > 0.58;
  const colors = [
    palette.friend,
    palette.connection,
    palette.account,
    palette.feed,
    palette.providers.instagram,
    palette.providers.facebook,
    palette.providers.linkedin,
    palette.providers.x,
    palette.providers.rss,
    palette.mutedText,
    palette.selection,
  ];

  for (let role = 0; role < colors.length; role += 1) {
    const [red, green, blue] = hexToRgb(colors[role]!);
    const offset = GALAXY_LAB_STAR_PALETTE_FLOAT_OFFSET + role * 4;
    target[offset] = red;
    target[offset + 1] = green;
    target[offset + 2] = blue;
    target[offset + 3] = role === FriendsGalaxyStarColorRole.Background
      ? lightSurface ? 0.2 : 0.5
      : role === FriendsGalaxyStarColorRole.Selection
        ? 1
        : lightSurface ? 0.88 : 0.97;
  }
  return { clearColor, lightSurface };
}
