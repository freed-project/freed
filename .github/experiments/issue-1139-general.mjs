// Temporary issue 1139 experiment. This never writes the timing catalog.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { closeSync, copyFileSync, existsSync, mkdirSync, openSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const SOURCE = "bfd3393a65a0532cb55dbd4a9a81d1aaf10939e7";
// One complete paired comparison per runner, two independent runner-level repeats.
// ABBA / BAAB counterbalances mode order for each shard index. Do not pool
// individual shard times across CPUs or call these four repeats per runner.
export const SCHEDULES = {
  1: [
    { mode: "bytes", shardIndex: 1 },
    { mode: "durations", shardIndex: 1 },
    { mode: "durations", shardIndex: 2 },
    { mode: "bytes", shardIndex: 2 },
  ],
  2: [
    { mode: "durations", shardIndex: 1 },
    { mode: "bytes", shardIndex: 1 },
    { mode: "bytes", shardIndex: 2 },
    { mode: "durations", shardIndex: 2 },
  ],
};
const hash = (value) => createHash("sha256").update(value).digest("hex");
const save = (file, value) => writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);

// ElementTree preserves nested suite identity and repeated case occurrences.
// Only identities/statuses enter this contract, never observed durations.
export function caseInventory(xml) {
  const parsed = spawnSync("python3", ["-c", `
import json,sys,xml.etree.ElementTree as E
rows=[]
def walk(element, parents):
  if element.tag in ('failure','error'): raise ValueError('JUnit failure/error')
  if element.tag=='testsuite': parents=parents+[element.attrib['name']]
  if element.tag=='testcase':
    file=element.attrib['file']
    if '/scripts/' in file: file='scripts/'+file.split('/scripts/',1)[1]
    if not file.startswith('scripts/'): raise ValueError('foreign test path')
    rows.append([file,parents+[element.attrib['name']], 'skipped' if element.find('skipped') is not None else 'passed'])
  for child in element: walk(child,parents)
walk(E.fromstring(sys.stdin.read()),[])
print(json.dumps(rows))
`], { input: xml, encoding: "utf8", timeout: 10_000, maxBuffer: 16 * 1024 * 1024 });
  assert.equal(parsed.status, 0, parsed.stderr || parsed.error?.message);
  const grouped = new Map();
  for (const [file, names, status] of JSON.parse(parsed.stdout)) {
    if (!grouped.has(file)) grouped.set(file, []);
    grouped.get(file).push([names, status]);
  }
  return Object.fromEntries([...grouped].sort(([a], [b]) => a.localeCompare(b)).map(([file, rows]) => {
    rows.sort((a, b) => JSON.stringify(a) < JSON.stringify(b) ? -1 : JSON.stringify(a) > JSON.stringify(b) ? 1 : 0);
    return [file, { cases: rows.length, passed: rows.filter(([, status]) => status === "passed").length,
      skipped: rows.filter(([, status]) => status === "skipped").map(([names]) => names),
      identitySha256: hash(JSON.stringify(rows)) }];
  }));
}

export function verifyCases(xml, files, expected) {
  const actual = caseInventory(xml);
  assert.deepEqual(Object.keys(actual).sort(), [...files].sort(), "case file coverage differs");
  for (const file of files) assert.deepEqual(actual[file], expected[file], `case identity/status coverage differs: ${file}`);
  return actual;
}

function command(command, args, cwd) {
  const result = spawnSync(command, args, { cwd, encoding: "utf8" });
  assert.equal(result.status, 0, `${command}: ${result.stderr ?? result.error}`);
  return result.stdout.trim();
}

export function makePlans(build, repoRoot, catalog, files) {
  const plans = {};
  for (const mode of ["bytes", "durations"]) {
    plans[mode] = [1, 2].map((shardIndex) => build(
      { suite: "general", shardIndex, shardCount: 2 },
      { repoRoot, durations: mode === "bytes" ? {} : catalog },
    ));
    const assigned = plans[mode].flatMap((plan) => plan.testFiles);
    assert.equal(new Set(assigned).size, assigned.length, "overlapping shards");
    assert.deepEqual([...assigned].sort(), [...files].sort(), "incomplete file coverage");
  }
  return plans;
}

