import type { ThemeId } from "./types.js";
export type { ThemeId } from "./types.js";

export interface ThemeDefinition {
  id: ThemeId;
  name: string;
  tagline: string;
  description: string;
  previewGradient: string;
  surface: "dark" | "light";
  effects: "dramatic" | "restrained";
}

export const DEFAULT_THEME_ID: ThemeId = "neon";

export const THEME_DEFINITIONS: readonly ThemeDefinition[] = [
  {
    id: "neon",
    name: "Neon",
    tagline: "Electric, rebellious, and gloriously overclocked.",
    description:
      "Freed in its original high-voltage form. Blue, purple, cyan, and a little bit of trouble.",
    previewGradient: "linear-gradient(135deg, #3b82f6, #8b5cf6 55%, #06b6d4)",
    surface: "dark",
    effects: "dramatic",
  },
  {
    id: "midas",
    name: "Midas",
    tagline: "A rescued scroll lit by candle and ambition.",
    description:
      "Parchment, bronze, and old-world warmth. Elegant, ceremonial, and quietly grand.",
    previewGradient: "linear-gradient(135deg, #7c5c38, #b08a48 55%, #5f4a32)",
    surface: "dark",
    effects: "dramatic",
  },
  {
    id: "vesper",
    name: "Vesper",
    tagline: "Precise, modern, and professionally dangerous.",
    description:
      "Slate, pearl, and surgical restraint. Built for focus without feeling sterile.",
    previewGradient: "linear-gradient(135deg, #4f6a7a, #90a4b4 55%, #d8dee5)",
    surface: "dark",
    effects: "restrained",
  },
  {
    id: "ember",
    name: "Ember",
    tagline: "Banked coals, iron tools, and a long memory.",
    description:
      "Volcanic charcoal with ember-orange heat. Serious, tactile, and quietly alive.",
    previewGradient: "linear-gradient(135deg, #7a2f1f, #c15a2e 55%, #5b1711)",
    surface: "dark",
    effects: "dramatic",
  },
  {
    id: "porcelain",
    name: "Porcelain",
    tagline: "Minimal, lucid, and impossible to clutter.",
    description:
      "Ivory, graphite, and pale mineral accents. Calm enough to think in, sharp enough to ship in.",
    previewGradient: "linear-gradient(135deg, #f2eee6, #d8d2c6 55%, #8a857d)",
    surface: "light",
    effects: "restrained",
  },
];

export function isThemeId(value: string): value is ThemeId {
  return THEME_DEFINITIONS.some((theme) => theme.id === value);
}

export function resolveThemeId(value: string | null | undefined): ThemeId {
  return value && isThemeId(value) ? value : DEFAULT_THEME_ID;
}

export function getThemeDefinition(themeId: ThemeId): ThemeDefinition {
  return (
    THEME_DEFINITIONS.find((theme) => theme.id === themeId) ??
    THEME_DEFINITIONS[0]
  );
}
