import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  acquireLease,
  AUTOMATION_ACTOR_POLICIES,
  automationControlPaths,
  createTask,
  finalizeTaskOutcome,
  readTask,
  releaseLease,
  transitionTask,
  withMutationLeaseAuthority,
  withOutcomeRecordingGuards,
} from "./lib/automation-control.mjs";
import {
  assessSoakEvidenceQuality,
  applyOutcomeFeedback,
  appendOutcomeLedger,
  buildBehavioralTaskGate,
  buildCandidates,
  buildExecutionPlan,
  collectDuplicateWork,
  collectPeerWorktrees,
  collectRepoSnapshot,
  collectRiskSnapshot,
  DEFAULT_BEHAVIOR_SOAK_EXCLUSIVITY_KEY,
  deriveCandidatePrTitle,
  findLatestReadableSoakDir,
  findPendingOutcomeTransitions,
  formatBytes,
  loadTriageCandidates,
  main,
  parseArgs,
  parseGitWorktreePorcelain,
  parseTsv,
  planOutcomeRecord,
  planNightlyRun,
  repairSoakPointer,
  resolveReadableSoak,
  selectTargets,
  shouldRetainPeerWorktree,
  summarizePeerWorktree,
  summarizeOutcomeLedger,
  summarizeDailyBugMemory,
  summarizeSoak,
  runNightlyMachinePreflight,
  withOutcomeLedgerWriterLock,
  writeRunPlan,
} from "./nightly-self-improve.mjs";
import { writeMeasuredOutcomeVerdict } from "./test-helpers/outcome-evidence.mjs";
import { installAutomationKernelGuardCutoverFixture } from "./test-helpers/automation-kernel-guard.mjs";
import { automationKernelGuardMarkerBytes } from "./lib/automation-kernel-guard-contract.mjs";

const GIB = 1024 * 1024 * 1024;
const ACTOR_LEASES = new Map();
let OWNER_OUTCOME_LEASE_SEQUENCE = 0;
let LEASE_MUTATION_SEQUENCE = 0;

function leaseMutationId(label) {
  LEASE_MUTATION_SEQUENCE += 1;
  return createHash("sha256")
    .update(`${label}:${LEASE_MUTATION_SEQUENCE}`)
    .digest("hex");
}

function temporaryOutcomeStateRoot(prefix) {
  const stateRoot = realpathSync(mkdtempSync(path.join(os.tmpdir(), prefix)));
  installAutomationKernelGuardCutoverFixture(stateRoot);
  mkdirSync(path.join(stateRoot, "control"), {
    recursive: true,
    mode: 0o700,
  });
  return stateRoot;
}

function actorCredential(stateRoot, actor) {
  const token = `credential:${actor}:${"x".repeat(64)}`;
  const credentialDir = path.join(stateRoot, "control", "actor-credentials");
  mkdirSync(credentialDir, { recursive: true, mode: 0o700 });
  chmodSync(credentialDir, 0o700);
  writeFileSync(
    path.join(credentialDir, `${actor}.json`),
    `${JSON.stringify({
      schemaVersion: 1,
      actor,
      purpose: "automation-actor-lease",
      tokenSha256: createHash("sha256").update(token).digest("hex"),
    })}\n`,
    { mode: 0o600 },
  );
  return token;
}

function outcomeAuthentication(stateRoot, actor, nowMs) {
  installAutomationKernelGuardCutoverFixture(stateRoot);
  const policy = AUTOMATION_ACTOR_POLICIES[actor];
  const token = `${actor}-${nowMs}`;
  const key = `${stateRoot}:${actor}`;
  if (!ACTOR_LEASES.has(key)) {
    const leaseNowMs = Math.max(nowMs, Date.now());
    acquireLease({
      stateRoot,
      name: policy.leaseName,
      owner: actor,
      operationId: leaseMutationId(`acquire:${actor}`),
      token,
      actorCredentialToken: actorCredential(stateRoot, actor),
      nowMs: leaseNowMs - 1_000,
      ttlMs: policy.maxLeaseLifetimeMs,
    });
    ACTOR_LEASES.set(key, token);
  }
  const leaseToken = ACTOR_LEASES.get(key);
  return {
    stateRoot,
    authentication: {
      actor,
      leaseName: policy.leaseName,
      leaseToken,
    },
  };
}

function ownerOutcomeAuthentication(stateRoot, plan, nowMs = Date.now()) {
  installAutomationKernelGuardCutoverFixture(stateRoot);
  OWNER_OUTCOME_LEASE_SEQUENCE += 1;
  const confirmationId =
    `owner-outcome-confirmation-${OWNER_OUTCOME_LEASE_SEQUENCE}`;
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
      expiresAt: new Date(nowMs + 11 * 60_000).toISOString(),
    })}\n`,
    { mode: 0o600 },
  );
  const acquired = acquireLease({
    stateRoot,
    name: "owner-governance",
    owner: "freed-owner",
    operationId: leaseMutationId("acquire:freed-owner"),
    token: `owner-outcome-token-${"x".repeat(64)}`,
    ttlMs: 10 * 60_000,
    nowMs: nowMs + 1,
    ownerConfirmationFile: confirmationPath,
    ownerCapabilityTaskId: plan.taskId,
    ownerCapabilityIntentDigest: plan.intentDigest,
  });
  return {
    stateRoot,
    authentication: {
      actor: "freed-owner",
      leaseName: "owner-governance",
      leaseToken: acquired.lease.token,
    },
    ownerPlan: plan,
  };
}

function writeLegacyOutcomeTransitionFixture({
  stateRoot,
  taskId,
  toState,
  nowMs,
  actor,
  installedIdentity = undefined,
}) {
  assert.ok(["merged", "installed"].includes(toState));
  const paths = automationControlPaths(stateRoot);
  const manifest = JSON.parse(readFileSync(paths.taskManifest, "utf8"));
  const task = manifest.tasks.find((candidate) => candidate.taskId === taskId);
  assert.ok(task, `Missing legacy outcome fixture task ${taskId}.`);
  const fromState = task.state;
  task.state = toState;
  task.revision += 1;
  task.updatedAt = new Date(nowMs).toISOString();
  if (toState === "merged") {
    task.mergedAt = task.updatedAt;
  } else {
    task.installedIdentity = installedIdentity;
    task.installedBuild = installedIdentity.version;
    task.installedAt = task.updatedAt;
  }
  manifest.revision += 1;
  manifest.updatedAt = task.updatedAt;
  writeFileSync(paths.taskManifest, `${JSON.stringify(manifest)}\n`, {
    mode: 0o600,
  });
  const eventId = `legacy-outcome:${createHash("sha256")
    .update(`${taskId}:${toState}:${task.revision}`)
    .digest("hex")}`;
  const event = {
    schemaVersion: 1,
    eventId,
    type: "task_transitioned",
    ts: task.updatedAt,
    actor,
    taskId,
    taskRevision: task.revision,
    manifestRevision: manifest.revision,
    observerAuthority: task.observerAuthority,
    providerAuthority: task.providerAuthority,
    ...(task.providerApprovalReference === undefined
      ? {}
      : { providerApprovalReference: task.providerApprovalReference }),
    data: {
      fromState,
      toState,
      ...(toState === "merged" ? { mergedAt: task.mergedAt } : {}),
      ...(toState === "installed"
        ? {
            installedBuild: task.installedBuild,
            installedIdentity: task.installedIdentity,
            installedAt: task.installedAt,
          }
        : {}),
    },
  };
  const existing = existsSync(paths.events) ? readFileSync(paths.events) : Buffer.alloc(0);
  writeFileSync(
    paths.events,
    Buffer.concat([
      existing,
      existing.length > 0 && existing.at(-1) !== 0x0a
        ? Buffer.from("\n")
        : Buffer.alloc(0),
      Buffer.from(`${JSON.stringify(event)}\n`),
    ]),
    { mode: 0o600 },
  );
}

function prepareTaskAtState(
  stateRoot,
  taskId,
  targetState,
  nowMs,
  {
    behavioral = false,
    build = "v26.7.100-dev",
    commitSha = "a".repeat(40),
    channel = "dev",
  } = {},
) {
  const controller = outcomeAuthentication(
    stateRoot,
    "freed-stability-controller",
    nowMs,
  );
  const nightly = outcomeAuthentication(
    stateRoot,
    "freed-nightly-runner",
    nowMs,
  );
  const lifecycleStartMs = nowMs - 12 * 60 * 60 * 1_000;
  createTask({
    stateRoot,
    taskId,
    actor: controller.authentication.actor,
    leaseName: controller.authentication.leaseName,
    leaseToken: controller.authentication.leaseToken,
    observerAuthority: "merge-safe",
    providerAuthority: "forbidden",
    details: { behavioral },
    nowMs: lifecycleStartMs,
  });
  const sequence = [
    ["triaged", controller],
    ["approved_for_pr", controller],
    ["implemented", nightly],
    ["validated", nightly],
    ["merged", nightly],
    ["installed", nightly],
    ["soaking", nightly],
  ];
  for (const [index, [state, authentication]] of sequence.entries()) {
    if (
      state === targetState ||
      sequence.slice(0, index).some(([prior]) => prior === targetState)
    ) {
      if (state !== targetState) break;
    }
    const transitionNowMs = lifecycleStartMs + (index + 1) * 60_000;
    if (["merged", "installed"].includes(state)) {
      writeLegacyOutcomeTransitionFixture({
        stateRoot,
        taskId,
        toState: state,
        nowMs: transitionNowMs,
        actor: authentication.authentication.actor,
        ...(state === "installed"
          ? {
              installedIdentity: {
                version: build.replace(/^v/i, ""),
                commitSha,
                channel,
              },
            }
          : {}),
      });
    } else {
      transitionTask({
        stateRoot,
        taskId,
        actor: authentication.authentication.actor,
        leaseName: authentication.authentication.leaseName,
        leaseToken: authentication.authentication.leaseToken,
        toState: state,
        nowMs: transitionNowMs,
      });
    }
    if (state === targetState) break;
  }
}

function prepareLiveMergedOutcomeBackfillFixture(stateRoot) {
  const paths = automationControlPaths(stateRoot);
  const taskId = "authenticated-essay-capture-pr-642";
  const mergedAt = "2026-07-14T21:56:07.850Z";
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
      featureMergeCommit: "c1ac25428ecb28cd4da89225590738b08800ca19",
      governanceRepairPullRequest:
        "https://github.com/freed-project/freed/pull/982",
      governanceRepairMergeCommit:
        "c253c21945c4e159047fe7329fe24e2694fa989a",
      providerRiskArtifact:
        "/Users/aubreyfalconer/.freed/automation/artifacts/provider-risk-review/authenticated-essay-capture-pr-642/20260714215412807-d7af8b95508050f9e4d2d30f617571d67d4ac4acde28e9f772107da3a0eab70a.json",
      providerRiskArtifactDigest:
        "d7af8b95508050f9e4d2d30f617571d67d4ac4acde28e9f772107da3a0eab70a",
      gate2AuthorizationDigest: providerApprovalReference,
      ownerApprovalComment:
        "https://github.com/freed-project/freed/pull/642#issuecomment-4970593829",
      liveProviderTrafficAuthorized: false,
      soakMode: "offline-installed-build",
    },
    mergedAt,
  };
  const historicalEvent = {
    schemaVersion: 1,
    eventId: "37db3aa0-7a37-4341-a13c-5bfe6485f393",
    type: "task_transitioned",
    ts: mergedAt,
    actor: "freed-owner",
    taskId,
    taskRevision: 6,
    manifestRevision: 7,
    observerAuthority: "merge-safe",
    providerAuthority: "approved",
    providerApprovalReference,
    data: {
      fromState: "validated",
      toState: "merged",
      authorizationProvenance: {
        leaseName: "owner-governance",
        leaseAcquiredAt: "2026-07-14T21:56:07.712Z",
        credentialKind: "owner-confirmation",
        ownerConfirmationId: "authenticated-essay-capture-merged",
        ownerConfirmationTaskId: taskId,
        ownerConfirmationIntentDigest:
          "2a9c302e304cf76ed0ef57c5e5a22c9de03d76d7c6f35806f13222754fc48c4f",
        ownerConfirmationDigest:
          "8a59fcff56c33629689bed0ef96038ea291126d9241b2e3fffec16f684b017c7",
        ownerConfirmationReference:
          "authenticated-essay-capture-current-task-2026-07-14",
        ownerConfirmationApprovedBy: "AubreyF",
        ownerConfirmationApprovalReference:
          "The owner explicitly approved this exact lifecycle operation in the current task on 2026-07-14.",
        ownerConfirmationApprovedAt: "2026-07-14T21:56:06.623Z",
        ownerConfirmationExpiresAt: "2026-07-14T23:56:07.623Z",
      },
      mergedAt,
    },
  };
  writeFileSync(
    paths.taskManifest,
    `${JSON.stringify({
      schemaVersion: 1,
      revision: 7,
      updatedAt: mergedAt,
      tasks: [task],
    })}\n`,
    { mode: 0o600 },
  );
  writeFileSync(paths.events, `${JSON.stringify(historicalEvent)}\n`, {
    mode: 0o600,
  });
  return { historicalEvent, task, taskId };
}

function writeOutcomeVerdict(
  dir,
  {
    taskId,
    build,
    windowEnd,
    windowStart,
    outcome = "verified_effective",
    effect,
    commitSha = "a".repeat(40),
  },
) {
  return writeMeasuredOutcomeVerdict(dir, {
    taskId,
    version: build.replace(/^v/i, ""),
    commitSha,
    windowEnd,
    outcome,
    ...(effect === undefined
      ? {}
      : { before: effect.before, after: effect.after }),
    ...(windowStart === undefined
      ? {}
      : { sourceStartMs: Date.parse(windowStart) }),
  }).verdictPath;
}

test("summarizeSoak reads WebKit memory, heartbeat, and DOM evidence", () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "freed-soak-test-"));
  writeFileSync(
    path.join(dir, "metrics.tsv"),
    [
      "ts\thealth_event\thealth_dom_nodes\thealth_event_loop_lag_ms\thealth_webkit_rss_bytes\thealth_hidden_timer_throttled",
      `2026-05-29T01:00:00Z\trenderer_heartbeat\t450\t4\t${3 * GIB}\tfalse`,
      `2026-05-29T01:00:15Z\trenderer_heartbeat_stale\t900\t65\t${4 * GIB}\ttrue`,
      "",
    ].join("\n"),
  );
  writeFileSync(
    path.join(dir, "runtime-health.jsonl"),
    [
      JSON.stringify({
        event: "renderer_heartbeat",
        domNodeCount: 700,
        eventLoopLagMs: 12,
        webkitResidentBytes: 2 * GIB,
      }),
      "",
    ].join("\n"),
  );

  const summary = summarizeSoak(dir);
  assert.equal(summary.exists, true);
  assert.equal(summary.sampleCount, 2);
  assert.equal(summary.maxWebKitResidentBytes, 4 * GIB);
  assert.equal(summary.maxEventLoopLagMs, 65);
  assert.equal(summary.maxDomNodes, 900);
  assert.equal(summary.staleHeartbeatCount, 1);
  assert.equal(summary.throttledHeartbeatCount, 1);
});

test("resolveReadableSoak falls back from an empty current soak to the newest readable soak", () => {
  const rootDir = mkdtempSync(path.join(os.tmpdir(), "freed-soak-root-"));
  const emptyDir = path.join(rootDir, "empty");
  const oldReadableDir = path.join(rootDir, "old-readable");
  const readableDir = path.join(rootDir, "new-readable");
  mkdirSync(emptyDir);
  mkdirSync(oldReadableDir);
  mkdirSync(readableDir);
  writeFileSync(
    path.join(oldReadableDir, "metrics.tsv"),
    [
      "ts\thealth_event\thealth_webkit_rss_bytes",
      `2026-05-29T01:00:00Z\trenderer_heartbeat\t${2 * GIB}`,
      "",
    ].join("\n"),
  );
  writeFileSync(
    path.join(readableDir, "runtime-health.jsonl"),
    `${JSON.stringify({
      tsMs: Date.parse("2026-05-29T02:00:00Z"),
      event: "renderer_heartbeat",
      webkitResidentBytes: 3 * GIB,
    })}\n`,
  );
  const newer = new Date("2026-05-29T03:00:00Z");
  const older = new Date("2026-05-29T01:00:00Z");
  execFileSync("touch", ["-t", "202605290100", oldReadableDir]);
  execFileSync("touch", ["-t", "202605290300", readableDir]);

  assert.equal(findLatestReadableSoakDir(rootDir, emptyDir), readableDir);
  const summary = resolveReadableSoak(emptyDir);
  assert.equal(summary.soakDir, readableDir);
  assert.equal(summary.fallbackFrom, emptyDir);
  assert.equal(summary.sampleCount, 1);
  assert.ok(summary.maxWebKitResidentBytes >= 3 * GIB);
  assert.equal(newer > older, true);
});

test("repairSoakPointer rewrites an unreadable pointer to the newest readable soak", () => {
  const rootDir = mkdtempSync(path.join(os.tmpdir(), "freed-soak-repair-"));
  const pointerPath = path.join(rootDir, "current-soak-dir");
  const emptyDir = path.join(rootDir, "empty");
  const readableDir = path.join(rootDir, "readable");
  mkdirSync(emptyDir);
  mkdirSync(readableDir);
  writeFileSync(pointerPath, `${emptyDir}\n`);
  writeFileSync(
    path.join(readableDir, "metrics.tsv"),
    [
      "ts\thealth_event\thealth_webkit_rss_bytes",
      `2026-05-29T01:00:00Z\trenderer_heartbeat\t${2 * GIB}`,
      "",
    ].join("\n"),
  );

  const repair = repairSoakPointer(pointerPath);
  assert.equal(repair.repaired, true);
  assert.equal(repair.reason, "repaired");
  assert.equal(repair.previousDir, realpathSync(emptyDir));
  assert.equal(repair.readableDir, realpathSync(readableDir));
  assert.equal(repair.sampleCount, 1);
  assert.equal(
    readFileSync(pointerPath, "utf8").trim(),
    realpathSync(readableDir),
  );
});

test("repairSoakPointer dry run reports the target without changing the pointer", () => {
  const rootDir = mkdtempSync(path.join(os.tmpdir(), "freed-soak-repair-dry-"));
  const pointerPath = path.join(rootDir, "current-soak-dir");
  const emptyDir = path.join(rootDir, "empty");
  const readableDir = path.join(rootDir, "readable");
  mkdirSync(emptyDir);
  mkdirSync(readableDir);
  writeFileSync(pointerPath, `${emptyDir}\n`);
  writeFileSync(
    path.join(readableDir, "runtime-health.jsonl"),
    `${JSON.stringify({
      tsMs: Date.parse("2026-05-29T02:00:00Z"),
      event: "renderer_heartbeat",
      webkitResidentBytes: 3 * GIB,
    })}\n`,
  );

  const repair = repairSoakPointer(pointerPath, { dryRun: true });
  assert.equal(repair.repaired, false);
  assert.equal(repair.reason, "dry-run");
  assert.equal(repair.readableDir, realpathSync(readableDir));
  assert.equal(readFileSync(pointerPath, "utf8").trim(), emptyDir);
});

test("daily bug memory summary keeps the latest dated scan", () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "freed-bug-memory-"));
  const memoryPath = path.join(dir, "memory.md");
  writeFileSync(
    memoryPath,
    [
      "# Daily Bug Scan Memory",
      "",
      "## 2026-05-28",
      "- Outcome: fix applied.",
      "",
      "## 2026-05-29",
      "- Commit counts since the prior scan cutoff: `origin/dev` `0`, `origin/main` `0`, `origin/www` `0`.",
      "- Outcome: no new repo evidence to review, no evidence-backed bug found.",
      "",
    ].join("\n"),
  );

  const summary = summarizeDailyBugMemory(memoryPath);
  assert.equal(summary.exists, true);
  assert.equal(summary.latestDate, "2026-05-29");
  assert.equal(summary.latestHadNoNewCommits, true);
  assert.equal(summary.latestHadFix, false);
});

test("daily bug memory does not treat a referenced old PR as a new fix", () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "freed-bug-memory-pr-"));
  const memoryPath = path.join(dir, "memory.md");
  writeFileSync(
    memoryPath,
    [
      "# Daily Bug Scan Memory",
      "",
      "## 2026-05-29",
      "- Latest unchanged `origin/dev` commits remain `ef7bd47d` from PR `#605`.",
      "- Outcome: no new repo evidence to review, no evidence-backed bug found, and no fix applied.",
      "",
    ].join("\n"),
  );

  const summary = summarizeDailyBugMemory(memoryPath);
  assert.equal(summary.latestHadFix, false);
});

