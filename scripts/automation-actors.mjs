#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  ACTOR_LAUNCHER_ATTESTATION_PROTOCOL,
  ACTOR_LAUNCHER_HANDOFF,
  ACTOR_LAUNCHER_PURPOSE,
  ACTOR_LAUNCHER_RECORD_ROOT,
  ACTOR_RUNTIME_ROOT,
  LAUNCHER_ATTESTATION_TIMEOUT_MS,
  actorLauncherReadiness,
  defaultLauncherAttestor,
  inspectRootOwnedRecord,
  readInstalledActorBinding,
  runtimeDigestForPins as sharedRuntimeDigestForPins,
  sha256File,
  validateActorBindingRecord,
} from "./lib/automation-actor-readiness.mjs";

const __filename = fileURLToPath(import.meta.url);
const REPO_ROOT = path.resolve(path.dirname(__filename), "..");
const DEFAULT_LAUNCHER_ROOT = ACTOR_LAUNCHER_RECORD_ROOT;
const DEFAULT_RUNTIME_ROOT = ACTOR_RUNTIME_ROOT;
const LAUNCHER_PURPOSE = ACTOR_LAUNCHER_PURPOSE;
const LAUNCHER_HANDOFF = ACTOR_LAUNCHER_HANDOFF;
const ATTESTATION_PROTOCOL = ACTOR_LAUNCHER_ATTESTATION_PROTOCOL;
const MAX_LEASE_LIFETIME_MS = 30 * 60 * 1_000;
const LEASE_TTL_SECONDS = 30 * 60;
const MAX_LAUNCHER_HANDOFF_BYTES = 16 * 1_024;
// The native launcher bounds two acquire attempts, two exact-token release
// attempts, and two absence inspections to a 65-second lifecycle. Keep the
// caller bound above that complete recovery budget so SIGKILL cannot preempt
// an active bounded child or discard its retained lease token.
const NATIVE_LAUNCHER_LIFECYCLE_BUDGET_MS = 65_000;
const LAUNCHER_ACQUIRE_TIMEOUT_MS =
  NATIVE_LAUNCHER_LIFECYCLE_BUDGET_MS + 10_000;
const CONTROL_LIFECYCLE_TIMEOUT_MS = 15_000;
const LIFECYCLE_LOCK_STALE_MS = 30 * 1_000;
const LIFECYCLE_LOCK_PROTOCOL = "freed-automation-actor-lifecycle-lock-v1";
const LIFECYCLE_LOCK_DIRECTORY = "automation-actor-lifecycle-v2.lock";
const LIFECYCLE_LOCK_RECORD = "owner.json";
const MAX_LIFECYCLE_LOCK_RECORD_BYTES = 4 * 1_024;
const RESERVED_ACTORS = new Set(["freed-owner", "freed-pr-publisher"]);

export const AUTOMATION_ACTORS = Object.freeze({
  "freed-runtime-observer": Object.freeze({
    leaseName: "runtime-observer",
  }),
  "freed-stability-controller": Object.freeze({
    leaseName: "stability-controller",
  }),
  "freed-scaffolding-maintainer": Object.freeze({
    leaseName: "scaffolding-writer",
  }),
  "freed-nightly-runner": Object.freeze({
    leaseName: "nightly-writer",
  }),
  "freed-release-verifier": Object.freeze({
    leaseName: "release-verifier",
  }),
});

export const AUTOMATION_ACTOR_IDS = Object.freeze(
  Object.keys(AUTOMATION_ACTORS),
);

export class AutomationActorsError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "AutomationActorsError";
    this.code = code;
  }
}

function fail(code, message) {
  throw new AutomationActorsError(code, message);
}

function usage() {
  return `Usage:
  node scripts/automation-actors.mjs provision (--actor <actor> | --all) [--state-root <path>]
  node scripts/automation-actors.mjs revoke (--actor <actor> | --all) [--state-root <path>]
  node scripts/automation-actors.mjs verify (--actor <actor> | --all) [--state-root <path>]
  node scripts/automation-actors.mjs acquire --actor <actor> [--state-root <path>]
  node scripts/automation-actors.mjs accept-host --all [--state-root <path>]

Supported actors:
  ${AUTOMATION_ACTOR_IDS.join("\n  ")}
`;
}

function takeOptions(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (flag === "--help" || flag === "-h") {
      options.help = true;
      continue;
    }
    if (!flag.startsWith("--")) {
      fail("invalid_argument", `Unexpected argument: ${flag}`);
    }
    if (!["--actor", "--state-root", "--all"].includes(flag)) {
      fail("invalid_argument", `Unexpected option: ${flag}`);
    }
    if (flag === "--all") {
      if (options.all === true) {
        fail("invalid_argument", "--all may only be provided once.");
      }
      options.all = true;
      continue;
    }
    const value = argv[index + 1];
    if (value === undefined || value.startsWith("--")) {
      fail("invalid_argument", `${flag} requires a value.`);
    }
    const key = flag === "--actor" ? "actor" : "stateRoot";
    if (Object.hasOwn(options, key)) {
      fail("invalid_argument", `${flag} may only be provided once.`);
    }
    options[key] = value;
    index += 1;
  }
  return options;
}

function validateActor(actor) {
  if (typeof actor !== "string" || actor.length === 0) {
    fail("invalid_actor", "--actor is required.");
  }
  if (RESERVED_ACTORS.has(actor)) {
    fail(
      "reserved_actor",
      `${actor} is reserved and cannot be managed by this orchestrator.`,
    );
  }
  if (actor === "all") {
    fail("invalid_actor", "Use --all instead of --actor all.");
  }
  if (!Object.hasOwn(AUTOMATION_ACTORS, actor)) {
    fail("invalid_actor", `Unsupported automation actor: ${actor}`);
  }
  return actor;
}

export function parseCommand(argv) {
  if (argv.length === 0 || argv.includes("--help") || argv.includes("-h")) {
    return { help: true };
  }
  const [action, ...rest] = argv;
  if (
    !["provision", "revoke", "verify", "acquire", "accept-host"].includes(
      action,
    )
  ) {
    fail("invalid_action", `Unsupported action: ${String(action)}`);
  }
  const options = takeOptions(rest);
  if (options.all && options.actor) {
    fail("invalid_argument", "--all and --actor are mutually exclusive.");
  }
  if (options.all && action === "acquire") {
    fail("invalid_actor", "acquire requires exactly one actor.");
  }
  if (action === "accept-host" && !options.all) {
    fail("invalid_actor", "accept-host requires --all.");
  }
  if (!options.all && !options.actor) {
    fail("invalid_actor", "--actor or --all is required.");
  }
  const actor = options.all ? "all" : validateActor(options.actor);
  return { action, actor, stateRoot: options.stateRoot };
}

function sanitizedEnvironment(env) {
  const safe = {
    PATH: "/usr/bin:/bin:/usr/sbin:/sbin",
    LANG: "C",
    LC_ALL: "C",
  };
  for (const name of ["HOME", "USER", "LOGNAME"]) {
    if (typeof env[name] === "string" && env[name] !== "") {
      safe[name] = env[name];
    }
  }
  return safe;
}

export function defaultRunner(executable, args, options) {
  return spawnSync(executable, args, {
    cwd: options.cwd,
    env: options.env,
    encoding: "utf8",
    maxBuffer: 256 * 1_024,
    stdio: [options.stdin ?? "inherit", "pipe", "pipe"],
    ...(options.timeoutMs === undefined
      ? {}
      : { timeout: options.timeoutMs, killSignal: "SIGKILL" }),
  });
}

function normalizedRunResult(result) {
  return {
    status: result?.status,
    error: result?.error,
    stdout: String(result?.stdout ?? ""),
  };
}

