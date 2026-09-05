import {
  FREED_NEWSLETTER_SUBSCRIBED_STORAGE_KEY,
  FREED_NEWSLETTER_SUBSCRIBE_URL,
  FREED_NEWSLETTER_TURNSTILE_SITE_KEY,
} from "@freed/shared";
import {
  useCallback,
  useEffect,
  useId,
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
          appearance?: "always" | "execute" | "interaction-only";
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

// Match the marketing signup suggestion, but never replace a name the reader edits.
function inferNameFromEmail(email: string): string {
  const cleaned = (email.split("@")[0] ?? "")
    .replace(/\+.*/, "")
    .replace(/[0-9]+/g, " ")
    .replace(/[._-]+/g, " ")
    .trim();
  return cleaned
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(" ");
}

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
  const [verificationStarted, setVerificationStarted] = useState(false);
  const [fieldErrors, setFieldErrors] = useState({ email: "", name: "" });
  const fieldId = useId();
  const formRef = useRef<HTMLFormElement>(null);
  const pendingSubmitRef = useRef(false);
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [nameManuallyEdited, setNameManuallyEdited] = useState(false);
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
    if (nameManuallyEdited) return;
    const suggestedName = inferNameFromEmail(email);
    setName(suggestedName);
    if (suggestedName) setFieldErrors((errors) => ({ ...errors, name: "" }));
  }, [email, nameManuallyEdited]);

  useEffect(() => {
    if (!verificationStarted) return;
    return ensureTurnstileScript(
      () => setTurnstileReady(true),
      () => {
        pendingSubmitRef.current = false;
        setStatus("error");
        setMessage(
          "The human check could not load. Check your connection and try again.",
        );
      },
    );
  }, [verificationStarted]);

  useEffect(() => {
    if (
      !verificationStarted ||
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
        appearance: "interaction-only",
        action: "newsletter_signup",
        callback: setTurnstileToken,
        "expired-callback": () => setTurnstileToken(""),
        "error-callback": () => {
          pendingSubmitRef.current = false;
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
  }, [verificationStarted, siteKey, turnstileReady]);

  useEffect(() => {
    if (turnstileToken && pendingSubmitRef.current) {
      pendingSubmitRef.current = false;
      formRef.current?.requestSubmit();
    }
  }, [turnstileToken]);

  const submit = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      const normalizedEmail = email.trim().toLowerCase();
      const normalizedName = name.trim();
      const errors = {
        email: EMAIL_PATTERN.test(normalizedEmail) ? "" : "Enter a valid email address.",
        name: normalizedName ? "" : "Enter your name.",
      };
      setFieldErrors(errors);
      setMessage("");
      // Preserve the existing first-valid-email-submit boundary for Cloudflare contact.
      if (!errors.email) setVerificationStarted(true);
      if (errors.email || errors.name) {
        pendingSubmitRef.current = false;
        formRef.current?.querySelector<HTMLInputElement>(errors.email ? 'input[type="email"]' : 'input[autocomplete="name"]')?.focus();
        return;
      }

      if (!turnstileToken) {
        pendingSubmitRef.current = true;
        setStatus("idle");
        setMessage("Checking you’re human. Your signup will continue automatically.");
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
          : "space-y-3 rounded-xl border border-[var(--theme-border-subtle)] bg-[var(--theme-bg-card)] p-4 sm:p-5"
      }
      aria-label="Freed newsletter signup"
    >
      {!compact && <div>
        <p className="text-sm font-semibold text-[var(--theme-text-primary)]">
          Keep up with Freed.
        </p>
        <p className="mt-1 text-xs leading-relaxed text-[var(--theme-text-muted)]">
          New builds, real progress, and the thinking behind Freed. No spam.
        </p>
      </div>}

      <form
        ref={formRef}
        className="space-y-3"
        onSubmit={(event) => void submit(event)}
        noValidate
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="min-w-0 flex-1">
            <span className="mb-1 block text-xs text-[var(--theme-text-muted)]">Email address</span>
            <input
              type="email"
              inputMode="email"
              autoComplete="email"
              name="email"
              maxLength={254}
              value={email}
              onChange={(event) => {
                setEmail(event.target.value);
                pendingSubmitRef.current = false;
                setMessage("");
                setFieldErrors((errors) => ({ ...errors, email: "" }));
              }}
              onBlur={() => setFieldErrors((errors) => ({ ...errors, email: email && !EMAIL_PATTERN.test(email.trim()) ? "Enter a valid email address." : "" }))}
              aria-invalid={Boolean(fieldErrors.email)}
              aria-describedby={fieldErrors.email ? `${fieldId}-email-error` : undefined}
              placeholder="you@example.com"
              className="theme-input w-full rounded-xl px-3 py-2.5 text-sm outline-none"
              disabled={status === "submitting"}
              required
            />
            {fieldErrors.email ? <span id={`${fieldId}-email-error`} role="alert" className="mt-1 block text-xs text-[rgb(var(--theme-feedback-danger-rgb))]">{fieldErrors.email}</span> : null}
          </label>
            <label className="min-w-0 flex-1">
              <span className="mb-1 block text-xs text-[var(--theme-text-muted)]">Name</span>
              <input
                type="text"
                autoComplete="name"
                name="name"
                maxLength={120}
                value={name}
                onChange={(event) => {
                  setName(event.target.value);
                  setNameManuallyEdited(true);
                  pendingSubmitRef.current = false;
                  setMessage("");
                  setFieldErrors((errors) => ({ ...errors, name: "" }));
                }}
                onBlur={() => setFieldErrors((errors) => ({ ...errors, name: name && !name.trim() ? "Enter your name." : "" }))}
                aria-invalid={Boolean(fieldErrors.name)}
                aria-describedby={fieldErrors.name ? `${fieldId}-name-error` : undefined}
                placeholder="Your name"
                className="theme-input w-full rounded-xl px-3 py-2.5 text-sm outline-none"
                disabled={status === "submitting"}
                required
              />
              {fieldErrors.name ? <span id={`${fieldId}-name-error`} role="alert" className="mt-1 block text-xs text-[rgb(var(--theme-feedback-danger-rgb))]">{fieldErrors.name}</span> : null}
            </label>
        </div>

        <input
          type="hidden"
          name="company"
          value={company}
          onChange={(event) => setCompany(event.target.value)}
        />

        <div ref={turnstileContainerRef} className="!mt-0" />
        <button
          type="submit"
          className="btn-primary inline-flex min-h-11 w-full items-center justify-center px-5 py-2.5 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-60"
          disabled={status === "submitting"}
        >
          {status === "submitting" ? "Joining…" : "Join the newsletter"}
        </button>

        {message ? (
          <p
            className={`text-xs leading-relaxed ${status === "error" ? "text-[rgb(var(--theme-feedback-danger-rgb))]" : "text-[var(--theme-text-muted)]"}`}
            role={status === "error" ? "alert" : "status"}
          >
            {message}
          </p>
        ) : null}
      </form>

      <p className={`text-[11px] leading-relaxed text-[var(--theme-text-soft)] ${compact ? "text-center" : ""}`}>
        Unsubscribe anytime. Your email goes to our newsletter provider and
        nowhere else.
      </p>
    </section>
  );
}
