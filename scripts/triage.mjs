#!/usr/bin/env node
/**
 * triage.mjs (stability W2-02)
 *
 * Evidence in, ranked tasks out. Reads four evidence streams —
 * invariant-alarm aggregates from rotated runtime-health, the latest
 * soak-verdict.json failures, canary-ledger regression entries (W2-03), and
 * open `automation-triage` CI-failure issues — dedupes them into root-cause
 * buckets, ranks by severity x frequency x freshness, and emits one task
 * file per bucket (docs/stability-tasks format, evidence pointers included)
 * into an immutable generation, then atomically moves the current manifest.
 *
 * Buckets deliberately map to EXISTING program tasks where one exists: the
 * emitted candidate says "execute P1-04, here is tonight's evidence", so the
 * queue converges on the program instead of forking it.
 */

import { createHash, randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  invariantAlarmMeetsMetricContract,
  metricSignalsForBucket,
  STABILITY_METRIC_REGISTRY_VERSION,
  STABILITY_METRICS,
} from "./lib/stability-metrics.mjs";
import {
  runtimeHealthEvidenceFingerprint,
  runtimeIdentityFromHealthLines,
} from "./soak-assert.mjs";
import {
  hasMatchedEvidenceAttribution,
  validateStoredCanaryRecordProvenance,
} from "./canary-summarize.mjs";
import { validateStoredSoakVerdictProvenance } from "./canary-context.mjs";

const __filename = fileURLToPath(import.meta.url);
const REPO_ROOT = path.resolve(path.dirname(__filename), "..");
const AUTOMATION_DIR = path.join(os.homedir(), ".freed/automation");
const DEFAULT_APP_DATA = path.join(
  os.homedir(),
  "Library/Application Support/wtf.freed.desktop",
);
const DEFAULT_CANDIDATE_DIR = path.join(AUTOMATION_DIR, "triage/candidates");
const DEFAULT_POINTER = path.join(AUTOMATION_DIR, "current-soak-dir");
const DEFAULT_LEDGER_DIR = path.join(REPO_ROOT, "canary-ledger");
const MAX_ACTIONABLE_EVIDENCE_AGE_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Root-cause buckets. Each maps the signals that indict it (alarm names,
 * soak-verdict assertion ids, canary metrics) to the program task that fixes
 * it. severity 1-5 follows stability-findings.json.
 */
const BUCKET_DEFINITIONS = [
  {
    id: "cloud-loop",
    taskId: "P1-01",
    title: "Idle cloud upload loop is live",
    severity: 5,
    programTask: "P1-01-cloud-loop-damper-desktop.md (then P1-02/P1-03)",
    findings: "F01/F06",
    providerVisible: true,
    behavioral: true,
    soakExclusivityKey: "cloud-sync-behavior",
    observerAuthority: "pr-only",
    ownerReviewRequired: true,
  },
  {
    id: "preflight-kill",
    taskId: "P1-04",
    title: "Window recycles are killing held scraper/login sessions",
    severity: 5,
    programTask: "P1-04-preflight-recycle-guard.md",
    findings: "F04",
    providerVisible: true,
    behavioral: true,
    soakExclusivityKey: "provider-window-lifecycle",
    observerAuthority: "pr-only",
    ownerReviewRequired: true,
  },
  {
    id: "scrape-zero-persist",
    taskId: "P1-05",
    title: "Novel scrape items are not persisted",
    severity: 5,
    programTask: "P1-05-recovery-invoke-latch.md",
    findings: "F03",
    providerVisible: true,
    behavioral: true,
    soakExclusivityKey: "provider-window-lifecycle",
    observerAuthority: "pr-only",
    ownerReviewRequired: true,
  },
  {
    id: "renderer-churn",
    taskId: "wave1-renderer-churn",
    title: "Watchdog is thrashing the main renderer",
    severity: 4,
    programTask:
      "demand-side dampers first (P1-*); thresholds stay frozen per program rules",
    findings: "F16/F23",
    providerVisible: true,
    behavioral: true,
    soakExclusivityKey: "renderer-recovery-behavior",
    observerAuthority: "pr-only",
    ownerReviewRequired: true,
  },
  {
    id: "auth-zombie",
    taskId: "wave4-auth-truth",
    title: "A provider is scraping empty while believed authenticated",
    severity: 3,
    programTask: "Wave 4 auth-truth tasks (see docs/STABILITY-PROGRAM.md)",
    findings: "auth misclassification theme",
    providerVisible: true,
    behavioral: true,
    soakExclusivityKey: "provider-auth-behavior",
    observerAuthority: "pr-only",
    ownerReviewRequired: true,
  },
  {
    id: "memory-growth",
    taskId: "wave5-memory-demand",
    title: "Idle memory footprint is growing or peaking high",
    severity: 4,
    programTask: "Wave 5 demand-side tasks (see docs/STABILITY-PROGRAM.md)",
    findings: "F-memory themes",
    providerVisible: false,
    behavioral: true,
    soakExclusivityKey: "memory-demand-behavior",
    observerAuthority: "pr-only",
    ownerReviewRequired: true,
  },
  {
    id: "worker-churn",
    taskId: "wave5-worker-lifecycle",
    title: "Automerge worker INIT churn",
    severity: 3,
    programTask: "Wave 5 worker lifecycle task",
    findings: "F20",
    providerVisible: false,
    behavioral: true,
    soakExclusivityKey: "worker-lifecycle-behavior",
    observerAuthority: "pr-only",
    ownerReviewRequired: true,
  },
  {
    id: "ci-red",
    taskId: "ci-red",
    title: "CI is red",
    severity: 5,
    programTask: "fix the failing job first; nothing ships over red CI",
    findings: "ci",
    providerVisible: false,
    behavioral: false,
    soakExclusivityKey: null,
    observerAuthority: "merge-safe",
    ownerReviewRequired: false,
  },
];

