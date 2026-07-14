#!/usr/bin/env node

// Machine-readable soak verdict.
//
// Reads a soak directory written by scripts/soak-collect.mjs plus the app's
// runtime-health.jsonl, evaluates named assertions, and writes
// soak-verdict.json into the soak dir. Loops gate on the verdict instead of
// reading soak evidence by eye.
//
// Assertions (each cites the violating file:line):
//   main_footprint_slope    idle main-process footprint slope < 25 MB/h over >= 4h
//   renderer_recoveries     renderer_recovery_restart_requested count == 0
//   stale_heartbeats        renderer_heartbeat_stale count == 0
//   worker_init_rate        worker INITs < 10/app-alive hour over >= 1h
//   webkit_returns_to_baseline  machine-wide WebContent count returns to its
//                           baseline between scrape cycles
//   uploads_unchanged_heads unchanged cloud uploads < 5/h over >= 1h
//   startup_repair_upload_budget at most one startup repair upload per
//                           provider and app session
//   social_outbox_retry_budget attempt and maxAttempts never exceed 3
//   preflight_kills        active-operation window destruction count == 0
//   scrape_zero_persist    novel items must be persisted; duplicate-only
//                           scrapes are not data loss
//
// Usage:
//   node scripts/soak-assert.mjs                       # soak dir from the active pointer
//   node scripts/soak-assert.mjs --soak-dir <dir>
//   node scripts/soak-assert.mjs --json                # print the verdict JSON
// Exit code: 1 when any assertion fails (pass/skip exit 0).

import { existsSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  metricContractForAssertion,
  stabilityMetricById,
  STABILITY_METRIC_REGISTRY_VERSION,
} from "./lib/stability-metrics.mjs";
import {
  COLLECTOR_EVENTS_ARCHIVE_FILENAME,
  COLLECTOR_EVENTS_FILENAME,
  COLLECTOR_EVENTS_SCHEMA_VERSION,
  hasCollectorEventEvidenceCapability,
} from "./soak-collect.mjs";

const __filename = fileURLToPath(import.meta.url);

export const VERDICT_SCHEMA_VERSION = 1;
export const EVIDENCE_FINGERPRINT_SCHEMA_VERSION = 2;
export const DEFAULT_COLLECTOR_INTERVAL_MS = 60_000;
export const MAX_COLLECTOR_CREDITED_GAP_MS = 5 * 60_000;
export const MIN_COLLECTOR_SAMPLE_DENSITY = 0.8;
export const DEFAULT_RUNTIME_HEALTH_INTERVAL_MS = 60_000;
export const MAX_RUNTIME_HEALTH_CREDITED_GAP_MS = 5 * 60_000;
export const MIN_RUNTIME_HEALTH_SAMPLE_DENSITY = 0.8;
const RUNTIME_HEALTH_LIVENESS_EVENTS = new Set([
  "renderer_heartbeat",
  "native_runtime_memory_sample",
]);
export const WORKER_IDLE_TERMINATION_REASONS = Object.freeze([
  "quiet_window",
  "pending_request_retry",
  "request_timeout_cleanup",
]);
const WORKER_IDLE_TERMINATION_REASON_SET = new Set(
  WORKER_IDLE_TERMINATION_REASONS,
);
const REQUIRED_METRICS_COLUMNS = Object.freeze([
  "tsMs",
  "iso",
  "appPid",
  "appRssKb",
  "webkitWebContentCount",
  "webkitWebContentRssKb",
  "webkitLargestRssKb",
  "webkitOtherRssKb",
  "healthFileBytes",
  "healthFileLines",
]);
const MB = 1024 * 1024;
const FOOTPRINT_TARGET = metricContractForAssertion(
  "main_footprint_slope",
).target;
const SLOPE_LIMIT_MB_PER_HOUR = FOOTPRINT_TARGET.value;
const SLOPE_MIN_HOURS = FOOTPRINT_TARGET.minHours;

const DEFAULT_POINTER = path.join(
  os.homedir(),
  ".freed",
  "automation",
  "current-soak-dir",
);
const DEFAULT_APP_DATA_DIR = path.join(
  os.homedir(),
  "Library",
  "Application Support",
  "wtf.freed.desktop",
);

function usage() {
  return `Usage:
  node scripts/soak-assert.mjs [options]

Options:
  --soak-dir <path>   Soak directory. Defaults to the active pointer (${DEFAULT_POINTER}).
  --pointer <path>    Pointer file used when --soak-dir is omitted.
  --app-data <path>   App data dir holding runtime-health.jsonl.
  --out <path>        Verdict output. Defaults to <soak-dir>/soak-verdict.json.
  --json              Also print the verdict JSON to stdout.
  --help              Show this help.
`;
}

