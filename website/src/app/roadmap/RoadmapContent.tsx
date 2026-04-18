"use client";

import { motion } from "framer-motion";
import { useNewsletter } from "@/context/NewsletterContext";
import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import {
  slowHeroMotion,
  slowHeroDelay,
  slowHeroInterval,
  slowHeroSpeed,
} from "@/lib/motion";
import { MarketingPageShell } from "@/components/MarketingPageShell";

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
    scale: 0.86,
    offsetX: 5.7,
    offsetY: 5.7,
    path: "M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z",
  },
  {
    id: "rss",
    label: "RSS",
    scale: 0.72,
    offsetX: 7.35,
    offsetY: 7.35,
    path: "M6.503 20.752c0 1.794-1.456 3.248-3.251 3.248-1.796 0-3.252-1.454-3.252-3.248 0-1.794 1.456-3.248 3.252-3.248 1.795.001 3.251 1.454 3.251 3.248zm-6.503-12.572v4.811c6.05.062 10.96 4.966 11.022 11.009h4.817c-.062-8.71-7.118-15.758-15.839-15.82zm0-3.368c10.58.046 19.152 8.594 19.183 19.188h4.817c-.03-13.231-10.755-23.954-24-24v4.812z",
  },
  {
    id: "save",
    label: "Save",
    scale: 0.86,
    offsetX: 5.7,
    offsetY: 5.7,
    path: "M17 3H7c-1.1 0-2 .9-2 2v16l7-3 7 3V5c0-1.1-.9-2-2-2z",
  },
  {
    id: "social",
    label: "Social",
    scale: 0.86,
    offsetX: 5.7,
    offsetY: 5.7,
    path: "M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zm0-2.163c-3.259 0-3.667.014-4.947.072-4.358.2-6.78 2.618-6.98 6.98-.059 1.281-.073 1.689-.073 4.948 0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98 1.281.058 1.689.072 4.948.072 3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98-1.281-.059-1.69-.073-4.949-.073zm0 5.838c-3.403 0-6.162 2.759-6.162 6.162s2.759 6.163 6.162 6.163 6.162-2.759 6.162-6.163c0-3.403-2.759-6.162-6.162-6.162zm0 10.162c-2.209 0-4-1.79-4-4 0-2.209 1.791-4 4-4s4 1.791 4 4c0 2.21-1.791 4-4 4zm6.406-11.845c-.796 0-1.441.645-1.441 1.44s.645 1.44 1.441 1.44c.795 0 1.439-.645 1.439-1.44s-.644-1.44-1.439-1.44z",
  },
];

const CLIENT_ICONS = [
  {
    id: "mobile",
    label: "Mobile",
    kind: "phone" as const,
  },
  {
    id: "pwa",
    label: "PWA",
    kind: "browser" as const,
  },
  {
    id: "desktop-viewer",
    label: "Desktop Viewer",
    kind: "viewer" as const,
  },
];

function FreedDesktopIcon() {
  return (
    <g aria-hidden="true">
      <rect
        x="22"
        y="23"
        width="56"
        height="38"
        rx="8"
        fill="none"
        stroke="var(--theme-text-primary)"
        strokeWidth="2"
      />
      <text
        x="50"
        y="52"
        fill="var(--theme-text-primary)"
        fontSize="27"
        fontWeight="700"
        textAnchor="middle"
      >
        F
      </text>
      <rect
        x="44"
        y="62"
        width="12"
        height="4"
        rx="2"
        fill="var(--theme-text-primary)"
      />
      <rect
        x="38"
        y="66.5"
        width="24"
        height="3"
        rx="1.5"
        fill="var(--theme-text-primary)"
      />
    </g>
  );
}

