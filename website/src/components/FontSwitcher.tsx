"use client";

import { useState, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";

const FONTS = [
  {
    id: "system",
    name: "System (SF/Segoe)",
    family:
      "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
    description: "Native OS font. Zero load time.",
  },
  {
    id: "inter",
    name: "Inter",
    family: "'Inter', system-ui, sans-serif",
    googleFont: "Inter:wght@400;500;600;700",
    description: "Clean, neutral. The SaaS default.",
  },
  {
    id: "space-grotesk",
    name: "Space Grotesk",
    family: "'Space Grotesk', system-ui, sans-serif",
    googleFont: "Space+Grotesk:wght@400;500;600;700",
    description: "Geometric, rebellious. Has opinions.",
  },
  {
    id: "manrope",
    name: "Manrope",
    family: "'Manrope', system-ui, sans-serif",
    googleFont: "Manrope:wght@400;500;600;700",
    description: "Geometric, slightly quirky.",
  },
  {
    id: "geist",
    name: "Geist",
    family: "'Geist', system-ui, sans-serif",
    googleFont: "Geist:wght@400;500;600;700",
    description: "Modern, sharp. Vercel's font.",
  },
  {
    id: "ibm-plex",
    name: "IBM Plex Sans",
    family: "'IBM Plex Sans', system-ui, sans-serif",
    googleFont: "IBM+Plex+Sans:wght@400;500;600;700",
    description: "Industrial, serious. Great i18n.",
  },
];

// Get initial font from localStorage (client-side only)
function getInitialFont(): string {
  if (typeof window === "undefined") return "inter";
  const saved = localStorage.getItem("freed-font");
  if (saved && FONTS.find((f) => f.id === saved)) {
    return saved;
  }
  return "inter";
}

export default function FontSwitcher() {
  const [isOpen, setIsOpen] = useState(false);
  const [activeFont, setActiveFont] = useState("inter");
  const [fontsLoaded, setFontsLoaded] = useState(false);
  const [mounted, setMounted] = useState(false);

  // Handle mounting and load saved preference
  useEffect(() => {
    setMounted(true);
    const saved = getInitialFont();
    if (saved !== "inter") {
      setActiveFont(saved);
    }
  }, []);

  // Load Google Fonts
  useEffect(() => {
    if (!mounted) return;

    const googleFonts = FONTS.filter((f) => f.googleFont)
      .map((f) => f.googleFont)
      .join("&family=");

    const link = document.createElement("link");
    link.href = `https://fonts.googleapis.com/css2?family=${googleFonts}&display=swap`;
    link.rel = "stylesheet";
    document.head.appendChild(link);

    link.onload = () => setFontsLoaded(true);

    return () => {
      if (document.head.contains(link)) {
        document.head.removeChild(link);
      }
    };
  }, [mounted]);

  // Apply font to body
  useEffect(() => {
    if (!mounted) return;

    const font = FONTS.find((f) => f.id === activeFont);
    if (font) {
      document.body.style.fontFamily = font.family;
      localStorage.setItem("freed-font", activeFont);
    }
  }, [activeFont, mounted]);

  const handleFontChange = useCallback((fontId: string) => {
    setActiveFont(fontId);
  }, []);

  const currentFont = FONTS.find((f) => f.id === activeFont);

  // Don't render the full UI until mounted (avoid hydration mismatch)
  // But always render a placeholder to confirm component is in DOM
  if (!mounted) {
    return (
      <div
        id="font-switcher-loading"
        className="fixed bottom-6 right-6 z-[1100] w-12 h-12 rounded-full bg-gray-500 animate-pulse"
      />
    );
  }

  return (
    <>
      {/* Floating toggle button */}
      <motion.button
        onClick={() => setIsOpen(!isOpen)}
        className="fixed bottom-6 right-6 z-[1100] w-12 h-12 rounded-full bg-glow-purple text-white shadow-lg flex items-center justify-center hover:bg-glow-blue transition-colors"
        whileHover={{ scale: 1.1 }}
        whileTap={{ scale: 0.95 }}
        aria-label="Toggle font switcher"
      >
        <svg
          className="w-6 h-6"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M4 6h16M4 12h16m-7 6h7"
          />
        </svg>
      </motion.button>

      {/* Font picker panel */}
      <AnimatePresence>
        {isOpen && (
          <>
            {/* Backdrop */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setIsOpen(false)}
              className="fixed inset-0 bg-black/40 z-[1050]"
            />

            {/* Panel */}
            <motion.div
              initial={{ opacity: 0, y: 20, scale: 0.95 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 20, scale: 0.95 }}
              className="fixed bottom-24 right-6 z-[1100] w-80 glass-card p-4 rounded-xl shadow-2xl"
            >
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-bold text-text-primary">
                  Font Comparison
                </h3>
                <span className="text-xs text-text-muted">
                  {fontsLoaded ? "✓ Loaded" : "Loading..."}
                </span>
              </div>

              <p className="text-xs text-text-secondary mb-4">
                Current:{" "}
                <span className="text-glow-purple font-medium">
                  {currentFont?.name}
                </span>
              </p>

              <div className="space-y-2">
                {FONTS.map((font) => (
                  <button
                    key={font.id}
                    onClick={() => handleFontChange(font.id)}
                    className={`w-full text-left p-3 rounded-lg transition-all ${
                      activeFont === font.id
                        ? "bg-glow-purple/20 border border-glow-purple/50"
                        : "bg-freed-surface/50 border border-freed-border hover:border-glow-purple/30"
                    }`}
                  >
                    <div
                      className="font-semibold text-text-primary mb-1"
                      style={{ fontFamily: font.family }}
                    >
                      {font.name}
                    </div>
                    <div className="text-xs text-text-muted">
                      {font.description}
                    </div>
                    <div
                      className="text-sm text-text-secondary mt-2"
                      style={{ fontFamily: font.family }}
                    >
                      The quick brown fox jumps over the lazy dog.
                    </div>
                  </button>
                ))}
              </div>

              <div className="mt-4 pt-4 border-t border-freed-border">
                <p className="text-xs text-text-muted text-center">
                  Selection persists in localStorage
                </p>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </>
  );
}
