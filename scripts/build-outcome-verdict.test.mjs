import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  buildOutcomeVerdictFromArtifacts,
  parseArgs,
  validateOutcomeVerdictProvenance,
} from "./build-outcome-verdict.mjs";
import {
  compareCanarySummary,
  computeCanarySummary,
  parseRuntimeHealthEvidenceText,
} from "./canary-summarize.mjs";
import { buildCanaryObservationContext } from "./canary-context.mjs";
import {
  COLLECTOR_EVENTS_SCHEMA_VERSION,
  collectorEventEvidenceDeclaration,
  METRICS_COLUMNS,
  SOAK_SCHEMA_VERSION,
} from "./soak-collect.mjs";
import {
  buildCompositeEvidenceFingerprint,
  collectorEventsEvidenceFingerprint,
  collectorMetricsEvidenceFingerprint,
  computeCollectorEventCoverage,
  computeRuntimeHealthCoverage,
  parseCollectorEventsJsonl,
  parseMetricsTsv,
  rebuildStoredSoakVerdict,
  runtimeHealthEvidenceFingerprint,
} from "./soak-assert.mjs";

const MB = 1024 * 1024;
const __dirname = path.dirname(fileURLToPath(import.meta.url));

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

function metricsText(rows) {
  return `${[
    METRICS_COLUMNS.join("\t"),
    ...rows.map((row) =>
      METRICS_COLUMNS.map((column) => row[column] ?? 0).join("\t"),
    ),
  ].join("\n")}\n`;
}

function writeStoredSoak(
  root,
  {
    name,
    start,
    commitSha,
    version,
    slopeMbPerHour,
    artifactDigest = "",
    durationHours = 5,
    comparisonContext = {},
  },
) {
  const soakDir = path.join(root, name);
  mkdirSync(soakDir, { recursive: true });
  const identity = {
    appVersion: version,
    buildCommitSha: commitSha,
    channel: "dev",
    appSessionId: `session-${name}`,
  };
  const end = start + durationHours * 60 * 60_000;
  const heartbeatCount = Math.floor(durationHours * 60) + 1;
  const health = [
    ...Array.from({ length: heartbeatCount }, (_, index) => ({
      ...identity,
      event: "renderer_heartbeat",
      tsMs: start + index * 60_000,
      nativeFootprintBytes: (500 + slopeMbPerHour * (index / 60)) * MB,
    })),
    {
      ...identity,
      event: "native_runtime_memory_sample",
      tsMs: start + 100,
      appResidentBytes: 500 * MB,
      webkitLargestResidentBytes: 100 * MB,
    },
    {
      ...identity,
      event: "native_runtime_memory_sample",
      tsMs: end - 100,
      appResidentBytes: 500 * MB,
      webkitLargestResidentBytes: 100 * MB,
    },
    {
      ...identity,
      event: "cloud_sync_coverage",
      tsMs: end,
      connected: true,
      eligible: true,
      intervalStartMs: start,
      intervalEndMs: end,
    },
    {
      ...identity,
      event: "window_destroyed",
      tsMs: end - 2,
      reasonEnum: "job_complete",
      label: "facebook-scraper",
      scraperSessionHeld: false,
    },
    {
      ...identity,
      event: "scrape_outcome",
      tsMs: end - 1,
      itemsExtracted: 0,
      itemsNovel: 0,
      itemsPersisted: 0,
    },
  ];
  const rows = Array.from(
    { length: Math.floor(durationHours * 60) + 1 },
    (_, index) => ({
      tsMs: start + index * 60_000,
      iso: new Date(start + index * 60_000).toISOString(),
      appPid: 123,
      appRssKb: 500 * 1024,
      webkitWebContentCount: 4,
      webkitWebContentRssKb: 400 * 1024,
      webkitLargestRssKb: 100 * 1024,
      webkitOtherRssKb: 20 * 1024,
      healthFileBytes: 1,
      healthFileLines: health.length,
    }),
  );
  writeFileSync(path.join(soakDir, "metrics.tsv"), metricsText(rows));
  writeFileSync(
    path.join(soakDir, "runtime-health.jsonl"),
    `${health.map((entry) => JSON.stringify(entry)).join("\n")}\n`,
  );
  writeFileSync(
    path.join(soakDir, "collector-events.jsonl"),
    closedCollectorSessionEventsText(start, end, `collector-run-${name}`),
  );
  writeFileSync(
    path.join(soakDir, "soak-info.json"),
    `${JSON.stringify({
      schemaVersion: SOAK_SCHEMA_VERSION,
      collectorSessionId: `collector-${name}`,
      intervalSeconds: 60,
      collectorEvents: collectorEventEvidenceDeclaration(),
      ...(artifactDigest ? { artifactDigest } : {}),
      comparisonContext: {
        scenario: comparisonContext.scenario ?? "idle",
        providerCohort:
          comparisonContext.providerCohort ??
          "social-authenticated-gdrive-connected",
        documentSizeBucket: comparisonContext.documentSizeBucket ?? "medium",
        host: {
          platform: comparisonContext.host?.platform ?? "darwin",
          architecture: comparisonContext.host?.architecture ?? "arm64",
          memoryTierGiB: comparisonContext.host?.memoryTierGiB ?? 64,
        },
      },
    })}\n`,
  );
  const verdict = rebuildStoredSoakVerdict(soakDir);
  const verdictPath = path.join(soakDir, "soak-verdict.json");
  writeFileSync(verdictPath, `${JSON.stringify(verdict, null, 2)}\n`);
  return {
    verdict,
    verdictPath,
    healthPath: path.join(soakDir, "runtime-health.jsonl"),
    metricsPath: path.join(soakDir, "metrics.tsv"),
  };
}

