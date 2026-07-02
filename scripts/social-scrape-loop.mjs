#!/usr/bin/env node

import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
export const REPO_ROOT = path.resolve(__dirname, "..");

const GIB = 1024 * 1024 * 1024;
const DEFAULT_APP_SUPPORT_DIR = path.join(
  os.homedir(),
  "Library",
  "Application Support",
  "wtf.freed.desktop",
);
const DEFAULT_HEALTH_LOG = path.join(DEFAULT_APP_SUPPORT_DIR, "runtime-health.jsonl");
const DEFAULT_DIAGNOSTICS_LOG = path.join(DEFAULT_APP_SUPPORT_DIR, "runtime-diagnostics.jsonl");
const DEFAULT_PROVIDER_HEALTH_STORE = path.join(DEFAULT_APP_SUPPORT_DIR, "sync-health.json");
const DEFAULT_OUTPUT = path.join("/tmp", "freed-social-scrape-loop", "latest-report.json");
const DEFAULT_LOCK_PATH = path.join("/tmp", "freed-social-scrape-loop", "run.lock");
const PROVIDERS = ["facebook", "instagram", "linkedin", "x"];
const PROVIDER_LABELS = {
  facebook: "Facebook",
  instagram: "Instagram",
  linkedin: "LinkedIn",
  x: "X",
};
const numberFormatter = new Intl.NumberFormat("en-US", {
  maximumFractionDigits: 1,
});

function usage() {
  return `Usage:
  node scripts/social-scrape-loop.mjs [options]

Options:
  --health-log <path>        runtime-health.jsonl path.
  --diagnostics-log <path>   runtime-diagnostics.jsonl path.
  --provider-health <path>   sync-health.json path.
  --output <path>            JSON report path. Defaults to ${DEFAULT_OUTPUT}.
  --tail <count>             Analyze only the last count JSONL rows. Defaults to 5,000.
  --memory-budget-gib <n>    WebKit resident memory budget before memory work is urgent. Defaults to 4.
  --watch                    Keep running and rewrite the report each interval.
  --interval-minutes <n>     Watch interval in minutes. Defaults to 30.
  --lock-path <path>         Lock file path. Defaults to ${DEFAULT_LOCK_PATH}.
  --lock-stale-minutes <n>   Treat lock files older than n minutes as stale. Defaults to 120.
  --no-lock                  Skip process locking. Tests only.
  --claim-lock               Acquire the run lock and leave it held for a wider automation pass.
  --release-lock <token>     Release a lock previously acquired with --claim-lock.
  --json                     Print JSON instead of a text summary.
  --no-write                 Do not write the JSON report.
  --help                     Show this help.
`;
}

export function parseArgs(argv) {
  const args = {
    healthLog: DEFAULT_HEALTH_LOG,
    diagnosticsLog: DEFAULT_DIAGNOSTICS_LOG,
    providerHealth: DEFAULT_PROVIDER_HEALTH_STORE,
    output: DEFAULT_OUTPUT,
    tail: 5000,
    memoryBudgetGib: 4,
    watch: false,
    intervalMinutes: 30,
    lockPath: DEFAULT_LOCK_PATH,
    lockStaleMinutes: 120,
    lock: true,
    claimLock: false,
    releaseLockToken: "",
    json: false,
    write: true,
    help: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    switch (arg) {
      case "--health-log":
        args.healthLog = argv[index + 1] ?? "";
        index += 1;
        break;
      case "--diagnostics-log":
        args.diagnosticsLog = argv[index + 1] ?? "";
        index += 1;
        break;
      case "--provider-health":
        args.providerHealth = argv[index + 1] ?? "";
        index += 1;
        break;
      case "--output":
        args.output = argv[index + 1] ?? "";
        index += 1;
        break;
      case "--tail":
        args.tail = Number.parseInt(argv[index + 1] ?? "", 10);
        index += 1;
        break;
      case "--memory-budget-gib":
        args.memoryBudgetGib = Number.parseFloat(argv[index + 1] ?? "");
        index += 1;
        break;
      case "--watch":
        args.watch = true;
        break;
      case "--interval-minutes":
        args.intervalMinutes = Number.parseFloat(argv[index + 1] ?? "");
        index += 1;
        break;
      case "--lock-path":
        args.lockPath = argv[index + 1] ?? "";
        index += 1;
        break;
      case "--lock-stale-minutes":
        args.lockStaleMinutes = Number.parseFloat(argv[index + 1] ?? "");
        index += 1;
        break;
      case "--no-lock":
        args.lock = false;
        break;
      case "--claim-lock":
        args.claimLock = true;
        break;
      case "--release-lock":
        args.releaseLockToken = argv[index + 1] ?? "";
        index += 1;
        break;
      case "--json":
        args.json = true;
        break;
      case "--no-write":
        args.write = false;
        break;
      case "--help":
      case "-h":
        args.help = true;
        break;
      default:
        throw new Error(`Unexpected argument '${arg}'.\n\n${usage()}`);
    }
  }

  if (args.help) {
    return args;
  }

  if (!args.healthLog) {
    throw new Error("health-log is required.");
  }
  if (!Number.isFinite(args.tail) || args.tail <= 0) {
    throw new Error("tail must be a positive number.");
  }
  if (!Number.isFinite(args.memoryBudgetGib) || args.memoryBudgetGib <= 0) {
    throw new Error("memory-budget-gib must be a positive number.");
  }
  if (!Number.isFinite(args.intervalMinutes) || args.intervalMinutes <= 0) {
    throw new Error("interval-minutes must be a positive number.");
  }
  if (args.lock && !args.lockPath) {
    throw new Error("lock-path is required when locking is enabled.");
  }
  if (!Number.isFinite(args.lockStaleMinutes) || args.lockStaleMinutes <= 0) {
    throw new Error("lock-stale-minutes must be a positive number.");
  }
  if (args.claimLock && args.releaseLockToken) {
    throw new Error("claim-lock cannot be combined with release-lock.");
  }

  return args;
}

