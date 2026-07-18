import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import {
  acquireCollectorLock,
  appendCollectorEvent,
  beginCollectorSession,
  buildSample,
  COLLECTOR_EVENTS_SCHEMA_VERSION,
  collectorEventEvidenceDeclaration,
  createCollectorTickState,
  ensurePendingOutageEvidenceDurable,
  hydrateCollectorTickStateFromEventsText,
  METRICS_COLUMNS,
  metricsRowToTsv,
  mirrorHealthDelta,
  parsePsTable,
  parseArgs as parseCollectArgs,
  readLastHealthCursor,
  readLastHealthOffset,
  releaseCollectorLock,
  runCollectorTick,
  SOAK_SCHEMA_VERSION,
  stopCollectorSession,
} from "./soak-collect.mjs";
import {
  assertAlarmCounts,
  assertEventCountZero,
  assertFootprintSlope,
  assertGuardedCounters,
  assertRendererRecoveryCountZero,
  assertRequestSurfaceContracts,
  assertWorkerIdleTerminationContract,
  assertWorkerInitRate,
  assertWebkitReturnsToBaseline,
  buildCompositeEvidenceFingerprint,
  buildVerdict,
  classifyWindowDestruction,
  collectorMetricsEvidenceFingerprint,
  computeAppAliveCoverage,
  computeCloudEligibleHours,
  computeCollectorEventCoverage,
  computeNativeMemoryPressureCoverage,
  computeRuntimeHealthCoverage,
  footprintSlopeMbPerHour,
  isMetricRelevantRuntimeEntry,
  parseCollectorEventsJsonl,
  parseMetricsTsv,
  readHealthLines,
  runtimeHealthEvidenceFingerprint,
  runtimeIdentityFromHealthLines,
  summarizeRequestSurfaceEvents,
  summarizeWorkerIdleTerminations,
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

function collectorCapableSoakInfo(overrides = {}) {
  return {
    schemaVersion: SOAK_SCHEMA_VERSION,
    collectorEvents: collectorEventEvidenceDeclaration(),
    ...overrides,
  };
}

function closedCollectorSessionEventsText({
  startMs = 1_700_000_000_000,
  endMs = startMs + 5 * 60 * 60_000,
  collectorRunId = "collector-run-1",
} = {}) {
  return `${JSON.stringify({
    schemaVersion: COLLECTOR_EVENTS_SCHEMA_VERSION,
    event: "collector_session_started",
    tsMs: startMs,
    collectorRunId,
  })}\n${JSON.stringify({
    schemaVersion: COLLECTOR_EVENTS_SCHEMA_VERSION,
    event: "collector_session_stopped",
    tsMs: endMs,
    collectorRunId,
    sessionStartedAtMs: startMs,
    reason: "duration_reached",
  })}\n`;
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
    ...Array.from({ length: 301 }, (_, index) =>
      withRuntimeIdentity({
        event: "native_runtime_memory_sample",
        tsMs: start + index * 60_000,
        appMemoryPressureBytes: (700 + (index % 20)) * MB,
        memoryHighBytes: 4 * 1024 * MB,
        memoryCriticalBytes: 6 * 1024 * MB,
        pageLoadId: "page-1",
        rendererGeneration: 1,
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
    const events = parseCollectorEventsJsonl(
      readFileSync(path.join(soakDir, "collector-events.jsonl"), "utf8"),
    );
    const coverage = computeCollectorEventCoverage(events, {
      requireClosedSession: true,
    });
    assert.equal(coverage.collectorEventCoverageHealthy, true);
    assert.equal(coverage.collectorEventSessionStartCount, 1);
    assert.equal(coverage.collectorEventSessionStopCount, 1);
  },
);

test(
  "detached collector survives a periodic metrics failure and records recovery",
  { timeout: 30_000 },
  async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "freed-soak-recovery-"));
    const soakDir = path.join(root, "soak");
    const pointer = path.join(root, "state", "current-soak-dir");
    const metricsPath = path.join(soakDir, "metrics.tsv");
    const savedMetricsPath = path.join(soakDir, "metrics.saved.tsv");
    const eventsPath = path.join(soakDir, "collector-events.jsonl");
    const args = [
      path.join(__dirname, "soak-collect.mjs"),
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
      const output = execFileSync(process.execPath, args, { encoding: "utf8" });
      const pidMatch = output.match(/Detached collector pid (\d+),/);
      assert.ok(pidMatch, output);
      childPid = Number(pidMatch[1]);
      const initialMetricsLines = readFileSync(metricsPath, "utf8")
        .trim()
        .split("\n").length;
      const initialEventsText = readFileSync(eventsPath, "utf8");
      const initialSession = JSON.parse(
        initialEventsText.split("\n").find((line) => line.trim()),
      );
      const rotationPadding = Array.from({ length: 550 }, () => {
        const tsMs = Number(initialSession.tsMs) + 1;
        return `${JSON.stringify({
          schemaVersion: COLLECTOR_EVENTS_SCHEMA_VERSION,
          event: "collector_sample_failed",
          tsMs,
          failedSamples: 1,
          sampleMayBePartial: true,
          padding: "p".repeat(1_000),
        })}\n${JSON.stringify({
          schemaVersion: COLLECTOR_EVENTS_SCHEMA_VERSION,
          event: "collector_sample_recovered",
          tsMs,
          failedSamples: 1,
          failureStartedAtMs: tsMs,
          failureLastObservedAtMs: tsMs,
          outageMs: 0,
          padding: "p".repeat(1_000),
        })}\n`;
      }).join("");
      writeFileSync(eventsPath, `${initialEventsText}${rotationPadding}`);

      renameSync(metricsPath, savedMetricsPath);
      mkdirSync(metricsPath);
      assert.equal(
        await waitForCondition(
          () =>
            existsSync(`${eventsPath}.1`) &&
            existsSync(eventsPath) &&
            readFileSync(eventsPath, "utf8").includes(
              '"event":"collector_sample_failed"',
            ),
          15_000,
        ),
        true,
        "detached collector did not record the induced sample failure",
      );
      assert.doesNotThrow(() => process.kill(childPid, 0));
      assert.equal(existsSync(`${pointer}.collector-lock`), true);

      rmSync(metricsPath, { recursive: true });
      renameSync(savedMetricsPath, metricsPath);
      assert.equal(
        await waitForCondition(() => {
          if (!existsSync(eventsPath)) return false;
          const eventsText = readFileSync(eventsPath, "utf8");
          if (!eventsText.includes('"event":"collector_sample_recovered"')) {
            return false;
          }
          return (
            readFileSync(metricsPath, "utf8").trim().split("\n").length >
            initialMetricsLines
          );
        }, 15_000),
        true,
        "detached collector did not resume metrics after the induced failure",
      );
      assert.doesNotThrow(() => process.kill(childPid, 0));
      assert.equal(existsSync(`${pointer}.collector-lock`), true);
    } finally {
      if (existsSync(savedMetricsPath)) {
        rmSync(metricsPath, { recursive: true, force: true });
        renameSync(savedMetricsPath, metricsPath);
      }
      if (!childPid && existsSync(`${pointer}.collector-lock`)) {
        childPid = Number(
          JSON.parse(readFileSync(`${pointer}.collector-lock`, "utf8")).pid,
        );
      }
      if (childPid > 0) {
        try {
          process.kill(childPid, "SIGTERM");
        } catch (error) {
          if (error?.code !== "ESRCH") throw error;
        }
      }
      assert.equal(
        await waitForCondition(
          () => !existsSync(`${pointer}.collector-lock`),
          5_000,
        ),
        true,
        "detached collector did not release its lock",
      );
    }
    const archivePath = `${eventsPath}.1`;
    assert.equal(existsSync(archivePath), true);
    for (const filePath of [archivePath, eventsPath]) {
      const coverage = computeCollectorEventCoverage(
        parseCollectorEventsJsonl(readFileSync(filePath, "utf8")),
        { requireClosedSession: true },
      );
      assert.equal(
        coverage.collectorEventCoverageHealthy,
        true,
        `${path.basename(filePath)} does not contain a closed lifecycle segment`,
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
  assert.ok(existsSync(path.join(soakDir, "collector-events.jsonl")));
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
  assert.equal(info.schemaVersion, SOAK_SCHEMA_VERSION);
  assert.deepEqual(info.collectorEvents, collectorEventEvidenceDeclaration());
  assert.equal(typeof info.collectorSessionId, "string");
  assert.deepEqual(info.metricsColumns, METRICS_COLUMNS);
  const eventCoverage = computeCollectorEventCoverage(
    parseCollectorEventsJsonl(
      readFileSync(path.join(soakDir, "collector-events.jsonl"), "utf8"),
    ),
    { requireClosedSession: true },
  );
  assert.equal(eventCoverage.collectorEventCoverageHealthy, true);
  assert.equal(eventCoverage.collectorEventCount, 2);
});

test("a capability-bearing collector restart refuses a missing event file", () => {
  const root = mkdtempSync(
    path.join(os.tmpdir(), "freed-soak-events-missing-"),
  );
  const soakDir = path.join(root, "soak");
  const pointer = path.join(root, "state", "current-soak-dir");
  const args = [
    path.join(__dirname, "soak-collect.mjs"),
    "--once",
    "--soak-dir",
    soakDir,
    "--pointer",
    pointer,
    "--app-data",
    root,
  ];
  execFileSync(process.execPath, args, { encoding: "utf8" });
  const eventPath = path.join(soakDir, "collector-events.jsonl");
  rmSync(eventPath);

  const restarted = spawnSync(process.execPath, args, { encoding: "utf8" });
  assert.equal(restarted.status, 1);
  assert.match(restarted.stderr, /Collector event evidence is missing/);
  assert.equal(existsSync(eventPath), false);
  assert.equal(existsSync(`${pointer}.collector-lock`), false);
});

test("a collector restart closes the prior session and recovers its open sample outage", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "freed-soak-resume-outage-"));
  const soakDir = path.join(root, "soak");
  const pointer = path.join(root, "state", "current-soak-dir");
  const args = [
    path.join(__dirname, "soak-collect.mjs"),
    "--once",
    "--soak-dir",
    soakDir,
    "--pointer",
    pointer,
    "--app-data",
    root,
  ];
  execFileSync(process.execPath, args, { encoding: "utf8" });
  const eventPath = path.join(soakDir, "collector-events.jsonl");
  const sessionStartedAtMs = Date.now() - 120_000;
  const failureStartedAtMs = sessionStartedAtMs + 60_000;
  const priorRunId = "collector-run-before-restart";
  writeFileSync(
    eventPath,
    `${JSON.stringify({
      schemaVersion: COLLECTOR_EVENTS_SCHEMA_VERSION,
      event: "collector_session_started",
      tsMs: sessionStartedAtMs,
      collectorRunId: priorRunId,
    })}\n${JSON.stringify({
      schemaVersion: COLLECTOR_EVENTS_SCHEMA_VERSION,
      event: "collector_sample_failed",
      tsMs: failureStartedAtMs,
      failedSamples: 1,
      sampleMayBePartial: true,
      errorName: "Error",
      errorMessage: "metrics write failed before restart",
    })}\n`,
  );

  execFileSync(process.execPath, args, { encoding: "utf8" });
  const eventsText = readFileSync(eventPath, "utf8");
  const entries = parseCollectorEventsJsonl(eventsText);
  const coverage = computeCollectorEventCoverage(entries, {
    requireClosedSession: true,
  });
  assert.equal(coverage.collectorEventCoverageHealthy, true);
  assert.equal(coverage.collectorEventSessionAbandonCount, 1);
  assert.equal(coverage.collectorEventFailureCount, 1);
  assert.equal(coverage.collectorEventRecoveryCount, 1);
  assert.match(eventsText, /collector_restarted_after_unclosed_session/);
  assert.equal(
    hydrateCollectorTickStateFromEventsText(eventsText).consecutiveFailures,
    0,
  );
});

