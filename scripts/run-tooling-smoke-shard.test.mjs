import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import {
  mkdirSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { once } from "node:events";
import yaml from "js-yaml";

import {
  DARWIN_ONLY_TEST_FILES,
  NATIVE_ACCEPTANCE_TEST_FILES,
} from "./lib/tooling-smoke-suites.mjs";
import {
  buildToolingSmokeShardPlan,
  exactTestNamePattern,
  exactTestUnitPattern,
  extractTopLevelTestNames,
  extractTopLevelTestUnits,
  partitionToolingSmokeItems,
  partitionWeightedTestUnits,
  runToolingSmokeShard,
} from "./run-tooling-smoke-shard.mjs";

function repositoryTestFiles(relativeDirectory = "scripts") {
  return readdirSync(path.join(process.cwd(), relativeDirectory), {
    withFileTypes: true,
  })
    .flatMap((entry) => {
      const relativePath = path.posix.join(relativeDirectory, entry.name);
      if (entry.isDirectory()) return repositoryTestFiles(relativePath);
      return entry.isFile() && entry.name.endsWith(".test.mjs")
        ? [relativePath]
        : [];
    })
    .sort();
}

test("top-level test extraction accepts exact literal names and rejects gaps", () => {
  const source = `
test("alpha", () => undefined);
test(
  "beta",
  { timeout: 100 },
  () => undefined,
);
  t.test("nested", () => undefined);
`;
  assert.deepEqual(extractTopLevelTestNames(source), ["alpha", "beta"]);
  assert.throws(
    () => extractTopLevelTestNames("test(dynamicName, () => undefined);\n"),
    /without one literal or deterministic template name/,
  );
  assert.throws(
    () =>
      extractTopLevelTestNames(
        'test("same", () => undefined);\ntest("same", () => undefined);\n',
      ),
    /duplicate/,
  );
  assert.throws(
    () => extractTopLevelTestNames('test.skip("same", () => undefined);\n'),
    /modifier/,
  );
  assert.throws(
    () => extractTopLevelTestNames("const indirect = test;\n"),
    /aliases or passes/,
  );
  assert.throws(
    () => extractTopLevelTestNames('test("broken", () => {\n'),
    /invalid syntax/,
  );

  const dynamicUnits = extractTopLevelTestUnits(`
for (const variant of ["one", "two"]) {
  test(\`dynamic ${"${variant}"} remains exact\`, () => undefined);
}
  test("indented literal", () => undefined);
`);
  assert.equal(dynamicUnits.length, 2);
  const pattern = new RegExp(exactTestUnitPattern(dynamicUnits), "u");
  assert.equal(pattern.test("dynamic one remains exact"), true);
  assert.equal(pattern.test("dynamic two remains exact"), true);
  assert.equal(pattern.test("indented literal"), true);
  assert.equal(pattern.test("not registered"), false);
});

test("top-level extraction admits only a name-transparent local test wrapper", () => {
  const transparent = `
    import nodeTest from "node:test";
    function test(name, callback) {
      return nodeTest(name, async (context) => callback(context));
    }
    test("first", () => {});
  `;
  assert.deepEqual(
    extractTopLevelTestUnits(transparent, "wrapped.test.mjs", {
      allowTransparentLocalWrapper: true,
    }).map(({ name }) => name),
    ["first"],
  );
  const renamed = transparent.replace(
    "return nodeTest(name,",
    "return nodeTest(`wrapped: ${name}`,",
  );
  assert.throws(
    () =>
      extractTopLevelTestUnits(renamed, "renamed.test.mjs", {
        allowTransparentLocalWrapper: true,
      }),
    /aliases or passes/,
  );
});

test("shard assignment covers every item exactly once", () => {
  const items = Array.from({ length: 64 }, (_, index) => `test ${index}`);
  const assignments = Array.from({ length: 8 }, (_, index) =>
    partitionToolingSmokeItems(items, index + 1, 8),
  ).flat();
  assert.equal(assignments.length, items.length);
  assert.deepEqual([...assignments].sort(), [...items].sort());
  assert.equal(new Set(assignments).size, items.length);
});

test("weighted shard assignment is deterministic, complete, and balanced", () => {
  const units = Array.from({ length: 24 }, (_, index) => ({
    name: `test ${index}`,
    weight: (index % 7) + 1,
  }));
  const first = partitionWeightedTestUnits(units, 8);
  const second = partitionWeightedTestUnits(units, 8);
  assert.deepEqual(first, second);
  const assigned = first.flat();
  assert.equal(assigned.length, units.length);
  assert.equal(new Set(assigned.map(({ name }) => name)).size, units.length);
  assert.equal(
    first.every((shard) => shard.length > 0),
    true,
  );
});

test("recorded unit durations override source size when building shards", (t) => {
  const repoRoot = mkdtempSync(path.join(os.tmpdir(), "freed-unit-weights-"));
  t.after(() => rmSync(repoRoot, { recursive: true, force: true }));
  mkdirSync(path.join(repoRoot, "scripts", "lib"), { recursive: true });
  for (const name of ["alpha", "beta", "gamma"]) {
    writeFileSync(
      path.join(repoRoot, "scripts", `${name}.test.mjs`),
      `import test from "node:test";\ntest("${name}", () => undefined);\n`,
    );
  }

  const durations = {
    suites: {
      general: {
        units: {
          "scripts/alpha.test.mjs": { seconds: 0.001 },
          "scripts/beta.test.mjs": { seconds: 0.001 },
          "scripts/gamma.test.mjs": { seconds: 0.1 },
        },
      },
    },
  };
  const plans = [1, 2].map((shardIndex) =>
    buildToolingSmokeShardPlan(
      { suite: "general", shardIndex, shardCount: 2 },
      { repoRoot, durations },
    ),
  );

  assert.deepEqual(plans[0].testFiles, ["scripts/gamma.test.mjs"]);
  assert.deepEqual(plans[1].testFiles.sort(), [
    "scripts/alpha.test.mjs",
    "scripts/beta.test.mjs",
  ]);

  const fallback = buildToolingSmokeShardPlan(
    { suite: "general", shardIndex: 1, shardCount: 2 },
    { repoRoot, durations: { suites: { general: { units: {} } } } },
  );
  // Raw source lengths would dwarf these subsecond timings. The unknown
  // file must be estimated on their scale without discarding known weights.
  const partial = buildToolingSmokeShardPlan(
    { suite: "general", shardIndex: 1, shardCount: 2 },
    {
      repoRoot,
      durations: {
        suites: {
          general: {
            units: {
              "scripts/alpha.test.mjs": { seconds: 0.001 },
              "scripts/gamma.test.mjs": { seconds: 0.1 },
              "scripts/deleted.test.mjs": { seconds: 1e9 },
            },
          },
        },
      },
    },
  );
  assert.deepEqual(partial, plans[0]);
  assert.notDeepEqual(partial, fallback);

  for (const invalid of [null, "100", -1, NaN, Infinity]) {
    const invalidPlan = buildToolingSmokeShardPlan(
      { suite: "general", shardIndex: 1, shardCount: 2 },
      {
        repoRoot,
        durations: {
          suites: {
            general: {
              units: { "scripts/gamma.test.mjs": { seconds: invalid } },
            },
          },
        },
      },
    );
    assert.deepEqual(invalidPlan, fallback);
  }
  for (const evidence of [{ capped: true }, { failures: 1 }, { flaky: true }]) {
    const invalidPlan = buildToolingSmokeShardPlan(
      { suite: "general", shardIndex: 1, shardCount: 2 },
      {
        repoRoot,
        durations: {
          suites: { general: { ...durations.suites.general, ...evidence } },
        },
      },
    );
    assert.deepEqual(invalidPlan, fallback);
  }

  // Empty, newly added files still occupy exactly one shard in either mode.
  writeFileSync(path.join(repoRoot, "scripts", "empty.test.mjs"), "");
  for (const recorded of [durations, {}]) {
    const fullPartition = [1, 2, 3, 4].map((shardIndex) =>
      buildToolingSmokeShardPlan(
        { suite: "general", shardIndex, shardCount: 4 },
        { repoRoot, durations: recorded },
      ),
    );
    assert.ok(fullPartition.every((plan) => plan.testFiles.length === 1));
    assert.equal(new Set(fullPartition.flatMap((plan) => plan.testFiles)).size, 4);
  }
});

test("name shards retain timings with new, rounded-zero, and invalid units", (t) => {
  const repoRoot = mkdtempSync(path.join(os.tmpdir(), "freed-name-weights-"));
  t.after(() => rmSync(repoRoot, { recursive: true, force: true }));
  mkdirSync(path.join(repoRoot, "scripts"));
  const names = ["alpha", "bravo", "heavy", "newer", "zeros"];
  writeFileSync(
    path.join(repoRoot, "scripts/automation-control.test.mjs"),
    names.map((name) => `test("${name}", () => undefined);`).join("\n"),
  );
  const durations = {
    suites: {
      "automation-control": {
        units: {
          alpha: { seconds: 0.001 },
          bravo: { seconds: 0.001 },
          heavy: { seconds: 0.1 },
          newer: { seconds: 10000, capped: true },
          zeros: { seconds: 0 },
        },
      },
    },
  };
  const plans = [1, 2].map((shardIndex) =>
    buildToolingSmokeShardPlan(
      { suite: "automation-control", shardIndex, shardCount: 2 },
      { repoRoot, durations },
    ),
  );
  assert.deepEqual(plans[0].testNames, ["heavy"]);
  assert.deepEqual(plans[1].testNames, ["newer", "alpha", "bravo", "zeros"]);
  assert.deepEqual(plans.flatMap((plan) => plan.testNames).sort(), names);
  for (const plan of plans) {
    assert.deepEqual(
      names.filter((name) => new RegExp(plan.testNamePattern).test(name)).sort(),
      [...plan.testNames].sort(),
    );
  }

  // Rounded-zero measurements still fill each shard, including when no
  // positive observations exist to calibrate the new unit's source size.
  for (const name of names) {
    durations.suites["automation-control"].units[name] = { seconds: 0 };
  }
  delete durations.suites["automation-control"].units.newer;
  const zeroPlans = names.map((_, index) =>
    buildToolingSmokeShardPlan(
      {
        suite: "automation-control",
        shardIndex: index + 1,
        shardCount: names.length,
      },
      { repoRoot, durations },
    ),
  );
  assert.ok(zeroPlans.every((plan) => plan.testNames.length === 1));
  assert.deepEqual(zeroPlans.flatMap((plan) => plan.testNames).sort(), names);
});

test("exact name patterns run selected parents and all of their subtests", (t) => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "freed-test-shard-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const filePath = path.join(directory, "fixture.test.mjs");
  const names = ["alpha", "beta", "gamma", "delta"];
  const fixtureSource = `import test from "node:test";
test("alpha", async (t) => { console.log("top:alpha"); await t.test("nested", () => console.log("nested:alpha")); });
test("beta", async (t) => { console.log("top:beta"); await t.test("nested", () => console.log("nested:beta")); });
test("gamma", async (t) => { console.log("top:gamma"); await t.test("nested", () => console.log("nested:gamma")); });
test("delta", async (t) => { console.log("top:delta"); await t.test("nested", () => console.log("nested:delta")); });
`;
  writeFileSync(filePath, fixtureSource, { mode: 0o600 });

  let output = "";
  const childEnvironment = { ...process.env };
  delete childEnvironment.NODE_TEST_CONTEXT;
  for (let shardIndex = 1; shardIndex <= 2; shardIndex += 1) {
    const assigned = partitionToolingSmokeItems(names, shardIndex, 2);
    if (assigned.length === 0) continue;
    const result = spawnSync(
      process.execPath,
      [
        "--test",
        `--test-name-pattern=${exactTestNamePattern(assigned, names)}`,
        filePath,
      ],
      { encoding: "utf8", env: childEnvironment },
    );
    assert.equal(result.status, 0, result.stderr || result.stdout);
    output += result.stdout;
  }
  for (const name of names) {
    assert.equal(output.match(new RegExp(`top:${name}`, "g"))?.length, 1);
    assert.equal(output.match(new RegExp(`nested:${name}`, "g"))?.length, 1);
  }
});

