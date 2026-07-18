import {
  FRIENDS_GALAXY_STAR_PALETTE_ROLE_COUNT,
  FriendsGalaxyStarColorRole,
} from "./friends-galaxy-star-instances.js";

export const FRIENDS_GALAXY_STAR_PALETTE_FLOAT_OFFSET = 20;
export const FRIENDS_GALAXY_STAR_PALETTE_FLOAT_COUNT =
  FRIENDS_GALAXY_STAR_PALETTE_ROLE_COUNT * 4;

export interface FriendsGalaxyStarPalette {
  background: string;
  mutedText: string;
  friend: string;
  connection: string;
  account: string;
  feed: string;
  selection: string;
  providers: {
    instagram: string;
    facebook: string;
    linkedin: string;
    x: string;
    rss: string;
  };
}

export interface FriendsGalaxyStarPaletteState {
  clearColor: readonly [number, number, number];
  lightSurface: boolean;
}

export function friendsGalaxyHexToRgb(value: string): [number, number, number] {
  const normalized = value.trim().replace(/^#/, "");
  if (!/^[0-9a-f]{6}$/i.test(normalized)) return [1, 1, 1];
  return [
    Number.parseInt(normalized.slice(0, 2), 16) / 255,
    Number.parseInt(normalized.slice(2, 4), 16) / 255,
    Number.parseInt(normalized.slice(4, 6), 16) / 255,
  ];
}

export function friendsGalaxyColorIsLight(value: string): boolean {
  const [red, green, blue] = friendsGalaxyHexToRgb(value);
  return red * 0.2126 + green * 0.7152 + blue * 0.0722 > 0.58;
}

export function writeFriendsGalaxyStarPaletteUniforms(
  target: Float32Array,
  palette: FriendsGalaxyStarPalette,
): FriendsGalaxyStarPaletteState {
  const requiredLength =
    FRIENDS_GALAXY_STAR_PALETTE_FLOAT_OFFSET + FRIENDS_GALAXY_STAR_PALETTE_FLOAT_COUNT;
  if (target.length < requiredLength) {
    throw new Error("Friends Galaxy star palette uniform storage is too small.");
  }
  const clearColor = friendsGalaxyHexToRgb(palette.background);
  const lightSurface = friendsGalaxyColorIsLight(palette.background);
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
    const [red, green, blue] = friendsGalaxyHexToRgb(colors[role]!);
    const offset = FRIENDS_GALAXY_STAR_PALETTE_FLOAT_OFFSET + role * 4;
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