function runChecked(
  dependencies,
  executable,
  args,
  {
    cwd = "/",
    purpose = "command",
    timeoutMs = undefined,
    additionalEnv = {},
    stdin = "inherit",
    onFailure = undefined,
  } = {},
) {
  const result = normalizedRunResult(
    dependencies.runner(executable, args, {
      cwd,
      env: {
        ...sanitizedEnvironment(dependencies.env),
        ...additionalEnv,
      },
      timeoutMs,
      killSignal: timeoutMs === undefined ? undefined : "SIGKILL",
      stdin,
    }),
  );
  if (result.error || result.status !== 0) {
    onFailure?.(result);
    if (result.error?.code === "ETIMEDOUT") {
      const bound = Number.isSafeInteger(timeoutMs)
        ? `${timeoutMs.toLocaleString()} ms`
        : "its configured time bound";
      fail("command_timeout", `${purpose} exceeded ${bound}.`);
    }
    const status = Number.isInteger(result.status)
      ? ` with status ${result.status.toLocaleString()}`
      : "";
    fail("command_failed", `${purpose} failed${status}.`);
  }
  return result.stdout.trim();
}

function runGit(dependencies, args) {
  return runChecked(dependencies, "/usr/bin/git", args, {
    cwd: dependencies.repoRoot,
    purpose: "Git repository inspection",
  });
}

function defaultRepositoryInspector(dependencies) {
  return {
    topLevel: runGit(dependencies, ["rev-parse", "--show-toplevel"]),
    branch: runGit(dependencies, ["branch", "--show-current"]),
    head: runGit(dependencies, ["rev-parse", "HEAD"]),
    originDev: runGit(dependencies, ["rev-parse", "origin/dev"]),
    status: runGit(dependencies, [
      "status",
      "--porcelain=v1",
      "--untracked-files=all",
    ]),
  };
}

export function assertProvisioningReady({
  platform,
  uid,
  repository,
  repoRoot,
}) {
  if (platform !== "darwin") {
    fail(
      "unsupported_platform",
      "Automation actors can be provisioned only on macOS.",
    );
  }
  if (!Number.isSafeInteger(uid) || uid <= 0) {
    fail("invalid_owner", "Provisioning must run as the non-root owner.");
  }
  if (
    repository.topLevel !== repoRoot ||
    repository.branch !== "dev" ||
    repository.head !== repository.originDev ||
    repository.status !== ""
  ) {
    fail(
      "unsafe_checkout",
      "Provisioning requires a clean dev checkout at the exact origin/dev commit.",
    );
  }
}

function assertOwnerHost(dependencies) {
  if (dependencies.platform !== "darwin") {
    fail(
      "unsupported_platform",
      "Automation actor host commands require macOS.",
    );
  }
  if (!Number.isSafeInteger(dependencies.uid) || dependencies.uid <= 0) {
    fail(
      "invalid_owner",
      "Automation actor host commands must run as the non-root owner.",
    );
  }
}

function canonicalStateRoot(
  rawStateRoot,
  dependencies,
  { createIfMissing = false } = {},
) {
  const candidate =
    rawStateRoot ??
    dependencies.env.FREED_AUTOMATION_STATE_ROOT ??
    path.join(dependencies.homeDir, ".freed", "automation");
  if (!path.isAbsolute(candidate)) {
    fail("invalid_state_root", "The automation state root must be absolute.");
  }
  try {
    const resolved = path.resolve(candidate);
    if (!existsSync(resolved)) {
      if (!createIfMissing) {
        fail(
          "invalid_state_root",
          "The automation state root must already exist.",
        );
      }
      mkdirSync(resolved, { recursive: true, mode: 0o700 });
      chmodSync(resolved, 0o700);
    }
    const unresolvedStats = lstatSync(resolved);
    if (unresolvedStats.isSymbolicLink()) {
      fail(
        "invalid_state_root",
        "The automation state root cannot be a symbolic link.",
      );
    }
    const canonical = realpathSync(resolved);
    if (canonical !== resolved) {
      fail(
        "invalid_state_root",
        "The automation state root must be canonical.",
      );
    }
    const stats = lstatSync(canonical);
    if (
      !stats.isDirectory() ||
      stats.uid !== dependencies.uid ||
      (stats.mode & 0o077) !== 0
    ) {
      fail(
        "invalid_state_root",
        "The automation state root must be a private directory owned by the current user.",
      );
    }
    return canonical;
  } catch (error) {
    if (error instanceof AutomationActorsError) throw error;
    fail("invalid_state_root", "The automation state root must already exist.");
  }
}

function exactKeys(value, keys) {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.keys(value).sort().join("\n") === [...keys].sort().join("\n")
  );
}

function defaultProcessStartInspector(dependencies, pid) {
  const result = normalizedRunResult(
    dependencies.runner("/bin/ps", ["-p", String(pid), "-o", "lstart="], {
      cwd: "/",
      env: sanitizedEnvironment(dependencies.env),
      timeoutMs: 5_000,
      killSignal: "SIGKILL",
      stdin: "ignore",
    }),
  );
  const identity = result.stdout.trim();
  if (
    result.status === 0 &&
    identity.length > 0 &&
    Buffer.byteLength(identity, "utf8") <= 512
  ) {
    return { status: "live", identity };
  }
  if (!result.error && result.status === 1 && identity === "") {
    return { status: "dead", identity: "" };
  }
  return { status: "unknown", identity: "" };
}

function ensureLifecycleControlRoot(dependencies, stateRoot) {
  const controlRoot = path.join(stateRoot, "control");
  if (lstatIfPresent(controlRoot) === null) {
    try {
      mkdirSync(controlRoot, { mode: 0o700 });
      chmodSync(controlRoot, 0o700);
    } catch (error) {
      if (error?.code !== "EEXIST") {
        fail(
          "lifecycle_lock_unavailable",
          "The automation actor lifecycle lock directory could not be created.",
        );
      }
    }
  }
  try {
    const stats = lstatSync(controlRoot);
    if (
      !stats.isDirectory() ||
      stats.isSymbolicLink() ||
      stats.uid !== dependencies.uid ||
      (stats.mode & 0o077) !== 0 ||
      realpathSync(controlRoot) !== path.resolve(controlRoot)
    ) {
      fail(
        "lifecycle_lock_unavailable",
        "The automation control directory is not private and owner-controlled.",
      );
    }
  } catch (error) {
    if (error instanceof AutomationActorsError) throw error;
    fail(
      "lifecycle_lock_unavailable",
      "The automation control directory could not be inspected.",
    );
  }
  return controlRoot;
}

function lifecycleLockPaths(stateRoot) {
  const lockPath = path.join(stateRoot, "control", LIFECYCLE_LOCK_DIRECTORY);
  return {
    lockPath,
    ownerPath: path.join(lockPath, LIFECYCLE_LOCK_RECORD),
  };
}

function validLifecycleOwnerRecord(record, stateRoot) {
  return (
    exactKeys(record, [
      "acquiredAtMs",
      "nonce",
      "operation",
      "pid",
      "processStartIdentity",
      "protocol",
      "schemaVersion",
      "stateRoot",
    ]) &&
    record.schemaVersion === 1 &&
    record.protocol === LIFECYCLE_LOCK_PROTOCOL &&
    record.stateRoot === stateRoot &&
    ["provision", "revoke", "accept-host"].includes(record.operation) &&
    Number.isSafeInteger(record.pid) &&
    record.pid > 0 &&
    typeof record.processStartIdentity === "string" &&
    record.processStartIdentity.length > 0 &&
    Buffer.byteLength(record.processStartIdentity, "utf8") <= 512 &&
    typeof record.nonce === "string" &&
    /^[0-9a-f]{64}$/.test(record.nonce) &&
    Number.isSafeInteger(record.acquiredAtMs) &&
    record.acquiredAtMs >= 0
  );
}

