import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  aggregateShardedMeasurements,
  expectedMeasurementUnits,
  parseArgs,
  parseJUnitTestCases,
  receiptWithRetainedJUnit,
  selectStableCatalogMeasurements,
  unitDurationsForSuite,
} from "./measure-tooling-smoke.mjs";

test("shard measurement arguments require one complete bounded plan", () => {
  assert.deepEqual(
    parseArgs([
      "--suite=general",
      "--shard-index=1",
      "--shard-count=3",
      "--repeat=2",
      "--output-dir=receipts",
    ]),
    {
      aggregate: "",
      outputDir: "receipts",
      repeat: 2,
      shardCount: 3,
      shardIndex: 1,
      suite: "general",
      suites: [
        "general",
        "automation-control",
        "kernel-guard-cutover",
        "nightly-self-improve",
        "outcome-ledger-repair",
      ],
      write: false,
    },
  );
  assert.throws(
    () => parseArgs(["--suite=general", "--repeat=2"]),
    /requires --suite, --shard-index, --shard-count, and --output-dir/,
  );
  assert.throws(
    () =>
      parseArgs([
        "--suite=general",
        "--shard-index=4",
        "--shard-count=3",
        "--output-dir=receipts",
      ]),
    /valid index and count/,
  );
  assert.throws(
    () =>
      parseArgs([
        "--suite=general",
        "--shard-index=1",
        "--shard-count=3",
        "--repeat=4",
        "--output-dir=receipts",
      ]),
    /repeat must be between 1 and 3/,
  );
  assert.deepEqual(
    parseArgs([
      "--aggregate=receipts",
      "--write",
      "--suites=general,automation-control",
    ]),
    {
      aggregate: "receipts",
      outputDir: "",
      repeat: 1,
      shardCount: null,
      shardIndex: null,
      suite: "",
      suites: ["general", "automation-control"],
      write: true,
    },
  );
  assert.throws(
    () => parseArgs(["--aggregate=receipts", "--repeat=2"]),
    /cannot be combined with shard measurement options/,
  );
  assert.throws(
    () => parseArgs(["--aggregate=receipts", "--suites=general"]),
    /cannot be combined with shard measurement options/,
  );
});

test("JUnit measurements retain exact file and top-level test durations", (t) => {
  const repoRoot = mkdtempSync(path.join(os.tmpdir(), "freed-junit-units-"));
  t.after(() => rmSync(repoRoot, { recursive: true, force: true }));
  mkdirSync(path.join(repoRoot, "scripts"), { recursive: true });
  const specialFile = path.join(
    repoRoot,
    "scripts",
    "automation-control.test.mjs",
  );
  writeFileSync(
    specialFile,
    `import test from "node:test";
test("alpha & beta", () => undefined);
for (const variant of ["one", "two"]) {
  test(\`dynamic \${variant} remains exact\`, () => undefined);
}
`,
  );
  const xml = `<?xml version="1.0" encoding="utf-8"?>
<testsuites>
  <testcase name="alpha &amp; beta" time="2.500000" classname="test" file="${specialFile}"/>
  <testcase name="dynamic one remains exact" time="1.250000" classname="test" file="${specialFile}"/>
  <testcase name="dynamic two remains exact" time="0.750000" classname="test" file="${specialFile}"/>
</testsuites>`;

  const cases = parseJUnitTestCases(xml, repoRoot);
  assert.deepEqual(cases, [
    {
      name: "alpha & beta",
      file: "scripts/automation-control.test.mjs",
      seconds: 2.5,
    },
    {
      name: "dynamic one remains exact",
      file: "scripts/automation-control.test.mjs",
      seconds: 1.25,
    },
    {
      name: "dynamic two remains exact",
      file: "scripts/automation-control.test.mjs",
      seconds: 0.75,
    },
  ]);
  assert.deepEqual(
    unitDurationsForSuite("automation-control", cases, { repoRoot }),
    {
      "alpha & beta": 2.5,
      "`dynamic ${variant} remains exact`": 2,
    },
  );
});

