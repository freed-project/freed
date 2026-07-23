#!/usr/bin/env node
/**
 * replay-watchdog.mjs (stability W2-03)
 *
 * Re-runs the main-renderer memory recovery decision against recorded
 * native_runtime_memory_sample traces, so watchdog constant changes become a
 * pre-merge check instead of a shipped experiment (the #847/#850 flip-flop).
 *
 * The decision logic mirrors the pure Rust functions in
 * packages/desktop/src-tauri/src/lib.rs (main_renderer_memory_recovery_reason
 * and helpers). Constants are PARSED from the Rust source at run time — not
 * hardcoded here — so `--source` / `--compare-source` evaluate a trace under
 * the constants of two real code versions, and `--override NAME=VALUE` models
 * a proposed threshold without editing anything.
 *
 * Drift guard: the JS mirror is fixture-tested against a decision the shipped
 * watchdog actually made (scripts/fixtures/watchdog-trace.jsonl, recorded
 * 2026-07-05 around a real watchdog_memory kill). If the Rust logic changes
 * shape (not just constants), update the mirror and the fixture together.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const REPO_ROOT = path.resolve(path.dirname(__filename), "..");
const DEFAULT_RUST_SOURCE = path.join(
  REPO_ROOT,
  "packages/desktop/src-tauri/src/lib.rs",
);

// Names the decision mirror needs. Parsed generically so renames fail loudly.
const REQUIRED_CONSTANTS = [
  "BYTES_PER_GIB",
  "SCRAPE_MEMORY_HEADROOM_BYTES",
  "MAIN_RENDERER_MEMORY_RECOVERY_MIN_AGE_SECONDS",
  "MAIN_RENDERER_IDLE_WEBKIT_RESIDENT_RECOVERY_BYTES",
  "MAIN_RENDERER_HOT_WEBKIT_RESIDENT_RECOVERY_BYTES",
  "MAIN_RENDERER_HOT_WEBKIT_FOOTPRINT_RECOVERY_BYTES",
  "MAIN_RENDERER_HOT_WEBKIT_CPU_RECOVERY_PERCENT",
  "WEBKIT_PROCESS_START_GRACE_SECONDS",
];

/**
 * Parse `const NAME: <type> = <expr>;` declarations from Rust source and
 * evaluate simple arithmetic (integers, + - * /, parens, references to
 * previously parsed constants, Duration::from_secs(n)).
 */
export function parseWatchdogConstants(rustSource) {
  const constants = {};
  const declaration = /const\s+([A-Z][A-Z0-9_]*)\s*:\s*[A-Za-z0-9_:<>\s]+=\s*([^;]+);/g;
  for (const match of rustSource.matchAll(declaration)) {
    const [, name, rawExpr] = match;
    const value = evaluateRustConstExpr(rawExpr.trim(), constants);
    if (value !== null) constants[name] = value;
  }
  const missing = REQUIRED_CONSTANTS.filter((name) => !(name in constants));
  if (missing.length > 0) {
    throw new Error(
      `Rust source is missing expected watchdog constants: ${missing.join(", ")}. ` +
        "The decision logic may have moved — update replay-watchdog.mjs alongside it.",
    );
  }
  return constants;
}

function evaluateRustConstExpr(expr, known) {
  let normalized = expr
    .replace(/Duration::from_secs\(([^)]+)\)/g, "($1) * 1000")
    .replace(/Duration::from_millis\(([^)]+)\)/g, "($1)")
    .replace(/_/g, "")
    .replace(/([0-9.]+)\s*(?:u64|u32|usize|f32|f64|i64|i32)/g, "$1");
  normalized = normalized.replace(/\b([A-Z][A-Z0-9]*)\b/g, (name) => {
    // Constant names lose underscores above; match against squashed keys.
    for (const [key, value] of Object.entries(known)) {
      if (key.replace(/_/g, "") === name) return String(value);
    }
    return "NaN";
  });
  if (!/^[\d\s+\-*/().NaN]+$/.test(normalized)) return null;
  try {
    const value = Function(`"use strict"; return (${normalized});`)();
    return Number.isFinite(value) ? value : null;
  } catch {
    return null;
  }
}

