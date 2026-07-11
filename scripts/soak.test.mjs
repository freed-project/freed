import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import {
  acquireCollectorLock,
  buildSample,
  METRICS_COLUMNS,
  metricsRowToTsv,
  mirrorHealthDelta,
  parsePsTable,
  parseArgs as parseCollectArgs,
  readLastHealthCursor,
  readLastHealthOffset,
  releaseCollectorLock,
} from "./soak-collect.mjs";
import {
  assertAlarmCounts,
  assertEventCountZero,
  assertFootprintSlope,
  assertGuardedCounters,
  assertWebkitReturnsToBaseline,
  buildCompositeEvidenceFingerprint,
  buildVerdict,
  classifyWindowDestruction,
  collectorMetricsEvidenceFingerprint,
  computeAppAliveCoverage,
  computeCloudEligibleHours,
  computeRuntimeHealthCoverage,
  footprintSlopeMbPerHour,
  parseMetricsTsv,
  readHealthLines,
  runtimeHealthEvidenceFingerprint,
  runtimeIdentityFromHealthLines,
} from "./soak-assert.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MB = 1024 * 1024;
const RUNTIME_IDENTITY = Object.freeze({
  appVersion: "26.7.1000-dev",
  buildCommitSha: "a".repeat(40),
  channel: "dev",
  appSessionId: "app-session-1",
});
const COLLECTOR_PROCESS_IDENTITY = Object.freeze({
  schemaVersion: 1,
  platform: "darwin",
  startIdentity: "darwin:Fri Jul 10 18:00:00 2026",
  commandDigest: "a".repeat(64),
  collectorEntrypoint: "soak-collect.mjs",
});

function withRuntimeIdentity(entry, identity = RUNTIME_IDENTITY) {
  return { ...entry, ...identity };
}

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
    ...rows.map((row) =>
      METRICS_COLUMNS.map((column) => row[column] ?? 0).join("\t"),
    ),
  ].join("\n");
}

function healthFixtureFile(dir, lines) {
  const healthPath = path.join(dir, "runtime-health.jsonl");
  writeFileSync(
    healthPath,
    lines.map((line) => JSON.stringify(line)).join("\n") + "\n",
  );
  return healthPath;
}

function healthySoakEvidence(dir) {
  const start = 1_700_000_000_000;
  const healthEntries = [
    ...Array.from({ length: 301 }, (_, index) =>
      withRuntimeIdentity({
        event: "renderer_heartbeat",
        tsMs: start + index * 60_000,
        nativeFootprintBytes: 1_000 * MB,
      }),
    ),
    withRuntimeIdentity({
      event: "cloud_sync_coverage",
      tsMs: start + 5 * 60 * 60_000,
      connected: true,
      eligible: true,
      intervalStartMs: start,
      intervalEndMs: start + 5 * 60 * 60_000,
    }),
    withRuntimeIdentity({
      event: "window_destroyed",
      tsMs: start + 5 * 60 * 60_000 - 2,
      reasonEnum: "job_complete",
      label: "facebook-scraper",
      scraperSessionHeld: false,
    }),
    withRuntimeIdentity({
      event: "scrape_outcome",
      tsMs: start + 5 * 60 * 60_000 - 1,
      itemsExtracted: 0,
      itemsNovel: 0,
      itemsPersisted: 0,
    }),
  ];
  const healthPath = healthFixtureFile(dir, healthEntries);
  const metricsText = metricsFixture(
    Array.from({ length: 301 }, (_, index) => ({
      tsMs: start + index * 60_000,
      iso: new Date(start + index * 60_000).toISOString(),
      appPid: 1,
      appRssKb: 1_000,
      webkitWebContentCount: 4,
    })),
  );
  return { healthEntries, healthPath, metricsText };
}

test("parsePsTable and buildSample split app, WebContent, and other WebKit processes", () => {
  const rows = parsePsTable(PS_FIXTURE);
  assert.equal(rows.length, 5);

  const sample = buildSample(rows, {
    appBinary: "Freed.app/Contents/MacOS",
    tsMs: 1_700_000_000_000,
  });
  assert.equal(sample.appPid, 10312);
  assert.equal(sample.appRssKb, 913728);
  assert.equal(sample.webkitWebContentCount, 2);
  assert.equal(sample.webkitWebContentRssKb, 173152 + 6706592);
  assert.equal(sample.webkitLargestRssKb, 6706592);
  assert.equal(sample.webkitOtherRssKb, 92288);

  const tsv = metricsRowToTsv({
    ...sample,
    healthFileBytes: 10,
    healthFileLines: 2,
  });
  assert.equal(tsv.trim().split("\t").length, METRICS_COLUMNS.length);
});

test("soak-collect parseArgs derives a soaks dir under ~/.freed/automation", () => {
  const args = parseCollectArgs([], new Date("2026-07-02T10:00:00Z"));
  assert.ok(args.soakDir.includes(path.join(".freed", "automation", "soaks")));
  assert.ok(args.pointer.endsWith("current-soak-dir"));
  assert.throws(
    () => parseCollectArgs(["--interval-seconds", "1"]),
    /at least 5/,
  );
});

