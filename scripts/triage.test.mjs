import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  aggregateAlarms,
  BUCKETS,
  buildCandidates,
  emitCandidates,
  readHealthEntries,
  readLatestCanary,
  readLatestCanaries,
  readLatestVerdict,
  renderTaskFile,
} from "./triage.mjs";
import { buildCompositeEvidenceFingerprint } from "./soak-assert.mjs";
import {
  buildCandidates as buildNightlyCandidates,
  loadTriageCandidates,
} from "./nightly-self-improve.mjs";
import { COLLECTOR_EVENTS_SCHEMA_VERSION } from "./soak-collect.mjs";
import { writeCanaryEvidenceCohort } from "./test-helpers/canary-evidence.mjs";
import { writeStoredSoakEvidence } from "./test-helpers/outcome-evidence.mjs";

const NOW = Date.parse("2026-07-09T08:00:00Z");
const BUILD_IDENTITY = {
  appVersion: "26.7.900-dev",
  buildCommitSha: "a".repeat(40),
  channel: "dev",
  appSessionId: "session-1",
};

function attributableAlarm(count, lastTsMs, evidence = []) {
  return {
    count,
    lastTsMs,
    evidence,
    sourceHealth: "healthy",
    buildIdentity: BUILD_IDENTITY,
    evidenceFingerprint: {
      algorithm: "sha256",
      digest: "e".repeat(64),
      recordCount: count,
    },
  };
}

function validVerdict(assertions, windowEnd = NOW) {
  return {
    schemaVersion: 1,
    metricRegistryVersion: 3,
    sourceHealth: { healthy: true },
    runtimeIdentity: {
      attributable: true,
      evidenceStatus: "attributable",
      ...BUILD_IDENTITY,
    },
    evidenceFingerprint: {
      algorithm: "sha256",
      digest: "f".repeat(64),
      recordCount: 10,
    },
    windowEnd: new Date(windowEnd).toISOString(),
    assertions,
  };
}

