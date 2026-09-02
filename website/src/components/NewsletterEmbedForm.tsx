"use client";

import { isThemeId } from "@freed/shared/themes";
import { applyThemeToDocument } from "@freed/ui/lib/theme";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import TurnstileWidget from "@/components/TurnstileWidget";

const TURNSTILE_SITE_KEY = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY ?? "";
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type SignupState = "idle" | "loading" | "success" | "error";

export default function NewsletterEmbedForm() {
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [company, setCompany] = useState("");
  const [turnstileToken, setTurnstileToken] = useState("");
  const [turnstileResetKey, setTurnstileResetKey] = useState(0);
  const [state, setState] = useState<SignupState>("idle");
  const [message, setMessage] = useState("");

  useEffect(() => {
    const requestedTheme = new URLSearchParams(window.location.search).get(
      "theme",
    );
    if (requestedTheme && isThemeId(requestedTheme)) {
      window.localStorage.setItem("freed-theme", requestedTheme);
      applyThemeToDocument(requestedTheme);
    }
  }, []);

  const submit = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      const normalizedEmail = email.trim().toLowerCase();
      const normalizedName = name.trim();

      if (!EMAIL_PATTERN.test(normalizedEmail)) {
        setState("error");
        setMessage("Enter a valid email address.");
        return;
      }

      if (!detailsOpen) {
        setDetailsOpen(true);
        setState("idle");
        setMessage("");
        return;
      }

      if (!normalizedName) {
        setState("error");
        setMessage("Tell us your name.");
        return;
      }

      if (!turnstileToken) {
        setState("error");
        setMessage("Complete the human check.");
        return;
      }

      setState("loading");
      setMessage("");

      try {
        const response = await fetch("/api/subscribe", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            email: normalizedEmail,
            name: normalizedName,
            company,
            turnstileToken,
          }),
        });
        const data = (await response.json().catch(() => ({}))) as {
          success?: boolean;
          error?: string;
        };

        if (!response.ok || !data.success) {
          throw new Error(data.error ?? "Signup failed. Please try again.");
        }

        setState("success");
      } catch (error) {
        setState("error");
        setMessage(
          error instanceof Error
            ? error.message
            : "Signup failed. Please try again.",
        );
        setTurnstileToken("");
        setTurnstileResetKey((current) => current + 1);
      }
    },
    [company, detailsOpen, email, name, turnstileToken],
  );

  if (state === "success") {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[var(--theme-bg-primary)] p-4">
        <div
          className="w-full rounded-xl border border-[var(--theme-border-subtle)] bg-[var(--theme-bg-muted)] p-5"
          role="status"
        >
          <p className="text-base font-semibold text-[var(--theme-text-primary)]">
            You’re on the list.
          </p>
          <p className="mt-1 text-sm leading-relaxed text-[var(--theme-text-muted)]">
            We’ll email you about new builds and major progress. No content
            sludge.
          </p>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-[var(--theme-bg-primary)] p-4 text-[var(--theme-text-primary)]">
      <section
        className="mx-auto max-w-xl rounded-xl border border-[var(--theme-border-subtle)] bg-[var(--theme-bg-card)] p-5"
        aria-label="Freed newsletter signup"
      >
        <p className="text-base font-semibold">Keep up with Freed.</p>
        <p className="mt-1 text-sm leading-relaxed text-[var(--theme-text-muted)]">
          New builds, real progress, and the thinking behind Freed. No spam.
        </p>

        <form
          className="mt-4 space-y-3"
          onSubmit={(event) => void submit(event)}
          noValidate
        >
          <div
            className={
              detailsOpen
                ? "grid gap-3 sm:grid-cols-2"
                : "flex flex-col gap-2 sm:flex-row"
            }
          >
            <label className="min-w-0 flex-1">
              <span className="sr-only">Email address</span>
              <input
                type="email"
                inputMode="email"
                autoComplete="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="you@example.com"
                className="theme-input w-full rounded-xl px-3 py-2.5 text-sm outline-none"
                disabled={state === "loading"}
                required
              />
            </label>
            {detailsOpen ? (
              <label className="min-w-0 flex-1">
                <span className="sr-only">Name</span>
                <input
                  type="text"
                  autoComplete="name"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  placeholder="Your name"
                  className="theme-input w-full rounded-xl px-3 py-2.5 text-sm outline-none"
                  disabled={state === "loading"}
                  required
                />
              </label>
            ) : (
              <button
                type="submit"
                className="btn-secondary inline-flex min-h-10 items-center justify-center px-4 py-2 text-sm font-semibold"
              >
                Join the newsletter
              </button>
            )}
          </div>

          <input
            type="hidden"
            name="company"
            value={company}
            onChange={(event) => setCompany(event.target.value)}
          />

          {detailsOpen ? (
            <>
              <TurnstileWidget
                siteKey={TURNSTILE_SITE_KEY}
                resetKey={turnstileResetKey}
                action="newsletter_signup"
                disabled={state === "loading"}
                onTokenChange={(token) => {
                  setTurnstileToken(token);
                  if (token && state === "error") {
                    setState("idle");
                    setMessage("");
                  }
                }}
              />
              <button
                type="submit"
                className="btn-primary inline-flex min-h-11 w-full items-center justify-center px-5 py-2.5 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-60"
                disabled={state === "loading"}
              >
                {state === "loading" ? "Joining…" : "Join the newsletter"}
              </button>
            </>
          ) : null}

          {message ? (
            <p
              className="text-xs leading-relaxed text-[rgb(var(--theme-feedback-danger-rgb))]"
              role="alert"
            >
              {message}
            </p>
          ) : null}
        </form>

        <p className="mt-3 text-xs leading-relaxed text-[var(--theme-text-soft)]">
          Unsubscribe anytime. Your email goes to our newsletter provider and
          nowhere else.
        </p>
      </section>
    </main>
  );
}