function lockToken() {
  return `${process.pid}:${Date.now()}:${Math.random().toString(36).slice(2)}`;
}

function readLock(lockPath) {
  if (!existsSync(lockPath)) {
    return null;
  }

  try {
    return JSON.parse(readFileSync(lockPath, "utf8"));
  } catch {
    return {
      pid: null,
      token: "",
      createdAt: "",
      command: "",
      unreadable: true,
    };
  }
}

function lockAgeMs(lockPath, nowMs = Date.now()) {
  try {
    return nowMs - statSync(lockPath).mtimeMs;
  } catch {
    return 0;
  }
}

function writeLockFile(lockPath, token) {
  mkdirSync(path.dirname(lockPath), { recursive: true });
  const fd = openSync(lockPath, "wx");
  try {
    writeFileSync(
      fd,
      `${JSON.stringify({
        token,
        pid: process.pid,
        createdAt: new Date().toISOString(),
        command: process.argv.join(" "),
      })}\n`,
    );
  } finally {
    closeSync(fd);
  }
}

export function acquireRunLock({
  lockPath = DEFAULT_LOCK_PATH,
  staleMs = 120 * 60 * 1000,
  nowMs = Date.now(),
} = {}) {
  const token = lockToken();

  try {
    writeLockFile(lockPath, token);
    return { acquired: true, token, lockPath, stale: false, existing: null };
  } catch (error) {
    if (error?.code !== "EEXIST") {
      throw error;
    }
  }

  const existing = readLock(lockPath);
  const ageMs = lockAgeMs(lockPath, nowMs);
  if (ageMs < staleMs) {
    return { acquired: false, token: "", lockPath, stale: false, existing };
  }

  unlinkSync(lockPath);
  writeLockFile(lockPath, token);
  return { acquired: true, token, lockPath, stale: true, existing };
}

export function releaseRunLock({ lockPath = DEFAULT_LOCK_PATH, token }) {
  const existing = readLock(lockPath);
  if (!existing) {
    return { released: false, reason: "missing" };
  }

  if (token && existing.token !== token) {
    return { released: false, reason: "token_mismatch", existing };
  }

  unlinkSync(lockPath);
  return { released: true, reason: "released" };
}

function tailLines(text, count) {
  const lines = text.split(/\r?\n/).filter(Boolean);
  return count >= lines.length ? lines : lines.slice(lines.length - count);
}

export function readJsonl(filePath, { tail = 5000 } = {}) {
  if (!filePath || !existsSync(filePath)) {
    return { exists: false, rows: [], parseErrors: 0 };
  }

  const lines = tailLines(readFileSync(filePath, "utf8"), tail);
  const rows = [];
  let parseErrors = 0;
  for (const line of lines) {
    try {
      rows.push(JSON.parse(line));
    } catch {
      parseErrors += 1;
    }
  }

  return { exists: true, rows, parseErrors };
}

function normalizeProvider(value) {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (normalized === "twitter") {
    return "x";
  }
  if (normalized === "x / twitter") {
    return "x";
  }
  return PROVIDERS.includes(normalized) ? normalized : "";
}

function providerFromRow(row) {
  const direct = normalizeProvider(row.provider);
  if (direct) {
    return direct;
  }

  const haystack = `${row.operation ?? ""} ${row.reason ?? ""} ${row.source ?? ""}`.toLowerCase();
  if (haystack.includes("facebook")) {
    return "facebook";
  }
  if (haystack.includes("instagram")) {
    return "instagram";
  }
  if (haystack.includes("linkedin")) {
    return "linkedin";
  }
  if (haystack.includes("twitter") || /\bx\b/.test(haystack)) {
    return "x";
  }
  return "";
}

function maxNumber(...values) {
  return values
    .filter((value) => Number.isFinite(value))
    .reduce((max, value) => Math.max(max, value), 0);
}

function rowWebkitResidentBytes(row) {
  return maxNumber(
    row.webkitResidentBytes,
    row.afterWebkitResidentBytes,
    row.recoveredWebkitResidentBytes,
    row.webkitLargestResidentBytes,
    row.afterWebkitLargestResidentBytes,
    row.recoveredWebkitLargestResidentBytes,
  );
}

