"use client";

import { motion } from "framer-motion";
import { useState, useEffect, useRef, useCallback } from "react";

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

const COLORS = {
  blues: ["#3b82f6", "#6366f1", "#8b5cf6", "#a855f7", "#2563eb"],
  red: "#ef4444",
  logoBlue: "#3b82f6",
};

const CENTER = 200;
const RING_RADIUS = 175;
const LOGO_RADIUS = 220;
const BOX = { left: 155, right: 245, top: 155, bottom: 245 };

const PLATFORMS = [
  {
    id: "x",
    path: "M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z",
  },
  {
    id: "facebook",
    path: "M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z",
  },
  {
    id: "instagram",
    path: "M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zm0-2.163c-3.259 0-3.667.014-4.947.072-4.358.2-6.78 2.618-6.98 6.98-.059 1.281-.073 1.689-.073 4.948 0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98 1.281.058 1.689.072 4.948.072 3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98-1.281-.059-1.69-.073-4.949-.073zm0 5.838c-3.403 0-6.162 2.759-6.162 6.162s2.759 6.163 6.162 6.163 6.162-2.759 6.162-6.163c0-3.403-2.759-6.162-6.162-6.162zm0 10.162c-2.209 0-4-1.79-4-4 0-2.209 1.791-4 4-4s4 1.791 4 4c0 2.21-1.791 4-4 4zm6.406-11.845c-.796 0-1.441.645-1.441 1.44s.645 1.44 1.441 1.44c.795 0 1.439-.645 1.439-1.44s-.644-1.44-1.439-1.44z",
  },
  {
    id: "youtube",
    path: "M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z",
  },
  {
    id: "linkedin",
    path: "M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433c-1.144 0-2.063-.926-2.063-2.065 0-1.138.92-2.063 2.063-2.063 1.14 0 2.064.925 2.064 2.063 0 1.139-.925 2.065-2.064 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z",
  },
];

// Pre-compute logo positions and spin params
const LOGOS = PLATFORMS.map((platform, i) => {
  const angle = ((i * 360) / PLATFORMS.length - 90) * (Math.PI / 180);
  return {
    ...platform,
    angle,
    cx: CENTER + LOGO_RADIUS * Math.cos(angle),
    cy: CENTER + LOGO_RADIUS * Math.sin(angle),
    emitX: CENTER + RING_RADIUS * Math.cos(angle),
    emitY: CENTER + RING_RADIUS * Math.sin(angle),
    spinDuration: 25 + i * 5,
    spinDirection: Math.random() > 0.5 ? 1 : -1,
    flashDelay: Math.random() * 5,
  };
});

// ─────────────────────────────────────────────────────────────────────────────
// Particle System (single animation loop for all particles)
// ─────────────────────────────────────────────────────────────────────────────

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  opacity: number;
  scale: number;
  isRed: boolean;
  color: string;
  startX: number;
  startY: number;
  delay: number;
  age: number;
  state: "waiting" | "active" | "dead";
}

const PARTICLE_SPEED = 0.66;
const PARTICLES_PER_LOGO = 12;
const CYCLE_DURATION = 12000; // ms
const MAX_AGE = 600; // frames

function createParticle(logo: (typeof LOGOS)[0], isRed: boolean): Particle {
  // Aim directly at center with small random spread (±5 degrees)
  const angleToCenter = Math.atan2(CENTER - logo.emitY, CENTER - logo.emitX);
  const spread = (Math.random() - 0.5) * 0.17; // ~±5 degrees
  const angle = angleToCenter + spread;
  const speed = PARTICLE_SPEED + (Math.random() - 0.5) * 0.1;
  return {
    x: logo.emitX,
    y: logo.emitY,
    vx: Math.cos(angle) * speed,
    vy: Math.sin(angle) * speed,
    opacity: 1,
    scale: 1,
    isRed,
    color: isRed
      ? COLORS.red
      : COLORS.blues[Math.floor(Math.random() * COLORS.blues.length)],
    startX: logo.emitX,
    startY: logo.emitY,
    delay: Math.random() * CYCLE_DURATION,
    age: 0,
    state: "waiting",
  };
}

function initParticles(): Particle[] {
  return LOGOS.flatMap((logo) =>
    Array.from(
      { length: PARTICLES_PER_LOGO },
      (_, i) => createParticle(logo, i < 2) // First 2 particles per logo are red
    )
  );
}