test("soak collector lock rejects overlap and recovers a dead owner", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "freed-soak-lock-"));
  const pointer = path.join(root, "current-soak-dir");
  const inspectProcessIdentity = () => COLLECTOR_PROCESS_IDENTITY;
  const first = acquireCollectorLock({
    pointer,
    soakDir: path.join(root, "soak-a"),
    inspectProcessIdentity,
  });
  assert.throws(
    () =>
      acquireCollectorLock({
        pointer,
        soakDir: path.join(root, "soak-b"),
        inspectProcessIdentity,
      }),
    /already owns/,
  );
  assert.equal(releaseCollectorLock(first), true);

  writeFileSync(
    `${pointer}.collector-lock`,
    `${JSON.stringify({
      schemaVersion: 1,
      token: "dead-owner",
      pid: 2_147_483_647,
      soakDir: path.join(root, "old-soak"),
      acquiredAt: "2026-07-01T00:00:00.000Z",
    })}\n`,
  );
  const recovered = acquireCollectorLock({
    pointer,
    soakDir: path.join(root, "soak-c"),
    inspectProcessIdentity,
  });
  assert.equal(releaseCollectorLock(recovered), true);
});

test("soak collector lock recovers a reused live PID with mismatched process identity", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "freed-soak-reused-pid-"));
  const pointer = path.join(root, "current-soak-dir");
  const lockPath = `${pointer}.collector-lock`;
  const oldIdentity = {
    ...COLLECTOR_PROCESS_IDENTITY,
    startIdentity: "darwin:Fri Jul 10 17:00:00 2026",
    commandDigest: "b".repeat(64),
  };
  const unrelatedLiveIdentity = {
    ...COLLECTOR_PROCESS_IDENTITY,
    startIdentity: "darwin:Fri Jul 10 18:30:00 2026",
    commandDigest: "c".repeat(64),
    collectorEntrypoint: null,
  };
  writeFileSync(
    lockPath,
    `${JSON.stringify({
      schemaVersion: 2,
      token: "old-collector",
      pid: process.ppid,
      soakDir: path.join(root, "old-soak"),
      acquiredAt: "2026-07-10T17:00:00.000Z",
      ownerProcessIdentity: oldIdentity,
    })}\n`,
  );

  const recovered = acquireCollectorLock({
    pointer,
    soakDir: path.join(root, "new-soak"),
    inspectProcessIdentity: (pid) =>
      pid === process.pid ? COLLECTOR_PROCESS_IDENTITY : unrelatedLiveIdentity,
  });
  const replacement = JSON.parse(readFileSync(lockPath, "utf8"));
  assert.notEqual(replacement.token, "old-collector");
  assert.deepEqual(
    replacement.ownerProcessIdentity,
    COLLECTOR_PROCESS_IDENTITY,
  );
  assert.equal(releaseCollectorLock(recovered), true);
});

test("soak collector lock refuses recovery when a live owner identity is unavailable", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "freed-soak-unknown-owner-"));
  const pointer = path.join(root, "current-soak-dir");
  const lockPath = `${pointer}.collector-lock`;
  writeFileSync(
    lockPath,
    `${JSON.stringify({
      schemaVersion: 2,
      token: "unknown-owner",
      pid: process.ppid,
      soakDir: path.join(root, "old-soak"),
      acquiredAt: "2026-07-10T17:00:00.000Z",
      ownerProcessIdentity: COLLECTOR_PROCESS_IDENTITY,
    })}\n`,
  );
  assert.throws(
    () =>
      acquireCollectorLock({
        pointer,
        soakDir: path.join(root, "new-soak"),
        inspectProcessIdentity: (pid) =>
          pid === process.pid ? COLLECTOR_PROCESS_IDENTITY : null,
      }),
    /refusing stale recovery/,
  );
  assert.equal(
    JSON.parse(readFileSync(lockPath, "utf8")).token,
    "unknown-owner",
  );
});

async function waitForCondition(predicate, timeoutMs = 3_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) {
      return true;
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  return predicate();
}

