import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import {
  fetchWorkflowRuns,
  parseArgs,
  releaseOnlyParent,
  selectExactIntegrationReceipt,
  selectIntegrationReceipt,
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

test("release-only metadata may inherit the exact successful parent receipt", () => {
  const parentSha = "b".repeat(40);
  const receipt = selectIntegrationReceipt(
    {
      workflow_runs: [
        run({ status: "in_progress", conclusion: null }),
        run({ id: 41, head_sha: parentSha }),
      ],
    },
    OPTIONS,
    { inheritedFromSha: parentSha },
  );

  assert.equal(receipt.schemaVersion, 2);
  assert.equal(receipt.headSha, OPTIONS.sha);
  assert.equal(receipt.validationHeadSha, parentSha);
  assert.equal(receipt.inheritedFromSha, parentSha);
  assert.equal(receipt.changeScope, "release-only");
  assert.equal(receipt.runId, 41);
});

test("a failed exact run cannot be replaced by an inherited receipt", () => {
  const parentSha = "b".repeat(40);
  assert.throws(
    () =>
      selectIntegrationReceipt(
        {
          workflow_runs: [
            run({ conclusion: "failure" }),
            run({ id: 41, head_sha: parentSha }),
          ],
        },
        OPTIONS,
        { inheritedFromSha: parentSha },
      ),
    /concluded failure/,
  );
});

test("a cancelled metadata-only run may inherit the successful parent receipt", () => {
  const parentSha = "b".repeat(40);
  const receipt = selectIntegrationReceipt(
    {
      workflow_runs: [
        run({ conclusion: "cancelled" }),
        run({ id: 41, head_sha: parentSha }),
      ],
    },
    OPTIONS,
    { inheritedFromSha: parentSha },
  );

  assert.equal(receipt.schemaVersion, 2);
  assert.equal(receipt.headSha, OPTIONS.sha);
  assert.equal(receipt.validationHeadSha, parentSha);
  assert.equal(receipt.runId, 41);
});

function git(cwd, args) {
  return execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
}

function commit(cwd, message) {
  git(cwd, ["add", "."]);
  git(cwd, [
    "-c",
    "user.name=Freed Tests",
    "-c",
    "user.email=tests@freed.invalid",
    "commit",
    "-m",
    message,
  ]);
  return git(cwd, ["rev-parse", "HEAD"]);
}

test("releaseOnlyParent accepts only a single-parent release metadata change", () => {
  const cwd = mkdtempSync(path.join(tmpdir(), "freed-dev-receipt-"));
  git(cwd, ["init", "-q"]);
  mkdirSync(path.join(cwd, "release-notes", "releases"), { recursive: true });
  mkdirSync(path.join(cwd, "packages", "desktop", "src-tauri"), {
    recursive: true,
  });
  writeFileSync(path.join(cwd, "app.txt"), "product\n");
  writeFileSync(
    path.join(cwd, "packages", "desktop", "package.json"),
    '{"version":"1.0.0"}\n',
  );
  writeFileSync(
    path.join(cwd, "packages", "desktop", "src-tauri", "Cargo.lock"),
    '[[package]]\nname = "freed-desktop"\nversion = "1.0.0"\n',
  );
  writeFileSync(
    path.join(cwd, "release-notes", "releases", "v1.json"),
    '{"approved":false}\n',
  );
  const parent = commit(cwd, "initial");

  writeFileSync(
    path.join(cwd, "release-notes", "releases", "v1.json"),
    '{"approved":true}\n',
  );
  writeFileSync(
    path.join(cwd, "packages", "desktop", "package.json"),
    '{"version":"1.0.1"}\n',
  );
  writeFileSync(
    path.join(cwd, "packages", "desktop", "src-tauri", "Cargo.lock"),
    '[[package]]\nname = "freed-desktop"\nversion = "1.0.1"\n',
  );
  const releaseCommit = commit(cwd, "release metadata");
  assert.equal(releaseOnlyParent(releaseCommit, { cwd }), parent);

  writeFileSync(path.join(cwd, "app.txt"), "changed product\n");
  const productCommit = commit(cwd, "product change");
  assert.equal(releaseOnlyParent(productCommit, { cwd }), null);
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