/** Map a native_runtime_memory_sample JSONL record to RuntimeMemoryStats. */
export function statsFromSample(sample) {
  return {
    appResidentBytes: sample.appResidentBytes ?? 0,
    appMemoryPressureBytes: sample.appMemoryPressureBytes ?? 0,
    webkitTotalResidentBytes: sample.webkitResidentBytes ?? 0,
    webkitTotalFootprintBytes: sample.webkitFootprintBytes ?? null,
    webkitLargestResidentBytes: sample.webkitLargestResidentBytes ?? null,
    webkitLargestFootprintBytes: sample.webkitLargestFootprintBytes ?? null,
    webkitLargestCpuUsage: sample.webkitLargestCpuUsage ?? null,
    webkitLargestAgeSeconds: sample.webkitLargestAgeSeconds ?? null,
    webkitLargestRole: sample.webkitLargestRole ?? null,
    webkitTelemetryAvailable: sample.webkitTelemetryAvailable ?? false,
    memoryHighBytes: sample.memoryHighBytes ?? 0,
    memoryCriticalBytes: sample.memoryCriticalBytes ?? 0,
  };
}

function rendererIsEffectivelyVisible(isVisible, lastVisibility) {
  return isVisible && lastVisibility !== "hidden";
}

function webkitProcessMatchesRendererUptime(webkitAgeSeconds, rendererUptimeMs, constants) {
  if (webkitAgeSeconds === null || rendererUptimeMs === null || rendererUptimeMs === undefined) {
    return false;
  }
  const rendererAgeSeconds = Math.floor(rendererUptimeMs / 1000);
  return Math.abs(webkitAgeSeconds - rendererAgeSeconds) <=
    constants.WEBKIT_PROCESS_START_GRACE_SECONDS;
}

function scrapeMemoryStartBudgetBytes(stats, constants) {
  return Math.max(0, stats.memoryHighBytes - constants.SCRAPE_MEMORY_HEADROOM_BYTES);
}

export function webkitResidentTailIsProbablyReclaimable(stats, constants) {
  if (!stats.webkitTelemetryAvailable) return false;
  if (stats.webkitTotalFootprintBytes === null) return false;
  if (stats.webkitTotalResidentBytes <= stats.webkitTotalFootprintBytes) return false;
  const tailBytes = stats.webkitTotalResidentBytes - stats.webkitTotalFootprintBytes;
  const largestCpu = stats.webkitLargestCpuUsage ?? 0;
  return (
    stats.appMemoryPressureBytes < scrapeMemoryStartBudgetBytes(stats, constants) &&
    stats.appResidentBytes <
      Math.max(0, stats.memoryCriticalBytes - constants.SCRAPE_MEMORY_HEADROOM_BYTES) &&
    tailBytes >= constants.BYTES_PER_GIB &&
    largestCpu <= 10.0
  );
}

function hotWebkitActivityShouldRecover(stats, constants) {
  const residentHot =
    stats.webkitLargestResidentBytes !== null &&
    stats.webkitLargestResidentBytes >= constants.MAIN_RENDERER_HOT_WEBKIT_RESIDENT_RECOVERY_BYTES;
  const footprintHot =
    stats.webkitLargestFootprintBytes !== null &&
    stats.webkitLargestFootprintBytes >= constants.MAIN_RENDERER_HOT_WEBKIT_FOOTPRINT_RECOVERY_BYTES;
  const cpuHot =
    stats.webkitLargestCpuUsage !== null &&
    stats.webkitLargestCpuUsage >= constants.MAIN_RENDERER_HOT_WEBKIT_CPU_RECOVERY_PERCENT;
  const belowHighLimit =
    stats.webkitLargestResidentBytes !== null &&
    stats.webkitLargestResidentBytes < stats.memoryHighBytes;
  return residentHot && footprintHot && cpuHot && belowHighLimit;
}

function idleResidentTailShouldRecover(stats, constants) {
  if (!webkitResidentTailIsProbablyReclaimable(stats, constants)) return false;
  const residentHot =
    stats.webkitLargestResidentBytes !== null &&
    stats.webkitLargestResidentBytes >= constants.MAIN_RENDERER_IDLE_WEBKIT_RESIDENT_RECOVERY_BYTES;
  const cpuIdle = (stats.webkitLargestCpuUsage ?? null) === null || stats.webkitLargestCpuUsage <= 10.0;
  return residentHot && cpuIdle;
}