test("daily bug memory recognizes shipped fixes and zero additional continuation commits", () => {
  const dir = mkdtempSync(
    path.join(os.tmpdir(), "freed-bug-memory-continuation-"),
  );
  const memoryPath = path.join(dir, "memory.md");
  writeFileSync(
    memoryPath,
    [
      "# Daily Bug Scan Memory",
      "",
      "## 2026-06-15",
      "- Fix shipped:",
      "  - PR `#830`, `fix: ignore generated peer artifacts in nightly planner`, merged into `dev` at `2026-06-16T00:47:16Z`.",
      "- Continuation result:",
      "  - Fresh continuation evidence after the merge found `0` additional commits after `1944add4e6b44fcd32203363404aa0ddcb54e016` on `origin/dev`.",
      "",
    ].join("\n"),
  );

  const summary = summarizeDailyBugMemory(memoryPath);
  assert.equal(summary.latestDate, "2026-06-15");
  assert.equal(summary.latestHadNoNewCommits, true);
  assert.equal(summary.latestHadFix, true);
});

test("daily bug memory recognizes no new repo commits without treating unmerged regressions as fixes", () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "freed-bug-memory-unmerged-"));
  const memoryPath = path.join(dir, "memory.md");
  writeFileSync(
    memoryPath,
    [
      "# Daily Bug Scan Memory",
      "",
      "## 2026-06-17",
      "- Outcome: no new repo commits landed after the last completed cutoff. The strongest surviving evidence-backed bug is still the unmerged nightly planner regression.",
      "",
    ].join("\n"),
  );

  const summary = summarizeDailyBugMemory(memoryPath);
  assert.equal(summary.latestDate, "2026-06-17");
  assert.equal(summary.latestHadNoNewCommits, true);
  assert.equal(summary.latestHadFix, false);
});

test("candidate selection prioritizes memory work without opening a second behavior slot", () => {
  const candidates = buildCandidates({
    soak: {
      exists: true,
      soakDir: "/tmp/freed-perf-soak/example",
      sampleCount: 20,
      maxWebKitResidentBytes: 4 * GIB,
      maxEventLoopLagMs: 9,
      maxDomNodes: 600,
      staleHeartbeatCount: 0,
      throttledHeartbeatCount: 0,
      lastEvent: "renderer_heartbeat",
    },
    dailyBug: {
      exists: true,
      path: "/tmp/memory.md",
      latestDate: "2026-05-29",
      latestHadNoNewCommits: false,
      latestHadFix: false,
    },
    repo: {
      branch: "feat/nightly-improvement-runner",
      head: "abc1234",
      originDev: "def5678",
      originMain: "0000000",
      status: "",
    },
    peerWorktrees: [],
    crashAutomationExists: true,
    devBotMemoryExists: true,
    memoryBudgetBytes: 2.5 * GIB,
  });

  const selected = selectTargets(candidates, {
    maxTargets: 3,
    durationMinutes: 480,
    allowProviderVisible: false,
    behaviorGate: {
      status: "reserved",
      authorizedTaskId: "webkit-memory-pressure",
      activeTasks: [],
    },
  });

  assert.equal(selected[0].id, "webkit-memory-pressure");
  assert.equal(selected.filter((candidate) => candidate.behavioral).length, 1);
  assert.ok(
    !selected.some((candidate) => candidate.id === "daily-bug-fix-scan"),
  );
  assert.ok(!selected.some((candidate) => candidate.providerVisible));
});

test("target selection permits only one behavioral candidate per installed-build soak", () => {
  const selected = selectTargets(
    [
      {
        id: "behavior-a",
        taskId: "behavior-a",
        estimatedMinutes: 60,
        behavioral: true,
        soakExclusivityKey: "desktop-installed-build",
      },
      {
        id: "behavior-b",
        taskId: "behavior-b",
        estimatedMinutes: 60,
        behavioral: true,
        soakExclusivityKey: "desktop-installed-build",
      },
      {
        id: "scaffolding",
        estimatedMinutes: 30,
        behavioral: false,
      },
      {
        id: "independent-behavior",
        taskId: "independent-behavior",
        estimatedMinutes: 60,
        behavioral: true,
        soakExclusivityKey: "separate-simulator",
      },
    ],
    {
      maxTargets: 4,
      durationMinutes: 240,
      minimumNightMinutes: 180,
      allowProviderVisible: false,
      behaviorGate: {
        status: "reserved",
        authorizedTaskId: "behavior-a",
        activeTasks: [],
      },
    },
  );

  assert.deepEqual(
    selected.map((candidate) => candidate.id),
    ["behavior-a", "scaffolding"],
  );
});

test("behavioral work requires one persisted control-task reservation", () => {
  const candidate = {
    id: "P1-01",
    taskId: "P1-01",
    estimatedMinutes: 60,
    behavioral: true,
  };
  const options = {
    maxTargets: 1,
    durationMinutes: 120,
    minimumNightMinutes: 60,
  };

  assert.deepEqual(selectTargets([candidate], options), []);
  const reserved = buildBehavioralTaskGate([
    {
      taskId: "P1-01",
      state: "approved_for_pr",
      details: { behavioral: true },
    },
  ]);
  assert.equal(reserved.authorizedTaskId, "P1-01");
  assert.deepEqual(
    selectTargets([candidate], { ...options, behaviorGate: reserved }).map(
      ({ id }) => id,
    ),
    ["P1-01"],
  );
});

test("an unresolved behavior blocks every new behavior across runs", () => {
  for (const state of [
    "merged",
    "installed",
    "soaking",
    "inconclusive",
    "governance_blocked",
  ]) {
    const gate = buildBehavioralTaskGate([
      { taskId: "P1-01", state, details: { behavioral: true } },
    ]);
    assert.equal(gate.status, "awaiting-soak-outcome");
    assert.equal(gate.authorizedTaskId, null);
    assert.deepEqual(
      selectTargets(
        [
          {
            id: "P1-01",
            taskId: "P1-01",
            estimatedMinutes: 60,
            behavioral: true,
          },
          {
            id: "P1-02",
            taskId: "P1-02",
            estimatedMinutes: 60,
            behavioral: true,
          },
        ],
        {
          maxTargets: 2,
          durationMinutes: 120,
          minimumNightMinutes: 60,
          behaviorGate: gate,
        },
      ),
      [],
    );
  }
});

test("behavior gate fails closed on missing or contradictory classification", () => {
  const missing = buildBehavioralTaskGate([
    { taskId: "P1-01", state: "soaking", details: {} },
  ]);
  assert.equal(missing.status, "classification-required");
  assert.equal(missing.authorizedTaskId, null);

  const contradictory = buildBehavioralTaskGate(
    [
      {
        taskId: "P1-01",
        state: "approved_for_pr",
        details: { behavioral: false },
      },
    ],
    { behavioralTaskIds: ["P1-01"] },
  );
  assert.equal(contradictory.status, "classification-required");
  assert.equal(contradictory.authorizedTaskId, null);
});

test("a terminal task state cannot release the behavior slot before its trusted outcome", () => {
  const task = {
    taskId: "P1-01",
    state: "verified_effective",
    revision: 9,
    details: { behavioral: true },
  };
  const pending = buildBehavioralTaskGate([task]);
  assert.equal(pending.status, "outcome-record-pending");
  assert.equal(pending.authorizedTaskId, null);

  const recorded = buildBehavioralTaskGate([task], {
    outcomeEntries: [
      {
        taskId: "P1-01",
        outcome: "verified_effective",
        authentication: { taskRevision: 9 },
      },
    ],
  });
  assert.equal(recorded.status, "unreserved");

  const durableButNotFinalized = buildBehavioralTaskGate(
    [
      {
        ...task,
        pendingOutcome: {
          outcome: "verified_effective",
          outcomeDigest: "a".repeat(64),
          taskRevision: 9,
        },
      },
    ],
    {
      outcomeEntries: [
        {
          taskId: "P1-01",
          outcome: "verified_effective",
          authentication: { taskRevision: 9 },
        },
      ],
    },
  );
  assert.equal(durableButNotFinalized.status, "outcome-record-pending");

  const stale = buildBehavioralTaskGate([task], {
    outcomeEntries: [
      {
        taskId: "P1-01",
        outcome: "verified_effective",
        authentication: { taskRevision: 8 },
      },
    ],
  });
  assert.equal(stale.status, "outcome-record-pending");
});

test("missing or malformed control history keeps the behavior slot closed", () => {
  const dir = temporaryOutcomeStateRoot("freed-control-history-unhealthy-");
  const task = {
    taskId: "P1-01",
    state: "verified_effective",
    revision: 9,
    behavioral: true,
    details: { behavioral: true },
  };
  assert.equal(
    buildBehavioralTaskGate([task], { outcomeLedgerHealthy: false }).status,
    "outcome-history-unhealthy",
  );
  const missing = findPendingOutcomeTransitions(dir, []);
  assert.equal(missing.sourceHealthy, false);
  assert.equal(
    buildBehavioralTaskGate([task], { pendingOutcomeTransitions: missing })
      .status,
    "control-history-unhealthy",
  );

  const eventsPath = automationControlPaths(dir).events;
  mkdirSync(path.dirname(eventsPath), { recursive: true });
  writeFileSync(eventsPath, "{malformed\n");
  const malformed = findPendingOutcomeTransitions(dir, []);
  assert.equal(malformed.sourceHealthy, false);
  assert.deepEqual(malformed.malformedLines, [1]);
  assert.equal(
    buildBehavioralTaskGate([task], { pendingOutcomeTransitions: malformed })
      .status,
    "control-history-unhealthy",
  );

  writeFileSync(eventsPath, "");
  const healthyButMissingOutcome = findPendingOutcomeTransitions(dir, []);
  assert.equal(healthyButMissingOutcome.sourceHealthy, true);
  assert.equal(
    buildBehavioralTaskGate([task], {
      pendingOutcomeTransitions: healthyButMissingOutcome,
      outcomeEntries: [],
    }).status,
    "outcome-record-pending",
  );
});

test("pending outcome resolution binds the exact transition identity and digest", () => {
  const dir = temporaryOutcomeStateRoot("freed-pending-outcome-identity-");
  const eventsPath = automationControlPaths(dir).events;
  const outcomeDigest = "a".repeat(64);
  const reservation = {
    schemaVersion: 1,
    eventId: "task-outcome-reserved:exact",
    type: "outcome_reservation_created",
    ts: "2026-07-18T12:00:00.000Z",
    actor: "freed-nightly-runner",
    taskId: "pending-identity",
    taskRevision: 7,
    data: {
      toState: "merged",
      outcomeRequired: true,
      outcomeBackfill: true,
      outcomeDigest,
      legacyTransitionEventId: "legacy-transition",
    },
  };
  writeFileSync(eventsPath, `${JSON.stringify(reservation)}\n`, { mode: 0o600 });
  const outcomeEntry = (transitionEventId, authenticatedDigest) => ({
    taskId: reservation.taskId,
    outcome: reservation.data.toState,
    authentication: {
      taskRevision: reservation.taskRevision,
      transitionEventId,
      outcomeDigest: authenticatedDigest,
    },
  });

  const wrongEvent = findPendingOutcomeTransitions(dir, [
    outcomeEntry("task-outcome-reserved:other", outcomeDigest),
  ]);
  assert.deepEqual(wrongEvent, [
    { taskId: "pending-identity", state: "merged", revision: 7 },
  ]);
  assert.equal(wrongEvent.sourceHealthy, true);

  const wrongDigest = findPendingOutcomeTransitions(dir, [
    outcomeEntry(reservation.eventId, "b".repeat(64)),
  ]);
  assert.deepEqual(wrongDigest, [
    { taskId: "pending-identity", state: "merged", revision: 7 },
  ]);
  assert.equal(wrongDigest.sourceHealthy, true);

  const exact = findPendingOutcomeTransitions(dir, [
    outcomeEntry(reservation.eventId, outcomeDigest),
  ]);
  assert.deepEqual(exact, []);
  assert.equal(exact.sourceHealthy, true);
});

test("duplicate and conflicting outcome reservations fail control history health", () => {
  const dir = temporaryOutcomeStateRoot("freed-pending-outcome-conflict-");
  const eventsPath = automationControlPaths(dir).events;
  const reservation = (eventId, outcomeDigest) => ({
    schemaVersion: 1,
    eventId,
    type: "outcome_reservation_created",
    ts: "2026-07-18T12:00:00.000Z",
    actor: "freed-nightly-runner",
    taskId: "pending-conflict",
    taskRevision: 7,
    data: {
      toState: "merged",
      outcomeRequired: true,
      outcomeBackfill: true,
      outcomeDigest,
      legacyTransitionEventId: "legacy-transition",
    },
  });
  const first = reservation("task-outcome-reserved:first", "a".repeat(64));
  const second = reservation("task-outcome-reserved:second", "b".repeat(64));
  const firstOutcome = {
    taskId: first.taskId,
    outcome: first.data.toState,
    authentication: {
      taskRevision: first.taskRevision,
      transitionEventId: first.eventId,
      outcomeDigest: first.data.outcomeDigest,
    },
  };
  writeFileSync(
    eventsPath,
    `${JSON.stringify(first)}\n${JSON.stringify(second)}\n`,
    { mode: 0o600 },
  );

  const conflicting = findPendingOutcomeTransitions(dir, [firstOutcome]);
  assert.deepEqual(conflicting, [
    { taskId: "pending-conflict", state: "merged", revision: 7 },
  ]);
  assert.equal(conflicting.sourceHealthy, false);
  assert.deepEqual(conflicting.reservationConflicts, [
    {
      taskId: "pending-conflict",
      state: "merged",
      revision: 7,
      kind: "conflict",
    },
  ]);
  assert.equal(
    buildBehavioralTaskGate(
      [
        {
          taskId: "pending-conflict",
          state: "merged",
          revision: 7,
          behavioral: true,
        },
      ],
      { pendingOutcomeTransitions: conflicting },
    ).status,
    "control-history-unhealthy",
  );

  writeFileSync(
    eventsPath,
    `${JSON.stringify(first)}\n${JSON.stringify(first)}\n`,
    { mode: 0o600 },
  );
  const duplicate = findPendingOutcomeTransitions(dir, [firstOutcome]);
  assert.deepEqual(duplicate, []);
  assert.equal(duplicate.sourceHealthy, false);
  assert.deepEqual(duplicate.reservationConflicts, [
    {
      taskId: "pending-conflict",
      state: "merged",
      revision: 7,
      kind: "duplicate",
    },
  ]);
});

test("target selection ignores candidates outside the runnable task manifest", () => {
  const candidates = [
    { id: "authorized", taskId: "authorized", estimatedMinutes: 30 },
    { id: "unregistered", taskId: "unregistered", estimatedMinutes: 30 },
  ];
  const selected = selectTargets(candidates, {
    maxTargets: 2,
    durationMinutes: 60,
    minimumNightMinutes: 60,
    authorizedTaskIds: ["authorized"],
  });
  assert.deepEqual(
    selected.map((candidate) => candidate.id),
    ["authorized"],
  );
});

