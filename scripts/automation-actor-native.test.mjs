import assert from "node:assert/strict";
import { execFile, execFileSync, spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmod,
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import test, { after, before } from "node:test";

const execFileAsync = promisify(execFile);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const hostSource = path.join(root, "scripts/automation-actor-host.swift");
const callerSource = path.join(root, "scripts/automation-actors.mjs");
const buildHelper = path.join(root, "scripts/automation-actor-host-build.sh");
const provisionerSource = path.join(
  root,
  "scripts/automation-actor-provision.swift",
);
const darwinOnly = process.platform === "darwin";
const developerDirectory = darwinOnly
  ? execFileSync("/usr/bin/xcode-select", ["-p"], {
      encoding: "utf8",
    }).trim()
  : "";
const sdkPath = darwinOnly
  ? execFileSync("/usr/bin/xcrun", ["--sdk", "macosx", "--show-sdk-path"], {
      encoding: "utf8",
      env: { ...process.env, DEVELOPER_DIR: developerDirectory },
    }).trim()
  : "";
const deploymentTarget = `${os.arch() === "arm64" ? "arm64" : "x86_64"}-apple-macosx10.15`;
const defaultActor = "freed-scaffolding-maintainer";
const legacyCredential =
  "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
const actorLeaseNames = new Map([
  ["freed-runtime-observer", "runtime-observer"],
  ["freed-stability-controller", "stability-controller"],
  ["freed-scaffolding-maintainer", "scaffolding-writer"],
  ["freed-nightly-runner", "nightly-writer"],
  ["freed-release-verifier", "release-verifier"],
]);
const actorLeaseAuthorities = new Map([
  [
    "freed-runtime-observer",
    { observer: "observe-only", provider: "forbidden" },
  ],
  [
    "freed-stability-controller",
    { observer: "plan-only", provider: "forbidden" },
  ],
  [
    "freed-scaffolding-maintainer",
    { observer: "pr-only", provider: "forbidden" },
  ],
  [
    "freed-nightly-runner",
    { observer: "merge-safe", provider: "approval-required" },
  ],
  [
    "freed-release-verifier",
    { observer: "observe-only", provider: "forbidden" },
  ],
]);

let buildRoot = "";
let testHost = "";
let productionHost = "";
let testProvisioner = "";
let productionProvisioner = "";

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

async function sha256File(file) {
  return sha256(await readFile(file));
}

async function compileSwift({ source, output, testingFlag, frameworks }) {
  const arguments_ = [
    "--sdk",
    "macosx",
    "swiftc",
    "-sdk",
    sdkPath,
    "-target",
    deploymentTarget,
  ];
  if (testingFlag) arguments_.push("-D", testingFlag);
  arguments_.push(source, "-o", output);
  for (const framework of frameworks) {
    arguments_.push("-framework", framework);
  }
  await execFileAsync("/usr/bin/xcrun", arguments_, {
    cwd: root,
    env: { ...process.env, DEVELOPER_DIR: developerDirectory },
  });
}

before(async () => {
  if (!darwinOnly) return;
  buildRoot = await realpath(
    await mkdtemp(path.join(os.tmpdir(), "freed-actor-native-build-")),
  );
  await chmod(buildRoot, 0o700);
  testHost = path.join(buildRoot, "automation-actor-host-test");
  productionHost = path.join(buildRoot, "automation-actor-host-production");
  testProvisioner = path.join(buildRoot, "automation-actor-provision-test");
  productionProvisioner = path.join(
    buildRoot,
    "automation-actor-provision-production",
  );
  await Promise.all([
    compileSwift({
      source: hostSource,
      output: testHost,
      testingFlag: "AUTOMATION_ACTOR_HOST_TESTING",
      frameworks: ["CryptoKit"],
    }),
    compileSwift({
      source: hostSource,
      output: productionHost,
      frameworks: ["CryptoKit"],
    }),
    compileSwift({
      source: provisionerSource,
      output: testProvisioner,
      testingFlag: "AUTOMATION_ACTOR_PROVISION_TESTING",
      frameworks: ["CryptoKit", "Security"],
    }),
    compileSwift({
      source: provisionerSource,
      output: productionProvisioner,
      frameworks: ["CryptoKit", "Security"],
    }),
  ]);
});

after(async () => {
  if (buildRoot) await rm(buildRoot, { recursive: true, force: true });
});

function runtimeDigest(pins) {
  return sha256(
    [
      "freed-automation-actor-runtime-v4",
      `node:${pins.nodeSha256}`,
      `automation-control.mjs:${pins.controlEntrySha256}`,
      `automation-actor-control.mjs:${pins.actorControlEntrySha256}`,
      `lib/automation-control.mjs:${pins.controlLibrarySha256}`,
      `lib/automation-actor-readiness.mjs:${pins.readinessLibrarySha256}`,
      `lib/automation-kernel-guard-contract.mjs:${pins.kernelGuardContractSha256}`,
      `lib/outcome-ledger-repair-contract.mjs:${pins.outcomeLedgerRepairContractSha256}`,
      `lib/lease-archive-move.py:${pins.leaseArchiveHelperSha256}`,
      "",
    ].join("\n"),
  );
}

function legacyRuntimeDigest(pins) {
  return sha256(
    [
      "freed-automation-actor-runtime-v1",
      `node:${pins.nodeSha256}`,
      `automation-control.mjs:${pins.controlEntrySha256}`,
      `lib/automation-control.mjs:${pins.controlLibrarySha256}`,
      "",
    ].join("\n"),
  );
}

function nestedControlSource() {
  return `
import { spawnSync } from "node:child_process";
const [host, ...arguments_] = process.argv.slice(2);
const controlPidIndex = arguments_.indexOf("--control-pid");
if (!host || controlPidIndex < 0) process.exit(2);
arguments_[controlPidIndex + 1] = String(process.pid);
const result = spawnSync(host, arguments_, {
  encoding: "utf8",
  env: { LANG: "C", LC_ALL: "C", PATH: "/usr/bin:/bin" },
  stdio: ["ignore", "pipe", "pipe", 3],
});
if (result.stdout) process.stdout.write(result.stdout);
if (result.stderr) process.stderr.write(result.stderr);
process.exit(result.status ?? 1);
`;
}

function actorControlSource({
  mode,
  host,
  bindingPath,
  runtimeRoot,
  environmentCapturePath,
}) {
  return `
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { closeSync, readFileSync, readSync, unlinkSync, writeFileSync } from "node:fs";
import { once } from "node:events";
import net from "node:net";
import os from "node:os";
import path from "node:path";

const MODE = ${JSON.stringify(mode)};
const HOST = ${JSON.stringify(host)};
const BINDING_PATH = ${JSON.stringify(bindingPath)};
const RUNTIME_ROOT = ${JSON.stringify(runtimeRoot)};
const ENVIRONMENT_CAPTURE_PATH = ${JSON.stringify(environmentCapturePath)};
const AUTHORITIES = ${JSON.stringify(Object.fromEntries(actorLeaseAuthorities))};
process.on("uncaughtException", (error) => {
  writeFileSync(ENVIRONMENT_CAPTURE_PATH + ".error", String(error?.stack ?? error));
  process.exit(1);
});
process.on("unhandledRejection", (error) => {
  writeFileSync(ENVIRONMENT_CAPTURE_PATH + ".error", String(error?.stack ?? error));
  process.exit(1);
});
const options = {};
for (let index = 2; index < process.argv.length; index += 2) {
  options[process.argv[index]] = process.argv[index + 1];
}
writeFileSync(ENVIRONMENT_CAPTURE_PATH, JSON.stringify(Object.keys(process.env).sort()));
const frameBytes = [];
const byte = Buffer.allocUnsafe(1);
while (frameBytes.length < 8192) {
  const count = readSync(3, byte, 0, 1, null);
  if (count !== 1) throw new Error("missing launcher frame");
  if (byte[0] === 10) break;
  frameBytes.push(byte[0]);
}
const frame = JSON.parse(Buffer.from(frameBytes).toString("utf8"));
const binding = JSON.parse(readFileSync(BINDING_PATH, "utf8"));
const tokenSha256 = createHash("sha256").update(frame.leaseToken).digest("hex");
const verifierArgs = (overrides = {}) => [
  "--verify-control-channel",
  "--protocol", "freed-actor-launcher-channel-v1",
  "--channel-action", overrides.action ?? options["--action"],
  "--actor", options["--actor"],
  "--state-root", options["--state-root"],
  "--lease-name", options["--lease-name"],
  "--operation-id", overrides.operationId ?? frame.leaseOperationId,
  "--token-sha256", overrides.tokenSha256 ?? tokenSha256,
  "--ttl-seconds", options["--ttl-seconds"],
  "--challenge-sha256", overrides.challengeSha256 ?? options["--challenge-sha256"],
  "--control-pid", overrides.controlPid ?? String(process.pid),
  "--channel-fd", "3",
  "--test-binding", BINDING_PATH,
  "--test-runtime-root", RUNTIME_ROOT,
];
const invokeVerifier = (fd = 3, overrides = {}) =>
  spawnSync(HOST, verifierArgs(overrides), {
    encoding: "utf8",
    env: { HOSTILE_SECRET: "must-not-matter" },
    stdio: ["ignore", "pipe", "pipe", fd],
  });

let verification;
if (MODE === "closed-channel") {
  closeSync(3);
  verification = invokeVerifier("ignore");
} else if (MODE === "wrong-control-pid") {
  verification = invokeVerifier(3, { controlPid: String(process.pid + 1) });
} else if (MODE === "wrong-parent") {
  verification = spawnSync(
    binding.nodePath,
    [binding.controlEntryPath, HOST, ...verifierArgs()],
    { encoding: "utf8", stdio: ["ignore", "pipe", "pipe", 3] },
  );
} else if (MODE === "fake-peer") {
  const socketPath = path.join(os.tmpdir(), "freed-fake-peer-" + process.pid + ".sock");
  const server = net.createServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(socketPath, resolve);
  });
  const acceptedPromise = once(server, "connection");
  const client = net.createConnection(socketPath);
  await once(client, "connect");
  const [accepted] = await acceptedPromise;
  verification = invokeVerifier(accepted._handle.fd);
  accepted.destroy();
  client.destroy();
  await new Promise((resolve) => server.close(resolve));
  try { unlinkSync(socketPath); } catch {}
} else {
  verification = invokeVerifier();
  if (MODE === "replay-channel" && verification.status === 0) {
    verification = invokeVerifier();
  }
}
if (verification.status !== 0) {
  writeFileSync(
    ENVIRONMENT_CAPTURE_PATH + ".error",
    JSON.stringify({
      status: verification.status,
      signal: verification.signal,
      stderr: verification.stderr,
      stdout: verification.stdout,
    }),
  );
  process.stderr.write(verification.stderr || "channel verification failed\\n");
  process.exit(1);
}
const channel = JSON.parse(verification.stdout);
if (MODE === "slow-process-success") {
  await new Promise((resolve) => setTimeout(resolve, 11_000));
}
if (options["--action"] === "attest") {
  const readiness = {
    schemaVersion: 1,
    protocol: "freed-actor-launcher-readiness-v3",
    purpose: "automation-actor-launcher-readiness",
    actor: options["--actor"],
    stateRoot: options["--state-root"],
    leaseName: options["--lease-name"],
    maxLeaseLifetimeMs: 1800000,
    handoff: "trusted-launcher-channel-to-canonical-lease",
    channelProtocol: "freed-actor-launcher-channel-v1",
    launcherSha256: MODE === "wrong-readiness" ? "0".repeat(64) : channel.launcherSha256,
    runtimeDigest: channel.runtimeDigest,
    canonicalLeaseReady: true,
    mutatesState: MODE === "mutating-readiness",
  };
  if (MODE === "extra-readiness") readiness.extra = true;
  process.stdout.write(JSON.stringify(readiness) + "\\n");
} else {
  const authority = AUTHORITIES[options["--actor"]];
  const acquiredAt = "2026-07-22T12:00:00.000Z";
  const expiresAt = MODE === "overlong-lease"
    ? "2026-07-22T12:30:00.001Z"
    : "2026-07-22T12:30:00.000Z";
  const lease = {
    schemaVersion: 1,
    name: options["--lease-name"],
    owner: options["--actor"],
    token: MODE === "short-token" ? "short" : frame.leaseToken,
    observerAuthority: MODE === "wrong-observer-authority"
      ? "forbidden"
      : authority.observer,
    providerAuthority: MODE === "wrong-provider-authority"
      ? "unrestricted"
      : authority.provider,
    credentialKind: MODE === "wrong-kind"
      ? "persistent-actor"
      : "trusted-launcher-channel",
    launcherSha256: channel.launcherSha256,
    actorRuntimeDigest: MODE === "wrong-provenance"
      ? "0".repeat(64)
      : channel.runtimeDigest,
    launcherChannelProtocol: "freed-actor-launcher-channel-v1",
    launcherAttestationSha256: createHash("sha256").update(verification.stdout).digest("hex"),
    launcherSessionId: channel.sessionId,
    acquiredAt,
    heartbeatAt: acquiredAt,
    expiresAt,
    ttlMs: 1800000,
  };
  if (MODE === "extra-lease") lease.extra = true;
  const result = { acquired: true, takeover: false, credentialUpgrade: false, lease };
  if (MODE === "extra-result") result.extra = true;
  const envelope = {
    ok: true,
    schemaVersion: 1,
    action: "lease.acquire",
    stateRoot: options["--state-root"],
    result,
  };
  if (MODE === "extra-envelope") envelope.extra = true;
  const output = JSON.stringify(envelope) + "\\n";
  process.stdout.write(MODE === "oversized" ? "x".repeat(70000) : output);
}
`;
}

async function createFixture({ actor = defaultActor, mode = "valid" } = {}) {
  const fixtureRoot = await realpath(
    await mkdtemp(path.join(os.tmpdir(), "freed-actor-native-fixture-")),
  );
  await chmod(fixtureRoot, 0o700);
  const bindingRoot = path.join(fixtureRoot, "automation-actor-launchers");
  const launcherDirectory = path.join(bindingRoot, "bin");
  const runtimeRoot = path.join(fixtureRoot, "automation-actor-runtimes");
  const stateRoot = path.join(fixtureRoot, "state");
  await mkdir(launcherDirectory, { recursive: true, mode: 0o700 });
  await mkdir(runtimeRoot, { mode: 0o700 });
  await mkdir(stateRoot, { mode: 0o700 });
  for (const directory of [
    bindingRoot,
    launcherDirectory,
    runtimeRoot,
    stateRoot,
  ]) {
    await chmod(directory, 0o700);
  }
  const launcherSha256 = await sha256File(testHost);
  const launcherPath = path.join(
    launcherDirectory,
    `${actor}-${launcherSha256}`,
  );
  await copyFile(testHost, launcherPath);
  await chmod(launcherPath, 0o755);
  const bindingPath = path.join(bindingRoot, `${actor}.json`);
  const environmentCapturePath = path.join(
    fixtureRoot,
    "child-environment.json",
  );
  const files = {
    actorControl: Buffer.from(
      actorControlSource({
        mode,
        host: launcherPath,
        bindingPath,
        runtimeRoot,
        environmentCapturePath,
      }),
    ),
    controlEntry: Buffer.from(nestedControlSource()),
    controlLibrary: Buffer.from("export {};\n"),
    readinessLibrary: Buffer.from("export {};\n"),
    kernelGuardContract: Buffer.from("export {};\n"),
    outcomeLedgerRepairContract: Buffer.from("export {};\n"),
    leaseArchiveHelper: Buffer.from("print('archive helper fixture')\n"),
  };
  const pins = {
    nodeSha256: await sha256File(process.execPath),
    controlEntrySha256: sha256(files.controlEntry),
    actorControlEntrySha256: sha256(files.actorControl),
    controlLibrarySha256: sha256(files.controlLibrary),
    readinessLibrarySha256: sha256(files.readinessLibrary),
    kernelGuardContractSha256: sha256(files.kernelGuardContract),
    outcomeLedgerRepairContractSha256: sha256(
      files.outcomeLedgerRepairContract,
    ),
    leaseArchiveHelperSha256: sha256(files.leaseArchiveHelper),
  };
  const digest = runtimeDigest(pins);
  const runtimeDirectory = path.join(runtimeRoot, digest);
  const libraryDirectory = path.join(runtimeDirectory, "lib");
  await mkdir(libraryDirectory, { recursive: true, mode: 0o700 });
  await chmod(runtimeDirectory, 0o700);
  await chmod(libraryDirectory, 0o700);
  const paths = {
    nodePath: path.join(runtimeDirectory, "node"),
    actorControlEntryPath: path.join(
      runtimeDirectory,
      "automation-actor-control.mjs",
    ),
    controlEntryPath: path.join(runtimeDirectory, "automation-control.mjs"),
    controlLibraryPath: path.join(libraryDirectory, "automation-control.mjs"),
    readinessLibraryPath: path.join(
      libraryDirectory,
      "automation-actor-readiness.mjs",
    ),
    kernelGuardContractPath: path.join(
      libraryDirectory,
      "automation-kernel-guard-contract.mjs",
    ),
    outcomeLedgerRepairContractPath: path.join(
      libraryDirectory,
      "outcome-ledger-repair-contract.mjs",
    ),
    leaseArchiveHelperPath: path.join(
      libraryDirectory,
      "lease-archive-move.py",
    ),
  };
  await copyFile(process.execPath, paths.nodePath);
  await chmod(paths.nodePath, 0o755);
  const writes = [
    [paths.actorControlEntryPath, files.actorControl],
    [paths.controlEntryPath, files.controlEntry],
    [paths.controlLibraryPath, files.controlLibrary],
    [paths.readinessLibraryPath, files.readinessLibrary],
    [paths.kernelGuardContractPath, files.kernelGuardContract],
    [paths.outcomeLedgerRepairContractPath, files.outcomeLedgerRepairContract],
    [paths.leaseArchiveHelperPath, files.leaseArchiveHelper],
  ];
  for (const [file, bytes] of writes) {
    await writeFile(file, bytes, { mode: 0o600 });
    await chmod(file, 0o600);
  }
  const binding = {
    schemaVersion: 4,
    actor,
    purpose: "automation-actor-launcher",
    handoff: "trusted-launcher-channel-to-canonical-lease",
    attestationProtocol: "freed-actor-launcher-readiness-v3",
    launcherPath,
    launcherSha256,
    stateRoot,
    leaseName: actorLeaseNames.get(actor),
    maxLeaseLifetimeMs: 1_800_000,
    ...paths,
    ...pins,
  };
  await writeFile(bindingPath, `${JSON.stringify(binding, null, 2)}\n`, {
    mode: 0o600,
  });
  await chmod(bindingPath, 0o600);
  return {
    fixtureRoot,
    bindingRoot,
    bindingPath,
    binding,
    runtimeRoot,
    stateRoot,
    environmentCapturePath,
    host: launcherPath,
    runtimeDigest: digest,
  };
}

async function rewriteBinding(fixture, transform) {
  fixture.binding = transform(structuredClone(fixture.binding));
  await writeFile(
    fixture.bindingPath,
    `${JSON.stringify(fixture.binding, null, 2)}\n`,
  );
  await chmod(fixture.bindingPath, 0o600);
}

function fixtureFlags(fixture, { channelMode, controlMode } = {}) {
  return [
    "--test-binding",
    fixture.bindingPath,
    "--test-runtime-root",
    fixture.runtimeRoot,
    ...(channelMode ? ["--test-channel-mode", channelMode] : []),
    ...(controlMode ? ["--test-control-mode", controlMode] : []),
  ];
}

function readinessArguments(fixture, options = {}) {
  return [
    "--attest-readiness",
    "--protocol",
    "freed-actor-launcher-readiness-v3",
    "--actor",
    fixture.binding.actor,
    "--state-root",
    fixture.stateRoot,
    "--lease-name",
    fixture.binding.leaseName,
    "--max-lifetime-ms",
    "1800000",
    ...fixtureFlags(fixture, options),
  ];
}

function acquisitionArguments(fixture, options = {}) {
  return [
    "--acquire-lease",
    "--actor",
    fixture.binding.actor,
    "--state-root",
    fixture.stateRoot,
    "--lease-name",
    fixture.binding.leaseName,
    "--ttl-seconds",
    "1800",
    ...fixtureFlags(fixture, options),
  ];
}

function verifierArguments(fixture) {
  return [
    "--verify-control-channel",
    "--protocol",
    "freed-actor-launcher-channel-v1",
    "--channel-action",
    "acquire",
    "--actor",
    fixture.binding.actor,
    "--state-root",
    fixture.stateRoot,
    "--lease-name",
    fixture.binding.leaseName,
    "--operation-id",
    "00000000-0000-4000-8000-000000000000",
    "--token-sha256",
    "b".repeat(64),
    "--ttl-seconds",
    "1800",
    "--challenge-sha256",
    "a".repeat(64),
    "--control-pid",
    String(process.pid),
    "--channel-fd",
    "3",
    ...fixtureFlags(fixture),
  ];
}

function invoke(file, args, env = {}) {
  return spawnSync(file, args, {
    encoding: "utf8",
    env: { ...process.env, ...env },
    timeout: 15_000,
  });
}

function startRun(file, args) {
  const child = spawn(file, args, {
    env: { ...process.env },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (value) => {
    stdout += value;
  });
  child.stderr.on("data", (value) => {
    stderr += value;
  });
  return {
    child,
    result: new Promise((resolve, reject) => {
      child.once("error", reject);
      child.once("close", (code, signal) =>
        resolve({ code, signal, stdout, stderr }),
      );
    }),
  };
}

async function waitForFile(file, timeoutMs = 5_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      await stat(file);
      return;
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`timed out waiting for ${file}`);
}

async function withFixture(options, operation) {
  const fixture = await createFixture(options);
  try {
    return await operation(fixture);
  } finally {
    await rm(fixture.fixtureRoot, { recursive: true, force: true });
  }
}

async function createLegacyFixture({
  actor = defaultActor,
  record = true,
} = {}) {
  const fixtureRoot = await realpath(
    await mkdtemp(path.join(os.tmpdir(), "freed-actor-legacy-fixture-")),
  );
  await chmod(fixtureRoot, 0o700);
  const bindingRoot = path.join(fixtureRoot, "automation-actor-launchers");
  const launcherDirectory = path.join(bindingRoot, "bin");
  const runtimeRoot = path.join(fixtureRoot, "automation-actor-runtimes");
  const stateRoot = path.join(fixtureRoot, "state");
  await mkdir(launcherDirectory, { recursive: true, mode: 0o700 });
  await mkdir(runtimeRoot, { mode: 0o700 });
  await mkdir(stateRoot, { mode: 0o700 });
  for (const directory of [
    bindingRoot,
    launcherDirectory,
    runtimeRoot,
    stateRoot,
  ]) {
    await chmod(directory, 0o700);
  }
  const launcherSha256 = await sha256File(testHost);
  const launcherPath = path.join(
    launcherDirectory,
    `${actor}-${launcherSha256}`,
  );
  await copyFile(testHost, launcherPath);
  await chmod(launcherPath, 0o755);
  const files = {
    node: Buffer.from("#!/bin/sh\nexit 0\n"),
    controlEntry: Buffer.from("export {};\n"),
    controlLibrary: Buffer.from("export {};\n"),
  };
  const pins = {
    nodeSha256: sha256(files.node),
    controlEntrySha256: sha256(files.controlEntry),
    controlLibrarySha256: sha256(files.controlLibrary),
  };
  const digest = legacyRuntimeDigest(pins);
  const runtimeDirectory = path.join(runtimeRoot, digest);
  const libraryDirectory = path.join(runtimeDirectory, "lib");
  await mkdir(libraryDirectory, { recursive: true, mode: 0o700 });
  await chmod(runtimeDirectory, 0o700);
  await chmod(libraryDirectory, 0o700);
  const nodePath = path.join(runtimeDirectory, "node");
  const controlEntryPath = path.join(
    runtimeDirectory,
    "automation-control.mjs",
  );
  const controlLibraryPath = path.join(
    libraryDirectory,
    "automation-control.mjs",
  );
  await writeFile(nodePath, files.node, { mode: 0o755 });
  await writeFile(controlEntryPath, files.controlEntry, { mode: 0o600 });
  await writeFile(controlLibraryPath, files.controlLibrary, { mode: 0o600 });
  await chmod(nodePath, 0o755);
  await chmod(controlEntryPath, 0o600);
  await chmod(controlLibraryPath, 0o600);
  const binding = {
    schemaVersion: 1,
    actor,
    purpose: "automation-actor-launcher",
    handoff: "keychain-to-canonical-lease",
    attestationProtocol: "freed-actor-launcher-readiness-v1",
    launcherPath,
    launcherSha256,
    stateRoot,
    leaseName: actorLeaseNames.get(actor),
    maxLeaseLifetimeMs: 1_800_000,
    keychainService: "freed-automation-actor",
    keychainAccount: actor,
    nodePath,
    nodeSha256: pins.nodeSha256,
    controlEntryPath,
    controlEntrySha256: pins.controlEntrySha256,
    controlLibraryPath,
    controlLibrarySha256: pins.controlLibrarySha256,
  };
  const bindingPath = path.join(bindingRoot, `${actor}.json`);
  await writeFile(bindingPath, `${JSON.stringify(binding, null, 2)}\n`, {
    mode: 0o600,
  });
  await chmod(bindingPath, 0o600);
  const recordPath = path.join(
    stateRoot,
    "control",
    "actor-credentials",
    `${actor}.json`,
  );
  if (record) {
    await mkdir(path.dirname(recordPath), { recursive: true, mode: 0o700 });
    await chmod(path.join(stateRoot, "control"), 0o700);
    await chmod(path.dirname(recordPath), 0o700);
    await writeFile(
      recordPath,
      `${JSON.stringify({
        schemaVersion: 1,
        actor,
        purpose: "automation-actor-lease",
        tokenSha256: sha256(legacyCredential),
      })}\n`,
      { mode: 0o600 },
    );
    await chmod(recordPath, 0o600);
  }
  return {
    fixtureRoot,
    binding,
    bindingPath,
    runtimeRoot,
    stateRoot,
    recordPath,
  };
}

function provisionerArguments(fixture, action, state) {
  return [
    action,
    "--actor",
    fixture.binding.actor,
    "--state-root",
    fixture.stateRoot,
    "--test-binding",
    fixture.bindingPath,
    "--test-runtime-root",
    fixture.runtimeRoot,
    "--test-keychain-state",
    state,
  ];
}

test("native actor lifecycle budget stays below the caller outer ceiling", async () => {
  const [host, caller] = await Promise.all([
    readFile(hostSource, "utf8"),
    readFile(callerSource, "utf8"),
  ]);
  const acquisition = Number(
    /nativeAcquisitionWindowMilliseconds: UInt64 = (\d+) \* 1_000/.exec(
      host,
    )[1],
  );
  const cleanup = Number(
    /nativeCleanupReserveMilliseconds: UInt64 = (\d+) \* 1_000/.exec(host)[1],
  );
  const control = Number(
    /controlTimeoutMilliseconds: UInt64 = (\d+) \* 1_000/.exec(host)[1],
  );
  const callerBudget = Number(
    /NATIVE_LAUNCHER_LIFECYCLE_BUDGET_MS = ([\d_]+);/
      .exec(caller)[1]
      .replaceAll("_", ""),
  );
  assert.equal(callerBudget, (acquisition + cleanup) * 1_000);
  assert.equal(control, 30);
  assert.ok(acquisition >= control * 2 + 5);
  assert.ok(cleanup >= control * 4 + 5);
});

test(
  "native readiness uses the live launcher channel without reusable credentials",
  { skip: !darwinOnly },
  async () => {
    await withFixture({}, async (fixture) => {
      const result = invoke(fixture.host, readinessArguments(fixture), {
        FREED_AUTOMATION_ACTOR_TOKEN: "hostile-persistent-token",
        FREED_AUTOMATION_LEASE_TOKEN: "hostile-lease-token",
        NODE_OPTIONS: "--inspect",
      });
      const childError = await readFile(
        `${fixture.environmentCapturePath}.error`,
        "utf8",
      ).catch(() => "");
      assert.equal(result.status, 0, `${result.stderr}\n${childError}`);
      const readiness = JSON.parse(result.stdout);
      assert.equal(readiness.canonicalLeaseReady, true);
      assert.equal(readiness.mutatesState, false);
      assert.equal(readiness.runtimeDigest, fixture.runtimeDigest);
      assert.deepEqual(await readdir(fixture.stateRoot), []);
      const names = JSON.parse(
        await readFile(fixture.environmentCapturePath, "utf8"),
      ).filter((name) => name !== "__CF_USER_TEXT_ENCODING");
      assert.deepEqual(names, ["LANG", "LC_ALL", "PATH"]);
      assert.doesNotMatch(result.stdout + result.stderr, /hostile/);
    });
  },
);

test(
  "native acquisition returns only the caller-retained short lease for every actor",
  { skip: !darwinOnly },
  async () => {
    for (const [actor, leaseName] of actorLeaseNames) {
      await withFixture({ actor }, async (fixture) => {
        const result = invoke(
          fixture.host,
          acquisitionArguments(fixture, { controlMode: "process" }),
        );
        assert.equal(result.status, 0, `${actor}: ${result.stderr}`);
        const handoff = JSON.parse(result.stdout);
        assert.deepEqual(Object.keys(handoff).sort(), [
          "acquiredAt",
          "actor",
          "expiresAt",
          "leaseName",
          "leaseOperationId",
          "leaseToken",
          "leaseTokenSha256",
          "schemaVersion",
          "ttlMs",
        ]);
        assert.equal(handoff.actor, actor);
        assert.equal(handoff.leaseName, leaseName);
        assert.match(
          handoff.leaseOperationId,
          /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
        );
        assert.equal(handoff.leaseTokenSha256, sha256(handoff.leaseToken));
        assert.ok(Buffer.byteLength(handoff.leaseToken) >= 32);
        assert.equal(handoff.ttlMs, 1_800_000);
      });
    }
  },
);

test(
  "native acquisition retries response loss with the exact operation and token",
  { skip: !darwinOnly },
  async () => {
    await withFixture({}, async (fixture) => {
      const result = invoke(
        fixture.host,
        acquisitionArguments(fixture, {
          controlMode: "response-loss-once",
        }),
      );
      assert.equal(result.status, 0, result.stderr);
      const records = (
        await readFile(
          path.join(fixture.stateRoot, "test-actor-control.jsonl"),
          "utf8",
        )
      )
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line));
      assert.equal(records.length, 2);
      assert.equal(records[0].operationId, records[1].operationId);
      assert.equal(records[0].leaseTokenSha256, records[1].leaseTokenSha256);
      assert.ok(records.every((record) => record.channelAuthorityPresent));
    });
  },
);

