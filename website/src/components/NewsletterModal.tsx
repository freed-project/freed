"use client";

import { useRef, useState, useEffect, useCallback } from "react";
import {
  getPwaHostForChannel,
  inferReleaseChannelFromHostname,
  type ReleaseChannel,
} from "@freed/shared";
import { createPortal } from "react-dom";
import { motion, AnimatePresence } from "framer-motion";
import TurnstileWidget from "@/components/TurnstileWidget";
import { useNewsletter } from "@/context/NewsletterContext";

type SubmitState = "idle" | "loading" | "error";

type DownloadKey = "mac-arm" | "mac-intel" | "windows" | "linux";
type InstallTarget = DownloadKey | "web";

const DOWNLOADS: Record<DownloadKey, { label: string }> = {
  "mac-arm": {
    label: "macOS (Apple Silicon)",
  },
  "mac-intel": {
    label: "macOS (Intel)",
  },
  windows: {
    label: "Windows",
  },
  linux: {
    label: "Linux",
  },
};

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const TURNSTILE_SITE_KEY = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY ?? "";
const PHONE_REGEX = /^\+?[0-9()\s.-]{7,20}$/;

function isValidEmailAddress(email: string): boolean {
  return EMAIL_REGEX.test(email);
}

function inferNameFromEmail(email: string): string {
  const localPart = email.split("@")[0] ?? "";
  const cleaned = localPart
    .replace(/\+.*/, "")
    .replace(/[0-9]+/g, " ")
    .replace(/[._-]+/g, " ")
    .trim();

  if (!cleaned) return "";

  return cleaned
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(" ");
}

function normalizePhoneNumber(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return "";

  const hasLeadingPlus = trimmed.startsWith("+");
  const digitsOnly = trimmed.replace(/\D/g, "");
  if (!digitsOnly) return "";

  if (hasLeadingPlus) {
    return `+${digitsOnly}`;
  }

  if (digitsOnly.length === 10) {
    return `+1${digitsOnly}`;
  }

  if (digitsOnly.length === 11 && digitsOnly.startsWith("1")) {
    return `+${digitsOnly}`;
  }

  return `+${digitsOnly}`;
}

