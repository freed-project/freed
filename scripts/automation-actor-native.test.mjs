import assert from "node:assert/strict";
import { execFile, execFileSync, spawnSync } from "node:child_process";
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
let compiledHost = "";
let productionHost = "";

function sha256(data) {
  return createHash("sha256").update(data).digest("hex");
}

async function sha256File(file) {
  return sha256(await readFile(file));
}

async function compileHost(output, testing = false) {
  const arguments_ = [
    "--sdk",
    "macosx",
    "swiftc",
    "-sdk",
    sdkPath,
    "-target",
    deploymentTarget,
  ];
  if (testing) arguments_.push("-D", "AUTOMATION_ACTOR_HOST_TESTING");
  arguments_.push(hostSource, "-o", output, "-framework", "CryptoKit");
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
  compiledHost = path.join(buildRoot, "automation-actor-host-test");
  productionHost = path.join(buildRoot, "automation-actor-host-production");
  await Promise.all([
    compileHost(compiledHost, true),
    compileHost(productionHost, false),
  ]);
});

after(async () => {
  if (buildRoot) await rm(buildRoot, { recursive: true, force: true });
});

function sha256(data) {
  return createHash("sha256").update(data).digest("hex");
}

test("native actor lifecycle budget stays below the caller outer ceiling", async () => {
  const [host, caller] = await Promise.all([
    readFile(hostSource, "utf8"),
    readFile(callerSource, "utf8"),
  ]);
  const controlMatch =
    /controlTimeoutMilliseconds: UInt64 = (\d+) \* 1_000/.exec(host);
  const acquisitionMatch =
    /nativeAcquisitionWindowMilliseconds: UInt64 = (\d+) \* 1_000/.exec(host);
  const cleanupMatch =
    /nativeCleanupReserveMilliseconds: UInt64 = (\d+) \* 1_000/.exec(host);
  const callerBudgetMatch =
    /NATIVE_LAUNCHER_LIFECYCLE_BUDGET_MS = ([\d_]+);/.exec(caller);
  const callerMarginMatch =
    /NATIVE_LAUNCHER_LIFECYCLE_BUDGET_MS \+ ([\d_]+);/.exec(caller);
  assert.ok(controlMatch);
  assert.ok(acquisitionMatch);
  assert.ok(cleanupMatch);
  assert.ok(callerBudgetMatch);
  assert.ok(callerMarginMatch);
  const controlBudget = Number(controlMatch[1]) * 1_000;
  const acquisitionBudget = Number(acquisitionMatch[1]) * 1_000;
  const cleanupBudget = Number(cleanupMatch[1]) * 1_000;
  const nativeBudget = acquisitionBudget + cleanupBudget;
  const callerBudget = Number(callerBudgetMatch[1].replaceAll("_", ""));
  const callerMargin = Number(callerMarginMatch[1].replaceAll("_", ""));
  assert.ok(acquisitionBudget >= controlBudget * 2);
  assert.ok(cleanupBudget >= controlBudget * 4 + 5_000);
  assert.equal(callerBudget, nativeBudget);
  assert.ok(callerMargin >= 10_000);
});

async function sha256File(file) {
  return sha256(await readFile(file));
}

async function codeIdentifier(file) {
  const { stderr } = await execFileAsync("/usr/bin/codesign", ["-dvv", file]);
  const match = /^Identifier=(.+)$/m.exec(stderr);
  assert.ok(match, `missing linker ad hoc identifier for ${file}`);
  assert.match(stderr, /^Signature=adhoc$/m);
  assert.match(stderr, /^TeamIdentifier=not set$/m);
  assert.doesNotMatch(stderr, /^Authority=/m);
  return match[1];
}