test("shard execution preserves JUnit unit timings", (t) => {
  const repoRoot = mkdtempSync(path.join(os.tmpdir(), "freed-shard-junit-"));
  t.after(() => rmSync(repoRoot, { recursive: true, force: true }));
  mkdirSync(path.join(repoRoot, "scripts"), { recursive: true });
  writeFileSync(
    path.join(repoRoot, "scripts", "fixture.test.mjs"),
    'import test from "node:test";\ntest("measured", () => undefined);\n',
  );

  runToolingSmokeShard(
    {
      suite: "general",
      shardIndex: 1,
      shardCount: 1,
      shellFiles: [],
      testFiles: ["scripts/fixture.test.mjs"],
      testNames: [],
      testNamePattern: null,
    },
    { repoRoot },
  );

  const junit = readFileSync(
    path.join(repoRoot, "tooling-smoke-results", "general-1-of-1.xml"),
    "utf8",
  );
  assert.match(junit, /<testcase name="measured"/);
});

const supervisorPath = new URL("./test-helpers/nightly-fixture-supervisor.py", import.meta.url).pathname;
function processGeneration(pid) {
  const result = spawnSync("python3", ["-B", supervisorPath, "--inspect", String(pid)], {
    encoding: "utf8", timeout: 5000,
  });
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout);
}