function validCanaryRecord({
  version = "26.7.900",
  windowEnd = NOW,
  comparisonStatus = "pass",
  providerCohort = "social",
  regressions = [],
  session = "session-current",
} = {}) {
  const windowStart = windowEnd - 3_600_000;
  const buildIdentity = { version, commitSha: "a".repeat(40), channel: "dev" };
  const runtimeIdentity = {
    collectorSessionId: `collector-${session}`,
    appPid: 123,
    appSessionId: session,
  };
  const sourceHealth = {
    status: "healthy",
    appAliveHours: 1,
    appAliveRatio: 1,
    collectorSampleCount: 61,
    collectorDistinctSampleCount: 61,
    expectedSampleCount: 61,
    sampleDensity: 1,
    collectorSpanHours: 1,
    expectedIntervalMs: 60_000,
    maxCreditedGapMs: 150_000,
    largestObservedGapMs: 60_000,
    creditedIntervalCount: 60,
    collectorHeaderHealthy: true,
    collectorMalformedRowCount: 0,
    collectorEventCount: 2,
    collectorEventFailureCount: 0,
    collectorEventRecoveryCount: 0,
    collectorEventMalformedLineCount: 0,
    collectorEventProtocolErrorCount: 0,
    collectorOutageOpen: false,
    collectorOpenOutageStartedAtMs: null,
    collectorEventCoverageHealthy: true,
    collectorEventEvidenceCapable: true,
    collectorEventEvidencePresent: true,
    collectorEventEvidenceSchemaVersion: COLLECTOR_EVENTS_SCHEMA_VERSION,
    runtimeHealthMalformedLineCount: 0,
    runtimeHealthSampleCount: 61,
    runtimeHealthDistinctSampleCount: 61,
    runtimeHealthExpectedSampleCount: 60,
    runtimeHealthSampleDensity: 1,
    runtimeHealthExpectedIntervalMs: 60_000,
    runtimeHealthMaxCreditedGapMs: 150_000,
    runtimeHealthLargestObservedGapMs: 60_000,
    runtimeHealthLastFreshnessMs: 0,
    runtimeHealthAppAliveSegmentCount: 1,
    runtimeHealthCoveredAppAliveSegmentCount: 1,
    runtimeHealthCoverageHealthy: true,
    cloudEligibleHours: null,
  };
  const attribution = {
    collectorSessionId: runtimeIdentity.collectorSessionId,
    appPid: runtimeIdentity.appPid,
    appVersion: buildIdentity.version,
    buildCommitSha: buildIdentity.commitSha,
    channel: buildIdentity.channel,
    appSessionId: runtimeIdentity.appSessionId,
  };
  const runtimeHealth = {
    algorithm: "sha256",
    digest: "d".repeat(64),
    recordCount: 61,
  };
  sourceHealth.evidenceFingerprint = buildCompositeEvidenceFingerprint({
    runtimeHealthFingerprint: runtimeHealth,
    collectorMetricsFingerprint: {
      algorithm: "sha256",
      digest: "c".repeat(64),
      recordCount: sourceHealth.collectorSampleCount,
      byteLength: 6_100,
    },
    collectorEventsFingerprint: {
      algorithm: "sha256",
      digest: "e".repeat(64),
      recordCount: 2,
      byteLength: 240,
    },
    sourceHealth,
    runtimeAttribution: attribution,
  });
  return {
    schemaVersion: 3,
    metricRegistryVersion: 3,
    version,
    buildIdentity,
    runtimeIdentity,
    sourceHealth,
    evidenceAttribution: {
      status: "matched",
      identity: {
        appVersion: buildIdentity.version,
        buildCommitSha: buildIdentity.commitSha,
        channel: buildIdentity.channel,
        appSessionId: runtimeIdentity.appSessionId,
      },
      evidenceFingerprint: structuredClone(sourceHealth.evidenceFingerprint),
      observedRuntimeHealthFingerprint: runtimeHealth,
    },
    comparisonContext: {
      platform: "darwin",
      architecture: "arm64",
      memoryTierGiB: 64,
      channel: "dev",
      scenario: "idle",
      providerCohort,
      documentSizeBucket: "medium",
    },
    comparison: { status: comparisonStatus },
    observationId: `${version}:${session}:${windowStart}:${windowEnd}`,
    windowStart: new Date(windowStart).toISOString(),
    windowEnd: new Date(windowEnd).toISOString(),
    healthLineCount: runtimeHealth.recordCount,
    regressions,
  };
}

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
        {
          event: "invariant_alarm",
          name: "cloud_loop",
          detail: `burst ${i}`,
          tsMs: NOW - i * 1000,
        },
        i + 1,
      ),
    );
  }
  entries.push(
    healthEntry(
      {
        event: "invariant_alarm",
        name: "preflight_kill",
        detail: "held",
        tsMs: NOW,
      },
      99,
    ),
  );
  entries.push(healthEntry({ event: "renderer_heartbeat", tsMs: NOW }, 100));

  const alarms = aggregateAlarms(entries);
  assert.equal(alarms.cloud_loop.count, 8);
  assert.equal(
    alarms.cloud_loop.evidence.length,
    5,
    "evidence pointers are capped",
  );
  assert.equal(alarms.preflight_kill.count, 1);
  assert.equal(alarms.preflight_kill.evidence[0].line, 99);
});

test("alarm aggregation rejects legacy kill and scrape shortcuts that cannot prove the metric", () => {
  const entries = [
    healthEntry({
      event: "invariant_alarm",
      name: "preflight_kill",
      detail: "window_destroyed reason=job_complete scraperSessionHeld=true",
      tsMs: NOW,
    }),
    healthEntry({
      event: "invariant_alarm",
      name: "scrape_zero_persist",
      detail: "x scrape extracted 76 items but persisted 0",
      tsMs: NOW,
    }),
    healthEntry(
      {
        event: "invariant_alarm",
        name: "scrape_zero_persist",
        detail: "x scrape had novel loss",
        itemsNovel: 5,
        itemsPersisted: 0,
        tsMs: NOW,
      },
      3,
    ),
  ];

  const alarms = aggregateAlarms(entries);
  assert.equal(alarms.preflight_kill, undefined);
  assert.equal(alarms.scrape_zero_persist.count, 1);
  assert.equal(alarms.scrape_zero_persist.evidence[0].line, 3);
});

