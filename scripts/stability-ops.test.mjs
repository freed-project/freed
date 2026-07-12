import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import {
  mainRendererMemoryRecoveryReason,
  parseWatchdogConstants,
  readTraceLines,
  replayTrace,
  statsFromSample,
} from "./replay-watchdog.mjs";
import {
  canaryCollectorEvidenceFilename,
  canaryCollectorEventsEvidenceFilename,
  canaryEvidenceFilename,
  canaryRecordFilename,
  canaryRecordText,
  compareCanarySummary,
  computeCanarySummary,
  detectRegressions,
  loadTrailingSummaries,
  parseArgs as parseCanaryArgs,
  parseRuntimeHealthEvidenceText,
  readCollectorEventsEvidenceText,
  readHealthWindow,
  validateCanaryObservationContext,
  validateCanaryRawEvidence,
  writeImmutableCanaryArtifact,
} from "./canary-summarize.mjs";
import {
  buildBisectPlan,
  metricFromVerdict,
  parseArgs as parseBisectArgs,
  predicateExitCode,
  versionToTag,
} from "./bisect-regression.mjs";
import {
  buildCompositeEvidenceFingerprint,
  runtimeHealthEvidenceFingerprint,
} from "./soak-assert.mjs";
import { COLLECTOR_EVENTS_SCHEMA_VERSION } from "./soak-collect.mjs";
import {
  createCanaryEvidenceFixture,
  writeCanaryEvidenceBundle,
} from "./test-helpers/canary-evidence.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const RUST_SOURCE = path.join(
  __dirname,
  "../packages/desktop/src-tauri/src/lib.rs",
);
const TRACE_FIXTURE = path.join(__dirname, "fixtures/watchdog-trace.jsonl");

function closedCollectorSessionEventsText(startMs, endMs, collectorRunId) {
  return `${JSON.stringify({
    schemaVersion: COLLECTOR_EVENTS_SCHEMA_VERSION,
    event: "collector_session_started",
    tsMs: startMs,
    collectorRunId,
  })}\n${JSON.stringify({
    schemaVersion: COLLECTOR_EVENTS_SCHEMA_VERSION,
    event: "collector_session_stopped",
    tsMs: endMs,
    collectorRunId,
    sessionStartedAtMs: startMs,
    reason: "duration_reached",
  })}\n`;
}

// ---------------------------------------------------------------------------
// replay-watchdog
// ---------------------------------------------------------------------------

test("watchdog constants parse from the real Rust source with expected magnitudes", () => {
  const constants = parseWatchdogConstants(readFileSync(RUST_SOURCE, "utf8"));
  assert.equal(constants.BYTES_PER_GIB, 1024 ** 3);
  assert.ok(constants.MAIN_RENDERER_MEMORY_RECOVERY_MIN_AGE_SECONDS >= 60);
  assert.ok(
    constants.MAIN_RENDERER_HOT_WEBKIT_RESIDENT_RECOVERY_BYTES >
      constants.BYTES_PER_GIB,
  );
  assert.ok(constants.SCRAPE_MEMORY_HEADROOM_BYTES > 0);
});

test("replay reproduces the recorded 2026-07-05 watchdog_memory decision from the fixture trace", () => {
  // The fixture is two REAL native_runtime_memory_sample lines recorded
  // minutes before the shipped watchdog killed the main renderer for
  // "WebKit resident memory hot" (runtime-health-20260705.jsonl). The replay
  // must reach the same verdict: benign sample -> leave alone, hot sample
  // (webkit largest resident 7.79 GB >= memoryHigh 5.77 GB, tail not
  // reclaimable because app resident 9.3 GB is over critical-headroom) ->
  // recover.
  const constants = parseWatchdogConstants(readFileSync(RUST_SOURCE, "utf8"));
  const trace = readTraceLines(TRACE_FIXTURE);
  assert.equal(trace.length, 2);

  const result = replayTrace(trace, constants);
  assert.equal(result.samples, 2);
  assert.equal(result.recoveries, 1);
  assert.equal(
    result.decisions[0].reason,
    null,
    "benign idle sample must not recover",
  );
  assert.equal(result.decisions[1].reason, "webkit_hot_resident_pressure");
});

test("constant variants diverge: raising the min-age gate suppresses the historical recovery", () => {
  const constants = parseWatchdogConstants(readFileSync(RUST_SOURCE, "utf8"));
  const trace = readTraceLines(TRACE_FIXTURE);
  const base = replayTrace(trace, constants);
  const variant = replayTrace(trace, {
    ...constants,
    // The hot sample's webkit process was 2054s old; a 3000s min-age gate
    // would have left it alone. This is exactly the #847/#850 style question
    // the replay answers pre-merge.
    MAIN_RENDERER_MEMORY_RECOVERY_MIN_AGE_SECONDS: 3000,
  });
  assert.equal(base.recoveries, 1);
  assert.equal(variant.recoveries, 0);
});

test("hidden context maps the hot decision to its idle reason", () => {
  const constants = parseWatchdogConstants(readFileSync(RUST_SOURCE, "utf8"));
  const trace = readTraceLines(TRACE_FIXTURE);
  const hidden = replayTrace(trace, constants, {
    isVisible: false,
    lastVisibility: "hidden",
  });
  assert.equal(hidden.decisions[1].reason, "idle_webkit_hot_resident_pressure");
});

test("age-matched role only recovers when the webkit process age matches renderer uptime", () => {
  const constants = parseWatchdogConstants(readFileSync(RUST_SOURCE, "utf8"));
  const hot = readTraceLines(TRACE_FIXTURE)[1].entry;
  const sample = { ...hot, webkitLargestRole: "freed-webcontent-age-matched" };
  const noUptime = mainRendererMemoryRecoveryReason(
    statsFromSample(sample),
    { isVisible: true, lastVisibility: "visible", rendererUptimeMs: null },
    constants,
  );
  assert.equal(
    noUptime,
    null,
    "unknown renderer uptime must not attribute the process",
  );
  const matching = mainRendererMemoryRecoveryReason(
    statsFromSample(sample),
    {
      isVisible: true,
      lastVisibility: "visible",
      rendererUptimeMs: sample.webkitLargestAgeSeconds * 1000,
    },
    constants,
  );
  assert.equal(matching, "webkit_hot_resident_pressure");
});

// ---------------------------------------------------------------------------
// canary-summarize
// ---------------------------------------------------------------------------