test("nightly shard keeps real Git maintenance attached and preserves inherited configuration", (t) => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "freed-nightly-git-maintenance-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const fixture = path.join(directory, "git-maintenance.test.mjs");
  const trace = path.join(directory, "git-trace.jsonl");
  writeFileSync(fixture, `
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
test('real Git commit and local push with automatic maintenance', () => {
  const repo = mkdtempSync(path.join(os.tmpdir(), 'git-maintenance-'));
  const git = (...args) => execFileSync('git', args, { cwd: repo, encoding: 'utf8' });
  git('init', '--quiet');
  writeFileSync(path.join(repo, 'fixture.txt'), 'fixture');
  git('add', 'fixture.txt');
  git('commit', '--quiet', '-m', 'fixture');
  assert.equal(git('show', '-s', '--format=%an <%ae>').trim(), 'Inherited Fixture <fixture@example.com>');
  const origin = path.join(repo, 'origin.git');
  const peer = path.join(repo, 'peer');
  git('init', '--bare', '--quiet', origin);
  git('--git-dir', origin, 'config', 'receive.autoGC', 'true');
  git('--git-dir', origin, 'config', 'maintenance.auto', 'true');
  git('push', origin, 'HEAD:refs/heads/dev');
  git('clone', '--branch', 'dev', origin, peer);
  assert.equal(git('-C', peer, 'show', '-s', '--format=%an <%ae>').trim(), 'Inherited Fixture <fixture@example.com>');
});
`);
  const plan = { suite: "nightly-self-improve", shardIndex: 1, shardCount: 1,
    shellFiles: [], testFiles: [fixture], testNames: [], testNamePattern: null };
  const env = { ...process.env,
    GIT_CONFIG_COUNT: "1", GIT_CONFIG_KEY_0: "user.name", GIT_CONFIG_VALUE_0: "Inherited Fixture",
    GIT_CONFIG_PARAMETERS: "'user.email=fixture@example.com' 'maintenance.auto=true' 'maintenance.autoDetach=true' 'gc.autoDetach=true'",
    GIT_TEST_MAINT_AUTO_DETACH: "true",
    GIT_TRACE2_EVENT: trace,
  };
  delete env.NODE_TEST_CONTEXT;
  const result = spawnSync(process.execPath, ["--input-type=module", "-e", `
import { runToolingSmokeShard } from ${JSON.stringify(new URL("./run-tooling-smoke-shard.mjs", import.meta.url).href)};
runToolingSmokeShard(${JSON.stringify(plan)}, { repoRoot: ${JSON.stringify(directory)} });
`], { env, encoding: "utf8", timeout: 15_000 });
  const output = result.stdout + result.stderr;
  assert.equal(result.error, undefined, output);
  assert.equal(result.status, 0, output);
  assert.match(output, /"remaining": \[\].*fixtureRemoved=True/);
  const events = readFileSync(trace, "utf8").trim().split("\n").map((line) => JSON.parse(line));
  const versions = new Map(events.filter((entry) => entry.event === "version").map((entry) => [entry.sid, entry.exe]));
  const expectedVersion = versions.values().next().value;
  assert.ok(expectedVersion, "Git must report its version in the trace");
  for (const entry of events.filter((entry) => entry.event === "start")) {
    assert.equal(versions.get(entry.sid), expectedVersion, `mixed Git versions: ${entry.argv.join(" ")}`);
  }
  // Checking the caller alone misses an older git-receive-pack/upload-pack
  // found through PATH when a scratch Git build lacks those entrypoints.
  for (const name of ["receive-pack", "upload-pack"]) {
    const commands = events.filter((entry) => entry.event === "cmd_name" && entry.name === name);
    assert.ok(commands.length > 0, `local transport must execute ${name}`);
    assert.ok(commands.every((entry) => versions.get(entry.sid) === expectedVersion));
  }
  const receiver = events.find((entry) => entry.event === "cmd_name" && entry.name === "receive-pack");
  const remoteMaintenance = events.filter((entry) => entry.event === "child_start" && entry.sid === receiver.sid
    && (entry.argv?.includes("maintenance") || entry.argv?.includes("gc")));
  assert.ok(remoteMaintenance.length > 0, "receive-pack must execute automatic maintenance (gc on older Git)");
  assert.ok(remoteMaintenance.every((entry) => entry.argv.includes("--auto") && !entry.argv.includes("--detach")));
  const maintenance = events.filter((entry) => entry.event === "child_start" && entry.argv?.includes("maintenance"));
  assert.ok(maintenance.length > 0, "automatic maintenance must execute, not be disabled");
  assert.ok(maintenance.every((entry) => entry.argv.includes("--auto") && !entry.argv.includes("--detach")));
  assert.equal(events.some((entry) => entry.event === "region_enter" && entry.category === "maintenance" && entry.label === "detach"), false);
});

