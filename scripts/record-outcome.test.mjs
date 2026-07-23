import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import {
  acquireLease,
  AUTOMATION_ACTOR_POLICIES,
  automationControlPaths,
  createTask,
  readTask,
  transitionTask,
} from "./lib/automation-control.mjs";
import { parseArgs } from "./record-outcome.mjs";
import {
  appendOutcomeLedger,
  resolveStatePathWithLegacyFallback,
} from "./nightly-self-improve.mjs";
import { writeMeasuredOutcomeVerdict } from "./test-helpers/outcome-evidence.mjs";
import { installAutomationKernelGuardCutoverFixture } from "./test-helpers/automation-kernel-guard.mjs";
import { acquireGeneralActorLeaseForTest } from "./test-helpers/trusted-actor-lease.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CLI_PATH = path.join(__dirname, "record-outcome.mjs");
let ownerConfirmationSequence = 0;
let leaseMutationSequence = 0;

function leaseMutationId(label) {
  leaseMutationSequence += 1;
  return createHash("sha256")
    .update(`${label}:${leaseMutationSequence}`)
    .digest("hex");
}

function acquireActorLease(stateRoot, actor) {
  installAutomationKernelGuardCutoverFixture(stateRoot);
  const policy = AUTOMATION_ACTOR_POLICIES[actor];
  const token = `${actor}-lease-token`;
  const controlRoot = path.join(stateRoot, "control");
  mkdirSync(controlRoot, { recursive: true, mode: 0o700 });
  chmodSync(controlRoot, 0o700);
  acquireGeneralActorLeaseForTest({
    stateRoot,
    name: policy.leaseName,
    owner: actor,
    operationId: leaseMutationId(`acquire:${actor}`),
    token,
    ttlMs: policy.maxLeaseLifetimeMs,
  });
  return { actor, leaseName: policy.leaseName, leaseToken: token };
}

function acquireOwnerPlanLease(stateRoot, plan, nowMs = Date.now()) {
  installAutomationKernelGuardCutoverFixture(stateRoot);
  ownerConfirmationSequence += 1;
  const confirmationId = `record-outcome-owner-${ownerConfirmationSequence}`;
  const confirmationPath = path.join(stateRoot, `${confirmationId}.json`);
  writeFileSync(
    confirmationPath,
    `${JSON.stringify({
      schemaVersion: 1,
      kind: "owner-confirmation",
      confirmationId,
      approvedBy: "AubreyF",
      ownerApprovalReference:
        "Owner approved this exact isolated outcome record test intent.",
      approvalSource: { kind: "current-task", reference: plan.taskId },
      taskId: plan.taskId,
      intent: plan.intent,
      intentDigest: plan.intentDigest,
      approvedAt: new Date(nowMs).toISOString(),
      expiresAt: new Date(nowMs + 10 * 60_000).toISOString(),
    })}\n`,
    { mode: 0o600 },
  );
  const acquired = acquireLease({
    stateRoot,
    name: "owner-governance",
    owner: "freed-owner",
    operationId: leaseMutationId("acquire:freed-owner"),
    token: `record-outcome-owner-token-${"x".repeat(64)}`,
    ttlMs: 5 * 60_000,
    nowMs: nowMs + 1,
    ownerConfirmationFile: confirmationPath,
    ownerCapabilityTaskId: plan.taskId,
    ownerCapabilityIntentDigest: plan.intentDigest,
  });
  return acquired.lease.token;
}

function prepareValidatedTask(stateRoot, taskId) {
  const controller = acquireActorLease(stateRoot, "freed-stability-controller");
  const nightly = acquireActorLease(stateRoot, "freed-nightly-runner");
  const nowMs = Date.now() + 1_000;
  createTask({
    stateRoot,
    taskId,
    ...controller,
    observerAuthority: "merge-safe",
    providerAuthority: "forbidden",
    details: { behavioral: false },
    nowMs,
  });
  for (const [index, [toState, authentication]] of [
    ["triaged", controller],
    ["approved_for_pr", controller],
    ["implemented", nightly],
    ["validated", nightly],
  ].entries()) {
    transitionTask({
      stateRoot,
      taskId,
      toState,
      ...authentication,
      nowMs: nowMs + (index + 1) * 1_000,
    });
  }
  return automationControlPaths(stateRoot);
}

