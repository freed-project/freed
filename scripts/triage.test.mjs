import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, readdirSync, utimesSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  aggregateAlarms,
  buildCandidates,
  emitCandidates,
  renderTaskFile,
} from "./triage.mjs";
import { buildCandidates as buildNightlyCandidates, loadTriageCandidates } from "./nightly-self-improve.mjs";

const NOW = Date.parse("2026-07-09T08:00:00Z");

function healthEntry(entry, line = 1) {
  return { entry, file: "runtime-health-20260709.jsonl", line };
}

/** Minimal valid buildCandidates inputs, mirroring nightly-self-improve.test.mjs. */
function nightlyInputs() {
  return {
    soak: {
      exists: true,
      soakDir: "/tmp/example-soak",
      sampleCount: 20,
      maxWebKitResidentBytes: 1024 ** 3,
      maxEventLoopLagMs: 9,
      maxDomNodes: 600,
      staleHeartbeatCount: 0,
      throttledHeartbeatCount: 0,
      lastEvent: "renderer_heartbeat",
    },
    dailyBug: {
      exists: true,
      path: "/tmp/memory.md",
      latestDate: "2026-07-08",
      latestHadNoNewCommits: false,
      latestHadFix: false,
    },
    repo: {
      branch: "dev",
      head: "abc1234",
      originDev: "abc1234",
      originMain: "0000000",
      status: "",
    },
    peerWorktrees: [],
    crashAutomationExists: true,
    devBotMemoryExists: true,
    memoryBudgetBytes: 8 * 1024 ** 3,
  };
}

test("alarm aggregation groups by name with capped evidence pointers", () => {
  const entries = [];
  for (let i = 0; i < 8; i += 1) {
    entries.push(
      healthEntry(
        { event: "invariant_alarm", name: "cloud_loop", detail: `burst ${i}`, tsMs: NOW - i * 1000 },
        i + 1,
      ),
    );
  }
  entries.push(healthEntry({ event: "invariant_alarm", name: "preflight_kill", detail: "held", tsMs: NOW }, 99));
  entries.push(healthEntry({ event: "renderer_heartbeat", tsMs: NOW }, 100));

  const alarms = aggregateAlarms(entries);
  assert.equal(alarms.cloud_loop.count, 8);
  assert.equal(alarms.cloud_loop.evidence.length, 5, "evidence pointers are capped");
  assert.equal(alarms.preflight_kill.count, 1);
  assert.equal(alarms.preflight_kill.evidence[0].line, 99);
});

