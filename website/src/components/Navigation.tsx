"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import { useState, useEffect, useRef, useLayoutEffect } from "react";
import { Tooltip } from "@freed/ui/components/Tooltip";
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
  { path: "/changelog", label: "Changelog" },
  { path: "/updates", label: "Updates" },
];

function isActive(itemPath: string, pathname: string): boolean {
  if (itemPath === "/") return pathname === "/";
  return pathname === itemPath || pathname.startsWith(itemPath + "/");
}

export default function Navigation() {
  const pathname = usePathname();
  const { openModal } = useNewsletter();
  const [captionIndex, setCaptionIndex] = useState(0);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const [homePageScrolledPastFold, setHomePageScrolledPastFold] = useState(false);
  const [mobileMenuTopOffset, setMobileMenuTopOffset] = useState(64);
  const navRefs = useRef<(HTMLAnchorElement | null)[]>([]);
  const mobileTopBarRef = useRef<HTMLDivElement | null>(null);
  const [underlineStyle, setUnderlineStyle] = useState({ left: 0, width: 0 });
  const showMobileTopCta =
    !mobileMenuOpen && (pathname !== "/" || homePageScrolledPastFold);

  useEffect(() => {
    const handleScroll = () => {
      setScrolled(window.scrollY > 20);
      setHomePageScrolledPastFold(window.scrollY > window.innerHeight);
    };
    handleScroll(); // Check initial position
    window.addEventListener("scroll", handleScroll, { passive: true });
    window.addEventListener("resize", handleScroll);
    return () => {
      window.removeEventListener("scroll", handleScroll);
      window.removeEventListener("resize", handleScroll);
    };
  }, [pathname]);

  // Update underline position when pathname changes
  useLayoutEffect(() => {
    const activeIndex = NAV_ITEMS.findIndex((item) => isActive(item.path, pathname));
    if (activeIndex === -1) {
      setUnderlineStyle({ left: 0, width: 0 });
      return;
    }
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

  useLayoutEffect(() => {
    const updateMobileTopOffset = () => {
      if (!mobileTopBarRef.current) return;
      const { height } = mobileTopBarRef.current.getBoundingClientRect();
      setMobileMenuTopOffset(Math.max(0, Math.ceil(height)));
    };

    updateMobileTopOffset();
    window.addEventListener("resize", updateMobileTopOffset);

    const observer = new ResizeObserver(updateMobileTopOffset);
    if (mobileTopBarRef.current) {
      observer.observe(mobileTopBarRef.current);
    }

    return () => {
      observer.disconnect();
      window.removeEventListener("resize", updateMobileTopOffset);
    };
  }, []);

  const handleMouseEnter = () => {
    setCaptionIndex((prev) => (prev + 1) % WTF_CAPTIONS.length);
  };

  const logoElement = (
    <Tooltip side="bottom" label={WTF_CAPTIONS[captionIndex]}>
      <Link
        href="/"
        className="flex items-baseline gap-0.5 group relative"
        onMouseEnter={handleMouseEnter}
        onFocus={handleMouseEnter}
      >
        <span className="relative text-xl sm:text-2xl font-bold text-text-primary font-logo">
          FREED
          <span
            className="absolute bottom-0 left-0 right-0 h-0.5 rounded-full"
            style={{
              background: "var(--theme-logo-spectrum)",
            }}
          />
        </span>
        <span className="text-sm sm:text-base font-bold gradient-text relative font-logo">
          .WTF
        </span>
      </Link>
    </Tooltip>
  );

  const desktopLinks = (
    <div className="hidden lg:flex items-center gap-8 relative">
      {NAV_ITEMS.map((item, index) => (
        <Link
          key={item.path}
          href={item.path}
          ref={(el) => {
            navRefs.current[index] = el;
          }}
          className={`text-sm font-medium transition-colors ${
            isActive(item.path, pathname)
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

      <button onClick={() => openModal()} className="btn-primary text-sm !py-2">
        Get Freed
      </button>
    </div>
  );

  const mobileHamburger = (
    <button
      onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
      className="lg:hidden relative w-8 h-8 flex items-center justify-center"
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
      {/* iOS/macOS overscroll shield: extends nav background above viewport so rubber-band
          bounce doesn't reveal a gap above the mobile nav bar. Height of 200px covers any
          realistic overscroll. Desktop nav is a floating pill so doesn't need this. */}
      <div
        className="lg:hidden fixed left-0 right-0 bg-freed-black z-40 pointer-events-none"
        style={{ top: "-200px", height: "200px" }}
        aria-hidden="true"
      />

      {/* Desktop: Top blur overlay - blurs and darkens content as it approaches the top of viewport */}
      <div
        className="hidden lg:block fixed top-0 left-0 right-0 h-32 pointer-events-none z-40"
        style={{
          backdropFilter: "blur(20px)",
          WebkitBackdropFilter: "blur(20px)",
          maskImage:
            "linear-gradient(to bottom, var(--theme-bg-root) 0%, var(--theme-bg-root) 50%, transparent 100%)",
          WebkitMaskImage:
            "linear-gradient(to bottom, var(--theme-bg-root) 0%, var(--theme-bg-root) 50%, transparent 100%)",
          background:
            "linear-gradient(to bottom, color-mix(in oklab, var(--theme-bg-root) 78%, transparent) 0%, color-mix(in oklab, var(--theme-bg-root) 42%, transparent) 50%, transparent 100%)",
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
        <div
          ref={mobileTopBarRef}
          className={`lg:hidden bg-freed-black pl-8 pr-4 py-3 ${
            mobileMenuOpen ? "" : "border-b border-freed-border"
          }`}
        >
          <div className="flex items-center justify-between">
            {logoElement}
            <div className="flex items-center gap-3">
              <AnimatePresence initial={false}>
                {showMobileTopCta && (
                  <motion.div
                    key="mobile-top-cta"
                    initial={{ width: 0 }}
                    animate={{ width: "auto" }}
                    exit={{ width: 0 }}
                    transition={{ duration: 0.2, ease: "easeInOut" }}
                    className="overflow-hidden pr-4"
                    style={{
                      WebkitMaskImage:
                        "linear-gradient(to right, black 0, black calc(100% - 18px), transparent 100%)",
                      maskImage:
                        "linear-gradient(to right, black 0, black calc(100% - 18px), transparent 100%)",
                    }}
                  >
                    <motion.button
                      onClick={() => openModal()}
                      initial={{ opacity: 0, x: 8 }}
                      animate={{ opacity: 1, x: 0 }}
                      exit={{ opacity: 0, x: 8 }}
                      transition={{ duration: 0.2, ease: "easeInOut" }}
                      className="btn-primary nav-mobile-cta my-0 shrink-0 whitespace-nowrap text-[0.765rem]"
                    >
                      Get Freed
                    </motion.button>
                  </motion.div>
                )}
              </AnimatePresence>
              {mobileHamburger}
            </div>
          </div>
        </div>

        {/* Desktop: floating pill navbar */}
        <div className="hidden lg:block px-4 py-4">
          <div
            className={`max-w-[calc(72rem+2rem)] mx-auto px-4 py-[13px] rounded-2xl border transition-all duration-300 ${
              scrolled ? "theme-topbar" : "bg-transparent border-transparent shadow-none"
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
              className="lg:hidden fixed left-0 right-0 bottom-0 bg-freed-black z-40"
              style={{
                // Overlap navbar by 1px to eliminate sub-pixel rendering gaps
                top: `calc(${Math.max(0, mobileMenuTopOffset - 1)}px + env(safe-area-inset-top))`,
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
                      className={`text-[1.238rem] font-medium transition-colors ${
                        isActive(item.path, pathname)
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
                  className="text-[1.238rem] font-medium text-text-secondary"
                >
                  GitHub
                </motion.a>
                <motion.button
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.22, duration: 0.15 }}
                  onClick={() => {
                    openModal();
                    setMobileMenuOpen(false);
                  }}
                  className="btn-primary text-[1.0125rem] px-12 py-4 mt-4"
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