test("canonical behavioral and provider policy override candidate metadata", () => {
  const conflictGate = buildBehavioralTaskGate([
    {
      taskId: "behavior-a",
      state: "approved_for_pr",
      details: { behavioral: true },
    },
    {
      taskId: "behavior-b",
      state: "approved_for_pr",
      details: { behavioral: true },
    },
  ]);
  const conflicting = selectTargets(
    [
      {
        id: "behavior-b",
        taskId: "behavior-b",
        estimatedMinutes: 30,
        behavioral: false,
        providerVisible: false,
      },
    ],
    {
      maxTargets: 1,
      durationMinutes: 60,
      minimumNightMinutes: 30,
      authorizedTaskIds: ["behavior-b"],
      canonicalTaskPolicies: [
        {
          taskId: "behavior-b",
          behavioral: true,
          providerAuthority: "forbidden",
        },
      ],
      behaviorGate: conflictGate,
    },
  );
  assert.deepEqual(conflicting, []);

  const providerMismatch = selectTargets(
    [
      {
        id: "provider-task",
        taskId: "provider-task",
        estimatedMinutes: 30,
        behavioral: false,
        providerVisible: false,
      },
    ],
    {
      maxTargets: 1,
      durationMinutes: 60,
      minimumNightMinutes: 30,
      authorizedTaskIds: ["provider-task"],
      canonicalTaskPolicies: [
        {
          taskId: "provider-task",
          behavioral: false,
          providerAuthority: "approval-required",
        },
      ],
    },
  );
  assert.deepEqual(providerMismatch, []);
});

test("pending verification reservations block follow-on task state changes", () => {
  const dir = temporaryOutcomeStateRoot("freed-outcome-pending-history-");
  const nowMs = Date.parse("2026-07-10T13:00:00Z");
  prepareTaskAtState(dir, "partial-outcome", "soaking", nowMs, {
    behavioral: true,
  });
  const verifier = outcomeAuthentication(dir, "freed-release-verifier", nowMs);
  const cleanEntry = {
    schemaVersion: 3,
    ts: "2026-07-10T13:00:00.000Z",
    id: "partial-outcome",
    taskId: "partial-outcome",
    kind: "stability",
    outcome: "verified_neutral",
    notes: "",
    evidence: { digest: "b".repeat(64) },
  };
  const outcomeDigest = createHash("sha256")
    .update(JSON.stringify(cleanEntry))
    .digest("hex");
  const reserved = withMutationLeaseAuthority(
    {
      stateRoot: dir,
      taskId: "partial-outcome",
      ...verifier.authentication,
    },
    (authorityContext) =>
      withOutcomeRecordingGuards(
        { stateRoot: dir, nowMs: nowMs + 1, authorityContext },
        (control) =>
          control.transitionTask({
            stateRoot: dir,
            taskId: "partial-outcome",
            actor: verifier.authentication.actor,
            leaseName: verifier.authentication.leaseName,
            leaseToken: verifier.authentication.leaseToken,
            toState: "verified_neutral",
            details: {
              behavioral: true,
              latestOutcome: {
                outcome: "verified_neutral",
                outcomeDigest,
              },
            },
            nowMs: nowMs + 1,
          }),
      ),
  );
  assert.throws(
    () =>
      finalizeTaskOutcome({
        stateRoot: dir,
        taskId: "partial-outcome",
        actor: verifier.authentication.actor,
        leaseName: verifier.authentication.leaseName,
        leaseToken: verifier.authentication.leaseToken,
        outcome: "verified_neutral",
        outcomeDigest,
        taskRevision: reserved.task.revision,
        nowMs: nowMs + 2,
      }),
    (error) => error?.code === "outcome_not_durable",
  );
  writeFileSync(
    automationControlPaths(dir).outcomes,
    `${JSON.stringify({
      ...cleanEntry,
      authentication: {
        actor: verifier.authentication.actor,
        leaseName: verifier.authentication.leaseName,
        controlEventId: "missing-control-event",
        transitionEventId: "missing-transition-event",
        outcomeDigest,
        taskRevision: reserved.task.revision,
      },
    })}\n`,
  );
  assert.throws(
    () =>
      finalizeTaskOutcome({
        stateRoot: dir,
        taskId: "partial-outcome",
        actor: verifier.authentication.actor,
        leaseName: verifier.authentication.leaseName,
        leaseToken: verifier.authentication.leaseToken,
        outcome: "verified_neutral",
        outcomeDigest,
        taskRevision: reserved.task.revision,
        nowMs: nowMs + 3,
      }),
    (error) => error?.code === "outcome_not_durable",
  );
  assert.ok(
    readTask({ stateRoot: dir, taskId: "partial-outcome" }).pendingOutcome,
  );
  const controller = outcomeAuthentication(
    dir,
    "freed-stability-controller",
    nowMs,
  );
  assert.throws(
    () =>
      transitionTask({
        stateRoot: dir,
        taskId: "partial-outcome",
        actor: controller.authentication.actor,
        leaseName: controller.authentication.leaseName,
        leaseToken: controller.authentication.leaseToken,
        toState: "triaged",
        details: { behavioral: true },
        nowMs: nowMs + 4,
      }),
    (error) => error?.code === "outcome_pending",
  );
  prepareTaskAtState(dir, "next-behavior", "triaged", nowMs, {
    behavioral: true,
  });
  assert.throws(
    () =>
      transitionTask({
        stateRoot: dir,
        taskId: "next-behavior",
        actor: controller.authentication.actor,
        leaseName: controller.authentication.leaseName,
        leaseToken: controller.authentication.leaseToken,
        toState: "approved_for_pr",
        nowMs: nowMs + 5,
      }),
    (error) => error?.code === "behavior_slot_conflict",
  );

  assert.deepEqual(findPendingOutcomeTransitions(dir, []), [
    {
      taskId: "partial-outcome",
      state: "verified_neutral",
      revision: 9,
    },
  ]);
});

test("triage candidates inherit behavioral and provider gates from their program task", () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "freed-triage-contract-"));
  writeFileSync(
    path.join(dir, "T-01-preflight-kill.md"),
    [
      "# T-1: Provider preflight kill",
      "Program task: P1-04-preflight-recycle-guard.md",
      "Generated at: 2026-07-10T12:00:00Z",
      "Evidence window end: 2026-07-10T12:00:00Z",
      "- evidence",
      "",
    ].join("\n"),
  );
  writeFileSync(
    path.join(dir, "T-02-auth-zombie.md"),
    [
      "# T-2: Auth zombie",
      "Program task: Wave 4 auth-truth tasks",
      "Generated at: 2026-07-10T12:00:00Z",
      "Evidence window end: 2026-07-10T12:00:00Z",
      "- evidence",
      "",
    ].join("\n"),
  );

  const candidates = loadTriageCandidates(
    dir,
    Date.parse("2026-07-10T13:00:00Z"),
  );
  assert.equal(candidates[0].providerVisible, true);
  assert.equal(candidates[0].behavioral, true);
  assert.equal(
    candidates[0].soakExclusivityKey,
    DEFAULT_BEHAVIOR_SOAK_EXCLUSIVITY_KEY,
  );
  assert.equal(candidates[1].behavioral, true);
  assert.equal(
    candidates[1].soakExclusivityKey,
    DEFAULT_BEHAVIOR_SOAK_EXCLUSIVITY_KEY,
  );
});

test("target selection keeps batching small work until the three-hour floor is met", () => {
  const selected = selectTargets(
    [
      { id: "one", estimatedMinutes: 45, providerVisible: false },
      { id: "two", estimatedMinutes: 40, providerVisible: false },
      { id: "three", estimatedMinutes: 35, providerVisible: false },
      { id: "four", estimatedMinutes: 30, providerVisible: false },
      { id: "five", estimatedMinutes: 30, providerVisible: false },
      { id: "six", estimatedMinutes: 20, providerVisible: false },
    ],
    {
      maxTargets: 6,
      durationMinutes: 480,
      minimumNightMinutes: 180,
      allowProviderVisible: false,
    },
  );

  assert.deepEqual(
    selected.map((candidate) => candidate.id),
    ["one", "two", "three", "four", "five"],
  );
  assert.equal(
    selected.reduce(
      (total, candidate) => total + candidate.estimatedMinutes,
      0,
    ),
    180,
  );
});

test("candidate selection skips performance work when soak evidence is too thin", () => {
  const candidates = buildCandidates({
    soak: {
      exists: true,
      soakDir: "/tmp/freed-perf-soak/thin",
      sampleCount: 1,
      maxWebKitResidentBytes: 4 * GIB,
      maxEventLoopLagMs: 9,
      maxDomNodes: 600,
      staleHeartbeatCount: 0,
      throttledHeartbeatCount: 0,
      lastEvent: "renderer_heartbeat",
      lastTimestamp: "2026-05-29T01:00:00Z",
    },
    dailyBug: { exists: false },
    repo: { branch: "feature", head: "abc1234", status: "" },
    peerWorktrees: [],
    crashAutomationExists: false,
    devBotMemoryExists: false,
    memoryBudgetBytes: 2.5 * GIB,
  });

  assert.ok(
    !candidates.some((candidate) => candidate.id === "webkit-memory-pressure"),
  );
});

test("assessSoakEvidenceQuality requires enough fresh samples", () => {
  const nowMs = Date.parse("2026-05-29T04:00:00Z");
  assert.deepEqual(
    assessSoakEvidenceQuality(
      {
        exists: true,
        sampleCount: 1,
        lastTimestamp: "2026-05-29T01:00:00Z",
      },
      nowMs,
    ).reasons,
    ["insufficient-samples", "stale"],
  );
  assert.equal(
    assessSoakEvidenceQuality(
      {
        exists: true,
        sampleCount: 3,
        lastTimestamp: "2026-05-29T03:30:00Z",
      },
      nowMs,
    ).ready,
    true,
  );
});

test("preflight blockers outrank measured performance work", () => {
  const candidates = buildCandidates({
    soak: {
      exists: true,
      soakDir: "/tmp/freed-perf-soak/example",
      sampleCount: 20,
      maxWebKitResidentBytes: 4 * GIB,
      maxEventLoopLagMs: 9,
      maxDomNodes: 600,
      staleHeartbeatCount: 0,
      throttledHeartbeatCount: 0,
      lastEvent: "renderer_heartbeat",
    },
    dailyBug: { exists: false },
    repo: { branch: "feature", head: "abc1234", status: "" },
    riskSnapshot: {
      blockerCount: 1,
      warningCount: 0,
      risks: [
        {
          severity: "blocker",
          title: "Current worktree has uncommitted changes",
          evidence: ["scripts/nightly-self-improve.mjs"],
        },
      ],
    },
    peerWorktrees: [],
    crashAutomationExists: false,
    devBotMemoryExists: false,
    memoryBudgetBytes: 2.5 * GIB,
  });

  const selected = selectTargets(candidates, {
    maxTargets: 2,
    durationMinutes: 480,
    allowProviderVisible: false,
    behaviorGate: {
      status: "reserved",
      authorizedTaskId: "daily-bug-fix-scan",
      activeTasks: [],
    },
  });

  assert.equal(selected[0].id, "nightly-preflight-risk");
});

test("missing root dependencies stay visible without outranking the bug scan", () => {
  const repoPath = mkdtempSync(
    path.join(os.tmpdir(), "freed-nightly-missing-modules-"),
  );
  const repo = {
    branch: "dev",
    head: "abc1234",
    originDev: "abc1234",
    originMain: "def5678",
    status: "",
  };

  const riskSnapshot = collectRiskSnapshot({
    repoPath,
    repo,
    soak: {
      exists: false,
      soakDir: "",
      sampleCount: 0,
      maxWebKitResidentBytes: null,
      maxEventLoopLagMs: null,
      maxDomNodes: null,
      staleHeartbeatCount: 0,
      throttledHeartbeatCount: 0,
      lastEvent: "",
      firstTimestamp: "",
      lastTimestamp: "",
    },
    peerWorktrees: [],
    duplicateWork: {
      findingCount: 0,
      blockerCount: 0,
      warningCount: 0,
      findings: [],
    },
    crashAutomation: "",
    dailyBugMemory: "",
    devBotMemory: "",
    expectedBranch: "dev",
  });

  assert.equal(riskSnapshot.blockerCount, 0);
  assert.equal(riskSnapshot.warningCount, 1);
  assert.equal(riskSnapshot.risks[0]?.id, "missing-root-node-modules");
  assert.equal(riskSnapshot.risks[0]?.severity, "warning");

  const candidates = buildCandidates({
    soak: {
      exists: false,
      soakDir: "",
      sampleCount: 0,
      maxWebKitResidentBytes: null,
      maxEventLoopLagMs: null,
      maxDomNodes: null,
      staleHeartbeatCount: 0,
      throttledHeartbeatCount: 0,
      lastEvent: "",
      firstTimestamp: "",
      lastTimestamp: "",
    },
    dailyBug: {
      exists: true,
      path: "/tmp/daily-bug-memory.md",
      latestDate: "2026-06-24",
      latestHadNoNewCommits: false,
      latestHadFix: true,
    },
    repo,
    riskSnapshot,
    duplicateWork: {
      findingCount: 0,
      blockerCount: 0,
      warningCount: 0,
      findings: [],
    },
    peerWorktrees: [],
    crashAutomationExists: false,
    devBotMemoryExists: false,
    memoryBudgetBytes: 2.5 * GIB,
  });

  const selected = selectTargets(candidates, {
    maxTargets: 2,
    durationMinutes: 480,
    minimumNightMinutes: 180,
    allowProviderVisible: false,
    behaviorGate: {
      status: "reserved",
      authorizedTaskId: "daily-bug-fix-scan",
      activeTasks: [],
    },
  });

  assert.equal(selected[0].id, "daily-bug-fix-scan");
  assert.equal(selected[1].id, "nightly-preflight-risk");
});

test("parseGitWorktreePorcelain reads branch entries", () => {
  const entries = parseGitWorktreePorcelain(
    [
      "worktree /repo/main",
      "HEAD abc",
      "branch refs/heads/main",
      "",
      "worktree /repo/peer",
      "HEAD def",
      "branch refs/heads/perf/scraper-recycle-verification",
      "",
    ].join("\n"),
  );

  assert.deepEqual(entries, [
    { path: "/repo/main", head: "abc", branch: "main", detached: false },
    {
      path: "/repo/peer",
      head: "def",
      branch: "perf/scraper-recycle-verification",
      detached: false,
    },
  ]);
});

test("repo snapshot preserves leading status columns for changed paths", () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "freed-repo-status-"));
  execFileSync("git", ["init"], { cwd: dir });
  execFileSync("git", ["config", "user.email", "test@example.com"], {
    cwd: dir,
  });
  execFileSync("git", ["config", "user.name", "Test"], { cwd: dir });
  mkdirSync(path.join(dir, "docs"), { recursive: true });
  writeFileSync(path.join(dir, "docs/example.md"), "one\n");
  execFileSync("git", ["add", "docs/example.md"], { cwd: dir });
  execFileSync("git", ["commit", "-m", "test"], { cwd: dir });
  writeFileSync(path.join(dir, "docs/example.md"), "two\n");

  const snapshot = collectRepoSnapshot(dir);
  assert.match(snapshot.status, /^ M docs\/example\.md$/);
});

test("nightly JSON plan exposes only sanitized control-task state", () => {
  const dir = realpathSync(
    mkdtempSync(path.join(os.tmpdir(), "freed-plan-sanitized-")),
  );
  const repo = path.join(dir, "repo");
  const stateRoot = path.join(dir, "automation");
  mkdirSync(repo, { recursive: true });
  mkdirSync(path.join(stateRoot, "control"), {
    recursive: true,
    mode: 0o700,
  });
  execFileSync("git", ["init"], { cwd: repo });
  execFileSync("git", ["config", "user.email", "test@example.com"], {
    cwd: repo,
  });
  execFileSync("git", ["config", "user.name", "Test"], { cwd: repo });
  writeFileSync(path.join(repo, "README.md"), "test\n");
  execFileSync("git", ["add", "README.md"], { cwd: repo });
  execFileSync("git", ["commit", "-m", "test"], { cwd: repo });
  execFileSync("git", ["branch", "-M", "dev"], { cwd: repo });

  const nowMs = Date.parse("2026-07-10T13:00:00Z");
  const controller = outcomeAuthentication(
    stateRoot,
    "freed-stability-controller",
    nowMs,
  );
  createTask({
    stateRoot,
    taskId: "P1-01",
    actor: controller.authentication.actor,
    leaseName: controller.authentication.leaseName,
    leaseToken: controller.authentication.leaseToken,
    observerAuthority: "merge-safe",
    providerAuthority: "forbidden",
    details: {
      behavioral: true,
      privateNote: "must-not-appear-in-json",
    },
    nowMs: nowMs - 10,
  });
  transitionTask({
    stateRoot,
    taskId: "P1-01",
    actor: controller.authentication.actor,
    leaseName: controller.authentication.leaseName,
    leaseToken: controller.authentication.leaseToken,
    toState: "triaged",
    nowMs: nowMs - 9,
  });
  transitionTask({
    stateRoot,
    taskId: "P1-01",
    actor: controller.authentication.actor,
    leaseName: controller.authentication.leaseName,
    leaseToken: controller.authentication.leaseToken,
    toState: "approved_for_pr",
    nowMs: nowMs - 8,
  });
  createTask({
    stateRoot,
    taskId: "P1-02",
    actor: controller.authentication.actor,
    leaseName: controller.authentication.leaseName,
    leaseToken: controller.authentication.leaseToken,
    observerAuthority: "pr-only",
    providerAuthority: "forbidden",
    details: { behavioral: false },
    nowMs: nowMs - 7,
  });
  transitionTask({
    stateRoot,
    taskId: "P1-02",
    actor: controller.authentication.actor,
    leaseName: controller.authentication.leaseName,
    leaseToken: controller.authentication.leaseToken,
    toState: "triaged",
    nowMs: nowMs - 6,
  });
  transitionTask({
    stateRoot,
    taskId: "P1-02",
    actor: controller.authentication.actor,
    leaseName: controller.authentication.leaseName,
    leaseToken: controller.authentication.leaseToken,
    toState: "approved_for_pr",
    nowMs: nowMs - 5,
  });

  const plan = planNightlyRun(
    parseArgs([
      "--repo",
      repo,
      "--automation-state-root",
      stateRoot,
      "--outcome-ledger",
      path.join(stateRoot, "outcomes.jsonl"),
      "--soak-pointer",
      path.join(stateRoot, "current-soak-dir"),
      "--no-peer-scan",
      "--no-expected-branch",
      "--dry-run",
      "--json",
    ]),
  );
  const serialized = JSON.stringify(plan);

  assert.doesNotMatch(serialized, /must-not-appear-in-json/);
  assert.equal(Object.hasOwn(plan, "controlTaskManifest"), false);
  assert.deepEqual(Object.keys(plan.behaviorGate.activeTasks[0]).sort(), [
    "revision",
    "state",
    "taskId",
  ]);
  assert.ok(plan.runnableTaskIds.includes("P1-01"));
  assert.equal(plan.runnableTaskIds.includes("P1-02"), false);
});

