// NEVER MERGE: local contracts for the hosted cancellation experiment only.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import yaml from "js-yaml";

const sourceBytes = readFileSync(new URL("./source-ci.yml", import.meta.url));
const digest = "53a75ca66a5bc5e8c1c37444abbc995dd00cd96f1cc85b8a0146dc075821a6cb";
const source = yaml.load(sourceBytes.toString()).jobs["tooling-smoke"];
const probe = yaml.load(readFileSync(".github/workflows/tooling-nightly.yml", "utf8"));
const gate = probe.jobs["tooling-smoke"];
const status = gate.steps.find((s) => s.id === "status");
const guard = gate.steps.find((s) => s.id === "guard");
const receipt = gate.steps.at(-1);
const accepted = {
  EVENT_NAME: "pull_request", BASE_REF: "dev", REF: "refs/pull/2121/merge",
  FEATURE_RESULT: "success", OPFS_REQUIRED: "true", OPFS_RESULT: "success",
  PLAN_RESULT: "success", SHARD_RESULT: "success", NATIVE_RESULT: "success",
  APPLICABLE: "true", NATIVE_REQUIRED: "true", PREVIEW_REQUIRED: "true",
  PREVIEW_RESULT: "success", JOB_COUNT: "1",
};
function bash(run, env = {}) {
  return spawnSync("bash", ["--noprofile", "--norc", "-e", "-o", "pipefail", "-c", run],
    { env: { ...process.env, ...env }, encoding: "utf8", timeout: 5000 });
}

test("probe pins exact source and preserves real aggregate conditions and bodies", () => {
  assert.equal(createHash("sha256").update(sourceBytes).digest("hex"), digest);
  assert.deepEqual(gate.needs, source.needs);
  assert.equal(gate.needs.length, 6);
  assert.equal(gate.if, source.if);
  assert.equal(gate["timeout-minutes"], source["timeout-minutes"]);
  assert.equal(gate["runs-on"], source["runs-on"]);
  assert.equal(status.if, source.steps[0].if);
  assert.ok(status.run.startsWith(source.steps[0].run));
  assert.deepEqual(status.env, { ...source.steps[0].env,
    EVENT_NAME: accepted.EVENT_NAME, BASE_REF: accepted.BASE_REF, REF: accepted.REF });
  assert.deepEqual(guard, { ...source.steps[1], id: "guard" });
  assert.equal(receipt.if, "${{ always() }}");
  assert.ok(gate.steps.find((s) => s.id === "source").run.includes(digest));
  assert.match(status.run.slice(source.steps[0].run.length), /\nsleep 60\n/);
  assert.equal(gate.steps.indexOf(guard), gate.steps.indexOf(status) + 1);
});

test("probe is manual, bounded, read-only and contains only synthetic dependency work", () => {
  assert.deepEqual(probe.on, { workflow_dispatch: {} });
  assert.deepEqual(probe.permissions, { contents: "read" });
  assert.equal(probe.concurrency["cancel-in-progress"], false);
  assert.match(probe.concurrency.group, /^native-gate-cancel-proof-/);
  assert.match(probe.concurrency.group, /github.run_id/);
  assert.deepEqual(Object.keys(probe.jobs), [...source.needs, "tooling-smoke"]);
  for (const name of source.needs) {
    const job = probe.jobs[name];
    assert.equal(job["timeout-minutes"], 1);
    assert.equal(job["runs-on"], "ubuntu-latest");
    assert.equal(job.if, "github.event_name == 'workflow_dispatch' && github.ref == 'refs/heads/chore/native-gate-cancel-proof'");
    assert.equal(job.steps.length, 1);
    assert.match(job.steps[0].run, /^echo 'SYNTHETIC ONLY:/);
    assert.ok(job.steps[0].run.trim().split("\n").every((line) => line.startsWith("echo ")));
  }
  for (const job of Object.values(probe.jobs)) {
    assert.equal(job["continue-on-error"], undefined);
    assert.equal(job.permissions, undefined);
    for (const step of job.steps) {
      assert.equal(step["continue-on-error"], undefined);
      assert.doesNotMatch(JSON.stringify(step), /secrets\.|npm |cargo |gh |curl /);
      if (step.uses) {
        assert.equal(step.uses, "actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1");
        assert.equal(step.with["persist-credentials"], false);
        assert.equal(step.with.ref, "${{ github.sha }}");
      }
    }
  }
});

test("real accepted body reaches bounded rendezvous; rejected dependencies never do", (t) => {
  const dir = mkdtempSync(path.join(tmpdir(), "native-gate-cancel-contract-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  // No local minute-long sleep: record the actual wait argument and return.
  writeFileSync(path.join(dir, "sleep"), '#!/bin/sh\nprintf "%s" "$1" > "$WAIT_RECEIPT"\n', { mode: 0o700 });
  const env = { ...accepted, PATH: `${dir}:${process.env.PATH}`, WAIT_RECEIPT: path.join(dir, "wait"),
    GITHUB_STEP_SUMMARY: path.join(dir, "summary"), GITHUB_SHA: "synthetic", GITHUB_RUN_ID: "1", GITHUB_RUN_ATTEMPT: "1" };
  const run = bash(status.run, env);
  assert.equal(run.status, 0, run.stdout + run.stderr);
  assert.equal(readFileSync(env.WAIT_RECEIPT, "utf8"), "60");
  assert.match(run.stdout, /PROBE_RENDEZVOUS_OPEN status_body=success/);
  assert.match(readFileSync(env.GITHUB_STEP_SUMMARY, "utf8"), /PROBE_RENDEZVOUS_OPEN/);
  for (const changed of [{ OPFS_RESULT: "failure" }, { PREVIEW_RESULT: "skipped" }, { FEATURE_RESULT: "cancelled" }]) {
    const rejected = bash(status.run, { ...env, ...changed });
    assert.equal(rejected.status, 1);
    assert.doesNotMatch(rejected.stdout, /PROBE_RENDEZVOUS_OPEN/);
  }
  const failed = bash(guard.run);
  assert.equal(failed.status, 1);
  assert.match(failed.stdout, /Workflow cancellation prevents an acceptance verdict/);
});

test("evidence refuses missed cancellation, skipped guard, interruption and timeout", () => {
  for (const statusOutcome of ["success", "failure", "cancelled", "skipped", "timed_out", ""]) {
    for (const guardOutcome of ["success", "failure", "cancelled", "skipped", "timed_out", ""]) {
      const result = bash(receipt.run, { SOURCE_OUTCOME: "success", STATUS_OUTCOME: statusOutcome, GUARD_OUTCOME: guardOutcome });
      const proven = statusOutcome === "success" && guardOutcome === "failure";
      assert.equal(result.status, proven ? 0 : 1);
      assert.match(result.stdout, proven ? /PROBE_GUARD_EXECUTED_AND_FAILED/ : /PROBE_NOT_PROVEN/);
    }
  }
  assert.equal(bash(receipt.run, { SOURCE_OUTCOME: "failure", STATUS_OUTCOME: "success", GUARD_OUTCOME: "failure" }).status, 1);
});
