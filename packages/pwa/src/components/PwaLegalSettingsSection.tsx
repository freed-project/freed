import { LEGAL_BUNDLE_VERSION, LEGAL_DOCS } from "@freed/shared";
import { getPwaBundleAcceptance } from "../lib/legal-consent";

export function PwaLegalSettingsSection() {
  const acceptance = getPwaBundleAcceptance();

  return (
    <div className="space-y-4">
      <div className="rounded-xl bg-white/5 p-4">
        <p className="text-sm text-[#a1a1aa]">Accepted legal bundle</p>
        <p className="mt-1 text-sm text-white font-mono">{LEGAL_BUNDLE_VERSION}</p>
        <p className="mt-1 text-xs text-[#52525b]">
          {acceptance?.acceptedAt
            ? `Accepted on ${new Date(acceptance.acceptedAt).toLocaleString()}`
            : "Not accepted on this browser"}
        </p>
      </div>

      <div className="rounded-xl bg-white/5 p-4">
        <p className="text-sm text-[#a1a1aa]">Documents</p>
        <div className="mt-2 flex flex-wrap gap-x-3 gap-y-2 text-sm">
          {Object.values(LEGAL_DOCS).map((doc) => (
            <a
              key={doc.id}
              href={doc.url}
              target="_blank"
              rel="noopener noreferrer"
              className="text-[#c4b5fd] underline underline-offset-2 hover:text-white transition-colors"
            >
              {doc.label}
            </a>
          ))}
        </div>
      </div>

      <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-4">
        <p className="text-sm text-amber-200">
          Provider-specific risk consent lives in Freed Desktop. The PWA only stores the first-run legal gate.
        </p>
      </div>
    </div>
  );
}