function ClientIcon({
  kind,
}: {
  kind: "phone" | "browser" | "viewer";
}) {
  const color = "var(--theme-text-secondary)";

  if (kind === "phone") {
    const phoneColor = "var(--theme-text-primary)";
    return (
      <g aria-hidden="true">
        <rect
          x="15.5"
          y="5.5"
          width="19"
          height="29"
          rx="4"
          fill="none"
          stroke={phoneColor}
          strokeWidth="2"
        />
        <path
          d="M22 10.5h6"
          fill="none"
          stroke={phoneColor}
          strokeWidth="1.5"
          strokeLinecap="round"
        />
        <rect
          x="19"
          y="13.5"
          width="12"
          height="13"
          rx="2.2"
          fill="none"
          stroke={phoneColor}
          strokeWidth="1.6"
        />
        <circle cx="25" cy="29.8" r="1.1" fill={phoneColor} />
      </g>
    );
  }

  if (kind === "browser") {
    return (
      <g aria-hidden="true">
        <rect
          x="7"
          y="8"
          width="36"
          height="24"
          rx="5"
          fill="none"
          stroke={color}
          strokeWidth="2"
        />
        <path
          d="M9.5 14h31"
          fill="none"
          stroke={color}
          strokeWidth="1.8"
          strokeLinecap="round"
        />
        <circle cx="13" cy="11.2" r="1.1" fill={color} />
        <circle cx="17" cy="11.2" r="1.1" fill={color} />
        <circle cx="21" cy="11.2" r="1.1" fill={color} />
        <circle
          cx="25"
          cy="23"
          r="6.5"
          fill="none"
          stroke={color}
          strokeWidth="1.6"
        />
        <path
          d="M18.5 23h13M25 16.7c2.4 2.8 2.4 12.5 0 12.5M25 16.7c-2.4 2.8-2.4 12.5 0 12.5"
          fill="none"
          stroke={color}
          strokeWidth="1.4"
          strokeLinecap="round"
        />
      </g>
    );
  }

  return (
    <g aria-hidden="true">
      <rect
        x="8"
        y="8"
        width="34"
        height="22"
        rx="4"
        fill="none"
        stroke={color}
        strokeWidth="2"
      />
      <rect x="22" y="30" width="6" height="3" rx="1.5" fill={color} />
      <rect x="18" y="33" width="14" height="2.5" rx="1.25" fill={color} />
      <path
        d="M25 12a6.8 6.8 0 1 1-3.7 12.6l-2.8 1.6.9-3.1A6.8 6.8 0 0 1 25 12z"
        fill="none"
        stroke={color}
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
      <circle cx="23.2" cy="16.6" r="0.95" fill={color} />
      <circle cx="28.2" cy="16.6" r="0.95" fill={color} />
      <path
        d="M22.8 19.5c1.4 1.3 4.8 1.3 6.2 0"
        fill="none"
        stroke={color}
        strokeWidth="1.3"
        strokeLinecap="round"
      />
    </g>
  );
}

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
  const [capturePulseKeys, setCapturePulseKeys] = useState<number[]>(() =>
    CAPTURE_ICONS.map(() => 0),
  );
  const [clientPulseKeys, setClientPulseKeys] = useState<number[]>(() =>
    CLIENT_ICONS.map(() => 0),
  );
  const nextId = useRef(0);
  const frameRef = useRef<number>(0);
  const layoutRef = useRef(layout);
  layoutRef.current = layout;

  const pulseCapture = useCallback((index: number) => {
    setCapturePulseKeys((prev) => {
      const next = [...prev];
      next[index] += 1;
      return next;
    });
  }, []);

  const pulseClient = useCallback((index: number) => {
    setClientPulseKeys((prev) => {
      const next = [...prev];
      next[index] += 1;
      return next;
    });
  }, []);

  const spawnParticle = useCallback(() => {
    const isCapture = Math.random() > 0.3;
    const colors = [
      "var(--theme-accent-primary)",
      "var(--theme-accent-secondary)",
      "var(--theme-accent-tertiary)",
      "color-mix(in srgb, var(--theme-accent-primary) 60%, var(--theme-accent-secondary) 40%)",
      "color-mix(in srgb, var(--theme-accent-secondary) 65%, var(--theme-accent-tertiary) 35%)",
    ];
    const l = layoutRef.current;

    if (isCapture) {
      const sourceIndex = Math.floor(Math.random() * 4);
      pulseCapture(sourceIndex);
      const particle: DataParticle = {
        id: nextId.current++,
        x: 60,
        y: 50 + sourceIndex * 50,
        targetX: l.particles.syncTargetX,
        targetY: 125,
        progress: 0,
        speed: slowHeroSpeed(0.008 + Math.random() * 0.004) * 0.5,
        color: colors[Math.floor(Math.random() * colors.length)],
        size: 3 + Math.random() * 2,
        path: "capture-to-sync",
        sourceIndex,
        targetIndex: 0,
      };
      setParticles((prev) => [...prev, particle]);
    } else {
      const targetIndex = Math.floor(Math.random() * 3);
      pulseClient(targetIndex);
      const particle: DataParticle = {
        id: nextId.current++,
        x: l.particles.clientStartX,
        y: 125,
        targetX: l.particles.clientTargetX,
        targetY: 60 + targetIndex * 65,
        progress: 0,
        speed: slowHeroSpeed(0.008 + Math.random() * 0.004) * 0.5,
        color: colors[Math.floor(Math.random() * colors.length)],
        size: 3 + Math.random() * 2,
        path: "sync-to-client",
        sourceIndex: 0,
        targetIndex,
      };
      setParticles((prev) => [...prev, particle]);
    }
  }, [pulseCapture, pulseClient]);

  const tick = useCallback(() => {
    const completedClientTargets: number[] = [];

    setParticles((prev) =>
      prev
        .map((p) => {
          const progress = p.progress + p.speed;
          return {
            ...p,
            progress,
            x: p.x + (p.targetX - p.x) * p.speed * 3,
            y: p.y + (p.targetY - p.y) * p.speed * 3,
          };
        })
        .filter((p) => {
          const isComplete = p.progress >= 1;
          if (isComplete && p.path === "sync-to-client") {
            completedClientTargets.push(p.targetIndex);
          }
          return !isComplete;
        }),
    );

    if (completedClientTargets.length > 0) {
      completedClientTargets.forEach((targetIndex) => {
        pulseClient(targetIndex);
      });
    }

    frameRef.current = requestAnimationFrame(tick);
  }, [pulseClient]);

  useEffect(() => {
    frameRef.current = requestAnimationFrame(tick);
    const spawnInterval = setInterval(spawnParticle, slowHeroInterval(200));
    return () => {
      cancelAnimationFrame(frameRef.current);
      clearInterval(spawnInterval);
    };
  }, [tick, spawnParticle]);

  return { particles, capturePulseKeys, clientPulseKeys };
}

