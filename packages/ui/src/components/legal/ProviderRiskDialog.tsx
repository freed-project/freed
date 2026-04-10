import { useState } from "react";
import {
  LEGAL_DOCS,
  PLATFORM_LABELS,
  type ProviderRiskId,
} from "@freed/shared";

interface ProviderRiskDialogProps {
  open: boolean;
  provider: ProviderRiskId;
  openUrl?: (url: string) => void;
  onAccept: () => Promise<void> | void;
  onClose: () => void;
}

function openLegalUrl(url: string, openUrl?: (url: string) => void) {
  if (openUrl) {
    openUrl(url);
    return;
  }
  window.open(url, "_blank", "noopener,noreferrer");
}

export function ProviderRiskDialog({
  open,
  provider,
  openUrl,
  onAccept,
  onClose,
}: ProviderRiskDialogProps) {
  const [checked, setChecked] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  if (!open) return null;

  const providerLabel = PLATFORM_LABELS[provider];

  const handleAccept = async () => {
    if (!checked || submitting) return;
    setSubmitting(true);
    try {
      await onAccept();
      setChecked(false);
    } finally {
      setSubmitting(false);
    }
  };

  const handleClose = () => {
    if (submitting) return;
    setChecked(false);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-[130] flex items-start justify-center overflow-y-auto bg-black/70 px-4 py-4 sm:items-center sm:py-6">
      <div
        data-testid={`provider-risk-dialog-${provider}`}
        className="my-auto flex max-h-[calc(100dvh-2rem)] w-full max-w-lg flex-col overflow-hidden rounded-3xl border border-[var(--theme-border-subtle)] bg-[color:color-mix(in_oklab,var(--theme-bg-surface)_97%,transparent)] shadow-[0_24px_80px_rgba(0,0,0,0.35)] sm:max-h-[calc(100dvh-3rem)]"
      >
        <div className="shrink-0 border-b border-[var(--theme-border-subtle)] bg-[linear-gradient(135deg,rgb(127_29_29_/_0.16),color-mix(in_oklab,var(--theme-bg-surface)_88%,transparent),rgb(var(--theme-accent-secondary-rgb)_/_0.14))] px-6 py-5">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-amber-300">
            High Risk Source
          </p>
          <h2 className="mt-2 text-xl font-semibold text-[var(--theme-text-primary)]">
            {providerLabel} can retaliate against this behavior.
          </h2>
          <p className="mt-3 text-sm leading-relaxed text-[var(--theme-text-secondary)]">
            Connecting {providerLabel} can trigger checkpoints, forced logouts, account reviews,
            temporary locks, or permanent bans. If that risk is not acceptable, back away slowly
            and keep your fingers out of the machine.
          </p>
        </div>

        <div
          data-testid={`provider-risk-dialog-body-${provider}`}
          className="overflow-y-auto px-6 py-6 space-y-5"
        >
          <div className="rounded-2xl border border-amber-500/25 bg-amber-500/8 p-4">
            <p className="text-sm text-amber-100/90">
              Use Freed only with accounts and content you are authorized to access. Do not use it on employer,
              client, school, or regulated accounts unless you are fully prepared for the fallout.
            </p>
          </div>

          <div className="text-sm leading-relaxed text-[var(--theme-text-secondary)]">
            Review the{" "}
            <button
              type="button"
              onClick={() => openLegalUrl(LEGAL_DOCS.eula.url, openUrl)}
              className="theme-link underline underline-offset-2 transition-colors hover:text-[var(--theme-text-primary)]"
            >
              Desktop EULA
            </button>{" "}
            and{" "}
            <button
              type="button"
              onClick={() => openLegalUrl(LEGAL_DOCS.terms.url, openUrl)}
              className="theme-link underline underline-offset-2 transition-colors hover:text-[var(--theme-text-primary)]"
            >
              Terms of Use
            </button>
            .
          </div>

          <label className="flex cursor-pointer items-start gap-3 rounded-2xl border border-[var(--theme-border-subtle)] bg-[var(--theme-bg-muted)] p-4">
            <input
              type="checkbox"
              checked={checked}
              onChange={(event) => setChecked(event.target.checked)}
              className="mt-1 h-4 w-4 rounded border-[var(--theme-border-quiet)] bg-[var(--theme-bg-card)] text-[var(--theme-accent-secondary)] focus:ring-[var(--theme-accent-secondary)]"
            />
            <span className="text-sm leading-relaxed text-[var(--theme-text-primary)]">
              I understand the risk of using Freed with {providerLabel}, including rate limits,
              forced re-authentication, temporary locks, and permanent account bans.
            </span>
          </label>

          <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-3">
            <button
              type="button"
              onClick={handleClose}
              className="rounded-xl border border-[var(--theme-border-subtle)] bg-[var(--theme-bg-muted)] px-4 py-2.5 text-sm text-[var(--theme-text-secondary)] transition-colors hover:bg-[var(--theme-bg-card-hover)]"
            >
              Cancel
            </button>
            <button
              type="button"
              data-testid={`provider-risk-accept-${provider}`}
              onClick={() => {
                void handleAccept();
              }}
              disabled={!checked || submitting}
              className="btn-primary rounded-xl px-4 py-2.5 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-50"
            >
              {submitting ? "Saving..." : `Continue with ${providerLabel}`}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
