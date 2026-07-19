import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  readdirSync,
  renameSync,
  rmSync,
  symlinkSync,
  truncateSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  AUTOMATION_KERNEL_GUARD_CUTOVER_PLAN_MAX_BYTES,
  AUTOMATION_KERNEL_GUARD_NAMES,
  automationKernelGuardCutoverPaths,
  automationKernelGuardMarkerBytes,
  inspectAutomationKernelGuardCutover,
} from "./lib/automation-kernel-guard-contract.mjs";
import {
  applyAutomationKernelGuardCutover,
  applyAutomationKernelGuardCutoverSupersede,
  assertAutomationKernelGuardCutoverFilesystemAdmission,
  assertAutomationKernelGuardCutoverPlanSize,
  planAutomationKernelGuardCutover,
  planAutomationKernelGuardCutoverSupersede,
  readAutomationKernelGuardCutoverPlan,
  readAutomationKernelGuardCutoverSupersedePlan,
  writeAutomationKernelGuardCutoverPlan,
  writeAutomationKernelGuardCutoverSupersedePlan,
} from "./lib/automation-kernel-guard-cutover.mjs";
import { withKernelFileGuard } from "./lib/automation-control.mjs";

const TASK_ID = "authenticated-essay-capture-pr-642";
const CLI_PATH = path.join(
  import.meta.dirname,
  "automation-kernel-guard-cutover.mjs",
);
const ACTOR_IDS = [
  "freed-runtime-observer",
  "freed-stability-controller",
  "freed-scaffolding-maintainer",
  "freed-nightly-runner",
  "freed-release-verifier",
];

function privateDirectory(directoryPath) {
  mkdirSync(directoryPath, { recursive: true, mode: 0o700 });
  chmodSync(directoryPath, 0o700);
  return directoryPath;
}

