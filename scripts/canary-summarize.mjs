#!/usr/bin/env node
/**
 * canary-summarize.mjs (stability W2-03)
 *
 * The owner machine is the de-facto canary fleet: releases are near-daily and
 * there is no remote telemetry. This script folds a window of rotated
 * runtime-health history into immutable observation-window records. It flags
 * regressions against the trailing ledger median only after enough comparable
 * windows exist, so "which release regressed it" stops being guesswork.
 *
 * Writes content-addressed canary records and source sidecars. Metrics all
 * come from P0-02/P0-03/W2-01 counters: recoveries, window kills by reason,
 * invariant alarms by name, uploads (attempts / unchanged heads / damper
 * skips), worker INITs/hour, scrape success by provider, peak memory, and the
 * idle app-resident growth slope.
 */

import { createHash, randomUUID } from "node:crypto";
import {
  existsSync,
  linkSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  canaryRegressionTolerances,
  invariantAlarmMeetsMetricContract,
  MIN_LIFECYCLE_CREDITED_APP_ALIVE_HOURS,
  STABILITY_METRIC_REGISTRY_VERSION,
  windowDurationsAreComparable,
} from "./lib/stability-metrics.mjs";
import {
  buildCompositeEvidenceFingerprint,
  collectorEventsEvidenceFingerprint,
  collectorMetricsEvidenceFingerprint,
  computeAppAliveCoverage,
  computeCollectorEventCoverage,
  computeCloudEligibleHours,
  computeNativeMemoryPressureCoverage,
  computeRuntimeHealthCoverage,
  EVIDENCE_FINGERPRINT_SCHEMA_VERSION,
  MAX_COLLECTOR_CREDITED_GAP_MS,
  MAX_RUNTIME_HEALTH_CREDITED_GAP_MS,
  MIN_COLLECTOR_SAMPLE_DENSITY,
  MIN_RUNTIME_HEALTH_SAMPLE_DENSITY,
  parseCollectorEventsJsonl,
  parseMetricsTsv,
  runtimeHealthEvidenceFingerprint,
  runtimeIdentityFromHealthLines,
  summarizeRequestSurfaceEvents,
  summarizeWorkerIdleTerminations,
} from "./soak-assert.mjs";
import {
  COLLECTOR_EVENTS_ARCHIVE_FILENAME,
  COLLECTOR_EVENTS_FILENAME,
  COLLECTOR_EVENTS_SCHEMA_VERSION,
} from "./soak-collect.mjs";

const __filename = fileURLToPath(import.meta.url);
const REPO_ROOT = path.resolve(path.dirname(__filename), "..");
const DEFAULT_LEDGER_DIR = path.join(REPO_ROOT, "canary-ledger");
const DEFAULT_APP_DATA = path.join(
  os.homedir(),
  "Library/Application Support/wtf.freed.desktop",
);

/** Per-metric regression tolerances vs the trailing-ledger median. */
export const REGRESSION_TOLERANCES = Object.freeze(
  canaryRegressionTolerances(),
);
export const MIN_COMPARABLE_CANARY_WINDOWS = 3;
export const CANARY_OBSERVATION_CONTEXT_SCHEMA_VERSION = 3;

export function parseRuntimeHealthEvidenceText(
  text,
  sourceLabel = "runtime-health",
) {
  const entries = [];
  const malformedLines = [];
  const rawRecords = [];
  for (const [index, raw] of String(text ?? "")
    .split(/\r?\n/)
    .entries()) {
    if (!raw.trim()) continue;
    rawRecords.push(raw);
    try {
      entries.push(JSON.parse(raw));
    } catch {
      malformedLines.push({ file: sourceLabel, line: index + 1 });
    }
  }
  Object.defineProperty(entries, "sourceDiagnostics", {
    value: { malformedLines, rawRecords, sourceLineCount: rawRecords.length },
    enumerable: false,
  });
  return entries;
}

export function readHealthWindow(
  appDataDir,
  { sinceMs, untilMs = Number.POSITIVE_INFINITY },
) {
  const entries = [];
  const malformedLines = [];
  const rawRecords = [];
  if (!existsSync(appDataDir)) {
    Object.defineProperty(entries, "sourceDiagnostics", {
      value: { malformedLines, rawRecords, sourceLineCount: 0 },
      enumerable: false,
    });
    return entries;
  }
  const dated = readdirSync(appDataDir)
    .filter((name) => /^runtime-health-\d{8}\.jsonl$/.test(name))
    .sort();
  const livePath = path.join(appDataDir, "runtime-health.jsonl");
  const files = [
    ...dated.map((name) => path.join(appDataDir, name)),
    ...(existsSync(livePath) ? [livePath] : []),
  ];
  const maximumOccurrences = new Map();
  for (const file of files) {
    const fileOccurrences = new Map();
    for (const [lineIndex, raw] of readFileSync(file, "utf8")
      .split("\n")
      .entries()) {
      if (!raw.trim()) continue;
      let entry;
      try {
        entry = JSON.parse(raw);
      } catch {
        malformedLines.push({ file, line: lineIndex + 1 });
        rawRecords.push(raw);
        continue;
      }
      const ts = Number(entry.tsMs ?? 0);
      const fingerprint = `${ts}:${raw}`;
      if (ts < sinceMs || ts > untilMs) continue;
      const occurrence = (fileOccurrences.get(fingerprint) ?? 0) + 1;
      fileOccurrences.set(fingerprint, occurrence);
      if (occurrence <= (maximumOccurrences.get(fingerprint) ?? 0)) continue;
      entries.push(entry);
      rawRecords.push(raw);
    }
    for (const [fingerprint, count] of fileOccurrences) {
      maximumOccurrences.set(
        fingerprint,
        Math.max(maximumOccurrences.get(fingerprint) ?? 0, count),
      );
    }
  }
  Object.defineProperty(entries, "sourceDiagnostics", {
    value: {
      malformedLines,
      rawRecords,
      sourceLineCount: rawRecords.length,
    },
    enumerable: false,
  });
  return entries;
}

function linearSlopeMbPerHour(points) {
  const usable = points.filter((p) => p.bytes > 0 && p.tsMs > 0);
  if (usable.length < 2) return null;
  const n = usable.length;
  const meanX = usable.reduce((sum, p) => sum + p.tsMs, 0) / n;
  const meanY = usable.reduce((sum, p) => sum + p.bytes, 0) / n;
  let numerator = 0;
  let denominator = 0;
  for (const p of usable) {
    numerator += (p.tsMs - meanX) * (p.bytes - meanY);
    denominator += (p.tsMs - meanX) ** 2;
  }
  if (denominator === 0) return null;
  const bytesPerMs = numerator / denominator;
  return (bytesPerMs * 3_600_000) / (1024 * 1024);
}

/** Fold a window of runtime-health entries into one canary record. */
function requiredContextString(value, field, errors) {
  if (typeof value !== "string" || value.trim() === "") {
    errors.push(`${field} must be a non-empty string`);
    return "";
  }
  return value.trim();
}

function validFingerprintComponent(
  component,
  { requireByteLength = false } = {},
) {
  return Boolean(
    component?.algorithm === "sha256" &&
    /^[0-9a-f]{64}$/.test(String(component?.digest ?? "")) &&
    Number.isSafeInteger(component?.recordCount) &&
    component.recordCount >= 0 &&
    (!requireByteLength ||
      (Number.isSafeInteger(component?.byteLength) &&
        component.byteLength >= 0)),
  );
}

function sourceHealthAttribution({
  version,
  commitSha,
  channel,
  artifactDigest,
  collectorSessionId,
  appPid,
  appSessionId,
}) {
  return {
    collectorSessionId,
    appPid,
    appVersion: version,
    buildCommitSha: commitSha,
    channel,
    appSessionId,
    ...(artifactDigest ? { artifactDigest } : {}),
  };
}