function useParticleSystem() {
  const [particles, setParticles] = useState<Particle[]>(() => initParticles());
  const startTimeRef = useRef(performance.now());
  const frameRef = useRef<number>(0);

  const tick = useCallback(() => {
    const now = performance.now();
    const elapsed = now - startTimeRef.current;

    setParticles((prev) =>
      prev.map((p) => {
        // Handle waiting state
        if (p.state === "waiting") {
          if (elapsed % CYCLE_DURATION > p.delay) {
            return { ...p, state: "active", age: 0 };
          }
          return p;
        }

        // Handle dead state - reset after cycle
        if (p.state === "dead") {
          if (p.age > 60) {
            // Small delay before respawn
            const angleToCenter = Math.atan2(
              CENTER - p.startY,
              CENTER - p.startX
            );
            const spread = (Math.random() - 0.5) * 0.17; // ~±5 degrees
            const angle = angleToCenter + spread;
            return {
              ...p,
              x: p.startX,
              y: p.startY,
              vx: Math.cos(angle) * PARTICLE_SPEED,
              vy: Math.sin(angle) * PARTICLE_SPEED,
              opacity: 1,
              scale: 1,
              age: 0,
              state: "active",
            };
          }
          return { ...p, age: p.age + 1 };
        }

        // Physics update for active particles
        let { x, y, vx, vy, opacity, scale, age } = p;
        const newX = x + vx;
        const newY = y + vy;
        const inBox =
          newX >= BOX.left &&
          newX <= BOX.right &&
          newY >= BOX.top &&
          newY <= BOX.bottom;

        if (p.isRed) {
          // Red: moves toward center at constant speed, bounces off box edge
          // Check if about to enter the box (bounce off edge)
          const wasOutside =
            x < BOX.left || x > BOX.right || y < BOX.top || y > BOX.bottom;

          if (wasOutside && inBox && opacity === 1) {
            // Bouncing! Determine which edge based on entry direction
            const fromLeft = x < BOX.left;
            const fromRight = x > BOX.right;
            const fromTop = y < BOX.top;
            const fromBottom = y > BOX.bottom;

            if (fromLeft) {
              x = BOX.left - 3;
              vx = -Math.abs(vx) * (0.9 + Math.random() * 0.3);
              vy += (Math.random() - 0.5) * 1.5;
            } else if (fromRight) {
              x = BOX.right + 3;
              vx = Math.abs(vx) * (0.9 + Math.random() * 0.3);
              vy += (Math.random() - 0.5) * 1.5;
            } else if (fromTop) {
              y = BOX.top - 3;
              vy = -Math.abs(vy) * (0.9 + Math.random() * 0.3);
              vx += (Math.random() - 0.5) * 1.5;
            } else if (fromBottom) {
              y = BOX.bottom + 3;
              vy = Math.abs(vy) * (0.9 + Math.random() * 0.3);
              vx += (Math.random() - 0.5) * 1.5;
            }
            opacity = 0.99; // Mark as bounced
          } else if (opacity === 1) {
            x = newX;
            y = newY;
          } else {
            // After bounce, keep moving outward
            x = newX;
            y = newY;
          }

          // Fade out after bounce (slower to last longer)
          if (opacity < 1) {
            opacity = Math.max(0, opacity - 0.015);
            scale = Math.max(0, scale - 0.01);
          }
        } else {
          // Blue: move straight toward center, absorbed into box
          x = newX;
          y = newY;

          if (inBox) {
            // Inside box: viscous drag and pull toward center
            vx *= 0.92;
            vy *= 0.92;
            vx += (CENTER - x) * 0.02;
            vy += (CENTER - y) * 0.02;
            scale *= 0.94;
            opacity *= 0.96;
          }

          const dist = Math.hypot(x - CENTER, y - CENTER);
          if (dist < 15 || scale < 0.05) {
            opacity = 0;
          }
        }

        age++;
        const isDead = age > MAX_AGE || opacity <= 0;

        return {
          ...p,
          x,
          y,
          vx,
          vy,
          opacity,
          scale,
          age,
          state: isDead ? "dead" : "active",
        };
      })
    );

    frameRef.current = requestAnimationFrame(tick);
  }, []);

  useEffect(() => {
    frameRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frameRef.current);
  }, [tick]);

  return particles.filter((p) => p.state === "active" && p.opacity > 0);
}

// ─────────────────────────────────────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────────────────────────────────────