test("JUnit measurements attribute nested subtests to their top-level suite", (t) => {
  const repoRoot = mkdtempSync(path.join(os.tmpdir(), "freed-junit-suite-"));
  t.after(() => rmSync(repoRoot, { recursive: true, force: true }));
  const testFile = path.join(repoRoot, "scripts", "automation-control.test.mjs");
  const xml = `<?xml version="1.0" encoding="utf-8"?>
<testsuites>
  <testsuite name="parent test" time="4.500000" tests="2">
    <testcase name="child one" time="2.000000" classname="test" file="${testFile}"/>
    <testcase name="child two" time="2.500000" classname="test" file="${testFile}"/>
  </testsuite>
  <testcase name="leaf test" time="1.250000" classname="test" file="${testFile}"/>
</testsuites>`;

  assert.deepEqual(parseJUnitTestCases(xml, repoRoot), [
    {
      name: "parent test",
      file: "scripts/automation-control.test.mjs",
      seconds: 4.5,
    },
    {
      name: "leaf test",
      file: "scripts/automation-control.test.mjs",
      seconds: 1.25,
    },
  ]);
});

test("JUnit measurements remain portable across runner checkout roots", () => {
  const xml = `<?xml version="1.0" encoding="utf-8"?>
<testsuites>
  <testcase name="portable" time="2.000000" classname="test" file="/home/runner/work/freed/freed/scripts/portable.test.mjs"/>
</testsuites>`;
  assert.deepEqual(parseJUnitTestCases(xml, "/different/checkout"), [
    {
      name: "portable",
      file: "scripts/portable.test.mjs",
      seconds: 2,
    },
  ]);
});

test("retained JUnit repairs incomplete receipt unit evidence", (t) => {
  const repoRoot = mkdtempSync(path.join(os.tmpdir(), "freed-junit-repair-"));
  t.after(() => rmSync(repoRoot, { recursive: true, force: true }));
  mkdirSync(path.join(repoRoot, "scripts"), { recursive: true });
  const testFile = "scripts/automation-control.test.mjs";
  writeFileSync(
    path.join(repoRoot, testFile),
    'import test from "node:test";\ntest("parent", async (t) => t.test("child"));\n',
  );
  const receiptPath = path.join(repoRoot, "automation-control-1-of-1.json");
  writeFileSync(
    receiptPath,
    `${JSON.stringify({
      schemaVersion: 1,
      suite: "automation-control",
      shardIndex: 1,
      shardCount: 1,
      repeat: 1,
      runs: [{ attempt: 1, ok: true, seconds: 3, units: {} }],
    })}\n`,
  );
  writeFileSync(
    path.join(repoRoot, "automation-control-1-of-1-attempt-1.xml"),
    `<?xml version="1.0" encoding="utf-8"?>
<testsuites>
  <testsuite name="parent" time="2.500000" tests="1">
    <testcase name="child" time="2.500000" classname="test" file="/home/runner/work/freed/freed/${testFile}"/>
  </testsuite>
</testsuites>`,
  );

  assert.deepEqual(receiptWithRetainedJUnit(receiptPath, { repoRoot }).runs, [
    {
      attempt: 1,
      ok: true,
      seconds: 3,
      units: { parent: 2.5 },
    },
  ]);
});

test("general suite measurements aggregate test cases by file", () => {
  assert.deepEqual(
    unitDurationsForSuite("general", [
      { name: "one", file: "scripts/alpha.test.mjs", seconds: 1.5 },
      { name: "two", file: "scripts/alpha.test.mjs", seconds: 2.5 },
      { name: "three", file: "scripts/beta.test.mjs", seconds: 3 },
    ]),
    {
      "scripts/alpha.test.mjs": 4,
      "scripts/beta.test.mjs": 3,
    },
  );
});

test("nightly measurements map JUnit cases through its transparent wrapper", (t) => {
  const repoRoot = mkdtempSync(path.join(os.tmpdir(), "freed-nightly-units-"));
  t.after(() => rmSync(repoRoot, { recursive: true, force: true }));
  mkdirSync(path.join(repoRoot, "scripts"), { recursive: true });
  const testFile = path.join(
    repoRoot,
    "scripts",
    "nightly-self-improve.test.mjs",
  );
  writeFileSync(
    testFile,
    `import nodeTest from "node:test";
function test(name, callback) {
  return nodeTest(name, async (context) => callback(context));
}
test("wrapped timing", () => undefined);
`,
  );

  assert.deepEqual(
    unitDurationsForSuite(
      "nightly-self-improve",
      [
        {
          name: "wrapped timing",
          file: "scripts/nightly-self-improve.test.mjs",
          seconds: 4.25,
        },
      ],
      { repoRoot },
    ),
    { "wrapped timing": 4.25 },
  );
});

