import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmodSync,
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  symlinkSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  AUTOMATION_ACTORS,
  AUTOMATION_ACTOR_IDS,
  AutomationActorsError,
  assertProvisioningReady,
  bindingForActor,
  defaultRunner,
  executeCommand,
  parseCommand,
  runtimeDigestForPins,
  validatePublicBinding,
} from "./automation-actors.mjs";
import {
  defaultLauncherAttestor,
  parseLauncherAttestation,
} from "./lib/automation-actor-readiness.mjs";

const testLeaseOperationId = "12345678-1234-4123-8123-123456789abc";
const testLeaseToken = "short-lived-test-token-1234567890";
const testLeaseTokenSha256 = createHash("sha256")
  .update(testLeaseToken)
  .digest("hex");
const sourceScriptsRoot = path.dirname(fileURLToPath(import.meta.url));

function sha256(filePath) {
  return createHash("sha256").update(readFileSync(filePath)).digest("hex");
}

function lstatMode(filePath) {
  return lstatSync(filePath).mode & 0o777;
}

function writeExecutable(filePath, contents) {
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, contents, { mode: 0o700 });
}

function fixture(t) {
  const root = realpathSync(
    mkdtempSync(path.join(os.tmpdir(), "freed-automation-actors-test-")),
  );
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const repoRoot = path.join(root, "freed");
  const stateRoot = path.join(root, ".freed", "automation");
  const homeDir = path.join(root, "home");
  const tempRoot = path.join(root, "private-temp");
  const launcherRoot = path.join(root, "automation-actor-launchers");
  const runtimeRoot = path.join(root, "automation-actor-runtimes");
  const hostBuildPath = path.join(
    repoRoot,
    "scripts",
    "automation-actor-host-build.sh",
  );
  const pinnedNodePath = path.join(
    homeDir,
    ".nvm",
    "versions",
    "node",
    "v24.14.1",
    "bin",
    "node",
  );

  mkdirSync(path.join(repoRoot, "scripts", "lib"), { recursive: true });
  mkdirSync(stateRoot, { recursive: true, mode: 0o700 });
  chmodSync(stateRoot, 0o700);
  mkdirSync(tempRoot, { recursive: true, mode: 0o700 });
  writeFileSync(path.join(repoRoot, ".nvmrc"), "24.14.1\n");
  writeFileSync(
    path.join(repoRoot, "scripts", "automation-control.mjs"),
    "export const control = true;\n",
  );
  writeFileSync(
    path.join(repoRoot, "scripts", "automation-actor-control.mjs"),
    "export const actorControl = true;\n",
  );
  writeFileSync(
    path.join(repoRoot, "scripts", "lib", "automation-control.mjs"),
    "export const library = true;\n",
  );
  writeFileSync(
    path.join(
      repoRoot,
      "scripts",
      "lib",
      "automation-kernel-guard-contract.mjs",
    ),
    "export const kernelGuardContract = true;\n",
  );
  writeFileSync(
    path.join(repoRoot, "scripts", "lib", "outcome-ledger-repair-contract.mjs"),
    "export const outcomeLedgerRepairContract = true;\n",
  );
  writeFileSync(
    path.join(repoRoot, "scripts", "lib", "lease-archive-move.py"),
    "print('lease archive helper fixture')\n",
  );
  writeExecutable(hostBuildPath, "#!/bin/bash\nexit 0\n");
  writeExecutable(pinnedNodePath, "pinned node fixture\n");

  const calls = [];
  const liveLeases = new Map();
  const processIdentities = new Map([[4242, "fixture-process-start"]]);
  const runner = (executable, args, options) => {
    calls.push({ executable, args: [...args], options });
    if (executable === "/bin/bash" && args[0] === hostBuildPath) {
      const hostOutput = args[args.indexOf("--host-output") + 1];
      writeExecutable(hostOutput, "automation actor host fixture\n");
      return { status: 0, stdout: "built\n", stderr: "" };
    }
    if (executable === "/usr/bin/sudo") {
      if (args[0] === "/bin/rm") {
        rmSync(args.at(-1), { force: true });
      } else if (args[0] === "/usr/bin/install" && args[1] === "-d") {
        const mode = Number.parseInt(args[args.indexOf("-m") + 1], 8);
        const destination = args.at(-1);
        mkdirSync(destination, { recursive: true, mode });
        chmodSync(destination, mode);
      } else if (args[0] === "/usr/bin/install") {
        const mode = Number.parseInt(args[args.indexOf("-m") + 1], 8);
        const source = args.at(-2);
        const destination = args.at(-1);
        mkdirSync(path.dirname(destination), { recursive: true });
        rmSync(destination, { force: true });
        copyFileSync(source, destination);
        chmodSync(destination, mode);
      } else {
        assert.fail(`unexpected sudo command: ${args.join(" ")}`);
      }
      return { status: 0, stdout: "", stderr: "" };
    }
    if (args[0] === "--acquire-lease") {
      const actor = args[args.indexOf("--actor") + 1];
      const leaseName = args[args.indexOf("--lease-name") + 1];
      const leaseToken = testLeaseToken;
      liveLeases.set(leaseName, { actor, leaseToken });
      return {
        status: 0,
        stdout: `${JSON.stringify({
          schemaVersion: 1,
          actor,
          leaseName,
          leaseOperationId: testLeaseOperationId,
          leaseToken,
          leaseTokenSha256: testLeaseTokenSha256,
          acquiredAt: "2026-07-13T12:00:00.000Z",
          expiresAt: "2026-07-13T12:30:00.000Z",
          ttlMs: Number(args[args.indexOf("--ttl-seconds") + 1]) * 1_000,
        })}\n`,
        stderr: "",
      };
    }
    if (args[0] === "--attest-readiness") {
      const expected = {
        actor: args[args.indexOf("--actor") + 1],
        stateRoot: args[args.indexOf("--state-root") + 1],
        leaseName: args[args.indexOf("--lease-name") + 1],
        maxLeaseLifetimeMs: Number(args[args.indexOf("--max-lifetime-ms") + 1]),
        credentialSha256: args[args.indexOf("--credential-sha256") + 1],
        keychainService: args[args.indexOf("--keychain-service") + 1],
        keychainAccount: args[args.indexOf("--keychain-account") + 1],
      };
      return {
        status: 0,
        stdout: `${JSON.stringify({
          schemaVersion: 1,
          protocol: "freed-actor-launcher-readiness-v3",
          purpose: "automation-actor-launcher-readiness",
          actor,
          stateRoot,
          leaseName,
          maxLeaseLifetimeMs,
          handoff: "trusted-launcher-channel-to-canonical-lease",
          channelProtocol: "freed-actor-launcher-channel-v1",
          launcherSha256: binding.launcherSha256,
          runtimeDigest: path.basename(path.dirname(binding.nodePath)),
          canonicalLeaseReady: true,
          mutatesState: false,
        })}\n`,
        stderr: "",
      };
    }
    if (args[1] === "lease") {
      const action = args[2];
      const leaseName = args[args.indexOf("--name") + 1];
      const lease = liveLeases.get(leaseName);
      if (action === "show") {
        return {
          status: 0,
          stdout: `${JSON.stringify({
            ok: true,
            schemaVersion: 1,
            action: "lease.show",
            stateRoot,
            result: lease
              ? { name: leaseName, owner: lease.actor, status: "active" }
              : null,
          })}\n`,
          stderr: "",
        };
      }
      if (!lease) return { status: 1, stdout: "", stderr: "missing" };
      const result =
        action === "heartbeat"
          ? {
              heartbeated: true,
              lease: {
                name: leaseName,
                owner: lease.actor,
                token: options.env.FREED_AUTOMATION_LEASE_TOKEN,
              },
            }
          : {
              released: true,
              lease: { name: leaseName, owner: lease.actor },
            };
      if (action === "release") liveLeases.delete(leaseName);
      return {
        status: 0,
        stdout: `${JSON.stringify({
          ok: true,
          schemaVersion: 1,
          action: `lease.${action}`,
          stateRoot,
          result,
        })}\n`,
        stderr: "",
      };
    }
    if (executable === pinnedNodePath && args[0] === "--version") {
      return { status: 0, stdout: "v24.14.1\n", stderr: "" };
    }
    return { status: 0, stdout: "{}\n", stderr: "" };
  };

  const dependencies = {
    env: {
      HOME: homeDir,
      USER: "owner",
      LOGNAME: "owner",
      TMPDIR: "/untrusted/tmp",
      DEVELOPER_DIR: "/untrusted/developer",
      FREED_OWNER_LEASE_TOKEN: "must-not-reach-a-child",
    },
    platform: "darwin",
    uid: typeof process.getuid === "function" ? process.getuid() : 501,
    pid: 4242,
    homeDir,
    tempRoot,
    repoRoot,
    launcherRoot,
    runtimeRoot,
    trustedUid: typeof process.getuid === "function" ? process.getuid() : 501,
    hostBuildPath,
    runner,
    lifecycleLockStaleMs: 30_000,
    lifecycleLockTokenFactory: () => "c".repeat(64),
    nowMs: () => Date.parse("2026-07-18T12:00:00.000Z"),
    processStartInspector: (_dependencies, pid) =>
      processIdentities.has(pid)
        ? { status: "live", identity: processIdentities.get(pid) }
        : { status: "dead", identity: "" },
    repositoryInspector: () => ({
      topLevel: repoRoot,
      branch: "dev",
      head: "a".repeat(40),
      originDev: "a".repeat(40),
      status: "",
    }),
    pinnedNodeResolver: () => pinnedNodePath,
  };
  dependencies.launcherAttestor = (request, { timeoutMs }) => {
    const args = [
      "--attest-readiness",
      "--protocol",
      "freed-actor-launcher-readiness-v3",
      "--actor",
      request.actor,
      "--state-root",
      request.stateRoot,
      "--lease-name",
      request.leaseName,
      "--max-lifetime-ms",
      String(request.maxLeaseLifetimeMs),
    ];
    const result = runner(request.launcherPath, args, {
      cwd: "/",
      env: { PATH: "/usr/bin:/bin", LANG: "C", LC_ALL: "C" },
      timeoutMs,
      killSignal: "SIGKILL",
      stdin: "ignore",
    });
    if (result.error) {
      return {
        ready: false,
        reason:
          result.error.code === "ETIMEDOUT"
            ? `trusted launcher readiness attestation exceeded ${timeoutMs.toLocaleString()} ms`
            : "trusted launcher readiness attestation failed",
      };
    }
    if (result.status !== 0) {
      return {
        ready: false,
        reason: "trusted launcher readiness attestation failed",
      };
    }
    return parseLauncherAttestation(result.stdout, request);
  };

  return {
    root,
    repoRoot,
    stateRoot,
    homeDir,
    tempRoot,
    launcherRoot,
    runtimeRoot,
    hostBuildPath,
    pinnedNodePath,
    calls,
    liveLeases,
    processIdentities,
    runner,
    dependencies,
  };
}