export const BUCKETS = BUCKET_DEFINITIONS.map((bucket) => ({
  ...bucket,
  ...metricSignalsForBucket(bucket.id),
  metricRegistryIds: STABILITY_METRICS.filter(
    (metric) => metric.triageBucketId === bucket.id,
  ).map((metric) => metric.id),
}));

export function readHealthEntries(appDataDir, { sinceMs }) {
  const entries = [];
  const malformedLines = [];
  if (!existsSync(appDataDir)) {
    Object.defineProperty(entries, "sourceDiagnostics", {
      value: { malformedLines, sourceLineCount: 0 },
      enumerable: false,
    });
    return entries;
  }
  const files = readdirSync(appDataDir)
    .filter((name) => /^runtime-health-\d{8}\.jsonl$/.test(name))
    .sort()
    .map((name) => path.join(appDataDir, name));
  const livePath = path.join(appDataDir, "runtime-health.jsonl");
  if (existsSync(livePath)) files.push(livePath);
  const maximumOccurrences = new Map();
  let sourceLineCount = 0;
  for (const file of files) {
    const fileOccurrences = new Map();
    const lines = readFileSync(file, "utf8").split("\n");
    lines.forEach((raw, index) => {
      if (!raw.trim()) return;
      sourceLineCount += 1;
      try {
        const entry = JSON.parse(raw);
        if (Number(entry.tsMs ?? 0) >= sinceMs) {
          const fingerprint = `${Number(entry.tsMs ?? 0)}:${raw}`;
          const occurrence = (fileOccurrences.get(fingerprint) ?? 0) + 1;
          fileOccurrences.set(fingerprint, occurrence);
          if (occurrence <= (maximumOccurrences.get(fingerprint) ?? 0)) return;
          entries.push({ entry, file, line: index + 1 });
        }
      } catch {
        malformedLines.push({ file, line: index + 1 });
      }
    });
    for (const [fingerprint, count] of fileOccurrences) {
      maximumOccurrences.set(
        fingerprint,
        Math.max(maximumOccurrences.get(fingerprint) ?? 0, count),
      );
    }
  }
  Object.defineProperty(entries, "sourceDiagnostics", {
    value: { malformedLines, sourceLineCount },
    enumerable: false,
  });
  return entries;
}

