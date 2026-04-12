"use client";

import { motion, AnimatePresence } from "framer-motion";
import Link from "next/link";
import { useState, useEffect } from "react";
import { FaXTwitter, FaInstagram, FaFacebook, FaRss } from "react-icons/fa6";
import HeroAnimation from "./HeroAnimation";
import { useNewsletter } from "@/context/NewsletterContext";
import { slowHeroMotion, slowHeroDelay, slowHeroInterval } from "@/lib/motion";

const ROTATING_WORDS = ["Feed", "Life", "Mind"];

export default function Hero() {
  const { openModal } = useNewsletter();
  const [wordIndex, setWordIndex] = useState(0);
  const [compactHeroAnimation, setCompactHeroAnimation] = useState(false);

  useEffect(() => {
    const interval = setInterval(() => {
      setWordIndex((prev) => (prev + 1) % ROTATING_WORDS.length);
    }, slowHeroInterval(6000));
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    const mediaQuery = window.matchMedia("(max-width: 639px)");
    const updateCompactHero = () => setCompactHeroAnimation(mediaQuery.matches);
    updateCompactHero();
    mediaQuery.addEventListener("change", updateCompactHero);
    return () => mediaQuery.removeEventListener("change", updateCompactHero);
  }, []);

  return (
    <section className="relative min-h-viewport-safe flex items-start justify-center px-8 sm:px-6 pb-8 pt-24 sm:pb-16 md:pt-[clamp(7rem,_25vh,_50rem)]">
      {/* Open Source badge - aligned with nav container right edge, hidden on mobile */}
      <div className="hidden lg:block absolute top-20 left-0 right-0 mt-4 px-4 sm:px-6">
        <div className="max-w-6xl mx-auto flex justify-end">
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{
              duration: slowHeroMotion(0.5),
              delay: slowHeroDelay(0.3),
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
            delay: slowHeroDelay(0.2),
          }}
          className="relative order-1 w-full lg:order-2"
          style={{
            maxWidth: compactHeroAnimation ? "212px" : "425px",
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
            duration: slowHeroMotion(0.8),
            delay: slowHeroDelay(0.3),
          }}
          className="order-2 text-center lg:order-1 lg:pl-10 lg:text-left"
        >
          <h1 className="theme-display-large mb-6 text-4xl font-bold leading-[1.05] sm:mb-12 sm:text-5xl md:text-6xl lg:-ml-2 lg:text-7xl">
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

          <div className="flex flex-col flex-wrap justify-center gap-3 sm:flex-row sm:gap-4 lg:justify-start">
            <motion.button
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.98 }}
              onClick={openModal}
              className="btn-primary text-base px-8 py-3 w-full sm:w-auto"
            >
              Get Freed
            </motion.button>

            <Link href="/manifesto" className="w-full sm:w-auto">
              <motion.button
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
                className="btn-secondary hero-manifesto-button text-base px-8 py-3 w-full"
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
