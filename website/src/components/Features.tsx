"use client";

import { motion } from "framer-motion";

// Custom SVG icons with gradient styling
const PrivacyIcon = () => (
  <svg viewBox="0 0 48 48" className="w-12 h-12">
    <defs>
      <linearGradient id="privacyGrad" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stopColor="#3b82f6" />
        <stop offset="100%" stopColor="#8b5cf6" />
      </linearGradient>
    </defs>
    {/* Shield base */}
    <path
      d="M24 6 L16 10 L16 24 C16 32 20 38 24 42 C28 38 32 32 32 24 L32 10 Z"
      fill="none"
      stroke="url(#privacyGrad)"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
    {/* Shield interior fill */}
    <path
      d="M24 8 L18 11 L18 24 C18 30 21 34 24 37 C27 34 30 30 30 24 L30 11 Z"
      fill="url(#privacyGrad)"
      opacity="0.1"
    />
    {/* Lock mechanism */}
    <rect x="21" y="18" width="6" height="4" rx="1" fill="none" stroke="url(#privacyGrad)" strokeWidth="1.5" />
    <path
      d="M22.5 18 L22.5 16 C22.5 14.9 23.4 14 24.5 14 C25.6 14 26.5 14.9 26.5 16 L26.5 18"
      fill="none"
      stroke="url(#privacyGrad)"
      strokeWidth="1.5"
      strokeLinecap="round"
    />
    {/* Protection symbol */}
    <circle cx="24" cy="21" r="1" fill="url(#privacyGrad)" />
  </svg>
);

const UnifiedFeedIcon = () => (
  <svg viewBox="0 0 48 48" className="w-12 h-12">
    <defs>
      <linearGradient id="feedGrad" x1="0%" y1="100%" x2="100%" y2="0%">
        <stop offset="0%" stopColor="#3b82f6" />
        <stop offset="60%" stopColor="#6366f1" />
        <stop offset="100%" stopColor="#a855f7" />
      </linearGradient>
    </defs>
    {/* Flowing wave hand - wave emoji inspired */}
    <path
      d="M8 32 Q8 28 12 28 Q16 28 16 32 Q16 36 12 36 Q8 36 8 32"
      fill="none"
      stroke="url(#feedGrad)"
      strokeWidth="3"
      strokeLinecap="round"
    />
    <path
      d="M16 32 Q16 28 20 28 Q24 28 24 32 Q24 36 20 36 Q16 36 16 32"
      fill="none"
      stroke="url(#feedGrad)"
      strokeWidth="3"
      strokeLinecap="round"
    />
    <path
      d="M24 32 Q24 28 28 28 Q32 28 32 32 Q32 36 28 36 Q24 36 24 32"
      fill="none"
      stroke="url(#feedGrad)"
      strokeWidth="3"
      strokeLinecap="round"
    />
    <path
      d="M32 32 Q32 28 36 28 Q40 28 40 32 Q40 36 36 36 Q32 36 32 32"
      fill="none"
      stroke="url(#feedGrad)"
      strokeWidth="3"
      strokeLinecap="round"
    />
    {/* Wave motion lines */}
    <path
      d="M6 32 Q10 26 14 32 Q18 38 22 32"
      fill="none"
      stroke="url(#feedGrad)"
      strokeWidth="1.5"
      strokeLinecap="round"
      opacity="0.6"
    />
    <path
      d="M22 32 Q26 26 30 32 Q34 38 38 32"
      fill="none"
      stroke="url(#feedGrad)"
      strokeWidth="1.5"
      strokeLinecap="round"
      opacity="0.6"
    />
    <path
      d="M38 32 Q42 26 46 32"
      fill="none"
      stroke="url(#feedGrad)"
      strokeWidth="1.5"
      strokeLinecap="round"
      opacity="0.6"
    />
  </svg>
);

const FriendMapIcon = () => (
  <svg viewBox="0 0 48 48" className="w-12 h-12">
    <defs>
      <linearGradient id="mapGrad" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stopColor="#3b82f6" />
        <stop offset="100%" stopColor="#8b5cf6" />
      </linearGradient>
    </defs>
    <path
      d="M24 4C16.27 4 10 10.27 10 18c0 10.5 14 26 14 26s14-15.5 14-26c0-7.73-6.27-14-14-14z"
      fill="none"
      stroke="url(#mapGrad)"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
    <circle cx="24" cy="18" r="5" fill="url(#mapGrad)" />
    <circle cx="12" cy="36" r="2" fill="#6366f1" opacity="0.6" />
    <circle cx="36" cy="32" r="2" fill="#a855f7" opacity="0.6" />
    <circle cx="40" cy="40" r="1.5" fill="#8b5cf6" opacity="0.4" />
  </svg>
);

