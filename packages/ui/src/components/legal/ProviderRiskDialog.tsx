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
        className="my-auto flex max-h-[calc(100dvh-2rem)] w-full max-w-lg flex-col overflow-hidden rounded-3xl border border-white/10 bg-[#101014] shadow-[0_24px_80px_rgba(0,0,0,0.45)] sm:max-h-[calc(100dvh-3rem)]"
      >
        <div className="shrink-0 px-6 py-5 border-b border-white/10 bg-gradient-to-r from-[#7f1d1d]/25 via-[#111827] to-[#312e81]/25">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-amber-300">
            High Risk Source
          </p>
          <h2 className="mt-2 text-xl font-semibold text-white">
            {providerLabel} can retaliate against this behavior.
          </h2>
          <p className="mt-3 text-sm text-[#d4d4d8] leading-relaxed">
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

          <div className="text-sm text-[#d4d4d8] leading-relaxed">
            Review the{" "}
            <button
              type="button"
              onClick={() => openLegalUrl(LEGAL_DOCS.eula.url, openUrl)}
              className="text-[#c4b5fd] hover:text-white underline underline-offset-2 transition-colors"
            >
              Desktop EULA
            </button>{" "}
            and{" "}
            <button
              type="button"
              onClick={() => openLegalUrl(LEGAL_DOCS.terms.url, openUrl)}
              className="text-[#c4b5fd] hover:text-white underline underline-offset-2 transition-colors"
            >
              Terms of Use
            </button>
            .
          </div>

          <label className="flex items-start gap-3 rounded-2xl border border-white/10 bg-white/5 p-4 cursor-pointer">
            <input
              type="checkbox"
              checked={checked}
              onChange={(event) => setChecked(event.target.checked)}
              className="mt-1 h-4 w-4 rounded border-white/20 bg-[#18181b] text-[#8b5cf6] focus:ring-[#8b5cf6]"
            />
            <span className="text-sm text-[#e4e4e7] leading-relaxed">
              I understand the risk of using Freed with {providerLabel}, including rate limits,
              forced re-authentication, temporary locks, and permanent account bans.
            </span>
          </label>

          <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-3">
            <button
              type="button"
              onClick={handleClose}
              className="px-4 py-2.5 rounded-xl border border-white/10 bg-white/5 text-sm text-[#d4d4d8] hover:bg-white/10 transition-colors"
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
              className="px-4 py-2.5 rounded-xl bg-[#8b5cf6] text-sm font-semibold text-white hover:bg-[#7c3aed] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {submitting ? "Saving..." : `Continue with ${providerLabel}`}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
