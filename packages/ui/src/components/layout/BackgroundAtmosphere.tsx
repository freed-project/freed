"use client";

import { useEffect, useMemo, useState } from "react";

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
const BASE_COLOR_INTENSITY = 0.12;

interface Orb {
  channel: ChannelName;
  x: number;
  y: number;
  size: number;
  intensity: number;
}

function generateOrbs(): Orb[] {
  const orbs: Orb[] = [];
  const names: ChannelName[] = ["secondary", "primary", "tertiary"];

  orbs.push({
    channel: "secondary",
    x: 15 + Math.random() * 35,
    y: 100 + Math.random() * 300,
    size: 600 + Math.random() * 400,
    intensity: 1.2,
  });
  orbs.push({
    channel: "primary",
    x: 50 + Math.random() * 35,
    y: 200 + Math.random() * 400,
    size: 550 + Math.random() * 400,
    intensity: 1.0,
  });

  const numRows =
    Math.ceil((MAX_HEIGHT - HERO_ZONE_HEIGHT) / VERTICAL_SPACING) + 1;
  for (let row = 0; row < numRows; row++) {
    const baseY = HERO_ZONE_HEIGHT + row * VERTICAL_SPACING;
    for (let i = 0; i < 2; i++) {
      orbs.push({
        channel: names[Math.floor(Math.random() * names.length)],
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
  return orbs
    .map((orb) => {
      const { rgbVar, intensity } = channels[orb.channel];
      const opacity =
        BASE_COLOR_INTENSITY *
        orb.intensity *
        intensity *
        intensityMultiplier;
      return `radial-gradient(${orb.size}px ${orb.size}px at ${orb.x}% ${orb.y}px, rgb(var(${rgbVar}) / ${opacity}), transparent)`;
    })
    .join(", ");
}

function buildRepeatValues(count: number): string {
  return Array(count).fill("no-repeat").join(", ");
}

function buildSizeValues(count: number): string {
  return Array(count).fill("auto").join(", ");
}

export function BackgroundAtmosphere() {
  const [orbs, setOrbs] = useState<Orb[] | null>(null);
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    setOrbs(generateOrbs());
    setIsMobile(window.innerWidth < MOBILE_BREAKPOINT);

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
    };
  }, []);

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
        className="absolute inset-0 opacity-60"
        style={{
          backgroundImage: [
            "radial-gradient(circle at 20% 20%, rgb(255 255 255 / 0.04) 0.7px, transparent 1px)",
            "radial-gradient(circle at 80% 30%, rgb(var(--theme-accent-secondary-rgb) / 0.04) 0.8px, transparent 1.1px)",
            "radial-gradient(circle at 30% 70%, rgb(var(--theme-accent-primary-rgb) / 0.03) 0.7px, transparent 1px)",
          ].join(", "),
          backgroundSize: "24px 24px, 32px 32px, 28px 28px",
          backgroundPosition: "0 0, 13px 9px, 7px 17px",
          mixBlendMode: "screen",
        }}
      />
      <div className="bg-gradient-orbs absolute inset-0 opacity-90" />
    </div>
  );
}