test(
  "native process acquisition returns a durable success beyond the former child deadline",
  { skip: !darwinOnly, timeout: 25_000 },
  async () => {
    await withFixture({ mode: "slow-process-success" }, async (fixture) => {
      const startedAt = Date.now();
      const result = spawnSync(
        fixture.host,
        acquisitionArguments(fixture, { controlMode: "process" }),
        {
          encoding: "utf8",
          env: { ...process.env },
          timeout: 20_000,
        },
      );
      assert.equal(result.status, 0, result.stderr);
      assert.ok(Date.now() - startedAt >= 11_000);
      const handoff = JSON.parse(result.stdout);
      assert.equal(handoff.actor, fixture.binding.actor);
      assert.equal(handoff.leaseName, fixture.binding.leaseName);
      assert.equal(handoff.leaseTokenSha256, sha256(handoff.leaseToken));
      assert.equal(
        await readFile(`${fixture.environmentCapturePath}.error`, "utf8").catch(
          () => "",
        ),
        "",
      );
    });
  },
);

test(
  "native cancellation before handoff releases and proves lease absence",
  { skip: !darwinOnly, timeout: 15_000 },
  async () => {
    for (const [signal, expectedCode] of [
      ["SIGINT", 130],
      ["SIGTERM", 143],
    ]) {
      await withFixture({}, async (fixture) => {
        const execution = startRun(
          fixture.host,
          acquisitionArguments(fixture, {
            controlMode: "post-child-handoff-delay",
          }),
        );
        await waitForFile(
          path.join(fixture.fixtureRoot, "test-actor-handoff-ready"),
        );
        assert.equal(execution.child.kill(signal), true);
        const result = await execution.result;
        assert.equal(result.code, expectedCode, result.stderr);
        assert.equal(result.stdout, "");
        const records = (
          await readFile(
            path.join(fixture.stateRoot, "test-actor-control.jsonl"),
            "utf8",
          )
        )
          .trim()
          .split("\n")
          .map((line) => JSON.parse(line));
        assert.deepEqual(
          records.map((record) => record.action),
          ["acquire", "release", "show"],
        );
        assert.equal(records[1].channelAuthorityPresent, false);
        assert.equal(records[2].channelAuthorityPresent, false);
      });
    }
  },
);

