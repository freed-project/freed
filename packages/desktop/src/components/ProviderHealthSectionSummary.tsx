import { useState } from "react";
import { ProviderHealthSummary } from "@freed/ui/components/ProviderHealthSummary";
import { useDebugStore, type HealthProviderId } from "@freed/ui/lib/debug-store";
import { clearProviderPause } from "../lib/provider-health";

export function ProviderHealthSectionSummary({
  provider,
}: {
  provider: HealthProviderId;
}) {
  const health = useDebugStore((state) => state.health);
  const [resuming, setResuming] = useState(false);

  const snapshot = health?.providers[provider];
  if (!snapshot) return null;

  return (
    <div className="space-y-3">
      <ProviderHealthSummary snapshot={snapshot} hourly />
      {snapshot.pause && snapshot.pause.pausedUntil > Date.now() && (
        <button
          onClick={() => {
            setResuming(true);
            void clearProviderPause(provider).finally(() => setResuming(false));
          }}
          disabled={resuming}
          className="text-sm px-3 py-2 rounded-xl bg-white/5 text-[#a1a1aa] hover:bg-white/10 hover:text-white transition-colors disabled:opacity-50"
        >
          {resuming ? "Resuming..." : "Resume now"}
        </button>
      )}
    </div>
  );
}