function lifecycleLockPath(value) {
  return path.join(
    value.stateRoot,
    "control",
    "automation-actor-lifecycle-v2.lock",
  );
}

function lifecycleOwnerRecord(value, overrides = {}) {
  return {
    schemaVersion: 1,
    protocol: "freed-automation-actor-lifecycle-lock-v1",
    stateRoot: value.stateRoot,
    operation: "accept-host",
    pid: 9001,
    processStartIdentity: "other-process-start",
    nonce: "d".repeat(64),
    acquiredAtMs: value.dependencies.nowMs(),
    ...overrides,
  };
}

function writeLifecycleLock(
  value,
  { owner = undefined, ownerText = undefined, ageMs = 0 } = {},
) {
  const lockPath = lifecycleLockPath(value);
  mkdirSync(path.dirname(lockPath), { recursive: true, mode: 0o700 });
  chmodSync(path.dirname(lockPath), 0o700);
  mkdirSync(lockPath, { mode: 0o700 });
  chmodSync(lockPath, 0o700);
  const ownerPath = path.join(lockPath, "owner.json");
  if (owner !== undefined || ownerText !== undefined) {
    writeFileSync(ownerPath, ownerText ?? `${JSON.stringify(owner)}\n`, {
      mode: 0o600,
    });
    chmodSync(ownerPath, 0o600);
  }
  if (ageMs > 0) {
    const time = new Date(value.dependencies.nowMs() - ageMs);
    if (existsSync(ownerPath)) utimesSync(ownerPath, time, time);
    utimesSync(lockPath, time, time);
  }
  return { lockPath, ownerPath };
}

test("bounded owner probes hard-kill a SIGTERM-resistant fixture child", (t) => {
  const value = fixture(t);
  const childPath = path.join(value.root, "sigterm-resistant-child.mjs");
  writeExecutable(
    childPath,
    `#!${process.execPath}\nprocess.on("SIGTERM", () => {});\nsetTimeout(() => process.exit(91), 5_000);\n`,
  );

  const runnerStartedAt = Date.now();
  const runnerResult = defaultRunner(process.execPath, [childPath], {
    cwd: value.root,
    env: { PATH: "/usr/bin:/bin", LANG: "C", LC_ALL: "C" },
    timeoutMs: 75,
    stdin: "ignore",
  });
  assert.equal(runnerResult.error?.code, "ETIMEDOUT");
  assert.equal(runnerResult.signal, "SIGKILL");
  assert.ok(Date.now() - runnerStartedAt < 2_000);

  const attestorStartedAt = Date.now();
  const attestation = defaultLauncherAttestor(
    {
      launcherPath: childPath,
      actor: "freed-runtime-observer",
      stateRoot: value.stateRoot,
      leaseName: "runtime-observer",
      maxLeaseLifetimeMs: 30 * 60_000,
      launcherSha256: "a".repeat(64),
      runtimeDigest: "b".repeat(64),
    },
    { timeoutMs: 75 },
  );
  assert.equal(attestation.ready, false);
  assert.match(attestation.reason, /75 ms/);
  assert.ok(Date.now() - attestorStartedAt < 2_000);
});

test("command parsing accepts only the five actor contracts", () => {
  assert.deepEqual(AUTOMATION_ACTOR_IDS, [
    "freed-runtime-observer",
    "freed-stability-controller",
    "freed-scaffolding-maintainer",
    "freed-nightly-runner",
    "freed-release-verifier",
  ]);
  assert.deepEqual(parseCommand(["provision", "--all"]), {
    action: "provision",
    actor: "all",
    stateRoot: undefined,
  });
  assert.deepEqual(
    parseCommand(["acquire", "--actor", "freed-nightly-runner"]),
    {
      action: "acquire",
      actor: "freed-nightly-runner",
      stateRoot: undefined,
    },
  );
  assert.deepEqual(parseCommand(["accept-host", "--all"]), {
    action: "accept-host",
    actor: "all",
    stateRoot: undefined,
  });
  assert.throws(
    () => parseCommand(["accept-host", "--actor", "freed-runtime-observer"]),
    (error) =>
      error instanceof AutomationActorsError && error.code === "invalid_actor",
  );
});

test("reserved owner and publisher identities are explicitly rejected", () => {
  for (const actor of ["freed-owner", "freed-pr-publisher"]) {
    assert.throws(
      () => parseCommand(["provision", "--actor", actor]),
      (error) =>
        error instanceof AutomationActorsError &&
        error.code === "reserved_actor" &&
        error.message.includes(actor),
    );
  }
  assert.throws(
    () => parseCommand(["acquire", "--all"]),
    (error) =>
      error instanceof AutomationActorsError && error.code === "invalid_actor",
  );
  assert.throws(
    () => parseCommand(["provision", "--actor", "all"]),
    (error) =>
      error instanceof AutomationActorsError && error.code === "invalid_actor",
  );
  assert.throws(
    () =>
      parseCommand(["verify", "--all", "--actor", "freed-runtime-observer"]),
    (error) =>
      error instanceof AutomationActorsError &&
      error.code === "invalid_argument",
  );
});

test("provisioning preflight requires macOS, a non-root owner, and exact clean dev", () => {
  const repository = {
    topLevel: "/repo",
    branch: "dev",
    head: "a".repeat(40),
    originDev: "a".repeat(40),
    status: "",
  };
  assert.doesNotThrow(() =>
    assertProvisioningReady({
      platform: "darwin",
      uid: 501,
      repository,
      repoRoot: "/repo",
    }),
  );
  for (const value of [
    { platform: "linux", uid: 501, repository, repoRoot: "/repo" },
    { platform: "darwin", uid: 0, repository, repoRoot: "/repo" },
    {
      platform: "darwin",
      uid: 501,
      repository: { ...repository, branch: "feature" },
      repoRoot: "/repo",
    },
    {
      platform: "darwin",
      uid: 501,
      repository: { ...repository, originDev: "b".repeat(40) },
      repoRoot: "/repo",
    },
    {
      platform: "darwin",
      uid: 501,
      repository: { ...repository, status: " M file" },
      repoRoot: "/repo",
    },
  ]) {
    assert.throws(() => assertProvisioningReady(value), AutomationActorsError);
  }
});

test("one lifecycle lock serializes provisioning and standalone acceptance", (t) => {
  const value = fixture(t);
  const baseRunner = value.dependencies.runner;
  let nestedError;
  let attempted = false;
  value.dependencies.runner = (executable, args, options) => {
    if (
      !attempted &&
      executable === "/bin/bash" &&
      args[0] === value.hostBuildPath
    ) {
      attempted = true;
      try {
        executeCommand(
          {
            action: "accept-host",
            actor: "all",
            stateRoot: value.stateRoot,
          },
          value.dependencies,
        );
      } catch (error) {
        nestedError = error;
      }
    }
    return baseRunner(executable, args, options);
  };

  const result = executeCommand(
    {
      action: "provision",
      actor: "freed-runtime-observer",
      stateRoot: value.stateRoot,
    },
    value.dependencies,
  );

  assert.equal(attempted, true);
  assert.equal(nestedError instanceof AutomationActorsError, true);
  assert.equal(nestedError.code, "lifecycle_busy");
  assert.equal(result.records[0].accepted, true);
  assert.equal(existsSync(lifecycleLockPath(value)), false);
});

test("fresh empty and partial lifecycle locks remain busy", (t) => {
  for (const scenario of ["empty", "partial"]) {
    const value = fixture(t);
    writeLifecycleLock(value, {
      ownerText: scenario === "partial" ? '{"schemaVersion":' : undefined,
      ageMs: 1,
    });

    assert.throws(
      () =>
        executeCommand(
          {
            action: "accept-host",
            actor: "all",
            stateRoot: value.stateRoot,
          },
          value.dependencies,
        ),
      (error) =>
        error instanceof AutomationActorsError &&
        error.code === "lifecycle_busy",
      scenario,
    );
    assert.equal(existsSync(lifecycleLockPath(value)), true, scenario);
    assert.equal(value.calls.length, 0, scenario);
  }
});

test("an empty lifecycle lock is recoverable only after thirty seconds", (t) => {
  const value = fixture(t);
  for (const actor of AUTOMATION_ACTOR_IDS) {
    writeAcquisitionBinding(value, actor);
  }
  writeLifecycleLock(value, { ageMs: 30_001 });

  const result = executeCommand(
    {
      action: "accept-host",
      actor: "all",
      stateRoot: value.stateRoot,
    },
    value.dependencies,
  );
  assert.equal(result.accepted, true);
  assert.equal(existsSync(lifecycleLockPath(value)), false);
});

test("an unsafe lifecycle lock mode fails closed", (t) => {
  const value = fixture(t);
  const { lockPath } = writeLifecycleLock(value, { ageMs: 30_001 });
  chmodSync(lockPath, 0o755);

  assert.throws(
    () =>
      executeCommand(
        {
          action: "accept-host",
          actor: "all",
          stateRoot: value.stateRoot,
        },
        value.dependencies,
      ),
    (error) =>
      error instanceof AutomationActorsError &&
      error.code === "invalid_lifecycle_lock",
  );
  assert.equal(existsSync(lockPath), true);
});

test("a verified dead lifecycle owner is recovered immediately", (t) => {
  for (const ageMs of [1, 30_001]) {
    const value = fixture(t);
    for (const actor of AUTOMATION_ACTOR_IDS) {
      writeAcquisitionBinding(value, actor);
    }
    writeLifecycleLock(value, {
      owner: lifecycleOwnerRecord(value, {
        acquiredAtMs: value.dependencies.nowMs() - ageMs,
      }),
      ageMs,
    });

    const result = executeCommand(
      {
        action: "accept-host",
        actor: "all",
        stateRoot: value.stateRoot,
      },
      value.dependencies,
    );
    assert.equal(result.accepted, true, ageMs.toLocaleString());
    assert.equal(existsSync(lifecycleLockPath(value)), false);
  }
});