function rowAppResidentBytes(row) {
  return maxNumber(
    row.appResidentBytes,
    row.afterAppResidentBytes,
    row.recoveredAppResidentBytes,
  );
}

function emptyProviderStats() {
  return {
    preflights: 0,
    plans: 0,
    memoryCooldowns: 0,
    blockedPreflights: 0,
    highPreflights: 0,
    criticalPreflights: 0,
    silentExtractions: 0,
    emptyExtractions: 0,
    authFailures: 0,
    placeholderFailures: 0,
    maxWebkitResidentBytes: 0,
    maxAppResidentBytes: 0,
    lastEventTsMs: 0,
    lastPreflightTsMs: 0,
    lastPlanTsMs: 0,
    lastBlockedPreflightTsMs: 0,
    lastBlockedPreflightPressureLevel: "",
    lastBlockedPreflightWebkitResidentBytes: 0,
    lastMemorySampleAfterBlockedTsMs: 0,
    lastMemorySampleAfterBlockedWebkitResidentBytes: 0,
    minMemorySampleAfterBlockedWebkitResidentBytes: null,
    lastMemorySampleAfterBlockedBackgroundWorkPaused: null,
    lastMemorySampleAfterBlockedPauseReason: "",
    lastMemorySampleAfterBlockedPauseRemainingMs: null,
    lastMemorySampleAfterBlockedSafeModeActive: null,
    lastMemorySampleAfterBlockedActiveJob: null,
    lastMemorySampleAfterBlockedActiveJobAgeMs: null,
    healthPauseActive: false,
    healthPauseUntilMs: null,
    healthPauseReason: "",
    healthLatestAttemptFinishedAtMs: 0,
    healthLatestAttemptOutcome: "",
    healthLatestAttemptStage: "",
    healthLatestAttemptReason: "",
    healthLatestAttemptItemsSeen: null,
    healthLatestAttemptItemsAdded: null,
  };
}

function updateProviderStats(stats, row) {
  stats.maxWebkitResidentBytes = Math.max(stats.maxWebkitResidentBytes, rowWebkitResidentBytes(row));
  stats.maxAppResidentBytes = Math.max(stats.maxAppResidentBytes, rowAppResidentBytes(row));
  stats.lastEventTsMs = Math.max(stats.lastEventTsMs, Number(row.tsMs ?? 0));

  if (row.event === "scrape_memory_preflight") {
    stats.preflights += 1;
    stats.lastPreflightTsMs = Math.max(stats.lastPreflightTsMs, Number(row.tsMs ?? 0));
    const pressureLevel = String(row.pressureLevel ?? "").toLowerCase();
    if (pressureLevel === "high") {
      stats.highPreflights += 1;
    }
    if (pressureLevel === "critical") {
      stats.criticalPreflights += 1;
    }
    if (row.mayProceed === false || pressureLevel === "high" || pressureLevel === "critical") {
      stats.blockedPreflights += 1;
      const tsMs = Number(row.tsMs ?? 0);
      if (tsMs >= stats.lastBlockedPreflightTsMs) {
        stats.lastBlockedPreflightTsMs = tsMs;
        stats.lastBlockedPreflightPressureLevel = pressureLevel;
        stats.lastBlockedPreflightWebkitResidentBytes = rowWebkitResidentBytes(row);
        stats.lastMemorySampleAfterBlockedTsMs = 0;
        stats.lastMemorySampleAfterBlockedWebkitResidentBytes = 0;
        stats.minMemorySampleAfterBlockedWebkitResidentBytes = null;
        stats.lastMemorySampleAfterBlockedBackgroundWorkPaused = null;
        stats.lastMemorySampleAfterBlockedPauseReason = "";
        stats.lastMemorySampleAfterBlockedPauseRemainingMs = null;
        stats.lastMemorySampleAfterBlockedSafeModeActive = null;
        stats.lastMemorySampleAfterBlockedActiveJob = null;
        stats.lastMemorySampleAfterBlockedActiveJobAgeMs = null;
      }
    }
  }

  if (row.event === "social_scrape_plan") {
    stats.plans += 1;
    stats.lastPlanTsMs = Math.max(stats.lastPlanTsMs, Number(row.tsMs ?? 0));
  }

  if (row.event === "background_scraper_memory_cooldown") {
    stats.memoryCooldowns += 1;
  }

  const stage = String(row.stage ?? row.failureStage ?? "").toLowerCase();
  if (stage === "extract_silent") {
    stats.silentExtractions += 1;
  } else if (stage === "extract_empty") {
    stats.emptyExtractions += 1;
  } else if (stage === "auth") {
    stats.authFailures += 1;
  } else if (stage === "placeholder_feed") {
    stats.placeholderFailures += 1;
  }
}