test("a synthetic alarm aggregate + failed verdict produce ranked task files with evidence pointers", () => {
  const alarms = {
    cloud_loop: {
      count: 7,
      lastTsMs: NOW - 3_600_000,
      evidence: [{ file: "runtime-health-20260709.jsonl", line: 42, detail: "5 uploads unchanged heads" }],
    },
    auth_zombie: {
      count: 1,
      lastTsMs: NOW - 3_600_000,
      evidence: [{ file: "runtime-health-20260709.jsonl", line: 50, detail: "linkedin ok-empty x3" }],
    },
  };
  const verdictInfo = {
    verdictPath: "/soak/soak-verdict.json",
    verdict: {
      windowEnd: new Date(NOW - 3_600_000).toISOString(),
      assertions: [
        { id: "uploads_unchanged_heads", status: "fail", detail: "98 of 102 uploads had unchanged heads" },
        { id: "renderer_recoveries", status: "pass", detail: "0 events" },
      ],
    },
  };
  const canaryInfo = {
    file: "/repo/canary-ledger/canary-26.7.800.json",
    record: {
      version: "26.7.800",
      windowEnd: new Date(NOW - 3_600_000).toISOString(),
      regressions: [{ metric: "workerInitsPerHour", current: 40, trailingMedian: 10, limit: 15 }],
    },
  };

  const ranked = buildCandidates({ alarms, verdictInfo, canaryInfo, ciIssues: [], nowMs: NOW });
  assert.equal(ranked[0].bucket.id, "cloud-loop", "alarm x7 + verdict fail must rank first");
  const ids = ranked.map((c) => c.bucket.id);
  assert.ok(ids.includes("worker-churn"), "canary regression maps to its bucket");
  assert.ok(ids.includes("auth-zombie"));
  assert.ok(
    ranked[0].evidence.some((line) => line.includes("runtime-health-20260709.jsonl:42")),
    "ledger line pointer survives into the candidate",
  );
  assert.ok(
    ranked[0].evidence.some((line) => line.includes("soak-verdict") && line.includes("98 of 102")),
    "verdict entry pointer survives",
  );

  const dir = mkdtempSync(path.join(os.tmpdir(), "freed-triage-"));
  const written = emitCandidates(ranked, dir, { nowIso: new Date(NOW).toISOString() });
  assert.equal(path.basename(written[0]), "T-01-cloud-loop.md");
  const rendered = readFileSync(written[0], "utf8");
  assert.match(rendered, /^# T-1: /m);
  assert.match(rendered, /runner-safe: false/);
  assert.match(rendered, /P1-01-cloud-loop-damper-desktop\.md/);
  assert.match(rendered, /## Evidence/);
  assert.match(rendered, /runtime-health-20260709\.jsonl:42/);
});

test("passed soak assertions suppress stale raw alarms for the same bucket", () => {
  const alarms = {
    preflight_kill: {
      count: 13,
      lastTsMs: NOW - 1_000,
      evidence: [{ file: "runtime-health-20260709.jsonl", line: 1639, detail: "window destroyed during held session" }],
    },
    scrape_zero_persist: {
      count: 1,
      lastTsMs: NOW - 1_000,
      evidence: [{ file: "runtime-health-20260709.jsonl", line: 2077, detail: "x scrape extracted 76 items but persisted 0" }],
    },
    cloud_loop: {
      count: 2,
      lastTsMs: NOW - 1_000,
      evidence: [{ file: "runtime-health-20260709.jsonl", line: 1532, detail: "2 uploads unchanged heads" }],
    },
  };
  const verdictInfo = {
    verdictPath: "/soak/soak-verdict.json",
    verdict: {
      windowEnd: new Date(NOW).toISOString(),
      assertions: [
        { id: "preflight_kills", status: "pass", detail: "0 of 10 window_destroyed records killed an active session" },
        { id: "scrape_zero_persist", status: "fail", detail: "1 scrape extracted >= 5 items and persisted 0" },
        { id: "uploads_unchanged_heads", status: "fail", detail: "2 of 8 uploads had unchanged heads" },
      ],
    },
  };

  const ranked = buildCandidates({ alarms, verdictInfo, canaryInfo: null, ciIssues: [], nowMs: NOW });
  const ids = ranked.map((candidate) => candidate.bucket.id);
  assert.ok(!ids.includes("preflight-kill"), "resolved preflight assertions should clear raw positive-control alarms");
  assert.ok(ids.includes("scrape-zero-persist"), "failing assertions still produce candidates");
  assert.ok(ids.includes("cloud-loop"), "failing cloud-loop assertions still produce candidates");
});

test("CI issues rank at the top when fresh", () => {
  const ranked = buildCandidates({
    alarms: { cloud_loop: { count: 2, lastTsMs: NOW - 6 * 86_400_000, evidence: [] } },
    verdictInfo: null,
    canaryInfo: null,
    ciIssues: [{ number: 940, title: "CI failure: dev validation on dev", updatedAt: new Date(NOW).toISOString(), url: "https://x" }],
    nowMs: NOW,
  });
  assert.equal(ranked[0].bucket.id, "ci-red");
  assert.ok(ranked[0].score > ranked[1].score, "fresh CI outranks week-old alarms");
});

test("renderTaskFile follows the stability-tasks header format", () => {
  const candidate = {
    bucket: {
      id: "preflight-kill",
      title: "Window recycles are killing held scraper/login sessions",
      severity: 5,
      programTask: "P1-04-preflight-recycle-guard.md",
      findings: "F04",
    },
    hits: 1,
    score: 3.47,
    evidence: ["alarm preflight_kill x1: file:1 detail"],
  };
  const text = renderTaskFile(candidate, 2, "2026-07-09T08:00:00.000Z");
  const lines = text.split("\n");
  assert.match(lines[0], /^# T-2: Window recycles/);
  assert.match(lines[2], /^runner-safe: .+ \| provider-visible: .+ \| soak-gated: /);
  assert.ok(text.includes("## Context") && text.includes("## Evidence") && text.includes("## Verify"));
});

test("nightly planner loads fresh triage files and ranks them above roadmap work", () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "freed-triage-nightly-"));
  const filePath = path.join(dir, "T-01-cloud-loop.md");
  writeFileSync(
    filePath,
    [
      "# T-1: Idle cloud upload loop is live",
      "",
      "runner-safe: false | provider-visible: false | soak-gated: see program task",
      "Findings: F01/F06.",
      "",
      "## Context",
      "",
      "Program task: P1-01-cloud-loop-damper-desktop.md",
      "",
      "## Evidence",
      "",
      "- alarm cloud_loop x7: runtime-health-20260709.jsonl:42",
      "",
      "## Verify",
      "",
    ].join("\n"),
  );
  // Also a stale-marked file that must be skipped.
  writeFileSync(path.join(dir, "T-02-auth-zombie.md"), "# stale: superseded by a newer triage run\n");

  const loaded = loadTriageCandidates(dir, Date.now());
  assert.equal(loaded.length, 1);
  assert.equal(loaded[0].bucketId, "cloud-loop");
  assert.equal(loaded[0].fresh, true);
  assert.equal(loaded[0].programTask, "P1-01-cloud-loop-damper-desktop.md");

  const candidates = buildNightlyCandidates({
    ...nightlyInputs(),
    triageCandidates: loaded,
  });
  const triage = candidates.find((c) => c.id === "triage-cloud-loop");
  const roadmap = candidates.find((c) => c.id === "roadmap-autonomous-task");
  assert.ok(triage, "triage candidate present");
  assert.ok(roadmap, "roadmap candidate present");
  assert.ok(triage.score > roadmap.score, "fresh triage outranks roadmap");
  assert.ok(triage.evidence.some((line) => line.includes(filePath)));

  // Stale files sink below roadmap instead of vanishing.
  const past = new Date(Date.now() - 3 * 86_400_000);
  utimesSync(filePath, past, past);
  const staleLoaded = loadTriageCandidates(dir, Date.now());
  assert.equal(staleLoaded[0].fresh, false);
  const staleCandidates = buildNightlyCandidates({
    ...nightlyInputs(),
    triageCandidates: staleLoaded,
  });
  const staleTriage = staleCandidates.find((c) => c.id === "triage-cloud-loop");
  assert.ok(staleTriage.score < roadmap.score, "stale triage sinks below roadmap");
});

test("emitCandidates marks leftover higher ranks from previous runs as stale", () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "freed-triage-stale-"));
  writeFileSync(path.join(dir, "T-03-memory-growth.md"), "# T-3: old leftover\n");
  const ranked = buildCandidates({
    alarms: { cloud_loop: { count: 5, lastTsMs: NOW, evidence: [] } },
    verdictInfo: null,
    canaryInfo: null,
    ciIssues: [],
    nowMs: NOW,
  });
  emitCandidates(ranked, dir, { nowIso: new Date(NOW).toISOString() });
  const names = readdirSync(dir).sort();
  assert.deepEqual(names, ["T-01-cloud-loop.md", "T-03-memory-growth.md"]);
  assert.match(readFileSync(path.join(dir, "T-03-memory-growth.md"), "utf8"), /^# stale:/);
});
