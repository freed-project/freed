import { createHash, randomUUID } from "node:crypto";
import { writeFileSync } from "node:fs";
import path from "node:path";

import {
  compareCanarySummary,
  computeCanarySummary,
} from "../canary-summarize.mjs";
import { METRICS_COLUMNS } from "../soak-collect.mjs";
import {
  buildCompositeEvidenceFingerprint,
  collectorMetricsEvidenceFingerprint,
  computeRuntimeHealthCoverage,
  parseMetricsTsv,
  runtimeHealthEvidenceFingerprint,
} from "../soak-assert.mjs";

const MB = 1024 * 1024;
const DAY_MS = 24 * 60 * 60_000;

function metricsText(rows) {
  return `${[
    METRICS_COLUMNS.join("\t"),
    ...rows.map((row) =>
      METRICS_COLUMNS.map((column) => row[column] ?? 0).join("\t"),
    ),
  ].join("\n")}\n`;
}

export function createCanaryEvidenceFixture({
  startMs,
  version,
  commitSha,
  recoveries = 0,
  workerInits = 0,
  scenario = "idle",
  providerCohort = "social-authenticated-gdrive-connected",
  documentSizeBucket = "medium",
  platform = "darwin",
  architecture = "arm64",
  memoryTierGiB = 64,
  artifactDigest = "",
} = {}) {
  const endMs = startMs + DAY_MS;
  const build = {
    version,
    commitSha,
    channel: "dev",
    ...(artifactDigest ? { artifactDigest } : {}),
    installId: `install-${version}-${randomUUID()}`,
    installedAt: new Date(startMs - 60_000).toISOString(),
  };
  const runtime = {
    collectorSessionId: `collector-${randomUUID()}`,
    appPid: 321,
    appSessionId: `session-${randomUUID()}`,
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
      tsMs: startMs + index * 60_000,
    })),
    {
      ...identity,
      event: "native_runtime_memory_sample",
      tsMs: startMs + 100,
      appResidentBytes: 500 * MB,
      webkitLargestResidentBytes: 100 * MB,
    },
    ...Array.from({ length: recoveries }, (_, index) => ({
      ...identity,
      event: "renderer_recovery_restart_requested",
      tsMs: startMs + (index + 1) * 1_000,
    })),
    ...Array.from({ length: workerInits }, (_, index) => ({
      ...identity,
      event: "worker_init",
      tsMs: startMs + (index + 1) * 2_000,
    })),
    {
      ...identity,
      event: "native_runtime_memory_sample",
      tsMs: endMs - 100,
      appResidentBytes: 500 * MB,
      webkitLargestResidentBytes: 100 * MB,
    },
    {
      ...identity,
      event: "cloud_sync_coverage",
      tsMs: endMs,
      connected: true,
      eligible: true,
      intervalStartMs: startMs,
      intervalEndMs: endMs,
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
  const collectorSampleCount = 1_441;
  const collectorMetricsText = metricsText(
    Array.from({ length: collectorSampleCount }, (_, index) => ({
      tsMs: startMs + index * 60_000,
      iso: new Date(startMs + index * 60_000).toISOString(),
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
  const sourceHealth = {
    status: "healthy",
    appAliveHours: 24,
    appAliveRatio: 1,
    collectorSampleCount,
    collectorDistinctSampleCount: collectorSampleCount,
    expectedSampleCount: collectorSampleCount,
    sampleDensity: 1,
    collectorSpanHours: 24,
    expectedIntervalMs: 60_000,
    maxCreditedGapMs: 150_000,
    largestObservedGapMs: 60_000,
    creditedIntervalCount: 1,
    collectorHeaderHealthy: true,
    collectorMalformedRowCount: 0,
    runtimeHealthMalformedLineCount: 0,
    ...runtimeHealthCoverage,
    cloudEligibleHours: 24,
  };
  sourceHealth.evidenceFingerprint = buildCompositeEvidenceFingerprint({
    runtimeHealthFingerprint: runtimeHealthEvidenceFingerprint(entries),
    collectorMetricsFingerprint:
      collectorMetricsEvidenceFingerprint(collectorMetricsText),
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
      schemaVersion: 2,
      build,
      runtime,
      workload: { scenario, providerCohort, documentSizeBucket },
      host: { platform, architecture, memoryTierGiB },
      sourceHealth,
      windowStart: new Date(startMs).toISOString(),
      windowEnd: new Date(endMs).toISOString(),
    },
    windowStartMs: startMs,
    windowEndMs: endMs,
  });
  return { entries, summary, collectorMetricsText };
}

export function writeCanaryEvidenceBundle(root, fixture, comparison = null) {
  const runtimeText = `${fixture.entries.map((entry) => JSON.stringify(entry)).join("\n")}\n`;
  const runtimeFile = `canary-evidence-${randomUUID()}.jsonl`;
  const collectorFile = `canary-collector-${randomUUID()}.tsv`;
  writeFileSync(path.join(root, runtimeFile), runtimeText);
  writeFileSync(path.join(root, collectorFile), fixture.collectorMetricsText);
  const record = {
    ...fixture.summary,
    sourceEvidence: {
      runtimeHealth: {
        file: runtimeFile,
        digest: createHash("sha256").update(runtimeText).digest("hex"),
        format: "runtime-health-jsonl",
      },
      collectorMetrics: {
        file: collectorFile,
        digest: createHash("sha256")
          .update(fixture.collectorMetricsText)
          .digest("hex"),
        format: "collector-metrics-tsv",
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

export function writeCanaryEvidenceCohort(
  root,
  {
    startMs,
    version,
    commitSha,
    recoveries = 0,
    workerInits = 0,
    baselineCount = 3,
    ...context
  },
) {
  const baselines = Array.from({ length: baselineCount }, (_, index) => {
    const fixture = createCanaryEvidenceFixture({
      startMs: startMs - (baselineCount - index) * DAY_MS,
      version: `baseline-${index + 1}-${version}`,
      commitSha: String(index + 1).repeat(40),
      recoveries: 0,
      ...context,
    });
    const written = writeCanaryEvidenceBundle(root, fixture);
    return { ...written.record, sourceReference: written.sourceReference };
  });
  const current = createCanaryEvidenceFixture({
    startMs,
    version,
    commitSha,
    recoveries,
    workerInits,
    ...context,
  });
  const comparison = compareCanarySummary(current.summary, baselines);
  return {
    baselines,
    current: writeCanaryEvidenceBundle(root, current, comparison),
    comparison,
  };
}