test("a collector restart cannot close the prior session unless its replacement start is durable", () => {
  const startMs = 1_000;
  const priorEventsText = `${JSON.stringify({
    schemaVersion: COLLECTOR_EVENTS_SCHEMA_VERSION,
    event: "collector_session_started",
    tsMs: startMs,
    collectorRunId: "prior-run",
  })}\n`;
  const lifecycle = {
    collectorRunId: "replacement-run",
    sessionStartedAtMs: null,
  };
  assert.throws(
    () =>
      beginCollectorSession(
        "/unused",
        lifecycle,
        priorEventsText,
        2_000,
        () => {
          throw new Error("event sink unavailable");
        },
      ),
    /event sink unavailable/,
  );
  assert.equal(lifecycle.sessionStartedAtMs, null);
  const coverage = computeCollectorEventCoverage(
    parseCollectorEventsJsonl(priorEventsText),
    { requireClosedSession: true },
  );
  assert.equal(coverage.collectorEventCoverageHealthy, false);
  assert.equal(coverage.collectorOutageOpen, true);
});

test("a standalone abandoned-session record cannot close lifecycle evidence", () => {
  const text = `${JSON.stringify({
    schemaVersion: COLLECTOR_EVENTS_SCHEMA_VERSION,
    event: "collector_session_started",
    tsMs: 1_000,
    collectorRunId: "prior-run",
  })}\n${JSON.stringify({
    schemaVersion: COLLECTOR_EVENTS_SCHEMA_VERSION,
    event: "collector_session_abandoned",
    tsMs: 2_000,
    collectorRunId: "prior-run",
    sessionStartedAtMs: 1_000,
    reason: "replacement_failed_to_start",
  })}\n`;
  const coverage = computeCollectorEventCoverage(
    parseCollectorEventsJsonl(text),
    { requireClosedSession: true },
  );
  assert.equal(coverage.collectorEventCoverageHealthy, false);
  assert.equal(coverage.collectorEventMalformedLineCount, 1);
  assert.equal(coverage.collectorOutageOpen, true);
});

