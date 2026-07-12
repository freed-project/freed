#!/usr/bin/env node

import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  CANARY_OBSERVATION_CONTEXT_SCHEMA_VERSION,
  validateCanaryObservationContext,
} from "./canary-summarize.mjs";
import { rebuildStoredSoakVerdict } from "./soak-assert.mjs";

const __filename = fileURLToPath(import.meta.url);

function required(value, field) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${field} is required.`);
  }
  return value.trim();
}

function stableVerdictProjection(verdict) {
  const projection = structuredClone(verdict);
  delete projection.generatedAt;
  return projection;
}

export function validateStoredSoakVerdictProvenance(verdict) {
  const soakDir = required(verdict?.soakDir, "verdict.soakDir");
  const rebuilt = rebuildStoredSoakVerdict(soakDir);
  if (
    JSON.stringify(stableVerdictProjection(verdict)) !==
    JSON.stringify(stableVerdictProjection(rebuilt))
  ) {
    throw new Error(
      "The soak verdict does not match its stored runtime and collector artifacts.",
    );
  }
  return rebuilt;
}

export function buildCanaryObservationContext({
  verdict: suppliedVerdict,
  installId,
  installedAt,
  scenario,
  providerCohort,
  documentSizeBucket,
  platform,
  architecture,
  memoryTierGiB,
}) {
  if (!suppliedVerdict || typeof suppliedVerdict !== "object") {
    throw new Error("A soak verdict is required.");
  }
  const verdict = validateStoredSoakVerdictProvenance(suppliedVerdict);
  if (verdict.sourceHealth?.healthy !== true) {
    throw new Error(
      "The soak verdict does not have healthy app-alive source coverage.",
    );
  }
  if (verdict.runtimeIdentity?.attributable !== true) {
    throw new Error(
      "The soak verdict does not have one event-derived build and app session identity.",
    );
  }
  const storedComparison = verdict.comparisonContext ?? {};
  const storedScenario = required(
    storedComparison.scenario,
    "verdict.comparisonContext.scenario",
  );
  const storedProviderCohort = required(
    storedComparison.providerCohort,
    "verdict.comparisonContext.providerCohort",
  );
  const storedDocumentSizeBucket = required(
    storedComparison.documentSizeBucket,
    "verdict.comparisonContext.documentSizeBucket",
  );
  const storedPlatform = required(
    storedComparison.host?.platform,
    "verdict.comparisonContext.host.platform",
  );
  const storedArchitecture = required(
    storedComparison.host?.architecture,
    "verdict.comparisonContext.host.architecture",
  );
  const storedMemoryTierGiB = Number(storedComparison.host?.memoryTierGiB);
  if (!Number.isFinite(storedMemoryTierGiB) || storedMemoryTierGiB <= 0) {
    throw new Error(
      "verdict.comparisonContext.host.memoryTierGiB is required.",
    );
  }
  const assertedFields = [
    ["scenario", scenario, storedScenario],
    ["providerCohort", providerCohort, storedProviderCohort],
    ["documentSizeBucket", documentSizeBucket, storedDocumentSizeBucket],
    ["platform", platform, storedPlatform],
    ["architecture", architecture, storedArchitecture],
    ["memoryTierGiB", memoryTierGiB, storedMemoryTierGiB],
  ];
  for (const [field, asserted, stored] of assertedFields) {
    if (asserted !== undefined && String(asserted) !== String(stored)) {
      throw new Error(
        `${field} cannot relabel the immutable soak comparison context.`,
      );
    }
  }
  const context = {
    schemaVersion: CANARY_OBSERVATION_CONTEXT_SCHEMA_VERSION,
    build: {
      version: required(
        verdict.runtimeIdentity.appVersion,
        "verdict.runtimeIdentity.appVersion",
      ),
      commitSha: required(
        verdict.runtimeIdentity.buildCommitSha,
        "verdict.runtimeIdentity.buildCommitSha",
      ),
      channel: required(
        verdict.runtimeIdentity.channel,
        "verdict.runtimeIdentity.channel",
      ),
      ...(verdict.runtimeIdentity.artifactDigest
        ? {
            artifactDigest: required(
              verdict.runtimeIdentity.artifactDigest,
              "verdict.runtimeIdentity.artifactDigest",
            ),
          }
        : {}),
      installId: required(installId, "installId"),
      installedAt: required(installedAt, "installedAt"),
    },
    runtime: {
      collectorSessionId: required(
        verdict.runtimeIdentity.collectorSessionId,
        "verdict.runtimeIdentity.collectorSessionId",
      ),
      appPid: verdict.runtimeIdentity.appPid,
      appSessionId: required(
        verdict.runtimeIdentity.appSessionId,
        "verdict.runtimeIdentity.appSessionId",
      ),
    },
    workload: {
      scenario: storedScenario,
      providerCohort: storedProviderCohort,
      documentSizeBucket: storedDocumentSizeBucket,
    },
    host: {
      platform: storedPlatform,
      architecture: storedArchitecture,
      memoryTierGiB: storedMemoryTierGiB,
    },
    sourceHealth: {
      status: "healthy",
      appAliveHours: verdict.sourceHealth.appAliveHours,
      appAliveRatio: verdict.sourceHealth.appAliveRatio,
      collectorSampleCount: verdict.sourceHealth.sampleCount,
      collectorDistinctSampleCount: verdict.sourceHealth.distinctSampleCount,
      expectedSampleCount: verdict.sourceHealth.expectedSampleCount,
      sampleDensity: verdict.sourceHealth.sampleDensity,
      collectorSpanHours: verdict.sourceHealth.spanHours,
      expectedIntervalMs: verdict.sourceHealth.expectedIntervalMs,
      maxCreditedGapMs: verdict.sourceHealth.maxCreditedGapMs,
      largestObservedGapMs: verdict.sourceHealth.largestObservedGapMs,
      creditedIntervalCount: verdict.sourceHealth.creditedIntervalCount,
      collectorHeaderHealthy: verdict.sourceHealth.collectorHeaderHealthy,
      collectorMalformedRowCount:
        verdict.sourceHealth.collectorMalformedRowCount,
      collectorEventCount: verdict.sourceHealth.collectorEventCount,
      collectorEventFailureCount:
        verdict.sourceHealth.collectorEventFailureCount,
      collectorEventRecoveryCount:
        verdict.sourceHealth.collectorEventRecoveryCount,
      collectorEventMalformedLineCount:
        verdict.sourceHealth.collectorEventMalformedLineCount,
      collectorEventProtocolErrorCount:
        verdict.sourceHealth.collectorEventProtocolErrorCount,
      collectorOutageOpen: verdict.sourceHealth.collectorOutageOpen,
      collectorOpenOutageStartedAtMs:
        verdict.sourceHealth.collectorOpenOutageStartedAtMs,
      collectorEventCoverageHealthy:
        verdict.sourceHealth.collectorEventCoverageHealthy,
      collectorEventEvidenceCapable:
        verdict.sourceHealth.collectorEventEvidenceCapable,
      collectorEventEvidencePresent:
        verdict.sourceHealth.collectorEventEvidencePresent,
      collectorEventEvidenceSchemaVersion:
        verdict.sourceHealth.collectorEventEvidenceSchemaVersion,
      runtimeHealthMalformedLineCount:
        verdict.sourceHealth.runtimeHealthMalformedLineCount,
      runtimeHealthSampleCount: verdict.sourceHealth.runtimeHealthSampleCount,
      runtimeHealthDistinctSampleCount:
        verdict.sourceHealth.runtimeHealthDistinctSampleCount,
      runtimeHealthExpectedSampleCount:
        verdict.sourceHealth.runtimeHealthExpectedSampleCount,
      runtimeHealthSampleDensity:
        verdict.sourceHealth.runtimeHealthSampleDensity,
      runtimeHealthExpectedIntervalMs:
        verdict.sourceHealth.runtimeHealthExpectedIntervalMs,
      runtimeHealthMaxCreditedGapMs:
        verdict.sourceHealth.runtimeHealthMaxCreditedGapMs,
      runtimeHealthLargestObservedGapMs:
        verdict.sourceHealth.runtimeHealthLargestObservedGapMs,
      runtimeHealthLastFreshnessMs:
        verdict.sourceHealth.runtimeHealthLastFreshnessMs,
      runtimeHealthAppAliveSegmentCount:
        verdict.sourceHealth.runtimeHealthAppAliveSegmentCount,
      runtimeHealthCoveredAppAliveSegmentCount:
        verdict.sourceHealth.runtimeHealthCoveredAppAliveSegmentCount,
      runtimeHealthCoverageHealthy:
        verdict.sourceHealth.runtimeHealthCoverageHealthy,
      cloudEligibleHours: verdict.sourceHealth.cloudEligibleHours ?? null,
      evidenceFingerprint: verdict.evidenceFingerprint,
    },
    windowStart: required(verdict.windowStart, "verdict.windowStart"),
    windowEnd: required(verdict.windowEnd, "verdict.windowEnd"),
  };
  return validateCanaryObservationContext(context);
}

function usage() {
  return `Usage:
  node scripts/canary-context.mjs --verdict <path> --install-id <id> --installed-at <iso> [options]

