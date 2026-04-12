import { DEFAULT_THEME_ID, getThemeDefinition, type ThemeId } from "@freed/shared/themes";

type Rgb = { r: number; g: number; b: number };

export interface FriendAvatarPalette {
  tintHex: string;
  borderStrong: string;
  borderSoft: string;
  glow: string;
  glowSoft: string;
  ring: string;
  gradientStart: string;
  gradientMid: string;
  gradientEnd: string;
  imageOverlay: string;
  imageShadow: string;
  imageHighlight: string;
  selectionStroke: string;
  selectionOuterStroke: string;
  labelBorder: string;
  initialsShadow: string;
}

function clampChannel(value: number): number {
  return Math.max(0, Math.min(255, Math.round(value)));
}

function normalizeThemeId(input?: ThemeId | null): ThemeId {
  return input ?? DEFAULT_THEME_ID;
}

function hexToRgb(hex: string): Rgb {
  return {
    r: parseInt(hex.slice(1, 3), 16),
    g: parseInt(hex.slice(3, 5), 16),
    b: parseInt(hex.slice(5, 7), 16),
  };
}

function mix(a: Rgb, b: Rgb, ratio: number): Rgb {
  return {
    r: clampChannel(a.r + (b.r - a.r) * ratio),
    g: clampChannel(a.g + (b.g - a.g) * ratio),
    b: clampChannel(a.b + (b.b - a.b) * ratio),
  };
}

function rgba(rgb: Rgb, alpha: number): string {
  return `rgba(${rgb.r},${rgb.g},${rgb.b},${alpha})`;
}

export function createFriendAvatarPalette(themeId?: ThemeId | null): FriendAvatarPalette {
  const tintHex = getThemeDefinition(normalizeThemeId(themeId)).avatarTint;
  const base = hexToRgb(tintHex);
  const light = mix(base, { r: 255, g: 255, b: 255 }, 0.26);
  const bright = mix(base, { r: 255, g: 255, b: 255 }, 0.4);
  const dark = mix(base, { r: 20, g: 14, b: 30 }, 0.56);
  const deep = mix(base, { r: 10, g: 8, b: 16 }, 0.76);

  return {
    tintHex,
    borderStrong: rgba(light, 0.82),
    borderSoft: rgba(base, 0.24),
    glow: rgba(base, 0.3),
    glowSoft: rgba(base, 0.18),
    ring: rgba(bright, 0.2),
    gradientStart: rgba(bright, 0.96),
    gradientMid: rgba(base, 0.9),
    gradientEnd: rgba(deep, 0.98),
    imageOverlay: `radial-gradient(circle at 30% 28%, ${rgba(bright, 0.22)}, ${rgba(base, 0.2)} 42%, ${rgba(dark, 0.28)} 100%)`,
    imageShadow: rgba(deep, 0.36),
    imageHighlight: rgba(bright, 0.16),
    selectionStroke: rgba(bright, 0.96),
    selectionOuterStroke: rgba(base, 0.9),
    labelBorder: rgba(base, 0.28),
    initialsShadow: rgba(bright, 0.42),
  };
}