function canaryEntries(uploadsUnchanged) {
  const start = 1_700_000_000_000;
  const entries = [
    { event: "renderer_recovery_attempt", tsMs: start + 1000 },
    { event: "renderer_recovery_restart_requested", tsMs: start + 1500 },
    {
      event: "window_destroyed",
      reasonEnum: "job_complete",
      tsMs: start + 2000,
    },
    {
      event: "window_destroyed",
      reasonEnum: "watchdog_memory",
      tsMs: start + 3000,
    },
    { event: "invariant_alarm", name: "cloud_loop", tsMs: start + 4000 },
    {
      event: "invariant_alarm",
      name: "preflight_kill",
      detail: "window_destroyed reason=job_complete scraperSessionHeld=true",
      tsMs: start + 4500,
    },
    { event: "worker_init", durationMs: 1000, docBytes: 1, tsMs: start + 5000 },
    {
      event: "scrape_outcome",
      provider: "facebook",
      stage: "ok",
      tsMs: start + 6000,
    },
    {
      event: "scrape_outcome",
      provider: "linkedin",
      stage: "event_timeout",
      tsMs: start + 7000,
    },
    { event: "cloud_upload_skipped", provider: "gdrive", tsMs: start + 8000 },
    {
      event: "native_runtime_memory_sample",
      tsMs: start + 9000,
      appResidentBytes: 500 * 1024 * 1024,
      webkitLargestResidentBytes: 900 * 1024 * 1024,
    },
    {
      event: "native_runtime_memory_sample",
      tsMs: start + 3_600_000,
      appResidentBytes: 600 * 1024 * 1024,
      webkitLargestResidentBytes: 950 * 1024 * 1024,
    },
  ];
  for (let i = 0; i < uploadsUnchanged; i += 1) {
    entries.push({
      event: "cloud_upload_attempt",
      provider: "gdrive",
      headsUnchanged: true,
      tsMs: start + 10_000 + i,
    });
  }
  return { entries, start };
}

function canaryContext(version, windowStartMs, windowEndMs, overrides = {}) {
  const spanHours = (windowEndMs - windowStartMs) / 3_600_000;
  const expectedIntervalMs = overrides.expectedIntervalMs ?? 60_000;
  const expectedSampleCount =
    Math.floor((windowEndMs - windowStartMs) / expectedIntervalMs) + 1;
  const collectorSampleCount =
    overrides.collectorSampleCount ?? expectedSampleCount;
  const collectorDistinctSampleCount =
    overrides.collectorDistinctSampleCount ?? collectorSampleCount;
  const runtimeHealthSampleCount = overrides.runtimeHealthSampleCount ?? 3;
  const runtimeHealthDistinctSampleCount =
    overrides.runtimeHealthDistinctSampleCount ?? runtimeHealthSampleCount;
  const runtimeHealthExpectedSampleCount =
    overrides.runtimeHealthExpectedSampleCount ??
    runtimeHealthDistinctSampleCount;
  const collectorEventsText = closedCollectorSessionEventsText(
    windowStartMs,
    windowEndMs,
    `collector-run-${version}-${windowStartMs}`,
  );
  const sourceHealth = {
    status: "healthy",
    appAliveHours: overrides.appAliveHours ?? spanHours,
    appAliveRatio: overrides.appAliveRatio ?? 1,
    collectorSampleCount,
    collectorDistinctSampleCount,
    expectedSampleCount: overrides.expectedSampleCount ?? expectedSampleCount,
    sampleDensity: overrides.sampleDensity ?? 1,
    collectorSpanHours: overrides.collectorSpanHours ?? spanHours,
    expectedIntervalMs,
    maxCreditedGapMs: overrides.maxCreditedGapMs ?? 150_000,
    largestObservedGapMs: overrides.largestObservedGapMs ?? 60_000,
    creditedIntervalCount: overrides.creditedIntervalCount ?? 1,
    collectorHeaderHealthy: overrides.collectorHeaderHealthy ?? true,
    collectorMalformedRowCount: overrides.collectorMalformedRowCount ?? 0,
    collectorEventCount: overrides.collectorEventCount ?? 2,
    collectorEventFailureCount: overrides.collectorEventFailureCount ?? 0,
    collectorEventRecoveryCount: overrides.collectorEventRecoveryCount ?? 0,
    collectorEventMalformedLineCount:
      overrides.collectorEventMalformedLineCount ?? 0,
    collectorEventProtocolErrorCount:
      overrides.collectorEventProtocolErrorCount ?? 0,
    collectorOutageOpen: overrides.collectorOutageOpen ?? false,
    collectorOpenOutageStartedAtMs:
      overrides.collectorOpenOutageStartedAtMs ?? null,
    collectorEventCoverageHealthy:
      overrides.collectorEventCoverageHealthy ?? true,
    collectorEventEvidenceCapable:
      overrides.collectorEventEvidenceCapable ?? true,
    collectorEventEvidencePresent:
      overrides.collectorEventEvidencePresent ?? true,
    collectorEventEvidenceSchemaVersion:
      overrides.collectorEventEvidenceSchemaVersion ??
      COLLECTOR_EVENTS_SCHEMA_VERSION,
    runtimeHealthMalformedLineCount:
      overrides.runtimeHealthMalformedLineCount ?? 0,
    runtimeHealthSampleCount,
    runtimeHealthDistinctSampleCount,
    runtimeHealthExpectedSampleCount,
    runtimeHealthSampleDensity:
      overrides.runtimeHealthSampleDensity ??
      Math.min(
        1,
        runtimeHealthDistinctSampleCount / runtimeHealthExpectedSampleCount,
      ),
    runtimeHealthExpectedIntervalMs:
      overrides.runtimeHealthExpectedIntervalMs ?? 60_000,
    runtimeHealthMaxCreditedGapMs:
      overrides.runtimeHealthMaxCreditedGapMs ?? 150_000,
    runtimeHealthLargestObservedGapMs:
      overrides.runtimeHealthLargestObservedGapMs ?? 60_000,
    runtimeHealthLastFreshnessMs:
      overrides.runtimeHealthLastFreshnessMs ?? 60_000,
    runtimeHealthAppAliveSegmentCount:
      overrides.runtimeHealthAppAliveSegmentCount ?? 1,
    runtimeHealthCoveredAppAliveSegmentCount:
      overrides.runtimeHealthCoveredAppAliveSegmentCount ?? 1,
    runtimeHealthCoverageHealthy:
      overrides.runtimeHealthCoverageHealthy ?? true,
    cloudEligibleHours: Object.hasOwn(overrides, "cloudEligibleHours")
      ? overrides.cloudEligibleHours
      : spanHours,
  };
  const build = {
    version,
    commitSha: overrides.commitSha ?? "a".repeat(40),
    channel: overrides.channel ?? "dev",
    installId: overrides.installId ?? `install-${version}`,
    installedAt: new Date(windowStartMs - 60_000).toISOString(),
  };
  const runtime = {
    collectorSessionId:
      overrides.collectorSessionId ?? `collector-${version}-${windowStartMs}`,
    appPid: overrides.appPid ?? 123,
    appSessionId:
      overrides.appSessionId ?? `session-${version}-${windowStartMs}`,
  };
  const attribution = {
    collectorSessionId: runtime.collectorSessionId,
    appPid: runtime.appPid,
    appVersion: build.version,
    buildCommitSha: build.commitSha,
    channel: build.channel,
    appSessionId: runtime.appSessionId,
  };
  sourceHealth.evidenceFingerprint =
    overrides.evidenceFingerprint ??
    buildCompositeEvidenceFingerprint({
      runtimeHealthFingerprint: overrides.runtimeHealthFingerprint ?? {
        algorithm: "sha256",
        digest: "d".repeat(64),
        recordCount: Math.max(3, runtimeHealthSampleCount),
      },
      collectorMetricsFingerprint: overrides.collectorMetricsFingerprint ?? {
        algorithm: "sha256",
        digest: "c".repeat(64),
        recordCount: collectorSampleCount,
        byteLength: collectorSampleCount * 100,
      },
      collectorEventsFingerprint: overrides.collectorEventsFingerprint ?? {
        algorithm: "sha256",
        digest: createHash("sha256").update(collectorEventsText).digest("hex"),
        recordCount: 2,
        byteLength: Buffer.byteLength(collectorEventsText, "utf8"),
      },
      sourceHealth,
      runtimeAttribution: attribution,
    });
  return {
    schemaVersion: 3,
    build,
    runtime,
    workload: {
      scenario: overrides.scenario ?? "idle",
      providerCohort:
        overrides.providerCohort ?? "social-authenticated-gdrive-connected",
      documentSizeBucket: overrides.documentSizeBucket ?? "medium",
    },
    host: {
      platform: overrides.platform ?? "darwin",
      architecture: overrides.architecture ?? "arm64",
      memoryTierGiB: overrides.memoryTierGiB ?? 64,
    },
    sourceHealth,
    windowStart: new Date(windowStartMs).toISOString(),
    windowEnd: new Date(windowEndMs).toISOString(),
  };
}

