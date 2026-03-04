"use client";

import { useRef, useState, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  useFloating,
  useClientPoint,
  useInteractions,
  useHover,
  offset,
  shift,
  arrow,
  FloatingArrow,
} from "@floating-ui/react";
import { useNewsletter } from "@/context/NewsletterContext";

type SubmitState = "idle" | "loading" | "success" | "error";

const RELEASE_BASE = "https://github.com/freed-project/freed/releases/latest/download";

type DownloadKey = "mac-arm" | "mac-intel" | "windows" | "linux";

const DOWNLOADS: Record<DownloadKey, { label: string; file: string }> = {
  "mac-arm": {
    label: "macOS (Apple Silicon)",
    file: "Freed-macOS-arm64.dmg",
  },
  "mac-intel": {
    label: "macOS (Intel)",
    file: "Freed-macOS-x64.dmg",
  },
  windows: {
    label: "Windows",
    file: "Freed-Windows-x64-setup.exe",
  },
  linux: {
    label: "Linux",
    file: "Freed-Linux-x64.AppImage",
  },
};

function detectDownloadKey(): DownloadKey {
  if (typeof navigator === "undefined") return "mac-arm";
  const ua = navigator.userAgent.toLowerCase();

  if (ua.includes("win")) return "windows";
  if (ua.includes("linux")) return "linux";

  if (ua.includes("mac")) {
    // Post-2020 Macs are overwhelmingly ARM. WebGL renderer can confirm:
    // Apple GPU = Apple Silicon, Intel HD/Iris = Intel.
    try {
      const canvas = document.createElement("canvas");
      const gl =
        canvas.getContext("webgl2") || canvas.getContext("webgl");
      if (gl) {
        const dbg = gl.getExtension("WEBGL_debug_renderer_info");
        if (dbg) {
          const renderer = gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL);
          if (/intel/i.test(renderer)) return "mac-intel";
        }
      }
    } catch {
      // WebGL unavailable — fall through to ARM default
    }
    return "mac-arm";
  }

  return "mac-arm";
}