for (const operation of ["git", "gh", "local-timeout", "double-fork"]) {
  test(`nightly shard bounds imported ${operation} and reaps escaped descendants`, async (t) => {
    const directory = mkdtempSync(path.join(os.tmpdir(), "freed-nightly-deadline-"));
    t.after(() => rmSync(directory, { recursive: true, force: true }));
    const env = { ...process.env };
    delete env.NODE_TEST_CONTEXT;
    const unrelated = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore" });
    const unrelatedStart = processGeneration(unrelated.pid);
    t.after(async () => {
      if (unrelated.exitCode !== null || unrelated.signalCode !== null) return;
      const exited = once(unrelated, "exit");
      unrelated.kill("SIGKILL");
      await exited;
    });
    const bin = path.join(directory, "bin");
    mkdirSync(bin);
    const evidence = path.join(directory, "identities.json");
    // Only Git's executable is stalled. The test calls the real imported
    // collectRepoSnapshot, whose lexical execFileSync previously bypassed bounds.
    writeFileSync(path.join(bin, operation === "gh" ? "gh" : "git"), `#!${process.execPath}
  const { spawn } = require('node:child_process');
  const fs = require('node:fs');
  const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { detached: true, stdio: 'ignore' });
  function generation(pid) {
    return JSON.parse(require('node:child_process').execFileSync('python3', ['-B', ${JSON.stringify(supervisorPath)}, '--inspect', String(pid)], { encoding: 'utf8' }));
  }
  fs.writeFileSync(${JSON.stringify(evidence)}, JSON.stringify({ child: process.pid, descendant: child.pid, childGeneration: generation(process.pid), descendantGeneration: generation(child.pid), fixture: process.env.TMPDIR }));
  setInterval(() => {}, 1000);
  `, { mode: 0o700 });
    if (operation === "double-fork") {
      writeFileSync(path.join(bin, "git"), `#!/usr/bin/env python3
import importlib.util, json, os, sys, time
sys.dont_write_bytecode = True
sys.path.insert(0, ${JSON.stringify(path.dirname(supervisorPath))})
spec = importlib.util.spec_from_file_location('supervisor', ${JSON.stringify(supervisorPath)})
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
root = module.process_snapshot(os.getpid())
intermediate = os.fork()
if intermediate == 0:
    os.setsid()
    parent = module.process_snapshot(os.getpid())
    reader, writer = os.pipe()
    descendant = os.fork()
    if descendant:
        os.close(writer)
        os.read(reader, 1)
        os._exit(0)
    os.close(reader)
    evidence = dict(child=root['pid'], childGeneration=root, descendant=os.getpid(),
                    descendantGeneration=module.process_snapshot(os.getpid()),
                    intermediate=parent['pid'], intermediateGeneration=parent,
                    fixture=os.environ['TMPDIR'])
    with open(${JSON.stringify(evidence)}, 'w') as stream:
        json.dump(evidence, stream)
    os.write(writer, b'1')
    os.close(writer)
    while True:
        time.sleep(60)
os.waitpid(intermediate, 0)
while True:
    time.sleep(60)
`, { mode: 0o700 });
    }
    const fixture = path.join(directory, "stall.test.mjs");
    writeFileSync(fixture, `
import test from 'node:test';
import { execFileSync } from 'node:child_process';
  import { mkdtempSync, writeFileSync } from 'node:fs';
  import os from 'node:os';
  import path from 'node:path';
  import { collectRepoSnapshot, collectPeerWorktrees } from ${JSON.stringify(new URL("./nightly-self-improve.mjs", import.meta.url).href)};
  import { withNightlyFixture } from ${JSON.stringify(new URL("./test-helpers/nightly-fixture-preload.mjs", import.meta.url).href)};
  test('deliberately stalled imported ${operation}', () => withNightlyFixture('deliberately stalled imported ${operation}', () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'fixture-'));
    writeFileSync(path.join(root, 'owned-fixture'), 'cleanup required');
  ${["git", "double-fork"].includes(operation) ? "collectRepoSnapshot(root)" : operation === "gh" ? "collectPeerWorktrees(root, [], false)" : "try { execFileSync('git', [], { timeout: 1000, killSignal: 'SIGKILL' }); } catch {}"};
  }));
  `);
    const plan = { suite: "nightly-self-improve", shardIndex: 1, shardCount: 1,
      shellFiles: [], testFiles: [fixture], testNames: [], testNamePattern: null };
    const script = `import { runToolingSmokeShard } from ${JSON.stringify(new URL("./run-tooling-smoke-shard.mjs", import.meta.url).href)};
  runToolingSmokeShard(${JSON.stringify(plan)}, { repoRoot: ${JSON.stringify(directory)}, nightlyDeadlines: { operationMs: 2000, testMs: 4000, shardMs: 7000 } });`;
    const start = performance.now();
    const result = spawnSync(process.execPath, ["--input-type=module", "-e", script], {
      env: { ...env, PATH: `${bin}${path.delimiter}${env.PATH}` }, encoding: "utf8", timeout: 15_000,
    });
    const output = result.stdout + result.stderr;
    assert.equal(result.error, undefined, output);
    assert.equal(result.status, 1, output);
    assert.match(output, ["local-timeout", "double-fork"].includes(operation)
      ? new RegExp(`orphaned fixture descendants: .*test=deliberately stalled imported ${operation} operation=execFileSync git`)
      : new RegExp(`operation deadline 2000ms test=deliberately stalled imported ${operation} operation=execFileSync ${operation}`));
    assert.match(output, /fixtureRemoved=True/);
    assert.ok(performance.now() - start < 10_000, output);
    const identities = JSON.parse(readFileSync(evidence, "utf8"));
    assert.equal(identities.descendantGeneration.parentPid, identities.intermediate ?? identities.child);
    assert.ok(identities.childGeneration.birth);
    assert.ok(identities.descendantGeneration.birth);
    for (const pid of [identities.child, identities.descendant, identities.intermediate].filter(Boolean)) {
      assert.equal(processGeneration(pid), null, `PID ${pid} must disappear, not merely become a zombie`);
    }
    assert.equal(existsSync(identities.fixture), false);
    assert.equal(process.kill(unrelated.pid, 0), true, "unrelated process survives");
    const unrelatedNow = processGeneration(unrelated.pid);
    assert.equal(unrelatedNow.birth, unrelatedStart.birth, "unrelated generation is unchanged");
    assert.equal(unrelatedNow.zombie, false, "unrelated process is alive, not a zombie");
    console.log(output.split("\n").filter((line) => line.startsWith("[nightly supervisor]")).join("\n"));
    console.log(JSON.stringify({ contract: `imported ${operation} stall`, status: result.status,
      elapsedMs: performance.now() - start, ...identities, childAndDescendantGone: true,
      fixtureRemoved: true, unrelatedAlive: true }));
  });
}