test(
  "soak-collect --detach reports success only after lock handoff and rejects overlap",
  { timeout: 15_000 },
  async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "freed-soak-detach-"));
    const soakDir = path.join(root, "soak");
    const pointer = path.join(root, "state", "current-soak-dir");
    const scriptPath = path.join(__dirname, "soak-collect.mjs");
    const args = [
      scriptPath,
      "--detach",
      "--soak-dir",
      soakDir,
      "--pointer",
      pointer,
      "--app-data",
      root,
      "--interval-seconds",
      "5",
      "--duration-minutes",
      "1",
    ];
    let childPid = 0;

    try {
      const firstOutput = execFileSync(process.execPath, args, {
        encoding: "utf8",
      });
      const pidMatch = firstOutput.match(/Detached collector pid (\d+),/);
      assert.ok(pidMatch, firstOutput);
      childPid = Number(pidMatch[1]);

      const lockPath = `${pointer}.collector-lock`;
      const lock = JSON.parse(readFileSync(lockPath, "utf8"));
      assert.equal(lock.pid, childPid);
      assert.equal(lock.soakDir, soakDir);
      assert.equal(typeof lock.handedOffAt, "string");
      assert.equal(lock.schemaVersion, 2);
      assert.equal(
        lock.ownerProcessIdentity.collectorEntrypoint,
        "soak-collect.mjs",
      );
      assert.equal(typeof lock.ownerProcessIdentity.startIdentity, "string");
      assert.match(lock.ownerProcessIdentity.commandDigest, /^[a-f0-9]{64}$/);
      assert.ok(existsSync(path.join(soakDir, "metrics.tsv")));

      const overlap = spawnSync(
        process.execPath,
        [...args.slice(0, 3), path.join(root, "other-soak"), ...args.slice(4)],
        {
          encoding: "utf8",
        },
      );
      assert.equal(
        overlap.status,
        1,
        "overlapping detached collector unexpectedly succeeded",
      );
      assert.match(overlap.stderr, /already owns/);
      assert.doesNotMatch(overlap.stdout, /Detached collector/);
    } finally {
      if (!childPid && existsSync(`${pointer}.collector-lock`)) {
        childPid = Number(
          JSON.parse(readFileSync(`${pointer}.collector-lock`, "utf8")).pid,
        );
      }
      if (childPid > 0) {
        try {
          process.kill(childPid, "SIGTERM");
        } catch (error) {
          if (error?.code !== "ESRCH") {
            throw error;
          }
        }
      }
      assert.equal(
        await waitForCondition(() => !existsSync(`${pointer}.collector-lock`)),
        true,
        "detached collector did not release its lock",
      );
    }
  },
);

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
  assert.equal(existsSync(`${pointer}.collector-lock`), false);
  assert.equal(readFileSync(pointer, "utf8").trim(), soakDir);

  const metrics = readFileSync(path.join(soakDir, "metrics.tsv"), "utf8")
    .trim()
    .split("\n");
  assert.equal(metrics[0], METRICS_COLUMNS.join("\t"));
  assert.equal(metrics.length, 2);

  const info = JSON.parse(
    readFileSync(path.join(soakDir, "soak-info.json"), "utf8"),
  );
  assert.equal(info.schemaVersion, 2);
  assert.equal(typeof info.collectorSessionId, "string");
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
  assert.equal(
    readFileSync(mirrorPath, "utf8"),
    readFileSync(healthPath, "utf8"),
  );

  // Each --once is a fresh process, so the cursor round-trips through
  // health-offsets.jsonl; only the appended line may be copied again.
  writeFileSync(
    healthPath,
    readFileSync(healthPath, "utf8") + '{"event":"c","tsMs":3}\n',
  );
  runCollectOnce(root, soakDir, pointer);
  assert.equal(
    readFileSync(mirrorPath, "utf8"),
    '{"event":"a","tsMs":1}\n{"event":"b","tsMs":2}\n{"event":"c","tsMs":3}\n',
  );

  const offsets = readFileSync(
    path.join(soakDir, "health-offsets.jsonl"),
    "utf8",
  )
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
  assert.equal(offsets.length, 2);
  assert.equal(offsets[0].rotated, false);
  assert.equal(offsets[1].bytes, readFileSync(healthPath).length);
  assert.equal(offsets[1].appendedBytes, '{"event":"c","tsMs":3}\n'.length);
  assert.equal(
    readLastHealthOffset(path.join(soakDir, "health-offsets.jsonl")),
    offsets[1].bytes,
  );
});

test("soak-collect re-mirrors from byte 0 after rotation without duplicating", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "freed-soak-rotate-"));
  const soakDir = path.join(root, "soak");
  const pointer = path.join(root, "state", "current-soak-dir");
  const healthPath = path.join(root, "runtime-health.jsonl");
  const mirrorPath = path.join(soakDir, "runtime-health.jsonl");

  writeFileSync(
    healthPath,
    '{"event":"old-1","tsMs":1}\n{"event":"old-2","tsMs":2}\n',
  );
  runCollectOnce(root, soakDir, pointer);

  // Daily rotation truncates the live file; the mirror keeps the old window
  // and appends the whole rotated file exactly once.
  writeFileSync(healthPath, '{"event":"new-1","tsMs":3}\n');
  runCollectOnce(root, soakDir, pointer);
  assert.equal(
    readFileSync(mirrorPath, "utf8"),
    '{"event":"old-1","tsMs":1}\n{"event":"old-2","tsMs":2}\n{"event":"new-1","tsMs":3}\n',
  );

  const offsets = readFileSync(
    path.join(soakDir, "health-offsets.jsonl"),
    "utf8",
  )
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
  assert.equal(offsets[1].rotated, true);
  assert.equal(offsets[1].bytes, '{"event":"new-1","tsMs":3}\n'.length);
});

test("soak-collect detects an equal-or-larger replacement after a process restart", () => {
  const root = mkdtempSync(
    path.join(os.tmpdir(), "freed-soak-replace-growth-"),
  );
  const soakDir = path.join(root, "soak");
  const pointer = path.join(root, "state", "current-soak-dir");
  const healthPath = path.join(root, "runtime-health.jsonl");
  const mirrorPath = path.join(soakDir, "runtime-health.jsonl");
  const oldText = '{"event":"old-1","tsMs":1}\n';
  const newText =
    '{"event":"new-1","tsMs":2}\n{"event":"new-2-with-longer-payload","tsMs":3}\n';

  writeFileSync(healthPath, oldText);
  runCollectOnce(root, soakDir, pointer);
  const replacementPath = path.join(root, "runtime-health.next.jsonl");
  writeFileSync(replacementPath, newText);
  renameSync(replacementPath, healthPath);
  runCollectOnce(root, soakDir, pointer);

  assert.equal(readFileSync(mirrorPath, "utf8"), `${oldText}${newText}`);
  const offsets = readFileSync(
    path.join(soakDir, "health-offsets.jsonl"),
    "utf8",
  )
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
  assert.equal(offsets[1].rotated, true);
  assert.equal(offsets[1].rotationReason, "file-generation-changed");
  assert.equal(offsets[1].fileGenerationChanged, true);
  assert.match(offsets[1].prefixSha256, /^[0-9a-f]{64}$/);
  assert.equal(
    readLastHealthCursor(path.join(soakDir, "health-offsets.jsonl")).bytes,
    newText.length,
  );
});