/** Aggregate invariant alarms by name with evidence pointers. */
export function aggregateAlarms(healthEntries) {
  const byName = {};
  const sourceMalformed =
    (healthEntries.sourceDiagnostics?.malformedLines?.length ?? 0) > 0;
  for (const { entry, file, line } of healthEntries) {
    if (entry.event !== "invariant_alarm") continue;
    const name = entry.name ?? "unknown";
    const detail = typeof entry.detail === "string" ? entry.detail : "";
    if (!invariantAlarmMeetsMetricContract(entry)) continue;
    const identity = runtimeIdentityFromHealthLines([{ entry }]);
    const identityKey =
      identity.status === "attributable"
        ? JSON.stringify(identity.identity)
        : `unattributed:${identity.status}`;
    const named = (byName[name] ??= new Map());
    const bucket = named.get(identityKey) ?? {
      count: 0,
      lastTsMs: 0,
      evidence: [],
      records: [],
      sourceHealth: sourceMalformed
        ? "malformed"
        : identity.status === "attributable"
          ? "healthy"
          : "unattributed",
      buildIdentity: identity.identity,
    };
    bucket.count += 1;
    bucket.lastTsMs = Math.max(bucket.lastTsMs, Number(entry.tsMs ?? 0));
    bucket.records.push(entry);
    if (bucket.evidence.length < 5) {
      bucket.evidence.push({ file, line, detail });
    }
    named.set(identityKey, bucket);
  }
  return Object.fromEntries(
    Object.entries(byName).map(([name, groups]) => {
      const normalizedGroups = [...groups.values()].map(
        ({ records, ...group }) => ({
          ...group,
          evidenceFingerprint: runtimeHealthEvidenceFingerprint(records),
        }),
      );
      return [
        name,
        normalizedGroups.length === 1 ? normalizedGroups[0] : normalizedGroups,
      ];
    }),
  );
}

export function readLatestVerdict(pointerPath = DEFAULT_POINTER) {
  try {
    const soakDir = realpathSync(
      path.resolve(readFileSync(pointerPath, "utf8").trim()),
    );
    const verdictPath = path.join(soakDir, "soak-verdict.json");
    if (!existsSync(verdictPath)) return null;
    const storedVerdict = JSON.parse(readFileSync(verdictPath, "utf8"));
    if (realpathSync(path.resolve(storedVerdict?.soakDir ?? "")) !== soakDir) {
      return null;
    }
    const verdict = validateStoredSoakVerdictProvenance(storedVerdict);
    return { verdict, verdictPath, provenanceVerified: true };
  } catch {
    return null;
  }
}

function canaryComparisonContextKey(record) {
  const context = record?.comparisonContext;
  if (!context || typeof context !== "object") return null;
  return JSON.stringify(
    Object.fromEntries(
      Object.entries(context).sort(([left], [right]) =>
        left.localeCompare(right),
      ),
    ),
  );
}

export function readLatestCanaries(ledgerDir = DEFAULT_LEDGER_DIR) {
  if (!existsSync(ledgerDir)) return [];
  const records = readdirSync(ledgerDir)
    .filter((name) => /^canary-.+\.json$/.test(name))
    .map((name) => {
      try {
        const file = path.join(ledgerDir, name);
        const record = JSON.parse(readFileSync(file, "utf8"));
        validateStoredCanaryRecordProvenance(record, file);
        return { record, file };
      } catch {
        return null;
      }
    })
    .filter((item) => {
      const record = item?.record;
      return (
        record?.schemaVersion === 2 &&
        record?.metricRegistryVersion === STABILITY_METRIC_REGISTRY_VERSION &&
        typeof record?.buildIdentity?.commitSha === "string" &&
        typeof record?.runtimeIdentity?.appSessionId === "string" &&
        record?.sourceHealth?.status === "healthy" &&
        hasMatchedEvidenceAttribution(record) &&
        canaryComparisonContextKey(record) &&
        record?.comparison &&
        ["pass", "regression", "inconclusive"].includes(
          record.comparison.status,
        )
      );
    })
    .sort((a, b) =>
      String(a.record.windowEnd).localeCompare(String(b.record.windowEnd)),
    );
  const latestByContext = new Map();
  for (const item of records) {
    latestByContext.set(canaryComparisonContextKey(item.record), item);
  }
  return [...latestByContext.values()].sort((left, right) =>
    String(left.record.windowEnd).localeCompare(String(right.record.windowEnd)),
  );
}

export function readLatestCanary(ledgerDir = DEFAULT_LEDGER_DIR) {
  return readLatestCanaries(ledgerDir).at(-1) ?? null;
}

