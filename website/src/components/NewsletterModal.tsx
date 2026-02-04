"use client";

import { useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useNewsletter } from "@/context/NewsletterContext";
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

type SubmitState = "idle" | "loading" | "success" | "error";

export default function NewsletterModal() {
  const { isOpen, closeModal } = useNewsletter();
  const [email, setEmail] = useState("");
  const [state, setState] = useState<SubmitState>("idle");
  const [errorMessage, setErrorMessage] = useState("");
  const [isTooltipOpen, setIsTooltipOpen] = useState(false);
  const arrowRef = useRef(null);

  const { refs, floatingStyles, context } = useFloating({
    open: isTooltipOpen,
    onOpenChange: setIsTooltipOpen,
    placement: "top",
    middleware: [
      offset(12),
      shift({ padding: 8 }),
      arrow({ element: arrowRef }),
    ],
  });

  const clientPoint = useClientPoint(context);
  const hover = useHover(context);
  const { getReferenceProps, getFloatingProps } = useInteractions([
    clientPoint,
    hover,
  ]);

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
            ref={refs.setReference}
            {...getReferenceProps()}
          >
            {/* Cursor-following tooltip with arrow */}
            <AnimatePresence>
              {isTooltipOpen && state !== "success" && (
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
                    context={context}
                    fill="#0a0a0a"
                    strokeWidth={1}
                    stroke="var(--freed-border, #1f1f1f)"
                  />
                </motion.div>
              )}
            </AnimatePresence>

            <div className="relative p-10 overflow-hidden rounded-2xl bg-freed-black/80 backdrop-blur-xl border border-freed-border shadow-[0_4px_30px_rgba(0,0,0,0.5)]">
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
                  <>
                    <div className="text-center mb-6">
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
                          disabled
                          className="w-full px-4 py-3 rounded-lg bg-freed-surface border border-freed-border text-text-primary placeholder:text-text-muted focus:outline-none focus:border-glow-purple/50 focus:ring-1 focus:ring-glow-purple/50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
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
                        disabled
                        className="w-full btn-primary py-3 disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        Join the Waitlist
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
