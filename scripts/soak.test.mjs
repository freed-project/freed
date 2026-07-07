import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import {
  buildSample,
  METRICS_COLUMNS,
  metricsRowToTsv,
  mirrorHealthDelta,
  parsePsTable,
  parseArgs as parseCollectArgs,
  readLastHealthOffset,
} from "./soak-collect.mjs";
import {
  assertAlarmCounts,
  assertEventCountZero,
  assertFootprintSlope,
  assertGuardedCounters,
  assertWebkitReturnsToBaseline,
  buildVerdict,
  footprintSlopeMbPerHour,
  parseMetricsTsv,
  readHealthLines,
} from "./soak-assert.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MB = 1024 * 1024;

const PS_FIXTURE = [
  "  312     1  92288 /System/Library/Frameworks/WebKit.framework/Versions/A/XPCServices/com.apple.WebKit.Networking.xpc/Contents/MacOS/com.apple.WebKit.Networking",
  "10312     1 913728 /Applications/Freed.app/Contents/MacOS/freed-desktop",
  "10316     1 173152 /System/Library/Frameworks/WebKit.framework/Versions/A/XPCServices/com.apple.WebKit.WebContent.xpc/Contents/MacOS/com.apple.WebKit.WebContent",
  "18781     1 6706592 /System/Library/Frameworks/WebKit.framework/Versions/A/XPCServices/com.apple.WebKit.WebContent.xpc/Contents/MacOS/com.apple.WebKit.WebContent",
  "99999     1   1000 /usr/sbin/somethingelse",
].join("\n");

function metricsFixture(rows) {
  return [
    METRICS_COLUMNS.join("\t"),
    ...rows.map((row) => METRICS_COLUMNS.map((column) => row[column] ?? 0).join("\t")),
  ].join("\n");
}

function healthFixtureFile(dir, lines) {
  const healthPath = path.join(dir, "runtime-health.jsonl");
  writeFileSync(healthPath, lines.map((line) => JSON.stringify(line)).join("\n") + "\n");
  return healthPath;
}

test("parsePsTable and buildSample split app, WebContent, and other WebKit processes", () => {
  const rows = parsePsTable(PS_FIXTURE);
  assert.equal(rows.length, 5);

  const sample = buildSample(rows, { appBinary: "Freed.app/Contents/MacOS", tsMs: 1_700_000_000_000 });
  assert.equal(sample.appPid, 10312);
  assert.equal(sample.appRssKb, 913728);
  assert.equal(sample.webkitWebContentCount, 2);
  assert.equal(sample.webkitWebContentRssKb, 173152 + 6706592);
  assert.equal(sample.webkitLargestRssKb, 6706592);
  assert.equal(sample.webkitOtherRssKb, 92288);

  const tsv = metricsRowToTsv({ ...sample, healthFileBytes: 10, healthFileLines: 2 });
  assert.equal(tsv.trim().split("\t").length, METRICS_COLUMNS.length);
});

test("soak-collect parseArgs derives a soaks dir under ~/.freed/automation", () => {
  const args = parseCollectArgs([], new Date("2026-07-02T10:00:00Z"));
  assert.ok(args.soakDir.includes(path.join(".freed", "automation", "soaks")));
  assert.ok(args.pointer.endsWith("current-soak-dir"));
  assert.throws(() => parseCollectArgs(["--interval-seconds", "1"]), /at least 5/);
});

test("soak-collect --once writes metrics, offsets, info, and the pointer", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "freed-soak-collect-"));
  const soakDir = path.join(root, "soak");
  const pointer = path.join(root, "state", "current-soak-dir");
  execFileSync(
    process.execPath,
    [
      path.join(__dirname, "soak-collect.mjs"),
      "--once",
      "--soak-dir",
      soakDir,
      "--pointer",
      pointer,
      "--app-data",
      root,
    ],
    { encoding: "utf8" },
  );

  assert.ok(existsSync(path.join(soakDir, "metrics.tsv")));
  assert.ok(existsSync(path.join(soakDir, "soak-info.json")));
  assert.ok(existsSync(path.join(soakDir, "health-offsets.jsonl")));
  assert.equal(readFileSync(pointer, "utf8").trim(), soakDir);

  const metrics = readFileSync(path.join(soakDir, "metrics.tsv"), "utf8").trim().split("\n");
  assert.equal(metrics[0], METRICS_COLUMNS.join("\t"));
  assert.equal(metrics.length, 2);

  const info = JSON.parse(readFileSync(path.join(soakDir, "soak-info.json"), "utf8"));
  assert.equal(info.schemaVersion, 1);
  assert.deepEqual(info.metricsColumns, METRICS_COLUMNS);
});

