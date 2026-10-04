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
          "scripts/alpha.test.mjs": { seconds: 1 },
          "scripts/beta.test.mjs": { seconds: 1 },
          "scripts/gamma.test.mjs": { seconds: 100 },
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
  const partial = buildToolingSmokeShardPlan(
    { suite: "general", shardIndex: 1, shardCount: 2 },
    {
      repoRoot,
      durations: {
        suites: {
          general: {
            units: { "scripts/gamma.test.mjs": { seconds: 100 } },
          },
        },
      },
    },
  );
  assert.deepEqual(partial, fallback);
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

for (const operation of ["git", "gh", "local-timeout"]) {
  test(`nightly shard bounds imported ${operation} and reaps escaped descendants`, async (t) => {
    const directory = mkdtempSync(path.join(os.tmpdir(), "freed-nightly-deadline-"));
    t.after(() => rmSync(directory, { recursive: true, force: true }));
    const env = { ...process.env };
    delete env.NODE_TEST_CONTEXT;
    const unrelated = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore" });
    const unrelatedStart = process.platform === "linux"
      ? readFileSync(`/proc/${unrelated.pid}/stat`, "utf8").split(")").at(-1).trim().split(/\s+/)[19]
      : null;
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
    const stat = fs.readFileSync('/proc/' + pid + '/stat', 'utf8').split(')').at(-1).trim().split(/\\s+/);
    return { pid, parentPid: Number(stat[1]), startTicks: stat[19], bootId: fs.readFileSync('/proc/sys/kernel/random/boot_id', 'utf8').trim() };
  }
  fs.writeFileSync(${JSON.stringify(evidence)}, JSON.stringify({ child: process.pid, descendant: child.pid, childGeneration: generation(process.pid), descendantGeneration: generation(child.pid), fixture: process.env.TMPDIR }));
  setInterval(() => {}, 1000);
  `, { mode: 0o700 });
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
  ${operation === "git" ? "collectRepoSnapshot(root)" : operation === "gh" ? "collectPeerWorktrees(root, [], false)" : "try { execFileSync('git', [], { timeout: 1000, killSignal: 'SIGKILL' }); } catch {}"};
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
    if (process.platform !== "linux") {
      assert.match(output, /confinement requires Linux.*refusing launch/);
      assert.equal(existsSync(evidence), false);
      return;
    }
    assert.match(output, operation === "local-timeout"
      ? /orphaned fixture descendants: .*test=deliberately stalled imported local-timeout operation=execFileSync git/
      : new RegExp(`operation deadline 2000ms test=deliberately stalled imported ${operation} operation=execFileSync ${operation}`));
    assert.match(output, /fixtureRemoved=True/);
    assert.ok(performance.now() - start < 10_000, output);
    const identities = JSON.parse(readFileSync(evidence, "utf8"));
    assert.equal(identities.descendantGeneration.parentPid, identities.child);
    assert.match(identities.childGeneration.startTicks, /^\d+$/);
    assert.match(identities.descendantGeneration.startTicks, /^\d+$/);
    for (const pid of [identities.child, identities.descendant]) {
      assert.equal(existsSync(`/proc/${pid}`), false, `PID ${pid} must be reaped, not merely a zombie`);
    }
    assert.equal(existsSync(identities.fixture), false);
    assert.equal(process.kill(unrelated.pid, 0), true, "unrelated process survives");
    const unrelatedNow = readFileSync(`/proc/${unrelated.pid}/stat`, "utf8").split(")").at(-1).trim().split(/\s+/);
    assert.equal(unrelatedNow[19], unrelatedStart, "unrelated generation is unchanged");
    assert.notEqual(unrelatedNow[0], "Z", "unrelated process is alive, not a zombie");
    console.log(output.split("\n").filter((line) => line.startsWith("[nightly supervisor]")).join("\n"));
    console.log(JSON.stringify({ contract: `imported ${operation} stall`, status: result.status,
      elapsedMs: performance.now() - start, ...identities, childAndDescendantReaped: true,
      fixtureRemoved: true, unrelatedAlive: true }));
  });
}

test("nightly supervisor refuses stale generations and foreign parents", () => {
  const helper = new URL("./test-helpers/nightly-fixture-supervisor.py", import.meta.url).pathname;
  const result = spawnSync("python3", ["-c", `
import importlib.util, os, subprocess, sys
sys.dont_write_bytecode = True
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
`], { encoding: "utf8", timeout: 10_000 });
  assert.equal(result.status, 0, result.stderr);
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
    if (process.platform !== "linux") {
      assert.match(output, /refusing launch/);
    } else {
      assert.match(output, deadline === "test" ? /test deadline 200ms test=blocked loop/ : /independent shard deadline/);
      assert.match(output, /"remaining": \[\]/);
      assert.match(output, /fixtureRemoved=True/);
    }
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
    /needs: \[tooling-smoke-plan, tooling-smoke-shards, native-acceptance\]/,
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
