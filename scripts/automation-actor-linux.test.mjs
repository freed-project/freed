import assert from "node:assert/strict";
import { execFile, execFileSync, spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmod,
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import test, { after, before } from "node:test";

const execFileAsync = promisify(execFile);
const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const linuxOnly = process.platform === "linux";
const actorHostSource = path.join(
  repoRoot,
  "scripts",
  "automation-actor-host-linux.go",
);
const buildHelper = path.join(
  repoRoot,
  "scripts",
  "automation-actor-host-build.sh",
);
const actor = "freed-nightly-runner";
const leaseName = "nightly-writer";
const authority = {
  observer: "merge-safe",
  provider: "approval-required",
};

let goExecutable = "";
let buildRoot = "";
let testHost = "";

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

async function sha256File(file) {
  return sha256(await readFile(file));
}

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

function controlEntrySource() {
  return `
import { appendFileSync, existsSync, readFileSync, rmSync } from "node:fs";
const action = process.argv[3];
const value = (name) => process.argv[process.argv.indexOf(name) + 1];
const stateRoot = value("--state-root");
const name = value("--name");
const leasePath = stateRoot + "/linux-test-lease.json";
const logPath = stateRoot + "/linux-test-cleanup.jsonl";
appendFileSync(logPath, JSON.stringify({
  action,
  operationId: process.env.FREED_AUTOMATION_LEASE_OPERATION_ID ?? null,
  tokenPresent: Boolean(process.env.FREED_AUTOMATION_LEASE_TOKEN),
}) + "\\n");
if (action === "release") {
  const lease = existsSync(leasePath)
    ? JSON.parse(readFileSync(leasePath, "utf8"))
    : { schemaVersion: 1, name, owner: ${JSON.stringify(actor)}, status: "expired" };
  rmSync(leasePath, { force: true });
  process.stdout.write(JSON.stringify({
    ok: true,
    schemaVersion: 1,
    action: "lease.release",
    stateRoot,
    result: { released: true, lease },
  }) + "\\n");
} else if (action === "show") {
  const lease = existsSync(leasePath)
    ? JSON.parse(readFileSync(leasePath, "utf8"))
    : null;
  process.stdout.write(JSON.stringify({
    ok: true,
    schemaVersion: 1,
    action: "lease.show",
    stateRoot,
    result: lease,
  }) + "\\n");
} else {
  process.exit(2);
}
`;
}

function actorControlSource(mode, markerPath, environmentPath, launcherPath) {
  return `
import { appendFileSync, closeSync, readSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
const MODE = ${JSON.stringify(mode)};
const MARKER = ${JSON.stringify(markerPath)};
const ENVIRONMENT = ${JSON.stringify(environmentPath)};
const value = (name) => process.argv[process.argv.indexOf(name) + 1];
const frameBytes = [];
const byte = Buffer.alloc(1);
while (frameBytes.length < 8192) {
  const count = readSync(3, byte, 0, 1, null);
  if (count !== 1) throw new Error("missing launcher frame");
  if (byte[0] === 10) break;
  frameBytes.push(byte[0]);
}
const frame = JSON.parse(Buffer.from(frameBytes).toString("utf8"));
const tokenSha256 = createHash("sha256").update(frame.leaseToken).digest("hex");
const verification = spawnSync(${JSON.stringify(launcherPath)}, [
  "--verify-control-channel",
  "--protocol", "freed-actor-launcher-channel-v1",
  "--channel-action", value("--action"),
  "--actor", value("--actor"),
  "--state-root", value("--state-root"),
  "--lease-name", value("--lease-name"),
  "--operation-id", frame.leaseOperationId,
  "--token-sha256", tokenSha256,
  "--ttl-seconds", value("--ttl-seconds"),
  "--challenge-sha256", value("--challenge-sha256"),
  "--control-pid", String(process.pid),
  "--channel-fd", "3",
  "--test-binding", value("--test-binding"),
  "--test-runtime-root", value("--test-runtime-root"),
], {
  encoding: "utf8",
  env: {},
  stdio: ["ignore", "pipe", "pipe", 3],
});
if (verification.status !== 0) {
  process.stderr.write(verification.stderr || "channel verification failed\\n");
  process.exit(1);
}
const channel = JSON.parse(verification.stdout);
writeFileSync(ENVIRONMENT, JSON.stringify(Object.keys(process.env).sort()));
if (value("--action") === "attest") {
  process.stdout.write(JSON.stringify({
    schemaVersion: 1,
    protocol: "freed-actor-launcher-readiness-v3",
    purpose: "automation-actor-launcher-readiness",
    actor: value("--actor"),
    stateRoot: value("--state-root"),
    leaseName: value("--lease-name"),
    maxLeaseLifetimeMs: 1800000,
    handoff: "trusted-launcher-channel-to-canonical-lease",
    channelProtocol: "freed-actor-launcher-channel-v1",
    launcherSha256: channel.launcherSha256,
    runtimeDigest: channel.runtimeDigest,
    canonicalLeaseReady: true,
    mutatesState: false,
  }) + "\\n");
  process.exit(0);
}
const stateRoot = value("--state-root");
const lease = {
  schemaVersion: 1,
  name: value("--lease-name"),
  owner: value("--actor"),
  token: frame.leaseToken,
  observerAuthority: MODE === "wrong-authority" ? "forbidden" : ${JSON.stringify(authority.observer)},
  providerAuthority: ${JSON.stringify(authority.provider)},
  credentialKind: "trusted-launcher-channel",
  launcherSha256: channel.launcherSha256,
  actorRuntimeDigest: channel.runtimeDigest,
  launcherChannelProtocol: "freed-actor-launcher-channel-v1",
  launcherAttestationSha256: createHash("sha256").update(verification.stdout).digest("hex"),
  launcherSessionId: channel.sessionId,
  acquiredAt: "2026-08-14T19:00:00.000Z",
  heartbeatAt: "2026-08-14T19:00:00.000Z",
  expiresAt: "2026-08-14T19:30:00.000Z",
  ttlMs: 1800000,
};
writeFileSync(stateRoot + "/linux-test-lease.json", JSON.stringify(lease));
appendFileSync(stateRoot + "/linux-test-acquire.jsonl", JSON.stringify({
  operationId: frame.leaseOperationId,
  tokenSha256,
}) + "\\n");
if (MODE === "response-loss-once") {
  const countPath = stateRoot + "/linux-test-attempt";
  try {
    writeFileSync(countPath, "first", { flag: "wx" });
    process.exit(1);
  } catch {}
}
if (MODE === "cancel-delay") {
  writeFileSync(MARKER, "ready");
  await new Promise((resolve) => setTimeout(resolve, 10000));
}
const envelope = {
  ok: true,
  schemaVersion: 1,
  action: "lease.acquire",
  stateRoot,
  result: {
    acquired: true,
    takeover: false,
    credentialUpgrade: false,
    lease,
  },
};
if (MODE === "extra-envelope") envelope.extra = true;
process.stdout.write(JSON.stringify(envelope) + "\\n");
closeSync(3);
`;
}

before(async () => {
  if (!linuxOnly) return;
  goExecutable = execFileSync(
    "/usr/bin/env",
    ["bash", "-lc", "command -v go"],
    {
      encoding: "utf8",
    },
  ).trim();
  assert.ok(
    path.isAbsolute(goExecutable),
    "Linux native tests require Go on PATH",
  );
  buildRoot = await mkdtemp(
    path.join(repoRoot, ".automation-actor-linux-build-"),
  );
  await chmod(buildRoot, 0o700);
  testHost = path.join(buildRoot, "automation-actor-host-test");
  await execFileAsync(
    goExecutable,
    [
      "build",
      "-trimpath",
      "-ldflags",
      `-s -w -X main.buildMode=host -X main.testingMode=true -X main.trustedUID=${process.getuid()}`,
      "-o",
      testHost,
      actorHostSource,
    ],
    {
      cwd: repoRoot,
      env: { ...process.env, GO111MODULE: "off", CGO_ENABLED: "0" },
    },
  );
});

after(async () => {
  if (buildRoot) await rm(buildRoot, { recursive: true, force: true });
});

async function createFixture(mode = "valid") {
  const fixtureRoot = await mkdtemp(
    path.join(repoRoot, ".automation-actor-linux-fixture-"),
  );
  await chmod(fixtureRoot, 0o700);
  const bindingRoot = path.join(fixtureRoot, "automation-actor-launchers");
  const launcherBin = path.join(bindingRoot, "bin");
  const runtimeRoot = path.join(fixtureRoot, "automation-actor-runtimes");
  const stateRoot = path.join(fixtureRoot, "state");
  const markerPath = path.join(fixtureRoot, "handoff-ready");
  const environmentPath = path.join(fixtureRoot, "environment.json");
  await Promise.all([
    mkdir(launcherBin, { recursive: true, mode: 0o700 }),
    mkdir(runtimeRoot, { mode: 0o700 }),
    mkdir(stateRoot, { mode: 0o700 }),
  ]);
  for (const directory of [bindingRoot, launcherBin, runtimeRoot, stateRoot]) {
    await chmod(directory, 0o700);
  }
  const launcherSha256 = await sha256File(testHost);
  const launcherPath = path.join(launcherBin, `${actor}-${launcherSha256}`);
  const files = {
    controlEntry: Buffer.from(controlEntrySource()),
    actorControl: Buffer.from(
      actorControlSource(mode, markerPath, environmentPath, launcherPath),
    ),
    controlLibrary: Buffer.from("export {};\n"),
    readinessLibrary: Buffer.from("export {};\n"),
    kernelGuardContract: Buffer.from("export {};\n"),
    outcomeLedgerRepairContract: Buffer.from("export {};\n"),
    leaseArchiveHelper: Buffer.from("print('linux fixture')\n"),
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
    controlEntryPath: path.join(runtimeDirectory, "automation-control.mjs"),
    actorControlEntryPath: path.join(
      runtimeDirectory,
      "automation-actor-control.mjs",
    ),
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
  await chmod(paths.nodePath, 0o555);
  for (const [file, bytes] of [
    [paths.controlEntryPath, files.controlEntry],
    [paths.actorControlEntryPath, files.actorControl],
    [paths.controlLibraryPath, files.controlLibrary],
    [paths.readinessLibraryPath, files.readinessLibrary],
    [paths.kernelGuardContractPath, files.kernelGuardContract],
    [paths.outcomeLedgerRepairContractPath, files.outcomeLedgerRepairContract],
    [paths.leaseArchiveHelperPath, files.leaseArchiveHelper],
  ]) {
    await writeFile(file, bytes, { mode: 0o444 });
    await chmod(file, 0o444);
  }
  await copyFile(testHost, launcherPath);
  await chmod(launcherPath, 0o555);
  const bindingPath = path.join(bindingRoot, `${actor}.json`);
  await writeFile(
    bindingPath,
    `${JSON.stringify({
      schemaVersion: 4,
      actor,
      purpose: "automation-actor-launcher",
      handoff: "trusted-launcher-channel-to-canonical-lease",
      attestationProtocol: "freed-actor-launcher-readiness-v3",
      stateRoot,
      leaseName,
      maxLeaseLifetimeMs: 1_800_000,
      launcherPath,
      launcherSha256,
      ...paths,
      ...pins,
    })}\n`,
    { mode: 0o444 },
  );
  await chmod(bindingPath, 0o444);
  return {
    fixtureRoot,
    bindingPath,
    runtimeRoot,
    stateRoot,
    markerPath,
    environmentPath,
    launcherPath,
  };
}

function hostArguments(fixture, action) {
  const common = [
    "--actor",
    actor,
    "--state-root",
    fixture.stateRoot,
    "--lease-name",
    leaseName,
    "--test-binding",
    fixture.bindingPath,
    "--test-runtime-root",
    fixture.runtimeRoot,
  ];
  if (action === "attest") {
    return [
      "--attest-readiness",
      "--protocol",
      "freed-actor-launcher-readiness-v3",
      ...common,
      "--max-lifetime-ms",
      "1800000",
    ];
  }
  return ["--acquire-lease", ...common, "--ttl-seconds", "1800"];
}

function invoke(fixture, action) {
  return spawnSync(fixture.launcherPath, hostArguments(fixture, action), {
    encoding: "utf8",
    env: {
      HOSTILE_SECRET: "must-not-reach-the-control-process",
    },
    timeout: 15_000,
  });
}

async function withFixture(mode, operation) {
  const fixture = await createFixture(mode);
  try {
    await operation(fixture);
  } finally {
    await rm(fixture.fixtureRoot, { recursive: true, force: true });
  }
}

test(
  "Linux launcher attests and acquires through the pinned live channel",
  { skip: !linuxOnly, timeout: 30_000 },
  async () => {
    await withFixture("valid", async (fixture) => {
      const readinessResult = invoke(fixture, "attest");
      assert.equal(readinessResult.status, 0, readinessResult.stderr);
      const readiness = JSON.parse(readinessResult.stdout);
      assert.equal(readiness.canonicalLeaseReady, true);
      assert.equal(readiness.mutatesState, false);
      assert.deepEqual(
        JSON.parse(await readFile(fixture.environmentPath, "utf8")),
        ["LANG", "LC_ALL", "PATH"],
      );
      assert.doesNotMatch(
        readinessResult.stdout + readinessResult.stderr,
        /HOSTILE_SECRET|must-not-reach/,
      );
      const acquireResult = invoke(fixture, "acquire");
      assert.equal(acquireResult.status, 0, acquireResult.stderr);
      const handoff = JSON.parse(acquireResult.stdout);
      assert.equal(handoff.actor, actor);
      assert.equal(handoff.leaseName, leaseName);
      assert.equal(handoff.ttlMs, 1_800_000);
      assert.equal(handoff.leaseTokenSha256, sha256(handoff.leaseToken));
      assert.match(
        handoff.leaseOperationId,
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
      );
    });
  },
);

test(
  "Linux launcher retries response loss with one operation and token",
  { skip: !linuxOnly, timeout: 30_000 },
  async () => {
    await withFixture("response-loss-once", async (fixture) => {
      const result = invoke(fixture, "acquire");
      assert.equal(result.status, 0, result.stderr);
      const attempts = (
        await readFile(
          path.join(fixture.stateRoot, "linux-test-acquire.jsonl"),
          "utf8",
        )
      )
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line));
      assert.equal(attempts.length, 2);
      assert.equal(attempts[0].operationId, attempts[1].operationId);
      assert.equal(attempts[0].tokenSha256, attempts[1].tokenSha256);
    });
  },
);

