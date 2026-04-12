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
      className="text-[var(--theme-accent-secondary)] hover:text-text-primary underline underline-offset-2 transition-colors"
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
        <div className="theme-dialog-shell flex max-h-[calc(100dvh-2rem)] w-full max-w-2xl flex-col sm:max-h-[calc(100dvh-3rem)]">
          <div className="theme-dialog-divider shrink-0 border-b bg-[linear-gradient(90deg,color-mix(in_srgb,var(--theme-accent-secondary)_18%,transparent),color-mix(in_srgb,var(--theme-bg-surface)_92%,transparent),color-mix(in_srgb,var(--theme-accent-tertiary)_12%,transparent))] px-6 py-5 sm:px-8 sm:py-7">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--theme-accent-secondary)]">
              Before You Continue
            </p>
            <h1 className="mt-2 text-2xl sm:text-3xl font-semibold">
              {productName} is a live experiment with sharp edges.
            </h1>
            <p className="mt-3 text-sm leading-relaxed text-text-secondary sm:text-base">
              Freed is local-first and does not phone home, but some features can still go badly sideways.
              Third-party providers can rate limit you, lock your account, force re-authentication,
              or ban you outright.
            </p>
          </div>

          <div className="overflow-y-auto px-6 py-6 sm:px-8 sm:py-7 space-y-6">
            <div className="theme-dialog-section rounded-2xl p-4">
              <p className="text-sm font-semibold text-amber-300">
                What you are agreeing to
              </p>
              <ul className="mt-3 space-y-2 text-sm text-amber-100/85">
                <li>You are using experimental software that may break or change without notice.</li>
                <li>You are responsible for deciding whether to connect any account or provider.</li>
                <li>Some social features can trigger throttling, forced logouts, temporary locks, or permanent bans.</li>
                <li>Freed is provided as-is, without promises of safety, uptime, or compatibility.</li>
              </ul>
            </div>

            <div className="theme-dialog-section rounded-2xl p-4">
              <p className="text-sm font-semibold text-text-primary">
                Read these documents
              </p>
              <div className="mt-3 flex flex-wrap gap-x-3 gap-y-2 text-sm text-text-secondary">
                {documentList.map((doc, index) => (
                  <span key={doc.id}>
                    <LegalLink href={doc.url} label={doc.label} openUrl={openUrl} />
                    {index < documentList.length - 1 ? <span className="ml-3 text-text-muted/60">•</span> : null}
                  </span>
                ))}
              </div>
            </div>

            <label className="theme-card-soft flex cursor-pointer items-start gap-3 rounded-2xl p-4">
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
                I understand that some features can damage or terminate my access to third-party accounts.
              </span>
            </label>

            <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-3">
              <button
                type="button"
                onClick={() => {
                  void handleDecline();
                }}
                className="px-4 py-2.5 rounded-xl border border-[color:var(--theme-border)] bg-[color:color-mix(in_srgb,var(--theme-bg-surface)_72%,transparent)] text-sm text-text-secondary transition-colors hover:bg-[color:color-mix(in_srgb,var(--theme-bg-surface)_90%,transparent)]"
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