function normalizeSourceHealth(
  sourceHealth,
  { windowSpanHours, attribution },
  errors,
) {
  if (sourceHealth.status !== "healthy") {
    errors.push("sourceHealth.status must be healthy");
  }
  const appAliveHours = Number(sourceHealth.appAliveHours);
  const appAliveRatio = Number(sourceHealth.appAliveRatio);
  const collectorSampleCount = Number(sourceHealth.collectorSampleCount);
  const collectorDistinctSampleCount = Number(
    sourceHealth.collectorDistinctSampleCount,
  );
  const expectedSampleCount = Number(sourceHealth.expectedSampleCount);
  const sampleDensity = Number(sourceHealth.sampleDensity);
  const collectorSpanHours = Number(sourceHealth.collectorSpanHours);
  const expectedIntervalMs = Number(sourceHealth.expectedIntervalMs);
  const maxCreditedGapMs = Number(sourceHealth.maxCreditedGapMs);
  const largestObservedGapMs = Number(sourceHealth.largestObservedGapMs);
  const creditedIntervalCount = Number(sourceHealth.creditedIntervalCount);
  const collectorHeaderHealthy = sourceHealth.collectorHeaderHealthy === true;
  const collectorMalformedRowCount = Number(
    sourceHealth.collectorMalformedRowCount ?? 0,
  );
  const collectorEventCount = Number(sourceHealth.collectorEventCount ?? 0);
  const collectorEventFailureCount = Number(
    sourceHealth.collectorEventFailureCount ?? 0,
  );
  const collectorEventRecoveryCount = Number(
    sourceHealth.collectorEventRecoveryCount ?? 0,
  );
  const collectorEventMalformedLineCount = Number(
    sourceHealth.collectorEventMalformedLineCount ?? 0,
  );
  const collectorEventProtocolErrorCount = Number(
    sourceHealth.collectorEventProtocolErrorCount ?? 0,
  );
  const collectorOutageOpen = sourceHealth.collectorOutageOpen === true;
  const collectorOpenOutageStartedAtMs =
    sourceHealth.collectorOpenOutageStartedAtMs === null ||
    sourceHealth.collectorOpenOutageStartedAtMs === undefined
      ? null
      : Number(sourceHealth.collectorOpenOutageStartedAtMs);
  const collectorEventCoverageHealthy =
    sourceHealth.collectorEventCoverageHealthy !== false;
  const collectorEventEvidenceCapable =
    sourceHealth.collectorEventEvidenceCapable === true;
  const collectorEventEvidencePresent =
    sourceHealth.collectorEventEvidencePresent === true;
  const collectorEventEvidenceSchemaVersion = Number(
    sourceHealth.collectorEventEvidenceSchemaVersion,
  );
  const runtimeHealthMalformedLineCount = Number(
    sourceHealth.runtimeHealthMalformedLineCount ?? 0,
  );
  const runtimeHealthSampleCount = Number(
    sourceHealth.runtimeHealthSampleCount,
  );
  const runtimeHealthDistinctSampleCount = Number(
    sourceHealth.runtimeHealthDistinctSampleCount,
  );
  const runtimeHealthExpectedSampleCount = Number(
    sourceHealth.runtimeHealthExpectedSampleCount,
  );
  const runtimeHealthSampleDensity = Number(
    sourceHealth.runtimeHealthSampleDensity,
  );
  const runtimeHealthExpectedIntervalMs = Number(
    sourceHealth.runtimeHealthExpectedIntervalMs,
  );
  const runtimeHealthMaxCreditedGapMs = Number(
    sourceHealth.runtimeHealthMaxCreditedGapMs,
  );
  const runtimeHealthLargestObservedGapMs = Number(
    sourceHealth.runtimeHealthLargestObservedGapMs,
  );
  const runtimeHealthLastFreshnessMs = Number(
    sourceHealth.runtimeHealthLastFreshnessMs,
  );
  const runtimeHealthAppAliveSegmentCount = Number(
    sourceHealth.runtimeHealthAppAliveSegmentCount,
  );
  const runtimeHealthCoveredAppAliveSegmentCount = Number(
    sourceHealth.runtimeHealthCoveredAppAliveSegmentCount,
  );
  const runtimeHealthCoverageHealthy =
    sourceHealth.runtimeHealthCoverageHealthy === true;
  const nativeMemoryPressureSampleCount = Number(
    sourceHealth.nativeMemoryPressureSampleCount,
  );
  const nativeMemoryPressureValidSampleCount = Number(
    sourceHealth.nativeMemoryPressureValidSampleCount,
  );
  const nativeMemoryPressureDistinctSampleCount = Number(
    sourceHealth.nativeMemoryPressureDistinctSampleCount,
  );
  const nativeMemoryPressureExpectedSampleCount = Number(
    sourceHealth.nativeMemoryPressureExpectedSampleCount,
  );
  const nativeMemoryPressureSampleDensity = Number(
    sourceHealth.nativeMemoryPressureSampleDensity,
  );
  const nativeMemoryPressureExpectedIntervalMs = Number(
    sourceHealth.nativeMemoryPressureExpectedIntervalMs,
  );
  const nativeMemoryPressureMaxCreditedGapMs = Number(
    sourceHealth.nativeMemoryPressureMaxCreditedGapMs,
  );
  const nativeMemoryPressureLargestObservedGapMs = Number(
    sourceHealth.nativeMemoryPressureLargestObservedGapMs,
  );
  const nativeMemoryPressureLastFreshnessMs = Number(
    sourceHealth.nativeMemoryPressureLastFreshnessMs,
  );
  const nativeMemoryPressureAppAliveSegmentCount = Number(
    sourceHealth.nativeMemoryPressureAppAliveSegmentCount,
  );
  const nativeMemoryPressureCoveredAppAliveSegmentCount = Number(
    sourceHealth.nativeMemoryPressureCoveredAppAliveSegmentCount,
  );
  const nativeMemoryPressureInvalidSampleCount = Number(
    sourceHealth.nativeMemoryPressureInvalidSampleCount,
  );
  const nativeMemoryPressureDuplicateTimestampCount = Number(
    sourceHealth.nativeMemoryPressureDuplicateTimestampCount,
  );
  const nativeMemoryPressurePageLoadIdCount = Number(
    sourceHealth.nativeMemoryPressurePageLoadIdCount,
  );
  const nativeMemoryPressureRendererGenerationCount = Number(
    sourceHealth.nativeMemoryPressureRendererGenerationCount,
  );
  const nativeMemoryPressureCoverageHealthy =
    sourceHealth.nativeMemoryPressureCoverageHealthy === true;
  const appMemoryPressureP95Bytes =
    sourceHealth.appMemoryPressureP95Bytes === null ||
    sourceHealth.appMemoryPressureP95Bytes === undefined
      ? null
      : Number(sourceHealth.appMemoryPressureP95Bytes);
  const cloudEligibleHours =
    sourceHealth.cloudEligibleHours === null ||
    sourceHealth.cloudEligibleHours === undefined
      ? null
      : Number(sourceHealth.cloudEligibleHours);

  if (!Number.isFinite(appAliveHours) || appAliveHours <= 0) {
    errors.push("sourceHealth.appAliveHours must be positive");
  }
  if (!Number.isFinite(collectorSpanHours) || collectorSpanHours <= 0) {
    errors.push("sourceHealth.collectorSpanHours must be positive");
  }
  if (
    !Number.isFinite(appAliveRatio) ||
    appAliveRatio < 0.8 ||
    appAliveRatio > 1.000001
  ) {
    errors.push("sourceHealth.appAliveRatio must be between 0.8 and 1");
  }
  if (!Number.isSafeInteger(collectorSampleCount) || collectorSampleCount < 3) {
    errors.push(
      "sourceHealth.collectorSampleCount must be an integer of at least 3",
    );
  }
  if (
    !Number.isSafeInteger(collectorDistinctSampleCount) ||
    collectorDistinctSampleCount < 3 ||
    collectorDistinctSampleCount > collectorSampleCount
  ) {
    errors.push(
      "sourceHealth.collectorDistinctSampleCount must be between 3 and collectorSampleCount",
    );
  }
  if (!Number.isSafeInteger(expectedSampleCount) || expectedSampleCount < 3) {
    errors.push(
      "sourceHealth.expectedSampleCount must be an integer of at least 3",
    );
  }
  if (
    !Number.isFinite(sampleDensity) ||
    sampleDensity < MIN_COLLECTOR_SAMPLE_DENSITY ||
    sampleDensity > 1.000001
  ) {
    errors.push(
      `sourceHealth.sampleDensity must be between ${MIN_COLLECTOR_SAMPLE_DENSITY.toLocaleString()} and 1`,
    );
  }
  const derivedDensity =
    Number.isSafeInteger(collectorDistinctSampleCount) &&
    Number.isSafeInteger(expectedSampleCount) &&
    expectedSampleCount > 0
      ? Math.min(1, collectorDistinctSampleCount / expectedSampleCount)
      : Number.NaN;
  if (
    Number.isFinite(sampleDensity) &&
    Math.abs(sampleDensity - derivedDensity) > 1e-9
  ) {
    errors.push(
      "sourceHealth.sampleDensity does not match its collector sample counts",
    );
  }
  if (!Number.isFinite(expectedIntervalMs) || expectedIntervalMs < 5_000) {
    errors.push("sourceHealth.expectedIntervalMs must be at least 5,000");
  }
  if (
    !Number.isFinite(maxCreditedGapMs) ||
    maxCreditedGapMs <= 0 ||
    maxCreditedGapMs > MAX_COLLECTOR_CREDITED_GAP_MS
  ) {
    errors.push(
      `sourceHealth.maxCreditedGapMs must be positive and no greater than ${MAX_COLLECTOR_CREDITED_GAP_MS.toLocaleString()}`,
    );
  }
  if (!Number.isFinite(largestObservedGapMs) || largestObservedGapMs < 0) {
    errors.push("sourceHealth.largestObservedGapMs must be non-negative");
  }
  if (
    !Number.isSafeInteger(creditedIntervalCount) ||
    creditedIntervalCount < 1
  ) {
    errors.push(
      "sourceHealth.creditedIntervalCount must be a positive integer",
    );
  }
  if (!collectorHeaderHealthy) {
    errors.push("sourceHealth.collectorHeaderHealthy must be true");
  }
  if (
    !Number.isSafeInteger(collectorMalformedRowCount) ||
    collectorMalformedRowCount !== 0
  ) {
    errors.push("sourceHealth.collectorMalformedRowCount must be 0");
  }
  if (
    !Number.isSafeInteger(collectorEventCount) ||
    collectorEventCount < 0 ||
    !Number.isSafeInteger(collectorEventFailureCount) ||
    collectorEventFailureCount < 0 ||
    !Number.isSafeInteger(collectorEventRecoveryCount) ||
    collectorEventRecoveryCount < 0 ||
    collectorEventFailureCount + collectorEventRecoveryCount >
      collectorEventCount ||
    collectorEventCount -
      collectorEventFailureCount -
      collectorEventRecoveryCount <
      2
  ) {
    errors.push(
      "sourceHealth collector event counts must be non-negative integers with at least one closed collector session",
    );
  }
  if (
    !Number.isSafeInteger(collectorEventMalformedLineCount) ||
    collectorEventMalformedLineCount !== 0
  ) {
    errors.push("sourceHealth.collectorEventMalformedLineCount must be 0");
  }
  if (
    !Number.isSafeInteger(collectorEventProtocolErrorCount) ||
    collectorEventProtocolErrorCount !== 0
  ) {
    errors.push("sourceHealth.collectorEventProtocolErrorCount must be 0");
  }
  if (
    collectorOutageOpen ||
    collectorOpenOutageStartedAtMs !== null ||
    !collectorEventCoverageHealthy
  ) {
    errors.push(
      "sourceHealth collector event coverage must be healthy with no open outage",
    );
  }
  if (
    !collectorEventEvidenceCapable ||
    !collectorEventEvidencePresent ||
    collectorEventEvidenceSchemaVersion !== COLLECTOR_EVENTS_SCHEMA_VERSION
  ) {
    errors.push(
      `sourceHealth collector event evidence must be capability-declared, present, and schema version ${COLLECTOR_EVENTS_SCHEMA_VERSION.toLocaleString()}`,
    );
  }
  if (
    !Number.isSafeInteger(runtimeHealthMalformedLineCount) ||
    runtimeHealthMalformedLineCount !== 0
  ) {
    errors.push("sourceHealth.runtimeHealthMalformedLineCount must be 0");
  }
  if (
    !Number.isSafeInteger(runtimeHealthSampleCount) ||
    runtimeHealthSampleCount < 3
  ) {
    errors.push(
      "sourceHealth.runtimeHealthSampleCount must be an integer of at least 3",
    );
  }
  if (
    !Number.isSafeInteger(runtimeHealthDistinctSampleCount) ||
    runtimeHealthDistinctSampleCount < 3 ||
    runtimeHealthDistinctSampleCount > runtimeHealthSampleCount
  ) {
    errors.push(
      "sourceHealth.runtimeHealthDistinctSampleCount must be between 3 and runtimeHealthSampleCount",
    );
  }
  if (
    !Number.isSafeInteger(runtimeHealthExpectedSampleCount) ||
    runtimeHealthExpectedSampleCount < 3
  ) {
    errors.push(
      "sourceHealth.runtimeHealthExpectedSampleCount must be an integer of at least 3",
    );
  }
  if (
    !Number.isFinite(runtimeHealthSampleDensity) ||
    runtimeHealthSampleDensity < MIN_RUNTIME_HEALTH_SAMPLE_DENSITY ||
    runtimeHealthSampleDensity > 1.000001
  ) {
    errors.push(
      `sourceHealth.runtimeHealthSampleDensity must be between ${MIN_RUNTIME_HEALTH_SAMPLE_DENSITY.toLocaleString()} and 1`,
    );
  }
  const derivedRuntimeHealthDensity =
    Number.isSafeInteger(runtimeHealthDistinctSampleCount) &&
    Number.isSafeInteger(runtimeHealthExpectedSampleCount) &&
    runtimeHealthExpectedSampleCount > 0
      ? Math.min(
          1,
          runtimeHealthDistinctSampleCount / runtimeHealthExpectedSampleCount,
        )
      : Number.NaN;
  if (
    Number.isFinite(runtimeHealthSampleDensity) &&
    Math.abs(runtimeHealthSampleDensity - derivedRuntimeHealthDensity) > 1e-9
  ) {
    errors.push(
      "sourceHealth.runtimeHealthSampleDensity does not match its runtime-health sample counts",
    );
  }
  if (
    !Number.isFinite(runtimeHealthExpectedIntervalMs) ||
    runtimeHealthExpectedIntervalMs < 5_000
  ) {
    errors.push(
      "sourceHealth.runtimeHealthExpectedIntervalMs must be at least 5,000",
    );
  }
  if (
    !Number.isFinite(runtimeHealthMaxCreditedGapMs) ||
    runtimeHealthMaxCreditedGapMs <= 0 ||
    runtimeHealthMaxCreditedGapMs > MAX_RUNTIME_HEALTH_CREDITED_GAP_MS
  ) {
    errors.push(
      `sourceHealth.runtimeHealthMaxCreditedGapMs must be positive and no greater than ${MAX_RUNTIME_HEALTH_CREDITED_GAP_MS.toLocaleString()}`,
    );
  }
  if (
    !Number.isFinite(runtimeHealthLargestObservedGapMs) ||
    runtimeHealthLargestObservedGapMs < 0 ||
    runtimeHealthLargestObservedGapMs > runtimeHealthMaxCreditedGapMs
  ) {
    errors.push(
      "sourceHealth.runtimeHealthLargestObservedGapMs must be non-negative and no greater than runtimeHealthMaxCreditedGapMs",
    );
  }
  if (
    !Number.isFinite(runtimeHealthLastFreshnessMs) ||
    runtimeHealthLastFreshnessMs < 0 ||
    runtimeHealthLastFreshnessMs > runtimeHealthMaxCreditedGapMs ||
    runtimeHealthLastFreshnessMs > runtimeHealthLargestObservedGapMs
  ) {
    errors.push(
      "sourceHealth.runtimeHealthLastFreshnessMs must be non-negative and no greater than the runtime-health gap limits",
    );
  }
  if (
    !Number.isSafeInteger(runtimeHealthAppAliveSegmentCount) ||
    runtimeHealthAppAliveSegmentCount < 1
  ) {
    errors.push(
      "sourceHealth.runtimeHealthAppAliveSegmentCount must be a positive integer",
    );
  }
  if (
    !Number.isSafeInteger(runtimeHealthCoveredAppAliveSegmentCount) ||
    runtimeHealthCoveredAppAliveSegmentCount < 1 ||
    runtimeHealthCoveredAppAliveSegmentCount !==
      runtimeHealthAppAliveSegmentCount
  ) {
    errors.push(
      "sourceHealth.runtimeHealthCoveredAppAliveSegmentCount must cover every app-alive segment",
    );
  }
  if (!runtimeHealthCoverageHealthy) {
    errors.push("sourceHealth.runtimeHealthCoverageHealthy must be true");
  }
  const nativeCountFields = [
    ["nativeMemoryPressureSampleCount", nativeMemoryPressureSampleCount],
    [
      "nativeMemoryPressureValidSampleCount",
      nativeMemoryPressureValidSampleCount,
    ],
    [
      "nativeMemoryPressureDistinctSampleCount",
      nativeMemoryPressureDistinctSampleCount,
    ],
    [
      "nativeMemoryPressureExpectedSampleCount",
      nativeMemoryPressureExpectedSampleCount,
    ],
    [
      "nativeMemoryPressureAppAliveSegmentCount",
      nativeMemoryPressureAppAliveSegmentCount,
    ],
    [
      "nativeMemoryPressureCoveredAppAliveSegmentCount",
      nativeMemoryPressureCoveredAppAliveSegmentCount,
    ],
    [
      "nativeMemoryPressureInvalidSampleCount",
      nativeMemoryPressureInvalidSampleCount,
    ],
    [
      "nativeMemoryPressureDuplicateTimestampCount",
      nativeMemoryPressureDuplicateTimestampCount,
    ],
    [
      "nativeMemoryPressurePageLoadIdCount",
      nativeMemoryPressurePageLoadIdCount,
    ],
    [
      "nativeMemoryPressureRendererGenerationCount",
      nativeMemoryPressureRendererGenerationCount,
    ],
  ];
  for (const [field, value] of nativeCountFields) {
    if (!Number.isSafeInteger(value) || value < 0) {
      errors.push(`sourceHealth.${field} must be a non-negative integer`);
    }
  }
  if (
    !Number.isFinite(nativeMemoryPressureSampleDensity) ||
    nativeMemoryPressureSampleDensity < 0 ||
    nativeMemoryPressureSampleDensity > 1.000001
  ) {
    errors.push(
      "sourceHealth.nativeMemoryPressureSampleDensity must be between 0 and 1",
    );
  }
  if (
    !Number.isFinite(nativeMemoryPressureExpectedIntervalMs) ||
    nativeMemoryPressureExpectedIntervalMs < 5_000
  ) {
    errors.push(
      "sourceHealth.nativeMemoryPressureExpectedIntervalMs must be at least 5,000",
    );
  }
  if (
    !Number.isFinite(nativeMemoryPressureMaxCreditedGapMs) ||
    nativeMemoryPressureMaxCreditedGapMs <= 0 ||
    nativeMemoryPressureMaxCreditedGapMs > MAX_RUNTIME_HEALTH_CREDITED_GAP_MS
  ) {
    errors.push(
      "sourceHealth.nativeMemoryPressureMaxCreditedGapMs must be within the runtime-health gap limit",
    );
  }
  for (const [field, value] of [
    [
      "nativeMemoryPressureLargestObservedGapMs",
      nativeMemoryPressureLargestObservedGapMs,
    ],
    [
      "nativeMemoryPressureLastFreshnessMs",
      nativeMemoryPressureLastFreshnessMs,
    ],
  ]) {
    if (!Number.isFinite(value) || value < 0) {
      errors.push(`sourceHealth.${field} must be non-negative`);
    }
  }
  if (nativeMemoryPressureCoverageHealthy) {
    if (
      nativeMemoryPressureDistinctSampleCount < 3 ||
      nativeMemoryPressureExpectedSampleCount < 3 ||
      nativeMemoryPressureSampleDensity < MIN_RUNTIME_HEALTH_SAMPLE_DENSITY ||
      nativeMemoryPressureInvalidSampleCount !== 0 ||
      nativeMemoryPressureDuplicateTimestampCount !== 0 ||
      nativeMemoryPressureAppAliveSegmentCount !== 1 ||
      nativeMemoryPressureCoveredAppAliveSegmentCount !== 1 ||
      nativeMemoryPressurePageLoadIdCount !== 1 ||
      nativeMemoryPressureRendererGenerationCount !== 1 ||
      nativeMemoryPressureLargestObservedGapMs >
        nativeMemoryPressureMaxCreditedGapMs ||
      nativeMemoryPressureLastFreshnessMs >
        nativeMemoryPressureMaxCreditedGapMs ||
      !Number.isSafeInteger(appMemoryPressureP95Bytes) ||
      appMemoryPressureP95Bytes < 0
    ) {
      errors.push(
        "sourceHealth native memory-pressure coverage is marked healthy but its samples, generation, gaps, or p95 are invalid",
      );
    }
  } else if (appMemoryPressureP95Bytes !== null) {
    errors.push(
      "sourceHealth.appMemoryPressureP95Bytes must be null when native memory-pressure coverage is unhealthy",
    );
  }
  if (
    cloudEligibleHours !== null &&
    (!Number.isFinite(cloudEligibleHours) || cloudEligibleHours <= 0)
  ) {
    errors.push(
      "sourceHealth.cloudEligibleHours must be null or a positive number",
    );
  }
  if (windowSpanHours > 0 && collectorSpanHours > windowSpanHours * 1.05) {
    errors.push(
      "sourceHealth.collectorSpanHours cannot exceed the observation window",
    );
  }
  if (Number.isFinite(appAliveHours) && Number.isFinite(collectorSpanHours)) {
    if (appAliveHours > collectorSpanHours * 1.000001) {
      errors.push(
        "sourceHealth.appAliveHours cannot exceed collectorSpanHours",
      );
    }
    const derivedAliveRatio =
      collectorSpanHours > 0 ? appAliveHours / collectorSpanHours : 0;
    if (
      Number.isFinite(appAliveRatio) &&
      Math.abs(appAliveRatio - derivedAliveRatio) > 1e-9
    ) {
      errors.push(
        "sourceHealth.appAliveRatio does not match its credited hours",
      );
    }
  }
  if (cloudEligibleHours !== null && cloudEligibleHours > appAliveHours) {
    errors.push("sourceHealth.cloudEligibleHours cannot exceed appAliveHours");
  }

  const normalized = {
    status: "healthy",
    appAliveHours,
    appAliveRatio,
    collectorSampleCount,
    collectorDistinctSampleCount,
    expectedSampleCount,
    sampleDensity,
    collectorSpanHours,
    expectedIntervalMs,
    maxCreditedGapMs,
    largestObservedGapMs,
    creditedIntervalCount,
    collectorHeaderHealthy,
    collectorMalformedRowCount,
    collectorEventCount,
    collectorEventFailureCount,
    collectorEventRecoveryCount,
    collectorEventMalformedLineCount,
    collectorEventProtocolErrorCount,
    collectorOutageOpen,
    collectorOpenOutageStartedAtMs,
    collectorEventCoverageHealthy,
    collectorEventEvidenceCapable,
    collectorEventEvidencePresent,
    collectorEventEvidenceSchemaVersion,
    runtimeHealthMalformedLineCount,
    runtimeHealthSampleCount,
    runtimeHealthDistinctSampleCount,
    runtimeHealthExpectedSampleCount,
    runtimeHealthSampleDensity,
    runtimeHealthExpectedIntervalMs,
    runtimeHealthMaxCreditedGapMs,
    runtimeHealthLargestObservedGapMs,
    runtimeHealthLastFreshnessMs,
    runtimeHealthAppAliveSegmentCount,
    runtimeHealthCoveredAppAliveSegmentCount,
    runtimeHealthCoverageHealthy,
    nativeMemoryPressureSampleCount,
    nativeMemoryPressureValidSampleCount,
    nativeMemoryPressureDistinctSampleCount,
    nativeMemoryPressureExpectedSampleCount,
    nativeMemoryPressureSampleDensity,
    nativeMemoryPressureExpectedIntervalMs,
    nativeMemoryPressureMaxCreditedGapMs,
    nativeMemoryPressureLargestObservedGapMs,
    nativeMemoryPressureLastFreshnessMs,
    nativeMemoryPressureAppAliveSegmentCount,
    nativeMemoryPressureCoveredAppAliveSegmentCount,
    nativeMemoryPressureInvalidSampleCount,
    nativeMemoryPressureDuplicateTimestampCount,
    nativeMemoryPressurePageLoadIdCount,
    nativeMemoryPressureRendererGenerationCount,
    nativeMemoryPressureCoverageHealthy,
    appMemoryPressureP95Bytes,
    cloudEligibleHours,
    evidenceFingerprint: structuredClone(sourceHealth.evidenceFingerprint),
  };
  const fingerprint = normalized.evidenceFingerprint;
  if (
    fingerprint?.schemaVersion !== EVIDENCE_FINGERPRINT_SCHEMA_VERSION ||
    fingerprint?.algorithm !== "sha256" ||
    !/^[0-9a-f]{64}$/.test(String(fingerprint?.digest ?? "")) ||
    !Number.isSafeInteger(fingerprint?.recordCount) ||
    fingerprint.recordCount <= 0 ||
    !validFingerprintComponent(fingerprint?.runtimeHealth) ||
    fingerprint.runtimeHealth.recordCount <= 0 ||
    fingerprint.runtimeHealth.recordCount < runtimeHealthSampleCount ||
    !validFingerprintComponent(fingerprint?.collectorMetrics, {
      requireByteLength: true,
    }) ||
    fingerprint.collectorMetrics.recordCount !== collectorSampleCount ||
    !validFingerprintComponent(fingerprint?.collectorEvents, {
      requireByteLength: true,
    }) ||
    fingerprint.collectorEvents.recordCount !== collectorEventCount
  ) {
    errors.push(
      "sourceHealth.evidenceFingerprint must contain complete runtime, collector metrics, and collector event SHA-256 components",
    );
    return normalized;
  }
  const rebuilt = buildCompositeEvidenceFingerprint({
    runtimeHealthFingerprint: fingerprint.runtimeHealth,
    collectorMetricsFingerprint: fingerprint.collectorMetrics,
    collectorEventsFingerprint: fingerprint.collectorEvents,
    sourceHealth: normalized,
    runtimeAttribution: attribution,
  });
  if (
    rebuilt.digest !== fingerprint.digest ||
    rebuilt.recordCount !== fingerprint.recordCount ||
    JSON.stringify(rebuilt.coverage) !== JSON.stringify(fingerprint.coverage) ||
    JSON.stringify(rebuilt.attribution) !==
      JSON.stringify(fingerprint.attribution)
  ) {
    errors.push(
      "sourceHealth.evidenceFingerprint does not bind the declared coverage and runtime attribution",
    );
  }
  return normalized;
}

