/**
 * Canonical stability metric contracts.
 *
 * Soak assertions, triage routing, and canary comparison all consume this
 * registry. A metric contract owns its signal names and target so those
 * surfaces cannot quietly invent different definitions for the same symptom.
 */

export const STABILITY_METRIC_REGISTRY_VERSION = 7;
export const MIN_LIFECYCLE_CREDITED_APP_ALIVE_HOURS = 6;
export const MIN_COMPARABLE_WINDOW_DURATION_RATIO = 0.8;
export const MAX_COMPARABLE_WINDOW_DURATION_RATIO = 1.25;

// A recovery can destroy and rebuild the main window, then escalate to a full
// app restart when the three-second memory verification fails. Treat that
// pair as one recovery sequence. After destruction is recorded, the 15-second
// bound covers the five-second release poll, the five-second rebuild step, and
// three-second verification while staying below the recovery cooldown.
const RENDERER_RECOVERY_ESCALATION_PAIR_WINDOW_MS = 15_000;

function exactNonemptyString(value) {
  return typeof value === "string" && value.trim() ? value : null;
}

function recoveryTimestamp(entry) {
  const raw = entry?.tsMs;
  return typeof raw === "number" && Number.isSafeInteger(raw) && raw > 0
    ? raw
    : null;
}

function normalizedNativePid(value) {
  return typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value > 0
    ? value
    : null;
}

// appSessionId belongs to the renderer and changes during a successful main
// window rebuild, so it cannot separate native recovery generations. Records
// that carry nativeBootId or nativePid can prove a generation match. Current
// historical records carry neither, leaving the exact reason and bounded
// timestamp as their only sequence identity. A renderer worker_spawn record
// is not a native boundary.
function nativeGenerationField(entry, key, normalize) {
  const raw = entry?.[key];
  if (raw === undefined) return { state: "absent", value: null };
  const value = normalize(raw);
  return value === null
    ? { state: "invalid", value: null }
    : { state: "valid", value };
}

function nativeGenerationFields(entry) {
  return {
    bootId: nativeGenerationField(entry, "nativeBootId", exactNonemptyString),
    pid: nativeGenerationField(entry, "nativePid", normalizedNativePid),
  };
}

function recoveryRecordsShareNativeGeneration(
  left,
  right,
  { allowLegacyKeylessFallback },
) {
  const leftGeneration = nativeGenerationFields(left);
  const rightGeneration = nativeGenerationFields(right);
  let matchedExplicitGeneration = false;
  for (const key of ["bootId", "pid"]) {
    const leftField = leftGeneration[key];
    const rightField = rightGeneration[key];
    if (leftField.state === "invalid" || rightField.state === "invalid") {
      return false;
    }
    if (leftField.state === "valid" || rightField.state === "valid") {
      if (leftField.state !== "valid" || rightField.state !== "valid") {
        return false;
      }
      if (leftField.value !== rightField.value) return false;
      matchedExplicitGeneration = true;
    }
  }
  return matchedExplicitGeneration || allowLegacyKeylessFallback;
}

function restartMatchesMainRecoveryReasonAndTime(
  mainRecovery,
  restartRequest,
) {
  const mainTs = recoveryTimestamp(mainRecovery);
  const restartTs = recoveryTimestamp(restartRequest);
  if (mainTs === null || restartTs === null) return false;
  const elapsedMs = restartTs - mainTs;
  if (
    elapsedMs < 0 ||
    elapsedMs > RENDERER_RECOVERY_ESCALATION_PAIR_WINDOW_MS
  ) {
    return false;
  }
  const mainReason = exactNonemptyString(mainRecovery.requestedBy);
  const restartReason = exactNonemptyString(restartRequest.reason);
  return mainReason !== null && mainReason === restartReason;
}

export function isMainRendererRecoveryRecord(entry) {
  return entry?.event === "window_destroyed" && entry?.label === "main";
}

