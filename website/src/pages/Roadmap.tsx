import { motion } from "framer-motion";
import { useNewsletter } from "../context/NewsletterContext";

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
    status: "complete",
  },
  {
    number: 2,
    title: "Capture Skills",
    description:
      "capture-x and capture-rss packages with OpenClaw skill wrappers.",
    status: "complete",
  },
  {
    number: 3,
    title: "Save for Later",
    description:
      "URL capture with Readability extraction. Capture any article, thread, or page.",
    status: "upcoming",
    planLink:
      "https://github.com/freed-project/freed/blob/main/docs/PHASE-3-SAVE-FOR-LATER.md",
  },
  {
    number: 4,
    title: "Sync Layer",
    description:
      "Local WebSocket relay + cloud backup. Automerge CRDT for conflict-free sync.",
    status: "upcoming",
    planLink:
      "https://github.com/freed-project/freed/blob/main/docs/PHASE-4-SYNC.md",
  },
  {
    number: 5,
    title: "Desktop App",
    description:
      "Native app bundling capture, sync, and reader UI. The hub that makes everything work.",
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
    status: "upcoming",
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
      "Quick saves and Ulysses mode. Block platform feeds, stay intentional.",
    status: "upcoming",
    planLink:
      "https://github.com/freed-project/freed/blob/main/docs/PHASE-9-BROWSER-EXTENSION.md",
  },
  {
    number: 10,
    title: "Polish",
    description:
      "Onboarding flows, statistics dashboard, accessibility improvements.",
    status: "upcoming",
    planLink:
      "https://github.com/freed-project/freed/blob/main/docs/PHASE-10-POLISH.md",
  },
  {
    number: 11,
    title: "OpenClaw Integration 🦞",
    description: "Headless capture for power users. Run FREED without the GUI.",
    status: "upcoming",
    planLink:
      "https://github.com/freed-project/freed/blob/main/docs/PHASE-11-OPENCLAW.md",
  },
  {
    number: 12,
    title: "Additional Platforms",
    description: "LinkedIn, TikTok, Threads, and beyond.",
    status: "upcoming",
    planLink:
      "https://github.com/freed-project/freed/blob/main/docs/PHASE-12-ADDITIONAL-PLATFORMS.md",
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

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, delay: index * 0.05 }}
      className={`relative p-6 rounded-xl border ${style.border} ${style.bg} ${style.glow} transition-all hover:scale-[1.02]`}
    >
      {/* Priority badge */}
      {phase.priority && (
        <div className="absolute -top-3 -right-3 px-3 py-1 rounded-full bg-linear-to-r from-glow-blue to-glow-purple text-xs font-bold text-white">
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
            <a
              href={phase.planLink}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs text-text-muted hover:text-glow-purple transition-colors"
            >
              View Plan →
            </a>
          )}
        </div>
      </div>
    </motion.div>
  );
}

export default function Roadmap() {
  const { openModal } = useNewsletter();

  const completedCount = phases.filter((p) => p.status === "complete").length;
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
          <p className="text-text-secondary text-lg sm:text-xl mb-8">
            Where we are. Where we're going. Fully transparent.
          </p>

          {/* Progress bar */}
          <div className="max-w-md mx-auto">
            <div className="flex justify-between text-sm text-text-muted mb-2">
              <span>
                {completedCount} of {totalCount} phases complete
              </span>
              <span>{Math.round(progressPercent)}%</span>
            </div>
            <div className="h-2 bg-freed-surface rounded-full overflow-hidden">
              <motion.div
                initial={{ width: 0 }}
                animate={{ width: `${progressPercent}%` }}
                transition={{ duration: 1, delay: 0.3 }}
                className="h-full bg-linear-to-r from-glow-blue via-glow-purple to-glow-cyan rounded-full"
              />
            </div>
          </div>
        </motion.header>

        {/* Architecture Overview */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.2 }}
          className="glass-card p-6 sm:p-8 mb-12 rounded-xl"
        >
          <h2 className="text-xl font-bold text-text-primary mb-4">
            Architecture
          </h2>
          <div className="font-mono text-sm text-text-secondary overflow-x-auto">
            <pre className="whitespace-pre">
              {`  Capture Layers              Sync                    Clients
 ─────────────────      ─────────────────      ─────────────────
  X, RSS, Facebook,  →   Automerge CRDT   →    Desktop App
  Instagram, etc.        Local + Cloud          Phone PWA
                                                Extension`}
            </pre>
          </div>
          <p className="text-text-muted text-sm mt-4">
            Desktop App is the hub. It runs capture, hosts the sync relay, and
            provides the reader UI.
          </p>
        </motion.div>

        {/* Phases */}
        <div className="space-y-4">
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
              View on GitHub
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