Options:
  Workload and host assertions are optional. When supplied, they must match the immutable soak context.
  --scenario <name>
  --provider-cohort <id>
  --document-size-bucket <bucket>
  --platform <name>
  --architecture <name>
  --memory-tier-gib <n>
  --out <path>                Defaults beside the verdict as canary-context.json.
  --help                      Show this help.
`;
}

export function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--help" || arg === "-h") {
      args.help = true;
      continue;
    }
    if (!arg.startsWith("--")) throw new Error(`Unknown argument: ${arg}`);
    const value = argv[index + 1];
    if (value === undefined || value.startsWith("--"))
      throw new Error(`${arg} requires a value.`);
    const key = arg
      .slice(2)
      .replace(/-([a-z])/g, (_match, letter) => letter.toUpperCase());
    args[key] = value;
    index += 1;
  }
  return args;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    process.stdout.write(usage());
    return;
  }
  const verdictPath = path.resolve(required(args.verdict, "--verdict"));
  const verdict = JSON.parse(readFileSync(verdictPath, "utf8"));
  const context = buildCanaryObservationContext({
    verdict,
    installId: args.installId,
    installedAt: args.installedAt,
    scenario: args.scenario,
    providerCohort: args.providerCohort,
    documentSizeBucket: args.documentSizeBucket,
    platform: args.platform,
    architecture: args.architecture,
    memoryTierGiB:
      args.memoryTierGib === undefined ? undefined : Number(args.memoryTierGib),
  });
  const outPath = path.resolve(
    args.out ?? path.join(path.dirname(verdictPath), "canary-context.json"),
  );
  writeFileSync(outPath, `${JSON.stringify(context, null, 2)}\n`);
  process.stdout.write(`Wrote build-bounded canary context to ${outPath}.\n`);
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
