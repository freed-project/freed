import { useMemo } from "react";
import { useDebugStore, type HealthProviderId } from "@freed/ui/lib/debug-store";
import { formatClockTime } from "@freed/ui/lib/date-format";
import { SettingsListPanel } from "@freed/ui/components/settings/SettingsListPanel";
import { useAppStore } from "../lib/store";

const PROVIDER_PREFIX: Partial<Record<HealthProviderId, string>> = {
  x: "[X]",
  facebook: "[FB]",
  instagram: "[IG]",
  linkedin: "[LI]",
  rss: "[RSS]",
};

export function ProviderActivityLog({
  provider,
  title = "Scrape log",
}: {
  provider: HealthProviderId;
  title?: string;
}) {
  const prefix = PROVIDER_PREFIX[provider];
  const events = useDebugStore((state) => state.events);
  const syncing = useAppStore((state) => (state.providerSyncCounts[provider] ?? 0) > 0);

  if (!prefix) return null;

  const lines = useMemo(
    () =>
      events
        .filter((event) => event.detail?.startsWith(prefix))
        .slice(0, 10)
        .reverse()
        .map((event) => ({
          event,
          formattedTime: formatClockTime(event.ts),
        })),
    [events, prefix],
  );

  if (!syncing && lines.length === 0) {
    return null;
  }

  return (
    <div className="space-y-2 rounded-xl border border-[var(--theme-border-subtle)] bg-[var(--theme-bg-card)] px-3 py-3">
      <div className="flex items-center justify-between gap-3">
        <p className="text-[11px] uppercase tracking-[0.18em] text-[var(--theme-text-soft)]">
          {title}
        </p>
        {syncing && (
          <span className="inline-flex items-center gap-2 text-[11px] text-emerald-400">
            <span className="h-3 w-3 rounded-full border border-current border-t-transparent animate-spin" />
            Live
          </span>
        )}
      </div>

      {lines.length > 0 ? (
        <SettingsListPanel
          items={lines}
          searchPlaceholder="Filter log"
          ariaLabel={`Filter ${provider} scrape log`}
          emptyLabel="No scraper output yet."
          noMatchesLabel="No log lines match that filter."
          dataTestId={`provider-activity-log-${provider}`}
          searchDataTestId={`provider-activity-log-filter-${provider}`}
          scrollDataTestId={`provider-activity-log-scroll-${provider}`}
          className="border-0 bg-[var(--theme-bg-muted)] p-2"
          listClassName="space-y-1 font-mono text-[11px] text-[var(--theme-text-secondary)]"
          itemKey={(line) => line.event.id}
          getSearchText={(line) => `${line.formattedTime} ${line.event.detail}`}
          renderItem={(line) => (
            <div className="flex gap-2 leading-relaxed">
              <span className="shrink-0 text-[var(--theme-text-muted)]">{line.formattedTime}</span>
              <span className="break-words text-[var(--theme-text-primary)]">{line.event.detail}</span>
            </div>
          )}
        />
      ) : (
        <p
          className="rounded-lg bg-[var(--theme-bg-muted)] px-2 py-2 text-[11px] text-[var(--theme-text-muted)]"
          data-testid={`provider-activity-log-${provider}`}
        >
          Waiting for scraper output...
        </p>
      )}
    </div>
  );
}
