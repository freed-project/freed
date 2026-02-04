"use client";

import { useState, useEffect, useRef } from "react";

interface OrbConfig {
  x: number;
  y: number; // Now in pixels, not percentage
  size: number;
  gradient: string;
}

// Many color stops for ultra-smooth falloff
const gradients = [
  // Purple - most vibrant
  `radial-gradient(circle, 
    rgba(139, 92, 246, 0.18) 0%, 
    rgba(139, 92, 246, 0.15) 10%, 
    rgba(139, 92, 246, 0.11) 20%, 
    rgba(139, 92, 246, 0.075) 30%, 
    rgba(139, 92, 246, 0.045) 40%, 
    rgba(139, 92, 246, 0.022) 50%, 
    rgba(139, 92, 246, 0.01) 60%, 
    rgba(139, 92, 246, 0.004) 70%, 
    rgba(139, 92, 246, 0.001) 80%,
    transparent 100%)`,
  // Blue
  `radial-gradient(circle, 
    rgba(59, 130, 246, 0.15) 0%, 
    rgba(59, 130, 246, 0.12) 10%, 
    rgba(59, 130, 246, 0.09) 20%, 
    rgba(59, 130, 246, 0.06) 30%, 
    rgba(59, 130, 246, 0.036) 40%, 
    rgba(59, 130, 246, 0.018) 50%, 
    rgba(59, 130, 246, 0.008) 60%, 
    rgba(59, 130, 246, 0.003) 70%, 
    rgba(59, 130, 246, 0.001) 80%,
    transparent 100%)`,
  // Cyan
  `radial-gradient(circle, 
    rgba(6, 182, 212, 0.10) 0%, 
    rgba(6, 182, 212, 0.08) 10%, 
    rgba(6, 182, 212, 0.06) 20%, 
    rgba(6, 182, 212, 0.04) 30%, 
    rgba(6, 182, 212, 0.024) 40%, 
    rgba(6, 182, 212, 0.012) 50%, 
    rgba(6, 182, 212, 0.005) 60%, 
    rgba(6, 182, 212, 0.002) 70%, 
    rgba(6, 182, 212, 0.0005) 80%,
    transparent 100%)`,
];

// Hero gradients for above-the-fold - guaranteed visibility
const heroGradients = [gradients[0], gradients[1]]; // Purple and blue only

const VERTICAL_SPACING = 600; // Pixels between orb rows
const ORBS_PER_ROW = 2;
const HERO_ZONE_HEIGHT = 800; // Pixels - above the fold area

function generateOrbs(documentHeight: number): OrbConfig[] {
  const orbs: OrbConfig[] = [];

  // GUARANTEED: 2 hero orbs in the above-the-fold zone
  // These ensure color is always visible on initial load
  orbs.push({
    x: 15 + Math.random() * 35, // Left side: 15-50%
    y: 100 + Math.random() * 300, // Top area: 100-400px
    size: 1100 + Math.random() * 500,
    gradient: heroGradients[0], // Purple
  });
  orbs.push({
    x: 50 + Math.random() * 35, // Right side: 50-85%
    y: 200 + Math.random() * 400, // Slightly lower: 200-600px
    size: 1000 + Math.random() * 500,
    gradient: heroGradients[1], // Blue
  });

  // Additional orbs throughout the page (starting after hero zone)
  const numRows =
    Math.ceil((documentHeight - HERO_ZONE_HEIGHT) / VERTICAL_SPACING) + 1;

  for (let row = 0; row < numRows; row++) {
    const baseY = HERO_ZONE_HEIGHT + row * VERTICAL_SPACING;

    for (let i = 0; i < ORBS_PER_ROW; i++) {
      orbs.push({
        x: Math.random() * 80 + 10, // 10-90% horizontal
        y: baseY + Math.random() * VERTICAL_SPACING * 0.5,
        size: 1000 + Math.random() * 600,
        gradient: gradients[Math.floor(Math.random() * gradients.length)],
      });
    }
  }

  return orbs;
}

export default function BackgroundGradients() {
  const [orbs, setOrbs] = useState<OrbConfig[] | null>(null);
  const [docHeight, setDocHeight] = useState(0);
  const innerRef = useRef<HTMLDivElement>(null);
  const lastHeightRef = useRef<number>(0);

  useEffect(() => {
    // Generate orbs based on document height
    const updateOrbs = () => {
      const height = document.documentElement.scrollHeight;
      setDocHeight(height);
      // Only regenerate if height increased significantly (avoid flicker)
      if (height > lastHeightRef.current + VERTICAL_SPACING) {
        lastHeightRef.current = height;
        setOrbs(generateOrbs(height));
      } else if (lastHeightRef.current === 0) {
        lastHeightRef.current = height;
        setOrbs(generateOrbs(height));
      }
    };

    updateOrbs();

    // Watch for content height changes
    const resizeObserver = new ResizeObserver(updateOrbs);
    resizeObserver.observe(document.body);

    let ticking = false;

    // Throttled scroll update using rAF + GPU-accelerated transform
    const handleScroll = () => {
      if (!ticking) {
        requestAnimationFrame(() => {
          if (innerRef.current) {
            innerRef.current.style.transform = `translateY(${-window.scrollY}px)`;
          }
          ticking = false;
        });
        ticking = true;
      }
    };

    window.addEventListener("scroll", handleScroll, { passive: true });
    handleScroll();

    return () => {
      window.removeEventListener("scroll", handleScroll);
      resizeObserver.disconnect();
    };
  }, []);

  if (!orbs) return null;

  return (
    // Fixed viewport-sized wrapper that clips overflow
    <div
      className="fixed inset-0 pointer-events-none overflow-hidden"
      aria-hidden="true"
      style={{ zIndex: 0 }}
    >
      {/* Inner container sized to document height, translated on scroll */}
      <div
        ref={innerRef}
        className="absolute inset-x-0 top-0"
        style={{
          height: docHeight,
          willChange: "transform",
        }}
      >
        {orbs.map((orb, i) => (
          <div
            key={i}
            className="absolute"
            style={{
              width: orb.size,
              height: orb.size,
              left: `${orb.x}%`,
              top: orb.y,
              background: orb.gradient,
              transform: "translate(-50%, -50%)",
            }}
          />
        ))}
      </div>
    </div>
  );
}
