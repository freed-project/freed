import { LEGAL_BUNDLE_VERSION, LEGAL_DOCS } from "@freed/shared";
import { getPwaBundleAcceptance } from "../lib/legal-consent";

export function PwaLegalSettingsSection() {
  const acceptance = getPwaBundleAcceptance();

  return (
    <div className="space-y-4">
      <div className="rounded-xl bg-[var(--theme-bg-card)] p-4">
        <p className="text-sm text-[var(--theme-text-secondary)]">Accepted legal bundle</p>
        <p className="mt-1 font-mono text-sm text-[var(--theme-text-primary)]">{LEGAL_BUNDLE_VERSION}</p>
        <p className="mt-1 text-xs text-[var(--theme-text-soft)]">
          {acceptance?.acceptedAt
            ? `Accepted on ${new Date(acceptance.acceptedAt).toLocaleString()}`
            : "Not accepted on this browser"}
        </p>
      </div>

      <div className="rounded-xl bg-[var(--theme-bg-card)] p-4">
        <p className="text-sm text-[var(--theme-text-secondary)]">Documents</p>
        <div className="mt-2 flex flex-wrap gap-x-3 gap-y-2 text-sm">
          {Object.values(LEGAL_DOCS).map((doc) => (
            <a
              key={doc.id}
              href={doc.url}
              target="_blank"
              rel="noopener noreferrer"
              className="underline underline-offset-2 text-[var(--theme-accent-secondary)] transition-colors hover:text-[var(--theme-text-primary)]"
            >
              {doc.label}
            </a>
          ))}
        </div>
      </div>

      <div className="theme-feedback-panel-warning rounded-xl p-4">
        <p className="theme-feedback-text-warning text-sm">
          Provider-specific risk consent lives in Freed Desktop. The PWA only stores the first-run legal gate.
        </p>
      </div>
    </div>
  );
}
