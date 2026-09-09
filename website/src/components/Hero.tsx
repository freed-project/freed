"use client";

import { motion, AnimatePresence } from "framer-motion";
import Link from "next/link";
import DemoLink from "./DemoLink";
import { useState, useEffect } from "react";
import {
  FaPlay,
  FaWaveSquare,
  FaXTwitter,
  FaInstagram,
  FaFacebook,
  FaRss,
} from "react-icons/fa6";
import HeroAnimation from "./HeroAnimation";
import { slowHeroMotion, slowHeroDelay } from "@/lib/motion";

const ROTATING_WORDS = ["Feed", "Life", "Mind"];
const HEADLINE_ROTATION_INTERVAL_MS = 6000;
const HEADLINE_WORD_TRANSITION_SECONDS = 1 / 6;
const HEADLINE_LAYOUT_TRANSITION = {
  duration: 0.35,
  ease: [0.22, 1, 0.36, 1],
} as const;

export default function Hero() {
  const [wordIndex, setWordIndex] = useState(0);
  const [compactHeroAnimation, setCompactHeroAnimation] = useState(false);

  useEffect(() => {
    const interval = setInterval(() => {
      setWordIndex((prev) => (prev + 1) % ROTATING_WORDS.length);
    }, HEADLINE_ROTATION_INTERVAL_MS);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    const mediaQuery = window.matchMedia("(max-width: 1023px)");
    const updateCompactHero = () => setCompactHeroAnimation(mediaQuery.matches);
    updateCompactHero();
    mediaQuery.addEventListener("change", updateCompactHero);
    return () => mediaQuery.removeEventListener("change", updateCompactHero);
  }, []);

  return (
    <section
      className="relative flex items-start justify-center px-8 sm:px-6"
      // Compact layouts need only a small gap after the fixed navigation.
      style={{ paddingTop: compactHeroAnimation ? "6rem" : "calc(5rem + var(--landing-section-gap, 3rem))" }}
    >
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
          className="order-2 text-center lg:order-1"
        >
          <h1 className="theme-display-large mb-6 text-4xl font-bold leading-[1.05] sm:mb-12 sm:text-5xl lg:text-7xl">
            <span className="block text-text-primary">Take Back</span>
            <motion.span
              layout
              transition={HEADLINE_LAYOUT_TRANSITION}
              className="flex flex-wrap items-baseline justify-center gap-x-[0.2em]"
            >
              <motion.span
                layout="position"
                transition={HEADLINE_LAYOUT_TRANSITION}
                className="inline-block text-text-primary"
              >
                Your
              </motion.span>
              <motion.span
                layout
                transition={HEADLINE_LAYOUT_TRANSITION}
                className="relative inline-grid"
              >
                <AnimatePresence initial={false} mode="popLayout">
                  <motion.span
                    layout
                    key={wordIndex}
                    initial={{ y: 20, opacity: 0 }}
                    animate={{ y: 0, opacity: 1 }}
                    exit={{ y: -20, opacity: 0 }}
                    transition={{
                      duration: slowHeroMotion(
                        HEADLINE_WORD_TRANSITION_SECONDS,
                      ),
                      ease: "easeInOut",
                    }}
                    className="inline-block gradient-text"
                  >
                    {ROTATING_WORDS[wordIndex]}
                  </motion.span>
                </AnimatePresence>
              </motion.span>
            </motion.span>
          </h1>

          <p className="mb-2 inline-flex items-center gap-3 text-xl font-medium text-text-primary sm:mb-3 sm:text-2xl">
            <FaFacebook className="shrink-0 text-[var(--theme-media-icon)]" />
            <FaInstagram className="shrink-0 text-[var(--theme-media-icon)]" />
            <FaXTwitter className="shrink-0 text-[var(--theme-media-icon)]" />
            <FaRss className="shrink-0 text-[var(--theme-media-icon)]" />
            <span>in one local app.</span>
          </p>

          <p className="max-w-xl mx-auto text-base text-text-secondary sm:text-lg">
            Mental sovereignty. Digital dignity. Your feed, your rules. Torch
            the ads, tune your algo, and connect IRL with a live map of your
            people.
          </p>

          <div className="mx-auto w-fit max-w-full">
          <div className="demo-action-pair mx-auto mt-4 sm:mt-5 w-fit text-base sm:text-lg">
            <DemoLink className="demo-action gap-2">
              <FaPlay aria-hidden="true" className="h-3 w-3 shrink-0" />
              Live demo
            </DemoLink>
            <Link href="/changelog" className="demo-action gap-2">
                Latest Updates
                <FaWaveSquare aria-hidden="true" className="h-3.5 w-3.5 shrink-0" />
            </Link>
          </div>

          </div>
        </motion.div>
      </div>

    </section>
  );
}
