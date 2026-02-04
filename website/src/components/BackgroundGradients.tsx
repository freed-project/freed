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
  `radial-gradient(circle, 
    rgba(139, 92, 246, 0.095) 0%, 
    rgba(139, 92, 246, 0.08) 10%, 
    rgba(139, 92, 246, 0.06) 20%, 
    rgba(139, 92, 246, 0.04) 30%, 
    rgba(139, 92, 246, 0.025) 40%, 
    rgba(139, 92, 246, 0.012) 50%, 
    rgba(139, 92, 246, 0.006) 60%, 
    rgba(139, 92, 246, 0.002) 70%, 
    rgba(139, 92, 246, 0.0007) 80%,
    transparent 100%)`,
  `radial-gradient(circle, 
    rgba(59, 130, 246, 0.075) 0%, 
    rgba(59, 130, 246, 0.06) 10%, 
    rgba(59, 130, 246, 0.045) 20%, 
    rgba(59, 130, 246, 0.03) 30%, 
    rgba(59, 130, 246, 0.018) 40%, 
    rgba(59, 130, 246, 0.009) 50%, 
    rgba(59, 130, 246, 0.004) 60%, 
    rgba(59, 130, 246, 0.0015) 70%, 
    rgba(59, 130, 246, 0.0004) 80%,
    transparent 100%)`,
  `radial-gradient(circle, 
    rgba(6, 182, 212, 0.045) 0%, 
    rgba(6, 182, 212, 0.036) 10%, 
    rgba(6, 182, 212, 0.027) 20%, 
    rgba(6, 182, 212, 0.018) 30%, 
    rgba(6, 182, 212, 0.01) 40%, 
    rgba(6, 182, 212, 0.005) 50%, 
    rgba(6, 182, 212, 0.002) 60%, 
    rgba(6, 182, 212, 0.0007) 70%, 
    rgba(6, 182, 212, 0.0002) 80%,
    transparent 100%)`,
];

const VERTICAL_SPACING = 600; // Pixels between orb rows
const ORBS_PER_ROW = 2;

function generateOrbs(documentHeight: number): OrbConfig[] {
  const orbs: OrbConfig[] = [];
  const numRows = Math.ceil(documentHeight / VERTICAL_SPACING) + 1;

  for (let row = 0; row < numRows; row++) {
    const baseY = row * VERTICAL_SPACING;

    for (let i = 0; i < ORBS_PER_ROW; i++) {
      orbs.push({
        x: Math.random() * 80 + 10, // 10-90% horizontal
        y: baseY + Math.random() * VERTICAL_SPACING * 0.5, // Randomize within band
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
