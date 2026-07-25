#!/usr/bin/env node
// Record how long each tooling smoke suite actually takes, and how often it
// fails on a rerun. The planner shards by these numbers, so a suite that gets
// slower automatically gets more shards without anyone editing a workflow.
//
// The nightly exhaustive lane runs this and commits the result. Source size is
// only a fallback for a suite that has never been measured.

import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { DURATIONS_FILE } from "./lib/tooling-smoke-plan.mjs";
import {
  REPO_ROOT,
  SUITE_NAMES,
  suiteTestFiles,
} from "./lib/tooling-smoke-suites.mjs";

function parseArgs(argv) {
  const parsed = { repeat: 1, suites: [...SUITE_NAMES], write: false };
  for (const argument of argv) {
    if (argument === "--write") parsed.write = true;
    else if (argument.startsWith("--repeat=")) {
      parsed.repeat = Number(argument.slice("--repeat=".length));
    } else if (argument.startsWith("--suites=")) {
      parsed.suites = argument
        .slice("--suites=".length)
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean);
    } else {
      throw new Error(`Unknown measure-tooling-smoke argument: ${argument}`);
    }
  }
  if (!Number.isSafeInteger(parsed.repeat) || parsed.repeat <= 0) {
    throw new Error("--repeat must be a positive integer.");
  }
  for (const suite of parsed.suites) {
    if (!SUITE_NAMES.includes(suite)) {
      throw new Error(`Unknown tooling smoke suite: ${suite}`);
    }
  }
  return parsed;
}

function runSuiteOnce(suite) {
  const files = suiteTestFiles(suite, REPO_ROOT);
  const startedAt = process.hrtime.bigint();
  const result = spawnSync(process.execPath, ["--test", ...files], {
    cwd: REPO_ROOT,
    env: process.env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const seconds = Number(process.hrtime.bigint() - startedAt) / 1e9;
  return { seconds, ok: result.status === 0 };
}

export function measureSuites(suites, repeat) {
  const measured = {};
  for (const suite of suites) {
    const runs = [];
    for (let attempt = 0; attempt < repeat; attempt += 1) {
      const run = runSuiteOnce(suite);
      runs.push(run);
      process.stderr.write(
        `  ${suite} run ${(attempt + 1).toLocaleString()}/${repeat.toLocaleString()}: ${run.seconds.toFixed(1)}s ${run.ok ? "pass" : "FAIL"}\n`,
      );
    }
    const failures = runs.filter(({ ok }) => !ok).length;
    measured[suite] = {
      seconds: Number(
        (runs.reduce((total, { seconds }) => total + seconds, 0) / runs.length).toFixed(1),
      ),
      runs: runs.length,
      failures,
      // A suite that passes sometimes and fails sometimes across identical runs
      // is flaky by definition, and the report says so rather than hiding it.
      flaky: failures > 0 && failures < runs.length,
    };
  }
  return measured;
}

function main(argv) {
  const { repeat, suites, write } = parseArgs(argv);
  process.stderr.write(
    `Measuring ${suites.length.toLocaleString()} tooling smoke suites, ${repeat.toLocaleString()} run(s) each.\n`,
  );
  const measured = measureSuites(suites, repeat);

  const absolute = path.join(REPO_ROOT, DURATIONS_FILE);
  let existing = { schemaVersion: 1, suites: {} };
  try {
    existing = JSON.parse(readFileSync(absolute, "utf8"));
  } catch {
    // First run writes the file.
  }
  const merged = {
    schemaVersion: 1,
    suites: { ...existing.suites, ...measured },
  };
  const serialized = `${JSON.stringify(merged, null, 2)}\n`;
  if (write) {
    writeFileSync(absolute, serialized);
    process.stderr.write(`Wrote ${DURATIONS_FILE}.\n`);
  } else {
    process.stdout.write(serialized);
  }

  const flaky = Object.entries(merged.suites).filter(([, v]) => v.flaky);
  if (flaky.length > 0) {
    process.stderr.write(
      `Flaky suites: ${flaky.map(([name]) => name).join(", ")}\n`,
    );
  }
}

if (path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