function computeAttributedCanary(entries, context, bounds) {
  const identity = {
    appVersion: context.build.version,
    buildCommitSha: context.build.commitSha,
    channel: context.build.channel,
    appSessionId: context.runtime.appSessionId,
  };
  const attributedEntries = entries.map((entry) => ({ ...entry, ...identity }));
  const runtimeAttribution = {
    collectorSessionId: context.runtime.collectorSessionId,
    appPid: context.runtime.appPid,
    ...identity,
  };
  const evidenceFingerprint = buildCompositeEvidenceFingerprint({
    runtimeHealthFingerprint:
      runtimeHealthEvidenceFingerprint(attributedEntries),
    collectorMetricsFingerprint:
      context.sourceHealth.evidenceFingerprint.collectorMetrics,
    collectorEventsFingerprint:
      context.sourceHealth.evidenceFingerprint.collectorEvents,
    sourceHealth: context.sourceHealth,
    runtimeAttribution,
  });
  const attributedContext = {
    ...context,
    sourceHealth: {
      ...context.sourceHealth,
      evidenceFingerprint,
    },
  };
  return computeCanarySummary(attributedEntries, {
    observationContext: attributedContext,
    ...bounds,
  });
}

function priorCanary(summary, index) {
  const spanMs =
    Date.parse(summary.windowEnd) - Date.parse(summary.windowStart);
  const endMs =
    Date.parse(summary.windowStart) - (index - 1) * spanMs - index * 60_000;
  const buildIdentity = {
    ...summary.buildIdentity,
    version: `baseline-${index.toLocaleString()}`,
    commitSha: String(index).repeat(40),
  };
  const runtimeIdentity = {
    ...summary.runtimeIdentity,
    appSessionId: `baseline-session-${index.toLocaleString()}`,
  };
  const identity = {
    appVersion: buildIdentity.version,
    buildCommitSha: buildIdentity.commitSha,
    channel: buildIdentity.channel,
    appSessionId: runtimeIdentity.appSessionId,
  };
  const evidenceFingerprint = buildCompositeEvidenceFingerprint({
    runtimeHealthFingerprint:
      summary.sourceHealth.evidenceFingerprint.runtimeHealth,
    collectorMetricsFingerprint:
      summary.sourceHealth.evidenceFingerprint.collectorMetrics,
    collectorEventsFingerprint:
      summary.sourceHealth.evidenceFingerprint.collectorEvents,
    sourceHealth: summary.sourceHealth,
    runtimeAttribution: {
      collectorSessionId: runtimeIdentity.collectorSessionId,
      appPid: runtimeIdentity.appPid,
      ...identity,
    },
  });
  return {
    ...summary,
    version: `baseline-${index.toLocaleString()}`,
    buildIdentity,
    runtimeIdentity,
    sourceHealth: { ...summary.sourceHealth, evidenceFingerprint },
    evidenceAttribution: {
      ...summary.evidenceAttribution,
      identity,
      evidenceFingerprint,
      observedRuntimeHealthFingerprint: evidenceFingerprint.runtimeHealth,
    },
    observationId: `baseline-observation-${index.toLocaleString()}`,
    windowStart: new Date(endMs - spanMs).toISOString(),
    windowEnd: new Date(endMs).toISOString(),
  };
}

function withWindowDurationRatio(summary, ratio) {
  const adjusted = structuredClone(summary);
  const windowEndMs = Date.parse(adjusted.windowEnd);
  const originalDurationMs = windowEndMs - Date.parse(adjusted.windowStart);
  const durationMs = originalDurationMs * ratio;
  const durationHours = durationMs / 3_600_000;
  adjusted.windowStart = new Date(windowEndMs - durationMs).toISOString();
  const sourceHealth = {
    ...adjusted.sourceHealth,
    appAliveHours: durationHours,
    collectorSpanHours: durationHours,
    cloudEligibleHours:
      adjusted.sourceHealth.cloudEligibleHours === null ? null : durationHours,
  };
  const identity = adjusted.evidenceAttribution.identity;
  const evidenceFingerprint = buildCompositeEvidenceFingerprint({
    runtimeHealthFingerprint: sourceHealth.evidenceFingerprint.runtimeHealth,
    collectorMetricsFingerprint:
      sourceHealth.evidenceFingerprint.collectorMetrics,
    collectorEventsFingerprint:
      sourceHealth.evidenceFingerprint.collectorEvents,
    sourceHealth,
    runtimeAttribution: {
      collectorSessionId: adjusted.runtimeIdentity.collectorSessionId,
      appPid: adjusted.runtimeIdentity.appPid,
      ...identity,
    },
  });
  adjusted.sourceHealth = { ...sourceHealth, evidenceFingerprint };
  adjusted.evidenceAttribution = {
    ...adjusted.evidenceAttribution,
    evidenceFingerprint,
    observedRuntimeHealthFingerprint: evidenceFingerprint.runtimeHealth,
  };
  return adjusted;
}