test("nightly supervisor refuses stale generations and foreign parents", async (t) => {
  const foreign = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore" });
  const foreignBefore = processGeneration(foreign.pid);
  t.after(async () => {
    if (foreign.exitCode !== null || foreign.signalCode !== null) return;
    const exited = once(foreign, "exit");
    foreign.kill("SIGKILL");
    await exited;
  });
  const helper = new URL("./test-helpers/nightly-fixture-supervisor.py", import.meta.url).pathname;
  const result = spawnSync("python3", ["-c", `
import ctypes, errno, importlib.util, os, signal, subprocess, sys
sys.dont_write_bytecode = True
sys.path.insert(0, os.path.dirname(${JSON.stringify(helper)}))
spec = importlib.util.spec_from_file_location('supervisor', ${JSON.stringify(helper)})
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
platform = sys.platform
sys.platform = 'unsupported'
try:
    module.confine()
    raise AssertionError('unsupported confinement accepted')
except RuntimeError as error:
    assert 'refusing launch' in str(error)
finally:
    sys.platform = platform
if platform == 'linux':
    module.confine()
    child = subprocess.Popen([sys.executable, '-c', 'import time; time.sleep(30)'])
    try:
        expected = module.identity(child.pid)
        for stale in [(expected[0], expected[1], 'wrong-generation'), (expected[0], os.getppid(), expected[2])]:
            try:
                module.kill_owned(stale)
                raise AssertionError('stale or foreign identity accepted')
            except RuntimeError:
                pass
            assert child.poll() is None, 'refused identity was signaled'
    finally:
        module.cleanup(child)
    assert not os.path.exists('/proc/' + str(child.pid))
elif platform == 'darwin':
    module.confine()
    custody = module.DARWIN_CUSTODY
    # Darwin advances pidversion on exec. Capture after the child acknowledges
    # its final executable, so version + 1 cannot accidentally be the live token.
    child = subprocess.Popen([sys.executable, '-c', "import time; print('ready', flush=True); time.sleep(30)"], stdout=subprocess.PIPE, text=True)
    try:
        assert child.stdout.readline() == 'ready' + chr(10)
        members = custody.inventory()
        expected = next(entry for entry in members if entry['pid'] == child.pid)
        assert custody.send(dict(expected, birth='stale'), signal.SIGKILL) is False
        assert custody.send(dict(expected, pidversion=expected['pidversion'] + 1), signal.SIGKILL) is False
        # Exercise the kernel's token check too, not just the userspace check.
        from nightly_fixture_darwin import AuditToken
        stale = AuditToken()
        stale.val[5] = child.pid
        stale.val[7] = (expected['pidversion'] + 1) & 0xffffffff
        assert custody.lib.proc_signal_with_audittoken(ctypes.byref(stale), signal.SIGKILL) == errno.ESRCH
        outsider = custody.inspect(${foreign.pid})
        try:
            custody.send(outsider, signal.SIGKILL)
            raise AssertionError('foreign responsibility accepted')
        except RuntimeError:
            pass
        assert child.poll() is None
    finally:
        module.cleanup(child)
    assert custody.inspect(child.pid) is None
`], { encoding: "utf8", timeout: 10_000 });
  assert.equal(result.status, 0, result.stderr);
  const foreignAfter = processGeneration(foreign.pid);
  assert.equal(foreignAfter.birth, foreignBefore.birth);
  assert.equal(foreignAfter.zombie, false);
});

test("Darwin accounts for unseen zombies and refuses cleanup with missing ancestry", {
  skip: process.platform !== "darwin" && "requires real Darwin process generations",
}, () => {
  const result = spawnSync("python3", ["-B", "-c", `
import ctypes, errno, importlib.util, json, os, subprocess, sys, time
sys.path.insert(0, ${JSON.stringify(path.dirname(supervisorPath))})
spec = importlib.util.spec_from_file_location('supervisor', ${JSON.stringify(supervisorPath)})
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
module.confine()
custody = module.DARWIN_CUSTODY
# The parent deliberately does not waitpid. Its child exits before we perform
# the first custody inventory, so no previously captured identity can save it.
program = """
import ctypes, errno, json, os, sys, time
sys.path.insert(0, ${JSON.stringify(path.dirname(supervisorPath))})
from nightly_fixture_darwin import BsdWithUniqueInfo, DarwinCustody
observer = DarwinCustody(observe_only=True)
pid = os.fork()
if pid == 0:
    os._exit(0)
deadline = time.monotonic() + 3
while time.monotonic() < deadline:
    snapshot = observer.inspect(pid)
    assert snapshot is not None, 'unreaped child must remain inspectable'
    if snapshot['zombie']:
        raw = BsdWithUniqueInfo()
        ctypes.set_errno(0)
        size = observer.lib.proc_pidinfo(pid, 18, 0, ctypes.byref(raw), ctypes.sizeof(raw))
        if size == 0 and ctypes.get_errno() == errno.ESRCH:
            print(json.dumps(snapshot), flush=True)
            break
        assert size == ctypes.sizeof(raw), 'unexpected live-only query failure'
    # Wait for the transition into zombproc, never accept absence as success.
    time.sleep(0.01)
else:
    raise AssertionError('child did not reach held zombie state within 3 seconds')
while True:
    time.sleep(30)
"""
child = subprocess.Popen([sys.executable, '-B', '-c', program], stdout=subprocess.PIPE, text=True)
original_responsible, original_snapshots = custody.responsible, custody.snapshots
try:
    zombie = json.loads(child.stdout.readline())
    assert zombie['zombie']
    assert zombie['uniqueid'] not in custody.known
    from nightly_fixture_darwin import BsdWithUniqueInfo
    raw = BsdWithUniqueInfo()
    ctypes.set_errno(0)
    assert custody.lib.proc_pidinfo(zombie['pid'], 18, 0, ctypes.byref(raw), ctypes.sizeof(raw)) == 0
    assert ctypes.get_errno() == errno.ESRCH, 'arg=0 must reproduce the false absence'
    assert custody.same(zombie, custody.inspect(zombie['pid'])), 'arg=1 must include the zombie'
    # Ask the real kernel an invalid query. A query failure must raise, never
    # turn into an absence receipt, even for a process we know still exists.
    query = custody.lib.proc_pidinfo
    try:
        custody.lib.proc_pidinfo = lambda pid, flavor, arg, buffer, size: query(pid, 0x7fffffff, arg, buffer, size)
        try:
            custody.inspect(zombie['pid'])
            raise AssertionError('uninspectable process was reported absent')
        except RuntimeError as error:
            assert 'errno=' + str(errno.EINVAL) in str(error), str(error)
    finally:
        custody.lib.proc_pidinfo = query
    assert custody.same(zombie, custody.inspect(zombie['pid']))
    native_responsibility = custody.responsible(zombie['pid'])
    # Remove only unavailable evidence, never synthesize ownership. The kernel
    # parent unique ID and the live parent's responsibility remain authoritative.
    custody.responsible = lambda pid: -1 if pid == zombie['pid'] else original_responsible(pid)
    previous_predicate = (custody.responsible(zombie['pid']) == os.getpid()
                          or zombie['uniqueid'] in custody.known)
    assert not previous_predicate, 'fixture must exercise the previous omission'
    members = custody.inventory()
    captured = next(entry for entry in members if entry['pid'] == zombie['pid'])
    parent = next(entry for entry in members if entry['pid'] == child.pid)
    assert captured['parentUniqueid'] == parent['uniqueid']
    assert custody.same(captured, zombie)
    assert not custody.send(captured, 9), 'zombies must not become signal targets'

    # Withhold the intermediate parent and historical captures. This models
    # first observation after its generation has disappeared. All supplied
    # identities still come from real kernel snapshots.
    custody.known.clear()
    custody.snapshots = lambda: [(entry, responsible) for entry, responsible in original_snapshots()
                                if entry['pid'] != child.pid]
    members = custody.inventory()
    assert all(entry['pid'] != zombie['pid'] for entry in members)
    assert any(entry['pid'] == zombie['pid'] for entry in custody.unresolved)
    started = time.monotonic()
    try:
        custody.cleanup(child, module.reap)
        raise AssertionError('ambiguous zombie falsely reported successful cleanup')
    except RuntimeError as error:
        assert 'unresolved zombies=' in str(error), str(error)
        assert str(zombie['uniqueid']) in str(error), str(error)
    assert 4.9 <= time.monotonic() - started < 7
    assert child.poll() is None, 'unverified parent was signaled'
    assert custody.same(zombie, custody.inspect(zombie['pid']))
    print(json.dumps(dict(contract='unseen zombie with unavailable responsibility',
                          nativeResponsibility=native_responsibility,
                          previousPredicateAdmits=previous_predicate, liveOnlyQueryFalselyAbsent=True,
                          zombieQueryPresent=True, invalidQueryRefused=True, zombie=zombie, verifiedParent=parent,
                          incompleteAncestryRefused=True, unverifiedParentUntouched=True)))
finally:
    custody.responsible, custody.snapshots = original_responsible, original_snapshots
    receipt = module.cleanup(child)
assert custody.inspect(child.pid) is None
assert custody.inspect(zombie['pid']) is None, 'zombie must disappear after verified parent cleanup'
print(json.dumps(dict(cleanup=receipt, childAndUnseenZombieGone=True)))
`], { encoding: "utf8", timeout: 20_000 });
  assert.equal(result.error, undefined, result.stderr);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /"incompleteAncestryRefused": true/);
  assert.match(result.stdout, /"childAndUnseenZombieGone": true/);
  console.log(result.stdout);
});

