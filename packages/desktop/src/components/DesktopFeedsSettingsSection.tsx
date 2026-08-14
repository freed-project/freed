import { useState } from "react";
import { FeedsSection } from "@freed/ui/components/settings/FeedsSection";
import {
  getRssSyncSchedule,
  setRssSyncInterval,
} from "../lib/rss-sync-schedule-state";

export function DesktopFeedsSettingsSection() {
  const [revision, setRevision] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const schedule = getRssSyncSchedule();
  void revision;

  return (
    <div className="space-y-5">
      <div className="rounded-xl border border-[var(--theme-border-subtle)] bg-[var(--theme-bg-card)] p-3">
        <div className="flex items-end gap-3">
          <label className="flex-1 space-y-1 text-xs text-[var(--theme-text-muted)]">
            <span>Automatic RSS interval</span>
            <input
              key={schedule?.intervalMs}
              type="number"
              min={5 / 60}
              max={24}
              step={0.25}
              defaultValue={(schedule?.intervalMs ?? 0) / (60 * 60 * 1_000)}
              onBlur={(event) => {
                const intervalMs = Number(event.currentTarget.value) * 60 * 60 * 1_000;
                if (!setRssSyncInterval(intervalMs)) {
                  setError("Use an RSS interval from 5 minutes to 24 hours.");
                  return;
                }
                setError(null);
                setRevision((value) => value + 1);
              }}
              className="theme-input w-full rounded-xl px-3 py-2 text-sm"
            />
          </label>
          <span className="pb-2 text-xs text-[var(--theme-text-muted)]">hours</span>
        </div>
        <p className="mt-2 text-xs leading-relaxed text-[var(--theme-text-soft)]">
          RSS uses one fixed device-local interval. Scheduled runs refresh only stale, retry-eligible feeds. Wake debt is coalesced into one run.
        </p>
        {schedule ? (
          <p className="mt-2 text-xs text-[var(--theme-text-muted)]">
            Next automatic refresh: {new Date(schedule.nextDueAt).toLocaleString()}
          </p>
        ) : null}
        {error ? <p className="mt-2 text-xs text-red-400">{error}</p> : null}
      </div>
      <FeedsSection />
    </div>
  );
}