function actionableCanaryRecord(record) {
  return (
    record?.schemaVersion === 2 &&
    record?.metricRegistryVersion === STABILITY_METRIC_REGISTRY_VERSION &&
    record?.comparison?.status === "regression" &&
    record?.sourceHealth?.status === "healthy" &&
    hasMatchedEvidenceAttribution(record) &&
    typeof record?.buildIdentity?.commitSha === "string" &&
    typeof record?.runtimeIdentity?.appSessionId === "string" &&
    Array.isArray(record?.regressions)
  );
}

function evidenceIsFresh(windowEnd, nowMs) {
  const windowEndMs = Date.parse(String(windowEnd ?? ""));
  return (
    Number.isFinite(windowEndMs) &&
    windowEndMs <= nowMs + 5 * 60_000 &&
    nowMs - windowEndMs <= MAX_ACTIONABLE_EVIDENCE_AGE_MS
  );
}

function actionableSoakVerdict(verdictInfo, nowMs) {
  const verdict = verdictInfo?.verdict;
  return Boolean(
    verdictInfo?.provenanceVerified === true &&
    verdict?.schemaVersion === 1 &&
    verdict?.metricRegistryVersion === STABILITY_METRIC_REGISTRY_VERSION &&
    verdict?.sourceHealth?.healthy === true &&
    verdict?.runtimeIdentity?.attributable === true &&
    verdict?.runtimeIdentity?.evidenceStatus === "attributable" &&
    verdict?.evidenceFingerprint?.algorithm === "sha256" &&
    /^[0-9a-f]{64}$/.test(String(verdict?.evidenceFingerprint?.digest ?? "")) &&
    Number.isSafeInteger(verdict?.evidenceFingerprint?.recordCount) &&
    verdict.evidenceFingerprint.recordCount > 0 &&
    Array.isArray(verdict?.assertions) &&
    evidenceIsFresh(verdict.windowEnd, nowMs),
  );
}

export function readCiIssues({ exec = execFileSync } = {}) {
  try {
    const raw = exec(
      "/opt/homebrew/bin/gh",
      [
        "issue",
        "list",
        "--label",
        "automation-triage",
        "--state",
        "open",
        "--json",
        "number,title,body,updatedAt,url",
      ],
      { cwd: REPO_ROOT, encoding: "utf8", timeout: 30_000 },
    );
    return JSON.parse(raw);
  } catch {
    return []; // Offline or gh unavailable: triage degrades, never fails.
  }
}

function alarmResolvedByVerdict(name, aggregate, verdictInfo, nowMs) {
  const assertions = verdictInfo?.verdict?.assertions;
  if (!assertions) return false;
  if (!actionableSoakVerdict(verdictInfo, nowMs)) return false;
  const verdictIdentity = verdictInfo.verdict.runtimeIdentity;
  if (
    aggregate.buildIdentity &&
    JSON.stringify(aggregate.buildIdentity) !==
      JSON.stringify({
        appVersion: verdictIdentity.appVersion,
        buildCommitSha: verdictIdentity.buildCommitSha,
        channel: verdictIdentity.channel,
        appSessionId: verdictIdentity.appSessionId,
      })
  )
    return false;
  const verdictEndMs = Date.parse(verdictInfo.verdict.windowEnd ?? "");
  if (!Number.isFinite(verdictEndMs) || aggregate.lastTsMs > verdictEndMs)
    return false;

  const bucket = BUCKETS.find((candidate) => candidate.alarms.includes(name));
  if (!bucket || bucket.assertions.length === 0) return false;
  const statusByAssertion = new Map(
    assertions.map((assertion) => [assertion.id, assertion.status]),
  );
  const statuses = bucket.assertions
    .map((id) => statusByAssertion.get(id))
    .filter(Boolean);
  return statuses.includes("pass") && !statuses.includes("fail");
}

/**
 * Fold the four evidence streams into scored bucket candidates.
 * score = severity * ln(1 + hits) * freshness, freshness 1.0 for <24h-old
 * evidence decaying to 0.25 at 7 days. CI issues pin to their own bucket.
 */
