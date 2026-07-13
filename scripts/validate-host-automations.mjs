#!/usr/bin/env node

import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, lstatSync, readFileSync, realpathSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { validateAutomationSpecs } from "./validate-automation-specs.mjs";

const __filename = fileURLToPath(import.meta.url);
const REPO_ROOT = path.resolve(path.dirname(__filename), "..");
const ACTOR_CREDENTIAL_PURPOSE = "automation-actor-lease";
const ACTOR_LAUNCHER_PURPOSE = "automation-actor-launcher";
const ACTOR_LAUNCHER_HANDOFF = "keychain-to-canonical-lease";
const ACTOR_LAUNCHER_ATTESTATION_PROTOCOL = "freed-actor-launcher-readiness-v1";
const ACTOR_LAUNCHER_ATTESTATION_PURPOSE =
  "automation-actor-launcher-readiness";
const ACTOR_LAUNCHER_RECORD_ROOT =
  "/Library/Application Support/Freed/automation-actor-launchers";
const ACTOR_RUNTIME_ROOT =
  "/Library/Application Support/Freed/automation-actor-runtimes";
const ACTOR_RUNTIME_DIGEST_PROTOCOL = "freed-automation-actor-runtime-v1";
const CANONICAL_REPOSITORY = "freed-project/freed";
const MODEL_CATALOG_MAX_AGE_MS = 24 * 60 * 60 * 1_000;
const MODEL_CATALOG_MAX_FUTURE_SKEW_MS = 5 * 60 * 1_000;
const LAUNCHER_ATTESTATION_TIMEOUT_MS = 5 * 1_000;
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