export function validateCanaryObservationContext(
  context,
  { windowStartMs = undefined, windowEndMs = undefined } = {},
) {
  const errors = [];
  if (!context || typeof context !== "object" || Array.isArray(context)) {
    throw new Error("Canary observation context must be a JSON object.");
  }
  if (context.schemaVersion !== CANARY_OBSERVATION_CONTEXT_SCHEMA_VERSION) {
    errors.push(
      `schemaVersion must equal ${CANARY_OBSERVATION_CONTEXT_SCHEMA_VERSION.toLocaleString()}`,
    );
  }
  const build = context.build ?? {};
  const runtime = context.runtime ?? {};
  const workload = context.workload ?? {};
  const host = context.host ?? {};
  const sourceHealth = context.sourceHealth ?? {};
  const version = requiredContextString(build.version, "build.version", errors);
  const commitSha = requiredContextString(
    build.commitSha,
    "build.commitSha",
    errors,
  ).toLowerCase();
  if (commitSha && !/^[0-9a-f]{40,64}$/.test(commitSha)) {
    errors.push(
      "build.commitSha must be a full 40 to 64 character hexadecimal commit SHA",
    );
  }
  const channel = requiredContextString(build.channel, "build.channel", errors);
  if (channel && !["dev", "production"].includes(channel)) {
    errors.push("build.channel must be dev or production");
  }
  const artifactDigest =
    build.artifactDigest === undefined
      ? ""
      : requiredContextString(
          build.artifactDigest,
          "build.artifactDigest",
          errors,
        ).toLowerCase();
  if (artifactDigest && !/^[0-9a-f]{64}$/.test(artifactDigest)) {
    errors.push("build.artifactDigest must be a 64 character SHA-256 digest");
  }
  const installId = requiredContextString(
    build.installId,
    "build.installId",
    errors,
  );
  const installedAt = requiredContextString(
    build.installedAt,
    "build.installedAt",
    errors,
  );
  const installedAtMs = Date.parse(installedAt);
  if (!Number.isFinite(installedAtMs))
    errors.push("build.installedAt must be an ISO-8601 timestamp");
  const collectorSessionId = requiredContextString(
    runtime.collectorSessionId,
    "runtime.collectorSessionId",
    errors,
  );
  const appPid = Number(runtime.appPid);
  if (!Number.isSafeInteger(appPid) || appPid <= 0) {
    errors.push("runtime.appPid must be a positive integer");
  }
  const appSessionId = requiredContextString(
    runtime.appSessionId,
    "runtime.appSessionId",
    errors,
  );
  const scenario = requiredContextString(
    workload.scenario,
    "workload.scenario",
    errors,
  );
  const providerCohort = requiredContextString(
    workload.providerCohort,
    "workload.providerCohort",
    errors,
  );
  const documentSizeBucket = requiredContextString(
    workload.documentSizeBucket,
    "workload.documentSizeBucket",
    errors,
  );
  const platform = requiredContextString(
    host.platform,
    "host.platform",
    errors,
  );
  const architecture = requiredContextString(
    host.architecture,
    "host.architecture",
    errors,
  );
  const memoryTierGiB = Number(host.memoryTierGiB);
  if (!Number.isFinite(memoryTierGiB) || memoryTierGiB <= 0) {
    errors.push("host.memoryTierGiB must be a positive number");
  }
  const contextStartMs = Date.parse(
    requiredContextString(context.windowStart, "windowStart", errors),
  );
  const contextEndMs = Date.parse(
    requiredContextString(context.windowEnd, "windowEnd", errors),
  );
  if (
    !Number.isFinite(contextStartMs) ||
    !Number.isFinite(contextEndMs) ||
    contextEndMs <= contextStartMs
  ) {
    errors.push(
      "windowStart and windowEnd must form a valid increasing ISO-8601 window",
    );
  }
  if (
    Number.isFinite(installedAtMs) &&
    Number.isFinite(contextStartMs) &&
    installedAtMs > contextStartMs
  ) {
    errors.push("build.installedAt must be at or before windowStart");
  }
  if (windowStartMs !== undefined && contextStartMs !== windowStartMs) {
    errors.push(
      "observation context windowStart does not match the requested window",
    );
  }
  if (windowEndMs !== undefined && contextEndMs !== windowEndMs) {
    errors.push(
      "observation context windowEnd does not match the requested window",
    );
  }
  const windowSpanHours =
    Number.isFinite(contextStartMs) && Number.isFinite(contextEndMs)
      ? (contextEndMs - contextStartMs) / 3_600_000
      : 0;
  const fingerprintAttribution = sourceHealthAttribution({
    version,
    commitSha,
    channel,
    artifactDigest,
    collectorSessionId,
    appPid,
    appSessionId,
  });
  const normalizedSourceHealth = normalizeSourceHealth(
    sourceHealth,
    { windowSpanHours, attribution: fingerprintAttribution },
    errors,
  );
  if (errors.length > 0) {
    throw new Error(
      `Invalid canary observation context:\n- ${errors.join("\n- ")}`,
    );
  }
  return {
    schemaVersion: CANARY_OBSERVATION_CONTEXT_SCHEMA_VERSION,
    build: {
      version,
      commitSha,
      channel,
      ...(artifactDigest ? { artifactDigest } : {}),
      installId,
      installedAt: new Date(installedAtMs).toISOString(),
    },
    runtime: { collectorSessionId, appPid, appSessionId },
    workload: { scenario, providerCohort, documentSizeBucket },
    host: { platform, architecture, memoryTierGiB },
    sourceHealth: normalizedSourceHealth,
    windowStart: new Date(contextStartMs).toISOString(),
    windowEnd: new Date(contextEndMs).toISOString(),
  };
}

