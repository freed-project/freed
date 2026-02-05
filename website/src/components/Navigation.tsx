"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import { useState, useEffect, useRef, useLayoutEffect } from "react";
import { useNewsletter } from "@/context/NewsletterContext";

const WTF_CAPTIONS = [
  // Core brand
  "What They Fear",
  "Why Trust Facebook?",
  "Where's The Friend?",
  "Without Their Filters",
  // Rebellion
  "Watch Them Flounder",
  "Witness The Fall",
  // Empowerment
  "Write The Future",
  "Win Through Focus",
  "Wield True Freedom",
  "We Think Freely",
  "Worth The Fight",
  "Will To Freedom",
  // Pointed critique
  "Where's The Filter?",
  "Without Their Facade",
  // Philosophical
  "Where Truth Frees",
  "Where Thoughts Flow",
  "Wisdom Trumps Fear",
  "Witness True Freedom",
  // Declarative
  "We're The Future",
  "Wage Total Freedom",
  "Win The Future",
  "Without Their Footprint",
];

const NAV_ITEMS = [
  { path: "/", label: "Home" },
  { path: "/manifesto", label: "Manifesto" },
  { path: "/roadmap", label: "Roadmap" },
  { path: "/updates", label: "Updates" },
];

export default function Navigation() {
  const pathname = usePathname();
  const { openModal } = useNewsletter();
  const [captionIndex, setCaptionIndex] = useState(0);
  const [isHovering, setIsHovering] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const navRefs = useRef<(HTMLAnchorElement | null)[]>([]);
  const [underlineStyle, setUnderlineStyle] = useState({ left: 0, width: 0 });

  useEffect(() => {
    const handleScroll = () => {
      setScrolled(window.scrollY > 20);
    };
    handleScroll(); // Check initial position
    window.addEventListener("scroll", handleScroll, { passive: true });
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  // Update underline position when pathname changes
  useLayoutEffect(() => {
    const activeIndex = NAV_ITEMS.findIndex((item) => item.path === pathname);
    const activeRef = navRefs.current[activeIndex];
    if (activeRef) {
      const parent = activeRef.parentElement;
      if (parent) {
        const parentRect = parent.getBoundingClientRect();
        const activeRect = activeRef.getBoundingClientRect();
        setUnderlineStyle({
          left: activeRect.left - parentRect.left,
          width: activeRect.width,
        });
      }
    }
  }, [pathname]);

  // Lock body scroll when mobile menu is open
  useEffect(() => {
    if (mobileMenuOpen) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }
    return () => {
      document.body.style.overflow = "";
    };
  }, [mobileMenuOpen]);

  const handleMouseEnter = () => {
    setCaptionIndex((prev) => (prev + 1) % WTF_CAPTIONS.length);
    setIsHovering(true);
  };

  const logoElement = (
    <Link
      href="/"
      className="flex items-baseline gap-0.5 group relative"
      onMouseEnter={handleMouseEnter}
      onMouseLeave={() => setIsHovering(false)}
    >
      <span className="relative text-xl sm:text-2xl font-bold text-text-primary font-logo">
        FREED
        <span
          className="absolute bottom-0 left-0 right-0 h-0.5 rounded-full"
          style={{
            background:
              "linear-gradient(to right, #ef4444, #f97316, #eab308, #22c55e, #3b82f6, #8b5cf6, #ec4899)",
          }}
        />
      </span>
      <span className="text-sm sm:text-base font-bold gradient-text relative font-logo">
        .WTF
      </span>

      {/* WTF caption tooltip - changes on each hover, hidden on mobile */}
      {isHovering && (
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="hidden sm:block absolute top-full left-1/2 -translate-x-1/2 mt-3 px-3 py-1.5 rounded-lg bg-freed-surface border border-freed-border whitespace-nowrap"
        >
          {/* Tooltip tail */}
          <div className="absolute -top-[7px] left-1/2 -translate-x-1/2 w-3 h-3 bg-freed-surface border-l border-t border-freed-border rotate-45" />
          <span className="relative text-sm text-text-secondary">
            {WTF_CAPTIONS[captionIndex]}
          </span>
        </motion.div>
      )}
    </Link>
  );

  const desktopLinks = (
    <div className="hidden md:flex items-center gap-8 relative">
      {NAV_ITEMS.map((item, index) => (
        <Link
          key={item.path}
          href={item.path}
          ref={(el) => {
            navRefs.current[index] = el;
          }}
          className={`text-sm font-medium transition-colors ${
            pathname === item.path
              ? "text-text-primary"
              : "text-text-secondary hover:text-text-primary"
          }`}
        >
          {item.label}
        </Link>
      ))}
      {/* Sliding underline - only animates horizontally */}
      {underlineStyle.width > 0 && (
        <motion.span
          className="absolute -bottom-0.5 h-px bg-text-primary pointer-events-none"
          initial={false}
          animate={{ left: underlineStyle.left, width: underlineStyle.width }}
          transition={{ type: "spring", stiffness: 500, damping: 30 }}
        />
      )}

      <a
        href="https://github.com/freed-project/freed"
        target="_blank"
        rel="noopener noreferrer"
        className="text-sm font-medium text-text-secondary hover:text-text-primary transition-colors"
      >
        GitHub
      </a>

      <button onClick={openModal} className="btn-primary text-sm !py-2">
        Get Freed
      </button>
    </div>
  );

  const mobileHamburger = (
    <button
      onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
      className="md:hidden relative w-8 h-8 flex items-center justify-center"
      aria-label="Toggle menu"
    >
      <motion.span
        animate={{
          rotate: mobileMenuOpen ? 45 : 0,
          y: mobileMenuOpen ? 0 : -6,
        }}
        transition={{ duration: 0.2 }}
        className="absolute w-6 h-0.5 bg-text-primary rounded-full origin-center"
      />
      <motion.span
        animate={{
          opacity: mobileMenuOpen ? 0 : 1,
          scaleX: mobileMenuOpen ? 0 : 1,
        }}
        transition={{ duration: 0.2 }}
        className="absolute w-6 h-0.5 bg-text-primary rounded-full"
      />
      <motion.span
        animate={{
          rotate: mobileMenuOpen ? -45 : 0,
          y: mobileMenuOpen ? 0 : 6,
        }}
        transition={{ duration: 0.2 }}
        className="absolute w-6 h-0.5 bg-text-primary rounded-full origin-center"
      />
    </button>
  );

  return (
    <>
      {/* Desktop: Top blur overlay - blurs and darkens content as it approaches the top of viewport */}
      <div
        className="hidden md:block fixed top-0 left-0 right-0 h-32 pointer-events-none z-40"
        style={{
          backdropFilter: "blur(20px)",
          WebkitBackdropFilter: "blur(20px)",
          maskImage:
            "linear-gradient(to bottom, black 0%, black 50%, transparent 100%)",
          WebkitMaskImage:
            "linear-gradient(to bottom, black 0%, black 50%, transparent 100%)",
          background:
            "linear-gradient(to bottom, rgba(10, 10, 10, 0.8) 0%, rgba(10, 10, 10, 0.4) 50%, transparent 100%)",
        }}
        aria-hidden="true"
      />

      <motion.nav
        aria-label="Main navigation"
        initial={{ y: -20, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ duration: 0.5 }}
        className="fixed top-0 left-0 right-0 z-50"
        style={{ paddingTop: "env(safe-area-inset-top)" }}
      >
        {/* Mobile: solid full-width bar */}
        <div className="md:hidden bg-freed-black border-b border-freed-border px-4 py-4">
          <div className="flex items-center justify-between">
            {logoElement}
            {mobileHamburger}
          </div>
        </div>

        {/* Desktop: floating pill navbar */}
        <div className="hidden md:block px-4 py-4">
          <div
            className={`max-w-[calc(72rem+2rem)] mx-auto px-4 py-[13px] rounded-2xl border transition-all duration-300 ${
              scrolled
                ? "bg-freed-black/70 border-freed-border shadow-[0_4px_30px_rgba(0,0,0,0.5)]"
                : "bg-transparent border-transparent"
            }`}
          >
            <div className="max-w-6xl mx-auto flex items-center justify-between">
              {logoElement}
              {desktopLinks}
            </div>
          </div>
        </div>

        {/* Mobile Menu - Full Screen */}
        <AnimatePresence>
          {mobileMenuOpen && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="md:hidden fixed left-0 right-0 bottom-0 bg-freed-black z-40"
              style={{
                top: "calc(65px + env(safe-area-inset-top))",
                paddingBottom: "env(safe-area-inset-bottom)",
              }}
            >
              <div className="h-full flex flex-col justify-center items-center gap-8 px-6">
                {NAV_ITEMS.map((item, index) => (
                  <motion.div
                    key={item.path}
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: index * 0.05, duration: 0.15 }}
                  >
                    <Link
                      href={item.path}
                      onClick={() => setMobileMenuOpen(false)}
                      className={`text-2xl font-medium transition-colors ${
                        pathname === item.path
                          ? "text-text-primary underline underline-offset-8 decoration-2"
                          : "text-text-secondary"
                      }`}
                    >
                      {item.label}
                    </Link>
                  </motion.div>
                ))}

                <motion.a
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.2, duration: 0.15 }}
                  href="https://github.com/freed-project/freed"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-2xl font-medium text-text-secondary"
                >
                  GitHub
                </motion.a>

                <motion.button
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.25, duration: 0.15 }}
                  onClick={() => {
                    openModal();
                    setMobileMenuOpen(false);
                  }}
                  className="btn-primary text-lg px-12 py-4 mt-4"
                >
                  Get Freed
                </motion.button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.nav>
    </>
  );
}
