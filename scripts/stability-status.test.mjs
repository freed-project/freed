import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmodSync,
  closeSync,
  constants,
  fstatSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
  readdirSync,
  realpathSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";

import {
  buildStabilityStatus,
  deriveStabilityNextAction,
  formatStabilityStatus,
  readControlStatus,
  readRepositoryStatus,
  readRuntimeStatus,
  readSoakStatus,
} from "./lib/stability-status.mjs";
import { STABILITY_METRIC_REGISTRY_VERSION } from "./lib/stability-metrics.mjs";
import { authenticateOutcomeHistorySnapshots } from "./nightly-self-improve.mjs";
import { VERDICT_SCHEMA_VERSION } from "./soak-assert.mjs";
import { SOAK_SCHEMA_VERSION } from "./soak-collect.mjs";

const NOW = Date.parse("2026-07-24T09:00:00.000Z");

function fixtureTaskManifest(revision = 1) {
  return {
    schemaVersion: 1,
    revision,
    updatedAt: "2026-07-24T08:00:00.000Z",
    tasks: [
      {
        schemaVersion: 1,
        taskId: "github-issue-1107",
        state: "approved_for_pr",
        revision: 3,
        behavioral: false,
        observerAuthority: "merge-safe",
        providerAuthority: "forbidden",
        createdAt: "2026-07-24T07:10:15.153Z",
        updatedAt: "2026-07-24T07:11:10.608Z",
        details: {
          behavioral: false,
          estimatedMinutes: 120,
          githubIssue: {
            number: 1107,
            url: "https://github.com/freed-project/freed/issues/1107",
          },
        },
      },
    ],
  };
}

function writeFixtureState() {
  const stateRoot = realpathSync(
    mkdtempSync(path.join(os.tmpdir(), "freed-stability-status-")),
  );
  const control = path.join(stateRoot, "control");
  mkdirSync(path.join(control, "task-transactions", ".authority-retirements"), {
    recursive: true,
    mode: 0o700,
  });
  writeFileSync(
    path.join(control, "current-tasks.json"),
    `${JSON.stringify(fixtureTaskManifest(), null, 2)}\n`,
    { mode: 0o600 },
  );
  writeFileSync(path.join(stateRoot, "outcomes.jsonl"), "", { mode: 0o600 });
  writeFileSync(path.join(control, "events.jsonl"), "", { mode: 0o600 });
  for (const directory of [
    path.join(control, "leases"),
    path.join(stateRoot, "artifacts"),
    path.join(stateRoot, "soaks"),
    path.join(stateRoot, "host"),
    path.join(stateRoot, "app"),
    path.join(stateRoot, "provider"),
  ]) {
    mkdirSync(directory, { recursive: true, mode: 0o700 });
  }
  chmodSync(control, 0o700);
  return stateRoot;
}

function fixedReaders() {
  return {
    repository: () => ({
      health: "healthy",
      root: "/machine-specific/worktree",
      commitSha: "a".repeat(40),
      branch: "feat/status",
      detached: false,
      dirty: false,
      originUrl: "https://github.com/freed-project/freed.git",
    }),
    actorBindings: () => ({
      health: "healthy",
      checkedCount: 5,
      matchedCount: 5,
      actors: [],
      drift: [],
    }),
    soak: () => ({
      model: {
        health: "unavailable",
        maturity: "unavailable",
        soakId: null,
        startedAt: null,
        stoppedAt: null,
        verdict: null,
      },
      directory: null,
    }),
    runtime: () => ({ health: "unavailable", identity: null }),
    outcomes: () => ({
      health: "healthy",
      entryCount: 0,
      canonicalCount: 0,
      legacyCount: 0,
      malformedCount: 0,
      sourceDigest: createHash("sha256").update("").digest("hex"),
      latest: null,
      canonicalEntries: [],
      pendingOutcomeTransitions: [],
    }),
    artifacts: ({ artifactRoot }) => ({
      schemaVersion: 1,
      health: "unavailable",
      root: artifactRoot,
      counts: { valid: 0, stale: 0, malformed: 0, unsupported: 0 },
      records: [],
    }),
  };
}