export function computeCanarySummary(
  entries,
  {
    observationContext,
    windowStartMs,
    windowEndMs,
    collectorMetricsText = null,
  },
) {
  const context = validateCanaryObservationContext(observationContext, {
    windowStartMs,
    windowEndMs,
  });
  const version = context.build.version;
  const comparisonContext = {
    platform: context.host.platform,
    architecture: context.host.architecture,
    memoryTierGiB: context.host.memoryTierGiB,
    channel: context.build.channel,
    scenario: context.workload.scenario,
    providerCohort: context.workload.providerCohort,
    documentSizeBucket: context.workload.documentSizeBucket,
  };
  const spanHours = Math.max((windowEndMs - windowStartMs) / 3_600_000, 1 / 60);
  const appAliveHours = context.sourceHealth.appAliveHours;
  const appAliveDays = appAliveHours / 24;
  const cloudHours = context.sourceHealth.cloudEligibleHours;
  const observedIdentity = runtimeIdentityFromHealthLines(
    entries.map((entry) => ({ entry })),
  );
  const observedRuntimeHealthFingerprint =
    runtimeHealthEvidenceFingerprint(entries);
  const expectedIdentity = {
    appVersion: context.build.version,
    buildCommitSha: context.build.commitSha,
    channel: context.build.channel,
    appSessionId: context.runtime.appSessionId,
  };
  const expectedRuntimeHealthFingerprint =
    context.sourceHealth.evidenceFingerprint.runtimeHealth;
  const malformedRuntimeHealthLines =
    entries.sourceDiagnostics?.malformedLines?.length ?? 0;
  const fingerprintMatches =
    observedRuntimeHealthFingerprint.digest ===
      expectedRuntimeHealthFingerprint.digest &&
    observedRuntimeHealthFingerprint.recordCount ===
      expectedRuntimeHealthFingerprint.recordCount;
  const evidenceAttribution =
    malformedRuntimeHealthLines === 0 &&
    observedIdentity.status === "attributable" &&
    JSON.stringify(observedIdentity.identity) ===
      JSON.stringify(expectedIdentity) &&
    fingerprintMatches
      ? {
          status: "matched",
          evidenceCount: observedIdentity.evidenceCount,
          identity: {
            ...observedIdentity.identity,
            ...(context.build.artifactDigest
              ? { artifactDigest: context.build.artifactDigest }
              : {}),
          },
          evidenceFingerprint: context.sourceHealth.evidenceFingerprint,
          observedRuntimeHealthFingerprint,
        }
      : {
          status:
            malformedRuntimeHealthLines > 0
              ? "source-malformed"
              : fingerprintMatches
                ? observedIdentity.status
                : "evidence-mismatch",
          malformedRuntimeHealthLines,
          evidenceCount: observedIdentity.evidenceCount,
          identity: observedIdentity.identity,
          expectedIdentity,
          evidenceFingerprint: context.sourceHealth.evidenceFingerprint,
          observedRuntimeHealthFingerprint,
          expectedRuntimeHealthFingerprint,
        };

  const count = (predicate) => entries.filter(predicate).length;
  // Match the soak contract exactly. Attempts and restart requests can belong
  // to one recovery sequence, so adding both double-counts the same incident.
  const recoveries = count(
    (e) => e.event === "renderer_recovery_restart_requested",
  );
  const killsByReason = {};
  for (const e of entries) {
    if (e.event !== "window_destroyed") continue;
    const reason = e.reasonEnum ?? "unknown";
    killsByReason[reason] = (killsByReason[reason] ?? 0) + 1;
  }
  const alarmsByName = {};
  const rawAlarmsByName = {};
  for (const e of entries) {
    if (e.event !== "invariant_alarm") continue;
    const name = e.name ?? "unknown";
    rawAlarmsByName[name] = (rawAlarmsByName[name] ?? 0) + 1;
    if (!invariantAlarmMeetsMetricContract(e)) continue;
    alarmsByName[name] = (alarmsByName[name] ?? 0) + 1;
  }
  const uploads = entries.filter((e) => e.event === "cloud_upload_attempt");
  const uploadsUnchanged = uploads.filter((e) => e.headsUnchanged === true);
  const uploadSkips = count((e) => e.event === "cloud_upload_skipped");
  const workerInits = count((e) => e.event === "worker_init");
  const workerIdleTerminations = summarizeWorkerIdleTerminations(
    entries.map((entry) => ({ entry })),
  );
  const requestSurface = summarizeRequestSurfaceEvents(
    entries.map((entry) => ({ entry })),
  );

  const scrapeByProvider = {};
  for (const e of entries) {
    if (e.event !== "scrape_outcome") continue;
    const provider = e.provider ?? "unknown";
    const bucket = (scrapeByProvider[provider] ??= {
      attempts: 0,
      ok: 0,
      byStage: {},
    });
    bucket.attempts += 1;
    if (e.stage === "ok") bucket.ok += 1;
    bucket.byStage[e.stage ?? "unknown"] =
      (bucket.byStage[e.stage ?? "unknown"] ?? 0) + 1;
  }

  const samples = entries.filter(
    (e) => e.event === "native_runtime_memory_sample",
  );
  const peakAppResidentBytes = samples.reduce(
    (max, e) => Math.max(max, Number(e.appResidentBytes ?? 0)),
    0,
  );
  const peakWebkitLargestResidentBytes = samples.reduce(
    (max, e) => Math.max(max, Number(e.webkitLargestResidentBytes ?? 0)),
    0,
  );
  const idleGrowthMbPerHour = linearSlopeMbPerHour(
    samples.map((e) => ({
      tsMs: Number(e.tsMs ?? 0),
      bytes: Number(e.appResidentBytes ?? 0),
    })),
  );
  const nativeMemoryPressure = collectorMetricsText
    ? computeNativeMemoryPressureCoverage(
        entries.map((entry) => ({ entry })),
        parseMetricsTsv(collectorMetricsText),
        {
          collectorExpectedIntervalMs: context.sourceHealth.expectedIntervalMs,
        },
      )
    : {
        appMemoryPressureP95Bytes:
          context.sourceHealth.appMemoryPressureP95Bytes,
      };

  const alarmTotal = Object.values(alarmsByName).reduce((sum, n) => sum + n, 0);
  return {
    schemaVersion: 3,
    metricRegistryVersion: STABILITY_METRIC_REGISTRY_VERSION,
    version,
    buildIdentity: context.build,
    runtimeIdentity: context.runtime,
    evidenceAttribution,
    workload: context.workload,
    sourceHealth: context.sourceHealth,
    observationId: `${context.build.commitSha}:${context.runtime.appSessionId}:${windowStartMs}:${windowEndMs}`,
    comparisonContext,
    windowStart: new Date(windowStartMs).toISOString(),
    windowEnd: new Date(windowEndMs).toISOString(),
    spanHours: Number(spanHours.toFixed(2)),
    healthLineCount: entries.length,
    metrics: {
      recoveriesPerDay: Number((recoveries / appAliveDays).toFixed(2)),
      windowKillsByReason: killsByReason,
      alarmsByName,
      rawAlarmsByName,
      alarmsPerDay: Number((alarmTotal / appAliveDays).toFixed(2)),
      uploadsPerHour:
        cloudHours === null
          ? null
          : Number((uploads.length / cloudHours).toFixed(2)),
      uploadsUnchangedPerHour:
        cloudHours === null
          ? null
          : Number((uploadsUnchanged.length / cloudHours).toFixed(2)),
      startupRepairUploadsPerHour:
        cloudHours === null
          ? null
          : Number(
              (
                requestSurface.startupRepairUploads.total / cloudHours
              ).toFixed(2),
            ),
      uploadSkipsPerHour:
        cloudHours === null
          ? null
          : Number((uploadSkips / cloudHours).toFixed(2)),
      socialOutboxAttemptsPerHour: Number(
        (
          requestSurface.socialOutboxAttempts.total / appAliveHours
        ).toFixed(2),
      ),
      facebookGroupDiscoveryUpdatesPerHour: Number(
        (
          requestSurface.facebookGroupDiscoveryUpdates.total / appAliveHours
        ).toFixed(2),
      ),
      rssPullAttemptsPerHour: Number(
        (requestSurface.rssPullAttempts.total / appAliveHours).toFixed(2),
      ),
      aiRequestAttemptsPerHour: Number(
        (requestSurface.aiRequestAttempts.total / appAliveHours).toFixed(2),
      ),
      readerArticleFetchAttemptsPerHour: Number(
        (
          requestSurface.readerArticleFetchAttempts.total / appAliveHours
        ).toFixed(2),
      ),
      startupRepairUploadsByProvider:
        requestSurface.startupRepairUploads.byProvider,
      startupRepairUploadGroups: requestSurface.startupRepairUploads.groups,
      startupRepairUploadMaxPerProviderSession:
        requestSurface.startupRepairUploads.maxPerProviderSession,
      startupRepairUploadOverBudgetGroupCount:
        requestSurface.startupRepairUploads.overBudgetGroupCount,
      socialOutboxAttemptsByProviderAction:
        requestSurface.socialOutboxAttempts.byProviderAction,
      socialOutboxAttemptMax: requestSurface.socialOutboxAttempts.maxAttempt,
      socialOutboxMaxAttempts:
        requestSurface.socialOutboxAttempts.maxAttempts,
      socialOutboxInvalidContractCount:
        requestSurface.socialOutboxAttempts.invalidContractCount,
      facebookGroupDiscoveryUpdatesBySource:
        requestSurface.facebookGroupDiscoveryUpdates.bySource,
      rssPullAttemptsByTrigger: requestSurface.rssPullAttempts.byTrigger,
      aiRequestAttemptsByProviderPurpose:
        requestSurface.aiRequestAttempts.byProviderPurpose,
      readerArticleFetchAttemptsBySourcePin:
        requestSurface.readerArticleFetchAttempts.bySourcePin,
      workerInitsPerHour: Number((workerInits / appAliveHours).toFixed(2)),
      workerIdleTerminationsByReason: workerIdleTerminations.byReason,
      workerIdleTerminationInvalidReasonCount:
        workerIdleTerminations.invalidReasonCount,
      scrapeByProvider,
      appMemoryPressureP95Bytes: nativeMemoryPressure.appMemoryPressureP95Bytes,
      peakAppResidentBytes,
      peakWebkitLargestResidentBytes,
      idleGrowthMbPerHour:
        idleGrowthMbPerHour === null
          ? null
          : Number(idleGrowthMbPerHour.toFixed(1)),
    },
  };
}

