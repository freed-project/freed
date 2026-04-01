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
      className="text-[#c4b5fd] hover:text-white underline underline-offset-2 transition-colors"
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
    const docs = [LEGAL_DOCS.terms, LEGAL_DOCS.privacy, LEGAL_DOCS["experimental-risk"]];
    if (includeEula) docs.splice(1, 0, LEGAL_DOCS.eula);
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
    <div className="fixed inset-0 z-[120] bg-[#09090b] text-white">
      <div className="min-h-screen px-4 py-8 sm:px-6 lg:px-8 flex items-center justify-center">
        <div className="w-full max-w-2xl rounded-3xl border border-white/10 bg-[rgba(15,15,20,0.96)] shadow-[0_24px_80px_rgba(0,0,0,0.45)] overflow-hidden">
          <div className="px-6 py-5 sm:px-8 sm:py-7 border-b border-white/10 bg-gradient-to-r from-[#312e81]/25 via-[#111827] to-[#7c2d12]/20">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#c4b5fd]">
              Before You Continue
            </p>
            <h1 className="mt-2 text-2xl sm:text-3xl font-semibold">
              {productName} is a live experiment with sharp edges.
            </h1>
            <p className="mt-3 text-sm sm:text-base text-[#d4d4d8] leading-relaxed">
              Freed is local-first and does not phone home, but some features can still go badly sideways.
              Third-party providers can rate limit you, lock your account, force re-authentication,
              or ban you outright.
            </p>
          </div>

          <div className="px-6 py-6 sm:px-8 sm:py-7 space-y-6">
            <div className="rounded-2xl border border-amber-500/25 bg-amber-500/8 p-4">
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

            <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
              <p className="text-sm font-semibold text-white">
                Read these documents
              </p>
              <div className="mt-3 flex flex-wrap gap-x-3 gap-y-2 text-sm text-[#d4d4d8]">
                {documentList.map((doc, index) => (
                  <span key={doc.id}>
                    <LegalLink href={doc.url} label={doc.label} openUrl={openUrl} />
                    {index < documentList.length - 1 ? <span className="ml-3 text-white/30">•</span> : null}
                  </span>
                ))}
              </div>
            </div>

            <label className="flex items-start gap-3 rounded-2xl border border-white/10 bg-white/5 p-4 cursor-pointer">
              <input
                type="checkbox"
                checked={checked}
                onChange={(event) => setChecked(event.target.checked)}
                className="mt-1 h-4 w-4 rounded border-white/20 bg-[#18181b] text-[#8b5cf6] focus:ring-[#8b5cf6]"
              />
              <span className="text-sm text-[#e4e4e7] leading-relaxed">
                I have read and agree to the{" "}
                <LegalLink href={LEGAL_DOCS.terms.url} label={LEGAL_DOCS.terms.label} openUrl={openUrl} />,{" "}
                {includeEula ? (
                  <>
                    <LegalLink href={LEGAL_DOCS.eula.url} label={LEGAL_DOCS.eula.label} openUrl={openUrl} />,{" "}
                  </>
                ) : null}
                <LegalLink href={LEGAL_DOCS.privacy.url} label={LEGAL_DOCS.privacy.label} openUrl={openUrl} />, and{" "}
                <LegalLink
                  href={LEGAL_DOCS["experimental-risk"].url}
                  label={LEGAL_DOCS["experimental-risk"].label}
                  openUrl={openUrl}
                />
                . I understand that some features can damage or terminate my access to third-party accounts.
              </span>
            </label>

            <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-3">
              <button
                type="button"
                onClick={() => {
                  void handleDecline();
                }}
                className="px-4 py-2.5 rounded-xl border border-white/10 bg-white/5 text-sm text-[#d4d4d8] hover:bg-white/10 transition-colors"
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
                className="px-4 py-2.5 rounded-xl bg-[#8b5cf6] text-sm font-semibold text-white hover:bg-[#7c3aed] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
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