function snapshotTree(root) {
  const rows = [];
  function digestFile(target) {
    const descriptor = openSync(
      target,
      constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0),
    );
    try {
      const stats = fstatSync(descriptor);
      assert.equal(stats.isFile(), true);
      return createHash("sha256")
        .update(readFileSync(descriptor))
        .digest("hex");
    } finally {
      closeSync(descriptor);
    }
  }
  function visit(directory) {
    for (const name of readdirSync(directory).sort()) {
      const target = path.join(directory, name);
      const stats = lstatSync(target);
      const relative = path.relative(root, target);
      if (stats.isDirectory()) {
        rows.push({
          path: relative,
          type: "directory",
          mode: stats.mode,
          mtimeMs: stats.mtimeMs,
        });
        visit(target);
      } else {
        rows.push({
          path: relative,
          type: "file",
          mode: stats.mode,
          mtimeMs: stats.mtimeMs,
          digest: digestFile(target),
        });
      }
    }
  }
  visit(root);
  return rows;
}

test("stability status is repeatable, read-only, and changes when classified input changes", () => {
  const stateRoot = writeFixtureState();
  const readers = fixedReaders();
  const before = snapshotTree(stateRoot);
  const first = buildStabilityStatus({
    repoRoot: process.cwd(),
    stateRoot,
    nowMs: NOW,
    readers,
  });
  const second = buildStabilityStatus({
    repoRoot: process.cwd(),
    stateRoot,
    nowMs: NOW + 1_000,
    readers,
  });
  const after = snapshotTree(stateRoot);

  assert.equal(first.stableDigest, second.stableDigest);
  assert.notEqual(first.observedAt, second.observedAt);
  assert.deepEqual(after, before);
  assert.equal(
    first.nextAction.id,
    "implement_selected_task",
    first.control.reason,
  );
  assert.equal(first.nextAction.taskId, "github-issue-1107");
  assert.match(formatStabilityStatus(first), /Stable digest: [0-9a-f]{64}/);

  writeFileSync(
    path.join(stateRoot, "control", "current-tasks.json"),
    `${JSON.stringify(fixtureTaskManifest(2), null, 2)}\n`,
    { mode: 0o600 },
  );
  const changed = buildStabilityStatus({
    repoRoot: process.cwd(),
    stateRoot,
    nowMs: NOW,
    readers,
  });
  assert.notEqual(changed.stableDigest, first.stableDigest);
});

test("repository status invokes local git readers only", () => {
  const calls = [];
  const outputs = new Map([
    ["rev-parse HEAD", `${"b".repeat(40)}\n`],
    ["rev-parse --show-toplevel", "/repo\n"],
    ["symbolic-ref --quiet --short HEAD", "dev\n"],
    [
      "config --get remote.origin.url",
      "https://github.com/freed-project/freed.git\n",
    ],
    ["status --porcelain=v1 --untracked-files=normal", ""],
  ]);
  const status = readRepositoryStatus({
    repoRoot: "/repo",
    execFile(command, args, options) {
      calls.push({ command, args, options });
      return outputs.get(args.slice(4).join(" "));
    },
  });

  assert.equal(status.health, "healthy");
  assert.equal(status.commitSha, "b".repeat(40));
  assert.ok(calls.every((call) => call.command === "git"));
  assert.ok(
    calls.every(
      (call) =>
        call.args.slice(0, 4).join(" ") ===
          "-c core.fsmonitor=false -c core.untrackedCache=false" &&
        call.options.env.GIT_OPTIONAL_LOCKS === "0" &&
        call.options.env.GIT_CONFIG_NOSYSTEM === "1" &&
        call.options.env.GIT_CONFIG_GLOBAL === "/dev/null",
    ),
  );
  assert.ok(
    calls.every(
      (call) =>
        !call.args.some((argument) =>
          /fetch|pull|push|ls-remote|https?:/i.test(argument),
        ),
    ),
  );
});

test("control status rejects a world-writable task manifest", () => {
  const stateRoot = writeFixtureState();
  chmodSync(path.join(stateRoot, "control", "current-tasks.json"), 0o666);

  const status = readControlStatus({ stateRoot });

  assert.equal(status.health, "malformed");
  assert.match(status.reason, /admitted safely|private mode|unsafe/i);
});

test("shape-correct forged outcomes are rejected without matching control history", () => {
  const stateRoot = writeFixtureState();
  const forged = {
    schemaVersion: 3,
    id: "forged-installed",
    kind: "stability",
    taskId: "behavior-task",
    outcome: "installed",
    ts: "2026-07-24T08:00:00.000Z",
    build: "26.7.2300",
    buildIdentity: {
      version: "26.7.2300",
      commitSha: "a".repeat(40),
      channel: "production",
    },
    authentication: {
      actor: "freed-nightly-runner",
      leaseName: "nightly-writer",
      taskRevision: 6,
      controlEventId: "forged-control-event",
      transitionEventId: "forged-transition-event",
      outcomeDigest: "b".repeat(64),
    },
  };
  const result = authenticateOutcomeHistorySnapshots({
    stateRoot,
    ledgerPath: path.join(stateRoot, "outcomes.jsonl"),
    ledgerText: `${JSON.stringify(forged)}\n`,
    eventHistoryText: "",
    leaseTransactionHistory: {
      healthy: true,
      issues: [],
      retainedReceiptCount: 0,
      pendingTransactionArtifactCount: 0,
    },
  });
  assert.equal(result.health, "malformed");
  assert.equal(result.trustedEntries.length, 0);
  assert.equal(result.rejectedEntries.length, 1);
});

