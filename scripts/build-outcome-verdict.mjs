#!/usr/bin/env node

import { createHash } from "node:crypto";
import { readFileSync, realpathSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  hasMatchedEvidenceAttribution,
  validateStoredCanaryRecordProvenance,
} from "./canary-summarize.mjs";
import {
  canaryMetricContract,
  stabilityMetricById,
  STABILITY_METRIC_REGISTRY_VERSION,
  windowDurationsAreComparable,
} from "./lib/stability-metrics.mjs";
import {
  rebuildStoredSoakVerdict,
  VERDICT_SCHEMA_VERSION as SOAK_VERDICT_SCHEMA_VERSION,
} from "./soak-assert.mjs";

const __filename = fileURLToPath(import.meta.url);
export const OUTCOME_VERDICT_SCHEMA_VERSION = 1;
const MEASURED_OUTCOMES = new Set([
  "verified_effective",
  "verified_neutral",
  "regressed",
]);
const OUTCOME_STATUS = Object.freeze({
  verified_effective: "pass",
  verified_neutral: "pass",
  regressed: "fail",
  inconclusive: "inconclusive",
});

function usage() {
  return `Usage:
  node scripts/build-outcome-verdict.mjs (--soak-verdict <path> | --canary-verdict <path>) --task-id <id> --outcome <outcome> --out <path> [effect options]

Outcomes:
  verified_effective, verified_neutral, regressed, inconclusive

Effect options:
  Soak measured outcome: --metric <registered metric id> --baseline-reference <raw soak verdict path>
  Canary neutral/regression: --metric <registered canary metric name>

Before, after, unit, direction, and tolerance are derived from evidence and the checked-in metric registry.
`;
}

export function parseArgs(argv) {
  const args = {
    soakVerdict: "",
    canaryVerdict: "",
    taskId: "",
    outcome: "",
    out: "",
    metric: "",
    baselineReference: "",
    help: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (flag === "--help" || flag === "-h") {
      args.help = true;
      continue;
    }
    const value = argv[index + 1];
    if (value === undefined || value.startsWith("--")) {
      throw new Error(`${flag} requires a value.`);
    }
    switch (flag) {
      case "--soak-verdict":
        args.soakVerdict = value;
        break;
      case "--canary-verdict":
        args.canaryVerdict = value;
        break;
      case "--task-id":
        args.taskId = value;
        break;
      case "--outcome":
        args.outcome = value;
        break;
      case "--out":
        args.out = value;
        break;
      case "--metric":
        args.metric = value;
        break;
      case "--baseline-reference":
        args.baselineReference = value;
        break;
      default:
        throw new Error(`Unknown argument: ${flag}`);
    }
    index += 1;
  }
  if (args.help) return args;
  for (const [field, value] of [
    ["--task-id", args.taskId],
    ["--outcome", args.outcome],
    ["--out", args.out],
  ]) {
    if (!value) throw new Error(`${field} is required.`);
  }
  if (Boolean(args.soakVerdict) === Boolean(args.canaryVerdict)) {
    throw new Error(
      "Exactly one of --soak-verdict or --canary-verdict is required.",
    );
  }
  if (!Object.hasOwn(OUTCOME_STATUS, args.outcome)) {
    throw new Error(`Unsupported outcome: ${args.outcome}.`);
  }
  if (MEASURED_OUTCOMES.has(args.outcome) && !args.metric) {
    throw new Error("Measured outcomes require --metric.");
  }
  if (
    !MEASURED_OUTCOMES.has(args.outcome) &&
    (args.metric || args.baselineReference)
  ) {
    throw new Error("An inconclusive outcome cannot claim a measured effect.");
  }
  if (
    args.soakVerdict &&
    MEASURED_OUTCOMES.has(args.outcome) &&
    !args.baselineReference
  ) {
    throw new Error("Measured soak outcomes require --baseline-reference.");
  }
  if (args.canaryVerdict && args.baselineReference) {
    throw new Error("Canary comparisons carry their own trailing baseline.");
  }
  if (args.canaryVerdict && args.outcome === "verified_effective") {
    throw new Error(
      "A canary pass proves no regression, not verified effectiveness.",
    );
  }
  return args;
}

