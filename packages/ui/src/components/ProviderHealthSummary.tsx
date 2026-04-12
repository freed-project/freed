import { useEffect, useState, type ReactNode } from "react";
import type {
  HealthDailyBucket,
  HealthHourlyBucket,
  ProviderHealthAttempt,
  HealthProviderId,
  ProviderHealthSnapshot,
} from "../lib/debug-store.js";
import { getHealthStatusLabel } from "../lib/provider-status.js";

export function providerHealthLabel(provider: HealthProviderId): string {
  return {
    rss: "RSS",
    x: "X",
    facebook: "Facebook",
    instagram: "Instagram",
    linkedin: "LinkedIn",
    gdrive: "Google Drive",
    dropbox: "Dropbox",
  }[provider];
}

export function formatHealthRelative(ts?: number): string {
  if (!ts) return "Never";
  const diffSeconds = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  if (diffSeconds < 60) return "just now";
  const diffMinutes = Math.floor(diffSeconds / 60);
  if (diffMinutes < 60) return `${diffMinutes.toLocaleString()}m ago`;
  const diffHours = Math.floor(diffMinutes / 60);
  if (diffHours < 24) return `${diffHours.toLocaleString()}h ago`;
  const diffDays = Math.floor(diffHours / 24);
  return `${diffDays.toLocaleString()}d ago`;
}

export function formatPauseUntil(ts?: number): string {
  if (!ts) return "Paused";
  return `Paused until ${new Date(ts).toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
  })}`;
}

function barHeight(value: number, maxValue: number): string {
  if (maxValue <= 0) return "8%";
  return `${Math.max(8, Math.round((value / maxValue) * 100))}%`;
}

export type HealthChartRange = "daily" | "hourly";

export function DurationSelect({
  value,
  onChange,
  ariaLabel,
}: {
  value: HealthChartRange;
  onChange: (value: HealthChartRange) => void;
  ariaLabel: string;
}) {
  return (
    <select
      value={value}
      aria-label={ariaLabel}
      onChange={(event) => onChange(event.target.value as HealthChartRange)}
      className="shrink-0 cursor-pointer rounded-lg border border-[var(--theme-border-subtle)] bg-[var(--theme-bg-input)] px-2.5 py-1.5 text-xs text-[var(--theme-text-primary)] focus:outline-none focus:border-[var(--theme-border-strong)]"
    >
      <option value="daily">Last 7 days</option>
      <option value="hourly">Last 24 hours</option>
    </select>
  );
}