test(
  "launcher channel rejects replay, fake peer, wrong parent, and wrong control identity",
  { skip: !darwinOnly },
  async () => {
    for (const mode of [
      "replay-channel",
      "fake-peer",
      "wrong-parent",
      "wrong-control-pid",
    ]) {
      await withFixture({ mode }, async (fixture) => {
        const result = invoke(fixture.host, readinessArguments(fixture));
        assert.notEqual(result.status, 0, mode);
      });
    }
  },
);

test(
  "launcher channel rejects missing, mismatched, and extra challenge bytes",
  { skip: !darwinOnly },
  async () => {
    for (const channelMode of ["missing", "mismatch", "extra"]) {
      await withFixture({}, async (fixture) => {
        const result = invoke(
          fixture.host,
          readinessArguments(fixture, { channelMode }),
        );
        assert.notEqual(result.status, 0, channelMode);
      });
    }
  },
);

test(
  "direct verifier invocation cannot forge a launcher channel",
  { skip: !darwinOnly },
  async () => {
    await withFixture({}, async (fixture) => {
      const result = invoke(fixture.host, verifierArguments(fixture));
      assert.notEqual(result.status, 0);
      assert.equal(result.stdout, "");
    });
  },
);

test(
  "native host rejects noncanonical readiness and lease responses",
  { skip: !darwinOnly },
  async () => {
    for (const mode of [
      "wrong-readiness",
      "mutating-readiness",
      "extra-readiness",
    ]) {
      await withFixture({ mode }, async (fixture) => {
        const result = invoke(fixture.host, readinessArguments(fixture));
        assert.notEqual(result.status, 0, mode);
      });
    }
    for (const mode of [
      "oversized",
      "short-token",
      "overlong-lease",
      "wrong-observer-authority",
      "wrong-provider-authority",
      "wrong-kind",
      "wrong-provenance",
      "extra-lease",
      "extra-result",
      "extra-envelope",
    ]) {
      await withFixture({ mode }, async (fixture) => {
        const result = invoke(
          fixture.host,
          acquisitionArguments(fixture, { controlMode: "process" }),
        );
        assert.notEqual(result.status, 0, mode);
      });
    }
  },
);

