#!/usr/bin/env node
/**
 * bisect-regression.mjs (stability W2-03)
 *
 * Metric name + version range -> a plan for a future runtime bisect.
 *
 * Execution is intentionally disabled. The previous executor checked out each
 * candidate commit but measured the currently installed app, so every commit
 * was judged against the same binary. A real executor must build and install
 * each candidate, verify the installed commit identity, cold launch, collect
 * an isolated version-bounded soak, and restore the prior app afterward.
 */

import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const REPO_ROOT = path.resolve(path.dirname(__filename), "..");
export const RUNTIME_BISECT_BLOCKERS = [
  "build the checked-out commit with the pinned toolchain",
  "install the candidate app in an isolated location",
  "verify the installed app reports the checked-out commit SHA",
  "cold launch and collect a build-bounded soak with minimum coverage",
  "restore the previously installed app even when a step fails",
];

/** v-prefix a bare version; pass tags through. */
export function versionToTag(version) {
  const trimmed = String(version).trim();
  if (!trimmed) throw new Error("Empty version.");
  return trimmed.startsWith("v") ? trimmed : `v${trimmed}`;
}

/**
 * Extract a named metric from a soak-verdict.json object.
 * Supported names: any assertion id (fails -> bad), or
 * "uploads_unchanged_per_hour" / "alarms_total" numeric extractions.
 */
export function metricFromVerdict(verdict, metric) {
  if (metric === "alarms_total") {
    const assertion = verdict.assertions?.find(
      (a) => a.id === "invariant_alarms",
    );
    const match = assertion?.detail?.match(/^(\d+) invariant_alarm/);
    return match ? Number(match[1]) : 0;
  }
  if (metric === "uploads_unchanged_per_hour") {
    const assertion = verdict.assertions?.find(
      (a) => a.id === "uploads_unchanged_heads",
    );
    const match = assertion?.detail?.match(/^(\d+) of (\d+) uploads/);
    const cloudEligibleHours = Number(verdict.sourceHealth?.cloudEligibleHours);
    if (
      !match ||
      !Number.isFinite(cloudEligibleHours) ||
      cloudEligibleHours <= 0
    )
      return null;
    return Number(match[1]) / cloudEligibleHours;
  }
  const assertion = verdict.assertions?.find((a) => a.id === metric);
  if (!assertion)
    throw new Error(`Verdict has no assertion or metric named "${metric}".`);
  return assertion.status === "fail" ? 1 : 0;
}

/**
 * Decide the git-bisect exit code for a metric value.
 * good -> 0, bad -> 1 (git bisect treats 125 as skip; callers use it for
 * build failures before the predicate ever runs).
 */
export function predicateExitCode(value, threshold) {
  if (!Number.isFinite(value)) return 125;
  return value > threshold ? 1 : 0;
}

export function resolveCommitRange(
  goodTag,
  badTag,
  { cwd = REPO_ROOT, exec = execFileSync } = {},
) {
  const revParse = (ref) =>
    exec("git", ["rev-parse", "--verify", `${ref}^{commit}`], {
      cwd,
      encoding: "utf8",
    }).trim();
  const good = revParse(goodTag);
  const bad = revParse(badTag);
  const count = Number(
    exec("git", ["rev-list", "--count", `${goodTag}..${badTag}`], {
      cwd,
      encoding: "utf8",
    }).trim(),
  );
  return { good, bad, count };
}

export function buildBisectPlan({
  metric,
  goodVersion,
  badVersion,
  threshold,
  soakMinutes,
}) {
  const goodTag = versionToTag(goodVersion);
  const badTag = versionToTag(badVersion);
  return {
    goodTag,
    badTag,
    metric,
    threshold,
    soakMinutes,
    executionSupported: false,
    blockers: [...RUNTIME_BISECT_BLOCKERS],
  };
}

function usage() {
  return `Usage:
  node scripts/bisect-regression.mjs --metric <name> --good <version> --bad <version> [options]

Options:
  --metric <name>       Assertion id from soak-verdict.json, or
                        uploads_unchanged_per_hour | alarms_total.
  --good <version>      Last known-good release version (tag with or without v).
  --bad <version>       First known-bad release version.
  --threshold <n>       Metric value above which a commit is "bad". Default 0.
  --soak-minutes <n>    Predicate soak length. Default 90.
  --execute             Unsupported until the per-commit build/install harness exists.
  --predicate           Unsupported until the per-commit build/install harness exists.
  --help                Show this help.
`;
}

export function parseArgs(argv) {
  const args = {
    metric: null,
    good: null,
    bad: null,
    threshold: 0,
    soakMinutes: 90,
    help: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--metric") args.metric = argv[++i];
    else if (arg === "--good") args.good = argv[++i];
    else if (arg === "--bad") args.bad = argv[++i];
    else if (arg === "--threshold") args.threshold = Number(argv[++i]);
    else if (arg === "--soak-minutes") args.soakMinutes = Number(argv[++i]);
    else if (arg === "--execute" || arg === "--predicate") {
      throw new Error(
        `${arg} is disabled until bisect-regression builds, installs, and verifies each checked-out commit.`,
      );
    } else if (arg === "--help" || arg === "-h") args.help = true;
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
  if (!args.metric || !args.good || !args.bad) {
    process.stdout.write(usage());
    process.exitCode = 1;
    return;
  }

  const plan = buildBisectPlan({
    metric: args.metric,
    goodVersion: args.good,
    badVersion: args.bad,
    threshold: args.threshold,
    soakMinutes: args.soakMinutes,
  });
  const range = resolveCommitRange(plan.goodTag, plan.badTag);
  process.stdout.write(
    `${plan.goodTag} (${range.good.slice(0, 8)}) .. ${plan.badTag} (${range.bad.slice(0, 8)}): ` +
      `${range.count} commits, ~${Math.ceil(Math.log2(Math.max(range.count, 1)))} bisect steps ` +
      `at ${args.soakMinutes} min each\n`,
  );
  process.stdout.write(
    "PLAN ONLY. Runtime bisect execution is disabled until these blockers are closed:\n",
  );
  for (const blocker of plan.blockers) {
    process.stdout.write(`  - ${blocker}\n`);
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
