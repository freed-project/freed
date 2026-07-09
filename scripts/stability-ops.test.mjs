import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import {
  mainRendererMemoryRecoveryReason,
  parseWatchdogConstants,
  readTraceLines,
  replayTrace,
  statsFromSample,
} from "./replay-watchdog.mjs";
import {
  computeCanarySummary,
  detectRegressions,
  loadTrailingSummaries,
} from "./canary-summarize.mjs";
import {
  buildBisectPlan,
  metricFromVerdict,
  predicateExitCode,
  versionToTag,
} from "./bisect-regression.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const RUST_SOURCE = path.join(__dirname, "../packages/desktop/src-tauri/src/lib.rs");
const TRACE_FIXTURE = path.join(__dirname, "fixtures/watchdog-trace.jsonl");

// ---------------------------------------------------------------------------
// replay-watchdog
// ---------------------------------------------------------------------------

test("watchdog constants parse from the real Rust source with expected magnitudes", () => {
  const constants = parseWatchdogConstants(readFileSync(RUST_SOURCE, "utf8"));
  assert.equal(constants.BYTES_PER_GIB, 1024 ** 3);
  assert.ok(constants.MAIN_RENDERER_MEMORY_RECOVERY_MIN_AGE_SECONDS >= 60);
  assert.ok(constants.MAIN_RENDERER_HOT_WEBKIT_RESIDENT_RECOVERY_BYTES > constants.BYTES_PER_GIB);
  assert.ok(constants.SCRAPE_MEMORY_HEADROOM_BYTES > 0);
});

test("replay reproduces the recorded 2026-07-05 watchdog_memory decision from the fixture trace", () => {
  // The fixture is two REAL native_runtime_memory_sample lines recorded
  // minutes before the shipped watchdog killed the main renderer for
  // "WebKit resident memory hot" (runtime-health-20260705.jsonl). The replay
  // must reach the same verdict: benign sample -> leave alone, hot sample
  // (webkit largest resident 7.79 GB >= memoryHigh 5.77 GB, tail not
  // reclaimable because app resident 9.3 GB is over critical-headroom) ->
  // recover.
  const constants = parseWatchdogConstants(readFileSync(RUST_SOURCE, "utf8"));
  const trace = readTraceLines(TRACE_FIXTURE);
  assert.equal(trace.length, 2);

  const result = replayTrace(trace, constants);
  assert.equal(result.samples, 2);
  assert.equal(result.recoveries, 1);
  assert.equal(result.decisions[0].reason, null, "benign idle sample must not recover");
  assert.equal(result.decisions[1].reason, "webkit_hot_resident_pressure");
});

test("constant variants diverge: raising the min-age gate suppresses the historical recovery", () => {
  const constants = parseWatchdogConstants(readFileSync(RUST_SOURCE, "utf8"));
  const trace = readTraceLines(TRACE_FIXTURE);
  const base = replayTrace(trace, constants);
  const variant = replayTrace(trace, {
    ...constants,
    // The hot sample's webkit process was 2054s old; a 3000s min-age gate
    // would have left it alone. This is exactly the #847/#850 style question
    // the replay answers pre-merge.
    MAIN_RENDERER_MEMORY_RECOVERY_MIN_AGE_SECONDS: 3000,
  });
  assert.equal(base.recoveries, 1);
  assert.equal(variant.recoveries, 0);
});

test("hidden context maps the hot decision to its idle reason", () => {
  const constants = parseWatchdogConstants(readFileSync(RUST_SOURCE, "utf8"));
  const trace = readTraceLines(TRACE_FIXTURE);
  const hidden = replayTrace(trace, constants, { isVisible: false, lastVisibility: "hidden" });
  assert.equal(hidden.decisions[1].reason, "idle_webkit_hot_resident_pressure");
});

test("age-matched role only recovers when the webkit process age matches renderer uptime", () => {
  const constants = parseWatchdogConstants(readFileSync(RUST_SOURCE, "utf8"));
  const hot = readTraceLines(TRACE_FIXTURE)[1].entry;
  const sample = { ...hot, webkitLargestRole: "freed-webcontent-age-matched" };
  const noUptime = mainRendererMemoryRecoveryReason(
    statsFromSample(sample),
    { isVisible: true, lastVisibility: "visible", rendererUptimeMs: null },
    constants,
  );
  assert.equal(noUptime, null, "unknown renderer uptime must not attribute the process");
  const matching = mainRendererMemoryRecoveryReason(
    statsFromSample(sample),
    { isVisible: true, lastVisibility: "visible", rendererUptimeMs: sample.webkitLargestAgeSeconds * 1000 },
    constants,
  );
  assert.equal(matching, "webkit_hot_resident_pressure");
});

// ---------------------------------------------------------------------------
// canary-summarize
// ---------------------------------------------------------------------------

