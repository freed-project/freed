"use client";

import { motion } from "framer-motion";

// Custom SVG icons with gradient styling
const PrivacyIcon = () => (
  <svg viewBox="0 0 48 48" className="w-12 h-12">
    <defs>
      <linearGradient id="privacyGrad" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stopColor="#3b82f6" />
        <stop offset="50%" stopColor="#6366f1" />
        <stop offset="100%" stopColor="#8b5cf6" />
      </linearGradient>
    </defs>
    {/* Bold shield with elegant proportions */}
    <path
      d="M24 3L7 10v14c0 12 8.5 22 17 25 8.5-3 17-13 17-25V10L24 3z"
      fill="url(#privacyGrad)"
      opacity="0.15"
    />
    <path
      d="M24 3L7 10v14c0 12 8.5 22 17 25 8.5-3 17-13 17-25V10L24 3z"
      fill="none"
      stroke="url(#privacyGrad)"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
    {/* Checkmark - trust indicator */}
    <path
      d="M16 24l5 5 11-11"
      fill="none"
      stroke="url(#privacyGrad)"
      strokeWidth="3"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

const UnifiedFeedIcon = () => (
  <svg viewBox="0 0 48 48" className="w-12 h-12">
    <defs>
      <linearGradient id="feedGrad" x1="0%" y1="100%" x2="100%" y2="0%">
        <stop offset="0%" stopColor="#3b82f6" />
        <stop offset="50%" stopColor="#6366f1" />
        <stop offset="100%" stopColor="#a855f7" />
      </linearGradient>
    </defs>
    {/* Classic wave emoji style - curling crest */}
    <path
      d="M4 38 Q4 32 10 28 Q16 24 20 18 Q24 12 30 10 Q36 8 40 12 Q44 16 42 22 Q40 28 36 30 Q32 32 28 30 Q24 28 22 32 Q20 36 16 38 Q12 40 8 40 Q4 40 4 38 Z"
      fill="url(#feedGrad)"
    />
    {/* Curling white crest */}
    <path
      d="M40 12 Q46 8 46 14 Q46 20 42 24 Q38 28 34 26"
      fill="none"
      stroke="url(#feedGrad)"
      strokeWidth="2.5"
      strokeLinecap="round"
    />
    {/* Inner spiral detail */}
    <path
      d="M42 14 Q44 16 42 20 Q40 24 38 24"
      fill="none"
      stroke="#8b5cf6"
      strokeWidth="2"
      strokeLinecap="round"
    />
    {/* Spray droplets */}
    <circle cx="44" cy="8" r="2.5" fill="#a855f7" />
    <circle cx="38" cy="6" r="2" fill="#8b5cf6" />
    <circle cx="46" cy="16" r="1.5" fill="#6366f1" opacity="0.8" />
    <circle cx="34" cy="4" r="1.5" fill="#6366f1" opacity="0.6" />
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
      <linearGradient id="hairGrad" x1="100%" y1="0%" x2="0%" y2="100%">
        <stop offset="0%" stopColor="#8b5cf6" />
        <stop offset="100%" stopColor="#a855f7" />
      </linearGradient>
    </defs>
    {/* Elegant feminine profile - siren singing */}
    {/* Flowing hair cascading back */}
    <path
      d="M18 8 Q10 10 8 18 Q6 26 8 34 Q10 40 14 44"
      fill="none"
      stroke="url(#hairGrad)"
      strokeWidth="2.5"
      strokeLinecap="round"
    />
    <path
      d="M20 6 Q14 8 12 14 Q10 22 12 30 Q14 38 18 44"
      fill="none"
      stroke="url(#hairGrad)"
      strokeWidth="2"
      strokeLinecap="round"
      opacity="0.7"
    />
    <path
      d="M22 5 Q18 6 16 12 Q14 20 16 28"
      fill="none"
      stroke="url(#hairGrad)"
      strokeWidth="1.5"
      strokeLinecap="round"
      opacity="0.5"
    />
    {/* Face profile - forehead, nose, lips, chin */}
    <path
      d="M24 6 Q28 6 30 10 Q31 14 29 16 L31 18 L29 20 Q30 22 29 24 Q28 28 24 30"
      fill="none"
      stroke="url(#ulyssesGrad)"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
    {/* Eye */}
    <ellipse cx="26" cy="12" rx="1.5" ry="1" fill="url(#ulyssesGrad)" />
    {/* Neck flowing into shoulder suggestion */}
    <path
      d="M24 30 Q22 34 20 38"
      fill="none"
      stroke="url(#ulyssesGrad)"
      strokeWidth="2"
      strokeLinecap="round"
    />
    {/* Sound waves - singing */}
    <path
      d="M34 16 Q38 14 38 18 Q38 22 34 20"
      fill="none"
      stroke="url(#ulyssesGrad)"
      strokeWidth="1.5"
      strokeLinecap="round"
      opacity="0.9"
    />
    <path
      d="M38 14 Q44 10 44 18 Q44 26 38 22"
      fill="none"
      stroke="url(#ulyssesGrad)"
      strokeWidth="1.5"
      strokeLinecap="round"
      opacity="0.6"
    />
    <path
      d="M42 12 Q48 6 48 18 Q48 30 42 24"
      fill="none"
      stroke="url(#ulyssesGrad)"
      strokeWidth="1.5"
      strokeLinecap="round"
      opacity="0.3"
    />
  </svg>
);

const SyncIcon = () => (
  <svg viewBox="0 0 48 48" className="w-12 h-12">
    <defs>
      <linearGradient id="syncGrad" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stopColor="#3b82f6" />
        <stop offset="50%" stopColor="#6366f1" />
        <stop offset="100%" stopColor="#8b5cf6" />
      </linearGradient>
    </defs>
    {/* Elegant circular sync arrows */}
    {/* Upper arc with arrow */}
    <path
      d="M8 24 A16 16 0 0 1 40 24"
      fill="none"
      stroke="url(#syncGrad)"
      strokeWidth="3"
      strokeLinecap="round"
    />
    <path
      d="M36 16 L40 24 L32 24"
      fill="none"
      stroke="url(#syncGrad)"
      strokeWidth="3"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
    {/* Lower arc with arrow */}
    <path
      d="M40 24 A16 16 0 0 1 8 24"
      fill="none"
      stroke="url(#syncGrad)"
      strokeWidth="3"
      strokeLinecap="round"
    />
    <path
      d="M12 32 L8 24 L16 24"
      fill="none"
      stroke="url(#syncGrad)"
      strokeWidth="3"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
    {/* Center pulse dot */}
    <circle cx="24" cy="24" r="4" fill="url(#syncGrad)" opacity="0.3" />
    <circle cx="24" cy="24" r="2" fill="url(#syncGrad)" />
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