// The caller supplies the frozen runner and parser. Tests use a tiny real fixture;
// the production CLI below permits only SOURCE and its exact 72-file inventory.
export function measure({ repoRoot, outputDir, replicate, plans, runnerPath, parseJUnitTestCases, unitDurationsForSuite, expectedCases, metadata, assertFrozen = () => {} }) {
  assert.ok([1, 2].includes(replicate));
  mkdirSync(outputDir, { recursive: true });
  const schedule = SCHEDULES[replicate];
  const report = { schemaVersion: 2, ...metadata, replicate, schedule, plans, runs: [] };
  save(path.join(outputDir, "report.json"), report);
  for (const [round, { mode, shardIndex }] of schedule.entries()) {
    assertFrozen();
    const plan = plans[mode][shardIndex - 1];
    const name = `${round + 1}-${mode}-shard-${shardIndex}`;
    const planFile = path.join(outputDir, `${name}.plan.json`);
    save(planFile, plan);
    const junit = path.join(repoRoot, "tooling-smoke-results", `general-${shardIndex}-of-2.xml`);
    rmSync(junit, { force: true });
    const log = openSync(path.join(outputDir, `${name}.log`), "w");
    const code = `import {readFileSync} from 'node:fs'; import {runToolingSmokeShard} from ${JSON.stringify(pathToFileURL(runnerPath).href)}; runToolingSmokeShard(JSON.parse(readFileSync(process.argv[1])), {repoRoot:process.argv[2]});`;
    const startedAt = new Date().toISOString();
    const start = process.hrtime.bigint();
    let result;
    try {
      result = spawnSync("timeout", ["--signal=TERM", "--kill-after=5s", "600s", process.execPath, "--input-type=module", "--eval", code, planFile, repoRoot], { cwd: repoRoot, stdio: ["ignore", log, log] });
    } finally {
      closeSync(log);
    }
    const run = { round: round + 1, mode, shardIndex, startedAt, endedAt: new Date().toISOString(), seconds: Number(process.hrtime.bigint() - start) / 1e9, status: result.status, signal: result.signal, error: result.error?.message, valid: false };
    report.runs.push(run);
    try {
      if (existsSync(junit)) copyFileSync(junit, path.join(outputDir, `${name}.xml`));
      assert.equal(result.status, 0, `${name} failed or timed out`);
      const xml = readFileSync(junit, "utf8");
      assert.ok(!/<(?:failure|error)\b/u.test(xml), "JUnit failure/error");
      const observed = unitDurationsForSuite("general", parseJUnitTestCases(xml, repoRoot), { repoRoot });
      assert.deepEqual(Object.keys(observed).sort(), [...plan.testFiles].sort(), "JUnit file coverage differs from plan");
      run.observedFiles = Object.keys(observed).length;
      run.caseCoverage = verifyCases(xml, plan.testFiles, expectedCases);
      assertFrozen();
      run.valid = true;
    } catch (error) {
      run.invalidReason = error.message;
      throw error;
    } finally {
      save(path.join(outputDir, "report.json"), report);
    }
    console.log(`${name}: ${run.seconds.toFixed(3)}s, ${run.observedFiles.toLocaleString()} files, pass`);
  }
  // Both shard observations in each mode belong to this one runner/CPU.
  report.comparison = Object.fromEntries(["bytes", "durations"].map((mode) => {
    const runs = report.runs.filter((run) => run.mode === mode)
      .sort((left, right) => left.shardIndex - right.shardIndex);
    assert.deepEqual(runs.map((run) => run.shardIndex), [1, 2]);
    assert.ok(runs.every((run) => run.valid));
    const seconds = runs.map((run) => run.seconds);
    return [mode, { seconds, spread: Math.max(...seconds) / Math.min(...seconds) }];
  }));
  save(path.join(outputDir, "report.json"), report);
  return report;
}

