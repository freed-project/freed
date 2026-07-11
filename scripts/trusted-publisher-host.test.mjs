import assert from "node:assert/strict";
import {
  createHash,
  generateKeyPairSync,
  verify as verifySignature,
} from "node:crypto";
import { execFile } from "node:child_process";
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import test, { after, before } from "node:test";

import { verifyOwnerCapabilityEnvelope } from "./lib/automation-control.mjs";

const execFileAsync = promisify(execFile);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const source = path.join(root, "scripts/trusted-publisher-host.swift");
const darwinOnly = process.platform === "darwin";
const developerDirectory = "/Library/Developer/CommandLineTools";

let buildRoot = "";
let broker = "";
let productionBroker = "";

before(async () => {
  if (!darwinOnly) return;
  buildRoot = await realpath(
    await mkdtemp(path.join(os.tmpdir(), "freed-publisher-host-build-")),
  );
  broker = path.join(buildRoot, "trusted-publisher-host-test");
  productionBroker = path.join(buildRoot, "trusted-publisher-host-production");
  const common = [
    "-O",
    source,
    "-framework",
    "Security",
    "-framework",
    "LocalAuthentication",
    "-framework",
    "CryptoKit",
  ];
  await execFileAsync(
    "xcrun",
    ["swiftc", "-D", "TRUSTED_PUBLISHER_HOST_TESTING", ...common, "-o", broker],
    {
      cwd: root,
      env: { ...process.env, DEVELOPER_DIR: developerDirectory },
    },
  );
  await execFileAsync("xcrun", ["swiftc", ...common, "-o", productionBroker], {
    cwd: root,
    env: { ...process.env, DEVELOPER_DIR: developerDirectory },
  });
});

after(async () => {
  if (buildRoot) await rm(buildRoot, { recursive: true, force: true });
});

async function sha256(file) {
  return createHash("sha256")
    .update(await readFile(file))
    .digest("hex");
}

