"use client";

import DemoLink from "@/components/DemoLink";
import { useTheme } from "@/context/ThemeContext";
import assets from "@/data/showcase.json";

export default function ProductShowcase() {
  const { activeThemeId } = useTheme();
  const asset = assets.themes[activeThemeId];

  return (
    <DemoLink className="demo-showcase" aria-label="Try Freed live in a new tab">
      <picture>
        <source media="(prefers-reduced-motion: reduce)" srcSet={asset.poster.url} />
        {/* Keep the original animation and its alpha channel intact. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={asset.animation.url}
          alt="Freed showing Unified Feed, Map, Friends, friend details, mobile Stories, and the mobile reader"
          width={960}
          height={640}
          loading="lazy"
          className="h-auto w-full"
        />
      </picture>
      <span className="btn-primary demo-showcase-caption">Try it live</span>
    </DemoLink>
  );
}
