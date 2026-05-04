"use client";

import { useEffect, useMemo, useState } from "react";
import {
  DEFAULT_THEME_ID,
  getThemeDefinition,
  resolveThemeId,
  type ThemeId,
  type ThemeBackgroundRecipe,
  type ThemeBackgroundTextureLayer,
} from "@freed/shared/themes";

const channels = {
  secondary: { rgbVar: "--theme-accent-secondary-rgb", intensity: 1.0 },
  primary: { rgbVar: "--theme-accent-primary-rgb", intensity: 1.0 },
  tertiary: { rgbVar: "--theme-accent-tertiary-rgb", intensity: 0.75 },
} as const;

type ChannelName = keyof typeof channels;

const MAX_HEIGHT = 2500;
const VERTICAL_SPACING = 600;
const HERO_ZONE_HEIGHT = 800;
const MOBILE_BREAKPOINT = 768;
const DESKTOP_BASELINE_WIDTH = 1280;
const MIN_WIDTH_SCALE = 0.58;

interface Orb {
  channel: ChannelName;
  x: number;
  y: number;
  size: number;
  intensity: number;
}

interface ViewportProfile {
  compact: boolean;
  orbSizeScale: number;
  orbIntensityScale: number;
}

type RendererMode = NonNullable<ThemeBackgroundRecipe["renderer"]>;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function randomInRange(min: number, range: number): number {
  return min + Math.random() * range;
}

function getViewportProfile(viewportWidth: number): ViewportProfile {
  const widthScale = clamp(
    viewportWidth / DESKTOP_BASELINE_WIDTH,
    MIN_WIDTH_SCALE,
    1,
  );

  return {
    compact: viewportWidth < MOBILE_BREAKPOINT,
    orbSizeScale: Math.sqrt(widthScale),
    orbIntensityScale: clamp(0.72 + widthScale * 0.28, 0.82, 1),
  };
}

function getCompactCountPerRow(countPerRow: number): number {
  return Math.max(1, Math.ceil(countPerRow / 2));
}

function generateOrbs(
  recipe: ThemeBackgroundRecipe,
  compact: boolean,
  rendererMode: RendererMode,
): Orb[] {
  const orbs: Orb[] = [];
  const rowRecipe = recipe.rowOrbs;
  const countPerRow =
    rendererMode === "legacy"
      ? rowRecipe.countPerRow
      : compact
    ? getCompactCountPerRow(rowRecipe.countPerRow)
    : rowRecipe.countPerRow;

  recipe.heroOrbs.forEach((heroOrb) => {
    orbs.push({
      channel: heroOrb.channel,
      x: randomInRange(heroOrb.xMin, heroOrb.xRange),
      y: randomInRange(heroOrb.yMin, heroOrb.yRange),
      size: randomInRange(heroOrb.sizeMin, heroOrb.sizeRange),
      intensity: heroOrb.intensity,
    });
  });

  const numRows =
    Math.ceil((MAX_HEIGHT - HERO_ZONE_HEIGHT) / VERTICAL_SPACING) + 1;
  for (let row = 0; row < numRows; row++) {
    const baseY = HERO_ZONE_HEIGHT + row * VERTICAL_SPACING;
    for (let i = 0; i < countPerRow; i++) {
      orbs.push({
        channel:
          rowRecipe.channels[
            Math.floor(Math.random() * rowRecipe.channels.length)
          ],
        x: randomInRange(rowRecipe.xMin, rowRecipe.xRange),
        y: baseY + Math.random() * VERTICAL_SPACING * rowRecipe.yRangeFactor,
        size: randomInRange(rowRecipe.sizeMin, rowRecipe.sizeRange),
        intensity: randomInRange(
          rowRecipe.intensityMin,
          rowRecipe.intensityRange,
        ),
      });
    }
  }

  return orbs;
}

function buildGradientBackground(
  orbs: Orb[],
  viewportProfile: ViewportProfile,
  recipe: ThemeBackgroundRecipe,
): string {
  return orbs
    .map((orb) => {
      const { rgbVar, intensity } = channels[orb.channel];
      const size = Math.round(orb.size * viewportProfile.orbSizeScale);
      const opacityMultiplier = Number(
        (
          orb.intensity
          * intensity
          * viewportProfile.orbIntensityScale
        ).toFixed(3),
      );
      return `radial-gradient(${size}px ${size}px at ${orb.x}% ${orb.y}px, rgb(var(${rgbVar}) / ${recipe.baseOpacity * opacityMultiplier}), transparent)`;
    })
    .join(", ");
}

function buildLegacyBackground(
  orbs: Orb[],
  intensityMultiplier: number,
  recipe: ThemeBackgroundRecipe,
): string {
  const gradients = orbs
    .map((orb) => {
      const { rgbVar, intensity } = channels[orb.channel];
      const opacityMultiplier = Number(
        (orb.intensity * intensity * intensityMultiplier).toFixed(3),
      );
      return `radial-gradient(${orb.size}px ${orb.size}px at ${orb.x}% ${orb.y}px, rgb(var(${rgbVar}) / ${recipe.baseOpacity * opacityMultiplier}), transparent)`;
    })
    .join(", ");
  const textures = recipe.textures.map((texture) => texture.image);
  return [...textures, gradients].join(", ");
}