test("a verified live owner blocks provision, revoke, and accept-host regardless of age", (t) => {
  const value = fixture(t);
  value.processIdentities.set(9001, "other-process-start");
  writeLifecycleLock(value, {
    owner: lifecycleOwnerRecord(value, {
      acquiredAtMs: value.dependencies.nowMs() - 120_000,
    }),
    ageMs: 120_000,
  });

  for (const command of [
    { action: "provision", actor: "freed-runtime-observer" },
    { action: "revoke", actor: "freed-runtime-observer" },
    { action: "accept-host", actor: "all" },
  ]) {
    assert.throws(
      () =>
        executeCommand(
          { ...command, stateRoot: value.stateRoot },
          value.dependencies,
        ),
      (error) =>
        error instanceof AutomationActorsError &&
        error.code === "lifecycle_busy",
      command.action,
    );
  }
  assert.equal(existsSync(lifecycleLockPath(value)), true);
});

test("provision all installs one content-addressed runtime and all public bindings", (t) => {
  const value = fixture(t);
  const staleActorRecords = AUTOMATION_ACTOR_IDS.map((actor) =>
    writeStaleActorRecord(value, actor),
  );
  const publisherRecordPath = path.join(
    value.stateRoot,
    "control",
    "actor-credentials",
    "freed-pr-publisher.json",
  );
  const publisherRecord = '{"reserved":"publisher-record"}\n';
  writeFileSync(publisherRecordPath, publisherRecord, { mode: 0o600 });
  chmodSync(publisherRecordPath, 0o600);
  const result = executeCommand(
    {
      action: "provision",
      actor: "all",
      stateRoot: value.stateRoot,
    },
    value.dependencies,
  );

  assert.equal(result.action, "provision");
  assert.equal(result.records.length, 5);
  assert.deepEqual(
    result.records.map((record) => record.actor),
    AUTOMATION_ACTOR_IDS,
  );
  assert.equal(
    result.records.every((record) => record.staleActorRecordRemoved),
    true,
  );
  assert.equal(
    result.records.every((record) => record.accepted),
    true,
  );
  assert.match(result.runtimeDigest, /^[0-9a-f]{64}$/);

  const runtimeDirectory = path.join(value.runtimeRoot, result.runtimeDigest);
  const runtimePaths = [
    path.join(runtimeDirectory, "node"),
    path.join(runtimeDirectory, "automation-control.mjs"),
    path.join(runtimeDirectory, "automation-actor-control.mjs"),
    path.join(runtimeDirectory, "lib", "automation-control.mjs"),
    path.join(runtimeDirectory, "lib", "automation-kernel-guard-contract.mjs"),
    path.join(runtimeDirectory, "lib", "outcome-ledger-repair-contract.mjs"),
    path.join(runtimeDirectory, "lib", "lease-archive-move.py"),
  ];
  for (const runtimePath of runtimePaths) {
    assert.equal(existsSync(runtimePath), true, runtimePath);
  }
  assert.deepEqual(readdirSync(runtimeDirectory).sort(), [
    "automation-control.mjs",
    "lib",
    "node",
  ]);
  assert.deepEqual(
    readdirSync(path.join(runtimeDirectory, "lib")).sort(),
    [
      "automation-control.mjs",
      "automation-kernel-guard-contract.mjs",
      "lease-archive-move.py",
      "outcome-ledger-repair-contract.mjs",
    ].sort(),
  );

  for (const actor of AUTOMATION_ACTOR_IDS) {
    const bindingPath = path.join(value.launcherRoot, `${actor}.json`);
    const binding = JSON.parse(readFileSync(bindingPath, "utf8"));
    assert.equal(binding.actor, actor);
    assert.equal(binding.schemaVersion, 2);
    assert.equal(binding.leaseName, AUTOMATION_ACTORS[actor].leaseName);
    assert.equal(binding.maxLeaseLifetimeMs, 30 * 60_000);
    assert.equal(binding.nodePath, runtimePaths[0]);
    assert.equal(binding.controlEntryPath, runtimePaths[1]);
    assert.equal(binding.controlLibraryPath, runtimePaths[2]);
    assert.equal(binding.kernelGuardContractPath, runtimePaths[3]);
    assert.equal(binding.outcomeLedgerRepairContractPath, runtimePaths[4]);
    assert.equal(binding.leaseArchiveHelperPath, runtimePaths[5]);
    assert.equal(existsSync(binding.launcherPath), true);
    assert.equal(
      path.basename(binding.launcherPath),
      `${actor}-${binding.launcherSha256}`,
    );
  }
  for (const recordPath of staleActorRecords) {
    assert.equal(existsSync(recordPath), false);
  }
  assert.equal(readFileSync(publisherRecordPath, "utf8"), publisherRecord);
  assert.equal(lstatMode(publisherRecordPath), 0o600);

  const buildCalls = value.calls.filter(
    (call) =>
      call.executable === "/bin/bash" && call.args[0] === value.hostBuildPath,
  );
  assert.equal(buildCalls.length, 1);
  assert.deepEqual(
    buildCalls[0].args.filter((arg) => arg.startsWith("--")),
    ["--host-output"],
  );
  assert.equal(
    value.calls.some((call) =>
      call.args.some(
        (arg) => arg === "freed-owner" || arg === "freed-pr-publisher",
      ),
    ),
    false,
  );
  for (const call of value.calls) {
    assert.equal(
      Object.hasOwn(call.options.env, "FREED_OWNER_LEASE_TOKEN"),
      false,
    );
    assert.equal(Object.hasOwn(call.options.env, "TMPDIR"), false);
    assert.equal(Object.hasOwn(call.options.env, "DEVELOPER_DIR"), false);
    assert.equal(call.options.env.LANG, "C");
    assert.equal(call.options.env.LC_ALL, "C");
  }
  assert.equal(
    value.calls.some(
      (call) =>
        call.executable === "/usr/bin/security" ||
        String(call.executable).includes("automation-actor-provisioner") ||
        call.args.some((argument) =>
          String(argument).includes("automation-actor-provisioner"),
        ),
    ),
    false,
  );
});

test("provisioned runtime resolves the automation control local import closure", (t) => {
  const value = fixture(t);
  for (const relativePath of [
    "automation-control.mjs",
    "lib/automation-control.mjs",
    "lib/automation-kernel-guard-contract.mjs",
    "lib/outcome-ledger-repair-contract.mjs",
    "lib/lease-archive-move.py",
  ]) {
    copyFileSync(
      path.join(sourceScriptsRoot, relativePath),
      path.join(value.repoRoot, "scripts", relativePath),
    );
  }
  value.dependencies.pinnedNodeResolver = () => process.execPath;

  executeCommand(
    {
      action: "provision",
      actor: "freed-runtime-observer",
      stateRoot: value.stateRoot,
    },
    value.dependencies,
  );

  const binding = JSON.parse(
    readFileSync(
      path.join(value.launcherRoot, "freed-runtime-observer.json"),
      "utf8",
    ),
  );
  rmSync(path.join(value.repoRoot, "scripts"), {
    recursive: true,
    force: true,
  });
  assert.equal(existsSync(path.join(value.repoRoot, "scripts")), false);
  const launched = spawnSync(
    binding.nodePath,
    [binding.controlEntryPath, "--help"],
    {
      cwd: "/",
      encoding: "utf8",
      env: { PATH: "/usr/bin:/bin", LANG: "C", LC_ALL: "C" },
      timeout: 15_000,
      killSignal: "SIGKILL",
    },
  );
  assert.equal(launched.status, 0, launched.stderr);
  assert.match(launched.stdout, /^Usage:/);
});

test("provision all rolls back only actors completed by the current batch", (t) => {
  const value = fixture(t);
  const actor = "freed-runtime-observer";
  const staleRecordPath = writeStaleActorRecord(value, actor);
  const proofSteps = [];
  const baseAttestor = value.dependencies.launcherAttestor;
  value.dependencies.launcherAttestor = (request, options) => {
    assert.equal(existsSync(staleRecordPath), true);
    proofSteps.push("attest");
    return baseAttestor(request, options);
  };
  const baseRunner = value.dependencies.runner;
  value.dependencies.runner = (executable, args, options) => {
    if (args[0] === "--acquire-lease") {
      assert.equal(existsSync(staleRecordPath), true);
      proofSteps.push("acquire");
    }
    if (args[1] === "lease" && ["heartbeat", "release"].includes(args[2])) {
      assert.equal(existsSync(staleRecordPath), true);
      proofSteps.push(args[2]);
    }
    return baseRunner(executable, args, options);
  };

  const result = executeCommand(
    { action: "provision", actor, stateRoot: value.stateRoot },
    value.dependencies,
  );

  assert.deepEqual(proofSteps, ["attest", "acquire", "heartbeat", "release"]);
  assert.equal(result.records[0].accepted, true);
  assert.equal(result.records[0].staleActorRecordRemoved, true);
  assert.equal(existsSync(staleRecordPath), false);
});

test("failed replacement acceptance restores every prior binding and obsolete record", (t) => {
  const value = fixture(t);
  const priorBindings = new Map();
  const priorStaleRecords = new Map();
  for (const actor of AUTOMATION_ACTOR_IDS) {
    writeAcquisitionBinding(value, actor);
    const bindingPath = path.join(value.launcherRoot, `${actor}.json`);
    priorBindings.set(bindingPath, readFileSync(bindingPath, "utf8"));
    const staleRecordPath = writeStaleActorRecord(value, actor);
    priorStaleRecords.set(
      staleRecordPath,
      readFileSync(staleRecordPath, "utf8"),
    );
  }
  const failedActor = AUTOMATION_ACTOR_IDS[1];
  const failedLease = AUTOMATION_ACTORS[failedActor].leaseName;
  const baseRunner = value.dependencies.runner;
  value.dependencies.runner = (executable, args, options) => {
    const result = baseRunner(executable, args, options);
    return args[1] === "lease" &&
      args[2] === "heartbeat" &&
      args[args.indexOf("--name") + 1] === failedLease
      ? { ...result, status: 1 }
      : result;
  };

  assert.throws(
    () =>
      executeCommand(
        { action: "provision", actor: "all", stateRoot: value.stateRoot },
        value.dependencies,
      ),
    (error) =>
      error instanceof AutomationActorsError && error.code === "command_failed",
  );

  for (const [bindingPath, contents] of priorBindings) {
    assert.equal(readFileSync(bindingPath, "utf8"), contents);
  }
  for (const [recordPath, contents] of priorStaleRecords) {
    assert.equal(readFileSync(recordPath, "utf8"), contents);
  }
  assert.deepEqual(
    value.calls
      .filter((call) => call.args[0] === "--acquire-lease")
      .map((call) => call.args[call.args.indexOf("--actor") + 1]),
    AUTOMATION_ACTOR_IDS.slice(0, 2),
  );
  assert.equal(value.liveLeases.size, 0);
  assert.equal(existsSync(lifecycleLockPath(value)), false);
});