test("alarm aggregation keeps normal app-session turnover attributable", () => {
  const alarms = aggregateAlarms([
    healthEntry({
      event: "invariant_alarm",
      name: "cloud_loop",
      detail: "first session",
      tsMs: NOW - 1_000,
      ...BUILD_IDENTITY,
    }),
    healthEntry(
      {
        event: "invariant_alarm",
        name: "cloud_loop",
        detail: "second session",
        tsMs: NOW,
        ...BUILD_IDENTITY,
        appSessionId: "session-2",
      },
      2,
    ),
  ]);

  assert.ok(Array.isArray(alarms.cloud_loop));
  assert.equal(alarms.cloud_loop.length, 2);
  const ranked = buildCandidates({
    alarms,
    verdictInfo: null,
    canaryInfo: null,
    ciIssues: [],
    nowMs: NOW,
  });
  assert.equal(ranked[0].hits, 2);
  assert.equal(ranked[0].buildIdentities.length, 2);
});

test("a synthetic alarm aggregate + failed verdict produce ranked task files with evidence pointers", () => {
  const alarms = {
    cloud_loop: attributableAlarm(7, NOW - 3_600_000, [
      {
        file: "runtime-health-20260709.jsonl",
        line: 42,
        detail: "5 uploads unchanged heads",
      },
    ]),
    auth_zombie: attributableAlarm(1, NOW - 3_600_000, [
      {
        file: "runtime-health-20260709.jsonl",
        line: 50,
        detail: "linkedin ok-empty x3",
      },
    ]),
  };
  const verdictInfo = {
    verdictPath: "/soak/soak-verdict.json",
    provenanceVerified: true,
    verdict: validVerdict(
      [
        {
          id: "uploads_unchanged_heads",
          status: "fail",
          detail: "98 of 102 uploads had unchanged heads",
        },
        { id: "renderer_recoveries", status: "pass", detail: "0 events" },
      ],
      NOW - 3_600_000,
    ),
  };
  const canaryInfo = {
    file: "/repo/canary-ledger/canary-26.7.800.json",
    record: validCanaryRecord({
      version: "26.7.800",
      session: "session-1",
      windowEnd: NOW - 3_600_000,
      comparisonStatus: "regression",
      regressions: [
        {
          metric: "workerInitsPerHour",
          current: 40,
          trailingMedian: 10,
          limit: 15,
        },
      ],
    }),
  };

  const ranked = buildCandidates({
    alarms,
    verdictInfo,
    canaryInfo,
    ciIssues: [],
    nowMs: NOW,
  });
  assert.equal(
    ranked[0].bucket.id,
    "cloud-loop",
    "alarm x7 + verdict fail must rank first",
  );
  const ids = ranked.map((c) => c.bucket.id);
  assert.ok(
    ids.includes("worker-churn"),
    "canary regression maps to its bucket",
  );
  assert.ok(ids.includes("auth-zombie"));
  assert.ok(
    ranked[0].evidence.some((line) =>
      line.includes("runtime-health-20260709.jsonl:42"),
    ),
    "ledger line pointer survives into the candidate",
  );
  assert.ok(
    ranked[0].evidence.some(
      (line) => line.includes("soak-verdict") && line.includes("98 of 102"),
    ),
    "verdict entry pointer survives",
  );

  const dir = mkdtempSync(path.join(os.tmpdir(), "freed-triage-"));
  const written = emitCandidates(ranked, dir, {
    nowIso: new Date(NOW).toISOString(),
  });
  assert.equal(path.basename(written[0]), "T-01-cloud-loop.md");
  const rendered = readFileSync(written[0], "utf8");
  assert.match(rendered, /^# T-1: /m);
  assert.match(rendered, /runner-safe: false/);
  assert.match(rendered, /P1-01-cloud-loop-damper-desktop\.md/);
  assert.match(rendered, /## Evidence/);
  assert.match(rendered, /runtime-health-20260709\.jsonl:42/);
  assert.match(rendered, /^Generated at: 2026-07-09T08:00:00\.000Z$/m);
  assert.match(rendered, /^Evidence window end: 2026-07-09T07:00:00\.000Z$/m);
});

test("passed soak assertions suppress stale raw alarms for the same bucket", () => {
  const alarms = {
    preflight_kill: attributableAlarm(13, NOW - 1_000, [
      {
        file: "runtime-health-20260709.jsonl",
        line: 1639,
        detail: "window destroyed during held session",
      },
    ]),
    scrape_zero_persist: attributableAlarm(1, NOW - 1_000, [
      {
        file: "runtime-health-20260709.jsonl",
        line: 2077,
        detail: "x scrape extracted 76 items but persisted 0",
      },
    ]),
    cloud_loop: attributableAlarm(2, NOW - 1_000, [
      {
        file: "runtime-health-20260709.jsonl",
        line: 1532,
        detail: "2 uploads unchanged heads",
      },
    ]),
  };
  const verdictInfo = {
    verdictPath: "/soak/soak-verdict.json",
    provenanceVerified: true,
    verdict: validVerdict([
      {
        id: "preflight_kills",
        status: "pass",
        detail: "0 of 10 window_destroyed records killed an active session",
      },
      {
        id: "scrape_zero_persist",
        status: "fail",
        detail: "1 scrape extracted >= 5 items and persisted 0",
      },
      {
        id: "uploads_unchanged_heads",
        status: "fail",
        detail: "2 of 8 uploads had unchanged heads",
      },
    ]),
  };

  const ranked = buildCandidates({
    alarms,
    verdictInfo,
    canaryInfo: null,
    ciIssues: [],
    nowMs: NOW,
  });
  const ids = ranked.map((candidate) => candidate.bucket.id);
  assert.ok(
    !ids.includes("preflight-kill"),
    "resolved preflight assertions should clear raw positive-control alarms",
  );
  assert.ok(
    ids.includes("scrape-zero-persist"),
    "failing assertions still produce candidates",
  );
  assert.ok(
    ids.includes("cloud-loop"),
    "failing cloud-loop assertions still produce candidates",
  );
});

test("a passing verdict never suppresses alarm evidence newer than its window", () => {
  const alarms = {
    preflight_kill: attributableAlarm(1, NOW, [
      {
        file: "runtime-health-20260709.jsonl",
        line: 1700,
        detail: "new destruction",
      },
    ]),
  };
  const verdictInfo = {
    verdictPath: "/soak/soak-verdict.json",
    provenanceVerified: true,
    verdict: validVerdict(
      [
        {
          id: "preflight_kills",
          status: "pass",
          detail: "0 destructive records",
        },
      ],
      NOW - 1,
    ),
  };

  const ranked = buildCandidates({
    alarms,
    verdictInfo,
    canaryInfo: null,
    ciIssues: [],
    nowMs: NOW,
  });
  assert.ok(
    ranked.some((candidate) => candidate.bucket.id === "preflight-kill"),
    "post-verdict evidence remains actionable",
  );
});

test("stale or unattributed soak failures cannot become work", () => {
  const stale = validVerdict(
    [
      {
        id: "preflight_kills",
        status: "fail",
        detail: "one destructive record",
      },
    ],
    NOW - 8 * 24 * 60 * 60_000,
  );
  const unattributed = {
    ...validVerdict([
      {
        id: "preflight_kills",
        status: "fail",
        detail: "one destructive record",
      },
    ]),
    runtimeIdentity: { attributable: false, evidenceStatus: "missing" },
  };
  for (const verdict of [stale, unattributed]) {
    const ranked = buildCandidates({
      alarms: {},
      verdictInfo: {
        verdict,
        verdictPath: "/tmp/soak-verdict.json",
        provenanceVerified: true,
      },
      canaryInfo: null,
      ciIssues: [],
      nowMs: NOW,
    });
    assert.equal(ranked.length, 0);
  }
});

test("latest soak verdict is rejected when it no longer matches raw evidence", () => {
  const root = mkdtempSync(
    path.join(os.tmpdir(), "freed-triage-soak-provenance-"),
  );
  const stored = writeStoredSoakEvidence(root, {
    name: "triage-provenance",
    startMs: NOW - 5 * 60 * 60_000,
    version: BUILD_IDENTITY.appVersion,
    commitSha: BUILD_IDENTITY.buildCommitSha,
    slopeMbPerHour: 1,
  });
  const pointer = path.join(root, "current-soak-dir");
  writeFileSync(pointer, `${stored.soakDir}\n`);

  const verified = readLatestVerdict(pointer);
  assert.equal(verified?.provenanceVerified, true);
  assert.equal(verified?.verdict.soakDir, realpathSync(stored.soakDir));

  const tampered = JSON.parse(readFileSync(stored.verdictPath, "utf8"));
  tampered.assertions[0].detail = "hand-edited source claim";
  writeFileSync(stored.verdictPath, `${JSON.stringify(tampered, null, 2)}\n`);
  assert.equal(readLatestVerdict(pointer), null);
});

test("health ingestion preserves same-source multiplicity and reports malformed lines", () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "freed-triage-health-"));
  const duplicate = JSON.stringify({
    ...BUILD_IDENTITY,
    event: "invariant_alarm",
    name: "cloud_loop",
    tsMs: NOW,
  });
  writeFileSync(
    path.join(dir, "runtime-health-20260709.jsonl"),
    `${duplicate}\n${duplicate}\n`,
  );
  writeFileSync(
    path.join(dir, "runtime-health.jsonl"),
    `${duplicate}\n${duplicate}\n${JSON.stringify({
      ...BUILD_IDENTITY,
      event: "invariant_alarm",
      name: "worker_churn",
      tsMs: NOW + 1,
    })}\nnot-json\n`,
  );

  const entries = readHealthEntries(dir, { sinceMs: NOW - 1 });
  assert.equal(entries.length, 3);
  assert.equal(
    entries.filter(({ entry }) => entry.name === "cloud_loop").length,
    2,
  );
  assert.ok(entries.some(({ file }) => file.endsWith("runtime-health.jsonl")));
  assert.equal(entries.sourceDiagnostics.malformedLines.length, 1);
  const alarms = aggregateAlarms(entries);
  assert.equal(alarms.cloud_loop.sourceHealth, "malformed");
});