test("next action permits only the exact nonbehavioral status repair under stale outcomes", () => {
  const issue = {
    number: 1107,
    url: "https://github.com/freed-project/freed/issues/1107",
  };
  const statusTask = {
    taskId: "github-issue-1107",
    state: "implemented",
    revision: 4,
    behavioral: false,
    providerAuthority: "forbidden",
    details: { behavioral: false, githubIssue: issue },
  };
  const behavioralMerged = {
    taskId: "authenticated-essay-capture-pr-642",
    state: "merged",
    revision: 6,
    behavioral: true,
    providerAuthority: "forbidden",
    details: { behavioral: true },
  };
  const model = {
    control: {
      health: "healthy",
      tasks: [statusTask, behavioralMerged],
    },
    outcomes: { health: "stale" },
    behaviorSlot: {
      status: "outcome-history-unhealthy",
      authorizedTaskId: null,
      activeTasks: [behavioralMerged],
    },
    artifacts: { health: "healthy" },
    actorBindings: { health: "healthy" },
  };
  assert.equal(deriveStabilityNextAction(model).id, "validate_selected_task");
  const afterStatusMerge = structuredClone(model);
  afterStatusMerge.control.tasks = [behavioralMerged];
  const repair = deriveStabilityNextAction(afterStatusMerge);
  assert.equal(repair.id, "repair_outcome_ledger");
  assert.match(repair.reason, /outcome-ledger\.repair/);
  assert.match(repair.reason, /separately approve/);
});

test("authority failures block behavioral and provider-visible action advice", () => {
  const behavioralTask = {
    taskId: "github-issue-1200",
    state: "implemented",
    revision: 2,
    behavioral: true,
    providerAuthority: "forbidden",
    details: {
      behavioral: true,
      githubIssue: {
        number: 1200,
        url: "https://github.com/freed-project/freed/issues/1200",
      },
    },
  };
  const base = {
    control: { health: "healthy", tasks: [behavioralTask] },
    outcomes: { health: "healthy" },
    behaviorSlot: {
      status: "reserved",
      authorizedTaskId: behavioralTask.taskId,
      activeTasks: [behavioralTask],
    },
    artifacts: { health: "healthy" },
    actorBindings: { health: "healthy" },
  };
  for (const health of ["stale", "malformed"]) {
    const unhealthyControl = structuredClone(base);
    unhealthyControl.control.health = health;
    assert.equal(
      deriveStabilityNextAction(unhealthyControl).id,
      "repair_control_state",
    );
  }
  const forgedOutcome = structuredClone(base);
  forgedOutcome.outcomes.health = "malformed";
  assert.equal(
    deriveStabilityNextAction(forgedOutcome).id,
    "repair_outcome_ledger",
  );
  const wrongReservation = structuredClone(base);
  wrongReservation.behaviorSlot.authorizedTaskId = "another-task";
  assert.equal(
    deriveStabilityNextAction(wrongReservation).id,
    "repair_behavior_authority",
  );
});

test("runtime identity rejects future, blank, and mixed unattributed evidence", () => {
  const soakDirectory = realpathSync(
    mkdtempSync(path.join(os.tmpdir(), "freed-runtime-status-")),
  );
  const runtimePath = path.join(soakDirectory, "runtime-health.jsonl");
  const tagged = {
    tsMs: NOW - 1_000,
    appVersion: "26.7.2300",
    buildCommitSha: "a".repeat(40),
    channel: "production",
    buildKind: "release",
    appSessionId: "session-1",
  };
  writeFileSync(
    runtimePath,
    `${JSON.stringify(tagged)}\n${JSON.stringify({
      tsMs: NOW,
      type: "native_runtime_memory_sample",
    })}\n`,
  );
  const mixed = readRuntimeStatus({ soakDirectory, nowMs: NOW });
  assert.equal(mixed.health, "malformed");
  assert.equal(mixed.unattributedCount, 1);

  writeFileSync(
    runtimePath,
    `${JSON.stringify({
      ...tagged,
      tsMs: NOW + 10 * 60 * 1_000,
      appSessionId: "",
    })}\n`,
  );
  assert.equal(
    readRuntimeStatus({ soakDirectory, nowMs: NOW }).health,
    "malformed",
  );

  writeFileSync(
    runtimePath,
    `${JSON.stringify(tagged)}\n${JSON.stringify({
      ...tagged,
      tsMs: NOW,
      buildCommitSha: "b".repeat(40),
      appSessionId: "session-2",
    })}\n`,
  );
  const mixedBuild = readRuntimeStatus({ soakDirectory, nowMs: NOW });
  assert.equal(mixedBuild.health, "malformed");
  assert.match(mixedBuild.reason, /multiple build identities/);
});