export function buildCandidates({
  alarms,
  verdictInfo,
  canaryInfo,
  ciIssues,
  nowMs,
}) {
  const candidates = new Map();
  const touch = (bucketId) => {
    const bucket = BUCKETS.find((b) => b.id === bucketId);
    if (!bucket) return null;
    if (!candidates.has(bucketId)) {
      candidates.set(bucketId, {
        bucket,
        hits: 0,
        lastEvidenceMs: 0,
        evidence: [],
        buildIdentities: [],
        sourceHealthStatuses: [],
        sourceFingerprints: [],
      });
    }
    return candidates.get(bucketId);
  };

  for (const [name, alarmGroups] of Object.entries(alarms ?? {})) {
    const groups = Array.isArray(alarmGroups) ? alarmGroups : [alarmGroups];
    for (const aggregate of groups) {
      if (aggregate.sourceHealth !== "healthy" || !aggregate.buildIdentity)
        continue;
      if (alarmResolvedByVerdict(name, aggregate, verdictInfo, nowMs)) continue;
      const bucket = BUCKETS.find((b) => b.alarms.includes(name));
      if (!bucket) continue;
      const candidate = touch(bucket.id);
      candidate.hits += aggregate.count;
      candidate.buildIdentities.push(aggregate.buildIdentity);
      candidate.sourceHealthStatuses.push(aggregate.sourceHealth);
      candidate.sourceFingerprints.push({
        kind: "runtime-health",
        ...aggregate.evidenceFingerprint,
      });
      candidate.lastEvidenceMs = Math.max(
        candidate.lastEvidenceMs,
        aggregate.lastTsMs,
      );
      for (const item of aggregate.evidence) {
        candidate.evidence.push(
          `alarm ${name} x${aggregate.count.toLocaleString()}: ${item.file}:${item.line} ${item.detail}`.trim(),
        );
      }
    }
  }

  if (actionableSoakVerdict(verdictInfo, nowMs)) {
    const verdictEndMs = Date.parse(verdictInfo.verdict.windowEnd);
    for (const assertion of verdictInfo.verdict.assertions) {
      if (assertion.status !== "fail") continue;
      const bucket = BUCKETS.find((b) => b.assertions.includes(assertion.id));
      if (!bucket) continue;
      const candidate = touch(bucket.id);
      candidate.hits += 1;
      candidate.buildIdentities.push({
        appVersion: verdictInfo.verdict.runtimeIdentity.appVersion,
        buildCommitSha: verdictInfo.verdict.runtimeIdentity.buildCommitSha,
        channel: verdictInfo.verdict.runtimeIdentity.channel,
        appSessionId: verdictInfo.verdict.runtimeIdentity.appSessionId,
      });
      candidate.sourceHealthStatuses.push("healthy");
      candidate.sourceFingerprints.push({
        kind: "soak",
        ...verdictInfo.verdict.evidenceFingerprint,
        measurementDigest:
          verdictInfo.verdict.sourceHealth?.measurementFingerprint?.digest ??
          null,
      });
      candidate.lastEvidenceMs = Math.max(
        candidate.lastEvidenceMs,
        verdictEndMs,
      );
      candidate.evidence.push(
        `soak-verdict ${assertion.id}: ${assertion.detail} (${verdictInfo.verdictPath})`,
      );
    }
  }

  const canaryInfos = Array.isArray(canaryInfo)
    ? canaryInfo
    : canaryInfo
      ? [canaryInfo]
      : [];
  for (const currentCanary of canaryInfos) {
    if (
      !actionableCanaryRecord(currentCanary?.record) ||
      !evidenceIsFresh(currentCanary.record.windowEnd, nowMs)
    )
      continue;
    const canaryEndMs = Date.parse(currentCanary.record.windowEnd);
    for (const regression of currentCanary.record.regressions) {
      const bucket = BUCKETS.find((b) =>
        b.canaryMetrics.includes(regression.metric),
      );
      if (!bucket) continue;
      const candidate = touch(bucket.id);
      candidate.hits += 1;
      candidate.buildIdentities.push({
        appVersion: currentCanary.record.buildIdentity.version,
        buildCommitSha: currentCanary.record.buildIdentity.commitSha,
        channel: currentCanary.record.buildIdentity.channel,
        appSessionId: currentCanary.record.runtimeIdentity.appSessionId,
      });
      candidate.sourceHealthStatuses.push("healthy");
      candidate.sourceFingerprints.push({
        kind: "canary",
        observationId: currentCanary.record.observationId,
        ...currentCanary.record.evidenceAttribution.evidenceFingerprint,
        measurementDigest:
          currentCanary.record.sourceHealth?.measurementFingerprint?.digest ??
          null,
      });
      candidate.lastEvidenceMs = Math.max(
        candidate.lastEvidenceMs,
        canaryEndMs,
      );
      candidate.evidence.push(
        `canary ${currentCanary.record.version} ${regression.metric}=${regression.current} vs median ${regression.trailingMedian} (${currentCanary.file})`,
      );
    }
  }

  for (const issue of ciIssues ?? []) {
    const issueUpdatedAtMs = Date.parse(issue.updatedAt ?? "");
    const commitSha = `${issue.title ?? ""}\n${issue.body ?? ""}`
      .match(/\b[0-9a-f]{40}\b/i)?.[0]
      ?.toLowerCase();
    if (!Number.isFinite(issueUpdatedAtMs) || !commitSha) continue;
    const candidate = touch("ci-red");
    candidate.hits += 1;
    candidate.buildIdentities.push({
      buildCommitSha: commitSha,
      source: "github-actions",
    });
    candidate.sourceHealthStatuses.push("healthy");
    candidate.sourceFingerprints.push({
      kind: "ci-issue",
      digest: createHash("sha256").update(JSON.stringify(issue)).digest("hex"),
    });
    candidate.lastEvidenceMs = Math.max(
      candidate.lastEvidenceMs,
      issueUpdatedAtMs,
    );
    candidate.evidence.push(
      `CI issue #${issue.number}: ${issue.title} (${issue.url})`,
    );
  }

  const scored = [...candidates.values()].map((candidate) => {
    const ageDays = Math.max(
      0,
      (nowMs - candidate.lastEvidenceMs) / 86_400_000,
    );
    const freshness =
      ageDays <= 1 ? 1 : Math.max(0.25, 1 - (ageDays - 1) * 0.125);
    const evidenceWindowEnd = candidate.lastEvidenceMs
      ? new Date(candidate.lastEvidenceMs).toISOString()
      : "";
    const buildIdentities = [
      ...new Map(
        candidate.buildIdentities.map((identity) => [
          JSON.stringify(identity),
          identity,
        ]),
      ).values(),
    ];
    const sourceFingerprints = candidate.sourceFingerprints
      .map((fingerprint) => JSON.stringify(fingerprint))
      .sort()
      .map((fingerprint) => JSON.parse(fingerprint));
    const evidenceFingerprint = createHash("sha256")
      .update(
        JSON.stringify({
          taskId: candidate.bucket.taskId,
          evidenceWindowEnd,
          evidence: candidate.evidence,
          buildIdentities,
          sourceFingerprints,
        }),
      )
      .digest("hex");
    return {
      ...candidate,
      evidenceWindowEnd,
      buildIdentities,
      sourceFingerprints,
      sourceHealth: candidate.sourceHealthStatuses.every(
        (status) => status === "healthy",
      )
        ? "healthy"
        : "inconclusive",
      evidenceFingerprint,
      score: Number(
        (
          candidate.bucket.severity *
          Math.log(1 + candidate.hits) *
          freshness
        ).toFixed(3),
      ),
    };
  });
  return scored.sort((a, b) => b.score - a.score);
}

