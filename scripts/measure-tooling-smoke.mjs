#!/usr/bin/env node
// Record how long each tooling smoke suite actually takes, and how often it
// fails on a rerun. The planner shards by these numbers, so a suite that gets
// slower automatically gets more shards without anyone editing a workflow.
//
// The exhaustive lane runs this and uploads the result. A reviewed refresh can
// write it back with --write. Source size is only a fallback until every unit
// in a suite has been measured.

import { spawnSync } from "node:child_process";
import {
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";

import { DURATIONS_FILE } from "./lib/tooling-smoke-plan.mjs";
import {
  REPO_ROOT,
  SHARDED_TEST_FILES,
  SUITE_NAMES,
  suiteTestFiles,
} from "./lib/tooling-smoke-suites.mjs";
import { extractTopLevelTestUnits } from "./run-tooling-smoke-shard.mjs";

export function parseArgs(argv) {
  const parsed = {
    aggregate: "",
    outputDir: "",
    repeat: 1,
    shardCount: null,
    shardIndex: null,
    suite: "",
    suites: [...SUITE_NAMES],
    write: false,
  };
  for (const argument of argv) {
    if (argument === "--write") parsed.write = true;
    else if (argument.startsWith("--aggregate=")) {
      parsed.aggregate = argument.slice("--aggregate=".length);
    } else if (argument.startsWith("--output-dir=")) {
      parsed.outputDir = argument.slice("--output-dir=".length);
    } else if (argument.startsWith("--suite=")) {
      parsed.suite = argument.slice("--suite=".length);
    } else if (argument.startsWith("--shard-index=")) {
      parsed.shardIndex = Number(argument.slice("--shard-index=".length));
    } else if (argument.startsWith("--shard-count=")) {
      parsed.shardCount = Number(argument.slice("--shard-count=".length));
    } else if (argument.startsWith("--repeat=")) {
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
  if (parsed.aggregate) {
    if (
      parsed.outputDir ||
      parsed.suite ||
      parsed.shardIndex !== null ||
      parsed.shardCount !== null ||
      parsed.write
    ) {
      throw new Error(
        "--aggregate cannot be combined with shard or write options.",
      );
    }
    return parsed;
  }
  const shardOptions = [
    parsed.outputDir.length > 0,
    parsed.suite.length > 0,
    parsed.shardIndex !== null,
    parsed.shardCount !== null,
  ];
  if (shardOptions.some(Boolean) && !shardOptions.every(Boolean)) {
    throw new Error(
      "Shard measurement requires --suite, --shard-index, --shard-count, and --output-dir.",
    );
  }
  if (parsed.suite) {
    if (!SUITE_NAMES.includes(parsed.suite)) {
      throw new Error(`Unknown tooling smoke suite: ${parsed.suite}`);
    }
    if (
      !Number.isSafeInteger(parsed.shardIndex) ||
      !Number.isSafeInteger(parsed.shardCount) ||
      parsed.shardIndex <= 0 ||
      parsed.shardCount <= 0 ||
      parsed.shardIndex > parsed.shardCount
    ) {
      throw new Error("Shard measurement requires a valid index and count.");
    }
    if (parsed.write) {
      throw new Error(
        "Shard measurement writes receipts, not the duration catalog.",
      );
    }
    if (parsed.repeat > 3) {
      throw new Error("Shard measurement repeat must be between 1 and 3.");
    }
  }
  return parsed;
}

function decodeXmlAttribute(value) {
  return value
    .replaceAll("&quot;", '"')
    .replaceAll("&apos;", "'")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&amp;", "&");
}

export function parseJUnitTestCases(xml, repoRoot = REPO_ROOT) {
  const testCases = [];
  const pattern =
    /<testcase\s+name="([^"]*)"\s+time="([^"]*)"\s+classname="[^"]*"\s+file="([^"]*)"[^>]*>/g;
  for (const match of xml.matchAll(pattern)) {
    const seconds = Number(match[2]);
    if (!Number.isFinite(seconds) || seconds < 0) continue;
    const absoluteFile = decodeXmlAttribute(match[3]);
    testCases.push({
      name: decodeXmlAttribute(match[1]),
      file: path.relative(repoRoot, absoluteFile).replaceAll(path.sep, "/"),
      seconds,
    });
  }
  return testCases;
}

export function unitDurationsForSuite(
  suite,
  testCases,
  { repoRoot = REPO_ROOT } = {},
) {
  const totals = new Map();
  if (suite === "general") {
    for (const testCase of testCases) {
      totals.set(
        testCase.file,
        (totals.get(testCase.file) ?? 0) + testCase.seconds,
      );
    }
  } else {
    const testFile = SHARDED_TEST_FILES[suite];
    const source = readFileSync(path.join(repoRoot, testFile), "utf8");
    const units = extractTopLevelTestUnits(source, testFile);
    for (const testCase of testCases.filter(
      (entry) => entry.file === testFile,
    )) {
      const matches = units.filter((unit) =>
        new RegExp(`^(?:${unit.patternFragment})$`, "u").test(testCase.name),
      );
      if (matches.length !== 1) continue;
      const [unit] = matches;
      totals.set(unit.name, (totals.get(unit.name) ?? 0) + testCase.seconds);
    }
  }
  return Object.fromEntries(
    [...totals]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([name, seconds]) => [name, seconds]),
  );
}

function shardJUnitPath(repoRoot, suite, shardIndex, shardCount) {
  return path.join(
    repoRoot,
    "tooling-smoke-results",
    `${suite}-${shardIndex}-of-${shardCount}.xml`,
  );
}

export function measureShard(
  { outputDir, repeat, shardCount, shardIndex, suite },
  { repoRoot = REPO_ROOT } = {},
) {
  const absoluteOutputDir = path.resolve(repoRoot, outputDir);
  mkdirSync(absoluteOutputDir, { recursive: true });
  const junitSource = shardJUnitPath(repoRoot, suite, shardIndex, shardCount);
  const runs = [];
  for (let attempt = 1; attempt <= repeat; attempt += 1) {
    rmSync(junitSource, { force: true });
    const startedAt = process.hrtime.bigint();
    const result = spawnSync(
      process.execPath,
      [
        path.join(repoRoot, "scripts", "run-tooling-smoke-shard.mjs"),
        `--suite=${suite}`,
        `--shard-index=${shardIndex}`,
        `--shard-count=${shardCount}`,
      ],
      { cwd: repoRoot, env: process.env, stdio: "inherit" },
    );
    const seconds = Number(process.hrtime.bigint() - startedAt) / 1e9;
    const junitDestination = path.join(
      absoluteOutputDir,
      `${suite}-${shardIndex}-of-${shardCount}-attempt-${attempt}.xml`,
    );
    let units = {};
    let junitOk = false;
    try {
      const xml = readFileSync(junitSource, "utf8");
      units = unitDurationsForSuite(suite, parseJUnitTestCases(xml, repoRoot), {
        repoRoot,
      });
      renameSync(junitSource, junitDestination);
      junitOk = Object.keys(units).length > 0;
    } catch {
      // A runner failure before JUnit creation is still an attributable failed
      // attempt. The receipt preserves it and the matrix job remains red.
    }
    const ok =
      result.error === undefined &&
      result.signal === null &&
      result.status === 0 &&
      junitOk;
    runs.push({
      attempt,
      ok,
      seconds: Number(seconds.toFixed(1)),
      units,
    });
    process.stderr.write(
      `  ${suite} shard ${shardIndex.toLocaleString()}/${shardCount.toLocaleString()} attempt ${attempt.toLocaleString()}/${repeat.toLocaleString()}: ${seconds.toFixed(1)}s ${ok ? "pass" : "FAIL"}\n`,
    );
  }
  const receipt = {
    schemaVersion: 1,
    suite,
    shardIndex,
    shardCount,
    repeat,
    runs,
  };
  writeFileSync(
    path.join(
      absoluteOutputDir,
      `${suite}-${shardIndex}-of-${shardCount}.json`,
    ),
    `${JSON.stringify(receipt, null, 2)}\n`,
  );
  return receipt;
}

function receiptFiles(directory) {
  const files = [];
  for (const entry of readdirSync(directory)) {
    const candidate = path.join(directory, entry);
    if (statSync(candidate).isDirectory())
      files.push(...receiptFiles(candidate));
    else if (entry.endsWith(".json")) files.push(candidate);
  }
  return files;
}

export function aggregateShardedMeasurements(receipts) {
  const bySuite = new Map(SUITE_NAMES.map((suite) => [suite, []]));
  for (const receipt of receipts) {
    if (
      receipt?.schemaVersion !== 1 ||
      !SUITE_NAMES.includes(receipt.suite) ||
      !Number.isSafeInteger(receipt.shardIndex) ||
      !Number.isSafeInteger(receipt.shardCount) ||
      !Number.isSafeInteger(receipt.repeat) ||
      receipt.shardIndex <= 0 ||
      receipt.shardIndex > receipt.shardCount ||
      receipt.repeat <= 0 ||
      !Array.isArray(receipt.runs) ||
      receipt.runs.length !== receipt.repeat
    ) {
      throw new Error("Tooling smoke measurement receipt is invalid.");
    }
    bySuite.get(receipt.suite).push(receipt);
  }

  const suites = {};
  for (const suite of SUITE_NAMES) {
    const suiteReceipts = bySuite.get(suite);
    if (suiteReceipts.length === 0) {
      throw new Error(`Tooling smoke measurements are missing suite ${suite}.`);
    }
    const shardCount = suiteReceipts[0].shardCount;
    const repeat = suiteReceipts[0].repeat;
    if (
      suiteReceipts.some(
        (receipt) =>
          receipt.shardCount !== shardCount || receipt.repeat !== repeat,
      )
    ) {
      throw new Error(
        `Tooling smoke ${suite} receipts disagree on their plan.`,
      );
    }
    const shardIndexes = suiteReceipts
      .map(({ shardIndex }) => shardIndex)
      .sort((a, b) => a - b);
    if (
      shardIndexes.length !== shardCount ||
      shardIndexes.some((value, index) => value !== index + 1)
    ) {
      throw new Error(`Tooling smoke ${suite} shard coverage is incomplete.`);
    }

    const attempts = [];
    for (let attempt = 1; attempt <= repeat; attempt += 1) {
      const unitTotals = new Map();
      let seconds = 0;
      let ok = true;
      for (const receipt of suiteReceipts) {
        const run = receipt.runs.find(
          (candidate) => candidate.attempt === attempt,
        );
        if (
          !run ||
          typeof run.ok !== "boolean" ||
          !Number.isFinite(run.seconds) ||
          run.seconds < 0 ||
          run.units === null ||
          typeof run.units !== "object"
        ) {
          throw new Error(
            `Tooling smoke ${suite} attempt ${attempt} is invalid.`,
          );
        }
        seconds += run.seconds;
        ok = ok && run.ok;
        for (const [name, value] of Object.entries(run.units)) {
          if (!Number.isFinite(value) || value < 0 || unitTotals.has(name)) {
            throw new Error(`Tooling smoke ${suite} unit coverage is invalid.`);
          }
          unitTotals.set(name, value);
        }
      }
      attempts.push({ seconds, ok, units: unitTotals });
    }

    const unitNames = new Set(
      attempts.flatMap(({ units }) => [...units.keys()]),
    );
    const units = Object.fromEntries(
      [...unitNames].sort().map((name) => {
        const observations = attempts
          .map(({ units: values }) => values.get(name))
          .filter((value) => Number.isFinite(value));
        return [
          name,
          {
            seconds: Number(
              (
                observations.reduce((total, value) => total + value, 0) /
                observations.length
              ).toFixed(3),
            ),
            runs: observations.length,
          },
        ];
      }),
    );
    const failures = attempts.filter(({ ok }) => !ok).length;
    suites[suite] = {
      seconds: Number(
        (
          attempts.reduce((total, attempt) => total + attempt.seconds, 0) /
          repeat
        ).toFixed(1),
      ),
      runs: repeat,
      failures,
      flaky: failures > 0 && failures < repeat,
      units,
    };
  }
  return { schemaVersion: 1, suites };
}

export function aggregateReceiptDirectory(directory) {
  return aggregateShardedMeasurements(
    receiptFiles(directory).map((file) =>
      JSON.parse(readFileSync(file, "utf8")),
    ),
  );
}

function runSuiteOnce(suite) {
  const files = suiteTestFiles(suite, REPO_ROOT);
  const startedAt = process.hrtime.bigint();
  const result = spawnSync(
    process.execPath,
    [
      "--test",
      "--test-reporter=spec",
      "--test-reporter-destination=stderr",
      "--test-reporter=junit",
      "--test-reporter-destination=stdout",
      ...files,
    ],
    {
      cwd: REPO_ROOT,
      encoding: "utf8",
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  const seconds = Number(process.hrtime.bigint() - startedAt) / 1e9;
  return {
    seconds,
    ok: result.status === 0,
    units: unitDurationsForSuite(
      suite,
      parseJUnitTestCases(result.stdout, REPO_ROOT),
    ),
  };
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
    const unitNames = new Set(runs.flatMap(({ units }) => Object.keys(units)));
    const units = Object.fromEntries(
      [...unitNames].sort().map((name) => {
        const observations = runs
          .map((run) => run.units[name])
          .filter((seconds) => Number.isFinite(seconds));
        const seconds =
          observations.reduce((total, value) => total + value, 0) /
          observations.length;
        return [
          name,
          {
            seconds: Number(seconds.toFixed(3)),
            runs: observations.length,
          },
        ];
      }),
    );
    measured[suite] = {
      seconds: Number(
        (
          runs.reduce((total, { seconds }) => total + seconds, 0) / runs.length
        ).toFixed(1),
      ),
      runs: runs.length,
      failures,
      // A suite that passes sometimes and fails sometimes across identical runs
      // is flaky by definition, and the report says so rather than hiding it.
      flaky: failures > 0 && failures < runs.length,
      units,
    };
  }
  return measured;
}

function main(argv) {
  const options = parseArgs(argv);
  if (options.aggregate) {
    process.stdout.write(
      `${JSON.stringify(aggregateReceiptDirectory(options.aggregate), null, 2)}\n`,
    );
    return;
  }
  if (options.suite) {
    const receipt = measureShard(options);
    if (receipt.runs.some(({ ok }) => !ok)) process.exitCode = 1;
    return;
  }
  const { repeat, suites, write } = options;
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

if (
  path.resolve(process.argv[1]) ===
  path.resolve(new URL(import.meta.url).pathname)
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