function canaryFromStoredSoak(stored, installId) {
  const context = buildCanaryObservationContext({
    verdict: stored.verdict,
    installId,
    installedAt: new Date(
      Date.parse(stored.verdict.windowStart) - 60_000,
    ).toISOString(),
  });
  const evidenceText = readFileSync(stored.healthPath, "utf8");
  const entries = parseRuntimeHealthEvidenceText(
    evidenceText,
    stored.healthPath,
  );
  const summary = computeCanarySummary(entries, {
    observationContext: context,
    windowStartMs: Date.parse(context.windowStart),
    windowEndMs: Date.parse(context.windowEnd),
  });
  return {
    entries,
    summary,
    collectorMetricsText: readFileSync(stored.metricsPath, "utf8"),
    collectorEventsText: readFileSync(
      path.join(path.dirname(stored.verdictPath), "collector-events.jsonl"),
      "utf8",
    ),
  };
}

function attributedCanary({
  recoveries = 0,
  start = Date.parse("2026-07-10T00:00:00.000Z"),
  version = "26.7.100-dev",
  commitSha = "c".repeat(40),
  artifactDigest = "",
} = {}) {
  const end = start + 24 * 60 * 60_000;
  const build = {
    version,
    commitSha,
    channel: "dev",
    ...(artifactDigest ? { artifactDigest } : {}),
    installId: `install-${version}`,
    installedAt: new Date(start - 60_000).toISOString(),
  };
  const runtime = {
    collectorSessionId: `collector-${version}`,
    appPid: 321,
    appSessionId: `session-${version}`,
  };
  const identity = {
    appVersion: build.version,
    buildCommitSha: build.commitSha,
    channel: build.channel,
    appSessionId: runtime.appSessionId,
  };
  const entries = [
    ...Array.from({ length: 1_441 }, (_, index) => ({
      ...identity,
      event: "renderer_heartbeat",
      tsMs: start + index * 60_000,
    })),
    {
      ...identity,
      event: "native_runtime_memory_sample",
      tsMs: start + 100,
      appResidentBytes: 500 * MB,
      webkitLargestResidentBytes: 100 * MB,
    },
    ...Array.from({ length: recoveries }, (_, index) => ({
      ...identity,
      event: "renderer_recovery_restart_requested",
      tsMs: start + (index + 1) * 1_000,
    })),
    {
      ...identity,
      event: "native_runtime_memory_sample",
      tsMs: end - 100,
      appResidentBytes: 500 * MB,
      webkitLargestResidentBytes: 100 * MB,
    },
    {
      ...identity,
      event: "cloud_sync_coverage",
      tsMs: end,
      connected: true,
      eligible: true,
      intervalStartMs: start,
      intervalEndMs: end,
    },
  ].sort((left, right) => left.tsMs - right.tsMs);
  Object.defineProperty(entries, "sourceDiagnostics", {
    value: {
      malformedLines: [],
      rawRecords: entries.map((entry) => JSON.stringify(entry)),
      sourceLineCount: entries.length,
    },
    enumerable: false,
  });
  const sampleCount = 1_441;
  const collectorMetricsText = metricsText(
    Array.from({ length: sampleCount }, (_, index) => ({
      tsMs: start + index * 60_000,
      iso: new Date(start + index * 60_000).toISOString(),
      appPid: runtime.appPid,
      appRssKb: 500 * 1024,
      webkitWebContentCount: 4,
      webkitWebContentRssKb: 400 * 1024,
      webkitLargestRssKb: 100 * 1024,
      webkitOtherRssKb: 20 * 1024,
      healthFileBytes: 1,
      healthFileLines: entries.length,
    })),
  );
  const runtimeHealthCoverage = computeRuntimeHealthCoverage(
    entries.map((entry) => ({ entry })),
    parseMetricsTsv(collectorMetricsText),
  );
  const collectorEventsText = closedCollectorSessionEventsText(
    start,
    end,
    `collector-run-${version}`,
  );
  const collectorEventCoverage = computeCollectorEventCoverage(
    parseCollectorEventsJsonl(collectorEventsText),
    { requireClosedSession: true },
  );
  const sourceHealth = {
    status: "healthy",
    appAliveHours: 24,
    appAliveRatio: 1,
    collectorSampleCount: sampleCount,
    collectorDistinctSampleCount: sampleCount,
    expectedSampleCount: sampleCount,
    sampleDensity: 1,
    collectorSpanHours: 24,
    expectedIntervalMs: 60_000,
    maxCreditedGapMs: 150_000,
    largestObservedGapMs: 60_000,
    creditedIntervalCount: 1,
    collectorHeaderHealthy: true,
    collectorMalformedRowCount: 0,
    ...collectorEventCoverage,
    collectorEventEvidenceCapable: true,
    collectorEventEvidencePresent: true,
    collectorEventEvidenceSchemaVersion: COLLECTOR_EVENTS_SCHEMA_VERSION,
    runtimeHealthMalformedLineCount: 0,
    ...runtimeHealthCoverage,
    cloudEligibleHours: 24,
  };
  sourceHealth.evidenceFingerprint = buildCompositeEvidenceFingerprint({
    runtimeHealthFingerprint: runtimeHealthEvidenceFingerprint(entries),
    collectorMetricsFingerprint:
      collectorMetricsEvidenceFingerprint(collectorMetricsText),
    collectorEventsFingerprint:
      collectorEventsEvidenceFingerprint(collectorEventsText),
    sourceHealth,
    runtimeAttribution: {
      collectorSessionId: runtime.collectorSessionId,
      appPid: runtime.appPid,
      ...identity,
      ...(artifactDigest ? { artifactDigest } : {}),
    },
  });
  const summary = computeCanarySummary(entries, {
    observationContext: {
      schemaVersion: 3,
      build,
      runtime,
      workload: {
        scenario: "idle",
        providerCohort: "social-authenticated-gdrive-connected",
        documentSizeBucket: "medium",
      },
      host: { platform: "darwin", architecture: "arm64", memoryTierGiB: 64 },
      sourceHealth,
      windowStart: new Date(start).toISOString(),
      windowEnd: new Date(end).toISOString(),
    },
    windowStartMs: start,
    windowEndMs: end,
  });
  return { entries, summary, collectorMetricsText, collectorEventsText };
}