function hashText(text) {
  return createHash("sha256").update(text).digest("hex");
}

function readJsonArtifact(filePath, label) {
  const resolvedPath = realpathSync(path.resolve(filePath));
  const text = readFileSync(resolvedPath, "utf8");
  let value;
  try {
    value = JSON.parse(text);
  } catch {
    throw new Error(`${label} must contain valid JSON.`);
  }
  return { path: resolvedPath, digest: hashText(text), value };
}

function evidenceWindow(verdict, label) {
  const windowStartMs = Date.parse(String(verdict?.windowStart ?? ""));
  const windowEndMs = Date.parse(String(verdict?.windowEnd ?? ""));
  if (
    !Number.isFinite(windowStartMs) ||
    !Number.isFinite(windowEndMs) ||
    windowStartMs >= windowEndMs
  ) {
    throw new Error(`${label} requires a valid non-empty evidence window.`);
  }
  return { windowStartMs, windowEndMs };
}

function buildIdentityFromRuntime(runtimeIdentity, label) {
  const version = String(runtimeIdentity?.appVersion ?? "")
    .trim()
    .replace(/^v/i, "");
  const commitSha = String(runtimeIdentity?.buildCommitSha ?? "")
    .trim()
    .toLowerCase();
  const channel = String(runtimeIdentity?.channel ?? "").trim();
  if (
    runtimeIdentity?.attributable !== true ||
    !version ||
    !/^[0-9a-f]{40}$/.test(commitSha) ||
    !["dev", "production"].includes(channel)
  ) {
    throw new Error(
      `${label} requires attributable version, full commit SHA, and channel identity.`,
    );
  }
  const artifactDigest = String(runtimeIdentity?.artifactDigest ?? "")
    .trim()
    .toLowerCase();
  if (artifactDigest && !/^[0-9a-f]{64}$/.test(artifactDigest)) {
    throw new Error(`${label} artifact digest must be a SHA-256 digest.`);
  }
  return {
    version,
    commitSha,
    channel,
    ...(artifactDigest ? { artifactDigest } : {}),
    ...(runtimeIdentity.appSessionId
      ? { appSessionId: String(runtimeIdentity.appSessionId) }
      : {}),
  };
}

function buildIdentityFromCanary(canary, label) {
  const build = canary?.buildIdentity ?? {};
  return buildIdentityFromRuntime(
    {
      attributable: canary?.evidenceAttribution?.status === "matched",
      appVersion: build.version,
      buildCommitSha: build.commitSha,
      channel: build.channel,
      artifactDigest: build.artifactDigest,
      appSessionId: canary?.runtimeIdentity?.appSessionId,
    },
    label,
  );
}

function validateEvidenceFingerprint(fingerprint, label) {
  if (
    fingerprint?.schemaVersion !== 1 ||
    fingerprint?.algorithm !== "sha256" ||
    !/^[0-9a-f]{64}$/.test(String(fingerprint?.digest ?? "")) ||
    !Number.isSafeInteger(fingerprint?.recordCount) ||
    fingerprint.recordCount <= 0
  ) {
    throw new Error(
      `${label} requires a complete SHA-256 evidence fingerprint.`,
    );
  }
  return structuredClone(fingerprint);
}

function stableSoakProjection(verdict) {
  const projection = structuredClone(verdict);
  delete projection.generatedAt;
  if (projection.soakDir) {
    projection.soakDir = realpathSync(path.resolve(projection.soakDir));
  }
  return projection;
}

function validateStoredSoakProvenance(verdict) {
  const rebuilt = rebuildStoredSoakVerdict(verdict?.soakDir);
  if (
    JSON.stringify(stableSoakProjection(verdict)) !==
    JSON.stringify(stableSoakProjection(rebuilt))
  ) {
    throw new Error(
      "Raw soak verdict does not match the stored collector artifacts.",
    );
  }
  return rebuilt;
}