/** Render one ranked candidate as a docs/stability-tasks-format task file. */
export function renderTaskFile(candidate, rank, generatedAtIso) {
  const { bucket } = candidate;
  const lines = [
    `# T-${rank.toLocaleString()}: ${bucket.title}`,
    "",
    `runner-safe: false (triage candidate; the mapped program task's own header governs) | provider-visible: ${bucket.providerVisible ? "true" : "false"} | soak-gated: ${bucket.behavioral ? "yes" : "no"}`,
    `Findings: ${bucket.findings}. Generated by scripts/triage.mjs at ${generatedAtIso}. Score ${candidate.score.toLocaleString()} (severity ${bucket.severity.toLocaleString()}, ${candidate.hits.toLocaleString()} evidence hit${candidate.hits === 1 ? "" : "s"}).`,
    `Task ID: ${bucket.taskId}`,
    `Evidence fingerprint: ${candidate.evidenceFingerprint}`,
    `Generated at: ${generatedAtIso}`,
    `Evidence window end: ${candidate.evidenceWindowEnd || generatedAtIso}`,
    `Lifecycle state: triaged`,
    `Authority: ${bucket.observerAuthority}`,
    `Owner review required: ${bucket.ownerReviewRequired ? "yes" : "no"}`,
    `Provider authority: ${bucket.providerVisible ? "approval-required" : "forbidden"}`,
    `Source health: ${candidate.sourceHealth}`,
    `Soak exclusivity key: ${bucket.soakExclusivityKey ?? "none"}`,
    "",
    "## Context",
    "",
    `Live evidence indicts this root-cause bucket. Do not re-derive: execute the mapped program task with tonight's evidence attached.`,
    "",
    `Program task: ${bucket.programTask}`,
    "",
    "## Evidence",
    "",
    ...candidate.evidence.slice(0, 10).map((item) => `- ${item}`),
    "",
    "## Verify",
    "",
    "- The program task's own counter-based verification governs; a follow-up soak/canary window must show this bucket's signals at or trending to target (docs/STABILITY-PROGRAM.md scorecard).",
    "",
  ];
  return lines.join("\n");
}

