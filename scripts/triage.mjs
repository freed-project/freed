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
 * into the nightly runner's candidate directory.
 *
 * Buckets deliberately map to EXISTING program tasks where one exists: the
 * emitted candidate says "execute P1-04, here is tonight's evidence", so the
 * queue converges on the program instead of forking it.
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

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

/**
 * Root-cause buckets. Each maps the signals that indict it (alarm names,
 * soak-verdict assertion ids, canary metrics) to the program task that fixes
 * it. severity 1-5 follows stability-findings.json.
 */
export const BUCKETS = [
  {
    id: "cloud-loop",
    title: "Idle cloud upload loop is live",
    severity: 5,
    alarms: ["cloud_loop"],
    assertions: ["uploads_unchanged_heads"],
    canaryMetrics: ["uploadsUnchangedPerHour", "uploadsPerHour"],
    programTask: "P1-01-cloud-loop-damper-desktop.md (then P1-02/P1-03)",
    findings: "F01/F06",
  },
  {
    id: "preflight-kill",
    title: "Window recycles are killing held scraper/login sessions",
    severity: 5,
    alarms: ["preflight_kill"],
    assertions: ["preflight_kills"],
    canaryMetrics: [],
    programTask: "P1-04-preflight-recycle-guard.md",
    findings: "F04",
  },
  {
    id: "scrape-zero-persist",
    title: "Scrapes extract items but persist nothing",
    severity: 5,
    alarms: ["scrape_zero_persist"],
    assertions: ["scrape_zero_persist"],
    canaryMetrics: [],
    programTask: "P1-05-recovery-invoke-latch.md",
    findings: "F03",
  },
  {
    id: "renderer-churn",
    title: "Watchdog is thrashing the main renderer",
    severity: 4,
    alarms: ["watchdog_thrash"],
    assertions: ["renderer_recoveries", "stale_heartbeats"],
    canaryMetrics: ["recoveriesPerDay"],
    programTask: "demand-side dampers first (P1-*); thresholds stay frozen per program rules",
    findings: "F16/F23",
  },
  {
    id: "auth-zombie",
    title: "A provider is scraping empty while believed authenticated",
    severity: 3,
    alarms: ["auth_zombie"],
    assertions: [],
    canaryMetrics: [],
    programTask: "Wave 4 auth-truth tasks (see docs/STABILITY-PROGRAM.md)",
    findings: "auth misclassification theme",
  },
  {
    id: "memory-growth",
    title: "Idle memory footprint is growing or peaking high",
    severity: 4,
    alarms: [],
    assertions: ["main_footprint_slope", "webkit_returns_to_baseline"],
    canaryMetrics: ["idleGrowthMbPerHour", "peakAppResidentBytes", "peakWebkitLargestResidentBytes"],
    programTask: "Wave 5 demand-side tasks (see docs/STABILITY-PROGRAM.md)",
    findings: "F-memory themes",
  },
  {
    id: "worker-churn",
    title: "Automerge worker INIT churn",
    severity: 3,
    alarms: [],
    assertions: [],
    canaryMetrics: ["workerInitsPerHour"],
    programTask: "Wave 5 worker lifecycle task",
    findings: "F20",
  },
  {
    id: "ci-red",
    title: "CI is red",
    severity: 5,
    alarms: [],
    assertions: [],
    canaryMetrics: [],
    programTask: "fix the failing job first; nothing ships over red CI",
    findings: "ci",
  },
];

export function readHealthEntries(appDataDir, { sinceMs }) {
  const entries = [];
  if (!existsSync(appDataDir)) return entries;
  const files = readdirSync(appDataDir)
    .filter((name) => /^runtime-health-\d{8}\.jsonl$/.test(name))
    .sort()
    .map((name) => path.join(appDataDir, name));
  for (const file of files) {
    const lines = readFileSync(file, "utf8").split("\n");
    lines.forEach((raw, index) => {
      if (!raw.trim()) return;
      try {
        const entry = JSON.parse(raw);
        if (Number(entry.tsMs ?? 0) >= sinceMs) {
          entries.push({ entry, file, line: index + 1 });
        }
      } catch {
        /* skip malformed */
      }
    });
  }
  return entries;
}

