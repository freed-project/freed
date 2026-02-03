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
    {/* Shield */}
    <path
      d="M24 4L8 10V22C8 33 15 42 24 44C33 42 40 33 40 22V10L24 4Z"
      fill="none"
      stroke="url(#privacyGrad)"
      strokeWidth="3"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
    {/* Inner Shield Structure - Strong & Secure */}
    <path
      d="M24 11V37"
      stroke="url(#privacyGrad)"
      strokeWidth="2"
      strokeLinecap="round"
      opacity="0.4"
    />
    <path
      d="M15 20H33"
      stroke="url(#privacyGrad)"
      strokeWidth="2"
      strokeLinecap="round"
      opacity="0.4"
    />
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
    {/* Stylized Wave - Emoji Style */}
    <path
      d="M6 42C6 42 12 38 18 32C24 26 26 14 36 10C44 7 48 14 46 22C44 28 38 30 32 26C26 22 28 14 36 12"
      fill="none"
      stroke="url(#feedGrad)"
      strokeWidth="3"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
    {/* Water Droplets */}
    <circle cx="44" cy="8" r="2.5" fill="url(#feedGrad)" />
    <circle cx="40" cy="5" r="1.5" fill="url(#feedGrad)" opacity="0.7" />
    <circle cx="10" cy="40" r="1.5" fill="url(#feedGrad)" opacity="0.6" />
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
    {/* Woman's Face Profile Singing */}
    <path
      d="M22 10C18 10 16 14 16 18C16 21 17 22 18 23L18 24C18 24 16 25 16 26C16 28 18 30 18 30C18 30 18 32 18 34C18 38 22 40 26 40"
      fill="none"
      stroke="url(#ulyssesGrad)"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
    {/* Flowing Hair */}
    <path
      d="M22 10C28 8 34 12 32 22C31 28 26 34 20 38"
      fill="none"
      stroke="url(#ulyssesGrad)"
      strokeWidth="2"
      strokeLinecap="round"
      opacity="0.6"
    />
    {/* Song / Voice Waves */}
    <path
      d="M34 24Q38 22 40 26"
      fill="none"
      stroke="url(#ulyssesGrad)"
      strokeWidth="2"
      strokeLinecap="round"
    />
    <path
      d="M36 30Q40 28 42 32"
      fill="none"
      stroke="url(#ulyssesGrad)"
      strokeWidth="2"
      strokeLinecap="round"
      opacity="0.7"
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
    {/* Central Device - Clean Tablet/Phone Hybrid */}
    <rect
      x="16"
      y="12"
      width="16"
      height="24"
      rx="3"
      fill="none"
      stroke="url(#syncGrad)"
      strokeWidth="2.5"
    />
    <path
      d="M22 32H26"
      stroke="url(#syncGrad)"
      strokeWidth="2.5"
      strokeLinecap="round"
    />
    {/* Orbiting Sync Path Top-Left to Top-Right */}
    <path
      d="M8 24C8 15.16 15.16 8 24 8"
      stroke="url(#syncGrad)"
      strokeWidth="2"
      strokeLinecap="round"
      fill="none"
      opacity="0.6"
    />
    {/* Arrow Top */}
    <path
      d="M20 4L24 8L20 12"
      stroke="url(#syncGrad)"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      fill="none"
      opacity="0.6"
    />
    {/* Orbiting Sync Path Bottom-Right to Bottom-Left */}
    <path
      d="M40 24C40 32.84 32.84 40 24 40"
      stroke="url(#syncGrad)"
      strokeWidth="2"
      strokeLinecap="round"
      fill="none"
      opacity="0.6"
    />
    {/* Arrow Bottom */}
    <path
      d="M28 36L24 40L28 44"
      stroke="url(#syncGrad)"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      fill="none"
      opacity="0.6"
    />
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