test(
  "runtime status rejects a FIFO without blocking",
  { skip: process.platform === "win32" },
  () => {
    const soakDirectory = realpathSync(
      mkdtempSync(path.join(os.tmpdir(), "freed-runtime-fifo-")),
    );
    execFileSync("mkfifo", [path.join(soakDirectory, "runtime-health.jsonl")]);
    const moduleUrl = pathToFileURL(
      path.join(process.cwd(), "scripts", "lib", "stability-status.mjs"),
    ).href;
    const probe = spawnSync(
      process.execPath,
      [
        "--input-type=module",
        "-e",
        `import { readRuntimeStatus } from ${JSON.stringify(moduleUrl)};
process.stdout.write(JSON.stringify(readRuntimeStatus({
  soakDirectory: ${JSON.stringify(soakDirectory)},
  nowMs: ${NOW}
})));`,
      ],
      {
        encoding: "utf8",
        timeout: 2_000,
      },
    );

    assert.equal(probe.error, undefined);
    assert.equal(probe.status, 0, probe.stderr);
    assert.equal(JSON.parse(probe.stdout).health, "malformed");
  },
);

test("soak status rejects unsupported soak, verdict, and metric schemas", () => {
  const stateRoot = writeFixtureState();
  const soakDirectory = path.join(stateRoot, "soaks", "schema-check");
  mkdirSync(soakDirectory, { recursive: true, mode: 0o700 });
  writeFileSync(
    path.join(stateRoot, "current-soak-dir"),
    `${soakDirectory}\n`,
    { mode: 0o600 },
  );
  const writeInfo = (schemaVersion) =>
    writeFileSync(
      path.join(soakDirectory, "soak-info.json"),
      `${JSON.stringify({
        schemaVersion,
        startedAt: "2026-07-24T08:00:00.000Z",
      })}\n`,
      { mode: 0o600 },
    );
  const writeVerdict = ({ schemaVersion, metricRegistryVersion }) =>
    writeFileSync(
      path.join(soakDirectory, "soak-verdict.json"),
      `${JSON.stringify({
        schemaVersion,
        metricRegistryVersion,
        generatedAt: "2026-07-24T08:30:00.000Z",
        status: "pass",
      })}\n`,
      { mode: 0o600 },
    );

  writeInfo(999);
  writeVerdict({
    schemaVersion: VERDICT_SCHEMA_VERSION,
    metricRegistryVersion: STABILITY_METRIC_REGISTRY_VERSION,
  });
  assert.equal(
    readSoakStatus({ stateRoot, nowMs: NOW }).model.health,
    "malformed",
  );

  writeInfo(SOAK_SCHEMA_VERSION);
  writeVerdict({
    schemaVersion: 999,
    metricRegistryVersion: STABILITY_METRIC_REGISTRY_VERSION,
  });
  assert.equal(
    readSoakStatus({ stateRoot, nowMs: NOW }).model.health,
    "malformed",
  );

  writeVerdict({
    schemaVersion: VERDICT_SCHEMA_VERSION,
    metricRegistryVersion: 999,
  });
  assert.equal(
    readSoakStatus({ stateRoot, nowMs: NOW }).model.health,
    "malformed",
  );

  writeVerdict({
    schemaVersion: VERDICT_SCHEMA_VERSION,
    metricRegistryVersion: STABILITY_METRIC_REGISTRY_VERSION,
  });
  const valid = readSoakStatus({ stateRoot, nowMs: NOW }).model;
  assert.equal(valid.health, "healthy");
  assert.equal(valid.maturity, "verdict-ready");
});