function writeCanaryRecord(root, fixture, comparison = null) {
  const evidenceText = `${fixture.entries.map((entry) => JSON.stringify(entry)).join("\n")}\n`;
  const collectorEventsText = fixture.collectorEventsText ?? "";
  const evidenceFile = `canary-evidence-${randomUUID()}.jsonl`;
  writeFileSync(path.join(root, evidenceFile), evidenceText);
  const collectorEvidenceFile = `canary-collector-${randomUUID()}.tsv`;
  const collectorEventsFile = `canary-collector-events-${randomUUID()}.jsonl`;
  writeFileSync(
    path.join(root, collectorEvidenceFile),
    fixture.collectorMetricsText,
  );
  writeFileSync(path.join(root, collectorEventsFile), collectorEventsText);
  const record = {
    ...fixture.summary,
    sourceEvidence: {
      runtimeHealth: {
        file: evidenceFile,
        digest: createHash("sha256").update(evidenceText).digest("hex"),
        format: "runtime-health-jsonl",
      },
      collectorMetrics: {
        file: collectorEvidenceFile,
        digest: createHash("sha256")
          .update(fixture.collectorMetricsText)
          .digest("hex"),
        format: "collector-metrics-tsv",
      },
      collectorEvents: {
        file: collectorEventsFile,
        digest: createHash("sha256").update(collectorEventsText).digest("hex"),
        format: "collector-events-jsonl",
      },
    },
    ...(comparison
      ? {
          comparison,
          regressions: comparison.regressions,
          trailingCompared: comparison.comparableWindows,
        }
      : {}),
  };
  const file = `canary-${randomUUID()}.json`;
  const recordPath = path.join(root, file);
  const text = `${JSON.stringify(record, null, 2)}\n`;
  writeFileSync(recordPath, text);
  return {
    record,
    recordPath,
    sourceReference: {
      file,
      digest: createHash("sha256").update(text).digest("hex"),
    },
  };
}

