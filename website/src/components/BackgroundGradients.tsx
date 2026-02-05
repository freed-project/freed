"use client";

import { useState, useEffect, useMemo } from "react";

// Color definitions with per-color intensity multipliers
const colors = {
  purple: { rgb: [139, 92, 246], intensity: 1.0 },
  blue: { rgb: [59, 130, 246], intensity: 1.0 },
  cyan: { rgb: [6, 182, 212], intensity: 0.75 },
} as const;

type ColorName = keyof typeof colors;

const MAX_HEIGHT = 2500; // Pre-generate for tall pages, CSS clips the rest
const VERTICAL_SPACING = 600;
const HERO_ZONE_HEIGHT = 800;
const MOBILE_BREAKPOINT = 768;

const BASE_COLOR_INTENSITY = 0.12;
const NOISE_INTENSITY = 1.5;
const NOISE_TEXTURE = `url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='1.2' numOctaves='4' stitchTiles='stitch' result='noise'/%3E%3CfeColorMatrix type='matrix' values='0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0.5 0' in='noise' result='dark'/%3E%3CfeComponentTransfer in='dark'%3E%3CfeFuncA type='linear' slope='${NOISE_INTENSITY}'/%3E%3C/feComponentTransfer%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E")`;

interface Orb {
  color: ColorName;
  x: number;
  y: number;
  size: number;
  intensity: number;
}

function generateOrbs(): Orb[] {
  const orbs: Orb[] = [];
  const colorNames: ColorName[] = ["purple", "blue", "cyan"];

  // Hero orbs
  orbs.push({
    color: "purple",
    x: 15 + Math.random() * 35,
    y: 100 + Math.random() * 300,
    size: 600 + Math.random() * 400,
    intensity: 1.2,
  });
  orbs.push({
    color: "blue",
    x: 50 + Math.random() * 35,
    y: 200 + Math.random() * 400,
    size: 550 + Math.random() * 400,
    intensity: 1.0,
  });

  // Page orbs throughout max height
  const numRows =
    Math.ceil((MAX_HEIGHT - HERO_ZONE_HEIGHT) / VERTICAL_SPACING) + 1;
  for (let row = 0; row < numRows; row++) {
    const baseY = HERO_ZONE_HEIGHT + row * VERTICAL_SPACING;
    for (let i = 0; i < 2; i++) {
      orbs.push({
        color: colorNames[Math.floor(Math.random() * colorNames.length)],
        x: Math.random() * 80 + 10,
        y: baseY + Math.random() * VERTICAL_SPACING * 0.5,
        size: 500 + Math.random() * 400,
        intensity: 0.6 + Math.random() * 0.6,
      });
    }
  }

  return orbs;
}

function buildBackground(orbs: Orb[], intensityMultiplier: number): string {
  const gradients = orbs.map((orb) => {
    const { rgb, intensity: colorIntensity } = colors[orb.color];
    const [r, g, b] = rgb;
    const o =
      BASE_COLOR_INTENSITY *
      orb.intensity *
      colorIntensity *
      intensityMultiplier;
    return `radial-gradient(${orb.size}px ${orb.size}px at ${orb.x}% ${orb.y}px, rgba(${r}, ${g}, ${b}, ${o}), transparent)`;
  });
  return [NOISE_TEXTURE, ...gradients].join(", ");
}

function buildRepeatValues(count: number): string {
  return ["repeat", ...Array(count).fill("no-repeat")].join(", ");
}

function buildSizeValues(count: number): string {
  return ["256px 256px", ...Array(count).fill("auto")].join(", ");
}

export default function BackgroundGradients() {
  const [orbs, setOrbs] = useState<Orb[] | null>(null);
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    setOrbs(generateOrbs());
    setIsMobile(window.innerWidth < MOBILE_BREAKPOINT);

    let rafId: number;
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
    };
  }, []);

  // Memoize all computed styles - only recompute when deps actually change
  const backgroundImage = useMemo(
    () => (orbs ? buildBackground(orbs, isMobile ? 0.5 : 1) : ""),
    [orbs, isMobile],
  );
  const backgroundRepeat = useMemo(
    () => (orbs ? buildRepeatValues(orbs.length) : ""),
    [orbs],
  );
  const backgroundSize = useMemo(
    () => (orbs ? buildSizeValues(orbs.length) : ""),
    [orbs],
  );

  // Don't render until client-side to avoid hydration mismatch
  if (!orbs) return null;

  return (
    <div
      className="absolute inset-0 pointer-events-none"
      aria-hidden="true"
      style={{
        zIndex: 0,
        backgroundImage,
        backgroundRepeat,
        backgroundSize,
        // GPU layer promotion
        willChange: "transform",
        transform: "translateZ(0)",
      }}
    />
  );
}