test("collector shutdown refuses to hide a failure marker that is still unwritten", () => {
  const state = createCollectorTickState();
  runCollectorTick({
    args: { soakDir: "/unused" },
    cursor: {},
    state,
    now: 1_000,
    takeSampleFn: () => {
      throw new Error("sample write failed");
    },
    writeEventFn: () => {
      throw new Error("failure marker write failed");
    },
  });
  assert.equal(state.failureRecorded, false);
  assert.throws(
    () =>
      ensurePendingOutageEvidenceDurable({
        state,
        writeEventFn: () => {
          throw new Error("failure marker still unavailable");
        },
        soakDir: "/unused",
        now: 2_000,
      }),
    /Refusing to close collector evidence/,
  );
  assert.equal(state.failureRecorded, false);
});

test("lifecycle-aware collector event rotation is retry safe", () => {
  const root = mkdtempSync(
    path.join(os.tmpdir(), "freed-soak-rotation-retry-"),
  );
  const eventPath = path.join(root, "collector-events.jsonl");
  const archivePath = `${eventPath}.1`;
  const lifecycle = {
    collectorRunId: "rotation-run",
    sessionStartedAtMs: 100,
  };
  const startLine = `${JSON.stringify({
    schemaVersion: COLLECTOR_EVENTS_SCHEMA_VERSION,
    event: "collector_session_started",
    tsMs: lifecycle.sessionStartedAtMs,
    collectorRunId: lifecycle.collectorRunId,
  })}\n`;
  const padding = Array.from({ length: 550 }, () => {
    const tsMs = 101;
    return `${JSON.stringify({
      schemaVersion: COLLECTOR_EVENTS_SCHEMA_VERSION,
      event: "collector_sample_failed",
      tsMs,
      failedSamples: 1,
      sampleMayBePartial: true,
      padding: "p".repeat(1_000),
    })}\n${JSON.stringify({
      schemaVersion: COLLECTOR_EVENTS_SCHEMA_VERSION,
      event: "collector_sample_recovered",
      tsMs,
      failedSamples: 1,
      failureStartedAtMs: tsMs,
      failureLastObservedAtMs: tsMs,
      outageMs: 0,
      padding: "p".repeat(1_000),
    })}\n`;
  }).join("");
  writeFileSync(eventPath, `${startLine}${padding}`);
  mkdirSync(archivePath);
  const state = createCollectorTickState();
  const writeEventFn = (soakDir, event) =>
    appendCollectorEvent(soakDir, event, lifecycle);
  const failSample = () => {
    throw new Error("metrics unavailable");
  };

  runCollectorTick({
    args: { soakDir: root },
    cursor: {},
    state,
    now: 2_000,
    takeSampleFn: failSample,
    writeEventFn,
  });
  assert.equal(state.failureRecorded, false);
  assert.equal(
    (readFileSync(eventPath, "utf8").match(/collector_session_stopped/g) ?? [])
      .length,
    0,
  );

  rmSync(archivePath, { recursive: true });
  runCollectorTick({
    args: { soakDir: root },
    cursor: {},
    state,
    now: 2_500,
    takeSampleFn: failSample,
    writeEventFn,
  });
  assert.equal(state.failureRecorded, true);
  runCollectorTick({
    args: { soakDir: root },
    cursor: {},
    state,
    now: 3_000,
    takeSampleFn: () => ({ appPid: 42 }),
    writeEventFn,
  });
  stopCollectorSession(root, lifecycle, "signal_sigterm", 4_000);

  for (const filePath of [archivePath, eventPath]) {
    const coverage = computeCollectorEventCoverage(
      parseCollectorEventsJsonl(readFileSync(filePath, "utf8")),
      { requireClosedSession: true },
    );
    assert.equal(coverage.collectorEventCoverageHealthy, true);
  }
  assert.equal(
    (
      readFileSync(archivePath, "utf8").match(/collector_session_stopped/g) ??
      []
    ).length,
    1,
  );
});

test("a partially published rotation cannot reuse a session identity and pass", () => {
  const start = {
    schemaVersion: COLLECTOR_EVENTS_SCHEMA_VERSION,
    event: "collector_session_started",
    tsMs: 1_000,
    collectorRunId: "rotation-run",
  };
  const rotationStop = {
    schemaVersion: COLLECTOR_EVENTS_SCHEMA_VERSION,
    event: "collector_session_stopped",
    tsMs: 1_000,
    collectorRunId: "rotation-run",
    sessionStartedAtMs: 1_000,
    reason: "event_file_rotation",
  };
  const restart = {
    schemaVersion: COLLECTOR_EVENTS_SCHEMA_VERSION,
    event: "collector_session_restarted",
    tsMs: 2_000,
    collectorRunId: "replacement-run",
    priorCollectorRunId: "rotation-run",
    priorSessionStartedAtMs: 1_000,
    reason: "collector_restarted_after_unclosed_session",
  };
  const replacementStop = {
    schemaVersion: COLLECTOR_EVENTS_SCHEMA_VERSION,
    event: "collector_session_stopped",
    tsMs: 3_000,
    collectorRunId: "replacement-run",
    sessionStartedAtMs: 2_000,
    reason: "signal_sigterm",
  };
  const partialArchive = `${JSON.stringify(start)}\n${JSON.stringify(rotationStop)}\n`;
  const staleCurrent = `${JSON.stringify(start)}\n${JSON.stringify(restart)}\n${JSON.stringify(replacementStop)}\n`;
  const coverage = computeCollectorEventCoverage(
    parseCollectorEventsJsonl(`${partialArchive}${staleCurrent}`),
    { requireClosedSession: true },
  );
  assert.equal(coverage.collectorEventCoverageHealthy, false);
  assert.ok(coverage.collectorEventProtocolErrorCount >= 1);
});

test("collector ticks survive transient sample failures and persist one outage pair", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "freed-soak-tick-"));
  const args = { soakDir: root };
  const cursor = {};
  const state = createCollectorTickState();
  let attempts = 0;
  const takeSampleFn = () => {
    attempts += 1;
    if (attempts <= 2) {
      const error = new Error(`temporary sample failure ${attempts}`);
      error.code = "EIO";
      throw error;
    }
    return { appPid: 42 };
  };

  const first = runCollectorTick({
    args,
    cursor,
    state,
    now: 1_000,
    takeSampleFn,
  });
  const second = runCollectorTick({
    args,
    cursor,
    state,
    now: 61_000,
    takeSampleFn,
  });
  const recovered = runCollectorTick({
    args,
    cursor,
    state,
    now: 121_000,
    takeSampleFn,
  });
  const steady = runCollectorTick({
    args,
    cursor,
    state,
    now: 181_000,
    takeSampleFn,
  });

  assert.equal(first.ok, false);
  assert.equal(second.ok, false);
  assert.deepEqual(recovered, { ok: true, sample: { appPid: 42 } });
  assert.equal(steady.ok, true);
  assert.deepEqual(state, createCollectorTickState());

  const events = readFileSync(path.join(root, "collector-events.jsonl"), "utf8")
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
  assert.equal(events.length, 2);
  assert.deepEqual(
    events.map(({ event }) => event),
    ["collector_sample_failed", "collector_sample_recovered"],
  );
  assert.equal(events[0].failedSamples, 1);
  assert.equal(events[0].errorCode, "EIO");
  assert.equal(events[1].failedSamples, 2);
  assert.equal(events[1].failureStartedAtMs, 1_000);
  assert.equal(events[1].failureLastObservedAtMs, 61_000);
  assert.equal(events[1].outageMs, 120_000);
  assert.equal(events[1].firstError.errorMessage, "temporary sample failure 1");
  assert.equal(events[1].lastError.errorMessage, "temporary sample failure 2");
});

