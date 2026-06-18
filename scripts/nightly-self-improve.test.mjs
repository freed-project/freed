import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  assessSoakEvidenceQuality,
  applyOutcomeFeedback,
  appendOutcomeLedger,
  buildCandidates,
  buildExecutionPlan,
  collectDuplicateWork,
  collectPeerWorktrees,
  collectRepoSnapshot,
  collectRiskSnapshot,
  findLatestReadableSoakDir,
  formatBytes,
  parseArgs,
  parseGitWorktreePorcelain,
  parseTsv,
  repairSoakPointer,
  resolveReadableSoak,
  selectTargets,
  shouldRetainPeerWorktree,
  summarizePeerWorktree,
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
  assert.equal(readFileSync(pointerPath, "utf8").trim(), realpathSync(readableDir));
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
  const dir = mkdtempSync(path.join(os.tmpdir(), "freed-bug-memory-continuation-"));
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
    selected.reduce((total, candidate) => total + candidate.estimatedMinutes, 0),
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

  assert.ok(!candidates.some((candidate) => candidate.id === "webkit-memory-pressure"));
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
        risk.evidence.includes("packages/desktop/src-tauri/src/fb-extract.js") &&
        risk.actions.some((action) => action.id === "request-provider-visible-approval"),
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
  assert.ok(duplicateWork.findings.some((finding) => finding.kind === "file-overlap"));
  assert.ok(duplicateWork.findings.some((finding) => finding.key === "nightly-runner"));
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
  execFileSync("git", ["-C", repo, "config", "user.email", "tests@example.com"]);
  execFileSync("git", ["-C", repo, "checkout", "-b", "dev"]);
  writeFileSync(path.join(repo, "notes.txt"), "first\n");
  execFileSync("git", ["-C", repo, "add", "notes.txt"]);
  execFileSync("git", ["-C", repo, "commit", "-m", "first"]);
  const firstHead = execFileSync("git", ["-C", repo, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
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
  execFileSync("git", ["-C", repo, "config", "user.email", "tests@example.com"]);
  execFileSync("git", ["-C", repo, "checkout", "-b", "dev"]);
  mkdirSync(path.join(repo, "scripts"), { recursive: true });
  mkdirSync(path.join(repo, "docs"), { recursive: true });
  writeFileSync(path.join(repo, "scripts/nightly-self-improve.mjs"), "export const value = 1;\n");
  writeFileSync(path.join(repo, "docs/NIGHTLY-SELF-IMPROVE.md"), "# Nightly\n");
  execFileSync("git", ["-C", repo, "add", "scripts/nightly-self-improve.mjs", "docs/NIGHTLY-SELF-IMPROVE.md"]);
  execFileSync("git", ["-C", repo, "commit", "-m", "base"]);
  execFileSync("git", ["-C", repo, "push", "-u", "origin", "dev"]);

  execFileSync("git", ["clone", origin, peer]);
  execFileSync("git", ["-C", peer, "checkout", "-b", "fix/nightly-small-batch", "origin/dev"]);

  for (let index = 0; index < 30; index += 1) {
    writeFileSync(path.join(repo, "notes.txt"), `commit ${index}\n`);
    execFileSync("git", ["-C", repo, "add", "notes.txt"]);
    execFileSync("git", ["-C", repo, "commit", "-m", `advance ${index}`]);
  }
  execFileSync("git", ["-C", repo, "push"]);
  execFileSync("git", ["-C", peer, "fetch", "origin", "dev"]);
  writeFileSync(path.join(peer, "scripts/nightly-self-improve.mjs"), "export const value = 2;\n");

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
    duplicateWork: { findingCount: 0, blockerCount: 0, warningCount: 0, findings: [] },
    peerWorktrees: peers,
    crashAutomationExists: false,
    devBotMemoryExists: false,
    memoryBudgetBytes: 2.5 * GIB,
  });

  assert.equal(candidates[0].id, "daily-bug-fix-scan");
  assert.equal(candidates[1].id, "peer-fix-nightly-small-batch");
});

test("collectPeerWorktrees ignores peers with only generated validation artifacts", () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "freed-peer-artifacts-"));
  const origin = path.join(dir, "origin.git");
  const repo = path.join(dir, "repo");
  const peer = path.join(dir, "peer");

  execFileSync("git", ["init", "--bare", origin]);
  execFileSync("git", ["clone", origin, repo]);
  execFileSync("git", ["-C", repo, "config", "user.name", "Freed Tests"]);
  execFileSync("git", ["-C", repo, "config", "user.email", "tests@example.com"]);
  execFileSync("git", ["-C", repo, "checkout", "-b", "dev"]);
  writeFileSync(path.join(repo, "notes.txt"), "first\n");
  execFileSync("git", ["-C", repo, "add", "notes.txt"]);
  execFileSync("git", ["-C", repo, "commit", "-m", "first"]);
  execFileSync("git", ["-C", repo, "push", "-u", "origin", "dev"]);

  execFileSync("git", ["clone", origin, peer]);
  execFileSync("git", ["-C", peer, "checkout", "-b", "chore/nightly-peer", "origin/dev"]);
  mkdirSync(path.join(peer, "packages/desktop/playwright-report"), { recursive: true });
  mkdirSync(path.join(peer, "packages/desktop/test-results"), { recursive: true });
  writeFileSync(path.join(peer, "packages/desktop/playwright-report/index.html"), "<html></html>");
  writeFileSync(path.join(peer, "packages/desktop/test-results/out.txt"), "artifact\n");

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

  assert.ok(candidates.findIndex((candidate) => candidate.id === "nightly-duplicate-work") >= 0);
  assert.ok(
    candidates.findIndex((candidate) => candidate.id === "nightly-duplicate-work") <
      candidates.findIndex((candidate) => candidate.id === "roadmap-autonomous-task"),
  );
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

