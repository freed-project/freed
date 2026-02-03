"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useNewsletter } from "@/context/NewsletterContext";

type SubmitState = "idle" | "loading" | "success" | "error";

export default function NewsletterModal() {
  const { isOpen, closeModal } = useNewsletter();
  const [email, setEmail] = useState("");
  const [state, setState] = useState<SubmitState>("idle");
  const [errorMessage, setErrorMessage] = useState("");

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
    // Reset state when closing
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
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={handleClose}
            className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50"
          />

          {/* Modal */}
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-labelledby="newsletter-title"
            initial={{ opacity: 0, scale: 0.95, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 20 }}
            transition={{ type: "spring", duration: 0.5 }}
            className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-50 w-full max-w-md px-4"
          >
            <div className="relative glass-card p-8 overflow-hidden">
              {/* Decorative glow */}
              <div className="absolute top-0 left-1/4 w-32 h-32 bg-glow-purple/20 rounded-full blur-3xl" />
              <div className="absolute bottom-0 right-1/4 w-40 h-40 bg-glow-blue/20 rounded-full blur-3xl" />

              {/* Close button */}
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
                  // Success state
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
                      You're In!
                    </h3>
                    <p className="text-text-secondary">
                      We'll let you know when Freed is ready for you.
                    </p>
                    <button
                      onClick={handleClose}
                      className="mt-6 btn-primary px-8 py-2"
                    >
                      Close
                    </button>
                  </motion.div>
                ) : (
                  // Form state
                  <>
                    <div className="text-center mb-6">
                      <div className="flex justify-center mb-3">
                        <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium bg-glow-purple/20 text-glow-purple border border-glow-purple/30">
                          <span className="w-1.5 h-1.5 rounded-full bg-glow-purple animate-pulse" />
                          Email updates coming soon
                        </span>
                      </div>
                      <h3
                        id="newsletter-title"
                        className="text-2xl font-bold text-text-primary mb-2"
                      >
                        Get <span className="gradient-text">Freed</span>
                      </h3>
                      <p className="text-text-secondary">
                        Be the first to know when we launch. Join the waitlist
                        for early access.
                      </p>
                    </div>

                    <form onSubmit={handleSubmit} className="space-y-4">
                      <div>
                        <input
                          type="email"
                          value={email}
                          onChange={(e) => setEmail(e.target.value)}
                          placeholder="Enter your email"
                          required
                          disabled={state === "loading"}
                          className="w-full px-4 py-3 rounded-lg bg-freed-surface border border-freed-border text-text-primary placeholder:text-text-muted focus:outline-none focus:border-glow-purple/50 focus:ring-1 focus:ring-glow-purple/50 transition-colors disabled:opacity-50"
                        />
                      </div>

                      {state === "error" && (
                        <motion.p
                          initial={{ opacity: 0, y: -10 }}
                          animate={{ opacity: 1, y: 0 }}
                          className="text-red-400 text-sm text-center"
                        >
                          {errorMessage}
                        </motion.p>
                      )}

                      <motion.button
                        type="submit"
                        disabled={state === "loading" || !email}
                        whileHover={{ scale: state === "loading" ? 1 : 1.02 }}
                        whileTap={{ scale: state === "loading" ? 1 : 0.98 }}
                        className="w-full btn-primary py-3 disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        {state === "loading" ? (
                          <span className="flex items-center justify-center gap-2">
                            <svg
                              className="animate-spin h-5 w-5"
                              viewBox="0 0 24 24"
                            >
                              <circle
                                className="opacity-25"
                                cx="12"
                                cy="12"
                                r="10"
                                stroke="currentColor"
                                strokeWidth="4"
                                fill="none"
                              />
                              <path
                                className="opacity-75"
                                fill="currentColor"
                                d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                              />
                            </svg>
                            Joining...
                          </span>
                        ) : (
                          "Join the Waitlist"
                        )}
                      </motion.button>
                    </form>

                    <p className="text-text-muted text-xs text-center mt-4">
                      No spam. Unsubscribe anytime. We respect your privacy.
                    </p>
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
