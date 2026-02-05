"use client";

import { motion } from "framer-motion";
import { useNewsletter } from "@/context/NewsletterContext";
import { useState, useEffect, useCallback, useRef, useMemo } from "react";

// Responsive layout hook
function useIsMobile() {
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const checkMobile = () => setIsMobile(window.innerWidth < 640);
    checkMobile();
    window.addEventListener("resize", checkMobile);
    return () => window.removeEventListener("resize", checkMobile);
  }, []);

  return isMobile;
}

// Layout configurations for responsive diagram
const LAYOUT = {
  desktop: {
    viewBox: "0 0 600 250",
    syncHub: { x: 250, y: 75 },
    clients: { x: 530, labelX: 555 },
    capturePath: { targetX: 250 },
    clientPath: { startX: 350, controlX: 440, endX: 530 },
    particles: { syncTargetX: 250, clientStartX: 350, clientTargetX: 540 },
  },
  mobile: {
    viewBox: "0 0 400 250",
    syncHub: { x: 140, y: 75 },
    clients: { x: 310, labelX: 335 },
    capturePath: { targetX: 140 },
    clientPath: { startX: 240, controlX: 275, endX: 310 },
    particles: { syncTargetX: 140, clientStartX: 240, clientTargetX: 320 },
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// Architecture Diagram Components
// ─────────────────────────────────────────────────────────────────────────────

const CAPTURE_ICONS = [
  {
    id: "x",
    label: "X",
    path: "M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z",
  },
  {
    id: "rss",
    label: "RSS",
    path: "M6.503 20.752c0 1.794-1.456 3.248-3.251 3.248-1.796 0-3.252-1.454-3.252-3.248 0-1.794 1.456-3.248 3.252-3.248 1.795.001 3.251 1.454 3.251 3.248zm-6.503-12.572v4.811c6.05.062 10.96 4.966 11.022 11.009h4.817c-.062-8.71-7.118-15.758-15.839-15.82zm0-3.368c10.58.046 19.152 8.594 19.183 19.188h4.817c-.03-13.231-10.755-23.954-24-24v4.812z",
  },
  {
    id: "save",
    label: "Save",
    path: "M17 3H7c-1.1 0-2 .9-2 2v16l7-3 7 3V5c0-1.1-.9-2-2-2z",
  },
  {
    id: "social",
    label: "Social",
    path: "M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zm0-2.163c-3.259 0-3.667.014-4.947.072-4.358.2-6.78 2.618-6.98 6.98-.059 1.281-.073 1.689-.073 4.948 0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98 1.281.058 1.689.072 4.948.072 3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98-1.281-.059-1.69-.073-4.949-.073zm0 5.838c-3.403 0-6.162 2.759-6.162 6.162s2.759 6.163 6.162 6.163 6.162-2.759 6.162-6.163c0-3.403-2.759-6.162-6.162-6.162zm0 10.162c-2.209 0-4-1.79-4-4 0-2.209 1.791-4 4-4s4 1.791 4 4c0 2.21-1.791 4-4 4zm6.406-11.845c-.796 0-1.441.645-1.441 1.44s.645 1.44 1.441 1.44c.795 0 1.439-.645 1.439-1.44s-.644-1.44-1.439-1.44z",
  },
];

const CLIENT_ICONS = [
  {
    id: "desktop",
    label: "Desktop",
    path: "M21 2H3c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h7v2H8v2h8v-2h-2v-2h7c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm0 14H3V4h18v12z",
  },
  {
    id: "mobile",
    label: "PWA",
    path: "M17 1.01L7 1c-1.1 0-2 .9-2 2v18c0 1.1.9 2 2 2h10c1.1 0 2-.9 2-2V3c0-1.1-.9-1.99-2-1.99zM17 19H7V5h10v14z",
  },
  {
    id: "extension",
    label: "Extension",
    path: "M20.5 11H19V7c0-1.1-.9-2-2-2h-4V3.5C13 2.12 11.88 1 10.5 1S8 2.12 8 3.5V5H4c-1.1 0-1.99.9-1.99 2v3.8H3.5c1.49 0 2.7 1.21 2.7 2.7s-1.21 2.7-2.7 2.7H2V20c0 1.1.9 2 2 2h3.8v-1.5c0-1.49 1.21-2.7 2.7-2.7 1.49 0 2.7 1.21 2.7 2.7V22H17c1.1 0 2-.9 2-2v-4h1.5c1.38 0 2.5-1.12 2.5-2.5S21.88 11 20.5 11z",
  },
];

interface DataParticle {
  id: number;
  x: number;
  y: number;
  targetX: number;
  targetY: number;
  progress: number;
  speed: number;
  color: string;
  size: number;
  path: "capture-to-sync" | "sync-to-client";
  sourceIndex: number;
  targetIndex: number;
}

function useDataFlow(layout: (typeof LAYOUT)["desktop"]) {
  const [particles, setParticles] = useState<DataParticle[]>([]);
  const nextId = useRef(0);
  const frameRef = useRef<number>(0);
  const layoutRef = useRef(layout);
  layoutRef.current = layout;

  const spawnParticle = useCallback(() => {
    const isCapture = Math.random() > 0.3;
    const colors = ["#3b82f6", "#6366f1", "#8b5cf6", "#a855f7", "#06b6d4"];
    const l = layoutRef.current;

    if (isCapture) {
      const sourceIndex = Math.floor(Math.random() * 4);
      const particle: DataParticle = {
        id: nextId.current++,
        x: 60,
        y: 50 + sourceIndex * 50,
        targetX: l.particles.syncTargetX,
        targetY: 125,
        progress: 0,
        speed: 0.008 + Math.random() * 0.004,
        color: colors[Math.floor(Math.random() * colors.length)],
        size: 3 + Math.random() * 2,
        path: "capture-to-sync",
        sourceIndex,
        targetIndex: 0,
      };
      setParticles((prev) => [...prev, particle]);
    } else {
      const targetIndex = Math.floor(Math.random() * 3);
      const particle: DataParticle = {
        id: nextId.current++,
        x: l.particles.clientStartX,
        y: 125,
        targetX: l.particles.clientTargetX,
        targetY: 60 + targetIndex * 65,
        progress: 0,
        speed: 0.008 + Math.random() * 0.004,
        color: colors[Math.floor(Math.random() * colors.length)],
        size: 3 + Math.random() * 2,
        path: "sync-to-client",
        sourceIndex: 0,
        targetIndex,
      };
      setParticles((prev) => [...prev, particle]);
    }
  }, []);

  const tick = useCallback(() => {
    setParticles((prev) =>
      prev
        .map((p) => ({
          ...p,
          progress: p.progress + p.speed,
          x: p.x + (p.targetX - p.x) * p.speed * 3,
          y: p.y + (p.targetY - p.y) * p.speed * 3,
        }))
        .filter((p) => p.progress < 1)
    );
    frameRef.current = requestAnimationFrame(tick);
  }, []);

  useEffect(() => {
    frameRef.current = requestAnimationFrame(tick);
    const spawnInterval = setInterval(spawnParticle, 200);
    return () => {
      cancelAnimationFrame(frameRef.current);
      clearInterval(spawnInterval);
    };
  }, [tick, spawnParticle]);

  return particles;
}

function ArchitectureDiagram() {
  const isMobile = useIsMobile();
  const layout = isMobile ? LAYOUT.mobile : LAYOUT.desktop;
  const particles = useDataFlow(layout);

  // Memoize path calculations
  const { capturePathTarget, clientPathConfig } = useMemo(
    () => ({
      capturePathTarget: layout.capturePath.targetX,
      clientPathConfig: layout.clientPath,
    }),
    [layout]
  );

  return (
    <div className="relative w-full overflow-hidden rounded-xl">
      <svg
        viewBox={layout.viewBox}
        className="w-full h-auto"
        preserveAspectRatio="xMidYMid meet"
      >
        <defs>
          <linearGradient id="archGradient" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#3b82f6" />
            <stop offset="50%" stopColor="#8b5cf6" />
            <stop offset="100%" stopColor="#06b6d4" />
          </linearGradient>
          <linearGradient id="syncGlow" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#8b5cf6" stopOpacity="0.8" />
            <stop offset="100%" stopColor="#3b82f6" stopOpacity="0.8" />
          </linearGradient>
          <filter id="archGlow" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="3" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
          <filter
            id="particleGlow"
            x="-100%"
            y="-100%"
            width="300%"
            height="300%"
          >
            <feGaussianBlur stdDeviation="2" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        {/* Connection paths */}
        <g opacity="0.3">
          {CAPTURE_ICONS.map((_, i) => {
            const midX = (70 + capturePathTarget) / 2;
            return (
              <path
                key={`capture-path-${i}`}
                d={`M 70 ${50 + i * 50} Q ${midX} ${
                  50 + i * 50
                } ${capturePathTarget} 125`}
                fill="none"
                stroke="url(#archGradient)"
                strokeWidth="1"
                strokeDasharray="4 4"
              />
            );
          })}
          {CLIENT_ICONS.map((_, i) => {
            const endY = 60 + i * 65;
            // PWA (i=1) needs a slight curve since start and end Y are both 125
            const controlY = i === 1 ? 110 : endY;
            return (
              <path
                key={`client-path-${i}`}
                d={`M ${clientPathConfig.startX} 125 Q ${clientPathConfig.controlX} ${controlY} ${clientPathConfig.endX} ${endY}`}
                fill="none"
                stroke="url(#archGradient)"
                strokeWidth="1"
                strokeDasharray="4 4"
              />
            );
          })}
        </g>

        {/* Capture Layer */}
        <g>
          <text
            x="45"
            y="20"
            fill="#71717a"
            fontSize="10"
            fontWeight="600"
            textAnchor="middle"
          >
            CAPTURE
          </text>
          {CAPTURE_ICONS.map((icon, i) => (
            <g key={icon.id} transform={`translate(30, ${30 + i * 50})`}>
              <motion.rect
                x="0"
                y="0"
                width="32"
                height="32"
                rx="8"
                fill="rgba(255,255,255,0.03)"
                stroke="rgba(139,92,246,0.3)"
                strokeWidth="1"
                initial={{ opacity: 0.5 }}
                animate={{ opacity: [0.5, 0.8, 0.5] }}
                transition={{ duration: 2, repeat: Infinity, delay: i * 0.3 }}
              />
              <g transform="translate(4, 4) scale(1)">
                <path d={icon.path} fill="#a1a1aa" transform="scale(1)" />
              </g>
            </g>
          ))}
        </g>

        {/* Sync Hub (Central) */}
        <g transform={`translate(${layout.syncHub.x}, ${layout.syncHub.y})`}>
          <text
            x="50"
            y="-10"
            fill="#71717a"
            fontSize="10"
            fontWeight="600"
            textAnchor="middle"
          >
            SYNC HUB
          </text>

          {/* Pulsing outer rings */}
          {[1, 2, 3].map((ring) => (
            <motion.rect
              key={ring}
              x="0"
              y="0"
              width="100"
              height="100"
              rx="20"
              fill="none"
              stroke="url(#syncGlow)"
              strokeWidth="1"
              initial={{ scale: 1, opacity: 0.6 }}
              animate={{ scale: [1, 1.15 + ring * 0.1], opacity: [0.4, 0] }}
              transition={{ duration: 2, repeat: Infinity, delay: ring * 0.4 }}
              style={{ transformOrigin: "50px 50px" }}
            />
          ))}

          {/* Main box */}
          <rect
            x="10"
            y="10"
            width="80"
            height="80"
            rx="16"
            fill="rgba(139,92,246,0.1)"
            stroke="url(#archGradient)"
            strokeWidth="2"
            filter="url(#archGlow)"
          />

          {/* Automerge CRDT text */}
          <text
            x="50"
            y="42"
            fill="#fafafa"
            fontSize="11"
            fontWeight="700"
            textAnchor="middle"
          >
            Automerge
          </text>
          <text x="50" y="56" fill="#a1a1aa" fontSize="9" textAnchor="middle">
            CRDT
          </text>
          <text x="50" y="72" fill="#6366f1" fontSize="8" textAnchor="middle">
            Local + Cloud
          </text>
        </g>

        {/* Clients */}
        <g>
          <text
            x={layout.clients.labelX}
            y="20"
            fill="#71717a"
            fontSize="10"
            fontWeight="600"
            textAnchor="middle"
          >
            CLIENTS
          </text>
          {CLIENT_ICONS.map((icon, i) => (
            <g
              key={icon.id}
              transform={`translate(${layout.clients.x}, ${40 + i * 65})`}
            >
              <motion.rect
                x="0"
                y="0"
                width="50"
                height="40"
                rx="8"
                fill="rgba(255,255,255,0.03)"
                stroke={
                  i === 0 ? "rgba(139,92,246,0.5)" : "rgba(139,92,246,0.3)"
                }
                strokeWidth={i === 0 ? "2" : "1"}
                initial={{ opacity: 0.5 }}
                animate={{ opacity: [0.5, 0.9, 0.5] }}
                transition={{ duration: 2.5, repeat: Infinity, delay: i * 0.4 }}
                filter={i === 0 ? "url(#archGlow)" : undefined}
              />
              <g transform="translate(13, 8) scale(1)">
                <path
                  d={icon.path}
                  fill={i === 0 ? "#8b5cf6" : "#a1a1aa"}
                  transform="scale(1)"
                />
              </g>
              <text
                x="25"
                y="52"
                fill="#71717a"
                fontSize="8"
                textAnchor="middle"
              >
                {icon.label}
              </text>
            </g>
          ))}
        </g>

        {/* Data particles */}
        {particles.map((p) => (
          <motion.circle
            key={p.id}
            cx={p.x}
            cy={p.y}
            r={p.size}
            fill={p.color}
            opacity={1 - p.progress}
            filter="url(#particleGlow)"
          />
        ))}

        {/* Hub label - hidden on mobile */}
        <text
          x="300"
          y="240"
          fill="#71717a"
          fontSize="9"
          textAnchor="middle"
          fontStyle="italic"
          className="hidden sm:inline"
        >
          Desktop is the hub — runs capture, hosts sync, powers everything
        </text>
      </svg>
    </div>
  );
}

interface Phase {
  number: number;
  title: string;
  description: string;
  status: "complete" | "current" | "upcoming";
  priority?: boolean;
  planLink?: string;
}

const phases: Phase[] = [
  {
    number: 1,
    title: "Foundation",
    description: "Marketing site, monorepo, Automerge schema, CI/CD.",
    status: "current",
    planLink:
      "https://github.com/freed-project/freed/blob/main/docs/PHASE-1-FOUNDATION.md",
  },
  {
    number: 2,
    title: "Capture Skills",
    description:
      "capture-x and capture-rss packages with OpenClaw skill wrappers.",
    status: "complete",
    planLink:
      "https://github.com/freed-project/freed/blob/main/docs/PHASE-2-CAPTURE-SKILLS.md",
  },
  {
    number: 3,
    title: "Save for Later",
    description:
      "URL capture with Readability extraction. Capture any article, thread, or page.",
    status: "complete",
    planLink:
      "https://github.com/freed-project/freed/blob/main/docs/PHASE-3-SAVE-FOR-LATER.md",
  },
  {
    number: 4,
    title: "Sync Layer",
    description:
      "Local WebSocket relay + cloud backup. Automerge CRDT for conflict-free sync.",
    status: "current",
    planLink:
      "https://github.com/freed-project/freed/blob/main/docs/PHASE-4-SYNC.md",
  },
  {
    number: 5,
    title: "Desktop & Mobile App",
    description:
      "Native apps (macOS, Windows, Linux, iOS, Android) bundling capture, sync, and reader UI.",
    status: "current",
    priority: true,
    planLink:
      "https://github.com/freed-project/freed/blob/main/docs/PHASE-5-DESKTOP.md",
  },
  {
    number: 6,
    title: "PWA Reader",
    description:
      "Mobile companion app. Read your feed anywhere, synced to your desktop.",
    status: "current",
    planLink:
      "https://github.com/freed-project/freed/blob/main/docs/PHASE-6-PWA.md",
  },
  {
    number: 7,
    title: "Facebook + Instagram",
    description:
      "DOM scraping via headless browser. Capture the walled gardens.",
    status: "upcoming",
    planLink:
      "https://github.com/freed-project/freed/blob/main/docs/PHASE-7-SOCIAL-CAPTURE.md",
  },
  {
    number: 8,
    title: "Friend Map",
    description:
      "Location-based social view. See where your friends are posting from.",
    status: "upcoming",
    planLink:
      "https://github.com/freed-project/freed/blob/main/docs/PHASE-8-FRIEND-MAP.md",
  },
  {
    number: 9,
    title: "Browser Extension",
    description:
      "Chrome, Firefox, and Safari extensions. Quick saves and Ulysses mode.",
    status: "upcoming",
    planLink:
      "https://github.com/freed-project/freed/blob/main/docs/PHASE-9-BROWSER-EXTENSION.md",
  },
  {
    number: 10,
    title: "Polish",
    description:
      "Onboarding, statistics, AI features, plugin API, and community infrastructure.",
    status: "upcoming",
    planLink:
      "https://github.com/freed-project/freed/blob/main/docs/PHASE-10-POLISH.md",
  },
  {
    number: 11,
    title: "OpenClaw Integration 🦞",
    description: "Headless capture for power users. Run Freed without the GUI.",
    status: "upcoming",
    planLink:
      "https://github.com/freed-project/freed/blob/main/docs/PHASE-11-OPENCLAW.md",
  },
  {
    number: 12,
    title: "Additional Platforms",
    description: "LinkedIn, TikTok, Threads, Bluesky, Reddit, YouTube.",
    status: "upcoming",
    planLink:
      "https://github.com/freed-project/freed/blob/main/docs/PHASE-12-ADDITIONAL-PLATFORMS.md",
  },
  {
    number: 13,
    title: "POSSE Party 🎉 🦝",
    description:
      "Compose and publish through your own site. Complete the sovereignty loop.",
    status: "upcoming",
    planLink:
      "https://github.com/freed-project/freed/blob/main/docs/PHASE-13-POSSE.md",
  },
];

function PhaseCard({ phase, index }: { phase: Phase; index: number }) {
  const statusStyles = {
    complete: {
      border: "border-green-500/30",
      bg: "bg-green-500/5",
      badge: "bg-green-500/20 text-green-400",
      badgeText: "✓ Complete",
      glow: "",
    },
    current: {
      border: "border-glow-purple/50",
      bg: "bg-glow-purple/5",
      badge: "bg-glow-purple/20 text-glow-purple",
      badgeText: "● In Progress",
      glow: "glow-sm",
    },
    upcoming: {
      border: "border-freed-border",
      bg: "bg-freed-surface/50",
      badge: "bg-freed-surface text-text-muted",
      badgeText: "Upcoming",
      glow: "",
    },
  };

  const style = statusStyles[phase.status];

  const cardContent = (
    <>
      {/* Priority badge */}
      {phase.priority && (
        <div className="absolute -top-3 -right-3 px-3 py-1 rounded-full bg-linear-to-r from-glow-blue to-glow-purple text-xs font-bold text-white z-10">
          HIGHEST PRIORITY
        </div>
      )}

      <div className="flex items-start justify-between gap-4">
        <div className="flex-1">
          <div className="flex items-center gap-3 mb-2">
            <span className="text-2xl font-bold text-text-muted">
              {String(phase.number).padStart(2, "0")}
            </span>
            <h3 className="text-xl font-bold text-text-primary">
              {phase.title}
            </h3>
          </div>
          <p className="text-text-secondary">{phase.description}</p>
        </div>

        <div className="flex flex-col items-end gap-2">
          <span
            className={`px-3 py-1 rounded-full text-xs font-medium ${style.badge}`}
          >
            {style.badgeText}
          </span>
          {phase.planLink && (
            <span className="text-xs text-text-muted group-hover:text-white transition-colors duration-200 flex items-center gap-1">
              View Plan →
            </span>
          )}
        </div>
      </div>
    </>
  );

  if (phase.planLink) {
    return (
      <motion.a
        href={phase.planLink}
        target="_blank"
        rel="noopener noreferrer"
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, delay: index * 0.05 }}
        className={`group relative block p-6 rounded-xl border ${style.border} ${style.bg} ${style.glow} transition-all duration-200 hover:scale-[1.02] cursor-pointer`}
      >
        {cardContent}
      </motion.a>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, delay: index * 0.05 }}
      className={`relative p-6 rounded-xl border ${style.border} ${style.bg} ${style.glow}`}
    >
      {cardContent}
    </motion.div>
  );
}

