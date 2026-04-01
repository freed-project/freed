import { useEffect, useState } from "react";
import {
  LEGAL_BUNDLE_VERSION,
  LEGAL_DOCS,
  PLATFORM_LABELS,
  PROVIDER_RISK_VERSIONS,
  type LegalAcceptanceRecord,
  type ProviderRiskId,
} from "@freed/shared";
import { open as shellOpen } from "@tauri-apps/plugin-shell";
import {
  getDesktopBundleAcceptance,
  getProviderRiskAcceptance,
} from "../lib/legal-consent";

const PROVIDERS: ProviderRiskId[] = ["x", "facebook", "instagram", "linkedin"];

export function DesktopLegalSettingsSection() {
  const [bundleAcceptance, setBundleAcceptance] =
    useState<LegalAcceptanceRecord | null>(null);
  const [providerAcceptance, setProviderAcceptance] = useState<
    Partial<Record<ProviderRiskId, LegalAcceptanceRecord | null>>
  >({});

  useEffect(() => {
    void (async () => {
      setBundleAcceptance(await getDesktopBundleAcceptance());
      const nextEntries = await Promise.all(
        PROVIDERS.map(async (provider) => [
          provider,
          await getProviderRiskAcceptance(provider),
        ] as const),
      );
      setProviderAcceptance(Object.fromEntries(nextEntries));
    })();
  }, []);

  return (
    <div className="space-y-4">
      <div className="rounded-xl bg-white/5 p-4">
        <p className="text-sm text-[#a1a1aa]">Accepted legal bundle</p>
        <p className="mt-1 text-sm text-white font-mono">{LEGAL_BUNDLE_VERSION}</p>
        <p className="mt-1 text-xs text-[#52525b]">
          {bundleAcceptance?.acceptedAt
            ? `Accepted on ${new Date(bundleAcceptance.acceptedAt).toLocaleString()}`
            : "Not accepted on this device"}
        </p>
      </div>

      <div className="rounded-xl bg-white/5 p-4">
        <p className="text-sm text-[#a1a1aa]">Provider risk versions</p>
        <div className="mt-3 space-y-3">
          {PROVIDERS.map((provider) => {
            const record = providerAcceptance[provider];
            return (
              <div key={provider} className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-sm text-white">{PLATFORM_LABELS[provider]}</p>
                  <p className="text-xs text-[#52525b] font-mono">
                    {PROVIDER_RISK_VERSIONS[provider]}
                  </p>
                </div>
                <p className="text-xs text-right text-[#a1a1aa]">
                  {record?.acceptedAt
                    ? `Accepted ${new Date(record.acceptedAt).toLocaleString()}`
                    : "Not accepted yet"}
                </p>
              </div>
            );
          })}
        </div>
      </div>

      <div className="rounded-xl bg-white/5 p-4">
        <p className="text-sm text-[#a1a1aa]">Documents</p>
        <div className="mt-2 flex flex-wrap gap-x-3 gap-y-2 text-sm">
          {Object.values(LEGAL_DOCS).map((doc) => (
            <button
              key={doc.id}
              type="button"
              onClick={() => {
                void shellOpen(doc.url);
              }}
              className="text-[#c4b5fd] underline underline-offset-2 hover:text-white transition-colors"
            >
              {doc.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