function runCollectOnce(root, soakDir, pointer) {
  execFileSync(
    process.execPath,
    [
      path.join(__dirname, "soak-collect.mjs"),
      "--once",
      "--soak-dir",
      soakDir,
      "--pointer",
      pointer,
      "--app-data",
      root,
    ],
    { encoding: "utf8" },
  );
}

test("soak-collect mirrors runtime-health incrementally across samples", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "freed-soak-mirror-"));
  const soakDir = path.join(root, "soak");
  const pointer = path.join(root, "state", "current-soak-dir");
  const healthPath = path.join(root, "runtime-health.jsonl");
  const mirrorPath = path.join(soakDir, "runtime-health.jsonl");

  writeFileSync(healthPath, '{"event":"a","tsMs":1}\n{"event":"b","tsMs":2}\n');
  runCollectOnce(root, soakDir, pointer);
  assert.equal(readFileSync(mirrorPath, "utf8"), readFileSync(healthPath, "utf8"));

  // Each --once is a fresh process, so the cursor round-trips through
  // health-offsets.jsonl; only the appended line may be copied again.
  writeFileSync(healthPath, readFileSync(healthPath, "utf8") + '{"event":"c","tsMs":3}\n');
  runCollectOnce(root, soakDir, pointer);
  assert.equal(
    readFileSync(mirrorPath, "utf8"),
    '{"event":"a","tsMs":1}\n{"event":"b","tsMs":2}\n{"event":"c","tsMs":3}\n',
  );

  const offsets = readFileSync(path.join(soakDir, "health-offsets.jsonl"), "utf8")
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
  assert.equal(offsets.length, 2);
  assert.equal(offsets[0].rotated, false);
  assert.equal(offsets[1].bytes, readFileSync(healthPath).length);
  assert.equal(offsets[1].appendedBytes, '{"event":"c","tsMs":3}\n'.length);
  assert.equal(readLastHealthOffset(path.join(soakDir, "health-offsets.jsonl")), offsets[1].bytes);
});

test("soak-collect re-mirrors from byte 0 after rotation without duplicating", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "freed-soak-rotate-"));
  const soakDir = path.join(root, "soak");
  const pointer = path.join(root, "state", "current-soak-dir");
  const healthPath = path.join(root, "runtime-health.jsonl");
  const mirrorPath = path.join(soakDir, "runtime-health.jsonl");

  writeFileSync(healthPath, '{"event":"old-1","tsMs":1}\n{"event":"old-2","tsMs":2}\n');
  runCollectOnce(root, soakDir, pointer);

  // Daily rotation truncates the live file; the mirror keeps the old window
  // and appends the whole rotated file exactly once.
  writeFileSync(healthPath, '{"event":"new-1","tsMs":3}\n');
  runCollectOnce(root, soakDir, pointer);
  assert.equal(
    readFileSync(mirrorPath, "utf8"),
    '{"event":"old-1","tsMs":1}\n{"event":"old-2","tsMs":2}\n{"event":"new-1","tsMs":3}\n',
  );

  const offsets = readFileSync(path.join(soakDir, "health-offsets.jsonl"), "utf8")
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
  assert.equal(offsets[1].rotated, true);
  assert.equal(offsets[1].bytes, '{"event":"new-1","tsMs":3}\n'.length);
});

test("mirrorHealthDelta completes a partially written line on the next sample", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "freed-soak-partial-"));
  const healthPath = path.join(root, "runtime-health.jsonl");
  const mirrorPath = path.join(root, "mirror.jsonl");

  writeFileSync(healthPath, '{"event":"a","tsMs":1}\n{"event":"b"');
  const first = mirrorHealthDelta({ healthPath, mirrorPath, lastBytes: 0 });
  assert.equal(first.rotated, false);

  writeFileSync(healthPath, '{"event":"a","tsMs":1}\n{"event":"b","tsMs":2}\n');
  const second = mirrorHealthDelta({ healthPath, mirrorPath, lastBytes: first.bytes });
  assert.equal(second.rotated, false);
  assert.equal(readFileSync(mirrorPath, "utf8"), readFileSync(healthPath, "utf8"));

  // Unchanged file appends nothing.
  const third = mirrorHealthDelta({ healthPath, mirrorPath, lastBytes: second.bytes });
  assert.equal(third.appendedBytes, 0);
  assert.equal(readFileSync(mirrorPath, "utf8"), readFileSync(healthPath, "utf8"));
});