test("collector ticks keep separate event pairs for separate outages", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "freed-soak-outage-pairs-"));
  const state = createCollectorTickState();
  let attempt = 0;
  const takeSampleFn = () => {
    attempt += 1;
    if (attempt === 1 || attempt === 3) {
      throw new Error(`sample failure ${attempt}`);
    }
    return { appPid: 42 };
  };

  for (const now of [1_000, 61_000, 121_000, 181_000]) {
    runCollectorTick({
      args: { soakDir: root },
      cursor: {},
      state,
      now,
      takeSampleFn,
    });
  }

  const events = readFileSync(path.join(root, "collector-events.jsonl"), "utf8")
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
  assert.deepEqual(
    events.map(({ event }) => event),
    [
      "collector_sample_failed",
      "collector_sample_recovered",
      "collector_sample_failed",
      "collector_sample_recovered",
    ],
  );
  assert.deepEqual(
    events.map(({ tsMs }) => tsMs),
    [1_000, 61_000, 121_000, 181_000],
  );
});

test("collector events rotate at the bounded file limit and truncate error text", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "freed-soak-event-bound-"));
  const eventPath = path.join(root, "collector-events.jsonl");
  const prior = "p".repeat(1024 * 1024);
  writeFileSync(eventPath, prior);

  const result = runCollectorTick({
    args: { soakDir: root },
    cursor: {},
    state: createCollectorTickState(),
    now: 1_000,
    takeSampleFn: () => {
      throw new Error("e".repeat(2_000));
    },
  });

  assert.equal(result.ok, false);
  assert.equal(readFileSync(`${eventPath}.1`, "utf8"), prior);
  const event = JSON.parse(readFileSync(eventPath, "utf8"));
  assert.equal(event.event, "collector_sample_failed");
  assert.equal(event.errorMessage.length, 1_000);
});

test("collector event rotation keeps every failure and recovery pair in one file", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "freed-soak-event-pairs-"));
  const eventPath = path.join(root, "collector-events.jsonl");
  const eventPair = (failureTsMs, padding) => {
    const recoveryTsMs = failureTsMs + 1;
    return `${JSON.stringify({
      schemaVersion: COLLECTOR_EVENTS_SCHEMA_VERSION,
      event: "collector_sample_failed",
      tsMs: failureTsMs,
      failedSamples: 1,
      sampleMayBePartial: true,
      padding,
    })}\n${JSON.stringify({
      schemaVersion: COLLECTOR_EVENTS_SCHEMA_VERSION,
      event: "collector_sample_recovered",
      tsMs: recoveryTsMs,
      failedSamples: 1,
      failureStartedAtMs: failureTsMs,
      failureLastObservedAtMs: failureTsMs,
      outageMs: 1,
      padding,
    })}\n`;
  };
  const largeClosedStream = (startTsMs) =>
    Array.from({ length: 550 }, (_, index) =>
      eventPair(startTsMs + index * 2, "p".repeat(1_000)),
    ).join("");
  writeFileSync(eventPath, largeClosedStream(1_000));

  const state = createCollectorTickState();
  let shouldFail = true;
  const takeSampleFn = () => {
    if (shouldFail) {
      shouldFail = false;
      throw new Error("first rotated outage");
    }
    return { appPid: 42 };
  };
  runCollectorTick({
    args: { soakDir: root },
    cursor: {},
    state,
    now: 10_000,
    takeSampleFn,
  });
  runCollectorTick({
    args: { soakDir: root },
    cursor: {},
    state,
    now: 10_001,
    takeSampleFn,
  });
  const firstCombined = `${readFileSync(`${eventPath}.1`, "utf8")}${readFileSync(eventPath, "utf8")}`;
  assert.equal(
    computeCollectorEventCoverage(parseCollectorEventsJsonl(firstCombined))
      .collectorEventCoverageHealthy,
    true,
  );

  writeFileSync(
    eventPath,
    `${readFileSync(eventPath, "utf8")}${largeClosedStream(20_000)}`,
  );
  shouldFail = true;
  runCollectorTick({
    args: { soakDir: root },
    cursor: {},
    state,
    now: 30_000,
    takeSampleFn,
  });
  runCollectorTick({
    args: { soakDir: root },
    cursor: {},
    state,
    now: 30_001,
    takeSampleFn,
  });
  const archive = readFileSync(`${eventPath}.1`, "utf8");
  const current = readFileSync(eventPath, "utf8");
  assert.equal(
    JSON.parse(archive.split("\n")[0]).event,
    "collector_sample_failed",
  );
  assert.equal(
    JSON.parse(current.split("\n")[0]).event,
    "collector_sample_failed",
  );
  assert.equal(
    computeCollectorEventCoverage(
      parseCollectorEventsJsonl(`${archive}${current}`),
    ).collectorEventCoverageHealthy,
    true,
  );
});

test("collector ticks retry an unpersisted failure marker without exiting", () => {
  const state = createCollectorTickState();
  const events = [];
  let writes = 0;
  const writeEventFn = (_soakDir, event) => {
    writes += 1;
    if (writes === 1) {
      throw new Error("diagnostic volume temporarily unavailable");
    }
    events.push(event);
  };
  const takeSampleFn = () => {
    throw new Error("sample failed");
  };

  const first = runCollectorTick({
    args: { soakDir: "/unused" },
    cursor: {},
    state,
    now: 1_000,
    takeSampleFn,
    writeEventFn,
  });
  const second = runCollectorTick({
    args: { soakDir: "/unused" },
    cursor: {},
    state,
    now: 61_000,
    takeSampleFn,
    writeEventFn,
  });

  assert.equal(first.ok, false);
  assert.equal(second.ok, false);
  assert.equal(writes, 2);
  assert.equal(events.length, 1);
  assert.equal(events[0].event, "collector_sample_failed");
  assert.equal(events[0].failedSamples, 1);
  assert.equal(events[0].tsMs, 1_000);
  assert.equal(events[0].errorMessage, "sample failed");
  assert.equal(state.failureRecorded, true);
  assert.equal(state.consecutiveFailures, 2);
});