async function main(args) {
  assert.equal(args.length, 3, "Usage: issue-1139-general.mjs <candidate> <receipts> <replicate:1|2>");
  const [source, output, index] = args;
  assert.match(index, /^[12]$/u);
  const repoRoot = path.resolve(source);
  const outputDir = path.resolve(output);
  assert.ok(!outputDir.startsWith(`${repoRoot}${path.sep}`), "receipts must be outside the candidate");
  assert.equal(command("git", ["rev-parse", "HEAD"], repoRoot), SOURCE);
  assert.equal(process.version, "v24.14.1");
  assert.equal(process.umask(), 0o022, "fixture umask must be 0022");
  assert.equal(command("npm", ["--version"], repoRoot), "11.11.0");
  assert.equal(command("go", ["version"], repoRoot), "go version go1.27.1 linux/amd64");
  assert.equal(command("bash", ["-lc", "go version"], repoRoot), "go version go1.27.1 linux/amd64");
  assert.equal(process.platform, "linux");
  assert.equal(process.arch, "x64");
  command("/usr/bin/file", ["--version"], repoRoot);
  const catalogPath = path.join(repoRoot, "scripts/tooling-smoke-durations.json");
  const catalogBytes = readFileSync(catalogPath);
  const catalogSha256 = hash(catalogBytes);
  const assertFrozen = () => {
    assert.equal(command("git", ["rev-parse", "HEAD"], repoRoot), SOURCE, "candidate HEAD changed");
    assert.equal(command("git", ["status", "--porcelain", "--untracked-files=no"], repoRoot), "", "candidate tracked files changed");
    assert.equal(hash(readFileSync(catalogPath)), catalogSha256, "catalog changed");
  };
  assertFrozen();
  const runnerPath = path.join(repoRoot, "scripts/run-tooling-smoke-shard.mjs");
  const { buildToolingSmokeShardPlan } = await import(pathToFileURL(runnerPath));
  const { generalTestFiles } = await import(pathToFileURL(path.join(repoRoot, "scripts/lib/tooling-smoke-suites.mjs")));
  const { parseJUnitTestCases, unitDurationsForSuite } = await import(pathToFileURL(path.join(repoRoot, "scripts/measure-tooling-smoke.mjs")));
  const files = generalTestFiles(repoRoot);
  const coverage = JSON.parse(readFileSync(new URL("./issue-1139-general-coverage.json", import.meta.url)));
  assert.equal(coverage.source, SOURCE);
  assert.equal(files.length, 72);
  assert.deepEqual([...files].sort(), Object.keys(coverage.files).sort(), "frozen file inventory differs");
  const plans = makePlans(buildToolingSmokeShardPlan, repoRoot, JSON.parse(catalogBytes), files);
  measure({ repoRoot, outputDir, replicate: Number(index), plans, runnerPath, parseJUnitTestCases, unitDurationsForSuite, expectedCases: coverage.files, assertFrozen, metadata: {
    source: SOURCE, experiment: process.env.GITHUB_SHA ?? null, catalogSha256,
    node: process.version, npm: "11.11.0", go: "1.27.1", platform: process.platform, arch: process.arch,
    availableParallelism: os.availableParallelism(), cpuModel: os.cpus()[0]?.model, totalMemory: os.totalmem(),
    kernel: os.release(), image: process.env.ImageOS ?? null, imageVersion: process.env.ImageVersion ?? null,
    files, coverageReference: coverage.reference, comparisonUnit: "One full byte/duration comparison on this runner; two runners provide two repeats. Do not pool shard times across runners.",
    timing: "Monotonic subprocess wall seconds, excluding install and artifact upload. No planner estimates.",
  } });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch((error) => { console.error(error.message); process.exitCode = 1; });
}