function canaryEntries(uploadsUnchanged) {
  const start = 1_700_000_000_000;
  const entries = [
    { event: "renderer_recovery_attempt", tsMs: start + 1000 },
    { event: "window_destroyed", reasonEnum: "job_complete", tsMs: start + 2000 },
    { event: "window_destroyed", reasonEnum: "watchdog_memory", tsMs: start + 3000 },
    { event: "invariant_alarm", name: "cloud_loop", tsMs: start + 4000 },
    { event: "worker_init", durationMs: 1000, docBytes: 1, tsMs: start + 5000 },
    { event: "scrape_outcome", provider: "facebook", stage: "ok", tsMs: start + 6000 },
    { event: "scrape_outcome", provider: "linkedin", stage: "event_timeout", tsMs: start + 7000 },
    { event: "cloud_upload_skipped", provider: "gdrive", tsMs: start + 8000 },
    {
      event: "native_runtime_memory_sample",
      tsMs: start + 9000,
      appResidentBytes: 500 * 1024 * 1024,
      webkitLargestResidentBytes: 900 * 1024 * 1024,
    },
    {
      event: "native_runtime_memory_sample",
      tsMs: start + 3_600_000,
      appResidentBytes: 600 * 1024 * 1024,
      webkitLargestResidentBytes: 950 * 1024 * 1024,
    },
  ];
  for (let i = 0; i < uploadsUnchanged; i += 1) {
    entries.push({
      event: "cloud_upload_attempt",
      provider: "gdrive",
      headsUnchanged: true,
      tsMs: start + 10_000 + i,
    });
  }
  return { entries, start };
}

test("computeCanarySummary folds counters into per-release metrics", () => {
  const { entries, start } = canaryEntries(12);
  const summary = computeCanarySummary(entries, {
    version: "26.7.800",
    windowStartMs: start,
    windowEndMs: start + 6 * 3_600_000,
  });
  assert.equal(summary.version, "26.7.800");
  assert.equal(summary.spanHours, 6);
  assert.equal(summary.metrics.uploadsUnchangedPerHour, 2);
  assert.equal(summary.metrics.windowKillsByReason.watchdog_memory, 1);
  assert.equal(summary.metrics.alarmsByName.cloud_loop, 1);
  assert.equal(summary.metrics.scrapeByProvider.linkedin.byStage.event_timeout, 1);
  assert.ok(summary.metrics.peakAppResidentBytes >= 600 * 1024 * 1024);
  assert.ok(summary.metrics.idleGrowthMbPerHour > 0);
});

test("regression detection flags a worsened trace and passes a steady one", () => {
  const { entries, start } = canaryEntries(12);
  const windowOpts = { windowStartMs: start, windowEndMs: start + 6 * 3_600_000 };
  const steady = computeCanarySummary(entries, { version: "26.7.801", ...windowOpts });
  const trailing = [steady, steady, steady];

  assert.deepEqual(detectRegressions(steady, trailing), []);

  const worsened = computeCanarySummary(canaryEntries(60).entries, {
    version: "26.7.802",
    ...windowOpts,
  });
  const regressions = detectRegressions(worsened, trailing);
  const metrics = regressions.map((r) => r.metric);
  assert.ok(metrics.includes("uploadsUnchangedPerHour"), `flagged: ${metrics.join(",")}`);
});

test("trailing ledger loads newest-last and excludes the version being judged", () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "freed-canary-ledger-"));
  const write = (version, windowEnd) =>
    writeFileSync(
      path.join(dir, `canary-${version}.json`),
      JSON.stringify({ version, windowEnd, metrics: { uploadsPerHour: 1 } }),
    );
  write("1.0.0", "2026-07-01T00:00:00Z");
  write("1.0.1", "2026-07-02T00:00:00Z");
  write("1.0.2", "2026-07-03T00:00:00Z");
  const trailing = loadTrailingSummaries(dir, "1.0.2", 7);
  assert.deepEqual(
    trailing.map((s) => s.version),
    ["1.0.0", "1.0.1"],
  );
});

// ---------------------------------------------------------------------------
// bisect-regression
// ---------------------------------------------------------------------------

test("versionToTag normalizes bare versions and passes tags through", () => {
  assert.equal(versionToTag("26.7.301-dev"), "v26.7.301-dev");
  assert.equal(versionToTag("v26.7.800-dev"), "v26.7.800-dev");
});

test("metricFromVerdict reads assertion status and numeric extractions", () => {
  const verdict = {
    spanHours: 6,
    assertions: [
      { id: "uploads_unchanged_heads", status: "fail", detail: "98 of 102 uploads had unchanged heads (cloud loop signature, F01/F06)." },
      { id: "invariant_alarms", status: "pass", detail: "8 invariant_alarm events (cloud_loop=7, preflight_kill=1)." },
      { id: "renderer_recoveries", status: "pass", detail: "0 events." },
    ],
  };
  assert.equal(metricFromVerdict(verdict, "renderer_recoveries"), 0);
  assert.equal(metricFromVerdict(verdict, "uploads_unchanged_heads"), 1);
  assert.equal(metricFromVerdict(verdict, "alarms_total"), 8);
  assert.ok(Math.abs(metricFromVerdict(verdict, "uploads_unchanged_per_hour") - 98 / 6) < 1e-9);
  assert.throws(() => metricFromVerdict(verdict, "no_such_metric"));
});

test("predicate exit codes follow git-bisect semantics", () => {
  assert.equal(predicateExitCode(0, 0), 0);
  assert.equal(predicateExitCode(3, 5), 0);
  assert.equal(predicateExitCode(6, 5), 1);
});

test("bisect plan wires the predicate through git bisect run", () => {
  const plan = buildBisectPlan({
    metric: "uploads_unchanged_per_hour",
    goodVersion: "26.7.301-dev",
    badVersion: "26.7.800-dev",
    threshold: 5,
    soakMinutes: 90,
  });
  assert.equal(plan.goodTag, "v26.7.301-dev");
  assert.equal(plan.commands[0], "git bisect start v26.7.800-dev v26.7.301-dev");
  assert.match(plan.commands[1], /^git bisect run node scripts\/bisect-regression\.mjs --predicate/);
  assert.match(plan.predicate, /--threshold 5 --soak-minutes 90/);
});