test("collector ticks persist a delayed failure marker before immediate recovery", () => {
  const state = createCollectorTickState();
  const events = [];
  let attempts = 0;
  let writes = 0;
  const first = runCollectorTick({
    args: { soakDir: "/unused" },
    cursor: {},
    state,
    now: 1_000,
    takeSampleFn: () => {
      attempts += 1;
      throw new Error("original sample failure");
    },
    writeEventFn: (_soakDir, event) => {
      writes += 1;
      if (writes === 1) throw new Error("diagnostic sink unavailable");
      events.push(event);
    },
  });
  const recovered = runCollectorTick({
    args: { soakDir: "/unused" },
    cursor: {},
    state,
    now: 61_000,
    takeSampleFn: () => {
      attempts += 1;
      return { appPid: 42 };
    },
    writeEventFn: (_soakDir, event) => {
      writes += 1;
      events.push(event);
    },
  });

  assert.equal(first.ok, false);
  assert.equal(recovered.ok, true);
  assert.equal(attempts, 2);
  assert.deepEqual(
    events.map(({ event }) => event),
    ["collector_sample_failed", "collector_sample_recovered"],
  );
  assert.equal(events[0].tsMs, 1_000);
  assert.equal(events[0].errorMessage, "original sample failure");
  assert.equal(events[1].tsMs, 61_000);
  assert.deepEqual(state, createCollectorTickState());
});

test("collector ticks retry a recovery marker before clearing outage state", () => {
  const state = createCollectorTickState();
  const events = [];
  let attempts = 0;
  let rejectRecovery = true;
  const takeSampleFn = () => {
    attempts += 1;
    if (attempts === 1) throw new Error("sample failed");
    return { appPid: 42 };
  };
  const writeEventFn = (_soakDir, event) => {
    if (event.event === "collector_sample_recovered" && rejectRecovery) {
      rejectRecovery = false;
      throw new Error("recovery write failed");
    }
    events.push(event);
  };

  runCollectorTick({
    args: { soakDir: "/unused" },
    cursor: {},
    state,
    now: 1_000,
    takeSampleFn,
    writeEventFn,
  });
  const firstSuccess = runCollectorTick({
    args: { soakDir: "/unused" },
    cursor: {},
    state,
    now: 61_000,
    takeSampleFn,
    writeEventFn,
  });
  assert.equal(firstSuccess.ok, true);
  assert.equal(state.recoveryEvent.tsMs, 61_000);

  const secondSuccess = runCollectorTick({
    args: { soakDir: "/unused" },
    cursor: {},
    state,
    now: 121_000,
    takeSampleFn,
    writeEventFn,
  });
  assert.equal(secondSuccess.ok, true);
  assert.deepEqual(
    events.map(({ event }) => event),
    ["collector_sample_failed", "collector_sample_recovered"],
  );
  assert.equal(events[1].tsMs, 61_000);
  assert.equal(events[1].outageMs, 60_000);
  assert.deepEqual(state, createCollectorTickState());
});

test(
  "detached collector reports startup sample failure and releases its lock",
  { timeout: 15_000 },
  async () => {
    const root = mkdtempSync(
      path.join(os.tmpdir(), "freed-soak-startup-fail-"),
    );
    const blockedSoakPath = path.join(root, "not-a-directory");
    const pointer = path.join(root, "state", "current-soak-dir");
    writeFileSync(blockedSoakPath, "blocked\n");
    const result = spawnSync(
      process.execPath,
      [
        path.join(__dirname, "soak-collect.mjs"),
        "--detach",
        "--soak-dir",
        blockedSoakPath,
        "--pointer",
        pointer,
        "--app-data",
        root,
      ],
      { encoding: "utf8", timeout: 10_000 },
    );

    assert.equal(result.status, 1);
    assert.match(result.stderr, /not-a-directory|EEXIST|directory/);
    assert.equal(
      await waitForCondition(() => !existsSync(`${pointer}.collector-lock`)),
      true,
    );
  },
);

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
      entry: {
        event: "window_destroyed",
        label: "main",
        requestedBy: "renderer heartbeat stale",
        appSessionId: "renderer-before-rebuild",
        tsMs: 2,
      },
      line: 2,
      raw: "{main-rebuild}",
    },
    {
      entry: {
        event: "renderer_recovery_restart_requested",
        reason: "renderer heartbeat stale",
        appSessionId: "renderer-after-rebuild",
        tsMs: 3,
      },
      line: 3,
      raw: "{paired-restart}",
    },
    {
      entry: { event: "renderer_heartbeat_stale", tsMs: 4 },
      line: 4,
      raw: "{stale}",
    },
  ];
  const recoveries = assertRendererRecoveryCountZero(
    lines,
    "runtime-health.jsonl",
  );
  assert.equal(recoveries.status, "fail");
  assert.deepEqual(recoveries.violations, [
    { file: "runtime-health.jsonl", line: 2, excerpt: "{main-rebuild}" },
  ]);

  const stale = assertEventCountZero(
    "stale_heartbeats",
    lines,
    "runtime-health.jsonl",
    "renderer_heartbeat_stale",
  );
  assert.equal(stale.status, "fail");
  assert.equal(stale.violations[0].line, 4);

  const clean = assertRendererRecoveryCountZero(
    [
      lines[0],
      {
        entry: {
          event: "window_destroyed",
          label: "facebook-scraper",
          requestedBy: "job complete",
          tsMs: 5,
        },
        line: 5,
        raw: "{scraper-window}",
      },
    ],
    "runtime-health.jsonl",
  );
  assert.equal(clean.status, "pass");
});

test("renderer recovery citations preserve repeated entry-object multiplicity", () => {
  const repeatedEntry = {
    event: "window_destroyed",
    label: "main",
    requestedBy: "renderer heartbeat stale",
    tsMs: 1_000,
  };
  const result = assertRendererRecoveryCountZero(
    [
      { entry: repeatedEntry, line: 10, raw: "{recovery-one}" },
      { entry: repeatedEntry, line: 11, raw: "{recovery-two}" },
    ],
    "runtime-health.jsonl",
  );

  assert.equal(result.status, "fail");
  assert.deepEqual(result.violations, [
    { file: "runtime-health.jsonl", line: 10, excerpt: "{recovery-one}" },
    { file: "runtime-health.jsonl", line: 11, excerpt: "{recovery-two}" },
  ]);
});

