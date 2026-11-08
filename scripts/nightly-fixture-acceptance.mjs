// Native acceptance for the public shard and measurement entrypoints.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { buildToolingSmokeShardPlan, runToolingSmokeShard } from "./run-tooling-smoke-shard.mjs";
import { measureShard } from "./measure-tooling-smoke.mjs";

const suite = "nightly-self-improve";
const measuredTest = "repo snapshot preserves leading status columns for changed paths";
const names = [
  "nightly fixture child operations fail inside their explicit bound",
  measuredTest,
  "collectPeerWorktrees ignores peers with only generated validation artifacts",
  "collectPeerWorktrees avoids GitHub lookup when no peer can be inspected",
  "nightly JSON plan exposes only sanitized control-task state",
  "nightly authority snapshots reject hard-linked ledger and event files",
];
runToolingSmokeShard({
  suite, shardIndex: 1, shardCount: 1, shellFiles: [],
  testFiles: ["scripts/nightly-self-improve.test.mjs"],
  testNamePattern: `^(?:${names.join("|")})$`,
});

const all = buildToolingSmokeShardPlan({ suite, shardIndex: 1, shardCount: 1 });
const shardCount = all.testNames.length;
let selected;
for (let shardIndex = 1; shardIndex <= shardCount; shardIndex += 1) {
  const plan = buildToolingSmokeShardPlan({ suite, shardIndex, shardCount });
  if (plan.testNames.includes(measuredTest)) {
    selected = plan;
    break;
  }
}
assert.deepEqual(selected?.testNames, [measuredTest]);
const outputDir = mkdtempSync(path.join(os.tmpdir(), "freed-nightly-measure-proof-"));
try {
  const receipt = measureShard({
    suite, shardIndex: selected.shardIndex, shardCount, repeat: 1, outputDir,
  });
  assert.equal(receipt.runs.length, 1);
  assert.equal(receipt.runs[0].ok, true, JSON.stringify(receipt));
  assert.ok(Object.hasOwn(receipt.runs[0].units, measuredTest));
  console.log(JSON.stringify({ platform: process.platform, measurement: receipt }));
} finally {
  rmSync(outputDir, { recursive: true, force: true });
}
