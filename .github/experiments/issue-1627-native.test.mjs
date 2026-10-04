// Temporary experiment contracts; Linux results are not native proof.
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { BRANCH, SOURCE, DARWIN_REQUIRED, FOCUSED, OTHER_PLATFORM, PLAN, assertSeparate, runCommand, runProof, validateResults } from "./issue-1627-native.mjs";

const root = "/synthetic/packages/library-service";
function fixture(full = false) {
  const inventory = full ? [...FOCUSED, ...DARWIN_REQUIRED] : [...FOCUSED];
  if (full) for (let i = 0; inventory.length < 187; i++)
    inventory.push([`src/synthetic-${i % 22}.test.ts`, `synthetic contract ${i}`]);
  const entries = [...inventory.map((entry) => [entry, "passed"]), ...(full ? OTHER_PLATFORM.map((entry) => [entry, "skipped"]) : [])];
  const byFile = new Map();
  for (const [[file, fullName], status] of entries) {
    if (!byFile.has(file)) byFile.set(file, { name: path.join(root, file), status: "passed", message: "", assertionResults: [] });
    byFile.get(file).assertionResults.push({ fullName, status, failureMessages: [] });
  }
  // Required cases use three real files; use 21 synthetic files for 24 total.
  if (full) {
    const extra = byFile.get("src/synthetic-21.test.ts");
    byFile.get("src/synthetic-0.test.ts").assertionResults.push(...extra.assertionResults);
    byFile.delete("src/synthetic-21.test.ts");
    for (const entry of inventory) if (entry[0] === "src/synthetic-21.test.ts") entry[0] = "src/synthetic-0.test.ts";
  }
  return { inventory, json: { success: true, numFailedTests: 0, numFailedTestSuites: 0, numPendingTestSuites: 0, numTodoTests: 0, numTotalTests: entries.length, numPassedTests: inventory.length, numPendingTests: full ? 8 : 0, testResults: [...byFile.values()] } };
}
const check = (f, full = false) => validateResults(f.json, { packageRoot: root, full, inventory: f.inventory });
const assertion = (f, [, name]) => f.json.testResults.flatMap((file) => file.assertionResults).find((item) => item.fullName === name);
function temporary(t) {
  const dir = mkdtempSync(path.join(os.tmpdir(), "issue-1627-contract-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

test("exact focused and full case coverage, with only eight documented Linux skips", () => {
  assert.equal(check(fixture()).passed, 2);
  assert.equal(check(fixture(true), true).passed, 187);
  assert.equal(PLAN.length, 14);
  assert.deepEqual(PLAN.slice(1, -1), Array.from({ length: 12 }, (_, i) => `repeat-${i + 1}`));
});

test("every required case rejects missing, skipped, or failed coverage", () => {
  for (const required of [...FOCUSED, ...DARWIN_REQUIRED]) {
    for (const status of ["skipped", "failed"]) {
      const f = fixture(true);
      assertion(f, required).status = status;
      assert.throws(() => check(f, true));
    }
    const f = fixture(true);
    for (const file of f.json.testResults) file.assertionResults = file.assertionResults.filter((item) => item.fullName !== required[1]);
    assert.throws(() => check(f, true));
  }
});

test("rejects unexpected skips even with internally consistent green totals", () => {
  const f = fixture(true);
  const item = f.json.testResults.flatMap((file) => file.assertionResults).find((item) => item.fullName.startsWith("synthetic"));
  item.status = "skipped";
  f.json.numPassedTests--;
  f.json.numPendingTests++;
  assert.throws(() => check(f, true), /coverage differs/);
});

test("rejects malformed receipts, duplicate cases, failed suites, and incorrect totals", () => {
  for (const mutate of [
    (f) => { f.json.success = false; },
    (f) => { f.json.testResults[0].status = "failed"; },
    (f) => { f.json.testResults[0].message = "collection error"; },
    (f) => { f.json.testResults[0].assertionResults.push(f.json.testResults[0].assertionResults[0]); },
    (f) => { f.json.numTotalTests++; },
    (f) => { f.json.testResults[0].name = "/foreign/test.ts"; },
    (f) => { f.json.numTodoTests = 1; },
    (f) => { f.json.testResults[0].assertionResults[0].failureMessages = ["failed hook"]; },
  ]) {
    const f = fixture(true);
    mutate(f);
    assert.throws(() => check(f, true));
  }
});

test("real subprocess reports complete the fixed plan once without retries", async (t) => {
  const outputDir = temporary(t);
  const report = { runs: [] };
  let checks = 0;
  await runProof({ packageRoot: root, outputDir, inventory: fixture(true).inventory, report,
    assertFrozen: () => { checks++; },
    execute: async (args, name) => {
      assert.ok(args.includes("--retry=0"));
      assert.ok(args.includes("--bail=1"));
      const output = args.find((arg) => arg.startsWith("--outputFile=")).slice(13);
      return runCommand(process.execPath, ["--input-type=module", "-e", "import{writeFileSync}from'node:fs';writeFileSync(process.argv[1],process.argv[2])", output, JSON.stringify(fixture(name === "full").json)], { cwd: outputDir, log: path.join(outputDir, `${name}.log`), timeoutMs: 5000 });
    },
  });
  assert.equal(checks, 28);
  assert.deepEqual(report.runs.map(({ name }) => name), PLAN);
  assert.ok(report.runs.every(({ accepted }) => accepted));
});

test("failed, timed out, missing, or invalid JSON stops immediately and retains failure", async (t) => {
  for (const mode of ["exit", "timeout", "missing", "invalid", "coverage", "dirty"]) {
    const outputDir = path.join(temporary(t), mode);
    mkdirSync(outputDir);
    const report = { runs: [] };
    let calls = 0;
    await assert.rejects(runProof({ packageRoot: root, outputDir, inventory: [], report,
      assertFrozen: () => { if (mode === "dirty") throw new Error("checkout changed"); },
      execute: async (args) => {
        calls++;
        const output = args.find((arg) => arg.startsWith("--outputFile=")).slice(13);
        if (mode === "invalid") writeFileSync(output, "{");
        if (mode === "coverage") { const f = fixture(); assertion(f, FOCUSED[0]).status = "skipped"; writeFileSync(output, JSON.stringify(f.json)); }
        return { status: mode === "exit" ? 1 : 0, timedOut: mode === "timeout" };
      },
    }));
    assert.equal(calls, mode === "dirty" ? 0 : 1);
    const saved = JSON.parse(readFileSync(path.join(outputDir, "report.json")));
    assert.equal(saved.runs.length, 1);
    assert.equal(saved.runs[0].accepted, false);
    assert.ok(saved.runs[0].error);
  }
});

test("command timeout and launch error settle with diagnostic receipts", async (t) => {
  const cwd = temporary(t);
  const timeout = await runCommand(process.execPath, ["-e", "setInterval(()=>{},1000)"], { cwd, log: path.join(cwd, "timeout.log"), timeoutMs: 100 });
  assert.equal(timeout.timedOut, true);
  assert.equal(timeout.signal, "SIGKILL");
  const missing = await runCommand(path.join(cwd, "missing"), [], { cwd, log: path.join(cwd, "missing.log"), timeoutMs: 1000 });
  assert.equal(missing.status, null);
  assert.match(missing.error, /ENOENT/);
});

test("physical checkout separation rejects nested paths, equality, and symlink aliases", (t) => {
  const base = temporary(t);
  const dirs = ["candidate", "experiment", "receipts"].map((name) => path.join(base, name));
  dirs.forEach((dir) => mkdirSync(dir));
  assertSeparate(...dirs);
  assert.throws(() => assertSeparate(dirs[0], dirs[0], dirs[2]));
  const nested = path.join(dirs[0], "nested");
  mkdirSync(nested);
  assert.throws(() => assertSeparate(dirs[0], dirs[1], nested));
  const alias = path.join(base, "alias");
  symlinkSync(dirs[0], alias);
  assert.throws(() => assertSeparate(dirs[0], dirs[1], alias));
});

test("workflow stays manual, one bounded macOS job, read-only, pinned, and isolated", () => {
  const workflow = readFileSync(new URL("../workflows/tooling-nightly.yml", import.meta.url), "utf8");
  assert.match(workflow, /on:\n  workflow_dispatch:\n/);
  assert.doesNotMatch(workflow, /schedule:|pull_request:|push:|write|continue-on-error|matrix:/);
  assert.equal((workflow.match(/^  native-proof:/gm) ?? []).length, 1);
  assert.match(workflow, /runs-on: macos-14\n    timeout-minutes: 30/);
  assert.match(workflow, /contents: read/);
  assert.ok(workflow.includes(BRANCH));
  assert.equal((workflow.match(/persist-credentials: false/g) ?? []).length, 2);
  assert.ok(workflow.includes(`ref: ${SOURCE}`));
  assert.match(workflow, /ref: \$\{\{ github.sha \}\}/);
  for (const match of workflow.matchAll(/uses: (\S+)/g)) assert.match(match[1], /@[a-f0-9]{40}$/);
  assert.match(workflow, /group: issue-1627-native-experiment/);
  assert.match(workflow, /if: always\(\)/);
  assert.match(workflow, /node-version: 24.14.1/);
  assert.match(workflow, /npm@11.11.0/);
  assert.match(workflow, /NEVER MERGE/);
});

// Exercise the actual CLI rejection path without pretending Linux is macOS.
test("Linux CLI refuses native acceptance and retains a failed receipt", { skip: process.platform !== "linux" }, async (t) => {
  const cwd = temporary(t);
  const candidate = path.join(cwd, "candidate");
  const output = path.join(cwd, "proof");
  mkdirSync(candidate);
  const driver = new URL("./issue-1627-native.mjs", import.meta.url);
  const result = await runCommand(process.execPath, [driver.pathname, candidate, output], { cwd, log: path.join(cwd, "driver.log"), timeoutMs: 5000 });
  assert.equal(result.status, 1);
  const report = JSON.parse(readFileSync(path.join(output, "report.json")));
  assert.equal(report.accepted, false);
  assert.match(report.error, /native proof requires Darwin/);
  assert.equal(report.runs.length, 0);
});
