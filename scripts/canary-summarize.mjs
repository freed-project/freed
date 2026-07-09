#!/usr/bin/env node
/**
 * canary-summarize.mjs (stability W2-03)
 *
 * The owner machine is the de-facto canary fleet: releases are near-daily and
 * there is no remote telemetry. This script folds a window of rotated
 * runtime-health history into one canary record per installed release and
 * flags regressions against the trailing ledger median, so "which release
 * regressed it" stops being a manual investigation.
 *
 * Writes canary-ledger/canary-<version>.json (committed ledger). Metrics all
 * come from P0-02/P0-03/W2-01 counters: recoveries, window kills by reason,
 * invariant alarms by name, uploads (attempts / unchanged heads / damper
 * skips), worker INITs/hour, scrape success by provider, peak memory, and the
 * idle app-resident growth slope.
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const REPO_ROOT = path.resolve(path.dirname(__filename), "..");
const DEFAULT_LEDGER_DIR = path.join(REPO_ROOT, "canary-ledger");
const DEFAULT_APP_DATA = path.join(
  os.homedir(),
  "Library/Application Support/wtf.freed.desktop",
);

/** Per-metric regression tolerances vs the trailing-ledger median. */
export const REGRESSION_TOLERANCES = {
  recoveriesPerDay: { kind: "absolute", allowance: 2 },
  uploadsUnchangedPerHour: { kind: "ratio", allowance: 1.5 },
  uploadsPerHour: { kind: "ratio", allowance: 1.5 },
  workerInitsPerHour: { kind: "ratio", allowance: 1.5 },
  peakAppResidentBytes: { kind: "ratio", allowance: 1.25 },
  peakWebkitLargestResidentBytes: { kind: "ratio", allowance: 1.25 },
  idleGrowthMbPerHour: { kind: "absolute", allowance: 20 },
  alarmsPerDay: { kind: "absolute", allowance: 2 },
};

export function readHealthWindow(appDataDir, { sinceMs, untilMs = Number.POSITIVE_INFINITY }) {
  const entries = [];
  if (!existsSync(appDataDir)) return entries;
  const dated = readdirSync(appDataDir)
    .filter((name) => /^runtime-health-\d{8}\.jsonl$/.test(name))
    .sort();
  const files = dated.length > 0
    ? dated.map((name) => path.join(appDataDir, name))
    : [path.join(appDataDir, "runtime-health.jsonl")].filter(existsSync);
  for (const file of files) {
    for (const raw of readFileSync(file, "utf8").split("\n")) {
      if (!raw.trim()) continue;
      let entry;
      try {
        entry = JSON.parse(raw);
      } catch {
        continue;
      }
      const ts = Number(entry.tsMs ?? 0);
      if (ts >= sinceMs && ts <= untilMs) entries.push(entry);
    }
  }
  return entries;
}

function linearSlopeMbPerHour(points) {
  const usable = points.filter((p) => p.bytes > 0 && p.tsMs > 0);
  if (usable.length < 2) return null;
  const n = usable.length;
  const meanX = usable.reduce((sum, p) => sum + p.tsMs, 0) / n;
  const meanY = usable.reduce((sum, p) => sum + p.bytes, 0) / n;
  let numerator = 0;
  let denominator = 0;
  for (const p of usable) {
    numerator += (p.tsMs - meanX) * (p.bytes - meanY);
    denominator += (p.tsMs - meanX) ** 2;
  }
  if (denominator === 0) return null;
  const bytesPerMs = numerator / denominator;
  return (bytesPerMs * 3_600_000) / (1024 * 1024);
}