test("provision all restores prior bindings after a partial install failure", (t) => {
  const value = fixture(t);
  const failingActor = AUTOMATION_ACTOR_IDS[2];
  const priorBindings = new Map();
  mkdirSync(value.launcherRoot, { recursive: true });
  for (const actor of AUTOMATION_ACTOR_IDS.slice(0, 2)) {
    const contents = `${JSON.stringify({
      schemaVersion: 1,
      actor,
      legacy: true,
    })}\n`;
    const bindingPath = path.join(value.launcherRoot, `${actor}.json`);
    writeFileSync(bindingPath, contents, { mode: 0o444 });
    priorBindings.set(actor, contents);
  }
  const publisherRecordPath = path.join(
    value.stateRoot,
    "control",
    "actor-credentials",
    "freed-pr-publisher.json",
  );
  mkdirSync(path.dirname(publisherRecordPath), {
    recursive: true,
    mode: 0o700,
  });
  const publisherRecord = '{"reserved":"publisher-record"}\n';
  writeFileSync(publisherRecordPath, publisherRecord, { mode: 0o600 });
  chmodSync(publisherRecordPath, 0o600);
  const baseRunner = value.dependencies.runner;
  value.dependencies.runner = (executable, args, options) => {
    const result = baseRunner(executable, args, options);
    return executable === "/usr/bin/sudo" &&
      args[0] === "/usr/bin/install" &&
      args.at(-1) === path.join(value.launcherRoot, `${failingActor}.json`)
      ? { ...result, status: 1 }
      : result;
  };

  assert.throws(
    () =>
      executeCommand(
        { action: "provision", actor: "all", stateRoot: value.stateRoot },
        value.dependencies,
      ),
    (error) =>
      error instanceof AutomationActorsError && error.code === "command_failed",
  );

  for (const [actor, contents] of priorBindings) {
    assert.equal(
      readFileSync(path.join(value.launcherRoot, `${actor}.json`), "utf8"),
      contents,
    );
  }
  assert.equal(
    existsSync(path.join(value.launcherRoot, `${failingActor}.json`)),
    false,
  );
  assert.equal(readFileSync(publisherRecordPath, "utf8"), publisherRecord);
  assert.equal(lstatMode(publisherRecordPath), 0o600);
});

test("provision all reports an explicit rollback failure", (t) => {
  const value = fixture(t);
  const failingActor = AUTOMATION_ACTOR_IDS[2];
  const rollbackFailureActor = AUTOMATION_ACTOR_IDS[1];
  mkdirSync(value.launcherRoot, { recursive: true });
  for (const actor of AUTOMATION_ACTOR_IDS.slice(0, 2)) {
    writeFileSync(
      path.join(value.launcherRoot, `${actor}.json`),
      `${JSON.stringify({ schemaVersion: 1, actor, legacy: true })}\n`,
      { mode: 0o444 },
    );
  }
  const baseRunner = value.dependencies.runner;
  let failingInstallSeen = false;
  value.dependencies.runner = (executable, args, options) => {
    const result = baseRunner(executable, args, options);
    const destination = args.at(-1);
    if (
      executable === "/usr/bin/sudo" &&
      args[0] === "/usr/bin/install" &&
      destination === path.join(value.launcherRoot, `${failingActor}.json`)
    ) {
      failingInstallSeen = true;
      return { ...result, status: 1 };
    }
    if (
      failingInstallSeen &&
      executable === "/usr/bin/sudo" &&
      args[0] === "/usr/bin/install" &&
      destination ===
        path.join(value.launcherRoot, `${rollbackFailureActor}.json`)
    ) {
      return { ...result, status: 1 };
    }
    return result;
  };

  assert.throws(
    () =>
      executeCommand(
        { action: "provision", actor: "all", stateRoot: value.stateRoot },
        value.dependencies,
      ),
    (error) =>
      error instanceof AutomationActorsError &&
      error.code === "provision_rollback_failed" &&
      error.message.includes(rollbackFailureActor),
  );
  assert.equal(failingInstallSeen, true);
});

test("rotate is removed and revoke removes only the exact validated binding", (t) => {
  assert.throws(
    () => parseCommand(["rotate", "--actor", "freed-runtime-observer"]),
    (error) =>
      error instanceof AutomationActorsError && error.code === "invalid_action",
  );

  const value = fixture(t);
  const actor = "freed-stability-controller";
  const binding = writeAcquisitionBinding(value, actor);
  const staleActorRecordPath = writeStaleActorRecord(value, actor);
  const publisherRecordPath = path.join(
    value.stateRoot,
    "control",
    "actor-credentials",
    "freed-pr-publisher.json",
  );
  mkdirSync(path.dirname(publisherRecordPath), {
    recursive: true,
    mode: 0o700,
  });
  const publisherRecord = '{"reserved":"publisher-record"}\n';
  writeFileSync(publisherRecordPath, publisherRecord, { mode: 0o600 });
  chmodSync(publisherRecordPath, 0o600);

  const result = executeCommand(
    { action: "revoke", actor, stateRoot: value.stateRoot },
    value.dependencies,
  );
  assert.deepEqual(result, {
    action: "revoke",
    actor,
    stateRoot: value.stateRoot,
    bindingPath: path.join(value.launcherRoot, `${actor}.json`),
    staleActorRecordRemoved: true,
  });
  assert.equal(
    existsSync(path.join(value.launcherRoot, `${actor}.json`)),
    false,
  );
  assert.equal(existsSync(staleActorRecordPath), false);
  assert.equal(existsSync(binding.launcherPath), true);
  assert.equal(readFileSync(publisherRecordPath, "utf8"), publisherRecord);
  assert.equal(lstatMode(publisherRecordPath), 0o600);
  assert.equal(
    value.calls.some(
      (call) =>
        call.executable === "/bin/bash" ||
        call.args[0] === "--attest-readiness" ||
        call.args[0] === "--acquire-lease",
    ),
    false,
  );
});

test("revoke restores the binding and obsolete record when removal changes state before failing", (t) => {
  const value = fixture(t);
  const actor = "freed-stability-controller";
  writeAcquisitionBinding(value, actor);
  const bindingPath = path.join(value.launcherRoot, `${actor}.json`);
  const bindingContents = readFileSync(bindingPath, "utf8");
  const staleRecordPath = writeStaleActorRecord(value, actor);
  const staleRecordContents = readFileSync(staleRecordPath, "utf8");
  const baseRunner = value.dependencies.runner;
  value.dependencies.runner = (executable, args, options) => {
    const result = baseRunner(executable, args, options);
    return executable === "/usr/bin/sudo" &&
      args[0] === "/bin/rm" &&
      args.at(-1) === bindingPath
      ? { ...result, status: 1 }
      : result;
  };

  assert.throws(
    () =>
      executeCommand(
        { action: "revoke", actor, stateRoot: value.stateRoot },
        value.dependencies,
      ),
    (error) =>
      error instanceof AutomationActorsError && error.code === "command_failed",
  );

  assert.equal(readFileSync(bindingPath, "utf8"), bindingContents);
  assert.equal(readFileSync(staleRecordPath, "utf8"), staleRecordContents);
  assert.equal(existsSync(lifecycleLockPath(value)), false);
});

test("verify all attests through exact installed launchers without build or sudo", (t) => {
  const value = fixture(t);
  for (const actor of AUTOMATION_ACTOR_IDS) {
    writeAcquisitionBinding(value, actor);
  }
  const result = executeCommand(
    { action: "verify", actor: "all", stateRoot: value.stateRoot },
    value.dependencies,
  );
  assert.equal(result.records.length, 5);
  assert.deepEqual(
    result.records.map((record) => record.actor),
    AUTOMATION_ACTOR_IDS,
  );
  assert.deepEqual(
    value.calls
      .filter((call) => call.args[0] === "--attest-readiness")
      .map((call) => call.args[call.args.indexOf("--actor") + 1]),
    AUTOMATION_ACTOR_IDS,
  );
  assert.equal(
    value.calls.some(
      (call) =>
        call.executable === "/bin/bash" ||
        call.executable === "/usr/bin/sudo" ||
        ["provision", "revoke", "verify"].includes(call.args[0]),
    ),
    false,
  );
  for (const call of value.calls.filter(
    (candidate) => candidate.args[0] === "--attest-readiness",
  )) {
    assert.equal(call.options.timeoutMs, 15_000);
    assert.equal(call.options.killSignal, "SIGKILL");
    assert.equal(call.options.stdin, "ignore");
  }
});

test("verify and acquire reject an exact-digest legacy protocol before launcher invocation", (t) => {
  for (const action of ["verify", "acquire"]) {
    const value = fixture(t);
    const actor = "freed-release-verifier";
    const binding = writeAcquisitionBinding(value, actor);
    assert.equal(sha256(binding.launcherPath), binding.launcherSha256);
    const bindingPath = path.join(value.launcherRoot, `${actor}.json`);
    writeFileSync(
      bindingPath,
      `${JSON.stringify({
        ...binding,
        attestationProtocol: "freed-actor-launcher-readiness-v1",
      })}\n`,
    );
    let attestationCalls = 0;
    value.dependencies.launcherAttestor = () => {
      attestationCalls += 1;
      throw new Error("legacy bindings must fail before launcher attestation");
    };

    assert.throws(
      () =>
        executeCommand(
          { action, actor, stateRoot: value.stateRoot },
          value.dependencies,
        ),
      (error) =>
        error instanceof AutomationActorsError &&
        error.code ===
          (action === "verify" ? "actor_not_ready" : "invalid_binding") &&
        error.message.includes("handoff contract is invalid"),
      action,
    );
    assert.equal(attestationCalls, 0);
    assert.equal(
      value.calls.some(
        (call) =>
          call.args[0] === "--attest-readiness" ||
          call.args[0] === "--acquire-lease",
      ),
      false,
    );
  }
});