export function HealthStatusBadge({ snapshot }: { snapshot: ProviderHealthSnapshot }) {
  const styles = {
    idle: "bg-[var(--theme-bg-muted)] text-[var(--theme-text-muted)]",
    healthy: "bg-green-500/15 text-green-400",
    degraded: "bg-amber-500/15 text-amber-400",
    paused: "bg-amber-500/15 text-amber-400",
  }[snapshot.status];

  const label =
    snapshot.status === "paused" && snapshot.lastOutcome !== "cooldown"
      ? formatPauseUntil(snapshot.pause?.pausedUntil)
      : getHealthStatusLabel(snapshot);

  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium ${styles}`}>
      {label}
    </span>
  );
}

export function ReliabilityBars({
  dailyBuckets,
}: {
  dailyBuckets: HealthDailyBucket[];
}) {
  return (
    <div className="grid grid-cols-7 gap-1">
      {dailyBuckets.map((bucket) => {
        const failure = bucket.failures > 0;
        const success = bucket.successes > 0;
        const bg = failure
          ? "bg-amber-500/80"
          : success
            ? "bg-green-500/80"
            : "bg-white/10";
        return (
          <div key={bucket.dateKey} className={`h-2 rounded-full ${bg}`} title={`${bucket.dateKey}: ${bucket.successes.toLocaleString()} ok, ${bucket.failures.toLocaleString()} fail`} />
        );
      })}
    </div>
  );
}

export function VolumeBars({
  buckets,
  metric = "itemsSeen",
  title,
}: {
  buckets: Array<HealthDailyBucket | HealthHourlyBucket>;
  metric?: "itemsSeen" | "itemsAdded" | "bytesMoved";
  title?: string;
}) {
  const values = buckets.map((bucket) => bucket[metric] ?? 0);
  const maxValue = Math.max(...values, 0);

  return (
    <div className="space-y-1">
      {title && (
        <p className="text-[10px] uppercase tracking-widest text-[var(--theme-text-soft)]">
          {title}
        </p>
      )}
      <div className="grid grid-cols-[repeat(auto-fit,minmax(0,1fr))] items-end gap-1 h-16">
        {buckets.map((bucket, index) => {
          const key = "dateKey" in bucket ? bucket.dateKey : bucket.hourKey;
          const value = values[index];
          return (
            <div key={key} className="flex h-full items-end">
              <div
                className="w-full rounded-t bg-[var(--theme-accent-secondary)]"
                style={{ height: barHeight(value, maxValue) }}
                title={`${key}: ${value.toLocaleString()}`}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}

function RecentAttemptsList({
  attempts,
}: {
  attempts: ProviderHealthAttempt[];
}) {
  return (
    <div className="space-y-2">
      <p className="text-[10px] uppercase tracking-widest text-[var(--theme-text-soft)]">
        Recent Attempts
      </p>
      {attempts.length === 0 ? (
        <p className="text-xs text-[var(--theme-text-muted)]">No attempts recorded yet.</p>
      ) : (
        attempts.slice(0, 5).map((attempt) => (
          <div key={attempt.id} className="rounded-lg bg-[var(--theme-bg-muted)] p-2 text-xs">
            <div className="flex items-center justify-between gap-3">
              <span className="font-mono text-[var(--theme-text-secondary)]">
                {new Date(attempt.finishedAt).toLocaleTimeString([], {
                  hour: "numeric",
                  minute: "2-digit",
                })}
              </span>
              <span className="text-[var(--theme-text-muted)]">{attempt.outcome}</span>
            </div>
            <p className="text-[var(--theme-text-soft)]">
              pulled {attempt.itemsSeen.toLocaleString()}, added {attempt.itemsAdded.toLocaleString()}
            </p>
            {attempt.reason && (
              <p className="text-amber-400">{attempt.reason}</p>
            )}
          </div>
        ))
      )}
    </div>
  );
}

export function ProviderHealthSummary({
  snapshot,
  defaultRange = "daily",
  showRangeSelector = true,
  showRecentAttempts = false,
  framed = true,
  showProviderInfo = true,
  actions,
}: {
  snapshot: ProviderHealthSnapshot;
  defaultRange?: HealthChartRange;
  showRangeSelector?: boolean;
  showRecentAttempts?: boolean;
  framed?: boolean;
  showProviderInfo?: boolean;
  actions?: ReactNode;
}) {
  const [selectedRange, setSelectedRange] = useState<HealthChartRange>(defaultRange);

  useEffect(() => {
    setSelectedRange(defaultRange);
  }, [defaultRange]);

  const showingHourly = selectedRange === "hourly";
  const bars = showingHourly ? snapshot.hourlyBuckets : snapshot.dailyBuckets;
  const totalSeen = bars.reduce((sum, bucket) => sum + bucket.itemsSeen, 0);
  const totalAdded = bars.reduce((sum, bucket) => sum + bucket.itemsAdded, 0);
  const rangeLabel = showingHourly ? "24h" : "7d";
  const showCurrentMessage =
    !!snapshot.currentMessage &&
    snapshot.status !== "healthy" &&
    snapshot.currentMessage !== snapshot.lastError;

  const content = (
    <>
      <div className="flex items-center justify-between gap-3">
        {showProviderInfo ? (
          <div>
            <p className="text-sm font-medium text-[var(--theme-text-primary)]">
              {providerHealthLabel(snapshot.provider)}
            </p>
            <p className="text-[11px] text-[var(--theme-text-muted)]">
              Last success {formatHealthRelative(snapshot.lastSuccessfulAt)}
            </p>
          </div>
        ) : (
          <div className="min-w-0">
            <p className="text-[11px] text-[var(--theme-text-muted)]">
              Last success {formatHealthRelative(snapshot.lastSuccessfulAt)}
            </p>
          </div>
        )}
        <div className="flex items-center gap-2">
          {showRangeSelector && (
            <DurationSelect
              value={selectedRange}
              onChange={setSelectedRange}
              ariaLabel={`${providerHealthLabel(snapshot.provider)} duration`}
            />
          )}
          <HealthStatusBadge snapshot={snapshot} />
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <VolumeBars
          buckets={bars}
          metric="itemsSeen"
          title={showingHourly ? "Pulled Per Hour" : "Pulled Per Day"}
        />
        <VolumeBars
          buckets={bars}
          metric="itemsAdded"
          title={showingHourly ? "Added Per Hour" : "Added Per Day"}
        />
      </div>

      <div className="space-y-1">
        <p className="text-[10px] uppercase tracking-widest text-[var(--theme-text-soft)]">
          Reliability (7d)
        </p>
        <ReliabilityBars dailyBuckets={snapshot.dailyBuckets} />
      </div>

      <div className="grid grid-cols-2 gap-2 text-xs">
        <div className="rounded-lg bg-[var(--theme-bg-muted)] p-2">
          <p className="text-[var(--theme-text-soft)]">Seen ({rangeLabel})</p>
          <p className="font-mono text-[var(--theme-text-secondary)]">
            {totalSeen.toLocaleString()}
          </p>
        </div>
        <div className="rounded-lg bg-[var(--theme-bg-muted)] p-2">
          <p className="text-[var(--theme-text-soft)]">Added ({rangeLabel})</p>
          <p className="font-mono text-[var(--theme-text-secondary)]">
            {totalAdded.toLocaleString()}
          </p>
        </div>
      </div>

      {showRecentAttempts && showingHourly && (
        <RecentAttemptsList attempts={snapshot.latestAttempts} />
      )}

      {actions && (
        <div className="flex flex-wrap gap-2">
          {actions}
        </div>
      )}

      {showCurrentMessage && (
        <p className="text-xs text-[var(--theme-text-muted)]">{snapshot.currentMessage}</p>
      )}
      {snapshot.lastError && (
        <p className="text-xs text-amber-400">{snapshot.lastError}</p>
      )}
    </>
  );

  if (!framed) {
    return <div className="space-y-3">{content}</div>;
  }

  return (
    <div className="space-y-3 rounded-xl border border-white/10 bg-white/[0.03] p-3">
      {content}
    </div>
  );
}
