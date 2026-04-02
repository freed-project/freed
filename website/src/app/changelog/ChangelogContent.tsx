"use client";

import { motion, useInView } from "framer-motion";
import { useRef } from "react";
import type { ParsedRelease } from "@/content/changelog";

function formatDate(iso: string): string {
  const date = new Date(iso);
  return date.toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

// ── Individual release card ───────────────────────────────────────────────────

function ReleaseCard({
  release,
  index,
  isLatest,
}: {
  release: ParsedRelease;
  index: number;
  isLatest: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, margin: "-80px" });

  const hasContent =
    release.features.length > 0 ||
    release.fixes.length > 0 ||
    release.performance.length > 0;

  return (
    <div ref={ref} className="relative flex gap-6 sm:gap-10 pb-12 last:pb-0">
      {/* Timeline node + line */}
      <div className="relative flex flex-col items-center" style={{ width: 24, flexShrink: 0 }}>
        {/* Vertical line below node (hidden on last item) */}
        <div
          className="absolute top-6 bottom-0 w-px last:hidden"
          style={{
            background:
              "linear-gradient(to bottom, rgba(139,92,246,0.4) 0%, rgba(6,182,212,0.15) 100%)",
          }}
        />

        {/* Node */}
        <div className="relative z-10 mt-1">
          {isLatest ? (
            <>
              {/* Pulsing rings for latest release */}
              <motion.div
                className="absolute inset-0 rounded-full"
                style={{ background: "rgba(139,92,246,0.3)" }}
                animate={{ scale: [1, 1.8], opacity: [0.6, 0] }}
                transition={{ duration: 2, repeat: Infinity, ease: "easeOut" }}
              />
              <motion.div
                className="absolute inset-0 rounded-full"
                style={{ background: "rgba(139,92,246,0.2)" }}
                animate={{ scale: [1, 2.4], opacity: [0.4, 0] }}
                transition={{
                  duration: 2,
                  repeat: Infinity,
                  ease: "easeOut",
                  delay: 0.4,
                }}
              />
              <div
                className="w-4 h-4 rounded-full border-2 border-glow-purple"
                style={{ background: "var(--color-glow-purple)" }}
              />
            </>
          ) : (
            <div
              className="w-3 h-3 rounded-full border border-[rgba(139,92,246,0.4)]"
              style={{ background: "rgba(139,92,246,0.15)", marginTop: 2 }}
            />
          )}
        </div>
      </div>

      {/* Card */}
      <motion.div
        initial={{ opacity: 0, x: 24 }}
        animate={inView ? { opacity: 1, x: 0 } : { opacity: 0, x: 24 }}
        transition={{ duration: 0.4, delay: Math.min(index * 0.04, 0.3) }}
        className="flex-1 min-w-0"
      >
        <div
          className={`rounded-xl border p-5 sm:p-6 transition-colors duration-200 ${
            isLatest
              ? "border-glow-purple/40 bg-glow-purple/5"
              : "border-freed-border bg-freed-surface/40"
          }`}
        >
          {/* Header */}
          <div className="flex flex-wrap items-center gap-3 mb-3">
            <h2 className="text-xl font-bold gradient-text font-logo tracking-tight">
              v{release.version}
            </h2>
            {isLatest && (
              <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-glow-purple/20 text-glow-purple border border-glow-purple/30">
                Latest
              </span>
            )}
            <time className="ml-auto text-sm text-text-muted">
              {formatDate(release.date)}
            </time>
          </div>
          {release.builds.length > 1 && (
            <p className="mb-3 text-xs text-text-muted">
              Builds: {release.builds.map((build) => `v${build}`).join(", ")}
            </p>
          )}
          {release.summary && (
            <p className="mb-4 text-sm text-text-secondary">{release.summary}</p>
          )}

          {/* Content */}
          {hasContent ? (
            <div className="space-y-4">
              {release.features.length > 0 && (
                <Section title="What's New" items={release.features} accent="purple" />
              )}
              {release.performance.length > 0 && (
                <Section title="Performance" items={release.performance} accent="cyan" />
              )}
              {release.fixes.length > 0 && (
                <Section title="Fixes" items={release.fixes} accent="zinc" />
              )}
            </div>
          ) : (
            <p className="text-sm text-text-muted">Bug fixes and improvements.</p>
          )}

          {/* PR links + GitHub release footer - GitHub link always shows */}
          <div className="mt-4 pt-3 border-t border-freed-border flex flex-wrap gap-2 items-center">
            {release.prNumbers.length > 0 && (
              <>
                <span className="text-xs text-text-muted">PRs</span>
                {release.prNumbers.map((num) => (
                  <a
                    key={num}
                    href={`https://github.com/freed-project/freed/pull/${num}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs text-text-muted hover:text-glow-purple transition-colors"
                  >
                    #{num}
                  </a>
                ))}
              </>
            )}
            <a
              href={release.htmlUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="ml-auto text-xs text-text-muted hover:text-glow-purple transition-colors"
            >
              GitHub release →
            </a>
          </div>
        </div>
      </motion.div>
    </div>
  );
}

function Section({
  title,
  items,
  accent,
}: {
  title: string;
  items: Array<{ text: string; prNumber?: number }>;
  accent: "purple" | "cyan" | "zinc";
}) {
  const dotColor = {
    purple: "bg-glow-purple",
    cyan: "bg-glow-cyan",
    zinc: "bg-zinc-500",
  }[accent];

  const labelColor = {
    purple: "text-glow-purple",
    cyan: "text-glow-cyan",
    zinc: "text-text-muted",
  }[accent];

  return (
    <div>
      <h3 className={`text-xs font-semibold uppercase tracking-wider mb-2 ${labelColor}`}>
        {title}
      </h3>
      <ul className="space-y-1.5">
        {items.map((item, i) => (
          <li key={i} className="flex gap-2.5 text-sm text-text-secondary">
            <span className={`mt-[7px] w-1.5 h-1.5 rounded-full shrink-0 ${dotColor} opacity-70`} />
            <span>{item.text}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ── Page ─────────────────────────────────────────────────────────────────────

export default function ChangelogContent({
  releases,
}: {
  releases: ParsedRelease[];
}) {
  return (
    <section className="py-24 sm:py-32 px-4 sm:px-6 md:px-12 lg:px-8">
      <div className="max-w-2xl mx-auto">
        {/* Header */}
        <motion.header
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6 }}
          className="text-center mb-16 sm:mb-20"
        >
          <h1 className="text-3xl sm:text-5xl font-bold mb-4">
            <span className="gradient-text">Changelog</span>
          </h1>
          <p className="text-text-secondary text-base sm:text-lg">
            Even death stars have an exhaust vent.
          </p>
          <p className="text-text-muted text-sm mt-1">
            Auto-updated when new builds ship.
          </p>
        </motion.header>

        {/* Empty state */}
        {releases.length === 0 && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="text-center py-20 text-text-muted"
          >
            No releases yet.
          </motion.div>
        )}

        {/* Timeline */}
        {releases.length > 0 && (
          <div className="relative">
            {/* Faint background track for the full timeline line */}
            <div
              className="absolute left-[11px] top-2 bottom-0 w-px pointer-events-none"
              style={{
                background:
                  "linear-gradient(to bottom, rgba(139,92,246,0.12) 0%, rgba(6,182,212,0.04) 100%)",
              }}
            />

            <div>
              {releases.map((release, index) => (
                <ReleaseCard
                  key={release.tagName}
                  release={release}
                  index={index}
                  isLatest={index === 0}
                />
              ))}
            </div>
          </div>
        )}

        {/* Footer CTA */}
        {releases.length > 0 && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.5 }}
            className="mt-12 text-center"
          >
            <a
              href="https://github.com/freed-project/freed/releases"
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm text-text-muted hover:text-glow-purple transition-colors"
            >
              View all releases on GitHub →
            </a>
          </motion.div>
        )}
      </div>
    </section>
  );
}
