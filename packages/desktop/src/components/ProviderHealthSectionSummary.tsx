import { ProviderHealthSummary } from "@freed/ui/components/ProviderHealthSummary";
import { useDebugStore, type HealthProviderId } from "@freed/ui/lib/debug-store";
import { ProviderActivityLog } from "./ProviderActivityLog";

export function ProviderHealthSectionSummary({
  provider,
  showMessages = false,
}: {
  provider: HealthProviderId;
  showMessages?: boolean;
}) {
  const health = useDebugStore((state) => state.health);
  const snapshot = health?.providers[provider];
  if (!snapshot) {
    return <ProviderActivityLog provider={provider} />;
  }

  return (
    <div className="space-y-3">
      <ProviderHealthSummary
        snapshot={snapshot}
        defaultRange="hourly"
        framed={false}
        showProviderInfo={false}
        showMessages={showMessages}
      />
      <ProviderActivityLog provider={provider} />
    </div>
  );
}
