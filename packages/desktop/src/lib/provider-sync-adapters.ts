import {
  runBackgroundJob,
  type BackgroundRuntimeTask,
} from "./background-runtime-coordinator";
import {
  refreshSocialProvider,
  type SocialProviderRefreshResult,
} from "./capture";
import type { AutomaticSyncProvider } from "./provider-sync-cadence";

export interface ProviderSyncAdapter {
  readonly provider: AutomaticSyncProvider;
  readonly coordinatesOwnBackgroundJob: boolean;
  runScheduled(onProviderContact: () => void): Promise<SocialProviderRefreshResult>;
}

function adapter(
  provider: AutomaticSyncProvider,
  coordinatesOwnBackgroundJob: boolean,
): ProviderSyncAdapter {
  return Object.freeze({
    provider,
    coordinatesOwnBackgroundJob,
    runScheduled: (onProviderContact: () => void) =>
      refreshSocialProvider(provider, "scheduled", onProviderContact),
  });
}

const PROVIDER_SYNC_ADAPTERS: Readonly<
  Record<AutomaticSyncProvider, ProviderSyncAdapter>
> = Object.freeze({
  x: adapter("x", false),
  facebook: adapter("facebook", true),
  instagram: adapter("instagram", true),
  linkedin: adapter("linkedin", true),
  youtube: adapter("youtube", false),
  substack: adapter("substack", true),
  medium: adapter("medium", true),
});

export async function runScheduledProviderAdapter(
  provider: AutomaticSyncProvider,
  onProviderContact: () => void,
): Promise<SocialProviderRefreshResult> {
  const selected = PROVIDER_SYNC_ADAPTERS[provider];
  if (selected.coordinatesOwnBackgroundJob) {
    return selected.runScheduled(onProviderContact);
  }
  const task: BackgroundRuntimeTask<SocialProviderRefreshResult> = {
    kind: "social-scrape",
    source: `provider-scheduler:${provider}`,
    timeoutMs: 12 * 60 * 1_000,
    retainUntilSettledAfterTimeout: true,
    run: () => selected.runScheduled(onProviderContact),
  };
  return runBackgroundJob(task);
}