test("peer worktree candidates outrank generic roadmap work", () => {
  const candidates = buildCandidates({
    soak: {
      exists: false,
      soakDir: "",
      sampleCount: 0,
      maxWebKitResidentBytes: null,
      maxEventLoopLagMs: null,
      maxDomNodes: null,
      staleHeartbeatCount: 0,
      throttledHeartbeatCount: 0,
      lastEvent: "",
    },
    dailyBug: { exists: false },
    repo: { branch: "feature", head: "abc1234", status: " M script" },
    peerWorktrees: [
      {
        path: "/peer",
        branch: "perf/scraper-recycle-verification",
        head: "def5678",
        aheadCount: 0,
        behindCount: 1,
        changedFileCount: 3,
        changedFiles: [
          "packages/desktop/src-tauri/src/lib.rs",
          "packages/desktop/src/lib/memory-monitor.ts",
          "packages/desktop/tests/e2e/smoke.spec.ts",
        ],
        touchesMemoryTelemetry: true,
        touchesNightlyRunner: false,
        providerVisible: false,
        score: 99,
      },
    ],
    crashAutomationExists: false,
    devBotMemoryExists: true,
    memoryBudgetBytes: 2.5 * GIB,
  });

  const selected = selectTargets(candidates, {
    maxTargets: 2,
    durationMinutes: 480,
    allowProviderVisible: false,
    behaviorGate: {
      status: "reserved",
      authorizedTaskId: "peer-perf-scraper-recycle-verification",
      activeTasks: [],
    },
  });

  assert.equal(selected[0].kind, "peer-worktree");
  assert.equal(selected[0].providerVisible, false);
});

test("provider-visible peer worktrees are retained and reported as preflight risks", () => {
  const peerWorktrees = [
    {
      path: "/peer-facebook",
      branch: "fix/facebook-ui-chrome-authors",
      head: "abc1234",
      status: "",
      aheadCount: 1,
      behindCount: 0,
      changedFileCount: 2,
      changedFiles: [
        "packages/desktop/src-tauri/src/fb-extract.js",
        "packages/shared/src/social-account-validity.ts",
      ],
      touchesNightlyRunner: false,
      touchesMemoryTelemetry: false,
      providerVisible: true,
      score: 35,
    },
  ];
  const candidates = buildCandidates({
    soak: {
      exists: false,
      soakDir: "",
      sampleCount: 0,
      maxWebKitResidentBytes: null,
      maxEventLoopLagMs: null,
      maxDomNodes: null,
      staleHeartbeatCount: 0,
      throttledHeartbeatCount: 0,
      lastEvent: "",
    },
    dailyBug: { exists: false },
    repo: { branch: "feature", head: "abc1234", status: "" },
    peerWorktrees,
    crashAutomationExists: false,
    devBotMemoryExists: false,
    memoryBudgetBytes: 2.5 * GIB,
  });
  const riskSnapshot = collectRiskSnapshot({
    repoPath: "/repo",
    repo: { status: "" },
    soak: { exists: false },
    peerWorktrees,
    crashAutomation: "",
    dailyBugMemory: "",
    devBotMemory: "",
  });
  const selected = selectTargets(candidates, {
    maxTargets: 3,
    durationMinutes: 480,
    allowProviderVisible: false,
  });

  assert.ok(candidates.some((candidate) => candidate.providerVisible));
  assert.ok(!selected.some((candidate) => candidate.providerVisible));
  assert.ok(
    riskSnapshot.risks.some(
      (risk) =>
        risk.id === "provider-visible-peer-fix-facebook-ui-chrome-authors" &&
        risk.evidence.includes(
          "packages/desktop/src-tauri/src/fb-extract.js",
        ) &&
        risk.actions.some(
          (action) => action.id === "request-provider-visible-approval",
        ),
    ),
  );
});

test("stale provider-visible peer worktrees are skipped unless explicitly listed", () => {
  assert.equal(
    shouldRetainPeerWorktree({
      branch: "fix/old-provider-branch",
      providerVisible: true,
      behindCount: 240,
      explicit: false,
    }),
    false,
  );
  assert.equal(
    shouldRetainPeerWorktree({
      branch: "fix/facebook-ui-chrome-authors",
      providerVisible: true,
      behindCount: 1,
      explicit: false,
    }),
    true,
  );
  assert.equal(
    shouldRetainPeerWorktree({
      branch: "fix/old-provider-branch",
      providerVisible: true,
      behindCount: 240,
      explicit: true,
    }),
    true,
  );
});

test("duplicate work detector reports file and surface overlap", () => {
  const duplicateWork = collectDuplicateWork([
    {
      branch: "feat/nightly-one",
      path: "/tmp/one",
      head: "abc1234",
      changedFiles: [
        "scripts/nightly-self-improve.mjs",
        "docs/NIGHTLY-SELF-IMPROVE.md",
      ],
      touchesNightlyRunner: true,
      touchesMemoryTelemetry: false,
      providerVisible: false,
    },
    {
      branch: "feat/nightly-two",
      path: "/tmp/two",
      head: "def5678",
      changedFiles: [
        "scripts/nightly-self-improve.mjs",
        "scripts/nightly-self-improve.test.mjs",
      ],
      touchesNightlyRunner: true,
      touchesMemoryTelemetry: false,
      providerVisible: false,
    },
  ]);

  assert.ok(duplicateWork.findingCount >= 2);
  assert.ok(
    duplicateWork.findings.some((finding) => finding.kind === "file-overlap"),
  );
  assert.ok(
    duplicateWork.findings.some((finding) => finding.key === "nightly-runner"),
  );
  assert.equal(duplicateWork.blockerCount, 1);
});

test("summarizePeerWorktree ignores behind-only detached snapshots as active changes", () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "freed-peer-summary-"));
  const origin = path.join(dir, "origin.git");
  const repo = path.join(dir, "repo");
  const peer = path.join(dir, "peer");

  execFileSync("git", ["init", "--bare", origin]);
  execFileSync("git", ["clone", origin, repo]);
  execFileSync("git", ["-C", repo, "config", "user.name", "Freed Tests"]);
  execFileSync("git", [
    "-C",
    repo,
    "config",
    "user.email",
    "tests@example.com",
  ]);
  execFileSync("git", ["-C", repo, "checkout", "-b", "dev"]);
  writeFileSync(path.join(repo, "notes.txt"), "first\n");
  execFileSync("git", ["-C", repo, "add", "notes.txt"]);
  execFileSync("git", ["-C", repo, "commit", "-m", "first"]);
  const firstHead = execFileSync("git", ["-C", repo, "rev-parse", "HEAD"], {
    encoding: "utf8",
  }).trim();
  execFileSync("git", ["-C", repo, "push", "-u", "origin", "dev"]);

  writeFileSync(path.join(repo, "notes.txt"), "second\n");
  execFileSync("git", ["-C", repo, "commit", "-am", "second"]);
  execFileSync("git", ["-C", repo, "push"]);

  execFileSync("git", ["clone", origin, peer]);
  execFileSync("git", ["-C", peer, "fetch", "origin", "dev"]);
  execFileSync("git", ["-C", peer, "checkout", "--detach", firstHead]);

  const summary = summarizePeerWorktree(peer, repo);
  assert.equal(summary?.branch, "HEAD");
  assert.equal(summary?.aheadCount, 0);
  assert.equal(summary?.behindCount, 1);
  assert.equal(summary?.changedFileCount, 0);
});

test("stale dirty nightly peers stay visible but do not outrank fresh bug scans", () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "freed-stale-peer-score-"));
  const origin = path.join(dir, "origin.git");
  const repo = path.join(dir, "repo");
  const peer = path.join(dir, "peer");

  execFileSync("git", ["init", "--bare", origin]);
  execFileSync("git", ["clone", origin, repo]);
  execFileSync("git", ["-C", repo, "config", "user.name", "Freed Tests"]);
  execFileSync("git", [
    "-C",
    repo,
    "config",
    "user.email",
    "tests@example.com",
  ]);
  execFileSync("git", ["-C", repo, "checkout", "-b", "dev"]);
  mkdirSync(path.join(repo, "scripts"), { recursive: true });
  mkdirSync(path.join(repo, "docs"), { recursive: true });
  writeFileSync(
    path.join(repo, "scripts/nightly-self-improve.mjs"),
    "export const value = 1;\n",
  );
  writeFileSync(path.join(repo, "docs/NIGHTLY-SELF-IMPROVE.md"), "# Nightly\n");
  execFileSync("git", [
    "-C",
    repo,
    "add",
    "scripts/nightly-self-improve.mjs",
    "docs/NIGHTLY-SELF-IMPROVE.md",
  ]);
  execFileSync("git", ["-C", repo, "commit", "-m", "base"]);
  execFileSync("git", ["-C", repo, "push", "-u", "origin", "dev"]);

  execFileSync("git", ["clone", origin, peer]);
  execFileSync("git", [
    "-C",
    peer,
    "checkout",
    "-b",
    "fix/nightly-small-batch",
    "origin/dev",
  ]);

  for (let index = 0; index < 30; index += 1) {
    writeFileSync(path.join(repo, "notes.txt"), `commit ${index}\n`);
    execFileSync("git", ["-C", repo, "add", "notes.txt"]);
    execFileSync("git", ["-C", repo, "commit", "-m", `advance ${index}`]);
  }
  execFileSync("git", ["-C", repo, "push"]);
  execFileSync("git", ["-C", peer, "fetch", "origin", "dev"]);
  writeFileSync(
    path.join(peer, "scripts/nightly-self-improve.mjs"),
    "export const value = 2;\n",
  );

  const peers = collectPeerWorktrees(repo, [peer], false);
  assert.equal(peers.length, 1);
  assert.equal(peers[0].branch, "fix/nightly-small-batch");
  assert.equal(peers[0].aheadCount, 0);
  assert.ok(peers[0].behindCount >= 25);
  assert.ok(peers[0].score < 82);

  const candidates = buildCandidates({
    soak: { exists: false },
    dailyBug: {
      exists: true,
      path: "/tmp/memory.md",
      latestDate: "2026-06-14",
      latestHadNoNewCommits: false,
      latestHadFix: false,
    },
    repo: { branch: "dev", head: "abc1234", originDev: "abc1234", status: "" },
    riskSnapshot: { blockerCount: 0, warningCount: 0, risks: [] },
    duplicateWork: {
      findingCount: 0,
      blockerCount: 0,
      warningCount: 0,
      findings: [],
    },
    peerWorktrees: peers,
    crashAutomationExists: false,
    devBotMemoryExists: false,
    memoryBudgetBytes: 2.5 * GIB,
  });

  assert.equal(candidates[0].id, "daily-bug-fix-scan");
  assert.equal(candidates[1].id, "peer-fix-nightly-small-batch");
});

test("collectPeerWorktrees skips peers whose exact head already landed through a merged PR", () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "freed-merged-peer-"));
  const origin = path.join(dir, "origin.git");
  const repo = path.join(dir, "repo");
  const peer = path.join(dir, "peer");

  execFileSync("git", ["init", "--bare", origin]);
  execFileSync("git", ["clone", origin, repo]);
  execFileSync("git", ["-C", repo, "config", "user.name", "Freed Tests"]);
  execFileSync("git", [
    "-C",
    repo,
    "config",
    "user.email",
    "tests@example.com",
  ]);
  execFileSync("git", ["-C", repo, "checkout", "-b", "dev"]);
  mkdirSync(path.join(repo, "scripts"), { recursive: true });
  writeFileSync(
    path.join(repo, "scripts/nightly-self-improve.mjs"),
    "export const value = 1;\n",
  );
  execFileSync("git", ["-C", repo, "add", "scripts/nightly-self-improve.mjs"]);
  execFileSync("git", ["-C", repo, "commit", "-m", "base"]);
  execFileSync("git", ["-C", repo, "push", "-u", "origin", "dev"]);

  execFileSync("git", [
    "-C",
    repo,
    "worktree",
    "add",
    peer,
    "-b",
    "fix/nightly-peer",
    "origin/dev",
  ]);
  writeFileSync(
    path.join(peer, "scripts/nightly-self-improve.mjs"),
    "export const value = 2;\n",
  );
  const peerHead = execFileSync("git", ["-C", peer, "rev-parse", "HEAD"], {
    encoding: "utf8",
  }).trim();

  const mergedHeads = new Map([["fix/nightly-peer", new Set([peerHead])]]);
  const peers = collectPeerWorktrees(repo, [], true, mergedHeads);

  assert.deepEqual(peers, []);

  const explicitPeers = collectPeerWorktrees(repo, [peer], false, mergedHeads);
  assert.equal(explicitPeers.length, 1);
  assert.equal(explicitPeers[0].branch, "fix/nightly-peer");
});

test("collectPeerWorktrees ignores peers with only generated validation artifacts", () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "freed-peer-artifacts-"));
  const origin = path.join(dir, "origin.git");
  const repo = path.join(dir, "repo");
  const peer = path.join(dir, "peer");

  execFileSync("git", ["init", "--bare", origin]);
  execFileSync("git", ["clone", origin, repo]);
  execFileSync("git", ["-C", repo, "config", "user.name", "Freed Tests"]);
  execFileSync("git", [
    "-C",
    repo,
    "config",
    "user.email",
    "tests@example.com",
  ]);
  execFileSync("git", ["-C", repo, "checkout", "-b", "dev"]);
  writeFileSync(path.join(repo, "notes.txt"), "first\n");
  execFileSync("git", ["-C", repo, "add", "notes.txt"]);
  execFileSync("git", ["-C", repo, "commit", "-m", "first"]);
  execFileSync("git", ["-C", repo, "push", "-u", "origin", "dev"]);

  execFileSync("git", ["clone", origin, peer]);
  execFileSync("git", [
    "-C",
    peer,
    "checkout",
    "-b",
    "chore/nightly-peer",
    "origin/dev",
  ]);
  mkdirSync(path.join(peer, "packages/desktop/playwright-report"), {
    recursive: true,
  });
  mkdirSync(path.join(peer, "packages/desktop/test-results"), {
    recursive: true,
  });
  writeFileSync(
    path.join(peer, "packages/desktop/playwright-report/index.html"),
    "<html></html>",
  );
  writeFileSync(
    path.join(peer, "packages/desktop/test-results/out.txt"),
    "artifact\n",
  );

  const summary = summarizePeerWorktree(peer, repo);
  assert.equal(summary?.status, "");
  assert.equal(summary?.changedFileCount, 0);

  const peers = collectPeerWorktrees(repo, [peer], false);
  assert.deepEqual(peers, []);
});

test("duplicate work candidates are selected before generic roadmap fallback", () => {
  const duplicateWork = {
    findingCount: 1,
    blockerCount: 0,
    warningCount: 1,
    findings: [
      {
        severity: "warning",
        title: "Multiple peer worktrees are touching scripts",
        peers: [{ branch: "feat/nightly-one", path: "/tmp/one" }],
      },
    ],
  };
  const candidates = buildCandidates({
    soak: {
      exists: false,
      soakDir: "",
      sampleCount: 0,
      maxWebKitResidentBytes: null,
      maxEventLoopLagMs: null,
      maxDomNodes: null,
      staleHeartbeatCount: 0,
      throttledHeartbeatCount: 0,
      lastEvent: "",
    },
    dailyBug: { exists: false },
    repo: { branch: "feature", head: "abc1234", status: "" },
    duplicateWork,
    peerWorktrees: [],
    crashAutomationExists: false,
    devBotMemoryExists: true,
    memoryBudgetBytes: 2.5 * GIB,
  });

  assert.ok(
    candidates.findIndex(
      (candidate) => candidate.id === "nightly-duplicate-work",
    ) >= 0,
  );
  assert.ok(
    candidates.findIndex(
      (candidate) => candidate.id === "nightly-duplicate-work",
    ) <
      candidates.findIndex(
        (candidate) => candidate.id === "roadmap-autonomous-task",
      ),
  );
});