function isValidPhoneNumber(value: string): boolean {
  if (!value.trim()) return true;
  if (!PHONE_REGEX.test(value.trim())) return false;

  const normalized = normalizePhoneNumber(value);
  const digits = normalized.replace(/\D/g, "");
  return digits.length >= 10 && digits.length <= 15;
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

function isMobileDevice(): boolean {
  if (typeof navigator === "undefined") return false;

  const navWithUAData = navigator as Navigator & {
    userAgentData?: { mobile?: boolean };
  };

  if (navWithUAData.userAgentData?.mobile === true) {
    return true;
  }

  const ua = navigator.userAgent.toLowerCase();
  if (
    /\b(iphone|ipod|ipad|android|windows phone|mobile)\b/.test(ua)
  ) {
    return true;
  }

  return navigator.maxTouchPoints > 1 && ua.includes("macintosh");
}

function detectDefaultInstallTarget(): InstallTarget {
  if (isMobileDevice()) {
    return "web";
  }

  return detectDownloadKey();
}

function LaunchFreedWebIcon() {
  return (
    <svg
      className="h-5 w-5 text-white"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M14 5h5v5" />
      <path d="M10 14L19 5" />
      <rect x="5" y="9" width="10" height="10" rx="2.5" />
    </svg>
  );
}

export default function NewsletterModal() {
  const { isOpen, closeModal } = useNewsletter();
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [phoneNumber, setPhoneNumber] = useState("");
  const [company, setCompany] = useState("");
  const [state, setState] = useState<SubmitState>("idle");
  const [errorMessage, setErrorMessage] = useState("");
  const [successMessage, setSuccessMessage] = useState("");
  const [turnstileToken, setTurnstileToken] = useState("");
  const [turnstileResetKey, setTurnstileResetKey] = useState(0);
  const [websiteChannel, setWebsiteChannel] =
    useState<ReleaseChannel>("production");
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [nameManuallyEdited, setNameManuallyEdited] = useState(false);
  const [selectedTarget, setSelectedTarget] = useState<InstallTarget>("mac-arm");
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [dropdownMenuStyle, setDropdownMenuStyle] = useState<{
    top: number;
    left: number;
    width: number;
    openUpward: boolean;
  } | null>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const dropdownMenuRef = useRef<HTMLUListElement>(null);
  const modalPanelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setSelectedTarget(detectDefaultInstallTarget());
  }, []);

  useEffect(() => {
    setWebsiteChannel(
      inferReleaseChannelFromHostname(window.location.hostname) ?? "production",
    );
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    setDetailsOpen(false);
    setTurnstileToken("");
    setTurnstileResetKey((current) => current + 1);
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;

    const body = document.body;
    const root = document.documentElement;
    const previousBodyOverflow = body.style.overflow;
    const previousRootOverflow = root.style.overflow;
    const previousBodyTouchAction = body.style.touchAction;

    body.style.overflow = "hidden";
    root.style.overflow = "hidden";
    body.style.touchAction = "none";

    return () => {
      body.style.overflow = previousBodyOverflow;
      root.style.overflow = previousRootOverflow;
      body.style.touchAction = previousBodyTouchAction;
    };
  }, [isOpen]);

  useEffect(() => {
    if (nameManuallyEdited) return;
    setName(inferNameFromEmail(email));
  }, [email, nameManuallyEdited]);

  // Close dropdown on outside click
  useEffect(() => {
    if (!dropdownOpen) return;
    const handler = (e: MouseEvent) => {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(e.target as Node) &&
        !dropdownMenuRef.current?.contains(e.target as Node)
      ) {
        setDropdownOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [dropdownOpen]);

  useEffect(() => {
    if (!dropdownOpen) return;

    const updateDropdownPosition = () => {
      const rect = dropdownRef.current?.getBoundingClientRect();
      if (!rect) return;

      const menuHeight =
        dropdownMenuRef.current?.getBoundingClientRect().height || 0;
      const viewportHeight = window.visualViewport?.height ?? window.innerHeight;
      const viewportWidth = window.visualViewport?.width ?? window.innerWidth;
      const fallbackMenuHeight = 240;
      const effectiveMenuHeight = menuHeight || fallbackMenuHeight;
      const availableTop = 8;
      const availableBottom = viewportHeight - 8;
      const downSpace = availableBottom - rect.bottom - 6;
      const upSpace = rect.top - availableTop - 6;
      const canOpenDown = downSpace >= effectiveMenuHeight;
      const canOpenUp = upSpace >= effectiveMenuHeight;
      const openUpward = !canOpenDown && canOpenUp;
      const unclampedTop = openUpward
        ? rect.top - effectiveMenuHeight - 6
        : rect.bottom + 6;
      const maxTop = availableBottom - effectiveMenuHeight;
      const minTop = availableTop;
      const top = Math.max(minTop, Math.min(unclampedTop, maxTop));
      const maxLeft = Math.max(8, viewportWidth - rect.width - 8);
      const left = Math.max(8, Math.min(rect.left, maxLeft));

      setDropdownMenuStyle({
        top,
        left,
        width: Math.min(rect.width, viewportWidth - 16),
        openUpward,
      });
    };

    updateDropdownPosition();
    window.addEventListener("resize", updateDropdownPosition);
    window.addEventListener("scroll", updateDropdownPosition, true);

    return () => {
      window.removeEventListener("resize", updateDropdownPosition);
      window.removeEventListener("scroll", updateDropdownPosition, true);
    };
  }, [dropdownOpen]);

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      if (!email || state === "loading") return;
      const normalizedEmail = email.trim().toLowerCase();
      const normalizedName = name.trim();
      const normalizedPhoneNumber = normalizePhoneNumber(phoneNumber);

      if (!normalizedEmail || !isValidEmailAddress(normalizedEmail)) {
        setState("error");
        setErrorMessage("Please enter a valid email address.");
        setSuccessMessage("");
        return;
      }

      if (!detailsOpen) {
        setDetailsOpen(true);
        setState("idle");
        setErrorMessage("");
        setSuccessMessage("");
        return;
      }

      if (!normalizedName) {
        setState("error");
        setErrorMessage("Please tell us your name.");
        setSuccessMessage("");
        return;
      }

      if (!isValidPhoneNumber(phoneNumber)) {
        setState("error");
        setErrorMessage("Please enter a valid phone number or leave it blank.");
        setSuccessMessage("");
        return;
      }

      if (!turnstileToken) {
        setState("error");
        setErrorMessage("Please complete the human check.");
        setSuccessMessage("");
        return;
      }

      setState("loading");
      setErrorMessage("");
      setSuccessMessage("");

      try {
        const response = await fetch("/api/subscribe", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            email: normalizedEmail,
            name: normalizedName,
            phoneNumber: normalizedPhoneNumber,
            company,
            turnstileToken,
          }),
        });

        const data = (await response.json().catch(() => ({}))) as {
          success?: boolean;
          error?: string;
          message?: string;
        };

        if (response.ok && data.success) {
          setEmail("");
          setName("");
          setPhoneNumber("");
          setCompany("");
          setDetailsOpen(false);
          setNameManuallyEdited(false);
          setState("idle");
          setSuccessMessage(
            "You are subscribed. We will email you about new builds and major progress."
          );
          return;
        }

        setState("error");
        setErrorMessage(
          data.error ?? "Something went wrong. Please try again in a moment."
        );
      } catch {
        setState("error");
        setErrorMessage("Network error. Please try again.");
      } finally {
        setTurnstileToken("");
        setTurnstileResetKey((current) => current + 1);
      }
    },
    [company, detailsOpen, email, name, phoneNumber, state, turnstileToken],
  );

  const handleClose = useCallback(() => {
    if (state !== "loading") {
      setState("idle");
      setErrorMessage("");
      setSuccessMessage("");
      setDropdownOpen(false);
      setDetailsOpen(false);
      setName("");
      setPhoneNumber("");
      setNameManuallyEdited(false);
      setTurnstileToken("");
      setTurnstileResetKey((current) => current + 1);
    }
    closeModal();
  }, [closeModal, state]);

  useEffect(() => {
    if (!isOpen) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        handleClose();
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [handleClose, isOpen]);

  const currentDownload =
    selectedTarget === "web" ? null : DOWNLOADS[selectedTarget];
  const downloadUrl = currentDownload
    ? `/api/downloads/${selectedTarget}`
    : null;
  const freedWebUrl = `https://${getPwaHostForChannel(websiteChannel)}`;
  const selectedTargetLabel =
    selectedTarget === "web" ? "Freed Web" : currentDownload?.label ?? "";
  const isWebTarget = selectedTarget === "web";
  const normalizedEmailInput = email.trim().toLowerCase();
  const isEmailInputValid = isValidEmailAddress(normalizedEmailInput);
  const isPhoneInputValid = isValidPhoneNumber(phoneNumber);

  const handleOpenFreedWeb = useCallback(() => {
    window.open(freedWebUrl, "_blank", "noopener,noreferrer");
  }, [freedWebUrl]);

  const handleDownload = useCallback(() => {
    if (!downloadUrl) return;
    window.open(downloadUrl, "_blank", "noopener,noreferrer");
  }, [downloadUrl]);

  const handleSwitchToDesktopTarget = useCallback(() => {
    setSelectedTarget(detectDownloadKey());
    setDropdownOpen(false);
  }, []);

  const handlePrimaryAction = useCallback(() => {
    if (isWebTarget) {
      handleOpenFreedWeb();
      return;
    }

    handleDownload();
  }, [handleDownload, handleOpenFreedWeb, isWebTarget]);

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onPointerDown={(event) => {
              const target = event.target as Node | null;
              const panel = modalPanelRef.current;

              if (panel && target && panel.contains(target)) {
                return;
              }

              handleClose();
            }}
            onTouchStart={(event) => {
              const target = event.target as Node | null;
              const panel = modalPanelRef.current;

              if (panel && target && panel.contains(target)) {
                return;
              }

              handleClose();
            }}
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
            className="fixed inset-0 z-50 flex items-center justify-center px-4 pt-4 sm:items-center sm:py-6"
            style={{
              paddingTop: "calc(env(safe-area-inset-top) + 1rem)",
              paddingBottom: "calc(env(safe-area-inset-bottom) + 1rem)",
            }}
            onPointerDown={(event) => {
              const target = event.target as Node | null;
              const panel = modalPanelRef.current;
              if (panel && target && panel.contains(target)) return;
              handleClose();
            }}
            onTouchStart={(event) => {
              const target = event.target as Node | null;
              const panel = modalPanelRef.current;
              if (panel && target && panel.contains(target)) return;
              handleClose();
            }}
          >
            <div
              ref={modalPanelRef}
              className="newsletter-modal theme-panel relative w-full max-w-5xl overflow-hidden rounded-2xl"
            >
              <div
                className="absolute top-0 left-1/4 h-32 w-32 rounded-full blur-3xl"
                style={{
                  background:
                    "color-mix(in srgb, var(--theme-accent-secondary) 14%, transparent)",
                }}
              />
              <div
                className="absolute bottom-0 right-1/4 h-40 w-40 rounded-full blur-3xl"
                style={{
                  background:
                    "color-mix(in srgb, var(--theme-accent-primary) 12%, transparent)",
                }}
              />

              <button
                type="button"
                aria-label="Close"
                onClick={handleClose}
                onPointerDown={(event) => event.stopPropagation()}
                onTouchStart={(event) => event.stopPropagation()}
                className="absolute top-5 right-5 z-30 inline-flex h-11 w-11 cursor-pointer items-center justify-center rounded-full bg-[color-mix(in srgb,var(--theme-bg-card) 86%,transparent)] p-0 text-text-muted transition-colors hover:text-text-primary"
              >
                <svg
                  className="h-6 w-6"
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

              <div
                className="relative z-10 overflow-y-auto px-6 pt-6 pb-8 sm:px-10 sm:pt-10 sm:pb-12 md:px-12 md:pt-12 md:pb-14"
                style={{
                  maxHeight:
                    "calc(100dvh - env(safe-area-inset-top) - env(safe-area-inset-bottom) - 2rem)",
                }}
              >
                <>
                  <div className="text-center mb-10 sm:mb-8">
                    <h3
                      id="get-freed-title"
                      className="mb-2 text-4xl font-bold text-text-primary sm:text-5xl"
                    >
                      Get <span className="theme-heading-accent">Freed</span>
                    </h3>
                    <p className="mt-2 hidden text-base text-text-secondary sm:block">
                      Open-source. Free forever. Take back your feed.
                    </p>
                  </div>

                  <div className="grid gap-0 lg:grid-cols-2 lg:items-start">
                    <div className="pb-2 sm:py-4 lg:pr-8">
                      <div className="mb-6 max-w-md">
                        <h4 className="flex items-center gap-3 text-2xl font-bold text-text-primary sm:text-3xl">
                          <CircledStepNumber number={1} />
                          <span>Email Updates</span>
                        </h4>
                      </div>

                      <div className="relative">
                        <form onSubmit={handleSubmit} className="space-y-3">
                          <div
                            aria-hidden="true"
                            className="absolute left-[-9999px] top-auto h-px w-px overflow-hidden"
                          >
                            <label htmlFor="newsletter-company">Company</label>
                            <input
                              id="newsletter-company"
                              name="company"
                              type="text"
                              tabIndex={-1}
                              autoComplete="off"
                              value={company}
                              onChange={(event) => setCompany(event.target.value)}
                            />
                          </div>
                          <div className="space-y-1">
                            <label
                              htmlFor="newsletter-email"
                              className="text-xs font-medium uppercase tracking-[0.12em] text-text-muted"
                            >
                              Email
                            </label>
                            <div className="flex flex-col gap-2 sm:flex-row">
                              <input
                                id="newsletter-email"
                                type="email"
                                value={email}
                                onChange={(e) => {
                                  setEmail(e.target.value);
                                  if (state === "error") {
                                    setState("idle");
                                    setErrorMessage("");
                                  }
                                  if (successMessage) {
                                    setSuccessMessage("");
                                  }
                                }}
                                placeholder="your@email.com"
                                className="min-w-0 flex-1 rounded-lg border px-3 py-2.5 text-sm text-text-primary placeholder:text-text-muted transition-colors focus:outline-none focus:border-[color:var(--theme-heading-accent)] focus:ring-2 focus:ring-[color:var(--theme-heading-accent)]/18 sm:px-4"
                                style={{
                                  background:
                                    "color-mix(in srgb, var(--theme-bg-elevated) 96%, transparent)",
                                  borderColor:
                                    "color-mix(in srgb, var(--theme-border-strong) 82%, transparent)",
                                  boxShadow:
                                    "0 0 0 1px rgb(255 255 255 / 0.04), inset 0 1px 0 rgb(255 255 255 / 0.05)",
                                }}
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
                              {!detailsOpen && (
                                <motion.button
                                  type="submit"
                                  disabled={state === "loading"}
                                  className="btn-primary flex min-w-[8.5rem] shrink-0 items-center justify-center gap-2 px-5 py-2.5 text-sm whitespace-nowrap hover:!scale-100 active:!scale-100 disabled:cursor-not-allowed disabled:opacity-70"
                                >
                                  Continue
                                </motion.button>
                              )}
                            </div>
                          </div>

                          <AnimatePresence initial={false}>
                            {detailsOpen && (
                              <motion.div
                                initial={{ opacity: 0, height: 0, y: -6 }}
                                animate={{ opacity: 1, height: "auto", y: 0 }}
                                exit={{ opacity: 0, height: 0, y: -6 }}
                                transition={{ duration: 0.18 }}
                                className="space-y-3 overflow-visible"
                              >
                                <div className="grid gap-2 sm:grid-cols-2">
                                  <div className="space-y-1">
                                    <label
                                      htmlFor="newsletter-name"
                                      className="text-xs font-medium uppercase tracking-[0.12em] text-text-muted"
                                    >
                                      Name
                                    </label>
                                    <input
                                      id="newsletter-name"
                                      type="text"
                                      value={name}
                                      onChange={(event) => {
                                        setName(event.target.value);
                                        setNameManuallyEdited(true);
                                        if (state === "error") {
                                          setState("idle");
                                          setErrorMessage("");
                                        }
                                      }}
                                      placeholder="Your name"
                                      className="min-w-0 w-full rounded-lg border px-3 py-2.5 text-sm text-text-primary placeholder:text-text-muted transition-colors focus:outline-none focus:border-[color:var(--theme-heading-accent)] focus:ring-2 focus:ring-[color:var(--theme-heading-accent)]/18 sm:px-4"
                                      style={{
                                        background:
                                          "color-mix(in srgb, var(--theme-bg-elevated) 96%, transparent)",
                                        borderColor:
                                          "color-mix(in srgb, var(--theme-border-strong) 82%, transparent)",
                                        boxShadow:
                                          "0 0 0 1px rgb(255 255 255 / 0.04), inset 0 1px 0 rgb(255 255 255 / 0.05)",
                                      }}
                                      autoComplete="name"
                                      name="name"
                                      maxLength={120}
                                      required
                                    />
                                  </div>
                                  <div className="space-y-1">
                                    <label
                                      htmlFor="newsletter-phone"
                                      className="text-xs font-medium uppercase tracking-[0.12em] text-text-muted"
                                    >
                                      Phone Number
                                    </label>
                                    <input
                                      id="newsletter-phone"
                                      type="tel"
                                      value={phoneNumber}
                                      onChange={(event) => {
                                        setPhoneNumber(event.target.value);
                                        if (state === "error") {
                                          setState("idle");
                                          setErrorMessage("");
                                        }
                                      }}
                                      placeholder="Phone number, optional"
                                      className="min-w-0 w-full rounded-lg border px-3 py-2.5 text-sm text-text-primary placeholder:text-text-muted transition-colors focus:outline-none focus:border-[color:var(--theme-heading-accent)] focus:ring-2 focus:ring-[color:var(--theme-heading-accent)]/18 sm:px-4"
                                      style={{
                                        background:
                                          "color-mix(in srgb, var(--theme-bg-elevated) 96%, transparent)",
                                        borderColor:
                                          "color-mix(in srgb, var(--theme-border-strong) 82%, transparent)",
                                        boxShadow:
                                          "0 0 0 1px rgb(255 255 255 / 0.04), inset 0 1px 0 rgb(255 255 255 / 0.05)",
                                      }}
                                      autoComplete="tel"
                                      inputMode="tel"
                                      aria-invalid={!!phoneNumber && !isPhoneInputValid}
                                      name="phone"
                                      maxLength={32}
                                    />
                                  </div>
                                </div>

                                <TurnstileWidget
                                  siteKey={TURNSTILE_SITE_KEY}
                                  resetKey={turnstileResetKey}
                                  disabled={state === "loading"}
                                  onTokenChange={(token) => {
                                    setTurnstileToken(token);
                                    if (token && state === "error") {
                                      setState("idle");
                                      setErrorMessage("");
                                    }
                                  }}
                                />

                                {turnstileToken ? (
                                  <motion.button
                                    type="submit"
                                    disabled={state === "loading"}
                                    className="btn-primary flex min-w-[12rem] items-center justify-center gap-2 px-5 py-2.5 text-sm whitespace-nowrap hover:!scale-100 active:!scale-100 disabled:cursor-not-allowed disabled:opacity-70"
                                  >
                                    {state === "loading" ? (
                                      <>
                                        <Spinner />
                                        <span>Submitting</span>
                                      </>
                                    ) : (
                                      "Confirm subscription"
                                    )}
                                  </motion.button>
                                ) : (
                                  <p className="text-xs leading-relaxed text-text-muted">
                                    Complete the human check to confirm your subscription.
                                  </p>
                                )}
                              </motion.div>
                            )}
                          </AnimatePresence>

                          {successMessage && (
                            <p
                              role="status"
                              aria-live="polite"
                              className="text-xs leading-relaxed text-[rgb(var(--theme-feedback-success-rgb))]"
                            >
                              {successMessage}
                            </p>
                          )}
                          {state === "error" && (
                            <p
                              id="newsletter-error"
                              role="status"
                              aria-live="polite"
                              className="text-xs leading-relaxed text-[rgb(var(--theme-feedback-danger-rgb))]"
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

                    <div className="space-y-5 pt-10 pb-2 sm:py-4 lg:pt-4 lg:pl-8 lg:border-l lg:border-freed-border">
                        <div className="max-w-lg space-y-2">
                          <h4 className="flex items-center gap-3 text-2xl font-bold text-text-primary sm:text-3xl">
                            <CircledStepNumber number={2} />
                            <span>{isWebTarget ? "Launch Freed" : "Download Freed"}</span>
                          </h4>
                          {!isWebTarget && (
                            <p className="text-sm leading-relaxed text-text-secondary">
                              Install Freed Desktop first, then launch Freed Web on your
                              mobile device.
                            </p>
                          )}
                        </div>

                        <div className="relative" ref={dropdownRef}>
                          <div
                            className="newsletter-modal-download-cta btn-primary get-freed-launch-cta flex items-center rounded-xl !p-0 hover:!scale-100 active:!scale-100"
                          >
                            <button
                              type="button"
                              onClick={handlePrimaryAction}
                              data-testid="website-primary-action"
                              className="get-freed-launch-cta__primary group flex min-w-0 flex-1 items-center gap-4 p-4 text-left cursor-pointer"
                            >
                              <div
                                className="get-freed-launch-cta__icon flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-white/15 bg-white/12"
                              >
                                {isWebTarget ? (
                                  <LaunchFreedWebIcon />
                                ) : (
                                  <svg
                                    className="h-5 w-5 text-white"
                                    fill="none"
                                    viewBox="0 0 24 24"
                                    stroke="currentColor"
                                    strokeWidth={2}
                                    aria-hidden="true"
                                  >
                                    <path
                                      strokeLinecap="round"
                                      strokeLinejoin="round"
                                      d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3"
                                    />
                                  </svg>
                                )}
                              </div>
                              <div className="flex-1 min-w-0 text-left">
                                <p className="get-freed-launch-cta__title text-sm font-semibold text-white transition-colors group-hover:text-white">
                                  {isWebTarget
                                    ? "Launch Freed Web"
                                    : `Download for ${selectedTargetLabel}`}
                                </p>
                                <p className="get-freed-launch-cta__subtitle text-xs text-white/80">
                                  {isWebTarget
                                    ? "Open the mobile reader instantly in your browser"
                                    : "Runs in background to subscribe and monitor"}
                                </p>
                              </div>
                            </button>
                            <button
                              type="button"
                              onClick={() => setDropdownOpen((o) => !o)}
                              aria-label="Choose a different platform"
                              className="get-freed-launch-cta__toggle shrink-0 self-stretch border-l border-white/15 px-4 text-white/90 transition-colors hover:bg-white/10 hover:text-white cursor-pointer"
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

                        </div>

                        <div className="space-y-3">
                          {(selectedTarget === "windows" ||
                            selectedTarget === "linux") && (
                            <p className="text-xs leading-relaxed text-text-muted">
                              {selectedTarget === "windows"
                                ? "Windows will probably warn before opening this unsigned installer. Click More info, then Run anyway."
                                : "Before running on Linux, make the AppImage executable with chmod +x Freed-Linux-x64.AppImage."}
                            </p>
                          )}

                          {!isWebTarget && (
                            <button
                              type="button"
                              onClick={handleOpenFreedWeb}
                              data-testid="website-open-web-app"
                              className="flex w-full cursor-pointer items-center justify-start gap-2 rounded-lg bg-transparent px-3 py-2.5 text-left text-sm text-text-muted transition-colors hover:bg-[rgb(var(--theme-control-accent-rgb)/0.08)] hover:text-text-primary"
                            >
                              <svg
                                aria-hidden="true"
                                className="h-4 w-4"
                                fill="none"
                                viewBox="0 0 24 24"
                                stroke="currentColor"
                                strokeWidth={2}
                              >
                                <path
                                  strokeLinecap="round"
                                  strokeLinejoin="round"
                                  d="M9 6l6 6-6 6M14 6l6 6-6 6"
                                />
                              </svg>
                              <span>
                                Already running Freed Desktop? Launch{" "}
                                <span className="underline decoration-current underline-offset-4">
                                  Freed Web
                                </span>{" "}
                                here
                              </span>
                            </button>
                          )}
                          {isWebTarget && (
                            <button
                              type="button"
                              onClick={handleSwitchToDesktopTarget}
                              data-testid="website-switch-to-desktop-download"
                              className="flex w-full cursor-pointer items-center justify-start gap-2 rounded-lg bg-transparent px-3 py-2.5 text-left text-sm text-text-muted transition-colors hover:bg-[rgb(var(--theme-control-accent-rgb)/0.08)] hover:text-text-primary"
                            >
                              <svg
                                aria-hidden="true"
                                className="h-4 w-4"
                                fill="none"
                                viewBox="0 0 24 24"
                                stroke="currentColor"
                                strokeWidth={2}
                              >
                                <path
                                  strokeLinecap="round"
                                  strokeLinejoin="round"
                                  d="M9 6l6 6-6 6M14 6l6 6-6 6"
                                />
                              </svg>
                              <span>
                                You'll first need{" "}
                                <span className="underline decoration-current underline-offset-4">
                                  Freed Desktop
                                </span>{" "}
                                running on your primary machine
                              </span>
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                </>
              </div>
            </div>
          </motion.div>
          {typeof document !== "undefined" &&
            dropdownOpen &&
            dropdownMenuStyle &&
            createPortal(
              <AnimatePresence>
                <motion.ul
                  ref={dropdownMenuRef}
                  initial={{
                    opacity: 0,
                    y: dropdownMenuStyle?.openUpward ? 4 : -4,
                  }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{
                    opacity: 0,
                    y: dropdownMenuStyle?.openUpward ? 4 : -4,
                  }}
                  transition={{ duration: 0.15 }}
                  className="fixed z-[70] overflow-hidden rounded-xl border shadow-lg"
                  style={{
                    top: dropdownMenuStyle.top,
                    left: dropdownMenuStyle.left,
                    width: dropdownMenuStyle.width,
                    borderColor: "var(--theme-border-subtle)",
                    background: "var(--theme-bg-elevated)",
                  }}
                >
                  {([
                    ["web", { label: "Freed Web" }],
                    ...(Object.entries(DOWNLOADS) as [
                      DownloadKey,
                      (typeof DOWNLOADS)[DownloadKey],
                    ][]),
                  ] as [InstallTarget, { label: string }][]).map(([key, dl]) => (
                    <li key={key}>
                      <button
                        onClick={() => {
                          setSelectedTarget(key);
                          setDropdownOpen(false);
                        }}
                        className={`flex w-full items-center justify-between px-4 py-3 text-left text-sm transition-colors ${
                          key === selectedTarget
                            ? "text-text-primary"
                            : "text-text-secondary hover:text-text-primary"
                        }`}
                        style={
                          key === selectedTarget
                            ? {
                                background:
                                  "color-mix(in srgb, var(--theme-heading-accent) 12%, transparent)",
                              }
                            : undefined
                        }
                      >
                        <span>{dl.label}</span>
                        {key === selectedTarget && (
                          <svg
                            className="w-4 h-4 text-[color:var(--theme-heading-accent)]"
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
              </AnimatePresence>,
              document.body,
            )}
        </>
      )}
    </AnimatePresence>
  );
}

function Spinner() {
  return (
    <span
      aria-hidden="true"
      className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-current border-r-transparent"
    />
  );
}

function CircledStepNumber({ number }: { number: 1 | 2 }) {
  return (
    <span className="inline-flex h-[1em] w-[1em] items-center justify-center text-[1em] leading-none">
      <svg
        aria-hidden="true"
        viewBox="0 0 32 32"
        className="h-[1em] w-[1em]"
        fill="none"
      >
        <circle
          cx="16"
          cy="16"
          r="14.5"
          stroke="currentColor"
          strokeWidth="1.5"
        />
        <text
          x="16"
          y="20"
          textAnchor="middle"
          fill="currentColor"
          fontSize="13"
          fontWeight="700"
          fontFamily="var(--font-space-grotesk), sans-serif"
        >
          {number}
        </text>
      </svg>
    </span>
  );
}