function validateSoakVerdict(
  verdict,
  { outcome = null, requireHealthy = false, label },
) {
  if (
    verdict?.schemaVersion !== SOAK_VERDICT_SCHEMA_VERSION ||
    verdict?.metricRegistryVersion !== STABILITY_METRIC_REGISTRY_VERSION
  ) {
    throw new Error(
      `${label} uses an unsupported soak or metric registry schema.`,
    );
  }
  if (outcome) {
    const expectedStatus = OUTCOME_STATUS[outcome];
    if (
      verdict.status !== expectedStatus ||
      verdict.pass !== (expectedStatus === "pass")
    ) {
      throw new Error(`${label} status does not match the requested outcome.`);
    }
  }
  const window = evidenceWindow(verdict, label);
  const buildIdentity = buildIdentityFromRuntime(
    verdict.runtimeIdentity,
    label,
  );
  const fingerprint = validateEvidenceFingerprint(
    verdict.evidenceFingerprint,
    label,
  );
  const healthy = verdict?.sourceHealth?.healthy === true;
  if (requireHealthy && !healthy) {
    throw new Error(`${label} requires healthy collector coverage.`);
  }
  return { window, buildIdentity, fingerprint, healthy };
}

function validatedSoakMeasurement(verdict, metricId, label) {
  const metricContract = stabilityMetricById(metricId);
  const contract = metricContract?.outcomeMeasurement;
  const measurement = verdict?.measurements?.[metricId];
  if (
    !metricContract ||
    !contract ||
    !Number.isFinite(measurement?.value) ||
    measurement.unit !== contract.unit ||
    measurement.direction !== contract.direction ||
    !Number.isFinite(contract.tolerance) ||
    contract.tolerance < 0
  ) {
    throw new Error(
      `${label} lacks the registered ${metricId} measurement contract.`,
    );
  }
  return { metricContract, contract, value: measurement.value };
}

function validatedSoakComparisonContext(verdict, label) {
  const context = verdict?.comparisonContext;
  const normalized = {
    scenario: String(context?.scenario ?? "").trim(),
    providerCohort: String(context?.providerCohort ?? "").trim(),
    documentSizeBucket: String(context?.documentSizeBucket ?? "").trim(),
    host: {
      platform: String(context?.host?.platform ?? "").trim(),
      architecture: String(context?.host?.architecture ?? "").trim(),
      memoryTierGiB: Number(context?.host?.memoryTierGiB),
    },
  };
  if (
    !normalized.scenario ||
    !normalized.providerCohort ||
    !normalized.documentSizeBucket ||
    !normalized.host.platform ||
    !normalized.host.architecture ||
    !Number.isFinite(normalized.host.memoryTierGiB) ||
    normalized.host.memoryTierGiB <= 0
  ) {
    throw new Error(
      `${label} lacks a complete workload and host comparison context.`,
    );
  }
  return normalized;
}

export function canonicalOutcomeNumber(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric)
    ? Number.parseFloat(numeric.toPrecision(15))
    : Number.NaN;
}

export function canonicalOutcomeDelta(before, after) {
  return canonicalOutcomeNumber(
    canonicalOutcomeNumber(after) - canonicalOutcomeNumber(before),
  );
}

function assertMeasuredOutcome(
  outcome,
  { before, after, direction, tolerance },
) {
  const delta = canonicalOutcomeDelta(before, after);
  const signedImprovement = direction === "lower" ? -delta : delta;
  if (outcome === "verified_effective" && signedImprovement <= tolerance) {
    throw new Error(
      "verified_effective requires evidence-derived improvement beyond registry tolerance.",
    );
  }
  if (outcome === "verified_neutral" && Math.abs(delta) > tolerance) {
    throw new Error(
      "verified_neutral requires an evidence-derived delta within registry tolerance.",
    );
  }
  if (outcome === "regressed" && signedImprovement >= -tolerance) {
    throw new Error(
      "regressed requires evidence-derived deterioration beyond registry tolerance.",
    );
  }
  return delta;
}

