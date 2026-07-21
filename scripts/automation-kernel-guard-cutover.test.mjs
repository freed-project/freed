import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmodSync,
  existsSync,
  linkSync,
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

function captureOversizedBufferAllocation(minimumSize, operation) {
  const originalAllocate = Buffer.alloc;
  const attemptedSizes = [];
  let caught = null;
  Buffer.alloc = function guardedAllocate(size, ...args) {
    if (Number.isSafeInteger(size) && size >= minimumSize) {
      attemptedSizes.push(size);
      const error = new Error(
        `Test intercepted an oversized Buffer allocation of ${size.toLocaleString()} bytes.`,
      );
      error.code = "cutover_test_oversized_allocation";
      throw error;
    }
    return Reflect.apply(originalAllocate, Buffer, [size, ...args]);
  };
  try {
    operation();
  } catch (error) {
    caught = error;
  } finally {
    Buffer.alloc = originalAllocate;
  }
  return { attemptedSizes, error: caught };
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

function maximumConfirmationBytes(plan, confirmationId, approvedAt, expiresAt) {
  const confirmation = {
    schemaVersion: 1,
    kind: "owner-confirmation",
    confirmationId,
    approvedBy: "AubreyF",
    ownerApprovalReference: "",
    approvalSource: { kind: "current-task", reference: TASK_ID },
    taskId: TASK_ID,
    intent: plan.intent,
    intentDigest: plan.intentDigest,
    approvedAt,
    expiresAt,
  };
  const emptyBytes = Buffer.from(`${JSON.stringify(confirmation)}\n`, "utf8");
  confirmation.ownerApprovalReference = "x".repeat(
    64 * 1024 - emptyBytes.length,
  );
  const bytes = Buffer.from(`${JSON.stringify(confirmation)}\n`, "utf8");
  assert.equal(bytes.length, 64 * 1024);
  return { confirmation, bytes };
}

function seedMaximumValidPreparedTransaction(fixture, plan) {
  const paths = automationKernelGuardCutoverPaths(fixture.stateRoot);
  const authorizationDirectory = privateDirectory(
    path.join(
      paths.artifactRoot,
      plan.parameters.cutoverId,
      "authorizations",
    ),
  );
  const preparedAtMs = Date.parse(plan.createdAt);
  const approvedAt = new Date(preparedAtMs - 1_000).toISOString();
  const expiresAt = new Date(preparedAtMs + 10 * 60_000).toISOString();
  const confirmationDirectory = privateDirectory(
    path.join(fixture.root, "maximum-confirmations"),
  );
  const authorizations = [];
  for (let index = 0; index < 63; index += 1) {
    const confirmationId = `maximum-valid-${index.toLocaleString("en-US", {
      minimumIntegerDigits: 2,
      useGrouping: false,
    })}`;
    const { confirmation, bytes } = maximumConfirmationBytes(
      plan,
      confirmationId,
      approvedAt,
      expiresAt,
    );
    const confirmationPath = path.join(
      confirmationDirectory,
      `${confirmationId}.json`,
    );
    writeFileSync(confirmationPath, bytes, { mode: 0o600 });
    const confirmationDigest = sha256(
      Buffer.from(stableJson(confirmation), "utf8"),
    );
    const confirmationRawDigest = sha256(bytes);
    const confirmationArtifact = path.join(
      authorizationDirectory,
      `${confirmationDigest}-${confirmationRawDigest}.json`,
    );
    writeFileSync(confirmationArtifact, bytes, { mode: 0o600 });
    authorizations.push({
      actor: "freed-owner",
      confirmationId,
      confirmationDigest,
      confirmationPath,
      confirmationBytesBase64: bytes.toString("base64"),
      confirmationRawDigest,
      confirmationArtifact,
      intentDigest: plan.intentDigest,
      validatedAt: new Date(preparedAtMs + index).toISOString(),
    });
  }
  writeFileSync(
    path.join(authorizationDirectory, "prepared-authorization.json"),
    `${JSON.stringify(authorizations[0], null, 2)}\n`,
    { mode: 0o600 },
  );
  writeSeededTransaction(fixture, {
    schemaVersion: 1,
    kind: "automation-kernel-guard-cutover-transaction",
    cutoverId: plan.parameters.cutoverId,
    planDigest: sha256(Buffer.from(`${stableJson(plan)}\n`, "utf8")),
    phase: "prepared",
    preparedAt: plan.createdAt,
    authorizations,
    claimGenerations: [],
  });
  const current = maximumConfirmationBytes(
    plan,
    "maximum-valid-63",
    approvedAt,
    expiresAt,
  );
  writeFileSync(fixture.confirmationFile, current.bytes, { mode: 0o600 });
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

function waitForProcessExit(pid) {
  assert.equal(Number.isSafeInteger(pid) && pid > 0, true);
  const deadline = Date.now() + 10_000;
  while (true) {
    try {
      process.kill(pid, 0);
    } catch (error) {
      if (error?.code === "ESRCH") return;
      throw error;
    }
    if (Date.now() >= deadline) {
      throw new Error(`Timed out waiting for killed process ${pid} to exit.`);
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
  let killedProcess;
  assert.throws(
    () =>
      execFileSync(
        process.execPath,
        ["--input-type=module", "--eval", source],
        { stdio: ["ignore", "pipe", "pipe"] },
      ),
    (error) => {
      killedProcess = error;
      return error?.signal === "SIGKILL";
    },
  );
  waitForProcessExit(killedProcess.pid);
}

function runSupersedeKilledAtCheckpoint(
  fixture,
  checkpointName,
  { occurrence = 1 } = {},
) {
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
    let occurrence = 0;
    applyAutomationKernelGuardCutoverSupersede({
      plan,
      supersedePlan,
      ownerConfirmationFile: ${JSON.stringify(fixture.confirmationFile)},
      checkpoint(name) {
        if (
          name === ${JSON.stringify(checkpointName)} &&
          ++occurrence === ${JSON.stringify(occurrence)}
        ) {
          process.kill(process.pid, "SIGKILL");
        }
      },
    });
  `;
  let killedProcess;
  assert.throws(
    () =>
      execFileSync(
        process.execPath,
        ["--input-type=module", "--eval", source],
        { stdio: ["ignore", "pipe", "pipe"] },
      ),
    (error) => {
      killedProcess = error;
      return error?.signal === "SIGKILL";
    },
  );
  waitForProcessExit(killedProcess.pid);
}

function prepareSupersedeWriteAheadCrash(t, { occurrence = 1 } = {}) {
  const fixture = createFixture(t, {
    legacyGuard: true,
    legacyWriter: true,
  });
  const oldPlan = planFixture(fixture);
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
  const supersedePlan = supersedePlanFixture(fixture, oldPlan);
  runSupersedeKilledAtCheckpoint(
    fixture,
    "write-ahead-temporary-durable",
    { occurrence },
  );
  return {
    fixture,
    oldPlan,
    paths: automationKernelGuardCutoverPaths(fixture.stateRoot),
    supersedePlan,
  };
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

const nativeHelperPauseStates = new WeakMap();

function nativeHelperPauseState(child) {
  let state = nativeHelperPauseStates.get(child);
  if (state !== undefined) return state;
  state = { lines: [], waiters: [], stderr: "", exited: null };
  nativeHelperPauseStates.set(child, state);
  let buffered = "";
  child.stdio[4].setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk) => {
    state.stderr += chunk;
  });
  child.stdio[4].on("data", (chunk) => {
    buffered += chunk;
    const parts = buffered.split("\n");
    buffered = parts.pop() ?? "";
    state.lines.push(...parts.filter(Boolean));
    for (const waiter of [...state.waiters]) waiter();
  });
  child.once("exit", (code, signal) => {
    state.exited = { code, signal };
    for (const waiter of [...state.waiters]) waiter();
  });
  return state;
}

function waitForNativeHelperPause(child, checkpoint, occurrence = 1) {
  const state = nativeHelperPauseState(child);
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + 10_000;
    const inspect = () => {
      const count = state.lines.filter((line) => line === checkpoint).length;
      if (count >= occurrence) {
        clearInterval(timer);
        state.waiters = state.waiters.filter((waiter) => waiter !== inspect);
        resolve();
        return;
      }
      if (state.exited !== null || Date.now() >= deadline) {
        clearInterval(timer);
        state.waiters = state.waiters.filter((waiter) => waiter !== inspect);
        reject(
          new Error(
            `Cutover helper did not reach ${checkpoint} occurrence ${occurrence.toLocaleString()}: ${state.stderr}`,
          ),
        );
      }
    };
    const timer = setInterval(inspect, 10);
    state.waiters.push(inspect);
    inspect();
  });
}

function waitForChildExit(child) {
  if (child.exitCode !== null || child.signalCode !== null) {
    return Promise.resolve({ code: child.exitCode, signal: child.signalCode });
  }
  return new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code, signal) => resolve({ code, signal }));
  });
}

function releasePausedNativeHelper(child) {
  child.stdio[3].write("1");
}

function killPausedNativeHelper(child) {
  const output = execFileSync("/usr/bin/pgrep", ["-P", String(child.pid)], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  const pids = output
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map(Number);
  assert.equal(pids.length, 1);
  process.kill(pids[0], "SIGKILL");
}

function spawnNativePausedPlanWriter(
  t,
  fixture,
  plan,
  {
    checkpoint,
    operation = "",
    source = "",
    destination = "",
    directoryCheckpoint = "",
  },
) {
  const modulePath = path.join(
    import.meta.dirname,
    "lib",
    "automation-kernel-guard-cutover.mjs",
  );
  const sourceCode = `
    import { writeAutomationKernelGuardCutoverPlan } from ${JSON.stringify(modulePath)};
    writeAutomationKernelGuardCutoverPlan(
      ${JSON.stringify(fixture.planFile)},
      ${JSON.stringify(plan)},
    );
  `;
  const child = spawn(
    process.execPath,
    ["--input-type=module", "--eval", sourceCode],
    {
      stdio: ["ignore", "pipe", "pipe", "pipe", "pipe"],
      env: {
        ...process.env,
        FREED_CUTOVER_MOVE_TEST_FDS: "3,4",
        FREED_CUTOVER_MOVE_TEST_PAUSE: checkpoint,
        FREED_CUTOVER_MOVE_TEST_OPERATION: operation,
        FREED_CUTOVER_MOVE_TEST_SOURCE: source,
        FREED_CUTOVER_MOVE_TEST_DESTINATION: destination,
        FREED_CUTOVER_DIRECTORY_TEST_PAUSE: directoryCheckpoint,
      },
    },
  );
  t.after(() => stopChild(child));
  return child;
}

function spawnNativePausedPlanning(
  t,
  fixture,
  { checkpoint, source },
) {
  const modulePath = path.join(
    import.meta.dirname,
    "lib",
    "automation-kernel-guard-cutover.mjs",
  );
  const sourceCode = `
    import { planAutomationKernelGuardCutover } from ${JSON.stringify(modulePath)};
    let outcome;
    try {
      planAutomationKernelGuardCutover({
        stateRoot: ${JSON.stringify(fixture.stateRoot)},
        taskId: ${JSON.stringify(TASK_ID)},
        codexHome: ${JSON.stringify(fixture.codexHome)},
        repoRoot: ${JSON.stringify(fixture.repoRoot)},
      });
      outcome = { ok: true };
    } catch (error) {
      outcome = {
        ok: false,
        code: error?.code ?? null,
        message: error instanceof Error ? error.message : String(error),
        details: error?.details ?? null,
      };
    }
    process.stdout.write(JSON.stringify(outcome));
  `;
  const child = spawn(
    process.execPath,
    ["--input-type=module", "--eval", sourceCode],
    {
      stdio: ["ignore", "pipe", "pipe", "pipe", "pipe"],
      env: {
        ...process.env,
        FREED_CUTOVER_MOVE_TEST_FDS: "3,4",
        FREED_CUTOVER_MOVE_TEST_PAUSE: checkpoint,
        FREED_CUTOVER_MOVE_TEST_OPERATION: "snapshot-tree",
        FREED_CUTOVER_MOVE_TEST_SOURCE: source,
      },
    },
  );
  t.after(() => stopChild(child));
  return child;
}

function spawnNativePausedCutoverApply(
  t,
  fixture,
  checkpoint,
  { source = "" } = {},
) {
  const modulePath = path.join(
    import.meta.dirname,
    "lib",
    "automation-kernel-guard-cutover.mjs",
  );
  const sourceCode = `
    import {
      applyAutomationKernelGuardCutover,
      readAutomationKernelGuardCutoverPlan,
    } from ${JSON.stringify(modulePath)};
    const plan = readAutomationKernelGuardCutoverPlan(${JSON.stringify(fixture.planFile)});
    let outcome;
    try {
      applyAutomationKernelGuardCutover({
        plan,
        ownerConfirmationFile: ${JSON.stringify(fixture.confirmationFile)},
      });
      outcome = { ok: true };
    } catch (error) {
      outcome = {
        ok: false,
        code: error?.code ?? null,
        message: error instanceof Error ? error.message : String(error),
        details: error?.details ?? null,
      };
    }
    process.stdout.write(JSON.stringify(outcome));
  `;
  const child = spawn(
    process.execPath,
    ["--input-type=module", "--eval", sourceCode],
    {
      stdio: ["ignore", "pipe", "pipe", "pipe", "pipe"],
      env: {
        ...process.env,
        FREED_CUTOVER_MOVE_TEST_FDS: "3,4",
        FREED_CUTOVER_MOVE_TEST_PAUSE: checkpoint,
        FREED_CUTOVER_MOVE_TEST_OPERATION: "list-bounded",
        FREED_CUTOVER_MOVE_TEST_SOURCE: source,
      },
    },
  );
  t.after(() => stopChild(child));
  return child;
}

function retainedHardLinkGenerationPaths(plan, filePath, bytes) {
  const retirementDirectory = path.join(
    plan.parameters.stateRoot,
    "control",
    ".kernel-guard-cutover-retired",
    plan.parameters.cutoverId,
    "immutable-hard-links",
  );
  const generation = sha256(
    Buffer.from(
      `${stableJson({
        kind: "automation-kernel-guard-retained-hard-link-generation",
        filePath,
        digest: sha256(bytes),
      })}\n`,
      "utf8",
    ),
  );
  return {
    retirementDirectory,
    temporaryArchive: path.join(
      retirementDirectory,
      `${generation}.temporary.archive`,
    ),
    canonicalArchive: path.join(
      retirementDirectory,
      `${generation}.canonical.archive`,
    ),
    replacement: path.join(
      retirementDirectory,
      `${generation}.replacement.tmp`,
    ),
  };
}

function assertRetainedHardLinkGeneration(plan, filePath, bytes) {
  const retained = retainedHardLinkGenerationPaths(plan, filePath, bytes);
  assert.equal(existsSync(retained.temporaryArchive), true);
  assert.equal(existsSync(retained.canonicalArchive), true);
  assert.equal(existsSync(retained.replacement), false);
  assert.deepEqual(readFileSync(retained.temporaryArchive), bytes);
  assert.deepEqual(readFileSync(retained.canonicalArchive), bytes);
  const temporary = lstatSync(retained.temporaryArchive);
  const canonical = lstatSync(retained.canonicalArchive);
  const live = lstatSync(filePath);
  assert.equal(temporary.dev, canonical.dev);
  assert.equal(temporary.ino, canonical.ino);
  assert.equal(temporary.nlink, 2);
  assert.equal(canonical.nlink, 2);
  assert.equal(live.nlink, 1);
  assert.notEqual(live.ino, canonical.ino);
  return retained;
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

test("native final-window swaps cannot redirect retained hard-link retirement", async (t) => {
  const fixture = createFixture(t);
  const plan = planAutomationKernelGuardCutover({
    stateRoot: fixture.stateRoot,
    taskId: TASK_ID,
    codexHome: fixture.codexHome,
    repoRoot: fixture.repoRoot,
  });
  const temporaryPath = `${fixture.planFile}.cutover.tmp`;
  const child = spawnNativePausedPlanWriter(t, fixture, plan, {
    checkpoint: "before-rename-syscall",
    operation: "rename-durable",
    source: path.basename(temporaryPath),
  });
  await waitForNativeHelperPause(child, "before-rename-syscall");

  const admittedGeneration = path.join(
    fixture.root,
    "admitted-plan-hard-link",
  );
  const foreignBytes = Buffer.from("foreign final-window generation\n", "utf8");
  renameSync(temporaryPath, admittedGeneration);
  writeFileSync(temporaryPath, foreignBytes, { mode: 0o600 });
  releasePausedNativeHelper(child);
  const exited = await waitForChildExit(child);

  assert.notEqual(exited.code, 0);
  assert.deepEqual(readFileSync(temporaryPath), foreignBytes);
  const live = lstatSync(fixture.planFile);
  const admitted = lstatSync(admittedGeneration);
  assert.equal(live.dev, admitted.dev);
  assert.equal(live.ino, admitted.ino);
  assert.equal(live.nlink, 2);
  assert.equal(admitted.nlink, 2);
  const expectedBytes = Buffer.from(`${JSON.stringify(plan, null, 2)}\n`);
  assert.deepEqual(readFileSync(fixture.planFile), expectedBytes);
  assert.deepEqual(readFileSync(admittedGeneration), expectedBytes);
  const retained = retainedHardLinkGenerationPaths(
    plan,
    fixture.planFile,
    expectedBytes,
  );
  assert.deepEqual(readdirSync(retained.retirementDirectory), []);
});

test("retained hard-link publication recovers after every native mutation", async (t) => {
  const scenarios = [
    {
      name: "temporary retirement rename",
      checkpoint: "after-rename-before-destination-sync",
      operation: "rename-durable",
      occurrence: 1,
    },
    {
      name: "canonical replacement exchange",
      checkpoint: "after-exchange-before-destination-sync",
      operation: "exchange-durable",
      occurrence: 1,
    },
    {
      name: "canonical retirement rename",
      checkpoint: "after-rename-before-destination-sync",
      operation: "rename-durable",
      occurrence: 2,
    },
  ];
  for (const scenario of scenarios) {
    await t.test(scenario.name, async (subtest) => {
      const fixture = createFixture(subtest);
      const plan = planAutomationKernelGuardCutover({
        stateRoot: fixture.stateRoot,
        taskId: TASK_ID,
        codexHome: fixture.codexHome,
        repoRoot: fixture.repoRoot,
      });
      const child = spawnNativePausedPlanWriter(subtest, fixture, plan, {
        checkpoint: scenario.checkpoint,
        operation: scenario.operation,
      });
      for (let occurrence = 1; occurrence <= scenario.occurrence; occurrence += 1) {
        await waitForNativeHelperPause(
          child,
          scenario.checkpoint,
          occurrence,
        );
        if (occurrence < scenario.occurrence) {
          releasePausedNativeHelper(child);
        }
      }
      killPausedNativeHelper(child);
      const exited = await waitForChildExit(child);
      assert.notEqual(exited.code, 0);

      writeAutomationKernelGuardCutoverPlan(fixture.planFile, plan);
      assert.deepEqual(
        readAutomationKernelGuardCutoverPlan(fixture.planFile),
        plan,
      );
      const bytes = readFileSync(fixture.planFile);
      assertRetainedHardLinkGeneration(plan, fixture.planFile, bytes);
      assert.equal(existsSync(`${fixture.planFile}.cutover.tmp`), false);
    });
  }
});

test("replacement creation resumes every admitted prefix after process loss", async (t) => {
  for (const checkpoint of [
    "after-create-before-copy",
    "during-copy",
    "after-file-sync-before-directory-sync",
    "before-directory-sync",
    "after-directory-sync",
  ]) {
    await t.test(checkpoint, async (subtest) => {
      const fixture = createFixture(subtest);
      const plan = planAutomationKernelGuardCutover({
        stateRoot: fixture.stateRoot,
        taskId: TASK_ID,
        codexHome: fixture.codexHome,
        repoRoot: fixture.repoRoot,
      });
      const expectedBytes = Buffer.from(`${JSON.stringify(plan, null, 2)}\n`);
      const retained = retainedHardLinkGenerationPaths(
        plan,
        fixture.planFile,
        expectedBytes,
      );
      const child = spawnNativePausedPlanWriter(subtest, fixture, plan, {
        checkpoint,
        operation: "create-private-durable",
        destination: path.basename(retained.replacement),
      });
      await waitForNativeHelperPause(child, checkpoint);
      killPausedNativeHelper(child);
      const exited = await waitForChildExit(child);
      assert.notEqual(exited.code, 0);

      const live = lstatSync(fixture.planFile);
      const temporaryArchive = lstatSync(retained.temporaryArchive);
      assert.equal(live.dev, temporaryArchive.dev);
      assert.equal(live.ino, temporaryArchive.ino);
      assert.equal(live.nlink, 2);
      assert.equal(temporaryArchive.nlink, 2);
      assert.deepEqual(readFileSync(fixture.planFile), expectedBytes);
      assert.equal(existsSync(retained.canonicalArchive), false);
      const prefix = readFileSync(retained.replacement);
      assert.deepEqual(expectedBytes.subarray(0, prefix.length), prefix);

      writeAutomationKernelGuardCutoverPlan(fixture.planFile, plan);
      assertRetainedHardLinkGeneration(
        plan,
        fixture.planFile,
        expectedBytes,
      );
    });
  }
});

test("retained directory creation is recoverable on both sides of parent fsync", async (t) => {
  for (const checkpoint of [
    "retained-directory-created-before-parent-sync",
    "retained-directory-parent-synced",
  ]) {
    await t.test(checkpoint, async (subtest) => {
      const fixture = createFixture(subtest);
      const plan = planAutomationKernelGuardCutover({
        stateRoot: fixture.stateRoot,
        taskId: TASK_ID,
        codexHome: fixture.codexHome,
        repoRoot: fixture.repoRoot,
      });
      const expectedBytes = Buffer.from(`${JSON.stringify(plan, null, 2)}\n`);
      const child = spawnNativePausedPlanWriter(subtest, fixture, plan, {
        checkpoint,
        directoryCheckpoint: checkpoint,
      });
      await waitForNativeHelperPause(child, checkpoint);
      child.kill("SIGKILL");
      const exited = await waitForChildExit(child);
      assert.equal(exited.signal, "SIGKILL");

      writeAutomationKernelGuardCutoverPlan(fixture.planFile, plan);
      assertRetainedHardLinkGeneration(
        plan,
        fixture.planFile,
        expectedBytes,
      );
    });
  }
});

test("held directory generations contain every native publication boundary", async (t) => {
  const scenarios = [
    {
      name: "first retirement rename",
      checkpoint: "before-rename-syscall",
      operation: "rename-durable",
      occurrence: 1,
      swapAncestor: false,
    },
    {
      name: "replacement creation",
      checkpoint: "before-create-syscall",
      operation: "create-private-durable",
      occurrence: 1,
      swapAncestor: false,
    },
    {
      name: "replacement creation ancestor",
      checkpoint: "before-create-syscall",
      operation: "create-private-durable",
      occurrence: 1,
      swapAncestor: true,
    },
    {
      name: "canonical exchange",
      checkpoint: "before-exchange-syscall",
      operation: "exchange-durable",
      occurrence: 1,
      swapAncestor: false,
    },
    {
      name: "second retirement rename",
      checkpoint: "before-rename-syscall",
      operation: "rename-durable",
      occurrence: 2,
      swapAncestor: false,
    },
  ];
  for (const scenario of scenarios) {
    await t.test(scenario.name, async (subtest) => {
      const fixture = createFixture(subtest);
      const plan = planAutomationKernelGuardCutover({
        stateRoot: fixture.stateRoot,
        taskId: TASK_ID,
        codexHome: fixture.codexHome,
        repoRoot: fixture.repoRoot,
      });
      const expectedBytes = Buffer.from(`${JSON.stringify(plan, null, 2)}\n`);
      const retained = retainedHardLinkGenerationPaths(
        plan,
        fixture.planFile,
        expectedBytes,
      );
      const child = spawnNativePausedPlanWriter(subtest, fixture, plan, {
        checkpoint: scenario.checkpoint,
        operation: scenario.operation,
      });
      for (let occurrence = 1; occurrence <= scenario.occurrence; occurrence += 1) {
        await waitForNativeHelperPause(
          child,
          scenario.checkpoint,
          occurrence,
        );
        if (occurrence < scenario.occurrence) {
          releasePausedNativeHelper(child);
        }
      }

      const swappedPath = scenario.swapAncestor
        ? path.dirname(path.dirname(retained.retirementDirectory))
        : retained.retirementDirectory;
      const admittedPath = `${swappedPath}.admitted`;
      renameSync(swappedPath, admittedPath);
      privateDirectory(swappedPath);
      releasePausedNativeHelper(child);
      const exited = await waitForChildExit(child);
      assert.notEqual(exited.code, 0);
      assert.deepEqual(readdirSync(swappedPath), []);

      rmSync(swappedPath, { recursive: true, force: true });
      renameSync(admittedPath, swappedPath);
      writeAutomationKernelGuardCutoverPlan(fixture.planFile, plan);
      assertRetainedHardLinkGeneration(
        plan,
        fixture.planFile,
        expectedBytes,
      );
    });
  }
});

test("snapshot admission stops at its entry, depth, and aggregate byte limits", (t) => {
  const fixture = createFixture(t);
  const leasesRoot = path.join(fixture.controlRoot, "leases");

  let nested = leasesRoot;
  for (let depth = 0; depth <= 64; depth += 1) {
    nested = privateDirectory(path.join(nested, `depth-${depth}`));
  }
  assert.throws(
    () =>
      planAutomationKernelGuardCutover({
        stateRoot: fixture.stateRoot,
        taskId: TASK_ID,
        codexHome: fixture.codexHome,
        repoRoot: fixture.repoRoot,
      }),
    (error) =>
      error?.code === "cutover_state_invalid" &&
      /snapshot depth limit/.test(error.message),
  );

  rmSync(leasesRoot, { recursive: true, force: true });
  privateDirectory(leasesRoot);
  for (let index = 0; index < 4_096; index += 1) {
    writeFileSync(
      path.join(
        leasesRoot,
        `entry-${index.toLocaleString("en-US", {
          minimumIntegerDigits: 4,
          useGrouping: false,
        })}`,
      ),
      "",
      { mode: 0o600 },
    );
  }
  assert.throws(
    () =>
      planAutomationKernelGuardCutover({
        stateRoot: fixture.stateRoot,
        taskId: TASK_ID,
        codexHome: fixture.codexHome,
        repoRoot: fixture.repoRoot,
      }),
    (error) =>
      error?.code === "cutover_state_invalid" &&
      /entry snapshot limit/.test(error.message),
  );

  rmSync(leasesRoot, { recursive: true, force: true });
  privateDirectory(leasesRoot);
  truncateSync(
    path.join(fixture.controlRoot, "events.jsonl"),
    AUTOMATION_KERNEL_GUARD_CUTOVER_PLAN_MAX_BYTES,
  );
  assert.throws(
    () =>
      planAutomationKernelGuardCutover({
        stateRoot: fixture.stateRoot,
        taskId: TASK_ID,
        codexHome: fixture.codexHome,
        repoRoot: fixture.repoRoot,
      }),
    (error) =>
      error?.code === "cutover_state_invalid" &&
      /aggregate snapshot limit/.test(error.message),
  );
});

test("descriptor-bound snapshot rejects a same-inode growth without allocating its bytes", async (t) => {
  const fixture = createFixture(t);
  const paths = automationKernelGuardCutoverPaths(fixture.stateRoot);
  const eventsPath = path.join(fixture.controlRoot, "events.jsonl");
  const eventsInode = lstatSync(eventsPath).ino;
  const child = spawnNativePausedPlanning(t, fixture, {
    checkpoint: "after-snapshot-file-open-before-read",
    source: "events.jsonl",
  });
  const stdout = [];
  child.stdout.on("data", (chunk) => stdout.push(Buffer.from(chunk)));
  const exitPromise = waitForChildExit(child);
  await waitForNativeHelperPause(
    child,
    "after-snapshot-file-open-before-read",
  );
  truncateSync(
    eventsPath,
    AUTOMATION_KERNEL_GUARD_CUTOVER_PLAN_MAX_BYTES,
  );
  releasePausedNativeHelper(child);
  const exited = await exitPromise;
  assert.equal(exited.code, 0);
  assert.equal(exited.signal, null);
  const outcome = JSON.parse(Buffer.concat(stdout).toString("utf8"));

  assert.equal(outcome.ok, false);
  assert.equal(outcome.code, "cutover_conflict");
  assert.match(outcome.message, /changed while being read|grew while being read/);
  assert.equal(lstatSync(eventsPath).ino, eventsInode);
  assert.equal(
    lstatSync(eventsPath).size,
    AUTOMATION_KERNEL_GUARD_CUTOVER_PLAN_MAX_BYTES,
  );
  assert.equal(existsSync(paths.transaction), false);
  assert.equal(existsSync(paths.globalReceipt), false);
  assert.equal(existsSync(paths.bootstrapLock), false);
  assert.equal(existsSync(paths.writerLock), false);
  assert.deepEqual(readdirSync(paths.guardsRoot), []);
});

test("planning rejects a recursively snapshotted root swap without admitting a hybrid tree", async (t) => {
  const fixture = createFixture(t);
  const paths = automationKernelGuardCutoverPaths(fixture.stateRoot);
  const leasesRoot = path.join(fixture.controlRoot, "leases");
  const child = spawnNativePausedPlanning(t, fixture, {
    checkpoint: "after-snapshot-tree-root-open-before-traversal",
    source: "leases",
  });
  const stdout = [];
  child.stdout.on("data", (chunk) => stdout.push(Buffer.from(chunk)));
  const exitPromise = waitForChildExit(child);
  await waitForNativeHelperPause(
    child,
    "after-snapshot-tree-root-open-before-traversal",
  );
  const admitted = `${leasesRoot}.admitted`;
  renameSync(leasesRoot, admitted);
  privateDirectory(leasesRoot);
  writeFileSync(path.join(leasesRoot, "replacement.json"), "replacement\n", {
    mode: 0o600,
  });
  releasePausedNativeHelper(child);
  const exited = await exitPromise;
  assert.equal(exited.code, 0);
  assert.equal(exited.signal, null);
  const outcome = JSON.parse(Buffer.concat(stdout).toString("utf8"));

  assert.equal(outcome.ok, false);
  assert.equal(outcome.code, "cutover_conflict");
  assert.match(outcome.message, /snapshot target changed/);
  assert.deepEqual(readdirSync(admitted), []);
  assert.deepEqual(readdirSync(leasesRoot), ["replacement.json"]);
  assert.equal(existsSync(paths.transaction), false);
  assert.equal(existsSync(paths.globalReceipt), false);
});

test("the maximum valid authorization transaction remains writable and readable", (t) => {
  const fixture = createFixture(t);
  const plan = planFixture(fixture);
  const paths = automationKernelGuardCutoverPaths(fixture.stateRoot);
  seedMaximumValidPreparedTransaction(fixture, plan);

  assert.throws(
    () =>
      applyAutomationKernelGuardCutover({
        plan,
        ownerConfirmationFile: fixture.confirmationFile,
        checkpoint(name) {
          if (name === "retry-authorization-evidence-durable") {
            throw new Error("stop after maximum authorization transaction");
          }
        },
      }),
    /stop after maximum authorization transaction/,
  );

  const transactionBytes = readFileSync(paths.transaction);
  const transaction = JSON.parse(transactionBytes.toString("utf8"));
  assert.equal(transaction.authorizations.length, 64);
  assert.ok(transactionBytes.length > 1024 * 1024);
  assert.ok(transactionBytes.length <= 8 * 1024 * 1024);
  const supersedePlan = planAutomationKernelGuardCutoverSupersede({ plan });
  assert.equal(
    supersedePlan.parameters.transactionDigest,
    sha256(transactionBytes),
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

      const beforeRecovery = JSON.parse(
        readFileSync(paths.transaction, "utf8"),
      );
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
  assert.equal(
    existsSync(interruptedAuthorization.confirmationArtifact),
    false,
  );
  assert.equal(
    existsSync(
      path.join(authorizationDirectory, "prepared-authorization.json"),
    ),
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
    ["kernel-cutover-test", "kernel-cutover-test", "kernel-cutover-test"],
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

      const failure = assert.throws(() =>
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

      assert.equal(tampered, true, failure?.stack);
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
                  name !== "guard-inner-marker-linked-recovery-before-unlink" ||
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
    path.join(paths.artifactRoot, plan.parameters.cutoverId, "authorizations"),
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

test("oversized same-inode rewrite is rejected before initial recovery allocation", (t) => {
  const fixture = createFixture(t, { legacyWriter: true });
  const plan = planFixture(fixture);
  const paths = automationKernelGuardCutoverPaths(fixture.stateRoot);
  assert.throws(
    () =>
      applyAutomationKernelGuardCutover({
        plan,
        ownerConfirmationFile: fixture.confirmationFile,
        checkpoint(name) {
          if (name === "writer-claim-before-write-journal-durable") {
            throw new Error("stop after rewrite journal");
          }
        },
      }),
    /stop after rewrite journal/,
  );
  const journal = JSON.parse(readFileSync(paths.writeAhead, "utf8"));
  const sourceBytes = Buffer.from(journal.sourceBytesBase64, "base64");
  const sourceInode = lstatSync(paths.writerLock).ino;
  const rewriteMaximum = Math.max(journal.sourceSize, journal.targetSize);
  const adversarialSize = 8 * 1024 * 1024 + 1;
  assert.ok(adversarialSize > rewriteMaximum);
  truncateSync(paths.writerLock, adversarialSize);
  assert.equal(lstatSync(paths.writerLock).ino, sourceInode);

  const trapped = captureOversizedBufferAllocation(adversarialSize, () =>
    applyAutomationKernelGuardCutover({
      plan,
      ownerConfirmationFile: fixture.confirmationFile,
    }),
  );
  assert.equal(trapped.error?.code, "cutover_source_drift");
  assert.match(trapped.error?.message ?? "", /Legacy claim source changed/);
  assert.deepEqual(trapped.attemptedSizes, []);
  assert.equal(existsSync(paths.writeAhead), true);
  assert.equal(existsSync(paths.globalReceipt), false);
  assert.equal(lstatSync(paths.writerLock).ino, sourceInode);
  assert.equal(lstatSync(paths.writerLock).size, adversarialSize);

  writeFileSync(paths.writerLock, sourceBytes, { mode: journal.sourceMode });
  assert.equal(lstatSync(paths.writerLock).ino, sourceInode);
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

test("oversized same-inode rewrite is rejected before pinned revalidation allocation", (t) => {
  const fixture = createFixture(t, { legacyWriter: true });
  const plan = planFixture(fixture);
  const paths = automationKernelGuardCutoverPaths(fixture.stateRoot);
  assert.throws(
    () =>
      applyAutomationKernelGuardCutover({
        plan,
        ownerConfirmationFile: fixture.confirmationFile,
        checkpoint(name) {
          if (name === "writer-claim-before-write-journal-durable") {
            throw new Error("stop after rewrite journal");
          }
        },
      }),
    /stop after rewrite journal/,
  );
  const journal = JSON.parse(readFileSync(paths.writeAhead, "utf8"));
  const sourceBytes = Buffer.from(journal.sourceBytesBase64, "base64");
  const sourceInode = lstatSync(paths.writerLock).ino;
  const rewriteMaximum = Math.max(journal.sourceSize, journal.targetSize);
  const adversarialSize = 8 * 1024 * 1024 + 1;
  assert.ok(adversarialSize > rewriteMaximum);
  let expandedAtRevalidation = false;

  const trapped = captureOversizedBufferAllocation(adversarialSize, () =>
    applyAutomationKernelGuardCutover({
      plan,
      ownerConfirmationFile: fixture.confirmationFile,
      checkpoint(name, details) {
        if (
          name === "writer-claim" &&
          details?.filePath === paths.writerLock &&
          !expandedAtRevalidation
        ) {
          truncateSync(paths.writerLock, adversarialSize);
          expandedAtRevalidation = true;
        }
      },
    }),
  );
  assert.equal(expandedAtRevalidation, true);
  assert.equal(trapped.error?.code, "cutover_source_drift");
  assert.match(
    trapped.error?.message ?? "",
    /Legacy claim generation changed/,
  );
  assert.deepEqual(trapped.attemptedSizes, []);
  assert.equal(existsSync(paths.writeAhead), true);
  assert.equal(existsSync(paths.globalReceipt), false);
  assert.equal(lstatSync(paths.writerLock).ino, sourceInode);
  assert.equal(lstatSync(paths.writerLock).size, adversarialSize);

  writeFileSync(paths.writerLock, sourceBytes, { mode: journal.sourceMode });
  assert.equal(lstatSync(paths.writerLock).ino, sourceInode);
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

test("supersede planning rejects ambiguous authoritative temporary residue byte-stably", async (t) => {
  const scenarios = [
    {
      name: "transaction",
      temporaryPath: (paths) => `${paths.transaction}.cutover.tmp`,
      bytes: (paths) => readFileSync(paths.transaction),
    },
    {
      name: "write-ahead",
      temporaryPath: (paths) => `${paths.writeAhead}.cutover.tmp`,
      bytes: () => Buffer.from('{"phase":"prepared"}\n', "utf8"),
    },
    {
      name: "global receipt",
      temporaryPath: (paths) => `${paths.globalReceipt}.cutover.tmp`,
      bytes: () => Buffer.from('{"kind":"unfinished-receipt"}\n', "utf8"),
    },
  ];

  for (const scenario of scenarios) {
    await t.test(scenario.name, (subtest) => {
      const fixture = createFixture(subtest);
      const oldPlan = planFixture(fixture);
      seedPreparedTransaction(fixture, oldPlan);
      const paths = automationKernelGuardCutoverPaths(fixture.stateRoot);
      const temporaryPath = scenario.temporaryPath(paths);
      writeFileSync(temporaryPath, scenario.bytes(paths), { mode: 0o600 });
      const beforePlanning = snapshotFilesystemTree(fixture.root);

      assert.throws(
        () => planAutomationKernelGuardCutoverSupersede({ plan: oldPlan }),
        (error) =>
          error?.code === "cutover_supersede_conflict" &&
          /ambiguous temporary residue/.test(error.message),
      );
      assert.deepEqual(snapshotFilesystemTree(fixture.root), beforePlanning);
      assert.equal(existsSync(temporaryPath), true);
    });
  }
});

test("real SIGKILL transaction temp blocks supersede and recovers through the original apply", (t) => {
  const fixture = createFixture(t);
  const oldPlan = planFixture(fixture);
  const paths = automationKernelGuardCutoverPaths(fixture.stateRoot);
  const temporaryPath = `${paths.transaction}.cutover.tmp`;

  runCutoverKilledAtCheckpoint(fixture, "transaction-temporary-durable", {
    filePath: paths.transaction,
  });

  assert.equal(existsSync(paths.transaction), false);
  assert.equal(existsSync(temporaryPath), true);
  assert.equal(lstatSync(temporaryPath).mode & 0o7777, 0o600);
  assert.equal(
    JSON.parse(readFileSync(temporaryPath, "utf8")).phase,
    "prepared",
  );
  const beforePlanning = snapshotFilesystemTree(fixture.root);

  assert.throws(
    () => planAutomationKernelGuardCutoverSupersede({ plan: oldPlan }),
    (error) =>
      error?.code === "cutover_supersede_conflict" &&
      /ambiguous temporary residue/.test(error.message),
  );
  assert.deepEqual(snapshotFilesystemTree(fixture.root), beforePlanning);
  assert.equal(existsSync(temporaryPath), true);

  const recovered = applyAutomationKernelGuardCutover({
    plan: oldPlan,
    ownerConfirmationFile: fixture.confirmationFile,
  });
  assert.equal(recovered.changed, true);
  assert.equal(existsSync(temporaryPath), false);
  const inspection = inspectAutomationKernelGuardCutover(fixture.stateRoot);
  assert.equal(inspection.ready, true, inspection.problems.join("\n"));
});

test("real SIGKILL supersede write-ahead temp recovers under the exact plan", (t) => {
  const { fixture, oldPlan, paths, supersedePlan } =
    prepareSupersedeWriteAheadCrash(t);
  const temporaryPath = `${paths.writeAhead}.cutover.tmp`;

  assert.equal(existsSync(paths.writeAhead), false);
  assert.equal(existsSync(temporaryPath), true);
  const temporaryRecord = JSON.parse(readFileSync(temporaryPath, "utf8"));
  assert.equal(temporaryRecord.scope, "supersede");
  assert.equal(
    temporaryRecord.scopeId,
    supersedePlan.parameters.supersedeId,
  );
  assert.equal(temporaryRecord.phase, "prepared");

  const recovered = applyAutomationKernelGuardCutoverSupersede({
    plan: oldPlan,
    supersedePlan,
    ownerConfirmationFile: fixture.confirmationFile,
  });
  assert.equal(recovered.changed, true);
  assert.equal(existsSync(temporaryPath), false);
  assert.equal(existsSync(paths.writeAhead), false);
  assert.equal(existsSync(paths.transaction), false);
  assert.equal(existsSync(paths.globalReceipt), false);
});

test("supersede recovery preserves a canonical write-ahead predecessor", (t) => {
  const { fixture, oldPlan, paths, supersedePlan } =
    prepareSupersedeWriteAheadCrash(t, { occurrence: 2 });
  const temporaryPath = `${paths.writeAhead}.cutover.tmp`;
  const canonicalRecord = JSON.parse(readFileSync(paths.writeAhead, "utf8"));
  const temporaryRecord = JSON.parse(readFileSync(temporaryPath, "utf8"));
  assert.equal(canonicalRecord.phase, "prepared");
  assert.equal(temporaryRecord.phase, "written");
  assert.equal(temporaryRecord.operationId, canonicalRecord.operationId);

  const recovered = applyAutomationKernelGuardCutoverSupersede({
    plan: oldPlan,
    supersedePlan,
    ownerConfirmationFile: fixture.confirmationFile,
  });
  assert.equal(recovered.changed, true);
  assert.equal(existsSync(temporaryPath), false);
  assert.equal(existsSync(paths.writeAhead), false);
  assert.equal(existsSync(paths.transaction), false);
});

test("supersede write-ahead temp recovery requires live exact authority", async (t) => {
  await t.test("missing confirmation", (subtest) => {
    const { fixture, oldPlan, paths, supersedePlan } =
      prepareSupersedeWriteAheadCrash(subtest);
    const temporaryPath = `${paths.writeAhead}.cutover.tmp`;
    unlinkSync(fixture.confirmationFile);
    const beforeRecovery = snapshotFilesystemTree(fixture.stateRoot);

    assert.throws(
      () =>
        applyAutomationKernelGuardCutoverSupersede({
          plan: oldPlan,
          supersedePlan,
          ownerConfirmationFile: fixture.confirmationFile,
        }),
      (error) => error?.code === "owner_confirmation_required",
    );
    assert.deepEqual(
      snapshotFilesystemTree(fixture.stateRoot),
      beforeRecovery,
    );
    assert.equal(existsSync(temporaryPath), true);
    assert.equal(existsSync(paths.writeAhead), false);
  });

  await t.test("different plan bytes", (subtest) => {
    const { fixture, oldPlan, paths, supersedePlan } =
      prepareSupersedeWriteAheadCrash(subtest);
    const temporaryPath = `${paths.writeAhead}.cutover.tmp`;
    const conflictingPlan = structuredClone(supersedePlan);
    conflictingPlan.createdAt = new Date(
      Date.parse(supersedePlan.createdAt) + 1,
    ).toISOString();
    assert.equal(
      conflictingPlan.parameters.supersedeId,
      supersedePlan.parameters.supersedeId,
    );
    assert.equal(conflictingPlan.intentDigest, supersedePlan.intentDigest);
    const beforeRecovery = snapshotFilesystemTree(fixture.stateRoot);

    assert.throws(
      () =>
        applyAutomationKernelGuardCutoverSupersede({
          plan: oldPlan,
          supersedePlan: conflictingPlan,
          ownerConfirmationFile: fixture.confirmationFile,
        }),
      (error) => error?.code === "cutover_supersede_conflict",
    );
    assert.deepEqual(
      snapshotFilesystemTree(fixture.stateRoot),
      beforeRecovery,
    );
    assert.equal(existsSync(temporaryPath), true);
    assert.equal(existsSync(paths.writeAhead), false);
  });
});

test("supersede protected retirement rejects transaction temporary residue under the bootstrap guard", (t) => {
  const fixture = createFixture(t, {
    legacyGuard: true,
    legacyWriter: true,
  });
  const oldPlan = planFixture(fixture);
  seedPreparedTransaction(fixture, oldPlan);
  const supersedePlan = supersedePlanFixture(fixture, oldPlan);
  const paths = automationKernelGuardCutoverPaths(fixture.stateRoot);
  const transactionBytes = readFileSync(paths.transaction);
  const temporaryPath = `${paths.transaction}.cutover.tmp`;
  const receiptPath = path.join(
    paths.artifactRoot,
    oldPlan.parameters.cutoverId,
    "superseded",
    supersedePlan.parameters.supersedeId,
    "receipt.json",
  );
  let injected = false;

  assert.throws(
    () =>
      applyAutomationKernelGuardCutoverSupersede({
        plan: oldPlan,
        supersedePlan,
        ownerConfirmationFile: fixture.confirmationFile,
        checkpoint(name) {
          if (name !== "supersede-claims-restored" || injected) return;
          writeFileSync(temporaryPath, transactionBytes, { mode: 0o600 });
          injected = true;
        },
      }),
    (error) =>
      error?.code === "cutover_supersede_conflict" &&
      /ambiguous temporary residue/.test(error.message),
  );

  assert.equal(injected, true);
  assert.deepEqual(readFileSync(paths.transaction), transactionBytes);
  assert.deepEqual(readFileSync(temporaryPath), transactionBytes);
  assert.equal(existsSync(receiptPath), false);
  assert.equal(existsSync(paths.globalReceipt), false);
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
      Object.assign(rawSupersedePlan, structuredClone(victimSupersedePlan));
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
      const manifestPath = path.join(fixture.controlRoot, "current-tasks.json");
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
    (error) =>
      ["cutover_conflict", "cutover_supersede_conflict"].includes(
        error?.code,
      ),
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

test("supersede preserves retired file and directory generations", (t) => {
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
            throw new Error("stop after claims");
          }
        },
      }),
    /stop after claims/,
  );
  const transactionBytes = readFileSync(paths.transaction);
  const transactionInode = lstatSync(paths.transaction).ino;
  const guardInode = lstatSync(paths.guards.events.directory).ino;
  const supersedePlan = supersedePlanFixture(fixture, plan);

  const result = applyAutomationKernelGuardCutoverSupersede({
    plan,
    supersedePlan,
    ownerConfirmationFile: fixture.confirmationFile,
  });

  assert.equal(result.changed, true);
  const retirementDirectory = path.join(
    fixture.controlRoot,
    ".kernel-guard-cutover-retired",
    plan.parameters.cutoverId,
    "removals",
  );
  const retiredPaths = readdirSync(retirementDirectory).map((name) =>
    path.join(retirementDirectory, name),
  );
  const retiredTransaction = retiredPaths.find((filePath) => {
    const stats = lstatSync(filePath);
    return stats.isFile() && stats.ino === transactionInode;
  });
  const retiredGuard = retiredPaths.find((filePath) => {
    const stats = lstatSync(filePath);
    return stats.isDirectory() && stats.ino === guardInode;
  });
  assert.notEqual(retiredTransaction, undefined);
  assert.deepEqual(readFileSync(retiredTransaction), transactionBytes);
  assert.notEqual(retiredGuard, undefined);
  assert.equal(existsSync(paths.transaction), false);
  assert.equal(existsSync(paths.guards.events.directory), false);
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
    readdirSync(
      path.join(paths.artifactRoot, oldPlan.parameters.cutoverId),
    ).sort(),
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

test("completed supersede response-loss recovery needs no live confirmation or unchanged task", (t) => {
  const fixture = createFixture(t, {
    legacyGuard: true,
    legacyWriter: true,
  });
  const oldPlan = planFixture(fixture);
  seedPreparedTransaction(fixture, oldPlan);
  const supersedePlan = supersedePlanFixture(fixture, oldPlan);
  const paths = automationKernelGuardCutoverPaths(fixture.stateRoot);
  runSupersedeKilledAtCheckpoint(fixture, "supersede-transaction-retired");
  assert.equal(existsSync(paths.transaction), false);
  assert.equal(existsSync(paths.writeAhead), false);

  unlinkSync(fixture.confirmationFile);
  const manifestPath = path.join(fixture.controlRoot, "current-tasks.json");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  manifest.revision += 1;
  manifest.updatedAt = new Date().toISOString();
  manifest.tasks[0].revision += 1;
  manifest.tasks[0].updatedAt = manifest.updatedAt;
  manifest.tasks[0].details.supersedeResponseRecovered = true;
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, {
    mode: 0o600,
  });
  const beforeRecovery = snapshotFilesystemTree(fixture.stateRoot);

  const conflictingPlan = structuredClone(supersedePlan);
  conflictingPlan.createdAt = new Date(
    Date.parse(supersedePlan.createdAt) + 1,
  ).toISOString();
  assert.equal(
    conflictingPlan.parameters.supersedeId,
    supersedePlan.parameters.supersedeId,
  );
  assert.equal(conflictingPlan.intentDigest, supersedePlan.intentDigest);
  assert.throws(
    () =>
      applyAutomationKernelGuardCutoverSupersede({
        plan: oldPlan,
        supersedePlan: conflictingPlan,
        ownerConfirmationFile: fixture.confirmationFile,
      }),
    (error) =>
      ["cutover_conflict", "cutover_supersede_conflict"].includes(
        error?.code,
      ),
  );
  assert.deepEqual(snapshotFilesystemTree(fixture.stateRoot), beforeRecovery);

  const recovered = applyAutomationKernelGuardCutoverSupersede({
    plan: oldPlan,
    supersedePlan,
    ownerConfirmationFile: fixture.confirmationFile,
  });

  assert.equal(recovered.changed, false);
  assert.equal(
    recovered.receipt.supersedeId,
    supersedePlan.parameters.supersedeId,
  );
  assert.deepEqual(snapshotFilesystemTree(fixture.stateRoot), beforeRecovery);
});

test("completed supersede recovery rejects a renamed guard entry without authorization", (t) => {
  const fixture = createFixture(t, {
    legacyGuard: true,
    legacyWriter: true,
  });
  const oldPlan = planFixture(fixture);
  seedPreparedTransaction(fixture, oldPlan);
  const supersedePlan = supersedePlanFixture(fixture, oldPlan);
  const paths = automationKernelGuardCutoverPaths(fixture.stateRoot);
  runSupersedeKilledAtCheckpoint(fixture, "supersede-transaction-retired");
  unlinkSync(fixture.confirmationFile);

  renameSync(
    paths.guards.events.directory,
    path.join(paths.guardsRoot, "events-renamed.lock"),
  );
  const beforeRecovery = snapshotFilesystemTree(fixture.stateRoot);

  assert.throws(
    () =>
      applyAutomationKernelGuardCutoverSupersede({
        plan: oldPlan,
        supersedePlan,
        ownerConfirmationFile: fixture.confirmationFile,
      }),
    (error) => error?.code === "cutover_source_drift",
  );
  assert.deepEqual(snapshotFilesystemTree(fixture.stateRoot), beforeRecovery);
  assert.equal(existsSync(paths.transaction), false);
  assert.equal(existsSync(paths.globalReceipt), false);
});

test("completed supersede recovery rejects every ambiguous authoritative temporary", async (t) => {
  const scenarios = [
    {
      name: "transaction",
      temporaryPath: ({ paths }) => `${paths.transaction}.cutover.tmp`,
      install({ temporaryPath, evidence }) {
        writeFileSync(temporaryPath, readFileSync(evidence.transaction), {
          mode: 0o600,
        });
      },
    },
    {
      name: "write-ahead",
      temporaryPath: ({ paths }) => `${paths.writeAhead}.cutover.tmp`,
      install({ temporaryPath }) {
        writeFileSync(temporaryPath, '{"phase":"prepared"}\n', {
          mode: 0o600,
        });
      },
    },
    {
      name: "global receipt",
      temporaryPath: ({ paths }) => `${paths.globalReceipt}.cutover.tmp`,
      install({ temporaryPath }) {
        writeFileSync(temporaryPath, '{"kind":"unfinished-receipt"}\n', {
          mode: 0o600,
        });
      },
    },
    {
      name: "bootstrap marker hard link",
      temporaryPath: ({ paths }) => `${paths.bootstrapLock}.cutover.tmp`,
      install({ temporaryPath, paths }) {
        linkSync(paths.bootstrapLock, temporaryPath);
      },
    },
    {
      name: "supersede receipt hard link",
      temporaryPath: ({ evidence }) => `${evidence.receipt}.cutover.tmp`,
      install({ temporaryPath, evidence }) {
        linkSync(evidence.receipt, temporaryPath);
      },
    },
  ];

  for (const scenario of scenarios) {
    await t.test(scenario.name, (subtest) => {
      const fixture = createFixture(subtest, {
        legacyGuard: true,
        legacyWriter: true,
      });
      const oldPlan = planFixture(fixture);
      seedPreparedTransaction(fixture, oldPlan);
      const supersedePlan = supersedePlanFixture(fixture, oldPlan);
      const paths = automationKernelGuardCutoverPaths(fixture.stateRoot);
      const evidence = {
        directory: path.join(
          paths.artifactRoot,
          oldPlan.parameters.cutoverId,
          "superseded",
          supersedePlan.parameters.supersedeId,
        ),
      };
      evidence.transaction = path.join(
        evidence.directory,
        "superseded-transaction.json",
      );
      evidence.receipt = path.join(evidence.directory, "receipt.json");
      runSupersedeKilledAtCheckpoint(fixture, "supersede-transaction-retired");
      unlinkSync(fixture.confirmationFile);

      const temporaryPath = scenario.temporaryPath({ paths, evidence });
      scenario.install({ temporaryPath, paths, evidence });
      const beforeRecovery = snapshotFilesystemTree(fixture.stateRoot);

      assert.throws(
        () =>
          applyAutomationKernelGuardCutoverSupersede({
            plan: oldPlan,
            supersedePlan,
            ownerConfirmationFile: fixture.confirmationFile,
          }),
        (error) =>
          error?.code === "cutover_supersede_conflict" &&
          /ambiguous temporary residue/.test(error.message),
      );
      assert.deepEqual(
        snapshotFilesystemTree(fixture.stateRoot),
        beforeRecovery,
      );
      assert.equal(existsSync(temporaryPath), true);
      assert.equal(existsSync(paths.transaction), false);
      assert.equal(existsSync(paths.globalReceipt), false);
    });
  }
});

test("supersede response-loss recovery cannot bypass unfinished retirement authorization", async (t) => {
  for (const checkpoint of [
    "supersede-receipt-durable",
    "supersede-transaction-retire-after-rename",
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
      unlinkSync(fixture.confirmationFile);
      const beforeRecovery = snapshotFilesystemTree(fixture.stateRoot);

      assert.throws(
        () =>
          applyAutomationKernelGuardCutoverSupersede({
            plan: oldPlan,
            supersedePlan,
            ownerConfirmationFile: fixture.confirmationFile,
          }),
        (error) => error?.code === "owner_confirmation_required",
      );
      assert.deepEqual(
        snapshotFilesystemTree(fixture.stateRoot),
        beforeRecovery,
      );
      assert.equal(
        existsSync(paths.transaction),
        checkpoint === "supersede-receipt-durable",
      );
      assert.equal(
        existsSync(paths.writeAhead),
        checkpoint !== "supersede-receipt-durable",
      );
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
            true,
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

test("empty quarantine recovery stays bound to its held directory across a path swap", async (t) => {
  const fixture = createFixture(t);
  const plan = planFixture(fixture);
  assert.throws(
    () =>
      applyAutomationKernelGuardCutover({
        plan,
        ownerConfirmationFile: fixture.confirmationFile,
        checkpoint(name) {
          if (name === "transaction-prepared-durable") {
            throw new Error("stop after prepared transaction");
          }
        },
      }),
    /stop after prepared transaction/,
  );
  const paths = automationKernelGuardCutoverPaths(fixture.stateRoot);
  const artifactDirectory = path.join(
    paths.artifactRoot,
    plan.parameters.cutoverId,
  );
  const quarantineRoot = privateDirectory(
    path.join(artifactDirectory, ".recovery-quarantine"),
  );
  const heldQuarantineRoot = `${quarantineRoot}.held`;
  const child = spawnNativePausedCutoverApply(
    t,
    fixture,
    "after-list-bounded-scan",
    { source: String(lstatSync(quarantineRoot).ino) },
  );
  const stdout = [];
  child.stdout.on("data", (chunk) => stdout.push(Buffer.from(chunk)));
  const exitPromise = waitForChildExit(child);

  try {
    await waitForNativeHelperPause(child, "after-list-bounded-scan");
  } catch (error) {
    await exitPromise;
    throw new Error(
      `${error instanceof Error ? error.message : String(error)} Child output: ${Buffer.concat(stdout).toString("utf8")}`,
      { cause: error },
    );
  }
  renameSync(quarantineRoot, heldQuarantineRoot);
  privateDirectory(quarantineRoot);
  releasePausedNativeHelper(child);
  const exited = await exitPromise;
  assert.equal(exited.code, 0);
  assert.equal(exited.signal, null);
  const outcome = JSON.parse(Buffer.concat(stdout).toString("utf8"));

  assert.equal(outcome.ok, false);
  assert.equal(outcome.code, "cutover_conflict");
  assert.match(
    outcome.message,
    /bounded list directory changed during admission|recovery directory generation changed/,
  );
  assert.deepEqual(readdirSync(heldQuarantineRoot), []);
  assert.deepEqual(readdirSync(quarantineRoot), []);
  assert.equal(existsSync(paths.transaction), true);
  assert.equal(existsSync(paths.writeAhead), false);
  assert.equal(existsSync(paths.globalReceipt), false);
  assert.equal(
    existsSync(
      path.join(
        fixture.controlRoot,
        ".kernel-guard-cutover-retired",
        plan.parameters.cutoverId,
        "legacy-quarantine-roots",
      ),
    ),
    false,
  );
});

test("lease quiescence stays bound to the held lease root across a path swap", async (t) => {
  const fixture = createFixture(t);
  const plan = planFixture(fixture);
  const paths = automationKernelGuardCutoverPaths(fixture.stateRoot);
  const leasesRoot = path.join(fixture.controlRoot, "leases");
  const heldLeasesRoot = `${leasesRoot}.held`;
  const child = spawnNativePausedCutoverApply(
    t,
    fixture,
    "after-list-bounded-scan",
    { source: String(lstatSync(leasesRoot).ino) },
  );
  const stdout = [];
  child.stdout.on("data", (chunk) => stdout.push(Buffer.from(chunk)));
  const exitPromise = waitForChildExit(child);
  await waitForNativeHelperPause(child, "after-list-bounded-scan");
  renameSync(leasesRoot, heldLeasesRoot);
  privateDirectory(leasesRoot);
  writeFileSync(path.join(leasesRoot, "live-lease.json"), "{}\n", {
    mode: 0o600,
  });
  releasePausedNativeHelper(child);
  const exited = await exitPromise;
  assert.equal(exited.code, 0);
  assert.equal(exited.signal, null);
  const outcome = JSON.parse(Buffer.concat(stdout).toString("utf8"));

  assert.equal(outcome.ok, false);
  assert.equal(outcome.code, "cutover_conflict");
  assert.match(
    outcome.message,
    /bounded list directory changed during admission|lease root generation changed/,
  );
  assert.deepEqual(readdirSync(heldLeasesRoot), []);
  assert.deepEqual(readdirSync(leasesRoot), ["live-lease.json"]);
  assert.equal(existsSync(paths.transaction), false);
  assert.equal(existsSync(paths.globalReceipt), false);
});

test("guard mode changes never follow a final-window path swap", (t) => {
  const fixture = createFixture(t);
  const paths = automationKernelGuardCutoverPaths(fixture.stateRoot);
  const guard = paths.guards.tasks;
  const victim = privateDirectory(path.join(fixture.root, "mode-swap-victim"));
  chmodSync(victim, 0o755);
  const plan = planFixture(fixture);
  const displaced = `${guard.directory}.held`;
  let armed = false;
  let swapped = false;

  assert.throws(
    () =>
      applyAutomationKernelGuardCutover({
        plan,
        ownerConfirmationFile: fixture.confirmationFile,
        checkpoint(name, details) {
          if (
            name === "guard-inner-marker-durable" &&
            details?.guardName === "tasks" &&
            !armed
          ) {
            chmodSync(guard.directory, 0o755);
            armed = true;
            return;
          }
          if (name === "guard-tasks-before-private-mode" && !swapped) {
            swapped = true;
            renameSync(guard.directory, displaced);
            symlinkSync(victim, guard.directory);
          }
        },
      }),
    (error) =>
      ["cutover_conflict", "cutover_source_drift"].includes(error?.code),
  );

  assert.equal(armed, true);
  assert.equal(swapped, true);
  assert.equal(lstatSync(guard.directory).isSymbolicLink(), true);
  assert.equal(lstatSync(victim).mode & 0o7777, 0o755);
  assert.equal(lstatSync(displaced).mode & 0o7777, 0o755);
  assert.equal(existsSync(paths.globalReceipt), false);
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

test("callback pathname swaps preserve foreign generations and fail closed", async (t) => {
  await t.test("absent atomic destination appears before publication", (subtest) => {
    const fixture = createFixture(subtest);
    const plan = planFixture(fixture);
    const paths = automationKernelGuardCutoverPaths(fixture.stateRoot);
    const foreignBytes = Buffer.from("unadmitted transaction generation\n");
    let injected = false;

    assert.throws(
      () =>
        applyAutomationKernelGuardCutover({
          plan,
          ownerConfirmationFile: fixture.confirmationFile,
          checkpoint(name, details) {
            if (
              injected ||
              name !== "transaction-temporary-durable" ||
              details?.cleanup === true
            ) {
              return;
            }
            writeFileSync(paths.transaction, foreignBytes, { mode: 0o600 });
            injected = true;
          },
        }),
      (error) => error?.code === "cutover_conflict",
    );

    assert.equal(injected, true);
    assert.deepEqual(readFileSync(paths.transaction), foreignBytes);
    assert.equal(existsSync(`${paths.transaction}.cutover.tmp`), true);
  });

  await t.test("admitted atomic destination changes before exchange", (subtest) => {
    const fixture = createFixture(subtest);
    const plan = planFixture(fixture);
    seedPreparedTransaction(fixture, plan);
    const paths = automationKernelGuardCutoverPaths(fixture.stateRoot);
    const predecessorBytes = readFileSync(paths.transaction);
    const admittedInode = lstatSync(paths.transaction).ino;
    let replacementInode = null;
    let swapped = false;

    assert.throws(
      () =>
        applyAutomationKernelGuardCutover({
          plan,
          ownerConfirmationFile: fixture.confirmationFile,
          checkpoint(name, details) {
            if (
              swapped ||
              name !== "transaction-temporary-durable" ||
              details?.cleanup === true
            ) {
              return;
            }
            unlinkSync(paths.transaction);
            writeFileSync(paths.transaction, predecessorBytes, {
              mode: 0o600,
            });
            replacementInode = lstatSync(paths.transaction).ino;
            swapped = true;
          },
        }),
      (error) => error?.code === "cutover_conflict",
    );

    assert.equal(swapped, true);
    assert.notEqual(replacementInode, admittedInode);
    assert.equal(lstatSync(paths.transaction).ino, replacementInode);
    assert.deepEqual(readFileSync(paths.transaction), predecessorBytes);
    assert.equal(existsSync(`${paths.transaction}.cutover.tmp`), true);
  });

  await t.test("normal write-ahead publication", (subtest) => {
    const fixture = createFixture(subtest, { legacyWriter: true });
    const plan = planFixture(fixture);
    const paths = automationKernelGuardCutoverPaths(fixture.stateRoot);
    let replacementBytes = null;
    let admittedInode = null;
    let replacementInode = null;
    let swapped = false;

    assert.throws(() =>
      applyAutomationKernelGuardCutover({
        plan,
        ownerConfirmationFile: fixture.confirmationFile,
        checkpoint(name, details) {
          if (
            swapped ||
            name !== "write-ahead-temporary-durable" ||
            details?.cleanup === true
          ) {
            return;
          }
          replacementBytes = readFileSync(details.temporaryPath);
          admittedInode = lstatSync(details.temporaryPath).ino;
          unlinkSync(details.temporaryPath);
          writeFileSync(details.temporaryPath, replacementBytes, {
            mode: 0o600,
          });
          replacementInode = lstatSync(details.temporaryPath).ino;
          swapped = true;
        },
      }),
    );

    assert.equal(swapped, true);
    assert.notEqual(replacementInode, admittedInode);
    assert.deepEqual(
      readFileSync(`${paths.writeAhead}.cutover.tmp`),
      replacementBytes,
    );
    assert.equal(existsSync(paths.writeAhead), false);
  });

  await t.test("write-ahead clear", (subtest) => {
    const fixture = createFixture(subtest, { legacyWriter: true });
    const plan = planFixture(fixture);
    const paths = automationKernelGuardCutoverPaths(fixture.stateRoot);
    let replacementBytes = null;
    let admittedInode = null;
    let replacementInode = null;
    let swapped = false;

    assert.throws(() =>
      applyAutomationKernelGuardCutover({
        plan,
        ownerConfirmationFile: fixture.confirmationFile,
        checkpoint(name, details) {
          if (
            swapped ||
            name !== "writer-claim-before-write-journal-written"
          ) {
            return;
          }
          assert.equal(details.writeAheadPath, paths.writeAhead);
          replacementBytes = readFileSync(paths.writeAhead);
          admittedInode = lstatSync(paths.writeAhead).ino;
          unlinkSync(paths.writeAhead);
          writeFileSync(paths.writeAhead, replacementBytes, { mode: 0o600 });
          replacementInode = lstatSync(paths.writeAhead).ino;
          swapped = true;
        },
      }),
    );

    assert.equal(swapped, true);
    assert.notEqual(replacementInode, admittedInode);
    assert.equal(lstatSync(paths.writeAhead).ino, replacementInode);
    assert.deepEqual(readFileSync(paths.writeAhead), replacementBytes);
  });

  await t.test("unlinked claim temporary removal", (subtest) => {
    const fixture = createFixture(subtest);
    const plan = planFixture(fixture);
    const paths = automationKernelGuardCutoverPaths(fixture.stateRoot);
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
    const temporaryPath = `${paths.writerLock}.cutover-claim.tmp`;
    const claimBytes = readFileSync(paths.writerLock);
    writeFileSync(temporaryPath, claimBytes, { mode: 0o600 });
    const admittedInode = lstatSync(temporaryPath).ino;
    const supersedePlan = supersedePlanFixture(fixture, plan);
    let replacementInode = null;
    let swapped = false;

    assert.throws(() =>
      applyAutomationKernelGuardCutoverSupersede({
        plan,
        supersedePlan,
        ownerConfirmationFile: fixture.confirmationFile,
        checkpoint(name, details) {
          if (
            swapped ||
            name !== "supersede-claim-temporary-before-remove" ||
            details?.temporaryPath !== temporaryPath
          ) {
            return;
          }
          unlinkSync(temporaryPath);
          writeFileSync(temporaryPath, claimBytes, { mode: 0o600 });
          replacementInode = lstatSync(temporaryPath).ino;
          swapped = true;
        },
      }),
    );

    assert.equal(swapped, true);
    assert.notEqual(replacementInode, admittedInode);
    assert.equal(lstatSync(temporaryPath).ino, replacementInode);
    assert.deepEqual(readFileSync(temporaryPath), claimBytes);
  });

  await t.test("unlinked guard claim temporary removal", (subtest) => {
    const fixture = createFixture(subtest);
    const plan = planFixture(fixture);
    const paths = automationKernelGuardCutoverPaths(fixture.stateRoot);
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
    const ownerPath = paths.guards.events.owner;
    const temporaryPath = `${ownerPath}.cutover-claim.tmp`;
    const claimBytes = readFileSync(ownerPath);
    writeFileSync(temporaryPath, claimBytes, { mode: 0o600 });
    const admittedInode = lstatSync(temporaryPath).ino;
    const supersedePlan = supersedePlanFixture(fixture, plan);
    let replacementInode = null;
    let swapped = false;

    assert.throws(() =>
      applyAutomationKernelGuardCutoverSupersede({
        plan,
        supersedePlan,
        ownerConfirmationFile: fixture.confirmationFile,
        checkpoint(name, details) {
          if (
            swapped ||
            name !== "supersede-claim-temporary-before-remove" ||
            details?.temporaryPath !== temporaryPath
          ) {
            return;
          }
          unlinkSync(temporaryPath);
          writeFileSync(temporaryPath, claimBytes, { mode: 0o600 });
          replacementInode = lstatSync(temporaryPath).ino;
          swapped = true;
        },
      }),
    );

    assert.equal(swapped, true);
    assert.notEqual(replacementInode, admittedInode);
    assert.equal(lstatSync(temporaryPath).ino, replacementInode);
    assert.deepEqual(readFileSync(temporaryPath), claimBytes);
  });

  for (const scenario of [
    { name: "supersede successor rename", occurrence: 1, predecessor: false },
    {
      name: "supersede predecessor preservation",
      occurrence: 2,
      predecessor: true,
    },
  ]) {
    await t.test(scenario.name, (subtest) => {
      const { fixture, oldPlan, paths, supersedePlan } =
        prepareSupersedeWriteAheadCrash(subtest, {
          occurrence: scenario.occurrence,
        });
      const temporaryPath = `${paths.writeAhead}.cutover.tmp`;
      const predecessorBytes = scenario.predecessor
        ? readFileSync(paths.writeAhead)
        : null;
      const replacementBytes = readFileSync(temporaryPath);
      const admittedInode = lstatSync(temporaryPath).ino;
      let replacementInode = null;
      let swapped = false;

      assert.throws(() =>
        applyAutomationKernelGuardCutoverSupersede({
          plan: oldPlan,
          supersedePlan,
          ownerConfirmationFile: fixture.confirmationFile,
          checkpoint(name) {
            if (
              swapped ||
              name !==
                "supersede-write-ahead-temporary-recovery-before-mutation"
            ) {
              return;
            }
            unlinkSync(temporaryPath);
            writeFileSync(temporaryPath, replacementBytes, { mode: 0o600 });
            replacementInode = lstatSync(temporaryPath).ino;
            swapped = true;
          },
        }),
      );

      assert.equal(swapped, true);
      assert.notEqual(replacementInode, admittedInode);
      assert.equal(lstatSync(temporaryPath).ino, replacementInode);
      assert.deepEqual(readFileSync(temporaryPath), replacementBytes);
      if (predecessorBytes === null) {
        assert.equal(existsSync(paths.writeAhead), false);
      } else {
        assert.deepEqual(readFileSync(paths.writeAhead), predecessorBytes);
      }
    });
  }

  await t.test("immutable receipt finalization", (subtest) => {
    const fixture = createFixture(subtest);
    const plan = planFixture(fixture);
    const paths = automationKernelGuardCutoverPaths(fixture.stateRoot);
    let replacementBytes = null;
    let admittedInode = null;
    let replacementInode = null;
    let temporaryPath = null;

    assert.throws(() =>
      applyAutomationKernelGuardCutover({
        plan,
        ownerConfirmationFile: fixture.confirmationFile,
        checkpoint(name, details) {
          if (temporaryPath !== null || name !== "receipt-artifact-linked") {
            return;
          }
          temporaryPath = details.temporaryPath;
          replacementBytes = readFileSync(temporaryPath);
          admittedInode = lstatSync(temporaryPath).ino;
          unlinkSync(temporaryPath);
          writeFileSync(temporaryPath, replacementBytes, { mode: 0o600 });
          replacementInode = lstatSync(temporaryPath).ino;
        },
      }),
    );

    assert.notEqual(temporaryPath, null);
    assert.notEqual(replacementInode, admittedInode);
    assert.equal(lstatSync(temporaryPath).ino, replacementInode);
    assert.deepEqual(readFileSync(temporaryPath), replacementBytes);
    assert.equal(existsSync(paths.globalReceipt), false);
  });

  await t.test("permanent marker finalization", (subtest) => {
    const fixture = createFixture(subtest);
    const plan = planFixture(fixture);
    let replacementBytes = null;
    let admittedInode = null;
    let replacementInode = null;
    let markerPath = null;
    let temporaryPath = null;

    assert.throws(() =>
      applyAutomationKernelGuardCutover({
        plan,
        ownerConfirmationFile: fixture.confirmationFile,
        checkpoint(name, details) {
          if (temporaryPath !== null || name !== "guard-inner-marker-linked") {
            return;
          }
          markerPath = details.filePath;
          temporaryPath = details.temporaryPath;
          replacementBytes = readFileSync(markerPath);
          admittedInode = lstatSync(markerPath).ino;
          unlinkSync(markerPath);
          writeFileSync(markerPath, replacementBytes, { mode: 0o600 });
          replacementInode = lstatSync(markerPath).ino;
        },
      }),
    );

    assert.notEqual(markerPath, null);
    assert.notEqual(replacementInode, admittedInode);
    assert.equal(lstatSync(markerPath).ino, replacementInode);
    assert.deepEqual(readFileSync(markerPath), replacementBytes);
    assert.equal(lstatSync(temporaryPath).ino, admittedInode);
    assert.deepEqual(
      readFileSync(markerPath),
      automationKernelGuardMarkerBytes(),
    );
  });

  await t.test("in-place rewrite target", (subtest) => {
    const fixture = createFixture(subtest, { legacyWriter: true });
    const plan = planFixture(fixture);
    const paths = automationKernelGuardCutoverPaths(fixture.stateRoot);
    let replacementBytes = null;
    let admittedInode = null;
    let replacementInode = null;
    let swapped = false;

    assert.throws(() =>
      applyAutomationKernelGuardCutover({
        plan,
        ownerConfirmationFile: fixture.confirmationFile,
        checkpoint(name, details) {
          if (swapped || name !== "writer-claim-before-write") return;
          assert.equal(details.filePath, paths.writerLock);
          replacementBytes = readFileSync(paths.writerLock);
          admittedInode = lstatSync(paths.writerLock).ino;
          unlinkSync(paths.writerLock);
          writeFileSync(paths.writerLock, replacementBytes, { mode: 0o600 });
          replacementInode = lstatSync(paths.writerLock).ino;
          swapped = true;
        },
      }),
    );

    assert.equal(swapped, true);
    assert.notEqual(replacementInode, admittedInode);
    assert.equal(lstatSync(paths.writerLock).ino, replacementInode);
    assert.deepEqual(readFileSync(paths.writerLock), replacementBytes);
    assert.equal(existsSync(paths.writeAhead), true);
  });

  await t.test("quarantine deletion target", (subtest) => {
    const fixture = createFixture(subtest, { legacyGuard: true });
    const legacyChild = path.join(
      fixture.guardsRoot,
      "events.lock",
      "legacy-child.json",
    );
    writeFileSync(legacyChild, '{"legacy":true}\n', { mode: 0o600 });
    const plan = planFixture(fixture);
    let quarantinePath = null;
    let admittedInode = null;
    let replacementInode = null;
    let replacementBytes = null;

    assert.throws(() =>
      applyAutomationKernelGuardCutover({
        plan,
        ownerConfirmationFile: fixture.confirmationFile,
        checkpoint(name, details) {
          if (
            quarantinePath !== null ||
            name !== "guard-events-legacy-remove-after-rename"
          ) {
            return;
          }
          quarantinePath = details.quarantinePath;
          admittedInode = lstatSync(quarantinePath).ino;
          replacementBytes = readFileSync(quarantinePath);
          unlinkSync(quarantinePath);
          writeFileSync(quarantinePath, replacementBytes, {
            mode: 0o600,
          });
          replacementInode = lstatSync(quarantinePath).ino;
        },
      }),
    );

    assert.notEqual(quarantinePath, null);
    assert.notEqual(replacementInode, admittedInode);
    assert.equal(lstatSync(quarantinePath).ino, replacementInode);
    assert.deepEqual(readFileSync(quarantinePath), replacementBytes);
  });
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