const UlyssesIcon = () => (
  <svg viewBox="0 0 48 48" className="w-12 h-12">
    <defs>
      <linearGradient id="ulyssesGrad" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stopColor="#6366f1" />
        <stop offset="100%" stopColor="#a855f7" />
      </linearGradient>
    </defs>
    {/* Beautiful woman's face */}
    {/* Hair outline */}
    <path
      d="M16 14 Q12 12 10 16 Q8 20 12 22 Q16 24 20 22"
      fill="none"
      stroke="url(#ulyssesGrad)"
      strokeWidth="2"
      strokeLinecap="round"
    />
    <path
      d="M32 14 Q36 12 38 16 Q40 20 36 22 Q32 24 28 22"
      fill="none"
      stroke="url(#ulyssesGrad)"
      strokeWidth="2"
      strokeLinecap="round"
    />
    {/* Face silhouette */}
    <ellipse cx="24" cy="18" rx="8" ry="10" fill="url(#ulyssesGrad)" opacity="0.1" />
    <path
      d="M16 18 Q16 26 24 26 Q32 26 32 18"
      fill="none"
      stroke="url(#ulyssesGrad)"
      strokeWidth="2"
      strokeLinecap="round"
    />
    {/* Eyes */}
    <circle cx="20" cy="16" r="1.5" fill="url(#ulyssesGrad)" />
    <circle cx="28" cy="16" r="1.5" fill="url(#ulyssesGrad)" />
    {/* Nose */}
    <path
      d="M24 16 L24 20"
      stroke="url(#ulyssesGrad)"
      strokeWidth="1"
      strokeLinecap="round"
    />
    {/* Mouth - singing */}
    <path
      d="M22 22 Q24 24 26 22"
      fill="none"
      stroke="url(#ulyssesGrad)"
      strokeWidth="2"
      strokeLinecap="round"
    />
    {/* Musical notes */}
    <path
      d="M34 12 Q34 10 36 10 Q36 12 34 12"
      fill="url(#ulyssesGrad)"
      stroke="url(#ulyssesGrad)"
      strokeWidth="0.5"
    />
    <path
      d="M36 8 L36 12"
      stroke="url(#ulyssesGrad)"
      strokeWidth="1"
      strokeLinecap="round"
    />
    <circle cx="38" cy="6" r="1" fill="url(#ulyssesGrad)" />
    <circle cx="42" cy="8" r="1" fill="url(#ulyssesGrad)" />
    {/* Note stems */}
    <path
      d="M38 6 L38 10"
      stroke="url(#ulyssesGrad)"
      strokeWidth="1"
      strokeLinecap="round"
    />
    <path
      d="M42 8 L42 12"
      stroke="url(#ulyssesGrad)"
      strokeWidth="1"
      strokeLinecap="round"
    />
  </svg>
);

const SyncIcon = () => (
  <svg viewBox="0 0 48 48" className="w-12 h-12">
    <defs>
      <linearGradient id="syncGrad" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stopColor="#3b82f6" />
        <stop offset="100%" stopColor="#8b5cf6" />
      </linearGradient>
    </defs>
    {/* Modern devices sync */}
    {/* Phone */}
    <rect
      x="6"
      y="12"
      width="12"
      height="24"
      rx="2"
      fill="none"
      stroke="url(#syncGrad)"
      strokeWidth="2"
    />
    <circle cx="12" cy="30" r="1" fill="url(#syncGrad)" />
    {/* Tablet */}
    <rect
      x="30"
      y="8"
      width="12"
      height="20"
      rx="2"
      fill="none"
      stroke="url(#syncGrad)"
      strokeWidth="2"
    />
    <circle cx="36" cy="22" r="1" fill="url(#syncGrad)" />
    {/* Sync waves/arrows */}
    <path
      d="M18 16 Q22 12 26 16 Q22 20 18 16"
      fill="none"
      stroke="url(#syncGrad)"
      strokeWidth="2"
      strokeLinecap="round"
    />
    <path
      d="M18 20 Q22 24 26 20 Q22 16 18 20"
      fill="none"
      stroke="url(#syncGrad)"
      strokeWidth="2"
      strokeLinecap="round"
    />
    <path
      d="M18 24 Q22 28 26 24 Q22 20 18 24"
      fill="none"
      stroke="url(#syncGrad)"
      strokeWidth="2"
      strokeLinecap="round"
    />
    {/* Connection dots */}
    <circle cx="18" cy="16" r="1.5" fill="url(#syncGrad)" opacity="0.7" />
    <circle cx="26" cy="16" r="1.5" fill="url(#syncGrad)" opacity="0.7" />
    <circle cx="18" cy="24" r="1.5" fill="url(#syncGrad)" opacity="0.7" />
    <circle cx="26" cy="24" r="1.5" fill="url(#syncGrad)" opacity="0.7" />
  </svg>
);