export default function NewsletterModal() {
  const { isOpen, closeModal } = useNewsletter();
  const [email, setEmail] = useState("");
  const [state, setState] = useState<SubmitState>("idle");
  const [errorMessage, setErrorMessage] = useState("");
  const [selectedPlatform, setSelectedPlatform] =
    useState<DownloadKey>("mac-arm");
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [isTooltipOpen, setIsTooltipOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const arrowRef = useRef(null);

  const { refs, floatingStyles, context: floatingCtx } = useFloating({
    open: isTooltipOpen,
    onOpenChange: setIsTooltipOpen,
    placement: "top",
    middleware: [
      offset(12),
      shift({ padding: 8 }),
      arrow({ element: arrowRef }),
    ],
  });

  const clientPoint = useClientPoint(floatingCtx);
  const hover = useHover(floatingCtx);
  const { getReferenceProps, getFloatingProps } = useInteractions([
    clientPoint,
    hover,
  ]);

  useEffect(() => {
    setSelectedPlatform(detectDownloadKey());
  }, []);

  // Close dropdown on outside click
  useEffect(() => {
    if (!dropdownOpen) return;
    const handler = (e: MouseEvent) => {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(e.target as Node)
      ) {
        setDropdownOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [dropdownOpen]);

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      if (!email || state === "loading") return;

      setState("loading");
      setErrorMessage("");

      try {
        const response = await fetch("/api/subscribe", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email }),
        });

        const data = await response.json();

        if (response.ok && data.success) {
          setState("success");
          setEmail("");
        } else {
          setState("error");
          setErrorMessage(data.error || "Something went wrong");
        }
      } catch {
        setState("error");
        setErrorMessage("Network error. Please try again.");
      }
    },
    [email, state],
  );

  const handleClose = () => {
    if (state !== "loading") {
      setState("idle");
      setErrorMessage("");
      setDropdownOpen(false);
    }
    closeModal();
  };

  const currentDownload = DOWNLOADS[selectedPlatform];
  const downloadUrl = `${RELEASE_BASE}/${currentDownload.file}`;

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={handleClose}
            className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50"
          />

          <motion.div
            role="dialog"
            aria-modal="true"
            aria-labelledby="get-freed-title"
            initial={{ opacity: 0, scale: 0.95, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 20 }}
            transition={{ type: "spring", duration: 0.5 }}
            className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-50 w-full max-w-lg px-4"
          >
            <div className="relative p-6 sm:p-10 md:p-12 overflow-hidden rounded-2xl bg-freed-black/80 backdrop-blur-xl border border-freed-border shadow-[0_4px_30px_rgba(0,0,0,0.5)]">
              {/* Decorative glows */}
              <div className="absolute top-0 left-1/4 w-32 h-32 bg-glow-purple/20 rounded-full blur-3xl" />
              <div className="absolute bottom-0 right-1/4 w-40 h-40 bg-glow-blue/20 rounded-full blur-3xl" />

              <button
                onClick={handleClose}
                className="absolute top-5 right-5 text-text-muted hover:text-text-primary transition-colors"
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
                    d="M6 18L18 6M6 6l12 12"
                  />
                </svg>
              </button>

              <div className="relative z-10">
                {state === "success" ? (
                  <SuccessView onClose={handleClose} />
                ) : (
                  <>
                    <div className="text-center mb-10">
                      <h3
                        id="get-freed-title"
                        className="text-2xl font-bold text-text-primary mb-2"
                      >
                        Get <span className="gradient-text">Freed</span>
                      </h3>
                      <p className="text-text-secondary text-sm">
                        Open-source. Free forever. Take back your feed.
                      </p>
                    </div>

                    {/* Early-build disclaimer */}
                    <div className="mb-6 px-4 py-3 rounded-xl border border-amber-500/30 bg-amber-500/5">
                      <p className="text-center text-xs sm:text-sm font-bold text-amber-400/90">
                        ⚠️ Very early build. Nothing works yet!
                      </p>
                      <p className="text-center text-xs text-amber-400/60 mt-1">
                        Active development in progress. Expect a functional
                        release within the next month or two.
                      </p>
                    </div>

                    {/* --- Web App --- */}
                    <a
                      href="https://app.freed.wtf"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="group flex items-center gap-4 p-4 rounded-xl border border-freed-border hover:border-glow-purple/40 bg-freed-surface/40 hover:bg-freed-surface/70 transition-all mb-3"
                    >
                      <div className="shrink-0 w-10 h-10 rounded-lg bg-gradient-to-br from-glow-blue to-glow-purple flex items-center justify-center">
                        <svg
                          className="w-5 h-5 text-white"
                          fill="none"
                          viewBox="0 0 24 24"
                          stroke="currentColor"
                          strokeWidth={2}
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            d="M12 21a9.004 9.004 0 008.716-6.747M12 21a9.004 9.004 0 01-8.716-6.747M12 21c2.485 0 4.5-4.03 4.5-9S14.485 3 12 3m0 18c-2.485 0-4.5-4.03-4.5-9S9.515 3 12 3m0 0a8.997 8.997 0 017.843 4.582M12 3a8.997 8.997 0 00-7.843 4.582m15.686 0A11.953 11.953 0 0112 10.5c-2.998 0-5.74-1.1-7.843-2.918m15.686 0A8.959 8.959 0 0121 12c0 .778-.099 1.533-.284 2.253m0 0A17.919 17.919 0 0112 16.5a17.92 17.92 0 01-8.716-2.247m0 0A9 9 0 013 12c0-1.605.42-3.113 1.157-4.418"
                          />
                        </svg>
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold text-text-primary group-hover:text-white transition-colors">
                          Open Web App
                        </p>
                        <p className="text-xs text-text-muted">
                          Read your feeds anywhere, great on mobile
                        </p>
                      </div>
                      <svg
                        className="w-4 h-4 text-text-muted group-hover:text-text-secondary transition-colors shrink-0"
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                        strokeWidth={2}
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3"
                        />
                      </svg>
                    </a>

                    {/* --- Desktop Download with platform dropdown --- */}
                    <div className="relative mb-8" ref={dropdownRef}>
                      <div className="flex items-center rounded-xl border border-freed-border hover:border-glow-purple/40 bg-freed-surface/40 hover:bg-freed-surface/70 transition-all">
                        <a
                          href={downloadUrl}
                          className="group flex items-center gap-4 p-4 flex-1 min-w-0"
                        >
                          <div className="shrink-0 w-10 h-10 rounded-lg bg-freed-surface border border-freed-border flex items-center justify-center">
                            <svg
                              className="w-5 h-5 text-text-secondary"
                              fill="none"
                              viewBox="0 0 24 24"
                              stroke="currentColor"
                              strokeWidth={2}
                            >
                              <path
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3"
                              />
                            </svg>
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-semibold text-text-primary group-hover:text-white transition-colors">
                              Download for {currentDownload.label}
                            </p>
                            <p className="text-xs text-text-muted">
                              Runs in background to subscribe &amp; monitor
                            </p>
                          </div>
                        </a>
                        <button
                          onClick={() => setDropdownOpen((o) => !o)}
                          aria-label="Choose a different platform"
                          className="shrink-0 px-3 self-stretch border-l border-freed-border text-text-muted hover:text-text-primary transition-colors"
                        >
                          <svg
                            className={`w-4 h-4 transition-transform ${dropdownOpen ? "rotate-180" : ""}`}
                            fill="none"
                            viewBox="0 0 24 24"
                            stroke="currentColor"
                            strokeWidth={2}
                          >
                            <path
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              d="M19.5 8.25l-7.5 7.5-7.5-7.5"
                            />
                          </svg>
                        </button>
                      </div>

                      {/* Platform dropdown */}
                      <AnimatePresence>
                        {dropdownOpen && (
                          <motion.ul
                            initial={{ opacity: 0, y: -4 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={{ opacity: 0, y: -4 }}
                            transition={{ duration: 0.15 }}
                            className="absolute left-0 right-0 mt-1.5 rounded-xl border border-freed-border bg-freed-black/95 backdrop-blur-xl shadow-lg overflow-hidden z-20"
                          >
                            {(
                              Object.entries(DOWNLOADS) as [
                                DownloadKey,
                                (typeof DOWNLOADS)[DownloadKey],
                              ][]
                            ).map(([key, dl]) => (
                              <li key={key}>
                                <button
                                  onClick={() => {
                                    setSelectedPlatform(key);
                                    setDropdownOpen(false);
                                  }}
                                  className={`w-full text-left px-4 py-3 text-sm transition-colors flex items-center justify-between ${
                                    key === selectedPlatform
                                      ? "text-white bg-freed-surface/60"
                                      : "text-text-secondary hover:text-white hover:bg-freed-surface/40"
                                  }`}
                                >
                                  <span>{dl.label}</span>
                                  {key === selectedPlatform && (
                                    <svg
                                      className="w-4 h-4 text-glow-purple"
                                      fill="none"
                                      viewBox="0 0 24 24"
                                      stroke="currentColor"
                                      strokeWidth={2}
                                    >
                                      <path
                                        strokeLinecap="round"
                                        strokeLinejoin="round"
                                        d="M4.5 12.75l6 6 9-13.5"
                                      />
                                    </svg>
                                  )}
                                </button>
                              </li>
                            ))}
                          </motion.ul>
                        )}
                      </AnimatePresence>
                    </div>

                    {/* --- Divider --- */}
                    <div className="flex items-center gap-3 mb-6">
                      <div className="flex-1 h-px bg-freed-border" />
                      <span className="text-xs text-text-muted uppercase tracking-wider">
                        Stay in the loop
                      </span>
                      <div className="flex-1 h-px bg-freed-border" />
                    </div>

                    {/* --- Newsletter (disabled — tooltip on hover) --- */}
                    <div
                      className="relative"
                      ref={refs.setReference}
                      {...getReferenceProps()}
                    >
                      <AnimatePresence>
                        {isTooltipOpen && (
                          <motion.div
                            ref={refs.setFloating}
                            style={floatingStyles}
                            {...getFloatingProps()}
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            exit={{ opacity: 0 }}
                            className="z-[60] pointer-events-none px-3 py-1.5 rounded-lg text-xs font-medium bg-freed-black border border-freed-border text-text-primary shadow-lg whitespace-nowrap"
                          >
                            <span>We just launched! 🚀</span>{" "}
                            <span className="text-text-muted">
                              Email updates coming soon ✨
                            </span>
                            <FloatingArrow
                              ref={arrowRef}
                              context={floatingCtx}
                              fill="#0a0a0a"
                              strokeWidth={1}
                              stroke="var(--freed-border, #1f1f1f)"
                            />
                          </motion.div>
                        )}
                      </AnimatePresence>

                      <form onSubmit={handleSubmit} className="space-y-3">
                        <div className="flex gap-2">
                          <input
                            type="email"
                            value={email}
                            onChange={(e) => setEmail(e.target.value)}
                            placeholder="your@email.com"
                            disabled
                            className="min-w-0 flex-1 px-3 sm:px-4 py-2.5 rounded-lg bg-freed-surface border border-freed-border text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:border-glow-purple/50 focus:ring-1 focus:ring-glow-purple/50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                          />
                          <motion.button
                            type="submit"
                            disabled
                            className="btn-primary shrink-0 px-5 py-2.5 text-sm whitespace-nowrap disabled:opacity-50 disabled:cursor-not-allowed"
                          >
                            Subscribe
                          </motion.button>
                        </div>

                        <p className="text-text-muted text-xs text-center">
                          No spam. Unsubscribe anytime. We respect your privacy.
                        </p>
                      </form>
                    </div>
                  </>
                )}
              </div>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}

function SuccessView({ onClose }: { onClose: () => void }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="text-center py-6"
    >
      <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-green-500/20 flex items-center justify-center">
        <svg
          className="w-8 h-8 text-green-400"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M5 13l4 4L19 7"
          />
        </svg>
      </div>
      <h3 className="text-2xl font-bold text-text-primary mb-2">
        You&apos;re In!
      </h3>
      <p className="text-text-secondary">
        We&apos;ll keep you posted on new releases and updates.
      </p>
      <button onClick={onClose} className="mt-6 btn-primary px-8 py-2">
        Close
      </button>
    </motion.div>
  );
}