test("parseArgs accepts only evidence-derived effect inputs", () => {
  const args = parseArgs([
    "--soak-verdict",
    "/tmp/soak.json",
    "--task-id",
    "P1-01",
    "--outcome",
    "verified_effective",
    "--metric",
    "main-footprint-slope",
    "--baseline-reference",
    "/tmp/baseline.json",
    "--out",
    "/tmp/outcome.json",
  ]);
  assert.equal(args.metric, "main-footprint-slope");
  assert.throws(
    () =>
      parseArgs([
        "--soak-verdict",
        "/tmp/soak.json",
        "--task-id",
        "P1-01",
        "--outcome",
        "verified_effective",
        "--metric",
        "main-footprint-slope",
        "--baseline-reference",
        "/tmp/baseline.json",
        "--before",
        "100",
        "--out",
        "/tmp/outcome.json",
      ]),
    /Unknown argument: --before/,
  );
  assert.throws(
    () =>
      parseArgs([
        "--canary-verdict",
        "/tmp/canary.json",
        "--task-id",
        "P1-01",
        "--outcome",
        "verified_effective",
        "--metric",
        "recoveriesPerDay",
        "--out",
        "/tmp/outcome.json",
      ]),
    /no regression, not verified effectiveness/,
  );
});

test("soak outcome derives its effect and tolerance from stored artifacts", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "freed-outcome-verdict-"));
  const baseline = writeStoredSoak(root, {
    name: "baseline",
    start: Date.parse("2026-07-09T00:00:00.000Z"),
    commitSha: "a".repeat(40),
    version: "26.7.900-dev",
    slopeMbPerHour: 30,
  });
  const current = writeStoredSoak(root, {
    name: "current",
    start: Date.parse("2026-07-10T00:00:00.000Z"),
    commitSha: "b".repeat(40),
    version: "26.7.1000-dev",
    slopeMbPerHour: 4,
  });
  assert.equal(
    current.verdict.status,
    "pass",
    JSON.stringify(
      current.verdict.assertions.map(({ id, status }) => ({ id, status })),
    ),
  );
  const verdict = buildOutcomeVerdictFromArtifacts({
    sourcePath: current.verdictPath,
    sourceKind: "soak",
    taskId: "P1-01",
    outcome: "verified_effective",
    metric: "main-footprint-slope",
    baselineReference: baseline.verdictPath,
  });
  assert.ok(Math.abs(verdict.effect.before - 30) < 1e-9);
  assert.ok(Math.abs(verdict.effect.after - 4) < 1e-9);
  assert.equal(verdict.effect.unit, "MB/sample-hour");
  assert.equal(verdict.effectAssessment.direction, "lower");
  assert.equal(verdict.effectAssessment.tolerance, 2);
  assert.equal(verdict.buildIdentity.commitSha, "b".repeat(40));
  assert.doesNotThrow(() => validateOutcomeVerdictProvenance(verdict));
});

