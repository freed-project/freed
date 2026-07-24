#!/usr/bin/env node
// Compare a fresh measurement against the committed durations and fail when the
// shard balance has gone stale or a suite proved flaky.
//
// The planner shards by committed durations. When real runtimes drift far from
// them, shards stop being balanced and the slowest shard silently sets the lane
// duration. This turns that into a visible, tracked failure.

import { readFileSync, appendFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { DURATIONS_FILE } from "./lib/tooling-smoke-plan.mjs";
import { REPO_ROOT } from "./lib/tooling-smoke-suites.mjs";

// A suite has to be meaningfully wrong before it counts as drift. Runner noise
// alone should never open a debt issue.
export const DRIFT_RATIO = 2;
export const DRIFT_FLOOR_SECONDS = 20;

export function compareDurations(committed, measured) {
  const rows = [];
  for (const [suite, value] of Object.entries(measured.suites ?? {})) {
    const before = Number(committed.suites?.[suite]?.seconds);
    const after = Number(value.seconds);
    const known = Number.isFinite(before) && before > 0;
    const ratio = known && after > 0 ? after / before : null;
    const drifted =
      known &&
      Math.abs(after - before) >= DRIFT_FLOOR_SECONDS &&
      (ratio >= DRIFT_RATIO || ratio <= 1 / DRIFT_RATIO);
    rows.push({
      suite,
      before: known ? before : null,
      after,
      ratio,
      drifted,
      flaky: value.flaky === true,
      failures: value.failures ?? 0,
      runs: value.runs ?? 0,
    });
  }
  return rows.sort((left, right) => right.after - left.after);
}

function formatRow(row) {
  const before = row.before === null ? "unmeasured" : `${row.before.toFixed(1)}s`;
  const ratio = row.ratio === null ? "n/a" : `${row.ratio.toFixed(2)}x`;
  const flags = [row.drifted ? "DRIFT" : "", row.flaky ? "FLAKY" : ""]
    .filter(Boolean)
    .join(" ");
  return `| ${row.suite} | ${before} | ${row.after.toFixed(1)}s | ${ratio} | ${row.failures}/${row.runs} | ${flags || "ok"} |`;
}

function main(argv) {
  const measuredPath = argv[0];
  if (!measuredPath) throw new Error("Usage: report-tooling-smoke-drift.mjs <measured.json>");
  const measured = JSON.parse(readFileSync(measuredPath, "utf8"));
  let committed = { schemaVersion: 1, suites: {} };
  try {
    committed = JSON.parse(
      readFileSync(path.join(REPO_ROOT, DURATIONS_FILE), "utf8"),
    );
  } catch {
    process.stderr.write(`${DURATIONS_FILE} is missing, treating every suite as unmeasured.\n`);
  }

  const rows = compareDurations(committed, measured);
  const lines = [
    "### Tooling smoke timings",
    "",
    "| suite | committed | measured | ratio | failures | status |",
    "| --- | --- | --- | --- | --- | --- |",
    ...rows.map(formatRow),
    "",
    `Refresh with \`node scripts/measure-tooling-smoke.mjs --write\` when drift is real.`,
  ];
  const report = `${lines.join("\n")}\n`;
  process.stdout.write(report);
  if (process.env.GITHUB_STEP_SUMMARY) {
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, report);
  }

  const drifted = rows.filter(({ drifted: d }) => d);
  const flaky = rows.filter(({ flaky: f }) => f);
  if (flaky.length > 0) {
    process.stderr.write(`Flaky suites: ${flaky.map((r) => r.suite).join(", ")}\n`);
  }
  if (drifted.length > 0) {
    process.stderr.write(`Drifted suites: ${drifted.map((r) => r.suite).join(", ")}\n`);
  }
  if (flaky.length > 0 || drifted.length > 0) process.exitCode = 1;
}

if (
  typeof process.argv[1] === "string" &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(
      `${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exitCode = 1;
  }
}
