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
    <path
      d="M24 4L10 10v12c0 10 6.8 19.2 14 22 7.2-2.8 14-12 14-22V10L24 4z"
      fill="none"
      stroke="url(#privacyGrad)"
      strokeWidth="2.6"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
    <path
      d="M24 9L15 13v9c0 6.6 4.2 12.7 9 15 4.8-2.3 9-8.4 9-15v-9L24 9z"
      fill="none"
      stroke="url(#privacyGrad)"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      opacity="0.65"
    />
    <path
      d="M18 18L24 15L30 18"
      fill="none"
      stroke="url(#privacyGrad)"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      opacity="0.75"
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
    <path
      d="M4 36c6-8 14-12 22-14 7-2 12-7 12-12 0-4 3-6 7-6 5 0 9 4 9 9 0 8-6 14-13 16-4 1-6 3-6 6 0 4 3 6 7 6 5 0 8-2 10-4v7H4z"
      fill="url(#feedGrad)"
    />
    <path
      d="M38 4c5 0 9 4 9 9 0 7-5 12-11 14"
      fill="none"
      stroke="#a855f7"
      strokeWidth="2.5"
      strokeLinecap="round"
    />
    <path
      d="M37 10c3 1 4 3 4 6 0 4-3 7-7 8"
      fill="none"
      stroke="#8b5cf6"
      strokeWidth="1.6"
      strokeLinecap="round"
      opacity="0.8"
    />
    <circle cx="40" cy="7" r="2" fill="#a855f7" />
    <circle cx="44" cy="12" r="1.5" fill="#8b5cf6" opacity="0.75" />
    <circle cx="46" cy="18" r="1.5" fill="#6366f1" opacity="0.6" />
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
    <path
      d="M14 16c0-7 6-12 10-12s10 5 10 12"
      fill="none"
      stroke="url(#ulyssesGrad)"
      strokeWidth="2.4"
      strokeLinecap="round"
    />
    <path
      d="M12 18c-2 8 1 16 6 20"
      fill="none"
      stroke="url(#ulyssesGrad)"
      strokeWidth="2"
      strokeLinecap="round"
      opacity="0.8"
    />
    <path
      d="M36 18c2 8-1 16-6 20"
      fill="none"
      stroke="url(#ulyssesGrad)"
      strokeWidth="2"
      strokeLinecap="round"
      opacity="0.8"
    />
    <path
      d="M24 10c-6 0-9 4-9 10 0 8 5 14 9 16 4-2 9-8 9-16 0-6-3-10-9-10z"
      fill="none"
      stroke="url(#ulyssesGrad)"
      strokeWidth="2.4"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
    <path
      d="M18 21c2-2 4-2 6 0"
      fill="none"
      stroke="url(#ulyssesGrad)"
      strokeWidth="1.6"
      strokeLinecap="round"
      opacity="0.8"
    />
    <path
      d="M24 21c2-2 4-2 6 0"
      fill="none"
      stroke="url(#ulyssesGrad)"
      strokeWidth="1.6"
      strokeLinecap="round"
      opacity="0.8"
    />
    <ellipse
      cx="24"
      cy="26.5"
      rx="2.2"
      ry="3"
      fill="url(#ulyssesGrad)"
      opacity="0.85"
    />
    <path
      d="M32 23c4 0 7-2 9-5"
      fill="none"
      stroke="url(#ulyssesGrad)"
      strokeWidth="2"
      strokeLinecap="round"
    />
    <path
      d="M32 27c5 1 8 4 10 8"
      fill="none"
      stroke="url(#ulyssesGrad)"
      strokeWidth="2"
      strokeLinecap="round"
      opacity="0.85"
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
    <rect
      x="6"
      y="10"
      width="18"
      height="12"
      rx="2"
      fill="none"
      stroke="url(#syncGrad)"
      strokeWidth="2.4"
    />
    <rect
      x="24"
      y="26"
      width="18"
      height="12"
      rx="2"
      fill="none"
      stroke="url(#syncGrad)"
      strokeWidth="2.4"
    />
    <path
      d="M12 28A12 12 0 0 1 28 12"
      fill="none"
      stroke="url(#syncGrad)"
      strokeWidth="2.2"
      strokeLinecap="round"
    />
    <path
      d="M36 20A12 12 0 0 1 20 36"
      fill="none"
      stroke="url(#syncGrad)"
      strokeWidth="2.2"
      strokeLinecap="round"
    />
    <path
      d="M26 10l2 2 2-2"
      fill="none"
      stroke="url(#syncGrad)"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
    <path
      d="M22 38l-2-2-2 2"
      fill="none"
      stroke="url(#syncGrad)"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
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