function ArchitectureDiagram() {
  const isMobile = useIsMobile();
  const layout = isMobile ? LAYOUT.mobile : LAYOUT.desktop;
  const { particles, capturePulseKeys, clientPulseKeys } = useDataFlow(layout);

  // Memoize path calculations
  const { capturePathTarget, clientPathConfig } = useMemo(
    () => ({
      capturePathTarget: layout.capturePath.targetX,
      clientPathConfig: layout.clientPath,
    }),
    [layout],
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
            <stop offset="0%" stopColor="var(--theme-accent-primary)" />
            <stop offset="50%" stopColor="var(--theme-accent-secondary)" />
            <stop offset="100%" stopColor="var(--theme-accent-tertiary)" />
          </linearGradient>
          <linearGradient id="syncGlow" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop
              offset="0%"
              stopColor="var(--theme-accent-secondary)"
              stopOpacity="0.8"
            />
            <stop
              offset="100%"
              stopColor="var(--theme-accent-primary)"
              stopOpacity="0.8"
            />
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
            fill="var(--theme-text-muted)"
            fontSize="10"
            fontWeight="600"
            textAnchor="middle"
          >
            CAPTURE
          </text>
          {CAPTURE_ICONS.map((icon, i) => (
            <g key={icon.id} transform={`translate(30, ${30 + i * 50})`}>
              <rect
                x="0"
                y="0"
                width="32"
                height="32"
                rx="8"
                fill="color-mix(in srgb, var(--theme-bg-surface) 72%, transparent)"
                stroke="color-mix(in srgb, var(--theme-accent-secondary) 36%, transparent)"
                strokeWidth="1"
              />
              {capturePulseKeys[i] > 0 && (
                <motion.rect
                  key={`capture-pulse-${icon.id}-${capturePulseKeys[i]}`}
                  x="0"
                  y="0"
                  width="32"
                  height="32"
                  rx="8"
                  fill="none"
                  stroke="var(--theme-accent-secondary)"
                  strokeWidth="1.5"
                  filter="url(#archGlow)"
                  initial={{ scale: 1, opacity: 0 }}
                  animate={{ scale: [1, 1.06, 1], opacity: [0, 0.85, 0] }}
                  transition={{ duration: slowHeroMotion(0.8), ease: "easeOut" }}
                />
              )}
              <g
                transform={`translate(${icon.offsetX}, ${icon.offsetY}) scale(${icon.scale})`}
              >
                <path d={icon.path} fill="var(--theme-text-secondary)" />
              </g>
            </g>
          ))}
        </g>

        {/* Freed Desktop (Central) */}
        <g transform={`translate(${layout.syncHub.x}, ${layout.syncHub.y})`}>
          <text
            x="50"
            y="-17"
            fill="var(--theme-text-muted)"
            fontSize="10"
            fontWeight="600"
            textAnchor="middle"
          >
            FREED DESKTOP
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
              transition={{
                duration: slowHeroMotion(2),
                repeat: Infinity,
                delay: slowHeroDelay(ring * 0.4),
              }}
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
            fill="color-mix(in srgb, var(--theme-accent-secondary) 10%, transparent)"
            stroke="url(#archGradient)"
            strokeWidth="2"
            filter="url(#archGlow)"
          />

          <FreedDesktopIcon />
        </g>

        {/* Clients */}
        <g>
          <text
            x={layout.clients.labelX}
            y="20"
            fill="var(--theme-text-muted)"
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
              <rect
                x="0"
                y="0"
                width="50"
                height="40"
                rx="8"
                fill="color-mix(in srgb, var(--theme-bg-surface) 72%, transparent)"
                stroke="color-mix(in srgb, var(--theme-accent-secondary) 34%, transparent)"
                strokeWidth="1"
              />
              {clientPulseKeys[i] > 0 && (
                <motion.rect
                  key={`client-pulse-${icon.id}-${clientPulseKeys[i]}`}
                  x="0"
                  y="0"
                  width="50"
                  height="40"
                  rx="8"
                  fill="none"
                  stroke="var(--theme-accent-secondary)"
                  strokeWidth="1.5"
                  filter="url(#archGlow)"
                  initial={{ scale: 1, opacity: 0 }}
                  animate={{ scale: [1, 1.05, 1], opacity: [0, 0.85, 0] }}
                  transition={{ duration: slowHeroMotion(0.8), ease: "easeOut" }}
                />
              )}
              <ClientIcon kind={icon.kind} />
              <text
                x="25"
                y="52"
                fill="var(--theme-text-muted)"
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
          fill="var(--theme-text-muted)"
          fontSize="9"
          textAnchor="middle"
          fontStyle="italic"
          className="hidden sm:inline"
        >
          Desktop is the hub: runs capture, hosts sync, powers everything
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
    description:
      "Marketing site, QR gallery, monorepo, Automerge schema, CI/CD, public legal docs with download clickwrap, and a protected newsletter signup flow.",
    status: "complete",
    planLink:
      "https://github.com/freed-project/freed/blob/dev/docs/PHASE-1-FOUNDATION.md",
  },
  {
    number: 2,
    title: "Capture Skills",
    description:
      "RSS and X capture complete. Freed Markdown import/export, batch library management.",
    status: "complete",
    planLink:
      "https://github.com/freed-project/freed/blob/dev/docs/PHASE-2-CAPTURE-SKILLS.md",
  },
  {
    number: 3,
    title: "Save for Later",
    description:
      "Save any URL from desktop or mobile. Full offline reading with layered content cache. AI summarization and tag navigation.",
    status: "complete",
    planLink:
      "https://github.com/freed-project/freed/blob/dev/docs/PHASE-3-SAVE-FOR-LATER.md",
  },
  {
    number: 4,
    title: "Sync Layer",
    description:
      "Local relay and GDrive/Dropbox sync are working, with cloud health diagnostics, retry and reconnect actions, debug charts, and desktop snapshot restore. iCloud remains the open item.",
    status: "current",
    planLink:
      "https://github.com/freed-project/freed/blob/dev/docs/PHASE-4-SYNC.md",
  },
  {
    number: 5,
    title: "Desktop & Mobile App",
    description:
      "Freed Desktop ships for macOS (ARM + Intel), Windows, and Linux with signed auto-updates, a Freed-owned updater endpoint, local production or dev release-channel switching, first-run legal gating, provider risk interstitials, browser-style back and forward shortcuts, draggable shared top-toolbar chrome, local snapshot rollback for disaster recovery, a provider health dashboard, failing-feed unsubscribe tools, renderer heartbeat diagnostics in the local log, runtime memory telemetry for long-session leak hunting, renderer heap and DOM diagnostics, reduced worker payload churn during large-library updates, duplicate-fetch suppression, fetcher rescans gated to real library growth, incremental Automerge persistence compaction, leaner outbox retry bookkeeping, dead-feed health cleanup, capped preserved-text previews with on-demand reader fetches, reviewed cumulative release headings, paginated changelog history, and public-safe bug reporting.",
    status: "current",
    priority: true,
    planLink:
      "https://github.com/freed-project/freed/blob/dev/docs/PHASE-5-DESKTOP.md",
  },
  {
    number: 6,
    title: "PWA Reader",
    description:
      "Primary mobile surface with first-run legal gating, URL-backed view state, public-safe bug reporting, and switchable production or dev update channels across `app.freed.wtf` and `dev-app.freed.wtf`.",
    status: "complete",
    planLink:
      "https://github.com/freed-project/freed/blob/dev/docs/PHASE-6-PWA.md",
  },
  {
    number: 7,
    title: "Facebook + Instagram",
    description:
      "Facebook and Instagram integrated via Tauri WebView scraping, with suggested-post filtering, hardened story capture, preserved Instagram story location metadata for map recovery, silent background media guarding, serialized background scraper sessions, Facebook group controls, provider health summaries, and smart backoff when sync looks rate-limited.",
    status: "current",
    planLink:
      "https://github.com/freed-project/freed/blob/dev/docs/PHASE-7-SOCIAL-CAPTURE.md",
  },
  {
    number: 8,
    title: "Friends + Social Graph",
    description:
      "A people CRM with a canonical Person plus Account identity graph, a stable pan-and-zoom Friends workspace, Google Contacts imports that create friend people by default, suggestion-only same-person review across platforms, and a map that resolves identity through linked accounts while still showing followed accounts at the edge before confirmation.",
    status: "current",
    planLink:
      "https://github.com/freed-project/freed/blob/dev/docs/PHASE-8-FRIENDS.md",
  },
  {
    number: 9,
    title: "Browser Extension",
    description:
      "Chrome, Firefox, and Safari extensions. Quick saves and Ulysses mode.",
    status: "upcoming",
    planLink:
      "https://github.com/freed-project/freed/blob/dev/docs/PHASE-9-BROWSER-EXTENSION.md",
  },
  {
    number: 10,
    title: "Polish",
    description:
      "Onboarding, statistics, AI features, plugin API, community infrastructure, and deeper crash recovery hardening.",
    status: "upcoming",
    planLink:
      "https://github.com/freed-project/freed/blob/dev/docs/PHASE-10-POLISH.md",
  },
  {
    number: 11,
    title: "OpenClaw + Omi 🦞",
    description:
      'Headless capture for power users via OpenClaw CLI. Plus bidirectional Omi wearable integration: say "Hey Freed" to save a voice note, and your reading activity enriches Omi\'s memory.',
    status: "upcoming",
    planLink:
      "https://github.com/freed-project/freed/blob/dev/docs/PHASE-11-OPENCLAW.md",
  },
  {
    number: 12,
    title: "Additional Platforms",
    description:
      "LinkedIn is in, including matching desktop scraper window controls, silent background media guarding, and the shared provider health and pause-state surfaces. Next up: Mozi for social planning, then TikTok, Threads, Bluesky, Reddit, and YouTube.",
    status: "current",
    planLink:
      "https://github.com/freed-project/freed/blob/dev/docs/PHASE-12-ADDITIONAL-PLATFORMS.md",
  },
  {
    number: 13,
    title: "POSSE Party 🎉 🦝",
    description:
      "Compose and publish through your own site. Complete the sovereignty loop.",
    status: "upcoming",
    planLink:
      "https://github.com/freed-project/freed/blob/dev/docs/PHASE-13-POSSE.md",
  },
];