test("nightly shard deadline remains independent of a blocked test event loop", (t) => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "freed-nightly-loop-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const fixture = path.join(directory, "loop.test.mjs");
  writeFileSync(fixture, `import test from 'node:test';
import { withNightlyFixture } from ${JSON.stringify(new URL("./test-helpers/nightly-fixture-preload.mjs", import.meta.url).href)};
test('blocked loop', () => withNightlyFixture('blocked loop', () => { while (true) {} }));`);
  const plan = { suite: "nightly-self-improve", shardIndex: 1, shardCount: 1,
    shellFiles: [], testFiles: [fixture], testNames: [], testNamePattern: null };
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT;
  for (const deadline of ["test", "shard"]) {
    const script = `import { runToolingSmokeShard } from ${JSON.stringify(new URL("./run-tooling-smoke-shard.mjs", import.meta.url).href)};
runToolingSmokeShard(${JSON.stringify(plan)}, { repoRoot: ${JSON.stringify(directory)}, nightlyDeadlines: { operationMs: 5000, testMs: ${deadline === "test" ? 200 : 5000}, shardMs: ${deadline === "shard" ? 1000 : 5000} } });`;
    const result = spawnSync(process.execPath, ["--input-type=module", "-e", script], {
      env, encoding: "utf8", timeout: 10_000,
    });
    const output = result.stdout + result.stderr;
    assert.equal(result.error, undefined, output);
    assert.equal(result.status, 1, output);
    assert.match(output, deadline === "test" ? /test deadline 200ms test=blocked loop/ : /independent shard deadline/);
    assert.match(output, /"remaining": \[\]/);
    assert.match(output, /fixtureRemoved=True/);
  }
});

test("repository plans are nonempty and cover each named suite", () => {
  for (const suite of [
    "general",
    "automation-control",
    "kernel-guard-cutover",
    "nightly-self-improve",
    "outcome-ledger-repair",
  ]) {
    const plans = Array.from({ length: 8 }, (_, index) =>
      buildToolingSmokeShardPlan({
        suite,
        shardIndex: index + 1,
        shardCount: 8,
      }),
    );
    assert.equal(
      plans.every((plan) => plan.testFiles.length > 0),
      true,
    );
    if (suite === "general") {
      const files = plans.flatMap((plan) => plan.testFiles).sort();
      assert.equal(files.length, new Set(files).size);
      const specialFiles = new Set([
        "scripts/automation-control.test.mjs",
        "scripts/automation-kernel-guard-cutover.test.mjs",
        "scripts/nightly-self-improve.test.mjs",
        "scripts/outcome-ledger-repair.test.mjs",
      ]);
      // The darwin-only files moved to the macOS lane. They gate every test
      // behind one module-level platform check, so running them on Linux only
      // ever skipped them.
      const routedElsewhere = new Set([
        ...specialFiles,
        ...DARWIN_ONLY_TEST_FILES,
      ]);
      assert.deepEqual(
        files,
        repositoryTestFiles().filter(
          (filePath) => !routedElsewhere.has(filePath),
        ),
      );

      // Nothing may silently fall out of the lane. Every repository test file
      // must be claimed by a sharded suite, the general suite, or the macOS
      // native lane.
      const covered = new Set([
        ...files,
        ...specialFiles,
        ...NATIVE_ACCEPTANCE_TEST_FILES,
      ]);
      const orphaned = repositoryTestFiles().filter(
        (filePath) => !covered.has(filePath),
      );
      assert.deepEqual(orphaned, [], "every test file must run somewhere");

      // Each darwin-only file must actually be claimed by the native lane.
      for (const darwinOnly of DARWIN_ONLY_TEST_FILES) {
        assert.ok(
          NATIVE_ACCEPTANCE_TEST_FILES.includes(darwinOnly),
          `${darwinOnly} left the general suite and must run on the macOS lane`,
        );
      }
    } else {
      const names = plans.flatMap((plan) => plan.testNames);
      assert.equal(names.length, new Set(names).size);
      const testFile = plans[0].testFiles[0];
      const source = readFileSync(path.join(process.cwd(), testFile), "utf8");
      assert.equal(
        names.length,
        extractTopLevelTestUnits(source, testFile, {
          allowTransparentLocalWrapper: suite === "nightly-self-improve",
        }).length,
      );
    }
  }
});

