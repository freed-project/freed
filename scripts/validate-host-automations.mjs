#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  closeSync,
  constants as fsConstants,
  existsSync,
  fstatSync,
  openSync,
  readFileSync,
  readSync,
  realpathSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { validateAutomationSpecs } from "./validate-automation-specs.mjs";
import {
  ACTOR_LAUNCHER_RECORD_ROOT,
  ACTOR_RUNTIME_ROOT,
  actorCredentialReadiness as sharedActorCredentialReadiness,
  actorLauncherReadiness as sharedActorLauncherReadiness,
  defaultLauncherAttestor as sharedDefaultLauncherAttestor,
  inspectRootOwnedExecutable as sharedInspectRootOwnedExecutable,
  inspectRootOwnedRecord as sharedInspectRootOwnedRecord,
  inspectRootOwnedRuntimeFile as sharedInspectRootOwnedRuntimeFile,
} from "./lib/automation-actor-readiness.mjs";

export {
  sharedActorCredentialReadiness as actorCredentialReadiness,
  sharedActorLauncherReadiness as actorLauncherReadiness,
  sharedInspectRootOwnedRuntimeFile as inspectRootOwnedRuntimeFile,
};

const __filename = fileURLToPath(import.meta.url);
const REPO_ROOT = path.resolve(path.dirname(__filename), "..");
const CANONICAL_REPOSITORY = "freed-project/freed";
const MODEL_CATALOG_MAX_AGE_MS = 24 * 60 * 60 * 1_000;
const MODEL_CATALOG_MAX_FUTURE_SKEW_MS = 5 * 60 * 1_000;
const MAX_CODEX_GLOBAL_STATE_BYTES = 16 * 1_024 * 1_024;
const CODEX_LOCAL_PROJECT_ID_PATTERN = /^local-[0-9a-f]{32}$/;
const HOST_SCHEDULE_CONTRACT = Object.freeze({
  cron: Object.freeze({
    HOURLY: Object.freeze({
      allowed: Object.freeze(["FREQ", "INTERVAL", "BYMINUTE", "BYDAY"]),
      required: Object.freeze(["INTERVAL", "BYMINUTE"]),
    }),
    DAILY: Object.freeze({
      allowed: Object.freeze(["FREQ", "BYHOUR", "BYMINUTE"]),
      required: Object.freeze(["BYHOUR", "BYMINUTE"]),
    }),
    WEEKLY: Object.freeze({
      allowed: Object.freeze(["FREQ", "BYDAY", "BYHOUR", "BYMINUTE"]),
      required: Object.freeze(["BYDAY", "BYHOUR", "BYMINUTE"]),
    }),
  }),
  heartbeat: Object.freeze({
    MINUTELY: Object.freeze({
      allowed: Object.freeze(["FREQ", "INTERVAL"]),
      required: Object.freeze(["INTERVAL"]),
    }),
  }),
});
const SAVED_AUTOMATION_FIELDS = new Set([
  "id",
  "kind",
  "name",
  "prompt",
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
const MUTATION_AUTHORITIES = new Set(["pr-only", "merge-safe"]);

function normalizedText(value) {
  return String(value ?? "")
    .replace(/\r\n/g, "\n")
    .trimEnd();
}

function parseTomlString(raw, field) {
  const value = raw.trim();
  if (value.startsWith('"')) {
    try {
      return JSON.parse(value);
    } catch {
      throw new Error(`${field} is not a supported TOML basic string.`);
    }
  }
  if (value.startsWith("'") && value.endsWith("'")) {
    return value.slice(1, -1);
  }
  throw new Error(`${field} must be a quoted TOML string.`);
}

function splitTomlItems(raw, field) {
  const items = [];
  let start = 0;
  let quote = "";
  let escaped = false;
  for (let index = 0; index < raw.length; index += 1) {
    const character = raw[index];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (quote === '"' && character === "\\") {
      escaped = true;
      continue;
    }
    if (quote) {
      if (character === quote) quote = "";
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
      continue;
    }
    if (character === ",") {
      items.push(raw.slice(start, index).trim());
      start = index + 1;
    }
  }
  if (quote || escaped)
    throw new Error(`${field} contains an unterminated TOML string.`);
  items.push(raw.slice(start).trim());
  if (items.some((item) => item === ""))
    throw new Error(`${field} contains an empty item.`);
  return items;
}

function parseTomlStringArray(raw, field) {
  const value = raw.trim();
  if (!value.startsWith("[") || !value.endsWith("]")) {
    throw new Error(`${field} must be a TOML array of strings.`);
  }
  const inner = value.slice(1, -1).trim();
  if (inner === "") return [];
  return splitTomlItems(inner, field).map((item) =>
    parseTomlString(item, field),
  );
}

function parseTomlInlineTable(raw, field) {
  const value = raw.trim();
  if (!value.startsWith("{") || !value.endsWith("}")) {
    throw new Error(`${field} must be a TOML inline table.`);
  }
  const inner = value.slice(1, -1).trim();
  if (inner === "") return {};
  const result = {};
  for (const item of splitTomlItems(inner, field)) {
    const match = item.match(/^([A-Za-z0-9_]+)\s*=\s*(.+)$/);
    if (!match) throw new Error(`${field} contains an invalid TOML entry.`);
    if (Object.hasOwn(result, match[1])) {
      throw new Error(`${field} contains duplicate field ${match[1]}.`);
    }
    result[match[1]] = parseTomlString(match[2], `${field}.${match[1]}`);
  }
  return result;
}

export function parseSavedAutomationToml(text) {
  const fields = {};
  for (const line of String(text ?? "").split("\n")) {
    const match = line.match(/^([A-Za-z0-9_]+)\s*=\s*(.+?)\s*$/);
    if (!match || !SAVED_AUTOMATION_FIELDS.has(match[1])) continue;
    if (Object.hasOwn(fields, match[1])) {
      throw new Error(`${match[1]} may only appear once.`);
    }
    if (match[1] === "cwds") {
      fields[match[1]] = parseTomlStringArray(match[2], match[1]);
    } else if (match[1] === "target") {
      fields[match[1]] = parseTomlInlineTable(match[2], match[1]);
    } else {
      fields[match[1]] = parseTomlString(match[2], match[1]);
    }
  }
  return fields;
}

export function authoritativeModelCatalog(
  codexHome,
  suppliedCatalog = undefined,
  {
    nowMs = Date.now(),
    maxAgeMs = MODEL_CATALOG_MAX_AGE_MS,
    maxFutureSkewMs = MODEL_CATALOG_MAX_FUTURE_SKEW_MS,
  } = {},
) {
  const catalogPath = path.join(path.resolve(codexHome), "models_cache.json");
  if (
    !Number.isFinite(nowMs) ||
    !Number.isSafeInteger(maxAgeMs) ||
    maxAgeMs <= 0 ||
    !Number.isSafeInteger(maxFutureSkewMs) ||
    maxFutureSkewMs < 0
  ) {
    return {
      ready: false,
      path: catalogPath,
      reason: "authoritative model catalog freshness contract is invalid",
      models: new Map(),
    };
  }
  let catalog = suppliedCatalog;
  if (catalog === undefined) {
    try {
      catalog = JSON.parse(readFileSync(catalogPath, "utf8"));
    } catch (error) {
      return {
        ready: false,
        path: catalogPath,
        reason: `authoritative model catalog cannot be read: ${error instanceof Error ? error.message : String(error)}`,
        models: new Map(),
      };
    }
  }
  const fetchedAtMs = Date.parse(String(catalog?.fetched_at ?? ""));
  if (!Number.isFinite(fetchedAtMs) || !Array.isArray(catalog?.models)) {
    return {
      ready: false,
      path: catalogPath,
      reason: "authoritative model catalog has an unsupported shape",
      models: new Map(),
    };
  }
  if (fetchedAtMs > nowMs + maxFutureSkewMs) {
    return {
      ready: false,
      path: catalogPath,
      reason: "authoritative model catalog is future-dated",
      models: new Map(),
    };
  }
  if (nowMs - fetchedAtMs > maxAgeMs) {
    return {
      ready: false,
      path: catalogPath,
      reason: `authoritative model catalog is older than ${maxAgeMs.toLocaleString()} ms`,
      models: new Map(),
    };
  }
  const models = new Map();
  for (const model of catalog.models) {
    if (
      typeof model?.slug !== "string" ||
      model.visibility !== "list" ||
      !Array.isArray(model.supported_reasoning_levels)
    ) {
      continue;
    }
    models.set(
      model.slug,
      new Set(
        model.supported_reasoning_levels
          .map((level) => (typeof level === "string" ? level : level?.effort))
          .filter((effort) => typeof effort === "string"),
      ),
    );
  }
  if (models.size === 0) {
    return {
      ready: false,
      path: catalogPath,
      reason: "authoritative model catalog advertises no callable models",
      models,
    };
  }
  return { ready: true, path: catalogPath, reason: "", models };
}

function parsePositiveScheduleInteger(value, field, minimum, maximum) {
  if (!/^[0-9]+$/.test(value)) throw new Error(`${field} must be an integer.`);
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(
      `${field} must be between ${minimum.toLocaleString()} and ${maximum.toLocaleString()}.`,
    );
  }
  return parsed;
}

export function validateSavedSchedule(value, kind) {
  const raw = String(value ?? "").trim();
  if (raw === "") throw new Error("schedule is missing");
  if (/DTSTART|COUNT|UNTIL/i.test(raw)) {
    throw new Error("schedule must not contain DTSTART, COUNT, or UNTIL");
  }
  const normalized = raw.replace(/^RRULE:/i, "");
  const fields = {};
  for (const segment of normalized.split(";")) {
    const match = segment.match(/^([A-Z]+)=(.+)$/);
    if (!match || Object.hasOwn(fields, match[1])) {
      throw new Error("schedule contains an invalid or duplicate RRULE field");
    }
    fields[match[1]] = match[2];
  }
  const kindContract = HOST_SCHEDULE_CONTRACT[kind];
  const frequencyContract = kindContract?.[fields.FREQ];
  if (!frequencyContract) {
    throw new Error(
      `${kind} schedule has unsupported frequency ${fields.FREQ ?? "missing"}`,
    );
  }
  const allowedFields = new Set(frequencyContract.allowed);
  const unsupported = Object.keys(fields).filter(
    (field) => !allowedFields.has(field),
  );
  if (unsupported.length > 0) {
    throw new Error(
      `schedule contains unsupported RRULE fields: ${unsupported.join(", ")}`,
    );
  }
  if (fields.INTERVAL !== undefined) {
    parsePositiveScheduleInteger(fields.INTERVAL, "INTERVAL", 1, 10_000);
  }
  if (fields.BYHOUR !== undefined) {
    parsePositiveScheduleInteger(fields.BYHOUR, "BYHOUR", 0, 23);
  }
  if (fields.BYMINUTE !== undefined) {
    parsePositiveScheduleInteger(fields.BYMINUTE, "BYMINUTE", 0, 59);
  }
  if (fields.BYDAY !== undefined) {
    const days = fields.BYDAY.split(",");
    if (
      days.length === 0 ||
      new Set(days).size !== days.length ||
      days.some(
        (day) => !["MO", "TU", "WE", "TH", "FR", "SA", "SU"].includes(day),
      )
    ) {
      throw new Error("BYDAY must contain unique weekday codes");
    }
  }
  const missing = frequencyContract.required.filter(
    (field) => fields[field] === undefined,
  );
  if (missing.length > 0) {
    throw new Error(
      `${kind} ${fields.FREQ.toLowerCase()} schedule requires ${missing.join(", ")}`,
    );
  }
  return { normalized, fields };
}

export function readProjectRegistrySnapshot(
  descriptor,
  expectedSize,
  { reader = readSync } = {},
) {
  if (
    !Number.isSafeInteger(expectedSize) ||
    expectedSize <= 0 ||
    expectedSize > MAX_CODEX_GLOBAL_STATE_BYTES
  ) {
    throw new Error("project registry size is outside its bound");
  }
  const snapshot = Buffer.alloc(expectedSize + 1);
  let totalBytesRead = 0;
  while (totalBytesRead < snapshot.length) {
    const bytesRead = reader(
      descriptor,
      snapshot,
      totalBytesRead,
      snapshot.length - totalBytesRead,
      totalBytesRead,
    );
    if (
      !Number.isSafeInteger(bytesRead) ||
      bytesRead < 0 ||
      bytesRead > snapshot.length - totalBytesRead
    ) {
      throw new Error("project registry reader returned an invalid byte count");
    }
    if (bytesRead === 0) break;
    totalBytesRead += bytesRead;
  }
  if (totalBytesRead !== expectedSize) {
    throw new Error("project registry changed during its bounded read");
  }
  return snapshot.subarray(0, expectedSize).toString("utf8");
}

function registeredCodexProjectRoot(codexHome, projectId, expectedProjectRoot) {
  if (!CODEX_LOCAL_PROJECT_ID_PATTERN.test(projectId)) {
    return {
      ready: false,
      reason: "target project id is not a supported local project reference",
    };
  }
  const registryPath = path.join(
    path.resolve(codexHome),
    ".codex-global-state.json",
  );
  let registry;
  let registryHandle;
  try {
    if (
      typeof fsConstants.O_NOFOLLOW !== "number" ||
      typeof fsConstants.O_NONBLOCK !== "number"
    ) {
      throw new Error("safe project registry open flags are unavailable");
    }
    registryHandle = openSync(
      registryPath,
      fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW | fsConstants.O_NONBLOCK,
    );
    const metadata = fstatSync(registryHandle);
    const currentUid =
      typeof process.getuid === "function" ? process.getuid() : metadata.uid;
    if (
      !metadata.isFile() ||
      metadata.uid !== currentUid ||
      (metadata.mode & 0o022) !== 0 ||
      metadata.size <= 0 ||
      metadata.size > MAX_CODEX_GLOBAL_STATE_BYTES
    ) {
      throw new Error("unsafe project registry");
    }
    registry = JSON.parse(
      readProjectRegistrySnapshot(registryHandle, metadata.size),
    );
  } catch {
    return {
      ready: false,
      reason: "target project registry cannot be read",
    };
  } finally {
    if (registryHandle !== undefined) closeSync(registryHandle);
  }
  const localProjects = registry?.["local-projects"];
  const project =
    localProjects &&
    typeof localProjects === "object" &&
    !Array.isArray(localProjects)
      ? localProjects[projectId]
      : undefined;
  if (
    !project ||
    typeof project !== "object" ||
    Array.isArray(project) ||
    project.id !== projectId ||
    !Array.isArray(project.rootPaths) ||
    project.rootPaths.length !== 1 ||
    typeof project.rootPaths[0] !== "string" ||
    !path.isAbsolute(project.rootPaths[0])
  ) {
    return {
      ready: false,
      reason: "target project id is not registered to one absolute root",
    };
  }
  const registeredProjectRoot = project.rootPaths[0];
  const expectedProjectId = `local-${createHash("sha256")
    .update(registeredProjectRoot, "utf8")
    .digest("hex")
    .slice(0, 32)}`;
  if (projectId !== expectedProjectId) {
    return {
      ready: false,
      reason: "target project id does not match its registered root",
    };
  }
  if (registeredProjectRoot !== expectedProjectRoot) {
    return {
      ready: false,
      reason: "cwds does not match the registered target project root",
    };
  }
  let rootClaimants;
  try {
    rootClaimants = Object.values(localProjects).filter((candidate) => {
      if (
        !candidate ||
        typeof candidate !== "object" ||
        Array.isArray(candidate) ||
        !Array.isArray(candidate.rootPaths) ||
        candidate.rootPaths.length === 0 ||
        candidate.rootPaths.some(
          (candidateRoot) =>
            typeof candidateRoot !== "string" ||
            !path.isAbsolute(candidateRoot),
        )
      ) {
        throw new Error("malformed project claimant");
      }
      return candidate.rootPaths.some((candidateRoot) => {
        try {
          return realpathSync(candidateRoot) === expectedProjectRoot;
        } catch (error) {
          if (error?.code === "ENOENT") return false;
          throw error;
        }
      });
    });
  } catch {
    return {
      ready: false,
      reason: "target project registry cannot establish a unique root",
    };
  }
  if (rootClaimants.length !== 1 || rootClaimants[0] !== project) {
    return {
      ready: false,
      reason: "target project root is not uniquely registered",
    };
  }
  return { ready: true, projectRoot: registeredProjectRoot };
}

function canonicalFreedProjectProblems(target, cwds, codexHome) {
  const problems = [];
  const targetKeys =
    target && typeof target === "object" && !Array.isArray(target)
      ? Object.keys(target).sort()
      : [];
  if (
    targetKeys.join("\n") !== ["project_id", "type"].sort().join("\n") ||
    target.type !== "project" ||
    typeof target.project_id !== "string" ||
    target.project_id.trim() === ""
  ) {
    return ["target must be one project target"];
  }
  let resolvedTarget;
  if (path.isAbsolute(target.project_id)) {
    resolvedTarget = { ready: true, projectRoot: target.project_id };
  } else {
    if (
      !Array.isArray(cwds) ||
      cwds.length !== 1 ||
      typeof cwds[0] !== "string" ||
      !path.isAbsolute(cwds[0])
    ) {
      return ["cwds must contain one absolute target project path"];
    }
    let canonicalCwd;
    try {
      canonicalCwd = realpathSync(cwds[0]);
    } catch {
      return ["cwds target project does not exist"];
    }
    resolvedTarget = registeredCodexProjectRoot(
      codexHome,
      target.project_id,
      canonicalCwd,
    );
  }
  if (!resolvedTarget.ready) return [resolvedTarget.reason];
  let projectRoot = "";
  try {
    projectRoot = realpathSync(resolvedTarget.projectRoot);
  } catch {
    return ["target project does not exist"];
  }
  if (projectRoot !== resolvedTarget.projectRoot) {
    problems.push("target project must use its canonical physical path");
  }
  if (
    !Array.isArray(cwds) ||
    cwds.length !== 1 ||
    cwds[0] !== resolvedTarget.projectRoot ||
    cwds[0] !== projectRoot
  ) {
    problems.push("cwds must contain only the canonical target project path");
  }
  try {
    const environment = {
      DEVELOPER_DIR: "/Library/Developer/CommandLineTools",
      HOME: os.homedir(),
      PATH: "/usr/bin:/bin",
      GIT_CONFIG_GLOBAL: "/dev/null",
      GIT_CONFIG_NOSYSTEM: "1",
    };
    const gitRoot = execFileSync(
      "/usr/bin/git",
      [
        "-c",
        "core.fsmonitor=false",
        "-c",
        "core.hooksPath=/dev/null",
        "-C",
        projectRoot,
        "rev-parse",
        "--show-toplevel",
      ],
      { encoding: "utf8", env: environment, stdio: ["ignore", "pipe", "pipe"] },
    ).trim();
    const origin = execFileSync(
      "/usr/bin/git",
      ["-C", projectRoot, "config", "--local", "--get", "remote.origin.url"],
      { encoding: "utf8", env: environment, stdio: ["ignore", "pipe", "pipe"] },
    ).trim();
    if (gitRoot !== projectRoot)
      problems.push("target project is not its Git worktree root");
    if (
      ![
        `https://github.com/${CANONICAL_REPOSITORY}`,
        `https://github.com/${CANONICAL_REPOSITORY}.git`,
        `git@github.com:${CANONICAL_REPOSITORY}`,
        `git@github.com:${CANONICAL_REPOSITORY}.git`,
      ].includes(origin)
    ) {
      problems.push("target project is not the canonical Freed repository");
    }
  } catch {
    problems.push("target project Git identity cannot be verified");
  }
  return problems;
}

function overlayIssues({ spec, saved, modelCatalog, codexHome }) {
  const issues = [];
  const savedOverlayFields = Object.keys(saved).filter(
    (field) => !["id", "kind", "name", "prompt"].includes(field),
  );
  const unsupportedSavedFields = savedOverlayFields.filter(
    (field) =>
      !spec.localOverlayFields.includes(field) &&
      !(
        ["rrule", "cadence"].includes(field) &&
        spec.localOverlayFields.some((overlayField) =>
          ["rrule", "cadence"].includes(overlayField),
        )
      ),
  );
  for (const field of unsupportedSavedFields) {
    issues.push(
      issue(
        "overlay-field-drift",
        `saved field ${field} is not allowed by the actor specification`,
      ),
    );
  }

  const scheduleField = saved.rrule === undefined ? "cadence" : "rrule";
  if (saved.rrule !== undefined && saved.cadence !== undefined) {
    issues.push(
      issue(
        "schedule-drift",
        "saved automation must not define both rrule and cadence",
      ),
    );
  } else {
    try {
      validateSavedSchedule(saved[scheduleField], spec.kind);
    } catch (error) {
      issues.push(
        issue(
          "schedule-drift",
          error instanceof Error ? error.message : String(error),
        ),
      );
    }
  }

  if (spec.kind === "cron") {
    if (!modelCatalog.ready) {
      issues.push(issue("model-catalog-unavailable", modelCatalog.reason));
    } else if (!modelCatalog.models.has(saved.model)) {
      issues.push(
        issue(
          "model-not-callable",
          `model ${JSON.stringify(saved.model ?? null)} is not advertised by the authoritative Codex model catalog`,
        ),
      );
    } else if (
      !modelCatalog.models.get(saved.model).has(saved.reasoning_effort)
    ) {
      issues.push(
        issue(
          "reasoning-effort-unsupported",
          `reasoning effort ${JSON.stringify(saved.reasoning_effort ?? null)} is not supported by ${saved.model}`,
        ),
      );
    }
    if (!["local", "worktree"].includes(saved.execution_environment)) {
      issues.push(
        issue(
          "execution-environment-drift",
          "cron execution_environment must be local or worktree",
        ),
      );
    } else if (
      MUTATION_AUTHORITIES.has(spec.authority) &&
      saved.execution_environment !== "worktree"
    ) {
      issues.push(
        issue(
          "execution-environment-unsafe",
          `${spec.authority} actors must use worktree execution`,
        ),
      );
    }
    for (const problem of canonicalFreedProjectProblems(
      saved.target,
      saved.cwds,
      codexHome,
    )) {
      issues.push(
        issue(
          problem.startsWith("cwds") ? "cwds-drift" : "target-drift",
          problem,
        ),
      );
    }
  } else {
    if (
      saved.destination !== undefined &&
      saved.destination !== "thread"
    ) {
      issues.push(
        issue(
          "target-drift",
          "heartbeat destination, when set, must be thread",
        ),
      );
    }
    if (
      typeof saved.target_thread_id !== "string" ||
      saved.target_thread_id.trim() === ""
    ) {
      issues.push(
        issue("target-drift", "heartbeat target_thread_id is required"),
      );
    }
  }
  return issues;
}

function issue(code, message) {
  return { code, message };
}

export function auditSavedAutomations({
  specs,
  repoRoot = REPO_ROOT,
  codexHome = process.env.CODEX_HOME || path.join(os.homedir(), ".codex"),
  stateRoot = process.env.FREED_AUTOMATION_STATE_ROOT ||
    path.join(os.homedir(), ".freed", "automation"),
  modelCatalog: suppliedModelCatalog = undefined,
  nowMs = Date.now(),
  launcherAttestor = sharedDefaultLauncherAttestor,
  launcherInspector = sharedInspectRootOwnedExecutable,
  launcherRecordInspector = sharedInspectRootOwnedRecord,
  launcherRecordRoot = ACTOR_LAUNCHER_RECORD_ROOT,
  runtimeFileInspector = sharedInspectRootOwnedRuntimeFile,
  runtimeRoot = ACTOR_RUNTIME_ROOT,
}) {
  const modelCatalog = authoritativeModelCatalog(
    codexHome,
    suppliedModelCatalog,
    { nowMs },
  );
  const records = [];
  for (const spec of specs) {
    const automationPath = path.join(
      codexHome,
      "automations",
      spec.id,
      "automation.toml",
    );
    const promptPath = path.isAbsolute(spec.promptPath)
      ? spec.promptPath
      : path.resolve(repoRoot, spec.promptPath);
    const expectedPrompt = normalizedText(readFileSync(promptPath, "utf8"));
    const credential = sharedActorCredentialReadiness(stateRoot, spec.id);
    const launcher = sharedActorLauncherReadiness(stateRoot, spec.id, {
      credential,
      leaseContract: spec.lease,
      launcherAttestor,
      launcherInspector,
      launcherRecordInspector,
      launcherRecordRoot,
      runtimeFileInspector,
      runtimeRoot,
    });
    const issues = [];
    let saved = {};
    let parsedSavedAutomation = false;

    if (!existsSync(automationPath)) {
      issues.push(
        issue(
          "automation-missing",
          `saved automation is missing at ${automationPath}`,
        ),
      );
    } else {
      try {
        saved = parseSavedAutomationToml(readFileSync(automationPath, "utf8"));
        parsedSavedAutomation = true;
      } catch (error) {
        issues.push(
          issue(
            "automation-unreadable",
            error instanceof Error ? error.message : String(error),
          ),
        );
      }
    }

    for (const field of ["id", "kind", "name"]) {
      if (parsedSavedAutomation && saved[field] !== spec[field]) {
        issues.push(
          issue(
            `${field}-drift`,
            `${field} is ${JSON.stringify(saved[field] ?? null)}, expected ${JSON.stringify(spec[field])}`,
          ),
        );
      }
    }
    if (
      parsedSavedAutomation &&
      normalizedText(saved.prompt) !== expectedPrompt
    ) {
      issues.push(
        issue(
          "prompt-drift",
          `saved prompt does not match ${path.relative(repoRoot, promptPath)}`,
        ),
      );
    }

    if (parsedSavedAutomation) {
      issues.push(...overlayIssues({ spec, saved, modelCatalog, codexHome }));
    }

    const status = String(saved.status ?? "").toUpperCase();
    if (parsedSavedAutomation && !["ACTIVE", "PAUSED"].includes(status)) {
      issues.push(
        issue("status-invalid", "saved status must be ACTIVE or PAUSED"),
      );
    }
    if (status === "ACTIVE" && (!credential.ready || !launcher.ready)) {
      const reasons = [credential, launcher]
        .filter((readiness) => !readiness.ready)
        .map((readiness) => `${readiness.reason} at ${readiness.path}`);
      issues.push(
        issue(
          "active-without-trusted-handoff",
          `ACTIVE actor must be paused because ${reasons.join("; ")}`,
        ),
      );
    }

    records.push({
      id: spec.id,
      automationPath,
      installed: existsSync(automationPath),
      status: status || "PAUSED",
      credential,
      launcher,
      handoffReady: credential.ready && launcher.ready,
      issues,
    });
  }
  return {
    records,
    issueCount: records.reduce((sum, record) => sum + record.issues.length, 0),
    modelCatalog: {
      ready: modelCatalog.ready,
      path: modelCatalog.path,
      reason: modelCatalog.reason,
      callableModels: [...modelCatalog.models.keys()].sort(),
    },
  };
}

export function formatHostAutomationAudit(result) {
  const lines = ["Freed saved automation reconciliation"];
  for (const record of result.records) {
    if (record.issues.length > 0) {
      lines.push(
        `  [FAIL] ${record.id} (${record.status}${record.installed ? "" : ", not installed"})`,
      );
      for (const item of record.issues) {
        lines.push(`    ${item.code}: ${item.message}`);
      }
    } else if (!record.handoffReady) {
      const reasons = [record.credential, record.launcher]
        .filter((readiness) => !readiness.ready)
        .map((readiness) => readiness.reason);
      lines.push(
        `  [PAUSED] ${record.id}: saved contract matches; ${reasons.join("; ")}.`,
      );
    } else {
      lines.push(`  [ok] ${record.id} (${record.status})`);
    }
  }
  lines.push(
    `Summary: ${result.records.length.toLocaleString()} actors, ${result.issueCount.toLocaleString()} reconciliation issue${result.issueCount === 1 ? "" : "s"}. No host files changed.`,
  );
  return `${lines.join("\n")}\n`;
}

function usage() {
  return `Usage: node scripts/validate-host-automations.mjs [options]

Options:
  --codex-home <path>  Defaults to CODEX_HOME or ~/.codex.
  --state-root <path>  Defaults to FREED_AUTOMATION_STATE_ROOT or ~/.freed/automation.
  --json               Print the machine-readable audit.
  --help               Show this help.
`;
}

export function parseArgs(argv) {
  const args = { codexHome: "", stateRoot: "", json: false, help: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--json") {
      args.json = true;
    } else if (arg === "--help" || arg === "-h") {
      args.help = true;
    } else if (arg === "--codex-home" || arg === "--state-root") {
      const value = argv[index + 1];
      if (!value || value.startsWith("--"))
        throw new Error(`${arg} requires a path.`);
      if (arg === "--codex-home") args.codexHome = value;
      else args.stateRoot = value;
      index += 1;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return args;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    process.stdout.write(usage());
    return;
  }
  const specs = validateAutomationSpecs();
  const result = auditSavedAutomations({
    specs,
    ...(args.codexHome ? { codexHome: path.resolve(args.codexHome) } : {}),
    ...(args.stateRoot ? { stateRoot: path.resolve(args.stateRoot) } : {}),
  });
  process.stdout.write(
    args.json
      ? `${JSON.stringify(result, null, 2)}\n`
      : formatHostAutomationAudit(result),
  );
  process.exitCode = result.issueCount > 0 ? 1 : 0;
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
