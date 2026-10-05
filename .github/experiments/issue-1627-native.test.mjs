// Temporary experiment contracts; Linux results are not native proof.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { BRANCH, SOURCE, DARWIN_REQUIRED, FOCUSED, OTHER_PLATFORM, PLAN, assertSeparate, npmNodeArgs, runCommand, runProof, validateResults } from "./issue-1627-native.mjs";

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

test("rejects malformed receipts, unexpected duplicate cases, failed suites, and incorrect totals", () => {
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


test("repaired launch supplies genuine pinned npm identity in a package workspace", (t) => {
  const cwd = temporary(t);
  writeFileSync(path.join(cwd, "package.json"), JSON.stringify({ private: true, workspaces: ["packages/*"] }));
  const workspace = path.join(cwd, "packages/library-service");
  mkdirSync(workspace, { recursive: true });
  writeFileSync(path.join(workspace, "package.json"), JSON.stringify({ name: "@fixture/library-service", private: true }));
  const probe = path.join(cwd, "npm identity probe.mjs");
  writeFileSync(probe, `
    import assert from "node:assert/strict";
    import { spawnSync } from "node:child_process";
    const npmCli = process.env.npm_execpath;
    assert.ok(npmCli, "npm must supply npm_execpath");
    const version = spawnSync(process.execPath, [npmCli, "--version"], { encoding: "utf8" });
    assert.equal(version.status, 0);
    console.log(JSON.stringify({ npmCli, npmVersion: version.stdout.trim(),
      node: process.execPath, nodeVersion: process.version,
      npmNode: process.env.npm_node_execpath, cwd: process.cwd(), args: process.argv.slice(2) }));
  `);
  const npm = path.join(path.dirname(process.execPath), "npm");
  // Remove inherited npm metadata so a parent npm invocation cannot mask this
  // regression. Only real npm may restore it in the child.
  const env = { ...process.env };
  for (const name of Object.keys(env)) if (/^npm_/i.test(name)) delete env[name];
  const args = ["--retry=0", "--bail=1", "^(?:exact first case|exact second case)$"];
  const direct = spawnSync(process.execPath, [probe, ...args], { cwd: workspace, env, encoding: "utf8", timeout: 10_000 });
  assert.notEqual(direct.status, 0, "direct Node launch must reproduce missing npm metadata");
  assert.match(direct.stderr, /npm must supply npm_execpath/);
  const launched = spawnSync(npm, npmNodeArgs([probe, ...args]), { cwd: workspace, env, encoding: "utf8", timeout: 10_000 });
  assert.equal(launched.status, 0, launched.stderr);
  const receipt = JSON.parse(launched.stdout);
  assert.equal(realpathSync(receipt.npmCli), realpathSync(npm));
  assert.equal(receipt.npmVersion, "11.11.0");
  assert.equal(receipt.nodeVersion, "v24.14.1");
  assert.equal(realpathSync(receipt.node), realpathSync(process.execPath));
  assert.equal(realpathSync(receipt.npmNode), realpathSync(process.execPath));
  assert.equal(realpathSync(receipt.cwd), realpathSync(workspace));
  assert.deepEqual(receipt.args, args);
  assert.deepEqual(npmNodeArgs([]), ["exec", "--offline", "--yes=false", "--", "node"]);
  const failure = spawnSync(npm, npmNodeArgs(["-e", "process.exit(23)"]), { cwd: workspace, env, encoding: "utf8", timeout: 10_000 });
  assert.equal(failure.status, 23, "npm must preserve test process failure");
});


// This synthetic case runs without downloaded artifacts. Replace three ordinary
// rows with equal names in both discovery and results, keeping every occurrence.
test("matches exact parameter multiplicities and rejects same-total substitutions", () => {
  const f = fixture(true);
  const file = f.json.testResults.find((item) => item.name.endsWith("synthetic-0.test.ts"));
  const originalNames = file.assertionResults.slice(0, 3).map((item) => item.fullName);
  for (const item of file.assertionResults.slice(0, 3)) item.fullName = "parameterized duplicate";
  for (const entry of f.inventory) if (entry[0] === "src/synthetic-0.test.ts" && originalNames.includes(entry[1])) entry[1] = "parameterized duplicate";
  const coverage = check(f, true);
  assert.equal(coverage.cases.filter(([id]) => id.endsWith("\nparameterized duplicate")).length, 3);
  for (const direction of ["extra", "missing"]) {
    const mutated = structuredClone(f);
    const rows = mutated.json.testResults.find((item) => item.name === file.name).assertionResults;
    if (direction === "extra") rows[3].fullName = rows[0].fullName;
    else rows[0].fullName = rows[3].fullName;
    assert.throws(() => check(mutated, true), /coverage differs/);
  }
});

// Opt-in real receipt replay: ISSUE_1627_REPLAY_DIR=<retained artifact directory>
// node --test .github/experiments/issue-1627-native.test.mjs
// No original receipt is written; all negative probes mutate in-memory clones.
if (process.env.ISSUE_1627_REPLAY_DIR) {
  test("retained native receipts preserve multiplicities and reject coverage mutations", () => {
    const receiptRoot = path.join(process.env.ISSUE_1627_REPLAY_DIR, "proof");
    const read = (name) => JSON.parse(readFileSync(path.join(receiptRoot, `${name}.json`)));
    const original = read("report");
    // Historical parser regression fixture remains bound to its original source.
    assert.equal(original.source, "69f8446a5050a6881cb08a0064c7bfb59a6cacf4");
    assert.equal(original.run.id, "37244898484");
    assert.equal(original.experiment, "17401d170d83d828a4c9f0813304ba3478e405b4");
    assert.equal(original.accepted, false, "retain original wrapper failure");
    const packageRoot = "/Users/runner/work/freed/freed/candidate/packages/library-service";
    const inventory = read("discovery").map(({ file, name }) => [path.relative(packageRoot, file), name.replaceAll(" > ", " ")]);
    assert.deepEqual(inventory, original.inventory);
    assert.deepEqual(original.runs.map(({ name }) => name), PLAN);
    for (const run of original.runs) {
      assert.equal(run.status, 0);
      assert.equal(run.timedOut, false);
      validateResults(read(run.name), { packageRoot, full: run.name === "full", inventory });
    }
    const full = read("full");
    const validate = (json, expected = inventory) => validateResults(json, { packageRoot, full: true, inventory: expected });
    const coverage = validate(full);
    assert.equal(coverage.cases.length, 195);
    assert.equal(coverage.passed, 187);
    assert.equal(coverage.skipped, 8);
    assert.equal(coverage.files.length, 24);
    const duplicateGroups = [
      ["src/linux-acl-proof.test.ts", "Linux Library service ACL proof rejects an extended ACL", 3],
      ["src/linux-acl-proof.test.ts", "Linux Library service ACL proof rejects malformed or mode-inconsistent output", 4],
      ["src/local-actor-transport.test.ts", "Library service local actor transport rejects a closed invalid frame", 3],
    ];
    for (const [file, name, multiplicity] of duplicateGroups) {
      assert.equal(coverage.cases.filter(([id]) => id === `${file}\n${name}`).length, multiplicity);
      for (const mutation of ["extra", "missing", "replace-other", "replace-duplicate", "failed", "skipped"]) {
        const changed = structuredClone(full);
        const rows = changed.testResults.find((item) => item.name === path.join(packageRoot, file)).assertionResults;
        const index = rows.findIndex((item) => item.fullName === name);
        const other = rows.find((item) => item.fullName !== name);
        if (mutation === "extra") { rows.push(structuredClone(rows[index])); changed.numTotalTests++; changed.numPassedTests++; }
        if (mutation === "missing") { rows.splice(index, 1); changed.numTotalTests--; changed.numPassedTests--; }
        // Both preserve totals; replacing a duplicate also preserves distinct names.
        if (mutation === "replace-other") other.fullName = name;
        if (mutation === "replace-duplicate") rows[index].fullName = other.fullName;
        if (mutation === "failed") { rows[index].status = "failed"; changed.numPassedTests--; changed.numFailedTests++; changed.success = false; }
        if (mutation === "skipped") { rows[index].status = "skipped"; changed.numPassedTests--; changed.numPendingTests++; }
        assert.throws(() => validate(changed), undefined, `${file}: ${mutation}`);
      }
      const alteredInventory = structuredClone(inventory);
      const index = alteredInventory.findIndex((entry) => entry[0] === file && entry[1] === name);
      alteredInventory[index][1] = "unexpected inventory duplicate replacement";
      assert.throws(() => validate(full, alteredInventory), /coverage differs/);
    }
    const cliCase = ["src/cli.test.ts", "freed-library CLI runs the installed npm bin symlink and fails closed with bounded stderr"];
    for (const required of [...FOCUSED, ...DARWIN_REQUIRED, cliCase]) {
      const changed = structuredClone(full);
      const rows = changed.testResults.find((item) => item.name === path.join(packageRoot, required[0])).assertionResults;
      rows.find((item) => item.fullName === required[1]).status = "skipped";
      changed.numPassedTests--; changed.numPendingTests++;
      assert.throws(() => validate(changed));
    }
  });
}