function prepareLiveMergedOutcomeBackfillFixture(stateRoot) {
  installAutomationKernelGuardCutoverFixture(stateRoot);
  const paths = automationControlPaths(stateRoot);
  mkdirSync(paths.controlRoot, { recursive: true, mode: 0o700 });
  chmodSync(paths.controlRoot, 0o700);
  const taskId = "authenticated-essay-capture-pr-642";
  const historyBytes = readFileSync(
    path.join(
      __dirname,
      "fixtures",
      "legacy-control-event-history.jsonl",
    ),
  );
  const history = historyBytes
    .toString("utf8")
    .trimEnd()
    .split("\n")
    .map((line) => JSON.parse(line));
  const historicalEvent = history.find(
    (event) =>
      event.eventId === "37db3aa0-7a37-4341-a13c-5bfe6485f393" &&
      event.taskId === taskId,
  );
  assert.ok(historicalEvent);
  const observedEvent = history.find(
    (event) =>
      event.type === "task_created" &&
      event.taskId === "sync-health-youtube-attempt-divergence",
  );
  assert.ok(observedEvent);
  const mergedAt = historicalEvent.ts;
  const providerApprovalReference =
    "sha256:b89bcf1c2c9aaa6277618451cc9329d4689da038deb6e94f6776eccea5bd4ab9";
  const task = {
    schemaVersion: 1,
    taskId,
    state: "merged",
    revision: 6,
    behavioral: true,
    observerAuthority: "merge-safe",
    providerAuthority: "approved",
    providerApprovalReference,
    createdAt: "2026-07-14T21:56:06.121Z",
    updatedAt: mergedAt,
    details: {
      behavioral: true,
      metricId: "renderer-recovery-count",
      feature: "Authenticated Substack and Medium capture",
      featurePullRequest: "https://github.com/freed-project/freed/pull/642",
      liveProviderTrafficAuthorized: false,
      soakMode: "offline-installed-build",
    },
    mergedAt,
  };
  const observedTask = {
    schemaVersion: 1,
    taskId: observedEvent.taskId,
    state: "observed",
    revision: 1,
    behavioral: false,
    observerAuthority: "observe-only",
    providerAuthority: "forbidden",
    createdAt: observedEvent.ts,
    updatedAt: observedEvent.ts,
    details: { behavioral: false },
  };
  writeFileSync(
    paths.taskManifest,
    `${JSON.stringify({
      schemaVersion: 1,
      revision: 7,
      updatedAt: mergedAt,
      tasks: [observedTask, task],
    })}\n`,
    { mode: 0o600 },
  );
  writeFileSync(paths.events, historyBytes, {
    mode: 0o600,
  });
  return { historicalEvent, task, taskId, paths };
}

function prepareSoakingTask(stateRoot, taskId, build = "v26.7.203-dev") {
  const evidenceWindowMs = 6 * 60 * 60_000;
  const realDateNow = Date.now;
  let eventNowMs = realDateNow() - evidenceWindowMs - 60_000;
  Date.now = () => eventNowMs;
  try {
    const controller = acquireActorLease(
      stateRoot,
      "freed-stability-controller",
    );
    eventNowMs += 100;
    const nightly = acquireActorLease(stateRoot, "freed-nightly-runner");
    eventNowMs += 900;
    createTask({
      stateRoot,
      taskId,
      ...controller,
      observerAuthority: "merge-safe",
      providerAuthority: "forbidden",
      details: { behavioral: true },
      nowMs: eventNowMs,
    });
    for (const [state, authentication] of [
      ["triaged", controller],
      ["approved_for_pr", controller],
      ["implemented", nightly],
      ["validated", nightly],
    ]) {
      eventNowMs += 1_000;
      transitionTask({
        stateRoot,
        taskId,
        toState: state,
        ...authentication,
        nowMs: eventNowMs,
      });
    }
    const ledger = automationControlPaths(stateRoot).outcomes;
    appendOutcomeLedger(
      ledger,
      {
        id: taskId,
        taskId,
        kind: "task",
        outcome: "merged",
        evidenceDigest: "1".repeat(64),
      },
      {
        stateRoot,
        authentication: nightly,
        now: new Date((eventNowMs += 1_000)),
      },
    );
    appendOutcomeLedger(
      ledger,
      {
        id: taskId,
        taskId,
        kind: "task",
        outcome: "installed",
        installedIdentity: {
          version: build.replace(/^v/i, ""),
          commitSha: "a".repeat(40),
          channel: "dev",
        },
        evidenceDigest: "2".repeat(64),
      },
      {
        stateRoot,
        authentication: nightly,
        now: new Date((eventNowMs += 1_000)),
      },
    );
    eventNowMs += 1_000;
    transitionTask({
      stateRoot,
      taskId,
      toState: "soaking",
      ...nightly,
      nowMs: eventNowMs,
    });
    const task = readTask({ stateRoot, taskId });
    const sourceStartMs = Date.parse(task.soakStartedAt);
    return {
      evidenceWindowEnd: new Date(
        sourceStartMs + evidenceWindowMs,
      ).toISOString(),
      sourceStartMs,
    };
  } finally {
    Date.now = realDateNow;
  }
}