function buildGradientRepeatValues(count: number): string {
  return Array(count).fill("no-repeat").join(", ");
}

function buildGradientSizeValues(count: number): string {
  return Array(count).fill("auto").join(", ");
}

function buildLegacyRepeatValues(
  count: number,
  recipe: ThemeBackgroundRecipe,
): string {
  return [
    ...recipe.textures.map((texture) => texture.repeat),
    ...Array(count).fill("no-repeat"),
  ].join(", ");
}

function buildLegacySizeValues(
  count: number,
  recipe: ThemeBackgroundRecipe,
): string {
  return [
    ...recipe.textures.map((texture) => texture.size),
    ...Array(count).fill("auto"),
  ].join(", ");
}

function resolveTextureSize(
  texture: ThemeBackgroundTextureLayer,
  viewportProfile: ViewportProfile,
): string {
  return viewportProfile.compact
    ? texture.compactSize ?? texture.size
    : texture.size;
}

function resolveTextureOpacity(
  texture: ThemeBackgroundTextureLayer,
  viewportProfile: ViewportProfile,
): number {
  if (!viewportProfile.compact) {
    return 1;
  }

  return texture.compactOpacity ?? 1;
}

export function BackgroundAtmosphere() {
  const [orbs, setOrbs] = useState<Orb[] | null>(null);
  const [viewportWidth, setViewportWidth] = useState(DESKTOP_BASELINE_WIDTH);
  const [themeId, setThemeId] = useState<ThemeId>(DEFAULT_THEME_ID);
  const themeRecipe = useMemo(
    () => getThemeDefinition(themeId).background,
    [themeId],
  );
  const viewportProfile = useMemo(
    () => getViewportProfile(viewportWidth),
    [viewportWidth],
  );
  const rendererMode: RendererMode = themeRecipe.renderer ?? "responsive";
  const isLegacyRenderer = rendererMode === "legacy";

  useEffect(() => {
    const initialThemeId = resolveThemeId(
      document.documentElement.dataset.theme || DEFAULT_THEME_ID,
    );
    setViewportWidth(window.innerWidth);
    setThemeId(initialThemeId);

    const observer = new MutationObserver(() => {
      const nextThemeId = resolveThemeId(
        document.documentElement.dataset.theme || DEFAULT_THEME_ID,
      );
      setThemeId(nextThemeId);
    });
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme"],
    });

    let rafId = 0;
    const onResize = () => {
      cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(() => {
        setViewportWidth(window.innerWidth);
      });
    };
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("resize", onResize);
      cancelAnimationFrame(rafId);
      observer.disconnect();
    };
  }, []);

  useEffect(() => {
    setOrbs(generateOrbs(themeRecipe, viewportProfile.compact, rendererMode));
  }, [themeRecipe, viewportProfile.compact, rendererMode]);

  const gradientBackgroundImage = useMemo(
    () =>
      orbs
        ? isLegacyRenderer
          ? buildLegacyBackground(
              orbs,
              viewportProfile.compact ? 0.5 : 1,
              themeRecipe,
            )
          : buildGradientBackground(orbs, viewportProfile, themeRecipe)
        : "",
    [isLegacyRenderer, orbs, viewportProfile, themeRecipe],
  );
  const gradientBackgroundRepeat = useMemo(
    () =>
      orbs
        ? isLegacyRenderer
          ? buildLegacyRepeatValues(orbs.length, themeRecipe)
          : buildGradientRepeatValues(orbs.length)
        : "",
    [isLegacyRenderer, orbs, themeRecipe],
  );
  const gradientBackgroundSize = useMemo(
    () =>
      orbs
        ? isLegacyRenderer
          ? buildLegacySizeValues(orbs.length, themeRecipe)
          : buildGradientSizeValues(orbs.length)
        : "",
    [isLegacyRenderer, orbs, themeRecipe],
  );

  if (!orbs) return null;

  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden="true">
      {isLegacyRenderer ? (
        <div
          className="absolute inset-0"
          style={{
            backgroundImage: gradientBackgroundImage,
            backgroundRepeat: gradientBackgroundRepeat,
            backgroundSize: gradientBackgroundSize,
            willChange: "transform",
            transform: "translateZ(0)",
          }}
        />
      ) : (
        <>
          {themeRecipe.textures.map((texture, index) => (
            <div
              key={`${themeId}-${index}`}
              className="absolute inset-0"
              style={{
                backgroundImage: texture.image,
                backgroundRepeat: texture.repeat,
                backgroundSize: resolveTextureSize(texture, viewportProfile),
                opacity: resolveTextureOpacity(texture, viewportProfile),
                willChange: "transform",
                transform: "translateZ(0)",
              }}
            />
          ))}
          <div
            className="absolute inset-0"
            style={{
              backgroundImage: gradientBackgroundImage,
              backgroundRepeat: gradientBackgroundRepeat,
              backgroundSize: gradientBackgroundSize,
              willChange: "transform",
              transform: "translateZ(0)",
            }}
          />
        </>
      )}
      {themeRecipe.overlayEnabled !== false && (
        <div className="bg-gradient-orbs absolute inset-0" />
      )}
    </div>
  );
}