test("appendOutcomeLedger records closeout entries for future scoring", () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "freed-outcome-append-"));
  const ledgerPath = path.join(dir, "outcomes.jsonl");
  const entry = appendOutcomeLedger(
    ledgerPath,
    {
      id: "webkit-memory-pressure",
      kind: "performance",
      outcome: "shipped",
      notes: "Merged and soaked.",
      pr: "617",
      build: "v26.5.2900-dev",
      runDir: "/tmp/nightly-run",
    },
    new Date("2026-05-29T12:00:00Z"),
  );

  assert.equal(entry.ts, "2026-05-29T12:00:00.000Z");
  const lines = readFileSync(ledgerPath, "utf8").trim().split("\n");
  assert.equal(lines.length, 1);
  const ledger = summarizeOutcomeLedger(ledgerPath);
  assert.equal(ledger.byKind.performance.shipped, 1);
  assert.equal(ledger.byId["webkit-memory-pressure"].shipped, 1);
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
    expectedBranch: "",
    nowMs,
  });

  assert.equal(snapshot.blockerCount, 1);
  assert.ok(snapshot.warningCount >= 4);
  assert.ok(snapshot.actionCount >= 4);
  assert.ok(snapshot.risks.some((risk) => risk.id === "dirty-current-worktree"));
  assert.ok(snapshot.risks.some((risk) => risk.id === "stale-soak-evidence"));
  assert.ok(snapshot.risks.some((risk) => risk.id === "paused-crash-watch"));
  assert.ok(
    snapshot.risks
      .find((risk) => risk.id === "generated-artifacts-packages-desktop-playwright-report")
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

  const risk = snapshot.risks.find((item) => item.id === "unexpected-repo-branch");
  assert.ok(snapshot.blockerCount >= 1);
  assert.equal(risk?.severity, "blocker");
  assert.ok(risk?.actions.some((action) => action.id === "rerun-from-dev-worktree"));
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
  assert.equal(snapshot.risks.some((item) => item.id === "unexpected-repo-branch"), false);
  assert.equal(risk?.severity, "warning");
  assert.ok(risk?.actions.some((action) => action.id === "refresh-dev-worktree"));
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

  assert.equal(snapshot.risks.some((item) => item.id === "unexpected-repo-branch"), false);
  assert.equal(snapshot.risks.some((item) => item.id === "stale-dev-worktree"), false);
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
  assert.equal(path.basename(result.preflightActionsPath), "preflight-actions.md");
  assert.equal(path.basename(result.duplicateWorkPath), "duplicate-work.md");
  assert.equal(path.basename(result.executionPlanPath), "execution-plan.md");
  assert.equal(path.basename(result.outcomeCloseoutPath), "outcome-closeout.md");
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
  assert.equal(parseArgs(["--expected-branch", "release"]).expectedBranch, "release");
  assert.equal(parseArgs(["--no-expected-branch"]).expectedBranch, "");
  assert.equal(parseArgs(["--minimum-night-minutes", "210"]).minimumNightMinutes, 210);
  assert.throws(() => parseArgs(["--expected-branch", "bad branch"]), /expected-branch/);
  assert.throws(
    () => parseArgs(["--duration-minutes", "120", "--minimum-night-minutes", "180"]),
    /minimumNightMinutes/,
  );
  assert.equal(parseArgs(["--soak-pointer", "/tmp/pointer"]).soakPointer, "/tmp/pointer");
  assert.equal(parseArgs(["--repair-soak-pointer"]).repairSoakPointer, true);
  assert.throws(
    () => parseArgs(["--repair-soak-pointer", "--soak-dir", "/tmp/soak"]),
    /repair-soak-pointer/,
  );
  assert.equal(
    parseArgs([
      "--record-outcome",
      "target",
      "--record-kind",
      "performance",
      "--record-status",
      "shipped",
    ]).recordStatus,
    "shipped",
  );
  assert.equal(parseArgs(["--peer-worktree", "/tmp/peer", "--no-peer-scan"]).peerScan, false);
});

test("formatBytes uses GiB with grouped decimal output", () => {
  assert.equal(formatBytes(3.25 * GIB), "3.3 GiB");
});

test("parseTsv maps headers to row fields", () => {
  assert.deepEqual(parseTsv("a\tb\n1\t2\n"), [{ a: "1", b: "2" }]);
});
