import type { ThemeId } from "@freed/shared/themes";

export interface FriendAvatarPalette {
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
  text: string;
}

const FALLBACK_PALETTE: FriendAvatarPalette = {
  borderStrong:
    "color-mix(in srgb, var(--theme-accent-primary) 68%, var(--theme-text-primary))",
  borderSoft: "rgb(var(--theme-accent-primary-rgb) / 0.24)",
  glow: "rgb(var(--theme-accent-secondary-rgb) / 0.3)",
  glowSoft: "rgb(var(--theme-accent-secondary-rgb) / 0.18)",
  ring: "rgb(var(--theme-accent-primary-rgb) / 0.2)",
  gradientStart:
    "color-mix(in srgb, var(--theme-accent-primary) 68%, white 32%)",
  gradientMid:
    "color-mix(in srgb, var(--theme-accent-primary) 36%, var(--theme-accent-secondary) 64%)",
  gradientEnd:
    "color-mix(in srgb, var(--theme-bg-deep) 64%, var(--theme-accent-secondary) 36%)",
  imageOverlay:
    "radial-gradient(circle at 30% 28%, rgb(var(--theme-accent-primary-rgb) / 0.22), rgb(var(--theme-accent-secondary-rgb) / 0.2) 42%, rgb(var(--theme-shell-rgb) / 0.28) 100%)",
  imageShadow: "rgb(var(--theme-shell-rgb) / 0.36)",
  imageHighlight: "rgb(var(--theme-accent-primary-rgb) / 0.16)",
  selectionStroke:
    "color-mix(in srgb, var(--theme-accent-primary) 56%, white 44%)",
  selectionOuterStroke:
    "color-mix(in srgb, var(--theme-accent-secondary) 72%, var(--theme-accent-primary) 28%)",
  labelBorder: "rgb(var(--theme-accent-secondary-rgb) / 0.28)",
  initialsShadow: "rgb(var(--theme-accent-primary-rgb) / 0.42)",
  text: "var(--theme-button-primary-text)",
};

function readThemeVar(
  styles: CSSStyleDeclaration,
  name: string,
  fallback: string,
): string {
  const value = styles.getPropertyValue(name).trim();
  return value || fallback;
}

export function createFriendAvatarPalette(
  themeId?: ThemeId | null,
): FriendAvatarPalette {
  void themeId;

  if (typeof document === "undefined") {
    return FALLBACK_PALETTE;
  }

  const styles = getComputedStyle(document.documentElement);
  return {
    borderStrong: readThemeVar(
      styles,
      "--theme-avatar-border-strong",
      FALLBACK_PALETTE.borderStrong,
    ),
    borderSoft: readThemeVar(
      styles,
      "--theme-avatar-border-soft",
      FALLBACK_PALETTE.borderSoft,
    ),
    glow: readThemeVar(styles, "--theme-avatar-glow", FALLBACK_PALETTE.glow),
    glowSoft: readThemeVar(
      styles,
      "--theme-avatar-glow-soft",
      FALLBACK_PALETTE.glowSoft,
    ),
    ring: readThemeVar(styles, "--theme-avatar-ring", FALLBACK_PALETTE.ring),
    gradientStart: readThemeVar(
      styles,
      "--theme-avatar-gradient-start",
      FALLBACK_PALETTE.gradientStart,
    ),
    gradientMid: readThemeVar(
      styles,
      "--theme-avatar-gradient-mid",
      FALLBACK_PALETTE.gradientMid,
    ),
    gradientEnd: readThemeVar(
      styles,
      "--theme-avatar-gradient-end",
      FALLBACK_PALETTE.gradientEnd,
    ),
    imageOverlay: readThemeVar(
      styles,
      "--theme-avatar-image-overlay",
      FALLBACK_PALETTE.imageOverlay,
    ),
    imageShadow: readThemeVar(
      styles,
      "--theme-avatar-image-shadow",
      FALLBACK_PALETTE.imageShadow,
    ),
    imageHighlight: readThemeVar(
      styles,
      "--theme-avatar-image-highlight",
      FALLBACK_PALETTE.imageHighlight,
    ),
    selectionStroke: readThemeVar(
      styles,
      "--theme-avatar-selection-stroke",
      FALLBACK_PALETTE.selectionStroke,
    ),
    selectionOuterStroke: readThemeVar(
      styles,
      "--theme-avatar-selection-outer-stroke",
      FALLBACK_PALETTE.selectionOuterStroke,
    ),
    labelBorder: readThemeVar(
      styles,
      "--theme-avatar-label-border",
      FALLBACK_PALETTE.labelBorder,
    ),
    initialsShadow: readThemeVar(
      styles,
      "--theme-avatar-initials-shadow",
      FALLBACK_PALETTE.initialsShadow,
    ),
    text: readThemeVar(styles, "--theme-avatar-text", FALLBACK_PALETTE.text),
  };
}
