"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { motion, useInView } from "framer-motion";
import type { CSSProperties } from "react";
import { useMemo, useRef } from "react";
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
  return page <= 1 ? "/changelog" : `/changelog/${page.toString()}`;
}

function shouldAnimateChangelogHeader(pathname: string): boolean {
  if (typeof window === "undefined") {
    return true;
  }

  try {
    const previousPath = sessionStorage.getItem("freed-previous-path");
    const currentPath = sessionStorage.getItem("freed-current-path");
    const priorPath = currentPath === pathname ? previousPath : currentPath;

    return priorPath ? !priorPath.startsWith("/changelog") : true;
  } catch {
    return true;
  }
}

function PaginationNav({
  currentPage,
  totalPages,
  className = "",
}: {
  currentPage: number;
  totalPages: number;
  className?: string;
}) {
  if (totalPages <= 1) {
    return null;
  }

  return (
    <nav
      aria-label="Changelog pagination"
      className={`text-sm text-text-muted ${className}`.trim()}
    >
      <div className="flex flex-wrap items-center justify-center gap-x-1 gap-y-2">
        {Array.from({ length: totalPages }, (_, index) => {
          const page = index + 1;
          const isCurrent = page === currentPage;
          const label = page === 1 ? "Latest" : page.toLocaleString();

          return (
            <span key={page} className="flex items-center">
              {isCurrent ? (
                <span
                  aria-current="page"
                  className="rounded-md px-2 py-1 text-text-primary underline underline-offset-4 decoration-1"
                  style={{
                    textDecorationColor:
                      "color-mix(in srgb, var(--theme-heading-accent) 72%, transparent)",
                  }}
                >
                  {label}
                </span>
              ) : (
                <Link
                  href={getPageHref(page)}
                  className="rounded-md px-2 py-1 transition-colors hover:text-text-primary"
                >
                  {label}
                </Link>
              )}
            </span>
          );
        })}
      </div>
    </nav>
  );
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
        <div className="release-timeline-line absolute top-6 bottom-0 w-px last:hidden">
          <div
            className="release-timeline-line-base absolute inset-0"
            style={{
              background:
                "linear-gradient(to bottom, color-mix(in srgb, var(--theme-accent-secondary) 40%, transparent) 0%, color-mix(in srgb, var(--theme-accent-tertiary) 15%, transparent) 100%)",
            }}
          />
          <div
            className="release-timeline-line-hover absolute inset-0"
            style={{
              background:
                "linear-gradient(to bottom, color-mix(in srgb, var(--theme-heading-accent) 58%, transparent) 0%, color-mix(in srgb, var(--theme-accent-tertiary) 26%, transparent) 100%)",
            }}
          />
        </div>

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
  const pathname = usePathname();
  const shouldAnimateHeader = useMemo(
    () => shouldAnimateChangelogHeader(pathname),
    [pathname]
  );

  return (
    <section className="py-24 sm:py-32 px-4 sm:px-6 md:px-12 lg:px-8">
      <div className="max-w-2xl mx-auto">
        {/* Header */}
        <motion.header
          initial={shouldAnimateHeader ? { opacity: 0, y: 20 } : false}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6 }}
          className="text-center mb-10 sm:mb-12"
        >
          <h1 className="theme-display-large text-3xl sm:text-5xl font-bold mb-4">
            <span className="theme-heading-accent">Changelog</span>
          </h1>
          <p className="text-text-secondary text-base sm:text-lg">
            Even death stars have an exhaust vent.
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

        <PaginationNav
          currentPage={currentPage}
          totalPages={totalPages}
          className="mb-6"
        />

        {/* Timeline */}
        {releases.length > 0 && (
          <div className="relative">
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

        <PaginationNav
          currentPage={currentPage}
          totalPages={totalPages}
          className="mt-8"
        />

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
              View all {pageRange.total.toLocaleString()} releases on GitHub →
            </a>
          </motion.div>
        )}
      </div>
    </section>
  );
}
