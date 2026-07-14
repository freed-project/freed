import { createHash } from "node:crypto";
import {
  linkSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";

import { stabilityMetricById } from "./stability-metrics.mjs";

export const STABILITY_ARTIFACT_SCHEMA_VERSION = 1;
export const DEFAULT_STABILITY_ARTIFACT_ROOT = path.join(
  os.homedir(),
  ".freed",
  "automation",
  "artifacts",
);

export const STABILITY_ARTIFACT_CONTRACTS = Object.freeze({
  "evidence-capture": Object.freeze({
    statuses: Object.freeze(["attributable", "inconclusive"]),
    payloadFields: Object.freeze([
      "processSegments",
      "redactions",
      "unresolvedGaps",
    ]),
    requiresWindow: true,
    requiresBuildIdentity: true,
  }),
  "memory-profile": Object.freeze({
    statuses: Object.freeze(["pass", "fail", "inconclusive"]),
    payloadFields: Object.freeze([
      "scenario",
      "comparisonCohort",
      "metricId",
      "budget",
      "contributors",
      "measuredScope",
      "excludedScope",
    ]),
    requiresWindow: true,
    requiresBuildIdentity: true,
  }),
  "sync-replay": Object.freeze({
    statuses: Object.freeze(["reproduced", "not_reproduced", "inconclusive"]),
    payloadFields: Object.freeze([
      "codeSha",
      "fixtureSchema",
      "fixtureDigest",
      "seed",
      "command",
      "invariants",
      "firstDivergentEvent",
    ]),
    requiresWindow: true,
    requiresBuildIdentity: false,
  }),
  "provider-risk-review": Object.freeze({
    statuses: Object.freeze([
      "behavior_approved",
      "diff_authorized",
      "blocked_by_owner",
      "needs_revision",
    ]),
    payloadFields: Object.freeze([
      "providers",
      "observableBehavior",
      "fingerprintingRisk",
      "lowestProfileAlternative",
      "allowedBehavior",
    ]),
    requiresWindow: false,
    requiresBuildIdentity: false,
  }),
  "stability-controller": Object.freeze({
    statuses: Object.freeze([
      "selected",
      "inconclusive",
      "blocked_by_authority",
      "noop",
    ]),
    payloadFields: Object.freeze([
      "currentState",
      "evidenceQuality",
      "metricContract",
      "authority",
      "providerRiskStatus",
      "exclusivityKey",
      "nextSkill",
    ]),
    requiresWindow: false,
    requiresBuildIdentity: false,
  }),
});

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

function requireString(value, field, errors) {
  if (typeof value !== "string" || value.trim() === "") {
    errors.push(`${field} must be a non-empty string`);
    return "";
  }
  return value.trim();
}

function validIso(value) {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

function requireArray(value, field, errors, { minItems = 0 } = {}) {
  if (!Array.isArray(value)) {
    errors.push(`${field} must be an array`);
    return [];
  }
  if (value.length < minItems) {
    errors.push(
      `${field} must contain at least ${minItems.toLocaleString()} item${minItems === 1 ? "" : "s"}`,
    );
  }
  return value;
}

function requireObject(value, field, errors) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    errors.push(`${field} must be an object`);
    return {};
  }
  return value;
}

function requireStringArray(value, field, errors, options = {}) {
  const values = requireArray(value, field, errors, options);
  values.forEach((item, index) => {
    requireString(item, `${field}[${index.toLocaleString()}]`, errors);
  });
  return values;
}

function validateMetricId(payload, errors, { required = false } = {}) {
  if (!Object.hasOwn(payload, "metricId")) {
    if (required) {
      requireString(payload.metricId, "payload.metricId", errors);
    }
    return;
  }
  const metricId = requireString(payload.metricId, "payload.metricId", errors);
  if (metricId && !stabilityMetricById(metricId)) {
    errors.push(
      `payload.metricId must name a registered stability metric: ${metricId}`,
    );
  }
}