export function validateCanaryRawEvidence(
  entries,
  collectorMetricsText,
  observationContext,
  collectorEventsText = "",
) {
  const context = validateCanaryObservationContext(observationContext);
  const metricsRows = parseMetricsTsv(collectorMetricsText);
  const expectedIntervalMs = context.sourceHealth.expectedIntervalMs;
  const coverage = computeAppAliveCoverage(metricsRows, { expectedIntervalMs });
  const collectorEvents = parseCollectorEventsJsonl(collectorEventsText);
  const collectorEventCoverage = computeCollectorEventCoverage(
    collectorEvents,
    {
      requireClosedSession: true,
    },
  );
  const healthLines = entries.map((entry) => ({ entry }));
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
    entries.sourceDiagnostics?.malformedLines?.length ?? 0;
  const cloudEligibleHours = computeCloudEligibleHours(
    healthLines,
    metricsRows,
    { expectedIntervalMs },
  );
  const rebuiltSourceHealth = {
    status:
      coverage.healthy &&
      runtimeHealthCoverage.runtimeHealthCoverageHealthy &&
      runtimeHealthMalformedLineCount === 0 &&
      collectorEventCoverage.collectorEventCoverageHealthy
        ? "healthy"
        : "unhealthy",
    appAliveHours: coverage.appAliveHours,
    appAliveRatio: coverage.appAliveRatio,
    collectorSampleCount: coverage.sampleCount,
    collectorDistinctSampleCount: coverage.distinctSampleCount,
    expectedSampleCount: coverage.expectedSampleCount,
    sampleDensity: coverage.sampleDensity,
    collectorSpanHours: coverage.spanHours,
    expectedIntervalMs: coverage.expectedIntervalMs,
    maxCreditedGapMs: coverage.maxCreditedGapMs,
    largestObservedGapMs: coverage.largestObservedGapMs,
    creditedIntervalCount: coverage.creditedIntervalCount,
    collectorHeaderHealthy: coverage.collectorHeaderHealthy,
    collectorMalformedRowCount: coverage.collectorMalformedRowCount,
    collectorEventCount: collectorEventCoverage.collectorEventCount,
    collectorEventFailureCount:
      collectorEventCoverage.collectorEventFailureCount,
    collectorEventRecoveryCount:
      collectorEventCoverage.collectorEventRecoveryCount,
    collectorEventMalformedLineCount:
      collectorEventCoverage.collectorEventMalformedLineCount,
    collectorEventProtocolErrorCount:
      collectorEventCoverage.collectorEventProtocolErrorCount,
    collectorOutageOpen: collectorEventCoverage.collectorOutageOpen,
    collectorOpenOutageStartedAtMs:
      collectorEventCoverage.collectorOpenOutageStartedAtMs,
    collectorEventCoverageHealthy:
      collectorEventCoverage.collectorEventCoverageHealthy,
    collectorEventEvidenceCapable: true,
    collectorEventEvidencePresent: true,
    collectorEventEvidenceSchemaVersion: COLLECTOR_EVENTS_SCHEMA_VERSION,
    runtimeHealthMalformedLineCount,
    runtimeHealthSampleCount: runtimeHealthCoverage.runtimeHealthSampleCount,
    runtimeHealthDistinctSampleCount:
      runtimeHealthCoverage.runtimeHealthDistinctSampleCount,
    runtimeHealthExpectedSampleCount:
      runtimeHealthCoverage.runtimeHealthExpectedSampleCount,
    runtimeHealthSampleDensity:
      runtimeHealthCoverage.runtimeHealthSampleDensity,
    runtimeHealthExpectedIntervalMs:
      runtimeHealthCoverage.runtimeHealthExpectedIntervalMs,
    runtimeHealthMaxCreditedGapMs:
      runtimeHealthCoverage.runtimeHealthMaxCreditedGapMs,
    runtimeHealthLargestObservedGapMs:
      runtimeHealthCoverage.runtimeHealthLargestObservedGapMs,
    runtimeHealthLastFreshnessMs:
      runtimeHealthCoverage.runtimeHealthLastFreshnessMs,
    runtimeHealthAppAliveSegmentCount:
      runtimeHealthCoverage.runtimeHealthAppAliveSegmentCount,
    runtimeHealthCoveredAppAliveSegmentCount:
      runtimeHealthCoverage.runtimeHealthCoveredAppAliveSegmentCount,
    runtimeHealthCoverageHealthy:
      runtimeHealthCoverage.runtimeHealthCoverageHealthy,
    ...nativeMemoryPressureCoverage,
    cloudEligibleHours,
  };
  const runtimeHealthSourceFields = new Set([
    "runtimeHealthSampleCount",
    "runtimeHealthDistinctSampleCount",
    "runtimeHealthExpectedSampleCount",
    "runtimeHealthSampleDensity",
    "runtimeHealthExpectedIntervalMs",
    "runtimeHealthMaxCreditedGapMs",
    "runtimeHealthLargestObservedGapMs",
    "runtimeHealthLastFreshnessMs",
    "runtimeHealthAppAliveSegmentCount",
    "runtimeHealthCoveredAppAliveSegmentCount",
    "runtimeHealthCoverageHealthy",
  ]);
  const sourceHealthFields = [
    ...runtimeHealthSourceFields,
    "status",
    "appAliveHours",
    "appAliveRatio",
    "collectorSampleCount",
    "collectorDistinctSampleCount",
    "expectedSampleCount",
    "sampleDensity",
    "collectorSpanHours",
    "expectedIntervalMs",
    "maxCreditedGapMs",
    "largestObservedGapMs",
    "creditedIntervalCount",
    "collectorHeaderHealthy",
    "collectorMalformedRowCount",
    "collectorEventCount",
    "collectorEventFailureCount",
    "collectorEventRecoveryCount",
    "collectorEventMalformedLineCount",
    "collectorEventProtocolErrorCount",
    "collectorOutageOpen",
    "collectorOpenOutageStartedAtMs",
    "collectorEventCoverageHealthy",
    "collectorEventEvidenceCapable",
    "collectorEventEvidencePresent",
    "collectorEventEvidenceSchemaVersion",
    "runtimeHealthMalformedLineCount",
    "nativeMemoryPressureSampleCount",
    "nativeMemoryPressureValidSampleCount",
    "nativeMemoryPressureDistinctSampleCount",
    "nativeMemoryPressureExpectedSampleCount",
    "nativeMemoryPressureSampleDensity",
    "nativeMemoryPressureExpectedIntervalMs",
    "nativeMemoryPressureMaxCreditedGapMs",
    "nativeMemoryPressureLargestObservedGapMs",
    "nativeMemoryPressureLastFreshnessMs",
    "nativeMemoryPressureAppAliveSegmentCount",
    "nativeMemoryPressureCoveredAppAliveSegmentCount",
    "nativeMemoryPressureInvalidSampleCount",
    "nativeMemoryPressureDuplicateTimestampCount",
    "nativeMemoryPressurePageLoadIdCount",
    "nativeMemoryPressureRendererGenerationCount",
    "nativeMemoryPressureCoverageHealthy",
    "appMemoryPressureP95Bytes",
    "cloudEligibleHours",
  ];
  for (const field of sourceHealthFields) {
    if (!Object.is(rebuiltSourceHealth[field], context.sourceHealth[field])) {
      const source = runtimeHealthSourceFields.has(field)
        ? "collector evidence and runtime-health"
        : "collector";
      throw new Error(
        `Canary ${field} does not match the raw ${source} evidence.`,
      );
    }
  }
  const runtimeAttribution = sourceHealthAttribution({
    version: context.build.version,
    commitSha: context.build.commitSha,
    channel: context.build.channel,
    artifactDigest: context.build.artifactDigest,
    collectorSessionId: context.runtime.collectorSessionId,
    appPid: context.runtime.appPid,
    appSessionId: context.runtime.appSessionId,
  });
  const evidenceFingerprint = buildCompositeEvidenceFingerprint({
    runtimeHealthFingerprint: runtimeHealthEvidenceFingerprint(entries),
    collectorMetricsFingerprint: collectorMetricsEvidenceFingerprint(
      collectorMetricsText,
      metricsRows,
    ),
    collectorEventsFingerprint: collectorEventsEvidenceFingerprint(
      collectorEventsText,
      collectorEvents,
    ),
    sourceHealth: rebuiltSourceHealth,
    runtimeAttribution,
  });
  if (
    JSON.stringify(evidenceFingerprint) !==
    JSON.stringify(context.sourceHealth.evidenceFingerprint)
  ) {
    throw new Error(
      "Canary evidence fingerprint does not match its raw runtime and collector sources.",
    );
  }
  return {
    context,
    metricsRows,
    collectorEvents,
    sourceHealth: rebuiltSourceHealth,
    evidenceFingerprint,
  };
}

