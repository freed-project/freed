// Temporary issue 1139 experiment. This never writes the timing catalog.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { closeSync, copyFileSync, existsSync, mkdirSync, openSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const SOURCE = "1d7045a16e01e5551dc452b62734bec0130473fb";
export const MODES = ["bytes", "durations", "durations", "bytes"];
const hash = (value) => createHash("sha256").update(value).digest("hex");
const save = (file, value) => writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);

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
// the production CLI below permits only SOURCE and exactly 71 general files.
export function measure({ repoRoot, outputDir, shardIndex, plans, runnerPath, parseJUnitTestCases, unitDurationsForSuite, metadata, assertFrozen = () => {} }) {
  assert.ok([1, 2].includes(shardIndex));
  mkdirSync(outputDir, { recursive: true });
  const report = { ...metadata, shardIndex, modes: MODES, plans, runs: [] };
  save(path.join(outputDir, "report.json"), report);
  for (const [round, mode] of MODES.entries()) {
    assertFrozen();
    const plan = plans[mode][shardIndex - 1];
    const name = `${round + 1}-${mode}`;
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
    const run = { round: round + 1, mode, startedAt, endedAt: new Date().toISOString(), seconds: Number(process.hrtime.bigint() - start) / 1e9, status: result.status, signal: result.signal, error: result.error?.message, valid: false };
    report.runs.push(run);
    try {
      if (existsSync(junit)) copyFileSync(junit, path.join(outputDir, `${name}.xml`));
      assert.equal(result.status, 0, `${name} failed or timed out`);
      const xml = readFileSync(junit, "utf8");
      assert.ok(!/<(?:failure|error)\b/u.test(xml), "JUnit failure/error");
      const observed = unitDurationsForSuite("general", parseJUnitTestCases(xml, repoRoot), { repoRoot });
      assert.deepEqual(Object.keys(observed).sort(), [...plan.testFiles].sort(), "JUnit file coverage differs from plan");
      run.observedFiles = Object.keys(observed).length;
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
  return report;
}

async function main(args) {
  assert.equal(args.length, 3, "Usage: issue-1139-general.mjs <candidate> <receipts> <1|2>");
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
    assert.equal(command("git", ["status", "--porcelain", "--untracked-files=no"], repoRoot), "", "candidate tracked files changed");
    assert.equal(hash(readFileSync(catalogPath)), catalogSha256, "catalog changed");
  };
  assertFrozen();
  const runnerPath = path.join(repoRoot, "scripts/run-tooling-smoke-shard.mjs");
  const { buildToolingSmokeShardPlan } = await import(pathToFileURL(runnerPath));
  const { generalTestFiles } = await import(pathToFileURL(path.join(repoRoot, "scripts/lib/tooling-smoke-suites.mjs")));
  const { parseJUnitTestCases, unitDurationsForSuite } = await import(pathToFileURL(path.join(repoRoot, "scripts/measure-tooling-smoke.mjs")));
  const files = generalTestFiles(repoRoot);
  assert.equal(files.length, 71);
  const plans = makePlans(buildToolingSmokeShardPlan, repoRoot, JSON.parse(catalogBytes), files);
  measure({ repoRoot, outputDir, shardIndex: Number(index), plans, runnerPath, parseJUnitTestCases, unitDurationsForSuite, assertFrozen, metadata: {
    source: SOURCE, experiment: process.env.GITHUB_SHA ?? null, catalogSha256,
    node: process.version, npm: "11.11.0", go: "1.27.1", platform: process.platform, arch: process.arch,
    availableParallelism: os.availableParallelism(), cpuModel: os.cpus()[0]?.model, totalMemory: os.totalmem(),
    kernel: os.release(), image: process.env.ImageOS ?? null, imageVersion: process.env.ImageVersion ?? null,
    files, timing: "Monotonic subprocess wall seconds, excluding install and artifact upload. No planner estimates.",
  } });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch((error) => { console.error(error.message); process.exitCode = 1; });
}
