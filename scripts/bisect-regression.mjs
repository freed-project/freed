#!/usr/bin/env node
/**
 * bisect-regression.mjs (stability W2-03)
 *
 * Metric name + version range -> commit range -> `git bisect run` with the
 * soak verdict (W1-02) as the predicate. Version bumps are commits, so the
 * range between two release tags is bisectable; each step installs nothing —
 * the predicate runs a bounded soak of the CURRENTLY INSTALLED build only
 * when invoked in --predicate mode by git bisect on a machine that rebuilds
 * per step, or (default) evaluates an existing soak-verdict.json.
 *
 * Default output is the exact command sequence rather than silent execution:
 * a bisect at 90 minutes per step is an hours-long commitment the operator
 * should see before starting. --execute runs it for real.
 */

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const REPO_ROOT = path.resolve(path.dirname(__filename), "..");
const DEFAULT_POINTER = path.join(os.homedir(), ".freed/automation/current-soak-dir");

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
    const assertion = verdict.assertions?.find((a) => a.id === "invariant_alarms");
    const match = assertion?.detail?.match(/^(\d+) invariant_alarm/);
    return match ? Number(match[1]) : 0;
  }
  if (metric === "uploads_unchanged_per_hour") {
    const assertion = verdict.assertions?.find((a) => a.id === "uploads_unchanged_heads");
    const match = assertion?.detail?.match(/^(\d+) of (\d+) uploads/);
    if (!match || !verdict.spanHours) return 0;
    return Number(match[1]) / verdict.spanHours;
  }
  const assertion = verdict.assertions?.find((a) => a.id === metric);
  if (!assertion) throw new Error(`Verdict has no assertion or metric named "${metric}".`);
  return assertion.status === "fail" ? 1 : 0;
}

/**
 * Decide the git-bisect exit code for a metric value.
 * good -> 0, bad -> 1 (git bisect treats 125 as skip; callers use it for
 * build failures before the predicate ever runs).
 */
export function predicateExitCode(value, threshold) {
  return value > threshold ? 1 : 0;
}

export function resolveCommitRange(goodTag, badTag, { cwd = REPO_ROOT, exec = execFileSync } = {}) {
  const revParse = (ref) =>
    exec("git", ["rev-parse", "--verify", `${ref}^{commit}`], { cwd, encoding: "utf8" }).trim();
  const good = revParse(goodTag);
  const bad = revParse(badTag);
  const count = Number(
    exec("git", ["rev-list", "--count", `${goodTag}..${badTag}`], { cwd, encoding: "utf8" }).trim(),
  );
  return { good, bad, count };
}

export function buildBisectPlan({ metric, goodVersion, badVersion, threshold, soakMinutes }) {
  const goodTag = versionToTag(goodVersion);
  const badTag = versionToTag(badVersion);
  const predicate =
    `node scripts/bisect-regression.mjs --predicate --metric ${metric} ` +
    `--threshold ${threshold} --soak-minutes ${soakMinutes}`;
  return {
    goodTag,
    badTag,
    commands: [
      `git bisect start ${badTag} ${goodTag}`,
      `git bisect run ${predicate}`,
      "git bisect reset",
    ],
    predicate,
  };
}

function runPredicate(args) {
  // Build/soak orchestration is the operator's per-step hook; the predicate
  // itself is: collect a bounded soak, judge it, map the metric to an exit
  // code. When a fresh soak is not wanted (--verdict), judge that file as-is.
  let verdictPath = args.verdict;
  if (!verdictPath) {
    const pinnedNode = process.execPath;
    execFileSync(
      pinnedNode,
      [
        path.join(REPO_ROOT, "scripts/soak-collect.mjs"),
        "--duration-minutes",
        String(args.soakMinutes),
      ],
      { stdio: "inherit" },
    );
    try {
      execFileSync(pinnedNode, [path.join(REPO_ROOT, "scripts/soak-assert.mjs")], {
        stdio: "inherit",
      });
    } catch {
      // soak-assert exits 1 on a failing verdict; the verdict file is still
      // written and the metric extraction below is what decides good/bad.
    }
    const pointer = args.pointer ?? DEFAULT_POINTER;
    verdictPath = path.join(readFileSync(pointer, "utf8").trim(), "soak-verdict.json");
  }
  if (!existsSync(verdictPath)) {
    process.stderr.write(`No verdict at ${verdictPath}; skipping this commit.\n`);
    process.exit(125);
  }
  const verdict = JSON.parse(readFileSync(verdictPath, "utf8"));
  const value = metricFromVerdict(verdict, args.metric);
  const code = predicateExitCode(value, args.threshold);
  process.stdout.write(`${args.metric}=${value} threshold=${args.threshold} -> ${code === 0 ? "good" : "bad"}\n`);
  process.exit(code);
}

function usage() {
  return `Usage:
  node scripts/bisect-regression.mjs --metric <name> --good <version> --bad <version> [options]
  node scripts/bisect-regression.mjs --predicate --metric <name> [--verdict <path>] [options]

Options:
  --metric <name>       Assertion id from soak-verdict.json, or
                        uploads_unchanged_per_hour | alarms_total.
  --good <version>      Last known-good release version (tag with or without v).
  --bad <version>       First known-bad release version.
  --threshold <n>       Metric value above which a commit is "bad". Default 0.
  --soak-minutes <n>    Predicate soak length. Default 90.
  --execute             Actually run the bisect (default: print the plan).
  --predicate           Internal: act as the git-bisect run command.
  --verdict <path>      Predicate: judge an existing soak-verdict.json instead
                        of collecting a fresh soak.
  --pointer <path>      Predicate: soak pointer file. Default ~/.freed/automation/current-soak-dir.
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
    execute: false,
    predicate: false,
    verdict: null,
    pointer: null,
    help: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--metric") args.metric = argv[++i];
    else if (arg === "--good") args.good = argv[++i];
    else if (arg === "--bad") args.bad = argv[++i];
    else if (arg === "--threshold") args.threshold = Number(argv[++i]);
    else if (arg === "--soak-minutes") args.soakMinutes = Number(argv[++i]);
    else if (arg === "--execute") args.execute = true;
    else if (arg === "--predicate") args.predicate = true;
    else if (arg === "--verdict") args.verdict = argv[++i];
    else if (arg === "--pointer") args.pointer = argv[++i];
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
  if (args.predicate) {
    if (!args.metric) throw new Error("--predicate requires --metric.");
    runPredicate(args);
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
  for (const command of plan.commands) {
    process.stdout.write(`  ${command}\n`);
  }
  if (!args.execute) {
    process.stdout.write("Dry run (pass --execute to start the bisect).\n");
    return;
  }
  execFileSync("git", ["bisect", "start", plan.badTag, plan.goodTag], {
    cwd: REPO_ROOT,
    stdio: "inherit",
  });
  try {
    execFileSync("git", ["bisect", "run", ...plan.predicate.split(" ")], {
      cwd: REPO_ROOT,
      stdio: "inherit",
    });
  } finally {
    execFileSync("git", ["bisect", "reset"], { cwd: REPO_ROOT, stdio: "inherit" });
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
