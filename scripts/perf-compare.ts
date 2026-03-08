#!/usr/bin/env tsx
/**
 * scripts/perf-compare.ts
 *
 * Compares the latest perf-results.json against perf-baselines.json.
 * Prints a markdown table of before/after/delta for every metric.
 * Exits non-zero if any metric regresses beyond its tolerance threshold.
 *
 * Usage:
 *   npx tsx scripts/perf-compare.ts [results] [baselines] [budgets]
 *   (all paths default to their standard locations below)
 *
 * Environment:
 *   PERF_TOLERANCE  — override default regression tolerance (0.20 = 20%)
 *   CI              — if set, annotates GitHub Actions with warning/error
 */

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const REPO_ROOT = new URL("..", import.meta.url).pathname;
const DEFAULT_RESULTS   = join(REPO_ROOT, "packages/desktop/playwright-report/perf-results.json");
const DEFAULT_BASELINES = join(REPO_ROOT, "packages/desktop/tests/e2e/perf-baselines.json");
const DEFAULT_BUDGETS   = join(REPO_ROOT, "packages/desktop/tests/e2e/perf-budgets.json");
const DEFAULT_TOLERANCE = parseFloat(process.env.PERF_TOLERANCE ?? "0.20");

const resultsPath  = process.argv[2] ?? DEFAULT_RESULTS;
const baselinesPath = process.argv[3] ?? DEFAULT_BASELINES;
const budgetsPath  = process.argv[4] ?? DEFAULT_BUDGETS;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface PerfMetric {
  name: string;
  value: number;
  unit: string;
  scenario: string;
}

interface PerfResults {
  timestamp: string;
  gitSha: string;
  gitBranch: string;
  metrics: PerfMetric[];
}

interface Baselines {
  generatedAt: string;
  gitSha: string;
  metrics: Record<string, { value: number; unit: string }>;
}

interface BudgetEntry {
  max: number;
  tolerance: number;
}

type Budgets = Record<string, BudgetEntry>;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function loadJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

/** Sanitise metric name for use as a budget/baseline key. */
function metricKey(metric: PerfMetric): string {
  return metric.name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "");
}

function ci(msg: string, level: "warning" | "error"): void {
  if (process.env.CI) {
    process.stdout.write(`::${level}::${msg}\n`);
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

if (!existsSync(resultsPath)) {
  console.error(`[perf-compare] No results file at ${resultsPath}`);
  console.error("  Run the E2E perf suite first.");
  process.exit(1);
}

const results = loadJson<PerfResults>(resultsPath);
const baselines = existsSync(baselinesPath) ? loadJson<Baselines>(baselinesPath) : null;
const budgets = existsSync(budgetsPath) ? loadJson<Budgets>(budgetsPath) : {};

console.log(`\n## Perf Comparison`);
console.log(`Results: ${results.gitBranch} @ ${results.gitSha} (${results.timestamp})`);
if (baselines) {
  console.log(`Baseline: ${baselines.gitSha} (${baselines.generatedAt})`);
} else {
  console.log(`Baseline: none — all metrics are informational (run will pass)`);
}
console.log();

// Table header
console.log(
  `| Metric | Baseline | Current | Δ | Status |`,
);
console.log(
  `|--------|----------|---------|---|--------|`,
);

let regressions = 0;

for (const metric of results.metrics) {
  const key = metricKey(metric);
  const baseline = baselines?.metrics[key];
  const budget = budgets[key];

  const current = metric.value;
  const unit = metric.unit;

  // Determine baseline value — from baselines file or from budget max
  const baselineVal = baseline?.value;

  // Calculate delta
  const delta =
    baselineVal !== undefined
      ? current - baselineVal
      : null;

  const deltaStr =
    delta === null
      ? "—"
      : `${delta >= 0 ? "+" : ""}${delta.toFixed(1)} ${unit}`;

  const baselineStr = baselineVal !== undefined ? `${baselineVal.toFixed(1)} ${unit}` : "—";
  const currentStr = `${current.toFixed(1)} ${unit}`;

  // Determine status
  let status = "✅";
  let isRegression = false;

  if (baselineVal !== undefined && delta !== null) {
    const tolerance = budget?.tolerance ?? DEFAULT_TOLERANCE;
    const threshold = baselineVal * (1 + tolerance);
    if (current > threshold) {
      isRegression = true;
      regressions++;
      status = `❌ (+${((delta / baselineVal) * 100).toFixed(0)}% > ${(tolerance * 100).toFixed(0)}% tolerance)`;
    } else if (delta > 0) {
      const pct = ((delta / baselineVal) * 100).toFixed(0);
      status = `⚠️ (+${pct}% within tolerance)`;
    }
  } else if (budget?.max !== undefined && current > budget.max) {
    isRegression = true;
    regressions++;
    status = `❌ (${current.toFixed(1)} > budget ${budget.max} ${unit})`;
  }

  console.log(`| ${metric.name} | ${baselineStr} | ${currentStr} | ${deltaStr} | ${status} |`);

  if (isRegression) {
    ci(`Perf regression: ${metric.name} = ${current} ${unit} (baseline ${baselineVal ?? "n/a"}, budget max ${budget?.max ?? "n/a"})`, "error");
  }
}

console.log();

if (regressions > 0) {
  const msg = `${regressions} perf regression${regressions > 1 ? "s" : ""} detected.`;
  console.error(`❌  ${msg}`);
  ci(msg, "error");
  process.exit(1);
} else {
  console.log("✅  No regressions detected.");
}