test("health ingestion ignores malformed dated files wholly before the evidence window", () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "freed-triage-old-health-"));
  writeFileSync(
    path.join(dir, "runtime-health-20260707.jsonl"),
    "historical-truncated-json\n",
  );
  writeFileSync(
    path.join(dir, "runtime-health.jsonl"),
    `${JSON.stringify({
      ...BUILD_IDENTITY,
      event: "invariant_alarm",
      name: "cloud_loop",
      tsMs: NOW,
    })}\n`,
  );

  const entries = readHealthEntries(dir, { sinceMs: NOW - 1 });
  assert.equal(entries.length, 1);
  assert.equal(entries.sourceDiagnostics.sourceLineCount, 1);
  assert.deepEqual(entries.sourceDiagnostics.malformedLines, []);
  const alarms = aggregateAlarms(entries);
  assert.equal(alarms.cloud_loop.sourceHealth, "healthy");
  const ranked = buildCandidates({
    alarms,
    verdictInfo: null,
    canaryInfo: null,
    ciIssues: [],
    nowMs: NOW,
  });
  assert.ok(ranked.some((candidate) => candidate.bucket.id === "cloud-loop"));
});

test("health ingestion keeps malformed cutoff-day files fail-closed", () => {
  const dir = mkdtempSync(
    path.join(os.tmpdir(), "freed-triage-cutoff-health-"),
  );
  writeFileSync(
    path.join(dir, "runtime-health-20260709.jsonl"),
    "current-window-truncated-json\n",
  );
  writeFileSync(
    path.join(dir, "runtime-health-20260000.jsonl"),
    "invalid-date-truncated-json\n",
  );
  writeFileSync(
    path.join(dir, "runtime-health.jsonl"),
    `${JSON.stringify({
      ...BUILD_IDENTITY,
      event: "invariant_alarm",
      name: "cloud_loop",
      tsMs: NOW,
    })}\n`,
  );

  const entries = readHealthEntries(dir, { sinceMs: NOW - 1 });
  assert.deepEqual(
    entries.sourceDiagnostics.malformedLines
      .map(({ file }) => path.basename(file))
      .sort(),
    ["runtime-health-20260000.jsonl", "runtime-health-20260709.jsonl"],
  );
  const alarms = aggregateAlarms(entries);
  assert.equal(alarms.cloud_loop.sourceHealth, "malformed");
  assert.equal(
    buildCandidates({
      alarms,
      verdictInfo: null,
      canaryInfo: null,
      ciIssues: [],
      nowMs: NOW,
    }).length,
    0,
  );
});