/** Aggregate invariant alarms by name with evidence pointers. */
export function aggregateAlarms(healthEntries) {
  const byName = {};
  for (const { entry, file, line } of healthEntries) {
    if (entry.event !== "invariant_alarm") continue;
    const name = entry.name ?? "unknown";
    const bucket = (byName[name] ??= { count: 0, lastTsMs: 0, evidence: [] });
    bucket.count += 1;
    bucket.lastTsMs = Math.max(bucket.lastTsMs, Number(entry.tsMs ?? 0));
    if (bucket.evidence.length < 5) {
      bucket.evidence.push({ file, line, detail: entry.detail ?? "" });
    }
  }
  return byName;
}

export function readLatestVerdict(pointerPath = DEFAULT_POINTER) {
  try {
    const soakDir = readFileSync(pointerPath, "utf8").trim();
    const verdictPath = path.join(soakDir, "soak-verdict.json");
    if (!existsSync(verdictPath)) return null;
    return { verdict: JSON.parse(readFileSync(verdictPath, "utf8")), verdictPath };
  } catch {
    return null;
  }
}

export function readLatestCanary(ledgerDir = DEFAULT_LEDGER_DIR) {
  if (!existsSync(ledgerDir)) return null;
  const records = readdirSync(ledgerDir)
    .filter((name) => /^canary-.+\.json$/.test(name))
    .map((name) => {
      try {
        return { record: JSON.parse(readFileSync(path.join(ledgerDir, name), "utf8")), file: path.join(ledgerDir, name) };
      } catch {
        return null;
      }
    })
    .filter(Boolean)
    .sort((a, b) => String(a.record.windowEnd).localeCompare(String(b.record.windowEnd)));
  return records.at(-1) ?? null;
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
        "number,title,updatedAt,url",
      ],
      { cwd: REPO_ROOT, encoding: "utf8", timeout: 30_000 },
    );
    return JSON.parse(raw);
  } catch {
    return []; // Offline or gh unavailable: triage degrades, never fails.
  }
}

/**
 * Fold the four evidence streams into scored bucket candidates.
 * score = severity * ln(1 + hits) * freshness, freshness 1.0 for <24h-old
 * evidence decaying to 0.25 at 7 days. CI issues pin to their own bucket.
 */
export function buildCandidates({ alarms, verdictInfo, canaryInfo, ciIssues, nowMs }) {
  const candidates = new Map();
  const touch = (bucketId) => {
    const bucket = BUCKETS.find((b) => b.id === bucketId);
    if (!bucket) return null;
    if (!candidates.has(bucketId)) {
      candidates.set(bucketId, { bucket, hits: 0, lastEvidenceMs: 0, evidence: [] });
    }
    return candidates.get(bucketId);
  };

  for (const [name, aggregate] of Object.entries(alarms ?? {})) {
    const bucket = BUCKETS.find((b) => b.alarms.includes(name));
    if (!bucket) continue;
    const candidate = touch(bucket.id);
    candidate.hits += aggregate.count;
    candidate.lastEvidenceMs = Math.max(candidate.lastEvidenceMs, aggregate.lastTsMs);
    for (const item of aggregate.evidence) {
      candidate.evidence.push(`alarm ${name} x${aggregate.count}: ${item.file}:${item.line} ${item.detail}`.trim());
    }
  }

  if (verdictInfo?.verdict?.assertions) {
    const verdictEndMs = Date.parse(verdictInfo.verdict.windowEnd ?? "") || nowMs;
    for (const assertion of verdictInfo.verdict.assertions) {
      if (assertion.status !== "fail") continue;
      const bucket = BUCKETS.find((b) => b.assertions.includes(assertion.id));
      if (!bucket) continue;
      const candidate = touch(bucket.id);
      candidate.hits += 1;
      candidate.lastEvidenceMs = Math.max(candidate.lastEvidenceMs, verdictEndMs);
      candidate.evidence.push(`soak-verdict ${assertion.id}: ${assertion.detail} (${verdictInfo.verdictPath})`);
    }
  }

  if (canaryInfo?.record?.regressions) {
    const canaryEndMs = Date.parse(canaryInfo.record.windowEnd ?? "") || nowMs;
    for (const regression of canaryInfo.record.regressions) {
      const bucket = BUCKETS.find((b) => b.canaryMetrics.includes(regression.metric));
      if (!bucket) continue;
      const candidate = touch(bucket.id);
      candidate.hits += 1;
      candidate.lastEvidenceMs = Math.max(candidate.lastEvidenceMs, canaryEndMs);
      candidate.evidence.push(
        `canary ${canaryInfo.record.version} ${regression.metric}=${regression.current} vs median ${regression.trailingMedian} (${canaryInfo.file})`,
      );
    }
  }

  for (const issue of ciIssues ?? []) {
    const candidate = touch("ci-red");
    candidate.hits += 1;
    candidate.lastEvidenceMs = Math.max(candidate.lastEvidenceMs, Date.parse(issue.updatedAt ?? "") || nowMs);
    candidate.evidence.push(`CI issue #${issue.number}: ${issue.title} (${issue.url})`);
  }

  const scored = [...candidates.values()].map((candidate) => {
    const ageDays = Math.max(0, (nowMs - candidate.lastEvidenceMs) / 86_400_000);
    const freshness = ageDays <= 1 ? 1 : Math.max(0.25, 1 - (ageDays - 1) * 0.125);
    return {
      ...candidate,
      score: Number((candidate.bucket.severity * Math.log(1 + candidate.hits) * freshness).toFixed(3)),
    };
  });
  return scored.sort((a, b) => b.score - a.score);
}