const OpenSourceIcon = () => (
  <svg viewBox="0 0 48 48" className="w-12 h-12">
    <defs>
      <linearGradient id="ossGrad" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stopColor="#8b5cf6" />
        <stop offset="100%" stopColor="#a855f7" />
      </linearGradient>
    </defs>
    <path
      d="M24 8C14.06 8 6 16.06 6 26c0 7.18 4.69 13.27 11.18 15.38.82.15 1.12-.36 1.12-.79v-2.77c-4.55.99-5.51-2.19-5.51-2.19-.74-1.89-1.81-2.39-1.81-2.39-1.48-1.01.11-.99.11-.99 1.64.12 2.5 1.68 2.5 1.68 1.46 2.5 3.82 1.78 4.75 1.36.15-1.06.57-1.78 1.04-2.19-3.63-.41-7.45-1.82-7.45-8.08 0-1.78.64-3.24 1.68-4.38-.17-.41-.73-2.07.16-4.32 0 0 1.37-.44 4.48 1.67 1.3-.36 2.69-.54 4.08-.55 1.38.01 2.78.19 4.08.55 3.11-2.11 4.47-1.67 4.47-1.67.89 2.25.33 3.91.16 4.32 1.05 1.14 1.68 2.6 1.68 4.38 0 6.28-3.82 7.66-7.46 8.07.59.51 1.11 1.5 1.11 3.03v4.49c0 .44.29.95 1.13.79C37.31 39.27 42 33.18 42 26c0-9.94-8.06-18-18-18z"
      fill="url(#ossGrad)"
    />
  </svg>
);

const features = [
  {
    icon: <PrivacyIcon />,
    title: "Local-First Privacy",
    description:
      "All your data stays on your device. No servers, no tracking, no telemetry. Your feed, your control.",
  },
  {
    icon: <UnifiedFeedIcon />,
    title: "Unified Feed",
    description:
      "One feed to rule them all. X, Facebook, Instagram—combined and weighted by what matters to you.",
  },
  {
    icon: <FriendMapIcon />,
    title: "Friend Map",
    description:
      "See where your friends are in real life. Location extraction from posts and stories builds a live map.",
  },
  {
    icon: <UlyssesIcon />,
    title: "Ulysses Mode",
    description:
      "Bind yourself to your values. Block algorithmic feeds and only engage through Freed.",
  },
  {
    icon: <SyncIcon />,
    title: "Cross-Device Sync",
    description:
      "CRDT-powered sync across all your devices. No cloud required—peer-to-peer when you want it.",
  },
  {
    icon: <OpenSourceIcon />,
    title: "Open Source",
    description:
      "MIT licensed. Fork it, audit it, improve it. Built by humans who are Open to Source.",
  },
];

export default function Features() {
  return (
    <section
      id="features"
      className="py-16 sm:py-24 px-4 sm:px-6 md:px-12 lg:px-8"
    >
      <div className="max-w-6xl mx-auto">
        {/* Feature Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {features.map((feature, index) => (
            <motion.div
              key={feature.title}
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.5, delay: index * 0.1 }}
            >
              <div className="glass-card p-6 h-full transition-all duration-300 hover:glow-sm">
                <div className="mb-4">{feature.icon}</div>
                <h3 className="text-xl font-semibold text-text-primary mb-2">
                  {feature.title}
                </h3>
                <p className="text-text-secondary">{feature.description}</p>
              </div>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}