function resolveLedgerRelativeEvidence(recordPath, reference, label) {
  const recordDirectory = path.dirname(realpathSync(path.resolve(recordPath)));
  const file = String(reference?.file ?? "");
  if (!file || file !== path.basename(file)) {
    throw new Error(`${label} must use a ledger-relative filename.`);
  }
  const resolvedPath = realpathSync(path.join(recordDirectory, file));
  if (path.dirname(resolvedPath) !== recordDirectory) {
    throw new Error(
      `${label} must resolve inside the record ledger directory.`,
    );
  }
  return { recordDirectory, file, resolvedPath };
}

function readHashedLedgerEvidence(
  recordPath,
  reference,
  label,
  expectedFormat,
) {
  if (
    reference?.format !== expectedFormat ||
    !/^[0-9a-f]{64}$/.test(String(reference?.digest ?? ""))
  ) {
    throw new Error(`${label} lacks a supported format and SHA-256 digest.`);
  }
  const resolved = resolveLedgerRelativeEvidence(recordPath, reference, label);
  const text = readFileSync(resolved.resolvedPath, "utf8");
  const digest = createHash("sha256").update(text).digest("hex");
  if (digest !== reference.digest) {
    throw new Error(`${label} digest does not match its snapshot.`);
  }
  const filenameDigest = /-([0-9a-f]{64})\.(?:jsonl|tsv)$/.exec(
    resolved.file,
  )?.[1];
  if (filenameDigest && filenameDigest !== digest) {
    throw new Error(`${label} filename does not match its content digest.`);
  }
  return { ...resolved, text, digest };
}

function validateContentAddressedCanaryRecord(recordPath) {
  const resolvedPath = realpathSync(path.resolve(recordPath));
  const filenameDigest = /-([0-9a-f]{64})\.json$/.exec(
    path.basename(resolvedPath),
  )?.[1];
  if (!filenameDigest) return;
  const digest = createHash("sha256")
    .update(readFileSync(resolvedPath))
    .digest("hex");
  if (filenameDigest !== digest) {
    throw new Error(
      "Canary record filename does not match its content digest.",
    );
  }
}

export function validateStoredCanaryRecordEvidence(canary, recordPath) {
  validateContentAddressedCanaryRecord(recordPath);
  const runtimeArtifact = readHashedLedgerEvidence(
    recordPath,
    canary?.sourceEvidence?.runtimeHealth,
    "Canary runtime source evidence",
    "runtime-health-jsonl",
  );
  const collectorArtifact = readHashedLedgerEvidence(
    recordPath,
    canary?.sourceEvidence?.collectorMetrics,
    "Canary collector source evidence",
    "collector-metrics-tsv",
  );
  const collectorEventsArtifact = readHashedLedgerEvidence(
    recordPath,
    canary?.sourceEvidence?.collectorEvents,
    "Canary collector event source evidence",
    "collector-events-jsonl",
  );
  const entries = parseRuntimeHealthEvidenceText(
    runtimeArtifact.text,
    runtimeArtifact.resolvedPath,
  );
  const comparisonContext = canary.comparisonContext ?? {};
  const observationContext = {
    schemaVersion: CANARY_OBSERVATION_CONTEXT_SCHEMA_VERSION,
    build: canary.buildIdentity,
    runtime: canary.runtimeIdentity,
    workload: canary.workload,
    host: {
      platform: comparisonContext.platform,
      architecture: comparisonContext.architecture,
      memoryTierGiB: comparisonContext.memoryTierGiB,
    },
    sourceHealth: canary.sourceHealth,
    windowStart: canary.windowStart,
    windowEnd: canary.windowEnd,
  };
  validateCanaryRawEvidence(
    entries,
    collectorArtifact.text,
    observationContext,
    collectorEventsArtifact.text,
  );
  const recomputed = computeCanarySummary(entries, {
    observationContext,
    windowStartMs: Date.parse(canary.windowStart),
    windowEndMs: Date.parse(canary.windowEnd),
    collectorMetricsText: collectorArtifact.text,
  });
  for (const [key, value] of Object.entries(recomputed)) {
    if (JSON.stringify(canary[key]) !== JSON.stringify(value)) {
      throw new Error(
        `Canary record field ${key} does not match its raw evidence bundle.`,
      );
    }
  }
  return recomputed;
}

