import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_SHARD_TIMEOUT_SECONDS,
  buildToolingSmokeMatrix,
  projectShardRuntime,
  suiteWeights,
} from "./lib/tooling-smoke-plan.mjs";

// The planner decides how every tooling smoke job is allocated and had no
// coverage at all. What follows pins the specific failure that motivated it:
// a shard killed by the job timeout was recorded as if it were a measurement,
// so the planner under-sharded, so the shards were killed again, so the
// recorded number could never grow. See issue #1147.

const CAPPED = {
  suites: {
    "outcome-ledger-repair": {
      seconds: 5415,
      runs: 1,
      capped: true,
      source: "killed by the 90m cap",
    },
  },
};

const COMPLETED = {
  suites: {
    "outcome-ledger-repair": { seconds: 5415, runs: 1, source: "completed" },
  },
};

test("a capped duration is not treated as a measurement", () => {
  const capped = suiteWeights({ durations: CAPPED }).get("outcome-ledger-repair");
  assert.equal(capped.capped, true);
  assert.equal(capped.measured, false);

  // Same seconds, no cap flag: this one really was measured.
  const completed = suiteWeights({ durations: COMPLETED }).get(
    "outcome-ledger-repair",
  );
  assert.equal(completed.capped, false);
  assert.equal(completed.measured, true);

  // The weight itself is unchanged. A floor is still the best number available
  // for relative ordering; what changes is the confidence attached to it.
  assert.equal(capped.weight, completed.weight);
});

test("a capped suite never reports that it fits, even when the floor divides small", () => {
  // The trap this guards: 5415 / 2 is 45 minutes, comfortably inside a 90
  // minute timeout, so arithmetic on the floor says the plan is fine. It is
  // not fine, because the real duration is unknown and already exceeded a
  // timeout once. Both shards of this suite went on to burn the full 90.
  const weights = suiteWeights({ durations: CAPPED });
  const [projected] = projectShardRuntime(
    [{ suite: "outcome-ledger-repair", shardCount: 2 }],
    weights,
    DEFAULT_SHARD_TIMEOUT_SECONDS,
  );
  assert.equal(projected.perShardSeconds, 5415 / 2);
  assert.ok(projected.perShardSeconds < DEFAULT_SHARD_TIMEOUT_SECONDS);
  assert.equal(projected.atLeast, true);
  assert.equal(projected.fits, false);
  assert.equal(projected.predictedFrom, "capped");
});

test("a measured suite that genuinely overruns is reported too", () => {
  const weights = suiteWeights({
    durations: { suites: { "outcome-ledger-repair": { seconds: 20_000 } } },
  });
  const [projected] = projectShardRuntime(
    [{ suite: "outcome-ledger-repair", shardCount: 2 }],
    weights,
    DEFAULT_SHARD_TIMEOUT_SECONDS,
  );
  assert.equal(projected.fits, false);
  assert.equal(projected.predictedFrom, "measured");
  assert.equal(projected.atLeast, false);
});

test("a measured suite that fits is left alone", () => {
  const weights = suiteWeights({
    durations: { suites: { "outcome-ledger-repair": { seconds: 600 } } },
  });
  const [projected] = projectShardRuntime(
    [{ suite: "outcome-ledger-repair", shardCount: 2 }],
    weights,
    DEFAULT_SHARD_TIMEOUT_SECONDS,
  );
  assert.equal(projected.fits, true);
  assert.equal(projected.perShardSeconds, 300);
});

test("the source-size fallback predicts nothing rather than comparing bytes to seconds", () => {
  // suiteWeights falls back to counting source bytes when no duration exists.
  // Dividing bytes by shards and comparing the result to a timeout is a unit
  // error that would still typecheck, and would either block every plan or
  // clear every plan depending on file sizes. It must abstain instead.
  const weights = suiteWeights({ durations: { suites: {} } });
  const entry = weights.get("outcome-ledger-repair");
  assert.equal(entry.measured, false);
  assert.equal(entry.capped, false);

  const [projected] = projectShardRuntime(
    [{ suite: "outcome-ledger-repair", shardCount: 2 }],
    weights,
    DEFAULT_SHARD_TIMEOUT_SECONDS,
  );
  assert.equal(projected.perShardSeconds, null);
  assert.equal(projected.fits, true);
  assert.equal(projected.predictedFrom, "size");
});

test("the real plan reports the overrun this repository currently has", () => {
  // Reads the checked-in durations file rather than a fixture, so if the
  // outcome-ledger-repair cost is ever genuinely fixed and re-measured, this
  // test fails and someone has to decide whether the guard is still needed.
  const plan = buildToolingSmokeMatrix({ changedFiles: [] });
  assert.ok(plan.projection.length > 0);
  assert.deepEqual(plan.overrunSuites, ["outcome-ledger-repair"]);
  assert.equal(plan.shardTimeoutSeconds, DEFAULT_SHARD_TIMEOUT_SECONDS);

  // Every other suite has a real measurement and is expected to fit.
  for (const entry of plan.projection) {
    if (entry.suite === "outcome-ledger-repair") continue;
    assert.equal(entry.fits, true, `${entry.suite} was expected to fit`);
    assert.equal(entry.predictedFrom, "measured");
  }
});

test("the plan still schedules work when a suite is predicted to overrun", () => {
  // Deliberate. Refusing to schedule would turn one slow suite into a total
  // lane outage, and the shards do produce real signal before they are killed.
  // The guard exists to make the overrun visible and attributable, not to stop
  // the lane. Changing this to a hard failure is a policy decision.
  const plan = buildToolingSmokeMatrix({ changedFiles: [] });
  assert.ok(plan.overrunSuites.includes("outcome-ledger-repair"));
  assert.equal(plan.applicable, true);
  assert.ok(
    plan.include.some((entry) => entry.suite === "outcome-ledger-repair"),
  );
});
