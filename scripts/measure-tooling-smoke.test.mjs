import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  parseJUnitTestCases,
  unitDurationsForSuite,
} from "./measure-tooling-smoke.mjs";

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