export default function HeroAnimation() {
  const particles = useParticleSystem();

  return (
    <div className="relative w-full aspect-square">
      <svg viewBox="-50 -50 500 500" className="w-full h-full">
        <defs>
          <linearGradient id="ringGradient" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#3b82f6" stopOpacity="0.3" />
            <stop offset="50%" stopColor="#8b5cf6" stopOpacity="0.5" />
            <stop offset="100%" stopColor="#06b6d4" stopOpacity="0.3" />
          </linearGradient>
          <linearGradient
            id="centerGradient"
            x1="0%"
            y1="0%"
            x2="100%"
            y2="100%"
          >
            {COLORS.blues.map((c, i) => (
              <stop key={i} offset={`${i * 25}%`} stopColor={c} />
            ))}
          </linearGradient>
          <linearGradient id="lineGradient" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="#8b5cf6" stopOpacity="0" />
            <stop offset="50%" stopColor="#8b5cf6" stopOpacity="0.6" />
            <stop offset="100%" stopColor="#8b5cf6" stopOpacity="0" />
          </linearGradient>
          <filter id="glow" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="4" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
          <filter
            id="particleGlow"
            x="-200%"
            y="-200%"
            width="500%"
            height="500%"
          >
            <feGaussianBlur stdDeviation="2" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        {/* Rotating dashed ring */}
        <motion.circle
          cx={CENTER}
          cy={CENTER}
          r={RING_RADIUS}
          fill="none"
          stroke="url(#ringGradient)"
          strokeWidth="1"
          strokeDasharray="15 8"
          animate={{ rotate: 360 }}
          transition={{ duration: 90, repeat: Infinity, ease: "linear" }}
          style={{ transformOrigin: `${CENTER}px ${CENTER}px` }}
        />

        {/* Connection lines */}
        {[0, 72, 144, 216, 288].map((angle) => (
          <motion.line
            key={angle}
            x1={CENTER}
            y1={CENTER}
            x2={CENTER}
            y2={CENTER - RING_RADIUS}
            stroke="url(#lineGradient)"
            strokeWidth="1"
            transform={`rotate(${angle} ${CENTER} ${CENTER})`}
            animate={{ opacity: [0, 0.4, 0] }}
            transition={{ duration: 3, repeat: Infinity, delay: angle / 120 }}
          />
        ))}

        {/* Particles */}
        {particles.map((p, i) => (
          <circle
            key={i}
            cx={p.x}
            cy={p.y}
            r={4}
            fill={p.color}
            opacity={p.opacity}
            transform={`scale(${p.scale})`}
            style={{ transformOrigin: `${p.x}px ${p.y}px` }}
            filter="url(#particleGlow)"
          />
        ))}

        {/* Platform logos */}
        {LOGOS.map((logo) => (
          <g key={logo.id}>
            <motion.circle
              cx={logo.cx}
              cy={logo.cy}
              r="22"
              strokeWidth="2"
              filter="url(#glow)"
              animate={{
                fill: [
                  `${COLORS.logoBlue}20`,
                  `${COLORS.logoBlue}20`,
                  `${COLORS.logoBlue}20`,
                  `${COLORS.red}20`,
                  `${COLORS.logoBlue}20`,
                ],
                stroke: [
                  `${COLORS.logoBlue}50`,
                  `${COLORS.logoBlue}50`,
                  `${COLORS.logoBlue}50`,
                  `${COLORS.red}50`,
                  `${COLORS.logoBlue}50`,
                ],
              }}
              transition={{
                duration: 5,
                repeat: Infinity,
                delay: logo.flashDelay,
                times: [0, 0.7, 0.8, 0.85, 1],
              }}
            />
            <motion.g
              animate={{ rotate: 360 * logo.spinDirection }}
              transition={{
                duration: logo.spinDuration,
                repeat: Infinity,
                ease: "linear",
              }}
              style={{ transformOrigin: `${logo.cx}px ${logo.cy}px` }}
            >
              <g
                transform={`translate(${logo.cx - 10}, ${logo.cy - 10}) scale(${
                  20 / 24
                })`}
              >
                <motion.path
                  d={logo.path}
                  animate={{
                    fill: [
                      COLORS.logoBlue,
                      COLORS.logoBlue,
                      COLORS.logoBlue,
                      COLORS.red,
                      COLORS.logoBlue,
                    ],
                  }}
                  transition={{
                    duration: 5,
                    repeat: Infinity,
                    delay: logo.flashDelay,
                    times: [0, 0.7, 0.8, 0.85, 1],
                  }}
                />
              </g>
            </motion.g>
          </g>
        ))}

        {/* Center glow */}
        <motion.circle
          cx={CENTER}
          cy={CENTER}
          r="55"
          fill="url(#centerGradient)"
          opacity="0.08"
          filter="url(#glow)"
          animate={{ r: [55, 62, 55], opacity: [0.08, 0.15, 0.08] }}
          transition={{ duration: 2, repeat: Infinity, ease: "easeInOut" }}
        />

        {/* Center box */}
        <rect
          x="155"
          y="155"
          width="90"
          height="90"
          rx="16"
          fill="rgba(0,0,0,0.4)"
        />
        <rect
          x="155"
          y="155"
          width="90"
          height="90"
          rx="16"
          fill="none"
          stroke="url(#centerGradient)"
          strokeWidth="3"
          filter="url(#glow)"
        />
        <text
          x={CENTER}
          y="215"
          textAnchor="middle"
          fill="white"
          fontSize="48"
          fontWeight="bold"
          fontFamily="system-ui"
        >
          F
        </text>

        {/* Pulse rings */}
        {[1, 2, 3].map((i) => (
          <motion.rect
            key={i}
            x="155"
            y="155"
            width="90"
            height="90"
            rx="16"
            fill="none"
            stroke="#8b5cf6"
            strokeWidth="2"
            animate={{ scale: [1, 1.8 + i * 0.3], opacity: [0.6, 0] }}
            transition={{
              duration: 2.5,
              repeat: Infinity,
              delay: i * 0.5,
              ease: "easeOut",
            }}
            style={{ transformOrigin: `${CENTER}px ${CENTER}px` }}
          />
        ))}
      </svg>
    </div>
  );
}