function validatePayload(kind, status, payload, errors) {
  validateMetricId(payload, errors, { required: kind === "memory-profile" });

  if (kind === "evidence-capture") {
    const processSegments = requireArray(
      payload.processSegments,
      "payload.processSegments",
      errors,
      {
        minItems: status === "attributable" ? 1 : 0,
      },
    );
    processSegments.forEach((segment, index) => {
      requireObject(
        segment,
        `payload.processSegments[${index.toLocaleString()}]`,
        errors,
      );
    });
    requireStringArray(payload.redactions, "payload.redactions", errors);
    requireStringArray(
      payload.unresolvedGaps,
      "payload.unresolvedGaps",
      errors,
    );
    return;
  }

  if (kind === "memory-profile") {
    requireString(payload.scenario, "payload.scenario", errors);
    requireString(payload.comparisonCohort, "payload.comparisonCohort", errors);
    const budget = requireObject(payload.budget, "payload.budget", errors);
    if (!Number.isFinite(budget.value))
      errors.push("payload.budget.value must be a finite number");
    requireString(budget.unit, "payload.budget.unit", errors);
    requireArray(payload.contributors, "payload.contributors", errors);
    requireStringArray(payload.measuredScope, "payload.measuredScope", errors, {
      minItems: 1,
    });
    requireStringArray(payload.excludedScope, "payload.excludedScope", errors);
    return;
  }

  if (kind === "sync-replay") {
    const codeSha = requireString(payload.codeSha, "payload.codeSha", errors);
    if (codeSha && !/^[0-9a-f]{40,64}$/.test(codeSha)) {
      errors.push("payload.codeSha must be a full hexadecimal commit SHA");
    }
    requireString(payload.fixtureSchema, "payload.fixtureSchema", errors);
    const fixtureDigest = requireString(
      payload.fixtureDigest,
      "payload.fixtureDigest",
      errors,
    );
    if (fixtureDigest && !/^[0-9a-f]{64}$/.test(fixtureDigest)) {
      errors.push("payload.fixtureDigest must be SHA-256");
    }
    if (
      !(typeof payload.seed === "string" && payload.seed.trim()) &&
      !Number.isSafeInteger(payload.seed)
    ) {
      errors.push("payload.seed must be a non-empty string or safe integer");
    }
    requireString(payload.command, "payload.command", errors);
    const invariants = requireArray(
      payload.invariants,
      "payload.invariants",
      errors,
      { minItems: 1 },
    );
    invariants.forEach((invariant, index) => {
      const item = requireObject(
        invariant,
        `payload.invariants[${index.toLocaleString()}]`,
        errors,
      );
      requireString(
        item.name,
        `payload.invariants[${index.toLocaleString()}].name`,
        errors,
      );
      if (!new Set(["pass", "fail", "inconclusive"]).has(item.status)) {
        errors.push(
          `payload.invariants[${index.toLocaleString()}].status must be pass, fail, or inconclusive`,
        );
      }
    });
    if (
      payload.firstDivergentEvent !== null &&
      (typeof payload.firstDivergentEvent !== "object" ||
        Array.isArray(payload.firstDivergentEvent))
    ) {
      errors.push("payload.firstDivergentEvent must be an object or null");
    }
    return;
  }

  if (kind === "provider-risk-review") {
    const providers = requireStringArray(
      payload.providers,
      "payload.providers",
      errors,
      { minItems: 1 },
    );
    const supported = new Set([
      "facebook",
      "instagram",
      "linkedin",
      "other",
      "x",
      "youtube",
    ]);
    for (const provider of providers) {
      if (!supported.has(provider))
        errors.push(
          `payload.providers contains unsupported provider '${provider}'`,
        );
    }
    requireString(
      payload.observableBehavior,
      "payload.observableBehavior",
      errors,
    );
    requireString(
      payload.fingerprintingRisk,
      "payload.fingerprintingRisk",
      errors,
    );
    requireString(
      payload.lowestProfileAlternative,
      "payload.lowestProfileAlternative",
      errors,
    );
    requireString(payload.allowedBehavior, "payload.allowedBehavior", errors);
    return;
  }

  if (kind === "stability-controller") {
    requireString(payload.currentState, "payload.currentState", errors);
    requireString(payload.evidenceQuality, "payload.evidenceQuality", errors);
    requireString(payload.metricContract, "payload.metricContract", errors);
    const authority = requireString(
      payload.authority,
      "payload.authority",
      errors,
    );
    if (
      authority &&
      !new Set(["observe-only", "plan-only", "pr-only", "merge-safe"]).has(
        authority,
      )
    ) {
      errors.push(
        "payload.authority must be observe-only, plan-only, pr-only, or merge-safe",
      );
    }
    requireString(
      payload.providerRiskStatus,
      "payload.providerRiskStatus",
      errors,
    );
    requireString(payload.exclusivityKey, "payload.exclusivityKey", errors);
    requireString(payload.nextSkill, "payload.nextSkill", errors);
  }
}