function inspectLifecycleLock(dependencies, stateRoot) {
  const { lockPath, ownerPath } = lifecycleLockPaths(stateRoot);
  const lockStats = lstatIfPresent(lockPath);
  if (lockStats === null) {
    return { state: "missing", lockPath, ownerPath };
  }
  if (
    !lockStats.isDirectory() ||
    lockStats.isSymbolicLink() ||
    lockStats.uid !== dependencies.uid ||
    (lockStats.mode & 0o777) !== 0o700
  ) {
    fail(
      "invalid_lifecycle_lock",
      "The automation actor lifecycle lock is not a private owner directory.",
    );
  }
  const base = {
    lockPath,
    ownerPath,
    directoryDevice: lockStats.dev,
    directoryInode: lockStats.ino,
    observedAtMs: lockStats.mtimeMs,
  };
  const ownerStats = lstatIfPresent(ownerPath);
  if (ownerStats === null) {
    return { ...base, state: "partial", ownerText: "" };
  }
  if (
    !ownerStats.isFile() ||
    ownerStats.isSymbolicLink() ||
    ownerStats.uid !== dependencies.uid ||
    (ownerStats.mode & 0o777) !== 0o600
  ) {
    fail(
      "invalid_lifecycle_lock",
      "The automation actor lifecycle owner record is not private and owner-controlled.",
    );
  }
  const observedAtMs = Math.max(lockStats.mtimeMs, ownerStats.mtimeMs);
  if (
    ownerStats.size <= 0 ||
    ownerStats.size > MAX_LIFECYCLE_LOCK_RECORD_BYTES
  ) {
    return { ...base, state: "partial", ownerText: "", observedAtMs };
  }
  let ownerText;
  try {
    ownerText = readFileSync(ownerPath, "utf8");
  } catch {
    return { ...base, state: "partial", ownerText: "", observedAtMs };
  }
  try {
    const owner = JSON.parse(ownerText);
    if (!validLifecycleOwnerRecord(owner, stateRoot)) {
      return { ...base, state: "partial", ownerText, observedAtMs };
    }
    return {
      ...base,
      state: "owned",
      owner,
      ownerText,
      observedAtMs: Math.max(observedAtMs, owner.acquiredAtMs),
    };
  } catch {
    return { ...base, state: "partial", ownerText, observedAtMs };
  }
}

function sameLifecycleLockObservation(left, right) {
  return (
    left.state === right.state &&
    left.directoryDevice === right.directoryDevice &&
    left.directoryInode === right.directoryInode &&
    left.ownerText === right.ownerText
  );
}

function lifecycleLockIsFresh(observation, nowMs, staleMs) {
  return (
    !Number.isFinite(observation.observedAtMs) ||
    nowMs - observation.observedAtMs < staleMs
  );
}

function recoverLifecycleLock(dependencies, stateRoot, observation) {
  const current = inspectLifecycleLock(dependencies, stateRoot);
  if (!sameLifecycleLockObservation(observation, current)) {
    fail(
      "lifecycle_busy",
      "The automation actor lifecycle lock changed while recovery was being considered.",
    );
  }
  rmSync(observation.lockPath, { recursive: true, force: false });
}

function acquireLifecycleLock(dependencies, stateRoot, operation) {
  ensureLifecycleControlRoot(dependencies, stateRoot);
  const pid = dependencies.pid;
  const ownProcess = dependencies.processStartInspector(dependencies, pid);
  if (
    ownProcess.status !== "live" ||
    typeof ownProcess.identity !== "string" ||
    ownProcess.identity.length === 0
  ) {
    fail(
      "lifecycle_identity_unavailable",
      "The current process start identity could not be verified.",
    );
  }
  const paths = lifecycleLockPaths(stateRoot);
  for (let attempt = 0; attempt < 3; attempt += 1) {
    let created = false;
    try {
      mkdirSync(paths.lockPath, { mode: 0o700 });
      created = true;
      chmodSync(paths.lockPath, 0o700);
      const nonce = dependencies.lifecycleLockTokenFactory();
      if (typeof nonce !== "string" || !/^[0-9a-f]{64}$/.test(nonce)) {
        fail(
          "lifecycle_identity_unavailable",
          "The lifecycle lock ownership token could not be created.",
        );
      }
      const owner = {
        schemaVersion: 1,
        protocol: LIFECYCLE_LOCK_PROTOCOL,
        stateRoot,
        operation,
        pid,
        processStartIdentity: ownProcess.identity,
        nonce,
        acquiredAtMs: dependencies.nowMs(),
      };
      const temporaryOwnerPath = path.join(
        paths.lockPath,
        `.owner-${nonce}.tmp`,
      );
      writeFileSync(temporaryOwnerPath, `${JSON.stringify(owner)}\n`, {
        flag: "wx",
        mode: 0o600,
      });
      chmodSync(temporaryOwnerPath, 0o600);
      renameSync(temporaryOwnerPath, paths.ownerPath);
      const installed = inspectLifecycleLock(dependencies, stateRoot);
      if (
        installed.state !== "owned" ||
        JSON.stringify(installed.owner) !== JSON.stringify(owner)
      ) {
        fail(
          "lifecycle_lock_unavailable",
          "The lifecycle lock owner record could not be verified.",
        );
      }
      return { ...paths, owner, observation: installed };
    } catch (error) {
      if (created) {
        try {
          rmSync(paths.lockPath, { recursive: true, force: true });
        } catch {
          fail(
            "lifecycle_lock_release_failed",
            "A partial lifecycle lock could not be removed after acquisition failed.",
          );
        }
      }
      if (error instanceof AutomationActorsError) throw error;
      if (error?.code !== "EEXIST") {
        fail(
          "lifecycle_lock_unavailable",
          "The automation actor lifecycle lock could not be acquired.",
        );
      }
    }

    const observation = inspectLifecycleLock(dependencies, stateRoot);
    if (observation.state === "missing") continue;
    const nowMs = dependencies.nowMs();
    if (observation.state === "owned") {
      const process = dependencies.processStartInspector(
        dependencies,
        observation.owner.pid,
      );
      if (
        process.status === "unknown" ||
        (process.status === "live" &&
          process.identity === observation.owner.processStartIdentity)
      ) {
        fail(
          "lifecycle_busy",
          "Another automation actor lifecycle operation still owns the lock.",
        );
      }
    } else if (
      lifecycleLockIsFresh(
        observation,
        nowMs,
        dependencies.lifecycleLockStaleMs,
      )
    ) {
      fail(
        "lifecycle_busy",
        "Another automation actor lifecycle operation owns a fresh partial lock.",
      );
    }
    recoverLifecycleLock(dependencies, stateRoot, observation);
  }
  fail(
    "lifecycle_busy",
    "The automation actor lifecycle lock could not be acquired safely.",
  );
}

function releaseLifecycleLock(dependencies, stateRoot, ownership) {
  const current = inspectLifecycleLock(dependencies, stateRoot);
  if (
    current.state !== "owned" ||
    current.directoryDevice !== ownership.observation.directoryDevice ||
    current.directoryInode !== ownership.observation.directoryInode ||
    JSON.stringify(current.owner) !== JSON.stringify(ownership.owner)
  ) {
    fail(
      "lifecycle_lock_release_failed",
      "The lifecycle lock no longer belongs to this exact operation.",
    );
  }
  rmSync(ownership.lockPath, { recursive: true, force: false });
  if (lstatIfPresent(ownership.lockPath) !== null) {
    fail(
      "lifecycle_lock_release_failed",
      "The lifecycle lock still exists after exact-owner release.",
    );
  }
}