export default function RoadmapContent() {
  const { openModal } = useNewsletter();

  const completedCount = phases.filter((p) => p.status === "complete").length;
  const activeCount = phases.filter((p) => p.status === "current").length;
  const totalCount = phases.length;
  const progressPercent = (completedCount / totalCount) * 100;

  return (
    <section className="py-24 sm:py-32 px-4 sm:px-6 md:px-12 lg:px-8">
      <div className="max-w-4xl mx-auto">
        {/* Header */}
        <motion.header
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6 }}
          className="text-center mb-12 sm:mb-16"
        >
          <h1 className="text-3xl sm:text-5xl md:text-6xl font-bold mb-4 sm:mb-6">
            <span className="gradient-text">Roadmap</span>
          </h1>
          <p className="text-text-secondary text-base sm:text-lg mb-2">
            Built for humans, not algorithms.
          </p>
          {/*<p className="text-text-secondary text-lg sm:text-xl mb-2">*/}
          {/*  We build in daylight.*/}
          {/*</p>*/}
          <p className="text-text-muted text-sm sm:text-base">
            Every commit, every decision, every pivot — visible.
          </p>
        </motion.header>

        {/* Architecture Overview */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.2 }}
          className="glass-card p-6 sm:p-8 mb-16 rounded-xl"
        >
          <h2 className="text-xl font-bold text-text-primary mb-6">
            Architecture
          </h2>
          <ArchitectureDiagram />
        </motion.div>

        {/* Progress bar */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.3 }}
          className="mb-8"
        >
          <h2 className="text-xl font-bold text-text-primary mb-4">Phases</h2>
          <div className="flex justify-center gap-6 text-sm text-text-muted mb-2">
            <span>{completedCount} complete</span>
            <span>{activeCount} active</span>
          </div>
          <div className="h-2 bg-freed-surface rounded-full overflow-hidden flex">
            <motion.div
              initial={{ width: 0 }}
              animate={{ width: `${progressPercent}%` }}
              transition={{ duration: 1, delay: 0.4 }}
              className="h-full bg-linear-to-r from-glow-blue via-glow-purple to-glow-cyan"
            />
            <motion.div
              initial={{ width: 0 }}
              animate={{ width: `${(activeCount / totalCount) * 100}%` }}
              transition={{ duration: 1, delay: 0.6 }}
              className="h-full bg-zinc-600"
            />
          </div>
        </motion.div>

        {/* Phases */}
        <div className="space-y-6">
          {phases.map((phase, index) => (
            <PhaseCard key={phase.number} phase={phase} index={index} />
          ))}
        </div>

        {/* CTA */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.6 }}
          className="mt-16 text-center"
        >
          <p className="text-text-secondary mb-6">
            Want to help build the future of social media?
          </p>
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <a
              href="https://github.com/freed-project/freed"
              target="_blank"
              rel="noopener noreferrer"
              className="btn-secondary"
            >
              GitHub
            </a>
            <motion.button
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
              onClick={openModal}
              className="btn-primary"
            >
              Get Updates
            </motion.button>
          </div>
        </motion.div>
      </div>
    </section>
  );
}