test(
  "Linux launcher rejects provenance and response-shape drift",
  { skip: !linuxOnly, timeout: 30_000 },
  async () => {
    for (const mode of ["wrong-authority", "extra-envelope"]) {
      await withFixture(mode, async (fixture) => {
        const result = invoke(fixture, "acquire");
        assert.notEqual(result.status, 0, mode);
        const cleanup = await readFile(
          path.join(fixture.stateRoot, "linux-test-cleanup.jsonl"),
          "utf8",
        );
        assert.match(cleanup, /"action":"release"/);
        assert.match(cleanup, /"action":"show"/);
        await assert.rejects(
          stat(path.join(fixture.stateRoot, "linux-test-lease.json")),
          { code: "ENOENT" },
        );
      });
    }
  },
);

test(
  "Linux cancellation before handoff releases and proves lease absence",
  { skip: !linuxOnly, timeout: 30_000 },
  async () => {
    await withFixture("cancel-delay", async (fixture) => {
      const child = spawn(
        fixture.launcherPath,
        hostArguments(fixture, "acquire"),
        {
          env: {},
          stdio: ["ignore", "pipe", "pipe"],
        },
      );
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
      const deadline = Date.now() + 5_000;
      while (Date.now() < deadline) {
        try {
          await stat(fixture.markerPath);
          break;
        } catch {
          await new Promise((resolve) => setTimeout(resolve, 20));
        }
      }
      await stat(fixture.markerPath);
      assert.equal(child.kill("SIGTERM"), true);
      const result = await new Promise((resolve) => {
        child.once("close", (code, signal) => resolve({ code, signal }));
      });
      assert.equal(result.code, 143, `${result.signal}\n${stderr}`);
      assert.equal(stdout, "");
      const cleanup = await readFile(
        path.join(fixture.stateRoot, "linux-test-cleanup.jsonl"),
        "utf8",
      );
      assert.match(cleanup, /"action":"release"/);
      assert.match(cleanup, /"action":"show"/);
      await assert.rejects(
        stat(path.join(fixture.stateRoot, "linux-test-lease.json")),
        { code: "ENOENT" },
      );
    });
  },
);