function withLifecycleLock(dependencies, stateRoot, operation, callback) {
  const ownership = acquireLifecycleLock(dependencies, stateRoot, operation);
  let result;
  let primaryError;
  try {
    result = callback();
  } catch (error) {
    primaryError = error;
  }
  try {
    releaseLifecycleLock(dependencies, stateRoot, ownership);
  } catch (releaseError) {
    if (primaryError) {
      fail(
        "lifecycle_lock_release_failed",
        `The lifecycle operation failed, and its exact-owner lock could not be released: ${releaseError instanceof Error ? releaseError.message : String(releaseError)}`,
      );
    }
    throw releaseError;
  }
  if (primaryError) throw primaryError;
  return result;
}

export function runtimeDigestForPins(pins) {
  return sharedRuntimeDigestForPins(pins);
}

function inspectRegularFile(filePath, { executable = false } = {}) {
  const resolved = path.resolve(filePath);
  let canonical;
  let stats;
  try {
    stats = lstatSync(resolved);
    canonical = realpathSync(resolved);
  } catch {
    fail("missing_file", `Required file is missing: ${filePath}`);
  }
  if (!stats.isFile() || stats.isSymbolicLink() || canonical !== resolved) {
    fail("invalid_file", `Required path is not a regular file: ${filePath}`);
  }
  if (executable && (stats.mode & 0o111) === 0) {
    fail("invalid_file", `Required file is not executable: ${filePath}`);
  }
  return canonical;
}

function defaultPinnedNodeResolver(dependencies) {
  const nvmrcPath = path.join(dependencies.repoRoot, ".nvmrc");
  const requestedVersion = readFileSync(nvmrcPath, "utf8").trim();
  if (!/^v?\d+\.\d+\.\d+$/.test(requestedVersion)) {
    fail("invalid_node_version", ".nvmrc must pin one exact Node version.");
  }
  const normalizedVersion = `v${requestedVersion.replace(/^v/, "")}`;
  const candidate = path.join(
    dependencies.homeDir,
    ".nvm",
    "versions",
    "node",
    normalizedVersion,
    "bin",
    "node",
  );
  const nodePath = inspectRegularFile(candidate, { executable: true });
  const actualVersion = runChecked(dependencies, nodePath, ["--version"], {
    cwd: dependencies.repoRoot,
    purpose: "Pinned Node verification",
  });
  if (actualVersion !== normalizedVersion) {
    fail(
      "node_version_mismatch",
      `Pinned Node reported ${actualVersion || "no version"}, expected ${normalizedVersion}.`,
    );
  }
  return nodePath;
}

