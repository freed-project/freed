import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  applyOutcomeFeedback,
  buildCandidates,
  buildExecutionPlan,
  collectRepoSnapshot,
  collectRiskSnapshot,
  formatBytes,
  parseArgs,
  parseGitWorktreePorcelain,
  parseTsv,
  selectTargets,
  summarizeOutcomeLedger,
  summarizeDailyBugMemory,
  summarizeSoak,
  writeRunPlan,
} from "./nightly-self-improve.mjs";

const GIB = 1024 * 1024 * 1024;

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

test("candidate selection prioritizes memory work while preserving bug scans", () => {
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
  });

  assert.equal(selected[0].id, "webkit-memory-pressure");
  assert.ok(selected.some((candidate) => candidate.id === "daily-bug-fix-scan"));
  assert.ok(!selected.some((candidate) => candidate.providerVisible));
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
  });

  assert.equal(selected[0].id, "nightly-preflight-risk");
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
  execFileSync("git", ["config", "user.email", "test@example.com"], { cwd: dir });
  execFileSync("git", ["config", "user.name", "Test"], { cwd: dir });
  mkdirSync(path.join(dir, "docs"), { recursive: true });
  writeFileSync(path.join(dir, "docs/example.md"), "one\n");
  execFileSync("git", ["add", "docs/example.md"], { cwd: dir });
  execFileSync("git", ["commit", "-m", "test"], { cwd: dir });
  writeFileSync(path.join(dir, "docs/example.md"), "two\n");

  const snapshot = collectRepoSnapshot(dir);
  assert.match(snapshot.status, /^ M docs\/example\.md$/);
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
  });

  assert.equal(selected[0].kind, "peer-worktree");
  assert.equal(selected[0].providerVisible, false);
});

test("outcome feedback raises shipped target kinds and lowers failed ones", () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "freed-outcomes-"));
  const ledgerPath = path.join(dir, "outcomes.jsonl");
  writeFileSync(
    ledgerPath,
    [
      JSON.stringify({ id: "webkit-memory-pressure", kind: "performance", outcome: "shipped" }),
      JSON.stringify({ id: "daily-bug-fix-scan", kind: "bug-fix", outcome: "failed" }),
      "",
    ].join("\n"),
  );

  const ledger = summarizeOutcomeLedger(ledgerPath);
  const adjusted = applyOutcomeFeedback(
    [
      { id: "webkit-memory-pressure", kind: "performance", score: 80 },
      { id: "daily-bug-fix-scan", kind: "bug-fix", score: 80 },
    ],
    ledger,
  );

  assert.equal(ledger.entries.length, 2);
  assert.equal(adjusted[0].id, "webkit-memory-pressure");
  assert.ok(adjusted[0].score > adjusted[1].score);
  assert.equal(adjusted[1].outcomeFeedback.failed, 2);
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
      status: " M scripts/nightly-self-improve.mjs\n?? packages/desktop/test-results/out.txt",
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
    nowMs,
  });

  assert.equal(snapshot.blockerCount, 1);
  assert.ok(snapshot.warningCount >= 4);
  assert.ok(snapshot.risks.some((risk) => risk.id === "dirty-current-worktree"));
  assert.ok(snapshot.risks.some((risk) => risk.id === "stale-soak-evidence"));
  assert.ok(snapshot.risks.some((risk) => risk.id === "paused-crash-watch"));
});

test("writeRunPlan emits report, targets, and task prompts", () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "freed-nightly-plan-"));
  const selected = [
    {
      id: "daily-bug-fix-scan",
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
    options: { durationMinutes: 480 },
  });

  assert.equal(path.basename(result.reportPath), "report.md");
  assert.equal(path.basename(result.tasksDir), "tasks");
  assert.equal(path.basename(result.riskSnapshotPath), "risk-snapshot.md");
  assert.equal(path.basename(result.executionPlanPath), "execution-plan.md");
  assert.equal(path.basename(result.outcomeTemplatePath), "outcome-template.jsonl");
});

test("execution plan includes peer review and release soak gates", () => {
  const phases = buildExecutionPlan([
    {
      id: "peer-perf-scraper-recycle-verification",
      kind: "peer-worktree",
      prompt: "Review peer work.",
    },
    {
      id: "webkit-memory-pressure",
      kind: "performance",
      prompt: "Reduce WebKit memory.",
    },
  ]);

  assert.ok(phases.some((phase) => phase.id === "peer-review"));
  assert.ok(phases.some((phase) => phase.id === "release-and-soak"));
  assert.ok(phases.every((phase) => phase.stopGate));
});

test("argument parsing validates numeric budgets", () => {
  assert.throws(() => parseArgs(["--max-targets", "0"]), /maxTargets/);
  assert.equal(parseArgs(["--memory-gib", "3"]).memoryGib, 3);
  assert.equal(parseArgs(["--peer-worktree", "/tmp/peer", "--no-peer-scan"]).peerScan, false);
});

test("formatBytes uses GiB with grouped decimal output", () => {
  assert.equal(formatBytes(3.25 * GIB), "3.3 GiB");
});

test("parseTsv maps headers to row fields", () => {
  assert.deepEqual(parseTsv("a\tb\n1\t2\n"), [{ a: "1", b: "2" }]);
});