function runtimeDigest({
  nodeSha256,
  controlEntrySha256,
  controlLibrarySha256,
  kernelGuardContractSha256,
  outcomeLedgerRepairContractSha256,
  leaseArchiveHelperSha256,
}) {
  return sha256(
    [
      "freed-automation-actor-runtime-v3",
      `node:${nodeSha256}`,
      `automation-control.mjs:${controlEntrySha256}`,
      `lib/automation-control.mjs:${controlLibrarySha256}`,
      `lib/automation-kernel-guard-contract.mjs:${kernelGuardContractSha256}`,
      `lib/outcome-ledger-repair-contract.mjs:${outcomeLedgerRepairContractSha256}`,
      `lib/lease-archive-move.py:${leaseArchiveHelperSha256}`,
      "",
    ].join("\n"),
  );
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
import { closeSync, readFileSync, writeFileSync, unlinkSync } from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { once } from "node:events";

const MODE = ${JSON.stringify(mode)};
const HOST = ${JSON.stringify(host)};
const BINDING_PATH = ${JSON.stringify(bindingPath)};
const RUNTIME_ROOT = ${JSON.stringify(runtimeRoot)};
const ENVIRONMENT_CAPTURE_PATH = ${JSON.stringify(environmentCapturePath)};
const ACTOR_AUTHORITIES = ${JSON.stringify(Object.fromEntries(actorLeaseAuthorities))};
const options = {};
for (let index = 2; index < process.argv.length; index += 2) {
  options[process.argv[index]] = process.argv[index + 1];
}
writeFileSync(ENVIRONMENT_CAPTURE_PATH, JSON.stringify(Object.keys(process.env).sort()));
const binding = JSON.parse(readFileSync(BINDING_PATH, "utf8"));
const verifierArgs = (overrides = {}) => [
  "--verify-control-channel",
  "--protocol", "freed-actor-launcher-channel-v1",
  "--actor", options["--actor"],
  "--state-root", options["--state-root"],
  "--lease-name", options["--lease-name"],
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
    env: { HOSTILE_SECRET: "must-not-matter", NODE_OPTIONS: "--no-warnings" },
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
      error: verification.error?.message,
      stderr: verification.stderr,
      stdout: verification.stdout,
    }),
  );
  process.stderr.write(verification.stderr || "channel verification failed\\n");
  process.exit(1);
}
const channel = JSON.parse(verification.stdout);
if (options["--action"] === "attest") {
  const response = {
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
  if (MODE === "extra-readiness") response.extra = true;
  process.stdout.write(JSON.stringify(response) + "\\n");
} else {
  const authority = ACTOR_AUTHORITIES[options["--actor"]];
  const acquiredAt = "2026-07-18T12:00:00.000Z";
  const expiresAt = MODE === "overlong-lease"
    ? "2026-07-18T12:30:00.001Z"
    : "2026-07-18T12:30:00.000Z";
  const lease = {
    schemaVersion: 1,
    name: options["--lease-name"],
    owner: options["--actor"],
    token: MODE === "short-token" ? "short" : "test-short-lived-lease-token",
    observerAuthority: MODE === "wrong-observer-authority"
      ? (authority.observer === "observe-only" ? "plan-only" : "observe-only")
      : authority.observer,
    providerAuthority: MODE === "wrong-provider-authority"
      ? (authority.provider === "forbidden" ? "approval-required" : "forbidden")
      : authority.provider,
    credentialKind: MODE === "wrong-kind" ? "persistent-actor" : "trusted-launcher-channel",
    launcherSha256: channel.launcherSha256,
    actorRuntimeDigest: channel.runtimeDigest,
    launcherChannelProtocol: "freed-actor-launcher-channel-v1",
    launcherAttestationSha256: createHash("sha256").update(verification.stdout).digest("hex"),
    launcherSessionId: channel.sessionId,
    acquiredAt,
    heartbeatAt: acquiredAt,
    expiresAt,
    ttlMs: 1800000,
  };
  if (MODE === "wrong-provenance") lease.actorRuntimeDigest = "0".repeat(64);
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

function nestedControlSource() {
  return `
import { spawnSync } from "node:child_process";

const [host, ...arguments_] = process.argv.slice(2);
const controlPidIndex = arguments_.indexOf("--control-pid");
if (!host || controlPidIndex < 0 || controlPidIndex + 1 >= arguments_.length) {
  process.exit(2);
}
arguments_[controlPidIndex + 1] = String(process.pid);
const verification = spawnSync(host, arguments_, {
  encoding: "utf8",
  env: { LANG: "C", LC_ALL: "C", PATH: "/usr/bin:/bin" },
  stdio: ["ignore", "pipe", "pipe", 3],
});
if (verification.stdout) process.stdout.write(verification.stdout);
if (verification.stderr) process.stderr.write(verification.stderr);
if (verification.error) process.stderr.write(verification.error.message);
process.exit(verification.status ?? 1);
`;
}

async function createFixture({
  actor = defaultActor,
  credential = existingCredential,
  runtimeNodeContents = "#!/bin/sh\nexit 99\n",
} = {}) {
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
  await chmod(bindingRoot, 0o700);
  await chmod(launcherDirectory, 0o700);
  await chmod(runtimeRoot, 0o700);
  await chmod(stateRoot, 0o700);

  const launcherSha256 = await sha256File(compiledHost);
  const launcherPath = path.join(
    launcherDirectory,
    `${actor}-${launcherSha256}`,
  );
  await copyFile(compiledHost, launcherPath);
  await chmod(launcherPath, 0o755);

  const runtimeFiles = {
    node: Buffer.from(runtimeNodeContents),
    controlEntry: Buffer.from("export {};\n"),
    controlLibrary: Buffer.from("export {};\n"),
    kernelGuardContract: Buffer.from("export {};\n"),
    outcomeLedgerRepairContract: Buffer.from("export {};\n"),
    leaseArchiveHelper: Buffer.from("print('archive helper fixture')\n"),
  };
  const digests = {
    nodeSha256: sha256(runtimeFiles.node),
    controlEntrySha256: sha256(runtimeFiles.controlEntry),
    controlLibrarySha256: sha256(runtimeFiles.controlLibrary),
    kernelGuardContractSha256: sha256(runtimeFiles.kernelGuardContract),
    outcomeLedgerRepairContractSha256: sha256(
      runtimeFiles.outcomeLedgerRepairContract,
    ),
    leaseArchiveHelperSha256: sha256(runtimeFiles.leaseArchiveHelper),
  };
  const digest = runtimeDigest(pins);
  const runtimeDirectory = path.join(runtimeRoot, digest);
  const runtimeLibraryDirectory = path.join(runtimeDirectory, "lib");
  await mkdir(runtimeLibraryDirectory, { recursive: true, mode: 0o700 });
  await chmod(runtimeDirectory, 0o700);
  await chmod(runtimeLibraryDirectory, 0o700);
  const nodePath = path.join(runtimeDirectory, "node");
  const actorControlEntryPath = path.join(
    runtimeDirectory,
    "automation-actor-control.mjs",
  );
  const controlEntryPath = path.join(
    runtimeDirectory,
    "automation-control.mjs",
  );
  const controlLibraryPath = path.join(
    runtimeLibraryDirectory,
    "automation-control.mjs",
  );
  const kernelGuardContractPath = path.join(
    runtimeLibraryDirectory,
    "automation-kernel-guard-contract.mjs",
  );
  const outcomeLedgerRepairContractPath = path.join(
    runtimeLibraryDirectory,
    "outcome-ledger-repair-contract.mjs",
  );
  const leaseArchiveHelperPath = path.join(
    runtimeLibraryDirectory,
    "lease-archive-move.py",
  );
  await writeFile(nodePath, runtimeFiles.node, { mode: 0o755 });
  await writeFile(controlEntryPath, runtimeFiles.controlEntry, { mode: 0o600 });
  await writeFile(controlLibraryPath, runtimeFiles.controlLibrary, {
    mode: 0o600,
  });
  await writeFile(kernelGuardContractPath, runtimeFiles.kernelGuardContract, {
    mode: 0o600,
  });
  await writeFile(
    outcomeLedgerRepairContractPath,
    runtimeFiles.outcomeLedgerRepairContract,
    { mode: 0o600 },
  );
  await writeFile(leaseArchiveHelperPath, runtimeFiles.leaseArchiveHelper, {
    mode: 0o600,
  });
  await chmod(nodePath, 0o755);
  await chmod(controlEntryPath, 0o600);
  await chmod(controlLibraryPath, 0o600);
  await chmod(kernelGuardContractPath, 0o600);
  await chmod(outcomeLedgerRepairContractPath, 0o600);
  await chmod(leaseArchiveHelperPath, 0o600);

  const binding = {
    schemaVersion: 3,
    actor,
    purpose: "automation-actor-launcher",
    handoff: "trusted-launcher-channel-to-canonical-lease",
    attestationProtocol: "freed-actor-launcher-readiness-v3",
    launcherPath,
    launcherSha256,
    stateRoot,
    leaseName: actorLeaseNames.get(actor),
    maxLeaseLifetimeMs: 1_800_000,
    nodePath,
    nodeSha256: pins.nodeSha256,
    actorControlEntryPath,
    actorControlEntrySha256: pins.actorControlEntrySha256,
    controlEntryPath,
    controlEntrySha256: pins.controlEntrySha256,
    controlLibraryPath,
    controlLibrarySha256: digests.controlLibrarySha256,
    kernelGuardContractPath,
    kernelGuardContractSha256: digests.kernelGuardContractSha256,
    outcomeLedgerRepairContractPath,
    outcomeLedgerRepairContractSha256:
      digests.outcomeLedgerRepairContractSha256,
    leaseArchiveHelperPath,
    leaseArchiveHelperSha256: digests.leaseArchiveHelperSha256,
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

function fixtureFlags(fixture, channelMode = undefined) {
  return [
    "--test-binding",
    fixture.bindingPath,
    "--test-runtime-root",
    fixture.runtimeRoot,
    ...(channelMode ? ["--test-channel-mode", channelMode] : []),
  ];
}

function readinessArguments(fixture, channelMode = undefined) {
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
    ...fixtureFlags(fixture, channelMode),
  ];
}

function acquisitionArguments(fixture, channelMode = undefined) {
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
    ...fixtureFlags(fixture, channelMode),
  ];
}

function verifierArguments(fixture) {
  return [
    "--verify-control-channel",
    "--protocol",
    "freed-actor-launcher-channel-v1",
    "--actor",
    fixture.binding.actor,
    "--state-root",
    fixture.stateRoot,
    "--lease-name",
    fixture.binding.leaseName,
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

async function run(executable, args, options = {}) {
  return await startRun(executable, args, options).result;
}

function startRun(executable, args, options = {}) {
  let child;
  const result = new Promise((resolve, reject) => {
    child = execFile(
      executable,
      args,
      {
        ...options,
        env: {
          ...process.env,
          DEVELOPER_DIR: developerDirectory,
          ...(options.env ?? {}),
        },
      },
      (error, stdout, stderr) => {
        if (error && typeof error.code !== "number") {
          reject(error);
          return;
        }
        resolve({
          code: error && typeof error.code === "number" ? error.code : 0,
          stdout,
          stderr,
        });
      },
    );
    child.on("error", reject);
  });
  return { child, result };
}

async function waitForFile(file, timeoutMs = 5_000) {
  const deadline = Date.now() + timeoutMs;
  while (true) {
    try {
      return await readFile(file, "utf8");
    } catch (error) {
      if (error?.code !== "ENOENT" || Date.now() >= deadline) throw error;
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

function processExists(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (error?.code === "ESRCH") return false;
    throw error;
  }
}

async function waitForProcessExit(pid, timeoutMs = 2_000) {
  const deadline = Date.now() + timeoutMs;
  while (processExists(pid)) {
    if (Date.now() >= deadline) return false;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  return true;
}

function actorControlRuntime({ selfSignal = false } = {}) {
  return `#!/bin/bash
set -eu
action="\${3:-}"
state_root=""
previous=""
for argument in "$@"; do
  if [[ "$previous" == "--state-root" ]]; then state_root="$argument"; fi
  previous="$argument"
done
if [[ -z "$state_root" ]]; then exit 88; fi
fixture_root="\${state_root%/*}"
lease_file="$state_root/test-actor-lease.json"
release_retry="$state_root/test-actor-release-retry"
show_retry="$state_root/test-actor-show-retry"
log_file="$state_root/test-actor-process-control.jsonl"
operation_id="\${FREED_AUTOMATION_LEASE_OPERATION_ID:-}"
token="\${FREED_AUTOMATION_LEASE_TOKEN:-}"
token_sha=""
if [[ -n "$token" ]]; then
  token_sha="$(printf '%s' "$token" | /usr/bin/shasum -a 256 | /usr/bin/awk '{ print $1 }')"
fi
printf '{"action":"%s","operationId":"%s","tokenSha256":"%s","persistentCredentialPresent":%s}\n' \
  "$action" "$operation_id" "$token_sha" "$([[ -n "\${FREED_AUTOMATION_ACTOR_TOKEN:-}" ]] && printf true || printf false)" >> "$log_file"
if [[ "$action" == "acquire" ]]; then
  printf '%s\n' "$$" >> "$fixture_root/test-actor-control-parent.pid"
  ${selfSignal ? 'kill -TERM $$\nprintf survivor > "$fixture_root/test-actor-child-survived-signal"' : `printf '{"name":"scaffolding-writer","owner":"freed-scaffolding-maintainer","token":"%s"}\n' "$token" > "$lease_file"
  : > "$release_retry"
  : > "$show_retry"
  /bin/sleep 30 &
  descendant_pid="$!"
  printf '%s\n' "$descendant_pid" >> "$fixture_root/test-actor-control-child.pid"
  : > "$fixture_root/test-actor-acquire-process-ready"
  wait "$descendant_pid"
  printf late > "$fixture_root/test-actor-late-mutation"`}
  exit 89
fi
if [[ "$action" == "release" ]]; then
  if [[ -f "$release_retry" ]]; then
    /bin/rm -f "$release_retry" "$lease_file"
    exit 91
  fi
  released=false
  if [[ -f "$lease_file" ]]; then
    /bin/rm -f "$lease_file"
    released=true
  fi
  printf '{"ok":true,"schemaVersion":1,"action":"lease.release","stateRoot":"%s","result":{"released":%s,"lease":{"name":"scaffolding-writer","owner":"freed-scaffolding-maintainer"}}}\n' "$state_root" "$released"
  exit 0
fi
if [[ "$action" == "show" ]]; then
  if [[ -f "$show_retry" ]]; then
    /bin/rm -f "$show_retry"
    exit 92
  fi
  if [[ -f "$lease_file" ]]; then
    printf '{"ok":true,"schemaVersion":1,"action":"lease.show","stateRoot":"%s","result":{"name":"scaffolding-writer","owner":"freed-scaffolding-maintainer","status":"active"}}\n' "$state_root"
  else
    printf '{"ok":true,"schemaVersion":1,"action":"lease.show","stateRoot":"%s","result":null}\n' "$state_root"
  fi
  exit 0
fi
exit 93
`;
}

function actorCleanupCancellationRuntime() {
  return `#!/bin/bash
set -eu
action="\${3:-}"
state_root=""
previous=""
for argument in "$@"; do
  if [[ "$previous" == "--state-root" ]]; then state_root="$argument"; fi
  previous="$argument"
done
if [[ -z "$state_root" ]]; then exit 88; fi
fixture_root="\${state_root%/*}"
lease_file="$state_root/test-actor-lease.json"
release_count_file="$state_root/test-actor-release-count"
show_count_file="$state_root/test-actor-show-count"
log_file="$state_root/test-actor-process-control.jsonl"
operation_id="\${FREED_AUTOMATION_LEASE_OPERATION_ID:-}"
token="\${FREED_AUTOMATION_LEASE_TOKEN:-}"
token_sha=""
if [[ -n "$token" ]]; then
  token_sha="$(printf '%s' "$token" | /usr/bin/shasum -a 256 | /usr/bin/awk '{ print $1 }')"
fi
printf '{"action":"%s","operationId":"%s","tokenSha256":"%s","persistentCredentialPresent":%s}\n' \
  "$action" "$operation_id" "$token_sha" "$([[ -n "\${FREED_AUTOMATION_ACTOR_TOKEN:-}" ]] && printf true || printf false)" >> "$log_file"
if [[ "$action" == "acquire" ]]; then
  printf '{"name":"scaffolding-writer","owner":"freed-scaffolding-maintainer","token":"%s"}\n' "$token" > "$lease_file"
  printf '{}\n'
  exit 0
fi
if [[ "$action" == "release" ]]; then
  count=0
  if [[ -f "$release_count_file" ]]; then count="$(cat "$release_count_file")"; fi
  count=$((count + 1))
  printf '%s\n' "$count" > "$release_count_file"
  if [[ "$count" == 1 ]]; then
    : > "$fixture_root/test-actor-cleanup-ready"
    /bin/sleep 0.5
    /bin/rm -f "$lease_file"
    exit 91
  fi
  printf '{"ok":true,"schemaVersion":1,"action":"lease.release","stateRoot":"%s","result":{"released":false,"lease":{"name":"scaffolding-writer","owner":"freed-scaffolding-maintainer"}}}\n' "$state_root"
  exit 0
fi
if [[ "$action" == "show" ]]; then
  count=0
  if [[ -f "$show_count_file" ]]; then count="$(cat "$show_count_file")"; fi
  count=$((count + 1))
  printf '%s\n' "$count" > "$show_count_file"
  if [[ "$count" == 1 ]]; then exit 92; fi
  printf '{"ok":true,"schemaVersion":1,"action":"lease.show","stateRoot":"%s","result":null}\n' "$state_root"
  exit 0
fi
exit 93
`;
}

function invokeWithClosedStdin(file, args, env = {}) {
  return spawnSync(
    "/bin/sh",
    ["-c", 'exec 0<&-\nexec "$@"', "closed-stdin", file, ...args],
    {
      encoding: "utf8",
      env: { ...process.env, ...env },
      timeout: 15_000,
    },
  );
}

async function withFixture(options, operation) {
  const fixture = await createFixture(options);
  try {
    return await operation(fixture);
  } finally {
    await rm(fixture.fixtureRoot, { recursive: true, force: true });
  }
}

test(
  "native actor readiness exercises the full live launcher channel without state mutation",
  { skip: !darwinOnly },
  async (t) => {
    const fixture = await createFixture();
    t.after(() => rm(fixture.fixtureRoot, { recursive: true, force: true }));
    const result = await run(fixture.host, acquisitionArguments(fixture), {
      env: {
        HOME: "/tmp/hostile-home",
        NODE_OPTIONS: "--inspect",
        FREED_AUTOMATION_ACTOR_TOKEN: "hostile-persistent-token",
      },
    });
    assert.equal(result.code, 0, result.stderr);
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
    assert.equal(handoff.actor, defaultActor);
    assert.equal(handoff.leaseName, "scaffolding-writer");
    assert.match(
      handoff.leaseOperationId,
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    assert.equal(
      handoff.leaseTokenSha256,
      createHash("sha256").update(handoff.leaseToken).digest("hex"),
    );
    assert.equal(handoff.ttlMs, 1_800_000);
    assert.equal(
      Date.parse(handoff.expiresAt) - Date.parse(handoff.acquiredAt),
      1_800_000,
    );
    assert.doesNotMatch(result.stdout, new RegExp(existingCredential));
    assert.doesNotMatch(result.stdout, /hostile-persistent-token/);
  },
);

test(
  "native actor host reuses its caller-owned acquisition identity after response loss",
  { skip: !darwinOnly },
  async (t) => {
    const fixture = await createFixture();
    t.after(() => rm(fixture.fixtureRoot, { recursive: true, force: true }));
    const result = await run(
      fixture.host,
      acquisitionArguments(fixture, { controlMode: "response-loss-once" }),
    );
    assert.equal(result.code, 0, result.stderr);
    const handoff = JSON.parse(result.stdout);
    assert.equal(
      handoff.leaseTokenSha256,
      createHash("sha256").update(handoff.leaseToken).digest("hex"),
    );
    assert.match(
      handoff.leaseOperationId,
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  },
);

test(
  "native actor host releases after malformed acquisition and retries malformed inspection without the persistent credential",
  { skip: !darwinOnly },
  async (t) => {
    const fixture = await createFixture();
    t.after(() => rm(fixture.fixtureRoot, { recursive: true, force: true }));
    const result = await run(
      fixture.host,
      acquisitionArguments(fixture, {
        controlMode: "malformed-acquire-and-show",
      }),
    );
    assert.equal(result.code, 1);
    assert.match(result.stderr, /control response is invalid/);
    assert.doesNotMatch(result.stderr, /unknown actor lease live/);
    assert.equal(result.stdout, "");
  },
);

test(
  "native actor host preserves its cleanup reserve after delayed Keychain preflight and committed response loss",
  { skip: !darwinOnly },
  async (t) => {
    const fixture = await createFixture();
    t.after(() => rm(fixture.fixtureRoot, { recursive: true, force: true }));
    const startedAt = Date.now();
    const result = await run(
      fixture.host,
      acquisitionArguments(fixture, {
        controlMode: "commit-response-loss-near-deadline",
        keychainMode: "delayed",
      }),
    );
    assert.equal(result.code, 1);
    assert.match(result.stderr, /control response is invalid/);
    assert.doesNotMatch(result.stderr, /unknown actor lease live/);
    assert.equal(result.stdout, "");
    assert.ok(Date.now() - startedAt < 4_000);
  },
);

test(
  "native actor host fails before mutation when Keychain preflight exhausts the acquisition window",
  { skip: !darwinOnly },
  async (t) => {
    const fixture = await createFixture();
    t.after(() => rm(fixture.fixtureRoot, { recursive: true, force: true }));
    const startedAt = Date.now();
    const result = await run(
      fixture.host,
      acquisitionArguments(fixture, {
        keychainMode: "acquisition-window-exhausted",
      }),
    );
    assert.equal(result.code, 1);
    assert.match(
      result.stderr,
      /acquisition window was exhausted before lease mutation/,
    );
    assert.equal(result.stdout, "");
    assert.ok(Date.now() - startedAt < 4_000);
  },
);

test(
  "native actor host owns SIGINT and SIGTERM before delayed preflight can mutate a lease",
  { skip: !darwinOnly, timeout: 15_000 },
  async (t) => {
    for (const [signal, expectedCode] of [
      ["SIGINT", 130],
      ["SIGTERM", 143],
    ]) {
      const fixture = await createFixture();
      t.after(() => rm(fixture.fixtureRoot, { recursive: true, force: true }));
      const before = await stateSnapshot(fixture.stateRoot);
      const execution = startRun(
        fixture.host,
        acquisitionArguments(fixture, {
          keychainMode: "signal-preflight-delay",
        }),
      );
      await waitForFile(
        path.join(fixture.fixtureRoot, "test-actor-preflight-ready"),
      );
      assert.equal(execution.child.kill(signal), true);
      const result = await execution.result;
      assert.equal(result.code, expectedCode, result.stderr);
      assert.equal(result.stdout, "");
      assert.deepEqual(await stateSnapshot(fixture.stateRoot), before);
      await assert.rejects(
        readFile(path.join(fixture.stateRoot, "test-actor-control.jsonl")),
        { code: "ENOENT" },
      );
    }
  },
);

test(
  "native actor host cancels a committed acquire child and proves exact lease absence",
  { skip: !darwinOnly, timeout: 20_000 },
  async (t) => {
    for (const [signal, expectedCode] of [
      ["SIGINT", 130],
      ["SIGTERM", 143],
    ]) {
      const fixture = await createFixture({
        runtimeNodeContents: actorControlRuntime(),
      });
      const execution = startRun(
        fixture.host,
        acquisitionArguments(fixture, {
          controlMode: "process-cancellation-commit",
        }),
      );
      let parentPid;
      let descendantPid;
      t.after(async () => {
        execution.child.kill("SIGKILL");
        for (const pid of [parentPid, descendantPid]) {
          if (Number.isInteger(pid) && processExists(pid)) {
            process.kill(pid, "SIGKILL");
          }
        }
        await rm(fixture.fixtureRoot, { recursive: true, force: true });
      });
      await waitForFile(
        path.join(fixture.fixtureRoot, "test-actor-acquire-process-ready"),
      );
      parentPid = Number(
        (
          await readFile(
            path.join(fixture.fixtureRoot, "test-actor-control-parent.pid"),
            "utf8",
          )
        ).trim(),
      );
      descendantPid = Number(
        (
          await readFile(
            path.join(fixture.fixtureRoot, "test-actor-control-child.pid"),
            "utf8",
          )
        ).trim(),
      );
      assert.equal(processExists(parentPid), true);
      assert.equal(processExists(descendantPid), true);
      assert.equal(execution.child.kill(signal), true);
      const result = await execution.result;
      assert.equal(result.code, expectedCode, result.stderr);
      assert.equal(result.stdout, "");
      assert.equal(await waitForProcessExit(parentPid), true);
      assert.equal(await waitForProcessExit(descendantPid), true);
      await assert.rejects(
        readFile(path.join(fixture.stateRoot, "test-actor-lease.json")),
        { code: "ENOENT" },
      );
      await new Promise((resolve) => setTimeout(resolve, 250));
      await assert.rejects(
        readFile(path.join(fixture.fixtureRoot, "test-actor-late-mutation")),
        { code: "ENOENT" },
      );
      const calls = (
        await readFile(
          path.join(fixture.stateRoot, "test-actor-process-control.jsonl"),
          "utf8",
        )
      )
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line));
      const acquire = calls.find((call) => call.action === "acquire");
      const releases = calls.filter((call) => call.action === "release");
      const inspections = calls.filter((call) => call.action === "show");
      assert.ok(acquire);
      assert.equal(acquire.persistentCredentialPresent, true);
      assert.equal(releases.length, 2);
      assert.equal(releases[0].operationId, releases[1].operationId);
      assert.match(releases[0].operationId, /^[0-9a-f-]{36}$/);
      assert.ok(
        releases.every(
          (call) =>
            call.tokenSha256 === acquire.tokenSha256 &&
            call.persistentCredentialPresent === false,
        ),
      );
      assert.equal(inspections.length, 2);
      assert.ok(
        inspections.every(
          (call) =>
            call.operationId === "" &&
            call.tokenSha256 === "" &&
            call.persistentCredentialPresent === false,
        ),
      );
    }
  },
);

test(
  "native actor host reclaims an acquired lease when cancellation arrives before handoff",
  { skip: !darwinOnly, timeout: 15_000 },
  async (t) => {
    for (const [signal, expectedCode] of [
      ["SIGINT", 130],
      ["SIGTERM", 143],
    ]) {
      const fixture = await createFixture();
      t.after(() => rm(fixture.fixtureRoot, { recursive: true, force: true }));
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
      const calls = (
        await readFile(
          path.join(fixture.stateRoot, "test-actor-control.jsonl"),
          "utf8",
        )
      )
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line));
      const releases = calls.filter((call) => call.action === "release");
      const inspections = calls.filter((call) => call.action === "show");
      assert.equal(releases.length, 1);
      assert.match(releases[0].operationId, /^[0-9a-f-]{36}$/);
      assert.equal(releases[0].persistentCredentialPresent, false);
      assert.equal(inspections.length, 1);
      assert.equal(inspections[0].operationId, null);
      assert.equal(inspections[0].leaseTokenSha256, null);
    }
  },
);

test(
  "native actor handoff commit stays successful when cancellation arrives after the final check",
  { skip: !darwinOnly, timeout: 15_000 },
  async (t) => {
    for (const signal of ["SIGINT", "SIGTERM"]) {
      const fixture = await createFixture();
      t.after(() => rm(fixture.fixtureRoot, { recursive: true, force: true }));
      const execution = startRun(
        fixture.host,
        acquisitionArguments(fixture, {
          controlMode: "post-final-check-pre-write-delay",
        }),
      );
      await waitForFile(
        path.join(fixture.fixtureRoot, "test-actor-handoff-commit-ready"),
      );
      assert.equal(execution.child.kill(signal), true);
      const result = await execution.result;
      assert.equal(result.code, 0, result.stderr);
      const handoff = JSON.parse(result.stdout);
      assert.equal(handoff.actor, defaultActor);
      assert.equal(handoff.leaseName, "scaffolding-writer");
      assert.equal(
        handoff.leaseTokenSha256,
        createHash("sha256").update(handoff.leaseToken).digest("hex"),
      );
      const calls = (
        await readFile(
          path.join(fixture.stateRoot, "test-actor-control.jsonl"),
          "utf8",
        )
      )
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line));
      assert.deepEqual(
        calls.map((call) => call.action),
        ["acquire"],
      );
    }
  },
);

test(
  "native actor cleanup retains cancellation without spending its release or inspection retries",
  { skip: !darwinOnly, timeout: 20_000 },
  async (t) => {
    for (const [signal, expectedCode] of [
      ["SIGINT", 130],
      ["SIGTERM", 143],
    ]) {
      const fixture = await createFixture({
        runtimeNodeContents: actorCleanupCancellationRuntime(),
      });
      const execution = startRun(
        fixture.host,
        acquisitionArguments(fixture, {
          controlMode: "process-cleanup-cancellation",
        }),
      );
      t.after(async () => {
        execution.child.kill("SIGKILL");
        await rm(fixture.fixtureRoot, { recursive: true, force: true });
      });
      await waitForFile(
        path.join(fixture.fixtureRoot, "test-actor-cleanup-ready"),
      );
      assert.equal(execution.child.kill(signal), true);
      const result = await execution.result;
      assert.equal(result.code, expectedCode, result.stderr);
      assert.equal(result.stdout, "");
      await assert.rejects(
        readFile(path.join(fixture.stateRoot, "test-actor-lease.json")),
        { code: "ENOENT" },
      );
      const calls = (
        await readFile(
          path.join(fixture.stateRoot, "test-actor-process-control.jsonl"),
          "utf8",
        )
      )
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line));
      const acquires = calls.filter((call) => call.action === "acquire");
      const releases = calls.filter((call) => call.action === "release");
      const inspections = calls.filter((call) => call.action === "show");
      assert.equal(acquires.length, 2);
      assert.equal(releases.length, 2);
      assert.equal(inspections.length, 2);
      assert.equal(releases[0].operationId, releases[1].operationId);
      assert.ok(
        releases.every(
          (call) =>
            call.tokenSha256 === acquires[0].tokenSha256 &&
            call.persistentCredentialPresent === false,
        ),
      );
      assert.ok(
        inspections.every(
          (call) =>
            call.operationId === "" &&
            call.tokenSha256 === "" &&
            call.persistentCredentialPresent === false,
        ),
      );
    }
  },
);

test(
  "native actor terminal drain retains SIGINT and SIGTERM while signals stay blocked through exit",
  { skip: !darwinOnly, timeout: 15_000 },
  async (t) => {
    for (const [signal, expectedCode] of [
      ["SIGINT", 130],
      ["SIGTERM", 143],
    ]) {
      const fixture = await createFixture();
      t.after(() => rm(fixture.fixtureRoot, { recursive: true, force: true }));
      await writeFile(
        path.join(fixture.stateRoot, "test-actor-finalization-pause"),
        "",
      );
      const execution = startRun(
        fixture.host,
        attestationArguments(fixture),
      );
      await waitForFile(
        path.join(fixture.stateRoot, "test-actor-finalization-drained"),
      );
      assert.equal(execution.child.kill(signal), true);
      const result = await execution.result;
      assert.equal(result.code, expectedCode, result.stderr);
      assert.equal(JSON.parse(result.stdout).mutatesState, false);
    }
  },
);

test(
  "native actor control child receives unblocked default termination signals",
  { skip: !darwinOnly, timeout: 10_000 },
  async (t) => {
    const fixture = await createFixture({
      runtimeNodeContents: actorControlRuntime({ selfSignal: true }),
    });
    t.after(() => rm(fixture.fixtureRoot, { recursive: true, force: true }));
    const result = await run(
      fixture.host,
      acquisitionArguments(fixture, { controlMode: "process-signal-state" }),
    );
    assert.equal(result.code, 1);
    assert.match(result.stderr, /rejected the lease request/);
    assert.equal(result.stdout, "");
    await assert.rejects(
      readFile(
        path.join(fixture.fixtureRoot, "test-actor-child-survived-signal"),
      ),
      { code: "ENOENT" },
    );
    const pids = (
      await readFile(
        path.join(fixture.fixtureRoot, "test-actor-control-parent.pid"),
        "utf8",
      )
    )
      .trim()
      .split("\n")
      .map((value) => Number.parseInt(value, 10));
    assert.equal(pids.length, 2);
    for (const pid of pids) assert.equal(await waitForProcessExit(pid), true);
  },
);

test(
  "native actor control timeout reclaims its process group before the lifecycle budget expires",
  { skip: !darwinOnly },
  async (t) => {
    const fixture = await createFixture({
      runtimeNodeContents: [
        "#!/bin/sh",
        'runtime_dir="${0%/*}"',
        'printf "%s\\n" "$$" >> "$runtime_dir/control-parent.pid"',
        "/bin/sleep 30 &",
        'printf "%s\\n" "$!" >> "$runtime_dir/control-child.pid"',
        "wait",
        "",
      ].join("\n"),
    });
    t.after(() => rm(fixture.fixtureRoot, { recursive: true, force: true }));
    const startedAt = Date.now();
    const result = await run(
      fixture.host,
      acquisitionArguments(fixture, { controlMode: "process-timeout" }),
    );
    assert.equal(result.code, 1);
    assert.match(result.stderr, /unknown actor lease live/);
    assert.ok(Date.now() - startedAt < 5_000);

    const runtimeDirectory = path.dirname(fixture.binding.nodePath);
    const pids = (
      await Promise.all(
        ["control-parent.pid", "control-child.pid"].map(async (name) =>
          (await readFile(path.join(runtimeDirectory, name), "utf8"))
            .trim()
            .split("\n")
            .map((value) => Number.parseInt(value, 10)),
        ),
      )
    ).flat();
    assert.equal(pids.length, 12);
    const processExists = (pid) => {
      try {
        process.kill(pid, 0);
        return true;
      } catch (error) {
        if (error?.code === "ESRCH") return false;
        throw error;
      }
    };
    const deadline = Date.now() + 2_000;
    while (pids.some(processExists) && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    for (const pid of pids) assert.equal(processExists(pid), false);
  },
);

test(
  "native actor host disables legacy Keychain UI and restores policy before continuing",
  { skip: !darwinOnly },
  async (t) => {
    const fixture = await createFixture();
    t.after(() => rm(fixture.fixtureRoot, { recursive: true, force: true }));
    for (const [keychainMode, pattern] of [
      ["read-failure", /test Keychain credential could not be read/],
      ["get-failure", /interaction policy could not be read/],
      ["disable-failure", /interaction policy could not be disabled/],
      ["disable-noop", /interaction policy remained enabled/],
      ["restore-failure", /could not be restored after the credential read/],
    ]) {
      const result = await run(
        fixture.host,
        readinessArguments(fixture, "require-output-read-fd3"),
        {
          FREED_AUTOMATION_ACTOR_TOKEN: "hostile-persistent-token",
          NODE_OPTIONS: "--require=/definitely/not/a/module",
          GH_TOKEN: "hostile-github-token",
        },
      );
      const childError = await readFile(
        `${fixture.environmentCapturePath}.error`,
        "utf8",
      ).catch(() => "");
      assert.equal(result.status, 0, `${result.stderr}\n${childError}`);
      assert.deepEqual(JSON.parse(result.stdout), {
        actor: fixture.binding.actor,
        canonicalLeaseReady: true,
        channelProtocol: "freed-actor-launcher-channel-v1",
        handoff: "trusted-launcher-channel-to-canonical-lease",
        launcherSha256: fixture.binding.launcherSha256,
        leaseName: fixture.binding.leaseName,
        maxLeaseLifetimeMs: 1_800_000,
        mutatesState: false,
        protocol: "freed-actor-launcher-readiness-v3",
        purpose: "automation-actor-launcher-readiness",
        runtimeDigest: fixture.runtimeDigest,
        schemaVersion: 1,
        stateRoot: fixture.stateRoot,
      });
      assert.deepEqual(await readdir(fixture.stateRoot), []);
      assert.deepEqual(
        JSON.parse(await readFile(fixture.environmentCapturePath)).filter(
          (name) => name !== "__CF_USER_TEXT_ENCODING",
        ),
        ["LANG", "LC_ALL", "PATH"],
      );
      assert.doesNotMatch(result.stdout + result.stderr, /hostile/i);

      const closedStdinResult = invokeWithClosedStdin(
        fixture.host,
        readinessArguments(fixture, "require-output-write-fd3"),
      );
      assert.equal(closedStdinResult.status, 0, closedStdinResult.stderr);
      assert.deepEqual(
        JSON.parse(closedStdinResult.stdout),
        JSON.parse(result.stdout),
      );
      assert.equal(result.code, 1);
    }
  },
);

test(
  "native actor host rejects runtime, launcher, and credential drift before lease acquisition",
  { skip: !darwinOnly },
  async (t) => {
    const runtimeFixture = await createFixture();
    t.after(() =>
      rm(runtimeFixture.fixtureRoot, { recursive: true, force: true }),
    );
    await rewriteBinding(runtimeFixture, (binding) => ({
      ...binding,
      nodeSha256: "0".repeat(64),
    }));
    const runtimeResult = await run(
      runtimeFixture.host,
      acquisitionArguments(runtimeFixture),
    );
    assert.equal(runtimeResult.code, 1);
    assert.match(
      runtimeResult.stderr,
      /content-addressed layout|pinned digest/,
    );

    const helperDigestFixture = await createFixture();
    t.after(() =>
      rm(helperDigestFixture.fixtureRoot, { recursive: true, force: true }),
    );
    await rewriteBinding(helperDigestFixture, (binding) => ({
      ...binding,
      leaseArchiveHelperSha256: "0".repeat(64),
    }));
    const helperDigestResult = await run(
      helperDigestFixture.host,
      acquisitionArguments(helperDigestFixture),
    );
    assert.equal(helperDigestResult.code, 1);
    assert.match(
      helperDigestResult.stderr,
      /content-addressed layout|pinned digest/,
    );

    const kernelContractDigestFixture = await createFixture();
    t.after(() =>
      rm(kernelContractDigestFixture.fixtureRoot, {
        recursive: true,
        force: true,
      }),
    );
    await rewriteBinding(kernelContractDigestFixture, (binding) => ({
      ...binding,
      kernelGuardContractSha256: "0".repeat(64),
    }));
    const kernelContractDigestResult = await run(
      kernelContractDigestFixture.host,
      acquisitionArguments(kernelContractDigestFixture),
    );
    assert.equal(kernelContractDigestResult.code, 1);
    assert.match(
      kernelContractDigestResult.stderr,
      /content-addressed layout|pinned digest/,
    );

    const helperModeFixture = await createFixture();
    t.after(() =>
      rm(helperModeFixture.fixtureRoot, { recursive: true, force: true }),
    );
    await chmod(helperModeFixture.binding.leaseArchiveHelperPath, 0o4600);
    const helperModeResult = await run(
      helperModeFixture.host,
      acquisitionArguments(helperModeFixture),
    );
    assert.equal(helperModeResult.code, 1);
    assert.match(helperModeResult.stderr, /trusted immutable regular file/);

    const launcherFixture = await createFixture();
    t.after(() =>
      rm(launcherFixture.fixtureRoot, { recursive: true, force: true }),
    );
    await rewriteBinding(launcherFixture, (binding) => ({
      ...binding,
      launcherSha256: "0".repeat(64),
    }));
    const launcherResult = await run(
      launcherFixture.host,
      acquisitionArguments(launcherFixture),
    );
    assert.equal(launcherResult.code, 1);
    assert.match(launcherResult.stderr, /content-addressed path|pinned digest/);

    const credentialFixture = await createFixture({
      credential: rotatedCredential,
    });
  },
);

test(
  "native actor acquire returns only the bounded canonical handoff",
  { skip: !darwinOnly },
  async () => {
    for (const [actor, leaseName] of actorLeaseNames) {
      await withFixture({ actor }, async (fixture) => {
        const result = invoke(fixture.host, acquisitionArguments(fixture));
        const childError = await readFile(
          `${fixture.environmentCapturePath}.error`,
          "utf8",
        ).catch(() => "");
        assert.equal(
          result.status,
          0,
          `${actor}: ${result.stderr}\n${childError}`,
        );
        assert.deepEqual(JSON.parse(result.stdout), {
          acquiredAt: "2026-07-18T12:00:00.000Z",
          actor,
          expiresAt: "2026-07-18T12:30:00.000Z",
          leaseName,
          leaseToken: "test-short-lived-lease-token",
          schemaVersion: 1,
          ttlMs: 1_800_000,
        });
        assert.doesNotMatch(result.stdout, /launcherSessionId|challengeSha256/);
      });
    }
  },
);

test(
  "native launcher channel fails closed for replay, fake peer, wrong parent, and wrong control pid",
  { skip: !darwinOnly },
  async () => {
    for (const mode of [
      "replay-channel",
      "fake-peer",
      "wrong-parent",
      "wrong-control-pid",
      "closed-channel",
    ]) {
      await withFixture({ mode }, async (fixture) => {
        const result = invoke(fixture.host, readinessArguments(fixture));
        assert.notEqual(result.status, 0, `${mode} unexpectedly succeeded`);
        if (mode === "wrong-parent") {
          const failure = JSON.parse(
            await readFile(`${fixture.environmentCapturePath}.error`, "utf8"),
          );
          assert.match(failure.stderr, /process chain does not match the binding/);
          assert.doesNotMatch(
            failure.stderr,
            /control process is not the verifier parent/,
          );
        }
        assert.equal((await readdir(fixture.stateRoot)).length, 0);
      });
    }
  },
);

test(
  "native launcher channel rejects missing, mismatched, and extra challenge bytes",
  { skip: !darwinOnly },
  async () => {
    for (const channelMode of ["missing", "mismatch", "extra"]) {
      await withFixture({}, async (fixture) => {
        const result = invoke(
          fixture.host,
          readinessArguments(fixture, channelMode),
        );
        assert.notEqual(
          result.status,
          0,
          `${channelMode} unexpectedly succeeded`,
        );
        assert.equal((await readdir(fixture.stateRoot)).length, 0);
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
      assert.match(result.stderr, /control process|channel peer|process chain/);
    });
  },
);

test(
  "native readiness rejects mutated or noncanonical child output",
  { skip: !darwinOnly },
  async () => {
    for (const mode of [
      "wrong-readiness",
      "mutating-readiness",
      "extra-readiness",
    ]) {
      await withFixture({ mode }, async (fixture) => {
        const result = invoke(fixture.host, readinessArguments(fixture));
        assert.notEqual(result.status, 0, `${mode} unexpectedly succeeded`);
      });
    }
  },
);

test(
  "native provisioner fails closed for partial state, digest drift, and ACL drift",
  { skip: !darwinOnly },
  async (t) => {
    const recordOnly = await createFixture();
    t.after(() => rm(recordOnly.fixtureRoot, { recursive: true, force: true }));
    const recordOnlyResult = await run(
      testProvisioner,
      provisionerArguments(recordOnly, "provision", "empty"),
    );
    assert.equal(recordOnlyResult.code, 1);
    assert.match(recordOnlyResult.stderr, /run revoke, then retry/);

    const itemOnly = await createFixture({ credential: null });
    t.after(() => rm(itemOnly.fixtureRoot, { recursive: true, force: true }));
    const itemOnlyResult = await run(
      testProvisioner,
      provisionerArguments(itemOnly, "provision", "metadata-only"),
    );
    assert.equal(itemOnlyResult.code, 1);
    assert.match(itemOnlyResult.stderr, /run revoke, then retry/);

    const wrongSecret = await createFixture();
    t.after(() =>
      rm(wrongSecret.fixtureRoot, { recursive: true, force: true }),
    );
    const wrongSecretResult = await run(
      testProvisioner,
      provisionerArguments(wrongSecret, "rotate", "wrong-secret"),
    );
    assert.equal(wrongSecretResult.code, 1);
    assert.match(
      wrongSecretResult.stderr,
      /does not match the owner-held digest/,
    );

    const helperDigest = await createFixture();
    t.after(() =>
      rm(helperDigest.fixtureRoot, { recursive: true, force: true }),
    );
    await rewriteBinding(helperDigest, (binding) => ({
      ...binding,
      leaseArchiveHelperSha256: "0".repeat(64),
    }));
    const helperDigestResult = await run(
      testProvisioner,
      provisionerArguments(helperDigest, "rotate", "valid"),
    );
    assert.equal(helperDigestResult.code, 1);
    assert.match(
      helperDigestResult.stderr,
      /content-addressed layout|pinned digest/,
    );

    const outcomeContractDigest = await createFixture();
    t.after(() =>
      rm(outcomeContractDigest.fixtureRoot, { recursive: true, force: true }),
    );
    await rewriteBinding(outcomeContractDigest, (binding) => ({
      ...binding,
      outcomeLedgerRepairContractSha256: "0".repeat(64),
    }));
    const outcomeContractDigestResult = await run(
      testProvisioner,
      provisionerArguments(outcomeContractDigest, "rotate", "valid"),
    );
    assert.equal(outcomeContractDigestResult.code, 1);
    assert.match(
      outcomeContractDigestResult.stderr,
      /content-addressed layout|pinned digest/,
    );

    const helperMode = await createFixture();
    t.after(() =>
      rm(helperMode.fixtureRoot, { recursive: true, force: true }),
    );
    await chmod(helperMode.binding.leaseArchiveHelperPath, 0o4600);
    const helperModeResult = await run(
      testProvisioner,
      provisionerArguments(helperMode, "rotate", "valid"),
    );
    assert.equal(helperModeResult.code, 1);
    assert.match(helperModeResult.stderr, /trusted immutable regular file/);

    const wrongACL = await createFixture();
    t.after(() => rm(wrongACL.fixtureRoot, { recursive: true, force: true }));
    const wrongACLResult = await run(
      testProvisioner,
      provisionerArguments(wrongACL, "rotate", "wrong-acl"),
    );
    assert.equal(wrongACLResult.code, 1);
    assert.match(
      wrongACLResult.stderr,
      /not constrained to the exact launcher/,
    );
  },
);

test(
  "native provisioner rejects owner and publisher identities",
  { skip: !darwinOnly },
  async () => {
    for (const mode of [
      "wrong-kind",
      "wrong-provenance",
      "short-token",
      "overlong-lease",
      "extra-envelope",
      "extra-result",
      "extra-lease",
      "oversized",
    ]) {
      await withFixture({ mode }, async (fixture) => {
        const result = invoke(fixture.host, acquisitionArguments(fixture));
        assert.notEqual(result.status, 0, `${mode} unexpectedly succeeded`);
      });
    }
    for (const actor of actorLeaseNames.keys()) {
      for (const mode of [
        "wrong-observer-authority",
        "wrong-provider-authority",
      ]) {
        await withFixture({ actor, mode }, async (fixture) => {
          const result = invoke(fixture.host, acquisitionArguments(fixture));
          assert.notEqual(result.status, 0, `${actor} accepted ${mode}`);
        });
      }
    }
  },
);

test(
  "binding and runtime identity drift fail before a channel can authorize",
  { skip: !darwinOnly },
  async () => {
    await withFixture({}, async (fixture) => {
      const binding = JSON.parse(await readFile(fixture.bindingPath, "utf8"));
      binding.nodeSha256 = "0".repeat(64);
      await writeFile(fixture.bindingPath, `${JSON.stringify(binding)}\n`, {
        mode: 0o600,
      });
      const result = invoke(fixture.host, readinessArguments(fixture));
      assert.notEqual(result.status, 0);
      assert.match(result.stderr, /runtime|digest|layout|binding/);
    });
  },
);

test(
  "production host rejects compile-time fixture flags",
  { skip: !darwinOnly },
  async () => {
    for (const binary of [productionHost, productionProvisioner]) {
      const { stdout } = await execFileAsync("/usr/bin/strings", [binary]);
      assert.doesNotMatch(stdout, new RegExp(existingCredential));
      assert.doesNotMatch(stdout, new RegExp(rotatedCredential));
      assert.doesNotMatch(stdout, /--test-binding|--test-runtime-root/);
      assert.doesNotMatch(stdout, /--test-keychain-state|--test-control-mode/);
      assert.doesNotMatch(stdout, /--test-keychain-mode/);
      assert.doesNotMatch(stdout, /--test-interaction-mode/);
      assert.doesNotMatch(
        stdout,
        /digest-write-failure|partial-rotation-failure|disable-noop|restore-failure-with-digest-drift|commit-response-loss-near-deadline|acquisition-window-exhausted|malformed-acquire-and-show|process-timeout/,
      );
    }
    const hostResult = await run(productionHost, [
      "--acquire-lease",
      "--actor",
      defaultActor,
      "--state-root",
      "/tmp",
      "--lease-name",
      actorLeaseNames.get(defaultActor),
      "--max-lifetime-ms",
      "1800000",
      "--test-binding",
      "/tmp/fake.json",
      "--test-runtime-root",
      "/tmp/fake-runtime",
    ]);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /unsupported or duplicate argument/);
  },
);

test(
  "build helper produces one host and accepts no provisioner compatibility",
  { skip: !darwinOnly },
  async () => {
    const directory = await realpath(
      await mkdtemp(path.join(os.tmpdir(), "freed-actor-build-script-")),
    );
    await chmod(directory, 0o700);
    try {
      const hostOutput = path.join(directory, "automation-actor-host");
      const built = invoke(buildScript, ["--host-output", hostOutput]);
      assert.equal(built.status, 0, built.stderr);
      assert.equal((await stat(hostOutput)).isFile(), true);
      const rejected = invoke(buildScript, [
        "--host-output",
        hostOutput,
        "--provisioner-output",
        path.join(directory, "legacy-provisioner"),
      ]);
      assert.notEqual(rejected.status, 0);
      assert.equal(
        await readFile(hostOutput).then((data) => data.length > 0),
        true,
      );
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  },
);

test(
  "native actor sources and binaries contain no Keychain dependency",
  { skip: !darwinOnly },
  async () => {
    const source = await readFile(hostSource, "utf8");
    const build = await readFile(buildScript, "utf8");
    for (const forbidden of [
      /import Security/,
      /SecItem/,
      /SecKeychain/,
      /FREED_AUTOMATION_ACTOR_TOKEN/,
      /persistentCredential/,
      /keychain-to-canonical-lease/,
    ]) {
      assert.doesNotMatch(source, forbidden);
      assert.doesNotMatch(build, forbidden);
    }
    await assert.rejects(readFile(provisionerSource), { code: "ENOENT" });
    const { stdout: libraries } = await execFileAsync("/usr/bin/otool", [
      "-L",
      productionHost,
    ]);
    assert.doesNotMatch(libraries, /Security\.framework/);
    const { stdout: symbols } = await execFileAsync("/usr/bin/nm", [
      "-u",
      productionHost,
    ]);
    assert.doesNotMatch(symbols, /Sec(Item|Keychain)/);
  },
);
