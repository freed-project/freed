import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { buildCanaryObservationContext, parseArgs } from "./canary-context.mjs";
import { writeStoredSoakEvidence } from "./test-helpers/outcome-evidence.mjs";

const START = "2026-07-10T10:00:00.000Z";
const END = "2026-07-10T15:00:00.000Z";

function input(overrides = {}) {
  const artifactDigest = overrides.artifactDigest ?? "";
  const root = mkdtempSync(path.join(os.tmpdir(), "freed-canary-context-"));
  const stored = writeStoredSoakEvidence(root, {
    name: "context",
    startMs: Date.parse(START),
    version: "26.7.1000-dev",
    commitSha: "a".repeat(40),
    artifactDigest,
    slopeMbPerHour: 4,
    comparisonContext: {
      scenario: "idle-cloud-connected",
      providerCohort: "social-authenticated-gdrive-connected",
      documentSizeBucket: "medium",
      host: { platform: "darwin", architecture: "arm64", memoryTierGiB: 64 },
    },
  });
  return {
    verdict: stored.verdict,
    installId: "install-1",
    installedAt: "2026-07-10T09:55:00.000Z",
    scenario: "idle-cloud-connected",
    providerCohort: "social-authenticated-gdrive-connected",
    documentSizeBucket: "medium",
    platform: "darwin",
    architecture: "arm64",
    memoryTierGiB: 64,
    ...overrides,
  };
}

test("buildCanaryObservationContext binds a healthy soak to exact build and workload identity", () => {
  const value = input();
  const context = buildCanaryObservationContext(value);
  assert.equal(context.build.commitSha, "a".repeat(40));
  assert.equal(
    context.runtime.appSessionId,
    value.verdict.runtimeIdentity.appSessionId,
  );
  assert.equal(
    context.runtime.collectorSessionId,
    value.verdict.runtimeIdentity.collectorSessionId,
  );
  assert.equal(context.runtime.appPid, 123);
  assert.equal(
    context.workload.providerCohort,
    "social-authenticated-gdrive-connected",
  );
  assert.equal(context.windowStart, START);
  assert.equal(context.sourceHealth.cloudEligibleHours, 5);
});

test("buildCanaryObservationContext rejects unhealthy source coverage", () => {
  assert.throws(
    () =>
      buildCanaryObservationContext(
        input({
          verdict: {
            windowStart: START,
            windowEnd: END,
            sourceHealth: { healthy: false },
          },
        }),
      ),
    /verdict.soakDir|does not have healthy app-alive source coverage/,
  );
});

test("buildCanaryObservationContext ignores caller build labels", () => {
  const value = input();
  const context = buildCanaryObservationContext({
    ...value,
    version: "fabricated-version",
    commitSha: "b".repeat(40),
    channel: "production",
    appSessionId: "fabricated-session",
  });
  assert.equal(context.build.version, "26.7.1000-dev");
  assert.equal(context.build.commitSha, "a".repeat(40));
  assert.equal(context.build.channel, "dev");
  assert.equal(
    context.runtime.appSessionId,
    value.verdict.runtimeIdentity.appSessionId,
  );
});

test("buildCanaryObservationContext does not treat the collector as an app session", () => {
  const value = input();
  value.verdict.runtimeIdentity = {
    collectorSessionId: "collector-only",
    appPids: [123],
    attributable: false,
  };
  assert.throws(
    () => buildCanaryObservationContext(value),
    /does not match its stored runtime and collector artifacts/,
  );
});

test("buildCanaryObservationContext cannot replace measured cloud coverage", () => {
  const context = buildCanaryObservationContext({
    ...input(),
    cloudEligibleHours: 999,
  });
  assert.equal(context.sourceHealth.cloudEligibleHours, 5);
});

test("buildCanaryObservationContext cannot relabel the stored workload or host", () => {
  assert.throws(
    () =>
      buildCanaryObservationContext({
        ...input(),
        providerCohort: "gdrive-only",
      }),
    /cannot relabel the immutable soak comparison context/,
  );
  assert.throws(
    () => buildCanaryObservationContext({ ...input(), memoryTierGiB: 32 }),
    /cannot relabel the immutable soak comparison context/,
  );
});

test("buildCanaryObservationContext rejects a relabeled stored verdict", () => {
  const value = input();
  value.verdict.comparisonContext.providerCohort = "gdrive-only";
  assert.throws(
    () => buildCanaryObservationContext(value),
    /does not match its stored runtime and collector artifacts/,
  );
});

test("buildCanaryObservationContext preserves the installed artifact digest", () => {
  const context = buildCanaryObservationContext(
    input({ artifactDigest: "e".repeat(64) }),
  );
  assert.equal(context.build.artifactDigest, "e".repeat(64));
  assert.equal(
    context.sourceHealth.evidenceFingerprint.attribution.artifactDigest,
    "e".repeat(64),
  );
});

test("buildCanaryObservationContext rejects coverage that no longer matches the soak fingerprint", () => {
  const value = input();
  value.verdict.sourceHealth.appAliveHours = 3;
  value.verdict.sourceHealth.appAliveRatio = 0.5;
  assert.throws(
    () => buildCanaryObservationContext(value),
    /does not match its stored runtime and collector artifacts/,
  );
});

test("buildCanaryObservationContext carries complete collector and runtime-health evidence", () => {
  const value = input();
  const context = buildCanaryObservationContext(value);
  assert.equal(context.sourceHealth.collectorDistinctSampleCount, 301);
  assert.equal(context.sourceHealth.sampleDensity, 1);
  for (const field of [
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
  ]) {
    assert.equal(
      context.sourceHealth[field],
      value.verdict.sourceHealth[field],
    );
    assert.equal(
      context.sourceHealth.evidenceFingerprint.coverage[field],
      value.verdict.evidenceFingerprint.coverage[field],
    );
  }
  assert.equal(context.sourceHealth.evidenceFingerprint.schemaVersion, 1);
  assert.equal(
    context.sourceHealth.evidenceFingerprint.collectorMetrics.recordCount,
    context.sourceHealth.collectorSampleCount,
  );
});

test("canary context argument parsing preserves explicit identifiers", () => {
  const args = parseArgs([
    "--install-id",
    "abc",
    "--provider-cohort",
    "social-on",
  ]);
  assert.equal(args.installId, "abc");
  assert.equal(args.providerCohort, "social-on");
});