test(
  "binding and every added runtime pin fail closed on drift",
  { skip: !darwinOnly },
  async () => {
    for (const field of [
      "nodeSha256",
      "actorControlEntrySha256",
      "controlLibrarySha256",
      "readinessLibrarySha256",
      "kernelGuardContractSha256",
      "outcomeLedgerRepairContractSha256",
      "leaseArchiveHelperSha256",
    ]) {
      await withFixture({}, async (fixture) => {
        await rewriteBinding(fixture, (binding) => ({
          ...binding,
          [field]: "0".repeat(64),
        }));
        const result = invoke(fixture.host, acquisitionArguments(fixture));
        assert.notEqual(result.status, 0, field);
      });
    }
    await withFixture({}, async (fixture) => {
      await rewriteBinding(fixture, (binding) => ({
        ...binding,
        extra: true,
      }));
      const result = invoke(fixture.host, readinessArguments(fixture));
      assert.notEqual(result.status, 0);
    });
  },
);

test(
  "legacy schema one migration revokes item and digest record idempotently",
  { skip: !darwinOnly },
  async () => {
    for (const [state, record] of [
      ["valid", true],
      ["valid", false],
      ["empty", true],
      ["empty", false],
    ]) {
      const fixture = await createLegacyFixture({ record });
      try {
        const result = invoke(
          testProvisioner,
          provisionerArguments(fixture, "revoke", state),
        );
        assert.equal(result.status, 0, result.stderr);
        assert.equal(JSON.parse(result.stdout).ready, false);
        const snapshot = JSON.parse(
          await readFile(
            path.join(fixture.stateRoot, "test-keychain-item.json"),
            "utf8",
          ),
        );
        assert.equal(snapshot.present, false);
        await assert.rejects(readFile(fixture.recordPath), { code: "ENOENT" });
      } finally {
        await rm(fixture.fixtureRoot, { recursive: true, force: true });
      }
    }
  },
);

