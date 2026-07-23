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
  readdir,
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
  return await startRun(executable, args, options).result;
}

function startRun(executable, args, options = {}) {
  const environment = {
    ...process.env,
    DEVELOPER_DIR: developerDirectory,
    ...(options.env ?? {}),
  };
  let child;
  const result = new Promise((resolve, reject) => {
    child = execFile(
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

async function createFixture({ launcherMode = "capture" } = {}) {
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
  const wrapperReadyPath = path.join(stateRoot, "test-publisher-wrapper-ready");
  const wrapperPidPath = path.join(stateRoot, "test-publisher-wrapper.pid");
  const descendantPidPath = path.join(
    stateRoot,
    "test-publisher-descendant.pid",
  );
  const externalMutationPath = path.join(
    stateRoot,
    "test-publisher-external-mutation",
  );
  const wrapperExecutedPath = path.join(
    stateRoot,
    "test-publisher-wrapper-executed",
  );
  const beforeSpawnReadyPath = path.join(
    stateRoot,
    "test-publisher-before-spawn-ready",
  );
  const finalizationBlockedPath = path.join(
    stateRoot,
    "test-publisher-finalization-blocked",
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
lease_handoff_safe=0
if [[ "\${FREED_PUBLISHER_ACQUIRE_OPERATION_ID:-}" =~ ^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$ && \${#FREED_PUBLISHER_ACQUIRE_TOKEN} -ge 32 && \${#FREED_PUBLISHER_ACQUIRE_TOKEN} -le 4096 ]]; then
  lease_handoff_safe=1
fi
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
  printf 'lease_handoff_safe=%s\\n' "\${lease_handoff_safe}"
  printf 'lease_operation_id=%s\\n' "\${FREED_PUBLISHER_ACQUIRE_OPERATION_ID}"
  printf 'lease_token_sha256=%s\\n' "$(printf '%s' "\${FREED_PUBLISHER_ACQUIRE_TOKEN}" | /usr/bin/shasum -a 256 | /usr/bin/awk '{ print $1 }')"
  printf 'capability_private=%s\\n' "\${capability_private}"
  printf 'cwd_match=%s\\n' "\${cwd_match}"
  printf 'args_match=%s\\n' "\${args_match}"
} > "$2"
if [[ "\${environment_safe}" != 1 || "\${lease_handoff_safe}" != 1 || "\${capability_private}" != 1 || "\${cwd_match}" != 1 || "\${args_match}" != 1 ]]; then
  exit 22
fi
`,
    { mode: 0o700 },
  );
  if (launcherMode === "sigkill-after-acquire") {
    await writeFile(
      launcher,
      `#!/bin/bash
set -eu
lease_file="\${FREED_TRUSTED_STATE_ROOT}/test-publisher-lease.json"
retry_file="\${FREED_TRUSTED_STATE_ROOT}/test-publisher-release-retry"
show_retry_file="\${FREED_TRUSTED_STATE_ROOT}/test-publisher-show-retry"
printf '{"name":"pr-publisher","owner":"freed-pr-publisher","token":"%s"}\\n' "\${FREED_PUBLISHER_ACQUIRE_TOKEN}" > "\${lease_file}"
: > "\${retry_file}"
: > "\${show_retry_file}"
kill -KILL $$
`,
      { mode: 0o700 },
    );
  }
  if (launcherMode === "block-after-acquire") {
    await writeFile(
      launcher,
      `#!/bin/bash
set -eu
lease_file="\${FREED_TRUSTED_STATE_ROOT}/test-publisher-lease.json"
retry_file="\${FREED_TRUSTED_STATE_ROOT}/test-publisher-release-retry"
show_retry_file="\${FREED_TRUSTED_STATE_ROOT}/test-publisher-show-retry"
printf '{"name":"pr-publisher","owner":"freed-pr-publisher","token":"%s"}\\n' "\${FREED_PUBLISHER_ACQUIRE_TOKEN}" > "\${lease_file}"
: > "\${retry_file}"
: > "\${show_retry_file}"
printf '%s\\n' "$$" > ${JSON.stringify(wrapperPidPath)}
/bin/sleep 30 &
descendant_pid="$!"
printf '%s\\n' "\${descendant_pid}" > ${JSON.stringify(descendantPidPath)}
: > ${JSON.stringify(wrapperReadyPath)}
wait "\${descendant_pid}" || true
printf 'external mutation after cancellation\\n' > ${JSON.stringify(externalMutationPath)}
`,
      { mode: 0o700 },
    );
  }
  if (launcherMode === "cancel-before-spawn") {
    await writeFile(
      path.join(stateRoot, "test-publisher-before-spawn-pause"),
      "",
      { mode: 0o600 },
    );
    await writeFile(
      launcher,
      `#!/bin/bash
set -eu
printf executed > ${JSON.stringify(wrapperExecutedPath)}
printf mutation > ${JSON.stringify(externalMutationPath)}
`,
      { mode: 0o700 },
    );
  }
  if (launcherMode === "post-child-finalization") {
    await writeFile(
      launcher,
      `#!/bin/bash
set -eu
lease_file="\${FREED_TRUSTED_STATE_ROOT}/test-publisher-lease.json"
retry_file="\${FREED_TRUSTED_STATE_ROOT}/test-publisher-release-retry"
show_retry_file="\${FREED_TRUSTED_STATE_ROOT}/test-publisher-show-retry"
printf '{"name":"pr-publisher","owner":"freed-pr-publisher","token":"%s"}\n' "\${FREED_PUBLISHER_ACQUIRE_TOKEN}" > "\${lease_file}"
: > "\${retry_file}"
: > "\${show_retry_file}"
: > "\${FREED_TRUSTED_STATE_ROOT}/test-publisher-finalization-pause"
exit 0
`,
      { mode: 0o700 },
    );
  }
  if (launcherMode === "trap-release") {
    await writeFile(
      launcher,
      `#!/bin/bash
set -eu
lease_file="\${FREED_TRUSTED_STATE_ROOT}/test-publisher-lease.json"
retry_file="\${FREED_TRUSTED_STATE_ROOT}/test-publisher-release-retry"
show_retry_file="\${FREED_TRUSTED_STATE_ROOT}/test-publisher-show-retry"
printf '{"name":"pr-publisher","owner":"freed-pr-publisher","token":"%s"}\n' "\${FREED_PUBLISHER_ACQUIRE_TOKEN}" > "\${lease_file}"
: > "\${retry_file}"
: > "\${show_retry_file}"
/bin/rm -f "\${lease_file}"
exit 0
`,
      { mode: 0o700 },
    );
  }
  if (launcherMode === "self-sigterm") {
    await writeFile(
      launcher,
      `#!/bin/bash
set -eu
lease_file="\${FREED_TRUSTED_STATE_ROOT}/test-publisher-lease.json"
retry_file="\${FREED_TRUSTED_STATE_ROOT}/test-publisher-release-retry"
show_retry_file="\${FREED_TRUSTED_STATE_ROOT}/test-publisher-show-retry"
printf '{"name":"pr-publisher","owner":"freed-pr-publisher","token":"%s"}\n' "\${FREED_PUBLISHER_ACQUIRE_TOKEN}" > "\${lease_file}"
: > "\${retry_file}"
: > "\${show_retry_file}"
kill -TERM $$
printf mutation > ${JSON.stringify(externalMutationPath)}
`,
      { mode: 0o700 },
    );
  }

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
  await writeFile(
    automationControl,
    `import { appendFileSync, existsSync, readFileSync, unlinkSync } from "node:fs";
const args = process.argv.slice(2);
const action = args[1];
const stateRoot = args[args.indexOf("--state-root") + 1];
const leasePath = stateRoot + "/test-publisher-lease.json";
const retryPath = stateRoot + "/test-publisher-release-retry";
const showRetryPath = stateRoot + "/test-publisher-show-retry";
const logPath = stateRoot + "/test-publisher-control.jsonl";
appendFileSync(logPath, JSON.stringify({
  action,
  operationId: process.env.FREED_AUTOMATION_LEASE_OPERATION_ID ?? null,
  leaseTokenPresent: Object.hasOwn(process.env, "FREED_AUTOMATION_LEASE_TOKEN"),
  persistentCredentialPresent: Object.hasOwn(process.env, "FREED_AUTOMATION_ACTOR_TOKEN"),
}) + "\\n");
if (action === "release" && existsSync(retryPath)) {
  unlinkSync(retryPath);
  process.exit(91);
}
if (action === "show" && existsSync(showRetryPath)) {
  unlinkSync(showRetryPath);
  process.exit(92);
}
const lease = existsSync(leasePath)
  ? JSON.parse(readFileSync(leasePath, "utf8"))
  : null;
if (action === "release") {
  const released = lease?.token === process.env.FREED_AUTOMATION_LEASE_TOKEN;
  if (released) unlinkSync(leasePath);
  process.stdout.write(JSON.stringify({
    ok: true,
    schemaVersion: 1,
    action: "lease.release",
    stateRoot,
    result: {
      released,
      lease: { name: "pr-publisher", owner: "freed-pr-publisher" },
    },
  }) + "\\n");
  process.exit(0);
}
if (action === "show") {
  process.stdout.write(JSON.stringify({
    ok: true,
    schemaVersion: 1,
    action: "lease.show",
    stateRoot,
    result: lease
      ? { name: lease.name, owner: lease.owner, status: "active" }
      : null,
  }) + "\\n");
  process.exit(0);
}
process.exit(92);
`,
    { mode: 0o600 },
  );
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
    publisherLeasePath: path.join(stateRoot, "test-publisher-lease.json"),
    publisherControlLogPath: path.join(
      stateRoot,
      "test-publisher-control.jsonl",
    ),
    pendingCapabilityRoot: path.join(
      stateRoot,
      "control",
      "publisher-capabilities",
      "pending",
    ),
    wrapperReadyPath,
    wrapperPidPath,
    descendantPidPath,
    externalMutationPath,
    wrapperExecutedPath,
    beforeSpawnReadyPath,
    finalizationBlockedPath,
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
    const handoff = Object.fromEntries(
      (await readFile(fixture.capturePath, "utf8"))
        .trim()
        .split("\n")
        .map((line) => line.split("=", 2)),
    );
    assert.equal(handoff.environment_safe, "1");
    assert.equal(handoff.lease_handoff_safe, "1");
    assert.equal(handoff.capability_private, "1");
    assert.equal(handoff.cwd_match, "1");
    assert.equal(handoff.args_match, "1");
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
    assert.match(
      payload.leaseOperationId,
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    assert.equal(payload.leaseOperationId, handoff.lease_operation_id);
    assert.equal(payload.tokenSha256, handoff.lease_token_sha256);
  },
);

test(
  "native publisher broker reclaims the exact lease after its wrapper is killed",
  { skip: !darwinOnly },
  async (t) => {
    const fixture = await createFixture({
      launcherMode: "sigkill-after-acquire",
    });
    t.after(
      async () =>
        await rm(fixture.fixtureRoot, { recursive: true, force: true }),
    );
    const result = await run(broker, brokerArguments(fixture), {
      cwd: fixture.candidateRoot,
    });
    assert.equal(result.code, 137, result.stderr);
    await assert.rejects(readFile(fixture.publisherLeasePath), {
      code: "ENOENT",
    });
    const calls = (await readFile(fixture.publisherControlLogPath, "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    const releases = calls.filter((call) => call.action === "release");
    assert.equal(releases.length, 2);
    assert.match(
      releases[0].operationId,
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    assert.equal(releases[0].operationId, releases[1].operationId);
    assert.ok(releases.every((call) => call.leaseTokenPresent === true));
    assert.ok(
      calls.every((call) => call.persistentCredentialPresent === false),
    );
    const inspections = calls.filter((call) => call.action === "show");
    assert.equal(inspections.length, 2);
    assert.ok(inspections.every((call) => call.operationId === null));
    assert.ok(inspections.every((call) => call.leaseTokenPresent === false));
  },
);

test(
  "native publisher broker owns SIGTERM cancellation before its blocked wrapper can mutate",
  { skip: !darwinOnly, timeout: 15_000 },
  async (t) => {
    const fixture = await createFixture({ launcherMode: "block-after-acquire" });
    let wrapperPid;
    let descendantPid;
    const execution = startRun(broker, brokerArguments(fixture), {
      cwd: fixture.candidateRoot,
    });
    t.after(async () => {
      execution.child.kill("SIGKILL");
      for (const pid of [wrapperPid, descendantPid]) {
        if (Number.isInteger(pid) && processExists(pid)) {
          process.kill(pid, "SIGKILL");
        }
      }
      await rm(fixture.fixtureRoot, { recursive: true, force: true });
    });

    await waitForFile(fixture.wrapperReadyPath);
    wrapperPid = Number((await readFile(fixture.wrapperPidPath, "utf8")).trim());
    descendantPid = Number(
      (await readFile(fixture.descendantPidPath, "utf8")).trim(),
    );
    assert.ok(Number.isInteger(wrapperPid) && wrapperPid > 1);
    assert.ok(Number.isInteger(descendantPid) && descendantPid > 1);
    assert.equal(processExists(wrapperPid), true);
    assert.equal(processExists(descendantPid), true);

    assert.equal(execution.child.kill("SIGTERM"), true);
    const result = await execution.result;
    assert.equal(result.code, 143, result.stderr);
    assert.equal(await waitForProcessExit(wrapperPid), true);
    assert.equal(await waitForProcessExit(descendantPid), true);
    await assert.rejects(readFile(fixture.publisherLeasePath), {
      code: "ENOENT",
    });
    await new Promise((resolve) => setTimeout(resolve, 250));
    await assert.rejects(readFile(fixture.externalMutationPath), {
      code: "ENOENT",
    });

    const calls = (await readFile(fixture.publisherControlLogPath, "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    const releases = calls.filter((call) => call.action === "release");
    assert.equal(releases.length, 2);
    assert.match(
      releases[0].operationId,
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    assert.equal(releases[0].operationId, releases[1].operationId);
    assert.ok(releases.every((call) => call.leaseTokenPresent === true));
    const inspections = calls.filter((call) => call.action === "show");
    assert.equal(inspections.length, 2);
    assert.ok(inspections.every((call) => call.operationId === null));
    assert.ok(inspections.every((call) => call.leaseTokenPresent === false));
    assert.ok(
      calls.every((call) => call.persistentCredentialPresent === false),
    );
  },
);

test(
  "native publisher broker owns SIGINT and SIGTERM before spawn without running the wrapper",
  { skip: !darwinOnly, timeout: 20_000 },
  async (t) => {
    for (const [signal, expectedCode] of [
      ["SIGINT", 130],
      ["SIGTERM", 143],
    ]) {
      const fixture = await createFixture({ launcherMode: "cancel-before-spawn" });
      const execution = startRun(broker, brokerArguments(fixture), {
        cwd: fixture.candidateRoot,
      });
      t.after(async () => {
        execution.child.kill("SIGKILL");
        await rm(fixture.fixtureRoot, { recursive: true, force: true });
      });
      await waitForFile(fixture.beforeSpawnReadyPath);
      assert.equal(execution.child.kill(signal), true);
      const result = await execution.result;
      assert.equal(result.code, expectedCode, result.stderr);
      await assert.rejects(readFile(fixture.wrapperExecutedPath), {
        code: "ENOENT",
      });
      await assert.rejects(readFile(fixture.externalMutationPath), {
        code: "ENOENT",
      });
      await assert.rejects(readFile(fixture.publisherLeasePath), {
        code: "ENOENT",
      });
      assert.deepEqual(await readdir(fixture.pendingCapabilityRoot), []);
      const calls = (await readFile(fixture.publisherControlLogPath, "utf8"))
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line));
      const releases = calls.filter((call) => call.action === "release");
      const inspections = calls.filter((call) => call.action === "show");
      assert.equal(releases.length, 2);
      assert.equal(releases[0].operationId, releases[1].operationId);
      assert.ok(releases.every((call) => call.leaseTokenPresent === true));
      assert.equal(inspections.length, 1);
      assert.ok(inspections.every((call) => call.leaseTokenPresent === false));
      assert.ok(
        calls.every((call) => call.persistentCredentialPresent === false),
      );
    }
  },
);

test(
  "native publisher broker owns SIGINT during wrapper wait and reaps the group",
  { skip: !darwinOnly, timeout: 15_000 },
  async (t) => {
    const fixture = await createFixture({ launcherMode: "block-after-acquire" });
    let wrapperPid;
    let descendantPid;
    const execution = startRun(broker, brokerArguments(fixture), {
      cwd: fixture.candidateRoot,
    });
    t.after(async () => {
      execution.child.kill("SIGKILL");
      for (const pid of [wrapperPid, descendantPid]) {
        if (Number.isInteger(pid) && processExists(pid)) {
          process.kill(pid, "SIGKILL");
        }
      }
      await rm(fixture.fixtureRoot, { recursive: true, force: true });
    });
    await waitForFile(fixture.wrapperReadyPath);
    wrapperPid = Number((await readFile(fixture.wrapperPidPath, "utf8")).trim());
    descendantPid = Number(
      (await readFile(fixture.descendantPidPath, "utf8")).trim(),
    );
    assert.equal(execution.child.kill("SIGINT"), true);
    const result = await execution.result;
    assert.equal(result.code, 130, result.stderr);
    assert.equal(await waitForProcessExit(wrapperPid), true);
    assert.equal(await waitForProcessExit(descendantPid), true);
    await assert.rejects(readFile(fixture.publisherLeasePath), {
      code: "ENOENT",
    });
    await new Promise((resolve) => setTimeout(resolve, 250));
    await assert.rejects(readFile(fixture.externalMutationPath), {
      code: "ENOENT",
    });
  },
);

test(
  "native publisher terminal drain returns queued SIGINT and SIGTERM after capability cleanup",
  { skip: !darwinOnly, timeout: 20_000 },
  async (t) => {
    for (const [signal, expectedCode] of [
      ["SIGINT", 130],
      ["SIGTERM", 143],
    ]) {
      const fixture = await createFixture({
        launcherMode: "post-child-finalization",
      });
      const execution = startRun(broker, brokerArguments(fixture), {
        cwd: fixture.candidateRoot,
      });
      t.after(async () => {
        execution.child.kill("SIGKILL");
        await rm(fixture.fixtureRoot, { recursive: true, force: true });
      });
      await waitForFile(fixture.finalizationBlockedPath);
      assert.equal(execution.child.kill(signal), true);
      const result = await execution.result;
      assert.equal(result.code, expectedCode, result.stderr);
      await assert.rejects(readFile(fixture.publisherLeasePath), {
        code: "ENOENT",
      });
      assert.deepEqual(await readdir(fixture.pendingCapabilityRoot), []);
      const calls = (await readFile(fixture.publisherControlLogPath, "utf8"))
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line));
      const releases = calls.filter((call) => call.action === "release");
      const inspections = calls.filter((call) => call.action === "show");
      assert.equal(releases.length, 2);
      assert.equal(releases[0].operationId, releases[1].operationId);
      assert.equal(inspections.length, 2);
      assert.ok(releases.every((call) => call.leaseTokenPresent === true));
      assert.ok(inspections.every((call) => call.leaseTokenPresent === false));
      assert.ok(
        calls.every((call) => call.persistentCredentialPresent === false),
      );
    }
  },
);

test(
  "native publisher broker confirms absence after wrapper and broker cleanup race",
  { skip: !darwinOnly },
  async (t) => {
    const fixture = await createFixture({ launcherMode: "trap-release" });
    t.after(
      async () =>
        await rm(fixture.fixtureRoot, { recursive: true, force: true }),
    );
    const result = await run(broker, brokerArguments(fixture), {
      cwd: fixture.candidateRoot,
    });
    assert.equal(result.code, 0, result.stderr);
    await assert.rejects(readFile(fixture.publisherLeasePath), {
      code: "ENOENT",
    });
    const calls = (await readFile(fixture.publisherControlLogPath, "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    const releases = calls.filter((call) => call.action === "release");
    const inspections = calls.filter((call) => call.action === "show");
    assert.equal(releases.length, 2);
    assert.equal(releases[0].operationId, releases[1].operationId);
    assert.equal(inspections.length, 2);
    assert.ok(
      calls.every((call) => call.persistentCredentialPresent === false),
    );
  },
);

test(
  "native publisher wrapper receives default unblocked SIGTERM",
  { skip: !darwinOnly },
  async (t) => {
    const fixture = await createFixture({ launcherMode: "self-sigterm" });
    t.after(
      async () =>
        await rm(fixture.fixtureRoot, { recursive: true, force: true }),
    );
    const result = await run(broker, brokerArguments(fixture), {
      cwd: fixture.candidateRoot,
    });
    assert.equal(result.code, 143, result.stderr);
    await assert.rejects(readFile(fixture.externalMutationPath), {
      code: "ENOENT",
    });
    await assert.rejects(readFile(fixture.publisherLeasePath), {
      code: "ENOENT",
    });
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
    assert.match(
      issued.leaseOperationId,
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
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