test("health ingestion uses the local rotation date across a UTC boundary", () => {
  const dir = mkdtempSync(
    path.join(os.tmpdir(), "freed-triage-local-date-health-"),
  );
  writeFileSync(
    path.join(dir, "runtime-health-20260707.jsonl"),
    "expired-local-day-truncated-json\n",
  );
  writeFileSync(
    path.join(dir, "runtime-health-20260708.jsonl"),
    "cutoff-local-day-truncated-json\n",
  );
  const triageUrl = new URL("./triage.mjs", import.meta.url).href;
  const diagnostics = JSON.parse(
    execFileSync(
      process.execPath,
      [
        "--input-type=module",
        "-e",
        `import { readHealthEntries } from ${JSON.stringify(triageUrl)};
const entries = readHealthEntries(process.env.TRIAGE_FIXTURE_DIR, {
  sinceMs: Date.parse("2026-07-09T06:30:00Z"),
});
process.stdout.write(JSON.stringify(entries.sourceDiagnostics.malformedLines));`,
      ],
      {
        encoding: "utf8",
        env: {
          ...process.env,
          TZ: "America/Los_Angeles",
          TRIAGE_FIXTURE_DIR: dir,
        },
      },
    ),
  );
  assert.deepEqual(
    diagnostics.map(({ file }) => path.basename(file)),
    ["runtime-health-20260708.jsonl"],
  );
});

