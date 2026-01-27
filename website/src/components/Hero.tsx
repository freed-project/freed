import { motion, AnimatePresence } from "framer-motion";
import { Link } from "react-router-dom";
import { useState, useEffect } from "react";
import HeroAnimation from "./HeroAnimation";
import { useNewsletter } from "../context/NewsletterContext";

const ROTATING_WORDS = ["Feed", "Life", "Mind"];

export default function Hero() {
  const { openModal } = useNewsletter();
  const [wordIndex, setWordIndex] = useState(0);

  useEffect(() => {
    const interval = setInterval(() => {
      setWordIndex((prev) => (prev + 1) % ROTATING_WORDS.length);
    }, 6000);
    return () => clearInterval(interval);
  }, []);

  return (
    <section className="relative min-h-screen flex items-center justify-center px-4 sm:px-6 md:px-12 lg:px-8 pt-24 pb-16 md:pt-20">
      {/* Open Source badge - aligned with nav container right edge, hidden on mobile */}
      <div className="hidden lg:block absolute top-20 left-0 right-0 mt-4 px-4 sm:px-6 md:px-12 lg:px-8">
        <div className="max-w-7xl mx-auto flex justify-end">
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.3 }}
          >
            <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full border border-freed-border bg-freed-surface/50">
              <span className="w-2 h-2 rounded-full bg-glow-purple animate-pulse" />
              <span className="text-sm text-text-secondary">
                Open Source & Free Forever
              </span>
            </div>
          </motion.div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto grid grid-cols-1 lg:grid-cols-[1fr_1.3fr] gap-8 lg:gap-8 items-center">
        {/* Animation - shows first on mobile */}
        <motion.div
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.8, delay: 0.2 }}
          className="relative order-1 lg:order-2 max-w-xs sm:max-w-sm mx-auto lg:max-w-none lg:scale-110 lg:origin-center"
        >
          <HeroAnimation />
        </motion.div>

        {/* Text Content */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, delay: 0.3 }}
          className="order-2 lg:order-1 text-center lg:text-left"
        >
          <h1 className="text-4xl sm:text-5xl md:text-6xl lg:text-7xl font-bold leading-tight mb-4 sm:mb-6">
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
                  transition={{ duration: 0.5, ease: "easeInOut" }}
                  className="inline-block gradient-text"
                >
                  {ROTATING_WORDS[wordIndex]}
                </motion.span>
              </AnimatePresence>
            </span>
          </h1>

          <p className="text-lg sm:text-xl md:text-2xl text-text-primary font-medium mb-3 sm:mb-4">
            The platforms built empires on your attention. You walked out the
            door.
          </p>

          <p className="text-base sm:text-lg text-text-secondary max-w-xl mx-auto lg:mx-0 mb-6 sm:mb-8">
            Mental sovereignty. Digital dignity. Your feed, your rules. Torch
            the ads, tune your algo, and connect IRL with a live map of your
            peeps.
          </p>

          <div className="flex flex-col sm:flex-row flex-wrap gap-3 sm:gap-4 justify-center lg:justify-start">
            <motion.button
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
              onClick={openModal}
              className="btn-primary text-base px-8 py-3 w-full sm:w-auto"
            >
              Get FREED
            </motion.button>

            <Link to="/manifesto" className="w-full sm:w-auto">
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
          <div className="flex justify-center lg:justify-start gap-6 sm:gap-8 mt-8 sm:mt-12 pt-6 sm:pt-8 border-t border-freed-border">
            <div className="text-center lg:text-left">
              <p className="text-2xl sm:text-3xl font-bold text-text-primary">
                100%
              </p>
              <p className="text-xs sm:text-sm text-text-secondary">
                Local Storage
              </p>
            </div>
            <div className="text-center lg:text-left">
              <p className="text-2xl sm:text-3xl font-bold text-text-primary">
                0
              </p>
              <p className="text-xs sm:text-sm text-text-secondary">
                Data Collected
              </p>
            </div>
            <div className="text-center lg:text-left">
              <p className="text-2xl sm:text-3xl font-bold text-text-primary">
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
        transition={{ delay: 1.5 }}
        className="hidden lg:block absolute bottom-8 left-1/2 -translate-x-1/2"
      >
        <motion.div
          animate={{ y: [0, 8, 0] }}
          transition={{ duration: 1.5, repeat: Infinity }}
          className="w-6 h-10 rounded-full border-2 border-text-muted flex items-start justify-center p-2"
        >
          <div className="w-1 h-2 rounded-full bg-text-muted" />
        </motion.div>
      </motion.div>
    </section>
  );
}