export function validateStoredCanaryRecordProvenance(canary, recordPath) {
  validateStoredCanaryRecordEvidence(canary, recordPath);
  const references = canary?.comparison?.baselineReferences;
  if (!Array.isArray(references)) {
    throw new Error(
      "Canary comparison must carry hashed trailing baseline references.",
    );
  }
  const recordDirectory = path.dirname(realpathSync(path.resolve(recordPath)));
  const seen = new Set();
  const baselines = references.map((reference) => {
    const file = String(reference?.file ?? "");
    if (!file || file !== path.basename(file)) {
      throw new Error("Canary baseline must use a ledger-relative filename.");
    }
    const baselinePath = realpathSync(path.join(recordDirectory, file));
    if (
      path.dirname(baselinePath) !== recordDirectory ||
      seen.has(baselinePath)
    ) {
      throw new Error(
        "Canary baseline must be unique and inside the record ledger directory.",
      );
    }
    seen.add(baselinePath);
    const text = readFileSync(baselinePath, "utf8");
    const digest = createHash("sha256").update(text).digest("hex");
    if (digest !== reference?.digest) {
      throw new Error(
        "Canary baseline digest does not match its referenced file.",
      );
    }
    const baseline = JSON.parse(text);
    validateStoredCanaryRecordEvidence(baseline, baselinePath);
    if (
      reference.observationId !== baseline.observationId ||
      reference.windowStart !== baseline.windowStart ||
      reference.windowEnd !== baseline.windowEnd ||
      JSON.stringify(reference.buildIdentity) !==
        JSON.stringify(baseline.buildIdentity) ||
      JSON.stringify(reference.evidenceFingerprint) !==
        JSON.stringify(baseline.sourceHealth?.evidenceFingerprint)
    ) {
      throw new Error(
        "Canary baseline reference does not match its attributable ledger record.",
      );
    }
    return {
      ...baseline,
      sourceReference: { file, digest },
    };
  });
  const recomputedComparison = compareCanarySummary(canary, baselines);
  if (
    JSON.stringify(recomputedComparison) !==
      JSON.stringify(canary.comparison) ||
    JSON.stringify(recomputedComparison.regressions) !==
      JSON.stringify(canary.regressions) ||
    recomputedComparison.comparableWindows !== canary.trailingCompared
  ) {
    throw new Error(
      "Canary comparison does not match its verified trailing evidence cohort.",
    );
  }
  return { summary: canary, comparison: recomputedComparison };
}

function median(values) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[mid]
    : (sorted[mid - 1] + sorted[mid]) / 2;
}

function comparisonContextKey(summary) {
  const context = summary?.comparisonContext;
  if (!context || typeof context !== "object") return null;
  return JSON.stringify(
    Object.fromEntries(
      Object.entries(context).sort(([left], [right]) =>
        left.localeCompare(right),
      ),
    ),
  );
}

function hasCompleteSourceHealth(summary) {
  const windowStartMs = Date.parse(summary?.windowStart ?? "");
  const windowEndMs = Date.parse(summary?.windowEnd ?? "");
  if (
    !Number.isFinite(windowStartMs) ||
    !Number.isFinite(windowEndMs) ||
    windowEndMs <= windowStartMs
  ) {
    return false;
  }
  const errors = [];
  normalizeSourceHealth(
    summary?.sourceHealth ?? {},
    {
      windowSpanHours: (windowEndMs - windowStartMs) / 3_600_000,
      attribution: sourceHealthAttribution({
        version: summary?.buildIdentity?.version,
        commitSha: summary?.buildIdentity?.commitSha,
        channel: summary?.buildIdentity?.channel,
        artifactDigest: summary?.buildIdentity?.artifactDigest,
        collectorSessionId: summary?.runtimeIdentity?.collectorSessionId,
        appPid: summary?.runtimeIdentity?.appPid,
        appSessionId: summary?.runtimeIdentity?.appSessionId,
      }),
    },
    errors,
  );
  return errors.length === 0;
}

export function hasMatchedEvidenceAttribution(summary) {
  const attribution = summary?.evidenceAttribution;
  if (
    attribution?.status !== "matched" ||
    !attribution.identity ||
    !hasCompleteSourceHealth(summary)
  ) {
    return false;
  }
  const identityMatches =
    JSON.stringify(attribution.identity) ===
    JSON.stringify({
      appVersion: summary.buildIdentity?.version,
      buildCommitSha: summary.buildIdentity?.commitSha,
      channel: summary.buildIdentity?.channel,
      appSessionId: summary.runtimeIdentity?.appSessionId,
      ...(summary.buildIdentity?.artifactDigest
        ? { artifactDigest: summary.buildIdentity.artifactDigest }
        : {}),
    });
  const sourceFingerprint = summary.sourceHealth.evidenceFingerprint;
  const recordedFingerprintMatches =
    JSON.stringify(attribution.evidenceFingerprint) ===
    JSON.stringify(sourceFingerprint);
  const observedRuntimeMatches =
    attribution.observedRuntimeHealthFingerprint?.digest ===
      sourceFingerprint.runtimeHealth.digest &&
    attribution.observedRuntimeHealthFingerprint?.recordCount ===
      sourceFingerprint.runtimeHealth.recordCount;
  return (
    identityMatches && recordedFingerprintMatches && observedRuntimeMatches
  );
}

export function comparableCanarySummaries(
  summary,
  trailingSummaries,
  limit = 7,
) {
  const currentKey = comparisonContextKey(summary);
  if (!currentKey) return [];
  const currentStartMs = Date.parse(summary.windowStart);
  const currentAppAliveHours = Number(summary.sourceHealth?.appAliveHours);
  const currentDurationMs = currentAppAliveHours * 3_600_000;
  if (
    !Number.isFinite(currentStartMs) ||
    !Number.isFinite(currentAppAliveHours) ||
    currentAppAliveHours < MIN_LIFECYCLE_CREDITED_APP_ALIVE_HOURS
  ) {
    return [];
  }
  const seenObservations = new Set();
  const eligible = trailingSummaries
    .filter((candidate) => {
      const candidateStartMs = Date.parse(candidate.windowStart);
      const candidateEndMs = Date.parse(candidate.windowEnd);
      const candidateAppAliveHours = Number(
        candidate.sourceHealth?.appAliveHours,
      );
      return (
        candidate.schemaVersion === summary.schemaVersion &&
        candidate.buildIdentity?.commitSha &&
        candidate.buildIdentity.commitSha !==
          summary.buildIdentity?.commitSha &&
        candidate.buildIdentity?.version !== summary.buildIdentity?.version &&
        candidate.runtimeIdentity?.appSessionId &&
        candidate.sourceHealth?.status === "healthy" &&
        hasMatchedEvidenceAttribution(candidate) &&
        candidate.metricRegistryVersion === summary.metricRegistryVersion &&
        comparisonContextKey(candidate) === currentKey &&
        Number.isFinite(candidateEndMs) &&
        Number.isFinite(candidateStartMs) &&
        candidateEndMs > candidateStartMs &&
        Number.isFinite(candidateAppAliveHours) &&
        candidateAppAliveHours >= MIN_LIFECYCLE_CREDITED_APP_ALIVE_HOURS &&
        windowDurationsAreComparable(
          currentDurationMs,
          candidateAppAliveHours * 3_600_000,
        ) &&
        candidateEndMs <= currentStartMs &&
        candidate.observationId !== summary.observationId
      );
    })
    .filter((candidate) => {
      if (
        !candidate.observationId ||
        seenObservations.has(candidate.observationId)
      )
        return false;
      seenObservations.add(candidate.observationId);
      return true;
    });
  const nonoverlapping = [];
  let earliestSelectedStart = Number.POSITIVE_INFINITY;
  const newestFirst = eligible.toSorted(
    (left, right) => Date.parse(right.windowEnd) - Date.parse(left.windowEnd),
  );
  for (const candidate of newestFirst) {
    const candidateEnd = Date.parse(candidate.windowEnd);
    if (candidateEnd > earliestSelectedStart) continue;
    nonoverlapping.push(candidate);
    earliestSelectedStart = Date.parse(candidate.windowStart);
    if (nonoverlapping.length >= limit) break;
  }
  return nonoverlapping.reverse();
}

/** Compare a canary window only after enough like-for-like history exists. */
export function compareCanarySummary(
  summary,
  trailingSummaries,
  { minimumComparable = MIN_COMPARABLE_CANARY_WINDOWS } = {},
) {
  const comparable = comparableCanarySummaries(summary, trailingSummaries);
  const baselineReferences = comparable.flatMap((candidate) => {
    const reference = candidate?.sourceReference;
    return reference?.file &&
      /^[0-9a-f]{64}$/.test(String(reference?.digest ?? ""))
      ? [
          {
            file: reference.file,
            digest: reference.digest,
            observationId: candidate.observationId,
            windowStart: candidate.windowStart,
            windowEnd: candidate.windowEnd,
            appAliveHours: candidate.sourceHealth?.appAliveHours,
            buildIdentity: candidate.buildIdentity,
            evidenceFingerprint: candidate.sourceHealth?.evidenceFingerprint,
          },
        ]
      : [];
  });
  if (Number(summary.healthLineCount ?? 0) === 0) {
    return {
      status: "inconclusive",
      minimumComparable,
      comparableWindows: comparable.length,
      regressions: [],
      metrics: {},
      baselineReferences,
      reason: "The observation window contains no runtime-health entries.",
    };
  }
  if (!hasMatchedEvidenceAttribution(summary)) {
    return {
      status: "inconclusive",
      minimumComparable,
      comparableWindows: comparable.length,
      regressions: [],
      metrics: {},
      baselineReferences,
      reason: `Runtime evidence identity is ${summary.evidenceAttribution?.status ?? "missing"}.`,
    };
  }
  const regressions = [];
  const metrics = {};
  for (const [metric, tolerance] of Object.entries(REGRESSION_TOLERANCES)) {
    const current = summary.metrics[metric];
    if (
      current === null ||
      current === undefined ||
      !Number.isFinite(current)
    ) {
      metrics[metric] = { status: "unavailable", current };
      continue;
    }
    const history = comparable
      .map((s) => s.metrics?.[metric])
      .filter((v) => v !== null && v !== undefined && Number.isFinite(v));
    if (history.length < minimumComparable) {
      metrics[metric] = {
        status: "inconclusive",
        current,
        comparableCount: history.length,
        minimumComparable,
      };
      continue;
    }
    const baseline = median(history);
    const limit =
      tolerance.direction === "higher"
        ? tolerance.kind === "ratio"
          ? Math.min(baseline / tolerance.allowance, baseline - Number.EPSILON)
          : baseline - tolerance.allowance
        : tolerance.kind === "ratio"
          ? Math.max(baseline * tolerance.allowance, baseline + Number.EPSILON)
          : baseline + tolerance.allowance;
    const isRegression =
      tolerance.direction === "higher" ? current < limit : current > limit;
    if (isRegression) {
      const regression = {
        metric,
        current,
        trailingMedian: Number(baseline.toFixed(2)),
        limit: Number(limit.toFixed(2)),
        trailingCount: history.length,
      };
      regressions.push(regression);
      metrics[metric] = { status: "regression", ...regression };
    } else {
      metrics[metric] = {
        status: "pass",
        current,
        trailingMedian: Number(baseline.toFixed(2)),
        limit: Number(limit.toFixed(2)),
        trailingCount: history.length,
      };
    }
  }
  const judged = Object.values(metrics);
  const status =
    regressions.length > 0
      ? "regression"
      : judged.some(
            (metric) =>
              metric.status === "inconclusive" ||
              metric.status === "unavailable",
          )
        ? "inconclusive"
        : "pass";
  return {
    status,
    minimumComparable,
    comparableWindows: comparable.length,
    regressions,
    metrics,
    baselineReferences,
    reason:
      status === "inconclusive"
        ? judged.some((metric) => metric.status === "unavailable")
          ? "At least one registered metric is unavailable for this observation window."
          : `Need at least ${minimumComparable.toLocaleString()} comparable observation windows per metric.`
        : null,
  };
}

