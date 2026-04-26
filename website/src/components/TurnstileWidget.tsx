"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Script from "next/script";

const TURNSTILE_UNAVAILABLE_TOKEN = "turnstile-unavailable";

declare global {
  interface Window {
    turnstile?: {
      render: (
        container: HTMLElement,
        options: {
          sitekey: string;
          theme?: "light" | "dark" | "auto";
          size?: "normal" | "compact" | "flexible";
          callback?: (token: string) => void;
          "expired-callback"?: () => void;
          "error-callback"?: () => void;
          "timeout-callback"?: () => void;
          "unsupported-callback"?: () => void;
        },
      ) => string;
      reset: (widgetId?: string) => void;
      remove: (widgetId?: string) => void;
    };
  }
}

interface TurnstileWidgetProps {
  siteKey: string;
  resetKey: number;
  onTokenChange: (token: string) => void;
  disabled?: boolean;
}

export default function TurnstileWidget({
  siteKey,
  resetKey,
  onTokenChange,
  disabled = false,
}: TurnstileWidgetProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const widgetIdRef = useRef<string | null>(null);
  const onTokenChangeRef = useRef(onTokenChange);
  const verificationTimerRef = useRef<number | null>(null);
  const [scriptReady, setScriptReady] = useState(false);
  const [retryKey, setRetryKey] = useState(0);
  const [verificationState, setVerificationState] = useState<
    "idle" | "checking" | "verified" | "failed"
  >("idle");

  useEffect(() => {
    onTokenChangeRef.current = onTokenChange;
  }, [onTokenChange]);

  const clearVerificationTimer = useCallback(() => {
    if (verificationTimerRef.current) {
      window.clearTimeout(verificationTimerRef.current);
      verificationTimerRef.current = null;
    }
  }, []);

  const emitTokenChange = useCallback((token: string) => {
    onTokenChangeRef.current(token);
  }, []);

  const markFailed = useCallback(() => {
    clearVerificationTimer();
    emitTokenChange(TURNSTILE_UNAVAILABLE_TOKEN);
    setVerificationState("failed");
  }, [clearVerificationTimer, emitTokenChange]);

  const rerenderWidget = useCallback(() => {
    clearVerificationTimer();
    emitTokenChange("");

    if (widgetIdRef.current && window.turnstile) {
      window.turnstile.remove(widgetIdRef.current);
    }

    widgetIdRef.current = null;
    containerRef.current?.replaceChildren();
    setVerificationState("idle");
    setRetryKey((current) => current + 1);
  }, [clearVerificationTimer, emitTokenChange]);

  useEffect(() => {
    if (window.turnstile) {
      setScriptReady(true);
    }
  }, []);

  useEffect(() => {
    if (!siteKey || !scriptReady || !containerRef.current || widgetIdRef.current) {
      return;
    }

    const turnstile = window.turnstile;
    if (!turnstile) return;

    setVerificationState("checking");
    verificationTimerRef.current = window.setTimeout(markFailed, 30_000);

    widgetIdRef.current = turnstile.render(containerRef.current, {
      sitekey: siteKey,
      theme: "auto",
      size: "flexible",
      callback: (token) => {
        clearVerificationTimer();
        setVerificationState("verified");
        emitTokenChange(token);
      },
      "expired-callback": () => {
        clearVerificationTimer();
        setVerificationState("idle");
        emitTokenChange("");
      },
      "error-callback": markFailed,
      "timeout-callback": markFailed,
      "unsupported-callback": markFailed,
    });

    return () => {
      clearVerificationTimer();
      if (widgetIdRef.current && window.turnstile) {
        window.turnstile.remove(widgetIdRef.current);
      }
      widgetIdRef.current = null;
    };
  }, [
    clearVerificationTimer,
    emitTokenChange,
    markFailed,
    retryKey,
    scriptReady,
    siteKey,
  ]);

  useEffect(() => {
    if (!resetKey || !widgetIdRef.current || !window.turnstile) return;
    clearVerificationTimer();
    window.turnstile.reset(widgetIdRef.current);
    setVerificationState("checking");
    verificationTimerRef.current = window.setTimeout(markFailed, 30_000);
    emitTokenChange("");
  }, [clearVerificationTimer, emitTokenChange, markFailed, resetKey]);

  if (!siteKey) {
    return (
      <p className="text-xs leading-relaxed text-[rgb(var(--theme-feedback-danger-rgb))]">
        Signup protection is not configured yet.
      </p>
    );
  }

  return (
    <div className={disabled ? "pointer-events-none opacity-70" : undefined}>
      <Script
        src="https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit"
        strategy="afterInteractive"
        onLoad={() => setScriptReady(true)}
      />
      <div ref={containerRef} className="min-h-[68px]" />
      {verificationState === "failed" ? (
        <div className="mt-2 flex flex-wrap items-center gap-2 text-xs leading-relaxed text-[rgb(var(--theme-feedback-danger-rgb))]">
          <span>Human check is taking too long. Try again, or submit below.</span>
          <button
            type="button"
            onClick={rerenderWidget}
            className="font-medium text-[color:var(--theme-heading-accent)] underline decoration-current/40 underline-offset-4 transition-colors hover:text-[color:var(--theme-heading-accent-2)]"
          >
            Try again
          </button>
        </div>
      ) : null}
    </div>
  );
}
