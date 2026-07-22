#!/usr/bin/env node

import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { AUTOMATION_ACTOR_POLICIES } from "./lib/automation-control.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.resolve(__dirname, "..");
export const SPEC_DIR = path.join(REPO_ROOT, "automation", "specs");

const AUTHORITIES = new Set([
  "observe-only",
  "plan-only",
  "pr-only",
  "merge-safe",
]);
const AUTOMATION_KINDS = new Set(["cron", "heartbeat"]);
const PROVIDER_BEHAVIORS = new Set(["forbidden", "approval-required"]);
const PR_CAPABLE_AUTHORITIES = new Set(["pr-only", "merge-safe"]);
const LOCAL_OVERLAY_FIELDS = new Set([
  "status",
  "rrule",
  "cadence",
  "model",
  "reasoning_effort",
  "execution_environment",
  "target",
  "cwds",
  "destination",
  "target_thread_id",
]);
const EXACT_LOCAL_OVERLAY_FIELDS = Object.freeze({
  cron: Object.freeze([
    "status",
    "rrule",
    "model",
    "reasoning_effort",
    "execution_environment",
    "target",
    "cwds",
  ]),
  heartbeat: Object.freeze([
    "status",
    "rrule",
    "destination",
    "target_thread_id",
  ]),
});
const REQUIRED_HOST_CAPABILITIES = Object.freeze([
  "short-lived-lease-handoff",
  "trusted-launcher",
]);
const EXPECTED_STATE_ROOT = "~/.freed/automation";
const MIN_ACTOR_LEASE_LIFETIME_MS = 60 * 1_000;
const MAX_ACTOR_LEASE_LIFETIME_MS = 60 * 60 * 1_000;
const STALE_PROMPT_PATTERNS = [
  ["website/src/pages/Roadmap.tsx", "obsolete public roadmap path"],
  ["PR 891", "stale pull request pin"],
  ["/tmp/freed", "volatile automation state path"],
];