test("soak outcomes reject mismatched workload, host, and observation duration", () => {
  const root = mkdtempSync(
    path.join(os.tmpdir(), "freed-outcome-comparability-"),
  );
  const current = writeStoredSoak(root, {
    name: "current",
    start: Date.parse("2026-07-10T00:00:00.000Z"),
    commitSha: "b".repeat(40),
    version: "26.7.1000-dev",
    slopeMbPerHour: 4,
  });
  const mismatchedProvider = writeStoredSoak(root, {
    name: "provider-mismatch",
    start: Date.parse("2026-07-09T00:00:00.000Z"),
    commitSha: "a".repeat(40),
    version: "26.7.900-dev",
    slopeMbPerHour: 30,
    comparisonContext: { providerCohort: "gdrive-only" },
  });
  const mismatchedHost = writeStoredSoak(root, {
    name: "host-mismatch",
    start: Date.parse("2026-07-08T00:00:00.000Z"),
    commitSha: "c".repeat(40),
    version: "26.7.800-dev",
    slopeMbPerHour: 30,
    comparisonContext: { host: { memoryTierGiB: 32 } },
  });
  const mismatchedDuration = writeStoredSoak(root, {
    name: "duration-mismatch",
    start: Date.parse("2026-07-07T00:00:00.000Z"),
    commitSha: "d".repeat(40),
    version: "26.7.700-dev",
    slopeMbPerHour: 30,
    durationHours: 2,
  });
  const build = (baselineReference) =>
    buildOutcomeVerdictFromArtifacts({
      sourcePath: current.verdictPath,
      sourceKind: "soak",
      taskId: "P1-01",
      outcome: "verified_effective",
      metric: "main-footprint-slope",
      baselineReference,
    });
  assert.throws(
    () => build(mismatchedProvider.verdictPath),
    /workload, provider cohort, document size, and host must match/,
  );
  assert.throws(
    () => build(mismatchedHost.verdictPath),
    /workload, provider cohort, document size, and host must match/,
  );
  assert.throws(
    () => build(mismatchedDuration.verdictPath),
    /windows must have comparable duration/,
  );
});

test("artifact identity survives the soak, canary, and outcome chain", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "freed-artifact-chain-"));
  const dayMs = 24 * 60 * 60_000;
  const currentStart = Date.parse("2026-07-10T00:00:00.000Z");
  const stored = [3, 2, 1, 0].map((daysAgo, index) =>
    writeStoredSoak(root, {
      name: daysAgo === 0 ? "current" : `baseline-${daysAgo.toLocaleString()}`,
      start: currentStart - daysAgo * dayMs,
      commitSha: String(index + 1).repeat(40),
      version: `26.7.${(700 + index).toLocaleString()}-dev`,
      slopeMbPerHour: 4,
      artifactDigest: String.fromCharCode(98 + index).repeat(64),
    }),
  );
  const baselineRecords = stored.slice(0, 3).map((soak, index) => {
    const fixture = canaryFromStoredSoak(
      soak,
      `install-baseline-${index.toLocaleString()}`,
    );
    const written = writeCanaryRecord(root, fixture);
    return { ...written.record, sourceReference: written.sourceReference };
  });
  const currentFixture = canaryFromStoredSoak(stored[3], "install-current");
  assert.equal(currentFixture.summary.evidenceAttribution.status, "matched");
  assert.equal(
    currentFixture.summary.evidenceAttribution.identity.artifactDigest,
    stored[3].verdict.runtimeIdentity.artifactDigest,
  );
  const comparison = compareCanarySummary(
    currentFixture.summary,
    baselineRecords,
  );
  assert.equal(comparison.status, "pass");
  const source = writeCanaryRecord(root, currentFixture, comparison);
  const verdict = buildOutcomeVerdictFromArtifacts({
    sourcePath: source.recordPath,
    sourceKind: "canary",
    taskId: "P1-04",
    outcome: "verified_neutral",
    metric: "recoveriesPerDay",
  });
  assert.equal(
    verdict.buildIdentity.artifactDigest,
    stored[3].verdict.runtimeIdentity.artifactDigest,
  );
  assert.equal(verdict.effect.before, 0);
  assert.equal(verdict.effect.after, 0);
});

