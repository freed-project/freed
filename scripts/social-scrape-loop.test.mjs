import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  acquireRunLock,
  applyProviderHealthStore,
  buildOptimizationPlan,
  buildReport,
  formatBytes,
  parseArgs,
  readJsonFile,
  readJsonl,
  releaseRunLock,
  summarizeSocialScrapeHealth,
} from "./social-scrape-loop.mjs";

const GIB = 1024 * 1024 * 1024;

test("parseArgs keeps the loop local-only by default", () => {
  const args = parseArgs(["--tail", "100", "--memory-budget-gib", "3.5", "--no-write"]);

  assert.equal(args.tail, 100);
  assert.equal(args.memoryBudgetGib, 3.5);
  assert.equal(args.write, false);
  assert.equal(args.watch, false);
});

test("readJsonl tails rows and counts parse errors", () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "freed-social-loop-jsonl-"));
  const filePath = path.join(dir, "runtime-health.jsonl");
  writeFileSync(
    filePath,
    [
      JSON.stringify({ event: "old" }),
      "not json",
      JSON.stringify({ event: "newer" }),
      JSON.stringify({ event: "newest" }),
      "",
    ].join("\n"),
  );

  const result = readJsonl(filePath, { tail: 3 });
  assert.equal(result.exists, true);
  assert.equal(result.parseErrors, 1);
  assert.deepEqual(result.rows.map((row) => row.event), ["newer", "newest"]);
});

test("readJsonl reads only the byte tail for large logs", () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "freed-social-loop-jsonl-tail-"));
  const filePath = path.join(dir, "runtime-diagnostics.jsonl");
  writeFileSync(
    filePath,
    [
      JSON.stringify({ event: "old", detail: "x".repeat(1024) }),
      JSON.stringify({ event: "recent-a" }),
      JSON.stringify({ event: "recent-b" }),
      "",
    ].join("\n"),
  );

  const result = readJsonl(filePath, { tail: 10, maxBytes: 96 });

  assert.equal(result.exists, true);
  assert.equal(result.parseErrors, 0);
  assert.deepEqual(result.rows.map((row) => row.event), ["recent-a", "recent-b"]);
});

test("readJsonl compacts heavyweight diagnostic text fields", () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "freed-social-loop-jsonl-compact-"));
  const filePath = path.join(dir, "runtime-diagnostics.jsonl");
  writeFileSync(
    filePath,
    `${JSON.stringify({
      event: "renderer_memory_recovery_attempt",
      sampleSummary: "sample".repeat(100),
      vmmapSummary: "vmmap".repeat(100),
    })}\n`,
  );

  const result = readJsonl(filePath);

  assert.equal(result.exists, true);
  assert.equal(result.rows.length, 1);
  assert.equal(result.rows[0].sampleSummary, undefined);
  assert.equal(result.rows[0].vmmapSummary, undefined);
  assert.equal(result.rows[0].sampleSummaryBytes, 600);
  assert.equal(result.rows[0].vmmapSummaryBytes, 500);
});

test("readJsonFile reads optional provider health stores", () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "freed-social-loop-json-"));
  const filePath = path.join(dir, "sync-health.json");
  writeFileSync(filePath, JSON.stringify({ ok: true }));

  assert.deepEqual(readJsonFile(filePath), {
    exists: true,
    value: { ok: true },
    parseError: false,
  });
  assert.deepEqual(readJsonFile(path.join(dir, "missing.json")), {
    exists: false,
    value: null,
    parseError: false,
  });
});

