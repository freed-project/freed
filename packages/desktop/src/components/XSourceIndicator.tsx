import { ProviderStatusIndicator } from "@freed/ui/components/ProviderStatusIndicator";
import { usePlatform } from "@freed/ui/context";

export function XSourceIndicator({ sourceId }: { sourceId: string }) {
  const { getSourceStatus } = usePlatform();
  const status = getSourceStatus?.(sourceId) ?? null;

  if (!status) return null;

  return (
    <ProviderStatusIndicator
      tone={status.tone}
      syncing={status.syncing}
      label={status.label}
      testId={`source-indicator-${sourceId}`}
      size="xxs"
    />
  );
}