test("provenance validation rejects hand-written wrappers and altered raw evidence", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "freed-outcome-tamper-"));
  const baseline = writeStoredSoak(root, {
    name: "baseline",
    start: Date.parse("2026-07-08T00:00:00.000Z"),
    commitSha: "a".repeat(40),
    version: "26.7.800-dev",
    slopeMbPerHour: 30,
  });
  const current = writeStoredSoak(root, {
    name: "current",
    start: Date.parse("2026-07-09T00:00:00.000Z"),
    commitSha: "b".repeat(40),
    version: "26.7.900-dev",
    slopeMbPerHour: 4,
  });
  assert.equal(
    current.verdict.status,
    "pass",
    JSON.stringify(
      current.verdict.assertions.map(({ id, status }) => ({ id, status })),
    ),
  );
  const verdict = buildOutcomeVerdictFromArtifacts({
    sourcePath: current.verdictPath,
    sourceKind: "soak",
    taskId: "P1-01",
    outcome: "verified_effective",
    metric: "main-footprint-slope",
    baselineReference: baseline.verdictPath,
  });
  const handwritten = structuredClone(verdict);
  handwritten.effect.after = 1;
  handwritten.effect.delta =
    handwritten.effect.after - handwritten.effect.before;
  assert.throws(
    () => validateOutcomeVerdictProvenance(handwritten),
    /semantics do not match/,
  );

  const alteredRaw = JSON.parse(readFileSync(current.verdictPath, "utf8"));
  alteredRaw.measurements["main-footprint-slope"].value = 1;
  writeFileSync(
    current.verdictPath,
    `${JSON.stringify(alteredRaw, null, 2)}\n`,
  );
  assert.throws(
    () =>
      buildOutcomeVerdictFromArtifacts({
        sourcePath: current.verdictPath,
        sourceKind: "soak",
        taskId: "P1-01",
        outcome: "verified_effective",
        metric: "main-footprint-slope",
        baselineReference: baseline.verdictPath,
      }),
    /does not match the stored collector artifacts/,
  );
});

test("canary outcome derives current value, unit, direction, and limit from the registry", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "freed-canary-outcome-"));
  const dayMs = 24 * 60 * 60_000;
  const current = attributedCanary({ recoveries: 3 });
  const baselines = [1, 2, 3].map((daysAgo, index) => {
    const fixture = attributedCanary({
      recoveries: 0,
      start: Date.parse("2026-07-10T00:00:00.000Z") - daysAgo * dayMs,
      version: `26.7.${(96 + index).toLocaleString()}-dev`,
      commitSha: String(index + 3).repeat(40),
    });
    const written = writeCanaryRecord(root, fixture);
    return { ...written.record, sourceReference: written.sourceReference };
  });
  const comparison = compareCanarySummary(current.summary, baselines);
  assert.equal(comparison.status, "regression");
  const source = writeCanaryRecord(root, current, comparison);
  const verdict = buildOutcomeVerdictFromArtifacts({
    sourcePath: source.recordPath,
    sourceKind: "canary",
    taskId: "P1-04",
    outcome: "regressed",
    metric: "recoveriesPerDay",
  });
  assert.deepEqual(verdict.effect, {
    metric: "recoveriesPerDay",
    before: 0,
    after: 3,
    delta: 3,
    unit: "events/app-alive-day",
  });
  assert.equal(verdict.effectAssessment.direction, "lower");
  assert.equal(verdict.effectAssessment.comparisonLimit, 2);
  assert.equal(
    verdict.evidenceFingerprint.coverage.runtimeHealthCoverageHealthy,
    true,
  );
  assert.equal(
    verdict.evidenceFingerprint.coverage.runtimeHealthDistinctSampleCount,
    current.summary.sourceHealth.runtimeHealthDistinctSampleCount,
  );

  const baselineRuntimePath = path.join(
    root,
    baselines[0].sourceEvidence.runtimeHealth.file,
  );
  const baselineRuntimeText = readFileSync(baselineRuntimePath, "utf8");
  writeFileSync(baselineRuntimePath, `${baselineRuntimeText}{"truncated":`);
  assert.throws(
    () =>
      buildOutcomeVerdictFromArtifacts({
        sourcePath: source.recordPath,
        sourceKind: "canary",
        taskId: "P1-04",
        outcome: "regressed",
        metric: "recoveriesPerDay",
      }),
    /baseline|runtime source evidence digest/i,
  );
  writeFileSync(baselineRuntimePath, baselineRuntimeText);

  const collectorPath = path.join(
    root,
    source.record.sourceEvidence.collectorMetrics.file,
  );
  const collectorText = readFileSync(collectorPath, "utf8");
  const alteredCollectorLines = collectorText.trimEnd().split("\n");
  const alteredColumns = alteredCollectorLines[720].split("\t");
  alteredColumns[2] = "0";
  alteredCollectorLines[720] = alteredColumns.join("\t");
  const alteredCollectorText = `${alteredCollectorLines.join("\n")}\n`;
  const denominatorTamper = structuredClone(source.record);
  denominatorTamper.sourceEvidence.collectorMetrics.digest = createHash(
    "sha256",
  )
    .update(alteredCollectorText)
    .digest("hex");
  writeFileSync(collectorPath, alteredCollectorText);
  writeFileSync(
    source.recordPath,
    `${JSON.stringify(denominatorTamper, null, 2)}\n`,
  );
  assert.throws(
    () =>
      buildOutcomeVerdictFromArtifacts({
        sourcePath: source.recordPath,
        sourceKind: "canary",
        taskId: "P1-04",
        outcome: "regressed",
        metric: "recoveriesPerDay",
      }),
    /raw collector evidence|evidence fingerprint/,
  );
  writeFileSync(collectorPath, collectorText);
  writeFileSync(
    source.recordPath,
    `${JSON.stringify(source.record, null, 2)}\n`,
  );

  const runtimePath = path.join(
    root,
    source.record.sourceEvidence.runtimeHealth.file,
  );
  const runtimeText = readFileSync(runtimePath, "utf8");
  const thinRuntimeText = `${runtimeText
    .trimEnd()
    .split("\n")
    .filter((line) => JSON.parse(line).event !== "renderer_heartbeat")
    .join("\n")}\n`;
  const thinRuntimeRecord = structuredClone(source.record);
  thinRuntimeRecord.sourceEvidence.runtimeHealth.digest = createHash("sha256")
    .update(thinRuntimeText)
    .digest("hex");
  writeFileSync(runtimePath, thinRuntimeText);
  writeFileSync(
    source.recordPath,
    `${JSON.stringify(thinRuntimeRecord, null, 2)}\n`,
  );
  assert.throws(
    () =>
      buildOutcomeVerdictFromArtifacts({
        sourcePath: source.recordPath,
        sourceKind: "canary",
        taskId: "P1-04",
        outcome: "regressed",
        metric: "recoveriesPerDay",
      }),
    /runtimeHealthSampleCount does not match the raw collector evidence and runtime-health evidence/,
  );
  writeFileSync(runtimePath, runtimeText);
  writeFileSync(
    source.recordPath,
    `${JSON.stringify(source.record, null, 2)}\n`,
  );

  const tampered = structuredClone(source.record);
  tampered.comparison.metrics.recoveriesPerDay.current = 4;
  writeFileSync(source.recordPath, `${JSON.stringify(tampered, null, 2)}\n`);
  assert.throws(
    () =>
      buildOutcomeVerdictFromArtifacts({
        sourcePath: source.recordPath,
        sourceKind: "canary",
        taskId: "P1-04",
        outcome: "regressed",
        metric: "recoveriesPerDay",
      }),
    /does not match its verified trailing evidence cohort|matching registered comparison/,
  );
});