test("summarizeSocialScrapeHealth groups provider memory and scrape failures", () => {
  const rows = [
    {
      event: "scrape_memory_preflight",
      provider: "Instagram",
      pressureLevel: "critical",
      afterWebkitResidentBytes: 7 * GIB,
      afterAppResidentBytes: 8 * GIB,
      tsMs: 100,
    },
    {
      event: "background_scraper_memory_cooldown",
      provider: "Instagram",
      pressureLevel: "critical",
      webkitResidentBytes: 7 * GIB,
      tsMs: 110,
    },
    {
      event: "sync_failed",
      provider: "facebook",
      stage: "extract_silent",
      tsMs: 120,
    },
    {
      event: "renderer_recovery_attempt",
      reason: "main renderer WebKit resident memory hot",
      webkitResidentBytes: 9 * GIB,
      eventLoopLagMs: 45,
      domNodeCount: 900,
      tsMs: 130,
    },
    {
      event: "native_runtime_memory_sample",
      webkitResidentBytes: 0,
      appResidentBytes: GIB,
      backgroundWorkPaused: true,
      backgroundPauseReason: "memory",
      backgroundPauseRemainingMs: 90_000,
      safeModeActive: true,
      activeBackgroundJob: "content-fetch",
      activeBackgroundJobAgeMs: 30_000,
      tsMs: 140,
    },
  ];

  const summary = summarizeSocialScrapeHealth(rows);
  assert.equal(summary.providers.instagram.preflights, 1);
  assert.equal(summary.providers.instagram.memoryCooldowns, 1);
  assert.equal(summary.providers.instagram.criticalPreflights, 1);
  assert.equal(summary.providers.facebook.silentExtractions, 1);
  assert.equal(summary.rendererRecoveryAttempts, 1);
  assert.equal(summary.maxWebkitResidentBytes, 9 * GIB);
  assert.equal(summary.maxEventLoopLagMs, 45);
  assert.equal(summary.maxDomNodeCount, 900);
  assert.equal(summary.providers.instagram.lastBlockedPreflightTsMs, 100);
  assert.equal(summary.providers.instagram.minMemorySampleAfterBlockedWebkitResidentBytes, 0);
  assert.equal(summary.providers.instagram.lastMemorySampleAfterBlockedTsMs, 140);
  assert.equal(summary.providers.instagram.lastMemorySampleAfterBlockedBackgroundWorkPaused, true);
  assert.equal(summary.providers.instagram.lastMemorySampleAfterBlockedPauseReason, "memory");
  assert.equal(summary.providers.instagram.lastMemorySampleAfterBlockedPauseRemainingMs, 90_000);
  assert.equal(summary.providers.instagram.lastMemorySampleAfterBlockedSafeModeActive, true);
  assert.equal(summary.providers.instagram.lastMemorySampleAfterBlockedActiveJob, "content-fetch");
  assert.equal(summary.providers.instagram.lastMemorySampleAfterBlockedActiveJobAgeMs, 30_000);
});

test("buildOptimizationPlan ranks local memory work before missing coverage", () => {
  const summary = summarizeSocialScrapeHealth([
    {
      event: "scrape_memory_preflight",
      provider: "LinkedIn",
      pressureLevel: "high",
      afterWebkitResidentBytes: 6 * GIB,
      tsMs: 100,
    },
    {
      event: "native_runtime_memory_sample",
      webkitResidentBytes: 2 * GIB,
      tsMs: 150,
    },
  ]);

  const plan = buildOptimizationPlan(summary, { memoryBudgetGib: 4 });
  assert.equal(plan.actions[0].id, "local-memory-preflight");
  assert.equal(plan.actions[0].scope, "local-only");
  const linkedinAction = plan.actions.find((action) => action.id === "linkedin-preflight-without-plan");
  assert.ok(linkedinAction);
  assert.match(linkedinAction.evidence, /Lowest WebKit RSS after the last blocked preflight was 2 GiB/);
  assert.ok(plan.blockedProviderRisk.some((risk) => risk.id === "scripted-scroll-click-recovery"));
});