function visibleResidentTailShouldRecover(stats, constants) {
  if (!webkitResidentTailIsProbablyReclaimable(stats, constants)) return false;
  const overHigh =
    stats.webkitLargestResidentBytes !== null &&
    stats.webkitLargestResidentBytes >= stats.memoryHighBytes;
  const cpuIdle = (stats.webkitLargestCpuUsage ?? null) === null || stats.webkitLargestCpuUsage <= 10.0;
  return overHigh && cpuIdle;
}

/**
 * Mirror of main_renderer_memory_recovery_reason (lib.rs). Returns the reason
 * string the watchdog would log, or null for "leave the renderer alone".
 */
export function mainRendererMemoryRecoveryReason(stats, context, constants) {
  const { isVisible, lastVisibility, rendererUptimeMs = null } = context;
  const effectivelyVisible = rendererIsEffectivelyVisible(isVisible, lastVisibility);

  const role = stats.webkitLargestRole;
  if (role === "freed-webcontent") {
    // eligible
  } else if (
    role === "freed-webcontent-age-matched" &&
    webkitProcessMatchesRendererUptime(stats.webkitLargestAgeSeconds, rendererUptimeMs, constants)
  ) {
    // eligible
  } else {
    return null;
  }

  if (
    stats.webkitLargestAgeSeconds === null ||
    stats.webkitLargestAgeSeconds < constants.MAIN_RENDERER_MEMORY_RECOVERY_MIN_AGE_SECONDS
  ) {
    return null;
  }

  const mainWebkitPressureBytes =
    stats.webkitLargestFootprintBytes ?? stats.webkitLargestResidentBytes ?? 0;
  if (mainWebkitPressureBytes >= stats.memoryHighBytes) {
    return effectivelyVisible ? "webkit_footprint_pressure" : "idle_webkit_footprint_pressure";
  }

  if (hotWebkitActivityShouldRecover(stats, constants)) {
    return effectivelyVisible ? "webkit_hot_active_pressure" : "idle_webkit_hot_active_pressure";
  }

  if (!effectivelyVisible && idleResidentTailShouldRecover(stats, constants)) {
    return "idle_webkit_resident_tail";
  }

  if (effectivelyVisible && visibleResidentTailShouldRecover(stats, constants)) {
    return "webkit_resident_tail";
  }

  if (
    stats.webkitLargestResidentBytes !== null &&
    stats.webkitLargestResidentBytes >= stats.memoryHighBytes &&
    !webkitResidentTailIsProbablyReclaimable(stats, constants)
  ) {
    return effectivelyVisible ? "webkit_hot_resident_pressure" : "idle_webkit_hot_resident_pressure";
  }

  return null;
}

/** Replay every sample in a trace under one constants variant. */
export function replayTrace(traceLines, constants, contextDefaults = {}) {
  const decisions = [];
  const byReason = {};
  for (const { entry, line } of traceLines) {
    if (entry.event !== "native_runtime_memory_sample") continue;
    const context = {
      isVisible: contextDefaults.isVisible ?? entry.lastVisibility === "visible",
      lastVisibility: contextDefaults.lastVisibility ?? entry.lastVisibility ?? "unknown",
      rendererUptimeMs: contextDefaults.rendererUptimeMs ?? null,
    };
    const reason = mainRendererMemoryRecoveryReason(statsFromSample(entry), context, constants);
    decisions.push({ line, tsMs: entry.tsMs ?? null, reason });
    if (reason) byReason[reason] = (byReason[reason] ?? 0) + 1;
  }
  return {
    samples: decisions.length,
    recoveries: decisions.filter((d) => d.reason !== null).length,
    byReason,
    decisions,
  };
}

export function readTraceLines(tracePath) {
  const lines = [];
  const text = readFileSync(tracePath, "utf8");
  text.split("\n").forEach((raw, index) => {
    if (!raw.trim()) return;
    try {
      lines.push({ entry: JSON.parse(raw), line: index + 1 });
    } catch {
      // Ignore malformed lines, matching soak-assert's reader.
    }
  });
  return lines;
}