export function summarizeSocialScrapeHealth(healthRows, diagnosticsRows = []) {
  const providers = Object.fromEntries(PROVIDERS.map((provider) => [provider, emptyProviderStats()]));
  const events = new Map();
  let rendererRecoveryAttempts = 0;
  let mainRendererRecoveryVerifications = 0;
  let maxWebkitResidentBytes = 0;
  let maxAppResidentBytes = 0;
  let maxEventLoopLagMs = 0;
  let maxDomNodeCount = 0;
  let lastTsMs = 0;

  const rows = [...healthRows, ...diagnosticsRows].sort((left, right) => {
    const leftTsMs = Number(left.tsMs ?? 0);
    const rightTsMs = Number(right.tsMs ?? 0);
    return leftTsMs - rightTsMs;
  });

  for (const row of rows) {
    const event = String(row.event ?? "unknown");
    events.set(event, (events.get(event) ?? 0) + 1);
    maxWebkitResidentBytes = Math.max(maxWebkitResidentBytes, rowWebkitResidentBytes(row));
    maxAppResidentBytes = Math.max(maxAppResidentBytes, rowAppResidentBytes(row));
    maxEventLoopLagMs = Math.max(maxEventLoopLagMs, Number(row.eventLoopLagMs ?? 0));
    maxDomNodeCount = Math.max(maxDomNodeCount, Number(row.domNodeCount ?? 0));
    lastTsMs = Math.max(lastTsMs, Number(row.tsMs ?? 0));

    if (event === "renderer_recovery_attempt") {
      rendererRecoveryAttempts += 1;
    }
    if (event === "main_renderer_recovery_verification") {
      mainRendererRecoveryVerifications += 1;
    }

    const provider = providerFromRow(row);
    if (provider) {
      updateProviderStats(providers[provider], row);
    }

    if (event === "native_runtime_memory_sample") {
      const tsMs = Number(row.tsMs ?? 0);
      const webkitResidentBytes = rowWebkitResidentBytes(row);
      for (const stats of Object.values(providers)) {
        if (stats.lastBlockedPreflightTsMs <= 0 || tsMs <= stats.lastBlockedPreflightTsMs) {
          continue;
        }

        stats.lastMemorySampleAfterBlockedTsMs = tsMs;
        stats.lastMemorySampleAfterBlockedWebkitResidentBytes = webkitResidentBytes;
        stats.lastMemorySampleAfterBlockedBackgroundWorkPaused =
          typeof row.backgroundWorkPaused === "boolean" ? row.backgroundWorkPaused : null;
        stats.lastMemorySampleAfterBlockedPauseReason = String(row.backgroundPauseReason ?? "");
        stats.lastMemorySampleAfterBlockedPauseRemainingMs =
          Number.isFinite(row.backgroundPauseRemainingMs) ? row.backgroundPauseRemainingMs : null;
        stats.lastMemorySampleAfterBlockedSafeModeActive =
          typeof row.safeModeActive === "boolean" ? row.safeModeActive : null;
        stats.lastMemorySampleAfterBlockedActiveJob = row.activeBackgroundJob ?? null;
        stats.lastMemorySampleAfterBlockedActiveJobAgeMs =
          Number.isFinite(row.activeBackgroundJobAgeMs) ? row.activeBackgroundJobAgeMs : null;
        if (
          stats.minMemorySampleAfterBlockedWebkitResidentBytes === null ||
          webkitResidentBytes < stats.minMemorySampleAfterBlockedWebkitResidentBytes
        ) {
          stats.minMemorySampleAfterBlockedWebkitResidentBytes = webkitResidentBytes;
        }
      }
    }
  }

  return {
    generatedAt: new Date().toISOString(),
    sampleCount: healthRows.length + diagnosticsRows.length,
    eventCounts: Object.fromEntries([...events.entries()].sort(([left], [right]) => left.localeCompare(right))),
    providers,
    rendererRecoveryAttempts,
    mainRendererRecoveryVerifications,
    maxWebkitResidentBytes,
    maxAppResidentBytes,
    maxEventLoopLagMs,
    maxDomNodeCount,
    lastTsMs,
  };
}

export function readJsonFile(filePath) {
  if (!filePath || !existsSync(filePath)) {
    return { exists: false, value: null, parseError: false };
  }

  try {
    return { exists: true, value: JSON.parse(readFileSync(filePath, "utf8")), parseError: false };
  } catch {
    return { exists: true, value: null, parseError: true };
  }
}

function providerHealthRoot(value) {
  if (!value || typeof value !== "object") {
    return null;
  }
  return value["provider-health"] && typeof value["provider-health"] === "object"
    ? value["provider-health"]
    : value;
}

function sortedHealthAttempts(state) {
  const attempts = Array.isArray(state?.latestAttempts) ? state.latestAttempts : [];
  return attempts
    .filter((attempt) => attempt && typeof attempt === "object")
    .sort((left, right) => Number(right.finishedAt ?? 0) - Number(left.finishedAt ?? 0));
}