/** Fold a window of runtime-health entries into one canary record. */
export function computeCanarySummary(entries, { version, windowStartMs, windowEndMs }) {
  const spanHours = Math.max((windowEndMs - windowStartMs) / 3_600_000, 1 / 60);
  const spanDays = spanHours / 24;

  const count = (predicate) => entries.filter(predicate).length;
  const recoveries =
    count((e) => e.event === "renderer_recovery_attempt") +
    count((e) => e.event === "renderer_recovery_restart_requested");
  const killsByReason = {};
  for (const e of entries) {
    if (e.event !== "window_destroyed") continue;
    const reason = e.reasonEnum ?? "unknown";
    killsByReason[reason] = (killsByReason[reason] ?? 0) + 1;
  }
  const alarmsByName = {};
  for (const e of entries) {
    if (e.event !== "invariant_alarm") continue;
    const name = e.name ?? "unknown";
    alarmsByName[name] = (alarmsByName[name] ?? 0) + 1;
  }
  const uploads = entries.filter((e) => e.event === "cloud_upload_attempt");
  const uploadsUnchanged = uploads.filter((e) => e.headsUnchanged === true);
  const uploadSkips = count((e) => e.event === "cloud_upload_skipped");
  const workerInits = count((e) => e.event === "worker_init");

  const scrapeByProvider = {};
  for (const e of entries) {
    if (e.event !== "scrape_outcome") continue;
    const provider = e.provider ?? "unknown";
    const bucket = (scrapeByProvider[provider] ??= { attempts: 0, ok: 0, byStage: {} });
    bucket.attempts += 1;
    if (e.stage === "ok") bucket.ok += 1;
    bucket.byStage[e.stage ?? "unknown"] = (bucket.byStage[e.stage ?? "unknown"] ?? 0) + 1;
  }

  const samples = entries.filter((e) => e.event === "native_runtime_memory_sample");
  const peakAppResidentBytes = samples.reduce(
    (max, e) => Math.max(max, Number(e.appResidentBytes ?? 0)),
    0,
  );
  const peakWebkitLargestResidentBytes = samples.reduce(
    (max, e) => Math.max(max, Number(e.webkitLargestResidentBytes ?? 0)),
    0,
  );
  const idleGrowthMbPerHour = linearSlopeMbPerHour(
    samples.map((e) => ({ tsMs: Number(e.tsMs ?? 0), bytes: Number(e.appResidentBytes ?? 0) })),
  );

  const alarmTotal = Object.values(alarmsByName).reduce((sum, n) => sum + n, 0);
  return {
    schemaVersion: 1,
    version,
    windowStart: new Date(windowStartMs).toISOString(),
    windowEnd: new Date(windowEndMs).toISOString(),
    spanHours: Number(spanHours.toFixed(2)),
    healthLineCount: entries.length,
    metrics: {
      recoveriesPerDay: Number((recoveries / spanDays).toFixed(2)),
      windowKillsByReason: killsByReason,
      alarmsByName,
      alarmsPerDay: Number((alarmTotal / spanDays).toFixed(2)),
      uploadsPerHour: Number((uploads.length / spanHours).toFixed(2)),
      uploadsUnchangedPerHour: Number((uploadsUnchanged.length / spanHours).toFixed(2)),
      uploadSkipsPerHour: Number((uploadSkips / spanHours).toFixed(2)),
      workerInitsPerHour: Number((workerInits / spanHours).toFixed(2)),
      scrapeByProvider,
      peakAppResidentBytes,
      peakWebkitLargestResidentBytes,
      idleGrowthMbPerHour: idleGrowthMbPerHour === null
        ? null
        : Number(idleGrowthMbPerHour.toFixed(1)),
    },
  };
}

function median(values) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * Flag metrics worse than the trailing-ledger median by more than the
 * per-metric tolerance. Returns [] when no history exists yet.
 */
export function detectRegressions(summary, trailingSummaries) {
  const regressions = [];
  for (const [metric, tolerance] of Object.entries(REGRESSION_TOLERANCES)) {
    const current = summary.metrics[metric];
    if (current === null || current === undefined) continue;
    const history = trailingSummaries
      .map((s) => s.metrics?.[metric])
      .filter((v) => v !== null && v !== undefined && Number.isFinite(v));
    if (history.length === 0) continue;
    const baseline = median(history);
    const limit = tolerance.kind === "ratio"
      ? Math.max(baseline * tolerance.allowance, baseline + Number.EPSILON)
      : baseline + tolerance.allowance;
    if (current > limit) {
      regressions.push({
        metric,
        current,
        trailingMedian: Number(baseline.toFixed(2)),
        limit: Number(limit.toFixed(2)),
        trailingCount: history.length,
      });
    }
  }
  return regressions;
}