function writeVerdict(dir, { taskId, build, windowEnd, sourceStartMs }) {
  return writeMeasuredOutcomeVerdict(dir, {
    taskId,
    version: build.replace(/^v/i, ""),
    commitSha: "a".repeat(40),
    windowEnd,
    sourceStartMs,
    before: 30,
    after: 4,
  }).verdictPath;
}

function authenticationArgs(stateRoot, authentication, verdictPath) {
  return [
    "--state-root",
    stateRoot,
    "--actor",
    authentication.actor,
    "--lease-name",
    authentication.leaseName,
    "--verdict-reference",
    verdictPath,
  ];
}

test("resolveStatePathWithLegacyFallback prefers an existing new-location file", () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "freed-state-fallback-"));
  const preferred = path.join(dir, "new", "outcomes.jsonl");
  const legacy = path.join(dir, "legacy", "outcomes.jsonl");
  writeFileSync(path.join(dir, "new-file"), "");
  const newPath = path.join(dir, "new-file");
  assert.equal(resolveStatePathWithLegacyFallback(newPath, legacy), newPath);
  assert.equal(
    resolveStatePathWithLegacyFallback(preferred, legacy),
    preferred,
  );
});

test("resolveStatePathWithLegacyFallback migrates legacy state to the new location", () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "freed-state-migrate-"));
  const preferred = path.join(dir, "new", "outcomes.jsonl");
  const legacy = path.join(dir, "legacy-outcomes.jsonl");
  writeFileSync(legacy, '{"id":"old","kind":"task","outcome":"shipped"}\n');

  const resolved = resolveStatePathWithLegacyFallback(preferred, legacy);

  assert.equal(resolved, preferred);
  assert.ok(existsSync(preferred));
  assert.match(readFileSync(preferred, "utf8"), /"id":"old"/);
});

test("resolveStatePathWithLegacyFallback keeps the legacy path when migration fails", () => {
  const failingOps = {
    existsSync: (p) => p === "/legacy/outcomes.jsonl",
    mkdirSync: () => {
      throw new Error("read-only");
    },
    copyFileSync: () => {
      throw new Error("read-only");
    },
  };
  assert.equal(
    resolveStatePathWithLegacyFallback(
      "/new/outcomes.jsonl",
      "/legacy/outcomes.jsonl",
      failingOps,
    ),
    "/legacy/outcomes.jsonl",
  );
});

test("record-outcome parseArgs requires an id and applies defaults", () => {
  const directEnv = { FREED_AUTOMATION_LEASE_TOKEN: "token" };
  assert.throws(() => parseArgs([]), /--id is required/);
  assert.throws(
    () => parseArgs(["--id", "W1-01", "--pr", "897"]),
    /requires --actor, --lease-name, and FREED_AUTOMATION_LEASE_TOKEN/,
  );
  const args = parseArgs(
    [
      "--id",
      "W1-01",
      "--pr",
      "897",
      "--actor",
      "freed-nightly-runner",
      "--lease-name",
      "nightly-writer",
      "--evidence-digest",
      "a".repeat(64),
    ],
    directEnv,
  );
  assert.equal(args.kind, "task");
  assert.equal(args.taskId, "W1-01");
  assert.equal(args.status, "merged");
  assert.equal(args.pr, "897");
  assert.ok(args.ledger.includes(path.join(".freed", "automation")));
  const customStateRoot = path.join(os.tmpdir(), "freed-custom-outcome-state");
  const custom = parseArgs(
    [
      "--id",
      "W1-02",
      "--state-root",
      customStateRoot,
      "--actor",
      "freed-nightly-runner",
      "--lease-name",
      "nightly-writer",
      "--evidence-digest",
      "b".repeat(64),
    ],
    directEnv,
  );
  assert.equal(custom.ledger, path.join(customStateRoot, "outcomes.jsonl"));
  assert.throws(
    () =>
      parseArgs(
        [
          "--id",
          "W1-02",
          "--state-root",
          customStateRoot,
          "--ledger",
          path.join(customStateRoot, "alternate.jsonl"),
          "--actor",
          "freed-nightly-runner",
          "--lease-name",
          "nightly-writer",
          "--evidence-digest",
          "b".repeat(64),
        ],
        directEnv,
      ),
    /canonical state-root ledger/,
  );
  assert.throws(
    () => parseArgs(["--id", "W1-01", "--lease-token", "secret"]),
    /--lease-token is forbidden/,
  );
  assert.throws(
    () =>
      parseArgs([
        "apply",
        "--plan",
        "/private/tmp/outcome-plan.json",
        "--lease-token",
        "secret",
      ]),
    /--lease-token is forbidden/,
  );
  assert.throws(
    () =>
      parseArgs(
        [
          "--id",
          "W1-01",
          "--actor",
          "freed-owner",
          "--lease-name",
          "owner-governance",
          "--evidence-digest",
          "a".repeat(64),
        ],
        directEnv,
      ),
    /requires the plan and apply commands/,
  );
  assert.throws(() => parseArgs(["--id", "x", "--bogus"]), /Unknown argument/);
});

