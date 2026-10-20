import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import yaml from "js-yaml";
import { publishControllerRepair } from "./publish-controller-repair.mjs";

const base = "4fddf2404f94af1b4495cab6ed273e141efebd6f";
const tree = "631fcc881fd4aa9dee6b0bf33da8fcc59c955f05";
const head = "a".repeat(40);
const branch = "fix/controller-activation-history-review";
const env = {
  GITHUB_REPOSITORY: "freed-project/freed",
  GITHUB_EVENT_NAME: "workflow_dispatch",
  GITHUB_REF: "refs/heads/dev",
  GITHUB_ACTOR: "AubreyF",
  GITHUB_ACTOR_ID: "2789037",
  GITHUB_TRIGGERING_ACTOR: "AubreyF",
  GITHUB_RUN_ATTEMPT: "1",
};
function fixture(override = () => undefined) {
  const calls = [];
  const api = async (method, route, body, allowMissing) => {
    calls.push({ method, route, body, allowMissing });
    const replacement = override({ method, route, body, calls });
    if (replacement !== undefined) return replacement;
    if (route === "git/ref/heads/release-controller")
      return { object: { type: "commit", sha: base } };
    if (route === `git/ref/heads/${branch}`) {
      assert.equal(allowMissing, true);
      return null;
    }
    if (route === `git/commits/${base}`)
      return { sha: base, tree: { sha: "b".repeat(40) } };
    if (route === "git/trees") return { sha: tree };
    if (route === "git/commits")
      return { sha: head, tree: { sha: tree }, parents: [{ sha: base }] };
    if (route === "git/refs") return { object: { sha: head } };
    if (route === "pulls")
      return {
        number: 999,
        html_url: "https://github.com/freed-project/freed/pull/999",
        user: { login: "github-actions[bot]" },
        head: { sha: head },
        base: { ref: "release-controller" },
        draft: true,
      };
    throw new Error(`Unexpected API route ${method} ${route}`);
  };
  return { calls, api };
}

test("proposal writes only the pinned two-file tree, bot commit, new branch and draft PR", async () => {
  const { api, calls } = fixture();
  const receipt = await publishControllerRepair({ env, api });
  assert.equal(receipt.status, "awaiting-owner-review");
  const writes = calls.filter(({ method }) => method !== "GET");
  assert.deepEqual(
    writes.map(({ route }) => route),
    ["git/trees", "git/commits", "git/refs", "pulls"],
  );
  assert.deepEqual(writes[0].body, {
    base_tree: "b".repeat(40),
    tree: [
      {
        path: "scripts/lib/library-core-release-activation.mjs",
        mode: "100644",
        type: "blob",
        sha: "d088603e20620f66572751cb5190be8c5cc9efaa",
      },
      {
        path: "scripts/lib/library-core-release-activation.test.mjs",
        mode: "100644",
        type: "blob",
        sha: "1efd4c76a1fffed769c397cd75d4e74d474009da",
      },
    ],
  });
  assert.deepEqual(writes[1].body, {
    message: "fix: canonicalize controller activation history",
    tree,
    parents: [base],
  });
  assert.deepEqual(writes[2].body, { ref: `refs/heads/${branch}`, sha: head });
  assert.equal(writes[3].body.base, "release-controller");
  assert.equal(writes[3].body.draft, true);
  assert.match(writes[3].body.body, /^\(AI Generated\)\.\n\n/);
  assert.match(writes[3].body.body, /does not claim CI on this new commit/);
});

test("wrong caller, repository, event, ref and reruns fail before any API request", async () => {
  for (const key of Object.keys(env)) {
    const { api, calls } = fixture();
    await assert.rejects(
      publishControllerRepair({ env: { ...env, [key]: "wrong" }, api }),
      /original owner dispatch/,
    );
    assert.equal(calls.length, 0);
  }
});

