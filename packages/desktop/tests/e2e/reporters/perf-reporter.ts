/**
 * Playwright custom reporter — structured performance results
 *
 * Intercepts [PERF] log lines from perf-feed.spec.ts and writes a
 * structured JSON file (playwright-report/perf-results.json) after the
 * run. The file is consumed by scripts/perf-compare.ts for regression
 * detection and uploaded as a CI artifact for trend dashboards.
 *
 * Log line formats recognised:
 *   [PERF] <label>: <value> ms
 *   [PERF] <label>: <value> (informational)
 *   [PERF] <label>: <value>         ← bare number
 */

import type {
  Reporter,
  FullConfig,
  Suite,
  TestCase,
  TestResult,
  FullResult,
} from "@playwright/test/reporter";
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { execSync } from "node:child_process";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PerfMetric {
  name: string;
  value: number;
  unit: string;
  scenario: string;
}

export interface PerfResults {
  timestamp: string;
  gitSha: string;
  gitBranch: string;
  metrics: PerfMetric[];
}

// ---------------------------------------------------------------------------
// Parser
// ---------------------------------------------------------------------------

/**
 * Extract a numeric value and optional unit from a [PERF] log line.
 *
 * Handles:
 *   "Cold load 1k items: 1,234 ms"          → { name: "Cold load 1k items", value: 1234, unit: "ms" }
 *   "Long tasks (>50ms): 3"                 → { name: "Long tasks", value: 3, unit: "count" }
 *   "markAsRead × 20 — avg: 50.1 ms, ..."  → { name: "markAsRead avg", value: 50.1, unit: "ms" }
 *   "markAsRead × 20 — worst: 120.3 ms"    → { name: "markAsRead worst", value: 120.3, unit: "ms" }
 */
function parseMetricLine(line: string, scenario: string): PerfMetric[] {
  // Strip leading "[PERF] "
  const body = line.replace(/^\[PERF\]\s*/, "").trim();
  const metrics: PerfMetric[] = [];

  // Compound line: "foo — avg: X ms, worst: Y ms"
  const compoundMatch = body.match(/^(.+?)\s+—\s+avg:\s*([\d,.]+)\s*(\w+)?,\s*worst:\s*([\d,.]+)\s*(\w+)?/i);
  if (compoundMatch) {
    const label = compoundMatch[1].trim();
    const avg = parseFloat(compoundMatch[2].replace(/,/g, ""));
    const avgUnit = compoundMatch[3] ?? "ms";
    const worst = parseFloat(compoundMatch[4].replace(/,/g, ""));
    const worstUnit = compoundMatch[5] ?? "ms";
    metrics.push({ name: `${label} avg`, value: avg, unit: avgUnit, scenario });
    metrics.push({ name: `${label} worst`, value: worst, unit: worstUnit, scenario });
    return metrics;
  }

  // Simple line: "Label: value unit"
  const simpleMatch = body.match(/^(.+?):\s*([\d,.]+)\s*(\w+)?/);
  if (simpleMatch) {
    const name = simpleMatch[1].trim();
    const value = parseFloat(simpleMatch[2].replace(/,/g, ""));
    const rawUnit = simpleMatch[3] ?? "";
    // Normalise unit
    const unit =
      rawUnit === "ms" || rawUnit === "s" ? rawUnit
      : rawUnit === "" ? "count"
      : rawUnit;

    // Skip non-numeric values (e.g. "Feed cards visible: 123 (informational)")
    if (isNaN(value)) return metrics;

    // Skip pure informational lines (those that include "(informational)")
    if (body.includes("(informational)")) return metrics;

    metrics.push({ name, value, unit, scenario });
    return metrics;
  }

  return metrics;
}

// ---------------------------------------------------------------------------
// Reporter
// ---------------------------------------------------------------------------

class PerfReporter implements Reporter {
  private metrics: PerfMetric[] = [];
  private outputDir = "";

  onBegin(_config: FullConfig, _suite: Suite): void {
    // playwright-report lives alongside the config file
    this.outputDir = join(process.cwd(), "playwright-report");
  }

  onTestEnd(test: TestCase, result: TestResult): void {
    // Derive scenario name from the full test title
    const scenario = test.titlePath().join(" › ");

    // Parse [PERF] lines from stdout
    for (const chunk of result.stdout) {
      const text = typeof chunk === "string" ? chunk : chunk.toString("utf8");
      for (const raw of text.split("\n")) {
        const line = raw.trim();
        if (!line.startsWith("[PERF]")) continue;
        const parsed = parseMetricLine(line, scenario);
        this.metrics.push(...parsed);
      }
    }
  }

  onEnd(_result: FullResult): void {
    // Resolve git metadata — best-effort, safe to fail in detached heads etc.
    let gitSha = "unknown";
    let gitBranch = "unknown";
    try {
      gitSha = execSync("git rev-parse --short HEAD", { encoding: "utf8" }).trim();
    } catch { /* ignore */ }
    try {
      gitBranch = execSync("git rev-parse --abbrev-ref HEAD", { encoding: "utf8" }).trim();
    } catch { /* ignore */ }

    const results: PerfResults = {
      timestamp: new Date().toISOString(),
      gitSha,
      gitBranch,
      metrics: this.metrics,
    };

    mkdirSync(this.outputDir, { recursive: true });
    const outPath = join(this.outputDir, "perf-results.json");
    writeFileSync(outPath, JSON.stringify(results, null, 2));

    if (this.metrics.length > 0) {
      console.log(`\n[PerfReporter] Captured ${this.metrics.length} metrics → ${outPath}`);
    }
  }
}

export default PerfReporter;