test("canary health ingestion includes rotated and live records without duplicates", () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "freed-canary-health-"));
  const rotated = { event: "renderer_heartbeat", tsMs: 100, seq: 1 };
  const live = { event: "invariant_alarm", tsMs: 200, name: "cloud_loop" };
  writeFileSync(
    path.join(dir, "runtime-health-20260710.jsonl"),
    `${JSON.stringify(rotated)}\n`,
  );
  writeFileSync(
    path.join(dir, "runtime-health.jsonl"),
    `${JSON.stringify(rotated)}\n${JSON.stringify(live)}\n`,
  );

  assert.deepEqual(readHealthWindow(dir, { sinceMs: 0 }), [rotated, live]);
});

test("canary health ingestion preserves duplicate multiplicity within one source", () => {
  const dir = mkdtempSync(
    path.join(os.tmpdir(), "freed-canary-duplicate-health-"),
  );
  const repeated = {
    event: "cloud_upload_attempt",
    tsMs: 100,
    headsUnchanged: true,
  };
  writeFileSync(
    path.join(dir, "runtime-health-20260710.jsonl"),
    `${JSON.stringify(repeated)}\n${JSON.stringify(repeated)}\n`,
  );
  writeFileSync(
    path.join(dir, "runtime-health.jsonl"),
    `${JSON.stringify(repeated)}\n${JSON.stringify(repeated)}\n`,
  );
  const entries = readHealthWindow(dir, { sinceMs: 0 });
  assert.equal(entries.length, 2);
  assert.equal(runtimeHealthEvidenceFingerprint(entries).recordCount, 2);
});

test("computeCanarySummary folds counters into per-release metrics", () => {
  const { entries, start } = canaryEntries(12);
  const bounds = { windowStartMs: start, windowEndMs: start + 6 * 3_600_000 };
  const summary = computeAttributedCanary(
    entries,
    canaryContext("26.7.800", bounds.windowStartMs, bounds.windowEndMs),
    bounds,
  );
  assert.equal(summary.version, "26.7.800");
  assert.equal(summary.metricRegistryVersion, 3);
  assert.equal(summary.spanHours, 6);
  assert.equal(summary.metrics.uploadsUnchangedPerHour, 2);
  assert.equal(
    summary.metrics.recoveriesPerDay,
    4,
    "attempt plus restart is one counted incident",
  );
  assert.equal(summary.metrics.windowKillsByReason.watchdog_memory, 1);
  assert.equal(summary.metrics.alarmsByName.cloud_loop, 1);
  assert.equal(summary.metrics.alarmsByName.preflight_kill, undefined);
  assert.equal(summary.metrics.rawAlarmsByName.preflight_kill, 1);
  assert.equal(
    summary.metrics.scrapeByProvider.linkedin.byStage.event_timeout,
    1,
  );
  assert.ok(summary.metrics.peakAppResidentBytes >= 600 * 1024 * 1024);
  assert.ok(summary.metrics.idleGrowthMbPerHour > 0);
});

test("regression detection flags a worsened trace and passes a steady one", () => {
  const { entries, start } = canaryEntries(12);
  const windowOpts = {
    windowStartMs: start,
    windowEndMs: start + 6 * 3_600_000,
  };
  const steady = computeAttributedCanary(
    entries,
    canaryContext("26.7.801", windowOpts.windowStartMs, windowOpts.windowEndMs),
    windowOpts,
  );
  const trailing = [
    priorCanary(steady, 1),
    priorCanary(steady, 2),
    priorCanary(steady, 3),
  ];

  assert.deepEqual(detectRegressions(steady, trailing), []);

  const worsened = computeAttributedCanary(
    canaryEntries(60).entries,
    canaryContext("26.7.802", windowOpts.windowStartMs, windowOpts.windowEndMs),
    windowOpts,
  );
  const regressions = detectRegressions(worsened, trailing);
  const metrics = regressions.map((r) => r.metric);
  assert.ok(
    metrics.includes("uploadsUnchangedPerHour"),
    `flagged: ${metrics.join(",")}`,
  );
});

test("canary comparison stays inconclusive until three matching-context windows exist", () => {
  const { entries, start } = canaryEntries(12);
  const bounds = { windowStartMs: start, windowEndMs: start + 6 * 3_600_000 };
  const current = computeAttributedCanary(
    entries,
    canaryContext("26.7.804", bounds.windowStartMs, bounds.windowEndMs),
    bounds,
  );
  const baselines = [
    priorCanary(current, 1),
    priorCanary(current, 2),
    priorCanary(current, 3),
  ];
  const otherMachine = {
    ...priorCanary(current, 4),
    comparisonContext: { ...current.comparisonContext, memoryTierGiB: 32 },
  };

  const tooThin = compareCanarySummary(current, [
    ...baselines.slice(0, 2),
    otherMachine,
  ]);
  assert.equal(tooThin.status, "inconclusive");
  assert.equal(tooThin.comparableWindows, 2);
  assert.match(tooThin.reason, /at least 3/);

  const sufficient = compareCanarySummary(current, [
    ...baselines,
    otherMachine,
  ]);
  assert.equal(sufficient.status, "pass");
  assert.equal(sufficient.comparableWindows, 3);
});

test("canary comparison rejects a baseline window shorter than the 0.8 duration ratio", () => {
  const { entries, start } = canaryEntries(12);
  const bounds = { windowStartMs: start, windowEndMs: start + 6 * 3_600_000 };
  const current = computeAttributedCanary(
    entries,
    canaryContext("26.7.803", bounds.windowStartMs, bounds.windowEndMs),
    bounds,
  );
  const comparison = compareCanarySummary(current, [
    priorCanary(current, 1),
    priorCanary(current, 2),
    withWindowDurationRatio(priorCanary(current, 3), 0.79),
  ]);
  assert.equal(comparison.comparableWindows, 2);
  assert.equal(comparison.status, "inconclusive");
});