test("observation time and machine paths do not affect the stable digest", () => {
  const stateRoot = writeFixtureState();
  const firstReaders = fixedReaders();
  const secondReaders = fixedReaders();
  secondReaders.repository = () => ({
    ...firstReaders.repository(),
    root: "/another/machine/worktree",
  });
  secondReaders.artifacts = () => ({
    schemaVersion: 1,
    health: "unavailable",
    root: "/another/machine/artifacts",
    counts: { valid: 0, stale: 0, malformed: 0, unsupported: 0 },
    records: [],
  });
  firstReaders.runtime = () => ({
    health: "healthy",
    identity: {
      version: "26.7.2300",
      commitSha: "a".repeat(40),
      channel: "production",
      buildKind: "release",
      nativeBootId: "machine-one",
      appSessionId: "session-one",
      observedAt: "2026-07-24T08:00:00.000Z",
    },
  });
  secondReaders.runtime = () => ({
    health: "healthy",
    identity: {
      ...firstReaders.runtime().identity,
      nativeBootId: "machine-two",
      appSessionId: "session-two",
      observedAt: "2026-07-24T08:30:00.000Z",
    },
    reason: "/another/machine/runtime-health.jsonl",
  });
  const first = buildStabilityStatus({
    repoRoot: process.cwd(),
    stateRoot,
    nowMs: NOW,
    readers: firstReaders,
  });
  const second = buildStabilityStatus({
    repoRoot: process.cwd(),
    stateRoot,
    nowMs: NOW + 60_000,
    readers: secondReaders,
  });
  assert.equal(first.stableDigest, second.stableDigest);
});

test("two real CLI runs leave repository and automation surfaces unchanged without network Git", () => {
  const stateRoot = writeFixtureState();
  const wrapperRoot = realpathSync(
    mkdtempSync(path.join(os.tmpdir(), "freed-status-git-wrapper-")),
  );
  const logPath = path.join(wrapperRoot, "git-calls.jsonl");
  const wrapperPath = path.join(wrapperRoot, "git");
  const realGit = execFileSync("which", ["git"], { encoding: "utf8" }).trim();
  writeFileSync(
    wrapperPath,
    `#!/usr/bin/env node
import { appendFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
const args = process.argv.slice(2);
appendFileSync(process.env.GIT_AUDIT_LOG, JSON.stringify({
  args,
  optionalLocks: process.env.GIT_OPTIONAL_LOCKS,
  noSystem: process.env.GIT_CONFIG_NOSYSTEM,
  globalConfig: process.env.GIT_CONFIG_GLOBAL
}) + "\\n");
const output = execFileSync(process.env.REAL_GIT, args, {
  encoding: "buffer",
  env: process.env,
  stdio: ["ignore", "pipe", "inherit"]
});
process.stdout.write(output);
`,
    { mode: 0o700 },
  );
  const gitFiles = [".git/HEAD", ".git/config", ".git/index", ".git/FETCH_HEAD"]
    .map((relative) => path.join(process.cwd(), relative))
    .filter((target) => {
      try {
        return lstatSync(target).isFile();
      } catch {
        return false;
      }
    });
  const inventory = () => ({
    repository: gitFiles.map((target) => ({
      path: path.relative(process.cwd(), target),
      digest: createHash("sha256").update(readFileSync(target)).digest("hex"),
      mtimeMs: lstatSync(target).mtimeMs,
    })),
    automation: snapshotTree(stateRoot),
  });
  const before = inventory();
  const env = {
    ...process.env,
    PATH: `${wrapperRoot}${path.delimiter}${process.env.PATH}`,
    REAL_GIT: realGit,
    GIT_AUDIT_LOG: logPath,
  };
  const args = [
    path.join(process.cwd(), "scripts", "stability-status.mjs"),
    "--json",
    "--repo-root",
    process.cwd(),
    "--state-root",
    stateRoot,
    "--now",
    new Date(NOW).toISOString(),
  ];
  const first = JSON.parse(
    execFileSync(process.execPath, args, { encoding: "utf8", env }),
  );
  const second = JSON.parse(
    execFileSync(process.execPath, args, { encoding: "utf8", env }),
  );
  assert.equal(first.stableDigest, second.stableDigest);
  assert.deepEqual(inventory(), before);
  const calls = readFileSync(logPath, "utf8")
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
  assert.ok(calls.length > 0);
  for (const call of calls) {
    assert.equal(call.optionalLocks, "0");
    assert.equal(call.noSystem, "1");
    assert.equal(call.globalConfig, "/dev/null");
    assert.equal(
      call.args.some((argument) =>
        /fetch|pull|push|ls-remote|https?:/i.test(argument),
      ),
      false,
    );
  }
});