test("outcome feedback learns from measured effects and suppresses completed task ids", () => {
  const dir = temporaryOutcomeStateRoot("freed-outcomes-");
  const ledgerPath = path.join(dir, "outcomes.jsonl");
  const releaseVerifier = outcomeAuthentication(
    dir,
    "freed-release-verifier",
    Date.parse("2026-05-29T12:00:00Z"),
  );
  const nightlyRunner = outcomeAuthentication(
    dir,
    "freed-nightly-runner",
    Date.parse("2026-05-29T12:00:00Z"),
  );
  prepareTaskAtState(
    dir,
    "webkit-memory-pressure",
    "soaking",
    Date.parse("2026-05-29T12:00:00Z"),
    { build: "v26.5.2900-dev" },
  );
  prepareTaskAtState(
    dir,
    "daily-bug-fix-scan",
    "implemented",
    Date.parse("2026-05-29T12:00:00Z"),
  );
  prepareTaskAtState(
    dir,
    "stale-effect",
    "soaking",
    Date.parse("2026-05-29T12:00:00Z"),
    { build: "v26.5.2900-dev" },
  );
  const memoryVerdict = writeOutcomeVerdict(dir, {
    taskId: "webkit-memory-pressure",
    build: "v26.5.2900-dev",
    windowEnd: "2026-05-29T11:30:00Z",
    effect: {
      metric: "main-footprint-slope",
      before: 40,
      after: 10,
      delta: -30,
      unit: "MB/sample-hour",
    },
  });
  const staleVerdict = writeOutcomeVerdict(dir, {
    taskId: "stale-effect",
    build: "v26.5.2900-dev",
    windowEnd: "2026-05-29T10:00:00Z",
    effect: {
      metric: "main-footprint-slope",
      before: 40,
      after: 10,
      delta: -30,
      unit: "MB/sample-hour",
    },
  });
  appendOutcomeLedger(
    ledgerPath,
    {
      id: "webkit-memory-pressure",
      taskId: "webkit-memory-pressure",
      kind: "performance",
      outcome: "verified_effective",
      evidenceWindowEnd: "2026-05-29T11:30:00Z",
      verdictReference: memoryVerdict,
    },
    { ...releaseVerifier, now: new Date("2026-05-29T12:00:00Z") },
  );
  appendOutcomeLedger(
    ledgerPath,
    {
      id: "daily-bug-fix-scan",
      taskId: "daily-bug-fix-scan",
      kind: "bug-fix",
      outcome: "implementation_failed",
      evidenceWindowEnd: "2026-05-29T12:00:00Z",
      evidenceDigest: "a".repeat(64),
    },
    { ...nightlyRunner, now: new Date("2026-05-29T12:01:00Z") },
  );
  appendOutcomeLedger(
    ledgerPath,
    {
      id: "stale-effect",
      taskId: "stale-effect",
      kind: "performance",
      outcome: "verified_effective",
      evidenceWindowEnd: "2026-05-29T10:00:00Z",
      verdictReference: staleVerdict,
    },
    { ...releaseVerifier, now: new Date("2026-05-29T12:02:00Z") },
  );

  const ledger = summarizeOutcomeLedger(ledgerPath, { stateRoot: dir });
  const adjusted = applyOutcomeFeedback(
    [
      {
        id: "webkit-memory-pressure",
        kind: "performance",
        score: 80,
        evidenceWindowEnd: "2026-05-29T11:00:00Z",
      },
      {
        id: "daily-bug-fix-scan",
        kind: "bug-fix",
        score: 80,
        evidenceWindowEnd: "2026-05-29T13:00:00Z",
      },
      {
        id: "another-performance-task",
        kind: "performance",
        score: 80,
        evidenceWindowEnd: "2026-05-29T13:00:00Z",
      },
      {
        id: "stale-effect",
        kind: "performance",
        score: 80,
        evidenceWindowEnd: "2026-05-29T11:00:00Z",
      },
    ],
    ledger,
  );

  assert.equal(ledger.entries.length, 3);
  const completed = adjusted.find(
    (candidate) => candidate.id === "webkit-memory-pressure",
  );
  const retry = adjusted.find(
    (candidate) => candidate.id === "daily-bug-fix-scan",
  );
  const unrelatedSuccess = adjusted.find(
    (candidate) => candidate.id === "another-performance-task",
  );
  const staleEffect = adjusted.find(
    (candidate) => candidate.id === "stale-effect",
  );
  assert.equal(completed.outcomeFeedback.suppressed, true);
  assert.equal(completed.score, 1);
  assert.equal(retry.outcomeFeedback.hasNewerEvidence, true);
  assert.equal(retry.outcomeFeedback.implementationFailed, 1);
  assert.ok(retry.score < 80);
  assert.equal(unrelatedSuccess.score, 80);
  assert.equal(staleEffect.outcomeFeedback.hasNewerEvidence, true);
  assert.equal(staleEffect.outcomeFeedback.suppressed, false);
});

test("target selection excludes completed and governance-blocked candidates", () => {
  const selected = selectTargets(
    [
      {
        id: "completed",
        score: 99,
        estimatedMinutes: 30,
        canModify: true,
        outcomeFeedback: { suppressed: true },
      },
      {
        id: "owner-only",
        score: 98,
        estimatedMinutes: 30,
        canModify: false,
      },
      {
        id: "actionable",
        score: 80,
        estimatedMinutes: 30,
        canModify: true,
      },
    ],
    {
      durationMinutes: 60,
      minimumNightMinutes: 30,
      maxTargets: 3,
      allowProviderVisible: false,
    },
  );
  assert.deepEqual(
    selected.map((candidate) => candidate.id),
    ["actionable"],
  );
});

test("one owner intent records a fresh merged outcome", () => {
  const stateRoot = temporaryOutcomeStateRoot("freed-owner-outcome-fresh-");
  const paths = automationControlPaths(stateRoot);
  const taskId = "owner-outcome-fresh";
  const nowMs = Date.now();
  prepareTaskAtState(stateRoot, taskId, "validated", nowMs);
  const input = {
    id: taskId,
    taskId,
    kind: "stability",
    outcome: "merged",
    notes: "Owner composite transition.",
    evidenceDigest: "d".repeat(64),
  };
  const plannedAt = new Date(nowMs + 1_000);
  const plan = planOutcomeRecord(paths.outcomes, input, {
    stateRoot,
    now: plannedAt,
  });
  const owner = ownerOutcomeAuthentication(stateRoot, plan, nowMs + 2_000);
  const recorded = appendOutcomeLedger(paths.outcomes, input, {
    ...owner,
    now: new Date(nowMs + 3_000),
  });

  assert.equal(recorded.ts, plannedAt.toISOString());
  assert.equal(recorded.outcome, "merged");
  assert.equal(recorded.authentication.actor, "freed-owner");
  const task = readTask({ stateRoot, taskId });
  assert.equal(task.state, "merged");
  assert.equal(task.revision, plan.intent.parameters.sourceTaskRevision + 1);
  assert.equal(task.pendingOutcome, undefined);
  assert.equal(task.details.latestOutcome.recordedAt, plannedAt.toISOString());
  const summary = summarizeOutcomeLedger(paths.outcomes, { stateRoot });
  assert.equal(summary.entries.length, 1);
  assert.equal(summary.sourceHealth.ledgerHealthy, true);
});

for (const checkpointName of [
  "outcome-transition-resolved",
  "outcome-control-event-appended",
  "outcome-ledger-appended",
  "outcome-finalized",
]) {
  test(`one owner intent recovers the live merged backfill after ${checkpointName}`, () => {
    const stateRoot = temporaryOutcomeStateRoot(
      `freed-owner-live-backfill-${checkpointName}-`,
    );
    const paths = automationControlPaths(stateRoot);
    const { taskId } = prepareLiveMergedOutcomeBackfillFixture(stateRoot);
    const input = {
      id: taskId,
      taskId,
      kind: "stability",
      outcome: "merged",
      notes: "Authenticated merged outcome backfill.",
      evidenceDigest: "e".repeat(64),
    };
    const nowMs = Date.now();
    const plan = planOutcomeRecord(paths.outcomes, input, {
      stateRoot,
      now: new Date(nowMs),
    });
    const firstOwner = ownerOutcomeAuthentication(
      stateRoot,
      plan,
      nowMs + 1_000,
    );
    assert.throws(
      () =>
        appendOutcomeLedger(paths.outcomes, input, {
          ...firstOwner,
          now: new Date(nowMs + 2_000),
          checkpoint: (checkpoint) => {
            if (checkpoint === checkpointName) {
              throw new Error(`simulated owner crash at ${checkpointName}`);
            }
          },
        }),
      new RegExp(`simulated owner crash at ${checkpointName}`),
    );
    releaseLease({
      stateRoot,
      name: firstOwner.authentication.leaseName,
      operationId: leaseMutationId("release:first-owner"),
      token: firstOwner.authentication.leaseToken,
      nowMs: nowMs + 3_000,
    });
    const recoveryOwner = ownerOutcomeAuthentication(
      stateRoot,
      plan,
      nowMs + 4_000,
    );
    const recovered = appendOutcomeLedger(paths.outcomes, input, {
      ...recoveryOwner,
      now: new Date(nowMs + 5_000),
    });
    const task = readTask({ stateRoot, taskId });
    assert.equal(task.state, "merged");
    assert.equal(task.revision, 7);
    assert.equal(task.pendingOutcome, undefined);
    assert.equal(recovered.ts, plan.cleanEntry.ts);
    const summary = summarizeOutcomeLedger(paths.outcomes, { stateRoot });
    assert.equal(summary.entries.length, 1);
    assert.equal(summary.sourceHealth.ledgerHealthy, true);

    const settledBytes = {
      manifest: readFileSync(paths.taskManifest),
      events: readFileSync(paths.events),
      ledger: readFileSync(paths.outcomes),
    };
    assert.deepEqual(
      appendOutcomeLedger(paths.outcomes, input, {
        ...recoveryOwner,
        now: new Date(nowMs + 6_000),
      }),
      recovered,
    );
    assert.deepEqual(readFileSync(paths.taskManifest), settledBytes.manifest);
    assert.deepEqual(readFileSync(paths.events), settledBytes.events);
    assert.deepEqual(readFileSync(paths.outcomes), settledBytes.ledger);
  });
}

test("an owner plan cannot take over another actor's pending outcome", () => {
  const stateRoot = temporaryOutcomeStateRoot("freed-owner-cross-actor-");
  const paths = automationControlPaths(stateRoot);
  const taskId = "owner-cross-actor";
  const nowMs = Date.now();
  prepareTaskAtState(stateRoot, taskId, "validated", nowMs);
  const input = {
    id: taskId,
    taskId,
    kind: "stability",
    outcome: "merged",
    notes: "Cross-actor retry proof.",
    evidenceDigest: "f".repeat(64),
  };
  const recordTime = new Date(nowMs + 1_000);
  const plan = planOutcomeRecord(paths.outcomes, input, {
    stateRoot,
    now: recordTime,
  });
  const nightly = outcomeAuthentication(
    stateRoot,
    "freed-nightly-runner",
    nowMs + 2_000,
  );
  assert.throws(
    () =>
      appendOutcomeLedger(paths.outcomes, input, {
        ...nightly,
        now: recordTime,
        checkpoint: (checkpoint) => {
          if (checkpoint === "outcome-transition-resolved") {
            throw new Error("simulated first-actor crash");
          }
        },
      }),
    /simulated first-actor crash/,
  );
  const owner = ownerOutcomeAuthentication(stateRoot, plan, nowMs + 3_000);
  const beforeOwnerRetry = {
    manifest: readFileSync(paths.taskManifest),
    events: readFileSync(paths.events),
    ledger: existsSync(paths.outcomes) ? readFileSync(paths.outcomes) : null,
    transactions: existsSync(paths.taskTransactions)
      ? readdirSync(paths.taskTransactions).sort()
      : [],
  };
  assert.throws(
    () =>
      appendOutcomeLedger(paths.outcomes, input, {
        ...owner,
        now: new Date(nowMs + 4_000),
      }),
    /lifecycle route does not match its owner plan/,
  );
  assert.deepEqual(readFileSync(paths.taskManifest), beforeOwnerRetry.manifest);
  assert.deepEqual(readFileSync(paths.events), beforeOwnerRetry.events);
  assert.deepEqual(
    existsSync(paths.outcomes) ? readFileSync(paths.outcomes) : null,
    beforeOwnerRetry.ledger,
  );
  assert.deepEqual(
    existsSync(paths.taskTransactions)
      ? readdirSync(paths.taskTransactions).sort()
      : [],
    beforeOwnerRetry.transactions,
  );

  const recovered = appendOutcomeLedger(paths.outcomes, input, {
    ...nightly,
    now: recordTime,
  });
  assert.equal(recovered.authentication.actor, "freed-nightly-runner");
  assert.equal(
    summarizeOutcomeLedger(paths.outcomes, { stateRoot }).entries.length,
    1,
  );
});

test("an owner plan rejects tampering before canonical mutation", () => {
  const stateRoot = temporaryOutcomeStateRoot("freed-owner-plan-tamper-");
  const paths = automationControlPaths(stateRoot);
  const taskId = "owner-plan-tamper";
  const nowMs = Date.now();
  prepareTaskAtState(stateRoot, taskId, "validated", nowMs);
  const input = {
    id: taskId,
    taskId,
    kind: "stability",
    outcome: "merged",
    notes: "Original owner plan.",
    evidenceDigest: "1".repeat(64),
  };
  const plan = planOutcomeRecord(paths.outcomes, input, {
    stateRoot,
    now: new Date(nowMs + 1_000),
  });
  const owner = ownerOutcomeAuthentication(stateRoot, plan, nowMs + 2_000);
  const tamperedPlan = structuredClone(plan);
  tamperedPlan.cleanEntry.notes = "Changed after approval.";
  const before = {
    manifest: readFileSync(paths.taskManifest),
    events: readFileSync(paths.events),
    ledger: existsSync(paths.outcomes) ? readFileSync(paths.outcomes) : null,
    transactions: existsSync(paths.taskTransactions)
      ? readdirSync(paths.taskTransactions).sort()
      : [],
  };
  assert.throws(
    () =>
      appendOutcomeLedger(paths.outcomes, input, {
        ...owner,
        ownerPlan: tamperedPlan,
        now: new Date(nowMs + 3_000),
      }),
    /does not match its canonical owner intent/,
  );
  assert.deepEqual(readFileSync(paths.taskManifest), before.manifest);
  assert.deepEqual(readFileSync(paths.events), before.events);
  assert.deepEqual(
    existsSync(paths.outcomes) ? readFileSync(paths.outcomes) : null,
    before.ledger,
  );
  assert.deepEqual(
    existsSync(paths.taskTransactions)
      ? readdirSync(paths.taskTransactions).sort()
      : [],
    before.transactions,
  );
});

test("a tampered pending outcome digest blocks retry before mutation", () => {
  const stateRoot = temporaryOutcomeStateRoot("freed-pending-digest-tamper-");
  const paths = automationControlPaths(stateRoot);
  const taskId = "pending-digest-tamper";
  const nowMs = Date.now();
  prepareTaskAtState(stateRoot, taskId, "validated", nowMs);
  const input = {
    id: taskId,
    taskId,
    kind: "stability",
    outcome: "merged",
    notes: "Pending digest parity.",
    evidenceDigest: "2".repeat(64),
  };
  const authentication = outcomeAuthentication(
    stateRoot,
    "freed-nightly-runner",
    nowMs + 1_000,
  );
  assert.throws(
    () =>
      appendOutcomeLedger(paths.outcomes, input, {
        ...authentication,
        now: new Date(nowMs + 2_000),
        checkpoint: (checkpoint) => {
          if (checkpoint === "outcome-transition-resolved") {
            throw new Error("simulated pending digest crash");
          }
        },
      }),
    /simulated pending digest crash/,
  );
  const manifest = JSON.parse(readFileSync(paths.taskManifest, "utf8"));
  const task = manifest.tasks.find((candidate) => candidate.taskId === taskId);
  task.pendingOutcome.outcomeDigest = "3".repeat(64);
  writeFileSync(paths.taskManifest, `${JSON.stringify(manifest)}\n`, {
    mode: 0o600,
  });
  const before = {
    manifest: readFileSync(paths.taskManifest),
    events: readFileSync(paths.events),
    ledger: existsSync(paths.outcomes) ? readFileSync(paths.outcomes) : null,
    transactions: existsSync(paths.taskTransactions)
      ? readdirSync(paths.taskTransactions).sort()
      : [],
  };
  assert.throws(
    () =>
      appendOutcomeLedger(paths.outcomes, input, {
        ...authentication,
        now: new Date(nowMs + 3_000),
      }),
    (error) => error?.code === "invalid_state",
  );
  assert.deepEqual(readFileSync(paths.taskManifest), before.manifest);
  assert.deepEqual(readFileSync(paths.events), before.events);
  assert.deepEqual(
    existsSync(paths.outcomes) ? readFileSync(paths.outcomes) : null,
    before.ledger,
  );
  assert.deepEqual(
    existsSync(paths.taskTransactions)
      ? readdirSync(paths.taskTransactions).sort()
      : [],
    before.transactions,
  );
});

test("lease replacement after the outcome event cannot append a ledger row", () => {
  const stateRoot = temporaryOutcomeStateRoot("freed-outcome-lease-replaced-");
  const paths = automationControlPaths(stateRoot);
  const taskId = "outcome-lease-replaced";
  const nowMs = Date.now();
  prepareTaskAtState(stateRoot, taskId, "validated", nowMs);
  const input = {
    id: taskId,
    taskId,
    kind: "stability",
    outcome: "merged",
    notes: "Lease reauthorization before ledger append.",
    evidenceDigest: "4".repeat(64),
  };
  const authentication = outcomeAuthentication(
    stateRoot,
    "freed-nightly-runner",
    nowMs + 1_000,
  );
  const leaseRecordPath = path.join(
    paths.leases,
    `${authentication.authentication.leaseName}.lease`,
    "lease.json",
  );
  assert.throws(
    () =>
      appendOutcomeLedger(paths.outcomes, input, {
        ...authentication,
        now: new Date(nowMs + 2_000),
        checkpoint: (checkpoint) => {
          if (checkpoint !== "outcome-control-event-appended") return;
          const lease = JSON.parse(readFileSync(leaseRecordPath, "utf8"));
          lease.token = "replacement-token";
          writeFileSync(leaseRecordPath, `${JSON.stringify(lease)}\n`, {
            mode: 0o600,
          });
        },
      }),
    (error) => error?.code === "lease_token_mismatch",
  );
  assert.equal(existsSync(paths.outcomes), false);
  assert.equal(
    JSON.parse(readFileSync(paths.taskManifest, "utf8")).tasks[0]
      .pendingOutcome.outcome,
    "merged",
  );
  assert.equal(
    readFileSync(paths.events, "utf8")
      .trim()
      .split("\n")
      .map(JSON.parse)
      .filter((event) => event.type === "outcome_recorded").length,
    1,
  );
});

