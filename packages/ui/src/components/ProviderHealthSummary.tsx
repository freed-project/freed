import type {
  HealthDailyBucket,
  HealthHourlyBucket,
  HealthProviderId,
  ProviderHealthSnapshot,
} from "../lib/debug-store.js";

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

export function HealthStatusBadge({ snapshot }: { snapshot: ProviderHealthSnapshot }) {
  const styles = {
    idle: "bg-white/5 text-[#71717a]",
    healthy: "bg-green-500/15 text-green-400",
    degraded: "bg-amber-500/15 text-amber-400",
    paused: "bg-red-500/15 text-red-400",
  }[snapshot.status];

  const label =
    snapshot.status === "paused"
      ? formatPauseUntil(snapshot.pause?.pausedUntil)
      : snapshot.status === "healthy"
        ? "Healthy"
        : snapshot.status === "degraded"
          ? "Needs attention"
          : "Idle";

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
        <p className="text-[10px] uppercase tracking-widest text-[#52525b]">
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
                className="w-full rounded-t bg-[#8b5cf6]/80"
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

export function ProviderHealthSummary({
  snapshot,
  hourly = false,
}: {
  snapshot: ProviderHealthSnapshot;
  hourly?: boolean;
}) {
  const bars = hourly ? snapshot.hourlyBuckets : snapshot.dailyBuckets;
  return (
    <div className="space-y-3 rounded-xl border border-white/10 bg-white/[0.03] p-3">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-sm font-medium text-white">
            {providerHealthLabel(snapshot.provider)}
          </p>
          <p className="text-[11px] text-[#71717a]">
            Last success {formatHealthRelative(snapshot.lastSuccessfulAt)}
          </p>
        </div>
        <HealthStatusBadge snapshot={snapshot} />
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <VolumeBars
          buckets={bars}
          metric="itemsSeen"
          title={hourly ? "Pulled Per Hour" : "Pulled Per Day"}
        />
        <VolumeBars
          buckets={bars}
          metric="itemsAdded"
          title={hourly ? "Added Per Hour" : "Added Per Day"}
        />
      </div>

      <div className="space-y-1">
        <p className="text-[10px] uppercase tracking-widest text-[#52525b]">
          Reliability
        </p>
        <ReliabilityBars dailyBuckets={snapshot.dailyBuckets} />
      </div>

      <div className="grid grid-cols-2 gap-2 text-xs">
        <div className="rounded-lg bg-white/5 p-2">
          <p className="text-[#52525b]">Seen (7d)</p>
          <p className="font-mono text-[#a1a1aa]">
            {snapshot.totalSeen7d.toLocaleString()}
          </p>
        </div>
        <div className="rounded-lg bg-white/5 p-2">
          <p className="text-[#52525b]">Added (7d)</p>
          <p className="font-mono text-[#a1a1aa]">
            {snapshot.totalAdded7d.toLocaleString()}
          </p>
        </div>
      </div>

      {snapshot.currentMessage && (
        <p className="text-xs text-[#71717a]">{snapshot.currentMessage}</p>
      )}
      {snapshot.lastError && (
        <p className="text-xs text-amber-400">{snapshot.lastError}</p>
      )}
    </div>
  );
}