test("verify fails closed on attestation timeout and malformed attestation", (t) => {
  for (const scenario of ["timeout", "malformed"]) {
    const value = fixture(t);
    const actor = "freed-runtime-observer";
    writeAcquisitionBinding(value, actor);
    value.dependencies.launcherAttestor =
      scenario === "timeout"
        ? (_request, { timeoutMs }) => ({
            ready: false,
            reason: `trusted launcher readiness attestation exceeded ${timeoutMs.toLocaleString()} ms`,
          })
        : (request) => ({
            ready: true,
            reason: "",
            attestation: {
              schemaVersion: 1,
              protocol: "freed-actor-launcher-readiness-v3",
              purpose: "automation-actor-launcher-readiness",
              actor: request.actor,
            },
          });

    assert.throws(
      () =>
        executeCommand(
          { action: "verify", actor, stateRoot: value.stateRoot },
          value.dependencies,
        ),
      (error) =>
        error instanceof AutomationActorsError &&
        error.code === "actor_not_ready" &&
        (scenario === "timeout"
          ? error.message.includes("15,000")
          : error.message.includes("does not match")),
      scenario,
    );
  }
});

test("provision creates a missing private state root only after checkout safety passes", (t) => {
  const value = fixture(t);
  rmSync(value.stateRoot, { recursive: true, force: true });
  executeCommand(
    {
      action: "provision",
      actor: "freed-runtime-observer",
      stateRoot: value.stateRoot,
    },
    value.dependencies,
  );
  assert.equal(existsSync(value.stateRoot), true);
  assert.equal(lstatMode(value.stateRoot), 0o700);

  const unsafe = fixture(t);
  rmSync(unsafe.stateRoot, { recursive: true, force: true });
  unsafe.dependencies.repositoryInspector = () => ({
    topLevel: unsafe.repoRoot,
    branch: "feature",
    head: "a".repeat(40),
    originDev: "a".repeat(40),
    status: "",
  });
  assert.throws(
    () =>
      executeCommand(
        {
          action: "provision",
          actor: "freed-runtime-observer",
          stateRoot: unsafe.stateRoot,
        },
        unsafe.dependencies,
      ),
    (error) =>
      error instanceof AutomationActorsError &&
      error.code === "unsafe_checkout",
  );
  assert.equal(existsSync(unsafe.stateRoot), false);
});

test("state roots reject symlinks, permissive modes, and the wrong owner", (t) => {
  const symlinked = fixture(t);
  const realStateRoot = path.join(symlinked.root, "real-state-root");
  mkdirSync(realStateRoot, { mode: 0o700 });
  rmSync(symlinked.stateRoot, { recursive: true, force: true });
  symlinkSync(realStateRoot, symlinked.stateRoot);
  assert.throws(
    () =>
      executeCommand(
        {
          action: "verify",
          actor: "freed-runtime-observer",
          stateRoot: symlinked.stateRoot,
        },
        symlinked.dependencies,
      ),
    (error) =>
      error instanceof AutomationActorsError &&
      error.code === "invalid_state_root",
  );

  const permissive = fixture(t);
  chmodSync(permissive.stateRoot, 0o755);
  assert.throws(
    () =>
      executeCommand(
        {
          action: "verify",
          actor: "freed-runtime-observer",
          stateRoot: permissive.stateRoot,
        },
        permissive.dependencies,
      ),
    (error) =>
      error instanceof AutomationActorsError &&
      error.code === "invalid_state_root",
  );

  const wrongOwner = fixture(t);
  wrongOwner.dependencies.uid += 1;
  assert.throws(
    () =>
      executeCommand(
        {
          action: "verify",
          actor: "freed-runtime-observer",
          stateRoot: wrongOwner.stateRoot,
        },
        wrongOwner.dependencies,
      ),
    (error) =>
      error instanceof AutomationActorsError &&
      error.code === "invalid_state_root",
  );
});

test("installed revocation does not inspect or depend on the source checkout", (t) => {
  const value = fixture(t);
  const actor = "freed-runtime-observer";
  writeAcquisitionBinding(value, actor);
  value.dependencies.repositoryInspector = () => {
    throw new Error("revoke must not inspect Git");
  };

  const result = executeCommand(
    { action: "revoke", actor, stateRoot: value.stateRoot },
    value.dependencies,
  );
  assert.equal(result.actor, actor);
  assert.equal(
    existsSync(path.join(value.launcherRoot, `${actor}.json`)),
    false,
  );
});

test("installed verification does not inspect or depend on the source checkout", (t) => {
  const value = fixture(t);
  const actor = "freed-runtime-observer";
  writeAcquisitionBinding(value, actor);
  value.dependencies.repositoryInspector = () => {
    throw new Error("verify must not inspect Git");
  };

  const result = executeCommand(
    { action: "verify", actor, stateRoot: value.stateRoot },
    value.dependencies,
  );
  assert.equal(result.records[0].actor, actor);
  assert.equal(result.records[0].attested, true);
});

test("provision resolves and verifies the exact Node version pinned by the repo", (t) => {
  const value = fixture(t);
  delete value.dependencies.pinnedNodeResolver;
  executeCommand(
    {
      action: "provision",
      actor: "freed-runtime-observer",
      stateRoot: value.stateRoot,
    },
    value.dependencies,
  );
  assert.equal(
    value.calls.some(
      (call) =>
        call.executable === value.pinnedNodePath &&
        call.args.length === 1 &&
        call.args[0] === "--version",
    ),
    true,
  );
});

function writeAcquisitionBinding(value, actor) {
  const sourcePins = {
    nodeSha256: sha256(value.pinnedNodePath),
    controlEntrySha256: sha256(
      path.join(value.repoRoot, "scripts", "automation-control.mjs"),
    ),
    actorControlEntrySha256: sha256(
      path.join(value.repoRoot, "scripts", "automation-actor-control.mjs"),
    ),
    controlLibrarySha256: sha256(
      path.join(value.repoRoot, "scripts", "lib", "automation-control.mjs"),
    ),
    kernelGuardContractSha256: sha256(
      path.join(
        value.repoRoot,
        "scripts",
        "lib",
        "automation-kernel-guard-contract.mjs",
      ),
    ),
    outcomeLedgerRepairContractSha256: sha256(
      path.join(
        value.repoRoot,
        "scripts",
        "lib",
        "outcome-ledger-repair-contract.mjs",
      ),
    ),
    leaseArchiveHelperSha256: sha256(
      path.join(value.repoRoot, "scripts", "lib", "lease-archive-move.py"),
    ),
  };
  const digest = runtimeDigestForPins(sourcePins);
  const runtimeDirectory = path.join(value.runtimeRoot, digest);
  const runtime = {
    digest,
    nodePath: path.join(runtimeDirectory, "node"),
    controlEntryPath: path.join(runtimeDirectory, "automation-control.mjs"),
    actorControlEntryPath: path.join(
      runtimeDirectory,
      "automation-actor-control.mjs",
    ),
    controlLibraryPath: path.join(
      runtimeDirectory,
      "lib",
      "automation-control.mjs",
    ),
    kernelGuardContractPath: path.join(
      runtimeDirectory,
      "lib",
      "automation-kernel-guard-contract.mjs",
    ),
    outcomeLedgerRepairContractPath: path.join(
      runtimeDirectory,
      "lib",
      "outcome-ledger-repair-contract.mjs",
    ),
    leaseArchiveHelperPath: path.join(
      runtimeDirectory,
      "lib",
      "lease-archive-move.py",
    ),
    ...sourcePins,
  };
  mkdirSync(path.dirname(runtime.controlLibraryPath), { recursive: true });
  copyFileSync(value.pinnedNodePath, runtime.nodePath);
  copyFileSync(
    path.join(value.repoRoot, "scripts", "automation-control.mjs"),
    runtime.controlEntryPath,
  );
  copyFileSync(
    path.join(value.repoRoot, "scripts", "automation-actor-control.mjs"),
    runtime.actorControlEntryPath,
  );
  copyFileSync(
    path.join(value.repoRoot, "scripts", "lib", "automation-control.mjs"),
    runtime.controlLibraryPath,
  );
  copyFileSync(
    path.join(
      value.repoRoot,
      "scripts",
      "lib",
      "automation-kernel-guard-contract.mjs",
    ),
    runtime.kernelGuardContractPath,
  );
  copyFileSync(
    path.join(
      value.repoRoot,
      "scripts",
      "lib",
      "outcome-ledger-repair-contract.mjs",
    ),
    runtime.outcomeLedgerRepairContractPath,
  );
  copyFileSync(
    path.join(value.repoRoot, "scripts", "lib", "lease-archive-move.py"),
    runtime.leaseArchiveHelperPath,
  );
  const launcherContents = "actor launcher fixture\n";
  const launcherSha256 = createHash("sha256")
    .update(launcherContents)
    .digest("hex");
  const launcherPath = path.join(
    value.launcherRoot,
    "bin",
    `${actor}-${launcherSha256}`,
  );
  writeExecutable(launcherPath, launcherContents);
  const binding = bindingForActor({
    actor,
    stateRoot: value.stateRoot,
    launcherRoot: value.launcherRoot,
    runtime,
    launcherSha256,
  });
  mkdirSync(value.launcherRoot, { recursive: true });
  writeFileSync(
    path.join(value.launcherRoot, `${actor}.json`),
    `${JSON.stringify(binding)}\n`,
  );
  return binding;
}

function writeActorCredential(value, actor, tokenSha256 = "a".repeat(64)) {
  const credentialDirectory = path.join(
    value.stateRoot,
    "control",
    "actor-credentials",
  );
  mkdirSync(recordDirectory, { recursive: true, mode: 0o700 });
  const recordPath = path.join(recordDirectory, `${actor}.json`);
  writeFileSync(
    recordPath,
    `${JSON.stringify({
      schemaVersion: 1,
      actor,
      obsolete: true,
    })}\n`,
    { mode: 0o600 },
  );
  chmodSync(recordPath, 0o600);
  return recordPath;
}