test("installed backfill rejects legacy event identity drift without mutation", () => {
  const stateRoot = temporaryOutcomeStateRoot(
    "freed-installed-legacy-identity-drift-",
  );
  const paths = automationControlPaths(stateRoot);
  const taskId = "installed-legacy-identity-drift";
  const nowMs = Date.now();
  const installedIdentity = {
    version: "26.7.1800",
    commitSha: "5".repeat(40),
    channel: "dev",
  };
  prepareTaskAtState(stateRoot, taskId, "installed", nowMs, {
    build: installedIdentity.version,
    commitSha: installedIdentity.commitSha,
    channel: installedIdentity.channel,
  });
  const events = readFileSync(paths.events, "utf8")
    .trim()
    .split("\n")
    .map(JSON.parse);
  const legacyInstalled = events.find(
    (event) =>
      event.type === "task_transitioned" &&
      event.taskId === taskId &&
      event.data?.toState === "installed",
  );
  legacyInstalled.data.installedIdentity.commitSha = "6".repeat(40);
  writeFileSync(
    paths.events,
    `${events.map((event) => JSON.stringify(event)).join("\n")}\n`,
    { mode: 0o600 },
  );
  const authentication = outcomeAuthentication(
    stateRoot,
    "freed-nightly-runner",
    nowMs + 1_000,
  );
  const before = {
    manifest: readFileSync(paths.taskManifest),
    events: readFileSync(paths.events),
    ledger: existsSync(paths.outcomes) ? readFileSync(paths.outcomes) : null,
    transactions: existsSync(paths.taskTransactions)
      ? readdirSync(paths.taskTransactions).sort()
      : [],
  };
  assert.throws(
    () =>
      appendOutcomeLedger(
        paths.outcomes,
        {
          id: taskId,
          taskId,
          kind: "stability",
          outcome: "installed",
          notes: "Legacy installed identity parity.",
          evidenceDigest: "7".repeat(64),
          installedIdentity,
        },
        {
          ...authentication,
          now: new Date(nowMs + 2_000),
        },
      ),
    /legacy installed transition does not match canonical installed state/,
  );
  assert.deepEqual(readFileSync(paths.taskManifest), before.manifest);
  assert.deepEqual(readFileSync(paths.events), before.events);
  assert.deepEqual(
    existsSync(paths.outcomes) ? readFileSync(paths.outcomes) : null,
    before.ledger,
  );
  assert.deepEqual(
    existsSync(paths.taskTransactions)
      ? readdirSync(paths.taskTransactions).sort()
      : [],
    before.transactions,
  );
});

test("appendOutcomeLedger crash recovery reserves merged and installed outcomes exactly once", () => {
  const dir = temporaryOutcomeStateRoot(
    "freed-all-outcome-reservation-recovery-",
  );
  const paths = automationControlPaths(dir);
  const ledgerPath = paths.outcomes;
  const nowMs = Date.now();
  const taskId = "all-outcome-reservation-recovery";
  const authentication = outcomeAuthentication(
    dir,
    "freed-nightly-runner",
    nowMs,
  );
  prepareTaskAtState(dir, taskId, "validated", nowMs);

  const readEvents = () =>
    readFileSync(paths.events, "utf8")
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line) => JSON.parse(line));
  const assertOutcomeExactlyOnce = (entry) => {
    const events = readEvents();
    const provenance = entry.authentication;
    assert.equal(
      events.filter(
        (event) =>
          event.eventId === provenance.transitionEventId &&
          event.type === "task_transitioned" &&
          event.taskId === taskId &&
          event.taskRevision === provenance.taskRevision &&
          event.data?.toState === entry.outcome &&
          event.data?.outcomeDigest === provenance.outcomeDigest &&
          event.data?.outcomeRequired === true,
      ).length,
      1,
    );
    assert.equal(
      events.filter(
        (event) =>
          event.eventId === provenance.controlEventId &&
          event.type === "outcome_recorded" &&
          event.taskId === taskId &&
          event.data?.taskRevision === provenance.taskRevision &&
          event.data?.outcome === entry.outcome &&
          event.data?.outcomeDigest === provenance.outcomeDigest,
      ).length,
      1,
    );
    assert.equal(
      events.filter(
        (event) =>
          event.type === "outcome_reservation_finalized" &&
          event.taskId === taskId &&
          event.data?.outcome === entry.outcome &&
          event.data?.outcomeDigest === provenance.outcomeDigest &&
          event.data?.taskRevision === provenance.taskRevision,
      ).length,
      1,
    );
    const summary = summarizeOutcomeLedger(ledgerPath, { stateRoot: dir });
    assert.equal(
      summary.entries.filter(
        (candidate) =>
          candidate.taskId === taskId &&
          candidate.outcome === entry.outcome &&
          candidate.authentication?.outcomeDigest ===
            provenance.outcomeDigest &&
          candidate.authentication?.transitionEventId ===
            provenance.transitionEventId &&
          candidate.authentication?.controlEventId ===
            provenance.controlEventId,
      ).length,
      1,
    );
    return summary;
  };

  const mergedInput = {
    id: taskId,
    taskId,
    kind: "stability",
    outcome: "merged",
    notes: "",
    evidenceDigest: "a".repeat(64),
  };
  const mergedNow = new Date(nowMs + 60_000);
  let mergedCheckpointReached = false;
  assert.throws(
    () =>
      appendOutcomeLedger(ledgerPath, mergedInput, {
        ...authentication,
        now: mergedNow,
        checkpoint: (checkpoint) => {
          if (checkpoint === "outcome-transition-resolved") {
            mergedCheckpointReached = true;
            throw new Error("simulated merged crash");
          }
        },
      }),
    /simulated merged crash/,
  );
  assert.equal(mergedCheckpointReached, true);

  const pendingMergedTask = readTask({ stateRoot: dir, taskId });
  assert.equal(pendingMergedTask.state, "merged");
  assert.deepEqual(pendingMergedTask.pendingOutcome, {
    outcome: "merged",
    outcomeDigest: pendingMergedTask.details.latestOutcome.outcomeDigest,
    taskRevision: pendingMergedTask.revision,
  });
  assert.deepEqual(findPendingOutcomeTransitions(dir, []), [
    {
      taskId,
      state: "merged",
      revision: pendingMergedTask.revision,
    },
  ]);
  assert.equal(existsSync(ledgerPath), false);

  const beforeBlockedInstall = {
    manifest: readFileSync(paths.taskManifest),
    events: readFileSync(paths.events),
  };
  assert.throws(
    () =>
      transitionTask({
        stateRoot: dir,
        taskId,
        actor: authentication.authentication.actor,
        leaseName: authentication.authentication.leaseName,
        leaseToken: authentication.authentication.leaseToken,
        toState: "installed",
        details: {
          behavioral: false,
          installedIdentity: {
            version: "26.7.1800",
            commitSha: "b".repeat(40),
            channel: "dev",
          },
        },
        nowMs: nowMs + 90_000,
      }),
    (error) => error?.code === "outcome_pending",
  );
  assert.deepEqual(
    readFileSync(paths.taskManifest),
    beforeBlockedInstall.manifest,
  );
  assert.deepEqual(readFileSync(paths.events), beforeBlockedInstall.events);
  assert.equal(existsSync(ledgerPath), false);

  const merged = appendOutcomeLedger(ledgerPath, mergedInput, {
    ...authentication,
    now: mergedNow,
  });
  assert.equal(readTask({ stateRoot: dir, taskId }).pendingOutcome, undefined);
  const mergedSummary = assertOutcomeExactlyOnce(merged);
  assert.deepEqual(
    findPendingOutcomeTransitions(dir, mergedSummary.entries),
    [],
  );

  const afterMergedRecovery = {
    manifest: readFileSync(paths.taskManifest),
    events: readFileSync(paths.events),
    ledger: readFileSync(ledgerPath),
  };
  assert.deepEqual(
    appendOutcomeLedger(ledgerPath, mergedInput, {
      ...authentication,
      now: mergedNow,
    }),
    merged,
  );
  assert.deepEqual(
    readFileSync(paths.taskManifest),
    afterMergedRecovery.manifest,
  );
  assert.deepEqual(readFileSync(paths.events), afterMergedRecovery.events);
  assert.deepEqual(readFileSync(ledgerPath), afterMergedRecovery.ledger);
  assertOutcomeExactlyOnce(merged);

  const installedIdentity = {
    version: "26.7.1800",
    commitSha: "b".repeat(40),
    channel: "dev",
  };
  const installedInput = {
    id: taskId,
    taskId,
    kind: "stability",
    outcome: "installed",
    notes: "",
    evidenceDigest: "c".repeat(64),
    installedIdentity,
  };
  const installedNow = new Date(nowMs + 120_000);
  let installedCheckpointReached = false;
  assert.throws(
    () =>
      appendOutcomeLedger(ledgerPath, installedInput, {
        ...authentication,
        now: installedNow,
        checkpoint: (checkpoint) => {
          if (checkpoint === "outcome-control-event-appended") {
            installedCheckpointReached = true;
            throw new Error("simulated installed crash");
          }
        },
      }),
    /simulated installed crash/,
  );
  assert.equal(installedCheckpointReached, true);

  const pendingInstalledTask = readTask({ stateRoot: dir, taskId });
  assert.equal(pendingInstalledTask.state, "installed");
  assert.deepEqual(pendingInstalledTask.installedIdentity, installedIdentity);
  assert.deepEqual(pendingInstalledTask.pendingOutcome, {
    outcome: "installed",
    outcomeDigest: pendingInstalledTask.details.latestOutcome.outcomeDigest,
    taskRevision: pendingInstalledTask.revision,
  });
  assert.deepEqual(readFileSync(ledgerPath), afterMergedRecovery.ledger);
  assert.deepEqual(findPendingOutcomeTransitions(dir, mergedSummary.entries), [
    {
      taskId,
      state: "installed",
      revision: pendingInstalledTask.revision,
    },
  ]);

  const beforeBlockedSoak = {
    manifest: readFileSync(paths.taskManifest),
    events: readFileSync(paths.events),
    ledger: readFileSync(ledgerPath),
  };
  assert.throws(
    () =>
      transitionTask({
        stateRoot: dir,
        taskId,
        actor: authentication.authentication.actor,
        leaseName: authentication.authentication.leaseName,
        leaseToken: authentication.authentication.leaseToken,
        toState: "soaking",
        nowMs: nowMs + 150_000,
      }),
    (error) => error?.code === "outcome_pending",
  );
  assert.deepEqual(
    readFileSync(paths.taskManifest),
    beforeBlockedSoak.manifest,
  );
  assert.deepEqual(readFileSync(paths.events), beforeBlockedSoak.events);
  assert.deepEqual(readFileSync(ledgerPath), beforeBlockedSoak.ledger);

  const installed = appendOutcomeLedger(ledgerPath, installedInput, {
    ...authentication,
    now: installedNow,
  });
  assert.equal(readTask({ stateRoot: dir, taskId }).pendingOutcome, undefined);
  const installedSummary = assertOutcomeExactlyOnce(installed);
  assert.deepEqual(
    findPendingOutcomeTransitions(dir, installedSummary.entries),
    [],
  );

  const afterInstalledRecovery = {
    manifest: readFileSync(paths.taskManifest),
    events: readFileSync(paths.events),
    ledger: readFileSync(ledgerPath),
  };
  assert.deepEqual(
    appendOutcomeLedger(ledgerPath, installedInput, {
      ...authentication,
      now: installedNow,
    }),
    installed,
  );
  assert.deepEqual(
    readFileSync(paths.taskManifest),
    afterInstalledRecovery.manifest,
  );
  assert.deepEqual(readFileSync(paths.events), afterInstalledRecovery.events);
  assert.deepEqual(readFileSync(ledgerPath), afterInstalledRecovery.ledger);
  assertOutcomeExactlyOnce(merged);
  assertOutcomeExactlyOnce(installed);
});

for (const route of ["fresh", "legacy-backfill"]) {
  test(`${route} installed identity drift blocks finalization and continuous trust`, () => {
    const stateRoot = temporaryOutcomeStateRoot(
      `freed-installed-${route}-finalization-`,
    );
    const paths = automationControlPaths(stateRoot);
    const nowMs = Date.now();
    const taskId = `installed-${route}-finalization`;
    const authentication = outcomeAuthentication(
      stateRoot,
      "freed-nightly-runner",
      nowMs,
    );
    const installedIdentity = {
      version: "26.7.1802-dev",
      commitSha: "d".repeat(40),
      channel: "dev",
      artifactDigest: "e".repeat(64),
    };
    if (route === "fresh") {
      prepareTaskAtState(stateRoot, taskId, "validated", nowMs);
      appendOutcomeLedger(
        paths.outcomes,
        {
          id: taskId,
          taskId,
          kind: "stability",
          outcome: "merged",
          notes: "Fresh installed identity setup.",
          evidenceDigest: "1".repeat(64),
        },
        {
          ...authentication,
          now: new Date(nowMs + 60_000),
        },
      );
    } else {
      prepareTaskAtState(stateRoot, taskId, "installed", nowMs, {
        build: installedIdentity.version,
        commitSha: installedIdentity.commitSha,
        channel: installedIdentity.channel,
      });
      const manifest = JSON.parse(readFileSync(paths.taskManifest, "utf8"));
      const task = manifest.tasks.find((candidate) => candidate.taskId === taskId);
      task.installedIdentity = installedIdentity;
      task.details.installedIdentity = installedIdentity;
      writeFileSync(paths.taskManifest, `${JSON.stringify(manifest)}\n`, {
        mode: 0o600,
      });
      const events = readFileSync(paths.events, "utf8")
        .trim()
        .split("\n")
        .map(JSON.parse);
      const legacyInstalled = events.find(
        (event) =>
          event.type === "task_transitioned" &&
          event.taskId === taskId &&
          event.data?.toState === "installed",
      );
      legacyInstalled.data.installedIdentity = installedIdentity;
      writeFileSync(
        paths.events,
        `${events.map((event) => JSON.stringify(event)).join("\n")}\n`,
        { mode: 0o600 },
      );
    }

    const input = {
      id: taskId,
      taskId,
      kind: "stability",
      outcome: "installed",
      notes: `${route} installed identity finalization.`,
      evidenceDigest: "2".repeat(64),
      installedIdentity,
    };
    const recordTime = new Date(nowMs + 120_000);
    assert.throws(
      () =>
        appendOutcomeLedger(paths.outcomes, input, {
          ...authentication,
          now: recordTime,
          checkpoint: (checkpoint) => {
            if (checkpoint === "outcome-ledger-appended") {
              throw new Error(`simulate ${route} installed crash`);
            }
          },
        }),
      new RegExp(`simulate ${route} installed crash`),
    );

    const ledgerEntries = readFileSync(paths.outcomes, "utf8")
      .trim()
      .split("\n")
      .map(JSON.parse);
    const installedEntry = ledgerEntries.find(
      (entry) => entry.taskId === taskId && entry.outcome === "installed",
    );
    assert.ok(installedEntry);
    const events = readFileSync(paths.events, "utf8")
      .trim()
      .split("\n")
      .map(JSON.parse);
    const transition = events.find(
      (event) =>
        event.eventId === installedEntry.authentication.transitionEventId,
    );
    assert.equal(
      transition.type,
      route === "fresh" ? "task_transitioned" : "outcome_reservation_created",
    );
    transition.data.installedIdentity = {
      ...transition.data.installedIdentity,
      commitSha: "f".repeat(40),
    };
    writeFileSync(
      paths.events,
      `${events.map((event) => JSON.stringify(event)).join("\n")}\n`,
      { mode: 0o600 },
    );

    const snapshot = () => ({
      manifest: readFileSync(paths.taskManifest),
      events: readFileSync(paths.events),
      ledger: readFileSync(paths.outcomes),
      taskTransactions: existsSync(paths.taskTransactions)
        ? Object.fromEntries(
            readdirSync(paths.taskTransactions)
              .sort()
              .map((name) => [
                name,
                readFileSync(path.join(paths.taskTransactions, name)),
              ]),
          )
        : {},
    });
    const beforeRetry = snapshot();
    assert.throws(
      () =>
        appendOutcomeLedger(paths.outcomes, input, {
          ...authentication,
          now: recordTime,
        }),
      (error) => error?.code === "outcome_not_durable",
    );
    assert.deepEqual(snapshot(), beforeRetry);

    const summary = summarizeOutcomeLedger(paths.outcomes, { stateRoot });
    assert.equal(
      summary.entries.some(
        (entry) => entry.taskId === taskId && entry.outcome === "installed",
      ),
      false,
    );
    assert.equal(
      summary.rejectedEntries.some(
        (record) =>
          record.entry?.taskId === taskId &&
          record.entry?.outcome === "installed" &&
          record.reason ===
            "outcome does not match its authenticated control event",
      ),
      true,
    );
    assert.equal(summary.sourceHealth.ledgerHealthy, false);
  });
}

