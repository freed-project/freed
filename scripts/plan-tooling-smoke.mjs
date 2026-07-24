#!/usr/bin/env node
// Decide which tooling smoke suites a change can actually affect, and spread a
// fixed job budget across them. Emits a GitHub Actions matrix.
//
// Ordinary pull requests get changed-path scoping. A push to dev gets the full
// lane, because dev carries the one full integration proof that release
// admission later inherits.

import { spawnSync } from "node:child_process";
import { appendFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  DEFAULT_MAX_JOBS,
  buildToolingSmokeMatrix,
  selectNativeAcceptance,
} from "./lib/tooling-smoke-plan.mjs";
import { REPO_ROOT, SUITE_NAMES } from "./lib/tooling-smoke-suites.mjs";

function usage() {
  return `Usage:
  node scripts/plan-tooling-smoke.mjs [--base-ref <ref>] [--changed-files <file>...]
                                      [--all] [--max-jobs <n>] [--github-output]

  --base-ref       Diff against this ref to derive the changed path set.
  --changed-files  Use this explicit path set instead of git.
  --all            Force every suite, used for pushes to dev.
  --max-jobs       Total job budget for the lane (default ${DEFAULT_MAX_JOBS}).
  --github-output  Append matrix and applicable outputs to $GITHUB_OUTPUT.`;
}

export function parseArgs(argv) {
  let baseRef = "";
  let changedFiles = [];
  let all = false;
  let maxJobs = DEFAULT_MAX_JOBS;
  let githubOutput = false;
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--all") all = true;
    else if (argument === "--github-output") githubOutput = true;
    else if (argument === "--base-ref") baseRef = argv[++index] ?? "";
    else if (argument === "--max-jobs") maxJobs = Number(argv[++index]);
    else if (argument === "--changed-files") {
      changedFiles = argv.slice(index + 1);
      index = argv.length;
    } else if (argument === "--help" || argument === "-h") {
      process.stdout.write(`${usage()}\n`);
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${argument}\n\n${usage()}`);
    }
  }
  if (!Number.isSafeInteger(maxJobs) || maxJobs <= 0) {
    throw new Error("--max-jobs must be a positive integer.");
  }
  return { all, baseRef, changedFiles, githubOutput, maxJobs };
}

function gitChangedFiles(baseRef) {
  const result = spawnSync(
    "git",
    ["diff", "--name-only", "--diff-filter=ACDMRTUXB", `${baseRef}...HEAD`],
    { cwd: REPO_ROOT, encoding: "utf8" },
  );
  if (result.status !== 0) {
    throw new Error(
      `Could not diff against ${baseRef}: ${(result.stderr || "").trim()}`,
    );
  }
  return result.stdout.split("\n").map((line) => line.trim()).filter(Boolean);
}

export function resolvePlan({ all, baseRef, changedFiles, maxJobs }) {
  // An empty changed set means "everything is in play" to the planner.
  const files = all
    ? []
    : changedFiles.length > 0
      ? changedFiles
      : baseRef
        ? gitChangedFiles(baseRef)
        : [];
  return {
    ...buildToolingSmokeMatrix({ changedFiles: files, maxJobs }),
    files,
    native: selectNativeAcceptance(files),
  };
}

function main(argv) {
  const options = parseArgs(argv);
  const plan = resolvePlan(options);

  process.stderr.write(
    `Tooling smoke plan: ${plan.jobCount.toLocaleString()} job(s) across ${plan.suites.length.toLocaleString()} of ${SUITE_NAMES.length.toLocaleString()} suites.\n`,
  );
  process.stderr.write(`  reason: ${plan.reason}\n`);
  process.stderr.write(
    `  shard weights: ${plan.weightsAreMeasured ? "measured runtimes" : "source size fallback"}\n`,
  );
  for (const suite of plan.suites) {
    const shards = plan.include.filter((entry) => entry.suite === suite).length;
    process.stderr.write(`  ${suite}: ${shards.toLocaleString()} shard(s)\n`);
  }
  if (!plan.applicable) {
    process.stderr.write(
      "  no suite is reachable, the lane reports not applicable\n",
    );
  }
  process.stderr.write(
    `  native acceptance (macOS): ${plan.native.required ? "required" : "not applicable"}\n`,
  );

  const matrix = JSON.stringify({ include: plan.include });
  if (options.githubOutput && process.env.GITHUB_OUTPUT) {
    appendFileSync(
      process.env.GITHUB_OUTPUT,
      `matrix=${matrix}\napplicable=${plan.applicable}\njob-count=${plan.jobCount}\nnative=${plan.native.required}\nreason=${plan.reason}\n`,
    );
  }
  process.stdout.write(`${matrix}\n`);
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
