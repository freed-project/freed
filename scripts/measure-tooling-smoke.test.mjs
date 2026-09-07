import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  aggregateShardedMeasurements,
  parseArgs,
  parseJUnitTestCases,
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
