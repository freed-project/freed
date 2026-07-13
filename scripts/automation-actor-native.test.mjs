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
  if (source === hostSource) {
    arguments_.push("-framework", "LocalAuthentication");
  }
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

async function sha256File(file) {
  return sha256(await readFile(file));
}

function runtimeDigest({
  nodeSha256,
  controlEntrySha256,
  controlLibrarySha256,
}) {
  return sha256(
    [
      "freed-automation-actor-runtime-v1",
      `node:${nodeSha256}`,
      `automation-control.mjs:${controlEntrySha256}`,
      `lib/automation-control.mjs:${controlLibrarySha256}`,
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
    node: Buffer.from("#!/bin/sh\nexit 99\n"),
    controlEntry: Buffer.from("export {};\n"),
    controlLibrary: Buffer.from("export {};\n"),
  };
  const digests = {
    nodeSha256: sha256(runtimeFiles.node),
    controlEntrySha256: sha256(runtimeFiles.controlEntry),
    controlLibrarySha256: sha256(runtimeFiles.controlLibrary),
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
  await writeFile(nodePath, runtimeFiles.node, { mode: 0o755 });
  await writeFile(controlEntryPath, runtimeFiles.controlEntry, { mode: 0o600 });
  await writeFile(controlLibraryPath, runtimeFiles.controlLibrary, {
    mode: 0o600,
  });
  await chmod(nodePath, 0o755);
  await chmod(controlEntryPath, 0o600);
  await chmod(controlLibraryPath, 0o600);

  const bindingPath = path.join(bindingRoot, `${actor}.json`);
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
    nodeSha256: digests.nodeSha256,
    controlEntryPath,
    controlEntrySha256: digests.controlEntrySha256,
    controlLibraryPath,
    controlLibrarySha256: digests.controlLibrarySha256,
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
    "freed-actor-launcher-readiness-v1",
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
  ];
}

function provisionerArguments(fixture, action, keychainState) {
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
  ];
}

async function run(executable, args, options = {}) {
  return await new Promise((resolve, reject) => {
    const child = execFile(
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
      "leaseToken",
      "schemaVersion",
      "ttlMs",
    ]);
    assert.equal(handoff.actor, defaultActor);
    assert.equal(handoff.leaseName, "scaffolding-writer");
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
  "native provisioner performs provision, rotate, verify, and recoverable revoke transitions",
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
    const verifiedRollback = await run(
      testProvisioner,
      provisionerArguments(rollbackFixture, "verify", "valid"),
    );
    assert.equal(verifiedRollback.code, 0, verifiedRollback.stderr);

    const verifyFixture = await createFixture();
    t.after(() =>
      rm(verifyFixture.fixtureRoot, { recursive: true, force: true }),
    );
    const verified = await run(
      testProvisioner,
      provisionerArguments(verifyFixture, "verify", "valid"),
    );
    assert.equal(verified.code, 0, verified.stderr);
    assert.equal(JSON.parse(verified.stdout).ready, true);

    const revokeFixture = await createFixture();
    t.after(() =>
      rm(revokeFixture.fixtureRoot, { recursive: true, force: true }),
    );
    const revoked = await run(
      testProvisioner,
      provisionerArguments(revokeFixture, "revoke", "empty"),
    );
    assert.equal(revoked.code, 0, revoked.stderr);
    await assert.rejects(readFile(revokeFixture.credentialPath), {
      code: "ENOENT",
    });
    assert.equal(JSON.parse(revoked.stdout).ready, false);
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
      provisionerArguments(itemOnly, "provision", "valid"),
    );
    assert.equal(itemOnlyResult.code, 1);
    assert.match(itemOnlyResult.stderr, /run revoke, then retry/);

    const wrongSecret = await createFixture();
    t.after(() =>
      rm(wrongSecret.fixtureRoot, { recursive: true, force: true }),
    );
    const wrongSecretResult = await run(
      testProvisioner,
      provisionerArguments(wrongSecret, "verify", "wrong-secret"),
    );
    assert.equal(wrongSecretResult.code, 1);
    assert.match(
      wrongSecretResult.stderr,
      /does not match the owner-held digest/,
    );

    const wrongACL = await createFixture();
    t.after(() => rm(wrongACL.fixtureRoot, { recursive: true, force: true }));
    const wrongACLResult = await run(
      testProvisioner,
      provisionerArguments(wrongACL, "verify", "wrong-acl"),
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
        "verify",
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
  "production binaries contain no test credential or test-only override",
  { skip: !darwinOnly },
  async () => {
    for (const binary of [productionHost, productionProvisioner]) {
      const { stdout } = await execFileAsync("/usr/bin/strings", [binary]);
      assert.doesNotMatch(stdout, new RegExp(existingCredential));
      assert.doesNotMatch(stdout, new RegExp(rotatedCredential));
      assert.doesNotMatch(stdout, /--test-binding|--test-runtime-root/);
      assert.doesNotMatch(stdout, /--test-keychain-state|--test-control-mode/);
      assert.doesNotMatch(stdout, /digest-write-failure/);
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
    const provisionerResult = await run(productionProvisioner, [
      "verify",
      "--actor",
      defaultActor,
      "--state-root",
      "/tmp",
      "--test-binding",
      "/tmp/binding.json",
    ]);
    assert.equal(provisionerResult.code, 1);
    assert.match(provisionerResult.stderr, /unsupported or duplicate argument/);
  },
);

test(
  "native build helper emits unsigned production tools with no signing flags",
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
    const result = await run(buildScript, [
      "--host-output",
      hostOutput,
      "--provisioner-output",
      provisionerOutput,
    ]);
    assert.equal(result.code, 0, result.stderr);
    assert.equal((await stat(hostOutput)).mode & 0o777, 0o755);
    assert.equal((await stat(provisionerOutput)).mode & 0o777, 0o755);
    const source = await readFile(buildScript, "utf8");
    assert.doesNotMatch(source, /codesign|signing-identity|--identity/);
    for (const binary of [hostOutput, provisionerOutput]) {
      const { stdout } = await execFileAsync("/usr/bin/strings", [binary]);
      assert.doesNotMatch(stdout, /--test-binding|--test-keychain-state/);
      assert.doesNotMatch(stdout, new RegExp(existingCredential));
    }
  },
);
