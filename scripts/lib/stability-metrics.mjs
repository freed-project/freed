/**
 * Canonical stability metric contracts.
 *
 * Soak assertions, triage routing, and canary comparison all consume this
 * registry. A metric contract owns its signal names and target so those
 * surfaces cannot quietly invent different definitions for the same symptom.
 */

export const STABILITY_METRIC_REGISTRY_VERSION = 4;
export const MIN_LIFECYCLE_CREDITED_APP_ALIVE_HOURS = 6;
export const MIN_COMPARABLE_WINDOW_DURATION_RATIO = 0.8;
export const MAX_COMPARABLE_WINDOW_DURATION_RATIO = 1.25;

/** Keep baseline windows close enough in duration for rate and peak comparisons. */
export function windowDurationsAreComparable(
  currentDurationMs,
  baselineDurationMs,
) {
  if (
    !Number.isFinite(currentDurationMs) ||
    !Number.isFinite(baselineDurationMs) ||
    currentDurationMs <= 0 ||
    baselineDurationMs <= 0
  ) {
    return false;
  }
  const ratio = baselineDurationMs / currentDurationMs;
  return (
    ratio >= MIN_COMPARABLE_WINDOW_DURATION_RATIO &&
    ratio <= MAX_COMPARABLE_WINDOW_DURATION_RATIO
  );
}

export const STABILITY_METRICS = Object.freeze([
  Object.freeze({
    id: "main-footprint-slope",
    soakAssertionId: "main_footprint_slope",
    outcomeMeasurement: Object.freeze({
      unit: "MB/sample-hour",
      direction: "lower",
      tolerance: 2,
    }),
    target: Object.freeze({
      kind: "max_rate",
      unit: "MB/sample-hour",
      denominator: "sampleElapsedHours",
      value: 25,
      minHours: 4,
    }),
    triageBucketId: "memory-growth",
    alarmNames: Object.freeze([]),
    canaryMetrics: Object.freeze([
      Object.freeze({
        name: "idleGrowthMbPerHour",
        unit: "MB/sample-hour",
        direction: "lower",
        denominator: "sampleElapsedHours",
        tolerance: Object.freeze({ kind: "absolute", allowance: 20 }),
      }),
    ]),
  }),
  Object.freeze({
    id: "renderer-recovery-count",
    soakAssertionId: "renderer_recoveries",
    outcomeMeasurement: Object.freeze({
      unit: "events/app-alive-day",
      direction: "lower",
      tolerance: 0.01,
    }),
    target: Object.freeze({ kind: "max_count", value: 0 }),
    triageBucketId: "renderer-churn",
    alarmNames: Object.freeze(["watchdog_thrash"]),
    canaryMetrics: Object.freeze([
      Object.freeze({
        name: "recoveriesPerDay",
        unit: "events/app-alive-day",
        direction: "lower",
        minimum: 0,
        denominator: "appAliveDays",
        tolerance: Object.freeze({ kind: "absolute", allowance: 2 }),
      }),
    ]),
  }),
  Object.freeze({
    id: "stale-heartbeat-count",
    soakAssertionId: "stale_heartbeats",
    outcomeMeasurement: Object.freeze({
      unit: "events/app-alive-day",
      direction: "lower",
      tolerance: 0.01,
    }),
    target: Object.freeze({ kind: "max_count", value: 0 }),
    triageBucketId: "renderer-churn",
    alarmNames: Object.freeze([]),
    canaryMetrics: Object.freeze([]),
  }),
  Object.freeze({
    id: "webkit-baseline-return",
    soakAssertionId: "webkit_returns_to_baseline",
    target: Object.freeze({ kind: "must_return_to_baseline" }),
    triageBucketId: "memory-growth",
    alarmNames: Object.freeze([]),
    canaryMetrics: Object.freeze([
      Object.freeze({
        name: "peakAppResidentBytes",
        unit: "bytes",
        direction: "lower",
        minimum: 0,
        tolerance: Object.freeze({ kind: "ratio", allowance: 1.25 }),
      }),
      Object.freeze({
        name: "peakWebkitLargestResidentBytes",
        unit: "bytes",
        direction: "lower",
        minimum: 0,
        tolerance: Object.freeze({ kind: "ratio", allowance: 1.25 }),
      }),
    ]),
  }),
  Object.freeze({
    id: "unchanged-cloud-upload-rate",
    soakAssertionId: "uploads_unchanged_heads",
    outcomeMeasurement: Object.freeze({
      unit: "events/cloud-eligible-hour",
      direction: "lower",
      tolerance: 0.5,
    }),
    target: Object.freeze({
      kind: "max_rate",
      unit: "events/cloud-eligible-hour",
      denominator: "cloudEligibleHours",
      value: 5,
      exclusive: true,
      minHours: 1,
    }),
    triageBucketId: "cloud-loop",
    alarmNames: Object.freeze(["cloud_loop"]),
    canaryMetrics: Object.freeze([
      Object.freeze({
        name: "uploadsUnchangedPerHour",
        unit: "events/cloud-eligible-hour",
        direction: "lower",
        minimum: 0,
        denominator: "cloudEligibleHours",
        tolerance: Object.freeze({ kind: "ratio", allowance: 1.5 }),
      }),
      Object.freeze({
        name: "uploadsPerHour",
        unit: "events/cloud-eligible-hour",
        direction: "lower",
        minimum: 0,
        denominator: "cloudEligibleHours",
        tolerance: Object.freeze({ kind: "ratio", allowance: 1.5 }),
      }),
    ]),
  }),
  Object.freeze({
    id: "active-operation-window-destruction",
    soakAssertionId: "preflight_kills",
    outcomeMeasurement: Object.freeze({
      unit: "events/app-alive-day",
      direction: "lower",
      tolerance: 0.01,
    }),
    target: Object.freeze({ kind: "max_count", value: 0 }),
    triageBucketId: "preflight-kill",
    alarmNames: Object.freeze(["preflight_kill"]),
    canaryMetrics: Object.freeze([]),
  }),
  Object.freeze({
    id: "novel-items-not-persisted",
    soakAssertionId: "scrape_zero_persist",
    outcomeMeasurement: Object.freeze({
      unit: "events/app-alive-day",
      direction: "lower",
      tolerance: 0.01,
    }),
    target: Object.freeze({ kind: "max_count", value: 0 }),
    triageBucketId: "scrape-zero-persist",
    alarmNames: Object.freeze(["scrape_zero_persist"]),
    canaryMetrics: Object.freeze([]),
  }),
  Object.freeze({
    id: "authenticated-empty-scrape-streak",
    soakAssertionId: null,
    target: null,
    triageBucketId: "auth-zombie",
    alarmNames: Object.freeze(["auth_zombie"]),
    canaryMetrics: Object.freeze([]),
  }),
  Object.freeze({
    id: "worker-init-rate",
    soakAssertionId: "worker_init_rate",
    outcomeMeasurement: Object.freeze({
      unit: "events/app-alive-hour",
      direction: "lower",
      tolerance: 0.25,
    }),
    target: Object.freeze({
      kind: "max_rate",
      unit: "events/app-alive-hour",
      denominator: "appAliveHours",
      value: 10,
      exclusive: true,
      minHours: 1,
    }),
    triageBucketId: "worker-churn",
    outcomeGuardrailMetricIds: Object.freeze(["app-memory-pressure-p95"]),
    alarmNames: Object.freeze([]),
    canaryMetrics: Object.freeze([
      Object.freeze({
        name: "workerInitsPerHour",
        unit: "events/app-alive-hour",
        direction: "lower",
        minimum: 0,
        denominator: "appAliveHours",
        tolerance: Object.freeze({ kind: "ratio", allowance: 1.5 }),
      }),
    ]),
  }),
  Object.freeze({
    id: "app-memory-pressure-p95",
    soakAssertionId: null,
    outcomeMeasurement: Object.freeze({
      unit: "bytes",
      direction: "lower",
      tolerance: 128 * 1024 * 1024,
    }),
    target: null,
    triageBucketId: "memory-growth",
    alarmNames: Object.freeze([]),
    canaryMetrics: Object.freeze([
      Object.freeze({
        name: "appMemoryPressureP95Bytes",
        unit: "bytes",
        direction: "lower",
        minimum: 0,
        tolerance: Object.freeze({
          kind: "absolute",
          allowance: 128 * 1024 * 1024,
        }),
      }),
    ]),
  }),
  Object.freeze({
    id: "invariant-alarm-rate",
    soakAssertionId: "invariant_alarms",
    outcomeMeasurement: Object.freeze({
      unit: "events/app-alive-day",
      direction: "lower",
      tolerance: 0.25,
    }),
    target: null,
    triageBucketId: null,
    alarmNames: Object.freeze([]),
    canaryMetrics: Object.freeze([
      Object.freeze({
        name: "alarmsPerDay",
        unit: "events/app-alive-day",
        direction: "lower",
        minimum: 0,
        denominator: "appAliveDays",
        tolerance: Object.freeze({ kind: "absolute", allowance: 2 }),
      }),
    ]),
  }),
]);