test("canary comparison rejects a baseline window longer than the 1.25 duration ratio", () => {
  const { entries, start } = canaryEntries(12);
  const bounds = { windowStartMs: start, windowEndMs: start + 6 * 3_600_000 };
  const current = computeAttributedCanary(
    entries,
    canaryContext("26.7.803", bounds.windowStartMs, bounds.windowEndMs),
    bounds,
  );
  const comparison = compareCanarySummary(current, [
    priorCanary(current, 1),
    priorCanary(current, 2),
    withWindowDurationRatio(priorCanary(current, 3), 1.26),
  ]);
  assert.equal(comparison.comparableWindows, 2);
  assert.equal(comparison.status, "inconclusive");
});

test("same-build canary history cannot satisfy the baseline minimum", () => {
  const { entries, start } = canaryEntries(12);
  const bounds = { windowStartMs: start, windowEndMs: start + 6 * 3_600_000 };
  const current = computeAttributedCanary(
    entries,
    canaryContext("26.7.805", bounds.windowStartMs, bounds.windowEndMs),
    bounds,
  );
  const validBaselines = [priorCanary(current, 1), priorCanary(current, 2)];
  const sameBuild = priorCanary(current, 3);
  const sameBuildIdentity = { ...current.buildIdentity };
  const sameBuildRuntime = sameBuild.runtimeIdentity;
  const sameBuildEvidenceFingerprint = buildCompositeEvidenceFingerprint({
    runtimeHealthFingerprint:
      sameBuild.sourceHealth.evidenceFingerprint.runtimeHealth,
    collectorMetricsFingerprint:
      sameBuild.sourceHealth.evidenceFingerprint.collectorMetrics,
    collectorEventsFingerprint:
      sameBuild.sourceHealth.evidenceFingerprint.collectorEvents,
    sourceHealth: sameBuild.sourceHealth,
    runtimeAttribution: {
      collectorSessionId: sameBuildRuntime.collectorSessionId,
      appPid: sameBuildRuntime.appPid,
      appVersion: sameBuildIdentity.version,
      buildCommitSha: sameBuildIdentity.commitSha,
      channel: sameBuildIdentity.channel,
      appSessionId: sameBuildRuntime.appSessionId,
    },
  });
  sameBuild.version = sameBuildIdentity.version;
  sameBuild.buildIdentity = sameBuildIdentity;
  sameBuild.sourceHealth = {
    ...sameBuild.sourceHealth,
    evidenceFingerprint: sameBuildEvidenceFingerprint,
  };
  sameBuild.evidenceAttribution = {
    ...sameBuild.evidenceAttribution,
    identity: {
      appVersion: sameBuildIdentity.version,
      buildCommitSha: sameBuildIdentity.commitSha,
      channel: sameBuildIdentity.channel,
      appSessionId: sameBuildRuntime.appSessionId,
    },
    evidenceFingerprint: sameBuildEvidenceFingerprint,
    observedRuntimeHealthFingerprint:
      sameBuildEvidenceFingerprint.runtimeHealth,
  };

  const comparison = compareCanarySummary(current, [
    ...validBaselines,
    sameBuild,
  ]);
  assert.equal(comparison.status, "inconclusive");
  assert.equal(comparison.comparableWindows, 2);
});

test("negative idle memory growth remains a valid neutral canary result", () => {
  const { entries, start } = canaryEntries(12);
  const bounds = { windowStartMs: start, windowEndMs: start + 6 * 3_600_000 };
  const measured = computeAttributedCanary(
    entries,
    canaryContext("26.7.806", bounds.windowStartMs, bounds.windowEndMs),
    bounds,
  );
  measured.metrics.idleGrowthMbPerHour = -60;
  const baselines = [1, 2, 3].map((index) => {
    const baseline = priorCanary(measured, index);
    baseline.metrics = { ...baseline.metrics, idleGrowthMbPerHour: -50 };
    return baseline;
  });
  const comparison = compareCanarySummary(measured, baselines);
  assert.equal(comparison.metrics.idleGrowthMbPerHour.status, "pass");
  assert.equal(comparison.metrics.idleGrowthMbPerHour.trailingMedian, -50);
  assert.equal(comparison.metrics.idleGrowthMbPerHour.limit, -30);
});

test("malformed runtime-health evidence cannot produce a passing canary", () => {
  const { entries, start } = canaryEntries(12);
  const bounds = { windowStartMs: start, windowEndMs: start + 6 * 3_600_000 };
  const context = canaryContext(
    "26.7.807",
    bounds.windowStartMs,
    bounds.windowEndMs,
  );
  const identity = {
    appVersion: context.build.version,
    buildCommitSha: context.build.commitSha,
    channel: context.build.channel,
    appSessionId: context.runtime.appSessionId,
  };
  const validEntries = entries.map((entry) => ({ ...entry, ...identity }));
  const rawEvidence = `${validEntries.map((entry) => JSON.stringify(entry)).join("\n")}\n{"truncated":`;
  const parsed = parseRuntimeHealthEvidenceText(
    rawEvidence,
    "malformed-canary.jsonl",
  );
  const evidenceFingerprint = buildCompositeEvidenceFingerprint({
    runtimeHealthFingerprint: runtimeHealthEvidenceFingerprint(parsed),
    collectorMetricsFingerprint:
      context.sourceHealth.evidenceFingerprint.collectorMetrics,
    collectorEventsFingerprint:
      context.sourceHealth.evidenceFingerprint.collectorEvents,
    sourceHealth: context.sourceHealth,
    runtimeAttribution: {
      collectorSessionId: context.runtime.collectorSessionId,
      appPid: context.runtime.appPid,
      ...identity,
    },
  });
  context.sourceHealth.evidenceFingerprint = evidenceFingerprint;
  const malformed = computeCanarySummary(parsed, {
    observationContext: context,
    ...bounds,
  });
  const healthy = computeAttributedCanary(
    entries,
    canaryContext("26.7.808", bounds.windowStartMs, bounds.windowEndMs, {
      commitSha: "b".repeat(40),
    }),
    bounds,
  );
  const comparison = compareCanarySummary(malformed, [
    priorCanary(healthy, 1),
    priorCanary(healthy, 2),
    priorCanary(healthy, 3),
  ]);
  assert.equal(parsed.sourceDiagnostics.malformedLines.length, 1);
  assert.equal(malformed.evidenceAttribution.status, "source-malformed");
  assert.equal(comparison.status, "inconclusive");
  assert.match(comparison.reason, /source-malformed/);
});

test("an empty canary observation window cannot pass from zero-valued counters", () => {
  const start = 1_700_000_000_000;
  const empty = computeCanarySummary([], {
    observationContext: canaryContext(
      "26.7.805",
      start,
      start + 24 * 3_600_000,
    ),
    windowStartMs: start,
    windowEndMs: start + 24 * 3_600_000,
  });
  const baseline = priorCanary(
    computeAttributedCanary(
      canaryEntries(12).entries,
      canaryContext("26.7.804", start, start + 24 * 3_600_000),
      { windowStartMs: start, windowEndMs: start + 24 * 3_600_000 },
    ),
    1,
  );
  const comparison = compareCanarySummary(empty, [baseline]);
  assert.equal(comparison.status, "inconclusive");
  assert.match(comparison.reason, /no runtime-health entries/);
});