async function run(executable, args, options = {}) {
  const environment = {
    ...process.env,
    DEVELOPER_DIR: developerDirectory,
    ...(options.env ?? {}),
  };
  return await new Promise((resolve, reject) => {
    const child = execFile(
      executable,
      args,
      { ...options, env: environment },
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

async function git(cwd, args) {
  return await execFileAsync(
    "/usr/bin/git",
    [
      "-c",
      "commit.gpgsign=false",
      "-c",
      "user.name=Freed Host Test",
      "-c",
      "user.email=host-test@invalid.example",
      ...args,
    ],
    {
      cwd,
      env: {
        HOME: os.homedir(),
        DEVELOPER_DIR: developerDirectory,
        PATH: "/usr/bin:/bin",
        GIT_CONFIG_NOSYSTEM: "1",
        GIT_CONFIG_GLOBAL: "/dev/null",
      },
    },
  );
}

async function createFixture() {
  const fixtureRoot = await realpath(
    await mkdtemp(path.join(os.tmpdir(), "freed-publisher-host-fixture-")),
  );
  await chmod(fixtureRoot, 0o700);
  const controlRoot = path.join(fixtureRoot, "control");
  const scriptsDirectory = path.join(controlRoot, "scripts");
  const scriptsLibraryDirectory = path.join(scriptsDirectory, "lib");
  const candidateRoot = path.join(fixtureRoot, "candidate");
  const seedRoot = path.join(fixtureRoot, "seed");
  const originRoot = path.join(fixtureRoot, "origin.git");
  const stateRoot = path.join(fixtureRoot, "state");
  await mkdir(scriptsLibraryDirectory, { recursive: true, mode: 0o755 });
  await mkdir(candidateRoot, { mode: 0o700 });
  await mkdir(seedRoot, { mode: 0o700 });
  await mkdir(stateRoot, { mode: 0o700 });

  await git(fixtureRoot, ["init", "--bare", originRoot]);
  await git(seedRoot, ["init", "-q"]);
  await writeFile(path.join(seedRoot, "README.md"), "seed\n");
  await git(seedRoot, ["add", "README.md"]);
  await git(seedRoot, ["commit", "-q", "-m", "test: seed candidate"]);
  await git(seedRoot, ["branch", "-M", "dev"]);
  await git(seedRoot, ["remote", "add", "origin", originRoot]);
  await git(seedRoot, ["push", "-q", "origin", "dev"]);
  await git(seedRoot, ["push", "-q", "origin", "dev:main"]);

  await git(candidateRoot, ["init", "-q"]);
  const canonicalOrigin = "https://github.com/freed-project/freed.git";
  await git(candidateRoot, ["remote", "add", "origin", canonicalOrigin]);
  await git(candidateRoot, [
    "config",
    `url.${originRoot}.insteadOf`,
    canonicalOrigin,
  ]);
  await git(candidateRoot, ["fetch", "-q", "origin", "dev"]);
  await git(candidateRoot, [
    "checkout",
    "-q",
    "-b",
    "fix/publisher-host-test",
    "origin/dev",
  ]);
  const { stdout: baseOutput } = await git(candidateRoot, [
    "rev-parse",
    "origin/dev",
  ]);
  const baseSha = baseOutput.trim();

  const ghPath = path.join(fixtureRoot, "gh");
  await writeFile(
    ghPath,
    `#!/bin/bash\nset -eu\nif [[ "$1" == api ]]; then printf '%s\\n' ${JSON.stringify(baseSha)}; exit 0; fi\nexit 91\n`,
    { mode: 0o700 },
  );

  const capturePath = path.join(fixtureRoot, "capture.txt");
  const capturedCapabilityPath = path.join(
    fixtureRoot,
    "captured-capability.json",
  );
  const launcher = path.join(scriptsDirectory, "trusted-worktree-publish.sh");
  await writeFile(
    launcher,
    `#!/bin/bash
set -eu
environment_safe=1
for name in BASH_ENV ENV GIT_CONFIG_GLOBAL GIT_DIR GH_TOKEN NODE_OPTIONS NODE_BIN FREED_OWNER_BOOTSTRAP_TOKEN FREED_PR_PUBLISHER_ACTOR_TOKEN FREED_AUTOMATION_ACTOR_TOKEN; do
  if [[ -n "\${!name+x}" ]]; then environment_safe=0; fi
done
capability_private=0
if [[ -f "\${FREED_PUBLISHER_CAPABILITY_FILE}" && "$(/usr/bin/stat -f '%Lp' "\${FREED_PUBLISHER_CAPABILITY_FILE}")" == 600 ]]; then
  capability_private=1
fi
/bin/cp "\${FREED_PUBLISHER_CAPABILITY_FILE}" ${JSON.stringify(capturedCapabilityPath)}
cwd_match=0
if [[ "$(pwd -P)" == "$4" ]]; then cwd_match=1; fi
args_match=0
if [[ "$1" == "--capture" && "$3" == "--expect-cwd" && "$5" == "--title" && "$6" == "fix: hostile environment isolation" ]]; then
  args_match=1
fi
{
  printf 'environment_safe=%s\\n' "\${environment_safe}"
  printf 'capability_private=%s\\n' "\${capability_private}"
  printf 'cwd_match=%s\\n' "\${cwd_match}"
  printf 'args_match=%s\\n' "\${args_match}"
} > "$2"
if [[ "\${environment_safe}" != 1 || "\${capability_private}" != 1 || "\${cwd_match}" != 1 || "\${args_match}" != 1 ]]; then
  exit 22
fi
`,
    { mode: 0o700 },
  );

  const automationControl = path.join(
    scriptsDirectory,
    "automation-control.mjs",
  );
  const automationControlLibrary = path.join(
    scriptsLibraryDirectory,
    "automation-control.mjs",
  );
  const publisherHelper = path.join(scriptsDirectory, "worktree-publish.sh");
  const mainValidator = path.join(scriptsDirectory, "validate-main-pr.mjs");
  await writeFile(automationControl, "export {};\n", { mode: 0o600 });
  await writeFile(automationControlLibrary, "export {};\n", { mode: 0o600 });
  await writeFile(publisherHelper, "#!/bin/bash\nexit 0\n", { mode: 0o700 });
  await writeFile(
    mainValidator,
    `const args = process.argv.slice(2);
const valid = process.cwd() === ${JSON.stringify(candidateRoot)} &&
  args[0] === ${JSON.stringify(`--cwd=${candidateRoot}`)} &&
  args[1] === "--base-ref=origin/main" &&
  /^--head-ref=[0-9a-f]{40}$/.test(args[2] || "") &&
  /^--head-branch=chore\\/(?:promote-dev-to-main|release)-[a-z0-9][a-z0-9._-]*$/.test(args[3] || "");
process.exit(valid ? 0 : 93);
`,
    { mode: 0o600 },
  );

  await git(controlRoot, ["init", "-q"]);
  await git(controlRoot, ["add", "scripts"]);
  await git(controlRoot, ["commit", "-q", "-m", "test: add trusted launcher"]);
  const { stdout: headOutput } = await git(controlRoot, ["rev-parse", "HEAD"]);
  const controlCommit = headOutput.trim();

  const keyPair = generateKeyPairSync("ed25519");
  const privateKey = keyPair.privateKey
    .export({ format: "der", type: "pkcs8" })
    .subarray(-32);
  const publicKey = keyPair.publicKey
    .export({ format: "der", type: "spki" })
    .subarray(-32);
  const configPath = path.join(fixtureRoot, "trusted-publisher-host.json");
  const secretPath = path.join(fixtureRoot, "publisher-signing-key");
  const nodePath = await realpath(process.execPath);
  const config = {
    schemaVersion: 2,
    brokerPath: broker,
    brokerSha256: await sha256(broker),
    brokerTeamIdentifier: "TESTTEAM01",
    brokerSigningIdentifier: "wtf.freed.publisher-host-test",
    controlRoot,
    controlCommit,
    stateRoot,
    launcherSha256: await sha256(launcher),
    automationControlSha256: await sha256(automationControl),
    automationControlLibrarySha256: await sha256(automationControlLibrary),
    publisherHelperSha256: await sha256(publisherHelper),
    githubCLIPath: ghPath,
    githubCLISha256: await sha256(ghPath),
    nodePath,
    nodeSha256: await sha256(nodePath),
    publisherPublicKeyBase64: publicKey.toString("base64"),
  };
  const actorCredentialDirectory = path.join(
    stateRoot,
    "control",
    "actor-credentials",
  );
  await mkdir(actorCredentialDirectory, { recursive: true, mode: 0o700 });
  await writeFile(
    path.join(actorCredentialDirectory, "freed-pr-publisher.json"),
    `${JSON.stringify({
      schemaVersion: 1,
      actor: "freed-pr-publisher",
      purpose: "publisher-capability-signing",
      publicKeyBase64: config.publisherPublicKeyBase64,
    })}\n`,
    { mode: 0o600 },
  );
  await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, {
    mode: 0o600,
  });
  await writeFile(secretPath, privateKey, { mode: 0o600 });
  const bashMarker = path.join(fixtureRoot, "bash-env-ran");
  const bashEnvironment = path.join(fixtureRoot, "hostile-bash-env.sh");
  await writeFile(bashEnvironment, `touch ${JSON.stringify(bashMarker)}\n`, {
    mode: 0o600,
  });
  return {
    fixtureRoot,
    controlRoot,
    candidateRoot,
    stateRoot,
    config,
    configPath,
    secretPath,
    capturePath,
    capturedCapabilityPath,
    bashMarker,
    bashEnvironment,
    baseSha,
    publicKey: keyPair.publicKey,
  };
}

function brokerArguments(fixture) {
  return [
    "--test-config",
    fixture.configPath,
    "--test-secret-file",
    fixture.secretPath,
    "--",
    "--capture",
    fixture.capturePath,
    "--expect-cwd",
    fixture.candidateRoot,
    "--title",
    "fix: hostile environment isolation",
  ];
}

test(
  "native publisher host issues a signed one-use capability without exposing its signing key",
  { skip: !darwinOnly },
  async (t) => {
    const fixture = await createFixture();
    t.after(
      async () =>
        await rm(fixture.fixtureRoot, { recursive: true, force: true }),
    );
    const result = await run(broker, brokerArguments(fixture), {
      cwd: fixture.candidateRoot,
      env: {
        ...process.env,
        BASH_ENV: fixture.bashEnvironment,
        ENV: fixture.bashEnvironment,
        GH_TOKEN: "hostile-gh-token",
        NODE_OPTIONS: "--require=/tmp/hostile-node-loader.cjs",
        FREED_PR_PUBLISHER_ACTOR_TOKEN: "hostile-publisher-token",
      },
    });
    assert.equal(result.code, 0, result.stderr);
    assert.equal(
      await readFile(fixture.capturePath, "utf8"),
      [
        "environment_safe=1",
        "capability_private=1",
        "cwd_match=1",
        "args_match=1",
        "",
      ].join("\n"),
    );
    await assert.rejects(readFile(fixture.bashMarker), { code: "ENOENT" });
    const envelope = JSON.parse(
      await readFile(fixture.capturedCapabilityPath, "utf8"),
    );
    const payloadBytes = Buffer.from(envelope.payloadBase64, "base64");
    assert.equal(
      verifySignature(
        null,
        payloadBytes,
        fixture.publicKey,
        Buffer.from(envelope.signatureBase64, "base64"),
      ),
      true,
    );
    const payload = JSON.parse(payloadBytes.toString("utf8"));
    assert.equal(payload.scope.worktree, fixture.candidateRoot);
    assert.equal(payload.scope.branch, "fix/publisher-host-test");
    assert.equal(payload.scope.base, "dev");
    assert.equal(payload.scope.baseSha, fixture.baseSha);
    assert.equal(payload.scope.headSha ?? null, null);
    assert.equal(payload.scope.publishMode, "feature-pr");
    assert.equal(payload.leaseTtlMs, 1_800_000);
  },
);

test(
  "native publisher host prebinds a clean production release-prep head",
  { skip: !darwinOnly },
  async (t) => {
    const fixture = await createFixture();
    t.after(
      async () =>
        await rm(fixture.fixtureRoot, { recursive: true, force: true }),
    );
    await git(fixture.candidateRoot, ["fetch", "-q", "origin", "main"]);
    await git(fixture.candidateRoot, [
      "checkout",
      "-q",
      "-b",
      "chore/release-v26.7.1001",
      "origin/main",
    ]);
    await writeFile(path.join(fixture.candidateRoot, "release.json"), "{}\n");
    await git(fixture.candidateRoot, ["add", "release.json"]);
    await git(fixture.candidateRoot, [
      "commit",
      "-q",
      "-m",
      "chore: prepare release",
    ]);
    const { stdout: headOutput } = await git(fixture.candidateRoot, [
      "rev-parse",
      "HEAD",
    ]);
    const result = await run(
      broker,
      [...brokerArguments(fixture), "--base", "main"],
      { cwd: fixture.candidateRoot },
    );
    assert.equal(result.code, 0, result.stderr);
    const envelope = JSON.parse(
      await readFile(fixture.capturedCapabilityPath, "utf8"),
    );
    const payload = JSON.parse(
      Buffer.from(envelope.payloadBase64, "base64").toString("utf8"),
    );
    assert.equal(payload.scope.schemaVersion, 2);
    assert.equal(payload.scope.branch, "chore/release-v26.7.1001");
    assert.equal(payload.scope.base, "main");
    assert.equal(payload.scope.baseSha, fixture.baseSha);
    assert.equal(payload.scope.headSha, headOutput.trim());
    assert.equal(payload.scope.publishMode, "production-release-prep");
  },
);

test(
  "native broker issues a signed task-bound owner capability after owner authorization",
  { skip: !darwinOnly },
  async (t) => {
    const fixture = await createFixture();
    t.after(
      async () =>
        await rm(fixture.fixtureRoot, { recursive: true, force: true }),
    );
    const taskId = "owner-governance-test";
    const intentDigest = "a".repeat(64);
    const result = await run(
      broker,
      [
        "--test-config",
        fixture.configPath,
        "--test-secret-file",
        fixture.secretPath,
        "--test-owner-authorized",
        "owner-capability",
        "--task-id",
        taskId,
        "--intent-digest",
        intentDigest,
        "--ttl-seconds",
        "600",
      ],
      { cwd: fixture.candidateRoot },
    );
    assert.equal(result.code, 0, result.stderr);
    const issued = JSON.parse(result.stdout);
    assert.equal(issued.taskId, taskId);
    assert.equal(issued.intentDigest, intentDigest);
    assert.equal(issued.leaseTtlMs, 600_000);
    const envelope = JSON.parse(await readFile(issued.capabilityFile, "utf8"));
    const payloadBytes = Buffer.from(envelope.payloadBase64, "base64");
    assert.equal(
      verifySignature(
        null,
        payloadBytes,
        fixture.publicKey,
        Buffer.from(envelope.signatureBase64, "base64"),
      ),
      true,
    );
    const payload = verifyOwnerCapabilityEnvelope({
      envelope,
      publicKeyBase64: fixture.config.publisherPublicKeyBase64,
      stateRoot: fixture.stateRoot,
      taskId,
      intentDigest,
      leaseToken: issued.leaseToken,
      ttlMs: 600_000,
      nowMs: Date.now(),
    });
    assert.equal(payload.actor, "freed-owner");
    assert.equal(payload.leaseName, "owner-governance");
    assert.equal(payload.stateRoot, fixture.stateRoot);
  },
);

test(
  "native broker refuses owner capability issuance without OS authorization",
  { skip: !darwinOnly },
  async (t) => {
    const fixture = await createFixture();
    t.after(
      async () =>
        await rm(fixture.fixtureRoot, { recursive: true, force: true }),
    );
    const result = await run(
      broker,
      [
        "--test-config",
        fixture.configPath,
        "--test-secret-file",
        fixture.secretPath,
        "owner-capability",
        "--task-id",
        "owner-governance-test",
        "--intent-digest",
        "a".repeat(64),
        "--ttl-seconds",
        "600",
      ],
      { cwd: fixture.candidateRoot },
    );
    assert.equal(result.code, 1);
    assert.match(result.stderr, /device owner authentication is required/);
  },
);

test(
  "native publisher host refuses a group or world writable config file",
  { skip: !darwinOnly },
  async (t) => {
    const fixture = await createFixture();
    t.after(
      async () =>
        await rm(fixture.fixtureRoot, { recursive: true, force: true }),
    );
    await chmod(fixture.configPath, 0o666);
    const result = await run(broker, brokerArguments(fixture), {
      cwd: fixture.candidateRoot,
    });
    assert.equal(result.code, 1);
    assert.match(result.stderr, /unsafe permissions/);
    await assert.rejects(readFile(fixture.capturePath), { code: "ENOENT" });
  },
);

test(
  "native publisher host refuses a launcher that differs from its pinned digest",
  { skip: !darwinOnly },
  async (t) => {
    const fixture = await createFixture();
    t.after(
      async () =>
        await rm(fixture.fixtureRoot, { recursive: true, force: true }),
    );
    const mismatched = { ...fixture.config, launcherSha256: "0".repeat(64) };
    await writeFile(
      fixture.configPath,
      `${JSON.stringify(mismatched, null, 2)}\n`,
      { mode: 0o600 },
    );
    const result = await run(broker, brokerArguments(fixture), {
      cwd: fixture.candidateRoot,
    });
    assert.equal(result.code, 1);
    assert.match(result.stderr, /launcher does not match its pinned digest/);
  },
);

test(
  "native publisher host refuses an automation control entry that differs from its pin",
  { skip: !darwinOnly },
  async (t) => {
    const fixture = await createFixture();
    t.after(
      async () =>
        await rm(fixture.fixtureRoot, { recursive: true, force: true }),
    );
    const mismatched = {
      ...fixture.config,
      automationControlSha256: "0".repeat(64),
    };
    await writeFile(
      fixture.configPath,
      `${JSON.stringify(mismatched, null, 2)}\n`,
      {
        mode: 0o600,
      },
    );
    const result = await run(broker, brokerArguments(fixture), {
      cwd: fixture.candidateRoot,
      env: process.env,
    });
    assert.notEqual(result.code, 0);
    assert.match(
      result.stderr,
      /automation control entry does not match its pinned digest/,
    );
    await assert.rejects(readFile(fixture.capturedCapabilityPath), {
      code: "ENOENT",
    });
  },
);

test(
  "native publisher host refuses a publisher public-key record that differs from root trust",
  { skip: !darwinOnly },
  async (t) => {
    const fixture = await createFixture();
    t.after(
      async () =>
        await rm(fixture.fixtureRoot, { recursive: true, force: true }),
    );
    const credentialPath = path.join(
      fixture.stateRoot,
      "control",
      "actor-credentials",
      "freed-pr-publisher.json",
    );
    await writeFile(
      credentialPath,
      `${JSON.stringify({
        schemaVersion: 1,
        actor: "freed-pr-publisher",
        purpose: "publisher-capability-signing",
        publicKeyBase64: Buffer.alloc(32, 9).toString("base64"),
      })}\n`,
      { mode: 0o600 },
    );
    const result = await run(broker, brokerArguments(fixture), {
      cwd: fixture.candidateRoot,
      env: process.env,
    });
    assert.notEqual(result.code, 0);
    assert.match(
      result.stderr,
      /public key record does not match the root-owned key pin/,
    );
    await assert.rejects(readFile(fixture.capturedCapabilityPath), {
      code: "ENOENT",
    });
  },
);

test(
  "native publisher host refuses a dirty approved control checkout",
  { skip: !darwinOnly },
  async (t) => {
    const fixture = await createFixture();
    t.after(
      async () =>
        await rm(fixture.fixtureRoot, { recursive: true, force: true }),
    );
    await writeFile(path.join(fixture.controlRoot, "untracked.txt"), "dirty\n");
    const result = await run(broker, brokerArguments(fixture), {
      cwd: fixture.candidateRoot,
    });
    assert.equal(result.code, 1);
    assert.match(result.stderr, /control checkout is not clean/);
  },
);

test(
  "production publisher host refuses an ad hoc unsigned test build before Keychain access",
  { skip: !darwinOnly },
  async () => {
    const fixtureRoot = await realpath(
      await mkdtemp(
        path.join(os.tmpdir(), "freed-publisher-production-refusal-"),
      ),
    );
    try {
      const result = await run(productionBroker, [], { cwd: fixtureRoot });
      assert.equal(result.code, 1);
      assert.match(
        result.stderr,
        /non-adhoc hardened runtime signature|code signature is invalid|code signature cannot be inspected/,
      );
    } finally {
      await rm(fixtureRoot, { recursive: true, force: true });
    }
  },
);