function usage() {
  return `Usage:
  node scripts/replay-watchdog.mjs --trace <runtime-health.jsonl> [options]

Options:
  --trace <path>            Trace of native_runtime_memory_sample lines. Required.
  --source <lib.rs>         Rust source to parse constants from. Defaults to the repo lib.rs.
  --compare-source <lib.rs> Second source; reports where the two variants diverge.
  --override NAME=VALUE     Override a constant (repeatable; applies to the compare variant,
                            or to the base when no --compare-source is given with --compare).
  --visible | --hidden      Force renderer visibility instead of the trace's lastVisibility.
  --uptime-ms <n>           Renderer uptime for age-matched role checks.
  --json                    Print the full result as JSON.
  --fail-on-divergence      Exit 1 when the variants disagree on any sample.
  --help                    Show this help.
`;
}

export function parseArgs(argv) {
  const args = {
    trace: null,
    source: DEFAULT_RUST_SOURCE,
    compareSource: null,
    overrides: {},
    visibility: null,
    uptimeMs: null,
    json: false,
    failOnDivergence: false,
    help: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--trace") args.trace = argv[++i];
    else if (arg === "--source") args.source = argv[++i];
    else if (arg === "--compare-source") args.compareSource = argv[++i];
    else if (arg === "--override") {
      const [name, value] = String(argv[++i]).split("=");
      args.overrides[name] = Number(value);
    } else if (arg === "--visible") args.visibility = "visible";
    else if (arg === "--hidden") args.visibility = "hidden";
    else if (arg === "--uptime-ms") args.uptimeMs = Number(argv[++i]);
    else if (arg === "--json") args.json = true;
    else if (arg === "--fail-on-divergence") args.failOnDivergence = true;
    else if (arg === "--help" || arg === "-h") args.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return args;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || !args.trace) {
    process.stdout.write(usage());
    process.exitCode = args.help ? 0 : 1;
    return;
  }

  const baseConstants = parseWatchdogConstants(readFileSync(args.source, "utf8"));
  const trace = readTraceLines(path.resolve(args.trace));
  const contextDefaults = {};
  if (args.visibility) {
    contextDefaults.isVisible = args.visibility === "visible";
    contextDefaults.lastVisibility = args.visibility;
  }
  if (args.uptimeMs !== null) contextDefaults.rendererUptimeMs = args.uptimeMs;

  const hasVariant = args.compareSource !== null || Object.keys(args.overrides).length > 0;
  const variantConstants = hasVariant
    ? {
        ...(args.compareSource
          ? parseWatchdogConstants(readFileSync(args.compareSource, "utf8"))
          : baseConstants),
        ...args.overrides,
      }
    : null;

  const base = replayTrace(trace, baseConstants, contextDefaults);
  const result = { base: summarize(base) };
  let divergences = [];
  if (variantConstants) {
    const variant = replayTrace(trace, variantConstants, contextDefaults);
    result.variant = summarize(variant);
    divergences = base.decisions
      .map((decision, index) => ({
        line: decision.line,
        tsMs: decision.tsMs,
        base: decision.reason,
        variant: variant.decisions[index]?.reason ?? null,
      }))
      .filter((row) => row.base !== row.variant);
    result.divergences = divergences.slice(0, 25);
    result.divergenceCount = divergences.length;
  }

  if (args.json) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } else {
    process.stdout.write(
      `base: ${base.samples} samples, ${base.recoveries} recoveries ${JSON.stringify(base.byReason)}\n`,
    );
    if (result.variant) {
      process.stdout.write(
        `variant: ${result.variant.samples} samples, ${result.variant.recoveries} recoveries ${JSON.stringify(result.variant.byReason)}\n`,
      );
      process.stdout.write(`divergences: ${result.divergenceCount}\n`);
      for (const row of result.divergences) {
        process.stdout.write(
          `  line ${row.line} tsMs=${row.tsMs}: base=${row.base ?? "none"} variant=${row.variant ?? "none"}\n`,
        );
      }
    }
  }
  if (args.failOnDivergence && divergences.length > 0) process.exitCode = 1;
}

function summarize(replay) {
  return { samples: replay.samples, recoveries: replay.recoveries, byReason: replay.byReason };
}

if (process.argv[1] === __filename) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