export function validateStabilityArtifact(
  artifact,
  { expectedKind = null } = {},
) {
  const errors = [];
  if (!artifact || typeof artifact !== "object" || Array.isArray(artifact)) {
    throw new Error("Stability artifact must be a JSON object.");
  }
  if (artifact.schemaVersion !== STABILITY_ARTIFACT_SCHEMA_VERSION) {
    errors.push(
      `schemaVersion must equal ${STABILITY_ARTIFACT_SCHEMA_VERSION.toLocaleString()}`,
    );
  }
  const kind = requireString(artifact.kind, "kind", errors);
  const contract = STABILITY_ARTIFACT_CONTRACTS[kind];
  if (!contract)
    errors.push(
      `kind must be one of ${Object.keys(STABILITY_ARTIFACT_CONTRACTS).join(", ")}`,
    );
  if (expectedKind && kind !== expectedKind)
    errors.push(`kind must equal ${expectedKind}`);
  const taskId = requireString(artifact.taskId, "taskId", errors);
  if (taskId && !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(taskId)) {
    errors.push(
      "taskId must be filesystem-safe and no longer than 128 characters",
    );
  }
  if (!validIso(artifact.createdAt))
    errors.push("createdAt must be an ISO-8601 timestamp");
  const status = requireString(artifact.status, "status", errors);
  if (contract && !contract.statuses.includes(status)) {
    errors.push(`status must be one of ${contract.statuses.join(", ")}`);
  }
  if (
    !artifact.source ||
    typeof artifact.source !== "object" ||
    Array.isArray(artifact.source)
  ) {
    errors.push("source must be an object");
  } else {
    if (
      !["healthy", "unhealthy", "inconclusive"].includes(artifact.source.status)
    ) {
      errors.push("source.status must be healthy, unhealthy, or inconclusive");
    }
    if (!Array.isArray(artifact.source.references)) {
      errors.push("source.references must be an array");
    } else {
      if (artifact.source.references.length === 0) {
        errors.push(
          "source.references must contain at least one immutable reference",
        );
      }
      artifact.source.references.forEach((reference, index) => {
        if (!reference || typeof reference !== "object") {
          errors.push(
            `source.references[${index.toLocaleString()}] must be an object`,
          );
          return;
        }
        requireString(
          reference.reference,
          `source.references[${index.toLocaleString()}].reference`,
          errors,
        );
        if (!/^[0-9a-f]{64}$/.test(String(reference.digest ?? ""))) {
          errors.push(
            `source.references[${index.toLocaleString()}].digest must be SHA-256`,
          );
        }
      });
    }
  }
  if (contract?.requiresWindow) {
    const startMs = Date.parse(artifact.window?.start ?? "");
    const endMs = Date.parse(artifact.window?.end ?? "");
    if (
      !Number.isFinite(startMs) ||
      !Number.isFinite(endMs) ||
      endMs <= startMs
    ) {
      errors.push(
        "window.start and window.end must form an increasing ISO-8601 interval",
      );
    }
  }
  if (contract?.requiresBuildIdentity) {
    const identity = artifact.identity ?? {};
    requireString(identity.version, "identity.version", errors);
    const commitSha = requireString(
      identity.commitSha,
      "identity.commitSha",
      errors,
    );
    if (commitSha && !/^[0-9a-f]{40,64}$/.test(commitSha)) {
      errors.push("identity.commitSha must be a full hexadecimal commit SHA");
    }
    const channel = requireString(identity.channel, "identity.channel", errors);
    if (channel && !["dev", "production"].includes(channel)) {
      errors.push("identity.channel must be dev or production");
    }
  }
  if (
    !artifact.payload ||
    typeof artifact.payload !== "object" ||
    Array.isArray(artifact.payload)
  ) {
    errors.push("payload must be an object");
  } else if (contract) {
    for (const field of contract.payloadFields) {
      if (!Object.hasOwn(artifact.payload, field))
        errors.push(`payload.${field} is required`);
    }
    validatePayload(kind, status, artifact.payload, errors);
  }
  if (
    artifact.artifactDigest !== undefined &&
    !/^[0-9a-f]{64}$/.test(String(artifact.artifactDigest))
  ) {
    errors.push("artifactDigest must be SHA-256 when present");
  } else if (
    artifact.artifactDigest !== undefined &&
    artifact.artifactDigest !== stabilityArtifactDigest(artifact)
  ) {
    errors.push("artifactDigest does not match the artifact content");
  }
  if (errors.length > 0) {
    throw new Error(`Invalid stability artifact:\n- ${errors.join("\n- ")}`);
  }
  return structuredClone(artifact);
}

export function stabilityArtifactDigest(artifact) {
  const payload = structuredClone(artifact);
  delete payload.artifactDigest;
  return createHash("sha256").update(stableJson(payload)).digest("hex");
}

export function writeStabilityArtifact(
  artifact,
  { artifactRoot = DEFAULT_STABILITY_ARTIFACT_ROOT } = {},
) {
  const validated = validateStabilityArtifact(artifact);
  const artifactDigest = stabilityArtifactDigest(validated);
  const stored = { ...validated, artifactDigest };
  const directory = path.join(artifactRoot, validated.kind, validated.taskId);
  mkdirSync(directory, { recursive: true });
  const timestamp = new Date(validated.createdAt)
    .toISOString()
    .replace(/[^0-9]/g, "")
    .slice(0, 17);
  const target = path.join(directory, `${timestamp}-${artifactDigest}.json`);
  const text = `${JSON.stringify(stored, null, 2)}\n`;
  const temporary = `${target}.tmp-${process.pid}-${Date.now().toString(36)}`;
  try {
    writeFileSync(temporary, text, { flag: "wx", mode: 0o600 });
    try {
      linkSync(temporary, target);
    } catch (error) {
      if (error?.code !== "EEXIST") throw error;
      if (readFileSync(target, "utf8") !== text) {
        throw new Error(
          `Existing stability artifact content differs at ${target}.`,
        );
      }
      return { path: target, artifact: stored, created: false };
    }
  } finally {
    rmSync(temporary, { force: true });
  }
  return { path: target, artifact: stored, created: true };
}