test("one unrelated health line fails closed as thin runtime-health coverage", () => {
  const start = 1_700_000_000_000;
  const end = start + 24 * 3_600_000;
  const entries = [{ event: "unrelated", tsMs: start + 1 }];
  const context = canaryContext("26.7.806", start, end);
  context.sourceHealth.evidenceFingerprint = buildCompositeEvidenceFingerprint({
    runtimeHealthFingerprint: runtimeHealthEvidenceFingerprint(entries),
    collectorMetricsFingerprint:
      context.sourceHealth.evidenceFingerprint.collectorMetrics,
    collectorEventsFingerprint:
      context.sourceHealth.evidenceFingerprint.collectorEvents,
    sourceHealth: context.sourceHealth,
    runtimeAttribution: {
      collectorSessionId: context.runtime.collectorSessionId,
      appPid: context.runtime.appPid,
      appVersion: context.build.version,
      buildCommitSha: context.build.commitSha,
      channel: context.build.channel,
      appSessionId: context.runtime.appSessionId,
    },
  });
  assert.throws(
    () =>
      computeCanarySummary(entries, {
        observationContext: context,
        windowStartMs: start,
        windowEndMs: end,
      }),
    /complete runtime, collector metrics, and collector event SHA-256 components/,
  );
});

test("one untagged metric line cannot claim healthy runtime-health coverage", () => {
  const start = 1_700_000_000_000;
  const end = start + 6 * 3_600_000;
  const entries = [{ event: "worker_init", tsMs: start + 1 }];
  const context = canaryContext("26.7.807", start, end);
  context.sourceHealth.evidenceFingerprint = buildCompositeEvidenceFingerprint({
    runtimeHealthFingerprint: runtimeHealthEvidenceFingerprint(entries),
    collectorMetricsFingerprint:
      context.sourceHealth.evidenceFingerprint.collectorMetrics,
    collectorEventsFingerprint:
      context.sourceHealth.evidenceFingerprint.collectorEvents,
    sourceHealth: context.sourceHealth,
    runtimeAttribution: {
      collectorSessionId: context.runtime.collectorSessionId,
      appPid: context.runtime.appPid,
      appVersion: context.build.version,
      buildCommitSha: context.build.commitSha,
      channel: context.build.channel,
      appSessionId: context.runtime.appSessionId,
    },
  });
  assert.throws(
    () =>
      computeCanarySummary(entries, {
        observationContext: context,
        windowStartMs: start,
        windowEndMs: end,
      }),
    /complete runtime, collector metrics, and collector event SHA-256 components/,
  );
});

test("canary context requires complete, consistent, healthy runtime-health coverage", () => {
  const start = 1_700_000_000_000;
  const end = start + 6 * 3_600_000;
  const missing = canaryContext("26.7.808", start, end);
  delete missing.sourceHealth.runtimeHealthSampleCount;
  assert.throws(
    () => validateCanaryObservationContext(missing),
    /runtimeHealthSampleCount must be an integer of at least 3/,
  );
  assert.throws(
    () =>
      validateCanaryObservationContext(
        canaryContext("26.7.808", start, end, {
          runtimeHealthSampleDensity: 0.9,
        }),
      ),
    /runtimeHealthSampleDensity does not match its runtime-health sample counts/,
  );
  assert.throws(
    () =>
      validateCanaryObservationContext(
        canaryContext("26.7.808", start, end, {
          runtimeHealthCoverageHealthy: false,
        }),
      ),
    /runtimeHealthCoverageHealthy must be true/,
  );
});

test("canary raw validation rejects runtime-health coverage tampering", () => {
  const fixture = createCanaryEvidenceFixture({
    startMs: Date.parse("2026-07-10T00:00:00.000Z"),
    version: "26.7.1000-dev",
    commitSha: "b".repeat(40),
  });
  const summary = fixture.summary;
  const context = {
    schemaVersion: 3,
    build: summary.buildIdentity,
    runtime: summary.runtimeIdentity,
    workload: summary.workload,
    host: {
      platform: summary.comparisonContext.platform,
      architecture: summary.comparisonContext.architecture,
      memoryTierGiB: summary.comparisonContext.memoryTierGiB,
    },
    sourceHealth: structuredClone(summary.sourceHealth),
    windowStart: summary.windowStart,
    windowEnd: summary.windowEnd,
  };
  assert.doesNotThrow(() =>
    validateCanaryRawEvidence(
      fixture.entries,
      fixture.collectorMetricsText,
      context,
      fixture.collectorEventsText,
    ),
  );

  context.sourceHealth.runtimeHealthLargestObservedGapMs += 1;
  context.sourceHealth.evidenceFingerprint = buildCompositeEvidenceFingerprint({
    runtimeHealthFingerprint:
      summary.sourceHealth.evidenceFingerprint.runtimeHealth,
    collectorMetricsFingerprint:
      summary.sourceHealth.evidenceFingerprint.collectorMetrics,
    collectorEventsFingerprint:
      summary.sourceHealth.evidenceFingerprint.collectorEvents,
    sourceHealth: context.sourceHealth,
    runtimeAttribution: {
      collectorSessionId: summary.runtimeIdentity.collectorSessionId,
      appPid: summary.runtimeIdentity.appPid,
      appVersion: summary.buildIdentity.version,
      buildCommitSha: summary.buildIdentity.commitSha,
      channel: summary.buildIdentity.channel,
      appSessionId: summary.runtimeIdentity.appSessionId,
    },
  });
  assert.throws(
    () =>
      validateCanaryRawEvidence(
        fixture.entries,
        fixture.collectorMetricsText,
        context,
        fixture.collectorEventsText,
      ),
    /runtimeHealthLargestObservedGapMs does not match the raw collector evidence and runtime-health evidence/,
  );
});

test("canary observation context rejects missing identity and historical relabeling", () => {
  const start = 1_700_000_000_000;
  const end = start + 6 * 3_600_000;
  assert.throws(
    () =>
      validateCanaryObservationContext(
        canaryContext("26.7.900", start, end, { commitSha: "short" }),
      ),
    /full 40 to 64 character hexadecimal commit SHA/,
  );
  assert.throws(
    () =>
      validateCanaryObservationContext(canaryContext("26.7.900", start, end), {
        windowStartMs: start + 1,
        windowEndMs: end,
      }),
    /windowStart does not match/,
  );
  assert.equal(parseCanaryArgs([]).context, null);
});

