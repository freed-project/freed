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
    tagline: "Calm slate, clear thought, and no unnecessary drama.",
    description:
      "Neutral slate, smoke, and restrained contrast. Clean enough for work, warm enough to stay human.",
    previewGradient: "linear-gradient(135deg, #46535d, #6f7a81 55%, #8f969a)",
    surface: "dark",
    effects: "restrained",
  },
  {
    id: "ember",
    name: "Ember",
    tagline: "Iron, soot, and a hand that means it.",
    description:
      "Volcanic charcoal with ember-orange heat. Heavier, sharper, and built like forged metal.",
    previewGradient: "linear-gradient(135deg, #7a2f1f, #c15a2e 55%, #5b1711)",
    surface: "dark",
    effects: "dramatic",
  },
  {
    id: "scriptorium",
    name: "Scriptorium",
    tagline: "Warm paper, dark ink, and a mind finally left alone.",
    description:
      "A low-blue-light editorial theme for long reading sessions. Vellum, walnut, and quietly dignified typography.",
    previewGradient: "linear-gradient(135deg, #f4ead7, #d8c4a1 55%, #86684a)",
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
