#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
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
  actorCredentialReadiness,
  actorLauncherReadiness,
  defaultLauncherAttestor,
  readInstalledActorBinding,
  runtimeDigestForPins as sharedRuntimeDigestForPins,
  sha256File,
  validateActorBindingRecord,
} from "./lib/automation-actor-readiness.mjs";

const __filename = fileURLToPath(import.meta.url);
const REPO_ROOT = path.resolve(path.dirname(__filename), "..");
const DEFAULT_LAUNCHER_ROOT = ACTOR_LAUNCHER_RECORD_ROOT;
const DEFAULT_RUNTIME_ROOT = ACTOR_RUNTIME_ROOT;
const KEYCHAIN_SERVICE = "freed-automation-actor";
const LAUNCHER_PURPOSE = ACTOR_LAUNCHER_PURPOSE;
const LAUNCHER_HANDOFF = ACTOR_LAUNCHER_HANDOFF;
const ATTESTATION_PROTOCOL = ACTOR_LAUNCHER_ATTESTATION_PROTOCOL;
const MAX_LEASE_LIFETIME_MS = 30 * 60 * 1_000;
const LEASE_TTL_SECONDS = 30 * 60;
const MAX_LAUNCHER_HANDOFF_BYTES = 16 * 1_024;
const LAUNCHER_ACQUIRE_TIMEOUT_MS = 15_000;
const CONTROL_LIFECYCLE_TIMEOUT_MS = 15_000;
const PROVISIONER_ACTION_TIMEOUT_MS = 120_000;
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
  node scripts/automation-actors.mjs rotate (--actor <actor> | --all) [--state-root <path>]
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
    ![
      "provision",
      "rotate",
      "revoke",
      "verify",
      "acquire",
      "accept-host",
    ].includes(action)
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
    if (result.error?.code === "ETIMEDOUT") {
      const bound = Number.isSafeInteger(timeoutMs)
        ? `${timeoutMs.toLocaleString()} ms`
        : "its configured time bound";
      fail(
        "command_timeout",
        `${purpose} exceeded ${bound}.`,
      );
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
  const provisionerOutput = path.join(
    directory,
    "automation-actor-provisioner",
  );
  const hostBuildPath = inspectRegularFile(dependencies.hostBuildPath);
  runChecked(
    dependencies,
    "/bin/bash",
    [
      hostBuildPath,
      "--host-output",
      hostOutput,
      "--provisioner-output",
      provisionerOutput,
    ],
    { cwd: dependencies.repoRoot, purpose: "Automation actor host build" },
  );
  return {
    hostOutput: inspectRegularFile(hostOutput, { executable: true }),
    provisionerOutput: inspectRegularFile(provisionerOutput, {
      executable: true,
    }),
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

function describeRuntime(dependencies, pinnedNodePath) {
  const controlEntrySource = inspectRegularFile(
    path.join(dependencies.repoRoot, "scripts", "automation-control.mjs"),
  );
  const controlLibrarySource = inspectRegularFile(
    path.join(
      dependencies.repoRoot,
      "scripts",
      "lib",
      "automation-control.mjs",
    ),
  );
  const pins = {
    nodeSha256: sha256File(pinnedNodePath),
    controlEntrySha256: sha256File(controlEntrySource),
    controlLibrarySha256: sha256File(controlLibrarySource),
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
    controlLibrarySource,
    controlLibraryPath: path.join(directory, "lib", "automation-control.mjs"),
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
    runtime.controlLibrarySource,
    runtime.controlLibraryPath,
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
    schemaVersion: 1,
    actor,
    purpose: LAUNCHER_PURPOSE,
    handoff: LAUNCHER_HANDOFF,
    attestationProtocol: ATTESTATION_PROTOCOL,
    keychainService: KEYCHAIN_SERVICE,
    keychainAccount: actor,
    stateRoot,
    leaseName: contract.leaseName,
    maxLeaseLifetimeMs: MAX_LEASE_LIFETIME_MS,
    launcherPath: path.join(launcherRoot, "bin", `${actor}-${launcherSha256}`),
    launcherSha256,
    nodePath: runtime.nodePath,
    nodeSha256: runtime.nodeSha256,
    controlEntryPath: runtime.controlEntryPath,
    controlEntrySha256: runtime.controlEntrySha256,
    controlLibraryPath: runtime.controlLibraryPath,
    controlLibrarySha256: runtime.controlLibrarySha256,
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

function invokeProvisioner(
  dependencies,
  provisionerPath,
  action,
  actor,
  stateRoot,
) {
  runChecked(
    dependencies,
    provisionerPath,
    [action, "--actor", actor, "--state-root", stateRoot],
    {
      purpose: `Automation actor ${actor} ${action}`,
      timeoutMs: dependencies.provisionerActionTimeoutMs,
      stdin: "ignore",
    },
  );
}

function provisionActors(command, dependencies, stateRoot) {
  const actors =
    command.actor === "all" ? AUTOMATION_ACTOR_IDS : [command.actor];
  const pinnedNodePath = dependencies.pinnedNodeResolver(dependencies);
  const runtime = describeRuntime(dependencies, pinnedNodePath);

  return withPrivateTempDirectory(dependencies, (privateDirectory) => {
    const artifacts = buildHostArtifacts(dependencies, privateDirectory);
    installRuntime(dependencies, runtime);
    const records = [];
    const provisionedActors = [];
    try {
      for (const actor of actors) {
        const installed = installActorPublicMaterial(dependencies, {
          actor,
          stateRoot,
          hostOutput: artifacts.hostOutput,
          runtime,
          privateDirectory,
        });
        invokeProvisioner(
          dependencies,
          artifacts.provisionerOutput,
          "provision",
          actor,
          stateRoot,
        );
        provisionedActors.push(actor);
        records.push({
          actor,
          leaseName: AUTOMATION_ACTORS[actor].leaseName,
          bindingPath: installed.bindingPath,
        });
      }
    } catch (error) {
      const rollbackFailures = [];
      for (const actor of [...provisionedActors].reverse()) {
        try {
          invokeProvisioner(
            dependencies,
            artifacts.provisionerOutput,
            "revoke",
            actor,
            stateRoot,
          );
        } catch {
          rollbackFailures.push(actor);
        }
      }
      if (rollbackFailures.length > 0) {
        fail(
          "provision_rollback_failed",
          `Provisioning failed, and rollback failed for ${rollbackFailures.join(", ")}. Explicit owner recovery is required.`,
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

function runProvisionerAction(command, dependencies, stateRoot) {
  return withPrivateTempDirectory(dependencies, (privateDirectory) => {
    const artifacts = buildHostArtifacts(dependencies, privateDirectory);
    const actors =
      command.actor === "all" ? AUTOMATION_ACTOR_IDS : [command.actor];
    for (const actor of actors) {
      invokeProvisioner(
        dependencies,
        artifacts.provisionerOutput,
        command.action,
        actor,
        stateRoot,
      );
    }
    return command.actor === "all"
      ? {
          action: command.action,
          stateRoot,
          records: actors.map((actor) => ({ actor })),
        }
      : {
          action: command.action,
          actor: command.actor,
          stateRoot,
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
  let result;
  try {
    result = JSON.parse(stdout);
  } catch {
    return { valid: false, plausibleLeaseToken: undefined };
  }
  const plausibleLeaseToken =
    typeof result?.leaseToken === "string" &&
    Buffer.byteLength(result.leaseToken, "utf8") >= 16 &&
    Buffer.byteLength(result.leaseToken, "utf8") <= 4 * 1_024
      ? result.leaseToken
      : undefined;
  const expectedHandoffKeys = [
    "acquiredAt",
    "actor",
    "expiresAt",
    "leaseName",
    "leaseToken",
    "schemaVersion",
    "ttlMs",
  ].sort();
  try {
    const acquiredAt = Date.parse(result?.acquiredAt);
    const expiresAt = Date.parse(result?.expiresAt);
    if (
      Buffer.byteLength(stdout, "utf8") > MAX_LAUNCHER_HANDOFF_BYTES ||
      !result ||
      typeof result !== "object" ||
      Array.isArray(result) ||
      Object.keys(result).sort().join("\n") !==
        expectedHandoffKeys.join("\n") ||
      result.schemaVersion !== 1 ||
      result.actor !== actor ||
      result.leaseName !== leaseName ||
      typeof result.leaseToken !== "string" ||
      Buffer.byteLength(result.leaseToken, "utf8") < 16 ||
      Buffer.byteLength(result.leaseToken, "utf8") > 4 * 1_024 ||
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
    const before = runPinnedControl(
      dependencies,
      binding,
      stateRoot,
      "show",
    );
    if (before === null) return;
    if (
      before?.name !== binding.leaseName ||
      before?.owner !== actor ||
      !["active", "expired"].includes(before?.status)
    ) {
      throw new Error("unexpected live lease");
    }
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
    if (
      runPinnedControl(dependencies, binding, stateRoot, "show") !== null
    ) {
      throw new Error("lease remains live");
    }
  } catch {
    fail(
      "acquire_cleanup_failed",
      `Malformed acquisition may have left the ${actor} lease live.`,
    );
  }
}

function attestActor(actor, dependencies, stateRoot) {
  const credential = actorCredentialReadiness(stateRoot, actor, {
    requiredUid: dependencies.uid,
  });
  const readiness = actorLauncherReadiness(stateRoot, actor, {
    credential,
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
    fail("invalid_control_response", "The pinned control output was too large.");
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
  const stdout = runChecked(dependencies, binding.nodePath, args, {
    purpose: `Automation actor lease ${action}`,
    timeoutMs: dependencies.controlLifecycleTimeoutMs,
    stdin: "ignore",
    additionalEnv:
      leaseToken === undefined
        ? {}
        : { FREED_AUTOMATION_LEASE_TOKEN: leaseToken },
  });
  return parseControlResponse(stdout, {
    action: `lease.${action}`,
    stateRoot,
  });
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
      credentialPath: readiness.credentialPath,
      credentialSha256: readiness.credentialSha256,
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
    initialReadinesses.map(
      (readiness) => readiness.binding.launcherSha256,
    ),
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
        `The installed ${actor} credential or launcher identity changed during acceptance.`,
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
    provisionerActionTimeoutMs: PROVISIONER_ACTION_TIMEOUT_MS,
    repositoryInspector: defaultRepositoryInspector,
    pinnedNodeResolver: defaultPinnedNodeResolver,
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
  if (["provision", "rotate", "revoke"].includes(command.action)) {
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
    return provisionActors(command, dependencies, stateRoot);
  }
  if (["rotate", "revoke"].includes(command.action)) {
    return runProvisionerAction(command, dependencies, stateRoot);
  }
  if (command.action === "verify") {
    return verifyActors(command, dependencies, stateRoot);
  }
  if (command.action === "acquire") {
    return acquireActor(command, dependencies, stateRoot);
  }
  if (command.action === "accept-host") {
    return acceptHost(dependencies, stateRoot);
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