export function parseArgs(argv) {
  const args = {
    soakDir: "",
    pointer: DEFAULT_POINTER,
    appData: DEFAULT_APP_DATA_DIR,
    out: "",
    json: false,
    help: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    switch (arg) {
      case "--soak-dir":
        args.soakDir = argv[index + 1] ?? "";
        index += 1;
        break;
      case "--pointer":
        args.pointer = argv[index + 1] ?? "";
        index += 1;
        break;
      case "--app-data":
        args.appData = argv[index + 1] ?? "";
        index += 1;
        break;
      case "--out":
        args.out = argv[index + 1] ?? "";
        index += 1;
        break;
      case "--json":
        args.json = true;
        break;
      case "--help":
      case "-h":
        args.help = true;
        break;
      default:
        throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return args;
}

export function parseMetricsTsv(text) {
  const lines = String(text ?? "")
    .split(/\r?\n/)
    .filter((line) => line.length > 0);
  const headers = lines.shift()?.split("\t") ?? [];
  const headerHealthy =
    headers.length === REQUIRED_METRICS_COLUMNS.length &&
    REQUIRED_METRICS_COLUMNS.every(
      (column, index) => headers[index] === column,
    );
  const malformedLines = [];
  const rows = lines.flatMap((line, index) => {
    const values = line.split("\t");
    const row = Object.fromEntries(
      headers.map((header, column) => [header, Number(values[column] ?? "")]),
    );
    row.iso = values[headers.indexOf("iso")] ?? "";
    row.line = index + 2; // 1-indexed, after the header row
    const numericHealthy = REQUIRED_METRICS_COLUMNS.filter(
      (column) => column !== "iso",
    ).every((column) => Number.isFinite(row[column]));
    if (
      !headerHealthy ||
      values.length !== headers.length ||
      !row.iso ||
      !numericHealthy
    ) {
      malformedLines.push(index + 2);
      return [];
    }
    return [row];
  });
  Object.defineProperty(rows, "sourceDiagnostics", {
    value: {
      headerHealthy,
      sourceLineCount: lines.length,
      malformedLines,
    },
    enumerable: false,
  });
  return rows;
}

export function parseCollectorEventsJsonl(text) {
  const rawRecords = [];
  const malformedLines = [];
  const events = [];
  for (const [index, raw] of String(text ?? "")
    .split("\n")
    .entries()) {
    if (!raw.trim()) continue;
    rawRecords.push(raw);
    try {
      const entry = JSON.parse(raw);
      const event = String(entry?.event ?? "");
      const tsMs = Number(entry?.tsMs);
      const failedSamples = Number(entry?.failedSamples);
      const failureStartedAtMs = Number(entry?.failureStartedAtMs);
      const failureLastObservedAtMs = Number(entry?.failureLastObservedAtMs);
      const outageMs = Number(entry?.outageMs);
      const collectorRunId = String(entry?.collectorRunId ?? "").trim();
      const sessionStartedAtMs = Number(entry?.sessionStartedAtMs);
      const priorCollectorRunId = String(
        entry?.priorCollectorRunId ?? "",
      ).trim();
      const priorSessionStartedAtMs = Number(entry?.priorSessionStartedAtMs);
      const validEvent =
        entry?.schemaVersion === COLLECTOR_EVENTS_SCHEMA_VERSION &&
        Number.isFinite(tsMs) &&
        tsMs > 0 &&
        ((event === "collector_session_started" && collectorRunId.length > 0) ||
          (event === "collector_session_restarted" &&
            collectorRunId.length > 0 &&
            priorCollectorRunId.length > 0 &&
            Number.isFinite(priorSessionStartedAtMs) &&
            priorSessionStartedAtMs > 0 &&
            priorSessionStartedAtMs <= tsMs &&
            typeof entry.reason === "string" &&
            entry.reason.length > 0) ||
          (event === "collector_session_stopped" &&
            collectorRunId.length > 0 &&
            Number.isFinite(sessionStartedAtMs) &&
            sessionStartedAtMs > 0 &&
            sessionStartedAtMs <= tsMs &&
            typeof entry.reason === "string" &&
            entry.reason.length > 0) ||
          (event === "collector_sample_failed" &&
            failedSamples === 1 &&
            entry.sampleMayBePartial === true) ||
          (event === "collector_sample_recovered" &&
            Number.isSafeInteger(failedSamples) &&
            failedSamples > 0 &&
            Number.isFinite(failureStartedAtMs) &&
            Number.isFinite(failureLastObservedAtMs) &&
            failureLastObservedAtMs >= failureStartedAtMs &&
            failureLastObservedAtMs <= tsMs &&
            outageMs === Math.max(0, tsMs - failureStartedAtMs)));
      if (!validEvent) {
        throw new Error("invalid collector event");
      }
      events.push({ entry, line: index + 1, raw });
    } catch {
      malformedLines.push({ line: index + 1, raw });
    }
  }
  events.sourceDiagnostics = {
    sourceLineCount: rawRecords.length,
    rawRecords,
    malformedLines,
  };
  return events;
}

export function computeCollectorEventCoverage(
  collectorEvents,
  { requireClosedSession = false } = {},
) {
  const malformedLineCount =
    collectorEvents.sourceDiagnostics?.malformedLines?.length ?? 0;
  let openFailure = null;
  let openSession = null;
  let failureCount = 0;
  let recoveryCount = 0;
  let sessionStartCount = 0;
  let sessionStopCount = 0;
  let sessionAbandonCount = 0;
  let protocolErrorCount = 0;
  let priorTsMs = 0;
  const seenSessionIdentities = new Set();
  for (const { entry } of collectorEvents) {
    const tsMs = Number(entry.tsMs);
    if (tsMs < priorTsMs) protocolErrorCount += 1;
    priorTsMs = Math.max(priorTsMs, tsMs);
    if (entry.event === "collector_session_started") {
      sessionStartCount += 1;
      const sessionIdentity = `${entry.collectorRunId}:${Number(entry.tsMs)}`;
      if (seenSessionIdentities.has(sessionIdentity)) {
        protocolErrorCount += 1;
      }
      seenSessionIdentities.add(sessionIdentity);
      if (openSession) protocolErrorCount += 1;
      openSession = entry;
      continue;
    }
    if (entry.event === "collector_session_restarted") {
      sessionStartCount += 1;
      sessionAbandonCount += 1;
      const sessionIdentity = `${entry.collectorRunId}:${Number(entry.tsMs)}`;
      if (seenSessionIdentities.has(sessionIdentity)) {
        protocolErrorCount += 1;
      }
      seenSessionIdentities.add(sessionIdentity);
      if (
        !openSession ||
        entry.priorCollectorRunId !== openSession.collectorRunId ||
        Number(entry.priorSessionStartedAtMs) !== Number(openSession.tsMs)
      ) {
        protocolErrorCount += 1;
      }
      openSession = {
        ...entry,
        event: "collector_session_started",
      };
      continue;
    }
    if (entry.event === "collector_session_stopped") {
      sessionStopCount += 1;
      if (
        !openSession ||
        entry.collectorRunId !== openSession.collectorRunId ||
        Number(entry.sessionStartedAtMs) !== Number(openSession.tsMs)
      ) {
        protocolErrorCount += 1;
      } else {
        openSession = null;
      }
      continue;
    }
    if (entry.event === "collector_sample_failed") {
      failureCount += 1;
      if (openFailure) {
        protocolErrorCount += 1;
      } else {
        openFailure = entry;
      }
      continue;
    }
    if (entry.event !== "collector_sample_recovered") {
      protocolErrorCount += 1;
      continue;
    }
    recoveryCount += 1;
    if (!openFailure) {
      protocolErrorCount += 1;
      continue;
    }
    if (
      Number(entry.failureStartedAtMs) !== Number(openFailure.tsMs) ||
      tsMs < Number(openFailure.tsMs)
    ) {
      protocolErrorCount += 1;
    }
    openFailure = null;
  }
  const healthy =
    malformedLineCount === 0 &&
    protocolErrorCount === 0 &&
    openFailure === null &&
    openSession === null &&
    (!requireClosedSession || sessionStartCount > 0);
  const openEvidence = [openFailure, openSession]
    .filter(Boolean)
    .sort((left, right) => Number(left.tsMs) - Number(right.tsMs))[0];
  return {
    collectorEventCount: collectorEvents.length,
    collectorEventFailureCount: failureCount,
    collectorEventRecoveryCount: recoveryCount,
    collectorEventSessionStartCount: sessionStartCount,
    collectorEventSessionStopCount: sessionStopCount,
    collectorEventSessionAbandonCount: sessionAbandonCount,
    collectorEventMalformedLineCount: malformedLineCount,
    collectorEventProtocolErrorCount: protocolErrorCount,
    collectorOutageOpen: openEvidence !== undefined,
    collectorOpenOutageStartedAtMs: openEvidence
      ? Number(openEvidence.tsMs)
      : null,
    collectorEventCoverageHealthy: healthy,
    collectorEventCoverageReason: healthy
      ? null
      : openFailure
        ? `Collector sampling has an unrecovered outage open since ${new Date(Number(openFailure.tsMs)).toISOString()}.`
        : openSession
          ? `Collector session ${openSession.collectorRunId} is still open since ${new Date(Number(openSession.tsMs)).toISOString()}. Stop the lock-owning collector before judging or hashing the soak.`
          : requireClosedSession && sessionStartCount === 0
            ? "Collector event evidence contains no durably closed collector session."
            : `Collector event evidence has ${malformedLineCount.toLocaleString()} malformed line${malformedLineCount === 1 ? "" : "s"} and ${protocolErrorCount.toLocaleString()} protocol error${protocolErrorCount === 1 ? "" : "s"}.`,
  };
}

export function readHealthLines(
  healthPath,
  { fromTsMs = 0, toTsMs = Number.POSITIVE_INFINITY } = {},
) {
  if (!existsSync(healthPath)) {
    const missing = [];
    Object.defineProperty(missing, "sourceDiagnostics", {
      value: { sourceLineCount: 0, malformedLines: [], rawRecords: [] },
      enumerable: false,
    });
    return missing;
  }
  const malformedLines = [];
  const rawRecords = [];
  const lines = readFileSync(healthPath, "utf8").split(/\r?\n/);
  const entries = lines.flatMap((raw, index) => {
    if (!raw.trim()) return [];
    try {
      const entry = JSON.parse(raw);
      const ts = Number(entry.tsMs ?? 0);
      if (ts !== 0 && (ts < fromTsMs || ts > toTsMs)) return [];
      rawRecords.push(raw);
      return [{ entry, line: index + 1, raw }];
    } catch {
      malformedLines.push(index + 1);
      rawRecords.push(raw);
      return [];
    }
  });
  Object.defineProperty(entries, "sourceDiagnostics", {
    value: {
      sourceLineCount: rawRecords.length,
      malformedLines,
      rawRecords,
    },
    enumerable: false,
  });
  return entries;
}

// Least-squares slope in MB/h over [{tsMs, bytes}] points.
export function footprintSlopeMbPerHour(points) {
  const usable = points.filter((point) => point.bytes > 0 && point.tsMs > 0);
  if (usable.length < 2) {
    return null;
  }
  const t0 = usable[0].tsMs;
  const xs = usable.map((point) => (point.tsMs - t0) / 3_600_000); // hours
  const ys = usable.map((point) => point.bytes / MB);
  const n = usable.length;
  const meanX = xs.reduce((sum, value) => sum + value, 0) / n;
  const meanY = ys.reduce((sum, value) => sum + value, 0) / n;
  let numerator = 0;
  let denominator = 0;
  for (let index = 0; index < n; index += 1) {
    numerator += (xs[index] - meanX) * (ys[index] - meanY);
    denominator += (xs[index] - meanX) ** 2;
  }
  if (denominator === 0) {
    return null;
  }
  return numerator / denominator;
}

function assertion(id, status, detail, violations = []) {
  return { id, status, detail, violations };
}

function cite(file, line, excerpt) {
  return { file, line, excerpt: String(excerpt).slice(0, 240) };
}

function localeFixed(value, digits = 0) {
  return Number(value).toLocaleString(undefined, {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

function mergeIntervals(intervals) {
  const sorted = intervals
    .filter(
      ({ startMs, endMs }) =>
        Number.isFinite(startMs) && Number.isFinite(endMs) && endMs > startMs,
    )
    .sort(
      (left, right) => left.startMs - right.startMs || left.endMs - right.endMs,
    );
  const merged = [];
  for (const interval of sorted) {
    const prior = merged.at(-1);
    if (!prior || interval.startMs > prior.endMs) {
      merged.push({ ...interval });
      continue;
    }
    prior.endMs = Math.max(prior.endMs, interval.endMs);
  }
  return merged;
}

function normalizedCollectorRows(metricsRows) {
  const byTimestamp = new Map();
  for (const row of metricsRows) {
    if (!Number.isFinite(row.tsMs) || row.tsMs <= 0) continue;
    const existing = byTimestamp.get(row.tsMs);
    const appPid =
      Number.isSafeInteger(row.appPid) && row.appPid > 0 ? row.appPid : 0;
    if (!existing) {
      byTimestamp.set(row.tsMs, { tsMs: row.tsMs, appPid });
      continue;
    }
    if (existing.appPid !== appPid) existing.appPid = 0;
  }
  return [...byTimestamp.values()].sort(
    (left, right) => left.tsMs - right.tsMs,
  );
}

function collectorTiming(expectedIntervalMs = DEFAULT_COLLECTOR_INTERVAL_MS) {
  const normalizedExpectedIntervalMs =
    Number.isFinite(expectedIntervalMs) && expectedIntervalMs >= 5_000
      ? expectedIntervalMs
      : DEFAULT_COLLECTOR_INTERVAL_MS;
  return {
    expectedIntervalMs: normalizedExpectedIntervalMs,
    maxCreditedGapMs: Math.min(
      MAX_COLLECTOR_CREDITED_GAP_MS,
      Math.max(normalizedExpectedIntervalMs * 2.5, 2 * 60_000),
    ),
  };
}

function appAliveIntervals(metricsRows, { expectedIntervalMs } = {}) {
  const rows = normalizedCollectorRows(metricsRows);
  const timing = collectorTiming(expectedIntervalMs);
  if (rows.length < 2) return [];
  return mergeIntervals(
    rows.slice(1).flatMap((current, index) => {
      const prior = rows[index];
      const gap = current.tsMs - prior.tsMs;
      return prior.appPid > 0 &&
        current.appPid > 0 &&
        prior.appPid === current.appPid &&
        gap > 0 &&
        gap <= timing.maxCreditedGapMs
        ? [{ startMs: prior.tsMs, endMs: current.tsMs }]
        : [];
    }),
  );
}

export function computeAppAliveCoverage(
  metricsRows,
  { expectedIntervalMs } = {},
) {
  const diagnostics = metricsRows.sourceDiagnostics ?? {
    headerHealthy: true,
    sourceLineCount: metricsRows.length,
    malformedLines: [],
  };
  const rows = metricsRows
    .filter((row) => Number.isFinite(row.tsMs) && row.tsMs > 0)
    .sort((left, right) => left.tsMs - right.tsMs);
  const distinctRows = normalizedCollectorRows(rows);
  const timing = collectorTiming(expectedIntervalMs);
  if (distinctRows.length < 2) {
    return {
      sampleCount: rows.length,
      distinctSampleCount: distinctRows.length,
      expectedSampleCount: 0,
      sampleDensity: 0,
      spanHours: 0,
      appAliveHours: 0,
      appAliveRatio: 0,
      expectedIntervalMs: timing.expectedIntervalMs,
      maxCreditedGapMs: timing.maxCreditedGapMs,
      largestObservedGapMs: 0,
      creditedIntervalCount: 0,
      collectorHeaderHealthy: diagnostics.headerHealthy !== false,
      collectorMalformedRowCount: diagnostics.malformedLines.length,
      healthy: false,
      reason: "At least two distinct collector samples are required.",
    };
  }
  const gaps = distinctRows
    .slice(1)
    .map((row, index) => row.tsMs - distinctRows[index].tsMs)
    .filter((gap) => gap > 0)
    .sort((left, right) => left - right);
  const intervals = appAliveIntervals(distinctRows, timing);
  const appAliveMs = intervals.reduce(
    (sum, interval) => sum + (interval.endMs - interval.startMs),
    0,
  );
  const spanMs = distinctRows.at(-1).tsMs - distinctRows[0].tsMs;
  const appAliveRatio = spanMs > 0 ? appAliveMs / spanMs : 0;
  const expectedSampleCount =
    spanMs > 0 ? Math.floor(spanMs / timing.expectedIntervalMs) + 1 : 0;
  const sampleDensity =
    expectedSampleCount > 0
      ? Math.min(1, distinctRows.length / expectedSampleCount)
      : 0;
  const healthy =
    diagnostics.headerHealthy !== false &&
    diagnostics.malformedLines.length === 0 &&
    distinctRows.length >= 3 &&
    expectedSampleCount >= 3 &&
    spanMs > 0 &&
    appAliveRatio >= 0.8 &&
    sampleDensity >= MIN_COLLECTOR_SAMPLE_DENSITY;
  return {
    sampleCount: rows.length,
    distinctSampleCount: distinctRows.length,
    expectedSampleCount,
    sampleDensity,
    spanHours: spanMs / 3_600_000,
    appAliveHours: appAliveMs / 3_600_000,
    appAliveRatio,
    expectedIntervalMs: timing.expectedIntervalMs,
    maxCreditedGapMs: timing.maxCreditedGapMs,
    largestObservedGapMs: gaps.at(-1) ?? 0,
    creditedIntervalCount: intervals.length,
    collectorHeaderHealthy: diagnostics.headerHealthy !== false,
    collectorMalformedRowCount: diagnostics.malformedLines.length,
    healthy,
    reason: healthy
      ? null
      : diagnostics.headerHealthy === false ||
          diagnostics.malformedLines.length > 0
        ? `Collector evidence has ${diagnostics.malformedLines.length.toLocaleString()} malformed row${diagnostics.malformedLines.length === 1 ? "" : "s"} or an invalid header.`
        : `Collector coverage was ${localeFixed(appAliveRatio * 100, 1)}% app-alive at ${localeFixed(sampleDensity * 100, 1)}% sample density across ${distinctRows.length.toLocaleString()} distinct samples.`,
  };
}

function runtimeHealthTiming(
  expectedIntervalMs = DEFAULT_RUNTIME_HEALTH_INTERVAL_MS,
) {
  const normalizedExpectedIntervalMs =
    Number.isFinite(expectedIntervalMs) && expectedIntervalMs >= 5_000
      ? expectedIntervalMs
      : DEFAULT_RUNTIME_HEALTH_INTERVAL_MS;
  return {
    expectedIntervalMs: normalizedExpectedIntervalMs,
    maxCreditedGapMs: Math.min(
      MAX_RUNTIME_HEALTH_CREDITED_GAP_MS,
      Math.max(normalizedExpectedIntervalMs * 2.5, 2 * 60_000),
    ),
  };
}

/**
 * Prove that the runtime-health stream remained live while the collector saw
 * one stable app process. Renderer heartbeats are normally more frequent than
 * this contract, while the native memory sampler supplies an independent
 * 60-second liveness record when renderer timers are throttled.
 */
export function computeRuntimeHealthCoverage(
  healthLines,
  metricsRows,
  {
    collectorExpectedIntervalMs = DEFAULT_COLLECTOR_INTERVAL_MS,
    runtimeExpectedIntervalMs = DEFAULT_RUNTIME_HEALTH_INTERVAL_MS,
  } = {},
) {
  const intervals = appAliveIntervals(metricsRows, {
    expectedIntervalMs: collectorExpectedIntervalMs,
  });
  const timing = runtimeHealthTiming(runtimeExpectedIntervalMs);
  const samples = healthLines
    .map(({ entry }) => entry)
    .filter((entry) => RUNTIME_HEALTH_LIVENESS_EVENTS.has(entry?.event))
    .map((entry) => Number(entry.tsMs ?? 0))
    .filter(
      (timestamp) =>
        Number.isFinite(timestamp) &&
        timestamp > 0 &&
        intervals.some(
          (interval) =>
            timestamp >= interval.startMs && timestamp <= interval.endMs,
        ),
    )
    .sort((left, right) => left - right);
  const distinctSamples = [...new Set(samples)];

  let expectedSampleCount = 0;
  let largestObservedGapMs = 0;
  let lastFreshnessMs = 0;
  let coveredSegmentCount = 0;
  for (const interval of intervals) {
    const durationMs = interval.endMs - interval.startMs;
    expectedSampleCount += Math.max(
      1,
      Math.ceil(durationMs / timing.expectedIntervalMs),
    );
    const segmentSamples = distinctSamples.filter(
      (timestamp) =>
        timestamp >= interval.startMs && timestamp <= interval.endMs,
    );
    if (segmentSamples.length > 0) {
      coveredSegmentCount += 1;
    }
    let priorTimestamp = interval.startMs;
    for (const timestamp of segmentSamples) {
      largestObservedGapMs = Math.max(
        largestObservedGapMs,
        timestamp - priorTimestamp,
      );
      priorTimestamp = timestamp;
    }
    const segmentFreshnessMs = interval.endMs - priorTimestamp;
    largestObservedGapMs = Math.max(largestObservedGapMs, segmentFreshnessMs);
    lastFreshnessMs = Math.max(lastFreshnessMs, segmentFreshnessMs);
  }

  const sampleDensity =
    expectedSampleCount > 0
      ? Math.min(1, distinctSamples.length / expectedSampleCount)
      : 0;
  const healthy =
    intervals.length > 0 &&
    expectedSampleCount >= 3 &&
    distinctSamples.length >= 3 &&
    coveredSegmentCount === intervals.length &&
    sampleDensity >= MIN_RUNTIME_HEALTH_SAMPLE_DENSITY &&
    largestObservedGapMs <= timing.maxCreditedGapMs &&
    lastFreshnessMs <= timing.maxCreditedGapMs;
  const reason = healthy
    ? null
    : intervals.length === 0
      ? "No app-alive collector segment is available for runtime-health coverage."
      : `Runtime-health liveness covered ${coveredSegmentCount.toLocaleString()} of ${intervals.length.toLocaleString()} app-alive segments with ${distinctSamples.length.toLocaleString()} distinct samples against ${expectedSampleCount.toLocaleString()} expected. Largest gap ${largestObservedGapMs.toLocaleString()} ms; last freshness ${lastFreshnessMs.toLocaleString()} ms.`;

  return {
    runtimeHealthSampleCount: samples.length,
    runtimeHealthDistinctSampleCount: distinctSamples.length,
    runtimeHealthExpectedSampleCount: expectedSampleCount,
    runtimeHealthSampleDensity: sampleDensity,
    runtimeHealthExpectedIntervalMs: timing.expectedIntervalMs,
    runtimeHealthMaxCreditedGapMs: timing.maxCreditedGapMs,
    runtimeHealthLargestObservedGapMs: largestObservedGapMs,
    runtimeHealthLastFreshnessMs: lastFreshnessMs,
    runtimeHealthAppAliveSegmentCount: intervals.length,
    runtimeHealthCoveredAppAliveSegmentCount: coveredSegmentCount,
    runtimeHealthCoverageHealthy: healthy,
    runtimeHealthCoverageReason: reason,
  };
}

function nearestRankPercentile(values, percentile) {
  if (!Array.isArray(values) || values.length === 0) return null;
  const sorted = values.toSorted((left, right) => left - right);
  return sorted[Math.ceil(sorted.length * percentile) - 1] ?? null;
}

export function summarizeWorkerIdleTerminations(healthLines) {
  const byReason = Object.fromEntries(
    WORKER_IDLE_TERMINATION_REASONS.map((reason) => [reason, 0]),
  );
  let invalidReasonCount = 0;
  for (const { entry } of healthLines) {
    if (entry?.event !== "worker_idle_terminated") continue;
    if (WORKER_IDLE_TERMINATION_REASON_SET.has(entry.reason)) {
      byReason[entry.reason] += 1;
    } else {
      invalidReasonCount += 1;
    }
  }
  return {
    total:
      Object.values(byReason).reduce((sum, count) => sum + count, 0) +
      invalidReasonCount,
    byReason,
    invalidReasonCount,
  };
}

function normalizedEventGroup(value) {
  return typeof value === "string" && value.trim() ? value.trim() : "unknown";
}

function incrementNestedCount(groups, first, second) {
  const firstKey = normalizedEventGroup(first);
  const secondKey = normalizedEventGroup(second);
  const nested = groups.get(firstKey) ?? new Map();
  nested.set(secondKey, (nested.get(secondKey) ?? 0) + 1);
  groups.set(firstKey, nested);
}

function nestedCountsToObject(groups) {
  return Object.fromEntries(
    [...groups.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, nested]) => [
        key,
        Object.fromEntries(
          [...nested.entries()].sort(([left], [right]) =>
            left.localeCompare(right),
          ),
        ),
      ]),
  );
}

function incrementCount(groups, key) {
  const normalized = normalizedEventGroup(key);
  groups.set(normalized, (groups.get(normalized) ?? 0) + 1);
}

function countsToObject(groups) {
  return Object.fromEntries(
    [...groups.entries()].sort(([left], [right]) =>
      left.localeCompare(right),
    ),
  );
}

function socialAttemptFieldsMeetContract(entry, target) {
  const attempt = entry?.attempt;
  const maxAttempts = entry?.maxAttempts;
  return (
    Number.isSafeInteger(attempt) &&
    attempt >= 1 &&
    Number.isSafeInteger(maxAttempts) &&
    maxAttempts >= 1 &&
    attempt <= maxAttempts &&
    attempt <= target &&
    maxAttempts <= target
  );
}

/** Fold privacy-safe request-surface counters into stable grouped summaries. */
export function summarizeRequestSurfaceEvents(healthLines) {
  const socialByProviderAction = new Map();
  const facebookBySource = new Map();
  const rssByTrigger = new Map();
  const aiByProviderPurpose = new Map();
  const readerBySourcePin = new Map();
  const startupByProvider = new Map();
  const startupGroups = new Map();
  let socialTotal = 0;
  let socialInvalidContractCount = 0;
  let socialMaxAttempt = 0;
  let socialMaxAttempts = 0;
  let facebookTotal = 0;
  let facebookChangedCount = 0;
  let facebookRemovedCount = 0;
  let rssTotal = 0;
  let aiTotal = 0;
  let readerTotal = 0;
  let startupTotal = 0;
  let startupInvalidGroupCount = 0;

  const socialTarget = metricContractForAssertion(
    "social_outbox_retry_budget",
  ).target.value;
  for (const line of healthLines) {
    const entry = line?.entry ?? line;
    if (entry?.event === "social_outbox_attempt") {
      socialTotal += 1;
      incrementNestedCount(
        socialByProviderAction,
        entry.provider,
        entry.action,
      );
      const attempt = entry.attempt;
      const maxAttempts = entry.maxAttempts;
      if (Number.isFinite(attempt)) {
        socialMaxAttempt = Math.max(socialMaxAttempt, attempt);
      }
      if (Number.isFinite(maxAttempts)) {
        socialMaxAttempts = Math.max(socialMaxAttempts, maxAttempts);
      }
      if (!socialAttemptFieldsMeetContract(entry, socialTarget)) {
        socialInvalidContractCount += 1;
      }
      continue;
    }
    if (entry?.event === "facebook_group_discovery_update") {
      facebookTotal += 1;
      incrementCount(facebookBySource, entry.source);
      const changedCount = Number(entry.changedCount);
      const removedCount = Number(entry.removedCount);
      if (Number.isSafeInteger(changedCount) && changedCount >= 0) {
        facebookChangedCount += changedCount;
      }
      if (Number.isSafeInteger(removedCount) && removedCount >= 0) {
        facebookRemovedCount += removedCount;
      }
      continue;
    }
    if (entry?.event === "rss_pull_attempt") {
      rssTotal += 1;
      incrementCount(rssByTrigger, entry.trigger);
      continue;
    }
    if (entry?.event === "ai_request_attempt") {
      aiTotal += 1;
      incrementNestedCount(aiByProviderPurpose, entry.provider, entry.purpose);
      continue;
    }
    if (entry?.event === "reader_article_fetch_attempt") {
      readerTotal += 1;
      const pin =
        entry.pin === true
          ? "pinned"
          : entry.pin === false
            ? "unpinned"
            : "unspecified";
      incrementNestedCount(readerBySourcePin, entry.source, pin);
      continue;
    }
    if (
      entry?.event === "cloud_upload_attempt" &&
      entry.cause === "startup-repair"
    ) {
      startupTotal += 1;
      const provider = normalizedEventGroup(entry.provider);
      const appSessionId = normalizedEventGroup(entry.appSessionId);
      incrementCount(startupByProvider, provider);
      if (provider === "unknown" || appSessionId === "unknown") {
        startupInvalidGroupCount += 1;
        continue;
      }
      const key = JSON.stringify([appSessionId, provider]);
      const prior = startupGroups.get(key);
      startupGroups.set(key, {
        appSessionId,
        provider,
        count: (prior?.count ?? 0) + 1,
      });
    }
  }

  const groups = [...startupGroups.values()].sort(
    (left, right) =>
      left.appSessionId.localeCompare(right.appSessionId) ||
      left.provider.localeCompare(right.provider),
  );
  const startupTarget = metricContractForAssertion(
    "startup_repair_upload_budget",
  ).target.value;
  return {
    startupRepairUploads: {
      total: startupTotal,
      byProvider: countsToObject(startupByProvider),
      groups,
      maxPerProviderSession: groups.reduce(
        (maximum, group) => Math.max(maximum, group.count),
        0,
      ),
      overBudgetGroupCount: groups.filter(
        (group) => group.count > startupTarget,
      ).length,
      invalidGroupCount: startupInvalidGroupCount,
    },
    socialOutboxAttempts: {
      total: socialTotal,
      byProviderAction: nestedCountsToObject(socialByProviderAction),
      maxAttempt: socialMaxAttempt,
      maxAttempts: socialMaxAttempts,
      invalidContractCount: socialInvalidContractCount,
    },
    facebookGroupDiscoveryUpdates: {
      total: facebookTotal,
      bySource: countsToObject(facebookBySource),
      changedCount: facebookChangedCount,
      removedCount: facebookRemovedCount,
    },
    rssPullAttempts: {
      total: rssTotal,
      byTrigger: countsToObject(rssByTrigger),
    },
    aiRequestAttempts: {
      total: aiTotal,
      byProviderPurpose: nestedCountsToObject(aiByProviderPurpose),
    },
    readerArticleFetchAttempts: {
      total: readerTotal,
      bySourcePin: nestedCountsToObject(readerBySourcePin),
    },
  };
}

export function computeNativeMemoryPressureCoverage(
  healthLines,
  metricsRows,
  {
    collectorExpectedIntervalMs = DEFAULT_COLLECTOR_INTERVAL_MS,
    nativeExpectedIntervalMs = DEFAULT_RUNTIME_HEALTH_INTERVAL_MS,
  } = {},
) {
  const intervals = appAliveIntervals(metricsRows, {
    expectedIntervalMs: collectorExpectedIntervalMs,
  });
  const timing = runtimeHealthTiming(nativeExpectedIntervalMs);
  const inCreditedInterval = (timestamp) =>
    intervals.some(
      (interval) =>
        timestamp >= interval.startMs && timestamp <= interval.endMs,
    );
  const observed = healthLines
    .map(({ entry }) => entry)
    .filter(
      (entry) =>
        entry?.event === "native_runtime_memory_sample" &&
        Number.isFinite(Number(entry.tsMs)) &&
        inCreditedInterval(Number(entry.tsMs)),
    );
  const valid = observed.filter((entry) => {
    const pressureBytes = Number(entry.appMemoryPressureBytes);
    const highBytes = Number(entry.memoryHighBytes);
    const criticalBytes = Number(entry.memoryCriticalBytes);
    const rendererGeneration = Number(entry.rendererGeneration);
    return (
      Number.isSafeInteger(pressureBytes) &&
      pressureBytes >= 0 &&
      Number.isSafeInteger(highBytes) &&
      highBytes > 0 &&
      Number.isSafeInteger(criticalBytes) &&
      criticalBytes >= highBytes &&
      Number.isSafeInteger(rendererGeneration) &&
      rendererGeneration > 0 &&
      typeof entry.pageLoadId === "string" &&
      entry.pageLoadId.trim().length > 0
    );
  });
  const invalidSampleCount = observed.length - valid.length;
  const timestamps = valid
    .map((entry) => Number(entry.tsMs))
    .sort((left, right) => left - right);
  const distinctTimestamps = [...new Set(timestamps)];
  const duplicateTimestampCount = timestamps.length - distinctTimestamps.length;
  const pageLoadIds = new Set(valid.map((entry) => entry.pageLoadId.trim()));
  const rendererGenerations = new Set(
    valid.map((entry) => Number(entry.rendererGeneration)),
  );

  let expectedSampleCount = 0;
  let largestObservedGapMs = 0;
  let lastFreshnessMs = 0;
  let coveredSegmentCount = 0;
  for (const interval of intervals) {
    const durationMs = interval.endMs - interval.startMs;
    expectedSampleCount += Math.max(
      1,
      Math.ceil(durationMs / timing.expectedIntervalMs),
    );
    const segmentSamples = distinctTimestamps.filter(
      (timestamp) =>
        timestamp >= interval.startMs && timestamp <= interval.endMs,
    );
    if (segmentSamples.length > 0) coveredSegmentCount += 1;
    let priorTimestamp = interval.startMs;
    for (const timestamp of segmentSamples) {
      largestObservedGapMs = Math.max(
        largestObservedGapMs,
        timestamp - priorTimestamp,
      );
      priorTimestamp = timestamp;
    }
    const freshnessMs = interval.endMs - priorTimestamp;
    largestObservedGapMs = Math.max(largestObservedGapMs, freshnessMs);
    lastFreshnessMs = Math.max(lastFreshnessMs, freshnessMs);
  }
  const sampleDensity =
    expectedSampleCount > 0
      ? Math.min(1, distinctTimestamps.length / expectedSampleCount)
      : 0;
  const healthy =
    intervals.length === 1 &&
    expectedSampleCount >= 3 &&
    distinctTimestamps.length >= 3 &&
    invalidSampleCount === 0 &&
    duplicateTimestampCount === 0 &&
    pageLoadIds.size === 1 &&
    rendererGenerations.size === 1 &&
    coveredSegmentCount === intervals.length &&
    sampleDensity >= MIN_RUNTIME_HEALTH_SAMPLE_DENSITY &&
    largestObservedGapMs <= timing.maxCreditedGapMs &&
    lastFreshnessMs <= timing.maxCreditedGapMs;
  const p95Bytes = healthy
    ? nearestRankPercentile(
        valid.map((entry) => Number(entry.appMemoryPressureBytes)),
        0.95,
      )
    : null;
  const reason = healthy
    ? null
    : `Native memory-pressure coverage used ${distinctTimestamps.length.toLocaleString()} distinct valid sample${distinctTimestamps.length === 1 ? "" : "s"} against ${expectedSampleCount.toLocaleString()} expected across ${intervals.length.toLocaleString()} credited segment${intervals.length === 1 ? "" : "s"}; invalid=${invalidSampleCount.toLocaleString()}, duplicates=${duplicateTimestampCount.toLocaleString()}, page loads=${pageLoadIds.size.toLocaleString()}, renderer generations=${rendererGenerations.size.toLocaleString()}, largest gap=${largestObservedGapMs.toLocaleString()} ms.`;
  return {
    nativeMemoryPressureSampleCount: observed.length,
    nativeMemoryPressureValidSampleCount: valid.length,
    nativeMemoryPressureDistinctSampleCount: distinctTimestamps.length,
    nativeMemoryPressureExpectedSampleCount: expectedSampleCount,
    nativeMemoryPressureSampleDensity: sampleDensity,
    nativeMemoryPressureExpectedIntervalMs: timing.expectedIntervalMs,
    nativeMemoryPressureMaxCreditedGapMs: timing.maxCreditedGapMs,
    nativeMemoryPressureLargestObservedGapMs: largestObservedGapMs,
    nativeMemoryPressureLastFreshnessMs: lastFreshnessMs,
    nativeMemoryPressureAppAliveSegmentCount: intervals.length,
    nativeMemoryPressureCoveredAppAliveSegmentCount: coveredSegmentCount,
    nativeMemoryPressureInvalidSampleCount: invalidSampleCount,
    nativeMemoryPressureDuplicateTimestampCount: duplicateTimestampCount,
    nativeMemoryPressurePageLoadIdCount: pageLoadIds.size,
    nativeMemoryPressureRendererGenerationCount: rendererGenerations.size,
    nativeMemoryPressureCoverageHealthy: healthy,
    nativeMemoryPressureCoverageReason: reason,
    appMemoryPressureP95Bytes: p95Bytes,
  };
}

export function computeCloudEligibleHours(
  healthLines,
  metricsRows,
  { expectedIntervalMs } = {},
) {
  const cloudIntervals = mergeIntervals(
    healthLines
      .filter(
        ({ entry }) =>
          entry.event === "cloud_sync_coverage" &&
          entry.connected === true &&
          entry.eligible === true,
      )
      .map(({ entry }) => ({
        startMs: Number(entry.intervalStartMs),
        endMs: Number(entry.intervalEndMs),
      })),
  );
  const runtimeIntervals = appAliveIntervals(metricsRows ?? [], {
    expectedIntervalMs,
  });
  const eligibleMs = cloudIntervals.reduce(
    (sum, cloudInterval) =>
      sum +
      runtimeIntervals.reduce(
        (runtimeSum, runtimeInterval) =>
          runtimeSum +
          Math.max(
            0,
            Math.min(cloudInterval.endMs, runtimeInterval.endMs) -
              Math.max(cloudInterval.startMs, runtimeInterval.startMs),
          ),
        0,
      ),
    0,
  );
  return eligibleMs > 0 ? eligibleMs / 3_600_000 : null;
}

export function assertFootprintSlope(
  healthLines,
  metricsRows,
  metricsPath,
  healthPath,
) {
  // Prefer the app's own heartbeat footprint (attributed); fall back to the
  // collector's ps rss for the main process.
  const heartbeatPoints = healthLines
    .filter(({ entry }) => entry.event === "renderer_heartbeat")
    .map(({ entry }) => ({
      tsMs: Number(entry.tsMs ?? 0),
      bytes: Number(
        entry.nativeFootprintBytes ?? entry.nativeResidentBytes ?? 0,
      ),
    }));
  const psPoints = metricsRows.map((row) => ({
    tsMs: row.tsMs,
    bytes: row.appRssKb * 1024,
  }));
  const source =
    heartbeatPoints.filter((p) => p.bytes > 0).length >= 2
      ? "renderer_heartbeat.nativeFootprintBytes"
      : `${path.basename(metricsPath)}.appRssKb`;
  const points = source.startsWith("renderer_heartbeat")
    ? heartbeatPoints
    : psPoints;

  const usable = points.filter((point) => point.bytes > 0 && point.tsMs > 0);
  if (usable.length < 2) {
    return assertion(
      "main_footprint_slope",
      "skipped",
      "No footprint samples available.",
    );
  }
  const spanHours = (usable.at(-1).tsMs - usable[0].tsMs) / 3_600_000;
  const slope = footprintSlopeMbPerHour(usable);
  if (spanHours < SLOPE_MIN_HOURS) {
    return assertion(
      "main_footprint_slope",
      "skipped",
      `Window is ${spanHours.toFixed(2)}h; slope needs >= ${SLOPE_MIN_HOURS}h. Measured ${slope?.toFixed(1) ?? "n/a"} MB/h over ${usable.length} samples from ${source} (informational).`,
    );
  }
  if (slope === null) {
    return assertion(
      "main_footprint_slope",
      "skipped",
      "Slope could not be computed.",
    );
  }
  if (slope >= SLOPE_LIMIT_MB_PER_HOUR) {
    return assertion(
      "main_footprint_slope",
      "fail",
      `${slope.toFixed(1)} MB/h over ${spanHours.toFixed(1)}h (${usable.length} samples from ${source}); limit ${SLOPE_LIMIT_MB_PER_HOUR} MB/h.`,
      [
        cite(
          source.startsWith("renderer_heartbeat") ? healthPath : metricsPath,
          0,
          `first ${usable[0].bytes.toLocaleString()} bytes @ ${new Date(usable[0].tsMs).toISOString()}, last ${usable.at(-1).bytes.toLocaleString()} bytes @ ${new Date(usable.at(-1).tsMs).toISOString()}`,
        ),
      ],
    );
  }
  return assertion(
    "main_footprint_slope",
    "pass",
    `${slope.toFixed(1)} MB/h over ${spanHours.toFixed(1)}h (${usable.length} samples from ${source}).`,
  );
}

export function assertEventCountZero(
  id,
  healthLines,
  healthPath,
  eventName,
  { runtimeEvidenceActionable = true } = {},
) {
  const hits = healthLines.filter(({ entry }) => entry.event === eventName);
  if (!runtimeEvidenceActionable) {
    return assertion(
      id,
      "inconclusive",
      `Runtime-health coverage or attribution is incomplete, so ${hits.length.toLocaleString()} observed ${eventName} event${hits.length === 1 ? "" : "s"} cannot establish the complete-window count.`,
      hits.slice(0, 10).map(({ line, raw }) => cite(healthPath, line, raw)),
    );
  }
  if (hits.length === 0) {
    return assertion(id, "pass", `0 ${eventName} events in the soak window.`);
  }
  return assertion(
    id,
    "fail",
    `${hits.length} ${eventName} event${hits.length === 1 ? "" : "s"} in the soak window.`,
    hits.slice(0, 10).map(({ line, raw }) => cite(healthPath, line, raw)),
  );
}

export function assertWorkerInitRate(
  healthLines,
  healthPath,
  { appAliveHours = null, runtimeEvidenceActionable = true } = {},
) {
  const workerInitLines = healthLines.filter(
    ({ entry }) => entry.event === "worker_init",
  );
  const contract = metricContractForAssertion("worker_init_rate");
  const target = contract.target;
  const observed = workerInitLines.length;

  if (!runtimeEvidenceActionable) {
    return assertion(
      "worker_init_rate",
      "inconclusive",
      `Runtime-health coverage or attribution is incomplete, so ${observed.toLocaleString()} observed worker INIT event${observed === 1 ? "" : "s"} cannot establish a complete-window rate.`,
    );
  }

  if (!Number.isFinite(appAliveHours) || appAliveHours <= 0) {
    return assertion(
      "worker_init_rate",
      "inconclusive",
      `${observed.toLocaleString()} worker INIT event${observed === 1 ? "" : "s"} observed, but no valid app-alive duration established the rate denominator.`,
    );
  }

  if (appAliveHours < target.minHours) {
    return assertion(
      "worker_init_rate",
      "inconclusive",
      `App-alive coverage is ${localeFixed(appAliveHours, 2)}h; worker INIT rate needs at least ${target.minHours.toLocaleString()}h. Observed ${observed.toLocaleString()} worker INIT event${observed === 1 ? "" : "s"}.`,
    );
  }

  const rate = observed / appAliveHours;
  const failed = target.exclusive ? rate >= target.value : rate > target.value;
  return assertion(
    "worker_init_rate",
    failed ? "fail" : "pass",
    `${observed.toLocaleString()} worker INIT event${observed === 1 ? "" : "s"} over ${localeFixed(appAliveHours, 2)} app-alive hours (${localeFixed(rate, 2)}/h; target below ${target.value.toLocaleString()}/h).`,
    failed
      ? workerInitLines
          .slice(0, 10)
          .map(({ line, raw }) => cite(healthPath, line, raw))
      : [],
  );
}

export function assertWebkitReturnsToBaseline(metricsRows, metricsPath) {
  const rows = metricsRows.filter((row) =>
    Number.isFinite(row.webkitWebContentCount),
  );
  if (rows.length < 3) {
    return assertion(
      "webkit_returns_to_baseline",
      "skipped",
      "Not enough collector samples to judge WebContent count.",
    );
  }
  const baseline = Math.min(...rows.map((row) => row.webkitWebContentCount));
  const tail = rows.slice(-Math.max(3, Math.floor(rows.length * 0.1)));
  const tailMin = Math.min(...tail.map((row) => row.webkitWebContentCount));
  if (tailMin > baseline) {
    const worst =
      tail.find((row) => row.webkitWebContentCount === tailMin) ?? tail.at(-1);
    return assertion(
      "webkit_returns_to_baseline",
      "fail",
      `WebContent count never returned to its baseline of ${baseline} in the final samples (still ${tailMin}). Machine-wide count; app-attributed counts arrive with P0-02/P0-03.`,
      [
        cite(
          metricsPath,
          worst.line,
          `${worst.iso} webkitWebContentCount=${worst.webkitWebContentCount.toLocaleString()}`,
        ),
      ],
    );
  }
  return assertion(
    "webkit_returns_to_baseline",
    "pass",
    `WebContent count returned to its baseline of ${baseline} by the end of the soak.`,
  );
}

export function classifyWindowDestruction(entry) {
  if (entry?.event !== "window_destroyed") return "not_window_destruction";

  const reason = typeof entry.reasonEnum === "string" ? entry.reasonEnum : "";
  const activeJob =
    typeof entry.jsActiveJob === "string" && entry.jsActiveJob.length > 0;
  const activeOperation =
    entry.sessionActive === true ||
    entry.scraperSessionHeld === true ||
    entry.loginSessionActive === true ||
    activeJob;
  const hasOperationState =
    Object.hasOwn(entry, "sessionActive") ||
    Object.hasOwn(entry, "scraperSessionHeld") ||
    Object.hasOwn(entry, "loginSessionActive") ||
    Object.hasOwn(entry, "jsActiveJob");

  // A provider tears down its own window before releasing the scraper mutex.
  // That is expected completion, not evidence that another operation killed it.
  if (reason === "job_complete") {
    const jobProvider = activeJob
      ? (entry.jsActiveJob.match(/^(fb|ig|li|x)_/)?.[1] ?? null)
      : null;
    const labelProvider =
      String(entry.label ?? "").match(/^(fb|ig|li|x)-/)?.[1] ?? null;
    if (
      activeJob &&
      (!labelProvider || (jobProvider && jobProvider !== labelProvider))
    ) {
      return "active_operation_destroyed";
    }
    return "expected_self_teardown";
  }
  if (activeOperation) return "active_operation_destroyed";
  if (!hasOperationState) return "inconclusive";
  return "inactive_window_destroyed";
}

function novelItems(entry) {
  if (Number.isFinite(entry.itemsNovel))
    return Math.max(0, Number(entry.itemsNovel));
  if (
    Number.isFinite(entry.itemsExtracted) &&
    Number.isFinite(entry.itemsAlreadyPresent)
  ) {
    return Math.max(
      0,
      Number(entry.itemsExtracted) - Number(entry.itemsAlreadyPresent),
    );
  }
  return null;
}

// P0-02/P0-03 counters. Guarded: skipped until the app emits fields that are
// precise enough to prove the metric contract.
export function assertGuardedCounters(
  healthLines,
  healthPath,
  { cloudCoverageHours = null, runtimeEvidenceActionable = true } = {},
) {
  const results = [];

  if (!runtimeEvidenceActionable) {
    const observedUploads = healthLines.filter(
      ({ entry }) => typeof entry.headsUnchanged === "boolean",
    ).length;
    const observedKills = healthLines.filter(
      ({ entry }) => entry.event === "window_destroyed",
    ).length;
    const observedScrapes = healthLines.filter(
      ({ entry }) =>
        Number.isFinite(entry.itemsExtracted) &&
        Number.isFinite(entry.itemsPersisted),
    ).length;
    return [
      assertion(
        "uploads_unchanged_heads",
        "inconclusive",
        `Runtime-health coverage or attribution is incomplete; ${observedUploads.toLocaleString()} observed upload attempt${observedUploads === 1 ? "" : "s"} cannot establish a complete-window rate.`,
      ),
      assertion(
        "preflight_kills",
        "inconclusive",
        `Runtime-health coverage or attribution is incomplete; ${observedKills.toLocaleString()} observed window destruction${observedKills === 1 ? "" : "s"} cannot establish a complete-window zero.`,
      ),
      assertion(
        "scrape_zero_persist",
        "inconclusive",
        `Runtime-health coverage or attribution is incomplete; ${observedScrapes.toLocaleString()} observed scrape outcome${observedScrapes === 1 ? "" : "s"} cannot establish a complete-window zero.`,
      ),
    ];
  }

  const uploadLines = healthLines.filter(
    ({ entry }) => typeof entry.headsUnchanged === "boolean",
  );
  if (cloudCoverageHours === null) {
    results.push(
      assertion(
        "uploads_unchanged_heads",
        "inconclusive",
        `${uploadLines.length.toLocaleString()} upload attempt${uploadLines.length === 1 ? "" : "s"} observed, but no valid cloud_sync_coverage interval established how long cloud sync was connected and eligible.`,
      ),
    );
  } else {
    const unchanged = uploadLines.filter(
      ({ entry }) => entry.headsUnchanged === true,
    );
    const contract = metricContractForAssertion("uploads_unchanged_heads");
    const target = contract.target;
    if (cloudCoverageHours < target.minHours) {
      results.push(
        assertion(
          "uploads_unchanged_heads",
          "inconclusive",
          `Cloud-eligible coverage is ${localeFixed(cloudCoverageHours, 2)}h; unchanged-upload rate needs at least ${target.minHours.toLocaleString()}h. Observed ${unchanged.length.toLocaleString()} unchanged upload${unchanged.length === 1 ? "" : "s"} in ${uploadLines.length.toLocaleString()} attempts.`,
        ),
      );
    } else {
      const rate = unchanged.length / cloudCoverageHours;
      const failed = target.exclusive
        ? rate >= target.value
        : rate > target.value;
      results.push(
        assertion(
          "uploads_unchanged_heads",
          failed ? "fail" : "pass",
          `${unchanged.length.toLocaleString()} of ${uploadLines.length.toLocaleString()} uploads had unchanged heads over ${localeFixed(cloudCoverageHours, 2)} cloud-eligible hours (${localeFixed(rate, 2)}/h; target below ${target.value.toLocaleString()}/h).`,
          failed
            ? unchanged
                .slice(0, 10)
                .map(({ line, raw }) => cite(healthPath, line, raw))
            : [],
        ),
      );
    }
  }

  const killLines = healthLines.filter(
    ({ entry }) => entry.event === "window_destroyed",
  );
  if (killLines.length === 0) {
    results.push(
      assertion(
        "preflight_kills",
        "skipped",
        "No window_destroyed records (lands with P0-02).",
      ),
    );
  } else {
    const classified = killLines.map((line) => ({
      ...line,
      classification: classifyWindowDestruction(line.entry),
    }));
    const destructive = classified.filter(
      ({ classification }) => classification === "active_operation_destroyed",
    );
    const conclusive = classified.filter(
      ({ classification }) => classification !== "inconclusive",
    );
    if (conclusive.length === 0) {
      results.push(
        assertion(
          "preflight_kills",
          "skipped",
          `${killLines.length.toLocaleString()} window_destroyed record${killLines.length === 1 ? "" : "s"} lacked operation state; active-operation destruction is inconclusive.`,
        ),
      );
    } else {
      results.push(
        destructive.length === 0
          ? assertion(
              "preflight_kills",
              "pass",
              `0 of ${conclusive.length.toLocaleString()} classified window_destroyed records destroyed an active operation; job_complete self-teardown is excluded.`,
            )
          : assertion(
              "preflight_kills",
              "fail",
              `${destructive.length.toLocaleString()} window_destroyed record${destructive.length === 1 ? "" : "s"} destroyed an active operation (F04); job_complete self-teardown is excluded.`,
              destructive
                .slice(0, 10)
                .map(({ line, raw }) => cite(healthPath, line, raw)),
            ),
      );
    }
  }

  const scrapeLines = healthLines.filter(
    ({ entry }) =>
      Number.isFinite(entry.itemsExtracted) &&
      Number.isFinite(entry.itemsPersisted),
  );
  if (scrapeLines.length === 0) {
    results.push(
      assertion(
        "scrape_zero_persist",
        "skipped",
        "Counter not yet emitted (lands with P0-03).",
      ),
    );
  } else {
    const decisive = scrapeLines
      .map((line) => ({ ...line, itemsNovel: novelItems(line.entry) }))
      .filter(({ itemsNovel }) => itemsNovel !== null);
    if (decisive.length === 0) {
      results.push(
        assertion(
          "scrape_zero_persist",
          "skipped",
          `${scrapeLines.length.toLocaleString()} scrape outcome${scrapeLines.length === 1 ? "" : "s"} reported extracted and persisted counts but not novel or already-present counts; duplicate-only scrapes are not data loss.`,
        ),
      );
    } else {
      const lostNovel = decisive.filter(
        ({ entry, itemsNovel: novel }) => novel > Number(entry.itemsPersisted),
      );
      results.push(
        lostNovel.length === 0
          ? assertion(
              "scrape_zero_persist",
              "pass",
              `0 of ${decisive.length.toLocaleString()} classified scrapes failed to persist novel items.`,
            )
          : assertion(
              "scrape_zero_persist",
              "fail",
              `${lostNovel.length.toLocaleString()} scrape${lostNovel.length === 1 ? "" : "s"} persisted fewer items than were classified novel (F03 signature).`,
              lostNovel
                .slice(0, 10)
                .map(({ line, raw }) => cite(healthPath, line, raw)),
            ),
      );
    }
  }

  return results;
}

// Invariant alarms (W2-01). A firing alarm is the EXPECTED positive control
// before its damper lands, so this is an informational measurement line
// (alarms/day), never a fail gate. The count and per-name breakdown feed the
// scorecard; the damper cycle is what flips a given alarm to zero.
export function assertAlarmCounts(
  healthLines,
  healthPath,
  { runtimeEvidenceActionable = true } = {},
) {
  const alarmLines = healthLines.filter(
    ({ entry }) => entry.event === "invariant_alarm",
  );
  if (!runtimeEvidenceActionable) {
    return assertion(
      "invariant_alarms",
      "inconclusive",
      `Runtime-health coverage or attribution is incomplete; ${alarmLines.length.toLocaleString()} observed invariant alarm${alarmLines.length === 1 ? "" : "s"} cannot establish a complete-window rate.`,
      alarmLines
        .slice(0, 10)
        .map(({ line, raw }) => cite(healthPath, line, raw)),
    );
  }
  if (alarmLines.length === 0) {
    return assertion(
      "invariant_alarms",
      "pass",
      "0 invariant_alarm events in the soak window.",
    );
  }
  const byName = {};
  for (const { entry } of alarmLines) {
    const name = typeof entry.name === "string" ? entry.name : "unknown";
    byName[name] = (byName[name] ?? 0) + 1;
  }
  const breakdown = Object.entries(byName)
    .sort((a, b) => b[1] - a[1])
    .map(([name, count]) => `${name}=${count}`)
    .join(", ");
  return assertion(
    "invariant_alarms",
    "pass",
    `${alarmLines.length} invariant_alarm event${alarmLines.length === 1 ? "" : "s"} (${breakdown}). Informational: alarms observe pathologies as positive controls before their dampers land.`,
    alarmLines.slice(0, 10).map(({ line, raw }) => cite(healthPath, line, raw)),
  );
}

export function assertWorkerIdleTerminationContract(
  healthLines,
  healthPath,
  { runtimeEvidenceActionable = true } = {},
) {
  const terminationLines = healthLines.filter(
    ({ entry }) => entry.event === "worker_idle_terminated",
  );
  const summary = summarizeWorkerIdleTerminations(terminationLines);
  const breakdown = WORKER_IDLE_TERMINATION_REASONS.map(
    (reason) => `${reason}=${summary.byReason[reason].toLocaleString()}`,
  ).join(", ");
  if (!runtimeEvidenceActionable) {
    return assertion(
      "worker_idle_termination_contract",
      "inconclusive",
      `Runtime-health coverage or attribution is incomplete, so ${summary.total.toLocaleString()} observed worker idle termination event${summary.total === 1 ? "" : "s"} cannot establish a complete-window reason summary (${breakdown}).`,
    );
  }
  if (summary.invalidReasonCount > 0) {
    return assertion(
      "worker_idle_termination_contract",
      "inconclusive",
      `${summary.invalidReasonCount.toLocaleString()} of ${summary.total.toLocaleString()} worker idle termination event${summary.total === 1 ? "" : "s"} had a missing or unregistered reason (${breakdown}).`,
      terminationLines
        .filter(
          ({ entry }) => !WORKER_IDLE_TERMINATION_REASON_SET.has(entry.reason),
        )
        .slice(0, 10)
        .map(({ line, raw }) => cite(healthPath, line, raw)),
    );
  }
  return assertion(
    "worker_idle_termination_contract",
    "pass",
    `${summary.total.toLocaleString()} worker idle termination event${summary.total === 1 ? "" : "s"} (${breakdown}).`,
  );
}

export function assertRequestSurfaceContracts(
  healthLines,
  healthPath,
  { runtimeEvidenceActionable = true } = {},
) {
  const summary = summarizeRequestSurfaceEvents(healthLines);
  const startupLines = healthLines.filter(
    ({ entry }) =>
      entry?.event === "cloud_upload_attempt" &&
      entry.cause === "startup-repair",
  );
  const socialLines = healthLines.filter(
    ({ entry }) => entry?.event === "social_outbox_attempt",
  );
  if (!runtimeEvidenceActionable) {
    return [
      assertion(
        "startup_repair_upload_budget",
        "inconclusive",
        `Runtime-health coverage or attribution is incomplete, so ${startupLines.length.toLocaleString()} observed startup repair upload${startupLines.length === 1 ? "" : "s"} cannot establish the per-provider, per-session budget.`,
      ),
      assertion(
        "social_outbox_retry_budget",
        "inconclusive",
        `Runtime-health coverage or attribution is incomplete, so ${socialLines.length.toLocaleString()} observed social outbox attempt${socialLines.length === 1 ? "" : "s"} cannot establish the retry-field contract.`,
      ),
    ];
  }

  const startupTarget = metricContractForAssertion(
    "startup_repair_upload_budget",
  ).target.value;
  const violatingStartupGroups = summary.startupRepairUploads.groups.filter(
    (group) => group.count > startupTarget,
  );
  let startupAssertion;
  if (violatingStartupGroups.length > 0) {
    const violatingKeys = new Set(
      violatingStartupGroups.map(({ appSessionId, provider }) =>
        JSON.stringify([appSessionId, provider]),
      ),
    );
    const violations = startupLines.filter(({ entry }) =>
      violatingKeys.has(
        JSON.stringify([
          normalizedEventGroup(entry.appSessionId),
          normalizedEventGroup(entry.provider),
        ]),
      ),
    );
    const breakdown = violatingStartupGroups
      .map(
        ({ provider, count }) =>
          `${provider}=${count.toLocaleString()}`,
      )
      .join(", ");
    startupAssertion = assertion(
      "startup_repair_upload_budget",
      "fail",
      `${violatingStartupGroups.length.toLocaleString()} provider and app-session group${violatingStartupGroups.length === 1 ? "" : "s"} exceeded the startup repair upload budget of ${startupTarget.toLocaleString()} (${breakdown}).`,
      violations
        .slice(0, 10)
        .map(({ line, raw }) => cite(healthPath, line, raw)),
    );
  } else if (summary.startupRepairUploads.invalidGroupCount > 0) {
    startupAssertion = assertion(
      "startup_repair_upload_budget",
      "inconclusive",
      `${summary.startupRepairUploads.invalidGroupCount.toLocaleString()} startup repair upload event${summary.startupRepairUploads.invalidGroupCount === 1 ? "" : "s"} lacked a provider or app session identity.`,
      startupLines
        .filter(
          ({ entry }) =>
            normalizedEventGroup(entry.provider) === "unknown" ||
            normalizedEventGroup(entry.appSessionId) === "unknown",
        )
        .slice(0, 10)
        .map(({ line, raw }) => cite(healthPath, line, raw)),
    );
  } else {
    startupAssertion = assertion(
      "startup_repair_upload_budget",
      "pass",
      `${summary.startupRepairUploads.total.toLocaleString()} startup repair upload${summary.startupRepairUploads.total === 1 ? "" : "s"}; no provider and app-session group exceeded ${startupTarget.toLocaleString()}.`,
    );
  }

  const socialTarget = metricContractForAssertion(
    "social_outbox_retry_budget",
  ).target.value;
  const invalidSocialLines = socialLines.filter(
    ({ entry }) => !socialAttemptFieldsMeetContract(entry, socialTarget),
  );
  const socialAssertion =
    invalidSocialLines.length > 0
      ? assertion(
          "social_outbox_retry_budget",
          "fail",
          `${invalidSocialLines.length.toLocaleString()} of ${socialLines.length.toLocaleString()} social outbox attempt events violated the attempt and maxAttempts ceiling of ${socialTarget.toLocaleString()}.`,
          invalidSocialLines
            .slice(0, 10)
            .map(({ line, raw }) => cite(healthPath, line, raw)),
        )
      : assertion(
          "social_outbox_retry_budget",
          "pass",
          `${socialLines.length.toLocaleString()} social outbox attempt${socialLines.length === 1 ? "" : "s"}; attempt and maxAttempts stayed at or below ${socialTarget.toLocaleString()}.`,
        );

  return [startupAssertion, socialAssertion];
}

export function isMetricRelevantRuntimeEntry(entry) {
  return Boolean(
    entry &&
    (entry.event === "renderer_heartbeat" ||
      entry.event === "renderer_recovery_restart_requested" ||
      entry.event === "renderer_heartbeat_stale" ||
      entry.event === "cloud_sync_coverage" ||
      entry.event === "cloud_upload_attempt" ||
      entry.event === "cloud_upload_skipped" ||
      entry.event === "window_destroyed" ||
      entry.event === "scrape_outcome" ||
      entry.event === "invariant_alarm" ||
      entry.event === "worker_init" ||
      entry.event === "worker_init_recovery" ||
      entry.event === "worker_idle_terminated" ||
      entry.event === "native_runtime_memory_sample" ||
      entry.event === "social_outbox_attempt" ||
      entry.event === "facebook_group_discovery_update" ||
      entry.event === "rss_pull_attempt" ||
      entry.event === "ai_request_attempt" ||
      entry.event === "reader_article_fetch_attempt" ||
      typeof entry.headsUnchanged === "boolean"),
  );
}

function identityFromEntry(entry) {
  if (!entry || typeof entry !== "object") return null;
  const appVersion =
    typeof entry.appVersion === "string" ? entry.appVersion.trim() : "";
  const buildCommitSha =
    typeof entry.buildCommitSha === "string"
      ? entry.buildCommitSha.trim().toLowerCase()
      : "";
  const channel = typeof entry.channel === "string" ? entry.channel.trim() : "";
  const appSessionId =
    typeof entry.appSessionId === "string" ? entry.appSessionId.trim() : "";
  if (
    !appVersion ||
    !/^[0-9a-f]{40,64}$/.test(buildCommitSha) ||
    !["dev", "production"].includes(channel) ||
    !appSessionId
  ) {
    return null;
  }
  return { appVersion, buildCommitSha, channel, appSessionId };
}

export function runtimeIdentityFromHealthLines(healthLines) {
  const relevantEntries = healthLines
    .map(({ entry }) => entry)
    .filter(isMetricRelevantRuntimeEntry);
  const complete = relevantEntries.flatMap((entry) => {
    const identity = identityFromEntry(entry);
    return identity ? [identity] : [];
  });
  const untaggedCount = relevantEntries.length - complete.length;
  const unique = [
    ...new Map(
      complete.map((identity) => [JSON.stringify(identity), identity]),
    ).values(),
  ];
  const status =
    relevantEntries.length === 0
      ? "missing"
      : untaggedCount > 0
        ? "incomplete"
        : unique.length === 1
          ? "attributable"
          : "mixed";
  return {
    status,
    evidenceCount: relevantEntries.length,
    attributedEvidenceCount: complete.length,
    untaggedCount,
    identity: status === "attributable" ? unique[0] : null,
  };
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

export function runtimeHealthEvidenceFingerprint(healthLines) {
  const diagnosticRecords = healthLines?.sourceDiagnostics?.rawRecords;
  const records = Array.isArray(diagnosticRecords)
    ? diagnosticRecords.map((raw) => String(raw))
    : healthLines.map((line) =>
        stableJson(Object.hasOwn(line, "entry") ? line.entry : line),
      );
  return {
    algorithm: "sha256",
    digest: createHash("sha256").update(records.join("\n")).digest("hex"),
    recordCount: records.length,
  };
}

function normalizedFingerprintComponent(component) {
  return {
    algorithm: "sha256",
    digest: String(component?.digest ?? "").toLowerCase(),
    recordCount: Number(component?.recordCount),
    ...(component?.byteLength === undefined
      ? {}
      : { byteLength: Number(component.byteLength) }),
  };
}

export function collectorMetricsEvidenceFingerprint(
  metricsText,
  metricsRows = undefined,
) {
  const text = String(metricsText ?? "");
  const rows = metricsRows ?? parseMetricsTsv(text);
  return {
    algorithm: "sha256",
    digest: createHash("sha256").update(text).digest("hex"),
    recordCount: rows.sourceDiagnostics?.sourceLineCount ?? rows.length,
    byteLength: Buffer.byteLength(text, "utf8"),
  };
}

export function collectorEventsEvidenceFingerprint(
  collectorEventsText,
  collectorEvents = undefined,
) {
  const text = String(collectorEventsText ?? "");
  const events = collectorEvents ?? parseCollectorEventsJsonl(text);
  return {
    algorithm: "sha256",
    digest: createHash("sha256").update(text).digest("hex"),
    recordCount: events.sourceDiagnostics?.sourceLineCount ?? events.length,
    byteLength: Buffer.byteLength(text, "utf8"),
  };
}

export function sourceHealthFingerprintFields(sourceHealth) {
  return {
    healthy:
      sourceHealth?.healthy === true || sourceHealth?.status === "healthy",
    sampleCount: Number(
      sourceHealth?.sampleCount ?? sourceHealth?.collectorSampleCount,
    ),
    distinctSampleCount: Number(
      sourceHealth?.distinctSampleCount ??
        sourceHealth?.collectorDistinctSampleCount,
    ),
    expectedSampleCount: Number(sourceHealth?.expectedSampleCount),
    sampleDensity: Number(sourceHealth?.sampleDensity),
    spanHours: Number(
      sourceHealth?.spanHours ?? sourceHealth?.collectorSpanHours,
    ),
    appAliveHours: Number(sourceHealth?.appAliveHours),
    appAliveRatio: Number(sourceHealth?.appAliveRatio),
    expectedIntervalMs: Number(sourceHealth?.expectedIntervalMs),
    maxCreditedGapMs: Number(sourceHealth?.maxCreditedGapMs),
    largestObservedGapMs: Number(sourceHealth?.largestObservedGapMs),
    creditedIntervalCount: Number(sourceHealth?.creditedIntervalCount),
    cloudEligibleHours:
      sourceHealth?.cloudEligibleHours === null ||
      sourceHealth?.cloudEligibleHours === undefined
        ? null
        : Number(sourceHealth.cloudEligibleHours),
    collectorHeaderHealthy: sourceHealth?.collectorHeaderHealthy !== false,
    collectorMalformedRowCount: Number(
      sourceHealth?.collectorMalformedRowCount ?? 0,
    ),
    collectorEventCount: Number(sourceHealth?.collectorEventCount ?? 0),
    collectorEventFailureCount: Number(
      sourceHealth?.collectorEventFailureCount ?? 0,
    ),
    collectorEventRecoveryCount: Number(
      sourceHealth?.collectorEventRecoveryCount ?? 0,
    ),
    collectorEventMalformedLineCount: Number(
      sourceHealth?.collectorEventMalformedLineCount ?? 0,
    ),
    collectorEventProtocolErrorCount: Number(
      sourceHealth?.collectorEventProtocolErrorCount ?? 0,
    ),
    collectorOutageOpen: sourceHealth?.collectorOutageOpen === true,
    collectorOpenOutageStartedAtMs:
      sourceHealth?.collectorOpenOutageStartedAtMs === null ||
      sourceHealth?.collectorOpenOutageStartedAtMs === undefined
        ? null
        : Number(sourceHealth.collectorOpenOutageStartedAtMs),
    collectorEventCoverageHealthy:
      sourceHealth?.collectorEventCoverageHealthy !== false,
    collectorEventEvidenceCapable:
      sourceHealth?.collectorEventEvidenceCapable === true,
    collectorEventEvidencePresent:
      sourceHealth?.collectorEventEvidencePresent === true,
    collectorEventEvidenceSchemaVersion:
      sourceHealth?.collectorEventEvidenceSchemaVersion === null ||
      sourceHealth?.collectorEventEvidenceSchemaVersion === undefined
        ? null
        : Number(sourceHealth.collectorEventEvidenceSchemaVersion),
    runtimeHealthMalformedLineCount: Number(
      sourceHealth?.runtimeHealthMalformedLineCount ?? 0,
    ),
    runtimeHealthSampleCount: Number(sourceHealth?.runtimeHealthSampleCount),
    runtimeHealthDistinctSampleCount: Number(
      sourceHealth?.runtimeHealthDistinctSampleCount,
    ),
    runtimeHealthExpectedSampleCount: Number(
      sourceHealth?.runtimeHealthExpectedSampleCount,
    ),
    runtimeHealthSampleDensity: Number(
      sourceHealth?.runtimeHealthSampleDensity,
    ),
    runtimeHealthExpectedIntervalMs: Number(
      sourceHealth?.runtimeHealthExpectedIntervalMs,
    ),
    runtimeHealthMaxCreditedGapMs: Number(
      sourceHealth?.runtimeHealthMaxCreditedGapMs,
    ),
    runtimeHealthLargestObservedGapMs: Number(
      sourceHealth?.runtimeHealthLargestObservedGapMs,
    ),
    runtimeHealthLastFreshnessMs: Number(
      sourceHealth?.runtimeHealthLastFreshnessMs,
    ),
    runtimeHealthAppAliveSegmentCount: Number(
      sourceHealth?.runtimeHealthAppAliveSegmentCount,
    ),
    runtimeHealthCoveredAppAliveSegmentCount: Number(
      sourceHealth?.runtimeHealthCoveredAppAliveSegmentCount,
    ),
    runtimeHealthCoverageHealthy:
      sourceHealth?.runtimeHealthCoverageHealthy === true,
    nativeMemoryPressureSampleCount: Number(
      sourceHealth?.nativeMemoryPressureSampleCount,
    ),
    nativeMemoryPressureValidSampleCount: Number(
      sourceHealth?.nativeMemoryPressureValidSampleCount,
    ),
    nativeMemoryPressureDistinctSampleCount: Number(
      sourceHealth?.nativeMemoryPressureDistinctSampleCount,
    ),
    nativeMemoryPressureExpectedSampleCount: Number(
      sourceHealth?.nativeMemoryPressureExpectedSampleCount,
    ),
    nativeMemoryPressureSampleDensity: Number(
      sourceHealth?.nativeMemoryPressureSampleDensity,
    ),
    nativeMemoryPressureExpectedIntervalMs: Number(
      sourceHealth?.nativeMemoryPressureExpectedIntervalMs,
    ),
    nativeMemoryPressureMaxCreditedGapMs: Number(
      sourceHealth?.nativeMemoryPressureMaxCreditedGapMs,
    ),
    nativeMemoryPressureLargestObservedGapMs: Number(
      sourceHealth?.nativeMemoryPressureLargestObservedGapMs,
    ),
    nativeMemoryPressureLastFreshnessMs: Number(
      sourceHealth?.nativeMemoryPressureLastFreshnessMs,
    ),
    nativeMemoryPressureAppAliveSegmentCount: Number(
      sourceHealth?.nativeMemoryPressureAppAliveSegmentCount,
    ),
    nativeMemoryPressureCoveredAppAliveSegmentCount: Number(
      sourceHealth?.nativeMemoryPressureCoveredAppAliveSegmentCount,
    ),
    nativeMemoryPressureInvalidSampleCount: Number(
      sourceHealth?.nativeMemoryPressureInvalidSampleCount,
    ),
    nativeMemoryPressureDuplicateTimestampCount: Number(
      sourceHealth?.nativeMemoryPressureDuplicateTimestampCount,
    ),
    nativeMemoryPressurePageLoadIdCount: Number(
      sourceHealth?.nativeMemoryPressurePageLoadIdCount,
    ),
    nativeMemoryPressureRendererGenerationCount: Number(
      sourceHealth?.nativeMemoryPressureRendererGenerationCount,
    ),
    nativeMemoryPressureCoverageHealthy:
      sourceHealth?.nativeMemoryPressureCoverageHealthy === true,
    appMemoryPressureP95Bytes:
      sourceHealth?.appMemoryPressureP95Bytes === null ||
      sourceHealth?.appMemoryPressureP95Bytes === undefined
        ? null
        : Number(sourceHealth.appMemoryPressureP95Bytes),
  };
}

export function runtimeAttributionFingerprintFields(runtimeIdentity) {
  if (!runtimeIdentity || runtimeIdentity.attributable !== true) return null;
  return {
    collectorSessionId: String(runtimeIdentity.collectorSessionId),
    appPid: Number(runtimeIdentity.appPid),
    appVersion: String(runtimeIdentity.appVersion),
    buildCommitSha: String(runtimeIdentity.buildCommitSha).toLowerCase(),
    channel: String(runtimeIdentity.channel),
    appSessionId: String(runtimeIdentity.appSessionId),
    ...(runtimeIdentity.artifactDigest
      ? { artifactDigest: String(runtimeIdentity.artifactDigest).toLowerCase() }
      : {}),
  };
}

export function buildCompositeEvidenceFingerprint({
  runtimeHealthFingerprint,
  collectorMetricsFingerprint,
  collectorEventsFingerprint = collectorEventsEvidenceFingerprint(""),
  sourceHealth,
  runtimeAttribution,
}) {
  const runtimeHealth = normalizedFingerprintComponent(
    runtimeHealthFingerprint,
  );
  const collectorMetrics = normalizedFingerprintComponent(
    collectorMetricsFingerprint,
  );
  const collectorEvents = normalizedFingerprintComponent(
    collectorEventsFingerprint,
  );
  const coverage = sourceHealthFingerprintFields(sourceHealth);
  const attribution = runtimeAttribution ?? null;
  const payload = {
    schemaVersion: EVIDENCE_FINGERPRINT_SCHEMA_VERSION,
    runtimeHealth,
    collectorMetrics,
    collectorEvents,
    coverage,
    attribution,
  };
  return {
    schemaVersion: EVIDENCE_FINGERPRINT_SCHEMA_VERSION,
    algorithm: "sha256",
    digest: createHash("sha256").update(stableJson(payload)).digest("hex"),
    recordCount:
      runtimeHealth.recordCount +
      collectorMetrics.recordCount +
      collectorEvents.recordCount,
    runtimeHealth,
    collectorMetrics,
    collectorEvents,
    coverage,
    attribution,
  };
}

export function buildVerdict({
  soakDir,
  metricsText,
  metricsPath,
  healthLines,
  healthPath,
  collectorEventsText = "",
  collectorEvents = parseCollectorEventsJsonl(collectorEventsText),
  collectorEventsEvidencePresent = false,
  soakInfo = {},
}) {
  const metricsRows = parseMetricsTsv(metricsText);
  const expectedIntervalMs =
    Number.isFinite(Number(soakInfo.intervalSeconds)) &&
    Number(soakInfo.intervalSeconds) >= 5
      ? Number(soakInfo.intervalSeconds) * 1_000
      : DEFAULT_COLLECTOR_INTERVAL_MS;
  let comparisonContext = null;
  if (soakInfo.comparisonContext !== undefined) {
    const context = soakInfo.comparisonContext;
    const scenario = String(context?.scenario ?? "").trim();
    const providerCohort = String(context?.providerCohort ?? "").trim();
    const documentSizeBucket = String(context?.documentSizeBucket ?? "").trim();
    const platform = String(context?.host?.platform ?? "").trim();
    const architecture = String(context?.host?.architecture ?? "").trim();
    const memoryTierGiB = Number(context?.host?.memoryTierGiB);
    if (
      !scenario ||
      !providerCohort ||
      !documentSizeBucket ||
      !platform ||
      !architecture ||
      !Number.isFinite(memoryTierGiB) ||
      memoryTierGiB <= 0
    ) {
      throw new Error("soak-info comparisonContext is incomplete.");
    }
    comparisonContext = {
      scenario,
      providerCohort,
      documentSizeBucket,
      host: { platform, architecture, memoryTierGiB },
    };
  }
  const timestamps = [
    ...metricsRows.map((row) => row.tsMs),
    ...healthLines.map(({ entry }) => Number(entry.tsMs ?? 0)),
  ].filter((timestamp) => Number.isFinite(timestamp) && timestamp > 0);
  const windowStart = timestamps.length > 0 ? Math.min(...timestamps) : 0;
  const windowEnd = timestamps.length > 0 ? Math.max(...timestamps) : 0;
  const measuredCloudEligibleHours = computeCloudEligibleHours(
    healthLines,
    metricsRows,
    {
      expectedIntervalMs,
    },
  );
  const collectorCoverage = computeAppAliveCoverage(metricsRows, {
    expectedIntervalMs,
  });
  const runtimeHealthCoverage = computeRuntimeHealthCoverage(
    healthLines,
    metricsRows,
    {
      collectorExpectedIntervalMs: expectedIntervalMs,
    },
  );
  const nativeMemoryPressureCoverage = computeNativeMemoryPressureCoverage(
    healthLines,
    metricsRows,
    { collectorExpectedIntervalMs: expectedIntervalMs },
  );
  const runtimeHealthMalformedLineCount =
    healthLines.sourceDiagnostics?.malformedLines?.length ?? 0;
  const collectorEventCoverage = computeCollectorEventCoverage(
    collectorEvents,
    {
      requireClosedSession: true,
    },
  );
  const collectorEventEvidenceCapable =
    hasCollectorEventEvidenceCapability(soakInfo);
  const collectorEventEvidenceSchemaVersion = Number.isSafeInteger(
    Number(soakInfo?.collectorEvents?.schemaVersion),
  )
    ? Number(soakInfo.collectorEvents.schemaVersion)
    : null;
  const sourceHealth = {
    ...collectorCoverage,
    ...runtimeHealthCoverage,
    ...nativeMemoryPressureCoverage,
    ...collectorEventCoverage,
    healthy:
      collectorCoverage.healthy &&
      runtimeHealthCoverage.runtimeHealthCoverageHealthy &&
      runtimeHealthMalformedLineCount === 0 &&
      collectorEventCoverage.collectorEventCoverageHealthy &&
      collectorEventEvidenceCapable &&
      collectorEventsEvidencePresent,
    reason:
      runtimeHealthMalformedLineCount > 0
        ? `Runtime-health evidence contains ${runtimeHealthMalformedLineCount.toLocaleString()} malformed line${runtimeHealthMalformedLineCount === 1 ? "" : "s"}.`
        : !collectorEventEvidenceCapable
          ? "The soak collector did not declare the collector-event evidence capability, so an empty event stream cannot prove that no trailing outage occurred."
          : !collectorEventsEvidencePresent
            ? "The capability-bearing soak is missing its current collector-event evidence file."
            : !collectorEventCoverage.collectorEventCoverageHealthy
              ? collectorEventCoverage.collectorEventCoverageReason
              : !collectorCoverage.healthy
                ? collectorCoverage.reason
                : runtimeHealthCoverage.runtimeHealthCoverageReason,
    runtimeHealthMalformedLineCount,
    collectorEventEvidenceCapable,
    collectorEventEvidencePresent: collectorEventsEvidencePresent,
    collectorEventEvidenceSchemaVersion,
    cloudEligibleHours: measuredCloudEligibleHours,
  };
  const appPids = [
    ...new Set(metricsRows.map((row) => row.appPid).filter((pid) => pid > 0)),
  ];
  const pageLoadIds = [
    ...new Set(
      healthLines
        .map(({ entry }) => entry.pageLoadId)
        .filter((value) => typeof value === "string" && value.length > 0),
    ),
  ];
  const collectorSessionId =
    typeof soakInfo.collectorSessionId === "string"
      ? soakInfo.collectorSessionId
      : null;
  const evidenceIdentity = runtimeIdentityFromHealthLines(healthLines);
  const artifactDigest = String(soakInfo.artifactDigest ?? "")
    .trim()
    .toLowerCase();
  if (artifactDigest && !/^[0-9a-f]{64}$/.test(artifactDigest)) {
    throw new Error("soak-info artifactDigest must be a SHA-256 digest.");
  }
  const runtimeIdentity = {
    collectorSessionId,
    appPids,
    pageLoadIds,
    appPid: appPids.length === 1 ? appPids[0] : null,
    ...(evidenceIdentity.identity ?? {}),
    ...(artifactDigest ? { artifactDigest } : {}),
    evidenceStatus: evidenceIdentity.status,
    evidenceCount: evidenceIdentity.evidenceCount,
    attributable: Boolean(
      collectorSessionId &&
      appPids.length === 1 &&
      evidenceIdentity.status === "attributable",
    ),
  };
  const evidenceFingerprint = buildCompositeEvidenceFingerprint({
    runtimeHealthFingerprint: runtimeHealthEvidenceFingerprint(healthLines),
    collectorMetricsFingerprint: collectorMetricsEvidenceFingerprint(
      metricsText,
      metricsRows,
    ),
    collectorEventsFingerprint: collectorEventsEvidenceFingerprint(
      collectorEventsText,
      collectorEvents,
    ),
    sourceHealth,
    runtimeAttribution: runtimeAttributionFingerprintFields(runtimeIdentity),
  });
  const runtimeEvidenceActionable =
    sourceHealth.healthy && runtimeIdentity.attributable;
  const sourceHealthAssertion = assertion(
    "source_health",
    runtimeEvidenceActionable ? "pass" : "inconclusive",
    runtimeEvidenceActionable
      ? `${sourceHealth.sampleCount.toLocaleString()} collector samples covered ${localeFixed(sourceHealth.appAliveHours, 2)} app-alive hours with ${sourceHealth.runtimeHealthDistinctSampleCount.toLocaleString()} distinct runtime-health liveness samples.`
      : `${sourceHealth.reason ?? "Collector coverage is unavailable"} Runtime-health lines: ${healthLines.length.toLocaleString()}. Runtime identity: ${runtimeIdentity.evidenceStatus}. Attributable app process and build: ${runtimeIdentity.attributable ? "yes" : "no"}.`,
  );
  const appAliveHours = Number(sourceHealth.appAliveHours);
  const appAliveDays = appAliveHours > 0 ? appAliveHours / 24 : null;
  const footprintPoints = healthLines
    .filter(({ entry }) => entry.event === "renderer_heartbeat")
    .map(({ entry }) => ({
      tsMs: Number(entry.tsMs ?? 0),
      bytes: Number(
        entry.nativeFootprintBytes ?? entry.nativeResidentBytes ?? 0,
      ),
    }))
    .filter((point) => point.tsMs > 0 && point.bytes > 0);
  const fallbackFootprintPoints = metricsRows
    .map((row) => ({ tsMs: row.tsMs, bytes: row.appRssKb * 1024 }))
    .filter((point) => point.tsMs > 0 && point.bytes > 0);
  const footprintSlope = footprintSlopeMbPerHour(
    footprintPoints.length >= 2 ? footprintPoints : fallbackFootprintPoints,
  );
  const unchangedUploads = healthLines.filter(
    ({ entry }) => entry.headsUnchanged === true,
  ).length;
  const requestSurface = summarizeRequestSurfaceEvents(healthLines);
  const activeWindowDestructions = healthLines.filter(
    ({ entry }) =>
      entry.event === "window_destroyed" &&
      classifyWindowDestruction(entry) === "active_operation_destroyed",
  ).length;
  const lostNovelScrapes = healthLines.filter(({ entry }) => {
    if (!Number.isFinite(entry.itemsPersisted)) return false;
    const novel = novelItems(entry);
    return novel !== null && novel > Number(entry.itemsPersisted);
  }).length;
  const measurement = (metricId, value) => {
    const contract = stabilityMetricById(metricId)?.outcomeMeasurement;
    if (!contract || !Number.isFinite(value)) return null;
    return {
      value,
      unit: contract.unit,
      direction: contract.direction,
    };
  };
  const measurements = Object.fromEntries(
    Object.entries({
      "main-footprint-slope": measurement(
        "main-footprint-slope",
        footprintSlope,
      ),
      "renderer-recovery-count": measurement(
        "renderer-recovery-count",
        runtimeEvidenceActionable && appAliveDays
          ? healthLines.filter(
              ({ entry }) =>
                entry.event === "renderer_recovery_restart_requested",
            ).length / appAliveDays
          : null,
      ),
      "stale-heartbeat-count": measurement(
        "stale-heartbeat-count",
        runtimeEvidenceActionable && appAliveDays
          ? healthLines.filter(
              ({ entry }) => entry.event === "renderer_heartbeat_stale",
            ).length / appAliveDays
          : null,
      ),
      "unchanged-cloud-upload-rate": measurement(
        "unchanged-cloud-upload-rate",
        runtimeEvidenceActionable && measuredCloudEligibleHours
          ? unchangedUploads / measuredCloudEligibleHours
          : null,
      ),
      "startup-repair-upload-surface": measurement(
        "startup-repair-upload-surface",
        runtimeEvidenceActionable && measuredCloudEligibleHours
          ? requestSurface.startupRepairUploads.total /
              measuredCloudEligibleHours
          : null,
      ),
      "social-outbox-attempt-surface": measurement(
        "social-outbox-attempt-surface",
        runtimeEvidenceActionable && appAliveHours
          ? requestSurface.socialOutboxAttempts.total / appAliveHours
          : null,
      ),
      "facebook-group-discovery-update-rate": measurement(
        "facebook-group-discovery-update-rate",
        runtimeEvidenceActionable && appAliveHours
          ? requestSurface.facebookGroupDiscoveryUpdates.total / appAliveHours
          : null,
      ),
      "rss-pull-attempt-rate": measurement(
        "rss-pull-attempt-rate",
        runtimeEvidenceActionable && appAliveHours
          ? requestSurface.rssPullAttempts.total / appAliveHours
          : null,
      ),
      "ai-request-attempt-rate": measurement(
        "ai-request-attempt-rate",
        runtimeEvidenceActionable && appAliveHours
          ? requestSurface.aiRequestAttempts.total / appAliveHours
          : null,
      ),
      "reader-article-fetch-attempt-rate": measurement(
        "reader-article-fetch-attempt-rate",
        runtimeEvidenceActionable && appAliveHours
          ? requestSurface.readerArticleFetchAttempts.total / appAliveHours
          : null,
      ),
      "active-operation-window-destruction": measurement(
        "active-operation-window-destruction",
        runtimeEvidenceActionable && appAliveDays
          ? activeWindowDestructions / appAliveDays
          : null,
      ),
      "novel-items-not-persisted": measurement(
        "novel-items-not-persisted",
        runtimeEvidenceActionable && appAliveDays
          ? lostNovelScrapes / appAliveDays
          : null,
      ),
      "worker-init-rate": measurement(
        "worker-init-rate",
        runtimeEvidenceActionable && appAliveHours
          ? healthLines.filter(({ entry }) => entry.event === "worker_init")
              .length / appAliveHours
          : null,
      ),
      "app-memory-pressure-p95": measurement(
        "app-memory-pressure-p95",
        runtimeEvidenceActionable &&
          sourceHealth.nativeMemoryPressureCoverageHealthy
          ? sourceHealth.appMemoryPressureP95Bytes
          : null,
      ),
      "invariant-alarm-rate": measurement(
        "invariant-alarm-rate",
        runtimeEvidenceActionable && appAliveDays
          ? healthLines.filter(({ entry }) => entry.event === "invariant_alarm")
              .length / appAliveDays
          : null,
      ),
    }).filter(([, value]) => value !== null),
  );

  const assertions = [
    sourceHealthAssertion,
    assertFootprintSlope(healthLines, metricsRows, metricsPath, healthPath),
    assertEventCountZero(
      "renderer_recoveries",
      healthLines,
      healthPath,
      "renderer_recovery_restart_requested",
      { runtimeEvidenceActionable },
    ),
    assertEventCountZero(
      "stale_heartbeats",
      healthLines,
      healthPath,
      "renderer_heartbeat_stale",
      { runtimeEvidenceActionable },
    ),
    assertWorkerInitRate(healthLines, healthPath, {
      appAliveHours,
      runtimeEvidenceActionable,
    }),
    assertWorkerIdleTerminationContract(healthLines, healthPath, {
      runtimeEvidenceActionable,
    }),
    assertWebkitReturnsToBaseline(metricsRows, metricsPath),
    ...assertGuardedCounters(healthLines, healthPath, {
      cloudCoverageHours: measuredCloudEligibleHours,
      runtimeEvidenceActionable,
    }),
    ...assertRequestSurfaceContracts(healthLines, healthPath, {
      runtimeEvidenceActionable,
    }),
    assertAlarmCounts(healthLines, healthPath, { runtimeEvidenceActionable }),
  ];

  const failures = assertions.filter((item) => item.status === "fail").length;
  const inconclusive = assertions.filter(
    (item) => item.status === "inconclusive" || item.status === "skipped",
  ).length;
  const status =
    failures > 0 ? "fail" : inconclusive > 0 ? "inconclusive" : "pass";
  return {
    schemaVersion: VERDICT_SCHEMA_VERSION,
    metricRegistryVersion: STABILITY_METRIC_REGISTRY_VERSION,
    soakDir,
    generatedAt: new Date().toISOString(),
    windowStart: windowStart ? new Date(windowStart).toISOString() : "",
    windowEnd: windowEnd ? new Date(windowEnd).toISOString() : "",
    spanHours:
      windowStart && windowEnd ? (windowEnd - windowStart) / 3_600_000 : 0,
    sampleCount: metricsRows.length,
    healthLineCount: healthLines.length,
    sourceHealth,
    evidenceFingerprint,
    comparisonContext,
    eventSummaries: {
      workerIdleTerminations: summarizeWorkerIdleTerminations(healthLines),
      requestSurface,
    },
    measurements,
    runtimeIdentity,
    assertions,
    failures,
    inconclusiveAssertions: inconclusive,
    status,
    pass: status === "pass",
  };
}

export function rebuildStoredSoakVerdict(soakDir) {
  const resolvedSoakDir = realpathSync(path.resolve(soakDir));
  const metricsPath = path.join(resolvedSoakDir, "metrics.tsv");
  const healthPath = path.join(resolvedSoakDir, "runtime-health.jsonl");
  const soakInfoPath = path.join(resolvedSoakDir, "soak-info.json");
  for (const requiredPath of [metricsPath, healthPath, soakInfoPath]) {
    if (!existsSync(requiredPath)) {
      throw new Error(`Stored soak provenance is incomplete: ${requiredPath}`);
    }
  }
  const metricsText = readFileSync(metricsPath, "utf8");
  const metricsRows = parseMetricsTsv(metricsText);
  const windowStart = metricsRows[0]?.tsMs ?? 0;
  const windowEnd = metricsRows.at(-1)?.tsMs ?? Number.POSITIVE_INFINITY;
  const healthLines = readHealthLines(healthPath, {
    fromTsMs: windowStart,
    toTsMs: windowEnd === 0 ? Number.POSITIVE_INFINITY : windowEnd,
  });
  const soakInfo = JSON.parse(readFileSync(soakInfoPath, "utf8"));
  const collectorEventEvidence = readCollectorEventsEvidence(resolvedSoakDir);
  return buildVerdict({
    soakDir: resolvedSoakDir,
    metricsText,
    metricsPath,
    healthLines,
    healthPath,
    collectorEventsText: collectorEventEvidence.text,
    collectorEventsEvidencePresent: collectorEventEvidence.present,
    soakInfo,
  });
}

function readCollectorEventsEvidence(soakDir) {
  const currentPath = path.join(soakDir, COLLECTOR_EVENTS_FILENAME);
  const text = [
    path.join(soakDir, COLLECTOR_EVENTS_ARCHIVE_FILENAME),
    currentPath,
  ]
    .filter((filePath) => existsSync(filePath))
    .map((filePath) => readFileSync(filePath, "utf8"))
    .join("");
  return { text, present: existsSync(currentPath) };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    process.stdout.write(usage());
    return;
  }

  let soakDir = args.soakDir;
  if (!soakDir) {
    if (!existsSync(args.pointer)) {
      throw new Error(`No --soak-dir given and no pointer at ${args.pointer}.`);
    }
    soakDir = readFileSync(args.pointer, "utf8").trim();
  }
  soakDir = path.resolve(soakDir);
  if (!existsSync(soakDir)) {
    throw new Error(`Soak dir does not exist: ${soakDir}`);
  }

  const metricsPath = path.join(soakDir, "metrics.tsv");
  const metricsText = existsSync(metricsPath)
    ? readFileSync(metricsPath, "utf8")
    : "";
  const metricsRows = parseMetricsTsv(metricsText);
  const windowStart = metricsRows[0]?.tsMs ?? 0;
  const windowEnd = metricsRows.at(-1)?.tsMs ?? Number.POSITIVE_INFINITY;

  // Prefer a runtime-health copy inside the soak dir (older soaks stored one);
  // otherwise read the app's live file sliced to the soak window.
  const soakHealthPath = path.join(soakDir, "runtime-health.jsonl");
  const healthPath = existsSync(soakHealthPath)
    ? soakHealthPath
    : path.join(args.appData, "runtime-health.jsonl");
  const healthLines = readHealthLines(healthPath, {
    fromTsMs: windowStart,
    toTsMs: windowEnd === 0 ? Number.POSITIVE_INFINITY : windowEnd,
  });

  const soakInfoPath = path.join(soakDir, "soak-info.json");
  const soakInfo = existsSync(soakInfoPath)
    ? JSON.parse(readFileSync(soakInfoPath, "utf8"))
    : {};
  const collectorEventEvidence = readCollectorEventsEvidence(soakDir);
  const verdict = buildVerdict({
    soakDir,
    metricsText,
    metricsPath,
    healthLines,
    healthPath,
    collectorEventsText: collectorEventEvidence.text,
    collectorEventsEvidencePresent: collectorEventEvidence.present,
    soakInfo,
  });
  const outPath = args.out
    ? path.resolve(args.out)
    : path.join(soakDir, "soak-verdict.json");
  writeFileSync(outPath, `${JSON.stringify(verdict, null, 2)}\n`);

  if (args.json) {
    process.stdout.write(`${JSON.stringify(verdict, null, 2)}\n`);
  } else {
    for (const item of verdict.assertions) {
      process.stdout.write(
        `[${item.status.toUpperCase()}] ${item.id}: ${item.detail}\n`,
      );
      for (const violation of item.violations) {
        process.stdout.write(
          `    ${violation.file}:${violation.line} ${violation.excerpt.slice(0, 120)}\n`,
        );
      }
    }
    process.stdout.write(
      `Verdict: ${verdict.status.toUpperCase()} (${verdict.failures.toLocaleString()} failing, ${verdict.inconclusiveAssertions.toLocaleString()} inconclusive assertion${verdict.inconclusiveAssertions === 1 ? "" : "s"}) -> ${outPath}\n`,
    );
  }
  process.exitCode = verdict.pass ? 0 : 1;
}

if (process.argv[1] === __filename) {
  try {
    main();
  } catch (error) {
    process.stderr.write(
      `${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exitCode = 1;
  }
}
