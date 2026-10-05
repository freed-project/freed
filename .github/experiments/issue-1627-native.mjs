// Branch-only proof for issue 1627 / PR 2114. NEVER MERGE this experiment.
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const SOURCE = "6364f7c7cc60413ffabb2388fcbf6375a8eefd9e";
export const BRANCH = "refs/heads/chore/library-integration-native-proof";
const RUNTIME = "src/runtime.integration.test.ts";
const runtimeCase = (title) => [RUNTIME, `compiled freed-library runtime ${title}`];
export const FOCUSED = [
  runtimeCase("settles a launched sidecar that drains startup input but closes stdout without ready"),
  runtimeCase("reports spawn_failed for a pinned executable with a missing interpreter"),
];
export const DARWIN_REQUIRED = [
  ...[
    "runs the real descriptor-bound native sidecar against normalized SQLite",
    "binds installed Primary identity through the real native command channel",
    "keeps the real sidecar lease and SQLite on fd4 after its visible root is replaced",
    "fails the real native sidecar closed for unsupported backend before ready",
    "fails the real native sidecar closed for admission digest drift before ready",
    "keeps doctor and status read-only with a root-owned pinned executable",
    "keeps runtime status writes on the bound file after state-root replacement",
  ].map(runtimeCase),
  ["src/service-definition.test.ts", "installed Library service definitions emits a plist accepted by the platform parser"],
];
// These eight declarations use linuxIt in the frozen source. No Darwin,
// authority, root-owned CLI, or changed fixture case is an allowed skip.
export const OTHER_PLATFORM = [
  runtimeCase("reports the production Linux ACL proof without assuming a clean runner root"),
  ...[
    "reopens a complete credential after writer termination before-rename",
    "reopens a complete credential after writer termination after-rename",
    "invalidates cached tokens after record replace and recovers only with a new token port",
    "invalidates cached tokens after record remove and recovers only with a new token port",
    "atomically creates and replaces a private sealed record",
    "preserves corrupt existing data and refuses links or nonprivate files",
    "fences key content changes and a renamed bound directory",
  ].map((title) => ["src/linux-drive-credential-store.test.ts", `Linux descriptor-bound Drive credential files ${title}`]),
];
export const PLAN = ["focused", ...Array.from({ length: 12 }, (_, i) => `repeat-${i + 1}`), "full"];
const key = ([file, name]) => `${file}\n${name}`;
const save = (file, value) => writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
const sorted = (values) => [...values].sort();

export function validateResults(json, { packageRoot, full = false, inventory = [] }) {
  assert.equal(json.success, true, "Vitest did not report success");
  for (const field of ["numFailedTests", "numFailedTestSuites", "numTodoTests", "numPendingTestSuites"])
    assert.equal(json[field], 0, field);
  assert.ok(Array.isArray(json.testResults) && json.testResults.length > 0, "missing results");
  // Parameterized tests can share a fullName. Preserve every occurrence and
  // compare sorted lists below as multisets, never deduplicate the receipt.
  const cases = [];
  const files = [];
  for (const file of json.testResults) {
    const relative = path.relative(packageRoot, file.name);
    assert.ok(!relative.startsWith("..") && !path.isAbsolute(relative), "foreign test file");
    assert.equal(file.status, "passed", relative);
    assert.equal(file.message, "", `suite error: ${relative}`);
    files.push(relative);
    for (const item of file.assertionResults) {
      const id = key([relative, item.fullName]);
      assert.deepEqual(item.failureMessages, [], id);
      assert.ok(item.status === "passed" || item.status === "skipped", `unexpected state: ${id}: ${item.status}`);
      cases.push([id, item.status]);
    }
  }
  assert.equal(new Set(files).size, files.length, "duplicate result file");
  assert.equal(json.numTotalTests, cases.length, "case count mismatch");
  const passed = cases.filter(([, status]) => status === "passed").map(([id]) => id);
  assert.equal(json.numPassedTests, passed.length, "pass count mismatch");
  assert.equal(json.numPendingTests, cases.length - passed.length, "skip count mismatch");
  for (const required of [...FOCUSED, ...(full ? DARWIN_REQUIRED : [])])
    assert.deepEqual(cases.filter(([id]) => id === key(required)).map(([, status]) => status), ["passed"], `required case missing, repeated or not passed: ${key(required)}`);
  if (full) {
    assert.equal(cases.length, 195, "frozen Darwin suite must contain 195 cases");
    assert.equal(files.length, 24, "frozen package must contain 24 files");
    assert.equal(inventory.length, 187, "Darwin discovery must contain 187 runnable cases");
    assert.deepEqual(sorted(passed), sorted(inventory.map(key)), "runnable case coverage differs from discovery");
    assert.deepEqual(sorted(cases.map(([id]) => id)), sorted([...inventory, ...OTHER_PLATFORM].map(key)), "full coverage differs");
    for (const entry of OTHER_PLATFORM)
      assert.deepEqual(cases.filter(([id]) => id === key(entry)).map(([, status]) => status), ["skipped"], `expected documented Linux-only skip: ${key(entry)}`);
  } else {
    assert.deepEqual(files, [RUNTIME]);
    assert.equal(new Set(cases.map(([id]) => id)).size, cases.length, "unexpected duplicate focused case");
    // Vitest reports filtered declarations as skipped in a focused run.
    assert.deepEqual(sorted(passed), sorted(FOCUSED.map(key)), "focused pass coverage differs");
  }
  return { passed: passed.length, skipped: cases.length - passed.length, files, cases };
}