test("renderer recovery citations identify the unpaired repeated restart occurrence", () => {
  const repeatedRestart = {
    event: "renderer_recovery_restart_requested",
    reason: "renderer heartbeat stale",
    tsMs: 2_000,
  };
  const result = assertRendererRecoveryCountZero(
    [
      {
        entry: {
          event: "window_destroyed",
          label: "main",
          requestedBy: "renderer heartbeat stale",
          tsMs: 1_000,
        },
        line: 1,
        raw: "{main-rebuild}",
      },
      { entry: repeatedRestart, line: 2, raw: "{paired-restart}" },
      { entry: repeatedRestart, line: 3, raw: "{unpaired-restart}" },
    ],
    "runtime-health.jsonl",
  );

  assert.equal(result.status, "fail");
  assert.deepEqual(result.violations, [
    { file: "runtime-health.jsonl", line: 1, excerpt: "{main-rebuild}" },
    {
      file: "runtime-health.jsonl",
      line: 3,
      excerpt: "{unpaired-restart}",
    },
  ]);
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

test("request-surface summaries group events and enforce hard retry budgets", () => {
  const events = [
    {
      event: "cloud_upload_attempt",
      cause: "startup-repair",
      provider: "gdrive",
      appSessionId: "session-1",
    },
    {
      event: "cloud_upload_attempt",
      cause: "startup-repair",
      provider: "gdrive",
      appSessionId: "session-1",
    },
    {
      event: "cloud_upload_attempt",
      cause: "startup-repair",
      provider: "dropbox",
      appSessionId: "session-1",
    },
    {
      event: "social_outbox_attempt",
      provider: "x",
      action: "like",
      attempt: 1,
      maxAttempts: 3,
    },
    {
      event: "social_outbox_attempt",
      provider: "x",
      action: "like",
      attempt: 4,
      maxAttempts: 4,
    },
    {
      event: "facebook_group_discovery_update",
      source: "group_scrape",
      changedCount: 2,
      removedCount: 1,
    },
    { event: "rss_pull_attempt", trigger: "scheduled" },
    {
      event: "ai_request_attempt",
      provider: "openai",
      purpose: "summarize",
    },
    {
      event: "reader_article_fetch_attempt",
      source: "reader-open",
      pin: true,
    },
  ].map((entry, index) => ({
    entry,
    line: index + 1,
    raw: JSON.stringify(entry),
  }));
  const summary = summarizeRequestSurfaceEvents(events);
  assert.deepEqual(summary.startupRepairUploads.byProvider, {
    dropbox: 1,
    gdrive: 2,
  });
  assert.equal(summary.startupRepairUploads.maxPerProviderSession, 2);
  assert.equal(summary.startupRepairUploads.overBudgetGroupCount, 1);
  assert.deepEqual(summary.socialOutboxAttempts.byProviderAction, {
    x: { like: 2 },
  });
  assert.equal(summary.socialOutboxAttempts.invalidContractCount, 1);
  assert.deepEqual(summary.facebookGroupDiscoveryUpdates, {
    total: 1,
    bySource: { group_scrape: 1 },
    changedCount: 2,
    removedCount: 1,
  });
  assert.deepEqual(summary.rssPullAttempts.byTrigger, { scheduled: 1 });
  assert.deepEqual(summary.aiRequestAttempts.byProviderPurpose, {
    openai: { summarize: 1 },
  });
  assert.deepEqual(summary.readerArticleFetchAttempts.bySourcePin, {
    "reader-open": { pinned: 1 },
  });

  const assertions = assertRequestSurfaceContracts(
    events,
    "runtime-health.jsonl",
  );
  assert.deepEqual(
    assertions.map(({ id, status }) => [id, status]),
    [
      ["startup_repair_upload_budget", "fail"],
      ["social_outbox_retry_budget", "fail"],
    ],
  );
  assert.equal(assertions[0].violations.length, 2);
  assert.equal(assertions[1].violations[0].line, 5);

  const withinBudget = events.filter(
    ({ line }) => line !== 2 && line !== 5,
  );
  assert.deepEqual(
    assertRequestSurfaceContracts(withinBudget, "runtime-health.jsonl").map(
      ({ status }) => status,
    ),
    ["pass", "pass"],
  );
});

test("worker INIT rate enforces the exclusive scorecard target", () => {
  const workerInitLines = Array.from({ length: 10 }, (_, index) => ({
    entry: { event: "worker_init", tsMs: index + 1 },
    line: index + 1,
    raw: `{worker-${index + 1}}`,
  }));

  const pass = assertWorkerInitRate(
    workerInitLines.slice(0, 9),
    "runtime-health.jsonl",
    { appAliveHours: 1 },
  );
  assert.equal(pass.status, "pass");
  assert.match(pass.detail, /9\.00\/h; target below 10\/h/);

  const boundaryFailure = assertWorkerInitRate(
    workerInitLines,
    "runtime-health.jsonl",
    { appAliveHours: 1 },
  );
  assert.equal(boundaryFailure.status, "fail");
  assert.match(boundaryFailure.detail, /10\.00\/h; target below 10\/h/);
  assert.equal(boundaryFailure.violations.length, 10);
  assert.equal(boundaryFailure.violations[0].line, 1);

  const denominatorPass = assertWorkerInitRate(
    workerInitLines,
    "runtime-health.jsonl",
    { appAliveHours: 2 },
  );
  assert.equal(denominatorPass.status, "pass");
  assert.match(denominatorPass.detail, /5\.00\/h; target below 10\/h/);

  const zeroPass = assertWorkerInitRate([], "runtime-health.jsonl", {
    appAliveHours: 1,
  });
  assert.equal(zeroPass.status, "pass");
  assert.match(zeroPass.detail, /0\.00\/h; target below 10\/h/);
});

test("worker INIT rate fails closed without attributable one-hour coverage", () => {
  const workerInitLines = [
    {
      entry: { event: "worker_init", tsMs: 1 },
      line: 1,
      raw: "{worker}",
    },
  ];

  const unattributed = assertWorkerInitRate(
    workerInitLines,
    "runtime-health.jsonl",
    { appAliveHours: 2, runtimeEvidenceActionable: false },
  );
  assert.equal(unattributed.status, "inconclusive");
  assert.match(unattributed.detail, /coverage or attribution is incomplete/);

  const shortWindow = assertWorkerInitRate(
    workerInitLines,
    "runtime-health.jsonl",
    { appAliveHours: 0.99 },
  );
  assert.equal(shortWindow.status, "inconclusive");
  assert.match(shortWindow.detail, /needs at least 1h/);

  const missingDenominator = assertWorkerInitRate(
    workerInitLines,
    "runtime-health.jsonl",
  );
  assert.equal(missingDenominator.status, "inconclusive");
  assert.match(missingDenominator.detail, /no valid app-alive duration/);
});

test("worker lifecycle events require attribution and use a fixed reason summary", () => {
  const lines = [
    {
      entry: withRuntimeIdentity({
        event: "worker_idle_terminated",
        reason: "quiet_window",
        tsMs: 1,
      }),
      line: 1,
      raw: "{quiet}",
    },
    {
      entry: withRuntimeIdentity({
        event: "worker_idle_terminated",
        reason: "pending_request_retry",
        tsMs: 2,
      }),
      line: 2,
      raw: "{retry}",
    },
    {
      entry: withRuntimeIdentity({
        event: "worker_idle_terminated",
        reason: "request_timeout_cleanup",
        tsMs: 3,
      }),
      line: 3,
      raw: "{timeout}",
    },
    {
      entry: withRuntimeIdentity({ event: "worker_init_recovery", tsMs: 4 }),
      line: 4,
      raw: "{recovery}",
    },
  ];
  assert.equal(runtimeIdentityFromHealthLines(lines).status, "attributable");
  assert.deepEqual(summarizeWorkerIdleTerminations(lines), {
    total: 3,
    byReason: {
      quiet_window: 1,
      pending_request_retry: 1,
      request_timeout_cleanup: 1,
    },
    invalidReasonCount: 0,
  });
  assert.equal(
    assertWorkerIdleTerminationContract(lines, "runtime-health.jsonl").status,
    "pass",
  );

  const untagged = {
    entry: { event: "worker_init_recovery", tsMs: 5 },
    line: 5,
    raw: "{untagged}",
  };
  assert.equal(
    runtimeIdentityFromHealthLines([...lines, untagged]).status,
    "incomplete",
  );
  const invalid = [
    ...lines,
    {
      entry: withRuntimeIdentity({
        event: "worker_idle_terminated",
        reason: "mystery",
        tsMs: 6,
      }),
      line: 6,
      raw: "{invalid}",
    },
  ];
  const invalidAssertion = assertWorkerIdleTerminationContract(
    invalid,
    "runtime-health.jsonl",
  );
  assert.equal(invalidAssertion.status, "inconclusive");
  assert.equal(invalidAssertion.violations.length, 1);
});

test("native memory pressure p95 requires dense credited single-generation evidence", () => {
  const start = 1_700_000_000_000;
  const metricsRows = Array.from({ length: 11 }, (_, index) => ({
    tsMs: start + index * 60_000,
    appPid: 1,
  }));
  const memoryLines = Array.from({ length: 11 }, (_, index) => ({
    entry: withRuntimeIdentity({
      event: "native_runtime_memory_sample",
      tsMs: start + index * 60_000,
      appMemoryPressureBytes: (100 + index) * MB,
      memoryHighBytes: 4 * 1024 * MB,
      memoryCriticalBytes: 6 * 1024 * MB,
      pageLoadId: "page-1",
      rendererGeneration: 1,
    }),
  }));
  const outside = {
    entry: withRuntimeIdentity({
      ...memoryLines.at(-1).entry,
      tsMs: start + 20 * 60_000,
      appMemoryPressureBytes: 9_999 * MB,
    }),
  };
  const healthy = computeNativeMemoryPressureCoverage(
    [...memoryLines, outside],
    metricsRows,
  );
  assert.equal(healthy.nativeMemoryPressureCoverageHealthy, true);
  assert.equal(healthy.nativeMemoryPressureDistinctSampleCount, 11);
  assert.equal(healthy.appMemoryPressureP95Bytes, 110 * MB);

  const duplicate = computeNativeMemoryPressureCoverage(
    [...memoryLines, memoryLines[0]],
    metricsRows,
  );
  assert.equal(duplicate.nativeMemoryPressureCoverageHealthy, false);
  assert.equal(duplicate.nativeMemoryPressureDuplicateTimestampCount, 1);
  assert.equal(duplicate.appMemoryPressureP95Bytes, null);

  const mixedGeneration = structuredClone(memoryLines);
  mixedGeneration.at(-1).entry.rendererGeneration = 2;
  assert.equal(
    computeNativeMemoryPressureCoverage(mixedGeneration, metricsRows)
      .nativeMemoryPressureCoverageHealthy,
    false,
  );

  const missingField = structuredClone(memoryLines);
  delete missingField[4].entry.memoryHighBytes;
  const invalid = computeNativeMemoryPressureCoverage(
    missingField,
    metricsRows,
  );
  assert.equal(invalid.nativeMemoryPressureCoverageHealthy, false);
  assert.equal(invalid.nativeMemoryPressureInvalidSampleCount, 1);
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

test("request-surface counters are attributable runtime evidence", () => {
  for (const event of [
    "social_outbox_attempt",
    "facebook_group_discovery_update",
    "rss_pull_attempt",
    "ai_request_attempt",
    "reader_article_fetch_attempt",
  ]) {
    assert.equal(isMetricRelevantRuntimeEntry({ event }), true, event);
    assert.equal(
      runtimeIdentityFromHealthLines([{ entry: { event } }]).status,
      "incomplete",
      event,
    );
  }
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
  const measurementStartMs = 1_700_000_000_000;
  const measurementEndMs = measurementStartMs + 5 * 60 * 60_000;

  const verdict = buildVerdict({
    soakDir: dir,
    metricsText,
    metricsPath: path.join(dir, "metrics.tsv"),
    healthLines: readHealthLines(healthPath),
    healthPath,
    collectorEventsText: closedCollectorSessionEventsText({
      startMs: measurementStartMs - 60_000,
      endMs: measurementEndMs + 60_000,
    }),
    collectorEventsEvidencePresent: true,
    soakInfo: collectorCapableSoakInfo({
      collectorSessionId: "collector-session-1",
      intervalSeconds: 60,
    }),
  });

  assert.equal(verdict.schemaVersion, 1);
  assert.equal(verdict.windowStart, new Date(measurementStartMs).toISOString());
  assert.equal(verdict.windowEnd, new Date(measurementEndMs).toISOString());
  assert.equal(verdict.metricRegistryVersion, 7);
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
  assert.equal(verdict.sourceHealth.nativeMemoryPressureCoverageHealthy, true);
  assert.equal(verdict.sourceHealth.collectorEventCoverageHealthy, true);
  assert.equal(verdict.sourceHealth.collectorEventCount, 2);
  assert.equal(verdict.sourceHealth.runtimeHealthDistinctSampleCount, 301);
  assert.equal(verdict.sourceHealth.runtimeHealthExpectedSampleCount, 300);
  assert.equal(
    verdict.evidenceFingerprint.coverage.runtimeHealthDistinctSampleCount,
    301,
  );
  assert.equal(verdict.evidenceFingerprint.collectorMetrics.recordCount, 301);
  assert.equal(verdict.evidenceFingerprint.schemaVersion, 2);
  assert.equal(verdict.evidenceFingerprint.collectorEvents.recordCount, 2);
  assert.equal(
    verdict.evidenceFingerprint.runtimeHealth.recordCount,
    verdict.healthLineCount,
  );
  const byId = Object.fromEntries(
    verdict.assertions.map((item) => [item.id, item.status]),
  );
  assert.equal(byId.main_footprint_slope, "pass");
  assert.equal(byId.startup_repair_upload_budget, "pass");
  assert.equal(byId.social_outbox_retry_budget, "pass");
  assert.equal(
    verdict.eventSummaries.requestSurface.rssPullAttempts.total,
    0,
  );
  assert.equal(byId.renderer_recoveries, "pass");
  assert.equal(byId.stale_heartbeats, "pass");
  assert.equal(byId.worker_init_rate, "pass");
  assert.equal(byId.worker_idle_termination_contract, "pass");
  assert.equal(byId.uploads_unchanged_heads, "pass");
  assert.equal(verdict.measurements["worker-init-rate"].value, 0);
  assert.equal(verdict.measurements["app-memory-pressure-p95"].value, 718 * MB);
});

test("buildVerdict does not treat legacy or missing collector-event evidence as a healthy empty stream", () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "freed-soak-capability-"));
  const { healthPath, metricsText } = healthySoakEvidence(dir);
  const build = (
    soakInfo,
    collectorEventsEvidencePresent,
    collectorEventsText = "",
  ) =>
    buildVerdict({
      soakDir: dir,
      metricsText,
      metricsPath: path.join(dir, "metrics.tsv"),
      healthLines: readHealthLines(healthPath),
      healthPath,
      collectorEventsText,
      collectorEventsEvidencePresent,
      soakInfo,
    });

  const legacy = build(
    { schemaVersion: 2, collectorSessionId: "legacy", intervalSeconds: 60 },
    false,
  );
  assert.equal(legacy.sourceHealth.healthy, false);
  assert.equal(legacy.sourceHealth.collectorEventEvidenceCapable, false);
  assert.match(legacy.sourceHealth.reason, /did not declare/);
  assert.equal(legacy.status, "inconclusive");

  const missing = build(
    collectorCapableSoakInfo({
      collectorSessionId: "missing-file",
      intervalSeconds: 60,
    }),
    false,
  );
  assert.equal(missing.sourceHealth.healthy, false);
  assert.equal(missing.sourceHealth.collectorEventEvidenceCapable, true);
  assert.equal(missing.sourceHealth.collectorEventEvidencePresent, false);
  assert.match(missing.sourceHealth.reason, /missing its current/);
  assert.equal(missing.status, "inconclusive");

  const empty = build(
    collectorCapableSoakInfo({
      collectorSessionId: "empty-events",
      intervalSeconds: 60,
    }),
    true,
  );
  assert.equal(empty.sourceHealth.healthy, false);
  assert.match(empty.sourceHealth.reason, /no durably closed/);

  const startMs = 1_700_000_000_000;
  const openSession = build(
    collectorCapableSoakInfo({
      collectorSessionId: "open-session",
      intervalSeconds: 60,
    }),
    true,
    `${JSON.stringify({
      schemaVersion: COLLECTOR_EVENTS_SCHEMA_VERSION,
      event: "collector_session_started",
      tsMs: startMs,
      collectorRunId: "collector-run-open",
    })}\n`,
  );
  assert.equal(openSession.sourceHealth.healthy, false);
  assert.equal(openSession.sourceHealth.collectorOutageOpen, true);
  assert.match(openSession.sourceHealth.reason, /still open/);
});

test("buildVerdict makes an unrecovered collector outage inconclusive and fingerprints its recovery", () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "freed-soak-outage-"));
  const { healthEntries, healthPath, metricsText } = healthySoakEvidence(dir);
  const failureStartedAtMs = healthEntries[0].tsMs + 60_000;
  const sessionStartedAtMs = failureStartedAtMs - 60_000;
  const collectorRunId = "collector-run-outage";
  const sessionStart = {
    schemaVersion: COLLECTOR_EVENTS_SCHEMA_VERSION,
    event: "collector_session_started",
    tsMs: sessionStartedAtMs,
    collectorRunId,
  };
  const failure = {
    schemaVersion: COLLECTOR_EVENTS_SCHEMA_VERSION,
    event: "collector_sample_failed",
    tsMs: failureStartedAtMs,
    failedSamples: 1,
    sampleMayBePartial: true,
    errorMessage: "metrics volume unavailable",
  };
  const build = (collectorEventsText) =>
    buildVerdict({
      soakDir: dir,
      metricsText,
      metricsPath: path.join(dir, "metrics.tsv"),
      healthLines: readHealthLines(healthPath),
      healthPath,
      collectorEventsText,
      collectorEventsEvidencePresent: true,
      soakInfo: collectorCapableSoakInfo({
        collectorSessionId: "collector-session-1",
        intervalSeconds: 60,
      }),
    });

  const open = build(
    `${JSON.stringify(sessionStart)}\n${JSON.stringify(failure)}\n`,
  );
  assert.equal(open.sourceHealth.healthy, false);
  assert.equal(open.sourceHealth.collectorOutageOpen, true);
  assert.equal(open.sourceHealth.collectorEventCoverageHealthy, false);
  assert.match(open.sourceHealth.reason, /unrecovered outage/);
  assert.equal(open.status, "inconclusive");
  assert.equal(open.evidenceFingerprint.collectorEvents.recordCount, 2);
  assert.equal(open.evidenceFingerprint.coverage.collectorOutageOpen, true);

  const recovery = {
    schemaVersion: COLLECTOR_EVENTS_SCHEMA_VERSION,
    event: "collector_sample_recovered",
    tsMs: failureStartedAtMs + 60_000,
    failedSamples: 1,
    failureStartedAtMs,
    failureLastObservedAtMs: failureStartedAtMs,
    outageMs: 60_000,
  };
  const sessionStop = {
    schemaVersion: COLLECTOR_EVENTS_SCHEMA_VERSION,
    event: "collector_session_stopped",
    tsMs: recovery.tsMs + 1,
    collectorRunId,
    sessionStartedAtMs,
    reason: "duration_reached",
  };
  const recovered = build(
    `${JSON.stringify(sessionStart)}\n${JSON.stringify(failure)}\n${JSON.stringify(recovery)}\n${JSON.stringify(sessionStop)}\n`,
  );
  assert.equal(recovered.sourceHealth.healthy, true);
  assert.equal(recovered.sourceHealth.collectorOutageOpen, false);
  assert.equal(recovered.sourceHealth.collectorEventCoverageHealthy, true);
  assert.equal(recovered.status, "pass");
  assert.equal(recovered.evidenceFingerprint.collectorEvents.recordCount, 4);
  assert.notEqual(
    recovered.evidenceFingerprint.digest,
    open.evidenceFingerprint.digest,
  );
});