export function actorCredentialReadiness(stateRoot, actor) {
  const credentialPath = path.join(
    path.resolve(stateRoot),
    "control",
    "actor-credentials",
    `${actor}.json`,
  );
  if (!existsSync(credentialPath)) {
    return {
      ready: false,
      path: credentialPath,
      reason: "credential record is missing",
    };
  }
  let tokenSha256 = "";
  try {
    const stats = lstatSync(credentialPath);
    const currentUid =
      typeof process.getuid === "function" ? process.getuid() : stats.uid;
    if (
      realpathSync(credentialPath) !== credentialPath ||
      !stats.isFile() ||
      stats.isSymbolicLink() ||
      stats.uid !== currentUid ||
      (stats.mode & 0o777) !== 0o600
    ) {
      return {
        ready: false,
        path: credentialPath,
        reason: "credential record is not an owner-held mode 0600 regular file",
      };
    }
    const credential = JSON.parse(readFileSync(credentialPath, "utf8"));
    tokenSha256 = String(credential?.tokenSha256 ?? "");
    if (
      Object.keys(credential).sort().join("\n") !==
        ["actor", "purpose", "schemaVersion", "tokenSha256"]
          .sort()
          .join("\n") ||
      credential?.schemaVersion !== 1 ||
      credential?.actor !== actor ||
      credential?.purpose !== ACTOR_CREDENTIAL_PURPOSE ||
      !/^[0-9a-f]{64}$/.test(tokenSha256)
    ) {
      return {
        ready: false,
        path: credentialPath,
        reason: "credential record identity or digest is invalid",
      };
    }
  } catch (error) {
    return {
      ready: false,
      path: credentialPath,
      reason: `credential record cannot be read: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
  return { ready: true, path: credentialPath, reason: "", tokenSha256 };
}

function inspectRootOwnedRecord(recordPath) {
  try {
    if (
      !path.isAbsolute(recordPath) ||
      realpathSync(recordPath) !== recordPath
    ) {
      return { ready: false, reason: "launcher record path is not canonical" };
    }
    const stats = lstatSync(recordPath);
    if (
      !stats.isFile() ||
      stats.isSymbolicLink() ||
      stats.uid !== 0 ||
      (stats.mode & 0o022) !== 0
    ) {
      return {
        ready: false,
        reason: "launcher record is not root-owned and immutable",
      };
    }
    let current = path.dirname(recordPath);
    while (current !== path.dirname(current)) {
      const parent = lstatSync(current);
      if (
        !parent.isDirectory() ||
        parent.isSymbolicLink() ||
        parent.uid !== 0 ||
        (parent.mode & 0o022) !== 0
      ) {
        return {
          ready: false,
          reason:
            "launcher record has a non-root-owned or writable directory in its path",
        };
      }
      current = path.dirname(current);
    }
  } catch (error) {
    return {
      ready: false,
      reason: `launcher record cannot be inspected: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
  return { ready: true, reason: "" };
}

function sha256(filePath) {
  return createHash("sha256").update(readFileSync(filePath)).digest("hex");
}

function actorRuntimeDigest(record) {
  return createHash("sha256")
    .update(
      [
        ACTOR_RUNTIME_DIGEST_PROTOCOL,
        `node:${record.nodeSha256}`,
        `automation-control.mjs:${record.controlEntrySha256}`,
        `lib/automation-control.mjs:${record.controlLibrarySha256}`,
        "",
      ].join("\n"),
    )
    .digest("hex");
}

function inspectRootOwnedExecutable(launcherPath) {
  try {
    if (
      !path.isAbsolute(launcherPath) ||
      realpathSync(launcherPath) !== launcherPath
    ) {
      return {
        ready: false,
        reason: "launcher path is not a canonical absolute path",
      };
    }
    const launcherStats = lstatSync(launcherPath);
    if (
      !launcherStats.isFile() ||
      launcherStats.isSymbolicLink() ||
      launcherStats.uid !== 0 ||
      (launcherStats.mode & 0o022) !== 0 ||
      (launcherStats.mode & 0o111) === 0
    ) {
      return {
        ready: false,
        reason: "launcher is not a root-owned immutable executable",
      };
    }
    let current = path.dirname(launcherPath);
    while (current !== path.dirname(current)) {
      const stats = lstatSync(current);
      if (
        !stats.isDirectory() ||
        stats.isSymbolicLink() ||
        stats.uid !== 0 ||
        (stats.mode & 0o022) !== 0
      ) {
        return {
          ready: false,
          reason:
            "launcher has a non-root-owned or writable directory in its path",
        };
      }
      current = path.dirname(current);
    }
  } catch (error) {
    return {
      ready: false,
      reason: `launcher cannot be inspected: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
  return { ready: true, reason: "" };
}

function isStrictChildPath(parentPath, candidatePath) {
  const relative = path.relative(parentPath, candidatePath);
  return (
    relative !== "" &&
    relative !== ".." &&
    !relative.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(relative)
  );
}

export function inspectRootOwnedRuntimeFile(
  runtimePath,
  runtimeRoot = ACTOR_RUNTIME_ROOT,
  { requiredUid = 0 } = {},
) {
  try {
    const resolvedRoot = path.resolve(runtimeRoot);
    if (
      !path.isAbsolute(runtimeRoot) ||
      realpathSync(resolvedRoot) !== resolvedRoot
    ) {
      return {
        ready: false,
        reason: "automation actor runtime root is not canonical",
      };
    }
    if (
      !path.isAbsolute(runtimePath) ||
      realpathSync(runtimePath) !== runtimePath ||
      !isStrictChildPath(resolvedRoot, runtimePath)
    ) {
      return {
        ready: false,
        reason:
          "runtime pin is not a canonical path under the automation actor runtime root",
      };
    }
    const runtimeStats = lstatSync(runtimePath);
    if (
      !runtimeStats.isFile() ||
      runtimeStats.isSymbolicLink() ||
      runtimeStats.uid !== requiredUid ||
      (runtimeStats.mode & 0o022) !== 0
    ) {
      return {
        ready: false,
        reason: "runtime pin is not a root-owned immutable regular file",
      };
    }
    let current = path.dirname(runtimePath);
    while (true) {
      const stats = lstatSync(current);
      if (
        !stats.isDirectory() ||
        stats.isSymbolicLink() ||
        stats.uid !== requiredUid ||
        (stats.mode & 0o022) !== 0
      ) {
        return {
          ready: false,
          reason:
            "runtime pin has a non-root-owned or writable directory in its runtime path",
        };
      }
      if (current === resolvedRoot) break;
      const parent = path.dirname(current);
      if (parent === current || !isStrictChildPath(resolvedRoot, current)) {
        return {
          ready: false,
          reason:
            "runtime pin escapes the root-owned automation actor runtime tree",
        };
      }
      current = parent;
    }
  } catch (error) {
    return {
      ready: false,
      reason: `runtime pin cannot be inspected: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
  return { ready: true, reason: "" };
}

function defaultKeychainLookup({ service, account }) {
  if (process.platform !== "darwin") {
    return {
      ready: false,
      reason: "Keychain handoff is supported only on macOS",
    };
  }
  const result = spawnSync(
    "/usr/bin/security",
    ["find-generic-password", "-s", service, "-a", account],
    { encoding: "utf8" },
  );
  return result.status === 0
    ? { ready: true, reason: "" }
    : { ready: false, reason: "Keychain actor credential is missing" };
}

function defaultLauncherAttestor(request) {
  const result = spawnSync(
    request.launcherPath,
    [
      "--attest-readiness",
      "--protocol",
      ACTOR_LAUNCHER_ATTESTATION_PROTOCOL,
      "--actor",
      request.actor,
      "--state-root",
      request.stateRoot,
      "--lease-name",
      request.leaseName,
      "--max-lifetime-ms",
      String(request.maxLeaseLifetimeMs),
      "--credential-sha256",
      request.credentialSha256,
      "--keychain-service",
      request.keychainService,
      "--keychain-account",
      request.keychainAccount,
    ],
    {
      cwd: "/",
      encoding: "utf8",
      env: { PATH: "/usr/bin:/bin", LANG: "C", LC_ALL: "C" },
      maxBuffer: 64 * 1_024,
      stdio: ["ignore", "pipe", "pipe"],
      timeout: LAUNCHER_ATTESTATION_TIMEOUT_MS,
    },
  );
  if (result.error) {
    return {
      ready: false,
      reason: `trusted launcher readiness attestation failed: ${result.error.message}`,
    };
  }
  if (result.status !== 0) {
    return {
      ready: false,
      reason: `trusted launcher readiness attestation exited with status ${String(result.status)}`,
    };
  }
  try {
    return { ready: true, reason: "", attestation: JSON.parse(result.stdout) };
  } catch {
    return {
      ready: false,
      reason:
        "trusted launcher readiness attestation did not return one JSON object",
    };
  }
}

function validateLauncherAttestation(attestation, expected) {
  const expectedKeys = [
    "actor",
    "canonicalLeaseReady",
    "credentialDigestVerified",
    "credentialSha256",
    "handoff",
    "keychainAccount",
    "keychainService",
    "leaseName",
    "maxLeaseLifetimeMs",
    "mutatesState",
    "protocol",
    "purpose",
    "schemaVersion",
    "stateRoot",
  ];
  if (
    !attestation ||
    typeof attestation !== "object" ||
    Array.isArray(attestation) ||
    Object.keys(attestation).sort().join("\n") !==
      expectedKeys.sort().join("\n") ||
    attestation.schemaVersion !== 1 ||
    attestation.protocol !== ACTOR_LAUNCHER_ATTESTATION_PROTOCOL ||
    attestation.purpose !== ACTOR_LAUNCHER_ATTESTATION_PURPOSE ||
    attestation.actor !== expected.actor ||
    attestation.stateRoot !== expected.stateRoot ||
    attestation.leaseName !== expected.leaseName ||
    attestation.maxLeaseLifetimeMs !== expected.maxLeaseLifetimeMs ||
    attestation.credentialSha256 !== expected.credentialSha256 ||
    attestation.handoff !== ACTOR_LAUNCHER_HANDOFF ||
    attestation.keychainService !== expected.keychainService ||
    attestation.keychainAccount !== expected.keychainAccount ||
    attestation.credentialDigestVerified !== true ||
    attestation.canonicalLeaseReady !== true ||
    attestation.mutatesState !== false
  ) {
    return {
      ready: false,
      reason:
        "trusted launcher readiness attestation does not match the actor handoff contract",
    };
  }
  return { ready: true, reason: "" };
}

export function actorLauncherReadiness(
  stateRoot,
  actor,
  {
    credential = undefined,
    leaseContract = undefined,
    launcherAttestor = defaultLauncherAttestor,
    launcherInspector = inspectRootOwnedExecutable,
    launcherRecordInspector = inspectRootOwnedRecord,
    launcherRecordRoot = ACTOR_LAUNCHER_RECORD_ROOT,
    runtimeFileInspector = inspectRootOwnedRuntimeFile,
    runtimeRoot = ACTOR_RUNTIME_ROOT,
    keychainLookup = defaultKeychainLookup,
  } = {},
) {
  const recordPath = path.join(
    path.resolve(launcherRecordRoot),
    `${actor}.json`,
  );
  if (!existsSync(recordPath)) {
    return {
      ready: false,
      path: recordPath,
      reason: "trusted launcher record is missing",
    };
  }
  try {
    const recordInspection = launcherRecordInspector(recordPath);
    if (!recordInspection.ready) {
      return {
        ready: false,
        path: recordPath,
        reason: recordInspection.reason,
      };
    }
    const record = JSON.parse(readFileSync(recordPath, "utf8"));
    let canonicalStateRoot = "";
    try {
      canonicalStateRoot = realpathSync(path.resolve(stateRoot));
    } catch {
      return {
        ready: false,
        path: recordPath,
        reason: "automation state root is missing or not canonical",
      };
    }
    let canonicalRuntimeRoot = "";
    try {
      const resolvedRuntimeRoot = path.resolve(runtimeRoot);
      if (
        !path.isAbsolute(runtimeRoot) ||
        realpathSync(resolvedRuntimeRoot) !== resolvedRuntimeRoot
      ) {
        throw new Error("runtime root is not canonical");
      }
      canonicalRuntimeRoot = resolvedRuntimeRoot;
    } catch {
      return {
        ready: false,
        path: recordPath,
        reason: "automation actor runtime root is missing or not canonical",
      };
    }
    if (
      !leaseContract ||
      typeof leaseContract.name !== "string" ||
      !Number.isSafeInteger(leaseContract.maxLifetimeMs) ||
      leaseContract.maxLifetimeMs <= 0
    ) {
      return {
        ready: false,
        path: recordPath,
        reason: "checked-in actor lease contract is unavailable",
      };
    }
    const expectedKeys = [
      "actor",
      "attestationProtocol",
      "controlEntryPath",
      "controlEntrySha256",
      "controlLibraryPath",
      "controlLibrarySha256",
      "handoff",
      "keychainAccount",
      "keychainService",
      "leaseName",
      "launcherPath",
      "launcherSha256",
      "maxLeaseLifetimeMs",
      "nodePath",
      "nodeSha256",
      "purpose",
      "schemaVersion",
      "stateRoot",
    ];
    if (
      Object.keys(record).sort().join("\n") !==
        expectedKeys.sort().join("\n") ||
      record.schemaVersion !== 1 ||
      record.actor !== actor ||
      record.purpose !== ACTOR_LAUNCHER_PURPOSE ||
      record.handoff !== ACTOR_LAUNCHER_HANDOFF ||
      record.attestationProtocol !== ACTOR_LAUNCHER_ATTESTATION_PROTOCOL ||
      record.keychainService !== "freed-automation-actor" ||
      record.keychainAccount !== actor ||
      record.stateRoot !== canonicalStateRoot ||
      record.leaseName !== leaseContract.name ||
      record.maxLeaseLifetimeMs !== leaseContract.maxLifetimeMs ||
      typeof record.launcherPath !== "string" ||
      !/^[0-9a-f]{64}$/.test(String(record.launcherSha256 ?? "")) ||
      typeof record.nodePath !== "string" ||
      !/^[0-9a-f]{64}$/.test(String(record.nodeSha256 ?? "")) ||
      typeof record.controlEntryPath !== "string" ||
      !/^[0-9a-f]{64}$/.test(String(record.controlEntrySha256 ?? "")) ||
      typeof record.controlLibraryPath !== "string" ||
      !/^[0-9a-f]{64}$/.test(String(record.controlLibrarySha256 ?? ""))
    ) {
      return {
        ready: false,
        path: recordPath,
        reason:
          "trusted launcher record identity or handoff contract is invalid",
      };
    }
    if (
      !credential?.ready ||
      !/^[0-9a-f]{64}$/.test(String(credential?.tokenSha256 ?? ""))
    ) {
      return {
        ready: false,
        path: recordPath,
        reason: "credential digest must be ready before launcher attestation",
      };
    }
    const launcher = launcherInspector(record.launcherPath);
    if (!launcher.ready) {
      return { ready: false, path: recordPath, reason: launcher.reason };
    }
    if (sha256(record.launcherPath) !== record.launcherSha256) {
      return {
        ready: false,
        path: recordPath,
        reason: "trusted launcher digest does not match",
      };
    }
    const runtimePins = [
      {
        label: "node",
        path: record.nodePath,
        sha256: record.nodeSha256,
      },
      {
        label: "automation control entry",
        path: record.controlEntryPath,
        sha256: record.controlEntrySha256,
      },
      {
        label: "automation control library",
        path: record.controlLibraryPath,
        sha256: record.controlLibrarySha256,
      },
    ];
    for (const pin of runtimePins) {
      if (
        !path.isAbsolute(pin.path) ||
        realpathSync(pin.path) !== pin.path ||
        !isStrictChildPath(canonicalRuntimeRoot, pin.path)
      ) {
        return {
          ready: false,
          path: recordPath,
          reason: `${pin.label} pin is not a canonical path under the automation actor runtime root`,
        };
      }
      const runtimeFile = runtimeFileInspector(pin.path, canonicalRuntimeRoot);
      if (!runtimeFile.ready) {
        return {
          ready: false,
          path: recordPath,
          reason: `${pin.label} pin is invalid: ${runtimeFile.reason}`,
        };
      }
      if (sha256(pin.path) !== pin.sha256) {
        return {
          ready: false,
          path: recordPath,
          reason: `${pin.label} pin digest does not match`,
        };
      }
    }
    const nodeRelativePath = path.relative(
      canonicalRuntimeRoot,
      record.nodePath,
    );
    const runtimePathParts = nodeRelativePath.split(path.sep);
    const runtimeDigest = runtimePathParts[0] ?? "";
    const expectedRuntimePaths = {
      nodePath: path.join(canonicalRuntimeRoot, runtimeDigest, "node"),
      controlEntryPath: path.join(
        canonicalRuntimeRoot,
        runtimeDigest,
        "automation-control.mjs",
      ),
      controlLibraryPath: path.join(
        canonicalRuntimeRoot,
        runtimeDigest,
        "lib",
        "automation-control.mjs",
      ),
    };
    if (
      !/^[0-9a-f]{64}$/.test(runtimeDigest) ||
      runtimePathParts.length !== 2 ||
      record.nodePath !== expectedRuntimePaths.nodePath ||
      record.controlEntryPath !== expectedRuntimePaths.controlEntryPath ||
      record.controlLibraryPath !== expectedRuntimePaths.controlLibraryPath ||
      runtimeDigest !== actorRuntimeDigest(record)
    ) {
      return {
        ready: false,
        path: recordPath,
        reason:
          "trusted launcher record runtime pins do not share one content-addressed runtime",
      };
    }
    const keychain = keychainLookup({
      service: record.keychainService,
      account: record.keychainAccount,
    });
    if (!keychain.ready) {
      return { ready: false, path: recordPath, reason: keychain.reason };
    }
    const expectedAttestation = {
      actor,
      stateRoot: canonicalStateRoot,
      leaseName: leaseContract.name,
      maxLeaseLifetimeMs: leaseContract.maxLifetimeMs,
      credentialSha256: credential.tokenSha256,
      keychainService: record.keychainService,
      keychainAccount: record.keychainAccount,
    };
    const attestationResult = launcherAttestor({
      launcherPath: record.launcherPath,
      ...expectedAttestation,
    });
    if (!attestationResult.ready) {
      return {
        ready: false,
        path: recordPath,
        reason: attestationResult.reason,
      };
    }
    const attestation = validateLauncherAttestation(
      attestationResult.attestation,
      expectedAttestation,
    );
    if (!attestation.ready) {
      return { ready: false, path: recordPath, reason: attestation.reason };
    }
    return {
      ready: true,
      path: recordPath,
      reason: "",
      launcherPath: record.launcherPath,
      handoff: record.handoff,
      leaseName: record.leaseName,
      maxLeaseLifetimeMs: record.maxLeaseLifetimeMs,
      runtimeRoot: canonicalRuntimeRoot,
      nodePath: record.nodePath,
      controlEntryPath: record.controlEntryPath,
      controlLibraryPath: record.controlLibraryPath,
    };
  } catch (error) {
    return {
      ready: false,
      path: recordPath,
      reason: `trusted launcher record cannot be read: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
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

function canonicalFreedProjectProblems(target, cwds) {
  const problems = [];
  const targetKeys =
    target && typeof target === "object" && !Array.isArray(target)
      ? Object.keys(target).sort()
      : [];
  if (
    targetKeys.join("\n") !== ["project_id", "type"].sort().join("\n") ||
    target.type !== "project" ||
    typeof target.project_id !== "string" ||
    !path.isAbsolute(target.project_id)
  ) {
    return ["target must be one absolute project target"];
  }
  let projectRoot = "";
  try {
    projectRoot = realpathSync(target.project_id);
  } catch {
    return ["target project does not exist"];
  }
  if (projectRoot !== target.project_id) {
    problems.push("target project must use its canonical physical path");
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
  if (!Array.isArray(cwds) || cwds.length !== 1 || cwds[0] !== projectRoot) {
    problems.push("cwds must contain only the canonical target project path");
  }
  return problems;
}

function overlayIssues({ spec, saved, modelCatalog }) {
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
    )) {
      issues.push(
        issue(
          problem.startsWith("cwds") ? "cwds-drift" : "target-drift",
          problem,
        ),
      );
    }
  } else {
    if (saved.destination !== "thread") {
      issues.push(
        issue("target-drift", "heartbeat destination must be thread"),
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
  launcherAttestor = defaultLauncherAttestor,
  launcherInspector = inspectRootOwnedExecutable,
  launcherRecordInspector = inspectRootOwnedRecord,
  launcherRecordRoot = ACTOR_LAUNCHER_RECORD_ROOT,
  runtimeFileInspector = inspectRootOwnedRuntimeFile,
  runtimeRoot = ACTOR_RUNTIME_ROOT,
  keychainLookup = defaultKeychainLookup,
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
    const credential = actorCredentialReadiness(stateRoot, spec.id);
    const launcher = actorLauncherReadiness(stateRoot, spec.id, {
      credential,
      leaseContract: spec.lease,
      launcherAttestor,
      launcherInspector,
      launcherRecordInspector,
      launcherRecordRoot,
      runtimeFileInspector,
      runtimeRoot,
      keychainLookup,
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
      issues.push(...overlayIssues({ spec, saved, modelCatalog }));
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