export function stabilityMetricById(metricId) {
  return STABILITY_METRICS.find((metric) => metric.id === metricId) ?? null;
}

export function canaryMetricContract(metricName) {
  for (const metric of STABILITY_METRICS) {
    const canaryMetric = metric.canaryMetrics.find(
      (candidate) => candidate.name === metricName,
    );
    if (canaryMetric) {
      return { metric, canaryMetric };
    }
  }
  return null;
}

export function metricContractForAssertion(assertionId) {
  return (
    STABILITY_METRICS.find(
      (metric) => metric.soakAssertionId === assertionId,
    ) ?? null
  );
}

export function metricSignalsForBucket(bucketId) {
  const metrics = STABILITY_METRICS.filter(
    (metric) => metric.triageBucketId === bucketId,
  );
  return {
    assertions: [
      ...new Set(
        metrics.map((metric) => metric.soakAssertionId).filter(Boolean),
      ),
    ],
    alarms: [...new Set(metrics.flatMap((metric) => metric.alarmNames))],
    canaryMetrics: [
      ...new Set(
        metrics.flatMap((metric) =>
          metric.canaryMetrics.map((item) => item.name),
        ),
      ),
    ],
  };
}

export function canaryRegressionTolerances() {
  return Object.fromEntries(
    STABILITY_METRICS.flatMap((metric) =>
      metric.canaryMetrics.map((item) => [
        item.name,
        {
          ...item.tolerance,
          direction: item.direction,
        },
      ]),
    ),
  );
}

/** Reject legacy invariant-alarm shortcuts that cannot prove their contract. */
export function invariantAlarmMeetsMetricContract(entry) {
  if (entry?.event !== "invariant_alarm") return false;
  const detail = typeof entry.detail === "string" ? entry.detail : "";
  if (entry.name === "preflight_kill") {
    return !/reason=job_complete\b/.test(detail);
  }
  if (entry.name === "scrape_zero_persist") {
    const novel = Number(entry.itemsNovel);
    const persisted = Number(entry.itemsPersisted);
    return (
      Number.isFinite(novel) && Number.isFinite(persisted) && novel > persisted
    );
  }
  return true;
}