for (const checkpointName of [
  "outcome-transition-resolved",
  "outcome-control-event-appended",
  "outcome-ledger-appended",
  "outcome-finalized",
]) {
  test(`legacy merged outcome backfill is exact after ${checkpointName}`, () => {
    const dir = temporaryOutcomeStateRoot(
      `freed-legacy-merged-backfill-${checkpointName}-`,
    );
    const paths = automationControlPaths(dir);
    const liveFixture = prepareLiveMergedOutcomeBackfillFixture(dir);
    const { historicalEvent: legacyMergedEvent, task: legacyTask, taskId } =
      liveFixture;
    const nowMs = Date.now();
    const authentication = outcomeAuthentication(
      dir,
      "freed-nightly-runner",
      nowMs,
    );
    const recordedLegacyTask = readTask({ stateRoot: dir, taskId });
    assert.equal(legacyTask.state, "merged");
    assert.equal(legacyTask.revision, 6);
    assert.equal(legacyTask.details.latestOutcome, undefined);
    assert.equal(legacyTask.pendingOutcome, undefined);
    assert.deepEqual(recordedLegacyTask, legacyTask);
    assert.equal(legacyMergedEvent.data.outcomeDigest, undefined);
    assert.equal(legacyMergedEvent.data.outcomeRequired, undefined);

    const mergedInput = {
      id: taskId,
      taskId,
      kind: "stability",
      outcome: "merged",
      notes: `legacy backfill ${checkpointName}`,
      evidenceDigest: "9".repeat(64),
    };
    const mergedNow = new Date(nowMs + 60_000);
    let checkpointReached = false;
    assert.throws(
      () =>
        appendOutcomeLedger(paths.outcomes, mergedInput, {
          ...authentication,
          now: mergedNow,
          checkpoint: (checkpoint) => {
            if (checkpoint === checkpointName && !checkpointReached) {
              checkpointReached = true;
              throw new Error(`simulate legacy backfill loss at ${checkpoint}`);
            }
          },
        }),
      new RegExp(`simulate legacy backfill loss at ${checkpointName}`),
    );
    assert.equal(checkpointReached, true);

    const merged = appendOutcomeLedger(paths.outcomes, mergedInput, {
      ...authentication,
      now: mergedNow,
    });
    const afterMerged = {
      manifest: readFileSync(paths.taskManifest),
      events: readFileSync(paths.events),
      ledger: readFileSync(paths.outcomes),
    };
    assert.deepEqual(
      appendOutcomeLedger(paths.outcomes, mergedInput, {
        ...authentication,
        now: mergedNow,
      }),
      merged,
    );
    assert.deepEqual(readFileSync(paths.taskManifest), afterMerged.manifest);
    assert.deepEqual(readFileSync(paths.events), afterMerged.events);
    assert.deepEqual(readFileSync(paths.outcomes), afterMerged.ledger);

    const mergedTask = readTask({ stateRoot: dir, taskId });
    assert.equal(mergedTask.state, "merged");
    assert.equal(mergedTask.revision, 7);
    assert.equal(mergedTask.mergedAt, legacyTask.mergedAt);
    assert.equal(mergedTask.pendingOutcome, undefined);
    assert.equal(
      mergedTask.details.latestOutcome.outcomeDigest,
      merged.authentication.outcomeDigest,
    );
    const eventsAfterMerged = readFileSync(paths.events, "utf8")
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line) => JSON.parse(line));
    assert.deepEqual(
      eventsAfterMerged.find(
        (event) => event.eventId === legacyMergedEvent.eventId,
      ),
      legacyMergedEvent,
    );
    assert.equal(
      eventsAfterMerged.filter(
        (event) =>
          event.eventId === merged.authentication.transitionEventId &&
          event.type === "outcome_reservation_created" &&
          event.taskId === taskId &&
          event.taskRevision === 7 &&
          event.data?.toState === "merged" &&
          event.data?.outcomeBackfill === true &&
          event.data?.outcomeRequired === true &&
          event.data?.legacyTransitionEventId === legacyMergedEvent.eventId &&
          event.data?.outcomeDigest === merged.authentication.outcomeDigest,
      ).length,
      1,
    );
    assert.equal(
      eventsAfterMerged.filter(
        (event) =>
          event.eventId === merged.authentication.controlEventId &&
          event.type === "outcome_recorded",
      ).length,
      1,
    );
    assert.equal(
      eventsAfterMerged.filter(
        (event) =>
          event.type === "outcome_reservation_finalized" &&
          event.taskId === taskId &&
          event.data?.outcomeDigest === merged.authentication.outcomeDigest,
      ).length,
      1,
    );
    assert.equal(
      summarizeOutcomeLedger(paths.outcomes, { stateRoot: dir }).entries.filter(
        (entry) =>
          entry.taskId === taskId &&
          entry.outcome === "merged" &&
          entry.authentication?.outcomeDigest ===
            merged.authentication.outcomeDigest,
      ).length,
      1,
    );

    const installedIdentity = {
      version: "26.7.1801-dev",
      commitSha: "8".repeat(40),
      channel: "dev",
    };
    appendOutcomeLedger(
      paths.outcomes,
      {
        id: taskId,
        taskId,
        kind: "stability",
        outcome: "installed",
        evidenceDigest: "7".repeat(64),
        installedIdentity,
      },
      {
        ...authentication,
        now: new Date(nowMs + 120_000),
      },
    );
    const installedTask = readTask({ stateRoot: dir, taskId });
    assert.equal(installedTask.state, "installed");
    assert.equal(installedTask.revision, 8);
    assert.deepEqual(installedTask.installedIdentity, installedIdentity);
    assert.equal(installedTask.pendingOutcome, undefined);
  });
}

test("appendOutcomeLedger records closeout entries for future scoring", () => {
  const dir = temporaryOutcomeStateRoot("freed-outcome-append-");
  const ledgerPath = path.join(dir, "outcomes.jsonl");
  const now = new Date("2026-05-29T12:00:00Z");
  const authentication = outcomeAuthentication(
    dir,
    "freed-release-verifier",
    now.getTime(),
  );
  prepareTaskAtState(dir, "webkit-memory-pressure", "soaking", now.getTime(), {
    build: "v26.5.2900-dev",
  });
  const verdictPath = writeOutcomeVerdict(dir, {
    taskId: "webkit-memory-pressure",
    build: "v26.5.2900-dev",
    windowEnd: "2026-05-29T11:59:00Z",
    effect: {
      metric: "worker_inits_per_hour",
      before: 82,
      after: 8,
      delta: -74,
      unit: "events/hour",
    },
  });
  const entryInput = {
    id: "webkit-memory-pressure",
    taskId: "webkit-memory-pressure",
    kind: "performance",
    outcome: "verified_effective",
    notes: "Merged and soaked.",
    pr: "617",
    runDir: "/tmp/nightly-run",
    evidenceWindowEnd: "2026-05-29T11:59:00Z",
    verdictReference: verdictPath,
  };
  const entry = appendOutcomeLedger(ledgerPath, entryInput, {
    ...authentication,
    now,
  });
  const manifestPath = automationControlPaths(dir).taskManifest;
  const interruptedManifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  const interruptedTask = interruptedManifest.tasks.find(
    (task) => task.taskId === "webkit-memory-pressure",
  );
  interruptedTask.pendingOutcome = {
    outcome: entry.outcome,
    outcomeDigest: entry.authentication.outcomeDigest,
    taskRevision: entry.authentication.taskRevision,
  };
  writeFileSync(
    manifestPath,
    `${JSON.stringify(interruptedManifest, null, 2)}\n`,
  );
  const retried = appendOutcomeLedger(ledgerPath, entryInput, {
    ...authentication,
    now: new Date("2026-05-29T12:05:00Z"),
  });

  assert.equal(entry.ts, "2026-05-29T12:00:00.000Z");
  assert.equal(entry.schemaVersion, 3);
  assert.equal(entry.effect.delta, -74);
  assert.equal(entry.authentication.actor, "freed-release-verifier");
  assert.ok(entry.authentication.controlEventId);
  assert.ok(entry.authentication.transitionEventId);
  assert.equal(
    retried.authentication.controlEventId,
    entry.authentication.controlEventId,
  );
  assert.equal(
    readTask({ stateRoot: dir, taskId: "webkit-memory-pressure" })
      .pendingOutcome,
    undefined,
  );
  assert.ok(Number.isInteger(entry.authentication.taskRevision));
  const lines = readFileSync(ledgerPath, "utf8").trim().split("\n");
  assert.equal(lines.length, 1);
  const ledger = summarizeOutcomeLedger(ledgerPath, { stateRoot: dir });
  assert.equal(ledger.byKind.performance.verifiedEffective, 1);
  assert.equal(
    ledger.byId["webkit-memory-pressure"].latestOutcome,
    "verified_effective",
  );
});

test("appendOutcomeLedger rejects unresolved verification evidence", () => {
  const dir = temporaryOutcomeStateRoot("freed-outcome-invalid-");
  const ledgerPath = path.join(dir, "outcomes.jsonl");
  const authentication = outcomeAuthentication(
    dir,
    "freed-release-verifier",
    Date.parse("2026-07-10T13:00:00Z"),
  );
  prepareTaskAtState(
    dir,
    "memory-fix",
    "soaking",
    Date.parse("2026-07-10T13:00:00Z"),
  );

  assert.throws(
    () =>
      appendOutcomeLedger(
        ledgerPath,
        {
          id: "memory-fix",
          taskId: "memory-fix",
          kind: "performance",
          outcome: "verified_effective",
          evidenceWindowEnd: "2026-07-10T12:00:00Z",
          verdictReference: "soak-verdict:missing-effect",
        },
        authentication,
      ),
    /does not resolve/,
  );
  assert.throws(
    () =>
      appendOutcomeLedger(
        ledgerPath,
        {
          id: "memory-fix",
          taskId: "memory-fix",
          kind: "performance",
          outcome: "inconclusive",
          evidenceWindowEnd: "2026-07-10T12:00:00Z",
          verdictReference: "soak-verdict:missing-build",
        },
        authentication,
      ),
    /does not resolve/,
  );
  assert.equal(existsSync(ledgerPath), false);
});

test("verification outcomes bind exact verdict semantics, installed build, and soak window", () => {
  const dir = temporaryOutcomeStateRoot("freed-outcome-contract-");
  const ledgerPath = path.join(dir, "outcomes.jsonl");
  const now = new Date("2026-07-10T13:00:00Z");
  const authentication = outcomeAuthentication(
    dir,
    "freed-release-verifier",
    now.getTime(),
  );
  const entryFor = (taskId, verdictReference, overrides = {}) => ({
    id: taskId,
    taskId,
    kind: "stability",
    outcome: "verified_effective",
    evidenceWindowEnd: "2026-07-10T12:00:00Z",
    verdictReference,
    ...overrides,
  });

  for (const taskId of [
    "wrong-status",
    "wrong-effect",
    "stale-window",
    "wrong-build",
  ]) {
    prepareTaskAtState(dir, taskId, "soaking", now.getTime(), {
      build: "v26.7.100-dev",
    });
  }

  const wrongStatusVerdict = writeOutcomeVerdict(dir, {
    taskId: "wrong-status",
    build: "v26.7.100-dev",
    windowEnd: "2026-07-10T12:00:00Z",
    outcome: "regressed",
  });
  assert.throws(
    () =>
      appendOutcomeLedger(
        ledgerPath,
        entryFor("wrong-status", wrongStatusVerdict),
        { ...authentication, now },
      ),
    /schema, task, status, and outcome/,
  );

  const wrongEffectVerdict = writeOutcomeVerdict(dir, {
    taskId: "wrong-effect",
    build: "v26.7.100-dev",
    windowEnd: "2026-07-10T12:00:00Z",
  });
  assert.throws(
    () =>
      appendOutcomeLedger(
        ledgerPath,
        entryFor("wrong-effect", wrongEffectVerdict, {
          effect: {
            metric: "main-footprint-slope",
            before: 30,
            after: 6,
            unit: "MB/sample-hour",
          },
        }),
        { ...authentication, now },
      ),
    /derived from the referenced verdict, not caller input/,
  );

  const staleWindowVerdict = writeOutcomeVerdict(dir, {
    taskId: "stale-window",
    build: "v26.7.100-dev",
    windowStart: "2026-07-09T19:00:00Z",
    windowEnd: "2026-07-10T01:00:00Z",
  });
  assert.throws(
    () =>
      appendOutcomeLedger(
        ledgerPath,
        entryFor("stale-window", staleWindowVerdict, {
          evidenceWindowEnd: "2026-07-10T01:00:00Z",
        }),
        { ...authentication, now },
      ),
    /must begin after the task entered soaking/,
  );

  const wrongBuildVerdict = writeOutcomeVerdict(dir, {
    taskId: "wrong-build",
    build: "v26.7.101-dev",
    windowEnd: "2026-07-10T12:00:00Z",
  });
  assert.throws(
    () =>
      appendOutcomeLedger(
        ledgerPath,
        entryFor("wrong-build", wrongBuildVerdict),
        { ...authentication, now },
      ),
    /canonical installed build and soak timestamps/,
  );
  assert.equal(existsSync(ledgerPath), false);
});

test("appendOutcomeLedger requires a canonical task at the verification lifecycle gate", () => {
  const dir = temporaryOutcomeStateRoot("freed-outcome-lifecycle-");
  const ledgerPath = path.join(dir, "outcomes.jsonl");
  const now = new Date("2026-07-10T13:00:00Z");
  const authentication = outcomeAuthentication(
    dir,
    "freed-release-verifier",
    now.getTime(),
  );
  const missingVerdict = writeOutcomeVerdict(dir, {
    taskId: "missing-task",
    build: "v26.7.100-dev",
    windowEnd: "2026-07-10T12:00:00Z",
  });

  assert.throws(
    () =>
      appendOutcomeLedger(
        ledgerPath,
        {
          id: "missing-task",
          taskId: "missing-task",
          kind: "stability",
          outcome: "verified_effective",
          evidenceWindowEnd: "2026-07-10T12:00:00Z",
          verdictReference: missingVerdict,
        },
        { ...authentication, now },
      ),
    /does not exist in canonical control state/,
  );

  prepareTaskAtState(dir, "premature-task", "installed", now.getTime());
  const prematureVerdict = writeOutcomeVerdict(dir, {
    taskId: "premature-task",
    build: "v26.7.100-dev",
    windowEnd: "2026-07-10T12:00:00Z",
  });
  assert.throws(
    () =>
      appendOutcomeLedger(
        ledgerPath,
        {
          id: "premature-task",
          taskId: "premature-task",
          kind: "stability",
          outcome: "verified_effective",
          evidenceWindowEnd: "2026-07-10T12:00:00Z",
          verdictReference: prematureVerdict,
        },
        { ...authentication, now },
      ),
    /canonical installed build and soak timestamps/,
  );
  assert.equal(existsSync(ledgerPath), false);
});

test("summarizeOutcomeLedger rejects unsigned and replayed ledger lines", () => {
  const dir = temporaryOutcomeStateRoot("freed-outcome-forged-");
  const ledgerPath = path.join(dir, "outcomes.jsonl");
  const now = new Date("2026-07-10T13:00:00Z");
  const authentication = outcomeAuthentication(
    dir,
    "freed-release-verifier",
    now.getTime(),
  );
  prepareTaskAtState(dir, "trusted-task", "soaking", now.getTime());
  const verdictPath = writeOutcomeVerdict(dir, {
    taskId: "trusted-task",
    build: "v26.7.100-dev",
    windowEnd: "2026-07-10T12:00:00Z",
  });
  const trusted = appendOutcomeLedger(
    ledgerPath,
    {
      id: "trusted-task",
      taskId: "trusted-task",
      kind: "stability",
      outcome: "verified_effective",
      evidenceWindowEnd: "2026-07-10T12:00:00Z",
      verdictReference: verdictPath,
    },
    { ...authentication, now },
  );
  writeFileSync(
    ledgerPath,
    `${JSON.stringify(trusted)}\n${JSON.stringify({
      schemaVersion: 3,
      ts: "2026-07-10T13:01:00Z",
      id: "forged-task",
      taskId: "forged-task",
      kind: "stability",
      outcome: "superseded",
      evidenceWindowEnd: "2026-07-10T12:00:00Z",
      evidence: { digest: "b".repeat(64) },
    })}\n${JSON.stringify(trusted)}\n`,
  );

  const ledger = summarizeOutcomeLedger(ledgerPath, { stateRoot: dir });
  assert.deepEqual(
    ledger.entries.map((entry) => entry.id),
    ["trusted-task"],
  );
  assert.equal(ledger.rejectedEntries.length, 2);
  assert.equal(ledger.sourceHealth.ledgerHealthy, false);
  assert.equal(ledger.byId["forged-task"], undefined);
  assert.equal(
    buildBehavioralTaskGate(
      [{ taskId: "next-behavior", state: "approved_for_pr", behavioral: true }],
      { outcomeLedgerHealthy: ledger.sourceHealth.ledgerHealthy },
    ).status,
    "outcome-history-unhealthy",
  );
});

test("nightly production exports no raw outcome append authority bypass", async () => {
  const module = await import("./nightly-self-improve.mjs");
  assert.equal(Object.hasOwn(module, "appendOutcomeEntryAtomic"), false);
});

test("outcome ledger writer refuses an unverifiable legacy owner after cutover", () => {
  const dir = temporaryOutcomeStateRoot("freed-outcome-lock-");
  const ledgerPath = path.join(dir, "outcomes.jsonl");
  const lockPath = `${ledgerPath}.writer-lock`;
  const lockContents = `${JSON.stringify({ token: "existing-owner", pid: 999 })}\n`;
  writeFileSync(lockPath, lockContents, { mode: 0o600 });

  assert.throws(
    () =>
      withOutcomeLedgerWriterLock(ledgerPath, () => undefined, {
        timeoutMs: 0,
        wait: () => {},
      }),
    /cutover is incomplete/,
  );
  assert.equal(readFileSync(lockPath, "utf8"), lockContents);
  assert.equal(existsSync(ledgerPath), false);
});