function requireString(value, field, fileName) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${fileName}: ${field} must be a non-empty string.`);
  }
}

export function validateAutomationSpec(
  spec,
  { fileName, repoRoot = REPO_ROOT, actorPolicies = null } = {},
) {
  if (spec?.schemaVersion !== 1) {
    throw new Error(`${fileName}: schemaVersion must be 1.`);
  }
  for (const field of [
    "id",
    "name",
    "kind",
    "promptPath",
    "authority",
    "providerBehavior",
    "stateRoot",
  ]) {
    requireString(spec[field], field, fileName);
  }
  const expectedId = path.basename(fileName, ".json");
  if (spec.id !== expectedId) {
    throw new Error(`${fileName}: id must match the filename (${expectedId}).`);
  }
  if (!AUTHORITIES.has(spec.authority)) {
    throw new Error(`${fileName}: unsupported authority ${spec.authority}.`);
  }
  if (!AUTOMATION_KINDS.has(spec.kind)) {
    throw new Error(`${fileName}: unsupported automation kind ${spec.kind}.`);
  }
  if (!PROVIDER_BEHAVIORS.has(spec.providerBehavior)) {
    throw new Error(
      `${fileName}: unsupported providerBehavior ${spec.providerBehavior}.`,
    );
  }
  if (
    !Number.isInteger(spec.maxBehavioralChangesPerSoak) ||
    spec.maxBehavioralChangesPerSoak < 0 ||
    spec.maxBehavioralChangesPerSoak > 1
  ) {
    throw new Error(`${fileName}: maxBehavioralChangesPerSoak must be 0 or 1.`);
  }
  if (
    !Array.isArray(spec.localOverlayFields) ||
    spec.localOverlayFields.length === 0
  ) {
    throw new Error(
      `${fileName}: localOverlayFields must be a non-empty array.`,
    );
  }
  const overlayFields = spec.localOverlayFields.map((field) => {
    requireString(field, "localOverlayFields entry", fileName);
    return field;
  });
  if (new Set(overlayFields).size !== overlayFields.length) {
    throw new Error(
      `${fileName}: localOverlayFields must not contain duplicates.`,
    );
  }
  const unsupportedOverlayFields = overlayFields.filter(
    (field) => !LOCAL_OVERLAY_FIELDS.has(field),
  );
  if (unsupportedOverlayFields.length > 0) {
    throw new Error(
      `${fileName}: unsupported localOverlayFields: ${unsupportedOverlayFields.join(", ")}.`,
    );
  }
  const normalizedOverlayFields = overlayFields.map((field) =>
    field === "cadence" ? "rrule" : field,
  );
  if (
    new Set(normalizedOverlayFields).size !== normalizedOverlayFields.length
  ) {
    throw new Error(
      `${fileName}: localOverlayFields must choose exactly one of rrule or cadence.`,
    );
  }
  const expectedOverlayFields = EXACT_LOCAL_OVERLAY_FIELDS[spec.kind];
  if (
    [...normalizedOverlayFields].sort().join("\n") !==
    [...expectedOverlayFields].sort().join("\n")
  ) {
    throw new Error(
      `${fileName}: ${spec.kind} localOverlayFields must be exactly: ${expectedOverlayFields.join(", ")}, with cadence allowed in place of rrule.`,
    );
  }
  if (
    !Array.isArray(spec.requiredHostCapabilities) ||
    spec.requiredHostCapabilities.length !==
      REQUIRED_HOST_CAPABILITIES.length ||
    [...spec.requiredHostCapabilities].sort().join("\n") !==
      [...REQUIRED_HOST_CAPABILITIES].sort().join("\n")
  ) {
    throw new Error(
      `${fileName}: requiredHostCapabilities must be trusted-launcher and short-lived-lease-handoff.`,
    );
  }
  if (spec.stateRoot !== EXPECTED_STATE_ROOT) {
    throw new Error(`${fileName}: stateRoot must be ${EXPECTED_STATE_ROOT}.`);
  }
  if (
    !spec.lease ||
    typeof spec.lease !== "object" ||
    Array.isArray(spec.lease) ||
    Object.keys(spec.lease).sort().join("\n") !==
      ["maxLifetimeMs", "name"].join("\n") ||
    typeof spec.lease.name !== "string" ||
    spec.lease.name.trim() === "" ||
    !Number.isSafeInteger(spec.lease.maxLifetimeMs) ||
    spec.lease.maxLifetimeMs < MIN_ACTOR_LEASE_LIFETIME_MS ||
    spec.lease.maxLifetimeMs > MAX_ACTOR_LEASE_LIFETIME_MS
  ) {
    throw new Error(
      `${fileName}: lease must contain a name and a maximum lifetime from ${MIN_ACTOR_LEASE_LIFETIME_MS.toLocaleString()} to ${MAX_ACTOR_LEASE_LIFETIME_MS.toLocaleString()} ms.`,
    );
  }
  if (actorPolicies !== null) {
    const actorPolicy = actorPolicies[spec.id];
    if (!actorPolicy) {
      throw new Error(
        `${fileName}: no runtime actor policy exists for ${spec.id}.`,
      );
    }
    if (actorPolicy.observerAuthority !== spec.authority) {
      throw new Error(
        `${fileName}: authority ${spec.authority} does not match runtime actor policy ${actorPolicy.observerAuthority}.`,
      );
    }
    if (actorPolicy.providerAuthority !== spec.providerBehavior) {
      throw new Error(
        `${fileName}: providerBehavior ${spec.providerBehavior} does not match runtime actor policy ${actorPolicy.providerAuthority}.`,
      );
    }
    if (actorPolicy.leaseName !== spec.lease.name) {
      throw new Error(
        `${fileName}: lease ${spec.lease.name} does not match runtime actor policy ${actorPolicy.leaseName}.`,
      );
    }
  }

  const promptPath = path.resolve(repoRoot, spec.promptPath);
  if (
    !promptPath.startsWith(`${path.resolve(repoRoot)}${path.sep}`) ||
    !existsSync(promptPath)
  ) {
    throw new Error(
      `${fileName}: promptPath does not resolve to a checked-in prompt.`,
    );
  }
  const prompt = readFileSync(promptPath, "utf8");
  for (const [pattern, reason] of STALE_PROMPT_PATTERNS) {
    if (prompt.includes(pattern)) {
      throw new Error(`${fileName}: prompt contains ${reason}: ${pattern}.`);
    }
  }
  if (spec.authority === "observe-only" && !/read-only/i.test(prompt)) {
    throw new Error(
      `${fileName}: observe-only prompts must state that they remain read-only.`,
    );
  }
  if (
    spec.providerBehavior === "forbidden" &&
    !/Do not .*provider|Do not .*trigger providers/is.test(prompt)
  ) {
    throw new Error(
      `${fileName}: provider-forbidden prompts must prohibit provider activity.`,
    );
  }
  if (
    spec.providerBehavior === "approval-required" &&
    !/scoped approval record/i.test(prompt)
  ) {
    throw new Error(
      `${fileName}: provider approval prompts must require a scoped approval record.`,
    );
  }
  if (
    PR_CAPABLE_AUTHORITIES.has(spec.authority) &&
    !prompt.includes("(AI Generated).")
  ) {
    throw new Error(
      `${fileName}: PR-capable prompts must preserve the external posting prefix.`,
    );
  }
  if (spec.authority === "merge-safe" && !/writer lease/i.test(prompt)) {
    throw new Error(
      `${fileName}: merge-capable prompts must require a writer lease.`,
    );
  }
  if (
    spec.authority === "pr-only" &&
    !/without merging|Do not .*merge/is.test(prompt)
  ) {
    throw new Error(`${fileName}: pr-only prompts must prohibit merging.`);
  }
  if (spec.authority === "plan-only" && !/plan-only/i.test(prompt)) {
    throw new Error(
      `${fileName}: plan-only prompts must state their authority.`,
    );
  }
  return { ...spec, promptPath };
}

export function validateAutomationSpecs({
  specDir = SPEC_DIR,
  repoRoot = REPO_ROOT,
  actorPolicies = AUTOMATION_ACTOR_POLICIES,
} = {}) {
  const files = readdirSync(specDir)
    .filter((name) => name.endsWith(".json"))
    .sort();
  if (files.length === 0) {
    throw new Error(`No automation specifications found in ${specDir}.`);
  }
  return files.map((fileName) => {
    const spec = JSON.parse(readFileSync(path.join(specDir, fileName), "utf8"));
    return validateAutomationSpec(spec, { fileName, repoRoot, actorPolicies });
  });
}

function main() {
  const specs = validateAutomationSpecs();
  process.stdout.write(
    `Validated ${specs.length.toLocaleString()} automation specifications.\n`,
  );
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (error) {
    process.stderr.write(
      `${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exitCode = 1;
  }
}
