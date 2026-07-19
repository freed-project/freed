import type { ThemeId } from "@freed/shared";
import type { FriendsGalaxyRendererPalette } from "./friends-galaxy-palette.js";

export const FRIENDS_GALAXY_THEME_PALETTES = {
  scriptorium: {
    background: "#f2e5cc",
    surface: "#f8efdc",
    text: "#302218",
    mutedText: "#745f4d",
    friend: "#735336",
    connection: "#477c86",
    account: "#a7794b",
    feed: "#b34f68",
    selection: "#237da0",
    providers: {
      instagram: "#c64f85",
      facebook: "#3d72c4",
      linkedin: "#2d7d9d",
      x: "#59636b",
      rss: "#d1842d",
    },
  },
  neon: {
    background: "#07090d",
    surface: "#11151d",
    text: "#f6fbff",
    mutedText: "#a2b1c1",
    friend: "#6df2d0",
    connection: "#f7d66d",
    account: "#9ac4ff",
    feed: "#ff77a9",
    selection: "#ffffff",
    providers: {
      instagram: "#ff5ea8",
      facebook: "#70a2ff",
      linkedin: "#49d4f2",
      x: "#d4dee8",
      rss: "#ffbd62",
    },
  },
  midas: {
    background: "#11100d",
    surface: "#1d1a13",
    text: "#fff8de",
    mutedText: "#c8b991",
    friend: "#f4d36b",
    connection: "#83c5be",
    account: "#d7a95e",
    feed: "#e7786f",
    selection: "#fff2a8",
    providers: {
      instagram: "#e77da7",
      facebook: "#75a7e8",
      linkedin: "#5eb7c8",
      x: "#cbc6b8",
      rss: "#f0a44a",
    },
  },
  ember: {
    background: "#140b0a",
    surface: "#1d1210",
    text: "#f7ede9",
    mutedText: "#ab8474",
    friend: "#c15a2e",
    connection: "#6aa5a0",
    account: "#d69a5d",
    feed: "#d97a72",
    selection: "#f0bd7c",
    providers: {
      instagram: "#e06f9d",
      facebook: "#6f91d9",
      linkedin: "#55a8b8",
      x: "#d2c3bd",
      rss: "#e49a4c",
    },
  },
} satisfies Record<ThemeId, FriendsGalaxyRendererPalette>;

export function friendsGalaxyRendererPaletteForTheme(
  themeId: string | null | undefined,
): FriendsGalaxyRendererPalette {
  if (
    themeId &&
    Object.prototype.hasOwnProperty.call(FRIENDS_GALAXY_THEME_PALETTES, themeId)
  ) {
    return FRIENDS_GALAXY_THEME_PALETTES[
      themeId as keyof typeof FRIENDS_GALAXY_THEME_PALETTES
    ];
  }
  return FRIENDS_GALAXY_THEME_PALETTES.scriptorium;
}