export function loadTrailingSummaries(ledgerDir, excludeVersion, limit = 7) {
  if (!existsSync(ledgerDir)) return [];
  return readdirSync(ledgerDir)
    .filter((name) => /^canary-.+\.json$/.test(name) && name !== `canary-${excludeVersion}.json`)
    .map((name) => {
      try {
        return JSON.parse(readFileSync(path.join(ledgerDir, name), "utf8"));
      } catch {
        return null;
      }
    })
    .filter(Boolean)
    .sort((a, b) => String(a.windowEnd).localeCompare(String(b.windowEnd)))
    .slice(-limit);
}

function installedAppVersion() {
  try {
    const plist = readFileSync("/Applications/Freed.app/Contents/Info.plist", "utf8");
    const match = plist.match(
      /<key>CFBundleShortVersionString<\/key>\s*<string>([^<]+)<\/string>/,
    );
    return match?.[1] ?? null;
  } catch {
    return null;
  }
}

function usage() {
  return `Usage:
  node scripts/canary-summarize.mjs [options]

Options:
  --version <v>        Release version for the ledger record. Defaults to the installed app.
  --app-data <path>    Dir with rotated runtime-health files. Defaults to the installed app dir.
  --hours <n>          Window length ending now. Defaults to 24.
  --since-ms <ts>      Explicit window start (overrides --hours).
  --until-ms <ts>      Explicit window end. Defaults to now.
  --ledger-dir <path>  Ledger output dir. Defaults to <repo>/canary-ledger.
  --strict             Exit 1 when a regression is flagged.
  --json               Print the record to stdout too.
  --help               Show this help.
`;
}

export function parseArgs(argv) {
  const args = {
    version: null,
    appData: DEFAULT_APP_DATA,
    hours: 24,
    sinceMs: null,
    untilMs: null,
    ledgerDir: DEFAULT_LEDGER_DIR,
    strict: false,
    json: false,
    help: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--version") args.version = argv[++i];
    else if (arg === "--app-data") args.appData = argv[++i];
    else if (arg === "--hours") args.hours = Number(argv[++i]);
    else if (arg === "--since-ms") args.sinceMs = Number(argv[++i]);
    else if (arg === "--until-ms") args.untilMs = Number(argv[++i]);
    else if (arg === "--ledger-dir") args.ledgerDir = argv[++i];
    else if (arg === "--strict") args.strict = true;
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
  const version = args.version ?? installedAppVersion();
  if (!version) {
    throw new Error("Could not determine the installed version; pass --version.");
  }
  const untilMs = args.untilMs ?? Date.now();
  const sinceMs = args.sinceMs ?? untilMs - args.hours * 3_600_000;

  const entries = readHealthWindow(args.appData, { sinceMs, untilMs });
  const summary = computeCanarySummary(entries, {
    version,
    windowStartMs: sinceMs,
    windowEndMs: untilMs,
  });
  const trailing = loadTrailingSummaries(args.ledgerDir, version);
  const regressions = detectRegressions(summary, trailing);
  const record = { ...summary, regressions, trailingCompared: trailing.length };

  mkdirSync(args.ledgerDir, { recursive: true });
  const outPath = path.join(args.ledgerDir, `canary-${version}.json`);
  writeFileSync(outPath, `${JSON.stringify(record, null, 2)}\n`);

  if (args.json) process.stdout.write(`${JSON.stringify(record, null, 2)}\n`);
  process.stdout.write(
    `canary ${version}: ${entries.length} health lines over ${summary.spanHours}h -> ${outPath}\n`,
  );
  if (regressions.length > 0) {
    for (const r of regressions) {
      process.stdout.write(
        `REGRESSION ${r.metric}: ${r.current} vs trailing median ${r.trailingMedian} (limit ${r.limit}, n=${r.trailingCount})\n`,
      );
    }
    if (args.strict) process.exitCode = 1;
  } else {
    process.stdout.write(`no regressions vs ${trailing.length} trailing ledger entr${trailing.length === 1 ? "y" : "ies"}\n`);
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