function git(repoRoot, args) {
  return execFileSync("/usr/bin/git", args, {
    cwd: repoRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

function createExactDevRepository(root) {
  const remote = path.join(root, "remote.git");
  const repoRoot = path.join(root, "repo");
  privateDirectory(remote);
  execFileSync("/usr/bin/git", ["init", "--bare", remote], {
    stdio: "ignore",
  });
  privateDirectory(repoRoot);
  git(repoRoot, ["init", "-b", "dev"]);
  git(repoRoot, ["config", "user.name", "Cutover Test"]);
  git(repoRoot, ["config", "user.email", "cutover-test@example.invalid"]);
  writeFileSync(path.join(repoRoot, "README.md"), "cutover fixture\n");
  git(repoRoot, ["add", "README.md"]);
  git(repoRoot, ["commit", "-m", "test: seed cutover fixture"]);
  git(repoRoot, ["remote", "add", "origin", remote]);
  git(repoRoot, ["push", "-u", "origin", "dev"]);
  return realpathSync(repoRoot);
}

function createFixture(t, { legacyGuard = false, legacyWriter = false } = {}) {
  const root = realpathSync(
    mkdtempSync(path.join(os.tmpdir(), "freed-kernel-cutover-")),
  );
  t.after(() => rmSync(root, { recursive: true, force: true }));
  chmodSync(root, 0o700);
  const stateRoot = privateDirectory(path.join(root, "state"));
  const controlRoot = privateDirectory(path.join(stateRoot, "control"));
  const guardsRoot = privateDirectory(path.join(controlRoot, ".guards"));
  const leasesRoot = privateDirectory(path.join(controlRoot, "leases"));
  const now = "2026-07-18T12:00:00.000Z";
  writeFileSync(
    path.join(controlRoot, "current-tasks.json"),
    `${JSON.stringify(
      {
        schemaVersion: 1,
        revision: 1,
        updatedAt: now,
        tasks: [
          {
            schemaVersion: 1,
            taskId: TASK_ID,
            revision: 6,
            state: "merged",
            createdAt: now,
            updatedAt: now,
            observerAuthority: "merge-safe",
            providerAuthority: "forbidden",
            details: { behavioral: true },
          },
        ],
      },
      null,
      2,
    )}\n`,
    { mode: 0o600 },
  );
  writeFileSync(path.join(controlRoot, "events.jsonl"), "", { mode: 0o600 });
  assert.deepEqual(readdirSync(leasesRoot), []);

  if (legacyGuard) {
    const directory = privateDirectory(path.join(guardsRoot, "events.lock"));
    writeFileSync(
      path.join(directory, "owner.json"),
      `${JSON.stringify({
        schemaVersion: 1,
        pid: 999_999,
        processStartIdentity: "darwin:legacy",
      })}\n`,
      { mode: 0o600 },
    );
  }
  if (legacyWriter) {
    writeFileSync(
      path.join(stateRoot, "outcomes.jsonl.writer-lock"),
      `${JSON.stringify({
        schemaVersion: 1,
        token:
          "legacy-writer-token-that-is-long-enough-for-safe-marker-conversion",
        pid: 999_999,
        processStartIdentity: "darwin:legacy-writer",
        acquiredAt: "2026-07-18T11:00:00.000Z",
      })}\n`,
      { mode: 0o600 },
    );
  }

  const codexHome = privateDirectory(path.join(root, "codex-home"));
  for (const actor of ACTOR_IDS) {
    const actorRoot = privateDirectory(
      path.join(codexHome, "automations", actor),
    );
    writeFileSync(
      path.join(actorRoot, "automation.toml"),
      `name = "${actor}"\nstatus = "PAUSED"\n`,
      { mode: 0o600 },
    );
  }
  const repoRoot = createExactDevRepository(root);
  const planFile = path.join(root, "cutover-plan.json");
  const supersedePlanFile = path.join(root, "cutover-supersede-plan.json");
  const confirmationFile = path.join(root, "owner-confirmation.json");
  return {
    root,
    stateRoot,
    controlRoot,
    guardsRoot,
    codexHome,
    repoRoot,
    planFile,
    supersedePlanFile,
    confirmationFile,
  };
}

function writeConfirmation(
  fixture,
  plan,
  confirmationId = "kernel-cutover-test",
) {
  const nowMs = Date.now();
  const confirmation = {
    schemaVersion: 1,
    kind: "owner-confirmation",
    confirmationId,
    approvedBy: "AubreyF",
    ownerApprovalReference:
      "Owner approved this exact kernel guard cutover test intent.",
    approvalSource: { kind: "current-task", reference: TASK_ID },
    taskId: TASK_ID,
    intent: plan.intent,
    intentDigest: plan.intentDigest,
    approvedAt: new Date(nowMs - 1_000).toISOString(),
    expiresAt: new Date(nowMs + 10 * 60_000).toISOString(),
  };
  writeFileSync(fixture.confirmationFile, `${JSON.stringify(confirmation)}\n`, {
    mode: 0o600,
  });
}

function planFixture(fixture) {
  const plan = planAutomationKernelGuardCutover({
    stateRoot: fixture.stateRoot,
    taskId: TASK_ID,
    codexHome: fixture.codexHome,
    repoRoot: fixture.repoRoot,
  });
  writeAutomationKernelGuardCutoverPlan(fixture.planFile, plan);
  writeConfirmation(fixture, plan);
  return plan;
}

function supersedePlanFixture(fixture, plan) {
  const supersedePlan = planAutomationKernelGuardCutoverSupersede({ plan });
  writeAutomationKernelGuardCutoverSupersedePlan(
    fixture.supersedePlanFile,
    supersedePlan,
    plan,
  );
  writeConfirmation(fixture, supersedePlan, "kernel-cutover-supersede-test");
  return supersedePlan;
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function snapshotFilesystemTree(root) {
  const records = [];
  const visit = (candidatePath) => {
    const stats = lstatSync(candidatePath);
    const relativePath = path.relative(root, candidatePath) || ".";
    const common = {
      path: relativePath,
      dev: String(stats.dev),
      ino: String(stats.ino),
      mode: stats.mode & 0o7777,
      nlink: stats.nlink,
      uid: stats.uid,
      gid: stats.gid,
    };
    if (stats.isDirectory()) {
      records.push({ ...common, kind: "directory" });
      for (const entry of readdirSync(candidatePath).sort()) {
        visit(path.join(candidatePath, entry));
      }
      return;
    }
    if (stats.isFile()) {
      records.push({
        ...common,
        kind: "file",
        bytesBase64: readFileSync(candidatePath).toString("base64"),
      });
      return;
    }
    records.push({ ...common, kind: "unsupported" });
  };
  visit(root);
  return records;
}

function seedPreparedTransaction(fixture, plan) {
  const confirmationBytes = readFileSync(fixture.confirmationFile);
  const confirmation = JSON.parse(confirmationBytes.toString("utf8"));
  const confirmationDigest = sha256(
    Buffer.from(stableJson(confirmation), "utf8"),
  );
  const confirmationRawDigest = sha256(confirmationBytes);
  const authorizationDirectory = path.join(
    automationKernelGuardCutoverPaths(fixture.stateRoot).artifactRoot,
    plan.parameters.cutoverId,
    "authorizations",
  );
  privateDirectory(authorizationDirectory);
  const confirmationArtifact = path.join(
    authorizationDirectory,
    `${confirmationDigest}-${confirmationRawDigest}.json`,
  );
  writeFileSync(confirmationArtifact, confirmationBytes, { mode: 0o600 });
  const preparedAt = plan.createdAt;
  const authorization = {
    actor: "freed-owner",
    confirmationId: confirmation.confirmationId,
    confirmationDigest,
    confirmationPath: fixture.confirmationFile,
    confirmationBytesBase64: confirmationBytes.toString("base64"),
    confirmationRawDigest,
    confirmationArtifact,
    intentDigest: plan.intentDigest,
    validatedAt: preparedAt,
  };
  writeFileSync(
    path.join(authorizationDirectory, "prepared-authorization.json"),
    `${JSON.stringify(authorization, null, 2)}\n`,
    { mode: 0o600 },
  );
  const transaction = {
    schemaVersion: 1,
    kind: "automation-kernel-guard-cutover-transaction",
    cutoverId: plan.parameters.cutoverId,
    planDigest: sha256(Buffer.from(`${stableJson(plan)}\n`, "utf8")),
    phase: "prepared",
    preparedAt,
    authorizations: [authorization],
    claimGenerations: [],
  };
  const paths = automationKernelGuardCutoverPaths(fixture.stateRoot);
  writeFileSync(
    paths.transaction,
    `${JSON.stringify(transaction, null, 2)}\n`,
    {
      mode: 0o600,
    },
  );
}

function readSeededTransaction(fixture) {
  const paths = automationKernelGuardCutoverPaths(fixture.stateRoot);
  return JSON.parse(readFileSync(paths.transaction, "utf8"));
}

function writeSeededTransaction(fixture, transaction) {
  const paths = automationKernelGuardCutoverPaths(fixture.stateRoot);
  writeFileSync(
    paths.transaction,
    `${JSON.stringify(transaction, null, 2)}\n`,
    {
      mode: 0o600,
    },
  );
}

function waitForPath(filePath) {
  const deadline = Date.now() + 10_000;
  while (!existsSync(filePath)) {
    if (Date.now() >= deadline) {
      throw new Error(`Timed out waiting for ${filePath}`);
    }
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10);
  }
}

function spawnLegacyWriterReplacement(writerPath, readyPath) {
  const source = `
    import { closeSync, fsyncSync, openSync, renameSync, rmSync, writeFileSync } from "node:fs";
    import { randomUUID } from "node:crypto";
    const writerPath = ${JSON.stringify(writerPath)};
    const abandonedPath = \`\${writerPath}.abandoned.\${randomUUID()}\`;
    renameSync(writerPath, abandonedPath);
    rmSync(abandonedPath, { force: true });
    const descriptor = openSync(writerPath, "wx", 0o600);
    writeFileSync(descriptor, JSON.stringify({
      schemaVersion: 1,
      token: "live-old-writer-contender",
      pid: process.pid,
      processStartIdentity: null,
      acquiredAt: new Date().toISOString(),
    }) + "\\n");
    fsyncSync(descriptor);
    closeSync(descriptor);
    writeFileSync(${JSON.stringify(readyPath)}, "ready\\n", { mode: 0o600 });
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 60000);
  `;
  return spawn(process.execPath, ["--input-type=module", "--eval", source], {
    stdio: ["ignore", "ignore", "pipe"],
  });
}

function spawnLegacyGuardContender(guardPath, readyPath) {
  const source = `
    import { closeSync, fsyncSync, mkdirSync, openSync, writeFileSync } from "node:fs";
    mkdirSync(${JSON.stringify(guardPath)}, { mode: 0o700 });
    const ownerPath = ${JSON.stringify(path.join(guardPath, "owner.json"))};
    const descriptor = openSync(ownerPath, "wx", 0o600);
    writeFileSync(descriptor, JSON.stringify({
      schemaVersion: 1,
      owner: process.pid + ":live-old-guard-contender",
      pid: process.pid,
      processStartIdentity: null,
      acquiredAt: new Date().toISOString(),
    }) + "\\n");
    fsyncSync(descriptor);
    closeSync(descriptor);
    writeFileSync(${JSON.stringify(readyPath)}, "ready\\n", { mode: 0o600 });
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 60000);
  `;
  return spawn(process.execPath, ["--input-type=module", "--eval", source], {
    stdio: ["ignore", "ignore", "pipe"],
  });
}

function spawnPausedLegacyWriterTakeover(
  writerPath,
  readyPath,
  continuePath,
  finishedPath,
  { advertiseControlProcess = false } = {},
) {
  const source = `
    import { closeSync, existsSync, fsyncSync, openSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
    import { randomUUID } from "node:crypto";
    process.on("uncaughtException", (error) => {
      writeFileSync(${JSON.stringify(finishedPath)}, JSON.stringify({ error: error.message, code: error.code }) + "\\n", { mode: 0o600 });
      process.exit(93);
    });
    ${advertiseControlProcess ? 'process.title = "scripts/record-outcome.mjs";' : ""}
    const writerPath = ${JSON.stringify(writerPath)};
    const owner = JSON.parse(readFileSync(writerPath, "utf8"));
    if (owner.schemaVersion !== 1) process.exit(91);
    writeFileSync(${JSON.stringify(readyPath)}, "stale-read\\n", { mode: 0o600 });
    while (!existsSync(${JSON.stringify(continuePath)})) {
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10);
    }
    const abandonedPath = \`\${writerPath}.abandoned.\${randomUUID()}\`;
    renameSync(writerPath, abandonedPath);
    rmSync(abandonedPath, { force: true });
    const descriptor = openSync(writerPath, "wx", 0o600);
    writeFileSync(descriptor, JSON.stringify({
      schemaVersion: 1,
      token: "paused-old-writer-takeover",
      pid: process.pid,
      processStartIdentity: null,
      acquiredAt: new Date().toISOString(),
    }) + "\\n");
    fsyncSync(descriptor);
    closeSync(descriptor);
    writeFileSync(${JSON.stringify(finishedPath)}, "taken\\n", { mode: 0o600 });
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 60000);
  `;
  return spawn(process.execPath, ["--input-type=module", "--eval", source], {
    stdio: ["ignore", "ignore", "pipe"],
  });
}

function spawnPausedLegacyGuardTakeover(
  guardPath,
  readyPath,
  continuePath,
  finishedPath,
  { advertiseControlProcess = false } = {},
) {
  const source = `
    import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
    import { randomUUID } from "node:crypto";
    process.on("uncaughtException", (error) => {
      writeFileSync(${JSON.stringify(finishedPath)}, JSON.stringify({ error: error.message, code: error.code }) + "\\n", { mode: 0o600 });
      process.exit(94);
    });
    ${advertiseControlProcess ? 'process.title = "scripts/automation-control.mjs";' : ""}
    const guardPath = ${JSON.stringify(guardPath)};
    const ownerPath = guardPath + "/owner.json";
    const owner = JSON.parse(readFileSync(ownerPath, "utf8"));
    if (owner.schemaVersion !== 1) process.exit(92);
    writeFileSync(${JSON.stringify(readyPath)}, "stale-read\\n", { mode: 0o600 });
    while (!existsSync(${JSON.stringify(continuePath)})) {
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10);
    }
    const abandonedPath = \`\${guardPath}.abandoned.\${randomUUID()}\`;
    renameSync(guardPath, abandonedPath);
    rmSync(abandonedPath, { recursive: true, force: true });
    mkdirSync(guardPath, { mode: 0o700 });
    const descriptor = openSync(ownerPath, "wx", 0o600);
    writeFileSync(descriptor, JSON.stringify({
      schemaVersion: 1,
      owner: process.pid + ":paused-old-guard-takeover",
      pid: process.pid,
      processStartIdentity: null,
      acquiredAt: new Date().toISOString(),
    }) + "\\n");
    fsyncSync(descriptor);
    closeSync(descriptor);
    writeFileSync(${JSON.stringify(finishedPath)}, "taken\\n", { mode: 0o600 });
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 60000);
  `;
  return spawn(process.execPath, ["--input-type=module", "--eval", source], {
    stdio: ["ignore", "ignore", "pipe"],
  });
}

function runCutoverKilledAtCheckpoint(
  fixture,
  checkpointName,
  { guardName = "", filePath = "" } = {},
) {
  const source = `
    import {
      applyAutomationKernelGuardCutover,
      readAutomationKernelGuardCutoverPlan,
    } from ${JSON.stringify(
      path.join(
        import.meta.dirname,
        "lib",
        "automation-kernel-guard-cutover.mjs",
      ),
    )};
    const plan = readAutomationKernelGuardCutoverPlan(${JSON.stringify(fixture.planFile)});
    applyAutomationKernelGuardCutover({
      plan,
      ownerConfirmationFile: ${JSON.stringify(fixture.confirmationFile)},
      checkpoint(name, details) {
        if (
          name === ${JSON.stringify(checkpointName)} &&
          (${JSON.stringify(guardName)} === "" || details?.guardName === ${JSON.stringify(guardName)}) &&
          (${JSON.stringify(filePath)} === "" || details?.filePath === ${JSON.stringify(filePath)})
        ) {
          process.kill(process.pid, "SIGKILL");
        }
      },
    });
  `;
  assert.throws(
    () =>
      execFileSync(
        process.execPath,
        ["--input-type=module", "--eval", source],
        { stdio: ["ignore", "pipe", "pipe"] },
      ),
    (error) => error?.signal === "SIGKILL",
  );
}

function runSupersedeKilledAtCheckpoint(fixture, checkpointName) {
  const source = `
    import {
      applyAutomationKernelGuardCutoverSupersede,
      readAutomationKernelGuardCutoverPlan,
      readAutomationKernelGuardCutoverSupersedePlan,
    } from ${JSON.stringify(
      path.join(
        import.meta.dirname,
        "lib",
        "automation-kernel-guard-cutover.mjs",
      ),
    )};
    const plan = readAutomationKernelGuardCutoverPlan(${JSON.stringify(fixture.planFile)});
    const supersedePlan = readAutomationKernelGuardCutoverSupersedePlan(
      ${JSON.stringify(fixture.supersedePlanFile)},
      plan,
    );
    applyAutomationKernelGuardCutoverSupersede({
      plan,
      supersedePlan,
      ownerConfirmationFile: ${JSON.stringify(fixture.confirmationFile)},
      checkpoint(name) {
        if (name === ${JSON.stringify(checkpointName)}) {
          process.kill(process.pid, "SIGKILL");
        }
      },
    });
  `;
  assert.throws(
    () =>
      execFileSync(
        process.execPath,
        ["--input-type=module", "--eval", source],
        { stdio: ["ignore", "pipe", "pipe"] },
      ),
    (error) => error?.signal === "SIGKILL",
  );
}

function runCli(args) {
  const result = execFileSync(process.execPath, [CLI_PATH, ...args], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  return JSON.parse(result);
}

function runCliFailure(args) {
  try {
    runCli(args);
  } catch (error) {
    return JSON.parse(error.stderr);
  }
  assert.fail("Expected cutover CLI to fail.");
}

function spawnHoldingKernelGuard(filePath) {
  const source = `
    import { withKernelFileGuard } from ${JSON.stringify(
      path.join(import.meta.dirname, "lib", "automation-control.mjs"),
    )};
    withKernelFileGuard(${JSON.stringify(filePath)}, () => {
      process.stdout.write("ready\\n");
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 60000);
    });
  `;
  return spawn(process.execPath, ["--input-type=module", "--eval", source], {
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function waitForLine(stream, expected) {
  return new Promise((resolve, reject) => {
    let output = "";
    const timeout = setTimeout(
      () => reject(new Error(`Timed out waiting for ${expected}: ${output}`)),
      10_000,
    );
    stream.setEncoding("utf8");
    stream.on("data", (chunk) => {
      output += chunk;
      if (output.includes(expected)) {
        clearTimeout(timeout);
        resolve(output);
      }
    });
  });
}

function stopChild(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  child.kill("SIGKILL");
  return new Promise((resolve) => child.once("close", resolve));
}

test("plan uses a real taskId and survives the required private file round trip", (t) => {
  const fixture = createFixture(t);
  const plan = planFixture(fixture);
  const reread = readAutomationKernelGuardCutoverPlan(fixture.planFile);

  assert.equal(plan.taskId, TASK_ID);
  assert.equal(plan.parameters.sourceCodeSha.length, 40);
  assert.deepEqual(reread, plan);
  assert.throws(
    () =>
      planAutomationKernelGuardCutover({
        stateRoot: fixture.stateRoot,
        taskId: "unknown-cutover-task",
        codexHome: fixture.codexHome,
        repoRoot: fixture.repoRoot,
      }),
    /does not exist/,
  );
});

test("caller-owned plan mutation after transaction durability cannot redirect cutover", (t) => {
  const fixture = createFixture(t);
  const victim = createFixture(t);
  const sourcePlan = planFixture(fixture);
  const victimPlan = planFixture(victim);
  const rawPlan = structuredClone(sourcePlan);
  const victimBefore = snapshotFilesystemTree(victim.stateRoot);
  let mutationRan = false;

  const result = applyAutomationKernelGuardCutover({
    plan: rawPlan,
    ownerConfirmationFile: fixture.confirmationFile,
    checkpoint(name) {
      if (name !== "transaction-prepared-durable") return;
      Object.assign(rawPlan, structuredClone(victimPlan));
      mutationRan = true;
    },
  });

  assert.equal(mutationRan, true);
  assert.equal(result.changed, true);
  assert.equal(
    inspectAutomationKernelGuardCutover(fixture.stateRoot).ready,
    true,
  );
  assert.deepEqual(snapshotFilesystemTree(victim.stateRoot), victimBefore);
  assert.equal(
    inspectAutomationKernelGuardCutover(victim.stateRoot).ready,
    false,
  );
});

test("planning rejects a malformed matching canonical task without mutation", (t) => {
  const fixture = createFixture(t);
  const paths = automationKernelGuardCutoverPaths(fixture.stateRoot);
  const manifestPath = path.join(fixture.controlRoot, "current-tasks.json");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  manifest.tasks[0].state = "invented-state";
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, {
    mode: 0o600,
  });
  const manifestBefore = readFileSync(manifestPath);
  const eventsBefore = readFileSync(
    path.join(fixture.controlRoot, "events.jsonl"),
  );

  assert.throws(
    () =>
      planAutomationKernelGuardCutover({
        stateRoot: fixture.stateRoot,
        taskId: TASK_ID,
        codexHome: fixture.codexHome,
        repoRoot: fixture.repoRoot,
      }),
    (error) => error?.code === "cutover_task_invalid",
  );

  assert.deepEqual(readFileSync(manifestPath), manifestBefore);
  assert.deepEqual(
    readFileSync(path.join(fixture.controlRoot, "events.jsonl")),
    eventsBefore,
  );
  assert.deepEqual(readdirSync(fixture.guardsRoot), []);
  for (const filePath of [
    paths.transaction,
    paths.globalReceipt,
    paths.bootstrapLock,
    paths.writerLock,
    paths.writeAhead,
  ]) {
    assert.equal(existsSync(filePath), false);
  }
});

test("exact write-ahead and evidence filesystem admission is read-only", async (t) => {
  for (const target of [
    "write-ahead",
    "evidence-directory",
    "authorization-child",
    "quarantine-child",
  ]) {
    await t.test(target, (subtest) => {
      const fixture = createFixture(subtest);
      const plan = planFixture(fixture);
      const paths = automationKernelGuardCutoverPaths(fixture.stateRoot);
      const evidenceDirectory = path.join(
        paths.artifactRoot,
        plan.parameters.cutoverId,
      );
      const unsupportedPath =
        target === "write-ahead"
          ? paths.writeAhead
          : target === "evidence-directory"
            ? evidenceDirectory
            : target === "authorization-child"
              ? path.join(
                  evidenceDirectory,
                  "authorizations",
                  `${"a".repeat(64)}-${"b".repeat(64)}.json`,
                )
              : path.join(
                  evidenceDirectory,
                  ".recovery-quarantine",
                  "c".repeat(64),
                );
      if (target === "write-ahead") {
        writeFileSync(unsupportedPath, "{}\n", { mode: 0o600 });
      } else if (target.endsWith("-child")) {
        privateDirectory(path.dirname(unsupportedPath));
        writeFileSync(unsupportedPath, "{}\n", { mode: 0o600 });
      } else {
        privateDirectory(unsupportedPath);
      }
      const targetBefore =
        target === "write-ahead" || target.endsWith("-child")
          ? readFileSync(unsupportedPath)
          : readdirSync(unsupportedPath);
      const manifestBefore = readFileSync(
        path.join(fixture.controlRoot, "current-tasks.json"),
      );
      const eventsBefore = readFileSync(
        path.join(fixture.controlRoot, "events.jsonl"),
      );

      assert.throws(
        () =>
          assertAutomationKernelGuardCutoverFilesystemAdmission(
            {
              stateRoot: fixture.stateRoot,
              plan,
              extraPaths: target.endsWith("-child") ? [unsupportedPath] : [],
            },
            {
              resolveFilesystemType(candidatePath) {
                return candidatePath === unsupportedPath ? "nfs" : "apfs";
              },
            },
          ),
        (error) => error?.code === "cutover_filesystem_unsupported",
      );

      assert.deepEqual(
        readFileSync(path.join(fixture.controlRoot, "current-tasks.json")),
        manifestBefore,
      );
      assert.deepEqual(
        readFileSync(path.join(fixture.controlRoot, "events.jsonl")),
        eventsBefore,
      );
      assert.deepEqual(
        target === "write-ahead" || target.endsWith("-child")
          ? readFileSync(unsupportedPath)
          : readdirSync(unsupportedPath),
        targetBefore,
      );
      assert.equal(existsSync(paths.transaction), false);
      assert.equal(existsSync(paths.globalReceipt), false);
      assert.equal(existsSync(paths.bootstrapLock), false);
      assert.equal(existsSync(paths.writerLock), false);
      assert.deepEqual(readdirSync(fixture.guardsRoot), []);
    });
  }
});

test("one aggregate plan bound governs creation, private reads, and evidence", (t) => {
  const fixture = createFixture(t);
  const plan = planFixture(fixture);
  const planBytes = Buffer.from(`${JSON.stringify(plan, null, 2)}\n`, "utf8");
  assert.ok(planBytes.length < AUTOMATION_KERNEL_GUARD_CUTOVER_PLAN_MAX_BYTES);
  assert.strictEqual(
    assertAutomationKernelGuardCutoverPlanSize(Buffer.alloc(1_024), 1_024)
      .length,
    1_024,
  );
  assert.throws(
    () =>
      assertAutomationKernelGuardCutoverPlanSize(Buffer.alloc(1_025), 1_024),
    (error) => error?.code === "cutover_plan_too_large",
  );
  const oversizedPlanFile = path.join(fixture.root, "oversized-plan.json");
  writeFileSync(oversizedPlanFile, "{}\n", { mode: 0o600 });
  truncateSync(
    oversizedPlanFile,
    AUTOMATION_KERNEL_GUARD_CUTOVER_PLAN_MAX_BYTES + 1,
  );
  assert.throws(
    () => readAutomationKernelGuardCutoverPlan(oversizedPlanFile),
    (error) =>
      error?.code === "cutover_state_invalid" &&
      /Cutover source file is unsafe/.test(error.message),
  );
});

test("CLI plans and applies one exact owner-confirmed cutover", (t) => {
  const fixture = createFixture(t);
  const planned = runCli([
    "plan",
    "--task-id",
    TASK_ID,
    "--plan-file",
    fixture.planFile,
    "--state-root",
    fixture.stateRoot,
    "--codex-home",
    fixture.codexHome,
    "--repo-root",
    fixture.repoRoot,
  ]);
  const plan = readAutomationKernelGuardCutoverPlan(fixture.planFile);
  writeConfirmation(fixture, plan, "kernel-cutover-cli-test");
  const applied = runCli([
    "apply",
    "--plan-file",
    fixture.planFile,
    "--owner-confirmation-file",
    fixture.confirmationFile,
  ]);

  assert.equal(planned.ok, true);
  assert.equal(planned.intentDigest, plan.intentDigest);
  assert.equal(applied.ok, true);
  assert.equal(applied.result.changed, true);
  const inspection = inspectAutomationKernelGuardCutover(fixture.stateRoot);
  assert.equal(inspection.ready, true, inspection.problems.join("\n"));
  assert.deepEqual(
    Object.keys(inspection.paths.guards).sort(),
    [...AUTOMATION_KERNEL_GUARD_NAMES].sort(),
  );
  assert.deepEqual(
    readFileSync(inspection.paths.bootstrapLock),
    automationKernelGuardMarkerBytes(),
  );
  assert.equal(lstatSync(inspection.paths.bootstrapLock).nlink, 1);
});

test("fresh retry authorization is recorded and becomes exact receipt attribution", (t) => {
  const fixture = createFixture(t);
  const plan = planFixture(fixture);
  const paths = automationKernelGuardCutoverPaths(fixture.stateRoot);
  assert.throws(
    () =>
      applyAutomationKernelGuardCutover({
        plan,
        ownerConfirmationFile: fixture.confirmationFile,
        checkpoint(name) {
          if (name === "claims-transaction-durable") {
            throw new Error("stop before marker conversion");
          }
        },
      }),
    /stop before marker conversion/,
  );
  writeConfirmation(fixture, plan, "kernel-cutover-retry-confirmation");

  const result = applyAutomationKernelGuardCutover({
    plan,
    ownerConfirmationFile: fixture.confirmationFile,
  });
  const transaction = JSON.parse(readFileSync(paths.transaction, "utf8"));
  const inspection = inspectAutomationKernelGuardCutover(fixture.stateRoot);

  assert.equal(result.changed, true);
  assert.equal(transaction.authorizations.length, 3);
  assert.equal(
    transaction.authorizations[0].confirmationId,
    "kernel-cutover-test",
  );
  assert.equal(
    transaction.authorizations[1].confirmationId,
    "kernel-cutover-retry-confirmation",
  );
  assert.equal(
    transaction.authorizations[2].confirmationId,
    "kernel-cutover-retry-confirmation",
  );
  assert.equal(
    transaction.completedAt,
    transaction.authorizations.at(-1).validatedAt,
  );
  assert.equal(
    inspection.receipt.confirmationId,
    "kernel-cutover-retry-confirmation",
  );
  assert.equal(inspection.ready, true, inspection.problems.join("\n"));
});

test("linked prepared authorization from the pre-transaction layout remains recoverable", (t) => {
  const fixture = createFixture(t);
  const plan = planFixture(fixture);
  const paths = automationKernelGuardCutoverPaths(fixture.stateRoot);
  const authorizationDirectory = path.join(
    paths.artifactRoot,
    plan.parameters.cutoverId,
    "authorizations",
  );

  runCutoverKilledAtCheckpoint(fixture, "prepared-authorization-linked");

  const publishedTransaction = JSON.parse(
    readFileSync(paths.transaction, "utf8"),
  );
  const preparedAuthorization = JSON.parse(
    readFileSync(
      path.join(authorizationDirectory, "prepared-authorization.json"),
      "utf8",
    ),
  );
  assert.deepEqual(
    publishedTransaction.authorizations[0],
    preparedAuthorization,
  );
  unlinkSync(paths.transaction);
  assert.equal(existsSync(paths.transaction), false);
  const preparedPath = path.join(
    authorizationDirectory,
    "prepared-authorization.json",
  );
  assert.equal(lstatSync(preparedPath).nlink, 2);
  assert.equal(existsSync(`${preparedPath}.cutover.tmp`), true);

  const recovered = applyAutomationKernelGuardCutover({
    plan,
    ownerConfirmationFile: fixture.confirmationFile,
  });
  const transaction = JSON.parse(readFileSync(paths.transaction, "utf8"));
  assert.equal(recovered.changed, true);
  assert.deepEqual(transaction.authorizations[0], preparedAuthorization);
  assert.equal(transaction.authorizations.length, 3);
  assert.equal(lstatSync(preparedPath).nlink, 1);
  assert.equal(existsSync(`${preparedPath}.cutover.tmp`), false);
  assert.equal(
    transaction.authorizations.every(
      (authorization) => authorization.confirmationId === "kernel-cutover-test",
    ),
    true,
  );
  assert.equal(
    inspectAutomationKernelGuardCutover(fixture.stateRoot).ready,
    true,
  );

  const stableState = snapshotFilesystemTree(fixture.stateRoot);
  const stable = applyAutomationKernelGuardCutover({
    plan,
    ownerConfirmationFile: fixture.confirmationFile,
  });
  assert.equal(stable.changed, false);
  assert.deepEqual(snapshotFilesystemTree(fixture.stateRoot), stableState);
});

test("transaction-first retry recovers authorization evidence before a replacement confirmation", async (t) => {
  for (const checkpointName of [
    "retry-authorization-transaction-durable",
    "retry-authorization-evidence-linked",
    "retry-authorization-evidence-durable",
  ]) {
    await t.test(checkpointName, (checkpointTest) => {
      const fixture = createFixture(checkpointTest);
      const plan = planFixture(fixture);
      const paths = automationKernelGuardCutoverPaths(fixture.stateRoot);
      const authorizationDirectory = path.join(
        paths.artifactRoot,
        plan.parameters.cutoverId,
        "authorizations",
      );
      assert.throws(
        () =>
          applyAutomationKernelGuardCutover({
            plan,
            ownerConfirmationFile: fixture.confirmationFile,
            checkpoint(name) {
              if (name === "claims-transaction-durable") {
                throw new Error("stop before authorization retry");
              }
            },
          }),
        /stop before authorization retry/,
      );
      writeConfirmation(fixture, plan, "kernel-cutover-pending-retry");

      runCutoverKilledAtCheckpoint(fixture, checkpointName);

      const beforeRecovery = JSON.parse(readFileSync(paths.transaction, "utf8"));
      const interruptedAuthorization = beforeRecovery.authorizations.at(-1);
      assert.equal(beforeRecovery.authorizations.length, 2);
      assert.equal(
        interruptedAuthorization.confirmationId,
        "kernel-cutover-pending-retry",
      );
      assert.equal(
        existsSync(interruptedAuthorization.confirmationArtifact),
        checkpointName !== "retry-authorization-transaction-durable",
      );
      if (checkpointName === "retry-authorization-evidence-linked") {
        assert.equal(
          lstatSync(interruptedAuthorization.confirmationArtifact).nlink,
          2,
        );
        assert.equal(
          existsSync(
            `${interruptedAuthorization.confirmationArtifact}.cutover.tmp`,
          ),
          true,
        );
      }

      writeConfirmation(fixture, plan, "kernel-cutover-replacement-retry");
      const recovered = applyAutomationKernelGuardCutover({
        plan,
        ownerConfirmationFile: fixture.confirmationFile,
      });
      const transaction = JSON.parse(readFileSync(paths.transaction, "utf8"));
      assert.equal(recovered.changed, true);
      assert.deepEqual(
        transaction.authorizations.map(
          (authorization) => authorization.confirmationId,
        ),
        [
          "kernel-cutover-test",
          "kernel-cutover-pending-retry",
          "kernel-cutover-replacement-retry",
          "kernel-cutover-replacement-retry",
        ],
      );
      assert.deepEqual(transaction.authorizations[1], interruptedAuthorization);
      const expectedAuthorizationNames = [
        "prepared-authorization.json",
        ...new Set(
          transaction.authorizations.map((authorization) =>
            path.basename(authorization.confirmationArtifact),
          ),
        ),
      ].sort();
      assert.deepEqual(
        readdirSync(authorizationDirectory).sort(),
        expectedAuthorizationNames,
      );
      assert.equal(
        inspectAutomationKernelGuardCutover(fixture.stateRoot).ready,
        true,
      );

      const stableState = snapshotFilesystemTree(fixture.stateRoot);
      const stable = applyAutomationKernelGuardCutover({
        plan,
        ownerConfirmationFile: fixture.confirmationFile,
      });
      assert.equal(stable.changed, false);
      assert.deepEqual(snapshotFilesystemTree(fixture.stateRoot), stableState);
    });
  }
});

test("initial transaction recovers authorization evidence after process loss", (t) => {
  const fixture = createFixture(t);
  const plan = planFixture(fixture);
  const paths = automationKernelGuardCutoverPaths(fixture.stateRoot);
  const authorizationDirectory = path.join(
    paths.artifactRoot,
    plan.parameters.cutoverId,
    "authorizations",
  );
  runCutoverKilledAtCheckpoint(
    fixture,
    "initial-authorization-transaction-durable",
  );
  const interruptedTransaction = JSON.parse(
    readFileSync(paths.transaction, "utf8"),
  );
  const interruptedAuthorization = interruptedTransaction.authorizations[0];
  assert.equal(interruptedTransaction.authorizations.length, 1);
  assert.equal(existsSync(interruptedAuthorization.confirmationArtifact), false);
  assert.equal(
    existsSync(path.join(authorizationDirectory, "prepared-authorization.json")),
    false,
  );

  const recovered = applyAutomationKernelGuardCutover({
    plan,
    ownerConfirmationFile: fixture.confirmationFile,
  });
  const transaction = JSON.parse(readFileSync(paths.transaction, "utf8"));
  assert.equal(recovered.changed, true);
  assert.deepEqual(
    transaction.authorizations.map(
      (authorization) => authorization.confirmationId,
    ),
    [
      "kernel-cutover-test",
      "kernel-cutover-test",
      "kernel-cutover-test",
    ],
  );
  assert.deepEqual(transaction.authorizations[0], interruptedAuthorization);
  const expectedAuthorizationNames = [
    "prepared-authorization.json",
    ...new Set(
      transaction.authorizations.map((authorization) =>
        path.basename(authorization.confirmationArtifact),
      ),
    ),
  ].sort();
  assert.deepEqual(
    readdirSync(authorizationDirectory).sort(),
    expectedAuthorizationNames,
  );
  assert.equal(
    inspectAutomationKernelGuardCutover(fixture.stateRoot).ready,
    true,
  );

  const stableState = snapshotFilesystemTree(fixture.stateRoot);
  const stable = applyAutomationKernelGuardCutover({
    plan,
    ownerConfirmationFile: fixture.confirmationFile,
  });
  assert.equal(stable.changed, false);
  assert.deepEqual(snapshotFilesystemTree(fixture.stateRoot), stableState);
});

test("linked initial authorization evidence recovers on the exact transaction", async (t) => {
  for (const checkpointName of [
    "initial-authorization-evidence-linked",
    "prepared-authorization-linked",
  ]) {
    await t.test(checkpointName, (checkpointTest) => {
      const fixture = createFixture(checkpointTest);
      const plan = planFixture(fixture);
      const paths = automationKernelGuardCutoverPaths(fixture.stateRoot);
      const authorizationDirectory = path.join(
        paths.artifactRoot,
        plan.parameters.cutoverId,
        "authorizations",
      );

      runCutoverKilledAtCheckpoint(fixture, checkpointName);

      const interruptedTransaction = JSON.parse(
        readFileSync(paths.transaction, "utf8"),
      );
      const interruptedAuthorization = interruptedTransaction.authorizations[0];
      const preparedPath = path.join(
        authorizationDirectory,
        "prepared-authorization.json",
      );
      const linkedPath =
        checkpointName === "initial-authorization-evidence-linked"
          ? interruptedAuthorization.confirmationArtifact
          : preparedPath;
      assert.equal(lstatSync(linkedPath).nlink, 2);
      assert.equal(existsSync(`${linkedPath}.cutover.tmp`), true);

      const recovered = applyAutomationKernelGuardCutover({
        plan,
        ownerConfirmationFile: fixture.confirmationFile,
      });
      const transaction = JSON.parse(readFileSync(paths.transaction, "utf8"));
      assert.equal(recovered.changed, true);
      assert.deepEqual(transaction.authorizations[0], interruptedAuthorization);
      assert.equal(existsSync(`${linkedPath}.cutover.tmp`), false);
      assert.equal(lstatSync(linkedPath).nlink, 1);
      assert.equal(
        inspectAutomationKernelGuardCutover(fixture.stateRoot).ready,
        true,
      );
    });
  }
});

test("every retry records changed raw confirmation bytes and source path", (t) => {
  const fixture = createFixture(t);
  const plan = planFixture(fixture);
  const paths = automationKernelGuardCutoverPaths(fixture.stateRoot);
  assert.throws(
    () =>
      applyAutomationKernelGuardCutover({
        plan,
        ownerConfirmationFile: fixture.confirmationFile,
        checkpoint(name) {
          if (name === "transaction-prepared-durable") {
            throw new Error("stop after initial authorization");
          }
        },
      }),
    /stop after initial authorization/,
  );

  const confirmation = JSON.parse(
    readFileSync(fixture.confirmationFile, "utf8"),
  );
  writeFileSync(
    fixture.confirmationFile,
    `${JSON.stringify(confirmation, null, 2)}\n`,
    { mode: 0o600 },
  );
  assert.throws(
    () =>
      applyAutomationKernelGuardCutover({
        plan,
        ownerConfirmationFile: fixture.confirmationFile,
        checkpoint(name) {
          if (name === "claims-transaction-durable") {
            throw new Error("stop after raw-byte retry");
          }
        },
      }),
    /stop after raw-byte retry/,
  );

  const alternateConfirmationPath = path.join(
    fixture.root,
    "alternate-owner-confirmation.json",
  );
  writeFileSync(
    alternateConfirmationPath,
    readFileSync(fixture.confirmationFile),
    { mode: 0o600 },
  );
  assert.throws(
    () =>
      applyAutomationKernelGuardCutover({
        plan,
        ownerConfirmationFile: alternateConfirmationPath,
        checkpoint(name) {
          if (name === "markers-transaction-durable") {
            throw new Error("stop after source-path retry");
          }
        },
      }),
    /stop after source-path retry/,
  );

  const transaction = JSON.parse(readFileSync(paths.transaction, "utf8"));
  assert.equal(transaction.authorizations.length, 3);
  assert.notEqual(
    transaction.authorizations[0].confirmationRawDigest,
    transaction.authorizations[1].confirmationRawDigest,
  );
  assert.equal(
    transaction.authorizations[0].confirmationPath,
    fixture.confirmationFile,
  );
  assert.equal(
    transaction.authorizations[1].confirmationPath,
    fixture.confirmationFile,
  );
  assert.equal(
    transaction.authorizations[2].confirmationRawDigest,
    transaction.authorizations[1].confirmationRawDigest,
  );
  assert.equal(
    transaction.authorizations[2].confirmationPath,
    alternateConfirmationPath,
  );
  assert.equal(existsSync(paths.globalReceipt), false);
});

test("receipt-prepared recovery no longer depends on the source confirmation", (t) => {
  const fixture = createFixture(t);
  const plan = planFixture(fixture);
  const paths = automationKernelGuardCutoverPaths(fixture.stateRoot);
  assert.throws(
    () =>
      applyAutomationKernelGuardCutover({
        plan,
        ownerConfirmationFile: fixture.confirmationFile,
        checkpoint(name) {
          if (name === "receipt-transaction-durable") {
            throw new Error("stop before receipt publication");
          }
        },
      }),
    /stop before receipt publication/,
  );
  unlinkSync(fixture.confirmationFile);

  const result = applyAutomationKernelGuardCutover({
    plan,
    ownerConfirmationFile: fixture.confirmationFile,
  });
  const transaction = JSON.parse(readFileSync(paths.transaction, "utf8"));
  const inspection = inspectAutomationKernelGuardCutover(fixture.stateRoot);

  assert.equal(result.changed, true);
  assert.equal(transaction.authorizations.length, 2);
  assert.equal(transaction.authorizations.length, 2);
  assert.equal(
    transaction.authorizations.at(-1).confirmationId,
    "kernel-cutover-test",
  );
  assert.equal(inspection.receipt.confirmationId, "kernel-cutover-test");
  assert.equal(
    transaction.completedAt,
    transaction.authorizations.at(-1).validatedAt,
  );
  assert.equal(inspection.ready, true, inspection.problems.join("\n"));
});

test("receipt-prepared activation rejects exact protected-state drift and residue", async (t) => {
  const scenarios = [
    {
      name: "static event source drift",
      mutate({ fixture }) {
        writeFileSync(
          path.join(fixture.controlRoot, "events.jsonl"),
          '{"type":"drift"}\n',
          { flag: "a" },
        );
      },
    },
    {
      name: "authorization evidence drift",
      mutate({ paths }) {
        const transaction = JSON.parse(readFileSync(paths.transaction, "utf8"));
        writeFileSync(
          transaction.authorizations[0].confirmationArtifact,
          '{"tampered":true}\n',
          { mode: 0o600 },
        );
      },
    },
    {
      name: "legacy archive drift",
      mutate({ artifactDirectory }) {
        writeFileSync(
          path.join(artifactDirectory, "legacy-paths", "guards", "extra"),
          "unexpected\n",
          { mode: 0o600 },
        );
      },
    },
    {
      name: "permanent marker mode drift",
      mutate({ paths }) {
        chmodSync(paths.writerLock, 0o640);
      },
    },
    {
      name: "terminal write-ahead residue",
      mutate({ paths }) {
        writeFileSync(paths.writeAhead, "{}\n", { mode: 0o600 });
      },
    },
    {
      name: "terminal quarantine residue",
      mutate({ artifactDirectory }) {
        privateDirectory(path.join(artifactDirectory, ".recovery-quarantine"));
      },
    },
  ];

  for (const scenario of scenarios) {
    await t.test(scenario.name, (subtest) => {
      const fixture = createFixture(subtest);
      const plan = planFixture(fixture);
      const paths = automationKernelGuardCutoverPaths(fixture.stateRoot);
      const artifactDirectory = path.join(
        paths.artifactRoot,
        plan.parameters.cutoverId,
      );
      assert.throws(
        () =>
          applyAutomationKernelGuardCutover({
            plan,
            ownerConfirmationFile: fixture.confirmationFile,
            checkpoint(name) {
              if (name === "receipt-transaction-durable") {
                throw new Error("stop after terminal WAL");
              }
            },
          }),
        /stop after terminal WAL/,
      );
      scenario.mutate({ fixture, plan, paths, artifactDirectory });
      unlinkSync(fixture.confirmationFile);

      assert.throws(() =>
        applyAutomationKernelGuardCutover({
          plan,
          ownerConfirmationFile: fixture.confirmationFile,
        }),
      );
      assert.equal(existsSync(paths.globalReceipt), false);
      assert.equal(
        inspectAutomationKernelGuardCutover(fixture.stateRoot).ready,
        false,
      );
    });
  }
});

test("activation checkpoints cannot publish after callback tampering", async (t) => {
  for (const checkpointName of [
    "receipt-artifact-linked",
    "receipt-artifact-durable",
    "global-receipt-linked",
  ]) {
    await t.test(checkpointName, (subtest) => {
      const fixture = createFixture(subtest);
      const plan = planFixture(fixture);
      const paths = automationKernelGuardCutoverPaths(fixture.stateRoot);
      let tampered = false;

      assert.throws(() =>
        applyAutomationKernelGuardCutover({
          plan,
          ownerConfirmationFile: fixture.confirmationFile,
          checkpoint(name) {
            if (tampered || name !== checkpointName) return;
            tampered = true;
            writeFileSync(
              path.join(fixture.controlRoot, "events.jsonl"),
              '{"type":"checkpoint_drift"}\n',
              { flag: "a" },
            );
          },
        }),
      );

      assert.equal(tampered, true);
      assert.equal(
        inspectAutomationKernelGuardCutover(fixture.stateRoot).ready,
        false,
      );
      if (checkpointName === "receipt-artifact-linked") {
        const receiptPath = path.join(
          paths.artifactRoot,
          plan.parameters.cutoverId,
          "receipt.json",
        );
        assert.equal(lstatSync(receiptPath).nlink, 2);
        assert.equal(existsSync(`${receiptPath}.cutover.tmp`), true);
        assert.equal(existsSync(paths.globalReceipt), false);
      } else if (checkpointName === "receipt-artifact-durable") {
        assert.equal(existsSync(paths.globalReceipt), false);
      } else {
        assert.equal(lstatSync(paths.globalReceipt).nlink, 2);
        assert.equal(existsSync(`${paths.globalReceipt}.cutover.tmp`), true);
      }
    });
  }
});

test("invalid owner confirmation leaves every canonical cutover path absent", (t) => {
  const fixture = createFixture(t);
  planFixture(fixture);
  const paths = automationKernelGuardCutoverPaths(fixture.stateRoot);
  writeFileSync(fixture.confirmationFile, "{}\n", { mode: 0o600 });

  const failure = runCliFailure([
    "apply",
    "--plan-file",
    fixture.planFile,
    "--owner-confirmation-file",
    fixture.confirmationFile,
  ]);

  assert.equal(failure.ok, false);
  assert.equal(failure.error.code, "owner_confirmation_invalid");
  assert.equal(existsSync(paths.globalReceipt), false);
  assert.equal(existsSync(paths.transaction), false);
  assert.equal(existsSync(paths.writerLock), false);
  assert.equal(
    existsSync(
      path.join(fixture.controlRoot, "kernel-guard-cutover.bootstrap.lock"),
    ),
    false,
  );
});

test("owner confirmation revocation or expiry stops every permanent mutation boundary", async (t) => {
  const scenarios = [
    {
      label: "writer marker rewrite journal admission",
      checkpoint: "writer-marker-before-write-before-journal",
      matches(details, paths) {
        return details?.filePath === paths.writerLock;
      },
    },
    {
      label: "writer marker rewrite",
      checkpoint: "writer-marker-before-write-after-first-write",
      matches(_details, paths) {
        return _details?.filePath === paths.writerLock;
      },
    },
    {
      label: "guard owner marker rewrite",
      checkpoint: "guard-owner-marker-before-write-after-first-write",
      matches(details, paths) {
        return details?.filePath === paths.guards.events.owner;
      },
    },
    {
      label: "guard owner marker durability",
      checkpoint: "guard-owner-marker-durable",
      matches(details) {
        return details?.guardName === "events";
      },
    },
    {
      label: "guard inner marker durability",
      checkpoint: "guard-inner-marker-durable",
      matches(details) {
        return details?.guardName === "events";
      },
    },
    {
      label: "legacy guard child removal journal admission",
      checkpoint: "guard-events-legacy-remove-before-journal",
      fixtureOptions: { legacyGuard: true },
      prepare(fixture) {
        writeFileSync(
          path.join(fixture.guardsRoot, "events.lock", "legacy-child.json"),
          '{"legacy":true}\n',
          { mode: 0o600 },
        );
      },
      matches() {
        return true;
      },
    },
    {
      label: "legacy guard child removal journal",
      checkpoint: "guard-events-legacy-remove-journal-durable",
      fixtureOptions: { legacyGuard: true },
      prepare(fixture) {
        writeFileSync(
          path.join(fixture.guardsRoot, "events.lock", "legacy-child.json"),
          '{"legacy":true}\n',
          { mode: 0o600 },
        );
      },
      matches() {
        return true;
      },
    },
    {
      label: "abandoned guard removal journal",
      checkpoint: "abandoned-guard-remove-journal-durable",
      prepare(fixture) {
        const abandoned = privateDirectory(
          path.join(
            fixture.guardsRoot,
            "events.lock.abandoned.11111111-1111-4111-8111-111111111111",
          ),
        );
        writeFileSync(path.join(abandoned, "owner.json"), '{"legacy":true}\n', {
          mode: 0o600,
        });
      },
      matches() {
        return true;
      },
    },
  ];

  for (const scenario of scenarios) {
    for (const invalidation of ["revocation", "expiry"]) {
      await t.test(`${scenario.label} ${invalidation}`, (checkpointTest) => {
        const fixture = createFixture(
          checkpointTest,
          scenario.fixtureOptions ?? {},
        );
        scenario.prepare?.(fixture);
        const plan = planFixture(fixture);
        const paths = automationKernelGuardCutoverPaths(fixture.stateRoot);
        const realDateNow = Date.now;
        let clockMs = realDateNow();
        let expiresAtMs = null;
        if (invalidation === "expiry") {
          const confirmation = JSON.parse(
            readFileSync(fixture.confirmationFile, "utf8"),
          );
          confirmation.approvedAt = new Date(clockMs - 1_000).toISOString();
          expiresAtMs = clockMs + 60_000;
          confirmation.expiresAt = new Date(expiresAtMs).toISOString();
          writeFileSync(
            fixture.confirmationFile,
            `${JSON.stringify(confirmation)}\n`,
            { mode: 0o600 },
          );
          Date.now = () => clockMs;
        }
        let boundarySnapshot = null;
        let checkpointRan = false;
        try {
          assert.throws(
            () =>
              applyAutomationKernelGuardCutover({
                plan,
                ownerConfirmationFile: fixture.confirmationFile,
                checkpoint(name, details) {
                  if (
                    checkpointRan ||
                    name !== scenario.checkpoint ||
                    !scenario.matches(details, paths)
                  ) {
                    return;
                  }
                  checkpointRan = true;
                  if (invalidation === "revocation") {
                    unlinkSync(fixture.confirmationFile);
                  } else {
                    clockMs = expiresAtMs + 1;
                  }
                  boundarySnapshot = snapshotFilesystemTree(
                    fixture.stateRoot,
                  );
                },
              }),
            (error) =>
              error?.code ===
              (invalidation === "revocation"
                ? "owner_confirmation_required"
                : "owner_confirmation_invalid"),
          );
        } finally {
          Date.now = realDateNow;
        }

        assert.equal(checkpointRan, true);
        assert.notEqual(boundarySnapshot, null);
        assert.deepEqual(
          snapshotFilesystemTree(fixture.stateRoot),
          boundarySnapshot,
        );
        assert.equal(existsSync(paths.globalReceipt), false);
      });
    }
  }
});

test("marker link recovery reauthorizes before removing its exact temporary link", async (t) => {
  for (const invalidation of ["revocation", "expiry"]) {
    await t.test(invalidation, (subtest) => {
      const fixture = createFixture(subtest);
      const plan = planFixture(fixture);
      const paths = automationKernelGuardCutoverPaths(fixture.stateRoot);
      assert.throws(
        () =>
          applyAutomationKernelGuardCutover({
            plan,
            ownerConfirmationFile: fixture.confirmationFile,
            checkpoint(name, details) {
              if (
                name === "guard-inner-marker-linked" &&
                details?.filePath === paths.guards.events.inner
              ) {
                throw new Error("stop with linked marker temporary file");
              }
            },
          }),
        /stop with linked marker temporary file/,
      );
      const temporaryPath = `${paths.guards.events.inner}.cutover.tmp`;
      assert.equal(lstatSync(paths.guards.events.inner).nlink, 2);
      assert.equal(existsSync(temporaryPath), true);
      const realDateNow = Date.now;
      let clockMs = realDateNow();
      let expiresAtMs = null;
      if (invalidation === "expiry") {
        const confirmation = JSON.parse(
          readFileSync(fixture.confirmationFile, "utf8"),
        );
        confirmation.approvedAt = new Date(clockMs - 1_000).toISOString();
        expiresAtMs = clockMs + 60_000;
        confirmation.expiresAt = new Date(expiresAtMs).toISOString();
        writeFileSync(
          fixture.confirmationFile,
          `${JSON.stringify(confirmation)}\n`,
          { mode: 0o600 },
        );
        Date.now = () => clockMs;
      }
      let boundarySnapshot = null;
      try {
        assert.throws(
          () =>
            applyAutomationKernelGuardCutover({
              plan,
              ownerConfirmationFile: fixture.confirmationFile,
              checkpoint(name) {
                if (
                  name !==
                    "guard-inner-marker-linked-recovery-before-unlink" ||
                  boundarySnapshot !== null
                ) {
                  return;
                }
                if (invalidation === "revocation") {
                  unlinkSync(fixture.confirmationFile);
                } else {
                  clockMs = expiresAtMs + 1;
                }
                boundarySnapshot = snapshotFilesystemTree(fixture.stateRoot);
              },
            }),
          (error) =>
            error?.code ===
            (invalidation === "revocation"
              ? "owner_confirmation_required"
              : "owner_confirmation_invalid"),
        );
      } finally {
        Date.now = realDateNow;
      }

      assert.notEqual(boundarySnapshot, null);
      assert.deepEqual(
        snapshotFilesystemTree(fixture.stateRoot),
        boundarySnapshot,
      );
      assert.equal(lstatSync(paths.guards.events.inner).nlink, 2);
      assert.equal(existsSync(temporaryPath), true);
      assert.equal(existsSync(paths.globalReceipt), false);
    });
  }
});

test("foreign private cutover temporary bytes fail closed without deletion", async (t) => {
  const scenarios = [
    {
      name: "bootstrap marker temporary file",
      temporaryPath(paths) {
        return `${paths.bootstrapLock}.cutover.tmp`;
      },
    },
    {
      name: "writer claim temporary file",
      temporaryPath(paths) {
        return `${paths.writerLock}.cutover-claim.tmp`;
      },
    },
  ];

  for (const scenario of scenarios) {
    await t.test(scenario.name, (subtest) => {
      const fixture = createFixture(subtest);
      const plan = planFixture(fixture);
      const paths = automationKernelGuardCutoverPaths(fixture.stateRoot);
      const temporaryPath = scenario.temporaryPath(paths);
      const foreignBytes = Buffer.from("foreign-private-temporary-bytes\n");
      writeFileSync(temporaryPath, foreignBytes, { mode: 0o600 });

      assert.throws(
        () =>
          applyAutomationKernelGuardCutover({
            plan,
            ownerConfirmationFile: fixture.confirmationFile,
          }),
        (error) => error?.code === "cutover_conflict",
      );

      assert.deepEqual(readFileSync(temporaryPath), foreignBytes);
      assert.equal(lstatSync(temporaryPath).mode & 0o7777, 0o600);
      assert.equal(existsSync(paths.globalReceipt), false);
    });
  }
});

test("unsafe exact authorization evidence fails before bootstrap mutation", (t) => {
  const fixture = createFixture(t);
  const plan = planFixture(fixture);
  const paths = automationKernelGuardCutoverPaths(fixture.stateRoot);
  const confirmationBytes = readFileSync(fixture.confirmationFile);
  const confirmation = JSON.parse(confirmationBytes.toString("utf8"));
  const confirmationDigest = sha256(
    Buffer.from(stableJson(confirmation), "utf8"),
  );
  const confirmationRawDigest = sha256(confirmationBytes);
  const authorizationDirectory = privateDirectory(
    path.join(
      paths.artifactRoot,
      plan.parameters.cutoverId,
      "authorizations",
    ),
  );
  const confirmationArtifact = path.join(
    authorizationDirectory,
    `${confirmationDigest}-${confirmationRawDigest}.json`,
  );
  const externalFile = path.join(fixture.root, "external-confirmation.json");
  writeFileSync(externalFile, confirmationBytes, { mode: 0o600 });
  symlinkSync(externalFile, confirmationArtifact);
  const manifestPath = path.join(fixture.controlRoot, "current-tasks.json");
  const eventsPath = path.join(fixture.controlRoot, "events.jsonl");
  const manifestBefore = readFileSync(manifestPath);
  const eventsBefore = readFileSync(eventsPath);

  assert.throws(
    () =>
      applyAutomationKernelGuardCutover({
        plan,
        ownerConfirmationFile: fixture.confirmationFile,
      }),
    (error) => error?.code === "cutover_state_invalid",
  );

  assert.deepEqual(readFileSync(manifestPath), manifestBefore);
  assert.deepEqual(readFileSync(eventsPath), eventsBefore);
  assert.equal(lstatSync(confirmationArtifact).isSymbolicLink(), true);
  assert.equal(existsSync(paths.transaction), false);
  assert.equal(existsSync(paths.bootstrapLock), false);
  assert.equal(existsSync(paths.globalReceipt), false);
  assert.equal(existsSync(paths.writerLock), false);
  assert.deepEqual(readdirSync(paths.guardsRoot), []);
});

test("prepared retry rejects malformed canonical task state before markers", (t) => {
  const fixture = createFixture(t);
  const plan = planFixture(fixture);
  seedPreparedTransaction(fixture, plan);
  const paths = automationKernelGuardCutoverPaths(fixture.stateRoot);
  const manifestPath = path.join(fixture.controlRoot, "current-tasks.json");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  manifest.tasks[0].state = "invented-state";
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, {
    mode: 0o600,
  });
  const manifestBefore = readFileSync(manifestPath);
  const transactionBefore = readFileSync(paths.transaction);
  const eventsBefore = readFileSync(
    path.join(fixture.controlRoot, "events.jsonl"),
  );

  assert.throws(
    () =>
      applyAutomationKernelGuardCutover({
        plan,
        ownerConfirmationFile: fixture.confirmationFile,
      }),
    (error) =>
      error?.code === "cutover_source_drift" ||
      error?.code === "cutover_task_invalid",
  );

  assert.deepEqual(readFileSync(manifestPath), manifestBefore);
  assert.deepEqual(readFileSync(paths.transaction), transactionBefore);
  assert.deepEqual(
    readFileSync(path.join(fixture.controlRoot, "events.jsonl")),
    eventsBefore,
  );
  assert.equal(existsSync(paths.globalReceipt), false);
  assert.equal(existsSync(paths.bootstrapLock), false);
  assert.equal(existsSync(paths.writerLock), false);
  assert.deepEqual(readdirSync(fixture.guardsRoot), []);
});

test("prepared transaction rejects noncanonical and impossible timestamp sequences", async (t) => {
  const cases = [
    {
      name: "noncanonical prepared timestamp",
      mutate(transaction) {
        transaction.preparedAt = transaction.preparedAt.replace(
          /\.\d{3}Z$/,
          "Z",
        );
        transaction.authorizations[0].validatedAt = transaction.preparedAt;
      },
    },
    {
      name: "authorization before preparation",
      mutate(transaction) {
        transaction.authorizations[0].validatedAt = new Date(
          Date.parse(transaction.preparedAt) - 1,
        ).toISOString();
      },
    },
    {
      name: "claim before preparation",
      mutate(transaction) {
        transaction.claimGenerations.push({
          claimToken: "a".repeat(64),
          claimedAt: new Date(
            Date.parse(transaction.preparedAt) - 1,
          ).toISOString(),
          pid: process.pid,
          processStartIdentity: "test:claim-before-preparation",
        });
      },
    },
    {
      name: "completion before authorization",
      mutate(transaction) {
        transaction.phase = "receipt-prepared";
        transaction.authorizations[0].validatedAt = new Date(
          Date.parse(transaction.preparedAt) + 2,
        ).toISOString();
        transaction.completedAt = new Date(
          Date.parse(transaction.preparedAt) + 1,
        ).toISOString();
      },
    },
    {
      name: "completion does not equal the final authorization",
      mutate(transaction) {
        transaction.phase = "receipt-prepared";
        transaction.authorizations[0].validatedAt = new Date(
          Date.parse(transaction.preparedAt) + 1,
        ).toISOString();
        transaction.completedAt = new Date(
          Date.parse(transaction.preparedAt) + 2,
        ).toISOString();
      },
    },
    {
      name: "completion reaches the embedded confirmation expiry",
      mutate(transaction) {
        const confirmation = JSON.parse(
          Buffer.from(
            transaction.authorizations[0].confirmationBytesBase64,
            "base64",
          ).toString("utf8"),
        );
        transaction.phase = "receipt-prepared";
        transaction.authorizations[0].validatedAt = confirmation.expiresAt;
        transaction.completedAt = confirmation.expiresAt;
      },
    },
  ];

  for (const testCase of cases) {
    await t.test(testCase.name, (subtest) => {
      const fixture = createFixture(subtest);
      const plan = planFixture(fixture);
      seedPreparedTransaction(fixture, plan);
      const transaction = readSeededTransaction(fixture);
      testCase.mutate(transaction);
      writeSeededTransaction(fixture, transaction);
      const paths = automationKernelGuardCutoverPaths(fixture.stateRoot);

      assert.throws(
        () =>
          applyAutomationKernelGuardCutover({
            plan,
            ownerConfirmationFile: fixture.confirmationFile,
          }),
        (error) => error?.code === "cutover_transaction_invalid",
      );
      assert.equal(existsSync(paths.globalReceipt), false);
      assert.equal(existsSync(paths.writerLock), false);
    });
  }
});

test("prepared transaction rejects duplicate and unbounded retry identities", async (t) => {
  const cases = [
    {
      name: "duplicate authorization identity",
      mutate(transaction) {
        transaction.authorizations.push({ ...transaction.authorizations[0] });
      },
    },
    {
      name: "more than 64 authorizations",
      mutate(transaction) {
        const base = transaction.authorizations[0];
        transaction.authorizations = Array.from({ length: 65 }, (_, index) => ({
          ...base,
          confirmationId: `retry-${index.toLocaleString("en-US", { useGrouping: false })}`,
          confirmationDigest: sha256(Buffer.from(`authorization-${index}`)),
        }));
      },
    },
    {
      name: "duplicate claim token",
      mutate(transaction) {
        const generation = {
          claimToken: "b".repeat(64),
          claimedAt: transaction.preparedAt,
          pid: process.pid,
          processStartIdentity: "test:duplicate-claim",
        };
        transaction.claimGenerations = [
          generation,
          { ...generation, pid: process.pid + 1 },
        ];
      },
    },
    {
      name: "more than 64 claim generations",
      mutate(transaction) {
        transaction.claimGenerations = Array.from(
          { length: 65 },
          (_, index) => ({
            claimToken: sha256(Buffer.from(`claim-${index}`)),
            claimedAt: transaction.preparedAt,
            pid: process.pid + index + 1,
            processStartIdentity: `test:claim-${index.toLocaleString("en-US", { useGrouping: false })}`,
          }),
        );
      },
    },
  ];

  for (const testCase of cases) {
    await t.test(testCase.name, (subtest) => {
      const fixture = createFixture(subtest);
      const plan = planFixture(fixture);
      seedPreparedTransaction(fixture, plan);
      const transaction = readSeededTransaction(fixture);
      testCase.mutate(transaction);
      writeSeededTransaction(fixture, transaction);
      const paths = automationKernelGuardCutoverPaths(fixture.stateRoot);

      assert.throws(
        () =>
          applyAutomationKernelGuardCutover({
            plan,
            ownerConfirmationFile: fixture.confirmationFile,
          }),
        (error) => error?.code === "cutover_transaction_invalid",
      );
      assert.equal(existsSync(paths.globalReceipt), false);
      assert.equal(existsSync(paths.writerLock), false);
    });
  }
});

test("private cutover admission rejects static mode drift and post-open swaps", async (t) => {
  await t.test("plan mode drift", () => {
    const fixture = createFixture(t);
    planFixture(fixture);
    chmodSync(fixture.planFile, 0o640);

    assert.throws(
      () => readAutomationKernelGuardCutoverPlan(fixture.planFile),
      (error) => error?.code === "cutover_state_invalid",
    );
  });

  await t.test("transaction mode drift", () => {
    const fixture = createFixture(t);
    const plan = planFixture(fixture);
    seedPreparedTransaction(fixture, plan);
    const paths = automationKernelGuardCutoverPaths(fixture.stateRoot);
    chmodSync(paths.transaction, 0o640);

    assert.throws(
      () =>
        applyAutomationKernelGuardCutover({
          plan,
          ownerConfirmationFile: fixture.confirmationFile,
        }),
      (error) => error?.code === "cutover_transaction_invalid",
    );
    assert.equal(existsSync(paths.globalReceipt), false);
  });

  await t.test("authorization evidence mode drift", () => {
    const fixture = createFixture(t);
    const plan = planFixture(fixture);
    seedPreparedTransaction(fixture, plan);
    const paths = automationKernelGuardCutoverPaths(fixture.stateRoot);
    const transaction = readSeededTransaction(fixture);
    chmodSync(transaction.authorizations[0].confirmationArtifact, 0o640);

    assert.throws(
      () =>
        applyAutomationKernelGuardCutover({
          plan,
          ownerConfirmationFile: fixture.confirmationFile,
        }),
      (error) => error?.code === "cutover_state_invalid",
    );
    assert.equal(existsSync(paths.globalReceipt), false);
  });

  for (const mutation of ["mode", "path"]) {
    await t.test(`transaction ${mutation} swap after open`, () => {
      const fixture = createFixture(t);
      const plan = planFixture(fixture);
      seedPreparedTransaction(fixture, plan);
      const paths = automationKernelGuardCutoverPaths(fixture.stateRoot);
      const transactionBytes = readFileSync(paths.transaction);
      let changed = false;

      assert.throws(
        () =>
          applyAutomationKernelGuardCutover({
            plan,
            ownerConfirmationFile: fixture.confirmationFile,
            checkpoint(name) {
              if (name !== "transaction-private-file-opened" || changed) return;
              changed = true;
              if (mutation === "mode") {
                chmodSync(paths.transaction, 0o640);
                return;
              }
              renameSync(
                paths.transaction,
                `${paths.transaction}.swapped-original`,
              );
              writeFileSync(paths.transaction, transactionBytes, {
                mode: 0o600,
              });
            },
          }),
        (error) => error?.code === "cutover_transaction_invalid",
      );
      assert.equal(changed, true);
      assert.equal(existsSync(paths.globalReceipt), false);
    });
  }
});

test("write-ahead recovery rejects journal, inode, and partial-byte tampering", async (t) => {
  await t.test("journal identity drift", () => {
    const fixture = createFixture(t, { legacyWriter: true });
    const plan = planFixture(fixture);
    const paths = automationKernelGuardCutoverPaths(fixture.stateRoot);
    const writerBefore = readFileSync(paths.writerLock);
    assert.throws(
      () =>
        applyAutomationKernelGuardCutover({
          plan,
          ownerConfirmationFile: fixture.confirmationFile,
          checkpoint(name) {
            if (name === "writer-claim-before-write-journal-durable") {
              throw new Error("stop after journal");
            }
          },
        }),
      /stop after journal/,
    );
    const journal = JSON.parse(readFileSync(paths.writeAhead, "utf8"));
    journal.sourceDigest = "0".repeat(64);
    writeFileSync(paths.writeAhead, `${JSON.stringify(journal, null, 2)}\n`, {
      mode: 0o600,
    });

    assert.throws(
      () =>
        applyAutomationKernelGuardCutover({
          plan,
          ownerConfirmationFile: fixture.confirmationFile,
        }),
      (error) => error?.code === "cutover_write_ahead_invalid",
    );
    assert.deepEqual(readFileSync(paths.writerLock), writerBefore);
    assert.equal(existsSync(paths.globalReceipt), false);
  });

  await t.test("canonical inode drift", () => {
    const fixture = createFixture(t, { legacyWriter: true });
    const plan = planFixture(fixture);
    const paths = automationKernelGuardCutoverPaths(fixture.stateRoot);
    const writerBefore = readFileSync(paths.writerLock);
    assert.throws(
      () =>
        applyAutomationKernelGuardCutover({
          plan,
          ownerConfirmationFile: fixture.confirmationFile,
          checkpoint(name) {
            if (name === "writer-claim-before-write-journal-durable") {
              throw new Error("stop after journal");
            }
          },
        }),
      /stop after journal/,
    );
    renameSync(paths.writerLock, `${paths.writerLock}.old-generation`);
    writeFileSync(paths.writerLock, writerBefore, { mode: 0o600 });

    assert.throws(
      () =>
        applyAutomationKernelGuardCutover({
          plan,
          ownerConfirmationFile: fixture.confirmationFile,
        }),
      (error) => error?.code === "cutover_source_drift",
    );
    assert.deepEqual(readFileSync(paths.writerLock), writerBefore);
    assert.equal(existsSync(paths.globalReceipt), false);
  });

  await t.test("partial rewrite drift", () => {
    const fixture = createFixture(t, { legacyWriter: true });
    const plan = planFixture(fixture);
    const paths = automationKernelGuardCutoverPaths(fixture.stateRoot);
    runCutoverKilledAtCheckpoint(
      fixture,
      "writer-claim-before-write-after-first-write",
      { filePath: paths.writerLock },
    );
    const bytes = readFileSync(paths.writerLock);
    bytes[0] ^= 0xff;
    writeFileSync(paths.writerLock, bytes, { mode: 0o600 });

    assert.throws(
      () =>
        applyAutomationKernelGuardCutover({
          plan,
          ownerConfirmationFile: fixture.confirmationFile,
        }),
      (error) => error?.code === "cutover_source_drift",
    );
    assert.equal(existsSync(paths.globalReceipt), false);
  });
});

test("supersede rejects an apply-scoped write-ahead record until same-plan recovery", (t) => {
  const fixture = createFixture(t);
  const plan = planFixture(fixture);
  const paths = automationKernelGuardCutoverPaths(fixture.stateRoot);
  assert.throws(
    () =>
      applyAutomationKernelGuardCutover({
        plan,
        ownerConfirmationFile: fixture.confirmationFile,
        checkpoint(name) {
          if (name === "claims-transaction-durable") {
            throw new Error("stop before supersede planning");
          }
        },
      }),
    /stop before supersede planning/,
  );
  const supersedePlan = supersedePlanFixture(fixture, plan);
  writeConfirmation(fixture, plan, "kernel-cutover-apply-recovery");
  assert.throws(
    () =>
      applyAutomationKernelGuardCutover({
        plan,
        ownerConfirmationFile: fixture.confirmationFile,
        checkpoint(name) {
          if (name === "writer-marker-before-write-journal-durable") {
            throw new Error("stop with apply write-ahead");
          }
        },
      }),
    /stop with apply write-ahead/,
  );
  assert.equal(
    JSON.parse(readFileSync(paths.writeAhead, "utf8")).scope,
    "apply",
  );
  writeConfirmation(
    fixture,
    supersedePlan,
    "kernel-cutover-supersede-write-ahead-rejection",
  );

  const unchanged = snapshotFilesystemTree(fixture.root);
  assert.throws(
    () => planAutomationKernelGuardCutoverSupersede({ plan }),
    (error) =>
      error?.code === "cutover_supersede_conflict" &&
      /must resume under its original plan/.test(error.message),
  );
  assert.deepEqual(snapshotFilesystemTree(fixture.root), unchanged);
  assert.throws(
    () =>
      applyAutomationKernelGuardCutoverSupersede({
        plan,
        supersedePlan,
        ownerConfirmationFile: fixture.confirmationFile,
      }),
    (error) =>
      error?.code === "cutover_supersede_conflict" &&
      /must resume under its original plan/.test(error.message),
  );
  assert.deepEqual(snapshotFilesystemTree(fixture.root), unchanged);

  writeConfirmation(fixture, plan, "kernel-cutover-apply-recovery-resume");
  const recovered = applyAutomationKernelGuardCutover({
    plan,
    ownerConfirmationFile: fixture.confirmationFile,
  });
  assert.equal(recovered.changed, true);
  assert.equal(existsSync(paths.writeAhead), false);
  assert.equal(
    inspectAutomationKernelGuardCutover(fixture.stateRoot).ready,
    true,
  );
});

test("owner-confirmed prepared supersede recovers drift and admits one fresh cutover", (t) => {
  const fixture = createFixture(t);
  const oldPlan = planFixture(fixture);
  seedPreparedTransaction(fixture, oldPlan);
  const paths = automationKernelGuardCutoverPaths(fixture.stateRoot);
  writeFileSync(
    path.join(fixture.controlRoot, "events.jsonl"),
    '{"type":"protected-source-drift"}\n',
    { mode: 0o600 },
  );
  writeFileSync(
    path.join(fixture.repoRoot, "README.md"),
    "cutover fixture advanced after prepare\n",
  );
  git(fixture.repoRoot, ["add", "README.md"]);
  git(fixture.repoRoot, ["commit", "-m", "test: advance cutover fixture"]);
  git(fixture.repoRoot, ["push", "origin", "dev"]);
  assert.throws(
    () =>
      applyAutomationKernelGuardCutover({
        plan: oldPlan,
        ownerConfirmationFile: fixture.confirmationFile,
      }),
    (error) => error?.code === "cutover_source_drift",
  );

  const planned = runCli([
    "plan-supersede",
    "--plan-file",
    fixture.planFile,
    "--supersede-plan-file",
    fixture.supersedePlanFile,
  ]);
  const supersedePlan = readAutomationKernelGuardCutoverSupersedePlan(
    fixture.supersedePlanFile,
    oldPlan,
  );
  writeConfirmation(fixture, supersedePlan, "prepared-cutover-supersede");
  const superseded = runCli([
    "supersede",
    "--plan-file",
    fixture.planFile,
    "--supersede-plan-file",
    fixture.supersedePlanFile,
    "--owner-confirmation-file",
    fixture.confirmationFile,
  ]);

  assert.equal(planned.ok, true);
  assert.equal(planned.intentDigest, supersedePlan.intentDigest);
  assert.equal(superseded.ok, true);
  assert.equal(superseded.result.changed, true);
  assert.equal(existsSync(paths.transaction), false);
  assert.equal(existsSync(paths.globalReceipt), false);
  assert.equal(existsSync(paths.writerLock), false);
  assert.deepEqual(readdirSync(paths.guardsRoot), []);
  assert.deepEqual(
    readFileSync(paths.bootstrapLock),
    automationKernelGuardMarkerBytes(),
  );

  const stable = applyAutomationKernelGuardCutoverSupersede({
    plan: oldPlan,
    supersedePlan,
    ownerConfirmationFile: fixture.confirmationFile,
  });
  assert.equal(stable.changed, false);

  const freshPlanFile = path.join(fixture.root, "fresh-cutover-plan.json");
  const freshPlan = planAutomationKernelGuardCutover({
    stateRoot: fixture.stateRoot,
    taskId: TASK_ID,
    codexHome: fixture.codexHome,
    repoRoot: fixture.repoRoot,
  });
  assert.notEqual(
    freshPlan.parameters.sourceCodeSha,
    oldPlan.parameters.sourceCodeSha,
  );
  writeAutomationKernelGuardCutoverPlan(freshPlanFile, freshPlan);
  writeConfirmation(fixture, freshPlan, "fresh-cutover-after-supersede");
  const applied = applyAutomationKernelGuardCutover({
    plan: freshPlan,
    ownerConfirmationFile: fixture.confirmationFile,
  });
  assert.equal(applied.changed, true);
  const inspection = inspectAutomationKernelGuardCutover(fixture.stateRoot);
  assert.equal(inspection.ready, true, inspection.problems.join("\n"));
});

test("caller-owned supersede plan mutation cannot redirect transaction retirement", (t) => {
  const fixture = createFixture(t);
  const oldPlan = planFixture(fixture);
  seedPreparedTransaction(fixture, oldPlan);
  const supersedePlan = supersedePlanFixture(fixture, oldPlan);
  const victim = createFixture(t);
  const victimOldPlan = planFixture(victim);
  seedPreparedTransaction(victim, victimOldPlan);
  const victimSupersedePlan = supersedePlanFixture(victim, victimOldPlan);
  const rawOldPlan = structuredClone(oldPlan);
  const rawSupersedePlan = structuredClone(supersedePlan);
  const sourcePaths = automationKernelGuardCutoverPaths(fixture.stateRoot);
  const victimPaths = automationKernelGuardCutoverPaths(victim.stateRoot);
  const victimBefore = snapshotFilesystemTree(victim.stateRoot);
  let mutationRan = false;

  const result = applyAutomationKernelGuardCutoverSupersede({
    plan: rawOldPlan,
    supersedePlan: rawSupersedePlan,
    ownerConfirmationFile: fixture.confirmationFile,
    checkpoint(name) {
      if (name !== "supersede-evidence-durable") return;
      Object.assign(rawOldPlan, structuredClone(victimOldPlan));
      Object.assign(
        rawSupersedePlan,
        structuredClone(victimSupersedePlan),
      );
      mutationRan = true;
    },
  });

  assert.equal(mutationRan, true);
  assert.equal(result.changed, true);
  assert.equal(existsSync(sourcePaths.transaction), false);
  assert.equal(existsSync(sourcePaths.globalReceipt), false);
  assert.equal(existsSync(victimPaths.transaction), true);
  assert.deepEqual(snapshotFilesystemTree(victim.stateRoot), victimBefore);
});

test("supersede callbacks cannot retire after the plan-bound task changes", async (t) => {
  for (const checkpointName of [
    "supersede-receipt-linked",
    "supersede-receipt-durable",
    "supersede-transaction-retire-journal-durable",
  ]) {
    await t.test(checkpointName, (subtest) => {
      const fixture = createFixture(subtest, {
        legacyGuard: true,
        legacyWriter: true,
      });
      const oldPlan = planFixture(fixture);
      seedPreparedTransaction(fixture, oldPlan);
      const supersedePlan = supersedePlanFixture(fixture, oldPlan);
      const paths = automationKernelGuardCutoverPaths(fixture.stateRoot);
      const manifestPath = path.join(
        fixture.controlRoot,
        "current-tasks.json",
      );
      let boundarySnapshot = null;

      assert.throws(
        () =>
          applyAutomationKernelGuardCutoverSupersede({
            plan: oldPlan,
            supersedePlan,
            ownerConfirmationFile: fixture.confirmationFile,
            checkpoint(name) {
              if (name !== checkpointName || boundarySnapshot !== null) return;
              const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
              manifest.tasks[0].details.supersedeCallbackDrift = checkpointName;
              writeFileSync(
                manifestPath,
                `${JSON.stringify(manifest, null, 2)}\n`,
                { mode: 0o600 },
              );
              boundarySnapshot = snapshotFilesystemTree(fixture.stateRoot);
            },
          }),
        (error) => error?.code === "cutover_supersede_source_drift",
      );

      assert.notEqual(boundarySnapshot, null);
      assert.deepEqual(
        snapshotFilesystemTree(fixture.stateRoot),
        boundarySnapshot,
      );
      assert.equal(existsSync(paths.transaction), true);
      assert.equal(existsSync(paths.globalReceipt), false);
    });
  }
});

test("supersede receipt link rejects a replacement live confirmation", (t) => {
  const fixture = createFixture(t, { legacyGuard: true, legacyWriter: true });
  const oldPlan = planFixture(fixture);
  seedPreparedTransaction(fixture, oldPlan);
  const supersedePlan = supersedePlanFixture(fixture, oldPlan);
  const paths = automationKernelGuardCutoverPaths(fixture.stateRoot);
  const receiptPath = path.join(
    paths.artifactRoot,
    oldPlan.parameters.cutoverId,
    "superseded",
    supersedePlan.parameters.supersedeId,
    "receipt.json",
  );
  let replaced = false;

  assert.throws(
    () =>
      applyAutomationKernelGuardCutoverSupersede({
        plan: oldPlan,
        supersedePlan,
        ownerConfirmationFile: fixture.confirmationFile,
        checkpoint(name) {
          if (name !== "supersede-receipt-linked" || replaced) return;
          replaced = true;
          writeConfirmation(
            fixture,
            supersedePlan,
            "replacement-supersede-confirmation",
          );
        },
      }),
    (error) => error?.code === "cutover_authorization_invalid",
  );

  assert.equal(replaced, true);
  assert.equal(lstatSync(receiptPath).nlink, 2);
  assert.equal(existsSync(`${receiptPath}.cutover.tmp`), true);
  assert.equal(existsSync(paths.transaction), true);
  const receiptBeforeRecovery = readFileSync(receiptPath);
  const recovered = applyAutomationKernelGuardCutoverSupersede({
    plan: oldPlan,
    supersedePlan,
    ownerConfirmationFile: fixture.confirmationFile,
  });
  assert.equal(recovered.changed, true);
  assert.deepEqual(readFileSync(receiptPath), receiptBeforeRecovery);
  assert.equal(existsSync(paths.transaction), false);
});

test("supersede receipt preserves raw owner confirmation across retry and rejects tampering", (t) => {
  const fixture = createFixture(t, { legacyGuard: true, legacyWriter: true });
  const oldPlan = planFixture(fixture);
  seedPreparedTransaction(fixture, oldPlan);
  const supersedePlan = supersedePlanFixture(fixture, oldPlan);
  const paths = automationKernelGuardCutoverPaths(fixture.stateRoot);
  const receiptPath = path.join(
    paths.artifactRoot,
    oldPlan.parameters.cutoverId,
    "superseded",
    supersedePlan.parameters.supersedeId,
    "receipt.json",
  );

  assert.throws(
    () =>
      applyAutomationKernelGuardCutoverSupersede({
        plan: oldPlan,
        supersedePlan,
        ownerConfirmationFile: fixture.confirmationFile,
        checkpoint(name) {
          if (name === "supersede-receipt-durable") {
            throw new Error("stop after supersede receipt");
          }
        },
      }),
    /stop after supersede receipt/,
  );
  const receiptBeforeRetry = readFileSync(receiptPath);
  const preparedReceipt = JSON.parse(receiptBeforeRetry);
  const storedConfirmation = JSON.parse(
    Buffer.from(preparedReceipt.confirmationBytesBase64, "base64"),
  );
  assert.equal(storedConfirmation.intent.action, supersedePlan.intent.action);
  assert.equal(
    storedConfirmation.confirmationId,
    "kernel-cutover-supersede-test",
  );
  assert.equal(
    sha256(Buffer.from(preparedReceipt.confirmationBytesBase64, "base64")),
    preparedReceipt.confirmationRawDigest,
  );

  writeConfirmation(fixture, supersedePlan, "supersede-fresh-retry");
  const recovered = applyAutomationKernelGuardCutoverSupersede({
    plan: oldPlan,
    supersedePlan,
    ownerConfirmationFile: fixture.confirmationFile,
  });
  assert.equal(recovered.changed, true);
  assert.deepEqual(readFileSync(receiptPath), receiptBeforeRetry);
  assert.equal(existsSync(paths.transaction), false);

  const manifestBefore = readFileSync(
    path.join(fixture.controlRoot, "current-tasks.json"),
  );
  const eventsBefore = readFileSync(
    path.join(fixture.controlRoot, "events.jsonl"),
  );
  const tampered = JSON.parse(receiptBeforeRetry);
  const forgedBytes = Buffer.from("{}\n", "utf8");
  tampered.confirmationBytesBase64 = forgedBytes.toString("base64");
  tampered.confirmationRawDigest = sha256(forgedBytes);
  writeFileSync(receiptPath, `${JSON.stringify(tampered, null, 2)}\n`, {
    mode: 0o600,
  });
  const tamperedReceipt = readFileSync(receiptPath);

  assert.throws(
    () =>
      applyAutomationKernelGuardCutoverSupersede({
        plan: oldPlan,
        supersedePlan,
        ownerConfirmationFile: fixture.confirmationFile,
      }),
    (error) => error?.code === "cutover_supersede_conflict",
  );
  assert.deepEqual(readFileSync(receiptPath), tamperedReceipt);
  assert.deepEqual(
    readFileSync(path.join(fixture.controlRoot, "current-tasks.json")),
    manifestBefore,
  );
  assert.deepEqual(
    readFileSync(path.join(fixture.controlRoot, "events.jsonl")),
    eventsBefore,
  );
  assert.equal(existsSync(paths.transaction), false);
  assert.equal(existsSync(paths.globalReceipt), false);
});

test("supersede completion must remain inside its embedded confirmation window", (t) => {
  const fixture = createFixture(t, { legacyGuard: true, legacyWriter: true });
  const oldPlan = planFixture(fixture);
  seedPreparedTransaction(fixture, oldPlan);
  const supersedePlan = supersedePlanFixture(fixture, oldPlan);
  const paths = automationKernelGuardCutoverPaths(fixture.stateRoot);
  const receiptPath = path.join(
    paths.artifactRoot,
    oldPlan.parameters.cutoverId,
    "superseded",
    supersedePlan.parameters.supersedeId,
    "receipt.json",
  );
  assert.throws(
    () =>
      applyAutomationKernelGuardCutoverSupersede({
        plan: oldPlan,
        supersedePlan,
        ownerConfirmationFile: fixture.confirmationFile,
        checkpoint(name) {
          if (name === "supersede-receipt-durable") {
            throw new Error("stop after supersede receipt");
          }
        },
      }),
    /stop after supersede receipt/,
  );
  const receipt = JSON.parse(readFileSync(receiptPath, "utf8"));
  const confirmation = JSON.parse(
    Buffer.from(receipt.confirmationBytesBase64, "base64").toString("utf8"),
  );
  receipt.supersededAt = confirmation.expiresAt;
  writeFileSync(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`, {
    mode: 0o600,
  });
  const treeBefore = snapshotFilesystemTree(fixture.stateRoot);

  assert.throws(
    () =>
      applyAutomationKernelGuardCutoverSupersede({
        plan: oldPlan,
        supersedePlan,
        ownerConfirmationFile: fixture.confirmationFile,
      }),
    (error) => error?.code === "cutover_supersede_conflict",
  );
  assert.deepEqual(snapshotFilesystemTree(fixture.stateRoot), treeBefore);
  assert.equal(existsSync(paths.transaction), true);
  assert.equal(existsSync(paths.globalReceipt), false);
});

test("claims-installed supersede restores every exact planned legacy byte", (t) => {
  const fixture = createFixture(t, { legacyGuard: true, legacyWriter: true });
  const oldPlan = planFixture(fixture);
  const paths = automationKernelGuardCutoverPaths(fixture.stateRoot);
  const writerBefore = readFileSync(paths.writerLock);
  const guardOwnerBefore = readFileSync(paths.guards.events.owner);
  const guardModeBefore =
    lstatSync(paths.guards.events.directory).mode & 0o7777;
  assert.throws(
    () =>
      applyAutomationKernelGuardCutover({
        plan: oldPlan,
        ownerConfirmationFile: fixture.confirmationFile,
        checkpoint(name) {
          if (name === "claims-transaction-durable") {
            throw new Error("stop after claims");
          }
        },
      }),
    /stop after claims/,
  );
  assert.equal(readSeededTransaction(fixture).phase, "claims-installed");
  const supersedePlan = supersedePlanFixture(fixture, oldPlan);
  const result = applyAutomationKernelGuardCutoverSupersede({
    plan: oldPlan,
    supersedePlan,
    ownerConfirmationFile: fixture.confirmationFile,
  });

  assert.equal(result.changed, true);
  assert.deepEqual(readFileSync(paths.writerLock), writerBefore);
  assert.deepEqual(readFileSync(paths.guards.events.owner), guardOwnerBefore);
  assert.equal(
    lstatSync(paths.guards.events.directory).mode & 0o7777,
    guardModeBefore,
  );
  assert.equal(existsSync(paths.transaction), false);
  assert.equal(existsSync(paths.globalReceipt), false);
});

test("supersede refuses every permanent target marker", (t) => {
  const fixture = createFixture(t);
  const oldPlan = planFixture(fixture);
  const paths = automationKernelGuardCutoverPaths(fixture.stateRoot);
  assert.throws(
    () =>
      applyAutomationKernelGuardCutover({
        plan: oldPlan,
        ownerConfirmationFile: fixture.confirmationFile,
        checkpoint(name) {
          if (name === "writer-marker-durable") {
            throw new Error("stop after marker");
          }
        },
      }),
    /stop after marker/,
  );
  assert.deepEqual(
    readFileSync(paths.writerLock),
    automationKernelGuardMarkerBytes(),
  );
  assert.throws(
    () => planAutomationKernelGuardCutoverSupersede({ plan: oldPlan }),
    (error) => error?.code === "cutover_supersede_too_late",
  );
  assert.equal(existsSync(paths.globalReceipt), false);
});

test("supersede rejects a malformed canonical task before bootstrap mutation", (t) => {
  const fixture = createFixture(t);
  const oldPlan = planFixture(fixture);
  seedPreparedTransaction(fixture, oldPlan);
  const supersedePlan = supersedePlanFixture(fixture, oldPlan);
  const paths = automationKernelGuardCutoverPaths(fixture.stateRoot);
  const manifestPath = path.join(fixture.controlRoot, "current-tasks.json");
  const eventsPath = path.join(fixture.controlRoot, "events.jsonl");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  manifest.tasks[0].state = "invented-state";
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, {
    mode: 0o600,
  });
  const manifestBefore = readFileSync(manifestPath);
  const eventsBefore = readFileSync(eventsPath);
  const transactionBefore = readFileSync(paths.transaction);
  const artifactNamesBefore = readdirSync(
    path.join(paths.artifactRoot, oldPlan.parameters.cutoverId),
  ).sort();

  assert.throws(
    () =>
      applyAutomationKernelGuardCutoverSupersede({
        plan: oldPlan,
        supersedePlan,
        ownerConfirmationFile: fixture.confirmationFile,
      }),
    (error) => error?.code === "cutover_task_invalid",
  );

  assert.deepEqual(readFileSync(manifestPath), manifestBefore);
  assert.deepEqual(readFileSync(eventsPath), eventsBefore);
  assert.deepEqual(readFileSync(paths.transaction), transactionBefore);
  assert.deepEqual(
    readdirSync(path.join(paths.artifactRoot, oldPlan.parameters.cutoverId)).sort(),
    artifactNamesBefore,
  );
  assert.equal(existsSync(paths.bootstrapLock), false);
  assert.equal(existsSync(paths.globalReceipt), false);
  assert.equal(existsSync(paths.writerLock), false);
  assert.deepEqual(readdirSync(paths.guardsRoot), []);
});

test("supersede rejects task and transaction tampering without retiring evidence", async (t) => {
  await t.test("current task drift", () => {
    const fixture = createFixture(t);
    const oldPlan = planFixture(fixture);
    seedPreparedTransaction(fixture, oldPlan);
    const supersedePlan = supersedePlanFixture(fixture, oldPlan);
    const paths = automationKernelGuardCutoverPaths(fixture.stateRoot);
    const transactionBefore = readFileSync(paths.transaction);
    const manifestPath = path.join(fixture.controlRoot, "current-tasks.json");
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    manifest.tasks[0].details.auditDrift = true;
    writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, {
      mode: 0o600,
    });
    assert.throws(
      () =>
        applyAutomationKernelGuardCutoverSupersede({
          plan: oldPlan,
          supersedePlan,
          ownerConfirmationFile: fixture.confirmationFile,
        }),
      (error) => error?.code === "cutover_supersede_source_drift",
    );
    assert.deepEqual(readFileSync(paths.transaction), transactionBefore);
    assert.equal(existsSync(paths.globalReceipt), false);
  });

  await t.test("transaction drift", () => {
    const fixture = createFixture(t);
    const oldPlan = planFixture(fixture);
    seedPreparedTransaction(fixture, oldPlan);
    const supersedePlan = supersedePlanFixture(fixture, oldPlan);
    const paths = automationKernelGuardCutoverPaths(fixture.stateRoot);
    const transaction = readSeededTransaction(fixture);
    transaction.claimGenerations.push({
      claimToken: "d".repeat(64),
      claimedAt: transaction.preparedAt,
      pid: process.pid,
      processStartIdentity: "test:transaction-drift",
    });
    writeSeededTransaction(fixture, transaction);
    const transactionBefore = readFileSync(paths.transaction);
    assert.throws(
      () =>
        applyAutomationKernelGuardCutoverSupersede({
          plan: oldPlan,
          supersedePlan,
          ownerConfirmationFile: fixture.confirmationFile,
        }),
      (error) => error?.code === "cutover_supersede_conflict",
    );
    assert.deepEqual(readFileSync(paths.transaction), transactionBefore);
    assert.equal(existsSync(paths.globalReceipt), false);
  });
});

test("real SIGKILL supersede recovery is exact before and after transaction retirement", async (t) => {
  for (const checkpoint of [
    "supersede-receipt-linked",
    "supersede-receipt-durable",
    "supersede-transaction-retired",
  ]) {
    await t.test(checkpoint, (subtest) => {
      const fixture = createFixture(subtest, {
        legacyGuard: true,
        legacyWriter: true,
      });
      const oldPlan = planFixture(fixture);
      seedPreparedTransaction(fixture, oldPlan);
      const supersedePlan = supersedePlanFixture(fixture, oldPlan);
      const paths = automationKernelGuardCutoverPaths(fixture.stateRoot);
      runSupersedeKilledAtCheckpoint(fixture, checkpoint);

      const recovered = applyAutomationKernelGuardCutoverSupersede({
        plan: oldPlan,
        supersedePlan,
        ownerConfirmationFile: fixture.confirmationFile,
      });
      assert.equal(
        recovered.changed,
        checkpoint !== "supersede-transaction-retired",
      );
      assert.equal(existsSync(paths.transaction), false);
      assert.equal(existsSync(paths.globalReceipt), false);
      const transactionBytes = readFileSync(
        path.join(
          paths.artifactRoot,
          oldPlan.parameters.cutoverId,
          "superseded",
          supersedePlan.parameters.supersedeId,
          "superseded-transaction.json",
        ),
      );
      assert.equal(
        sha256(transactionBytes),
        supersedePlan.parameters.transactionDigest,
      );
      const stable = applyAutomationKernelGuardCutoverSupersede({
        plan: oldPlan,
        supersedePlan,
        ownerConfirmationFile: fixture.confirmationFile,
      });
      assert.equal(stable.changed, false);
    });
  }
});

test("existing legacy guard directory keeps its inode and blocks old stale takeover", (t) => {
  const fixture = createFixture(t, { legacyGuard: true });
  const guardPath = path.join(fixture.guardsRoot, "events.lock");
  const before = lstatSync(guardPath);
  const plan = planFixture(fixture);

  applyAutomationKernelGuardCutover({
    plan,
    ownerConfirmationFile: fixture.confirmationFile,
  });

  const after = lstatSync(guardPath);
  assert.equal(after.dev, before.dev);
  assert.equal(after.ino, before.ino);
  assert.deepEqual(
    readFileSync(path.join(guardPath, "owner.json")),
    automationKernelGuardMarkerBytes(),
  );
  const oldOwner = JSON.parse(
    readFileSync(path.join(guardPath, "owner.json"), "utf8"),
  );
  assert.equal(oldOwner.pid, 1);
  try {
    process.kill(oldOwner.pid, 0);
  } catch (error) {
    assert.equal(error?.code, "EPERM");
  }
});

test("expected-missing guard retry completes from permanent owner with missing inner lock", (t) => {
  const fixture = createFixture(t);
  const plan = planFixture(fixture);
  seedPreparedTransaction(fixture, plan);
  const paths = automationKernelGuardCutoverPaths(fixture.stateRoot);
  const guard = paths.guards.events;
  privateDirectory(guard.directory);
  writeFileSync(guard.owner, automationKernelGuardMarkerBytes(), {
    mode: 0o600,
  });

  const result = applyAutomationKernelGuardCutover({
    plan,
    ownerConfirmationFile: fixture.confirmationFile,
  });

  assert.equal(result.changed, true);
  assert.deepEqual(
    readFileSync(guard.owner),
    automationKernelGuardMarkerBytes(),
  );
  assert.deepEqual(
    readFileSync(guard.inner),
    automationKernelGuardMarkerBytes(),
  );
  assert.equal(
    inspectAutomationKernelGuardCutover(fixture.stateRoot).ready,
    true,
  );
});

test("existing stale writer conversion never overwrites a replacement live old writer", (t) => {
  const fixture = createFixture(t, { legacyWriter: true });
  const plan = planFixture(fixture);
  const paths = automationKernelGuardCutoverPaths(fixture.stateRoot);
  const readyPath = path.join(fixture.root, "old-writer-ready");
  let contender;
  t.after(() => stopChild(contender));

  assert.throws(
    () =>
      applyAutomationKernelGuardCutover({
        plan,
        ownerConfirmationFile: fixture.confirmationFile,
        checkpoint(name) {
          if (name !== "writer-claim-before-write") return;
          contender = spawnLegacyWriterReplacement(paths.writerLock, readyPath);
          waitForPath(readyPath);
        },
      }),
    (error) => error?.code === "cutover_source_drift",
  );

  const liveOwnerBytes = readFileSync(paths.writerLock);
  const liveOwner = JSON.parse(liveOwnerBytes);
  assert.equal(liveOwner.pid, contender.pid);
  assert.equal(liveOwner.token, "live-old-writer-contender");
  assert.notDeepEqual(liveOwnerBytes, automationKernelGuardMarkerBytes());
  assert.equal(existsSync(paths.globalReceipt), false);
});

test("expected-missing guard never overwrites an old contender that wins mkdir", (t) => {
  const fixture = createFixture(t);
  const plan = planFixture(fixture);
  const paths = automationKernelGuardCutoverPaths(fixture.stateRoot);
  const guard = paths.guards.events;
  const readyPath = path.join(fixture.root, "old-guard-ready");
  let contender;
  t.after(() => stopChild(contender));

  assert.throws(
    () =>
      applyAutomationKernelGuardCutover({
        plan,
        ownerConfirmationFile: fixture.confirmationFile,
        checkpoint(name, details) {
          if (
            name !== "guard-claim-before-mkdir" ||
            details.guardName !== "events"
          ) {
            return;
          }
          contender = spawnLegacyGuardContender(guard.directory, readyPath);
          waitForPath(readyPath);
        },
      }),
    (error) => error?.code === "cutover_old_guard_busy",
  );

  const liveOwnerBytes = readFileSync(guard.owner);
  const liveOwner = JSON.parse(liveOwnerBytes);
  assert.equal(liveOwner.pid, contender.pid);
  assert.match(liveOwner.owner, /live-old-guard-contender$/);
  assert.notDeepEqual(liveOwnerBytes, automationKernelGuardMarkerBytes());
  assert.equal(existsSync(guard.inner), false);
  assert.equal(existsSync(paths.globalReceipt), false);
});

test("a delayed old writer stale decision cannot cross the live claim proof", (t) => {
  const fixture = createFixture(t, { legacyWriter: true });
  const plan = planFixture(fixture);
  const paths = automationKernelGuardCutoverPaths(fixture.stateRoot);
  const readyPath = path.join(fixture.root, "paused-writer-ready");
  const continuePath = path.join(fixture.root, "paused-writer-continue");
  const finishedPath = path.join(fixture.root, "paused-writer-finished");
  const contender = spawnPausedLegacyWriterTakeover(
    paths.writerLock,
    readyPath,
    continuePath,
    finishedPath,
  );
  t.after(() => stopChild(contender));
  waitForPath(readyPath);

  assert.throws(
    () =>
      applyAutomationKernelGuardCutover({
        plan,
        ownerConfirmationFile: fixture.confirmationFile,
        checkpoint(name) {
          if (name !== "claims-before-proof") return;
          writeFileSync(continuePath, "continue\n", { mode: 0o600 });
          waitForPath(finishedPath);
        },
      }),
    (error) => error?.code === "cutover_claim_conflict",
  );

  const liveOwner = JSON.parse(readFileSync(paths.writerLock, "utf8"));
  assert.equal(liveOwner.pid, contender.pid);
  assert.equal(liveOwner.token, "paused-old-writer-takeover");
  assert.notDeepEqual(
    readFileSync(paths.writerLock),
    automationKernelGuardMarkerBytes(),
  );
  assert.equal(existsSync(paths.globalReceipt), false);
});

test("a delayed old directory stale decision cannot cross the live claim proof", (t) => {
  const fixture = createFixture(t, { legacyGuard: true });
  const plan = planFixture(fixture);
  const paths = automationKernelGuardCutoverPaths(fixture.stateRoot);
  const guard = paths.guards.events;
  const readyPath = path.join(fixture.root, "paused-guard-ready");
  const continuePath = path.join(fixture.root, "paused-guard-continue");
  const finishedPath = path.join(fixture.root, "paused-guard-finished");
  const contender = spawnPausedLegacyGuardTakeover(
    guard.directory,
    readyPath,
    continuePath,
    finishedPath,
  );
  t.after(() => stopChild(contender));
  waitForPath(readyPath);

  assert.throws(
    () =>
      applyAutomationKernelGuardCutover({
        plan,
        ownerConfirmationFile: fixture.confirmationFile,
        checkpoint(name) {
          if (name !== "claims-before-proof") return;
          writeFileSync(continuePath, "continue\n", { mode: 0o600 });
          waitForPath(finishedPath);
        },
      }),
    (error) => error?.code === "cutover_source_drift",
  );

  const liveOwner = JSON.parse(readFileSync(guard.owner, "utf8"));
  assert.equal(liveOwner.pid, contender.pid);
  assert.match(liveOwner.owner, /paused-old-guard-takeover$/);
  assert.equal(existsSync(guard.inner), false);
  assert.equal(existsSync(paths.globalReceipt), false);
});

test("second quiescence detects an old writer staged after the first proof", (t) => {
  const fixture = createFixture(t, { legacyWriter: true });
  const plan = planFixture(fixture);
  const paths = automationKernelGuardCutoverPaths(fixture.stateRoot);
  const readyPath = path.join(fixture.root, "second-proof-writer-ready");
  const continuePath = path.join(fixture.root, "second-proof-writer-continue");
  const finishedPath = path.join(fixture.root, "second-proof-writer-finished");
  let contender;
  t.after(() => stopChild(contender));

  assert.throws(
    () =>
      applyAutomationKernelGuardCutover({
        plan,
        ownerConfirmationFile: fixture.confirmationFile,
        checkpoint(name) {
          if (name !== "writer-claim-before-write") return;
          contender = spawnPausedLegacyWriterTakeover(
            paths.writerLock,
            readyPath,
            continuePath,
            finishedPath,
            { advertiseControlProcess: true },
          );
          waitForPath(readyPath);
        },
      }),
    (error) => error?.code === "cutover_process_live",
  );
  writeFileSync(continuePath, "continue\n", { mode: 0o600 });
  waitForPath(finishedPath);
  assert.equal(
    JSON.parse(readFileSync(paths.writerLock, "utf8")).token,
    "paused-old-writer-takeover",
  );
  assert.equal(existsSync(paths.globalReceipt), false);
});

test("second quiescence detects an old directory contender staged after the first proof", (t) => {
  const fixture = createFixture(t, { legacyGuard: true });
  const plan = planFixture(fixture);
  const paths = automationKernelGuardCutoverPaths(fixture.stateRoot);
  const guard = paths.guards.events;
  const readyPath = path.join(fixture.root, "second-proof-guard-ready");
  const continuePath = path.join(fixture.root, "second-proof-guard-continue");
  const finishedPath = path.join(fixture.root, "second-proof-guard-finished");
  let contender;
  t.after(() => stopChild(contender));

  assert.throws(
    () =>
      applyAutomationKernelGuardCutover({
        plan,
        ownerConfirmationFile: fixture.confirmationFile,
        checkpoint(name, details) {
          if (
            name !== "guard-claim-before-write" ||
            details.filePath !== guard.owner
          ) {
            return;
          }
          contender = spawnPausedLegacyGuardTakeover(
            guard.directory,
            readyPath,
            continuePath,
            finishedPath,
            { advertiseControlProcess: true },
          );
          waitForPath(readyPath);
        },
      }),
    (error) => error?.code === "cutover_process_live",
  );
  writeFileSync(continuePath, "continue\n", { mode: 0o600 });
  waitForPath(finishedPath);
  assert.match(
    JSON.parse(readFileSync(guard.owner, "utf8")).owner,
    /paused-old-guard-takeover$/,
  );
  assert.equal(existsSync(paths.globalReceipt), false);
});

test("old readers that arrive after claims see one live owner and cannot take over", (t) => {
  const fixture = createFixture(t, { legacyGuard: true, legacyWriter: true });
  const plan = planFixture(fixture);
  const paths = automationKernelGuardCutoverPaths(fixture.stateRoot);
  const observationPath = path.join(fixture.root, "claim-observation.json");

  const result = applyAutomationKernelGuardCutover({
    plan,
    ownerConfirmationFile: fixture.confirmationFile,
    checkpoint(name) {
      if (name !== "claims-before-proof") return;
      const source = `
        import { readFileSync, writeFileSync } from "node:fs";
        const paths = ${JSON.stringify([
          paths.writerLock,
          paths.guards.events.owner,
        ])};
        const results = paths.map((filePath) => {
          const owner = JSON.parse(readFileSync(filePath, "utf8"));
          let live = true;
          try { process.kill(owner.pid, 0); } catch (error) { live = error?.code === "EPERM"; }
          return { filePath, live, pid: owner.pid, protocol: owner.lockProtocol };
        });
        writeFileSync(${JSON.stringify(observationPath)}, JSON.stringify(results) + "\\n", { mode: 0o600 });
      `;
      execFileSync(
        process.execPath,
        ["--input-type=module", "--eval", source],
        { stdio: ["ignore", "pipe", "pipe"] },
      );
    },
  });

  assert.equal(result.changed, true);
  const observations = JSON.parse(readFileSync(observationPath, "utf8"));
  assert.deepEqual(
    observations.map(({ live, protocol }) => ({ live, protocol })),
    [
      { live: true, protocol: "freed-kernel-guard-cutover-claim-v1" },
      { live: true, protocol: "freed-kernel-guard-cutover-claim-v1" },
    ],
  );
});

test("claim theft and fast protected-state mutation both block every PID 1 marker", (t) => {
  for (const mutation of ["claim-theft", "fast-event-mutation"]) {
    const fixture = createFixture(t, { legacyWriter: true });
    const plan = planFixture(fixture);
    const paths = automationKernelGuardCutoverPaths(fixture.stateRoot);
    assert.throws(
      () =>
        applyAutomationKernelGuardCutover({
          plan,
          ownerConfirmationFile: fixture.confirmationFile,
          checkpoint(name) {
            if (name !== "claims-before-proof") return;
            if (mutation === "claim-theft") {
              writeFileSync(
                paths.writerLock,
                `${JSON.stringify({
                  schemaVersion: 1,
                  token: "stolen-claim",
                  pid: process.pid,
                  processStartIdentity: null,
                  acquiredAt: new Date().toISOString(),
                })}\n`,
                { mode: 0o600 },
              );
              return;
            }
            execFileSync(
              process.execPath,
              [
                "--eval",
                `require("fs").appendFileSync(${JSON.stringify(
                  path.join(fixture.controlRoot, "events.jsonl"),
                )}, "{\\"type\\":\\"old-fast-mutation\\"}\\n")`,
              ],
              { stdio: ["ignore", "pipe", "pipe"] },
            );
          },
        }),
      (error) =>
        mutation === "claim-theft"
          ? error?.code === "cutover_claim_conflict"
          : error?.code === "cutover_source_drift",
    );
    assert.equal(existsSync(paths.globalReceipt), false);
    assert.equal(
      readFileSync(paths.writerLock).equals(automationKernelGuardMarkerBytes()),
      false,
    );
  }
});

test("real SIGKILL at every claim and marker boundary resumes the same plan exactly once", async (t) => {
  const scenarios = [
    {
      checkpoint: "guard-claim-directory-durable",
      options(paths) {
        return { guardName: "events" };
      },
      inspectResidue(paths) {
        assert.equal(existsSync(paths.guards.events.directory), true);
        assert.equal(existsSync(paths.guards.events.owner), false);
      },
    },
    {
      checkpoint: "guard-claim-linked",
      options(paths) {
        return { filePath: paths.guards.events.owner };
      },
      inspectResidue(paths) {
        assert.equal(lstatSync(paths.guards.events.owner).nlink, 2);
        assert.equal(
          existsSync(`${paths.guards.events.owner}.cutover-claim.tmp`),
          true,
        );
      },
    },
    {
      checkpoint: "claims-transaction-durable",
      options() {
        return {};
      },
      inspectResidue(paths) {
        const transaction = JSON.parse(readFileSync(paths.transaction, "utf8"));
        assert.equal(transaction.phase, "claims-installed");
      },
    },
    {
      checkpoint: "writer-marker-durable",
      options(paths) {
        return { filePath: paths.writerLock };
      },
      inspectResidue(paths) {
        assert.deepEqual(
          readFileSync(paths.writerLock),
          automationKernelGuardMarkerBytes(),
        );
      },
    },
    {
      checkpoint: "guard-owner-marker-durable",
      options() {
        return { guardName: "events" };
      },
      inspectResidue(paths) {
        assert.deepEqual(
          readFileSync(paths.guards.events.owner),
          automationKernelGuardMarkerBytes(),
        );
        assert.equal(existsSync(paths.guards.events.inner), false);
      },
    },
    {
      checkpoint: "guard-inner-marker-linked",
      options(paths) {
        return { filePath: paths.guards.events.inner };
      },
      inspectResidue(paths) {
        assert.equal(lstatSync(paths.guards.events.inner).nlink, 2);
        assert.equal(
          existsSync(`${paths.guards.events.inner}.cutover.tmp`),
          true,
        );
      },
    },
    {
      checkpoint: "markers-transaction-durable",
      options() {
        return {};
      },
      inspectResidue(paths) {
        const transaction = JSON.parse(readFileSync(paths.transaction, "utf8"));
        assert.equal(transaction.phase, "markers-installed");
      },
    },
  ];

  for (const scenario of scenarios) {
    await t.test(scenario.checkpoint, (checkpointTest) => {
      const fixture = createFixture(checkpointTest);
      const plan = planFixture(fixture);
      const paths = automationKernelGuardCutoverPaths(fixture.stateRoot);
      runCutoverKilledAtCheckpoint(
        fixture,
        scenario.checkpoint,
        scenario.options(paths),
      );
      assert.equal(existsSync(paths.globalReceipt), false);
      scenario.inspectResidue(paths);

      const recovered = applyAutomationKernelGuardCutover({
        plan,
        ownerConfirmationFile: fixture.confirmationFile,
      });
      assert.equal(recovered.changed, true);
      assert.equal(
        inspectAutomationKernelGuardCutover(fixture.stateRoot).ready,
        true,
      );
      const stable = applyAutomationKernelGuardCutover({
        plan,
        ownerConfirmationFile: fixture.confirmationFile,
      });
      assert.equal(stable.changed, false);
      assert.equal(existsSync(`${paths.writerLock}.cutover-claim.tmp`), false);
      for (const name of AUTOMATION_KERNEL_GUARD_NAMES) {
        const guard = paths.guards[name];
        assert.equal(lstatSync(guard.owner).nlink, 1);
        assert.equal(lstatSync(guard.inner).nlink, 1);
        assert.equal(existsSync(`${guard.owner}.cutover-claim.tmp`), false);
        assert.equal(existsSync(`${guard.inner}.cutover.tmp`), false);
      }
    });
  }
});

test("real SIGKILL recovers every journaled in-place rewrite edge on the same inode", async (t) => {
  const phases = [
    "after-first-write",
    "after-truncate",
    "before-fsync",
    "after-fsync",
    "journal-written",
    "journal-unlinked",
  ];
  const scenarios = [
    {
      label: "legacy writer claim",
      fixtureOptions: { legacyWriter: true },
      checkpointPrefix: "writer-claim-before-write",
      target(paths) {
        return paths.writerLock;
      },
    },
    {
      label: "writer marker",
      fixtureOptions: {},
      checkpointPrefix: "writer-marker-before-write",
      target(paths) {
        return paths.writerLock;
      },
    },
    {
      label: "legacy guard claim",
      fixtureOptions: { legacyGuard: true },
      checkpointPrefix: "guard-claim-before-write",
      target(paths) {
        return paths.guards.events.owner;
      },
    },
    {
      label: "guard owner marker",
      fixtureOptions: {},
      checkpointPrefix: "guard-owner-marker-before-write",
      target(paths) {
        return paths.guards.events.owner;
      },
    },
  ];

  for (const scenario of scenarios) {
    for (const phase of phases) {
      await t.test(`${scenario.label} ${phase}`, (checkpointTest) => {
        const fixture = createFixture(checkpointTest, scenario.fixtureOptions);
        const plan = planFixture(fixture);
        const paths = automationKernelGuardCutoverPaths(fixture.stateRoot);
        const targetPath = scenario.target(paths);
        const inodeBefore = existsSync(targetPath) && lstatSync(targetPath).ino;
        runCutoverKilledAtCheckpoint(
          fixture,
          `${scenario.checkpointPrefix}-${phase}`,
          { filePath: targetPath },
        );

        assert.equal(
          existsSync(paths.writeAhead),
          phase !== "journal-unlinked",
        );
        const journal = existsSync(paths.writeAhead)
          ? JSON.parse(readFileSync(paths.writeAhead, "utf8"))
          : {
              sourceIno: String(lstatSync(targetPath).ino),
              filePath: targetPath,
            };
        if (phase !== "journal-unlinked") {
          assert.equal(
            journal.phase,
            phase === "journal-written" ? "written" : "prepared",
          );
        }
        assert.equal(journal.filePath, targetPath);
        assert.equal(String(lstatSync(targetPath).ino), journal.sourceIno);
        if (inodeBefore !== false) {
          assert.equal(lstatSync(targetPath).ino, inodeBefore);
        }

        const recovered = applyAutomationKernelGuardCutover({
          plan,
          ownerConfirmationFile: fixture.confirmationFile,
        });
        assert.equal(recovered.changed, true);
        assert.equal(existsSync(paths.writeAhead), false);
        assert.equal(
          inspectAutomationKernelGuardCutover(fixture.stateRoot).ready,
          true,
        );
        assert.equal(String(lstatSync(targetPath).ino), journal.sourceIno);
      });
    }
  }
});

test("real SIGKILL recovers every journaled supersede restore edge on the same inode", async (t) => {
  const phases = [
    "after-first-write",
    "after-truncate",
    "before-fsync",
    "after-fsync",
    "journal-written",
    "journal-unlinked",
  ];
  const scenarios = [
    {
      label: "writer restore",
      checkpointPrefix: "supersede-writer-before-restore",
      target(paths) {
        return paths.writerLock;
      },
    },
    {
      label: "guard restore",
      checkpointPrefix: "supersede-guard-before-restore",
      target(paths) {
        return paths.guards.events.owner;
      },
    },
  ];

  for (const scenario of scenarios) {
    for (const phase of phases) {
      await t.test(`${scenario.label} ${phase}`, (checkpointTest) => {
        const fixture = createFixture(checkpointTest, {
          legacyGuard: true,
          legacyWriter: true,
        });
        const plan = planFixture(fixture);
        const paths = automationKernelGuardCutoverPaths(fixture.stateRoot);
        const targetPath = scenario.target(paths);
        const sourceBytes = readFileSync(targetPath);
        const sourceInode = lstatSync(targetPath).ino;
        assert.throws(
          () =>
            applyAutomationKernelGuardCutover({
              plan,
              ownerConfirmationFile: fixture.confirmationFile,
              checkpoint(name) {
                if (name === "claims-transaction-durable") {
                  throw new Error("stop after claims");
                }
              },
            }),
          /stop after claims/,
        );
        supersedePlanFixture(fixture, plan);
        runSupersedeKilledAtCheckpoint(
          fixture,
          `${scenario.checkpointPrefix}-${phase}`,
        );

        assert.equal(
          existsSync(paths.writeAhead),
          phase !== "journal-unlinked",
        );
        const journal = existsSync(paths.writeAhead)
          ? JSON.parse(readFileSync(paths.writeAhead, "utf8"))
          : {
              scope: "supersede",
              sourceIno: String(lstatSync(targetPath).ino),
              filePath: targetPath,
            };
        assert.equal(journal.scope, "supersede");
        if (phase !== "journal-unlinked") {
          assert.equal(
            journal.phase,
            phase === "journal-written" ? "written" : "prepared",
          );
        }
        assert.equal(journal.filePath, targetPath);
        assert.equal(String(lstatSync(targetPath).ino), journal.sourceIno);
        assert.equal(lstatSync(targetPath).ino, sourceInode);

        const supersedePlan = readAutomationKernelGuardCutoverSupersedePlan(
          fixture.supersedePlanFile,
          plan,
        );
        const recovered = applyAutomationKernelGuardCutoverSupersede({
          plan,
          supersedePlan,
          ownerConfirmationFile: fixture.confirmationFile,
        });
        assert.equal(recovered.changed, true);
        assert.equal(existsSync(paths.writeAhead), false);
        assert.deepEqual(readFileSync(targetPath), sourceBytes);
        assert.equal(lstatSync(targetPath).ino, sourceInode);
      });
    }
  }
});

test("real SIGKILL recovers every journaled quarantine deletion edge", async (t) => {
  const phases = [
    "after-rename",
    "after-quarantine-remove",
    "journal-written",
    "journal-unlinked",
  ];
  const scenarios = [
    {
      label: "legacy guard child cleanup",
      checkpointPrefix: "guard-events-legacy-remove",
      prepare(checkpointTest) {
        const fixture = createFixture(checkpointTest, { legacyGuard: true });
        writeFileSync(
          path.join(fixture.guardsRoot, "events.lock", "legacy-child.json"),
          '{"legacy":true}\n',
          { mode: 0o600 },
        );
        return { fixture, plan: planFixture(fixture), supersedePlan: null };
      },
      recover({ fixture, plan }) {
        return applyAutomationKernelGuardCutover({
          plan,
          ownerConfirmationFile: fixture.confirmationFile,
        });
      },
      expectedChanged: true,
    },
    {
      label: "abandoned guard cleanup",
      checkpointPrefix: "abandoned-guard-remove",
      prepare(checkpointTest) {
        const fixture = createFixture(checkpointTest);
        const abandoned = privateDirectory(
          path.join(
            fixture.guardsRoot,
            "events.lock.abandoned.11111111-1111-4111-8111-111111111111",
          ),
        );
        writeFileSync(path.join(abandoned, "owner.json"), '{"legacy":true}\n', {
          mode: 0o600,
        });
        return { fixture, plan: planFixture(fixture), supersedePlan: null };
      },
      recover({ fixture, plan }) {
        return applyAutomationKernelGuardCutover({
          plan,
          ownerConfirmationFile: fixture.confirmationFile,
        });
      },
      expectedChanged: true,
    },
    {
      label: "supersede claim rollback",
      checkpointPrefix: "supersede-writer-remove",
      prepare(checkpointTest) {
        const fixture = createFixture(checkpointTest);
        const plan = planFixture(fixture);
        assert.throws(
          () =>
            applyAutomationKernelGuardCutover({
              plan,
              ownerConfirmationFile: fixture.confirmationFile,
              checkpoint(name) {
                if (name === "claims-transaction-durable") {
                  throw new Error("stop after claims");
                }
              },
            }),
          /stop after claims/,
        );
        const supersedePlan = supersedePlanFixture(fixture, plan);
        return { fixture, plan, supersedePlan };
      },
      recover({ fixture, plan, supersedePlan }) {
        return applyAutomationKernelGuardCutoverSupersede({
          plan,
          supersedePlan,
          ownerConfirmationFile: fixture.confirmationFile,
        });
      },
      expectedChanged: true,
    },
    {
      label: "supersede transaction retirement",
      checkpointPrefix: "supersede-transaction-retire",
      prepare(checkpointTest) {
        const fixture = createFixture(checkpointTest, {
          legacyGuard: true,
          legacyWriter: true,
        });
        const plan = planFixture(fixture);
        seedPreparedTransaction(fixture, plan);
        const supersedePlan = supersedePlanFixture(fixture, plan);
        return { fixture, plan, supersedePlan };
      },
      recover({ fixture, plan, supersedePlan }) {
        return applyAutomationKernelGuardCutoverSupersede({
          plan,
          supersedePlan,
          ownerConfirmationFile: fixture.confirmationFile,
        });
      },
      expectedChanged: false,
    },
  ];

  for (const scenario of scenarios) {
    for (const phase of phases) {
      await t.test(`${scenario.label} ${phase}`, (checkpointTest) => {
        const prepared = scenario.prepare(checkpointTest);
        const { fixture, plan, supersedePlan } = prepared;
        const paths = automationKernelGuardCutoverPaths(fixture.stateRoot);
        if (supersedePlan === null) {
          runCutoverKilledAtCheckpoint(
            fixture,
            `${scenario.checkpointPrefix}-${phase}`,
          );
        } else {
          runSupersedeKilledAtCheckpoint(
            fixture,
            `${scenario.checkpointPrefix}-${phase}`,
          );
        }

        assert.equal(
          existsSync(paths.writeAhead),
          phase !== "journal-unlinked",
        );
        if (existsSync(paths.writeAhead)) {
          const journal = JSON.parse(readFileSync(paths.writeAhead, "utf8"));
          assert.equal(journal.operation, "remove");
          assert.equal(
            journal.phase,
            phase === "journal-written" ? "written" : "prepared",
          );
          assert.equal(
            existsSync(journal.quarantinePath),
            phase === "after-rename",
          );
        }

        const recovered = scenario.recover(prepared);
        assert.equal(recovered.changed, scenario.expectedChanged);
        assert.equal(existsSync(paths.writeAhead), false);
        const quarantineRoot = path.join(
          paths.artifactRoot,
          plan.parameters.cutoverId,
          ".recovery-quarantine",
        );
        assert.equal(existsSync(quarantineRoot), false);
      });
    }
  }
});

test("real SIGKILL across every remaining durable migration edge is recoverable", async (t) => {
  const scenarios = [
    {
      checkpoint: "transaction-prepared-durable",
      inspectResidue({ paths }) {
        assert.equal(
          JSON.parse(readFileSync(paths.transaction, "utf8")).phase,
          "prepared",
        );
      },
    },
    {
      checkpoint: "plan-artifact-durable",
      inspectResidue({ artifactDirectory }) {
        assert.equal(
          existsSync(path.join(artifactDirectory, "plan.json")),
          true,
        );
        assert.equal(
          existsSync(path.join(artifactDirectory, "source-snapshot.json")),
          false,
        );
      },
    },
    {
      checkpoint: "source-artifact-durable",
      inspectResidue({ artifactDirectory }) {
        assert.equal(
          existsSync(path.join(artifactDirectory, "source-snapshot.json")),
          true,
        );
        assert.equal(
          existsSync(path.join(artifactDirectory, "legacy-locks.json")),
          false,
        );
      },
    },
    {
      checkpoint: "legacy-manifest-artifact-durable",
      inspectResidue({ artifactDirectory }) {
        assert.equal(
          existsSync(path.join(artifactDirectory, "legacy-locks.json")),
          true,
        );
      },
    },
    {
      checkpoint: "legacy-archive-durable",
      inspectResidue({ artifactDirectory }) {
        assert.equal(
          existsSync(path.join(artifactDirectory, "legacy-paths", "guards")),
          true,
        );
      },
    },
    {
      checkpoint: "receipt-transaction-durable",
      confirmationMayDisappear: true,
      inspectResidue({ paths }) {
        assert.equal(
          JSON.parse(readFileSync(paths.transaction, "utf8")).phase,
          "receipt-prepared",
        );
      },
    },
    {
      checkpoint: "receipt-artifact-linked",
      confirmationMayDisappear: true,
      inspectResidue({ artifactDirectory }) {
        const receiptPath = path.join(artifactDirectory, "receipt.json");
        assert.equal(lstatSync(receiptPath).nlink, 2);
        assert.equal(existsSync(`${receiptPath}.cutover.tmp`), true);
      },
    },
    {
      checkpoint: "receipt-artifact-durable",
      confirmationMayDisappear: true,
      inspectResidue({ artifactDirectory }) {
        assert.equal(
          existsSync(path.join(artifactDirectory, "receipt.json")),
          true,
        );
      },
    },
    {
      checkpoint: "global-receipt-linked",
      confirmationMayDisappear: true,
      inspectResidue({ paths }) {
        assert.equal(lstatSync(paths.globalReceipt).nlink, 2);
        assert.equal(existsSync(`${paths.globalReceipt}.cutover.tmp`), true);
      },
    },
    {
      checkpoint: "global-receipt-durable",
      completedBeforeResponse: true,
      inspectResidue({ paths }) {
        assert.equal(lstatSync(paths.globalReceipt).nlink, 1);
        assert.equal(
          inspectAutomationKernelGuardCutover(paths.stateRoot).ready,
          true,
        );
      },
    },
  ];

  for (const scenario of scenarios) {
    await t.test(scenario.checkpoint, (checkpointTest) => {
      const fixture = createFixture(checkpointTest);
      const plan = planFixture(fixture);
      const paths = automationKernelGuardCutoverPaths(fixture.stateRoot);
      const artifactDirectory = path.join(
        paths.artifactRoot,
        plan.parameters.cutoverId,
      );
      runCutoverKilledAtCheckpoint(fixture, scenario.checkpoint);
      scenario.inspectResidue({ fixture, plan, paths, artifactDirectory });
      if (scenario.confirmationMayDisappear) {
        unlinkSync(fixture.confirmationFile);
      }

      const recovered = applyAutomationKernelGuardCutover({
        plan,
        ownerConfirmationFile: fixture.confirmationFile,
      });
      assert.equal(recovered.changed, !scenario.completedBeforeResponse);
      assert.equal(
        inspectAutomationKernelGuardCutover(fixture.stateRoot).ready,
        true,
      );
      const stable = applyAutomationKernelGuardCutover({
        plan,
        ownerConfirmationFile: fixture.confirmationFile,
      });
      assert.equal(stable.changed, false);
      assert.equal(lstatSync(paths.globalReceipt).nlink, 1);
      assert.equal(existsSync(`${paths.globalReceipt}.cutover.tmp`), false);
    });
  }
});

test("old writer wx fails after cutover and inner kernel contention survives SIGKILL", async (t) => {
  const fixture = createFixture(t);
  const plan = planFixture(fixture);
  applyAutomationKernelGuardCutover({
    plan,
    ownerConfirmationFile: fixture.confirmationFile,
  });
  const paths = automationKernelGuardCutoverPaths(fixture.stateRoot);
  const beforeWriter = lstatSync(paths.writerLock);
  const beforeOwner = lstatSync(paths.guards.events.owner);
  const beforeInner = lstatSync(paths.guards.events.inner);

  const oldWriter = execFileSync(process.execPath, [
    "--eval",
    `const fs=require('fs');try{fs.openSync(${JSON.stringify(paths.writerLock)},'wx');process.exit(2)}catch(e){process.exit(e.code==='EEXIST'?0:3)}`,
  ]);
  assert.equal(oldWriter.length, 0);

  const holder = spawnHoldingKernelGuard(paths.guards.events.inner);
  t.after(() => holder.kill("SIGKILL"));
  await waitForLine(holder.stdout, "ready");
  assert.throws(
    () =>
      withKernelFileGuard(paths.guards.events.inner, () => undefined, {
        timeoutMs: 75,
      }),
    /Timed out waiting/,
  );
  holder.kill("SIGKILL");
  await new Promise((resolve) => holder.once("close", resolve));
  assert.doesNotThrow(() =>
    withKernelFileGuard(paths.guards.events.inner, () => undefined),
  );

  for (const [filePath, before] of [
    [paths.writerLock, beforeWriter],
    [paths.guards.events.owner, beforeOwner],
    [paths.guards.events.inner, beforeInner],
  ]) {
    const after = lstatSync(filePath);
    assert.equal(after.dev, before.dev);
    assert.equal(after.ino, before.ino);
    assert.deepEqual(
      readFileSync(filePath),
      automationKernelGuardMarkerBytes(),
    );
  }
});

test("completed cutover retry is unchanged and does not require actor reactivation state", (t) => {
  const fixture = createFixture(t);
  const plan = planFixture(fixture);
  const paths = automationKernelGuardCutoverPaths(fixture.stateRoot);
  const first = applyAutomationKernelGuardCutover({
    plan,
    ownerConfirmationFile: fixture.confirmationFile,
  });
  const actorPath = path.join(
    fixture.codexHome,
    "automations",
    ACTOR_IDS[0],
    "automation.toml",
  );
  writeFileSync(actorPath, `name = "${ACTOR_IDS[0]}"\nstatus = "ACTIVE"\n`, {
    mode: 0o600,
  });
  const transactionBytes = readFileSync(paths.transaction);
  const receipt = JSON.parse(readFileSync(paths.globalReceipt, "utf8"));
  const transactionBeforeRetry = Buffer.from(transactionBytes);
  const second = applyAutomationKernelGuardCutover({
    plan,
    ownerConfirmationFile: fixture.confirmationFile,
  });

  assert.equal(first.changed, true);
  assert.equal(second.changed, false);
  assert.equal(receipt.transactionDigest, sha256(transactionBytes));
  assert.deepEqual(readFileSync(paths.transaction), transactionBeforeRetry);
});
