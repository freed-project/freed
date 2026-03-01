"use client";

import { useRef, useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useNewsletter } from "@/context/NewsletterContext";

type SubmitState = "idle" | "loading" | "success" | "error";
type Platform = "mac" | "windows" | "linux" | "unknown";

const GITHUB_RELEASE =
  "https://github.com/freed-project/freed/releases/latest";

function detectPlatform(): Platform {
  if (typeof navigator === "undefined") return "unknown";
  const ua = navigator.userAgent.toLowerCase();
  if (ua.includes("mac")) return "mac";
  if (ua.includes("win")) return "windows";
  if (ua.includes("linux")) return "linux";
  return "unknown";
}

const PLATFORM_LABELS: Record<Platform, string> = {
  mac: "macOS",
  windows: "Windows",
  linux: "Linux",
  unknown: "your platform",
};

export default function NewsletterModal() {
  const { isOpen, closeModal } = useNewsletter();
  const [email, setEmail] = useState("");
  const [state, setState] = useState<SubmitState>("idle");
  const [errorMessage, setErrorMessage] = useState("");
  const [platform, setPlatform] = useState<Platform>("unknown");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setPlatform(detectPlatform());
  }, []);

  useEffect(() => {
    if (isOpen && state !== "success") {
      const t = setTimeout(() => inputRef.current?.focus(), 400);
      return () => clearTimeout(t);
    }
  }, [isOpen, state]);

  const handleSubmit = async (e: React.FormEvent) => {
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
  };

  const handleClose = () => {
    if (state !== "loading") {
      setState("idle");
      setErrorMessage("");
    }
    closeModal();
  };

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
            <div className="relative p-8 sm:p-10 overflow-hidden rounded-2xl bg-freed-black/80 backdrop-blur-xl border border-freed-border shadow-[0_4px_30px_rgba(0,0,0,0.5)]">
              {/* Decorative glows */}
              <div className="absolute top-0 left-1/4 w-32 h-32 bg-glow-purple/20 rounded-full blur-3xl" />
              <div className="absolute bottom-0 right-1/4 w-40 h-40 bg-glow-blue/20 rounded-full blur-3xl" />

              <button
                onClick={handleClose}
                className="absolute top-4 right-4 text-text-muted hover:text-text-primary transition-colors"
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
                    <div className="text-center mb-8">
                      <h3
                        id="get-freed-title"
                        className="text-2xl font-bold text-text-primary mb-2"
                      >
                        Get <span className="gradient-text">Freed</span>
                      </h3>
                      <p className="text-text-secondary text-sm">
                        Choose how you want to take back your feed.
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
                          Use Freed instantly in your browser — no install
                          needed
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

                    {/* --- Desktop Download --- */}
                    <a
                      href={GITHUB_RELEASE}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="group flex items-center gap-4 p-4 rounded-xl border border-freed-border hover:border-glow-purple/40 bg-freed-surface/40 hover:bg-freed-surface/70 transition-all mb-6"
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
                          Download for {PLATFORM_LABELS[platform]}
                        </p>
                        <p className="text-xs text-text-muted">
                          Native desktop app with capture, sync, and
                          auto-updates
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

                    {/* --- Divider --- */}
                    <div className="flex items-center gap-3 mb-5">
                      <div className="flex-1 h-px bg-freed-border" />
                      <span className="text-xs text-text-muted uppercase tracking-wider">
                        Stay in the loop
                      </span>
                      <div className="flex-1 h-px bg-freed-border" />
                    </div>

                    {/* --- Newsletter --- */}
                    <form onSubmit={handleSubmit} className="space-y-3">
                      <div className="flex gap-2">
                        <input
                          ref={inputRef}
                          type="email"
                          value={email}
                          onChange={(e) => setEmail(e.target.value)}
                          placeholder="your@email.com"
                          required
                          className="flex-1 px-4 py-2.5 rounded-lg bg-freed-surface border border-freed-border text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:border-glow-purple/50 focus:ring-1 focus:ring-glow-purple/50 transition-colors"
                        />
                        <motion.button
                          type="submit"
                          disabled={state === "loading"}
                          whileHover={{ scale: 1.02 }}
                          whileTap={{ scale: 0.98 }}
                          className="btn-primary px-5 py-2.5 text-sm whitespace-nowrap disabled:opacity-50"
                        >
                          {state === "loading" ? "..." : "Subscribe"}
                        </motion.button>
                      </div>

                      {state === "error" && (
                        <motion.p
                          initial={{ opacity: 0, y: -5 }}
                          animate={{ opacity: 1, y: 0 }}
                          className="text-red-400 text-xs text-center"
                        >
                          {errorMessage}
                        </motion.p>
                      )}

                      <p className="text-text-muted text-[11px] text-center">
                        Release notes and project updates. No spam, ever.
                      </p>
                    </form>
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
      className="text-center py-4"
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
