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
import { LEGAL_BUNDLE_VERSION, LEGAL_DOCS } from "@freed/shared/legal";
import { useNewsletter } from "@/context/NewsletterContext";
import {
  acceptWebsiteBundle,
  getWebsiteBundleAcceptance,
  hasAcceptedWebsiteBundle,
} from "@/lib/legal-consent";

type SubmitState = "idle" | "loading" | "success" | "error";
type InstallNoteVariant = "callout" | "inline";

const RELEASE_BASE =
  "https://github.com/freed-project/freed/releases/latest/download";

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

const INSTALL_NOTE_VARIANT: InstallNoteVariant = "inline";
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function isValidEmailAddress(email: string): boolean {
  return EMAIL_REGEX.test(email);
}

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
      const gl = canvas.getContext("webgl2") || canvas.getContext("webgl");
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
  const [acceptedBundle, setAcceptedBundle] = useState(false);
  const [legalChecked, setLegalChecked] = useState(false);
  const [arrowElement, setArrowElement] = useState<SVGSVGElement | null>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const {
    refs,
    floatingStyles,
    context: floatingCtx,
  } = useFloating({
    open: isTooltipOpen,
    onOpenChange: setIsTooltipOpen,
    placement: "top",
    middleware: [
      offset(12),
      shift({ padding: 8 }),
      arrow({ element: arrowElement }),
    ],
  });

  const setTooltipReference = useCallback(
    (node: HTMLDivElement | null) => {
      refs.setReference(node);
    },
    [refs],
  );

  const setTooltipFloating = useCallback(
    (node: HTMLDivElement | null) => {
      refs.setFloating(node);
    },
    [refs],
  );

  const clientPoint = useClientPoint(floatingCtx);
  const hover = useHover(floatingCtx);
  const { getReferenceProps, getFloatingProps } = useInteractions([
    clientPoint,
    hover,
  ]);

  useEffect(() => {
    setSelectedPlatform(detectDownloadKey());
    setAcceptedBundle(hasAcceptedWebsiteBundle());
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    setAcceptedBundle(hasAcceptedWebsiteBundle());
    setLegalChecked(false);
  }, [isOpen]);

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
      const normalizedEmail = email.trim().toLowerCase();

      if (!normalizedEmail || !isValidEmailAddress(normalizedEmail)) {
        setState("error");
        setErrorMessage("Please enter a valid email address.");
        return;
      }

      setState("loading");
      setErrorMessage("");

      try {
        const response = await fetch("/api/subscribe", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email: normalizedEmail }),
        });

        const data = (await response.json().catch(() => ({}))) as {
          success?: boolean;
          error?: string;
          message?: string;
        };

        const nextState = response.ok && data.success ? "success" : "error";
        setState(nextState);

        if (response.ok && data.success) {
          setEmail("");
          return;
        }

        setErrorMessage(
          data.error ?? "Something went wrong. Please try again in a moment."
        );
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
  const canProceed = acceptedBundle || legalChecked;
  const storedAcceptance = getWebsiteBundleAcceptance();
  const normalizedEmailInput = email.trim().toLowerCase();
  const isEmailInputValid = isValidEmailAddress(normalizedEmailInput);

  const ensureAccepted = useCallback(() => {
    if (acceptedBundle) return true;
    if (!legalChecked) return false;
    const record = acceptWebsiteBundle();
    setAcceptedBundle(!!record);
    setLegalChecked(false);
    return !!record;
  }, [acceptedBundle, legalChecked]);

  const handleOpenWebApp = useCallback(() => {
    if (!ensureAccepted()) return;
    window.open("https://app.freed.wtf", "_blank", "noopener,noreferrer");
  }, [ensureAccepted]);

  const handleDownload = useCallback(() => {
    if (!ensureAccepted()) return;
    window.open(downloadUrl, "_blank", "noopener,noreferrer");
  }, [downloadUrl, ensureAccepted]);

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={handleClose}
            className="theme-elevated-overlay fixed inset-0 z-50 backdrop-blur-sm"
          />

          <motion.div
            role="dialog"
            aria-modal="true"
            aria-labelledby="get-freed-title"
            initial={{ opacity: 0, scale: 0.95, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 20 }}
            transition={{ type: "spring", duration: 0.5 }}
            className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-50 w-full max-w-5xl px-4"
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
                    <div className="text-center mb-8">
                      <h3
                        id="get-freed-title"
                        className="text-5xl font-bold text-text-primary mb-2"
                      >
                        Get <span className="gradient-text">Freed</span>
                      </h3>
                      <p className="text-text-secondary text-base mt-2">
                        Open-source. Free forever. Take back your feed.
                      </p>
                    </div>

                    <div className="grid gap-0 lg:grid-cols-2 lg:items-start">
                      <div className="py-2 sm:py-4 lg:pr-8">
                        <div className="mb-6 max-w-md">
                          <h4 className="text-3xl font-bold text-text-primary">
                            Email Updates
                          </h4>
                          <p className="mt-2 text-base leading-relaxed text-text-secondary">
                            Occasional updates on new builds, major fixes, and
                            meaningful progress as Freed settles down.
                          </p>
                        </div>

                        <div
                          className="relative"
                          ref={setTooltipReference}
                          {...getReferenceProps()}
                        >
                          <AnimatePresence>
                            {isTooltipOpen && (
                              <motion.div
                                ref={setTooltipFloating}
                                style={floatingStyles}
                                {...getFloatingProps()}
                                initial={{ opacity: 0 }}
                                animate={{ opacity: 1 }}
                                exit={{ opacity: 0 }}
                                className="z-[60] pointer-events-none px-3 py-1.5 rounded-lg text-xs font-medium bg-freed-black border border-freed-border text-text-primary shadow-lg whitespace-nowrap"
                              >
                                <span>We just launched! 🚀</span>{" "}
                                <span className="text-text-muted">
                                  Email updates are now live.
                                </span>
                                <FloatingArrow
                                  ref={setArrowElement}
                                  context={floatingCtx}
                                  fill="var(--color-freed-black)"
                                  strokeWidth={1}
                                  stroke="var(--freed-border, #1f1f1f)"
                                />
                              </motion.div>
                            )}
                          </AnimatePresence>

                          <form onSubmit={handleSubmit} className="space-y-3">
                            <div className="flex flex-col gap-2 sm:flex-row">
                              <input
                                type="email"
                                value={email}
                                onChange={(e) => {
                                  setEmail(e.target.value);
                                  if (state === "error") {
                                    setState("idle");
                                    setErrorMessage("");
                                  }
                                }}
                                placeholder="your@email.com"
                                className="min-w-0 flex-1 px-3 sm:px-4 py-2.5 rounded-lg bg-freed-surface/70 border border-freed-border/70 text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:border-glow-purple/50 focus:ring-1 focus:ring-glow-purple/50 transition-colors"
                                autoComplete="email"
                                inputMode="email"
                                aria-describedby={
                                  state === "error" ? "newsletter-error" : undefined
                                }
                                disabled={state === "loading"}
                                aria-invalid={
                                  state === "error" || (!!email && !isEmailInputValid)
                                }
                                name="email"
                                maxLength={254}
                                required
                              />
                              <motion.button
                                type="submit"
                                disabled={state === "loading" || !isEmailInputValid}
                                className="btn-primary shrink-0 px-5 py-2.5 text-sm whitespace-nowrap disabled:opacity-50 disabled:cursor-not-allowed"
                              >
                                {state === "loading" ? "Subscribing..." : "Subscribe"}
                              </motion.button>
                          </div>

                          {state === "error" && (
                            <p
                              id="newsletter-error"
                              role="status"
                              aria-live="polite"
                              className="text-xs leading-relaxed text-red-300"
                            >
                              {errorMessage}
                            </p>
                          )}
                          <p className="text-xs leading-relaxed text-text-muted">
                            No spam. Unsubscribe anytime. We respect your privacy.
                          </p>
                        </form>
                        </div>
                      </div>

                      <div className="space-y-5 py-2 sm:py-4 lg:pl-8 lg:border-l lg:border-freed-border">
                        <div className="max-w-lg">
                          <h4 className="text-3xl font-bold text-text-primary">
                            Install Freed Desktop
                          </h4>
                          <p className="mt-2 text-base leading-relaxed text-text-secondary">
                            Start with Freed Desktop. The web app becomes useful
                            after your feed is running locally and syncing.
                          </p>
                          {INSTALL_NOTE_VARIANT === "inline" && (
                            <p className="mt-3 text-xs leading-relaxed text-text-muted">
                              Freed is experimental software under active
                              development. You may still hit bugs or unfinished
                              edges, but stability is improving quickly and new
                              builds ship{" "}
                              <a
                                href="/changelog"
                                className="underline underline-offset-2 hover:text-text-primary transition-colors"
                              >
                                most days
                              </a>
                              .
                            </p>
                          )}
                        </div>

                        {INSTALL_NOTE_VARIANT === "callout" && (
                          <div className="rounded-2xl border border-glow-purple/30 bg-glow-purple/8 px-4 py-4">
                            <p className="text-sm font-semibold text-glow-purple">
                              Early experimental build
                            </p>
                            <p className="mt-2 text-xs leading-relaxed text-text-muted">
                              Freed is experimental software under active
                              development. You may still hit bugs or unfinished
                              edges, but stability is improving quickly and new
                              builds ship{" "}
                              <a
                                href="/changelog"
                                className="underline underline-offset-2 hover:text-text-primary transition-colors"
                              >
                                most days
                              </a>
                              .
                            </p>
                          </div>
                        )}

                        <div className="rounded-2xl bg-freed-surface/80 p-4">
                          {acceptedBundle ? (
                            <p className="text-xs leading-relaxed text-text-muted">
                              Legal terms already accepted for bundle {LEGAL_BUNDLE_VERSION}
                              {storedAcceptance?.acceptedAt
                                ? ` on ${new Date(storedAcceptance.acceptedAt).toLocaleString()}`
                                : ""}
                              .
                            </p>
                          ) : (
                            <label className="flex items-start gap-3 text-xs sm:text-sm leading-relaxed text-text-secondary cursor-pointer">
                              <input
                                type="checkbox"
                                checked={legalChecked}
                                onChange={(event) => setLegalChecked(event.target.checked)}
                                className="mt-0.5 h-4 w-4 rounded border-freed-border bg-freed-surface text-glow-purple focus:ring-glow-purple"
                              />
                              <span>
                                I have read and agree to the{" "}
                                <a
                                  href={LEGAL_DOCS.terms.path}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="underline underline-offset-2 hover:text-text-primary transition-colors"
                                >
                                  {LEGAL_DOCS.terms.label}
                                </a>{" "}
                                and{" "}
                                <a
                                  href={LEGAL_DOCS.privacy.path}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="underline underline-offset-2 hover:text-text-primary transition-colors"
                                >
                                  {LEGAL_DOCS.privacy.label}
                                </a>
                                . I understand that Freed is experimental software
                                under active development. The desktop app will show
                                additional license and risk terms on first launch.
                              </span>
                            </label>
                          )}
                        </div>

                        <div className="relative" ref={dropdownRef}>
                          <div className="flex items-center rounded-xl border border-freed-border hover:border-glow-purple/40 bg-freed-surface/35 hover:bg-freed-surface/60 transition-all">
                            <button
                              type="button"
                              onClick={handleDownload}
                              disabled={!canProceed}
                              data-testid="website-legal-download"
                              className="group flex items-center gap-4 p-4 flex-1 min-w-0 disabled:opacity-50 disabled:cursor-not-allowed"
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
                              <div className="flex-1 min-w-0 text-left">
                                <p className="text-sm font-semibold text-text-primary group-hover:text-text-primary transition-colors">
                                  Download for {currentDownload.label}
                                </p>
                                <p className="text-xs text-text-muted">
                                  Runs in background to subscribe and monitor
                                </p>
                              </div>
                            </button>
                            <button
                              onClick={() => setDropdownOpen((o) => !o)}
                              aria-label="Choose a different platform"
                              className="shrink-0 self-stretch border-l border-freed-border px-3 text-text-muted transition-colors hover:text-text-primary"
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
                                          ? "text-text-primary bg-freed-surface/60"
                                          : "text-text-secondary hover:text-text-primary hover:bg-freed-surface/40"
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

                        <div className="space-y-3">
                          {(selectedPlatform === "windows" ||
                            selectedPlatform === "linux") && (
                            <p className="text-xs leading-relaxed text-text-muted">
                              {selectedPlatform === "windows"
                                ? "Windows will probably warn before opening this unsigned installer. Click More info, then Run anyway."
                                : "Before running on Linux, make the AppImage executable with chmod +x Freed-Linux-x64.AppImage."}
                            </p>
                          )}

                          <button
                            type="button"
                            onClick={handleOpenWebApp}
                            disabled={!canProceed}
                            data-testid="website-legal-open-web-app"
                            className="text-sm text-text-muted underline underline-offset-4 transition-colors hover:text-text-primary disabled:opacity-50 disabled:cursor-not-allowed"
                          >
                            Already running Freed Desktop? Open the web app.
                          </button>
                        </div>
                      </div>
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
      <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-glow-purple/20 flex items-center justify-center">
        <svg
          className="w-8 h-8 text-glow-purple"
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