test("record-outcome requires complete installed build identity", () => {
  const directEnv = { FREED_AUTOMATION_LEASE_TOKEN: "token" };
  const authentication = [
    "--actor",
    "freed-nightly-runner",
    "--lease-name",
    "nightly-writer",
    "--evidence-digest",
    "a".repeat(64),
  ];
  assert.throws(
    () =>
      parseArgs(
        [
          "--id",
          "P1-01",
          "--status",
          "installed",
          "--build",
          "26.7.100-dev",
          ...authentication,
        ],
        directEnv,
      ),
    /require --build, --build-commit-sha, and --build-channel/,
  );
  const args = parseArgs(
    [
      "--id",
      "P1-01",
      "--status",
      "installed",
      "--build",
      "26.7.100-dev",
      "--build-commit-sha",
      "b".repeat(40),
      "--build-channel",
      "dev",
      ...authentication,
    ],
    directEnv,
  );
  assert.equal(args.buildCommitSha, "b".repeat(40));
  assert.equal(args.buildChannel, "dev");
});

test("record-outcome owner plan is read-only and one exact lease applies it", () => {
  const stateRoot = realpathSync(
    mkdtempSync(path.join(os.tmpdir(), "freed-record-owner-plan-")),
  );
  const taskId = "owner-planned-merged-outcome";
  const paths = prepareValidatedTask(stateRoot, taskId);
  const beforePlan = {
    manifest: readFileSync(paths.taskManifest),
    events: readFileSync(paths.events),
    ledgerExists: existsSync(paths.outcomes),
  };
  const plan = JSON.parse(
    execFileSync(
      process.execPath,
      [
        CLI_PATH,
        "plan",
        "--id",
        taskId,
        "--task-id",
        taskId,
        "--kind",
        "stability",
        "--status",
        "merged",
        "--evidence-digest",
        "a".repeat(64),
        "--state-root",
        stateRoot,
      ],
      { encoding: "utf8" },
    ),
  );
  assert.equal(plan.intent.action, "outcome.record");
  assert.equal(plan.intent.parameters.route, "transition");
  assert.equal(plan.intent.parameters.sourceTaskState, "validated");
  assert.deepEqual(readFileSync(paths.taskManifest), beforePlan.manifest);
  assert.deepEqual(readFileSync(paths.events), beforePlan.events);
  assert.equal(existsSync(paths.outcomes), beforePlan.ledgerExists);

  const planPath = path.join(stateRoot, "owner-outcome-plan.json");
  writeFileSync(planPath, `${JSON.stringify(plan)}\n`, { mode: 0o600 });
  const leaseToken = acquireOwnerPlanLease(stateRoot, plan);
  const stdout = execFileSync(
    process.execPath,
    [CLI_PATH, "apply", "--plan", planPath],
    {
      encoding: "utf8",
      env: { ...process.env, FREED_AUTOMATION_LEASE_TOKEN: leaseToken },
    },
  );
  assert.match(stdout, /Recorded merged outcome/);
  const task = readTask({ stateRoot, taskId });
  assert.equal(task.state, "merged");
  assert.equal(task.revision, plan.intent.parameters.sourceTaskRevision + 1);
  assert.equal(task.pendingOutcome, undefined);
  const entries = readFileSync(paths.outcomes, "utf8")
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
  assert.equal(entries.length, 1);
  assert.equal(entries[0].authentication.actor, "freed-owner");
  assert.equal(entries[0].authentication.leaseName, "owner-governance");
});

