import assert from "node:assert/strict";
import test from "node:test";

import {
  fetchWorkflowRuns,
  parseArgs,
  selectExactIntegrationReceipt,
} from "./validate-dev-integration-receipt.mjs";

const OPTIONS = Object.freeze({
  branch: "dev",
  repository: "freed-project/freed",
  sha: "a".repeat(40),
  workflow: "ci.yml",
});

function run(overrides = {}) {
  return {
    id: 42,
    run_attempt: 1,
    event: "push",
    head_branch: "dev",
    head_sha: OPTIONS.sha,
    status: "completed",
    conclusion: "success",
    updated_at: "2026-07-27T20:00:00Z",
    html_url: "https://github.com/freed-project/freed/actions/runs/42",
    ...overrides,
  };
}

test("parseArgs requires an exact commit and workflow identity", () => {
  assert.deepEqual(
    parseArgs([
      "--repo=freed-project/freed",
      `--sha=${OPTIONS.sha}`,
      "--branch=dev",
      "--workflow=ci.yml",
    ]),
    OPTIONS,
  );
  assert.throws(() => parseArgs(["--sha=abc"]), /one full Git commit SHA/);
});

test("selectExactIntegrationReceipt accepts only a successful dev push at the exact SHA", () => {
  const receipt = selectExactIntegrationReceipt(
    {
      workflow_runs: [
        run({ id: 99, event: "pull_request" }),
        run({ id: 98, head_branch: "main" }),
        run({ id: 97, head_sha: "b".repeat(40) }),
        run(),
      ],
    },
    OPTIONS,
  );

  assert.equal(receipt.headSha, OPTIONS.sha);
  assert.equal(receipt.runId, 42);
  assert.equal(receipt.conclusion, "success");
  assert.equal(receipt.event, "push");
});

test("selectExactIntegrationReceipt rejects pending, failed, and missing proofs", () => {
  assert.throws(
    () =>
      selectExactIntegrationReceipt(
        {
          workflow_runs: [
            run({ status: "in_progress", conclusion: null }),
          ],
        },
        OPTIONS,
      ),
    /still in_progress/,
  );
  assert.throws(
    () =>
      selectExactIntegrationReceipt(
        { workflow_runs: [run({ conclusion: "failure" })] },
        OPTIONS,
      ),
    /concluded failure/,
  );
  assert.throws(
    () => selectExactIntegrationReceipt({ workflow_runs: [] }, OPTIONS),
    /No push validation receipt exists/,
  );
});

test("fetchWorkflowRuns binds the request to the reviewed workflow, branch, and push event", async () => {
  let requested;
  const payload = { workflow_runs: [] };
  const result = await fetchWorkflowRuns(OPTIONS, {
    token: "test-token",
    fetchImpl: async (url, init) => {
      requested = { url, init };
      return {
        ok: true,
        json: async () => payload,
      };
    },
  });

  assert.equal(result, payload);
  assert.equal(
    requested.url.pathname,
    "/repos/freed-project/freed/actions/workflows/ci.yml/runs",
  );
  assert.equal(requested.url.searchParams.get("branch"), "dev");
  assert.equal(requested.url.searchParams.get("event"), "push");
  assert.equal(requested.init.headers.Authorization, "Bearer test-token");
});
