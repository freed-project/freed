import assert from "node:assert/strict";
import { execFile, execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { constants as fsConstants } from "node:fs";
import {
  chmod,
  copyFile,
  mkdir,
  mkdtemp,
  open,
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
const buildScript = path.join(root, "scripts/automation-actor-host-build.sh");
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
const existingCredential =
  "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
const rotatedCredential =
  "abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789";

let buildRoot = "";
let compiledHost = "";
let testProvisioner = "";
let productionHost = "";
let productionProvisioner = "";

async function compileSwift(source, output, testingFlag = undefined) {
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
  arguments_.push(source, "-o", output, "-framework", "Security");
  arguments_.push("-framework", "CryptoKit");
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
  compiledHost = path.join(buildRoot, "automation-actor-host-test-source");
  testProvisioner = path.join(buildRoot, "automation-actor-provision-test");
  productionHost = path.join(buildRoot, "automation-actor-host-production");
  productionProvisioner = path.join(
    buildRoot,
    "automation-actor-provision-production",
  );
  await Promise.all([
    compileSwift(hostSource, compiledHost, "AUTOMATION_ACTOR_HOST_TESTING"),
    compileSwift(
      provisionerSource,
      testProvisioner,
      "AUTOMATION_ACTOR_PROVISION_TESTING",
    ),
    compileSwift(hostSource, productionHost),
    compileSwift(provisionerSource, productionProvisioner),
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

async function writeCredentialRecord(stateRoot, actor, token) {
  const directory = path.join(stateRoot, "control", "actor-credentials");
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await chmod(path.join(stateRoot, "control"), 0o700);
  await chmod(directory, 0o700);
  const credentialPath = path.join(directory, `${actor}.json`);
  await writeFile(
    credentialPath,
    `${JSON.stringify({
      schemaVersion: 1,
      actor,
      purpose: "automation-actor-lease",
      tokenSha256: sha256(token),
    })}\n`,
    { mode: 0o600 },
  );
  await chmod(credentialPath, 0o600);
  return credentialPath;
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
  const runtimeDirectory = path.join(runtimeRoot, runtimeDigest(digests));
  const runtimeLibraryDirectory = path.join(runtimeDirectory, "lib");
  await mkdir(runtimeLibraryDirectory, { recursive: true, mode: 0o700 });
  await chmod(runtimeDirectory, 0o700);
  await chmod(runtimeLibraryDirectory, 0o700);
  const nodePath = path.join(runtimeDirectory, "node");
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

  const bindingPath = path.join(bindingRoot, `${actor}.json`);
  const binding = {
    schemaVersion: 3,
    actor,
    purpose: "automation-actor-launcher",
    handoff: "keychain-to-canonical-lease",
    attestationProtocol: "freed-actor-launcher-readiness-v2",
    launcherPath,
    launcherSha256,
    stateRoot,
    leaseName: actorLeaseNames.get(actor),
    maxLeaseLifetimeMs: 1_800_000,
    keychainService: "freed-automation-actor",
    keychainAccount: actor,
    nodePath,
    nodeSha256: digests.nodeSha256,
    controlEntryPath,
    controlEntrySha256: digests.controlEntrySha256,
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
  const credentialPath =
    credential === null
      ? path.join(stateRoot, "control", "actor-credentials", `${actor}.json`)
      : await writeCredentialRecord(stateRoot, actor, credential);
  if (credential === null) {
    const directory = path.dirname(credentialPath);
    await mkdir(directory, { recursive: true, mode: 0o700 });
    await chmod(path.join(stateRoot, "control"), 0o700);
    await chmod(directory, 0o700);
  }
  return {
    fixtureRoot,
    bindingRoot,
    bindingPath,
    binding,
    runtimeRoot,
    stateRoot,
    credentialPath,
    keychainSnapshotPath: path.join(stateRoot, "test-keychain-item.json"),
    host: launcherPath,
  };
}

function attestationArguments(fixture, overrides = {}) {
  const values = {
    actor: fixture.binding.actor,
    stateRoot: fixture.stateRoot,
    leaseName: fixture.binding.leaseName,
    maximumLifetimeMs: "1800000",
    credentialSha256: sha256(existingCredential),
    keychainService: "freed-automation-actor",
    keychainAccount: fixture.binding.actor,
    ...overrides,
  };
  return [
    "--attest-readiness",
    "--protocol",
    "freed-actor-launcher-readiness-v2",
    "--actor",
    values.actor,
    "--state-root",
    values.stateRoot,
    "--lease-name",
    values.leaseName,
    "--max-lifetime-ms",
    values.maximumLifetimeMs,
    "--credential-sha256",
    values.credentialSha256,
    "--keychain-service",
    values.keychainService,
    "--keychain-account",
    values.keychainAccount,
    "--test-binding",
    fixture.bindingPath,
    "--test-runtime-root",
    fixture.runtimeRoot,
  ];
}

function acquisitionArguments(fixture, overrides = {}) {
  const values = {
    actor: fixture.binding.actor,
    stateRoot: fixture.stateRoot,
    leaseName: fixture.binding.leaseName,
    ttlSeconds: "1800",
    controlMode: "valid",
    keychainMode: "valid",
    ...overrides,
  };
  return [
    "--acquire-lease",
    "--actor",
    values.actor,
    "--state-root",
    values.stateRoot,
    "--lease-name",
    values.leaseName,
    "--ttl-seconds",
    values.ttlSeconds,
    "--test-binding",
    fixture.bindingPath,
    "--test-runtime-root",
    fixture.runtimeRoot,
    "--test-control-mode",
    values.controlMode,
    "--test-keychain-mode",
    values.keychainMode,
  ];
}

function provisionerArguments(
  fixture,
  action,
  keychainState,
  interactionMode = "valid",
) {
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
    keychainState,
    "--test-interaction-mode",
    interactionMode,
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

async function stateSnapshot(stateRoot) {
  const names = (await readdir(stateRoot, { recursive: true })).sort();
  const files = {};
  for (const name of names) {
    const target = path.join(stateRoot, name);
    const handle = await open(
      target,
      fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW,
    );
    try {
      const metadata = await handle.stat();
      if (metadata.isFile()) {
        files[name] = (await handle.readFile()).toString("hex");
      }
    } finally {
      await handle.close();
    }
  }
  return { names, files };
}

async function rewriteBinding(fixture, transform) {
  const next = transform(structuredClone(fixture.binding));
  await writeFile(fixture.bindingPath, `${JSON.stringify(next, null, 2)}\n`, {
    mode: 0o600,
  });
  await chmod(fixture.bindingPath, 0o600);
}

test(
  "native actor host attests readiness without mutating state",
  { skip: !darwinOnly },
  async (t) => {
    const fixture = await createFixture();
    t.after(() => rm(fixture.fixtureRoot, { recursive: true, force: true }));
    const before = await stateSnapshot(fixture.stateRoot);
    const result = await run(fixture.host, attestationArguments(fixture), {
      env: {
        BASH_ENV: "/tmp/hostile-bash-env",
        NODE_OPTIONS: "--require=/tmp/hostile-loader.cjs",
        FREED_AUTOMATION_ACTOR_TOKEN: "hostile-persistent-token",
      },
    });
    assert.equal(result.code, 0, result.stderr);
    const attestation = JSON.parse(result.stdout);
    assert.deepEqual(Object.keys(attestation).sort(), [
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
    ]);
    assert.equal(attestation.actor, defaultActor);
    assert.equal(attestation.maxLeaseLifetimeMs, 1_800_000);
    assert.equal(attestation.credentialDigestVerified, true);
    assert.equal(attestation.canonicalLeaseReady, true);
    assert.equal(attestation.mutatesState, false);
    assert.deepEqual(await stateSnapshot(fixture.stateRoot), before);
  },
);

test(
  "native actor host returns only a bounded short-lived lease through a scrubbed handoff",
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
        acquisitionArguments(fixture, { keychainMode }),
      );
      assert.equal(result.code, 1);
      assert.match(result.stderr, pattern);
      if (keychainMode === "disable-noop") {
        assert.doesNotMatch(result.stderr, /credential read permitted user interaction/);
      }
      assert.equal(result.stdout, "");
    }
    const initiallyDisabled = await run(
      fixture.host,
      acquisitionArguments(fixture, { keychainMode: "initially-disabled" }),
    );
    assert.equal(initiallyDisabled.code, 0, initiallyDisabled.stderr);
    assert.equal(
      JSON.parse(initiallyDisabled.stdout).leaseName,
      "scaffolding-writer",
    );
  },
);

test(
  "native actor host rejects oversized, overlong, and implausible control responses",
  { skip: !darwinOnly },
  async (t) => {
    const fixture = await createFixture();
    t.after(() => rm(fixture.fixtureRoot, { recursive: true, force: true }));
    for (const [controlMode, pattern] of [
      ["oversized", /too much output/],
      ["overlong", /bounded canonical lease/],
      ["short-token", /bounded canonical lease/],
    ]) {
      const result = await run(
        fixture.host,
        acquisitionArguments(fixture, { controlMode }),
      );
      assert.equal(result.code, 1);
      assert.match(result.stderr, pattern);
      assert.equal(result.stdout, "");
    }
  },
);

test(
  "native actor host rejects owner, publisher, drifted contracts, and overlong TTL",
  { skip: !darwinOnly },
  async (t) => {
    const fixture = await createFixture();
    t.after(() => rm(fixture.fixtureRoot, { recursive: true, force: true }));
    for (const actor of ["freed-owner", "freed-pr-publisher"]) {
      const result = await run(
        fixture.host,
        acquisitionArguments(fixture, { actor }),
      );
      assert.equal(result.code, 1);
      assert.match(result.stderr, /not a general automation actor/);
    }
    for (const overrides of [
      { leaseName: "nightly-writer" },
      { stateRoot: fixture.fixtureRoot },
      { ttlSeconds: "1801" },
    ]) {
      const result = await run(
        fixture.host,
        acquisitionArguments(fixture, overrides),
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
    t.after(() =>
      rm(credentialFixture.fixtureRoot, { recursive: true, force: true }),
    );
    const credentialResult = await run(
      credentialFixture.host,
      acquisitionArguments(credentialFixture),
    );
    assert.equal(credentialResult.code, 1);
    assert.match(
      credentialResult.stderr,
      /does not match the owner-held digest/,
    );
  },
);

test(
  "native provisioner performs provision, owner-interactive rotate, and non-secret revoke transitions",
  { skip: !darwinOnly },
  async (t) => {
    const provisionFixture = await createFixture({ credential: null });
    t.after(() =>
      rm(provisionFixture.fixtureRoot, { recursive: true, force: true }),
    );
    const provisioned = await run(
      testProvisioner,
      provisionerArguments(provisionFixture, "provision", "empty"),
    );
    assert.equal(provisioned.code, 0, provisioned.stderr);
    const provisionedRecord = JSON.parse(
      await readFile(provisionFixture.credentialPath, "utf8"),
    );
    assert.equal(provisionedRecord.tokenSha256, sha256(rotatedCredential));
    assert.equal(
      (await stat(provisionFixture.credentialPath)).mode & 0o777,
      0o600,
    );
    assert.doesNotMatch(provisioned.stdout, new RegExp(rotatedCredential));

    const rotateFixture = await createFixture();
    t.after(() =>
      rm(rotateFixture.fixtureRoot, { recursive: true, force: true }),
    );
    const rotated = await run(
      testProvisioner,
      provisionerArguments(rotateFixture, "rotate", "valid"),
    );
    assert.equal(rotated.code, 0, rotated.stderr);
    assert.equal(
      JSON.parse(await readFile(rotateFixture.credentialPath, "utf8"))
        .tokenSha256,
      sha256(rotatedCredential),
    );

    const rollbackFixture = await createFixture();
    t.after(() =>
      rm(rollbackFixture.fixtureRoot, { recursive: true, force: true }),
    );
    const rolledBack = await run(
      testProvisioner,
      provisionerArguments(rollbackFixture, "rotate", "digest-write-failure"),
    );
    assert.equal(rolledBack.code, 1);
    assert.match(
      rolledBack.stderr,
      /failed while installing the digest; the previous credential was restored/,
    );
    assert.equal(
      JSON.parse(await readFile(rollbackFixture.credentialPath, "utf8"))
        .tokenSha256,
      sha256(existingCredential),
    );
    assert.deepEqual(
      JSON.parse(await readFile(rollbackFixture.keychainSnapshotPath, "utf8")),
      {
        launcherACLMatches: true,
        present: true,
        secretSha256: sha256(existingCredential),
      },
    );

    const partialRotationFixture = await createFixture();
    t.after(() =>
      rm(partialRotationFixture.fixtureRoot, { recursive: true, force: true }),
    );
    const partialRotation = await run(
      testProvisioner,
      provisionerArguments(
        partialRotationFixture,
        "rotate",
        "partial-rotation-failure",
      ),
    );
    assert.equal(partialRotation.code, 1);
    assert.match(
      partialRotation.stderr,
      /failed before the digest changed; the previous credential was restored/,
    );
    assert.equal(
      JSON.parse(
        await readFile(partialRotationFixture.credentialPath, "utf8"),
      ).tokenSha256,
      sha256(existingCredential),
    );
    assert.deepEqual(
      JSON.parse(
        await readFile(partialRotationFixture.keychainSnapshotPath, "utf8"),
      ),
      {
        launcherACLMatches: true,
        present: true,
        secretSha256: sha256(existingCredential),
      },
    );
    const revokeFixture = await createFixture();
    t.after(() =>
      rm(revokeFixture.fixtureRoot, { recursive: true, force: true }),
    );
    const revoked = await run(
      testProvisioner,
      provisionerArguments(
        revokeFixture,
        "revoke",
        "metadata-only",
        "initially-disabled",
      ),
    );
    assert.equal(revoked.code, 0, revoked.stderr);
    await assert.rejects(readFile(revokeFixture.credentialPath), {
      code: "ENOENT",
    });
    assert.equal(JSON.parse(revoked.stdout).ready, false);
  },
);

test(
  "native provisioner permits the legacy readiness protocol only for credential revocation",
  { skip: !darwinOnly },
  async (t) => {
    for (const action of ["provision", "rotate", "revoke"]) {
      const fixture = await createFixture({
        credential: action === "provision" ? null : existingCredential,
      });
      t.after(() => rm(fixture.fixtureRoot, { recursive: true, force: true }));
      await writeFile(
        fixture.bindingPath,
        `${JSON.stringify(
          {
            ...fixture.binding,
            attestationProtocol: "freed-actor-launcher-readiness-v1",
          },
          null,
          2,
        )}\n`,
        { mode: 0o600 },
      );
      const result = await run(
        testProvisioner,
        provisionerArguments(
          fixture,
          action,
          action === "provision"
            ? "empty"
            : action === "rotate"
              ? "valid"
              : "metadata-only",
          action === "revoke" ? "initially-disabled" : "get-failure",
        ),
      );
      if (action === "revoke") {
        assert.equal(result.code, 0, result.stderr);
        await assert.rejects(readFile(fixture.credentialPath), {
          code: "ENOENT",
        });
      } else {
        assert.equal(result.code, 1, result.stderr);
        assert.match(
          result.stderr,
          /actor launcher binding does not match this request/,
        );
      }
    }
  },
);

test(
  "native actor host rejects the legacy readiness protocol before Keychain access",
  { skip: !darwinOnly },
  async (t) => {
    const fixture = await createFixture();
    t.after(() => rm(fixture.fixtureRoot, { recursive: true, force: true }));
    await rewriteBinding(fixture, (binding) => ({
      ...binding,
      attestationProtocol: "freed-actor-launcher-readiness-v1",
    }));

    const result = await run(
      fixture.host,
      acquisitionArguments(fixture, { keychainMode: "read-failure" }),
    );
    assert.equal(result.code, 1);
    assert.match(
      result.stderr,
      /actor launcher binding does not match this request/,
    );
    assert.doesNotMatch(result.stderr, /Keychain credential could not be read/);
    assert.equal(result.stdout, "");
  },
);

test(
  "native provisioner keeps legacy credentials when binding integrity fails",
  { skip: !darwinOnly },
  async (t) => {
    const fixture = await createFixture();
    t.after(() => rm(fixture.fixtureRoot, { recursive: true, force: true }));
    await rewriteBinding(fixture, (binding) => ({
      ...binding,
      attestationProtocol: "freed-actor-launcher-readiness-v1",
      nodeSha256: "0".repeat(64),
    }));

    const result = await run(
      testProvisioner,
      provisionerArguments(
        fixture,
        "revoke",
        "metadata-only",
        "initially-disabled",
      ),
    );
    assert.equal(result.code, 1);
    assert.match(result.stderr, /content-addressed layout|pinned digest/);
    assert.equal(
      JSON.parse(await readFile(fixture.credentialPath, "utf8")).tokenSha256,
      sha256(existingCredential),
    );
  },
);

test(
  "native provision and revoke fail closed when Keychain UI policy cannot be controlled",
  { skip: !darwinOnly },
  async (t) => {
    for (const action of ["provision", "revoke"]) {
      for (const [interactionMode, pattern] of [
        ["get-failure", /interaction policy could not be read/],
        ["disable-failure", /interaction policy could not be disabled/],
        ["disable-noop", /interaction policy remained enabled/],
        ["restore-failure", /could not be restored after the lifecycle action/],
      ]) {
        const fixture = await createFixture({
          credential: action === "provision" ? null : existingCredential,
        });
        t.after(() => rm(fixture.fixtureRoot, { recursive: true, force: true }));
        const result = await run(
          testProvisioner,
          provisionerArguments(
            fixture,
            action,
            action === "provision" ? "empty" : "metadata-only",
            interactionMode,
          ),
        );
        assert.equal(result.code, 1);
        assert.match(result.stderr, pattern);
        assert.equal(result.stdout, "");
        if (interactionMode === "disable-noop") {
          assert.doesNotMatch(
            result.stderr,
            /fake Keychain (inspection|add|deletion) permitted user interaction/,
          );
        }
        if (action === "provision" && interactionMode === "restore-failure") {
          await assert.rejects(readFile(fixture.credentialPath), {
            code: "ENOENT",
          });
          assert.deepEqual(
            JSON.parse(
              await readFile(fixture.keychainSnapshotPath, "utf8"),
            ),
            { present: false },
          );
        }
      }
    }

    const driftFixture = await createFixture({ credential: null });
    t.after(() =>
      rm(driftFixture.fixtureRoot, { recursive: true, force: true }),
    );
    const driftedRollback = await run(
      testProvisioner,
      provisionerArguments(
        driftFixture,
        "provision",
        "empty",
        "restore-failure-with-digest-drift",
      ),
    );
    assert.equal(driftedRollback.code, 1);
    assert.match(
      driftedRollback.stderr,
      /could not be restored and the completed lifecycle action could not be rolled back/,
    );
    assert.equal(driftedRollback.stdout, "");
    assert.equal(
      JSON.parse(await readFile(driftFixture.credentialPath, "utf8"))
        .tokenSha256,
      "0".repeat(64),
    );
    assert.deepEqual(
      JSON.parse(
        await readFile(driftFixture.keychainSnapshotPath, "utf8"),
      ),
      {
        launcherACLMatches: true,
        present: true,
        secretSha256: sha256(rotatedCredential),
      },
    );
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
    for (const actor of ["freed-owner", "freed-pr-publisher"]) {
      const result = await run(testProvisioner, [
        "revoke",
        "--actor",
        actor,
        "--state-root",
        "/tmp",
        "--test-binding",
        "/tmp/binding.json",
        "--test-runtime-root",
        "/tmp/runtime",
        "--test-keychain-state",
        "empty",
      ]);
      assert.equal(result.code, 1);
      assert.match(result.stderr, /supported general automation actor/);
    }
  },
);

test(
  "native provisioner lets the exact trusted ad hoc launcher read without a passphrase prompt",
  { skip: !darwinOnly },
  async () => {
    const source = await readFile(provisionerSource, "utf8");
    assert.match(
      source,
      /launcherPromptSelector\s*=\s*SecKeychainPromptSelector\(\)/,
    );
    assert.match(source, /selector == launcherPromptSelector/);
    assert.match(source, /trustedApplications\.count == 1/);
    assert.doesNotMatch(source, /SecKeychainPromptSelector\.unsignedAct/);
    assert.doesNotMatch(source, /SecKeychainPromptSelector\.invalidAct/);
    assert.doesNotMatch(source, /SecKeychainPromptSelector\.requirePassphase/);
    assert.doesNotMatch(source, /func verify\s*\(/);
  },
);

test(
  "production binaries contain no test credential or test-only override",
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
      "scaffolding-writer",
      "--ttl-seconds",
      "1800",
      "--test-binding",
      "/tmp/binding.json",
    ]);
    assert.equal(hostResult.code, 1);
    assert.match(hostResult.stderr, /unsupported or duplicate argument/);
    const { stdout: hostUndefinedSymbols } = await execFileAsync(
      "/usr/bin/nm",
      ["-u", productionHost],
    );
    assert.match(
      hostUndefinedSymbols,
      /_SecKeychainGetUserInteractionAllowed/,
    );
    assert.match(
      hostUndefinedSymbols,
      /_SecKeychainSetUserInteractionAllowed/,
    );
    const { stdout: provisionerUndefinedSymbols } = await execFileAsync(
      "/usr/bin/nm",
      ["-u", productionProvisioner],
    );
    assert.match(
      provisionerUndefinedSymbols,
      /_SecKeychainGetUserInteractionAllowed/,
    );
    assert.match(
      provisionerUndefinedSymbols,
      /_SecKeychainSetUserInteractionAllowed/,
    );
    const provisionerResult = await run(productionProvisioner, [
      "verify",
      "--actor",
      defaultActor,
      "--state-root",
      "/tmp",
    ]);
    assert.equal(provisionerResult.code, 1);
    assert.match(
      provisionerResult.stderr,
      /requires provision, rotate, or revoke/,
    );
  },
);

test(
  "native build helper emits deterministic linker ad hoc tools with no signing identity",
  { skip: !darwinOnly },
  async (t) => {
    const outputRoot = await realpath(
      await mkdtemp(path.join(os.tmpdir(), "freed-actor-build-helper-")),
    );
    t.after(() => rm(outputRoot, { recursive: true, force: true }));
    await chmod(outputRoot, 0o700);
    const hostOutput = path.join(outputRoot, "automation-actor-host");
    const provisionerOutput = path.join(
      outputRoot,
      "automation-actor-provision",
    );
    const secondOutputRoot = await realpath(
      await mkdtemp(path.join(os.tmpdir(), "freed-actor-build-helper-second-")),
    );
    t.after(() => rm(secondOutputRoot, { recursive: true, force: true }));
    await chmod(secondOutputRoot, 0o700);
    const secondHostOutput = path.join(secondOutputRoot, "host-result");
    const secondProvisionerOutput = path.join(
      secondOutputRoot,
      "provisioner-result",
    );
    const result = await run(buildScript, [
      "--host-output",
      hostOutput,
      "--provisioner-output",
      provisionerOutput,
    ]);
    assert.equal(result.code, 0, result.stderr);
    const secondResult = await run(buildScript, [
      "--host-output",
      secondHostOutput,
      "--provisioner-output",
      secondProvisionerOutput,
    ]);
    assert.equal(secondResult.code, 0, secondResult.stderr);
    assert.equal((await stat(hostOutput)).mode & 0o777, 0o755);
    assert.equal((await stat(provisionerOutput)).mode & 0o777, 0o755);
    assert.equal(await sha256File(hostOutput), await sha256File(secondHostOutput));
    assert.equal(
      await sha256File(provisionerOutput),
      await sha256File(secondProvisionerOutput),
    );
    assert.equal(await codeIdentifier(hostOutput), "automation-actor-host");
    assert.equal(
      await codeIdentifier(secondHostOutput),
      "automation-actor-host",
    );
    assert.equal(
      await codeIdentifier(provisionerOutput),
      "automation-actor-provision",
    );
    assert.equal(
      await codeIdentifier(secondProvisionerOutput),
      "automation-actor-provision",
    );
    const source = await readFile(buildScript, "utf8");
    assert.doesNotMatch(source, /codesign|signing-identity|--identity/);
    for (const binary of [hostOutput, provisionerOutput]) {
      const { stdout } = await execFileAsync("/usr/bin/strings", [binary]);
      assert.doesNotMatch(stdout, /--test-binding|--test-keychain-state/);
      assert.doesNotMatch(stdout, new RegExp(existingCredential));
    }
  },
);