export function applyProviderHealthStore(summary, providerHealthValue, nowMs = Date.now()) {
  const root = providerHealthRoot(providerHealthValue);
  const providerStates = root?.providers && typeof root.providers === "object" ? root.providers : {};

  for (const provider of PROVIDERS) {
    const state = providerStates[provider];
    const stats = summary.providers[provider];
    if (!state || !stats) {
      continue;
    }

    const pause = state.pause && typeof state.pause === "object" ? state.pause : null;
    const pausedUntil = Number(pause?.pausedUntil ?? NaN);
    stats.healthPauseActive = Number.isFinite(pausedUntil) && pausedUntil > nowMs;
    stats.healthPauseUntilMs = Number.isFinite(pausedUntil) ? pausedUntil : null;
    stats.healthPauseReason = String(pause?.pauseReason ?? "");

    const latestAttempt = sortedHealthAttempts(state)[0];
    if (!latestAttempt) {
      continue;
    }

    stats.healthLatestAttemptFinishedAtMs = Number(latestAttempt.finishedAt ?? 0);
    stats.healthLatestAttemptOutcome = String(latestAttempt.outcome ?? "");
    stats.healthLatestAttemptStage = String(latestAttempt.stage ?? "");
    stats.healthLatestAttemptReason = String(latestAttempt.reason ?? "");
    stats.healthLatestAttemptItemsSeen = Number.isFinite(latestAttempt.itemsSeen)
      ? latestAttempt.itemsSeen
      : null;
    stats.healthLatestAttemptItemsAdded = Number.isFinite(latestAttempt.itemsAdded)
      ? latestAttempt.itemsAdded
      : null;
  }

  return summary;
}

function priority(level) {
  return {
    critical: 100,
    high: 75,
    medium: 50,
    low: 25,
  }[level] ?? 0;
}

function addAction(actions, action) {
  actions.push({
    ...action,
    priorityScore: priority(action.priority),
  });
}

function formatDurationMs(ms) {
  if (!Number.isFinite(ms) || ms <= 0) {
    return "0s";
  }
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) {
    return `${numberFormatter.format(seconds)}s`;
  }
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) {
    return `${numberFormatter.format(minutes)}m`;
  }
  const hours = Math.round(minutes / 60);
  return `${numberFormatter.format(hours)}h`;
}

function postBlockRuntimeEvidence(stats) {
  if (stats.lastMemorySampleAfterBlockedTsMs <= 0) {
    return "";
  }

  const pieces = [];
  if (stats.lastMemorySampleAfterBlockedBackgroundWorkPaused === true) {
    const reason = stats.lastMemorySampleAfterBlockedPauseReason || "unknown";
    const remaining = stats.lastMemorySampleAfterBlockedPauseRemainingMs === null
      ? ""
      : ` for ${formatDurationMs(stats.lastMemorySampleAfterBlockedPauseRemainingMs)}`;
    pieces.push(`background work was still paused by ${reason}${remaining}`);
  } else if (stats.lastMemorySampleAfterBlockedBackgroundWorkPaused === false) {
    pieces.push("background work was not paused");
  }

  if (stats.lastMemorySampleAfterBlockedSafeModeActive === true) {
    pieces.push("safe mode was active");
  } else if (stats.lastMemorySampleAfterBlockedSafeModeActive === false) {
    pieces.push("safe mode was not active");
  }

  if (stats.lastMemorySampleAfterBlockedActiveJob) {
    const age = stats.lastMemorySampleAfterBlockedActiveJobAgeMs === null
      ? ""
      : ` for ${formatDurationMs(stats.lastMemorySampleAfterBlockedActiveJobAgeMs)}`;
    pieces.push(`${stats.lastMemorySampleAfterBlockedActiveJob} was active${age}`);
  } else {
    pieces.push("no background job was active");
  }

  return pieces.length > 0 ? ` Latest post-block runtime sample: ${pieces.join(", ")}.` : "";
}

function compactReason(reason) {
  const normalized = String(reason ?? "").replace(/\s+/g, " ").trim();
  const trimmed = normalized.length <= 180
    ? normalized
    : `${normalized.slice(0, 177)}...`;
  if (trimmed.endsWith(".") && !trimmed.endsWith("...")) {
    return trimmed.slice(0, -1);
  }
  return trimmed;
}

function providerHealthEvidence(stats) {
  const pieces = [];
  if (stats.healthPauseActive) {
    const remaining = stats.healthPauseUntilMs === null
      ? ""
      : ` until ${new Date(stats.healthPauseUntilMs).toISOString()}`;
    const reason = stats.healthPauseReason ? `, reason: ${compactReason(stats.healthPauseReason)}` : "";
    pieces.push(`provider health is actively paused${remaining}${reason}`);
  } else if (stats.healthPauseUntilMs !== null || stats.healthLatestAttemptFinishedAtMs > 0) {
    pieces.push("provider health is not actively paused");
  }

  if (stats.healthLatestAttemptFinishedAtMs > 0) {
    const outcome = stats.healthLatestAttemptOutcome || "unknown";
    const stage = stats.healthLatestAttemptStage ? ` stage ${stats.healthLatestAttemptStage}` : "";
    const reason = stats.healthLatestAttemptReason
      ? `, reason: ${compactReason(stats.healthLatestAttemptReason)}`
      : "";
    pieces.push(`latest provider-health attempt was ${outcome}${stage}${reason}`);
  }

  return pieces.length > 0 ? ` Provider-health state: ${pieces.join("; ")}.` : "";
}