function withPrivateTempDirectory(dependencies, operation) {
  const directory = mkdtempSync(
    path.join(dependencies.tempRoot, "freed-automation-actors-"),
  );
  chmodSync(directory, 0o700);
  try {
    return operation(directory);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

function buildHostArtifacts(dependencies, directory) {
  const hostOutput = path.join(directory, "automation-actor-host");
  const hostBuildPath = inspectRegularFile(dependencies.hostBuildPath);
  runChecked(
    dependencies,
    "/bin/bash",
    [hostBuildPath, "--host-output", hostOutput],
    { cwd: dependencies.repoRoot, purpose: "Automation actor host build" },
  );
  return {
    hostOutput: inspectRegularFile(hostOutput, { executable: true }),
  };
}

function sudoInstall(dependencies, args, purpose) {
  runChecked(dependencies, "/usr/bin/sudo", ["/usr/bin/install", ...args], {
    purpose,
  });
}

function installDirectory(dependencies, directory) {
  sudoInstall(
    dependencies,
    ["-d", "-o", "root", "-g", "wheel", "-m", "0755", directory],
    "Root-owned directory installation",
  );
}

function installFile(dependencies, source, destination, mode) {
  sudoInstall(
    dependencies,
    ["-o", "root", "-g", "wheel", "-m", mode, source, destination],
    "Root-owned public material installation",
  );
}

function sudoRemoveFile(dependencies, destination, purpose) {
  runChecked(
    dependencies,
    "/usr/bin/sudo",
    ["/bin/rm", "-f", "--", destination],
    { purpose },
  );
}

function describeRuntime(dependencies, pinnedNodePath) {
  const controlEntrySource = inspectRegularFile(
    path.join(dependencies.repoRoot, "scripts", "automation-control.mjs"),
  );
  const actorControlEntrySource = inspectRegularFile(
    path.join(dependencies.repoRoot, "scripts", "automation-actor-control.mjs"),
  );
  const controlLibrarySource = inspectRegularFile(
    path.join(
      dependencies.repoRoot,
      "scripts",
      "lib",
      "automation-control.mjs",
    ),
  );
  const kernelGuardContractSource = inspectRegularFile(
    path.join(
      dependencies.repoRoot,
      "scripts",
      "lib",
      "automation-kernel-guard-contract.mjs",
    ),
  );
  const outcomeLedgerRepairContractSource = inspectRegularFile(
    path.join(
      dependencies.repoRoot,
      "scripts",
      "lib",
      "outcome-ledger-repair-contract.mjs",
    ),
  );
  const leaseArchiveHelperSource = inspectRegularFile(
    path.join(
      dependencies.repoRoot,
      "scripts",
      "lib",
      "lease-archive-move.py",
    ),
  );
  const pins = {
    nodeSha256: sha256File(pinnedNodePath),
    controlEntrySha256: sha256File(controlEntrySource),
    actorControlEntrySha256: sha256File(actorControlEntrySource),
    controlLibrarySha256: sha256File(controlLibrarySource),
    kernelGuardContractSha256: sha256File(kernelGuardContractSource),
    outcomeLedgerRepairContractSha256: sha256File(
      outcomeLedgerRepairContractSource,
    ),
    leaseArchiveHelperSha256: sha256File(leaseArchiveHelperSource),
  };
  const digest = runtimeDigestForPins(pins);
  const directory = path.join(dependencies.runtimeRoot, digest);
  return {
    digest,
    directory,
    nodeSource: pinnedNodePath,
    nodePath: path.join(directory, "node"),
    controlEntrySource,
    controlEntryPath: path.join(directory, "automation-control.mjs"),
    actorControlEntrySource,
    actorControlEntryPath: path.join(directory, "automation-actor-control.mjs"),
    controlLibrarySource,
    controlLibraryPath: path.join(directory, "lib", "automation-control.mjs"),
    kernelGuardContractSource,
    kernelGuardContractPath: path.join(
      directory,
      "lib",
      "automation-kernel-guard-contract.mjs",
    ),
    outcomeLedgerRepairContractSource,
    outcomeLedgerRepairContractPath: path.join(
      directory,
      "lib",
      "outcome-ledger-repair-contract.mjs",
    ),
    leaseArchiveHelperSource,
    leaseArchiveHelperPath: path.join(
      directory,
      "lib",
      "lease-archive-move.py",
    ),
    ...pins,
  };
}

function installRuntime(dependencies, runtime) {
  installDirectory(dependencies, dependencies.runtimeRoot);
  installDirectory(dependencies, runtime.directory);
  installDirectory(dependencies, path.join(runtime.directory, "lib"));
  installFile(dependencies, runtime.nodeSource, runtime.nodePath, "0555");
  installFile(
    dependencies,
    runtime.controlEntrySource,
    runtime.controlEntryPath,
    "0444",
  );
  installFile(
    dependencies,
    runtime.actorControlEntrySource,
    runtime.actorControlEntryPath,
    "0444",
  );
  installFile(
    dependencies,
    runtime.controlLibrarySource,
    runtime.controlLibraryPath,
    "0444",
  );
  installFile(
    dependencies,
    runtime.kernelGuardContractSource,
    runtime.kernelGuardContractPath,
    "0444",
  );
  installFile(
    dependencies,
    runtime.outcomeLedgerRepairContractSource,
    runtime.outcomeLedgerRepairContractPath,
    "0444",
  );
  installFile(
    dependencies,
    runtime.leaseArchiveHelperSource,
    runtime.leaseArchiveHelperPath,
    "0444",
  );
}

export function bindingForActor({
  actor,
  stateRoot,
  launcherRoot,
  runtime,
  launcherSha256,
}) {
  const contract = AUTOMATION_ACTORS[actor];
  if (!contract) {
    fail("invalid_actor", `Unsupported automation actor: ${actor}`);
  }
  return {
    schemaVersion: 3,
    actor,
    purpose: LAUNCHER_PURPOSE,
    handoff: LAUNCHER_HANDOFF,
    attestationProtocol: ATTESTATION_PROTOCOL,
    stateRoot,
    leaseName: contract.leaseName,
    maxLeaseLifetimeMs: MAX_LEASE_LIFETIME_MS,
    launcherPath: path.join(launcherRoot, "bin", `${actor}-${launcherSha256}`),
    launcherSha256,
    nodePath: runtime.nodePath,
    nodeSha256: runtime.nodeSha256,
    controlEntryPath: runtime.controlEntryPath,
    controlEntrySha256: runtime.controlEntrySha256,
    actorControlEntryPath: runtime.actorControlEntryPath,
    actorControlEntrySha256: runtime.actorControlEntrySha256,
    controlLibraryPath: runtime.controlLibraryPath,
    controlLibrarySha256: runtime.controlLibrarySha256,
    kernelGuardContractPath: runtime.kernelGuardContractPath,
    kernelGuardContractSha256: runtime.kernelGuardContractSha256,
    outcomeLedgerRepairContractPath:
      runtime.outcomeLedgerRepairContractPath,
    outcomeLedgerRepairContractSha256:
      runtime.outcomeLedgerRepairContractSha256,
    leaseArchiveHelperPath: runtime.leaseArchiveHelperPath,
    leaseArchiveHelperSha256: runtime.leaseArchiveHelperSha256,
  };
}

function installActorPublicMaterial(
  dependencies,
  { actor, stateRoot, hostOutput, runtime, privateDirectory },
) {
  installDirectory(dependencies, dependencies.launcherRoot);
  installDirectory(dependencies, path.join(dependencies.launcherRoot, "bin"));
  const launcherSha256 = sha256File(hostOutput);
  const launcherPath = path.join(
    dependencies.launcherRoot,
    "bin",
    `${actor}-${launcherSha256}`,
  );
  installFile(dependencies, hostOutput, launcherPath, "0555");
  const binding = bindingForActor({
    actor,
    stateRoot,
    launcherRoot: dependencies.launcherRoot,
    runtime,
    launcherSha256,
  });
  const privateBindingPath = path.join(privateDirectory, `${actor}.json`);
  writeFileSync(privateBindingPath, `${JSON.stringify(binding, null, 2)}\n`, {
    mode: 0o600,
  });
  const bindingPath = path.join(dependencies.launcherRoot, `${actor}.json`);
  installFile(dependencies, privateBindingPath, bindingPath, "0444");
  return { binding, bindingPath };
}

function bindingPathForActor(dependencies, actor) {
  return path.join(dependencies.launcherRoot, `${actor}.json`);
}

function captureBindingForRollback(dependencies, actor, privateDirectory) {
  const bindingPath = bindingPathForActor(dependencies, actor);
  if (lstatIfPresent(bindingPath) === null) {
    return { actor, bindingPath, snapshotPath: null };
  }
  const inspection = inspectRootOwnedRecord(bindingPath, {
    recordRoot: dependencies.launcherRoot,
    requiredUid: dependencies.trustedUid,
  });
  if (!inspection.ready) {
    fail(
      "invalid_binding",
      `The existing ${actor} binding cannot be preserved: ${inspection.reason}`,
    );
  }
  const snapshotPath = path.join(privateDirectory, `${actor}.previous.json`);
  writeFileSync(snapshotPath, readFileSync(bindingPath), { mode: 0o600 });
  return { actor, bindingPath, snapshotPath };
}

function restoreBinding(dependencies, rollback) {
  if (rollback.snapshotPath === null) {
    sudoRemoveFile(
      dependencies,
      rollback.bindingPath,
      `Automation actor ${rollback.actor} binding rollback`,
    );
    return;
  }
  installFile(
    dependencies,
    rollback.snapshotPath,
    rollback.bindingPath,
    "0444",
  );
}

function rollbackBindings(dependencies, records) {
  const failures = [];
  for (const record of [...records].reverse()) {
    try {
      restoreBinding(dependencies, record);
    } catch {
      failures.push(record.actor);
    }
  }
  return failures;
}

function staleActorRecordPath(stateRoot, actor) {
  return path.join(stateRoot, "control", "actor-credentials", `${actor}.json`);
}

function lstatIfPresent(filePath) {
  try {
    return lstatSync(filePath);
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

function captureStaleActorRecord(
  dependencies,
  stateRoot,
  actor,
  privateDirectory,
) {
  const controlRoot = path.join(stateRoot, "control");
  const recordRoot = path.join(controlRoot, "actor-credentials");
  for (const directory of [controlRoot, recordRoot]) {
    const stats = lstatIfPresent(directory);
    if (stats === null) {
      return {
        actor,
        recordPath: staleActorRecordPath(stateRoot, actor),
        snapshotPath: null,
        mode: null,
      };
    }
    if (
      !stats.isDirectory() ||
      stats.isSymbolicLink() ||
      stats.uid !== dependencies.uid ||
      (stats.mode & 0o077) !== 0
    ) {
      fail(
        "invalid_stale_actor_record_path",
        "The obsolete actor record directory must be private, canonical, and owner-controlled.",
      );
    }
  }
  const recordPath = staleActorRecordPath(stateRoot, actor);
  const stats = lstatIfPresent(recordPath);
  if (stats === null) {
    return { actor, recordPath, snapshotPath: null, mode: null };
  }
  if (
    !stats.isFile() ||
    stats.isSymbolicLink() ||
    stats.uid !== dependencies.uid ||
    (stats.mode & 0o077) !== 0 ||
    stats.size > MAX_LAUNCHER_HANDOFF_BYTES
  ) {
    fail(
      "invalid_stale_actor_record_path",
      `The obsolete ${actor} record is not an owner-controlled file.`,
    );
  }
  const snapshotPath = path.join(privateDirectory, `${actor}.obsolete.json`);
  writeFileSync(snapshotPath, readFileSync(recordPath), { mode: 0o600 });
  return {
    actor,
    recordPath,
    snapshotPath,
    mode: stats.mode & 0o777,
  };
}

function removeStaleActorRecord(record) {
  if (record.snapshotPath === null) return false;
  const stats = lstatIfPresent(record.recordPath);
  if (
    stats === null ||
    !stats.isFile() ||
    stats.isSymbolicLink() ||
    stats.size > MAX_LAUNCHER_HANDOFF_BYTES ||
    !readFileSync(record.recordPath).equals(readFileSync(record.snapshotPath))
  ) {
    fail(
      "stale_actor_record_changed",
      `The obsolete ${record.actor} record changed during the operation.`,
    );
  }
  rmSync(record.recordPath, { force: true });
  if (lstatIfPresent(record.recordPath) !== null) {
    fail(
      "stale_actor_record_removal_failed",
      `The obsolete ${record.actor} record still exists after removal.`,
    );
  }
  return true;
}

function restoreStaleActorRecords(records) {
  const failures = [];
  for (const record of [...records].reverse()) {
    if (record.snapshotPath === null) continue;
    try {
      if (lstatIfPresent(record.recordPath) !== null) {
        throw new Error("record path is occupied");
      }
      writeFileSync(record.recordPath, readFileSync(record.snapshotPath), {
        mode: record.mode,
      });
      chmodSync(record.recordPath, record.mode);
    } catch {
      failures.push(record.actor);
    }
  }
  return failures;
}

function provisionActors(command, dependencies, stateRoot) {
  const actors =
    command.actor === "all" ? AUTOMATION_ACTOR_IDS : [command.actor];
  const pinnedNodePath = dependencies.pinnedNodeResolver(dependencies);
  const runtime = describeRuntime(dependencies, pinnedNodePath);

  return withPrivateTempDirectory(dependencies, (privateDirectory) => {
    const artifacts = buildHostArtifacts(dependencies, privateDirectory);
    const records = [];
    const rollbackRecords = [];
    const staleRecords = actors.map((actor) =>
      captureStaleActorRecord(dependencies, stateRoot, actor, privateDirectory),
    );
    installRuntime(dependencies, runtime);
    const removedStaleRecords = [];
    try {
      for (const actor of actors) {
        const rollback = captureBindingForRollback(
          dependencies,
          actor,
          privateDirectory,
        );
        rollbackRecords.push(rollback);
        const installed = installActorPublicMaterial(dependencies, {
          actor,
          stateRoot,
          hostOutput: artifacts.hostOutput,
          runtime,
          privateDirectory,
        });
        records.push({
          actor,
          leaseName: AUTOMATION_ACTORS[actor].leaseName,
          bindingPath: installed.bindingPath,
          replacedExistingBinding: rollback.snapshotPath !== null,
          accepted: false,
          staleActorRecordRemoved: false,
        });
      }
      const readinesses = actors.map((actor) =>
        attestActor(actor, dependencies, stateRoot),
      );
      assertOneRuntimeDigest(readinesses);
      for (const [index, actor] of actors.entries()) {
        acceptActor(actor, dependencies, stateRoot, readinesses[index]);
        records[index].accepted = true;
      }
      for (const staleRecord of staleRecords) {
        if (removeStaleActorRecord(staleRecord)) {
          removedStaleRecords.push(staleRecord);
          records.find(
            (record) => record.actor === staleRecord.actor,
          ).staleActorRecordRemoved = true;
        }
      }
    } catch (error) {
      const rollbackFailures = rollbackBindings(dependencies, rollbackRecords);
      const staleRollbackFailures =
        restoreStaleActorRecords(removedStaleRecords);
      const failures = [...rollbackFailures, ...staleRollbackFailures];
      if (failures.length > 0) {
        fail(
          "provision_rollback_failed",
          `Provisioning failed, and rollback failed for ${[...new Set(failures)].join(", ")}. Explicit owner recovery is required.`,
        );
      }
      throw error;
    }
    return {
      action: "provision",
      stateRoot,
      runtimeDigest: runtime.digest,
      records,
    };
  });
}

function revokeActors(command, dependencies, stateRoot) {
  return withPrivateTempDirectory(dependencies, (privateDirectory) => {
    const actors =
      command.actor === "all" ? AUTOMATION_ACTOR_IDS : [command.actor];
    const validated = actors.map((actor) => {
      const installed = installedBinding(
        { action: "revoke", actor, stateRoot },
        dependencies,
        stateRoot,
      );
      const rollback = captureBindingForRollback(
        dependencies,
        actor,
        privateDirectory,
      );
      const staleRecord = captureStaleActorRecord(
        dependencies,
        stateRoot,
        actor,
        privateDirectory,
      );
      return { actor, installed, rollback, staleRecord };
    });
    const removed = [];
    const removedStaleRecords = [];
    try {
      for (const record of validated) {
        if (removeStaleActorRecord(record.staleRecord)) {
          removedStaleRecords.push(record.staleRecord);
        }
      }
      for (const record of validated) {
        removed.push(record.rollback);
        sudoRemoveFile(
          dependencies,
          record.rollback.bindingPath,
          `Automation actor ${record.actor} binding revocation`,
        );
        if (lstatIfPresent(record.rollback.bindingPath) !== null) {
          fail(
            "revoke_failed",
            `The ${record.actor} binding still exists after revocation.`,
          );
        }
      }
    } catch (error) {
      const rollbackFailures = rollbackBindings(dependencies, removed);
      const staleRollbackFailures =
        restoreStaleActorRecords(removedStaleRecords);
      const failures = [...rollbackFailures, ...staleRollbackFailures];
      if (failures.length > 0) {
        fail(
          "revoke_rollback_failed",
          `Revocation failed, and rollback failed for ${[...new Set(failures)].join(", ")}. Explicit owner recovery is required.`,
        );
      }
      throw error;
    }
    return command.actor === "all"
      ? {
          action: "revoke",
          stateRoot,
          records: validated.map(({ actor, installed }) => ({
            actor,
            leaseName: installed.binding.leaseName,
            bindingPath: installed.path,
            staleActorRecordRemoved: removedStaleRecords.some(
              (record) => record.actor === actor,
            ),
          })),
        }
      : {
          action: "revoke",
          actor: command.actor,
          stateRoot,
          bindingPath: validated[0].installed.path,
          staleActorRecordRemoved: removedStaleRecords.length === 1,
        };
  });
}

export function validatePublicBinding(binding, expected, dependencies) {
  const readiness = validateActorBindingRecord(binding, {
    actor: expected.actor,
    stateRoot: expected.stateRoot,
    leaseContract: {
      name: AUTOMATION_ACTORS[expected.actor].leaseName,
      maxLifetimeMs: MAX_LEASE_LIFETIME_MS,
    },
    launcherRoot: dependencies.launcherRoot,
    runtimeRoot: dependencies.runtimeRoot,
    requiredUid: dependencies.trustedUid,
  });
  if (!readiness.ready) {
    fail("invalid_binding", readiness.reason);
  }
  return binding;
}

function installedBinding(command, dependencies, stateRoot) {
  const readiness = readInstalledActorBinding(stateRoot, command.actor, {
    leaseContract: {
      name: AUTOMATION_ACTORS[command.actor].leaseName,
      maxLifetimeMs: MAX_LEASE_LIFETIME_MS,
    },
    launcherRecordRoot: dependencies.launcherRoot,
    runtimeRoot: dependencies.runtimeRoot,
    requiredUid: dependencies.trustedUid,
  });
  if (!readiness.ready) {
    fail("invalid_binding", readiness.reason);
  }
  return readiness;
}

function acquireActor(
  command,
  dependencies,
  stateRoot,
  installedBindingOverride = undefined,
) {
  const binding =
    installedBindingOverride ??
    installedBinding(command, dependencies, stateRoot).binding;
  const stdout = runChecked(
    dependencies,
    binding.launcherPath,
    [
      "--acquire-lease",
      "--actor",
      command.actor,
      "--state-root",
      stateRoot,
      "--lease-name",
      binding.leaseName,
      "--ttl-seconds",
      String(LEASE_TTL_SECONDS),
    ],
    {
      purpose: "Automation actor lease acquisition",
      timeoutMs: dependencies.launcherAcquireTimeoutMs,
      stdin: "ignore",
      onFailure: (result) => {
        const failedHandoff = parseAcquisitionHandoff(
          result.stdout,
          command.actor,
          binding.leaseName,
        );
        if (failedHandoff.plausibleLeaseToken !== undefined) {
          cleanupMalformedAcquisition(
            command.actor,
            failedHandoff.plausibleLeaseToken,
            binding,
            dependencies,
            stateRoot,
          );
        }
      },
    },
  );
  const parsed = parseAcquisitionHandoff(
    stdout,
    command.actor,
    binding.leaseName,
  );
  if (!parsed.valid) {
    if (parsed.plausibleLeaseToken !== undefined) {
      cleanupMalformedAcquisition(
        command.actor,
        parsed.plausibleLeaseToken,
        binding,
        dependencies,
        stateRoot,
      );
    }
    fail(
      "invalid_launcher_response",
      "The actor launcher did not return one JSON object.",
    );
  }
  return parsed.result;
}

function parseAcquisitionHandoff(stdout, actor, leaseName) {
  if (Buffer.byteLength(stdout, "utf8") > MAX_LAUNCHER_HANDOFF_BYTES) {
    return { valid: false, plausibleLeaseToken: undefined };
  }
  let result;
  try {
    result = JSON.parse(stdout);
  } catch {
    return { valid: false, plausibleLeaseToken: undefined };
  }
  const plausibleLeaseToken =
    typeof result?.leaseToken === "string" &&
    Buffer.byteLength(result.leaseToken, "utf8") >= 32 &&
    Buffer.byteLength(result.leaseToken, "utf8") <= 4 * 1_024
      ? result.leaseToken
      : undefined;
  const expectedHandoffKeys = [
    "acquiredAt",
    "actor",
    "expiresAt",
    "leaseName",
    "leaseOperationId",
    "leaseToken",
    "leaseTokenSha256",
    "schemaVersion",
    "ttlMs",
  ].sort();
  try {
    const acquiredAt = Date.parse(result?.acquiredAt);
    const expiresAt = Date.parse(result?.expiresAt);
    if (
      !result ||
      typeof result !== "object" ||
      Array.isArray(result) ||
      Object.keys(result).sort().join("\n") !==
        expectedHandoffKeys.join("\n") ||
      result.schemaVersion !== 1 ||
      result.actor !== actor ||
      result.leaseName !== leaseName ||
      typeof result.leaseOperationId !== "string" ||
      !/^(?:[0-9a-f]{64}|[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/.test(
        result.leaseOperationId,
      ) ||
      typeof result.leaseToken !== "string" ||
      Buffer.byteLength(result.leaseToken, "utf8") < 32 ||
      Buffer.byteLength(result.leaseToken, "utf8") > 4 * 1_024 ||
      typeof result.leaseTokenSha256 !== "string" ||
      createHash("sha256").update(result.leaseToken).digest("hex") !==
        result.leaseTokenSha256 ||
      typeof result.acquiredAt !== "string" ||
      typeof result.expiresAt !== "string" ||
      result.ttlMs !== MAX_LEASE_LIFETIME_MS ||
      !Number.isFinite(acquiredAt) ||
      !Number.isFinite(expiresAt) ||
      expiresAt <= acquiredAt ||
      expiresAt - acquiredAt > MAX_LEASE_LIFETIME_MS
    ) {
      throw new Error("invalid result");
    }
    return { valid: true, plausibleLeaseToken, result };
  } catch {
    return { valid: false, plausibleLeaseToken, result };
  }
}

function cleanupMalformedAcquisition(
  actor,
  leaseToken,
  binding,
  dependencies,
  stateRoot,
) {
  try {
    const release = runPinnedControl(
      dependencies,
      binding,
      stateRoot,
      "release",
      { leaseToken },
    );
    if (
      release?.released !== true ||
      release?.lease?.name !== binding.leaseName ||
      release?.lease?.owner !== actor
    ) {
      throw new Error("release was not confirmed");
    }
  } catch {
    // The retried absence inspection below is the cleanup authority.
  }
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const live = runPinnedControl(dependencies, binding, stateRoot, "show");
      if (live === null) return;
      if (
        live?.name !== binding.leaseName ||
        live?.owner !== actor ||
        !["active", "expired"].includes(live?.status)
      ) {
        throw new Error("unexpected live lease");
      }
    } catch {
      continue;
    }
  }
  fail(
    "acquire_cleanup_failed",
    `Malformed acquisition may have left the ${actor} lease live.`,
  );
}

function attestActor(actor, dependencies, stateRoot) {
  const readiness = actorLauncherReadiness(stateRoot, actor, {
    leaseContract: {
      name: AUTOMATION_ACTORS[actor].leaseName,
      maxLifetimeMs: MAX_LEASE_LIFETIME_MS,
    },
    launcherAttestor: dependencies.launcherAttestor,
    attestationTimeoutMs: LAUNCHER_ATTESTATION_TIMEOUT_MS,
    launcherRecordRoot: dependencies.launcherRoot,
    runtimeRoot: dependencies.runtimeRoot,
    requiredUid: dependencies.trustedUid,
  });
  if (!readiness.ready) {
    fail("actor_not_ready", readiness.reason);
  }
  return readiness;
}

function publicVerification(readiness) {
  return {
    actor: readiness.binding.actor,
    leaseName: readiness.binding.leaseName,
    launcherSha256: readiness.binding.launcherSha256,
    runtimeDigest: readiness.runtimeDigest,
    attested: true,
  };
}

function verifyActors(command, dependencies, stateRoot) {
  const actors =
    command.actor === "all" ? AUTOMATION_ACTOR_IDS : [command.actor];
  const readinesses = actors.map((actor) =>
    attestActor(actor, dependencies, stateRoot),
  );
  if (command.actor === "all") {
    assertOneRuntimeDigest(readinesses);
  }
  return {
    action: "verify",
    stateRoot,
    records: readinesses.map(publicVerification),
  };
}

function parseControlResponse(stdout, { action, stateRoot }) {
  if (Buffer.byteLength(stdout, "utf8") > MAX_LAUNCHER_HANDOFF_BYTES) {
    fail(
      "invalid_control_response",
      "The pinned control output was too large.",
    );
  }
  try {
    const payload = JSON.parse(stdout);
    if (
      !payload ||
      typeof payload !== "object" ||
      Array.isArray(payload) ||
      Object.keys(payload).sort().join("\n") !==
        ["action", "ok", "result", "schemaVersion", "stateRoot"]
          .sort()
          .join("\n") ||
      payload.ok !== true ||
      payload.schemaVersion !== 1 ||
      payload.action !== action ||
      payload.stateRoot !== stateRoot
    ) {
      throw new Error("invalid control result");
    }
    return payload.result;
  } catch {
    fail(
      "invalid_control_response",
      "The pinned control did not return the expected JSON object.",
    );
  }
}

function runPinnedControl(
  dependencies,
  binding,
  stateRoot,
  action,
  { leaseToken = undefined } = {},
) {
  const args = [
    binding.controlEntryPath,
    "lease",
    action,
    "--state-root",
    stateRoot,
    "--name",
    binding.leaseName,
  ];
  if (action === "heartbeat") {
    args.push("--ttl-seconds", String(LEASE_TTL_SECONDS));
  }
  const operationId =
    action === "show"
      ? undefined
      : dependencies.leaseOperationIdGenerator(action);
  let failure;
  const attempts = action === "show" ? 1 : 2;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const stdout = runChecked(dependencies, binding.nodePath, args, {
        purpose: `Automation actor lease ${action}`,
        timeoutMs: dependencies.controlLifecycleTimeoutMs,
        stdin: "ignore",
        additionalEnv:
          leaseToken === undefined
            ? {}
            : {
                FREED_AUTOMATION_LEASE_OPERATION_ID: operationId,
                FREED_AUTOMATION_LEASE_TOKEN: leaseToken,
              },
      });
      return parseControlResponse(stdout, {
        action: `lease.${action}`,
        stateRoot,
      });
    } catch (error) {
      failure = error;
    }
  }
  throw failure;
}

function canonicalIdentity(value) {
  if (Array.isArray(value)) return value.map(canonicalIdentity);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonicalIdentity(value[key])]),
    );
  }
  return value;
}