test("inconclusive lifecycle verdicts still require attributable nonempty evidence", () => {
  const root = mkdtempSync(
    path.join(os.tmpdir(), "freed-canary-inconclusive-"),
  );
  const fixture = attributedCanary();
  const comparison = compareCanarySummary(fixture.summary, []);
  const source = writeCanaryRecord(root, fixture, comparison);
  const verdict = buildOutcomeVerdictFromArtifacts({
    sourcePath: source.recordPath,
    sourceKind: "canary",
    taskId: "P1-04",
    outcome: "inconclusive",
  });
  assert.equal(verdict.status, "inconclusive");
  const tampered = structuredClone(source.record);
  tampered.evidenceAttribution.status = "mixed";
  writeFileSync(source.recordPath, `${JSON.stringify(tampered, null, 2)}\n`);
  assert.throws(
    () =>
      buildOutcomeVerdictFromArtifacts({
        sourcePath: source.recordPath,
        sourceKind: "canary",
        taskId: "P1-04",
        outcome: "inconclusive",
      }),
    /raw evidence bundle|attributable, nonempty/,
  );
});

test("legacy soaks without collector-event capability cannot close as lifecycle inconclusive", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "freed-soak-legacy-events-"));
  const stored = writeStoredSoak(root, {
    name: "legacy-events",
    start: Date.parse("2026-07-10T00:00:00.000Z"),
    commitSha: "e".repeat(40),
    version: "26.7.1000-dev",
    slopeMbPerHour: 4,
  });
  const soakDir = path.dirname(stored.verdictPath);
  const infoPath = path.join(soakDir, "soak-info.json");
  const info = JSON.parse(readFileSync(infoPath, "utf8"));
  info.schemaVersion = 2;
  delete info.collectorEvents;
  writeFileSync(infoPath, `${JSON.stringify(info, null, 2)}\n`);
  const legacyVerdict = rebuildStoredSoakVerdict(soakDir);
  writeFileSync(
    stored.verdictPath,
    `${JSON.stringify(legacyVerdict, null, 2)}\n`,
  );

  assert.equal(legacyVerdict.status, "inconclusive");
  assert.equal(legacyVerdict.sourceHealth.collectorEventEvidenceCapable, false);
  assert.throws(
    () =>
      buildOutcomeVerdictFromArtifacts({
        sourcePath: stored.verdictPath,
        sourceKind: "soak",
        taskId: "W1-02",
        outcome: "inconclusive",
      }),
    /cannot become a lifecycle outcome without capability-declared, present/,
  );

  const openStored = writeStoredSoak(root, {
    name: "open-events",
    start: Date.parse("2026-07-11T00:00:00.000Z"),
    commitSha: "f".repeat(40),
    version: "26.7.1100-dev",
    slopeMbPerHour: 4,
  });
  const openSoakDir = path.dirname(openStored.verdictPath);
  writeFileSync(
    path.join(openSoakDir, "collector-events.jsonl"),
    `${JSON.stringify({
      schemaVersion: COLLECTOR_EVENTS_SCHEMA_VERSION,
      event: "collector_sample_failed",
      tsMs: Date.parse("2026-07-11T01:00:00.000Z"),
      failedSamples: 1,
      sampleMayBePartial: true,
      errorMessage: "sample incomplete",
    })}\n`,
  );
  const openVerdict = rebuildStoredSoakVerdict(openSoakDir);
  writeFileSync(
    openStored.verdictPath,
    `${JSON.stringify(openVerdict, null, 2)}\n`,
  );
  assert.equal(openVerdict.sourceHealth.collectorOutageOpen, true);
  assert.throws(
    () =>
      buildOutcomeVerdictFromArtifacts({
        sourcePath: openStored.verdictPath,
        sourceKind: "soak",
        taskId: "W1-02",
        outcome: "inconclusive",
      }),
    /cannot become a lifecycle outcome without capability-declared, present, closed/,
  );
});

