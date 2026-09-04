import {
  FREED_NEWSLETTER_SUBSCRIBED_STORAGE_KEY,
  FREED_NEWSLETTER_SUBSCRIBE_URL,
  FREED_NEWSLETTER_TURNSTILE_SITE_KEY,
} from "@freed/shared";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from "react";

declare global {
  interface Window {
    turnstile?: {
      render: (
        container: HTMLElement,
        options: {
          sitekey: string;
          theme?: "light" | "dark" | "auto";
          size?: "normal" | "compact" | "flexible";
          action?: string;
          callback?: (token: string) => void;
          "expired-callback"?: () => void;
          "error-callback"?: () => void;
        },
      ) => string;
      reset: (widgetId?: string) => void;
      remove: (widgetId?: string) => void;
    };
  }
}

const TURNSTILE_SCRIPT_ID = "freed-newsletter-turnstile";
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type SignupStatus =
  "idle" | "submitting" | "subscribed" | "preview-complete" | "error";

export interface NewsletterSignupProps {
  endpoint?: string;
  siteKey?: string;
  compact?: boolean;
  previewOnly?: boolean;
  onSubscribed?: () => void;
}

function readSubscribedState(): boolean {
  try {
    return (
      localStorage.getItem(FREED_NEWSLETTER_SUBSCRIBED_STORAGE_KEY) === "1"
    );
  } catch {
    return false;
  }
}

function rememberSubscription(): void {
  try {
    localStorage.setItem(FREED_NEWSLETTER_SUBSCRIBED_STORAGE_KEY, "1");
  } catch {
    // Signup still succeeded when private storage is unavailable.
  }
}

function ensureTurnstileScript(
  onReady: () => void,
  onError: () => void,
): () => void {
  if (window.turnstile) {
    onReady();
    return () => {};
  }

  let script = document.getElementById(
    TURNSTILE_SCRIPT_ID,
  ) as HTMLScriptElement | null;
  if (!script) {
    script = document.createElement("script");
    script.id = TURNSTILE_SCRIPT_ID;
    script.src =
      "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
    script.async = true;
    script.defer = true;
    document.head.appendChild(script);
  }

  script.addEventListener("load", onReady);
  script.addEventListener("error", onError);
  return () => {
    script?.removeEventListener("load", onReady);
    script?.removeEventListener("error", onError);
  };
}