test("footprintSlopeMbPerHour measures a linear leak", () => {
  const start = 1_700_000_000_000;
  const points = Array.from({ length: 11 }, (_, i) => ({
    tsMs: start + i * 3_600_000,
    bytes: (1000 + 100 * i) * MB, // +100 MB/h
  }));
  const slope = footprintSlopeMbPerHour(points);
  assert.ok(Math.abs(slope - 100) < 0.001, `slope was ${slope}`);
});

test("a synthetic leaky heartbeat trace fails the slope assertion; a flat trace passes", () => {
  const start = 1_700_000_000_000;
  const leaky = Array.from({ length: 21 }, (_, i) => ({
    entry: {
      event: "renderer_heartbeat",
      tsMs: start + i * 15 * 60_000, // 5h of 15-min heartbeats
      nativeFootprintBytes: (1000 + 20 * i) * MB, // +80 MB/h
    },
    line: i + 1,
    raw: "{}",
  }));
  const flat = leaky.map((item, i) => ({
    ...item,
    entry: { ...item.entry, nativeFootprintBytes: 1000 * MB + (i % 2) * MB },
  }));

  const failing = assertFootprintSlope(leaky, [], "metrics.tsv", "runtime-health.jsonl");
  assert.equal(failing.status, "fail");
  assert.match(failing.detail, /MB\/h/);

  const passing = assertFootprintSlope(flat, [], "metrics.tsv", "runtime-health.jsonl");
  assert.equal(passing.status, "pass");
});

test("a short window skips the slope assertion instead of judging it", () => {
  const start = 1_700_000_000_000;
  const short = Array.from({ length: 10 }, (_, i) => ({
    entry: {
      event: "renderer_heartbeat",
      tsMs: start + i * 60_000, // 10 minutes
      nativeFootprintBytes: (1000 + 50 * i) * MB,
    },
    line: i + 1,
    raw: "{}",
  }));
  const result = assertFootprintSlope(short, [], "metrics.tsv", "runtime-health.jsonl");
  assert.equal(result.status, "skipped");
  assert.match(result.detail, /needs >= 4h/);
});

test("recovery and stale-heartbeat assertions cite the violating lines", () => {
  const lines = [
    { entry: { event: "renderer_heartbeat", tsMs: 1 }, line: 1, raw: "{hb}" },
    { entry: { event: "renderer_recovery_restart_requested", tsMs: 2 }, line: 2, raw: "{recovery}" },
    { entry: { event: "renderer_heartbeat_stale", tsMs: 3 }, line: 3, raw: "{stale}" },
  ];
  const recoveries = assertEventCountZero(
    "renderer_recoveries",
    lines,
    "runtime-health.jsonl",
    "renderer_recovery_restart_requested",
  );
  assert.equal(recoveries.status, "fail");
  assert.deepEqual(recoveries.violations, [
    { file: "runtime-health.jsonl", line: 2, excerpt: "{recovery}" },
  ]);

  const stale = assertEventCountZero(
    "stale_heartbeats",
    lines,
    "runtime-health.jsonl",
    "renderer_heartbeat_stale",
  );
  assert.equal(stale.status, "fail");
  assert.equal(stale.violations[0].line, 3);

  const clean = assertEventCountZero(
    "renderer_recoveries",
    lines.slice(0, 1),
    "runtime-health.jsonl",
    "renderer_recovery_restart_requested",
  );
  assert.equal(clean.status, "pass");
});

test("webkit_returns_to_baseline fails when the tail never returns to baseline", () => {
  const start = 1_700_000_000_000;
  const growing = parseMetricsTsv(
    metricsFixture(
      Array.from({ length: 10 }, (_, i) => ({
        tsMs: start + i * 60_000,
        iso: "t",
        webkitWebContentCount: i < 3 ? 4 : 9,
      })),
    ),
  );
  const failing = assertWebkitReturnsToBaseline(growing, "metrics.tsv");
  assert.equal(failing.status, "fail");
  assert.ok(failing.violations[0].line > 1);

  const returning = parseMetricsTsv(
    metricsFixture(
      Array.from({ length: 10 }, (_, i) => ({
        tsMs: start + i * 60_000,
        iso: "t",
        webkitWebContentCount: i > 3 && i < 7 ? 9 : 4,
      })),
    ),
  );
  assert.equal(assertWebkitReturnsToBaseline(returning, "metrics.tsv").status, "pass");
});