function replaceActorRuntime(value, actor) {
  const bindingPath = path.join(value.launcherRoot, `${actor}.json`);
  const installedBinding = JSON.parse(readFileSync(bindingPath, "utf8"));
  const controlLibraryContents =
    "export const library = 'different runtime fixture';\n";
  const runtimePins = {
    nodeSha256: sha256(installedBinding.nodePath),
    controlEntrySha256: sha256(installedBinding.controlEntryPath),
    actorControlEntrySha256: sha256(installedBinding.actorControlEntryPath),
    controlLibrarySha256: createHash("sha256")
      .update(controlLibraryContents)
      .digest("hex"),
    kernelGuardContractSha256: installedBinding.kernelGuardContractSha256,
    outcomeLedgerRepairContractSha256:
      installedBinding.outcomeLedgerRepairContractSha256,
    leaseArchiveHelperSha256: installedBinding.leaseArchiveHelperSha256,
  };
  const digest = runtimeDigestForPins(runtimePins);
  const runtimeDirectory = path.join(value.runtimeRoot, digest);
  const runtime = {
    digest,
    nodePath: path.join(runtimeDirectory, "node"),
    controlEntryPath: path.join(runtimeDirectory, "automation-control.mjs"),
    actorControlEntryPath: path.join(
      runtimeDirectory,
      "automation-actor-control.mjs",
    ),
    controlLibraryPath: path.join(
      runtimeDirectory,
      "lib",
      "automation-control.mjs",
    ),
    kernelGuardContractPath: path.join(
      runtimeDirectory,
      "lib",
      "automation-kernel-guard-contract.mjs",
    ),
    outcomeLedgerRepairContractPath: path.join(
      runtimeDirectory,
      "lib",
      "outcome-ledger-repair-contract.mjs",
    ),
    leaseArchiveHelperPath: path.join(
      runtimeDirectory,
      "lib",
      "lease-archive-move.py",
    ),
    ...runtimePins,
  };
  mkdirSync(path.dirname(runtime.controlLibraryPath), { recursive: true });
  copyFileSync(installedBinding.nodePath, runtime.nodePath);
  copyFileSync(installedBinding.controlEntryPath, runtime.controlEntryPath);
  copyFileSync(
    installedBinding.actorControlEntryPath,
    runtime.actorControlEntryPath,
  );
  writeFileSync(runtime.controlLibraryPath, controlLibraryContents, {
    mode: 0o600,
  });
  copyFileSync(
    installedBinding.kernelGuardContractPath,
    runtime.kernelGuardContractPath,
  );
  copyFileSync(
    installedBinding.outcomeLedgerRepairContractPath,
    runtime.outcomeLedgerRepairContractPath,
  );
  copyFileSync(
    installedBinding.leaseArchiveHelperPath,
    runtime.leaseArchiveHelperPath,
  );
  const replacementBinding = bindingForActor({
    actor,
    stateRoot: value.stateRoot,
    launcherRoot: value.launcherRoot,
    runtime,
    launcherSha256: installedBinding.launcherSha256,
  });
  writeFileSync(bindingPath, `${JSON.stringify(replacementBinding)}\n`);
  return replacementBinding;
}

test("acquire validates the public binding and invokes its exact launcher", (t) => {
  const value = fixture(t);
  const actor = "freed-nightly-runner";
  const binding = writeAcquisitionBinding(value, actor);

  const result = executeCommand(
    { action: "acquire", actor, stateRoot: value.stateRoot },
    value.dependencies,
  );
  assert.deepEqual(result, {
    schemaVersion: 1,
    actor,
    leaseName: "nightly-writer",
    leaseOperationId: testLeaseOperationId,
    leaseToken: testLeaseToken,
    leaseTokenSha256: testLeaseTokenSha256,
    acquiredAt: "2026-07-13T12:00:00.000Z",
    expiresAt: "2026-07-13T12:30:00.000Z",
    ttlMs: 1_800_000,
  });
  const launcherCall = value.calls.find(
    (call) => call.executable === binding.launcherPath,
  );
  assert.deepEqual(launcherCall.args, [
    "--acquire-lease",
    "--actor",
    actor,
    "--state-root",
    value.stateRoot,
    "--lease-name",
    "nightly-writer",
    "--ttl-seconds",
    "1800",
  ]);
  assert.equal(launcherCall.options.timeoutMs, 75_000);
  assert.equal(launcherCall.options.killSignal, "SIGKILL");
  assert.equal(launcherCall.options.stdin, "ignore");
});

test("acquire fails closed when the installed launcher exceeds its outer bound", (t) => {
  const value = fixture(t);
  const actor = "freed-nightly-runner";
  const binding = writeAcquisitionBinding(value, actor);
  const originalRunner = value.dependencies.runner;
  value.dependencies.runner = (executable, args, options) =>
    executable === binding.launcherPath && args[0] === "--acquire-lease"
      ? {
          status: null,
          stdout: "",
          stderr: "",
          error: Object.assign(new Error("timed out"), { code: "ETIMEDOUT" }),
        }
      : originalRunner(executable, args, options);

  assert.throws(
    () =>
      executeCommand(
        { action: "acquire", actor, stateRoot: value.stateRoot },
        value.dependencies,
      ),
    (error) =>
      error instanceof AutomationActorsError &&
      error.code === "command_timeout" &&
      error.message.includes("75,000"),
  );
});

test("acquire cleans a bounded handoff returned with SIGINT or SIGTERM status", (t) => {
  for (const status of [130, 143]) {
    const value = fixture(t);
    const actor = "freed-nightly-runner";
    const binding = writeAcquisitionBinding(value, actor);
    const originalRunner = value.dependencies.runner;
    value.dependencies.runner = (executable, args, options) => {
      const result = originalRunner(executable, args, options);
      if (
        executable === binding.launcherPath &&
        args[0] === "--acquire-lease"
      ) {
        return { ...result, status };
      }
      return result;
    };

    assert.throws(
      () =>
        executeCommand(
          { action: "acquire", actor, stateRoot: value.stateRoot },
          value.dependencies,
        ),
      (error) =>
        error instanceof AutomationActorsError &&
        error.code === "command_failed" &&
        error.message.includes(status.toLocaleString()),
    );
    assert.equal(value.liveLeases.size, 0);
    assert.deepEqual(
      value.calls
        .filter((call) => call.args[1] === "lease")
        .map((call) => call.args[2]),
      ["release", "show"],
    );
  }
});

test("acquire rejects malformed, unbounded, and actor-mismatched launcher handoffs", (t) => {
  const cases = [
    {
      name: "extra field",
      mutate(result) {
        result.extra = true;
      },
    },
    {
      name: "missing field",
      mutate(result) {
        delete result.leaseToken;
      },
    },
    {
      name: "wrong actor",
      mutate(result) {
        result.actor = "freed-release-verifier";
      },
    },
    {
      name: "wrong lease token digest",
      mutate(result) {
        result.leaseTokenSha256 = "0".repeat(64);
      },
    },
    {
      name: "invalid lease operation identity",
      mutate(result) {
        result.leaseOperationId = "predictable";
      },
    },
    {
      name: "short lease token",
      mutate(result) {
        result.leaseToken = "too-short";
      },
    },
    {
      name: "oversized lease token",
      mutate(result) {
        result.leaseToken = "x".repeat(4 * 1_024 + 1);
      },
    },
    {
      name: "overlong timestamps",
      mutate(result) {
        result.expiresAt = "2026-07-13T12:30:00.001Z";
      },
    },
    {
      name: "backwards timestamps",
      mutate(result) {
        result.expiresAt = "2026-07-13T11:59:59.999Z";
      },
    },
  ];
  for (const scenario of cases) {
    const value = fixture(t);
    const actor = "freed-nightly-runner";
    const binding = writeAcquisitionBinding(value, actor);
    const originalRunner = value.dependencies.runner;
    value.dependencies.runner = (executable, args, options) => {
      if (executable !== binding.launcherPath) {
        return originalRunner(executable, args, options);
      }
      const handoff = {
        schemaVersion: 1,
        actor,
        leaseName: "nightly-writer",
        leaseOperationId: testLeaseOperationId,
        leaseToken: testLeaseToken,
        leaseTokenSha256: testLeaseTokenSha256,
        acquiredAt: "2026-07-13T12:00:00.000Z",
        expiresAt: "2026-07-13T12:30:00.000Z",
        ttlMs: 1_800_000,
      };
      scenario.mutate(handoff);
      return {
        status: 0,
        stdout: `${JSON.stringify(handoff)}\n`,
        stderr: "",
      };
    };

    assert.throws(
      () =>
        executeCommand(
          { action: "acquire", actor, stateRoot: value.stateRoot },
          value.dependencies,
        ),
      (error) =>
        error instanceof AutomationActorsError &&
        error.code === "invalid_launcher_response",
      scenario.name,
    );
  }
});

test("standalone acquire cleans up a plausible lease from a malformed handoff", (t) => {
  const value = fixture(t);
  const actor = "freed-release-verifier";
  const binding = writeAcquisitionBinding(value, actor);
  const originalRunner = value.dependencies.runner;
  value.dependencies.runner = (executable, args, options) => {
    const result = originalRunner(executable, args, options);
    if (executable !== binding.launcherPath || args[0] !== "--acquire-lease") {
      return result;
    }
    const handoff = JSON.parse(result.stdout);
    handoff.unexpected = true;
    return { ...result, stdout: `${JSON.stringify(handoff)}\n` };
  };

  assert.throws(
    () =>
      executeCommand(
        { action: "acquire", actor, stateRoot: value.stateRoot },
        value.dependencies,
      ),
    (error) =>
      error instanceof AutomationActorsError &&
      error.code === "invalid_launcher_response",
  );
  assert.equal(value.liveLeases.size, 0);
  assert.deepEqual(
    value.calls
      .filter((call) => call.args[1] === "lease")
      .map((call) => call.args[2]),
    ["release", "show"],
  );
});

test("standalone malformed acquisition retries exact release and inspection identities", (t) => {
  const value = fixture(t);
  const actor = "freed-release-verifier";
  const binding = writeAcquisitionBinding(value, actor);
  const originalRunner = value.dependencies.runner;
  const releaseOperationIds = [];
  let releaseResponseLost = false;
  let showResponseLost = false;
  value.dependencies.runner = (executable, args, options) => {
    const result = originalRunner(executable, args, options);
    if (executable === binding.launcherPath && args[0] === "--acquire-lease") {
      const handoff = JSON.parse(result.stdout);
      handoff.unexpected = true;
      return { ...result, stdout: `${JSON.stringify(handoff)}\n` };
    }
    if (args[1] === "lease" && args[2] === "release") {
      releaseOperationIds.push(options.env.FREED_AUTOMATION_LEASE_OPERATION_ID);
      if (!releaseResponseLost) {
        releaseResponseLost = true;
        return { status: 1, stdout: "", stderr: "response lost" };
      }
    }
    if (args[1] === "lease" && args[2] === "show" && !showResponseLost) {
      showResponseLost = true;
      return { status: 0, stdout: "{}\n", stderr: "" };
    }
    return result;
  };

  assert.throws(
    () =>
      executeCommand(
        { action: "acquire", actor, stateRoot: value.stateRoot },
        value.dependencies,
      ),
    (error) =>
      error instanceof AutomationActorsError &&
      error.code === "invalid_launcher_response",
  );
  assert.equal(value.liveLeases.size, 0);
  assert.equal(releaseOperationIds.length, 2);
  assert.equal(releaseOperationIds[0], releaseOperationIds[1]);
  assert.deepEqual(
    value.calls
      .filter((call) => call.args[1] === "lease")
      .map((call) => call.args[2]),
    ["release", "release", "show", "show"],
  );
});