test("canary cloud rates are unavailable without cloud-eligible coverage", () => {
  const { entries, start } = canaryEntries(12);
  const end = start + 6 * 3_600_000;
  const summary = computeAttributedCanary(
    entries,
    canaryContext("26.7.901", start, end, {
      cloudEligibleHours: null,
      providerCohort: "social-authenticated-cloud-off",
    }),
    { windowStartMs: start, windowEndMs: end },
  );
  assert.equal(summary.metrics.uploadsPerHour, null);
  assert.equal(summary.metrics.uploadsUnchangedPerHour, null);
  assert.equal(summary.metrics.workerInitsPerHour, 0.17);
  const comparison = compareCanarySummary(summary, [
    priorCanary(summary, 1),
    priorCanary(summary, 2),
    priorCanary(summary, 3),
  ]);
  assert.equal(comparison.status, "inconclusive");
  assert.match(comparison.reason, /unavailable/);
});

test("canary baselines require healthy complete source fingerprints", () => {
  const { entries, start } = canaryEntries(12);
  const bounds = { windowStartMs: start, windowEndMs: start + 6 * 3_600_000 };
  const current = computeAttributedCanary(
    entries,
    canaryContext("26.7.902", bounds.windowStartMs, bounds.windowEndMs),
    bounds,
  );
  const baselines = [
    priorCanary(current, 1),
    priorCanary(current, 2),
    priorCanary(current, 3),
  ];
  baselines[0] = {
    ...baselines[0],
    sourceHealth: {
      ...baselines[0].sourceHealth,
      status: "unhealthy",
      evidenceFingerprint: {
        algorithm: "sha256",
        digest: "f".repeat(64),
        recordCount: 1,
      },
    },
  };
  const comparison = compareCanarySummary(current, baselines);
  assert.equal(comparison.comparableWindows, 2);
  assert.equal(comparison.status, "inconclusive");
});

test("canary filenames preserve multiple observation windows for one release", () => {
  const base = {
    version: "26.7.900-dev",
    windowStart: "2026-07-09T00:00:00.000Z",
    windowEnd: "2026-07-10T00:00:00.000Z",
  };
  const next = {
    ...base,
    windowStart: "2026-07-10T00:00:00.000Z",
    windowEnd: "2026-07-11T00:00:00.000Z",
  };
  assert.notEqual(canaryRecordFilename(base), canaryRecordFilename(next));
  assert.match(
    canaryRecordFilename(base),
    /^canary-26\.7\.900-dev-\d+-\d+-[0-9a-f]{64}\.json$/,
  );
});

test("canary collector event evidence preserves the rotated archive before the live file", () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "freed-canary-events-"));
  const metricsPath = path.join(dir, "metrics.tsv");
  const eventsPath = path.join(dir, "collector-events.jsonl");
  const archivedText = '{"event":"collector_sample_failed"}\n';
  const currentText = '{"event":"collector_sample_recovered"}\n';
  writeFileSync(metricsPath, "tsMs\tappPid\n");
  writeFileSync(`${eventsPath}.1`, archivedText);
  writeFileSync(eventsPath, currentText);

  assert.equal(
    readCollectorEventsEvidenceText({ collectorMetricsPath: metricsPath }),
    `${archivedText}${currentText}`,
  );
  assert.equal(
    readCollectorEventsEvidenceText({
      collectorMetricsPath: metricsPath,
      collectorEventsPath: eventsPath,
    }),
    currentText,
  );
  assert.throws(
    () =>
      readCollectorEventsEvidenceText({
        collectorMetricsPath: metricsPath,
        collectorEventsPath: path.join(dir, "missing.jsonl"),
      }),
    /Collector event evidence does not exist/,
  );
  const missingDir = mkdtempSync(
    path.join(os.tmpdir(), "freed-canary-events-missing-"),
  );
  const missingMetricsPath = path.join(missingDir, "metrics.tsv");
  writeFileSync(missingMetricsPath, "tsMs\tappPid\n");
  assert.throws(
    () =>
      readCollectorEventsEvidenceText({
        collectorMetricsPath: missingMetricsPath,
      }),
    /Collector event evidence does not exist/,
  );
});