test("mirrorHealthDelta detects same-file truncate-regrow past the saved offset", () => {
  const root = mkdtempSync(
    path.join(os.tmpdir(), "freed-soak-truncate-regrow-"),
  );
  const healthPath = path.join(root, "runtime-health.jsonl");
  const mirrorPath = path.join(root, "mirror.jsonl");
  const oldText = '{"event":"old","tsMs":1}\n';
  const newText = '{"event":"new-longer-than-old","tsMs":2}\n';

  writeFileSync(healthPath, oldText);
  const first = mirrorHealthDelta({ healthPath, mirrorPath, lastBytes: 0 });
  writeFileSync(healthPath, newText);
  const second = mirrorHealthDelta({ healthPath, mirrorPath, cursor: first });

  assert.equal(second.rotated, true);
  assert.equal(second.fileGenerationChanged, false);
  assert.equal(second.rotationReason, "prefix-continuity-changed");
  assert.equal(readFileSync(mirrorPath, "utf8"), `${oldText}${newText}`);
});

test("mirrorHealthDelta completes a partially written line on the next sample", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "freed-soak-partial-"));
  const healthPath = path.join(root, "runtime-health.jsonl");
  const mirrorPath = path.join(root, "mirror.jsonl");

  writeFileSync(healthPath, '{"event":"a","tsMs":1}\n{"event":"b"');
  const first = mirrorHealthDelta({ healthPath, mirrorPath, lastBytes: 0 });
  assert.equal(first.rotated, false);

  writeFileSync(healthPath, '{"event":"a","tsMs":1}\n{"event":"b","tsMs":2}\n');
  const second = mirrorHealthDelta({
    healthPath,
    mirrorPath,
    lastBytes: first.bytes,
  });
  assert.equal(second.rotated, false);
  assert.equal(
    readFileSync(mirrorPath, "utf8"),
    readFileSync(healthPath, "utf8"),
  );

  // Unchanged file appends nothing.
  const third = mirrorHealthDelta({
    healthPath,
    mirrorPath,
    lastBytes: second.bytes,
  });
  assert.equal(third.appendedBytes, 0);
  assert.equal(
    readFileSync(mirrorPath, "utf8"),
    readFileSync(healthPath, "utf8"),
  );
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

  const failing = assertFootprintSlope(
    leaky,
    [],
    "metrics.tsv",
    "runtime-health.jsonl",
  );
  assert.equal(failing.status, "fail");
  assert.match(failing.detail, /MB\/h/);

  const passing = assertFootprintSlope(
    flat,
    [],
    "metrics.tsv",
    "runtime-health.jsonl",
  );
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
  const result = assertFootprintSlope(
    short,
    [],
    "metrics.tsv",
    "runtime-health.jsonl",
  );
  assert.equal(result.status, "skipped");
  assert.match(result.detail, /needs >= 4h/);
});