function latestProviderHealthAttemptIsMemoryRelated(stats) {
  const haystack = `${stats.healthLatestAttemptStage} ${stats.healthLatestAttemptReason}`.toLowerCase();
  return (
    stats.healthLatestAttemptOutcome === "error" &&
    (haystack.includes("memory") || haystack.includes("webkit") || haystack.includes("rss"))
  );
}

export function buildOptimizationPlan(summary, { memoryBudgetGib = 4 } = {}) {
  const actions = [];
  const blockedProviderRisk = [];
  const memoryBudgetBytes = memoryBudgetGib * GIB;
  const totalCooldowns = Object.values(summary.providers)
    .reduce((sum, provider) => sum + provider.memoryCooldowns, 0);
  const totalBlockedPreflights = Object.values(summary.providers)
    .reduce((sum, provider) => sum + provider.blockedPreflights, 0);

  if (summary.maxWebkitResidentBytes >= memoryBudgetBytes) {
    addAction(actions, {
      id: "local-memory-preflight",
      priority: "critical",
      scope: "local-only",
      title: "Keep WebKit memory gates and renderer recovery ahead of provider work.",
      evidence: `Peak WebKit RSS was ${formatBytes(summary.maxWebkitResidentBytes)} against a ${formatBytes(memoryBudgetBytes)} loop budget.`,
      nextStep: "Inspect recent scrape_memory_preflight and renderer_recovery_attempt events, then improve local cleanup or cooldown clearing without adding provider traffic.",
    });
  }

  if (totalCooldowns > 0 || totalBlockedPreflights > 0) {
    const recoveredProviders = Object.values(summary.providers)
      .filter((provider) => (
        provider.lastBlockedPreflightTsMs > 0 &&
        provider.minMemorySampleAfterBlockedWebkitResidentBytes !== null &&
        provider.minMemorySampleAfterBlockedWebkitResidentBytes < memoryBudgetBytes
      )).length;
    const blockedEvidence = recoveredProviders > 0
      ? `${numberFormatter.format(totalCooldowns)} cooldowns and ${numberFormatter.format(totalBlockedPreflights)} blocked preflights were observed; ${numberFormatter.format(recoveredProviders)} provider${recoveredProviders === 1 ? "" : "s"} later had WebKit RSS recover under the loop budget.`
      : `${numberFormatter.format(totalCooldowns)} cooldowns and ${numberFormatter.format(totalBlockedPreflights)} blocked preflights were observed.`;
    addAction(actions, {
      id: "cooldown-recovery",
      priority: "high",
      scope: "local-only",
      title: "Verify memory cooldowns clear as soon as memory returns to normal.",
      evidence: blockedEvidence,
      nextStep: "Use the report's post-block memory samples to prove whether a provider pause is stale before changing provider cadence.",
    });
  }

  for (const [provider, stats] of Object.entries(summary.providers)) {
    const label = PROVIDER_LABELS[provider];
    if (stats.silentExtractions > 0) {
      addAction(actions, {
        id: `${provider}-silent-extraction`,
        priority: "high",
        scope: "local-only",
        title: `Tighten ${label} extractor diagnostics for silent rendered pages.`,
        evidence: `${label} recorded ${numberFormatter.format(stats.silentExtractions)} silent extraction failures.`,
        nextStep: "Add DOM fixture coverage that distinguishes no events from no posts, then update the parser or failure stage mapping.",
      });
    }

    if (stats.authFailures > 0) {
      addAction(actions, {
        id: `${provider}-auth-state`,
        priority: "medium",
        scope: "local-only",
        title: `Keep ${label} auth failures recoverable and explicit.`,
        evidence: `${label} recorded ${numberFormatter.format(stats.authFailures)} auth-stage failures.`,
        nextStep: "Check auth cookie diagnostics and settings copy without changing login window cadence.",
      });
    }

    if (
      stats.plans > 0 &&
      stats.lastBlockedPreflightTsMs > 0 &&
      stats.lastPlanTsMs < stats.lastBlockedPreflightTsMs &&
      stats.minMemorySampleAfterBlockedWebkitResidentBytes !== null &&
      stats.minMemorySampleAfterBlockedWebkitResidentBytes < memoryBudgetBytes
    ) {
      addAction(actions, {
        id: `${provider}-recovered-without-later-plan`,
        priority: "high",
        scope: "local-only",
        title: `Find why ${label} did not plan another scrape after memory recovered.`,
        evidence: `${label} last blocked at ${stats.lastBlockedPreflightPressureLevel || "unknown"} memory pressure, later WebKit RSS reached ${formatBytes(stats.minMemorySampleAfterBlockedWebkitResidentBytes)}, but no later scrape plan was recorded.${postBlockRuntimeEvidence(stats)}${providerHealthEvidence(stats)}`,
        nextStep: "Inspect local scheduler pause, cooldown, and trigger state after recovery before changing provider cadence.",
      });
    }

    if (
      stats.lastBlockedPreflightTsMs > 0 &&
      stats.minMemorySampleAfterBlockedWebkitResidentBytes !== null &&
      stats.minMemorySampleAfterBlockedWebkitResidentBytes < memoryBudgetBytes &&
      stats.lastMemorySampleAfterBlockedBackgroundWorkPaused === false &&
      stats.lastMemorySampleAfterBlockedSafeModeActive === false &&
      !stats.lastMemorySampleAfterBlockedActiveJob &&
      !stats.healthPauseActive &&
      latestProviderHealthAttemptIsMemoryRelated(stats)
    ) {
      addAction(actions, {
        id: `${provider}-stale-memory-health-after-recovery`,
        priority: "high",
        scope: "local-only",
        title: `Clear up stale ${label} memory health after runtime recovery.`,
        evidence: `${label} recovered under the memory budget and the scheduler was idle, but the latest provider-health attempt is still ${stats.healthLatestAttemptStage || "memory"}: ${compactReason(stats.healthLatestAttemptReason)}.`,
        nextStep: "Audit local health projection and retry bookkeeping. Do not enqueue extra provider traffic without explicit approval.",
      });
    }

    if (stats.preflights === 0) {
      addAction(actions, {
        id: `${provider}-missing-coverage`,
        priority: "medium",
        scope: "local-only",
        title: `Collect ${label} coverage evidence before tuning scraper behavior.`,
        evidence: `${label} had no scrape preflights in the analyzed window.`,
        nextStep: "Add passive health reporting or fixture coverage first. Do not synthesize provider requests just to fill the metric.",
      });
    } else if (stats.plans === 0) {
      const recoveryEvidence = stats.lastBlockedPreflightTsMs > 0 && stats.minMemorySampleAfterBlockedWebkitResidentBytes !== null
        ? ` Lowest WebKit RSS after the last blocked preflight was ${formatBytes(stats.minMemorySampleAfterBlockedWebkitResidentBytes)}.`
        : "";
      addAction(actions, {
        id: `${provider}-preflight-without-plan`,
        priority: "high",
        scope: "local-only",
        title: `Explain why ${label} preflights do not become scrape plans.`,
        evidence: `${label} had ${numberFormatter.format(stats.preflights)} preflights and no recorded scrape plans.${recoveryEvidence}${providerHealthEvidence(stats)}`,
        nextStep: "Inspect local deferral and pause state after the latest preflight before changing provider cadence.",
      });
    }
  }

  blockedProviderRisk.push(
    {
      id: "extra-feed-navigation",
      providers: ["Facebook", "Instagram", "LinkedIn", "X"],
      behavior: "Extra authenticated feed loads or refreshes.",
      whyRisky: "Providers can observe repeated navigation cadence and associate it with automation.",
      lowestProfileAlternative: "Use local preflight cleanup, passive log analysis, and manual Sync Now while reviewing risk.",
    },
    {
      id: "scripted-scroll-click-recovery",
      providers: ["Facebook", "Instagram", "LinkedIn", "X"],
      behavior: "Scripted scrolling, clicking, retrying, or story traversal to force more coverage.",
      whyRisky: "Interaction timing, depth, and path can become a stable fingerprint.",
      lowestProfileAlternative: "Replay saved DOM fixtures and provider exports, then gate any live traversal behind explicit approval.",
    },
    {
      id: "media-comment-hydration",
      providers: ["Facebook", "Instagram", "LinkedIn", "X"],
      behavior: "Automatic media preload, comment hydration, reply expansion, or profile backfill.",
      whyRisky: "It increases request volume and touches routes normal users may not visit in that sequence.",
      lowestProfileAlternative: "Capture only already-rendered feed content and report missing fields as local diagnostics.",
    },
  );

  return {
    actions: actions.sort((left, right) => right.priorityScore - left.priorityScore || left.id.localeCompare(right.id)),
    blockedProviderRisk,
  };
}

