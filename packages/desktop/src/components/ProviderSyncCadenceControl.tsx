import { useEffect, useMemo, useState } from "react";
import { SettingsToggle } from "@freed/ui/components/SettingsToggle";
import {
  HIGH_FREQUENCY_WARNING_MS,
  type AutomaticSyncProvider,
  type ProviderCadenceBounds,
} from "../lib/provider-sync-cadence";
import {
  getAutomaticProviderSyncEnabled,
  getProviderScheduleSnapshot,
  resetProviderCadenceDefaults,
  setAutomaticProviderSyncEnabled,
  setProviderAutomaticPaused,
  updateProviderCadenceBounds,
} from "../lib/provider-sync-schedule-state";

type CadenceUnit = "minutes" | "hours";

interface ProviderSyncCadenceControlProps {
  provider: AutomaticSyncProvider;
}

const NUMBER = new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 });
const GLOBAL_SYNC_EVENT = "freed-provider-sync-global-change";

function divisor(unit: CadenceUnit): number {
  return unit === "hours" ? 60 * 60 * 1_000 : 60 * 1_000;
}

function dateLabel(timestamp: number): string {
  return new Date(timestamp).toLocaleString();
}

export function ProviderSyncCadenceControl({
  provider,
}: ProviderSyncCadenceControlProps) {
  const [revision, setRevision] = useState(0);
  const [unit, setUnit] = useState<CadenceUnit>("hours");
  const [error, setError] = useState<string | null>(null);
  const snapshot = useMemo(
    () => getProviderScheduleSnapshot(provider),
    [provider, revision],
  );
  const [globalEnabled, setGlobalEnabledState] = useState(
    getAutomaticProviderSyncEnabled,
  );
  const record = snapshot.record;

  useEffect(() => {
    const refreshGlobalState = () => {
      setGlobalEnabledState(getAutomaticProviderSyncEnabled());
    };
    window.addEventListener(GLOBAL_SYNC_EVENT, refreshGlobalState);
    window.addEventListener("storage", refreshGlobalState);
    return () => {
      window.removeEventListener(GLOBAL_SYNC_EVENT, refreshGlobalState);
      window.removeEventListener("storage", refreshGlobalState);
    };
  }, []);

  if (snapshot.status !== "supported" || !record) {
    return (
      <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-3 text-xs leading-relaxed text-amber-300">
        Automatic sync is paused because this provider's device schedule cannot be read safely. Manual Sync Now remains available.
      </div>
    );
  }

  const scale = divisor(unit);
  const saveBounds = (field: "lowerMs" | "upperMs", raw: string) => {
    const parsed = Number(raw);
    if (!Number.isFinite(parsed)) return;
    const bounds: ProviderCadenceBounds = {
      ...record.bounds,
      [field]: parsed * scale,
      source: "custom",
    };
    if (!updateProviderCadenceBounds(provider, bounds)) {
      setError("Use a lower bound of at least 5 minutes and an upper bound above it, up to 24 hours.");
      return;
    }
    setError(null);
    setRevision((value) => value + 1);
  };

  return (
    <details className="theme-card-soft group rounded-xl p-3">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 text-sm text-[var(--theme-text-secondary)]">
        <span>Automatic sync cadence</span>
        <span className="text-xs text-[var(--theme-text-muted)]">
          {record.bounds.source === "generated" ? "Generated" : "Custom"}
        </span>
      </summary>
      <div className="mt-4 space-y-4">
        <SettingsToggle
          label="Automatic provider sync"
          checked={globalEnabled}
          onChange={(enabled) => {
            if (setAutomaticProviderSyncEnabled(enabled)) {
              setGlobalEnabledState(enabled);
              window.dispatchEvent(new Event(GLOBAL_SYNC_EVENT));
            }
          }}
          description="Turns every automatic provider schedule on or off. Manual Sync Now remains available."
        />

        <SettingsToggle
          label={`Automatic ${provider} sync`}
          checked={!record.automaticPaused}
          disabled={!globalEnabled}
          onChange={(enabled) => {
            if (setProviderAutomaticPaused(provider, !enabled)) {
              setRevision((value) => value + 1);
            }
          }}
          description="Pauses only this provider. Manual Sync Now remains available."
        />

        <div className="grid grid-cols-[1fr_1fr_auto] gap-2">
          <label className="space-y-1 text-xs text-[var(--theme-text-muted)]">
            <span>Lower</span>
            <input
              key={`lower-${revision}-${unit}-${record.bounds.lowerMs}`}
              type="number"
              min={unit === "hours" ? 5 / 60 : 5}
              step={unit === "hours" ? 0.25 : 5}
              defaultValue={NUMBER.format(record.bounds.lowerMs / scale)}
              onBlur={(event) => saveBounds("lowerMs", event.currentTarget.value)}
              className="theme-input w-full rounded-xl px-3 py-2 text-sm"
            />
          </label>
          <label className="space-y-1 text-xs text-[var(--theme-text-muted)]">
            <span>Upper</span>
            <input
              key={`upper-${revision}-${unit}-${record.bounds.upperMs}`}
              type="number"
              max={unit === "hours" ? 24 : 1_440}
              step={unit === "hours" ? 0.25 : 5}
              defaultValue={NUMBER.format(record.bounds.upperMs / scale)}
              onBlur={(event) => saveBounds("upperMs", event.currentTarget.value)}
              className="theme-input w-full rounded-xl px-3 py-2 text-sm"
            />
          </label>
          <label className="space-y-1 text-xs text-[var(--theme-text-muted)]">
            <span>Units</span>
            <select
              value={unit}
              onChange={(event) => setUnit(event.currentTarget.value as CadenceUnit)}
              className="theme-input rounded-xl px-3 py-2 text-sm"
            >
              <option value="minutes">Minutes</option>
              <option value="hours">Hours</option>
            </select>
          </label>
        </div>

        {record.bounds.lowerMs < HIGH_FREQUENCY_WARNING_MS ? (
          <p className="text-xs leading-relaxed text-[rgb(var(--theme-feedback-warning-rgb))]">
            High-frequency schedule. Contact opportunities below 15 minutes can make this device easier for the provider to recognize.
          </p>
        ) : null}
        {error ? (
          <p className="text-xs text-[rgb(var(--theme-feedback-danger-rgb))]">{error}</p>
        ) : null}

        <div className="grid gap-2 text-xs text-[var(--theme-text-muted)] sm:grid-cols-2">
          <p>
            Next automatic sync: <span className="text-[var(--theme-text-secondary)]">{dateLabel(record.nextDueAt)}</span>
          </p>
          <p>
            Current pace factor: <span className="text-[var(--theme-text-secondary)]">{NUMBER.format(record.yieldFactor * record.regime.multiplier)}x</span>
          </p>
        </div>
        <p className="text-xs leading-relaxed text-[var(--theme-text-muted)]">
          Normal automatic opportunities stay inside these bounds. Sleep, recovery, memory pressure, writer ownership, and provider backoff can delay a sync beyond the upper bound.
        </p>
        <button
          type="button"
          onClick={() => {
            if (resetProviderCadenceDefaults(provider)) {
              setError(null);
              setRevision((value) => value + 1);
            }
          }}
          className="btn-secondary px-3 py-2 text-sm"
        >
          Reset to fresh generated defaults
        </button>
      </div>
    </details>
  );
}
