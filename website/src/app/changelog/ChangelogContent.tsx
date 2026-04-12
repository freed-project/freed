"use client";

import Link from "next/link";
import { motion, useInView } from "framer-motion";
import type { CSSProperties } from "react";
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

function getPageHref(page: number): string {
  return page <= 1 ? "/changelog" : `/changelog/page/${page.toString()}`;
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
    release.followUps.length > 0;

  return (
    <div
      ref={ref}
      className="release-entry relative flex gap-6 sm:gap-10 pb-12 last:pb-0"
    >
      {/* Timeline node + line */}
      <div
        className="relative flex flex-col items-center"
        style={{ width: 24, flexShrink: 0 }}
      >
        {/* Vertical line below node (hidden on last item) */}
        <div
          className="release-timeline-line absolute top-6 bottom-0 w-px last:hidden transition-all duration-300"
          style={{
            background:
              "linear-gradient(to bottom, color-mix(in srgb, var(--theme-accent-secondary) 40%, transparent) 0%, color-mix(in srgb, var(--theme-accent-tertiary) 15%, transparent) 100%)",
          }}
        />

        {/* Node */}
        <div className="release-timeline-node relative z-10 mt-1 transition-transform duration-300">
          {isLatest ? (
            <>
              {/* Pulsing rings for latest release */}
              <motion.div
                className="absolute inset-0 rounded-full"
                style={{
                  background:
                    "color-mix(in srgb, var(--theme-accent-secondary) 30%, transparent)",
                }}
                animate={{ scale: [1, 1.8], opacity: [0.6, 0] }}
                transition={{ duration: 2, repeat: Infinity, ease: "easeOut" }}
              />
              <motion.div
                className="absolute inset-0 rounded-full"
                style={{
                  background:
                    "color-mix(in srgb, var(--theme-accent-secondary) 20%, transparent)",
                }}
                animate={{ scale: [1, 2.4], opacity: [0.4, 0] }}
                transition={{
                  duration: 2,
                  repeat: Infinity,
                  ease: "easeOut",
                  delay: 0.4,
                }}
              />
              <div
                className="w-4 h-4 rounded-full border-2"
                style={{
                  borderColor:
                    "color-mix(in srgb, var(--theme-heading-accent) 62%, white 12%)",
                  background: "var(--theme-heading-accent)",
                }}
              />
            </>
          ) : (
            <div
              className="w-3 h-3 rounded-full border border-[color:color-mix(in_srgb,var(--theme-accent-secondary)_40%,transparent)]"
              style={{
                background:
                  "color-mix(in srgb, var(--theme-accent-secondary) 15%, transparent)",
                marginTop: 2,
              }}
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
          className="release-card-shell group relative overflow-hidden rounded-xl border transition-[transform,border-color,background-color,box-shadow] duration-300"
          style={{
            borderColor:
              "color-mix(in srgb, var(--theme-border-subtle) 92%, transparent)",
            background:
              "linear-gradient(180deg, color-mix(in srgb, var(--theme-heading-accent) 7%, transparent) 0%, transparent 5rem), color-mix(in srgb, var(--theme-bg-surface) 88%, transparent)",
            boxShadow: isLatest
              ? "0 16px 34px rgb(var(--theme-shell-rgb) / 0.22)"
              : "0 12px 26px rgb(var(--theme-shell-rgb) / 0.16)",
          }}
        >
          <a
            href={release.htmlUrl}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={`Open GitHub release for v${release.version}`}
            className="absolute inset-0 z-10 rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2"
            style={
              {
                "--tw-ring-color": "var(--theme-focus-ring)",
                "--tw-ring-offset-color": "var(--theme-bg-root)",
              } as CSSProperties
            }
          />

          <div className="pointer-events-none relative z-20 p-5 sm:p-6">
            {/* Header */}
            <div className="flex flex-wrap items-center gap-3 mb-3">
              <a
                href={release.htmlUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="release-card-version pointer-events-auto inline-block text-xl font-bold font-logo tracking-tight underline-offset-4 decoration-1 transition-all group-hover:underline group-focus-within:underline"
                style={{
                  textDecorationColor:
                    "color-mix(in srgb, var(--theme-heading-accent) 70%, transparent)",
                }}
              >
                v{release.version}
              </a>
              {isLatest && (
                <span
                  className="px-2.5 py-0.5 rounded-full text-xs font-semibold border"
                  style={{
                    background:
                      "color-mix(in srgb, var(--theme-heading-accent) 14%, transparent)",
                    color: "var(--theme-heading-accent)",
                    borderColor:
                      "color-mix(in srgb, var(--theme-heading-accent) 24%, transparent)",
                  }}
                >
                  Latest
                </span>
              )}
              <time className="release-card-date ml-auto text-sm text-text-muted transition-colors duration-300">
                {formatDate(release.date)}
              </time>
            </div>
            {release.deck && (
              <p className="mb-4 text-[13px] leading-5 text-text-secondary">
                {release.deck}
              </p>
            )}

            {/* Content */}
            {hasContent ? (
              <div className="space-y-4">
                {release.features.length > 0 && (
                  <Section
                    title="Features"
                    items={release.features}
                    accent="purple"
                  />
                )}
                {release.fixes.length > 0 && (
                  <Section title="Fixes" items={release.fixes} accent="zinc" />
                )}
                {release.followUps.length > 0 && (
                  <Section
                    title="Follow-ups"
                    items={release.followUps}
                    accent="zinc"
                  />
                )}
              </div>
            ) : (
              <p className="text-[13px] leading-5 text-text-muted">
                Bug fixes and improvements.
              </p>
            )}

            <div className="mt-4 pt-3 border-t border-freed-border space-y-2">
              <div className="flex flex-wrap gap-2 items-center">
                <span className="text-xs text-text-muted">Builds:</span>
                {release.buildLinks.map((build) => (
                  <a
                    key={build.version}
                    href={build.htmlUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="pointer-events-auto text-xs text-text-muted transition-colors hover:text-text-primary"
                  >
                    v{build.version}
                  </a>
                ))}
              </div>
              {release.prNumbers.length > 0 && (
                <div className="flex flex-wrap gap-2 items-center">
                  <span className="text-xs text-text-muted">PRs:</span>
                  {release.prNumbers.map((num) => (
                    <a
                      key={num}
                      href={`https://github.com/freed-project/freed/pull/${num}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="pointer-events-auto text-xs text-text-muted transition-colors hover:text-text-primary"
                    >
                      #{num}
                    </a>
                  ))}
                </div>
              )}
            </div>
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
  accent: "purple" | "zinc";
}) {
  const dotStyle =
    accent === "purple"
      ? { background: "var(--theme-heading-accent)" }
      : {
          background:
            "color-mix(in srgb, var(--theme-text-muted) 78%, transparent)",
        };

  const labelStyle =
    accent === "purple"
      ? { color: "var(--theme-heading-accent)" }
      : { color: "var(--theme-text-muted)" };

  return (
    <div>
      <h3
        className="text-xs font-semibold uppercase tracking-wider mb-2"
        style={labelStyle}
      >
        {title}
      </h3>
      <ul className="space-y-1">
        {items.map((item, i) => (
          <li
            key={i}
            className="flex gap-2.5 text-[13px] leading-5 text-text-secondary"
          >
            <span
              className="mt-[6px] h-1.5 w-1.5 rounded-full shrink-0 opacity-70"
              style={dotStyle}
            />
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
  currentPage,
  totalPages,
  pageRange,
}: {
  releases: ParsedRelease[];
  currentPage: number;
  totalPages: number;
  pageRange: { start: number; end: number; total: number };
}) {
  const hasPreviousPage = currentPage > 1;
  const hasNextPage = currentPage < totalPages;

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
          <h1 className="theme-display-large text-3xl sm:text-5xl font-bold mb-4">
            <span className="theme-heading-accent">Changelog</span>
          </h1>
          <p className="text-text-secondary text-base sm:text-lg">
            Even death stars have an exhaust vent.
          </p>
          {pageRange.total > 0 && (
            <p className="mt-3 text-sm text-text-muted">
              Showing versions {pageRange.start.toLocaleString()} to{" "}
              {pageRange.end.toLocaleString()} of{" "}
              {pageRange.total.toLocaleString()}
            </p>
          )}
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
                  "linear-gradient(to bottom, color-mix(in srgb, var(--theme-accent-secondary) 12%, transparent) 0%, color-mix(in srgb, var(--theme-accent-tertiary) 4%, transparent) 100%)",
              }}
            />

            <div>
              {releases.map((release, index) => (
                <ReleaseCard
                  key={release.tagName}
                  release={release}
                  index={index}
                  isLatest={currentPage === 1 && index === 0}
                />
              ))}
            </div>
          </div>
        )}

        {totalPages > 1 && (
          <motion.nav
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.35 }}
            aria-label="Changelog pagination"
            className="mt-12 flex flex-col gap-4 rounded-xl border border-freed-border bg-freed-surface/40 p-4 sm:flex-row sm:items-center sm:justify-between"
          >
            <div className="text-sm text-text-muted">
              Page {currentPage.toLocaleString()} of{" "}
              {totalPages.toLocaleString()}
            </div>

            <div className="flex items-center gap-3">
              <Link
                href={
                  hasPreviousPage
                    ? getPageHref(currentPage - 1)
                    : getPageHref(currentPage)
                }
                aria-disabled={!hasPreviousPage}
                className={`rounded-lg border px-3 py-2 text-sm transition-colors ${
                  hasPreviousPage
                    ? "border-freed-border text-text-secondary hover:border-[color:var(--theme-heading-accent)] hover:text-text-primary"
                    : "pointer-events-none border-freed-border/60 text-text-muted opacity-50"
                }`}
              >
                Newer
              </Link>
              <Link
                href={
                  hasNextPage
                    ? getPageHref(currentPage + 1)
                    : getPageHref(currentPage)
                }
                aria-disabled={!hasNextPage}
                className={`rounded-lg border px-3 py-2 text-sm transition-colors ${
                  hasNextPage
                    ? "border-freed-border text-text-secondary hover:border-[color:var(--theme-heading-accent)] hover:text-text-primary"
                    : "pointer-events-none border-freed-border/60 text-text-muted opacity-50"
                }`}
              >
                Older
              </Link>
            </div>
          </motion.nav>
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
              className="text-sm text-text-muted transition-colors hover:text-text-primary"
            >
              View all releases on GitHub →
            </a>
          </motion.div>
        )}
      </div>
    </section>
  );
}