test("validation workflow preserves the complete tooling smoke gate", () => {
  const workflow = readFileSync(
    path.join(process.cwd(), ".github", "workflows", "ci.yml"),
    "utf8",
  );
  // The matrix is computed, never hardcoded. A literal suite list here would
  // silently reintroduce the fixed 32 job lane this planner replaced.
  assert.match(
    workflow,
    /matrix: \$\{\{ fromJSON\(needs\.tooling-smoke-plan\.outputs\.matrix\) \}\}/,
  );
  assert.match(workflow, /node scripts\/plan-tooling-smoke\.mjs/);
  assert.match(workflow, /--shard-count=\$\{\{ matrix\.shardCount \}\}/);
  assert.match(workflow, /tooling-smoke-results\/\*\.xml/);

  // Dev retains the full application integration job, while tooling smoke
  // scopes itself to the merged delta. Missing push history fails closed.
  assert.match(workflow, /--base-ref "\$BEFORE_SHA"/);
  assert.match(workflow, /git cat-file -e "\$\{BEFORE_SHA\}\^\{commit\}"/);
  assert.match(workflow, /plan-tooling-smoke\.mjs --all --github-output/);

  const nightlyWorkflow = readFileSync(
    path.join(process.cwd(), ".github", "workflows", "tooling-nightly.yml"),
    "utf8",
  );
  assert.match(
    nightlyWorkflow,
    /plan-tooling-smoke\.mjs --all --max-jobs 40 --github-output/,
  );
  assert.match(
    nightlyWorkflow,
    /matrix: \$\{\{ fromJSON\(needs\.exhaustive-tooling-plan\.outputs\.matrix\) \}\}/,
  );
  assert.match(nightlyWorkflow, /--suite=\$\{\{ matrix\.suite \}\}/);
  assert.match(
    nightlyWorkflow,
    /--repeat="\$\{\{ github\.event\.inputs\.repeat \|\| '2' \}\}"/,
  );
  assert.match(nightlyWorkflow, /--aggregate=tooling-smoke-measurements/);
  assert.match(
    nightlyWorkflow,
    /needs: \[exhaustive-tooling-plan, exhaustive-tooling-shards\]/,
  );
  assert.doesNotMatch(
    nightlyWorkflow,
    /--repeat="\$\{\{ github\.event\.inputs\.repeat \|\| '2' \}\}" \\\n\s*> tooling-smoke-measured\.json/,
  );

  // The gate observes the planner, the shards, and the native lane together.
  assert.match(
    workflow,
    /needs: \[tooling-smoke-plan, tooling-smoke-shards, native-acceptance, preview-process-acceptance, feature, pwa-opfs-acceptance\]/,
  );
  assert.match(workflow, /^  tooling-smoke:\n    name: Tooling smoke$/m);

  // Fail-closed wiring: a skipped shard job is acceptable only when the planner
  // said the lane was not applicable, and a failed planner always fails.
  assert.match(workflow, /if \[ "\$PLAN_RESULT" != "success" \]/);
  assert.match(workflow, /if \[ "\$SHARD_RESULT" != "skipped" \]/);
  // The macOS lane is observe-only until the first-run hang is diagnosed, so it
  // must warn rather than exit. It must still be wired up and still fail closed
  // when it runs unexpectedly, which the next assertion covers.
  assert.match(workflow, /observe-only, not gating yet/);
  assert.match(
    workflow,
    /Native acceptance was not required but reported \$NATIVE_RESULT/,
  );

  // Superseded dev runs cancel.
  assert.match(workflow, /^  cancel-in-progress: true$/m);
});


test("preview macOS acceptance is focused and fails the existing gate when required proof is absent", () => {
  const workflow = yaml.load(readFileSync(".github/workflows/ci.yml", "utf8"));
  const job = workflow.jobs["preview-process-acceptance"];
  assert.equal(job["runs-on"], "macos-latest");
  assert.equal(job.if, "needs.tooling-smoke-plan.outputs.preview-native == 'true'");
  assert.equal(job["timeout-minutes"], 5);
  assert.equal(job["continue-on-error"] ?? false, false);
  assert.ok(job.steps.every((step) => !step["continue-on-error"]));
  const commands = job.steps.map((step) => step.run ?? "").join("\n");
  assert.match(commands, /process.platform !== "darwin"/);
  assert.match(commands, /node --test --test-timeout=30000 scripts\/worktree-preview.test.mjs scripts\/task-decisions.test.mjs/);
  assert.doesNotMatch(commands, /npm ci|run-native-acceptance|cargo/);
  assert.equal(workflow.jobs["tooling-smoke-plan"].outputs["preview-native"], "${{ steps.plan.outputs.preview-native }}");
  const gate = workflow.jobs["tooling-smoke"];
  assert.ok(gate.needs.includes("preview-process-acceptance"));
  const step = gate.steps[0];
  assert.equal(step.env.PREVIEW_RESULT, "${{ needs.preview-process-acceptance.result }}");
  assert.equal(step.env.PREVIEW_REQUIRED, "${{ needs.tooling-smoke-plan.outputs.preview-native }}");
  for (const [required, result, expected] of [
    ["true", "success", 0], ["true", "failure", 1], ["true", "skipped", 1],
    ["true", "cancelled", 1], ["false", "skipped", 0], ["false", "success", 1],
    ["", "skipped", 1],
  ]) {
    const run = spawnSync("bash", ["-c", step.run], {
      env: { ...process.env, PLAN_RESULT: "success", SHARD_RESULT: "success",
        APPLICABLE: "true", JOB_COUNT: "2", NATIVE_REQUIRED: "false", NATIVE_RESULT: "skipped",
        EVENT_NAME: "pull_request", BASE_REF: "dev", REF: "refs/pull/1/merge",
        FEATURE_RESULT: "success", OPFS_REQUIRED: "false", OPFS_RESULT: "skipped",
        PREVIEW_REQUIRED: required, PREVIEW_RESULT: result },
      encoding: "utf8", timeout: 5000,
    });
    assert.equal(run.status, expected, `${required}/${result}: ${run.stdout}${run.stderr}`);
  }
});


