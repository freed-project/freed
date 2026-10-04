// Experiment-local contract checks; not added to required validation lanes.
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import yaml from "js-yaml";
import { makePlans, measure, SCHEDULES, SOURCE } from "./issue-1139-general.mjs";
import { buildToolingSmokeShardPlan } from "../../scripts/run-tooling-smoke-shard.mjs";
import { parseJUnitTestCases, unitDurationsForSuite } from "../../scripts/measure-tooling-smoke.mjs";

const runnerPath = path.resolve("scripts/run-tooling-smoke-shard.mjs");
function fixture(t, failing = false) {
  const root = mkdtempSync(path.join(os.tmpdir(), "issue-1139-experiment-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const repoRoot = path.join(root, "candidate");
  mkdirSync(path.join(repoRoot, "scripts/lib"), { recursive: true });
  const files = ["a", "b", "c"].map((name, index) => {
    const file = `scripts/${name}.test.mjs`;
    writeFileSync(path.join(repoRoot, file), `import test from 'node:test'; test('${name}', () => {${failing ? "throw new Error('fixture failure');" : ""}});\n//${"padding".repeat(index * 20)}\n`);
    return file;
  });
  const catalog = { suites: { general: { units: Object.fromEntries(files.map((file, index) => [file, { seconds: 3 - index }])) } } };
  const plans = makePlans(buildToolingSmokeShardPlan, repoRoot, catalog, files);
  return { root, repoRoot, plans, runnerPath, parseJUnitTestCases, unitDurationsForSuite, metadata: { source: "synthetic fixture" } };
}

test("manual workflow freezes source and caps work at two paired comparisons and eight shard runs", () => {
  assert.equal(existsSync(".github/workflows/issue-1139-general-experiment.yml"), false);
  const workflow = yaml.load(readFileSync(".github/workflows/tooling-nightly.yml", "utf8"));
  assert.deepEqual(Object.keys(workflow.on), ["workflow_dispatch"]);
  assert.deepEqual(workflow.permissions, { contents: "read" });
  assert.deepEqual(Object.keys(workflow.jobs), ["measure"]);
  const job = workflow.jobs.measure;
  assert.equal(job["runs-on"], "ubuntu-24.04");
  assert.equal(job["timeout-minutes"], 50);
  assert.deepEqual(job.strategy.matrix, { replicate: [1, 2] });
  assert.equal(job.strategy["max-parallel"], 2);
  assert.equal(job.strategy["fail-fast"], false);
  assert.deepEqual(SCHEDULES[1], [
    { mode: "bytes", shardIndex: 1 }, { mode: "durations", shardIndex: 1 },
    { mode: "durations", shardIndex: 2 }, { mode: "bytes", shardIndex: 2 },
  ]);
  assert.deepEqual(SCHEDULES[2], [
    { mode: "durations", shardIndex: 1 }, { mode: "bytes", shardIndex: 1 },
    { mode: "bytes", shardIndex: 2 }, { mode: "durations", shardIndex: 2 },
  ]);
  for (const step of job.steps.filter((step) => step.uses)) assert.match(step.uses, /@[a-f0-9]{40}$/u);
  const checkout = job.steps.find((step) => step.with?.path === "candidate");
  assert.equal(checkout.with.ref, SOURCE);
  assert.equal(checkout.with["persist-credentials"], false);
  assert.equal(job.steps.filter((step) => step.run?.includes("issue-1139-general.mjs")).length, 1);
  assert.ok(!JSON.stringify(workflow).includes("secrets."));
});

test("plans reject duplicate or missing files before execution", () => {
  const duplicate = () => ({ testFiles: ["a"] });
  assert.throws(() => makePlans(duplicate, "/unused", {}, ["a", "b"]), /overlapping/);
  const missing = ({ shardIndex }) => ({ testFiles: [shardIndex === 1 ? "a" : "c"] });
  assert.throws(() => makePlans(missing, "/unused", {}, ["a", "b", "c"]), /incomplete/);
});

test("each runner measures both indices and modes with real complete synthetic coverage", (t) => {
  const options = fixture(t);
  const reports = [1, 2].map((replicate) => measure({ ...options, replicate, outputDir: path.join(options.root, `receipts-${replicate}`) }));
  assert.equal(reports.flatMap((report) => report.runs).length, 8);
  for (const report of reports) {
    assert.deepEqual(report.runs.map(({ mode, shardIndex }) => ({ mode, shardIndex })), SCHEDULES[report.replicate]);
    for (const mode of ["bytes", "durations"]) {
      const runs = report.runs.filter((run) => run.mode === mode)
        .sort((a, b) => a.shardIndex - b.shardIndex);
      assert.deepEqual(runs.map((run) => run.shardIndex), [1, 2]);
      assert.equal(runs.reduce((n, run) => n + run.observedFiles, 0), 3);
      assert.ok(runs.every((run) => run.valid && run.seconds > 0));
      const seconds = runs.map((run) => run.seconds);
      assert.deepEqual(report.comparison[mode].seconds, seconds);
      assert.equal(report.comparison[mode].spread, Math.max(...seconds) / Math.min(...seconds));
    }
  }
});

test("failed shard preserves invalid receipt and stops before later rounds", (t) => {
  const options = fixture(t, true);
  const outputDir = path.join(options.root, "failed-receipts");
  assert.throws(() => measure({ ...options, replicate: 1, outputDir }), /failed or timed out/);
  const report = JSON.parse(readFileSync(path.join(outputDir, "report.json")));
  assert.equal(report.runs.length, 1);
  assert.equal(report.runs[0].valid, false);
  assert.notEqual(report.runs[0].status, 0);
});

test("a changed frozen input invalidates the observation and stops subsequent rounds", (t) => {
  const options = fixture(t);
  const outputDir = path.join(options.root, "changed-input-receipts");
  let checks = 0;
  assert.throws(() => measure({
    ...options, replicate: 1, outputDir,
    assertFrozen() {
      checks += 1;
      assert.equal(checks, 1, "catalog changed");
    },
  }), /catalog changed/);
  const report = JSON.parse(readFileSync(path.join(outputDir, "report.json")));
  assert.equal(report.runs.length, 1);
  assert.equal(report.runs[0].status, 0);
  assert.equal(report.runs[0].valid, false);
});