function deriveSoakEffect(rawVerdict, baselineArtifact, args) {
  const current = validateSoakVerdict(rawVerdict, {
    outcome: args.outcome,
    requireHealthy: true,
    label: "Raw soak verdict",
  });
  const baseline = validateSoakVerdict(baselineArtifact.value, {
    requireHealthy: true,
    label: "Baseline soak verdict",
  });
  if (baseline.window.windowEndMs > current.window.windowStartMs) {
    throw new Error(
      "Baseline soak window must end before the measured soak window begins.",
    );
  }
  if (baseline.buildIdentity.channel !== current.buildIdentity.channel) {
    throw new Error(
      "Baseline and measured soak builds must use the same release channel.",
    );
  }
  if (baseline.buildIdentity.commitSha === current.buildIdentity.commitSha) {
    throw new Error(
      "Measured outcomes require a baseline from a different build commit.",
    );
  }
  const currentContext = validatedSoakComparisonContext(
    rawVerdict,
    "Raw soak verdict",
  );
  const baselineContext = validatedSoakComparisonContext(
    baselineArtifact.value,
    "Baseline soak verdict",
  );
  if (JSON.stringify(currentContext) !== JSON.stringify(baselineContext)) {
    throw new Error(
      "Baseline and measured soak workload, provider cohort, document size, and host must match.",
    );
  }
  const currentSpanMs =
    current.window.windowEndMs - current.window.windowStartMs;
  const baselineSpanMs =
    baseline.window.windowEndMs - baseline.window.windowStartMs;
  if (!windowDurationsAreComparable(currentSpanMs, baselineSpanMs)) {
    throw new Error(
      "Baseline and measured soak windows must have comparable duration.",
    );
  }
  const beforeMeasurement = validatedSoakMeasurement(
    baselineArtifact.value,
    args.metric,
    "Baseline soak verdict",
  );
  const afterMeasurement = validatedSoakMeasurement(
    rawVerdict,
    args.metric,
    "Raw soak verdict",
  );
  const contract = afterMeasurement.contract;
  if (JSON.stringify(beforeMeasurement.contract) !== JSON.stringify(contract)) {
    throw new Error(
      "Baseline and measured soak metric contracts do not match.",
    );
  }
  const before = canonicalOutcomeNumber(beforeMeasurement.value);
  const after = canonicalOutcomeNumber(afterMeasurement.value);
  const delta = assertMeasuredOutcome(args.outcome, {
    before,
    after,
    direction: contract.direction,
    tolerance: contract.tolerance,
  });
  return {
    effect: { metric: args.metric, before, after, delta, unit: contract.unit },
    effectAssessment: {
      method: "registered-soak-baseline",
      direction: contract.direction,
      tolerance: contract.tolerance,
      metricRegistryVersion: STABILITY_METRIC_REGISTRY_VERSION,
      comparisonContext: currentContext,
      baselineReference: {
        kind: "soak",
        path: baselineArtifact.path,
        digest: baselineArtifact.digest,
        buildIdentity: baseline.buildIdentity,
        windowStart: baselineArtifact.value.windowStart,
        windowEnd: baselineArtifact.value.windowEnd,
        evidenceFingerprint: baseline.fingerprint,
      },
    },
  };
}

function canaryExpectedLimit(before, canaryMetric) {
  const tolerance = canaryMetric.tolerance;
  const limit =
    canaryMetric.direction === "higher"
      ? tolerance.kind === "ratio"
        ? Math.min(before / tolerance.allowance, before - Number.EPSILON)
        : before - tolerance.allowance
      : tolerance.kind === "ratio"
        ? Math.max(before * tolerance.allowance, before + Number.EPSILON)
        : before + tolerance.allowance;
  return Number(limit.toFixed(2));
}

function validateCanarySource(canary, args, sourcePath) {
  if (
    canary?.schemaVersion !== 2 ||
    canary?.metricRegistryVersion !== STABILITY_METRIC_REGISTRY_VERSION
  ) {
    throw new Error(
      "Canary verdict uses an unsupported schema or metric registry.",
    );
  }
  const expectedComparison = {
    verified_neutral: "pass",
    regressed: "regression",
    inconclusive: "inconclusive",
  }[args.outcome];
  if (
    !expectedComparison ||
    canary?.comparison?.status !== expectedComparison
  ) {
    throw new Error(
      "Canary comparison status does not match the requested outcome.",
    );
  }
  validateStoredCanaryRecordProvenance(canary, sourcePath);
  if (!hasMatchedEvidenceAttribution(canary)) {
    throw new Error(
      "Canary outcome requires healthy, attributable, nonempty source evidence.",
    );
  }
  const window = evidenceWindow(canary, "Canary verdict");
  const buildIdentity = buildIdentityFromCanary(canary, "Canary verdict");
  const fingerprint = validateEvidenceFingerprint(
    canary?.sourceHealth?.evidenceFingerprint,
    "Canary verdict",
  );
  return { window, buildIdentity, fingerprint };
}