test("latest canary ignores legacy records and preserves a newer inconclusive verdict", () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "freed-triage-canary-"));
  writeFileSync(
    path.join(dir, "canary-legacy.json"),
    JSON.stringify({
      schemaVersion: 1,
      version: "legacy",
      windowEnd: "2026-07-09T07:00:00Z",
      regressions: [{ metric: "workerInitsPerHour", current: 99 }],
    }),
  );
  writeCanaryEvidenceCohort(dir, {
    startMs: NOW - 24 * 60 * 60_000,
    version: "26.7.900",
    commitSha: "9".repeat(40),
    baselineCount: 0,
  });
  const latest = readLatestCanary(dir);
  assert.equal(latest.record.version, "26.7.900");
  const ranked = buildCandidates({
    alarms: {},
    verdictInfo: null,
    canaryInfo: latest,
    ciIssues: [],
    nowMs: NOW,
  });
  assert.equal(ranked.length, 0);
});

test("latest canaries preserve a regression from each comparison cohort", () => {
  const dir = mkdtempSync(
    path.join(os.tmpdir(), "freed-triage-canary-cohorts-"),
  );
  writeCanaryEvidenceCohort(dir, {
    startMs: NOW - 24 * 60 * 60_000,
    version: "26.7.899",
    commitSha: "8".repeat(40),
    providerCohort: "social",
    workerInits: 40,
  });
  writeCanaryEvidenceCohort(dir, {
    startMs: NOW - 24 * 60 * 60_000,
    version: "26.7.900",
    commitSha: "9".repeat(40),
    providerCohort: "empty",
  });

  const latest = readLatestCanaries(dir);
  assert.equal(latest.length, 2);
  const ranked = buildCandidates({
    alarms: {},
    verdictInfo: null,
    canaryInfo: latest,
    ciIssues: [],
    nowMs: NOW,
  });
  assert.ok(ranked.some((candidate) => candidate.bucket.id === "worker-churn"));
});

test("candidate fingerprints bind the underlying source evidence digest", () => {
  const first = buildCandidates({
    alarms: { cloud_loop: attributableAlarm(1, NOW) },
    verdictInfo: null,
    canaryInfo: null,
    ciIssues: [],
    nowMs: NOW,
  })[0];
  const changed = attributableAlarm(1, NOW);
  changed.evidenceFingerprint = {
    ...changed.evidenceFingerprint,
    digest: "f".repeat(64),
  };
  const second = buildCandidates({
    alarms: { cloud_loop: changed },
    verdictInfo: null,
    canaryInfo: null,
    ciIssues: [],
    nowMs: NOW,
  })[0];

  assert.notEqual(first.evidenceFingerprint, second.evidenceFingerprint);
});

test("CI issues rank at the top when fresh", () => {
  const ranked = buildCandidates({
    alarms: { cloud_loop: attributableAlarm(2, NOW - 6 * 86_400_000) },
    verdictInfo: null,
    canaryInfo: null,
    ciIssues: [
      {
        number: 940,
        title: "CI failure: dev validation on dev",
        body: `Commit ${"b".repeat(40)}`,
        updatedAt: new Date(NOW).toISOString(),
        url: "https://x",
      },
    ],
    nowMs: NOW,
  });
  assert.equal(ranked[0].bucket.id, "ci-red");
  assert.ok(
    ranked[0].score > ranked[1].score,
    "fresh CI outranks week-old alarms",
  );
});