/** Render one ranked candidate as a docs/stability-tasks-format task file. */
export function renderTaskFile(candidate, rank, generatedAtIso) {
  const { bucket } = candidate;
  const lines = [
    `# T-${rank}: ${bucket.title}`,
    "",
    `runner-safe: false (triage candidate; the mapped program task's own header governs) | provider-visible: false | soak-gated: see program task`,
    `Findings: ${bucket.findings}. Generated by scripts/triage.mjs at ${generatedAtIso}. Score ${candidate.score} (severity ${bucket.severity}, ${candidate.hits} evidence hit${candidate.hits === 1 ? "" : "s"}).`,
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

export function emitCandidates(ranked, candidateDir, { nowIso, keep = 8 } = {}) {
  mkdirSync(candidateDir, { recursive: true });
  const written = [];
  ranked.slice(0, keep).forEach((candidate, index) => {
    const rank = index + 1;
    const name = `T-${String(rank).padStart(2, "0")}-${candidate.bucket.id}.md`;
    const filePath = path.join(candidateDir, name);
    writeFileSync(filePath, renderTaskFile(candidate, rank, nowIso));
    written.push(filePath);
  });
  // Clear stale higher-ranked leftovers from previous runs.
  for (const name of readdirSync(candidateDir)) {
    if (!/^T-\d{2}-.+\.md$/.test(name)) continue;
    const rank = Number(name.slice(2, 4));
    if (rank > ranked.length || rank > keep) {
      writeFileSync(path.join(candidateDir, name), "# stale: superseded by a newer triage run\n");
    }
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
  const ranked = buildCandidates({
    alarms: aggregateAlarms(healthEntries),
    verdictInfo: readLatestVerdict(args.pointer),
    canaryInfo: readLatestCanary(args.ledgerDir),
    ciIssues: args.ci ? readCiIssues() : [],
    nowMs,
  });
  const written = emitCandidates(ranked, args.candidateDir, {
    nowIso: new Date(nowMs).toISOString(),
  });

  if (args.json) {
    process.stdout.write(
      `${JSON.stringify(ranked.map(({ bucket, hits, score, evidence }) => ({ id: bucket.id, hits, score, evidence })), null, 2)}\n`,
    );
  }
  process.stdout.write(`${ranked.length} candidate bucket${ranked.length === 1 ? "" : "s"} -> ${written.length} task file${written.length === 1 ? "" : "s"} in ${args.candidateDir}\n`);
  for (const [index, candidate] of ranked.entries()) {
    process.stdout.write(
      `  ${index + 1}. [${candidate.score}] ${candidate.bucket.id} (${candidate.hits} hits) -> ${candidate.bucket.programTask}\n`,
    );
  }
}

if (process.argv[1] === __filename) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
