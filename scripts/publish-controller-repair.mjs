#!/usr/bin/env node
import { appendFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

// One reviewed repair, not an arbitrary controller write capability. Both blobs
// already exist in the selected product commit; no candidate code is executed.
const repository = "freed-project/freed";
const base = "4fddf2404f94af1b4495cab6ed273e141efebd6f";
const expectedTree = "631fcc881fd4aa9dee6b0bf33da8fcc59c955f05";
const branch = "fix/controller-activation-history-review";
const title = "fix: canonicalize controller activation history";
const tree = [
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
];

export async function publishControllerRepair({ env = process.env, api }) {
  if (
    env.GITHUB_REPOSITORY !== repository ||
    env.GITHUB_EVENT_NAME !== "workflow_dispatch" ||
    env.GITHUB_REF !== "refs/heads/dev" ||
    env.GITHUB_ACTOR !== "AubreyF" ||
    env.GITHUB_ACTOR_ID !== "2789037" ||
    env.GITHUB_TRIGGERING_ACTOR !== "AubreyF" ||
    env.GITHUB_RUN_ATTEMPT !== "1"
  ) {
    throw new Error(
      "Requires an original owner dispatch from dev in freed-project/freed",
    );
  }
  const requireBase = async () => {
    const ref = await api("GET", "git/ref/heads/release-controller");
    if (ref.object?.type !== "commit" || ref.object.sha !== base)
      throw new Error(
        "Controller base moved; review a new repair before publication",
      );
  };
  await requireBase();
  const existing = await api("GET", `git/ref/heads/${branch}`, undefined, true);
  if (existing !== null)
    throw new Error(
      "Repair branch already exists; inspect its PR and workflow receipt before recovery. Never force-push it",
    );
  const parent = await api("GET", `git/commits/${base}`);
  if (parent.sha !== base || !/^[a-f0-9]{40}$/.test(parent.tree?.sha ?? ""))
    throw new Error("Invalid pinned controller commit");
  const resultTree = await api("POST", "git/trees", {
    base_tree: parent.tree.sha,
    tree,
  });
  if (resultTree.sha !== expectedTree)
    throw new Error(
      "Repair tree differs from the locally tested two-file patch",
    );
  // Omitting author/committer lets GitHub attribute the commit to the token's
  // installation identity, rather than impersonating the human reviewer.
  const commit = await api("POST", "git/commits", {
    message: title,
    tree: expectedTree,
    parents: [base],
  });
  if (
    !/^[a-f0-9]{40}$/.test(commit.sha ?? "") ||
    commit.tree?.sha !== expectedTree ||
    commit.parents?.length !== 1 ||
    commit.parents[0].sha !== base
  )
    throw new Error("Unexpected repair commit identity");
  await requireBase();
  await api("POST", "git/refs", {
    ref: `refs/heads/${branch}`,
    sha: commit.sha,
  });
  const pull = await api("POST", "pulls", {
    title,
    head: branch,
    base: "release-controller",
    draft: true,
    body: `(AI Generated).\n\nCanonicalize the combined activation history before validation. Individually valid append-only edges can introduce IDs that sort before earlier IDs; duplicate rejection and per-edge validation remain enforced.\n\nThis bot-created proposal copies exactly two pinned blobs from reviewed product source 809b0670b8d62b68a44258b9beb493b7542d5fb4 onto controller ${base}. Its complete tree ${expectedTree} equals the locally tested repair 7eee558f7ef7e93c40f09c282d4bd53a9dd84843. Local evidence: 27 activation tests and the feature gate, including 82 activation/identity tests, passed on that repair. This does not claim CI on this new commit.\n\nAubreyF must review the exact proposal under the existing CODEOWNER and last-push requirements. Approve any pending GitHub workflow runs and verify their results before ready/merge. This workflow does not approve or merge the PR, change the controller pin, or authorize a release or Library activation.`,
  });
  if (
    pull.user?.login !== "github-actions[bot]" ||
    pull.head?.sha !== commit.sha ||
    pull.base?.ref !== "release-controller" ||
    pull.draft !== true ||
    !Number.isSafeInteger(pull.number) ||
    pull.html_url !== `https://github.com/${repository}/pull/${pull.number}`
  ) {
    throw new Error(
      "Created PR identity mismatch; inspect the retained branch and PR before any further action",
    );
  }
  return {
    pullRequest: pull.html_url,
    head: commit.sha,
    base,
    tree: expectedTree,
    status: "awaiting-owner-review",
  };
}

async function main() {
  if (!process.env.GH_TOKEN) throw new Error("Missing workflow GITHUB_TOKEN");
  const api = async (method, route, body, allowMissing = false) => {
    const response = await fetch(
      `https://api.github.com/repos/${repository}/${route}`,
      {
        method,
        redirect: "error",
        signal: AbortSignal.timeout(30_000),
        headers: {
          Authorization: `Bearer ${process.env.GH_TOKEN}`,
          Accept: "application/vnd.github+json",
          "Content-Type": "application/json",
          "X-GitHub-Api-Version": "2022-11-28",
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      },
    );
    if (response.status === 404 && allowMissing) return null;
    if (!response.ok)
      throw new Error(
        `Controller repair API ${method} ${route}: HTTP ${response.status}. Preserve any created branch; do not retry blindly`,
      );
    return response.json();
  };
  const receipt = await publishControllerRepair({ api });
  console.log(JSON.stringify(receipt, null, 2));
  if (process.env.GITHUB_OUTPUT)
    appendFileSync(process.env.GITHUB_OUTPUT, `head=${receipt.head}\n`);
  if (process.env.GITHUB_STEP_SUMMARY)
    appendFileSync(
      process.env.GITHUB_STEP_SUMMARY,
      `Controller repair: ${receipt.pullRequest}\n\nHead: ${receipt.head}\n\nAwaiting owner review. Controller pin unchanged.\n`,
    );
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