// Each command owns a POSIX process group, killed on timeout. Detached test
// sidecars retain their fixture watchdog cleanup. Failed commands never pass.
export async function runCommand(command, args, { cwd, log, timeoutMs }) {
  const fd = openSync(log, "w");
  const startedAt = new Date().toISOString();
  const start = process.hrtime.bigint();
  let timedOut = false;
  let timer;
  try {
    const result = await new Promise((resolve) => {
      const child = spawn(command, args, { cwd, detached: true, stdio: ["ignore", fd, fd] });
      timer = setTimeout(() => {
        timedOut = true;
        try { process.kill(-child.pid, "SIGKILL"); } catch (error) { if (error.code !== "ESRCH") throw error; }
      }, timeoutMs);
      child.once("error", (error) => resolve({ status: null, error: error.message }));
      child.once("close", (status, signal) => resolve({ status, signal }));
    });
    return { command, args, startedAt, seconds: Number(process.hrtime.bigint() - start) / 1e9, ...result, timedOut };
  } finally {
    clearTimeout(timer);
    closeSync(fd);
  }
}

// Let pinned npm provide its normal script environment, including npm_execpath.
// Use the installed Node command and explicit local script path; never fetch a
// package or synthesize npm environment variables in the experiment driver.
export function npmNodeArgs(args) {
  return ["exec", "--offline", "--yes=false", "--", "node", ...args];
}

export async function runProof({ packageRoot, outputDir, inventory, execute, assertFrozen = () => {}, report }) {
  for (const name of PLAN) {
    const run = { name, accepted: false };
    report.runs.push(run);
    try {
      assertFrozen();
      const jsonPath = path.join(outputDir, `${name}.json`);
      const args = ["run", "--retry=0", "--bail=1", "--reporter=json", `--outputFile=${jsonPath}`];
      if (name !== "full") args.push(RUNTIME, "-t", `^(?:${FOCUSED.map(([, title]) => title).join("|")})$`);
      Object.assign(run, await execute(args, name));
      assert.equal(run.timedOut, false, `${name} timed out`);
      assert.equal(run.status, 0, `${name} subprocess failed`);
      run.coverage = validateResults(JSON.parse(readFileSync(jsonPath, "utf8")), { packageRoot, full: name === "full", inventory });
      assertFrozen();
      run.accepted = true;
    } catch (error) {
      run.error = error.message;
      throw error;
    } finally { save(path.join(outputDir, "report.json"), report); }
  }
}

function command(command, args, cwd) {
  const result = spawnSync(command, args, { cwd, encoding: "utf8", timeout: 15_000 });
  assert.equal(result.status, 0, `${command}: ${result.stderr || result.error}`);
  return result.stdout.trim();
}

export function assertSeparate(candidate, experiment, receipts) {
  const paths = [candidate, experiment, receipts].map((value) => existsSync(value)
    ? realpathSync(value)
    : path.join(realpathSync(path.dirname(value)), path.basename(value)));
  for (let i = 0; i < paths.length; i++) for (let j = i + 1; j < paths.length; j++) {
    const relative = path.relative(paths[i], paths[j]);
    const reverse = path.relative(paths[j], paths[i]);
    assert.ok(relative && relative.startsWith(`..${path.sep}`) && reverse.startsWith(`..${path.sep}`), "checkouts and receipts must be disjoint physical directories");
  }
}