test("planner publishes the required preview proof into GitHub job outputs", (t) => {
  const root = mkdtempSync(path.join(os.tmpdir(), "freed-preview-plan-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const output = path.join(root, "github-output");
  const result = spawnSync(process.execPath, ["scripts/plan-tooling-smoke.mjs",
    "--github-output", "--changed-files", "scripts/lib/preview-processes.py"], {
    env: { ...process.env, GITHUB_OUTPUT: output }, encoding: "utf8", timeout: 5000,
  });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  const values = Object.fromEntries(readFileSync(output, "utf8").trim().split("\n")
    .map((line) => [line.slice(0, line.indexOf("=")), line.slice(line.indexOf("=") + 1)]));
  assert.equal(values["preview-native"], "true");
  assert.equal(values.native, "false");
  assert.equal(values.applicable, "true");
});

test("required aggregate settles cancellation and enforces the native OPFS result matrix", () => {
  const workflow = yaml.load(readFileSync(".github/workflows/ci.yml", "utf8"));
  const gate = workflow.jobs["tooling-smoke"];
  assert.equal(gate.if, "${{ always() }}");
  assert.equal(gate["timeout-minutes"], 2);
  assert.deepEqual(gate.needs, [
    "tooling-smoke-plan",
    "tooling-smoke-shards",
    "native-acceptance",
    "preview-process-acceptance",
    "feature",
    "pwa-opfs-acceptance",
  ]);
  assert.equal(
    gate.steps.length,
    2,
    "status-only gate has no checkout or install",
  );
  assert.equal(gate["continue-on-error"] ?? false, false);
  const step = gate.steps[0];
  assert.equal(step.if, "${{ always() }}");
  assert.equal(step["continue-on-error"] ?? false, false);
  const cancellationStep = gate.steps[1];
  assert.equal(cancellationStep.if, "${{ cancelled() }}");
  assert.equal(cancellationStep["timeout-minutes"], 1);
  assert.equal(cancellationStep["continue-on-error"] ?? false, false);
  assert.ok(gate.steps.every((entry) => entry.run && !entry.uses));
  // Guard the invalid Actions context that YAML parsing alone admitted.
  for (const entry of gate.steps) {
    for (const value of Object.values(entry.env ?? {})) {
      assert.doesNotMatch(value, /\b(?:always|cancelled|success|failure)\s*\(/);
    }
  }
  for (const [name, expression] of Object.entries({
    EVENT_NAME: "github.event_name",
    BASE_REF: "github.base_ref",
    REF: "github.ref",
    FEATURE_RESULT: "needs.feature.result",
    OPFS_REQUIRED: "needs.feature.outputs.needs-webkit",
    OPFS_RESULT: "needs.pwa-opfs-acceptance.result",
  }))
    assert.equal(step.env[name], "${{ " + expression + " }}");
  assert.equal(
    workflow.jobs.feature.outputs["needs-webkit"],
    "${{ steps.feature-plan.outputs.needs_webkit }}",
  );
  const opfs = workflow.jobs["pwa-opfs-acceptance"];
  assert.equal(opfs.needs, "feature");
  assert.equal(opfs["runs-on"], "macos-latest");
  assert.equal(opfs["timeout-minutes"], 20);
  assert.equal(opfs["continue-on-error"] ?? false, false);
  assert.ok(opfs.steps.every((entry) => !entry["continue-on-error"]));
  assert.match(opfs.if, /needs\.feature\.outputs\.needs-webkit == 'true'/);
  assert.match(opfs.if, /github\.event_name == 'push'/);
  assert.ok(
    opfs.steps.some(
      (entry) =>
        entry.run === "npm run test:e2e:opfs" &&
        entry["working-directory"] === "packages/pwa",
    ),
  );

  const defaults = {
    EVENT_NAME: "pull_request",
    BASE_REF: "dev",
    REF: "refs/pull/1/merge",
    FEATURE_RESULT: "success",
    OPFS_REQUIRED: "true",
    OPFS_RESULT: "success",
    PLAN_RESULT: "success",
    SHARD_RESULT: "success",
    APPLICABLE: "true",
    JOB_COUNT: "2",
    NATIVE_REQUIRED: "false",
    NATIVE_RESULT: "skipped",
    PREVIEW_REQUIRED: "false",
    PREVIEW_RESULT: "skipped",
  };
  function check(overrides, accepted) {
    // Execute both real shell bodies with the two exact conditions asserted
    // above. This models their outcome composition, not GitHub scheduling.
    for (const cancelled of [false, true]) {
      const outcomes = gate.steps.map((entry) => {
        const shouldRun = entry.if === "${{ always() }}" || cancelled;
        if (!shouldRun) return "skipped";
        const result = spawnSync(
          "bash",
          ["--noprofile", "--norc", "-e", "-o", "pipefail", "-c", entry.run],
          {
            env: { ...process.env, ...defaults, ...overrides },
            encoding: "utf8",
            timeout: 5000,
          },
        );
        assert.equal(result.error, undefined);
        assert.equal(result.signal, null);
        assert.ok([0, 1].includes(result.status), result.stdout + result.stderr);
        return result.status === 0 ? "success" : "failure";
      });
      assert.deepEqual(
        outcomes,
        [accepted ? "success" : "failure", cancelled ? "failure" : "skipped"],
        `${JSON.stringify(overrides)}; cancelled=${cancelled}`,
      );
      assert.equal(outcomes.includes("failure"), cancelled || !accepted);
    }
  }
  const results = ["success", "failure", "cancelled", "skipped", "", "unknown"];
  for (const required of ["true", "false", "", "TRUE", " true", "null"]) {
    for (const result of results) {
      check(
        { OPFS_REQUIRED: required, OPFS_RESULT: result },
        (required === "true" && result === "success") ||
          (required === "false" && result === "skipped"),
      );
    }
  }
  for (const feature of results) {
    for (const required of ["true", "false"]) {
      check(
        {
          FEATURE_RESULT: feature,
          OPFS_REQUIRED: required,
          OPFS_RESULT: required === "true" ? "success" : "skipped",
        },
        feature === "success",
      );
    }
    for (const opfsResult of results) {
      check(
        {
          EVENT_NAME: "push",
          BASE_REF: "",
          REF: "refs/heads/dev",
          FEATURE_RESULT: feature,
          OPFS_REQUIRED: "",
          OPFS_RESULT: opfsResult,
        },
        feature === "skipped" && opfsResult === "success",
      );
      check(
        {
          BASE_REF: "main",
          FEATURE_RESULT: feature,
          OPFS_REQUIRED: "",
          OPFS_RESULT: opfsResult,
        },
        feature === "skipped" && opfsResult === "skipped",
      );
    }
  }
  for (const event of ["workflow_dispatch", "schedule", "", "unknown"]) {
    check({ EVENT_NAME: event }, false);
  }
  check({ BASE_REF: "other" }, false);
  check({ EVENT_NAME: "push", BASE_REF: "", REF: "refs/heads/main" }, false);
  for (const result of results) {
    check({ PLAN_RESULT: result }, result === "success");
    check({ SHARD_RESULT: result }, result === "success");
    check({ APPLICABLE: "false", SHARD_RESULT: result }, result === "skipped");
    // Actor acceptance remains observe-only when selected, including cancellation.
    check({ NATIVE_REQUIRED: "true", NATIVE_RESULT: result }, true);
    check({ NATIVE_RESULT: result }, result === "skipped");
  }
});
