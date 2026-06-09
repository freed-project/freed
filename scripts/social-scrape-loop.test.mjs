import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  acquireRunLock,
  buildOptimizationPlan,
  buildReport,
  formatBytes,
  parseArgs,
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
  ]);

  const plan = buildOptimizationPlan(summary, { memoryBudgetGib: 4 });
  assert.equal(plan.actions[0].id, "local-memory-preflight");
  assert.equal(plan.actions[0].scope, "local-only");
  assert.ok(plan.actions.some((action) => action.id === "linkedin-preflight-without-plan"));
  assert.ok(plan.blockedProviderRisk.some((risk) => risk.id === "scripted-scroll-click-recovery"));
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
