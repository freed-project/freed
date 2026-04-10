import { ProviderStatusIndicator } from "@freed/ui/components/ProviderStatusIndicator";
import { usePlatform } from "@freed/ui/context";
import { useDebugStore } from "@freed/ui/lib/debug-store";
import { useAppStore } from "../lib/store";
import { getDesktopSourceStatus } from "../lib/source-status";

export function XSourceIndicator({ sourceId }: { sourceId: string }) {
  const { getSourceStatus } = usePlatform();
  const xAuth = useAppStore((s) => s.xAuth);
  const fbAuth = useAppStore((s) => s.fbAuth);
  const igAuth = useAppStore((s) => s.igAuth);
  const liAuth = useAppStore((s) => s.liAuth);
  const providerSyncCounts = useAppStore((s) => s.providerSyncCounts);
  const itemCountByPlatform = useAppStore((s) => s.itemCountByPlatform);
  const feeds = useAppStore((s) => s.feeds);
  const health = useDebugStore((s) => s.health);

  const status =
    getSourceStatus?.(sourceId) ??
    getDesktopSourceStatus(
      sourceId,
      {
        feeds,
        providerSyncCounts,
        itemCountByPlatform,
        xAuth,
        fbAuth,
        igAuth,
        liAuth,
      },
      health,
    );

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