function PhaseCard({ phase, index }: { phase: Phase; index: number }) {
  const statusStyles = {
    complete: {
      border:
        "phase-card-complete border-[color:var(--theme-status-complete-border)]",
      bg: "phase-card-complete bg-[color:var(--theme-status-complete-bg)]",
      badge:
        "bg-[color:var(--theme-status-complete-bg)] text-[color:var(--theme-status-complete-text)]",
      badgeText: "✓ Complete",
      glow: "",
    },
    current: {
      border:
        "phase-card-current border-[color:color-mix(in_srgb,var(--theme-accent-secondary)_50%,transparent)]",
      bg: "phase-card-current bg-[color:color-mix(in_srgb,var(--theme-accent-secondary)_8%,transparent)]",
      badge:
        "bg-[color:color-mix(in_srgb,var(--theme-accent-secondary)_18%,transparent)] text-[var(--theme-accent-secondary)]",
      badgeText: "● In Progress",
      glow: "glow-sm",
    },
    upcoming: {
      border: "phase-card-upcoming border-freed-border",
      bg: "phase-card-upcoming bg-freed-surface/50",
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
        <div className="absolute -top-3 -right-3 px-3 py-1 rounded-full text-xs font-bold text-[var(--theme-bg-root)] z-10 bg-[linear-gradient(90deg,var(--theme-accent-primary),var(--theme-accent-secondary),var(--theme-accent-tertiary))]">
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
            <span className="text-xs text-text-muted group-hover:text-text-primary transition-colors duration-200 flex items-center gap-1">
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
    <MarketingPageShell maxWidthClassName="max-w-4xl">
        {/* Header */}
        <motion.header
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6 }}
          className="text-center mb-12 sm:mb-16"
        >
          <h1 className="theme-display-large text-3xl sm:text-5xl md:text-6xl font-bold mb-4 sm:mb-6">
            <span className="theme-page-heading-accent">Roadmap</span>
          </h1>
          <p className="text-text-secondary text-base sm:text-lg mb-2">
            Built for humans, not algorithms.
          </p>
          {/*<p className="text-text-secondary text-lg sm:text-xl mb-2">*/}
          {/*  We build in daylight.*/}
          {/*</p>*/}
          <p className="text-text-muted text-sm sm:text-base">
            Every commit, decision, and pivot. Visible.
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
              className="h-full bg-[linear-gradient(90deg,var(--theme-accent-primary),var(--theme-accent-secondary),var(--theme-accent-tertiary))]"
            />
            <motion.div
              initial={{ width: 0 }}
              animate={{ width: `${(activeCount / totalCount) * 100}%` }}
              transition={{ duration: 1, delay: 0.6 }}
              className="h-full bg-[color:var(--theme-status-active-progress)]"
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
    </MarketingPageShell>
  );
}