test("generated canary records remain verifiable after moving their evidence bundle", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "freed-canary-portable-"));
  const stored = writeStoredSoak(root, {
    name: "portable",
    start: Date.parse("2026-07-10T00:00:00.000Z"),
    commitSha: "f".repeat(40),
    version: "26.7.1000-dev",
    slopeMbPerHour: 4,
    artifactDigest: "e".repeat(64),
  });
  const context = buildCanaryObservationContext({
    verdict: stored.verdict,
    installId: "install-portable",
    installedAt: "2026-07-09T23:59:00.000Z",
  });
  const contextPath = path.join(root, "canary-context.json");
  writeFileSync(contextPath, `${JSON.stringify(context, null, 2)}\n`);
  const appData = path.join(root, "app-data");
  mkdirSync(appData);
  writeFileSync(
    path.join(appData, "runtime-health.jsonl"),
    readFileSync(stored.healthPath, "utf8"),
  );
  const ledger = path.join(root, "ledger");
  execFileSync(
    process.execPath,
    [
      path.join(__dirname, "canary-summarize.mjs"),
      "--context",
      contextPath,
      "--collector-metrics",
      stored.metricsPath,
      "--app-data",
      appData,
      "--ledger-dir",
      ledger,
    ],
    { encoding: "utf8" },
  );
  const recordFile = readdirSync(ledger).find((name) =>
    /^canary-.+\.json$/.test(name),
  );
  assert.ok(recordFile);
  const record = JSON.parse(
    readFileSync(path.join(ledger, recordFile), "utf8"),
  );
  assert.ok(record.sourceEvidence.runtimeHealth.file);
  assert.ok(record.sourceEvidence.collectorMetrics.file);
  assert.ok(record.sourceEvidence.collectorEvents.file);
  const movedLedger = path.join(root, "moved-ledger");
  renameSync(ledger, movedLedger);
  const verdict = buildOutcomeVerdictFromArtifacts({
    sourcePath: path.join(movedLedger, recordFile),
    sourceKind: "canary",
    taskId: "P1-04",
    outcome: "inconclusive",
  });
  assert.equal(verdict.status, "inconclusive");
  assert.equal(verdict.buildIdentity.artifactDigest, "e".repeat(64));
});