test("existing branch and moved base never produce writes", async () => {
  for (const route of [
    `git/ref/heads/${branch}`,
    "git/ref/heads/release-controller",
  ]) {
    const { api, calls } = fixture((call) =>
      call.route === route
        ? { object: { type: "commit", sha: head } }
        : undefined,
    );
    await assert.rejects(
      publishControllerRepair({ env, api }),
      /base moved|branch already exists/,
    );
    assert.equal(calls.filter(({ method }) => method !== "GET").length, 0);
  }
});

test("wrong tree or commit cannot create a branch", async () => {
  for (const route of ["git/trees", "git/commits"]) {
    const { api, calls } = fixture((call) =>
      call.route === route ? { sha: head } : undefined,
    );
    await assert.rejects(
      publishControllerRepair({ env, api }),
      /tree differs|commit identity/,
    );
    assert.equal(
      calls.some(({ route }) => route === "git/refs"),
      false,
    );
  }
});

test("base advancement during preparation prevents branch and PR publication", async () => {
  let reads = 0;
  const { api, calls } = fixture(({ route }) => {
    if (route === "git/ref/heads/release-controller" && ++reads === 2)
      return { object: { type: "commit", sha: head } };
  });
  await assert.rejects(publishControllerRepair({ env, api }), /base moved/);
  assert.equal(
    calls.some(({ route }) => route === "git/refs"),
    false,
  );
});

test("unexpected PR author cannot be reported as a successful owner-review handoff", async () => {
  const { api } = fixture(({ route }) =>
    route === "pulls" ? { user: { login: "AubreyF" } } : undefined,
  );
  await assert.rejects(
    publishControllerRepair({ env, api }),
    /PR identity mismatch/,
  );
});

test("partial publication errors are preserved without retries or cleanup writes", async () => {
  const { api: inner, calls } = fixture();
  const api = async (...args) => {
    if (args[1] === "pulls") throw new Error("HTTP 403");
    return inner(...args);
  };
  await assert.rejects(publishControllerRepair({ env, api }), /HTTP 403/);
  assert.equal(calls.filter(({ route }) => route === "git/refs").length, 1);
  assert.equal(
    calls.some(({ method }) => ["DELETE", "PATCH", "PUT"].includes(method)),
    false,
  );
});

test("workflow uses owner dispatch and job-local token, with no release environment or App key", () => {
  const workflow = readFileSync(
    new URL(
      "../.github/workflows/controller-repair-proposal.yml",
      import.meta.url,
    ),
    "utf8",
  );
  const parsed = yaml.load(workflow);
  assert.deepEqual(parsed.on, { workflow_dispatch: null });
  assert.deepEqual(parsed.permissions, { contents: "read" });
  assert.deepEqual(parsed.jobs.propose.permissions, {
    contents: "write",
    "pull-requests": "write",
  });
  const proof = parsed.jobs["verify-proposal"];
  assert.equal(proof.needs, "propose");
  assert.deepEqual(proof.permissions, { contents: "read" });
  assert.equal(proof.steps[0].with.ref, "${{ needs.propose.outputs.head }}");
  assert.equal(proof.steps[0].with["persist-credentials"], false);
  assert.match(proof.steps.at(-1).run, /git rev-parse HEAD/);
  assert.match(
    proof.steps.at(-1).run,
    /node --test scripts\/lib\/library-core-release-activation.test.mjs/,
  );
  assert.match(workflow, /workflow_dispatch:/);
  assert.match(workflow, /github.actor_id == '2789037'/);
  assert.match(workflow, /github.triggering_actor == 'AubreyF'/);
  assert.match(workflow, /github.ref == 'refs\/heads\/dev'/);
  assert.match(workflow, /github.run_attempt == 1/);
  assert.match(workflow, /persist-credentials: false/);
  assert.match(workflow, /GH_TOKEN: \$\{\{ github.token \}\}/);
  assert.match(workflow, /run: node scripts\/publish-controller-repair.mjs/);
  assert.doesNotMatch(
    workflow,
    /secrets\.|environment:|pull_request_target|actions: write|id-token: write/,
  );
});