test("buildVerdict keeps zero and rate assertions inconclusive for a thin runtime stream", () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "freed-soak-thin-runtime-"));
  const { healthPath, metricsText } = healthySoakEvidence(dir);
  const completeLines = readHealthLines(healthPath);
  const heartbeatLines = completeLines.filter(
    ({ entry }) => entry.event === "renderer_heartbeat",
  );
  const thinLines = completeLines.filter(
    ({ entry }) =>
      entry.event !== "renderer_heartbeat" &&
      entry.event !== "native_runtime_memory_sample",
  );
  thinLines.push(heartbeatLines[0], heartbeatLines.at(-1));
  const verdict = buildVerdict({
    soakDir: dir,
    metricsText,
    metricsPath: path.join(dir, "metrics.tsv"),
    healthLines: thinLines,
    healthPath,
    collectorEventsText: closedCollectorSessionEventsText(),
    collectorEventsEvidencePresent: true,
    soakInfo: collectorCapableSoakInfo({
      collectorSessionId: "collector-session-1",
      intervalSeconds: 60,
    }),
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
  assert.equal(byId.worker_init_rate, "inconclusive");
  assert.equal(byId.worker_idle_termination_contract, "inconclusive");
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
    collectorEventsText: closedCollectorSessionEventsText(),
    collectorEventsEvidencePresent: true,
    soakInfo: collectorCapableSoakInfo({
      collectorSessionId: "collector-session-1",
      intervalSeconds: 60,
    }),
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
    collectorEventsText: closedCollectorSessionEventsText(),
    collectorEventsEvidencePresent: true,
    soakInfo: collectorCapableSoakInfo({
      collectorSessionId: "collector-session-1",
      intervalSeconds: 60,
    }),
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
    collectorEventsText: closedCollectorSessionEventsText(),
    collectorEventsEvidencePresent: true,
    soakInfo: collectorCapableSoakInfo({
      collectorSessionId: "collector-session-1",
      intervalSeconds: 60,
    }),
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