test("renderTaskFile follows the stability-tasks header format", () => {
  const candidate = {
    bucket: BUCKETS.find((bucket) => bucket.id === "preflight-kill"),
    hits: 1,
    score: 3.47,
    evidence: ["alarm preflight_kill x1: file:1 detail"],
    evidenceWindowEnd: new Date(NOW).toISOString(),
    evidenceFingerprint: "f".repeat(64),
    sourceHealth: "healthy",
  };
  const text = renderTaskFile(candidate, 2, "2026-07-09T08:00:00.000Z");
  const lines = text.split("\n");
  assert.match(lines[0], /^# T-2: Window recycles/);
  assert.match(
    lines[2],
    /^runner-safe: .+ \| provider-visible: .+ \| soak-gated: /,
  );
  assert.match(lines[2], /provider-visible: true/);
  assert.ok(
    text.includes("## Context") &&
      text.includes("## Evidence") &&
      text.includes("## Verify"),
  );
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
  writeFileSync(
    path.join(dir, "T-02-auth-zombie.md"),
    "# stale: superseded by a newer triage run\n",
  );

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
  assert.ok(
    staleTriage.score < roadmap.score,
    "stale triage sinks below roadmap",
  );
});

test("emitCandidates atomically publishes one current immutable generation", () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "freed-triage-generation-"));
  writeFileSync(
    path.join(dir, "T-03-memory-growth.md"),
    "# T-3: old leftover\n",
  );
  const firstRanked = buildCandidates({
    alarms: { cloud_loop: attributableAlarm(5, NOW) },
    verdictInfo: null,
    canaryInfo: null,
    ciIssues: [],
    nowMs: NOW,
  });
  emitCandidates(firstRanked, dir, { nowIso: new Date(NOW).toISOString() });
  const firstCurrent = JSON.parse(
    readFileSync(path.join(dir, "current.json"), "utf8"),
  );
  assert.equal(firstCurrent.candidateCount, 1);
  assert.equal(firstCurrent.candidates[0].id, "cloud-loop");
  assert.equal(firstCurrent.candidates[0].taskId, "P1-01");
  assert.equal(firstCurrent.candidates[0].behavioral, true);
  assert.equal(
    firstCurrent.candidates[0].soakExclusivityKey,
    "cloud-sync-behavior",
  );
  assert.match(
    firstCurrent.candidates[0].evidenceFingerprint,
    /^[0-9a-f]{64}$/,
  );
  assert.deepEqual(
    readdirSync(dir).sort(),
    ["current.json", "generations"],
    "legacy top-level task files are removed after publication",
  );
  assert.deepEqual(
    readdirSync(path.join(dir, firstCurrent.generationDir)).sort(),
    ["T-01-cloud-loop.md", "manifest.json"],
  );

  const secondRanked = buildCandidates({
    alarms: { auth_zombie: attributableAlarm(1, NOW + 1_000) },
    verdictInfo: null,
    canaryInfo: null,
    ciIssues: [],
    nowMs: NOW + 1_000,
  });
  emitCandidates(secondRanked, dir, {
    nowIso: new Date(NOW + 1_000).toISOString(),
  });
  const secondCurrent = JSON.parse(
    readFileSync(path.join(dir, "current.json"), "utf8"),
  );
  assert.notEqual(secondCurrent.generation, firstCurrent.generation);
  assert.equal(secondCurrent.candidates[0].id, "auth-zombie");
  assert.equal(
    readdirSync(path.join(dir, "generations")).length,
    2,
    "past generations remain auditable",
  );

  const loaded = loadTriageCandidates(dir, NOW + 1_000);
  assert.equal(loaded.length, 1, "nightly sees only the current generation");
  assert.equal(loaded[0].bucketId, "auth-zombie");
  assert.equal(loaded[0].generation, secondCurrent.generation);
  assert.equal(
    loaded[0].evidenceWindowEnd,
    new Date(NOW + 1_000).toISOString(),
  );
});