/** Backward-compatible regression list for callers that do not need status. */
export function detectRegressions(summary, trailingSummaries, options) {
  return compareCanarySummary(summary, trailingSummaries, options).regressions;
}

export function loadTrailingSummaries(ledgerDir, excludeVersion, limit = 50) {
  if (!existsSync(ledgerDir)) return [];
  return readdirSync(ledgerDir)
    .filter((name) => /^canary-.+\.json$/.test(name))
    .map((name) => {
      try {
        const filePath = realpathSync(path.join(ledgerDir, name));
        const text = readFileSync(filePath, "utf8");
        const record = JSON.parse(text);
        validateStoredCanaryRecordEvidence(record, filePath);
        return {
          ...record,
          sourceReference: {
            file: path.basename(filePath),
            digest: createHash("sha256").update(text).digest("hex"),
          },
        };
      } catch {
        return null;
      }
    })
    .filter((record) => record && record.version !== excludeVersion)
    .sort((a, b) => String(a.windowEnd).localeCompare(String(b.windowEnd)))
    .slice(-limit);
}

function fileSafe(value) {
  return String(value).replace(/[^0-9A-Za-z.-]+/g, "_");
}

function compactTimestamp(value) {
  return String(value)
    .replace(/[^0-9]/g, "")
    .slice(0, 17);
}

export function canaryRecordFilename(record) {
  const digest = contentDigest(canaryRecordText(record));
  return `canary-${fileSafe(record.version)}-${compactTimestamp(record.windowStart)}-${compactTimestamp(record.windowEnd)}-${digest}.json`;
}

function artifactBytes(content) {
  return Buffer.isBuffer(content)
    ? content
    : Buffer.from(String(content), "utf8");
}

function contentDigest(content) {
  return createHash("sha256").update(artifactBytes(content)).digest("hex");
}

export function canaryRecordText(record) {
  return `${JSON.stringify(record, null, 2)}\n`;
}

export function canaryEvidenceFilename(evidenceText) {
  return `canary-evidence-${contentDigest(evidenceText)}.jsonl`;
}

export function canaryCollectorEvidenceFilename(collectorMetricsText) {
  return `canary-collector-${contentDigest(collectorMetricsText)}.tsv`;
}

export function canaryCollectorEventsEvidenceFilename(collectorEventsText) {
  return `canary-collector-events-${contentDigest(collectorEventsText)}.jsonl`;
}

export function readCollectorEventsEvidenceText({
  collectorMetricsPath,
  collectorEventsPath = null,
}) {
  if (collectorEventsPath) {
    const resolvedPath = path.resolve(collectorEventsPath);
    if (!existsSync(resolvedPath)) {
      throw new Error(
        `Collector event evidence does not exist: ${resolvedPath}`,
      );
    }
    return readFileSync(resolvedPath, "utf8");
  }
  const eventPath = path.join(
    path.dirname(path.resolve(collectorMetricsPath)),
    COLLECTOR_EVENTS_FILENAME,
  );
  if (!existsSync(eventPath)) {
    throw new Error(`Collector event evidence does not exist: ${eventPath}`);
  }
  return [
    path.join(path.dirname(eventPath), COLLECTOR_EVENTS_ARCHIVE_FILENAME),
    eventPath,
  ]
    .filter((candidate) => existsSync(candidate))
    .map((candidate) => readFileSync(candidate, "utf8"))
    .join("");
}

function existingArtifactMatches(filePath, expectedBytes) {
  try {
    const existingBytes = readFileSync(filePath);
    if (existingBytes.equals(expectedBytes)) return true;
    throw new Error(
      `Refusing to overwrite immutable canary artifact with different bytes: ${filePath}`,
    );
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}

/** Publish complete bytes without replacing an existing canary artifact. */
export function writeImmutableCanaryArtifact(filePath, content) {
  const resolvedPath = path.resolve(filePath);
  const bytes = artifactBytes(content);
  const digest = contentDigest(bytes);
  mkdirSync(path.dirname(resolvedPath), { recursive: true });
  if (existingArtifactMatches(resolvedPath, bytes)) {
    return { path: resolvedPath, created: false, digest };
  }

  const temporaryPath = `${resolvedPath}.${String(process.pid)}.${randomUUID()}.tmp`;
  try {
    writeFileSync(temporaryPath, bytes, { flag: "wx", mode: 0o644 });
    try {
      linkSync(temporaryPath, resolvedPath);
      return { path: resolvedPath, created: true, digest };
    } catch (error) {
      if (error?.code !== "EEXIST") throw error;
      if (existingArtifactMatches(resolvedPath, bytes)) {
        return { path: resolvedPath, created: false, digest };
      }
      throw new Error(
        `Canary artifact disappeared during exclusive publication: ${resolvedPath}`,
      );
    }
  } finally {
    rmSync(temporaryPath, { force: true });
  }
}

function usage() {
  return `Usage:
  node scripts/canary-summarize.mjs [options]

Options:
  --context <path>     Required observation context JSON with build, runtime, workload, host, source health, and exact window.
  --collector-metrics <path>  Required metrics.tsv from the soak that created the context.
  --collector-events <path>   Optional collector-events JSONL. By default requires the current file beside collector metrics and reads its archive first when present.
  --app-data <path>    Dir with rotated runtime-health files. Defaults to the installed app dir.
  --ledger-dir <path>  Ledger output dir. Defaults to <repo>/canary-ledger.
  --strict             Exit 1 when a regression is flagged.
  --json               Print the record to stdout too.
  --help               Show this help.
`;
}

export function parseArgs(argv) {
  const args = {
    context: null,
    collectorMetrics: null,
    collectorEvents: null,
    appData: DEFAULT_APP_DATA,
    ledgerDir: DEFAULT_LEDGER_DIR,
    strict: false,
    json: false,
    help: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--context") args.context = argv[++i];
    else if (arg === "--collector-metrics") args.collectorMetrics = argv[++i];
    else if (arg === "--collector-events") args.collectorEvents = argv[++i];
    else if (arg === "--app-data") args.appData = argv[++i];
    else if (arg === "--ledger-dir") args.ledgerDir = argv[++i];
    else if (arg === "--strict") args.strict = true;
    else if (arg === "--json") args.json = true;
    else if (arg === "--help" || arg === "-h") args.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return args;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    process.stdout.write(usage());
    return;
  }
  if (!args.context) {
    throw new Error(
      "--context is required so a historical window cannot be labeled from the currently installed build.",
    );
  }
  if (!args.collectorMetrics) {
    throw new Error(
      "--collector-metrics is required so canary denominators can be rebuilt from raw evidence.",
    );
  }
  const context = validateCanaryObservationContext(
    JSON.parse(readFileSync(path.resolve(args.context), "utf8")),
  );
  const version = context.build.version;
  const sinceMs = Date.parse(context.windowStart);
  const untilMs = Date.parse(context.windowEnd);

  const entries = readHealthWindow(args.appData, { sinceMs, untilMs });
  const collectorMetricsText = readFileSync(
    path.resolve(args.collectorMetrics),
    "utf8",
  );
  const collectorEventsText = readCollectorEventsEvidenceText({
    collectorMetricsPath: args.collectorMetrics,
    collectorEventsPath: args.collectorEvents,
  });
  validateCanaryRawEvidence(
    entries,
    collectorMetricsText,
    context,
    collectorEventsText,
  );
  const summary = computeCanarySummary(entries, {
    observationContext: context,
    windowStartMs: sinceMs,
    windowEndMs: untilMs,
    collectorMetricsText,
  });
  const trailing = loadTrailingSummaries(args.ledgerDir, version);
  const comparison = compareCanarySummary(summary, trailing);
  const regressions = comparison.regressions;
  mkdirSync(args.ledgerDir, { recursive: true });
  const evidenceText = `${(
    entries.sourceDiagnostics?.rawRecords ??
    entries.map((entry) => JSON.stringify(entry))
  ).join("\n")}\n`;
  const evidenceFile = canaryEvidenceFilename(evidenceText);
  const evidencePath = path.join(args.ledgerDir, evidenceFile);
  writeImmutableCanaryArtifact(evidencePath, evidenceText);
  const collectorEvidenceFile =
    canaryCollectorEvidenceFilename(collectorMetricsText);
  const collectorEvidencePath = path.join(
    args.ledgerDir,
    collectorEvidenceFile,
  );
  writeImmutableCanaryArtifact(collectorEvidencePath, collectorMetricsText);
  const collectorEventsEvidenceFile =
    canaryCollectorEventsEvidenceFilename(collectorEventsText);
  const collectorEventsEvidencePath = path.join(
    args.ledgerDir,
    collectorEventsEvidenceFile,
  );
  writeImmutableCanaryArtifact(
    collectorEventsEvidencePath,
    collectorEventsText,
  );
  const record = {
    ...summary,
    sourceEvidence: {
      runtimeHealth: {
        file: evidenceFile,
        digest: createHash("sha256").update(evidenceText).digest("hex"),
        format: "runtime-health-jsonl",
      },
      collectorMetrics: {
        file: collectorEvidenceFile,
        digest: createHash("sha256").update(collectorMetricsText).digest("hex"),
        format: "collector-metrics-tsv",
      },
      collectorEvents: {
        file: collectorEventsEvidenceFile,
        digest: createHash("sha256").update(collectorEventsText).digest("hex"),
        format: "collector-events-jsonl",
      },
    },
    comparison,
    regressions,
    trailingCompared: comparison.comparableWindows,
  };

  const recordText = canaryRecordText(record);
  const outPath = path.join(args.ledgerDir, canaryRecordFilename(record));
  writeImmutableCanaryArtifact(outPath, recordText);

  if (args.json) process.stdout.write(`${JSON.stringify(record, null, 2)}\n`);
  process.stdout.write(
    `canary ${version}: ${entries.length.toLocaleString()} health lines over ${summary.spanHours.toLocaleString()}h -> ${outPath}\n`,
  );
  if (comparison.status === "regression") {
    for (const r of regressions) {
      process.stdout.write(
        `REGRESSION ${r.metric}: ${r.current.toLocaleString()} vs trailing median ${r.trailingMedian.toLocaleString()} (limit ${r.limit.toLocaleString()}, n=${r.trailingCount.toLocaleString()})\n`,
      );
    }
    if (args.strict) process.exitCode = 1;
  } else if (comparison.status === "inconclusive") {
    process.stdout.write(
      `inconclusive: ${comparison.reason} Found ${comparison.comparableWindows.toLocaleString()} comparable window${comparison.comparableWindows === 1 ? "" : "s"}.\n`,
    );
  } else {
    process.stdout.write(
      `no regressions vs ${comparison.comparableWindows.toLocaleString()} comparable ledger entr${comparison.comparableWindows === 1 ? "y" : "ies"}\n`,
    );
  }
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
