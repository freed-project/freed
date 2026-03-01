"use client";

import { useState, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";

type Platform = "mac-arm" | "mac-intel" | "windows" | "linux" | "unknown";

const GITHUB_RELEASE =
  "https://github.com/freed-project/freed/releases/latest";

const PLATFORM_CONFIG: Record<
  Exclude<Platform, "unknown">,
  { label: string; icon: string; suffix: string }
> = {
  "mac-arm": {
    label: "Mac (Apple Silicon)",
    icon: "\uF8FF",
    suffix: "_aarch64.dmg",
  },
  "mac-intel": {
    label: "Mac (Intel)",
    icon: "\uF8FF",
    suffix: "_x64.dmg",
  },
  windows: {
    label: "Windows",
    icon: "⊞",
    suffix: "_x64-setup.exe",
  },
  linux: {
    label: "Linux",
    icon: "🐧",
    suffix: "_amd64.AppImage",
  },
};

function detectPlatform(): Platform {
  if (typeof navigator === "undefined") return "unknown";
  const ua = navigator.userAgent.toLowerCase();

  if (ua.includes("mac")) {
    // Apple Silicon detection via WebGL renderer or platform heuristics
    try {
      const canvas = document.createElement("canvas");
      const gl = canvas.getContext("webgl");
      if (gl) {
        const ext = gl.getExtension("WEBGL_debug_renderer_info");
        if (ext) {
          const renderer = gl.getParameter(ext.UNMASKED_RENDERER_WEBGL);
          if (renderer.toLowerCase().includes("apple")) return "mac-arm";
        }
      }
    } catch {
      // Fall through
    }
    return "mac-arm"; // Default to ARM for modern Macs
  }
  if (ua.includes("win")) return "windows";
  if (ua.includes("linux")) return "linux";
  return "unknown";
}

interface DownloadButtonProps {
  className?: string;
  size?: "default" | "large";
}

export default function DownloadButton({
  className = "",
  size = "default",
}: DownloadButtonProps) {
  const [platform, setPlatform] = useState<Platform>("unknown");
  const [menuOpen, setMenuOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setPlatform(detectPlatform());
  }, []);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const primaryPlatform = platform === "unknown" ? "mac-arm" : platform;
  const primaryConfig = PLATFORM_CONFIG[primaryPlatform];
  const otherPlatforms = (
    Object.keys(PLATFORM_CONFIG) as Exclude<Platform, "unknown">[]
  ).filter((p) => p !== primaryPlatform);

  const sizeClasses =
    size === "large" ? "text-lg px-10 py-4" : "text-base px-8 py-3";

  return (
    <div ref={ref} className={`relative inline-block ${className}`}>
      <div className="flex">
        <motion.a
          href={GITHUB_RELEASE}
          target="_blank"
          rel="noopener noreferrer"
          whileHover={{ scale: 1.02 }}
          whileTap={{ scale: 0.98 }}
          className={`btn-primary ${sizeClasses} rounded-r-none border-r border-white/20`}
        >
          Download for {primaryConfig.label}
        </motion.a>

        <motion.button
          whileHover={{ scale: 1.02 }}
          whileTap={{ scale: 0.98 }}
          onClick={() => setMenuOpen(!menuOpen)}
          className={`btn-primary px-3 ${size === "large" ? "py-4" : "py-3"} rounded-l-none`}
          aria-label="Other platforms"
        >
          <svg
            width="12"
            height="12"
            viewBox="0 0 12 12"
            fill="none"
            className={`transition-transform ${menuOpen ? "rotate-180" : ""}`}
          >
            <path
              d="M2 4l4 4 4-4"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </motion.button>
      </div>

      <AnimatePresence>
        {menuOpen && (
          <motion.div
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.15 }}
            className="absolute top-full mt-2 right-0 min-w-[220px] rounded-xl border border-freed-border bg-freed-surface/95 backdrop-blur-xl shadow-[0_8px_30px_rgba(0,0,0,0.5)] overflow-hidden z-50"
          >
            {otherPlatforms.map((p) => (
              <a
                key={p}
                href={GITHUB_RELEASE}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-3 px-4 py-3 text-sm text-text-secondary hover:text-text-primary hover:bg-white/5 transition-colors"
                onClick={() => setMenuOpen(false)}
              >
                <span className="w-5 text-center">{PLATFORM_CONFIG[p].icon}</span>
                {PLATFORM_CONFIG[p].label}
              </a>
            ))}
            <div className="border-t border-freed-border" />
            <a
              href="https://app.freed.wtf"
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-3 px-4 py-3 text-sm text-text-secondary hover:text-text-primary hover:bg-white/5 transition-colors"
              onClick={() => setMenuOpen(false)}
            >
              <span className="w-5 text-center">🌐</span>
              Try the Web App
            </a>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