test("recovery and stale-heartbeat assertions cite the violating lines", () => {
  const lines = [
    { entry: { event: "renderer_heartbeat", tsMs: 1 }, line: 1, raw: "{hb}" },
    {
      entry: { event: "renderer_recovery_restart_requested", tsMs: 2 },
      line: 2,
      raw: "{recovery}",
    },
    {
      entry: { event: "renderer_heartbeat_stale", tsMs: 3 },
      line: 3,
      raw: "{stale}",
    },
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
  assert.equal(
    assertWebkitReturnsToBaseline(returning, "metrics.tsv").status,
    "pass",
  );
});

test("guarded P0-02/P0-03 counter assertions no-op until the counters exist", () => {
  const withoutCounters = [
    { entry: { event: "renderer_heartbeat", tsMs: 1 }, line: 1, raw: "{}" },
  ];
  const skipped = assertGuardedCounters(
    withoutCounters,
    "runtime-health.jsonl",
  );
  assert.deepEqual(
    skipped.map((item) => [item.id, item.status]),
    [
      ["uploads_unchanged_heads", "inconclusive"],
      ["preflight_kills", "skipped"],
      ["scrape_zero_persist", "skipped"],
    ],
  );

  const withCounters = [
    ...Array.from({ length: 5 }, (_, index) => ({
      entry: {
        event: "cloud_upload_attempt",
        headsUnchanged: true,
        tsMs: index + 1,
      },
      line: index + 1,
      raw: `{u${index}}`,
    })),
    {
      entry: {
        event: "window_destroyed",
        reasonEnum: "preflight_recycle",
        scraperSessionHeld: true,
        jsActiveJob: "fb_scrape_feed",
        tsMs: 6,
      },
      line: 6,
      raw: "{kill}",
    },
    {
      entry: {
        event: "scrape_outcome",
        itemsExtracted: 12,
        itemsNovel: 12,
        itemsPersisted: 0,
        tsMs: 7,
      },
      line: 7,
      raw: "{s}",
    },
  ];
  const judged = assertGuardedCounters(withCounters, "runtime-health.jsonl", {
    cloudCoverageHours: 1,
  });
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

test("cloud churn is judged by the program rate target instead of any nonzero upload", () => {
  const start = 1_700_000_000_000;
  const lines = [
    {
      entry: {
        event: "cloud_upload_attempt",
        headsUnchanged: true,
        tsMs: start,
      },
      line: 1,
      raw: "{u1}",
    },
    {
      entry: {
        event: "cloud_upload_attempt",
        headsUnchanged: true,
        tsMs: start + 1,
      },
      line: 2,
      raw: "{u2}",
    },
  ];
  const [upload] = assertGuardedCounters(lines, "runtime-health.jsonl", {
    cloudCoverageHours: 3.3,
  });
  assert.equal(upload.status, "pass");
  assert.match(upload.detail, /0\.61\/h; target below 5\/h/);
});

test("cloud churn stays inconclusive without connected and eligible coverage", () => {
  const lines = [
    {
      entry: { event: "cloud_upload_attempt", headsUnchanged: true, tsMs: 1 },
      line: 1,
      raw: "{u1}",
    },
  ];
  const [upload] = assertGuardedCounters(lines, "runtime-health.jsonl");
  assert.equal(upload.status, "inconclusive");
  assert.match(upload.detail, /no valid cloud_sync_coverage interval/);
});

test("app-alive coverage rejects empty and mostly-dead collector windows", () => {
  assert.equal(computeAppAliveCoverage([]).healthy, false);
  const coverage = computeAppAliveCoverage([
    { tsMs: 1_000, appPid: 1 },
    { tsMs: 61_000, appPid: 0 },
    { tsMs: 121_000, appPid: 0 },
  ]);
  assert.equal(coverage.healthy, false);
  assert.equal(coverage.appAliveHours, 0);
});

test("app-alive coverage rejects sparse samples and duplicate timestamps", () => {
  const start = 1_700_000_000_000;
  const sparse = computeAppAliveCoverage([
    { tsMs: start, appPid: 1 },
    { tsMs: start + 60_000, appPid: 1 },
    { tsMs: start + 24 * 60 * 60_000, appPid: 1 },
  ]);
  assert.equal(sparse.healthy, false);
  assert.ok(sparse.appAliveHours < 0.1);
  assert.ok(sparse.sampleDensity < 0.01);
  assert.equal(sparse.maxCreditedGapMs, 150_000);

  const duplicateOnly = computeAppAliveCoverage([
    { tsMs: start, appPid: 1 },
    { tsMs: start, appPid: 1 },
    { tsMs: start + 60_000, appPid: 1 },
  ]);
  assert.equal(duplicateOnly.healthy, false);
  assert.equal(duplicateOnly.distinctSampleCount, 2);
});

test("runtime-health coverage requires dense fresh liveness across app-alive segments", () => {
  const start = 1_700_000_000_000;
  const metricsRows = Array.from({ length: 11 }, (_, index) => ({
    tsMs: start + index * 60_000,
    appPid: 1,
  }));
  const healthyLines = Array.from({ length: 11 }, (_, index) => ({
    entry: withRuntimeIdentity({
      event: "renderer_heartbeat",
      tsMs: start + index * 60_000,
    }),
  }));
  const healthy = computeRuntimeHealthCoverage(healthyLines, metricsRows);
  assert.equal(healthy.runtimeHealthCoverageHealthy, true);
  assert.equal(healthy.runtimeHealthDistinctSampleCount, 11);
  assert.equal(healthy.runtimeHealthExpectedSampleCount, 10);
  assert.equal(healthy.runtimeHealthLargestObservedGapMs, 60_000);
  assert.equal(healthy.runtimeHealthLastFreshnessMs, 0);
  assert.equal(healthy.runtimeHealthCoveredAppAliveSegmentCount, 1);

  const thin = computeRuntimeHealthCoverage(
    [healthyLines[0], healthyLines.at(-1)],
    metricsRows,
  );
  assert.equal(thin.runtimeHealthCoverageHealthy, false);
  assert.equal(thin.runtimeHealthDistinctSampleCount, 2);
  assert.equal(thin.runtimeHealthExpectedSampleCount, 10);
  assert.equal(thin.runtimeHealthSampleDensity, 0.2);
  assert.equal(thin.runtimeHealthLargestObservedGapMs, 10 * 60_000);
});

test("cloud coverage merges overlapping attributable intervals", () => {
  const start = 1_700_000_000_000;
  const hours = computeCloudEligibleHours(
    [
      {
        entry: {
          event: "cloud_sync_coverage",
          connected: true,
          eligible: true,
          intervalStartMs: start,
          intervalEndMs: start + 60 * 60_000,
        },
      },
      {
        entry: {
          event: "cloud_sync_coverage",
          connected: true,
          eligible: true,
          intervalStartMs: start + 30 * 60_000,
          intervalEndMs: start + 90 * 60_000,
        },
      },
      {
        entry: {
          event: "cloud_sync_coverage",
          connected: false,
          eligible: true,
          intervalStartMs: start + 90 * 60_000,
          intervalEndMs: start + 120 * 60_000,
        },
      },
    ],
    Array.from({ length: 91 }, (_, index) => ({
      tsMs: start + index * 60_000,
      appPid: 1,
    })),
  );
  assert.equal(hours, 1.5);
});

test("runtime fingerprints preserve duplicate event multiplicity", () => {
  const event = withRuntimeIdentity({
    event: "cloud_upload_attempt",
    headsUnchanged: true,
    tsMs: 1_700_000_000_000,
  });
  const once = runtimeHealthEvidenceFingerprint([{ entry: event }]);
  const twice = runtimeHealthEvidenceFingerprint([
    { entry: event },
    { entry: event },
  ]);
  assert.notEqual(once.digest, twice.digest);
  assert.equal(once.recordCount, 1);
  assert.equal(twice.recordCount, 2);
});

test("runtime attribution rejects untagged and mixed metric evidence", () => {
  const tagged = withRuntimeIdentity({ event: "worker_init", tsMs: 1 });
  const untagged = { event: "native_runtime_memory_sample", tsMs: 2 };
  assert.equal(
    runtimeIdentityFromHealthLines([{ entry: tagged }, { entry: untagged }])
      .status,
    "incomplete",
  );
  const mixed = withRuntimeIdentity(
    { event: "worker_init", tsMs: 3 },
    { ...RUNTIME_IDENTITY, appSessionId: "app-session-2" },
  );
  assert.equal(
    runtimeIdentityFromHealthLines([{ entry: tagged }, { entry: mixed }])
      .status,
    "mixed",
  );
});

test("composite evidence fingerprints bind collector data and denominators", () => {
  const metricsText = metricsFixture([
    { tsMs: 1, appPid: 1 },
    { tsMs: 60_001, appPid: 1 },
    { tsMs: 120_001, appPid: 1 },
    { tsMs: 180_001, appPid: 1 },
  ]);
  const healthLines = [1, 60_001, 120_001, 180_001].map((tsMs) => ({
    entry: withRuntimeIdentity({ event: "renderer_heartbeat", tsMs }),
  }));
  const metricsRows = parseMetricsTsv(metricsText);
  const sourceHealth = {
    ...computeAppAliveCoverage(metricsRows),
    ...computeRuntimeHealthCoverage(healthLines, metricsRows),
  };
  sourceHealth.cloudEligibleHours = null;
  const runtimeAttribution = {
    collectorSessionId: "collector-1",
    appPid: 1,
    ...RUNTIME_IDENTITY,
  };
  const fingerprint = buildCompositeEvidenceFingerprint({
    runtimeHealthFingerprint: runtimeHealthEvidenceFingerprint(healthLines),
    collectorMetricsFingerprint:
      collectorMetricsEvidenceFingerprint(metricsText),
    sourceHealth,
    runtimeAttribution,
  });
  const changedCoverage = buildCompositeEvidenceFingerprint({
    runtimeHealthFingerprint: fingerprint.runtimeHealth,
    collectorMetricsFingerprint: fingerprint.collectorMetrics,
    sourceHealth: {
      ...sourceHealth,
      appAliveHours: sourceHealth.appAliveHours / 2,
    },
    runtimeAttribution,
  });
  const changedMetrics = buildCompositeEvidenceFingerprint({
    runtimeHealthFingerprint: fingerprint.runtimeHealth,
    collectorMetricsFingerprint: collectorMetricsEvidenceFingerprint(
      `${metricsText}\n`,
    ),
    sourceHealth,
    runtimeAttribution,
  });
  const changedRuntimeCoverage = buildCompositeEvidenceFingerprint({
    runtimeHealthFingerprint: fingerprint.runtimeHealth,
    collectorMetricsFingerprint: fingerprint.collectorMetrics,
    sourceHealth: {
      ...sourceHealth,
      runtimeHealthLastFreshnessMs:
        sourceHealth.runtimeHealthLastFreshnessMs + 1,
    },
    runtimeAttribution,
  });
  assert.notEqual(changedCoverage.digest, fingerprint.digest);
  assert.notEqual(changedMetrics.digest, fingerprint.digest);
  assert.notEqual(changedRuntimeCoverage.digest, fingerprint.digest);
  assert.equal(fingerprint.collectorMetrics.recordCount, 4);
});

test("window destruction excludes expected self-teardown and catches active cross-cutting recovery", () => {
  const expected = {
    event: "window_destroyed",
    label: "li-scraper",
    reasonEnum: "job_complete",
    scraperSessionHeld: true,
    jsActiveJob: "li_scrape_feed",
  };
  const destructive = {
    event: "window_destroyed",
    label: "main",
    reasonEnum: "watchdog_memory",
    scraperSessionHeld: false,
    jsActiveJob: "fb_scrape_feed",
  };
  const crossProviderCompletion = {
    event: "window_destroyed",
    label: "li-scraper",
    reasonEnum: "job_complete",
    scraperSessionHeld: true,
    jsActiveJob: "fb_scrape_feed",
  };
  assert.equal(classifyWindowDestruction(expected), "expected_self_teardown");
  assert.equal(
    classifyWindowDestruction(destructive),
    "active_operation_destroyed",
  );
  assert.equal(
    classifyWindowDestruction(crossProviderCompletion),
    "active_operation_destroyed",
  );

  const expectedOnly = assertGuardedCounters(
    [{ entry: expected, line: 1, raw: "{expected}" }],
    "runtime-health.jsonl",
  );
  assert.equal(expectedOnly[1].status, "pass");

  const withDestruction = assertGuardedCounters(
    [
      { entry: expected, line: 1, raw: "{expected}" },
      { entry: destructive, line: 2, raw: "{destructive}" },
    ],
    "runtime-health.jsonl",
  );
  assert.equal(withDestruction[1].status, "fail");
  assert.equal(withDestruction[1].violations[0].line, 2);
});

test("scrape persistence requires novel-item evidence and does not call duplicates data loss", () => {
  const legacyDuplicate = {
    event: "scrape_outcome",
    itemsExtracted: 76,
    itemsPersisted: 0,
  };
  const inferredDuplicate = {
    ...legacyDuplicate,
    itemsAlreadyPresent: 76,
  };
  const novelLoss = {
    ...legacyDuplicate,
    itemsNovel: 5,
  };
  const legacy = assertGuardedCounters(
    [{ entry: legacyDuplicate, line: 1, raw: "{legacy}" }],
    "runtime-health.jsonl",
  );
  assert.equal(legacy[2].status, "skipped");
  assert.match(legacy[2].detail, /duplicate-only scrapes are not data loss/);

  const duplicate = assertGuardedCounters(
    [{ entry: inferredDuplicate, line: 1, raw: "{duplicate}" }],
    "runtime-health.jsonl",
  );
  assert.equal(duplicate[2].status, "pass");

  const lost = assertGuardedCounters(
    [{ entry: novelLoss, line: 1, raw: "{lost}" }],
    "runtime-health.jsonl",
  );
  assert.equal(lost[2].status, "fail");
});

test("invariant alarm counts are informational and break down by name", () => {
  const none = [
    { entry: { event: "renderer_heartbeat", tsMs: 1 }, line: 1, raw: "{}" },
  ];
  const empty = assertAlarmCounts(none, "runtime-health.jsonl");
  assert.equal(empty.id, "invariant_alarms");
  assert.equal(empty.status, "pass");
  assert.match(empty.detail, /0 invariant_alarm events/);

  const withAlarms = [
    {
      entry: { event: "invariant_alarm", name: "cloud_loop", tsMs: 1 },
      line: 1,
      raw: "{a1}",
    },
    {
      entry: { event: "invariant_alarm", name: "cloud_loop", tsMs: 2 },
      line: 2,
      raw: "{a2}",
    },
    {
      entry: { event: "invariant_alarm", name: "watchdog_thrash", tsMs: 3 },
      line: 3,
      raw: "{a3}",
    },
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
  const { healthPath, metricsText } = healthySoakEvidence(dir);

  const verdict = buildVerdict({
    soakDir: dir,
    metricsText,
    metricsPath: path.join(dir, "metrics.tsv"),
    healthLines: readHealthLines(healthPath),
    healthPath,
    soakInfo: {
      collectorSessionId: "collector-session-1",
      intervalSeconds: 60,
    },
  });

  assert.equal(verdict.schemaVersion, 1);
  assert.equal(verdict.metricRegistryVersion, 2);
  assert.equal(verdict.pass, true);
  assert.equal(verdict.status, "pass");
  assert.equal(verdict.failures, 0);
  assert.ok(verdict.spanHours >= 5);
  assert.equal(verdict.sampleCount, 301);
  assert.equal(verdict.runtimeIdentity.attributable, true);
  assert.equal(
    verdict.runtimeIdentity.collectorSessionId,
    "collector-session-1",
  );
  assert.equal(verdict.runtimeIdentity.appVersion, "26.7.1000-dev");
  assert.equal(verdict.runtimeIdentity.buildCommitSha, "a".repeat(40));
  assert.equal(verdict.runtimeIdentity.appSessionId, "app-session-1");
  assert.equal(verdict.sourceHealth.cloudEligibleHours, 5);
  assert.equal(verdict.sourceHealth.sampleDensity, 1);
  assert.equal(verdict.sourceHealth.runtimeHealthCoverageHealthy, true);
  assert.equal(verdict.sourceHealth.runtimeHealthDistinctSampleCount, 301);
  assert.equal(verdict.sourceHealth.runtimeHealthExpectedSampleCount, 300);
  assert.equal(
    verdict.evidenceFingerprint.coverage.runtimeHealthDistinctSampleCount,
    301,
  );
  assert.equal(verdict.evidenceFingerprint.collectorMetrics.recordCount, 301);
  assert.equal(
    verdict.evidenceFingerprint.runtimeHealth.recordCount,
    verdict.healthLineCount,
  );
  const byId = Object.fromEntries(
    verdict.assertions.map((item) => [item.id, item.status]),
  );
  assert.equal(byId.main_footprint_slope, "pass");
  assert.equal(byId.renderer_recoveries, "pass");
  assert.equal(byId.stale_heartbeats, "pass");
  assert.equal(byId.uploads_unchanged_heads, "pass");
});

test("buildVerdict keeps zero and rate assertions inconclusive for a thin runtime stream", () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "freed-soak-thin-runtime-"));
  const { healthPath, metricsText } = healthySoakEvidence(dir);
  const completeLines = readHealthLines(healthPath);
  const heartbeatLines = completeLines.filter(
    ({ entry }) => entry.event === "renderer_heartbeat",
  );
  const thinLines = completeLines.filter(
    ({ entry }) => entry.event !== "renderer_heartbeat",
  );
  thinLines.push(heartbeatLines[0], heartbeatLines.at(-1));
  const verdict = buildVerdict({
    soakDir: dir,
    metricsText,
    metricsPath: path.join(dir, "metrics.tsv"),
    healthLines: thinLines,
    healthPath,
    soakInfo: {
      collectorSessionId: "collector-session-1",
      intervalSeconds: 60,
    },
  });

  assert.equal(verdict.runtimeIdentity.attributable, true);
  assert.equal(verdict.sourceHealth.runtimeHealthCoverageHealthy, false);
  assert.equal(verdict.sourceHealth.runtimeHealthDistinctSampleCount, 2);
  assert.equal(verdict.status, "inconclusive");
  const byId = Object.fromEntries(
    verdict.assertions.map((item) => [item.id, item.status]),
  );
  assert.equal(byId.source_health, "inconclusive");
  assert.equal(byId.renderer_recoveries, "inconclusive");
  assert.equal(byId.stale_heartbeats, "inconclusive");
  assert.equal(byId.uploads_unchanged_heads, "inconclusive");
  assert.equal(byId.preflight_kills, "inconclusive");
  assert.equal(byId.scrape_zero_persist, "inconclusive");
  assert.equal(byId.invariant_alarms, "inconclusive");
  assert.equal(verdict.measurements["renderer-recovery-count"], undefined);
  assert.equal(verdict.measurements["worker-init-rate"], undefined);
});

test("malformed runtime and collector records make a soak verdict inconclusive", () => {
  const runtimeDir = mkdtempSync(
    path.join(os.tmpdir(), "freed-soak-malformed-runtime-"),
  );
  const runtimeEvidence = healthySoakEvidence(runtimeDir);
  writeFileSync(
    runtimeEvidence.healthPath,
    `${readFileSync(runtimeEvidence.healthPath, "utf8")}not-json\n`,
  );
  const malformedRuntime = buildVerdict({
    soakDir: runtimeDir,
    metricsText: runtimeEvidence.metricsText,
    metricsPath: path.join(runtimeDir, "metrics.tsv"),
    healthLines: readHealthLines(runtimeEvidence.healthPath),
    healthPath: runtimeEvidence.healthPath,
    soakInfo: {
      collectorSessionId: "collector-session-1",
      intervalSeconds: 60,
    },
  });
  assert.equal(malformedRuntime.pass, false);
  assert.equal(malformedRuntime.status, "inconclusive");
  assert.equal(
    malformedRuntime.sourceHealth.runtimeHealthMalformedLineCount,
    1,
  );
  assert.equal(
    malformedRuntime.assertions.find((item) => item.id === "source_health")
      ?.status,
    "inconclusive",
  );

  const collectorDir = mkdtempSync(
    path.join(os.tmpdir(), "freed-soak-malformed-collector-"),
  );
  const collectorEvidence = healthySoakEvidence(collectorDir);
  const collectorLines = collectorEvidence.metricsText.trimEnd().split("\n");
  collectorLines.splice(150, 0, "1700008940000\t2023-11-15T00:00:00.000Z\t1");
  const malformedCollector = buildVerdict({
    soakDir: collectorDir,
    metricsText: `${collectorLines.join("\n")}\n`,
    metricsPath: path.join(collectorDir, "metrics.tsv"),
    healthLines: readHealthLines(collectorEvidence.healthPath),
    healthPath: collectorEvidence.healthPath,
    soakInfo: {
      collectorSessionId: "collector-session-1",
      intervalSeconds: 60,
    },
  });
  assert.equal(malformedCollector.pass, false);
  assert.equal(malformedCollector.status, "inconclusive");
  assert.equal(malformedCollector.sourceHealth.collectorMalformedRowCount, 1);
  assert.equal(malformedCollector.sourceHealth.collectorHeaderHealthy, true);
});

test("buildVerdict marks untagged metric evidence unattributable", () => {
  const start = 1_700_000_000_000;
  const metricsText = metricsFixture(
    Array.from({ length: 301 }, (_, index) => ({
      tsMs: start + index * 60_000,
      iso: new Date(start + index * 60_000).toISOString(),
      appPid: 1,
      appRssKb: 1_000,
      webkitWebContentCount: 1,
    })),
  );
  const verdict = buildVerdict({
    soakDir: "/tmp/untagged-soak",
    metricsText,
    metricsPath: "/tmp/untagged-soak/metrics.tsv",
    healthLines: [
      {
        entry: { event: "worker_init", tsMs: start + 1 },
        line: 1,
        raw: "{}",
      },
    ],
    healthPath: "/tmp/untagged-soak/runtime-health.jsonl",
    soakInfo: {
      collectorSessionId: "collector-session-1",
      intervalSeconds: 60,
    },
  });
  assert.equal(verdict.runtimeIdentity.attributable, false);
  assert.equal(verdict.runtimeIdentity.evidenceStatus, "incomplete");
  assert.equal(
    verdict.assertions.find((item) => item.id === "source_health")?.status,
    "inconclusive",
  );
});

test("buildVerdict marks an empty soak inconclusive instead of passing zeros", () => {
  const verdict = buildVerdict({
    soakDir: "/tmp/empty-soak",
    metricsText: "",
    metricsPath: "/tmp/empty-soak/metrics.tsv",
    healthLines: [],
    healthPath: "/tmp/empty-soak/runtime-health.jsonl",
  });
  assert.equal(verdict.pass, false);
  assert.equal(verdict.status, "inconclusive");
  assert.ok(verdict.inconclusiveAssertions > 0);
});

test("readHealthLines slices by tsMs window and keeps malformed lines out", () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "freed-soak-health-"));
  const healthPath = path.join(dir, "runtime-health.jsonl");
  writeFileSync(
    healthPath,
    [
      '{"event":"a","tsMs":100}',
      "not-json",
      '{"event":"b","tsMs":200}',
      '{"event":"c","tsMs":300}',
    ].join("\n"),
  );
  const lines = readHealthLines(healthPath, { fromTsMs: 150, toTsMs: 250 });
  assert.equal(lines.length, 1);
  assert.equal(lines[0].entry.event, "b");
  assert.equal(lines[0].line, 3);
  assert.deepEqual(lines.sourceDiagnostics.malformedLines, [2]);
  assert.equal(lines.sourceDiagnostics.sourceLineCount, 2);
});