test("outcome ledger writer requires the permanent cutover marker", () => {
  const dir = temporaryOutcomeStateRoot("freed-outcome-lock-recovery-");
  const ledgerPath = path.join(dir, "outcomes.jsonl");
  const lockPath = `${ledgerPath}.writer-lock`;
  const lockContents = `${JSON.stringify({
    schemaVersion: 1,
    token: "dead-owner",
    pid: 2_147_483_647,
    processStartIdentity: "darwin:expired-process",
    acquiredAt: "2026-07-10T00:00:00.000Z",
  })}\n`;
  writeFileSync(lockPath, lockContents, { mode: 0o600 });

  assert.throws(
    () =>
      withOutcomeLedgerWriterLock(ledgerPath, () => undefined, {
        timeoutMs: 0,
        wait: () => {},
      }),
    /cutover is incomplete/,
  );
  assert.equal(readFileSync(lockPath, "utf8"), lockContents);
  assert.equal(existsSync(ledgerPath), false);

  rmSync(lockPath);
  installAutomationKernelGuardCutoverFixture(dir);
  withOutcomeLedgerWriterLock(ledgerPath, () => undefined, {
    timeoutMs: 0,
    wait: () => {},
  });

  assert.equal(existsSync(ledgerPath), false);
  assert.deepEqual(readFileSync(lockPath), automationKernelGuardMarkerBytes());
});

test("risk snapshot reports dirty worktrees, generated artifacts, stale soak, and paused automation", () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "freed-risk-snapshot-"));
  const reportDir = path.join(dir, "packages/desktop/playwright-report");
  mkdirSync(reportDir, { recursive: true });
  writeFileSync(path.join(reportDir, "index.html"), "<html></html>");
  mkdirSync(path.join(dir, "node_modules"), { recursive: true });
  const automationPath = path.join(dir, "automation.toml");
  writeFileSync(automationPath, 'status = "PAUSED"\n');
  const nowMs = Date.parse("2026-05-29T12:00:00Z");

  const snapshot = collectRiskSnapshot({
    repoPath: dir,
    repo: {
      status:
        " M scripts/nightly-self-improve.mjs\n?? packages/desktop/test-results/out.txt",
    },
    soak: {
      exists: true,
      soakDir: "/tmp/freed-soak",
      sampleCount: 10,
      lastTimestamp: "2026-05-29T09:00:00Z",
    },
    peerWorktrees: [
      {
        branch: "perf/nightly-peer",
        path: "/tmp/peer",
        status: " M scripts/nightly-self-improve.mjs",
        behindCount: 40,
      },
    ],
    crashAutomation: automationPath,
    dailyBugMemory: path.join(dir, "missing-memory.md"),
    devBotMemory: path.join(dir, "missing-dev-bot.md"),
    expectedBranch: "",
    nowMs,
  });

  assert.equal(snapshot.blockerCount, 1);
  assert.ok(snapshot.warningCount >= 4);
  assert.ok(snapshot.actionCount >= 4);
  assert.ok(
    snapshot.risks.some((risk) => risk.id === "dirty-current-worktree"),
  );
  assert.ok(snapshot.risks.some((risk) => risk.id === "stale-soak-evidence"));
  assert.ok(snapshot.risks.some((risk) => risk.id === "paused-crash-watch"));
  assert.ok(
    snapshot.risks
      .find(
        (risk) =>
          risk.id === "generated-artifacts-packages-desktop-playwright-report",
      )
      ?.actions.some((action) => action.kind === "local-command"),
  );
  assert.ok(
    snapshot.risks
      .find((risk) => risk.id === "paused-crash-watch")
      ?.actions.some((action) => action.kind === "automation-update"),
  );
});

test("risk snapshot blocks nightly planning from the wrong branch", () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "freed-branch-risk-"));
  mkdirSync(path.join(dir, "node_modules"), { recursive: true });
  const snapshot = collectRiskSnapshot({
    repoPath: dir,
    repo: {
      branch: "main",
      head: "abc1234",
      originDev: "def5678",
      status: "",
    },
    soak: { exists: false },
    crashAutomation: "",
    dailyBugMemory: "",
    devBotMemory: "",
    expectedBranch: "dev",
  });

  const risk = snapshot.risks.find(
    (item) => item.id === "unexpected-repo-branch",
  );
  assert.ok(snapshot.blockerCount >= 1);
  assert.equal(risk?.severity, "blocker");
  assert.ok(
    risk?.actions.some((action) => action.id === "rerun-from-dev-worktree"),
  );
});

test("risk snapshot warns when the dev worktree is stale", () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "freed-stale-dev-risk-"));
  mkdirSync(path.join(dir, "node_modules"), { recursive: true });
  const snapshot = collectRiskSnapshot({
    repoPath: dir,
    repo: {
      branch: "dev",
      head: "abc1234",
      originDev: "def5678",
      status: "",
    },
    soak: { exists: false },
    crashAutomation: "",
    dailyBugMemory: "",
    devBotMemory: "",
    expectedBranch: "dev",
  });

  const risk = snapshot.risks.find((item) => item.id === "stale-dev-worktree");
  assert.equal(
    snapshot.risks.some((item) => item.id === "unexpected-repo-branch"),
    false,
  );
  assert.equal(risk?.severity, "warning");
  assert.ok(
    risk?.actions.some((action) => action.id === "refresh-dev-worktree"),
  );
});

test("risk snapshot allows detached HEAD when it matches origin/dev", () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "freed-detached-dev-risk-"));
  mkdirSync(path.join(dir, "node_modules"), { recursive: true });
  const snapshot = collectRiskSnapshot({
    repoPath: dir,
    repo: {
      branch: "HEAD",
      head: "abc1234",
      originDev: "abc1234",
      originMain: "def5678",
      status: "",
    },
    soak: { exists: false },
    crashAutomation: "",
    dailyBugMemory: "",
    devBotMemory: "",
    expectedBranch: "dev",
  });

  assert.equal(
    snapshot.risks.some((item) => item.id === "unexpected-repo-branch"),
    false,
  );
  assert.equal(
    snapshot.risks.some((item) => item.id === "stale-dev-worktree"),
    false,
  );
});

test("writeRunPlan emits report, targets, and task prompts", () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "freed-nightly-plan-"));
  const selected = [
    {
      id: "daily-bug-fix-scan",
      taskId: "daily-bug-fix-scan",
      kind: "bug-fix",
      title: "Run evidence-backed nightly bug fix scan",
      score: 82,
      confidence: 0.86,
      estimatedMinutes: 90,
      providerVisible: false,
      rationale: "Fresh commits need review.",
      evidence: ["/tmp/memory.md"],
      prompt: "Inspect commits and fix only evidence-backed bugs.",
      validation: ["Run focused tests."],
    },
    {
      id: "nightly-preflight-risk",
      taskId: "nightly-preflight-risk",
      kind: "scaffolding",
      title: "Inspect an unregistered preflight finding",
      score: 70,
      confidence: 0.8,
      estimatedMinutes: 30,
      providerVisible: false,
      rationale: "The finding needs control-plane registration.",
      evidence: ["/tmp/risk.json"],
      prompt: "Stop until the controller registers this task.",
      validation: ["Confirm no executable outcome command was emitted."],
    },
  ];

  const result = writeRunPlan({
    runDir: dir,
    repo: { branch: "feature", head: "abc1234" },
    soak: {
      soakDir: "/tmp/soak",
      sampleCount: 10,
      maxWebKitResidentBytes: 3 * GIB,
      maxEventLoopLagMs: 4,
      maxDomNodes: 500,
      staleHeartbeatCount: 0,
      throttledHeartbeatCount: 0,
    },
    candidates: selected,
    selected,
    options: {
      durationMinutes: 480,
      behaviorGate: {
        status: "awaiting-soak-outcome",
        authorizedTaskId: null,
        activeTasks: [{ taskId: "P1-01", state: "soaking", revision: 7 }],
      },
      canonicalTaskIds: ["daily-bug-fix-scan"],
    },
  });

  assert.equal(path.basename(result.reportPath), "report.md");
  assert.equal(path.basename(result.tasksDir), "tasks");
  assert.equal(path.basename(result.riskSnapshotPath), "risk-snapshot.md");
  assert.equal(
    path.basename(result.preflightActionsPath),
    "preflight-actions.md",
  );
  assert.equal(path.basename(result.duplicateWorkPath), "duplicate-work.md");
  assert.equal(path.basename(result.executionPlanPath), "execution-plan.md");
  assert.equal(
    path.basename(result.outcomeCloseoutPath),
    "outcome-closeout.md",
  );
  assert.equal(
    path.basename(result.outcomeTemplatePath),
    "outcome-template.jsonl",
  );

  const report = readFileSync(result.reportPath, "utf8");
  const task = readFileSync(
    path.join(result.tasksDir, "01-daily-bug-fix-scan.md"),
    "utf8",
  );
  const closeout = readFileSync(result.outcomeCloseoutPath, "utf8");
  const targets = JSON.parse(
    readFileSync(path.join(dir, "targets.json"), "utf8"),
  );
  const outcomeTemplate = JSON.parse(
    readFileSync(result.outcomeTemplatePath, "utf8").trim(),
  );
  assert.match(report, /Unattended App Interaction/);
  assert.match(report, /Behavioral Soak Gate/);
  assert.match(report, /P1-01 in soaking/);
  assert.match(task, /10 minute response window/);
  assert.match(closeout, /terminal trigger/);
  assert.match(closeout, /--actor freed-nightly-runner/);
  assert.match(closeout, /--lease-name nightly-writer/);
  assert.doesNotMatch(closeout, /--lease-token/);
  assert.match(closeout, /--evidence-digest \"<merged-head-or-diff-digest>\"/);
  assert.match(closeout, /Outcome command unavailable/);
  assert.deepEqual(targets.behaviorGate, {
    status: "awaiting-soak-outcome",
    authorizedTaskId: null,
    activeTasks: [{ taskId: "P1-01", state: "soaking", revision: 7 }],
  });
  assert.equal(outcomeTemplate.taskId, "daily-bug-fix-scan");
  assert.doesNotMatch(
    readFileSync(result.outcomeTemplatePath, "utf8"),
    /nightly-preflight-risk/,
  );
});

test("writeRunPlan emits an empty JSONL file when no outcome command is eligible", () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "freed-nightly-empty-plan-"));
  const result = writeRunPlan({
    runDir: dir,
    repo: { branch: "feature", head: "abc1234" },
    soak: {
      soakDir: "",
      sampleCount: 0,
      maxWebKitResidentBytes: null,
      maxEventLoopLagMs: null,
      maxDomNodes: null,
      staleHeartbeatCount: 0,
      throttledHeartbeatCount: 0,
    },
    candidates: [],
    selected: [],
    options: { durationMinutes: 480, canonicalTaskIds: [] },
  });

  assert.equal(readFileSync(result.outcomeTemplatePath, "utf8"), "");
});

test("execution plan includes peer review and release soak gates", () => {
  const phases = buildExecutionPlan([
    {
      id: "peer-perf-scraper-recycle-verification",
      kind: "peer-worktree",
      title: "Review and incorporate peer worktree perf/scraper-recycle",
      providerVisible: false,
      prompt: "Review peer work.",
    },
    {
      id: "webkit-memory-pressure",
      kind: "performance",
      prompt: "Reduce WebKit memory.",
    },
  ]);

  assert.equal(phases[0].id, "strict-machine-preflight");
  assert.deepEqual(phases[0].commands, ["node scripts/doctor.mjs --strict"]);
  assert.ok(
    phases
      .filter((phase) => phase.mutates)
      .every((phase) => phase.requires.includes("strict-machine-preflight")),
  );
  assert.ok(phases.some((phase) => phase.id === "peer-review"));
  assert.ok(phases.some((phase) => phase.id === "release-and-soak"));
  assert.ok(phases.every((phase) => phase.stopGate));
  const publish = phases.find((phase) => phase.id === "publish");
  assert.equal(publish?.closeout, "ready");
  assert.match(
    publish?.commands[0] ?? "",
    /^\.\/scripts\/worktree-publish\.sh /,
  );
  assert.match(
    publish?.commands[0] ?? "",
    /--title "chore: review and incorporate peer worktree perf\/scraper-recycle"/,
  );
  assert.match(publish?.commands[0] ?? "", / --ready$/);
  assert.ok(
    phases
      .find((phase) => phase.id === "release-and-soak")
      ?.commands.some((command) => command.includes("dev-sync-trigger.mjs")),
  );

  const providerPublish = buildExecutionPlan([
    {
      id: "linkedin-sync-recovery",
      kind: "stability",
      title: "Fix LinkedIn sync recovery",
      providerVisible: true,
      prompt: "Wait for provider approval.",
    },
  ]).find((phase) => phase.id === "publish");
  assert.equal(providerPublish?.closeout, "draft");
  assert.doesNotMatch(providerPublish?.commands[0] ?? "", /--ready/);
  assert.match(providerPublish?.stopGate ?? "", /provider-risk approval/);
  assert.equal(
    deriveCandidatePrTitle({
      id: "unsafe",
      kind: "bug-fix",
      title: "Fix renderer $(touch /tmp/pwned) `whoami`",
    }),
    "fix: renderer (touch /tmp/pwned) whoami",
  );
});

test("strict machine preflight failure stops record-outcome mutation", () => {
  assert.throws(
    () =>
      runNightlyMachinePreflight({
        strict: true,
        exec: () => {
          throw new Error("doctor failed");
        },
      }),
    /No mutation phase was started/,
  );

  const stateRoot = mkdtempSync(
    path.join(os.tmpdir(), "freed-preflight-stop-"),
  );
  let strict = false;
  assert.throws(
    () =>
      main(
        [
          "--automation-state-root",
          stateRoot,
          "--outcome-ledger",
          path.join(stateRoot, "outcomes.jsonl"),
          "--record-outcome",
          "blocked-before-write",
          "--record-kind",
          "stability",
          "--record-task-id",
          "blocked-before-write",
          "--record-status",
          "merged",
          "--record-actor",
          "freed-nightly-runner",
          "--record-lease-name",
          "nightly-writer",
          "--record-lease-token",
          "token",
          "--record-evidence-digest",
          "a".repeat(64),
        ],
        {
          runPreflight: ({ strict: requestedStrict }) => {
            strict = requestedStrict;
            throw new Error("strict doctor blocked mutation");
          },
        },
      ),
    /strict doctor blocked mutation/,
  );
  assert.equal(strict, true);
  assert.equal(existsSync(path.join(stateRoot, "outcomes.jsonl")), false);
  assert.equal(
    existsSync(automationControlPaths(stateRoot).taskManifest),
    false,
  );
});

test("argument parsing validates numeric budgets", () => {
  assert.throws(() => parseArgs(["--max-targets", "0"]), /maxTargets/);
  assert.throws(
    () => parseArgs(["--allow-provider-visible"]),
    /authenticated provider review lane/,
  );
  assert.throws(() => parseArgs(["--record-outcome", "target"]), /record-kind/);
  assert.throws(
    () =>
      parseArgs([
        "--record-outcome",
        "target",
        "--record-kind",
        "performance",
        "--record-status",
        "maybe",
      ]),
    /record-status/,
  );
  assert.equal(parseArgs(["--memory-gib", "3"]).memoryGib, 3);
  assert.equal(parseArgs([]).expectedBranch, "dev");
  assert.equal(parseArgs([]).maxTargets, 6);
  assert.equal(parseArgs([]).minimumNightMinutes, 180);
  assert.equal(
    parseArgs(["--expected-branch", "release"]).expectedBranch,
    "release",
  );
  assert.equal(parseArgs(["--no-expected-branch"]).expectedBranch, "");
  assert.equal(
    parseArgs(["--minimum-night-minutes", "210"]).minimumNightMinutes,
    210,
  );
  const customStateRoot = path.join(os.tmpdir(), "freed-nightly-custom-state");
  assert.equal(
    parseArgs(["--automation-state-root", customStateRoot]).outcomeLedger,
    path.join(customStateRoot, "outcomes.jsonl"),
  );
  assert.throws(
    () =>
      parseArgs([
        "--automation-state-root",
        customStateRoot,
        "--outcome-ledger",
        path.join(customStateRoot, "alternate.jsonl"),
      ]),
    /canonical state-root ledger/,
  );
  assert.throws(
    () => parseArgs(["--expected-branch", "bad branch"]),
    /expected-branch/,
  );
  assert.throws(
    () =>
      parseArgs([
        "--duration-minutes",
        "120",
        "--minimum-night-minutes",
        "180",
      ]),
    /minimumNightMinutes/,
  );
  assert.equal(
    parseArgs(["--soak-pointer", "/tmp/pointer"]).soakPointer,
    "/tmp/pointer",
  );
  assert.equal(parseArgs(["--repair-soak-pointer"]).repairSoakPointer, true);
  assert.throws(
    () => parseArgs(["--repair-soak-pointer", "--soak-dir", "/tmp/soak"]),
    /repair-soak-pointer/,
  );
  assert.throws(
    () =>
      parseArgs([
        "--record-outcome",
        "target",
        "--record-kind",
        "performance",
        "--record-status",
        "verified_effective",
      ]),
    /requires record-actor, record-lease-name, and record-lease-token/,
  );
  assert.equal(
    parseArgs([
      "--record-outcome",
      "target",
      "--record-kind",
      "performance",
      "--record-task-id",
      "P1-01",
      "--record-status",
      "verified_effective",
      "--record-actor",
      "freed-release-verifier",
      "--record-lease-name",
      "release-verifier",
      "--record-lease-token",
      "token",
      "--record-verdict-reference",
      "soak-verdict:test",
    ]).recordStatus,
    "verified_effective",
  );
  assert.equal(
    parseArgs(["--peer-worktree", "/tmp/peer", "--no-peer-scan"]).peerScan,
    false,
  );
});

test("formatBytes uses GiB with grouped decimal output", () => {
  assert.equal(formatBytes(3.25 * GIB), "3.3 GiB");
});

test("parseTsv maps headers to row fields", () => {
  assert.deepEqual(parseTsv("a\tb\n1\t2\n"), [{ a: "1", b: "2" }]);
});