test(
  "migration rejects provision, rotate, current bindings, and shape drift before Keychain access",
  { skip: !darwinOnly },
  async () => {
    for (const action of ["provision", "rotate"]) {
      const fixture = await createLegacyFixture();
      try {
        const before = await readFile(fixture.recordPath);
        const result = invoke(
          testProvisioner,
          provisionerArguments(fixture, action, "valid"),
        );
        assert.notEqual(result.status, 0);
        await assert.rejects(
          readFile(path.join(fixture.stateRoot, "test-keychain-item.json")),
          { code: "ENOENT" },
        );
        assert.deepEqual(await readFile(fixture.recordPath), before);
      } finally {
        await rm(fixture.fixtureRoot, { recursive: true, force: true });
      }
    }
    await withFixture({}, async (fixture) => {
      const result = invoke(
        testProvisioner,
        provisionerArguments(fixture, "revoke", "valid"),
      );
      assert.notEqual(result.status, 0);
      await assert.rejects(
        readFile(path.join(fixture.stateRoot, "test-keychain-item.json")),
        { code: "ENOENT" },
      );
    });
    const drifted = await createLegacyFixture();
    try {
      const before = await readFile(drifted.recordPath);
      drifted.binding.extra = true;
      await writeFile(
        drifted.bindingPath,
        `${JSON.stringify(drifted.binding)}\n`,
      );
      await chmod(drifted.bindingPath, 0o600);
      const result = invoke(
        testProvisioner,
        provisionerArguments(drifted, "revoke", "valid"),
      );
      assert.notEqual(result.status, 0);
      await assert.rejects(
        readFile(path.join(drifted.stateRoot, "test-keychain-item.json")),
        { code: "ENOENT" },
      );
      assert.deepEqual(await readFile(drifted.recordPath), before);
    } finally {
      await rm(drifted.fixtureRoot, { recursive: true, force: true });
    }
  },
);