function readinessIdentity(readiness) {
  return JSON.stringify(
    canonicalIdentity({
      binding: readiness.binding,
      runtimeRoot: readiness.runtimeRoot,
      runtimeDigest: readiness.runtimeDigest,
      attestation: readiness.attestation,
    }),
  );
}

function assertOneRuntimeDigest(readinesses) {
  const runtimeDigests = new Set(
    readinesses.map((readiness) => readiness.runtimeDigest),
  );
  if (runtimeDigests.size !== 1) {
    fail(
      "runtime_identity_mismatch",
      "Installed actor bindings do not share one pinned runtime digest.",
    );
  }
  return readinesses[0].runtimeDigest;
}

function acceptActor(actor, dependencies, stateRoot, initial) {
  let leaseToken;
  let primaryFailure;
  let releaseFailure;
  try {
    const lease = acquireActor(
      { action: "acquire", actor, stateRoot },
      dependencies,
      stateRoot,
      initial.binding,
    );
    leaseToken = lease.leaseToken;
    const heartbeat = runPinnedControl(
      dependencies,
      initial.binding,
      stateRoot,
      "heartbeat",
      { leaseToken },
    );
    if (
      heartbeat?.heartbeated !== true ||
      heartbeat?.lease?.token !== leaseToken ||
      heartbeat?.lease?.name !== initial.binding.leaseName ||
      heartbeat?.lease?.owner !== actor
    ) {
      fail(
        "invalid_control_response",
        "The pinned control did not confirm the expected lease heartbeat.",
      );
    }
  } catch (error) {
    primaryFailure = error;
  } finally {
    if (leaseToken !== undefined) {
      try {
        const release = runPinnedControl(
          dependencies,
          initial.binding,
          stateRoot,
          "release",
          { leaseToken },
        );
        if (
          release?.released !== true ||
          release?.lease?.name !== initial.binding.leaseName ||
          release?.lease?.owner !== actor
        ) {
          fail(
            "invalid_control_response",
            "The pinned control did not confirm the expected lease release.",
          );
        }
      } catch (error) {
        releaseFailure = error;
      }
    }
  }
  if (releaseFailure) {
    fail(
      "accept_host_release_failed",
      `Host acceptance could not release the ${actor} lease.`,
    );
  }
  if (primaryFailure) throw primaryFailure;

  const shown = runPinnedControl(
    dependencies,
    initial.binding,
    stateRoot,
    "show",
  );
  if (shown !== null) {
    fail(
      "lease_still_live",
      `Host acceptance found a live ${actor} lease after release.`,
    );
  }
  return {
    actor,
    leaseName: initial.binding.leaseName,
    launcherSha256: initial.binding.launcherSha256,
    runtimeDigest: initial.runtimeDigest,
    attested: true,
    acquired: true,
    heartbeated: true,
    released: true,
    liveLease: false,
  };
}

