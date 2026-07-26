import { readFileSync, statSync } from "node:fs";
import path from "node:path";

import {
  GENERAL_SUITE,
  NATIVE_ACCEPTANCE_TEST_FILES,
  REPO_ROOT,
  SUITE_NAMES,
  suiteTestFiles,
} from "./tooling-smoke-suites.mjs";

// A change to any of these invalidates every suite, so the planner stops trying
// to attribute it and runs the full lane.
export const GLOBAL_INVALIDATION_PATHS = Object.freeze(
  new Set([
    ".github/workflows/ci.yml",
    ".github/workflows/tooling-nightly.yml",
    ".nvmrc",
    "package-lock.json",
    "package.json",
    "scripts/lib/tooling-smoke-plan.mjs",
    "scripts/lib/tooling-smoke-suites.mjs",
    "scripts/run-tooling-smoke-shard.mjs",
    "tsconfig.base.json",
    "tsconfig.json",
  ]),
);

// Changes under these roots can reach the tooling lane through a spawned shell
// script or a fixture that no static edge records, so an unattributed change
// here fails closed to the full lane instead of being silently dropped.
const FAIL_CLOSED_ROOTS = Object.freeze(["scripts/", "automation/"]);

const REPO_PATH_LITERAL =
  /(?<=["'`])(?:scripts|packages|website|docs|automation|release-notes|skills|\.github)\/[A-Za-z0-9._*/-]*/g;

const TOP_LEVEL_ROOTS = Object.freeze([
  ".github/",
  "automation/",
  "docs/",
  "packages/",
  "release-notes/",
  "scripts/",
  "skills/",
  "website/",
]);

function toPosix(filePath) {
  return filePath.replace(/\\/g, "/").replace(/^\.\//, "");
}

// Attempt the read rather than checking first. An existsSync/statSync guard
// ahead of readFileSync is a time-of-check to time-of-use race: the path can
// change between the check and the read. Reading a directory or a missing path
// throws, which is the same answer the guard was trying to produce.
function readIfPresent(repoRoot, relativePath) {
  try {
    return readFileSync(path.join(repoRoot, relativePath), "utf8");
  } catch {
    return null;
  }
}

function statOrNull(absolutePath) {
  try {
    return statSync(absolutePath);
  } catch {
    return null;
  }
}

function importSpecifiers(source) {
  const specifiers = [];
  const patterns = [
    /\bfrom\s*["']([^"']+)["']/g,
    /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g,
    /\bimport\s+["']([^"']+)["']/g,
  ];
  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) specifiers.push(match[1]);
  }
  return specifiers;
}

function resolveRelative(fromFile, specifier) {
  if (!specifier.startsWith(".")) return null;
  return toPosix(path.posix.join(path.posix.dirname(fromFile), specifier));
}

/**
 * Tooling sources mention repo paths for two different reasons: to name a
 * specific file they depend on, and to guard a path prefix such as
 * `startsWith("packages/")`. Only the first is a dependency edge. Treating a
 * bare top-level root as an edge would attach every UI and website change to
 * the control-plane suites, which is the exact waste this planner removes.
 */
function isDependencyEdge(literal, repoRoot) {
  const trimmed = literal.replace(/\/+$/, "");
  const segments = trimmed.split("/").filter(Boolean);
  // A lone root such as "packages/" is a guard prefix, never an edge.
  if (segments.length < 2) return false;
  if (literal.includes("*")) return true;
  // One stat, not an exists-then-stat pair, so there is no window for the path
  // to change between the two calls.
  const stats = statOrNull(path.join(repoRoot, trimmed));
  if (stats !== null) {
    // A package root such as "packages/desktop/" is as broad as a top-level
    // root, so it reads as a guard rather than a reference. Only a directory
    // narrower than a package counts as an edge. The provider gate does not
    // depend on this: validate:feature classifies provider surfaces on every
    // PR regardless of which tooling suites the planner selects.
    if (stats.isDirectory()) return segments.length >= 3;
    return true;
  }
  // Unresolved literals count only when they read as a deliberate filename
  // prefix, such as "docs/PHASE-" or "packages/capture-".
  return segments.length >= 3 || /[-_.]/.test(segments.at(-1) ?? "");
}

/**
 * Transitive closure of relative imports reachable from `entryFiles`, plus the
 * repo-path string literals those modules name. Literals matter because several
 * tooling validators assert facts about repo content they never import, such as
 * the provider-visible path list and the roadmap status file.
 */
export function moduleClosure(entryFiles, { repoRoot = REPO_ROOT } = {}) {
  const modules = new Set();
  const literals = new Set();
  const queue = [...entryFiles.map(toPosix)];
  while (queue.length > 0) {
    const current = queue.pop();
    if (modules.has(current)) continue;
    const source = readIfPresent(repoRoot, current);
    if (source === null) continue;
    modules.add(current);
    for (const specifier of importSpecifiers(source)) {
      const resolved = resolveRelative(current, specifier);
      if (resolved !== null && !modules.has(resolved)) queue.push(resolved);
    }
    for (const match of source.matchAll(REPO_PATH_LITERAL)) {
      const literal = toPosix(match[0]);
      if (!modules.has(literal) && isDependencyEdge(literal, repoRoot)) {
        literals.add(literal);
      }
    }
  }
  return { modules, literals };
}

function literalMatches(literal, changedFile) {
  if (literal === changedFile) return true;
  // A literal naming a directory, or a prefix such as "docs/PHASE-", covers
  // every file beneath or beginning with it. Bare roots never reach here:
  // isDependencyEdge rejects them before they become edges.
  if (literal.endsWith("/")) return changedFile.startsWith(literal);
  const glob = literal.indexOf("*");
  if (glob >= 0) return changedFile.startsWith(literal.slice(0, glob));
  if (path.posix.basename(literal).includes(".")) return false;
  return (
    changedFile.startsWith(`${literal}/`) || changedFile.startsWith(literal)
  );
}

export function suiteDependencies({ repoRoot = REPO_ROOT } = {}) {
  const dependencies = new Map();
  for (const suite of SUITE_NAMES) {
    const entryFiles = suiteTestFiles(suite, repoRoot);
    const { modules, literals } = moduleClosure(entryFiles, { repoRoot });
    // A suite always owns its own test files and their subject modules.
    for (const testFile of entryFiles) {
      const subject = testFile.replace(/\.test\.mjs$/, ".mjs");
      if (readIfPresent(repoRoot, subject) !== null) modules.add(subject);
    }
    dependencies.set(suite, { modules, literals });
  }
  return dependencies;
}

function isUnderFailClosedRoot(changedFile) {
  return FAIL_CLOSED_ROOTS.some((root) => changedFile.startsWith(root));
}

function isRepoSurface(changedFile) {
  return TOP_LEVEL_ROOTS.some((root) => changedFile.startsWith(root));
}

/**
 * Decide which suites a changed path set can actually affect.
 *
 * Returns every suite when the change is global or when a change under a
 * fail-closed root cannot be attributed. Returns an empty list only when no
 * changed file reaches the tooling lane at all, which is the quick
 * not-applicable success path.
 */
export function selectApplicableSuites(
  changedFiles,
  { repoRoot = REPO_ROOT, dependencies = null } = {},
) {
  const files = [...new Set(changedFiles.map(toPosix))].filter(Boolean).sort();
  if (files.length === 0) {
    return Object.freeze({
      suites: Object.freeze([...SUITE_NAMES]),
      reason: "no changed files were supplied, so the full lane runs",
      unattributed: Object.freeze([]),
    });
  }

  const globalHits = files.filter((file) => GLOBAL_INVALIDATION_PATHS.has(file));
  if (globalHits.length > 0) {
    return Object.freeze({
      suites: Object.freeze([...SUITE_NAMES]),
      reason: `global tooling input changed: ${globalHits.join(", ")}`,
      unattributed: Object.freeze([]),
    });
  }

  const graph = dependencies ?? suiteDependencies({ repoRoot });
  const selected = new Set();
  const attributed = new Set();
  for (const [suite, { modules, literals }] of graph) {
    for (const file of files) {
      const hit =
        modules.has(file) ||
        [...literals].some((literal) => literalMatches(literal, file));
      if (hit) {
        selected.add(suite);
        attributed.add(file);
      }
    }
  }

  const unattributed = files.filter(
    (file) => !attributed.has(file) && isUnderFailClosedRoot(file),
  );
  if (unattributed.length > 0) {
    return Object.freeze({
      suites: Object.freeze([...SUITE_NAMES]),
      reason: `unattributed tooling change fails closed to the full lane: ${unattributed.join(", ")}`,
      unattributed: Object.freeze(unattributed),
    });
  }

  const suites = SUITE_NAMES.filter((suite) => selected.has(suite));
  if (suites.length === 0) {
    const offRepo = files.filter((file) => !isRepoSurface(file));
    return Object.freeze({
      suites: Object.freeze([]),
      reason:
        offRepo.length === files.length
          ? "no changed file touches a tracked repo surface"
          : "no changed file reaches the tooling smoke lane",
      unattributed: Object.freeze([]),
    });
  }
  return Object.freeze({
    suites: Object.freeze(suites),
    reason: `changed paths reach ${suites.length.toLocaleString()} of ${SUITE_NAMES.length.toLocaleString()} tooling suites`,
    unattributed: Object.freeze([]),
  });
}

/**
 * Whether a change reaches the native acceptance tests. These skip themselves
 * on Linux, so selecting them means scheduling the macOS lane where their
 * assertions actually run.
 */
export function selectNativeAcceptance(
  changedFiles,
  { repoRoot = REPO_ROOT } = {},
) {
  const files = [...new Set(changedFiles.map(toPosix))].filter(Boolean);
  if (files.length === 0) return Object.freeze({ required: true, files: [] });
  if (files.some((file) => GLOBAL_INVALIDATION_PATHS.has(file))) {
    return Object.freeze({ required: true, files: [] });
  }
  const { modules, literals } = moduleClosure(NATIVE_ACCEPTANCE_TEST_FILES, {
    repoRoot,
  });
  const reached = files.filter(
    (file) =>
      modules.has(file) ||
      [...literals].some((literal) => literalMatches(literal, file)),
  );
  return Object.freeze({ required: reached.length > 0, files: reached });
}

export const DURATIONS_FILE = "scripts/tooling-smoke-durations.json";

/**
 * Total shard jobs the lane may schedule.
 *
 * 12, not 8. At 8 the allocator could not fit the measured suites inside the
 * 90 minute shard timeout no matter how it spread them: outcome-ledger-repair
 * needs at least 4 shards and general at least 2, and the arithmetic only
 * closes from 10 upward. Every npm dependency PR selects all four suites,
 * because package-lock.json is a global tooling input, so an unfittable budget
 * meant the gate was structurally red for the entire class.
 *
 * This raises parallelism, not the clock. Issue #1147 rules out a longer
 * `timeout-minutes` because that hides the cost and finds out later; splitting
 * further keeps total runner seconds flat, adds only per-job setup, and lets
 * the suite actually finish, which is also the only way its duration entry can
 * ever be a measurement instead of a timeout floor.
 *
 * It is a mitigation and not the fix. outcome-ledger-repair is ~4.8 hours of
 * work because it spawns a pinned Python interpreter per lease-archive
 * operation, roughly 466 of them per test. Cutting that is #1147 and it
 * touches a deliberate security boundary. Once it lands this should come back
 * down.
 */
export const DEFAULT_MAX_JOBS = 12;

/**
 * The `timeout-minutes` on a tooling smoke shard job, in seconds. Kept here so
 * the planner can predict an overrun rather than discover one.
 */
export const DEFAULT_SHARD_TIMEOUT_SECONDS = 90 * 60;

/**
 * Measured suite seconds when the nightly lane has recorded them, falling back
 * to source size. Size is a poor predictor of runtime, which is why the nightly
 * lane writes real timings back into the durations file.
 */
export function suiteWeights({ repoRoot = REPO_ROOT, durations = null } = {}) {
  const recorded =
    durations ??
    (() => {
      const raw = readIfPresent(repoRoot, DURATIONS_FILE);
      if (raw === null) return null;
      try {
        return JSON.parse(raw);
      } catch {
        return null;
      }
    })();
  const weights = new Map();
  for (const suite of SUITE_NAMES) {
    const entry = recorded?.suites?.[suite];
    const measured = Number(entry?.seconds);
    if (Number.isFinite(measured) && measured > 0) {
      // A run that was killed by the job timeout did not measure anything. It
      // established a floor. Recording it as a measurement is what made this
      // lane unable to correct itself: the truncated number is smaller than the
      // truth, so the planner under-shards, so the shards are killed again, so
      // the number never grows. `capped` breaks that loop by keeping the
      // distinction the durations file previously only stated in prose.
      weights.set(suite, {
        weight: measured,
        measured: entry?.capped !== true,
        capped: entry?.capped === true,
      });
      continue;
    }
    let size = 0;
    for (const testFile of suiteTestFiles(suite, repoRoot)) {
      size += readIfPresent(repoRoot, testFile)?.length ?? 0;
    }
    weights.set(suite, { weight: Math.max(1, size), measured: false, capped: false });
  }
  return weights;
}

/**
 * Per-shard seconds the plan implies, and whether that fits the job timeout.
 *
 * The lane used to schedule work it could have predicted would not fit, wait
 * ninety minutes, and then report the cancellation as a test failure. Predicting
 * it costs one division. A capped weight is a floor rather than a measurement,
 * so `atLeast` says the real figure is higher by an unknown amount.
 */
export function projectShardRuntime(allocation, weights, timeoutSeconds) {
  return allocation.map(({ suite, shardCount }) => {
    const entry = weights.get(suite);
    const weight = entry?.weight ?? 0;
    const capped = entry?.capped === true;
    // The size fallback weighs source bytes, not seconds. Dividing bytes by
    // shards and comparing the result to a timeout would be a unit error that
    // happens to typecheck, so that case predicts nothing and blocks nothing.
    const isSeconds = entry?.measured === true || capped;
    const perShardSeconds = shardCount > 0 ? weight / shardCount : weight;
    return {
      suite,
      shardCount,
      perShardSeconds: isSeconds ? perShardSeconds : null,
      atLeast: capped,
      // Only a real measurement can clear the check. A capped weight already
      // exceeded a timeout once, so treating "the floor fits" as "it fits"
      // would reproduce the bug this function exists to catch.
      fits: capped
        ? false
        : !isSeconds || !Number.isFinite(timeoutSeconds) || perShardSeconds <= timeoutSeconds,
      predictedFrom: capped ? "capped" : entry?.measured === true ? "measured" : "size",
    };
  });
}

/**
 * Spread a fixed job budget across the selected suites using highest averages,
 * so the slowest suite gets the most shards and total jobs never exceed the cap.
 */
export function allocateShardBudget(suites, maxJobs, weights) {
  if (suites.length === 0) return [];
  if (!Number.isSafeInteger(maxJobs) || maxJobs <= 0) {
    throw new Error("Tooling smoke job budget must be a positive integer.");
  }
  const ordered = [...suites];
  const counts = new Map(ordered.map((suite) => [suite, 1]));
  // With more suites than jobs, every suite still runs once. Correctness beats
  // the cap: dropping a suite would silently lose coverage.
  let remaining = Math.max(0, maxJobs - ordered.length);
  while (remaining > 0) {
    let best = null;
    let bestValue = -Infinity;
    for (const suite of ordered) {
      const weight = weights.get(suite)?.weight ?? 1;
      const value = weight / (counts.get(suite) + 1);
      if (value > bestValue) {
        bestValue = value;
        best = suite;
      }
    }
    counts.set(best, counts.get(best) + 1);
    remaining -= 1;
  }
  return ordered.map((suite) => ({ suite, shardCount: counts.get(suite) }));
}

/**
 * The full GitHub Actions matrix for a changed path set. An empty `include`
 * means no tooling suite is reachable, which the workflow reports as a quick
 * not-applicable success instead of running anything.
 */
export function buildToolingSmokeMatrix({
  changedFiles,
  maxJobs = DEFAULT_MAX_JOBS,
  repoRoot = REPO_ROOT,
  durations = null,
  shardTimeoutSeconds = DEFAULT_SHARD_TIMEOUT_SECONDS,
} = {}) {
  const selection = selectApplicableSuites(changedFiles, { repoRoot });
  const weights = suiteWeights({ repoRoot, durations });
  const allocation = allocateShardBudget(selection.suites, maxJobs, weights);
  const projection = projectShardRuntime(allocation, weights, shardTimeoutSeconds);
  const include = allocation.flatMap(({ suite, shardCount }) =>
    Array.from({ length: shardCount }, (_, index) => ({
      suite,
      shard: index + 1,
      shardCount,
      name: `${suite} ${(index + 1).toLocaleString()}/${shardCount.toLocaleString()}`,
    })),
  );
  return Object.freeze({
    schemaVersion: 1,
    applicable: include.length > 0,
    include,
    jobCount: include.length,
    maxJobs,
    reason: selection.reason,
    suites: selection.suites,
    weightsAreMeasured:
      selection.suites.length > 0 &&
      selection.suites.every((suite) => weights.get(suite)?.measured === true),
    projection,
    shardTimeoutSeconds,
    // Suites this plan predicts will not finish inside the job timeout. The
    // caller decides what to do about it; the point is that it is known before
    // the jobs run rather than ninety minutes later.
    overrunSuites: projection.filter((entry) => !entry.fits).map((entry) => entry.suite),
  });
}