test("standalone acquire fails closed against the legacy launcher handoff and removes its plausible lease", (t) => {
  const value = fixture(t);
  const actor = "freed-release-verifier";
  const binding = writeAcquisitionBinding(value, actor);
  const originalRunner = value.dependencies.runner;
  value.dependencies.runner = (executable, args, options) => {
    const result = originalRunner(executable, args, options);
    if (executable !== binding.launcherPath || args[0] !== "--acquire-lease") {
      return result;
    }
    const handoff = JSON.parse(result.stdout);
    delete handoff.leaseOperationId;
    delete handoff.leaseTokenSha256;
    return { ...result, stdout: `${JSON.stringify(handoff)}\n` };
  };

  assert.throws(
    () =>
      executeCommand(
        { action: "acquire", actor, stateRoot: value.stateRoot },
        value.dependencies,
      ),
    (error) =>
      error instanceof AutomationActorsError &&
      error.code === "invalid_launcher_response",
  );
  assert.equal(value.liveLeases.size, 0);
});

test("acquire rejects binding path or digest drift before invoking a launcher", (t) => {
  const cases = [
    {
      name: "launcher path drift",
      mutate(binding, value) {
        binding.launcherPath = path.join(value.root, "untrusted-launcher");
      },
    },
    {
      name: "runtime digest drift",
      mutate(binding) {
        binding.controlLibrarySha256 = "0".repeat(64);
      },
    },
    {
      name: "kernel guard contract digest drift",
      mutate(binding) {
        binding.kernelGuardContractSha256 = "0".repeat(64);
      },
    },
    {
      name: "outcome ledger repair contract digest drift",
      mutate(binding) {
        binding.outcomeLedgerRepairContractSha256 = "0".repeat(64);
      },
    },
  ];
  for (const scenario of cases) {
    const value = fixture(t);
    const actor = "freed-runtime-observer";
    const binding = writeAcquisitionBinding(value, actor);
    scenario.mutate(binding, value);
    writeFileSync(
      path.join(value.launcherRoot, `${actor}.json`),
      `${JSON.stringify(binding)}\n`,
    );

    assert.throws(
      () =>
        executeCommand(
          { action: "acquire", actor, stateRoot: value.stateRoot },
          value.dependencies,
        ),
      (error) =>
        error instanceof AutomationActorsError &&
        error.code === "invalid_binding",
      scenario.name,
    );
    assert.equal(
      value.calls.some((call) => call.args[0] === "--acquire-lease"),
      false,
      scenario.name,
    );
  }
});

test("acquire rejects writable public files and directories before invoking a launcher", (t) => {
  for (const mutate of [
    (value, actor) =>
      chmodSync(path.join(value.launcherRoot, `${actor}.json`), 0o666),
    (value) => chmodSync(path.join(value.launcherRoot, "bin"), 0o777),
    (value, _actor, binding) => chmodSync(binding.nodePath, 0o777),
  ]) {
    const value = fixture(t);
    const actor = "freed-runtime-observer";
    const binding = writeAcquisitionBinding(value, actor);
    mutate(value, actor, binding);
    assert.throws(
      () =>
        executeCommand(
          { action: "acquire", actor, stateRoot: value.stateRoot },
          value.dependencies,
        ),
      (error) =>
        error instanceof AutomationActorsError &&
        error.code === "invalid_binding",
    );
    assert.equal(
      value.calls.some((call) => call.args[0] === "--acquire-lease"),
      false,
    );
  }
});

test("public binding validation pins all runtime files to one digest directory", (t) => {
  const value = fixture(t);
  const actor = "freed-release-verifier";
  const binding = writeAcquisitionBinding(value, actor);
  assert.equal(
    validatePublicBinding(
      binding,
      { actor, stateRoot: value.stateRoot },
      value.dependencies,
    ),
    binding,
  );
  const runtimeDirectory = path.dirname(binding.nodePath);
  assert.equal(path.dirname(binding.controlEntryPath), runtimeDirectory);
  assert.equal(
    path.dirname(path.dirname(binding.controlLibraryPath)),
    runtimeDirectory,
  );
  for (const libraryPath of [
    binding.kernelGuardContractPath,
    binding.outcomeLedgerRepairContractPath,
    binding.leaseArchiveHelperPath,
  ]) {
    assert.equal(path.dirname(path.dirname(libraryPath)), runtimeDirectory);
  }
});

test("all-actor verification and acceptance require one runtime digest", (t) => {
  for (const action of ["verify", "accept-host"]) {
    const value = fixture(t);
    for (const actor of AUTOMATION_ACTOR_IDS) {
      writeAcquisitionBinding(value, actor);
    }
    replaceActorRuntime(value, AUTOMATION_ACTOR_IDS.at(-1));

    assert.throws(
      () =>
        executeCommand(
          { action, actor: "all", stateRoot: value.stateRoot },
          value.dependencies,
        ),
      (error) =>
        error instanceof AutomationActorsError &&
        error.code === "runtime_identity_mismatch",
      action,
    );
    assert.equal(
      value.calls.filter((call) => call.args[0] === "--attest-readiness")
        .length,
      AUTOMATION_ACTOR_IDS.length,
      action,
    );
    assert.equal(
      value.calls.some((call) => call.args[0] === "--acquire-lease"),
      false,
      action,
    );
  }
});

test("accept-host proves every installed actor lifecycle without exposing lease tokens", (t) => {
  const value = fixture(t);
  for (const actor of AUTOMATION_ACTOR_IDS) {
    writeAcquisitionBinding(value, actor);
  }

  const result = executeCommand(
    { action: "accept-host", actor: "all", stateRoot: value.stateRoot },
    value.dependencies,
  );

  assert.equal(result.accepted, true);
  assert.equal(result.records.length, AUTOMATION_ACTOR_IDS.length);
  assert.match(result.runtimeDigest, /^[0-9a-f]{64}$/);
  assert.equal(
    new Set(result.records.map((record) => record.launcherSha256)).size,
    1,
  );
  for (const record of result.records) {
    assert.deepEqual(
      {
        attested: record.attested,
        acquired: record.acquired,
        heartbeated: record.heartbeated,
        released: record.released,
        liveLease: record.liveLease,
        launcherIdentityStable: record.launcherIdentityStable,
      },
      {
        attested: true,
        acquired: true,
        heartbeated: true,
        released: true,
        liveLease: false,
        launcherIdentityStable: true,
      },
    );
  }
  assert.equal(value.liveLeases.size, 0);
  const publicOutput = JSON.stringify(result);
  assert.ok(Buffer.byteLength(publicOutput, "utf8") < 16 * 1_024);
  assert.equal(publicOutput.includes(testLeaseToken), false);
  assert.equal(publicOutput.includes("must-not-reach-a-child"), false);

  const controlCalls = value.calls.filter((call) => call.args[1] === "lease");
  assert.equal(controlCalls.length, AUTOMATION_ACTOR_IDS.length * 3);
  for (const call of controlCalls) {
    assert.equal(call.options.timeoutMs, 15_000);
    assert.equal(call.options.killSignal, "SIGKILL");
    assert.equal(call.options.stdin, "ignore");
    assert.equal(
      Object.hasOwn(call.options.env, "FREED_OWNER_LEASE_TOKEN"),
      false,
    );
    const action = call.args[2];
    assert.equal(
      Object.hasOwn(call.options.env, "FREED_AUTOMATION_LEASE_TOKEN"),
      action !== "show",
    );
    assert.equal(
      Object.hasOwn(call.options.env, "FREED_AUTOMATION_LEASE_OPERATION_ID"),
      action !== "show",
    );
    if (action !== "show") {
      assert.match(
        call.options.env.FREED_AUTOMATION_LEASE_OPERATION_ID,
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
      );
      assert.equal(
        call.args.includes(call.options.env.FREED_AUTOMATION_LEASE_TOKEN),
        false,
      );
      assert.equal(
        call.args.includes(
          call.options.env.FREED_AUTOMATION_LEASE_OPERATION_ID,
        ),
        false,
      );
    }
  }
  assert.equal(
    value.calls.some((call) =>
      call.args.some((argument) =>
        ["task", "activate", "automation", "status"].includes(argument),
      ),
    ),
    false,
  );
  const attestationCalls = value.calls.filter(
    (call) => call.args[0] === "--attest-readiness",
  );
  const acquisitionCalls = value.calls.filter(
    (call) => call.args[0] === "--acquire-lease",
  );
  assert.equal(attestationCalls.length, AUTOMATION_ACTOR_IDS.length * 2);
  assert.equal(acquisitionCalls.length, AUTOMATION_ACTOR_IDS.length);
  for (const actor of AUTOMATION_ACTOR_IDS) {
    assert.equal(
      attestationCalls.filter(
        (call) => call.args[call.args.indexOf("--actor") + 1] === actor,
      ).length,
      2,
    );
  }
  assert.ok(
    value.calls.indexOf(attestationCalls[AUTOMATION_ACTOR_IDS.length - 1]) <
      value.calls.indexOf(acquisitionCalls[0]),
  );
  assert.ok(
    value.calls.indexOf(
      controlCalls.filter((call) => call.args[2] === "show").at(-1),
    ) < value.calls.indexOf(attestationCalls[AUTOMATION_ACTOR_IDS.length]),
  );
});

