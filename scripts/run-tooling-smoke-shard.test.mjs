import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
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
        PREVIEW_REQUIRED: required, PREVIEW_RESULT: result,
        EVENT_NAME: "pull_request", BASE_REF: "dev", REF: "refs/pull/1/merge",
        FEATURE_RESULT: "success", OPFS_REQUIRED: "false", OPFS_RESULT: "skipped" },
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

test("required aggregate enforces selected OPFS dependency results with an explicit cancellation boundary", () => {
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
    1,
    "status-only gate has no checkout or install",
  );
  assert.equal(gate["continue-on-error"] ?? false, false);
  const step = gate.steps[0];
  assert.equal(step.if, "${{ always() }}");
  assert.equal(step["continue-on-error"] ?? false, false);
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
    const result = spawnSync(
      "bash",
      ["--noprofile", "--norc", "-e", "-o", "pipefail", "-c", step.run],
      {
        env: { ...process.env, ...defaults, ...overrides },
        encoding: "utf8",
        timeout: 5000,
      },
    );
    assert.equal(
      result.status,
      accepted ? 0 : 1,
      `${JSON.stringify(overrides)}: ${result.stdout}${result.stderr}`,
    );
  }
  // Negative hosted evidence: run 37249567047 was cancelled after all accepted
  // dependencies, while the always() aggregate's local status stayed successful.
  // Its step-level cancelled() guard skipped. This shell has no terminal-run
  // cancellation signal; an accepted snapshot still passes. Keep #2121 open.
  const cancelledRun = {
    conclusion: "cancelled",
    dependencies: { ...defaults, NATIVE_REQUIRED: "true", NATIVE_RESULT: "success",
      PREVIEW_REQUIRED: "true", PREVIEW_RESULT: "success" },
  };
  assert.equal(cancelledRun.conclusion, "cancelled");
  check(cancelledRun.dependencies, true);
  // Do not manufacture whole-run proof by adding another local cancelled() step.
  assert.equal(gate.steps.length, 1);

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
