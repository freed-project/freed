"use client";

import { motion, AnimatePresence } from "framer-motion";
import Link from "next/link";
import { useState, useEffect, type FormEvent } from "react";
import {
  FaArrowRight,
  FaXTwitter,
  FaInstagram,
  FaFacebook,
  FaRss,
} from "react-icons/fa6";
import HeroAnimation from "./HeroAnimation";
import { useNewsletter } from "@/context/NewsletterContext";
import { slowHeroMotion, slowHeroDelay, slowHeroInterval } from "@/lib/motion";

const ROTATING_WORDS = ["Feed", "Life", "Mind"];
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function Hero() {
  const { isSubscribed, openModal } = useNewsletter();
  const [wordIndex, setWordIndex] = useState(0);
  const [compactHeroAnimation, setCompactHeroAnimation] = useState(false);
  const [mobileEmail, setMobileEmail] = useState("");
  const [mobileEmailError, setMobileEmailError] = useState("");

  useEffect(() => {
    const interval = setInterval(() => {
      setWordIndex((prev) => (prev + 1) % ROTATING_WORDS.length);
    }, slowHeroInterval(6000));
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    const mediaQuery = window.matchMedia("(max-width: 1023px)");
    const updateCompactHero = () => setCompactHeroAnimation(mediaQuery.matches);
    updateCompactHero();
    mediaQuery.addEventListener("change", updateCompactHero);
    return () => mediaQuery.removeEventListener("change", updateCompactHero);
  }, []);

  const handleMobileSignup = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const normalizedEmail = mobileEmail.trim().toLowerCase();

    if (!EMAIL_REGEX.test(normalizedEmail)) {
      setMobileEmailError("Enter a valid email.");
      return;
    }

    setMobileEmailError("");
    openModal({
      email: normalizedEmail,
      detailsOpen: true,
    });
  };

  return (
    <section className="relative min-h-viewport-safe flex items-start justify-center px-8 sm:px-6 pb-8 pt-24 sm:pb-16 lg:pt-[clamp(7rem,_25vh,_50rem)]">
      {/* Open Source badge - aligned with nav container right edge, hidden on mobile */}
      <div className="hidden lg:block absolute top-20 left-0 right-0 mt-4 px-4 sm:px-6">
        <div className="max-w-6xl mx-auto flex justify-end">
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{
              duration: slowHeroMotion(0.5),
              delay: slowHeroDelay(0.08),
            }}
          >
            <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full border border-freed-border bg-freed-surface/50">
              <span className="w-2 h-2 rounded-full bg-[var(--theme-accent-secondary)] animate-pulse" />
              <span className="text-sm text-text-secondary">
                Open Source & Free Forever
              </span>
            </div>
          </motion.div>
        </div>
      </div>

      <div className="max-w-6xl mx-auto grid grid-cols-1 items-center gap-4 sm:gap-8 lg:grid-cols-[1fr_1.5fr] lg:gap-4">
        {/* Animation - shows first on mobile */}
        <motion.div
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{
            duration: slowHeroMotion(0.8),
            delay: slowHeroDelay(0.16),
          }}
          className="relative order-1 w-full lg:order-2"
          style={{
            maxWidth: compactHeroAnimation ? "282px" : "425px",
            margin: "0 auto",
          }}
        >
          <HeroAnimation compact={compactHeroAnimation} />
        </motion.div>

        {/* Text Content */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{
            duration: slowHeroMotion(0.55),
            delay: slowHeroDelay(0.04),
          }}
          className="order-2 text-center lg:order-1 lg:pl-10 lg:text-left"
        >
          <h1 className="theme-display-large mb-6 text-4xl font-bold leading-[1.05] sm:mb-12 sm:text-5xl lg:-ml-2 lg:text-7xl">
            <span className="text-text-primary">Take Back</span>
            <br />
            <span className="text-text-primary">Your </span>
            <span className="relative inline-block">
              <AnimatePresence mode="wait">
                <motion.span
                  key={wordIndex}
                  initial={{ y: 20, opacity: 0 }}
                  animate={{ y: 0, opacity: 1 }}
                  exit={{ y: -20, opacity: 0 }}
                  transition={{
                    duration: slowHeroMotion(0.5),
                    ease: "easeInOut",
                  }}
                  className="inline-block gradient-text"
                >
                  {ROTATING_WORDS[wordIndex]}
                </motion.span>
              </AnimatePresence>
            </span>
          </h1>

          <p className="mb-2 inline-flex items-center gap-3 text-xl font-medium text-text-primary sm:mb-3 sm:text-2xl">
            <FaFacebook className="shrink-0 text-[var(--theme-media-icon)]" />
            <FaInstagram className="shrink-0 text-[var(--theme-media-icon)]" />
            <FaXTwitter className="shrink-0 text-[var(--theme-media-icon)]" />
            <FaRss className="shrink-0 text-[var(--theme-media-icon)]" />
            <span>in one local app.</span>
          </p>

          <p className="mb-6 max-w-xl mx-auto text-base text-text-secondary sm:mb-8 sm:text-lg lg:mx-0">
            Mental sovereignty. Digital dignity. Your feed, your rules. Torch
            the ads, tune your algo, and connect IRL with a live map of your
            people.
          </p>

          {isSubscribed ? (
            <div
              role="status"
              aria-live="polite"
              className="mx-auto flex w-full max-w-md gap-3 rounded-xl border p-4 text-left lg:hidden"
              style={{
                background:
                  "color-mix(in srgb, rgb(var(--theme-feedback-success-rgb)) 10%, var(--theme-bg-elevated))",
                borderColor:
                  "color-mix(in srgb, rgb(var(--theme-feedback-success-rgb)) 38%, var(--theme-border-strong))",
                boxShadow:
                  "0 0 0 1px rgb(255 255 255 / 0.04), inset 0 1px 0 rgb(255 255 255 / 0.05)",
              }}
            >
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[rgb(var(--theme-feedback-success-rgb))] text-white">
                <svg
                  aria-hidden="true"
                  className="h-5 w-5"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={2.5}
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M4.5 12.75l6 6 9-13.5"
                  />
                </svg>
              </div>
              <div className="space-y-1">
                <p className="text-sm font-semibold text-text-primary">
                  You are now subscribed.
                </p>
                <p className="text-xs leading-relaxed text-text-secondary">
                  We will email you a download link when Freed launches.
                </p>
              </div>
            </div>
          ) : (
            <form
              onSubmit={handleMobileSignup}
              className="mx-auto flex w-full max-w-md flex-col gap-2 lg:hidden"
            >
              <label htmlFor="mobile-newsletter-email" className="sr-only">
                Email
              </label>
              <div className="flex w-full items-stretch rounded-xl border border-[color-mix(in_srgb,var(--theme-border-strong)_82%,transparent)] bg-[color-mix(in_srgb,var(--theme-bg-elevated)_96%,transparent)] shadow-[0_0_0_1px_rgb(255_255_255_/_0.04),inset_0_1px_0_rgb(255_255_255_/_0.05)]">
                <input
                  id="mobile-newsletter-email"
                  type="email"
                  value={mobileEmail}
                  onChange={(event) => {
                    setMobileEmail(event.target.value);
                    if (mobileEmailError) setMobileEmailError("");
                  }}
                  placeholder="your@email.com"
                  className="min-w-0 flex-1 bg-transparent px-4 py-3 text-sm text-text-primary placeholder:text-text-muted focus:outline-none"
                  autoComplete="email"
                  inputMode="email"
                  aria-invalid={!!mobileEmailError}
                  aria-describedby={
                    mobileEmailError ? "mobile-newsletter-error" : undefined
                  }
                  maxLength={254}
                  required
                />
                <button
                  type="submit"
                  className="inline-flex shrink-0 items-center justify-center gap-1.5 rounded-r-xl px-4 text-sm font-semibold text-[var(--theme-button-primary-text)]"
                  style={{
                    background: "var(--theme-button-primary-background)",
                  }}
                >
                  <span>Join Us</span>
                  <FaArrowRight aria-hidden="true" className="h-3.5 w-3.5" />
                </button>
              </div>
              {mobileEmailError && (
                <p
                  id="mobile-newsletter-error"
                  role="status"
                  className="text-left text-xs text-[rgb(var(--theme-feedback-danger-rgb))]"
                >
                  {mobileEmailError}
                </p>
              )}
              <p className="text-xs leading-relaxed text-text-muted">
                Freed is in early beta. You'll receive a download link when we
                launch 🚀
              </p>
            </form>
          )}

          <div className="hidden flex-col flex-wrap justify-center gap-3 lg:flex lg:flex-row lg:justify-start lg:gap-4">
            <motion.button
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.98 }}
              onClick={() => openModal()}
              className="btn-primary text-base px-8 py-3 w-full sm:w-auto"
            >
              Get Freed
            </motion.button>

            <Link href="/manifesto" className="w-full sm:w-auto">
              <motion.button
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
                className="btn-secondary text-base px-8 py-3 w-full"
              >
                Read the Manifesto
              </motion.button>
            </Link>
          </div>

          {/* Stats */}
          <div className="mt-6 flex justify-center gap-6 border-t border-freed-border pt-5 sm:mt-12 sm:gap-8 sm:pt-8 lg:justify-start">
            <div className="text-center lg:text-left">
              <p
                className="text-2xl sm:text-3xl font-bold"
                style={{ color: "var(--theme-metric-value)" }}
              >
                100%
              </p>
              <p className="text-xs sm:text-sm text-text-secondary">
                Local Storage
              </p>
            </div>
            <div className="text-center lg:text-left">
              <p
                className="text-2xl sm:text-3xl font-bold"
                style={{ color: "var(--theme-metric-value)" }}
              >
                0
              </p>
              <p className="text-xs sm:text-sm text-text-secondary">
                Data Collected
              </p>
            </div>
            <div className="text-center lg:text-left">
              <p
                className="text-2xl sm:text-3xl font-bold"
                style={{ color: "var(--theme-metric-value)" }}
              >
                ∞
              </p>
              <p className="text-xs sm:text-sm text-text-secondary">Freedom</p>
            </div>
          </div>
        </motion.div>
      </div>

      {/* Scroll indicator - hidden on mobile and tablet */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: slowHeroDelay(1.5) }}
        className="hidden lg:block absolute bottom-8 left-1/2 -translate-x-1/2"
      >
        <motion.div
          animate={{ y: [0, 8, 0] }}
          transition={{ duration: slowHeroMotion(1.5), repeat: Infinity }}
          className="w-6 h-10 rounded-full border-2 border-text-muted flex items-start justify-center p-2"
        >
          <div className="w-1 h-2 rounded-full bg-text-muted" />
        </motion.div>
      </motion.div>
    </section>
  );
}