function deriveCanaryEffect(canary, args) {
  if (args.outcome === "verified_effective") {
    throw new Error(
      "A canary pass proves no regression, not verified effectiveness.",
    );
  }
  const selected = canaryMetricContract(args.metric);
  const comparison = canary?.comparison?.metrics?.[args.metric];
  const expectedMetricStatus =
    args.outcome === "regressed" ? "regression" : "pass";
  if (
    !selected ||
    !selected.canaryMetric.unit ||
    comparison?.status !== expectedMetricStatus ||
    !Number.isFinite(comparison?.trailingMedian) ||
    !Number.isFinite(comparison?.current) ||
    !Number.isFinite(comparison?.limit) ||
    comparison.current !== canary?.metrics?.[args.metric] ||
    !["lower", "higher"].includes(selected.canaryMetric.direction) ||
    (selected.canaryMetric.minimum !== undefined &&
      (comparison.trailingMedian < selected.canaryMetric.minimum ||
        comparison.current < selected.canaryMetric.minimum))
  ) {
    throw new Error(
      "The selected canary metric lacks a matching registered comparison.",
    );
  }
  const before = canonicalOutcomeNumber(comparison.trailingMedian);
  const after = canonicalOutcomeNumber(comparison.current);
  const expectedLimit = canaryExpectedLimit(before, selected.canaryMetric);
  if (Math.abs(comparison.limit - expectedLimit) > 0.02) {
    throw new Error(
      "Canary comparison limit does not match the registered tolerance.",
    );
  }
  const regressed =
    selected.canaryMetric.direction === "higher"
      ? after < comparison.limit
      : after > comparison.limit;
  if ((args.outcome === "regressed") !== regressed) {
    throw new Error("Canary metric values contradict the requested outcome.");
  }
  return {
    effect: {
      metric: args.metric,
      before,
      after,
      delta: canonicalOutcomeDelta(before, after),
      unit: selected.canaryMetric.unit,
    },
    effectAssessment: {
      method: "registered-canary-cohort",
      direction: selected.canaryMetric.direction,
      tolerance: Math.abs(comparison.limit - before),
      comparisonLimit: comparison.limit,
      metricRegistryVersion: STABILITY_METRIC_REGISTRY_VERSION,
      registryTolerance: structuredClone(selected.canaryMetric.tolerance),
      comparableWindows: canary.comparison.comparableWindows,
    },
  };
}