export function summarizeRendererRecoverySequences(entries) {
  const sequences = [];
  const ineligibleMainSequences = new Set();
  const currentNativeGeneration = { bootId: null, pid: null };
  const decoratedEntries = (Array.isArray(entries) ? entries : []).map(
    (entry, inputIndex) => ({
      entry,
      inputIndex,
      timestamp: recoveryTimestamp(entry),
    }),
  );
  const pairingDisabledByUnreliableNativeGeneration = decoratedEntries.some(
    ({ entry, timestamp }) => {
      const generation = nativeGenerationFields(entry);
      if (
        generation.bootId.state === "invalid" ||
        generation.pid.state === "invalid"
      ) {
        return true;
      }
      if (timestamp !== null) return false;
      return (
        generation.bootId.state === "valid" || generation.pid.state === "valid"
      );
    },
  );
  const hasValidNativeGenerationEvidence = decoratedEntries.some(
    ({ entry }) => {
      const generation = nativeGenerationFields(entry);
      return (
        generation.bootId.state === "valid" || generation.pid.state === "valid"
      );
    },
  );
  const allowLegacyKeylessFallback = !hasValidNativeGenerationEvidence;
  const orderedEntries = decoratedEntries.sort((left, right) => {
    if (left.timestamp !== null && right.timestamp !== null) {
      return (
        left.timestamp - right.timestamp || left.inputIndex - right.inputIndex
      );
    }
    if (left.timestamp !== null) return -1;
    if (right.timestamp !== null) return 1;
    return left.inputIndex - right.inputIndex;
  });

  for (const { entry, inputIndex } of orderedEntries) {
    const generation = nativeGenerationFields(entry);
    let crossedNativeGeneration = false;
    for (const key of ["bootId", "pid"]) {
      const field = generation[key];
      if (field.state === "invalid") {
        crossedNativeGeneration = true;
        currentNativeGeneration[key] = null;
      } else if (field.state === "valid") {
        if (
          currentNativeGeneration[key] !== null &&
          currentNativeGeneration[key] !== field.value
        ) {
          crossedNativeGeneration = true;
        }
        currentNativeGeneration[key] = field.value;
      }
    }
    if (crossedNativeGeneration) {
      for (const sequence of sequences) {
        if (
          sequence.mainWindowDestroyed !== null &&
          sequence.restartRequest === null
        ) {
          ineligibleMainSequences.add(sequence);
        }
      }
    }

    if (isMainRendererRecoveryRecord(entry)) {
      sequences.push({
        primary: entry,
        primaryInputIndex: inputIndex,
        mainWindowDestroyed: entry,
        mainWindowDestroyedInputIndex: inputIndex,
        restartRequest: null,
        restartRequestInputIndex: null,
      });
      continue;
    }
    if (entry?.event !== "renderer_recovery_restart_requested") continue;

    const nearestCandidate = sequences.findLast(
      (sequence) =>
        !pairingDisabledByUnreliableNativeGeneration &&
        sequence.mainWindowDestroyed !== null &&
        sequence.restartRequest === null &&
        !ineligibleMainSequences.has(sequence) &&
        restartMatchesMainRecoveryReasonAndTime(
          sequence.mainWindowDestroyed,
          entry,
        ),
    );
    if (
      nearestCandidate &&
      recoveryRecordsShareNativeGeneration(
        nearestCandidate.mainWindowDestroyed,
        entry,
        { allowLegacyKeylessFallback },
      )
    ) {
      nearestCandidate.restartRequest = entry;
      nearestCandidate.restartRequestInputIndex = inputIndex;
      continue;
    }
    sequences.push({
      primary: entry,
      primaryInputIndex: inputIndex,
      mainWindowDestroyed: null,
      mainWindowDestroyedInputIndex: null,
      restartRequest: entry,
      restartRequestInputIndex: inputIndex,
    });
  }
  return {
    count: sequences.length,
    sequences,
  };
}

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
    id: "startup-repair-upload-surface",
    soakAssertionId: "startup_repair_upload_budget",
    outcomeMeasurement: Object.freeze({
      unit: "events/cloud-eligible-hour",
      direction: "lower",
      tolerance: 0.25,
    }),
    target: Object.freeze({
      kind: "max_group_count",
      groupBy: Object.freeze(["appSessionId", "provider"]),
      value: 1,
    }),
    triageBucketId: "cloud-loop",
    alarmNames: Object.freeze([]),
    canaryMetrics: Object.freeze([
      Object.freeze({
        name: "startupRepairUploadsPerHour",
        unit: "events/cloud-eligible-hour",
        direction: "lower",
        minimum: 0,
        denominator: "cloudEligibleHours",
        tolerance: Object.freeze({ kind: "absolute", allowance: 1 }),
      }),
    ]),
  }),
  Object.freeze({
    id: "social-outbox-attempt-surface",
    soakAssertionId: "social_outbox_retry_budget",
    outcomeMeasurement: Object.freeze({
      unit: "events/app-alive-hour",
      direction: "lower",
      tolerance: 0.25,
    }),
    target: Object.freeze({
      kind: "max_event_fields",
      fields: Object.freeze(["attempt", "maxAttempts"]),
      value: 3,
    }),
    triageBucketId: null,
    alarmNames: Object.freeze([]),
    canaryMetrics: Object.freeze([
      Object.freeze({
        name: "socialOutboxAttemptsPerHour",
        unit: "events/app-alive-hour",
        direction: "lower",
        minimum: 0,
        denominator: "appAliveHours",
        tolerance: Object.freeze({ kind: "ratio", allowance: 1.5 }),
      }),
    ]),
  }),
  Object.freeze({
    id: "facebook-group-discovery-update-rate",
    soakAssertionId: null,
    outcomeMeasurement: Object.freeze({
      unit: "events/app-alive-hour",
      direction: "lower",
      tolerance: 0.25,
    }),
    target: null,
    triageBucketId: null,
    alarmNames: Object.freeze([]),
    canaryMetrics: Object.freeze([
      Object.freeze({
        name: "facebookGroupDiscoveryUpdatesPerHour",
        unit: "events/app-alive-hour",
        direction: "lower",
        minimum: 0,
        denominator: "appAliveHours",
        tolerance: Object.freeze({ kind: "ratio", allowance: 1.5 }),
      }),
    ]),
  }),
  Object.freeze({
    id: "rss-pull-attempt-rate",
    soakAssertionId: null,
    outcomeMeasurement: Object.freeze({
      unit: "events/app-alive-hour",
      direction: "lower",
      tolerance: 0.25,
    }),
    target: null,
    triageBucketId: null,
    alarmNames: Object.freeze([]),
    canaryMetrics: Object.freeze([
      Object.freeze({
        name: "rssPullAttemptsPerHour",
        unit: "events/app-alive-hour",
        direction: "lower",
        minimum: 0,
        denominator: "appAliveHours",
        tolerance: Object.freeze({ kind: "ratio", allowance: 1.5 }),
      }),
    ]),
  }),
  Object.freeze({
    id: "ai-request-attempt-rate",
    soakAssertionId: null,
    outcomeMeasurement: Object.freeze({
      unit: "events/app-alive-hour",
      direction: "lower",
      tolerance: 0.25,
    }),
    target: null,
    triageBucketId: null,
    alarmNames: Object.freeze([]),
    canaryMetrics: Object.freeze([
      Object.freeze({
        name: "aiRequestAttemptsPerHour",
        unit: "events/app-alive-hour",
        direction: "lower",
        minimum: 0,
        denominator: "appAliveHours",
        tolerance: Object.freeze({ kind: "ratio", allowance: 1.5 }),
      }),
    ]),
  }),
  Object.freeze({
    id: "reader-article-fetch-attempt-rate",
    soakAssertionId: null,
    outcomeMeasurement: Object.freeze({
      unit: "events/app-alive-hour",
      direction: "lower",
      tolerance: 0.25,
    }),
    target: null,
    triageBucketId: null,
    alarmNames: Object.freeze([]),
    canaryMetrics: Object.freeze([
      Object.freeze({
        name: "readerArticleFetchAttemptsPerHour",
        unit: "events/app-alive-hour",
        direction: "lower",
        minimum: 0,
        denominator: "appAliveHours",
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
    outcomeGuardrailMetricIds: Object.freeze(["renderer-recovery-count"]),
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
