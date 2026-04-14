import { useMemo, useState } from "react";
import { LEGAL_DOCS } from "@freed/shared";

interface LegalGateProps {
  productName: string;
  includeEula?: boolean;
  acceptLabel?: string;
  declineLabel?: string;
  openUrl?: (url: string) => void;
  onAccept: () => Promise<void> | void;
  onDecline: () => Promise<void> | void;
}

function openLegalUrl(url: string, openUrl?: (url: string) => void) {
  if (openUrl) {
    openUrl(url);
    return;
  }
  window.open(url, "_blank", "noopener,noreferrer");
}

function LegalLink({
  href,
  label,
  openUrl,
}: {
  href: string;
  label: string;
  openUrl?: (url: string) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => openLegalUrl(href, openUrl)}
      className="theme-card-soft inline-flex items-center rounded-full px-3 py-1.5 text-sm font-medium text-text-secondary transition-colors hover:text-text-primary"
    >
      {label}
    </button>
  );
}

export function LegalGate({
  productName,
  includeEula = false,
  acceptLabel = "Agree and continue",
  declineLabel = "Decline",
  openUrl,
  onAccept,
  onDecline,
}: LegalGateProps) {
  const [checked, setChecked] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const documentList = useMemo(() => {
    const docs = [LEGAL_DOCS.terms];
    docs.push(LEGAL_DOCS.privacy);
    if (includeEula) docs.push(LEGAL_DOCS.eula);
    return docs;
  }, [includeEula]);

  const handleAccept = async () => {
    if (!checked || submitting) return;
    setSubmitting(true);
    try {
      await onAccept();
    } finally {
      setSubmitting(false);
    }
  };

  const handleDecline = async () => {
    if (submitting) return;
    setSubmitting(true);
    try {
      await onDecline();
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[120] app-theme-shell text-text-primary">
      <div className="flex min-h-full items-start justify-center overflow-y-auto px-4 py-4 sm:items-center sm:px-6 sm:py-8 lg:px-8">
        <div className="theme-dialog-shell flex max-h-[calc(100dvh-2rem)] w-full max-w-4xl flex-col overflow-hidden sm:max-h-[calc(100dvh-3rem)]">
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

          <div className="relative z-10 overflow-y-auto px-6 pt-6 pb-8 sm:px-10 sm:pt-10 sm:pb-10">
            <div className="mx-auto max-w-2xl text-center">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--theme-accent-secondary)]">
                Before You Continue
              </p>
              <h1 className="mt-3 text-3xl font-bold text-text-primary sm:text-4xl">
                Use <span className="theme-heading-accent">{productName}</span> carefully.
              </h1>
              <p className="mt-3 text-sm leading-relaxed text-text-secondary sm:text-base">
                {productName} is local-first and does not phone home. Third-party social providers can
                rate limit you, lock your account, or even potentially close your account if they are
                able to detect you're using Freed and they're feeling particularly Machiavellian.
              </p>
            </div>

            <div className="mt-8 grid gap-0 lg:grid-cols-2 lg:items-start">
              <div className="pb-6 lg:pr-8">
                <h2 className="text-2xl font-bold text-text-primary">
                  What you are agreeing to
                </h2>
                <ul className="mt-5 space-y-3 text-sm leading-relaxed text-text-secondary sm:text-base">
                  <li>You are using experimental software that may break or change without notice.</li>
                  <li>You decide whether to connect any account to third-party social providers.</li>
                  <li>Those providers can throttle you, force re-authentication, temporarily lock you out, or close your account.</li>
                  <li>{productName} is provided as-is, without promises of uptime, compatibility, or account safety.</li>
                </ul>
              </div>

              <div className="lg:border-l lg:border-[color:color-mix(in_srgb,var(--theme-border-subtle)_70%,transparent)] lg:pl-8">
                <h2 className="text-2xl font-bold text-text-primary">
                  Read first
                </h2>
                <p className="mt-3 text-sm leading-relaxed text-text-secondary">
                  Read the documents below before you accept. They are short, but the social platforms are not known for their sense of humor.
                </p>
                <div className="mt-5 flex flex-wrap gap-3">
                  {documentList.map((doc) => (
                    <LegalLink key={doc.id} href={doc.url} label={doc.label} openUrl={openUrl} />
                  ))}
                </div>
              </div>
            </div>

            <label className="theme-card-soft mt-8 flex cursor-pointer items-start gap-3 rounded-2xl p-4 sm:p-5">
              <input
                type="checkbox"
                checked={checked}
                onChange={(event) => setChecked(event.target.checked)}
                className="mt-1 h-4 w-4 rounded border-[color:var(--theme-border)] bg-[var(--theme-bg-root)] text-[var(--theme-accent-secondary)] focus:ring-[var(--theme-accent-secondary)]"
              />
              <span className="text-sm leading-relaxed text-text-secondary">
                I have read and agree to the{" "}
                <LegalLink href={LEGAL_DOCS.terms.url} label={LEGAL_DOCS.terms.label} openUrl={openUrl} />,{" "}
                <LegalLink href={LEGAL_DOCS.privacy.url} label={LEGAL_DOCS.privacy.label} openUrl={openUrl} />
                {includeEula ? (
                  <>
                    , and{" "}
                    <LegalLink href={LEGAL_DOCS.eula.url} label={LEGAL_DOCS.eula.label} openUrl={openUrl} />
                    .
                  </>
                ) : (
                  "."
                )}
                I understand that third-party social providers can rate limit, lock, or close accounts connected to Freed activity.
              </span>
            </label>

            <div className="mt-8 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
              <button
                type="button"
                onClick={() => {
                  void handleDecline();
                }}
                className="btn-secondary px-4 py-2.5 text-sm"
              >
                {declineLabel}
              </button>
              <button
                type="button"
                data-testid="legal-gate-accept"
                onClick={() => {
                  void handleAccept();
                }}
                disabled={!checked || submitting}
                className="btn-primary px-4 py-2.5 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-50"
              >
                {submitting ? "Saving..." : acceptLabel}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