test("buildOptimizationPlan flags recovered providers without a later scrape plan", () => {
  const summary = summarizeSocialScrapeHealth([
    {
      event: "social_scrape_plan",
      provider: "Facebook",
      tsMs: 100,
    },
    {
      event: "scrape_memory_preflight",
      provider: "Facebook",
      pressureLevel: "critical",
      mayProceed: false,
      afterWebkitResidentBytes: 6 * GIB,
      tsMs: 200,
    },
    {
      event: "native_runtime_memory_sample",
      webkitResidentBytes: 0,
      backgroundWorkPaused: false,
      safeModeActive: false,
      activeBackgroundJob: null,
      tsMs: 300,
    },
  ]);
  applyProviderHealthStore(
    summary,
    {
      "provider-health": {
        providers: {
          facebook: {
            pause: null,
            latestAttempts: [
              {
                outcome: "error",
                stage: "invoke",
                reason: "Facebook sync paused because Freed Desktop memory remains critically high after cleanup.",
                finishedAt: 250,
                itemsSeen: 0,
                itemsAdded: 0,
              },
            ],
          },
        },
      },
    },
    400,
  );

  const plan = buildOptimizationPlan(summary, { memoryBudgetGib: 4 });
  const action = plan.actions.find((candidate) => candidate.id === "facebook-recovered-without-later-plan");

  assert.ok(action);
  assert.equal(action.scope, "local-only");
  assert.match(action.evidence, /later WebKit RSS reached 0 B/);
  assert.match(action.evidence, /background work was not paused/);
  assert.match(action.evidence, /safe mode was not active/);
  assert.match(action.evidence, /no background job was active/);
  assert.match(action.evidence, /provider health is not actively paused/);
  assert.match(action.evidence, /latest provider-health attempt was error stage invoke/);
  assert.match(action.nextStep, /scheduler pause/);

  const staleHealthAction = plan.actions.find(
    (candidate) => candidate.id === "facebook-stale-memory-health-after-recovery",
  );
  assert.ok(staleHealthAction);
  assert.equal(staleHealthAction.scope, "local-only");
  assert.match(staleHealthAction.evidence, /latest provider-health attempt is still invoke/);
  assert.match(staleHealthAction.nextStep, /Do not enqueue extra provider traffic/);
});

test("buildOptimizationPlan flags provider-health empty feed attempts", () => {
  const summary = summarizeSocialScrapeHealth([
    {
      event: "scrape_memory_preflight",
      provider: "Instagram",
      pressureLevel: "normal",
      afterWebkitResidentBytes: GIB,
      tsMs: 100,
    },
    {
      event: "social_scrape_plan",
      provider: "Instagram",
      tsMs: 120,
    },
  ]);
  applyProviderHealthStore(
    summary,
    {
      "provider-health": {
        providers: {
          instagram: {
            pause: null,
            latestAttempts: [
              {
                outcome: "error",
                stage: "extract_empty",
                reason: "Instagram feed returned 0 posts.",
                finishedAt: 160,
                itemsSeen: 0,
                itemsAdded: 0,
              },
            ],
          },
        },
      },
    },
    200,
  );

  const plan = buildOptimizationPlan(summary, { memoryBudgetGib: 4 });
  const action = plan.actions.find((candidate) => candidate.id === "instagram-empty-feed-health");

  assert.ok(action);
  assert.equal(action.scope, "local-only");
  assert.match(action.evidence, /Provider-health latest attempt is error stage extract_empty/);
  assert.match(action.evidence, /Instagram feed returned 0 posts/);
  assert.match(action.nextStep, /Do not add extra provider loads/);
});

test("YouTube uses passive provider health without demanding social preflight events", () => {
  const summary = summarizeSocialScrapeHealth([]);
  applyProviderHealthStore(
    summary,
    {
      "provider-health": {
        providers: {
          youtube: {
            pause: null,
            latestAttempts: [{
              outcome: "empty",
              stage: "empty",
              reason: "No recent subscription videos were visible.",
              finishedAt: 160,
              itemsSeen: 0,
              itemsAdded: 0,
            }],
          },
        },
      },
    },
    200,
  );

  const plan = buildOptimizationPlan(summary, { memoryBudgetGib: 4 });
  const action = plan.actions.find((candidate) => candidate.id === "youtube-empty-feed-health");

  assert.ok(action);
  assert.match(action.title, /zero videos/);
  assert.equal(
    plan.actions.some((candidate) => candidate.id === "youtube-missing-coverage"),
    false,
  );
});