export function NewsletterSignup({
  endpoint = FREED_NEWSLETTER_SUBSCRIBE_URL,
  siteKey = FREED_NEWSLETTER_TURNSTILE_SITE_KEY,
  compact = false,
  previewOnly = false,
  onSubscribed,
}: NewsletterSignupProps = {}) {
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [company, setCompany] = useState("");
  const [turnstileToken, setTurnstileToken] = useState("");
  const [turnstileReady, setTurnstileReady] = useState(() =>
    Boolean(window.turnstile),
  );
  const [status, setStatus] = useState<SignupStatus>(() =>
    readSubscribedState() ? "subscribed" : "idle",
  );
  const [message, setMessage] = useState("");
  const turnstileContainerRef = useRef<HTMLDivElement>(null);
  const widgetIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (!detailsOpen) return;
    return ensureTurnstileScript(
      () => setTurnstileReady(true),
      () => {
        setStatus("error");
        setMessage(
          "The human check could not load. Check your connection and try again.",
        );
      },
    );
  }, [detailsOpen]);

  useEffect(() => {
    if (
      !detailsOpen ||
      !turnstileReady ||
      !turnstileContainerRef.current ||
      widgetIdRef.current ||
      !window.turnstile
    ) {
      return;
    }

    widgetIdRef.current = window.turnstile.render(
      turnstileContainerRef.current,
      {
        sitekey: siteKey,
        theme: "auto",
        size: "flexible",
        action: "newsletter_signup",
        callback: setTurnstileToken,
        "expired-callback": () => setTurnstileToken(""),
        "error-callback": () => {
          setTurnstileToken("");
          setStatus("error");
          setMessage("The human check failed. Please try again.");
        },
      },
    );

    return () => {
      if (widgetIdRef.current && window.turnstile) {
        window.turnstile.remove(widgetIdRef.current);
      }
      widgetIdRef.current = null;
    };
  }, [detailsOpen, siteKey, turnstileReady]);

  const submit = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      const normalizedEmail = email.trim().toLowerCase();
      const normalizedName = name.trim();

      if (!EMAIL_PATTERN.test(normalizedEmail)) {
        setStatus("error");
        setMessage("Enter a valid email address.");
        return;
      }

      if (!detailsOpen) {
        setStatus("idle");
        setMessage("");
        setDetailsOpen(true);
        return;
      }

      if (!normalizedName) {
        setStatus("error");
        setMessage("Tell us your name.");
        return;
      }

      if (!turnstileToken) {
        setStatus("error");
        setMessage("Complete the human check.");
        return;
      }

      setStatus("submitting");
      setMessage("");

      if (previewOnly) {
        setStatus("preview-complete");
        setMessage("");
        return;
      }

      try {
        const response = await fetch(endpoint, {
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

        rememberSubscription();
        setStatus("subscribed");
        setMessage("");
        onSubscribed?.();
      } catch (error) {
        setStatus("error");
        setMessage(
          error instanceof Error
            ? error.message
            : "Signup failed. Please try again.",
        );
        setTurnstileToken("");
        if (widgetIdRef.current && window.turnstile) {
          window.turnstile.reset(widgetIdRef.current);
        }
      }
    },
    [
      company,
      detailsOpen,
      email,
      endpoint,
      name,
      onSubscribed,
      previewOnly,
      turnstileToken,
    ],
  );

  if (status === "preview-complete") {
    return (
      <div
        className="rounded-xl border border-[var(--theme-border-subtle)] bg-[var(--theme-bg-muted)] p-4"
        role="status"
      >
        <p className="text-sm font-semibold text-[var(--theme-text-primary)]">
          That’s the complete signup flow.
        </p>
        <p className="mt-1 text-xs leading-relaxed text-[var(--theme-text-muted)]">
          This local preview didn’t send your email. Live Freed builds subscribe
          you here without opening another page.
        </p>
      </div>
    );
  }

  if (status === "subscribed") {
    return (
      <div
        className="rounded-xl border border-[var(--theme-border-subtle)] bg-[var(--theme-bg-muted)] p-4"
        role="status"
      >
        <p className="text-sm font-semibold text-[var(--theme-text-primary)]">
          You’re on the list.
        </p>
        <p className="mt-1 text-xs leading-relaxed text-[var(--theme-text-muted)]">
          We’ll email you about new builds and major progress. No content
          sludge.
        </p>
      </div>
    );
  }

  return (
    <section
      className={
        compact
          ? "space-y-3"
          : "rounded-xl border border-[var(--theme-border-subtle)] bg-[var(--theme-bg-card)] p-4 sm:p-5"
      }
      aria-label="Freed newsletter signup"
    >
      <div>
        <p className="text-sm font-semibold text-[var(--theme-text-primary)]">
          Keep up with Freed.
        </p>
        <p className="mt-1 text-xs leading-relaxed text-[var(--theme-text-muted)]">
          New builds, real progress, and the thinking behind Freed. No spam.
        </p>
      </div>

      <form
        className="space-y-3"
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
              disabled={status === "submitting"}
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
                disabled={status === "submitting"}
                required
              />
            </label>
          ) : null}
          {!detailsOpen ? (
            <button
              type="submit"
              className="btn-secondary inline-flex min-h-10 items-center justify-center px-4 py-2 text-sm font-semibold"
            >
              Join the newsletter
            </button>
          ) : null}
        </div>

        <input
          type="hidden"
          name="company"
          value={company}
          onChange={(event) => setCompany(event.target.value)}
        />

        {detailsOpen ? (
          <>
            <div ref={turnstileContainerRef} className="min-h-[68px]" />
            <button
              type="submit"
              className="btn-primary inline-flex min-h-11 w-full items-center justify-center px-5 py-2.5 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-60"
              disabled={status === "submitting"}
            >
              {status === "submitting" ? "Joining…" : "Join the newsletter"}
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

      <p className="text-[11px] leading-relaxed text-[var(--theme-text-soft)]">
        Unsubscribe anytime. Your email goes to our newsletter provider and
        nowhere else.
      </p>
    </section>
  );
}