export function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return "0 B";
  }
  if (bytes >= GIB) {
    return `${numberFormatter.format(bytes / GIB)} GiB`;
  }
  const mib = 1024 * 1024;
  if (bytes >= mib) {
    return `${numberFormatter.format(bytes / mib)} MiB`;
  }
  return `${numberFormatter.format(bytes)} B`;
}

export function formatTextReport(report) {
  const lines = [];
  lines.push("Freed social scrape loop report");
  lines.push(`Generated: ${report.summary.generatedAt}`);
  lines.push(`Samples: ${numberFormatter.format(report.summary.sampleCount)}`);
  lines.push(`Peak app RSS: ${formatBytes(report.summary.maxAppResidentBytes)}`);
  lines.push(`Peak WebKit RSS: ${formatBytes(report.summary.maxWebkitResidentBytes)}`);
  lines.push(`Renderer recovery attempts: ${numberFormatter.format(report.summary.rendererRecoveryAttempts)}`);
  lines.push("");
  lines.push("Provider coverage:");
  for (const [provider, stats] of Object.entries(report.summary.providers)) {
    const recovery = stats.lastBlockedPreflightTsMs > 0
      ? `, post-block min WebKit ${formatBytes(stats.minMemorySampleAfterBlockedWebkitResidentBytes)}`
      : "";
    lines.push(
      `- ${PROVIDER_LABELS[provider]}: ${numberFormatter.format(stats.preflights)} preflights, ${numberFormatter.format(stats.plans)} plans, ${numberFormatter.format(stats.memoryCooldowns)} cooldowns, peak WebKit ${formatBytes(stats.maxWebkitResidentBytes)}${recovery}`,
    );
  }
  lines.push("");
  lines.push("Next local-only actions:");
  for (const action of report.plan.actions.slice(0, 8)) {
    lines.push(`- [${action.priority}] ${action.title}`);
    lines.push(`  Evidence: ${action.evidence}`);
    lines.push(`  Next: ${action.nextStep}`);
  }
  lines.push("");
  lines.push("Provider-visible decisions still blocked:");
  for (const risk of report.plan.blockedProviderRisk) {
    lines.push(`- ${risk.id}: ${risk.behavior}`);
  }
  return lines.join("\n");
}