test("accept-host retries a lost heartbeat response with the exact caller identity", (t) => {
  const value = fixture(t);
  for (const actor of AUTOMATION_ACTOR_IDS) {
    writeAcquisitionBinding(value, actor);
    writeActorCredential(value, actor);
  }
  const originalRunner = value.dependencies.runner;
  const retryOperationIds = [];
  let responseLost = false;
  value.dependencies.runner = (executable, args, options) => {
    const result = originalRunner(executable, args, options);
    if (args[1] !== "lease" || args[2] !== "heartbeat") return result;
    retryOperationIds.push(options.env.FREED_AUTOMATION_LEASE_OPERATION_ID);
    if (!responseLost) {
      responseLost = true;
      return { status: 1, stdout: "", stderr: "response lost" };
    }
    return result;
  };

  const result = executeCommand(
    { action: "accept-host", actor: "all", stateRoot: value.stateRoot },
    value.dependencies,
  );

  assert.equal(result.accepted, true);
  assert.equal(retryOperationIds.length, AUTOMATION_ACTOR_IDS.length + 1);
  assert.equal(retryOperationIds[0], retryOperationIds[1]);
  assert.match(
    retryOperationIds[0],
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
  );
});

test("accept-host binds every control envelope to the exact canonical state root", (t) => {
  for (const scenario of ["wrong state root", "extra envelope field"]) {
    const value = fixture(t);
    for (const actor of AUTOMATION_ACTOR_IDS) {
      writeAcquisitionBinding(value, actor);
    }
    const originalRunner = value.dependencies.runner;
    value.dependencies.runner = (executable, args, options) => {
      const result = originalRunner(executable, args, options);
      if (args[1] !== "lease" || args[2] !== "heartbeat") return result;
      const envelope = JSON.parse(result.stdout);
      if (scenario === "wrong state root") {
        envelope.stateRoot = path.join(value.root, "different-state-root");
      } else {
        envelope.unexpected = true;
      }
      return { ...result, stdout: `${JSON.stringify(envelope)}\n` };
    };

    assert.throws(
      () =>
        executeCommand(
          { action: "accept-host", actor: "all", stateRoot: value.stateRoot },
          value.dependencies,
        ),
      (error) =>
        error instanceof AutomationActorsError &&
        error.code === "invalid_control_response",
      scenario,
    );
    assert.equal(value.liveLeases.size, 0, scenario);
    assert.equal(
      value.calls.some(
        (call) => call.args[1] === "lease" && call.args[2] === "release",
      ),
      true,
      scenario,
    );
  }
});

test("accept-host re-attests all five actors before comparing complete identities", (t) => {
  const value = fixture(t);
  for (const actor of AUTOMATION_ACTOR_IDS) {
    writeAcquisitionBinding(value, actor);
  }
  const firstActor = AUTOMATION_ACTOR_IDS[0];
  const finalLease = AUTOMATION_ACTORS[AUTOMATION_ACTOR_IDS.at(-1)].leaseName;
  const originalRunner = value.dependencies.runner;
  let changed = false;
  value.dependencies.runner = (executable, args, options) => {
    const result = originalRunner(executable, args, options);
    if (
      !changed &&
      args[1] === "lease" &&
      args[2] === "show" &&
      args[args.indexOf("--name") + 1] === finalLease
    ) {
      changed = true;
      replaceActorRuntime(value, firstActor);
    }
    return result;
  };

  assert.throws(
    () =>
      executeCommand(
        { action: "accept-host", actor: "all", stateRoot: value.stateRoot },
        value.dependencies,
      ),
    (error) =>
      error instanceof AutomationActorsError &&
      error.code === "launcher_identity_changed" &&
      error.message.includes(firstActor),
  );
  assert.equal(value.liveLeases.size, 0);
  assert.equal(
    value.calls.filter((call) => call.args[0] === "--acquire-lease").length,
    AUTOMATION_ACTOR_IDS.length,
  );
  assert.equal(
    value.calls.filter((call) => call.args[0] === "--attest-readiness").length,
    AUTOMATION_ACTOR_IDS.length * 2,
  );
});

test("accept-host stops at the first failure and releases the acquired lease in finally", (t) => {
  const value = fixture(t);
  for (const actor of AUTOMATION_ACTOR_IDS) {
    writeAcquisitionBinding(value, actor);
  }
  const failedActor = AUTOMATION_ACTOR_IDS[1];
  const untouchedActor = AUTOMATION_ACTOR_IDS[2];
  const failedLease = AUTOMATION_ACTORS[failedActor].leaseName;
  const originalRunner = value.dependencies.runner;
  value.dependencies.runner = (executable, args, options) => {
    if (
      args[1] === "lease" &&
      args[2] === "heartbeat" &&
      args[args.indexOf("--name") + 1] === failedLease
    ) {
      value.calls.push({ executable, args: [...args], options });
      return { status: 1, stdout: "", stderr: "heartbeat failed" };
    }
    return originalRunner(executable, args, options);
  };

  assert.throws(
    () =>
      executeCommand(
        { action: "accept-host", actor: "all", stateRoot: value.stateRoot },
        value.dependencies,
      ),
    (error) =>
      error instanceof AutomationActorsError && error.code === "command_failed",
  );

  assert.equal(value.liveLeases.size, 0);
  assert.equal(
    value.calls.some(
      (call) =>
        call.args[0] === "--acquire-lease" &&
        call.args[call.args.indexOf("--actor") + 1] === untouchedActor,
    ),
    false,
  );
  assert.deepEqual(
    value.calls
      .filter((call) => call.args[1] === "lease" && call.args[2] === "release")
      .map((call) => call.args[call.args.indexOf("--name") + 1]),
    [AUTOMATION_ACTORS[AUTOMATION_ACTOR_IDS[0]].leaseName, failedLease],
  );
});

test("accept-host releases a lease when its trusted acquisition handoff is malformed", (t) => {
  const value = fixture(t);
  for (const actor of AUTOMATION_ACTOR_IDS) {
    writeAcquisitionBinding(value, actor);
  }
  const originalRunner = value.dependencies.runner;
  value.dependencies.runner = (executable, args, options) => {
    const result = originalRunner(executable, args, options);
    if (args[0] !== "--acquire-lease") return result;
    const payload = JSON.parse(result.stdout);
    payload.unexpected = true;
    return { ...result, stdout: `${JSON.stringify(payload)}\n` };
  };

  assert.throws(
    () =>
      executeCommand(
        { action: "accept-host", actor: "all", stateRoot: value.stateRoot },
        value.dependencies,
      ),
    (error) =>
      error instanceof AutomationActorsError &&
      error.code === "invalid_launcher_response",
  );
  assert.equal(value.liveLeases.size, 0);
  assert.equal(
    value.calls.some(
      (call) => call.args[1] === "lease" && call.args[2] === "release",
    ),
    true,
  );
});

test("accept-host reports a bounded lifecycle timeout after releasing in finally", (t) => {
  const value = fixture(t);
  for (const actor of AUTOMATION_ACTOR_IDS) {
    writeAcquisitionBinding(value, actor);
  }
  const firstLease = AUTOMATION_ACTORS[AUTOMATION_ACTOR_IDS[0]].leaseName;
  const originalRunner = value.dependencies.runner;
  value.dependencies.runner = (executable, args, options) => {
    if (args[1] === "lease" && args[2] === "heartbeat") {
      value.calls.push({ executable, args: [...args], options });
      return {
        status: null,
        stdout: "",
        stderr: "",
        error: Object.assign(new Error("timed out"), { code: "ETIMEDOUT" }),
      };
    }
    return originalRunner(executable, args, options);
  };

  assert.throws(
    () =>
      executeCommand(
        { action: "accept-host", actor: "all", stateRoot: value.stateRoot },
        value.dependencies,
      ),
    (error) =>
      error instanceof AutomationActorsError &&
      error.code === "command_timeout" &&
      error.message.includes("15,000"),
  );
  assert.equal(value.liveLeases.size, 0);
  assert.equal(
    value.calls.some(
      (call) =>
        call.args[1] === "lease" &&
        call.args[2] === "release" &&
        call.args[call.args.indexOf("--name") + 1] === firstLease,
    ),
    true,
  );
});

test("accept-host stops when release fails", (t) => {
  const value = fixture(t);
  for (const actor of AUTOMATION_ACTOR_IDS) {
    writeAcquisitionBinding(value, actor);
  }
  const firstActor = AUTOMATION_ACTOR_IDS[0];
  const secondActor = AUTOMATION_ACTOR_IDS[1];
  const originalRunner = value.dependencies.runner;
  value.dependencies.runner = (executable, args, options) => {
    if (args[1] === "lease" && args[2] === "release") {
      value.calls.push({ executable, args: [...args], options });
      return { status: 1, stdout: "", stderr: "release failed" };
    }
    return originalRunner(executable, args, options);
  };

  assert.throws(
    () =>
      executeCommand(
        { action: "accept-host", actor: "all", stateRoot: value.stateRoot },
        value.dependencies,
      ),
    (error) =>
      error instanceof AutomationActorsError &&
      error.code === "accept_host_release_failed",
  );
  assert.equal(value.liveLeases.size, 1);
  assert.equal(
    value.calls.some(
      (call) =>
        call.args[0] === "--acquire-lease" &&
        call.args[call.args.indexOf("--actor") + 1] === secondActor,
    ),
    false,
  );
  assert.equal(
    value.liveLeases.has(AUTOMATION_ACTORS[firstActor].leaseName),
    true,
  );
});

test("accept-host fails if release does not actually clear the live lease", (t) => {
  const value = fixture(t);
  for (const actor of AUTOMATION_ACTOR_IDS) {
    writeAcquisitionBinding(value, actor);
  }
  const firstActor = AUTOMATION_ACTOR_IDS[0];
  const firstLease = AUTOMATION_ACTORS[firstActor].leaseName;
  const originalRunner = value.dependencies.runner;
  value.dependencies.runner = (executable, args, options) => {
    if (args[1] === "lease" && args[2] === "release") {
      value.calls.push({ executable, args: [...args], options });
      return {
        status: 0,
        stdout: `${JSON.stringify({
          ok: true,
          schemaVersion: 1,
          action: "lease.release",
          stateRoot: value.stateRoot,
          result: {
            released: true,
            lease: { name: firstLease, owner: firstActor },
          },
        })}\n`,
        stderr: "",
      };
    }
    return originalRunner(executable, args, options);
  };

  assert.throws(
    () =>
      executeCommand(
        { action: "accept-host", actor: "all", stateRoot: value.stateRoot },
        value.dependencies,
      ),
    (error) =>
      error instanceof AutomationActorsError &&
      error.code === "lease_still_live",
  );
  assert.equal(value.liveLeases.has(firstLease), true);
});