test("record-outcome apply rejects nonprivate and noncanonical plan files", () => {
  const stateRoot = realpathSync(
    mkdtempSync(path.join(os.tmpdir(), "freed-record-owner-plan-safe-")),
  );
  const taskId = "owner-plan-file-admission";
  const paths = prepareValidatedTask(stateRoot, taskId);
  const plan = execFileSync(
    process.execPath,
    [
      CLI_PATH,
      "plan",
      "--id",
      taskId,
      "--status",
      "merged",
      "--evidence-digest",
      "b".repeat(64),
      "--state-root",
      stateRoot,
    ],
    { encoding: "utf8" },
  );
  const before = {
    manifest: readFileSync(paths.taskManifest),
    events: readFileSync(paths.events),
    ledgerExists: existsSync(paths.outcomes),
  };
  const planPath = path.join(stateRoot, "unsafe-plan.json");
  writeFileSync(planPath, plan, { mode: 0o644 });
  const apply = (candidate) =>
    execFileSync(process.execPath, [CLI_PATH, "apply", "--plan", candidate], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, FREED_AUTOMATION_LEASE_TOKEN: "not-used" },
    });
  assert.throws(() => apply(planPath), /private 0600 regular file/);
  chmodSync(planPath, 0o600);
  const symlinkPath = path.join(stateRoot, "plan-link.json");
  symlinkSync(planPath, symlinkPath);
  assert.throws(() => apply(symlinkPath), /canonical|symlink/);
  assert.deepEqual(readFileSync(paths.taskManifest), before.manifest);
  assert.deepEqual(readFileSync(paths.events), before.events);
  assert.equal(existsSync(paths.outcomes), before.ledgerExists);
});

test("record-outcome owner apply backfills the exact live merged revision", () => {
  const stateRoot = realpathSync(
    mkdtempSync(path.join(os.tmpdir(), "freed-record-owner-backfill-")),
  );
  const fixture = prepareLiveMergedOutcomeBackfillFixture(stateRoot);
  const plan = JSON.parse(
    execFileSync(
      process.execPath,
      [
        CLI_PATH,
        "plan",
        "--id",
        fixture.taskId,
        "--task-id",
        fixture.taskId,
        "--kind",
        "stability",
        "--status",
        "merged",
        "--notes",
        "Authenticate the historical merged outcome.",
        "--evidence-digest",
        "c".repeat(64),
        "--state-root",
        stateRoot,
      ],
      { encoding: "utf8" },
    ),
  );
  assert.equal(plan.intent.parameters.route, "legacy-backfill");
  assert.equal(plan.intent.parameters.sourceTaskRevision, 6);
  assert.equal(
    plan.intent.parameters.legacyTransitionEventId,
    fixture.historicalEvent.eventId,
  );
  const planPath = path.join(stateRoot, "live-merged-backfill-plan.json");
  writeFileSync(planPath, `${JSON.stringify(plan)}\n`, { mode: 0o600 });
  const leaseToken = acquireOwnerPlanLease(stateRoot, plan);
  const applyOptions = {
    encoding: "utf8",
    env: { ...process.env, FREED_AUTOMATION_LEASE_TOKEN: leaseToken },
  };
  execFileSync(
    process.execPath,
    [CLI_PATH, "apply", "--plan", planPath],
    applyOptions,
  );
  const first = {
    manifest: readFileSync(fixture.paths.taskManifest),
    events: readFileSync(fixture.paths.events),
    ledger: readFileSync(fixture.paths.outcomes),
  };
  execFileSync(
    process.execPath,
    [CLI_PATH, "apply", "--plan", planPath],
    applyOptions,
  );
  assert.deepEqual(readFileSync(fixture.paths.taskManifest), first.manifest);
  assert.deepEqual(readFileSync(fixture.paths.events), first.events);
  assert.deepEqual(readFileSync(fixture.paths.outcomes), first.ledger);
  const task = readTask({ stateRoot, taskId: fixture.taskId });
  assert.equal(task.state, "merged");
  assert.equal(task.revision, 7);
  assert.equal(task.mergedAt, fixture.task.mergedAt);
  assert.equal(task.pendingOutcome, undefined);
  const events = first.events
    .toString("utf8")
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
  assert.deepEqual(
    events.find((event) => event.eventId === fixture.historicalEvent.eventId),
    fixture.historicalEvent,
  );
  assert.equal(
    events.filter(
      (event) =>
        event.type === "outcome_reservation_created" &&
        event.taskId === fixture.taskId,
    ).length,
    1,
  );
  const ledgerEntry = JSON.parse(first.ledger.toString("utf8").trim());
  assert.equal(ledgerEntry.outcome, "merged");
  assert.equal(ledgerEntry.authentication.actor, "freed-owner");
});