export function buildOutcomeVerdict(rawVerdict, args, source = {}) {
  const sourceKind = source.kind ?? "soak";
  if (!Object.hasOwn(OUTCOME_STATUS, args.outcome)) {
    throw new Error(`Unsupported outcome: ${args.outcome}.`);
  }
  let validated;
  let measured = null;
  if (sourceKind === "soak") {
    validated = validateSoakVerdict(rawVerdict, {
      outcome: args.outcome,
      requireHealthy: MEASURED_OUTCOMES.has(args.outcome),
      label: "Raw soak verdict",
    });
    if (MEASURED_OUTCOMES.has(args.outcome)) {
      if (!source.baseline?.value) {
        throw new Error(
          "Measured soak outcomes require a parsed, hashed baseline verdict.",
        );
      }
      measured = deriveSoakEffect(rawVerdict, source.baseline, args);
    }
  } else if (sourceKind === "canary") {
    validated = validateCanarySource(rawVerdict, args, source.path);
    if (MEASURED_OUTCOMES.has(args.outcome)) {
      measured = deriveCanaryEffect(rawVerdict, args);
    }
  } else {
    throw new Error(`Unsupported outcome source kind: ${sourceKind}.`);
  }
  const expectedStatus = OUTCOME_STATUS[args.outcome];
  return {
    schemaVersion: OUTCOME_VERDICT_SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    taskId: args.taskId,
    outcome: args.outcome,
    status: expectedStatus,
    pass: expectedStatus === "pass",
    buildIdentity: validated.buildIdentity,
    windowStart: rawVerdict.windowStart,
    windowEnd: rawVerdict.windowEnd,
    sourceHealth: {
      healthy:
        sourceKind === "canary"
          ? rawVerdict.sourceHealth?.status === "healthy"
          : rawVerdict.sourceHealth?.healthy === true,
      status:
        sourceKind === "canary"
          ? rawVerdict.sourceHealth?.status
          : rawVerdict.sourceHealth?.healthy === true
            ? "healthy"
            : "unhealthy",
      sampleCount:
        sourceKind === "canary"
          ? rawVerdict.sourceHealth?.collectorSampleCount
          : rawVerdict.sampleCount,
      healthLineCount: rawVerdict.healthLineCount,
    },
    evidenceFingerprint: validated.fingerprint,
    ...(measured ?? {}),
    sourceVerdict: {
      kind: sourceKind,
      schemaVersion: rawVerdict.schemaVersion,
      path: source.path,
      digest: source.digest,
      ...(sourceKind === "soak"
        ? { soakDir: realpathSync(path.resolve(rawVerdict.soakDir)) }
        : { observationId: rawVerdict.observationId }),
    },
  };
}

export function buildOutcomeVerdictFromArtifacts({
  sourcePath,
  sourceKind,
  taskId,
  outcome,
  metric = "",
  baselineReference = "",
}) {
  const source = readJsonArtifact(sourcePath, `${sourceKind} verdict`);
  const args = { taskId, outcome, metric, baselineReference };
  if (sourceKind === "soak") {
    validateStoredSoakProvenance(source.value);
  }
  let baseline;
  if (sourceKind === "soak" && MEASURED_OUTCOMES.has(outcome)) {
    baseline = readJsonArtifact(baselineReference, "Baseline soak verdict");
    validateStoredSoakProvenance(baseline.value);
  }
  return buildOutcomeVerdict(source.value, args, {
    kind: sourceKind,
    path: source.path,
    digest: source.digest,
    baseline,
  });
}

function semanticProjection(verdict) {
  const projection = structuredClone(verdict);
  delete projection.generatedAt;
  return projection;
}

export function validateOutcomeVerdictProvenance(verdict) {
  if (
    verdict?.schemaVersion !== OUTCOME_VERDICT_SCHEMA_VERSION ||
    !verdict?.sourceVerdict?.path ||
    !["soak", "canary"].includes(verdict?.sourceVerdict?.kind)
  ) {
    throw new Error("Outcome verdict lacks converter provenance.");
  }
  const rebuilt = buildOutcomeVerdictFromArtifacts({
    sourcePath: verdict.sourceVerdict.path,
    sourceKind: verdict.sourceVerdict.kind,
    taskId: verdict.taskId,
    outcome: verdict.outcome,
    metric: verdict.effect?.metric ?? "",
    baselineReference: verdict.effectAssessment?.baselineReference?.path ?? "",
  });
  if (
    JSON.stringify(semanticProjection(verdict)) !==
    JSON.stringify(semanticProjection(rebuilt))
  ) {
    throw new Error(
      "Outcome verdict semantics do not match the hashed source artifacts.",
    );
  }
  return rebuilt;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    process.stdout.write(usage());
    return;
  }
  const sourceKind = args.canaryVerdict ? "canary" : "soak";
  const verdict = buildOutcomeVerdictFromArtifacts({
    sourcePath: args.canaryVerdict || args.soakVerdict,
    sourceKind,
    taskId: args.taskId,
    outcome: args.outcome,
    metric: args.metric,
    baselineReference: args.baselineReference,
  });
  const outPath = path.resolve(args.out);
  writeFileSync(outPath, `${JSON.stringify(verdict, null, 2)}\n`);
  process.stdout.write(`Outcome verdict written to ${outPath}.\n`);
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