test("canary records and source sidecars are content addressed and immutable", () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "freed-canary-immutable-"));
  const runtimeA = '{"event":"renderer_heartbeat","tsMs":1}\n';
  const runtimeB = '{"event":"renderer_heartbeat","tsMs":2}\n';
  const collectorA = "tsMs\tappPid\n1\t123\n";
  const collectorB = "tsMs\tappPid\n2\t123\n";
  const collectorEventsA =
    '{"schemaVersion":1,"event":"collector_sample_failed","tsMs":1}\n';
  const collectorEventsB =
    '{"schemaVersion":1,"event":"collector_sample_failed","tsMs":2}\n';
  const runtimeDigestA = createHash("sha256").update(runtimeA).digest("hex");
  const collectorDigestA = createHash("sha256")
    .update(collectorA)
    .digest("hex");
  const collectorEventsDigestA = createHash("sha256")
    .update(collectorEventsA)
    .digest("hex");

  assert.equal(
    canaryEvidenceFilename(runtimeA),
    `canary-evidence-${runtimeDigestA}.jsonl`,
  );
  assert.equal(
    canaryCollectorEvidenceFilename(collectorA),
    `canary-collector-${collectorDigestA}.tsv`,
  );
  assert.equal(
    canaryCollectorEventsEvidenceFilename(collectorEventsA),
    `canary-collector-events-${collectorEventsDigestA}.jsonl`,
  );
  assert.notEqual(
    canaryEvidenceFilename(runtimeA),
    canaryEvidenceFilename(runtimeB),
  );
  assert.notEqual(
    canaryCollectorEvidenceFilename(collectorA),
    canaryCollectorEvidenceFilename(collectorB),
  );
  assert.notEqual(
    canaryCollectorEventsEvidenceFilename(collectorEventsA),
    canaryCollectorEventsEvidenceFilename(collectorEventsB),
  );

  const runtimePathA = path.join(dir, canaryEvidenceFilename(runtimeA));
  const firstWrite = writeImmutableCanaryArtifact(runtimePathA, runtimeA);
  const identicalReuse = writeImmutableCanaryArtifact(runtimePathA, runtimeA);
  assert.equal(firstWrite.created, true);
  assert.equal(identicalReuse.created, false);
  assert.throws(
    () => writeImmutableCanaryArtifact(runtimePathA, runtimeB),
    /Refusing to overwrite immutable canary artifact/,
  );
  assert.equal(readFileSync(runtimePathA, "utf8"), runtimeA);

  const collectorPathA = path.join(
    dir,
    canaryCollectorEvidenceFilename(collectorA),
  );
  const collectorPathB = path.join(
    dir,
    canaryCollectorEvidenceFilename(collectorB),
  );
  writeImmutableCanaryArtifact(collectorPathA, collectorA);
  writeImmutableCanaryArtifact(collectorPathB, collectorB);
  assert.equal(readFileSync(collectorPathA, "utf8"), collectorA);
  assert.equal(readFileSync(collectorPathB, "utf8"), collectorB);

  const collectorEventsPathA = path.join(
    dir,
    canaryCollectorEventsEvidenceFilename(collectorEventsA),
  );
  const collectorEventsPathB = path.join(
    dir,
    canaryCollectorEventsEvidenceFilename(collectorEventsB),
  );
  assert.equal(
    writeImmutableCanaryArtifact(collectorEventsPathA, collectorEventsA)
      .created,
    true,
  );
  assert.equal(
    writeImmutableCanaryArtifact(collectorEventsPathA, collectorEventsA)
      .created,
    false,
  );
  assert.throws(
    () => writeImmutableCanaryArtifact(collectorEventsPathA, collectorEventsB),
    /Refusing to overwrite immutable canary artifact/,
  );
  writeImmutableCanaryArtifact(collectorEventsPathB, collectorEventsB);
  assert.equal(readFileSync(collectorEventsPathA, "utf8"), collectorEventsA);
  assert.equal(readFileSync(collectorEventsPathB, "utf8"), collectorEventsB);

  const recordA = {
    version: "26.7.900-dev",
    windowStart: "2026-07-09T00:00:00.000Z",
    windowEnd: "2026-07-10T00:00:00.000Z",
    sourceEvidence: {
      runtimeHealth: { file: canaryEvidenceFilename(runtimeA) },
    },
  };
  const recordB = {
    ...recordA,
    sourceEvidence: {
      runtimeHealth: { file: canaryEvidenceFilename(runtimeB) },
    },
  };
  assert.notEqual(canaryRecordFilename(recordA), canaryRecordFilename(recordB));
  const recordPathA = path.join(dir, canaryRecordFilename(recordA));
  const recordPathB = path.join(dir, canaryRecordFilename(recordB));
  writeImmutableCanaryArtifact(recordPathA, canaryRecordText(recordA));
  assert.equal(
    writeImmutableCanaryArtifact(recordPathA, canaryRecordText(recordA))
      .created,
    false,
  );
  assert.throws(
    () => writeImmutableCanaryArtifact(recordPathA, canaryRecordText(recordB)),
    /Refusing to overwrite immutable canary artifact/,
  );
  writeImmutableCanaryArtifact(recordPathB, canaryRecordText(recordB));
  assert.equal(readFileSync(recordPathA, "utf8"), canaryRecordText(recordA));
  assert.equal(readFileSync(recordPathB, "utf8"), canaryRecordText(recordB));
});

test("trailing ledger loads newest-last and excludes the version being judged", () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "freed-canary-ledger-"));
  for (const [index, version] of ["1.0.0", "1.0.1", "1.0.2"].entries()) {
    writeCanaryEvidenceBundle(
      dir,
      createCanaryEvidenceFixture({
        startMs: Date.parse("2026-07-01T00:00:00Z") + index * 24 * 60 * 60_000,
        version,
        commitSha: String(index + 1).repeat(40),
      }),
    );
  }
  const trailing = loadTrailingSummaries(dir, "1.0.2", 7);
  assert.deepEqual(
    trailing.map((s) => s.version),
    ["1.0.0", "1.0.1"],
  );
});

// ---------------------------------------------------------------------------
// bisect-regression
// ---------------------------------------------------------------------------

test("versionToTag normalizes bare versions and passes tags through", () => {
  assert.equal(versionToTag("26.7.301-dev"), "v26.7.301-dev");
  assert.equal(versionToTag("v26.7.800-dev"), "v26.7.800-dev");
});

test("metricFromVerdict reads assertion status and numeric extractions", () => {
  const verdict = {
    spanHours: 6,
    sourceHealth: { cloudEligibleHours: 5 },
    assertions: [
      {
        id: "uploads_unchanged_heads",
        status: "fail",
        detail:
          "98 of 102 uploads had unchanged heads (cloud loop signature, F01/F06).",
      },
      {
        id: "invariant_alarms",
        status: "pass",
        detail: "8 invariant_alarm events (cloud_loop=7, preflight_kill=1).",
      },
      { id: "renderer_recoveries", status: "pass", detail: "0 events." },
    ],
  };
  assert.equal(metricFromVerdict(verdict, "renderer_recoveries"), 0);
  assert.equal(metricFromVerdict(verdict, "uploads_unchanged_heads"), 1);
  assert.equal(metricFromVerdict(verdict, "alarms_total"), 8);
  assert.ok(
    Math.abs(
      metricFromVerdict(verdict, "uploads_unchanged_per_hour") - 98 / 5,
    ) < 1e-9,
  );
  assert.equal(
    metricFromVerdict(
      { ...verdict, sourceHealth: { cloudEligibleHours: null } },
      "uploads_unchanged_per_hour",
    ),
    null,
  );
  assert.throws(() => metricFromVerdict(verdict, "no_such_metric"));
});

test("predicate exit codes follow git-bisect semantics", () => {
  assert.equal(predicateExitCode(0, 0), 0);
  assert.equal(predicateExitCode(3, 5), 0);
  assert.equal(predicateExitCode(6, 5), 1);
  assert.equal(predicateExitCode(null, 5), 125);
});

test("bisect plan stays plan-only until every commit is built and installed", () => {
  const plan = buildBisectPlan({
    metric: "uploads_unchanged_per_hour",
    goodVersion: "26.7.301-dev",
    badVersion: "26.7.800-dev",
    threshold: 5,
    soakMinutes: 90,
  });
  assert.equal(plan.goodTag, "v26.7.301-dev");
  assert.equal(plan.badTag, "v26.7.800-dev");
  assert.equal(plan.executionSupported, false);
  assert.ok(
    plan.blockers.some((blocker) => blocker.includes("installed app reports")),
  );
  assert.ok(plan.blockers.some((blocker) => blocker.includes("restore")));
});

test("runtime bisect execution flags fail closed", () => {
  assert.throws(
    () => parseBisectArgs(["--execute"]),
    /disabled until bisect-regression builds/,
  );
  assert.throws(
    () => parseBisectArgs(["--predicate"]),
    /disabled until bisect-regression builds/,
  );
});