export function buildReport(args) {
  const health = readJsonl(args.healthLog, { tail: args.tail });
  const diagnostics = readJsonl(args.diagnosticsLog, { tail: args.tail });
  const providerHealth = readJsonFile(args.providerHealth);
  const summary = applyProviderHealthStore(
    summarizeSocialScrapeHealth(health.rows, diagnostics.rows),
    providerHealth.value,
  );
  const plan = buildOptimizationPlan(summary, { memoryBudgetGib: args.memoryBudgetGib });
  return {
    inputs: {
      healthLog: args.healthLog,
      diagnosticsLog: args.diagnosticsLog,
      providerHealth: args.providerHealth,
      healthLogExists: health.exists,
      diagnosticsLogExists: diagnostics.exists,
      providerHealthExists: providerHealth.exists,
      healthParseErrors: health.parseErrors,
      diagnosticsParseErrors: diagnostics.parseErrors,
      providerHealthParseError: providerHealth.parseError,
      tail: args.tail,
      memoryBudgetGib: args.memoryBudgetGib,
      lockPath: args.lockPath,
    },
    summary,
    plan,
  };
}

function writeReport(filePath, report) {
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(report, null, 2)}\n`);
}

function runOnce(args) {
  const report = buildReport(args);
  if (args.write) {
    writeReport(args.output, report);
  }
  if (args.json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(formatTextReport(report));
    if (args.write) {
      console.log("");
      console.log(`Wrote ${args.output}`);
    }
  }
  return report;
}

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function printLockResult(result, { json = false, action = "claim" } = {}) {
  const payload = {
    action,
    ...result,
  };
  if (json) {
    console.log(JSON.stringify(payload, null, 2));
    return;
  }

  if (action === "release") {
    console.log(result.released ? "Released social scrape loop lock." : `Did not release social scrape loop lock: ${result.reason}.`);
    return;
  }

  if (result.acquired) {
    console.log(`Acquired social scrape loop lock: ${result.token}`);
    return;
  }

  const existing = result.existing?.createdAt ? ` Existing lock created at ${result.existing.createdAt}.` : "";
  console.log(`Social scrape loop already running. Skipping this pass.${existing}`);
}

async function runWithProcessLock(args) {
  const lock = acquireRunLock({
    lockPath: args.lockPath,
    staleMs: args.lockStaleMinutes * 60 * 1000,
  });
  if (!lock.acquired) {
    printLockResult(lock, { json: args.json });
    return;
  }

  try {
    if (!args.watch) {
      runOnce(args);
      return;
    }

    const intervalMs = args.intervalMinutes * 60 * 1000;
    while (true) {
      runOnce(args);
      await sleep(intervalMs);
    }
  } finally {
    releaseRunLock({ lockPath: args.lockPath, token: lock.token });
  }
}

export async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  if (args.help) {
    console.log(usage());
    return;
  }

  if (args.releaseLockToken) {
    printLockResult(
      releaseRunLock({ lockPath: args.lockPath, token: args.releaseLockToken }),
      { json: args.json, action: "release" },
    );
    return;
  }

  if (args.claimLock) {
    printLockResult(
      acquireRunLock({
        lockPath: args.lockPath,
        staleMs: args.lockStaleMinutes * 60 * 1000,
      }),
      { json: args.json },
    );
    return;
  }

  if (args.lock) {
    await runWithProcessLock(args);
    return;
  }

  if (!args.watch) {
    runOnce(args);
    return;
  }

  const intervalMs = args.intervalMinutes * 60 * 1000;
  while (true) {
    runOnce(args);
    await sleep(intervalMs);
  }
}

const invokedAsScript = process.argv[1]
  ? import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
  : false;

if (invokedAsScript) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