test(
  "production host contains no Keychain dependency while migration remains isolated",
  { skip: !darwinOnly },
  async () => {
    const hostLibraries = await execFileAsync("/usr/bin/otool", [
      "-L",
      productionHost,
    ]);
    const provisionerLibraries = await execFileAsync("/usr/bin/otool", [
      "-L",
      productionProvisioner,
    ]);
    assert.doesNotMatch(hostLibraries.stdout, /Security\.framework/);
    assert.match(provisionerLibraries.stdout, /Security\.framework/);
    const [host, provisioner] = await Promise.all([
      readFile(hostSource, "utf8"),
      readFile(provisionerSource, "utf8"),
    ]);
    assert.doesNotMatch(host, /import Security|SecItem|keychainService/i);
    assert.match(provisioner, /import Security/);
  },
);

test(
  "native build helper keeps Security isolated to the migration provisioner",
  { skip: !darwinOnly },
  async () => {
    const helperHost = path.join(buildRoot, "automation-actor-host-helper");
    const helperProvisioner = path.join(
      buildRoot,
      "automation-actor-provision-helper",
    );
    await execFileAsync(
      "/bin/bash",
      [
        buildHelper,
        "--host-output",
        helperHost,
        "--provisioner-output",
        helperProvisioner,
      ],
      {
        cwd: root,
        env: { ...process.env, DEVELOPER_DIR: developerDirectory },
      },
    );
    const [hostLibraries, provisionerLibraries] = await Promise.all([
      execFileAsync("/usr/bin/otool", ["-L", helperHost]),
      execFileAsync("/usr/bin/otool", ["-L", helperProvisioner]),
    ]);
    assert.doesNotMatch(hostLibraries.stdout, /Security\.framework/);
    assert.match(provisionerLibraries.stdout, /Security\.framework/);
  },
);

test(
  "production binaries reject test-only fixture flags",
  { skip: !darwinOnly },
  async () => {
    const hostResult = invoke(productionHost, [
      "--attest-readiness",
      "--protocol",
      "freed-actor-launcher-readiness-v3",
      "--actor",
      defaultActor,
      "--state-root",
      "/tmp/fake-state",
      "--lease-name",
      actorLeaseNames.get(defaultActor),
      "--max-lifetime-ms",
      "1800000",
      "--test-binding",
      "/tmp/fake.json",
    ]);
    assert.notEqual(hostResult.status, 0);
    const provisionerResult = invoke(productionProvisioner, [
      "revoke",
      "--actor",
      defaultActor,
      "--state-root",
      "/tmp/fake-state",
      "--test-binding",
      "/tmp/fake.json",
    ]);
    assert.notEqual(provisionerResult.status, 0);
  },
);