test("buildReport writes provider summaries from health and diagnostics logs", () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "freed-social-loop-report-"));
  const healthLog = path.join(dir, "runtime-health.jsonl");
  const diagnosticsLog = path.join(dir, "runtime-diagnostics.jsonl");
  mkdirSync(path.dirname(healthLog), { recursive: true });
  writeFileSync(
    healthLog,
    `${JSON.stringify({
      event: "scrape_memory_preflight",
      provider: "Facebook",
      pressureLevel: "normal",
      afterWebkitResidentBytes: GIB,
    })}\n`,
  );
  writeFileSync(
    diagnosticsLog,
    `${JSON.stringify({
      event: "sync_failed",
      provider: "Facebook",
      stage: "auth",
    })}\n`,
  );

  const report = buildReport({
    healthLog,
    diagnosticsLog,
    providerHealth: path.join(dir, "missing-sync-health.json"),
    tail: 5000,
    memoryBudgetGib: 4,
  });

  assert.equal(report.inputs.healthLogExists, true);
  assert.equal(report.summary.providers.facebook.preflights, 1);
  assert.equal(report.summary.providers.facebook.authFailures, 1);
});

test("formatBytes uses locale grouped units", () => {
  assert.equal(formatBytes(0), "0 B");
  assert.equal(formatBytes(5 * GIB), "5 GiB");
  assert.equal(formatBytes(1536 * 1024 * 1024), "1.5 GiB");
});

test("cli can write a JSON report", async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "freed-social-loop-cli-"));
  const healthLog = path.join(dir, "runtime-health.jsonl");
  const diagnosticsLog = path.join(dir, "runtime-diagnostics.jsonl");
  const output = path.join(dir, "report.json");
  writeFileSync(
    healthLog,
    `${JSON.stringify({
      event: "social_scrape_plan",
      provider: "Instagram",
      webkitResidentBytes: GIB,
    })}\n`,
  );
  writeFileSync(diagnosticsLog, "");

  const { main } = await import("./social-scrape-loop.mjs");
  const originalLog = console.log;
  try {
    console.log = () => {};
    await main([
      "--health-log",
      healthLog,
      "--diagnostics-log",
      diagnosticsLog,
      "--output",
      output,
      "--json",
      "--no-lock",
    ]);
  } finally {
    console.log = originalLog;
  }

  const report = JSON.parse(readFileSync(output, "utf8"));
  assert.equal(report.summary.providers.instagram.plans, 1);
});

test("run lock blocks overlapping loops and releases by token", () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "freed-social-loop-lock-"));
  const lockPath = path.join(dir, "run.lock");

  const first = acquireRunLock({ lockPath });
  assert.equal(first.acquired, true);

  const second = acquireRunLock({ lockPath });
  assert.equal(second.acquired, false);
  assert.equal(second.existing.token, first.token);

  const wrongRelease = releaseRunLock({ lockPath, token: "wrong" });
  assert.equal(wrongRelease.released, false);
  assert.equal(wrongRelease.reason, "token_mismatch");

  const release = releaseRunLock({ lockPath, token: first.token });
  assert.equal(release.released, true);

  const third = acquireRunLock({ lockPath });
  assert.equal(third.acquired, true);
  releaseRunLock({ lockPath, token: third.token });
});

test("run lock recovers stale lock files", () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "freed-social-loop-stale-lock-"));
  const lockPath = path.join(dir, "run.lock");
  writeFileSync(
    lockPath,
    `${JSON.stringify({
      token: "stale",
      pid: 1,
      createdAt: "2026-07-02T00:00:00.000Z",
    })}\n`,
  );

  const lock = acquireRunLock({
    lockPath,
    staleMs: 1,
    nowMs: Date.now() + 60 * 1000,
  });
  assert.equal(lock.acquired, true);
  assert.equal(lock.stale, true);
  assert.equal(lock.existing.token, "stale");
  releaseRunLock({ lockPath, token: lock.token });
});