test(
  "Linux build helper emits static production tools and rejects test flags",
  { skip: !linuxOnly, timeout: 30_000 },
  async () => {
    const hostOutput = path.join(buildRoot, "automation-actor-host-production");
    const provisionerOutput = path.join(
      buildRoot,
      "automation-actor-provisioner-production",
    );
    await execFileAsync(
      "/bin/bash",
      [
        buildHelper,
        "--host-output",
        hostOutput,
        "--provisioner-output",
        provisionerOutput,
      ],
      {
        cwd: repoRoot,
        env: { ...process.env, FREED_GO_EXECUTABLE: goExecutable },
      },
    );
    const fileIdentity = await execFileAsync("/usr/bin/file", [hostOutput]);
    assert.match(fileIdentity.stdout, /statically linked/);
    const rejected = spawnSync(
      hostOutput,
      [
        "--attest-readiness",
        "--protocol",
        "freed-actor-launcher-readiness-v3",
        "--actor",
        actor,
        "--state-root",
        "/tmp/fake-state",
        "--lease-name",
        leaseName,
        "--max-lifetime-ms",
        "1800000",
        "--test-binding",
        "/tmp/fake-binding.json",
      ],
      { encoding: "utf8" },
    );
    assert.notEqual(rejected.status, 0);
    const provisioner = spawnSync(provisionerOutput, [], { encoding: "utf8" });
    assert.notEqual(provisioner.status, 0);
    assert.match(
      provisioner.stderr,
      /legacy credential migration is unavailable/,
    );
  },
);