export function emitCandidates(
  ranked,
  candidateDir,
  { nowIso, keep = 8 } = {},
) {
  mkdirSync(candidateDir, { recursive: true });
  const generationsDir = path.join(candidateDir, "generations");
  mkdirSync(generationsDir, { recursive: true });
  const generationId = `${nowIso.replace(/[^0-9A-Za-z]/g, "")}-${randomUUID().slice(0, 8)}`;
  const generationDir = path.join(generationsDir, generationId);
  const temporaryDir = path.join(generationsDir, `.${generationId}.tmp`);
  mkdirSync(temporaryDir, { recursive: false });
  const written = [];
  ranked.slice(0, keep).forEach((candidate, index) => {
    const rank = index + 1;
    const name = `T-${String(rank).padStart(2, "0")}-${candidate.bucket.id}.md`;
    const filePath = path.join(temporaryDir, name);
    writeFileSync(filePath, renderTaskFile(candidate, rank, nowIso));
    written.push(path.join(generationDir, name));
  });

  const candidates = ranked.slice(0, keep).map((candidate, index) => ({
    rank: index + 1,
    id: candidate.bucket.id,
    file: `T-${String(index + 1).padStart(2, "0")}-${candidate.bucket.id}.md`,
    score: candidate.score,
    hits: candidate.hits,
    evidenceWindowEnd: candidate.evidenceWindowEnd || nowIso,
    taskId: candidate.bucket.taskId,
    rootCauseBucket: candidate.bucket.id,
    metricRegistryIds: candidate.bucket.metricRegistryIds,
    evidenceFingerprint: candidate.evidenceFingerprint,
    buildIdentities: candidate.buildIdentities,
    sourceHealth: candidate.sourceHealth,
    lifecycleState: "triaged",
    lastTransitionAt: nowIso,
    observerAuthority: candidate.bucket.observerAuthority,
    ownerReviewRequired: candidate.bucket.ownerReviewRequired,
    providerVisible: candidate.bucket.providerVisible,
    providerAuthority: candidate.bucket.providerVisible
      ? "approval-required"
      : "forbidden",
    behavioral: candidate.bucket.behavioral,
    soakExclusivityKey: candidate.bucket.soakExclusivityKey,
    requiredVerificationWindow: candidate.bucket.behavioral
      ? "one isolated installed-build soak"
      : "focused validation",
  }));
  const manifest = {
    schemaVersion: 1,
    metricRegistryVersion: STABILITY_METRIC_REGISTRY_VERSION,
    generation: generationId,
    generationDir: path.join("generations", generationId),
    generatedAt: nowIso,
    evidenceWindowEnd:
      candidates
        .map((candidate) => candidate.evidenceWindowEnd)
        .sort()
        .at(-1) ?? nowIso,
    candidateCount: candidates.length,
    candidates,
  };
  writeFileSync(
    path.join(temporaryDir, "manifest.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
  );
  renameSync(temporaryDir, generationDir);

  const currentPath = path.join(candidateDir, "current.json");
  const temporaryCurrentPath = path.join(
    candidateDir,
    `.current-${process.pid}-${randomUUID().slice(0, 8)}.json`,
  );
  writeFileSync(temporaryCurrentPath, `${JSON.stringify(manifest, null, 2)}\n`);
  renameSync(temporaryCurrentPath, currentPath);

  // Remove legacy top-level task files after the atomic pointer has moved.
  // Immutable generation directories remain available for audit history.
  for (const name of readdirSync(candidateDir)) {
    if (!/^T-\d{2}-.+\.md$/.test(name)) continue;
    rmSync(path.join(candidateDir, name), { force: true });
  }
  return written;
}

function usage() {
  return `Usage:
  node scripts/triage.mjs [options]

Options:
  --app-data <path>       Runtime-health dir. Defaults to the installed app dir.
  --hours <n>             Alarm aggregation window. Defaults to 48.
  --pointer <path>        Soak pointer for the latest verdict.
  --ledger-dir <path>     Canary ledger dir. Defaults to <repo>/canary-ledger.
  --candidate-dir <path>  Output dir. Defaults to ~/.freed/automation/triage/candidates.
  --no-ci                 Skip the GitHub CI-issue lookup (offline).
  --json                  Print the ranked candidates as JSON.
  --help                  Show this help.
`;
}

export function parseArgs(argv) {
  const args = {
    appData: DEFAULT_APP_DATA,
    hours: 48,
    pointer: DEFAULT_POINTER,
    ledgerDir: DEFAULT_LEDGER_DIR,
    candidateDir: DEFAULT_CANDIDATE_DIR,
    ci: true,
    json: false,
    help: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--app-data") args.appData = argv[++i];
    else if (arg === "--hours") args.hours = Number(argv[++i]);
    else if (arg === "--pointer") args.pointer = argv[++i];
    else if (arg === "--ledger-dir") args.ledgerDir = argv[++i];
    else if (arg === "--candidate-dir") args.candidateDir = argv[++i];
    else if (arg === "--no-ci") args.ci = false;
    else if (arg === "--json") args.json = true;
    else if (arg === "--help" || arg === "-h") args.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return args;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    process.stdout.write(usage());
    return;
  }
  const nowMs = Date.now();
  const healthEntries = readHealthEntries(args.appData, {
    sinceMs: nowMs - args.hours * 3_600_000,
  });
  const malformedCount =
    healthEntries.sourceDiagnostics?.malformedLines?.length ?? 0;
  if (malformedCount > 0) {
    process.stderr.write(
      `Withheld runtime alarm candidates because ${malformedCount.toLocaleString()} malformed health line${malformedCount === 1 ? " was" : "s were"} found.\n`,
    );
  }
  const ranked = buildCandidates({
    alarms: aggregateAlarms(healthEntries),
    verdictInfo: readLatestVerdict(args.pointer),
    canaryInfo: readLatestCanaries(args.ledgerDir),
    ciIssues: args.ci ? readCiIssues() : [],
    nowMs,
  });
  const written = emitCandidates(ranked, args.candidateDir, {
    nowIso: new Date(nowMs).toISOString(),
  });

  if (args.json) {
    process.stdout.write(
      `${JSON.stringify(
        ranked.map(({ bucket, hits, score, evidence }) => ({
          id: bucket.id,
          hits,
          score,
          evidence,
        })),
        null,
        2,
      )}\n`,
    );
  }
  process.stdout.write(
    `${ranked.length.toLocaleString()} candidate bucket${ranked.length === 1 ? "" : "s"} -> ${written.length.toLocaleString()} task file${written.length === 1 ? "" : "s"} in ${args.candidateDir}\n`,
  );
  for (const [index, candidate] of ranked.entries()) {
    process.stdout.write(
      `  ${(index + 1).toLocaleString()}. [${candidate.score.toLocaleString()}] ${candidate.bucket.id} (${candidate.hits.toLocaleString()} hits) -> ${candidate.bucket.programTask}\n`,
    );
  }
}

if (process.argv[1] === __filename) {
  try {
    main();
  } catch (error) {
    process.stderr.write(
      `${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exitCode = 1;
  }
}