function acceptHost(dependencies, stateRoot) {
  const initialReadinesses = AUTOMATION_ACTOR_IDS.map((actor) =>
    attestActor(actor, dependencies, stateRoot),
  );
  const runtimeDigest = assertOneRuntimeDigest(initialReadinesses);
  const launcherDigests = new Set(
    initialReadinesses.map((readiness) => readiness.binding.launcherSha256),
  );
  if (launcherDigests.size !== 1) {
    fail(
      "launcher_identity_mismatch",
      "Installed actor launchers do not share one stable public identity.",
    );
  }
  const records = [];
  for (const [index, actor] of AUTOMATION_ACTOR_IDS.entries()) {
    const record = acceptActor(
      actor,
      dependencies,
      stateRoot,
      initialReadinesses[index],
    );
    records.push(record);
  }
  const finalReadinesses = AUTOMATION_ACTOR_IDS.map((actor) =>
    attestActor(actor, dependencies, stateRoot),
  );
  for (const [index, actor] of AUTOMATION_ACTOR_IDS.entries()) {
    if (
      readinessIdentity(finalReadinesses[index]) !==
      readinessIdentity(initialReadinesses[index])
    ) {
      fail(
        "launcher_identity_changed",
        `The installed ${actor} launcher identity changed during acceptance.`,
      );
    }
    records[index].launcherIdentityStable = true;
  }
  return {
    action: "accept-host",
    stateRoot,
    accepted: true,
    launcherSha256: initialReadinesses[0].binding.launcherSha256,
    runtimeDigest,
    records,
  };
}

