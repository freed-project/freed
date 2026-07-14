import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  chmodSync,
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";

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
    path.join(repoRoot, "scripts", "lib", "automation-control.mjs"),
    "export const library = true;\n",
  );
  writeExecutable(hostBuildPath, "#!/bin/bash\nexit 0\n");
  writeExecutable(pinnedNodePath, "pinned node fixture\n");

  const calls = [];
  const liveLeases = new Map();
  const runner = (executable, args, options) => {
    calls.push({ executable, args: [...args], options });
    if (executable === "/bin/bash" && args[0] === hostBuildPath) {
      const hostOutput = args[args.indexOf("--host-output") + 1];
      const provisionerOutput = args[args.indexOf("--provisioner-output") + 1];
      writeExecutable(hostOutput, "automation actor host fixture\n");
      writeExecutable(
        provisionerOutput,
        "automation actor provisioner fixture\n",
      );
      return { status: 0, stdout: "built\n", stderr: "" };
    }
    if (executable === "/usr/bin/sudo") {
      assert.equal(args[0], "/usr/bin/install");
      if (args[1] === "-d") {
        const mode = Number.parseInt(args[args.indexOf("-m") + 1], 8);
        const destination = args.at(-1);
        mkdirSync(destination, { recursive: true, mode });
        chmodSync(destination, mode);
      } else {
        const mode = Number.parseInt(args[args.indexOf("-m") + 1], 8);
        const source = args.at(-2);
        const destination = args.at(-1);
        mkdirSync(path.dirname(destination), { recursive: true });
        copyFileSync(source, destination);
        chmodSync(destination, mode);
      }
      return { status: 0, stdout: "", stderr: "" };
    }
    if (args[0] === "--acquire-lease") {
      const actor = args[args.indexOf("--actor") + 1];
      const leaseName = args[args.indexOf("--lease-name") + 1];
      const leaseToken = "short-lived-test-token";
      liveLeases.set(leaseName, { actor, leaseToken });
      return {
        status: 0,
        stdout: `${JSON.stringify({
          schemaVersion: 1,
          actor,
          leaseName,
          leaseToken,
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
        maxLeaseLifetimeMs: Number(
          args[args.indexOf("--max-lifetime-ms") + 1],
        ),
        credentialSha256: args[args.indexOf("--credential-sha256") + 1],
        keychainService: args[args.indexOf("--keychain-service") + 1],
        keychainAccount: args[args.indexOf("--keychain-account") + 1],
      };
      return {
        status: 0,
        stdout: `${JSON.stringify({
          schemaVersion: 1,
          protocol: "freed-actor-launcher-readiness-v1",
          purpose: "automation-actor-launcher-readiness",
          ...expected,
          handoff: "keychain-to-canonical-lease",
          credentialDigestVerified: true,
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
      FREED_AUTOMATION_ACTOR_TOKEN: "must-not-reach-a-child",
      FREED_OWNER_LEASE_TOKEN: "must-not-reach-a-child",
    },
    platform: "darwin",
    uid: typeof process.getuid === "function" ? process.getuid() : 501,
    homeDir,
    tempRoot,
    repoRoot,
    launcherRoot,
    runtimeRoot,
    trustedUid: typeof process.getuid === "function" ? process.getuid() : 501,
    hostBuildPath,
    runner,
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
      "freed-actor-launcher-readiness-v1",
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
    runner,
    dependencies,
  };
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
      credentialSha256: "a".repeat(64),
      keychainService: "Freed automation actors",
      keychainAccount: "freed-runtime-observer",
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
    () =>
      parseCommand([
        "accept-host",
        "--actor",
        "freed-runtime-observer",
      ]),
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

test("provision all installs one content-addressed runtime and all public bindings", (t) => {
  const value = fixture(t);
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
  assert.match(result.runtimeDigest, /^[0-9a-f]{64}$/);

  const runtimeDirectory = path.join(value.runtimeRoot, result.runtimeDigest);
  const runtimePaths = [
    path.join(runtimeDirectory, "node"),
    path.join(runtimeDirectory, "automation-control.mjs"),
    path.join(runtimeDirectory, "lib", "automation-control.mjs"),
  ];
  for (const runtimePath of runtimePaths) {
    assert.equal(existsSync(runtimePath), true, runtimePath);
  }

  for (const actor of AUTOMATION_ACTOR_IDS) {
    const bindingPath = path.join(value.launcherRoot, `${actor}.json`);
    const binding = JSON.parse(readFileSync(bindingPath, "utf8"));
    assert.equal(binding.actor, actor);
    assert.equal(binding.leaseName, AUTOMATION_ACTORS[actor].leaseName);
    assert.equal(binding.maxLeaseLifetimeMs, 30 * 60_000);
    assert.equal(binding.keychainAccount, actor);
    assert.equal(binding.nodePath, runtimePaths[0]);
    assert.equal(binding.controlEntryPath, runtimePaths[1]);
    assert.equal(binding.controlLibraryPath, runtimePaths[2]);
    assert.equal(existsSync(binding.launcherPath), true);
    assert.equal(
      path.basename(binding.launcherPath),
      `${actor}-${binding.launcherSha256}`,
    );
  }

  const buildCalls = value.calls.filter(
    (call) =>
      call.executable === "/bin/bash" && call.args[0] === value.hostBuildPath,
  );
  assert.equal(buildCalls.length, 1);
  assert.deepEqual(
    buildCalls[0].args.filter((arg) => arg.startsWith("--")),
    ["--host-output", "--provisioner-output"],
  );
  const provisionCalls = value.calls.filter(
    (call) => call.args[0] === "provision",
  );
  assert.equal(provisionCalls.length, 5);
  for (const call of provisionCalls) {
    assert.deepEqual(call.args, [
      "provision",
      "--actor",
      call.args[2],
      "--state-root",
      value.stateRoot,
    ]);
  }
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
      Object.hasOwn(call.options.env, "FREED_AUTOMATION_ACTOR_TOKEN"),
      false,
    );
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
    value.calls
      .filter((call) => call.executable === "/usr/bin/sudo")
      .some((call) =>
        call.args.some((argument) =>
          argument.includes("automation-actor-provisioner"),
        ),
      ),
    false,
  );
});

test("provision all rolls back only actors completed by the current batch", (t) => {
  const value = fixture(t);
  const failingActor = AUTOMATION_ACTOR_IDS[2];
  const baseRunner = value.dependencies.runner;
  value.dependencies.runner = (executable, args, options) => {
    const result = baseRunner(executable, args, options);
    return args[0] === "provision" && args[2] === failingActor
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

  assert.deepEqual(
    value.calls
      .filter((call) => ["provision", "revoke"].includes(call.args[0]))
      .map((call) => [call.args[0], call.args[2]]),
    [
      ["provision", AUTOMATION_ACTOR_IDS[0]],
      ["provision", AUTOMATION_ACTOR_IDS[1]],
      ["provision", failingActor],
      ["revoke", AUTOMATION_ACTOR_IDS[1]],
      ["revoke", AUTOMATION_ACTOR_IDS[0]],
    ],
  );
  for (const call of value.calls.filter((candidate) =>
    ["provision", "revoke"].includes(candidate.args[0]),
  )) {
    assert.equal(
      Object.hasOwn(call.options.env, "FREED_AUTOMATION_ACTOR_TOKEN"),
      false,
    );
    assert.equal(
      Object.hasOwn(call.options.env, "FREED_OWNER_LEASE_TOKEN"),
      false,
    );
  }
});

test("provision all reports rollback failure after attempting every safe revoke", (t) => {
  const value = fixture(t);
  const failingActor = AUTOMATION_ACTOR_IDS[2];
  const rollbackFailureActor = AUTOMATION_ACTOR_IDS[1];
  const baseRunner = value.dependencies.runner;
  value.dependencies.runner = (executable, args, options) => {
    const result = baseRunner(executable, args, options);
    if (
      (args[0] === "provision" && args[2] === failingActor) ||
      (args[0] === "revoke" && args[2] === rollbackFailureActor)
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

  assert.deepEqual(
    value.calls
      .filter((call) => call.args[0] === "revoke")
      .map((call) => call.args[2]),
    [AUTOMATION_ACTOR_IDS[1], AUTOMATION_ACTOR_IDS[0]],
  );
  assert.equal(
    value.calls.some(
      (call) => call.args[0] === "revoke" && call.args[2] === failingActor,
    ),
    false,
  );
});

test("rotate and revoke build privately and invoke only the provisioner", (t) => {
  for (const action of ["rotate", "revoke"]) {
    const value = fixture(t);
    const result = executeCommand(
      {
        action,
        actor: "freed-stability-controller",
        stateRoot: value.stateRoot,
      },
      value.dependencies,
    );
    assert.deepEqual(result, {
      action,
      actor: "freed-stability-controller",
      stateRoot: value.stateRoot,
    });
    assert.equal(
      value.calls.filter((call) => call.executable === value.hostBuildPath)
        .length +
        value.calls.filter(
          (call) =>
            call.executable === "/bin/bash" &&
            call.args[0] === value.hostBuildPath,
        ).length,
      1,
    );
    const provisionerCall = value.calls.find((call) => call.args[0] === action);
    assert.deepEqual(provisionerCall.args, [
      action,
      "--actor",
      "freed-stability-controller",
      "--state-root",
      value.stateRoot,
    ]);
    assert.equal(
      value.calls.some((call) => call.executable === "/usr/bin/sudo"),
      false,
    );
  }
});

test("verify all attests through exact installed launchers without build, sudo, or provisioner", (t) => {
  const value = fixture(t);
  for (const actor of AUTOMATION_ACTOR_IDS) {
    writeAcquisitionBinding(value, actor);
    writeActorCredential(value, actor);
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
        ["provision", "rotate", "revoke", "verify"].includes(call.args[0]),
    ),
    false,
  );
  for (const call of value.calls.filter(
    (candidate) => candidate.args[0] === "--attest-readiness",
  )) {
    assert.equal(call.options.timeoutMs, 5_000);
    assert.equal(call.options.killSignal, "SIGKILL");
    assert.equal(call.options.stdin, "ignore");
  }
});

test("verify fails closed on attestation timeout and malformed attestation", (t) => {
  for (const scenario of ["timeout", "malformed"]) {
    const value = fixture(t);
    const actor = "freed-runtime-observer";
    writeAcquisitionBinding(value, actor);
    writeActorCredential(value, actor);
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
              protocol: "freed-actor-launcher-readiness-v1",
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
          ? error.message.includes("5,000")
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

test("source-built credential actions require a clean exact dev checkout", (t) => {
  for (const action of ["rotate", "revoke"]) {
    const value = fixture(t);
    value.dependencies.repositoryInspector = () => ({
      topLevel: value.repoRoot,
      branch: "dev",
      head: "a".repeat(40),
      originDev: "a".repeat(40),
      status: "?? unreviewed-file",
    });
    assert.throws(
      () =>
        executeCommand(
          {
            action,
            actor: "freed-runtime-observer",
            stateRoot: value.stateRoot,
          },
          value.dependencies,
        ),
      (error) =>
        error instanceof AutomationActorsError &&
        error.code === "unsafe_checkout",
      action,
    );
    assert.equal(value.calls.length, 0, action);
  }
});

test("installed verification does not inspect or depend on the source checkout", (t) => {
  const value = fixture(t);
  const actor = "freed-runtime-observer";
  writeAcquisitionBinding(value, actor);
  writeActorCredential(value, actor);
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
    controlLibrarySha256: sha256(
      path.join(value.repoRoot, "scripts", "lib", "automation-control.mjs"),
    ),
  };
  const digest = runtimeDigestForPins(sourcePins);
  const runtimeDirectory = path.join(value.runtimeRoot, digest);
  const runtime = {
    digest,
    nodePath: path.join(runtimeDirectory, "node"),
    controlEntryPath: path.join(runtimeDirectory, "automation-control.mjs"),
    controlLibraryPath: path.join(
      runtimeDirectory,
      "lib",
      "automation-control.mjs",
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
    path.join(value.repoRoot, "scripts", "lib", "automation-control.mjs"),
    runtime.controlLibraryPath,
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

function writeActorCredential(
  value,
  actor,
  tokenSha256 = "a".repeat(64),
) {
  const credentialDirectory = path.join(
    value.stateRoot,
    "control",
    "actor-credentials",
  );
  mkdirSync(credentialDirectory, { recursive: true, mode: 0o700 });
  const credentialPath = path.join(credentialDirectory, `${actor}.json`);
  writeFileSync(
    credentialPath,
    `${JSON.stringify({
      schemaVersion: 1,
      actor,
      purpose: "automation-actor-lease",
      tokenSha256,
    })}\n`,
    { mode: 0o600 },
  );
  chmodSync(credentialPath, 0o600);
  return credentialPath;
}

function replaceActorRuntime(value, actor) {
  const bindingPath = path.join(value.launcherRoot, `${actor}.json`);
  const installedBinding = JSON.parse(readFileSync(bindingPath, "utf8"));
  const controlLibraryContents =
    "export const library = 'different runtime fixture';\n";
  const runtimePins = {
    nodeSha256: sha256(installedBinding.nodePath),
    controlEntrySha256: sha256(installedBinding.controlEntryPath),
    controlLibrarySha256: createHash("sha256")
      .update(controlLibraryContents)
      .digest("hex"),
  };
  const digest = runtimeDigestForPins(runtimePins);
  const runtimeDirectory = path.join(value.runtimeRoot, digest);
  const runtime = {
    digest,
    nodePath: path.join(runtimeDirectory, "node"),
    controlEntryPath: path.join(runtimeDirectory, "automation-control.mjs"),
    controlLibraryPath: path.join(
      runtimeDirectory,
      "lib",
      "automation-control.mjs",
    ),
    ...runtimePins,
  };
  mkdirSync(path.dirname(runtime.controlLibraryPath), { recursive: true });
  copyFileSync(installedBinding.nodePath, runtime.nodePath);
  copyFileSync(installedBinding.controlEntryPath, runtime.controlEntryPath);
  writeFileSync(runtime.controlLibraryPath, controlLibraryContents, {
    mode: 0o600,
  });
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
    leaseToken: "short-lived-test-token",
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
  assert.equal(launcherCall.options.timeoutMs, 15_000);
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
      error.message.includes("15,000"),
  );
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
        leaseToken: "short-lived-test-token",
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
    ["show", "release", "show"],
  );
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
});

test("all-actor verification and acceptance require one runtime digest", (t) => {
  for (const action of ["verify", "accept-host"]) {
    const value = fixture(t);
    for (const actor of AUTOMATION_ACTOR_IDS) {
      writeAcquisitionBinding(value, actor);
      writeActorCredential(value, actor);
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

test("accept-host proves every installed actor lifecycle without exposing credentials", (t) => {
  const value = fixture(t);
  for (const actor of AUTOMATION_ACTOR_IDS) {
    writeAcquisitionBinding(value, actor);
    writeActorCredential(value, actor);
  }

  const result = executeCommand(
    { action: "accept-host", actor: "all", stateRoot: value.stateRoot },
    value.dependencies,
  );

  assert.equal(result.accepted, true);
  assert.equal(result.records.length, AUTOMATION_ACTOR_IDS.length);
  assert.match(result.runtimeDigest, /^[0-9a-f]{64}$/);
  assert.equal(new Set(result.records.map((record) => record.launcherSha256)).size, 1);
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
  assert.equal(publicOutput.includes("short-lived-test-token"), false);
  assert.equal(publicOutput.includes("must-not-reach-a-child"), false);

  const controlCalls = value.calls.filter((call) => call.args[1] === "lease");
  assert.equal(controlCalls.length, AUTOMATION_ACTOR_IDS.length * 3);
  for (const call of controlCalls) {
    assert.equal(call.options.timeoutMs, 15_000);
    assert.equal(call.options.killSignal, "SIGKILL");
    assert.equal(call.options.stdin, "ignore");
    assert.equal(
      Object.hasOwn(call.options.env, "FREED_AUTOMATION_ACTOR_TOKEN"),
      false,
    );
    assert.equal(
      Object.hasOwn(call.options.env, "FREED_OWNER_LEASE_TOKEN"),
      false,
    );
    const action = call.args[2];
    assert.equal(
      Object.hasOwn(call.options.env, "FREED_AUTOMATION_LEASE_TOKEN"),
      action !== "show",
    );
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

test("accept-host binds every control envelope to the exact canonical state root", (t) => {
  for (const scenario of ["wrong state root", "extra envelope field"]) {
    const value = fixture(t);
    for (const actor of AUTOMATION_ACTOR_IDS) {
      writeAcquisitionBinding(value, actor);
      writeActorCredential(value, actor);
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
    writeActorCredential(value, actor);
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
      writeActorCredential(value, firstActor, "b".repeat(64));
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
    value.calls.filter((call) => call.args[0] === "--attest-readiness")
      .length,
    AUTOMATION_ACTOR_IDS.length * 2,
  );
});

test("accept-host stops at the first failure and releases the acquired lease in finally", (t) => {
  const value = fixture(t);
  for (const actor of AUTOMATION_ACTOR_IDS) {
    writeAcquisitionBinding(value, actor);
    writeActorCredential(value, actor);
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
    [
      AUTOMATION_ACTORS[AUTOMATION_ACTOR_IDS[0]].leaseName,
      failedLease,
    ],
  );
});

test("accept-host releases a lease when its trusted acquisition handoff is malformed", (t) => {
  const value = fixture(t);
  for (const actor of AUTOMATION_ACTOR_IDS) {
    writeAcquisitionBinding(value, actor);
    writeActorCredential(value, actor);
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
    writeActorCredential(value, actor);
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
    writeActorCredential(value, actor);
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
  assert.equal(value.liveLeases.has(AUTOMATION_ACTORS[firstActor].leaseName), true);
});

test("accept-host fails if release does not actually clear the live lease", (t) => {
  const value = fixture(t);
  for (const actor of AUTOMATION_ACTOR_IDS) {
    writeAcquisitionBinding(value, actor);
    writeActorCredential(value, actor);
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
