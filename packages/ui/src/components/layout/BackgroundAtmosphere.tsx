"use client";

import { useEffect, useMemo, useState } from "react";
import {
  getThemeDefinition,
  resolveThemeId,
  type ThemeId,
  type ThemeBackgroundRecipe,
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

interface Orb {
  channel: ChannelName;
  x: number;
  y: number;
  size: number;
  intensity: number;
}

function randomInRange(min: number, range: number): number {
  return min + Math.random() * range;
}

function generateOrbs(recipe: ThemeBackgroundRecipe): Orb[] {
  const orbs: Orb[] = [];
  const rowRecipe = recipe.rowOrbs;

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
    for (let i = 0; i < rowRecipe.countPerRow; i++) {
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

function buildBackground(
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

function buildRepeatValues(
  count: number,
  recipe: ThemeBackgroundRecipe,
): string {
  return [
    ...recipe.textures.map((texture) => texture.repeat),
    ...Array(count).fill("no-repeat"),
  ].join(", ");
}

function buildSizeValues(count: number, recipe: ThemeBackgroundRecipe): string {
  return [
    ...recipe.textures.map((texture) => texture.size),
    ...Array(count).fill("auto"),
  ].join(", ");
}

export function BackgroundAtmosphere() {
  const [orbs, setOrbs] = useState<Orb[] | null>(null);
  const [isMobile, setIsMobile] = useState(false);
  const [themeId, setThemeId] = useState<ThemeId>("neon");
  const themeRecipe = useMemo(
    () => getThemeDefinition(themeId).background,
    [themeId],
  );

  useEffect(() => {
    const initialThemeId = resolveThemeId(
      document.documentElement.dataset.theme || "neon",
    );
    setOrbs(generateOrbs(getThemeDefinition(initialThemeId).background));
    setIsMobile(window.innerWidth < MOBILE_BREAKPOINT);
    setThemeId(initialThemeId);

    const observer = new MutationObserver(() => {
      const nextThemeId = resolveThemeId(
        document.documentElement.dataset.theme || "neon",
      );
      setThemeId(nextThemeId);
      setOrbs(generateOrbs(getThemeDefinition(nextThemeId).background));
    });
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme"],
    });

    let rafId = 0;
    const onResize = () => {
      cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(() => {
        setIsMobile(window.innerWidth < MOBILE_BREAKPOINT);
      });
    };
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("resize", onResize);
      cancelAnimationFrame(rafId);
      observer.disconnect();
    };
  }, []);

  const backgroundImage = useMemo(
    () => (orbs ? buildBackground(orbs, isMobile ? 0.5 : 1, themeRecipe) : ""),
    [orbs, isMobile, themeRecipe],
  );
  const backgroundRepeat = useMemo(
    () => (orbs ? buildRepeatValues(orbs.length, themeRecipe) : ""),
    [orbs, themeRecipe],
  );
  const backgroundSize = useMemo(
    () => (orbs ? buildSizeValues(orbs.length, themeRecipe) : ""),
    [orbs, themeRecipe],
  );

  if (!orbs) return null;

  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden="true">
      <div
        className="absolute inset-0"
        style={{
          backgroundImage,
          backgroundRepeat,
          backgroundSize,
          willChange: "transform",
          transform: "translateZ(0)",
        }}
      />
      <div
        className="bg-gradient-orbs absolute inset-0"
      />
    </div>
  );
}