test("guarded P0-02/P0-03 counter assertions no-op until the counters exist", () => {
  const withoutCounters = [
    { entry: { event: "renderer_heartbeat", tsMs: 1 }, line: 1, raw: "{}" },
  ];
  const skipped = assertGuardedCounters(withoutCounters, "runtime-health.jsonl");
  assert.deepEqual(
    skipped.map((item) => [item.id, item.status]),
    [
      ["uploads_unchanged_heads", "skipped"],
      ["preflight_kills", "skipped"],
      ["scrape_zero_persist", "skipped"],
    ],
  );

  const withCounters = [
    { entry: { event: "cloud_upload", headsUnchanged: true, tsMs: 1 }, line: 1, raw: "{u}" },
    { entry: { event: "cloud_upload", headsUnchanged: false, tsMs: 2 }, line: 2, raw: "{u2}" },
    { entry: { event: "window_destroyed", sessionActive: true, tsMs: 3 }, line: 3, raw: "{kill}" },
    { entry: { event: "scrape_outcome", itemsExtracted: 12, itemsPersisted: 0, tsMs: 4 }, line: 4, raw: "{s}" },
  ];
  const judged = assertGuardedCounters(withCounters, "runtime-health.jsonl");
  assert.deepEqual(
    judged.map((item) => [item.id, item.status]),
    [
      ["uploads_unchanged_heads", "fail"],
      ["preflight_kills", "fail"],
      ["scrape_zero_persist", "fail"],
    ],
  );
  assert.equal(judged[0].violations[0].line, 1);
});

test("invariant alarm counts are informational and break down by name", () => {
  const none = [{ entry: { event: "renderer_heartbeat", tsMs: 1 }, line: 1, raw: "{}" }];
  const empty = assertAlarmCounts(none, "runtime-health.jsonl");
  assert.equal(empty.id, "invariant_alarms");
  assert.equal(empty.status, "pass");
  assert.match(empty.detail, /0 invariant_alarm events/);

  const withAlarms = [
    { entry: { event: "invariant_alarm", name: "cloud_loop", tsMs: 1 }, line: 1, raw: "{a1}" },
    { entry: { event: "invariant_alarm", name: "cloud_loop", tsMs: 2 }, line: 2, raw: "{a2}" },
    { entry: { event: "invariant_alarm", name: "watchdog_thrash", tsMs: 3 }, line: 3, raw: "{a3}" },
  ];
  const judged = assertAlarmCounts(withAlarms, "runtime-health.jsonl");
  // A firing alarm is the expected positive control, so it must never fail the verdict.
  assert.equal(judged.status, "pass");
  assert.match(judged.detail, /cloud_loop=2/);
  assert.match(judged.detail, /watchdog_thrash=1/);
  assert.equal(judged.violations.length, 3);
});

test("buildVerdict produces a machine-readable verdict with real numbers", () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "freed-soak-verdict-"));
  const start = 1_700_000_000_000;
  const healthPath = healthFixtureFile(
    dir,
    Array.from({ length: 21 }, (_, i) => ({
      event: "renderer_heartbeat",
      tsMs: start + i * 15 * 60_000,
      nativeFootprintBytes: 1000 * MB,
    })),
  );
  const metricsText = metricsFixture(
    Array.from({ length: 6 }, (_, i) => ({
      tsMs: start + i * 60 * 60_000,
      iso: new Date(start + i * 60 * 60_000).toISOString(),
      appPid: 1,
      appRssKb: 1000,
      webkitWebContentCount: 4,
    })),
  );

  const verdict = buildVerdict({
    soakDir: dir,
    metricsText,
    metricsPath: path.join(dir, "metrics.tsv"),
    healthLines: readHealthLines(healthPath),
    healthPath,
  });

  assert.equal(verdict.schemaVersion, 1);
  assert.equal(verdict.pass, true);
  assert.equal(verdict.failures, 0);
  assert.ok(verdict.spanHours >= 5);
  assert.equal(verdict.sampleCount, 6);
  const byId = Object.fromEntries(verdict.assertions.map((item) => [item.id, item.status]));
  assert.equal(byId.main_footprint_slope, "pass");
  assert.equal(byId.renderer_recoveries, "pass");
  assert.equal(byId.stale_heartbeats, "pass");
  assert.equal(byId.uploads_unchanged_heads, "skipped");
});

test("readHealthLines slices by tsMs window and keeps malformed lines out", () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "freed-soak-health-"));
  const healthPath = path.join(dir, "runtime-health.jsonl");
  writeFileSync(
    healthPath,
    ['{"event":"a","tsMs":100}', "not-json", '{"event":"b","tsMs":200}', '{"event":"c","tsMs":300}'].join(
      "\n",
    ),
  );
  const lines = readHealthLines(healthPath, { fromTsMs: 150, toTsMs: 250 });
  assert.equal(lines.length, 1);
  assert.equal(lines[0].entry.event, "b");
  assert.equal(lines[0].line, 3);
});