test("catalog refresh accepts only stable measurements with exact unit coverage", (t) => {
  const repoRoot = mkdtempSync(path.join(os.tmpdir(), "freed-catalog-units-"));
  t.after(() => rmSync(repoRoot, { recursive: true, force: true }));
  mkdirSync(path.join(repoRoot, "scripts"), { recursive: true });
  writeFileSync(
    path.join(repoRoot, "scripts", "alpha.test.mjs"),
    'import test from "node:test";\ntest("alpha", () => undefined);\n',
  );
  const stable = {
    seconds: 3,
    runs: 2,
    failures: 0,
    flaky: false,
    units: { "scripts/alpha.test.mjs": { seconds: 2, runs: 2 } },
  };
  const measured = { schemaVersion: 1, suites: { general: stable } };

  assert.deepEqual(expectedMeasurementUnits("general", { repoRoot }), [
    "scripts/alpha.test.mjs",
  ]);
  assert.deepEqual(
    selectStableCatalogMeasurements(measured, ["general"], { repoRoot }),
    { general: stable },
  );
  assert.throws(
    () =>
      selectStableCatalogMeasurements(
        {
          schemaVersion: 1,
          suites: { general: { ...stable, failures: 1 } },
        },
        ["general"],
        { repoRoot },
      ),
    /not a stable repeated result/,
  );
  assert.throws(
    () =>
      selectStableCatalogMeasurements(
        {
          schemaVersion: 1,
          suites: { general: { ...stable, units: {} } },
        },
        ["general"],
        { repoRoot },
      ),
    /unit coverage is incomplete/,
  );
  assert.throws(
    () =>
      selectStableCatalogMeasurements(
        {
          schemaVersion: 1,
          suites: {
            general: {
              ...stable,
              units: {
                "scripts/alpha.test.mjs": { seconds: 2, runs: 1 },
              },
            },
          },
        },
        ["general"],
        { repoRoot },
      ),
    /unit coverage is incomplete/,
  );
});

test("sharded measurements reconstruct complete suite attempts and flake", () => {
  const receipts = [
    [
      "general",
      1,
      2,
      [
        [10, true, { alpha: 4 }],
        [12, true, { alpha: 5 }],
      ],
    ],
    [
      "general",
      2,
      2,
      [
        [20, true, { beta: 7 }],
        [18, false, { beta: 9 }],
      ],
    ],
    [
      "automation-control",
      1,
      1,
      [
        [30, true, { actor: 20 }],
        [40, true, { actor: 22 }],
      ],
    ],
    [
      "kernel-guard-cutover",
      1,
      1,
      [
        [50, true, { guard: 45 }],
        [60, true, { guard: 55 }],
      ],
    ],
    [
      "nightly-self-improve",
      1,
      1,
      [
        [70, true, { night: 65 }],
        [80, true, { night: 75 }],
      ],
    ],
    [
      "outcome-ledger-repair",
      1,
      1,
      [
        [90, true, { repair: 85 }],
        [100, true, { repair: 95 }],
      ],
    ],
  ].map(([suite, shardIndex, shardCount, runs]) => ({
    schemaVersion: 1,
    suite,
    shardIndex,
    shardCount,
    repeat: 2,
    runs: runs.map(([seconds, ok, units], index) => ({
      attempt: index + 1,
      seconds,
      ok,
      units,
    })),
  }));

  const measured = aggregateShardedMeasurements(receipts);
  assert.deepEqual(measured.suites.general, {
    seconds: 30,
    runs: 2,
    failures: 1,
    flaky: true,
    units: {
      alpha: { seconds: 4.5, runs: 2 },
      beta: { seconds: 8, runs: 2 },
    },
  });
  assert.equal(measured.suites["outcome-ledger-repair"].seconds, 95);
});

test("sharded aggregation accepts retained evidence errors on failed runs", () => {
  const run = {
    attempt: 1,
    seconds: 1,
    ok: false,
    units: {},
    evidenceError: "JUnit mapping failed",
  };
  const receipts = [
    "general",
    "automation-control",
    "kernel-guard-cutover",
    "nightly-self-improve",
    "outcome-ledger-repair",
  ].map((suite) => ({
    schemaVersion: 1,
    suite,
    shardIndex: 1,
    shardCount: 1,
    repeat: 1,
    runs: [run],
  }));

  const measured = aggregateShardedMeasurements(receipts);
  assert.equal(measured.suites["nightly-self-improve"].failures, 1);
});

test("sharded measurements reject missing shards and suites", () => {
  const receipt = {
    schemaVersion: 1,
    suite: "general",
    shardIndex: 1,
    shardCount: 2,
    repeat: 1,
    runs: [{ attempt: 1, seconds: 1, ok: true, units: {} }],
  };
  assert.throws(
    () => aggregateShardedMeasurements([receipt]),
    /general shard coverage is incomplete/,
  );
});
