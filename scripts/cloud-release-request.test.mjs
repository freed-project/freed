import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  readFileSync,
  writeFileSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
} from "node:fs";
import {
  validateRequest,
  validateController,
  validateCloudCaller,
  preflight,
} from "./cloud-release-request.mjs";
const request = {
  channel: "dev",
  tag: "v26.10.200-dev",
  source_sha: "a".repeat(40),
  receipt_sha256: "b".repeat(64),
};
const policy = () => ({
  repository: "freed-project/freed",
  ref: "refs/heads/release-controller",
  sha: "a".repeat(40),
  approvedSha: "a".repeat(40),
  environment: {
    deployment_branch_policy: {
      custom_branch_policies: true,
      protected_branches: false,
    },
  },
  policies: [{ name: "release-controller", type: "branch" }],
  rulesets: [
    {
      target: "branch",
      enforcement: "active",
      bypass_actors: [],
      conditions: {
        ref_name: { include: ["refs/heads/release-controller"], exclude: [] },
      },
      rules: [
        {
          type: "pull_request",
          parameters: {
            required_approving_review_count: 1,
            require_code_owner_review: true,
            dismiss_stale_reviews_on_push: true,
            require_last_push_approval: true,
          },
        },
        { type: "deletion" },
        { type: "non_fast_forward" },
      ],
    },
  ],
});
test("explicit channel is bound to immutable source and receipt", () => {
  assert.deepEqual(validateRequest(request), request);
  assert.equal(
    validateRequest({ ...request, channel: "production", tag: "v26.10.200" })
      .channel,
    "production",
  );
  for (const changed of [
    { channel: undefined },
    { tag: "v26.10.200" },
    { source_sha: "dev" },
    { receipt_sha256: "b".repeat(63) },
    { tag: "v26.10.0200-dev" },
    { tag: "v26.10.200-dev;echo" },
  ])
    assert.throws(() => validateRequest({ ...request, ...changed }));
});
test("only pinned protected owner-reviewed controller can reach App job", () => {
  assert.doesNotThrow(() => validateController(policy()));
  for (const change of [
    { repository: "fork/freed" },
    { ref: "refs/heads/dev" },
    { sha: "c".repeat(40) },
    { approvedSha: "" },
    { policies: [{ name: "*", type: "branch" }] },
    { policies: [{ name: "release-controller", type: "tag" }] },
    { rulesets: [] },
  ])
    assert.throws(() => validateController({ ...policy(), ...change }));
  for (const field of [
    "require_code_owner_review",
    "dismiss_stale_reviews_on_push",
    "require_last_push_approval",
  ]) {
    const value = policy();
    value.rulesets[0].rules[0].parameters[field] = false;
    assert.throws(() => validateController(value));
  }
  const bypass = policy();
  bypass.rulesets[0].bypass_actors = [{ actor_id: 1 }];
  assert.throws(() => validateController(bypass));
});
test("credential scope follows preflight and never runs candidate scripts", () => {
  const workflow = readFileSync(
    new URL("../.github/workflows/cloud-release-request.yml", import.meta.url),
    "utf8",
  );
  assert.ok(
    workflow.indexOf("preflight candidate") <
      workflow.indexOf("secrets.RELEASE_APP_PRIVATE_KEY"),
  );
  assert.match(workflow, /environment: release-publisher/);
  assert.match(workflow, /persist-credentials: false/);
  assert.match(workflow, /cancel-in-progress: false/);
  assert.doesNotMatch(
    workflow,
    /candidate\/(?:scripts|node_modules)|working-directory: candidate|npm (?:ci|install)/,
  );
  assert.match(workflow, /prepare-candidate candidate/);
  assert.match(workflow, /cd "\$GITHUB_WORKSPACE\/candidate"/);
  assert.match(
    workflow,
    /node "\$GITHUB_WORKSPACE\/controller\/scripts\/release-tag-publisher.mjs" publish/,
  );
  assert.match(workflow, /trap 'rm -f --/);
});

test("cloud inbox cannot forge owner identity or substitute immutable request content", () => {
  const bound = { ...request, request_run_id: "42" };
  const run = {
    id: 42,
    event: "push",
    actor: { login: "AubreyF" },
    head_repository: { full_name: "freed-project/freed" },
    head_branch: "release-requests/demo",
    head_sha: "c".repeat(40),
  };
  assert.doesNotThrow(() => validateCloudCaller({ actor: "AubreyF", request }));
  assert.doesNotThrow(() =>
    validateCloudCaller({
      actor: "github-actions[bot]",
      run,
      committedRequest: request,
      request: bound,
    }),
  );
  for (const bad of [
    { actor: "collaborator" },
    { run: { ...run, event: "workflow_dispatch" } },
    { run: { ...run, actor: { login: "collaborator" } } },
    { run: { ...run, head_branch: "dev" } },
    { run: { ...run, head_repository: { full_name: "fork/freed" } } },
    {
      committedRequest: {
        ...request,
        channel: "production",
        tag: "v26.10.200",
      },
    },
  ])
    assert.throws(() =>
      validateCloudCaller({
        actor: "github-actions[bot]",
        run,
        committedRequest: request,
        request: bound,
        ...bad,
      }),
    );
  const inbox = readFileSync(
    new URL("../.github/workflows/cloud-release-inbox.yml", import.meta.url),
    "utf8",
  );
  assert.doesNotMatch(inbox, /secrets\.|checkout@|npm |release-tag-publisher/);
  assert.match(inbox, /actions: write/);
  assert.match(inbox, /request_run_id:process.env.GITHUB_RUN_ID/);
});

test("real candidate metadata is bound before trusted CLI validation and remote settlement", () => {
  const directory = mkdtempSync(
    path.join(os.tmpdir(), "freed-cloud-preflight-"),
  );
  try {
    const git = (...args) =>
      execFileSync("git", args, { cwd: directory, encoding: "utf8" }).trim();
    git("init", "--initial-branch=dev");
    git("config", "user.email", "fixture@example.invalid");
    git("config", "user.name", "Synthetic Fixture");
    mkdirSync(path.join(directory, "release-notes/releases"), {
      recursive: true,
    });
    const bytes = JSON.stringify({ synthetic: true });
    writeFileSync(
      path.join(directory, `release-notes/releases/${request.tag}.json`),
      bytes,
    );
    git("add", ".");
    git("commit", "-m", "synthetic admission fixture");
    const sha = git("rev-parse", "HEAD");
    git("update-ref", "refs/remotes/origin/dev", sha);
    const digest = createHash("sha256").update(bytes).digest("hex"),
      bound = { ...request, source_sha: sha, receipt_sha256: digest },
      calls = [];
    const run = (file, args) => {
      calls.push({ file, args });
      return file === "synthetic-gh" ? JSON.stringify({ object: { sha } }) : "";
    };
    assert.equal(
      preflight(bound, directory, { run, gh: "synthetic-gh" }).source_sha,
      sha,
    );
    assert.ok(
      calls.some(
        (call) =>
          call.args[0].endsWith("/scripts/validate-release-identity.mjs") &&
          call.args.includes(`--cwd=${directory}`) &&
          call.args.includes(`--head-ref=${sha}`),
      ),
    );
    assert.ok(calls.every((call) => !call.args[0].startsWith(directory)));
    assert.throws(
      () =>
        preflight({ ...bound, receipt_sha256: "f".repeat(64) }, directory, {
          run,
          gh: "synthetic-gh",
        }),
      /digest mismatch/,
    );
    assert.throws(
      () =>
        preflight(bound, directory, {
          run: (file, args) =>
            file === "synthetic-gh"
              ? JSON.stringify({ object: { sha: "d".repeat(40) } })
              : run(file, args),
          gh: "synthetic-gh",
        }),
      /advanced/,
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