test("record-outcome CLI appends a ledger line at the given path", () => {
  const dir = realpathSync(
    mkdtempSync(path.join(os.tmpdir(), "freed-record-outcome-")),
  );
  const ledger = path.join(dir, "state", "outcomes.jsonl");
  const stateRoot = path.join(dir, "state");
  const { evidenceWindowEnd, sourceStartMs } = prepareSoakingTask(
    stateRoot,
    "W1-01",
  );
  const authentication = acquireActorLease(stateRoot, "freed-release-verifier");
  const verdictPath = writeVerdict(dir, {
    taskId: "W1-01",
    build: "v26.7.203-dev",
    windowEnd: evidenceWindowEnd,
    sourceStartMs,
  });

  const stdout = execFileSync(
    process.execPath,
    [
      CLI_PATH,
      "--id",
      "W1-01",
      "--task-id",
      "W1-01",
      "--kind",
      "task",
      "--status",
      "verified_effective",
      "--pr",
      "897",
      "--notes",
      "test entry",
      "--evidence-window-end",
      evidenceWindowEnd,
      "--ledger",
      ledger,
      ...authenticationArgs(stateRoot, authentication, verdictPath),
    ],
    {
      encoding: "utf8",
      env: {
        ...process.env,
        FREED_AUTOMATION_LEASE_TOKEN: authentication.leaseToken,
      },
    },
  );

  assert.match(stdout, /Recorded verified_effective outcome for W1-01/);
  const lines = readFileSync(ledger, "utf8")
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
  assert.equal(lines.length, 3);
  const entry = lines.find(
    (candidate) => candidate.outcome === "verified_effective",
  );
  assert.ok(entry);
  assert.equal(entry.id, "W1-01");
  assert.equal(entry.kind, "task");
  assert.equal(entry.schemaVersion, 3);
  assert.equal(entry.outcome, "verified_effective");
  assert.equal(entry.pr, "897");
  assert.equal(entry.build, "26.7.203-dev");
  assert.deepEqual(entry.buildIdentity, {
    version: "26.7.203-dev",
    commitSha: "a".repeat(40),
    channel: "dev",
  });
  assert.deepEqual(entry.effect, {
    metric: "main-footprint-slope",
    before: 30,
    after: 4,
    delta: -26,
    unit: "MB/sample-hour",
  });
  assert.equal(entry.evidenceWindowEnd, evidenceWindowEnd);
  assert.equal(entry.evidence.verdictReference, realpathSync(verdictPath));
  assert.equal(entry.authentication.actor, "freed-release-verifier");
  assert.ok(entry.ts);
});

test("record-outcome CLI rejects an invalid status", () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "freed-record-outcome-bad-"));
  const ledger = path.join(dir, "outcomes.jsonl");
  assert.throws(() =>
    execFileSync(
      process.execPath,
      [CLI_PATH, "--id", "x", "--status", "done", "--ledger", ledger],
      {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      },
    ),
  );
  assert.equal(existsSync(ledger), false);
});

test("record-outcome rejects caller-supplied effect measurements", () => {
  assert.throws(
    () => parseArgs(["--id", "x", "--metric", "rss", "--before", "10"]),
    /Unknown argument: --metric/,
  );
});

test("record-outcome rejects measured verification without attribution", () => {
  const dir = realpathSync(
    mkdtempSync(path.join(os.tmpdir(), "freed-record-outcome-unattributed-")),
  );
  const ledger = path.join(dir, "outcomes.jsonl");
  const authentication = acquireActorLease(dir, "freed-release-verifier");
  assert.throws(() =>
    execFileSync(
      process.execPath,
      [
        CLI_PATH,
        "--id",
        "x",
        "--status",
        "verified_effective",
        "--ledger",
        ledger,
        ...authenticationArgs(
          dir,
          authentication,
          path.join(dir, "missing-verdict.json"),
        ),
      ],
      {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
        env: {
          ...process.env,
          FREED_AUTOMATION_LEASE_TOKEN: authentication.leaseToken,
        },
      },
    ),
  );
  assert.equal(existsSync(ledger), false);
});