async function main(args) {
  assert.equal(args.length, 2, "Usage: issue-1627-native.mjs <candidate> <new-receipts-directory>");
  const candidate = realpathSync(args[0]);
  const experiment = realpathSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../.."));
  const outputDir = path.resolve(args[1]);
  // Refuse stale receipts and path aliases before writing any evidence.
  assertSeparate(candidate, experiment, outputDir);
  mkdirSync(outputDir);
  const packageRoot = path.join(candidate, "packages/library-service");
  const report = { schemaVersion: 1, accepted: false, source: SOURCE, plan: PLAN, runs: [], setup: [], platform: process.platform, arch: process.arch, node: process.version, startedAt: new Date().toISOString() };
  const persist = () => save(path.join(outputDir, "report.json"), report);
  persist();
  try {
    assert.equal(process.platform, "darwin", "native proof requires Darwin; Linux is not evidence");
    assert.equal(process.version, "v24.14.1");
    assert.equal(process.umask(), 0o022);
    assert.equal(process.env.GITHUB_EVENT_NAME, "workflow_dispatch");
    assert.equal(process.env.GITHUB_REF, BRANCH);
    report.experiment = command("git", ["rev-parse", "HEAD"], experiment);
    assert.equal(report.experiment, process.env.GITHUB_SHA);
    report.executables = { node: process.execPath, npm: command("which", ["npm"], candidate), npx: command("which", ["npx"], candidate) };
    for (const executable of Object.values(report.executables)) assert.equal(path.dirname(executable), path.dirname(process.execPath), "mixed Node toolchain");
    report.sourceTree = command("git", ["rev-parse", `${SOURCE}^{tree}`], candidate);
    report.experimentTree = command("git", ["rev-parse", "HEAD^{tree}"], experiment);
    report.npm = command("npm", ["--version"], candidate);
    assert.equal(report.npm, "11.11.0");
    report.macos = command("sw_vers", [], candidate);
    assert.match(command("sw_vers", ["-productVersion"], candidate), /^14\./u);
    report.kernel = os.release();
    report.machine = command("uname", ["-m"], candidate);
    report.rust = command("rustc", ["-Vv"], candidate);
    report.cargo = command("cargo", ["--version"], candidate);
    report.image = { os: process.env.ImageOS, version: process.env.ImageVersion };
    report.run = { id: process.env.GITHUB_RUN_ID, attempt: process.env.GITHUB_RUN_ATTEMPT };
    const assertFrozen = () => {
      for (const [root, sha] of [[candidate, SOURCE], [experiment, report.experiment]]) {
        assert.equal(command("git", ["rev-parse", "HEAD"], root), sha, "source identity drift");
        assert.equal(command("git", ["status", "--porcelain=v1", "--untracked-files=all"], root), "", "checkout changed");
      }
    };
    assertFrozen();
    persist();
    const setup = async (name, executable, argv, cwd, timeoutMs) => {
      const result = await runCommand(executable, argv, { cwd, timeoutMs, log: path.join(outputDir, `${name}.log`) });
      report.setup.push({ name, ...result });
      persist();
      assert.equal(result.timedOut, false, `${name} timed out`);
      assert.equal(result.status, 0, `${name} failed`);
      assertFrozen();
    };
    await setup("npm-ci", "npm", ["ci", "--no-audit", "--no-fund"], candidate, 300_000);
    // Warm the exact binary before any test deadline. The frozen test still
    // invokes cargo build itself; no candidate code or timeout is patched.
    await setup("sidecar-build", "cargo", ["build", "--locked", "--bin", "library-authority-sidecar"], path.join(candidate, "packages/library-core-native"), 600_000);
    await setup("package-build", "npm", ["run", "build"], packageRoot, 120_000);
    const vitest = path.join(candidate, "node_modules/vitest/vitest.mjs");
    const inventoryPath = path.join(outputDir, "discovery.json");
    await setup("discovery", report.executables.npm, npmNodeArgs([vitest, "list", `--json=${inventoryPath}`]), packageRoot, 60_000);
    const inventory = JSON.parse(readFileSync(inventoryPath, "utf8")).map(({ file, name }) => [path.relative(packageRoot, file), name.replaceAll(" > ", " ")]);
    assert.equal(inventory.length, 187);
    for (const required of [...FOCUSED, ...DARWIN_REQUIRED]) assert.ok(inventory.some((entry) => key(entry) === key(required)), `discovery omitted ${key(required)}`);
    report.inventory = inventory;
    await runProof({ packageRoot, outputDir, inventory, report, assertFrozen, execute: (argv, name) => runCommand(report.executables.npm, npmNodeArgs([vitest, ...argv]), { cwd: packageRoot, log: path.join(outputDir, `${name}.log`), timeoutMs: name === "full" ? 240_000 : 30_000 }) });
    report.accepted = true;
  } catch (error) {
    report.error = error.message;
    throw error;
  } finally {
    report.endedAt = new Date().toISOString();
    persist();
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch((error) => { console.error(error); process.exitCode = 1; });
}