function dependenciesWithDefaults(overrides = {}) {
  const env = overrides.env ?? process.env;
  const dependencies = {
    env,
    platform: process.platform,
    uid: typeof process.getuid === "function" ? process.getuid() : -1,
    pid: process.pid,
    homeDir: os.homedir(),
    tempRoot: realpathSync(os.tmpdir()),
    repoRoot: REPO_ROOT,
    launcherRoot: DEFAULT_LAUNCHER_ROOT,
    runtimeRoot: DEFAULT_RUNTIME_ROOT,
    trustedUid: 0,
    hostBuildPath: path.join(
      REPO_ROOT,
      "scripts",
      "automation-actor-host-build.sh",
    ),
    runner: defaultRunner,
    launcherAttestor: defaultLauncherAttestor,
    launcherAcquireTimeoutMs: LAUNCHER_ACQUIRE_TIMEOUT_MS,
    controlLifecycleTimeoutMs: CONTROL_LIFECYCLE_TIMEOUT_MS,
    lifecycleLockStaleMs: LIFECYCLE_LOCK_STALE_MS,
    lifecycleLockTokenFactory: () => randomBytes(32).toString("hex"),
    nowMs: () => Date.now(),
    processStartInspector: defaultProcessStartInspector,
    repositoryInspector: defaultRepositoryInspector,
    pinnedNodeResolver: defaultPinnedNodeResolver,
    leaseOperationIdGenerator: () => randomUUID(),
    ...overrides,
  };
  dependencies.repoRoot = path.resolve(dependencies.repoRoot);
  dependencies.launcherRoot = path.resolve(dependencies.launcherRoot);
  dependencies.runtimeRoot = path.resolve(dependencies.runtimeRoot);
  dependencies.hostBuildPath = path.resolve(dependencies.hostBuildPath);
  return dependencies;
}

export function executeCommand(command, overrides = {}) {
  if (command.help) return { help: true, usage: usage() };
  const dependencies = dependenciesWithDefaults(overrides);
  assertOwnerHost(dependencies);
  if (command.action === "provision") {
    const repository = dependencies.repositoryInspector(dependencies);
    assertProvisioningReady({
      platform: dependencies.platform,
      uid: dependencies.uid,
      repository,
      repoRoot: realpathSync(dependencies.repoRoot),
    });
  }
  const stateRoot = canonicalStateRoot(command.stateRoot, dependencies, {
    createIfMissing: command.action === "provision",
  });
  if (command.action === "provision") {
    return withLifecycleLock(dependencies, stateRoot, command.action, () =>
      provisionActors(command, dependencies, stateRoot),
    );
  }
  if (command.action === "revoke") {
    return withLifecycleLock(dependencies, stateRoot, command.action, () =>
      revokeActors(command, dependencies, stateRoot),
    );
  }
  if (command.action === "verify") {
    return verifyActors(command, dependencies, stateRoot);
  }
  if (command.action === "acquire") {
    return acquireActor(command, dependencies, stateRoot);
  }
  if (command.action === "accept-host") {
    return withLifecycleLock(dependencies, stateRoot, command.action, () =>
      acceptHost(dependencies, stateRoot),
    );
  }
  fail("invalid_action", `Unsupported action: ${command.action}`);
}

export function runCli(argv, overrides = {}) {
  const command = parseCommand(argv);
  const result = executeCommand(command, overrides);
  if (result.help) {
    process.stdout.write(result.usage);
  } else {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  }
  return result;
}

if (process.argv[1] && realpathSync(process.argv[1]) === __filename) {
  try {
    runCli(process.argv.slice(2));
  } catch (error) {
    const payload = {
      ok: false,
      code:
        error instanceof AutomationActorsError
          ? error.code
          : "automation_actor_failure",
      message: error instanceof Error ? error.message : String(error),
    };
    process.stderr.write(`${JSON.stringify(payload)}\n`);
    process.exitCode = 1;
  }
}
