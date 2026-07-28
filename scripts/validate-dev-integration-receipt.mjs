#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  CARGO_LOCK_PATH,
  inspectCargoLockReleaseChange,
} from "./lib/cargo-lock-release.mjs";
import { isReleaseOnlyFile } from "./release-promotion-shared.mjs";

const DEFAULT_REPOSITORY = "freed-project/freed";
const DEFAULT_BRANCH = "dev";
const DEFAULT_WORKFLOW = "ci.yml";
const BLOCKING_CONCLUSIONS = new Set([
  "action_required",
  "failure",
  "timed_out",
]);

function fail(message) {
  throw new Error(message);
}

export function parseArgs(argv) {
  const parsed = {
    branch: DEFAULT_BRANCH,
    repository: DEFAULT_REPOSITORY,
    sha: "",
    workflow: DEFAULT_WORKFLOW,
  };

  for (const argument of argv) {
    if (argument.startsWith("--branch=")) {
      parsed.branch = argument.slice("--branch=".length);
    } else if (argument.startsWith("--repo=")) {
      parsed.repository = argument.slice("--repo=".length);
    } else if (argument.startsWith("--sha=")) {
      parsed.sha = argument.slice("--sha=".length);
    } else if (argument.startsWith("--workflow=")) {
      parsed.workflow = argument.slice("--workflow=".length);
    } else {
      fail(`Unknown integration receipt argument: ${argument}`);
    }
  }

  if (!/^[^/]+\/[^/]+$/.test(parsed.repository)) {
    fail("--repo must be an owner/repository pair.");
  }
  if (!/^[0-9a-f]{40}$/i.test(parsed.sha)) {
    fail("--sha must be one full Git commit SHA.");
  }
  if (!parsed.branch) fail("--branch must not be empty.");
  if (!/^[A-Za-z0-9._-]+\.ya?ml$/.test(parsed.workflow)) {
    fail("--workflow must be one workflow file name.");
  }

  return Object.freeze(parsed);
}

function resolveToken() {
  const configured = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
  if (configured) return configured;
  try {
    return execFileSync("gh", ["auth", "token"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return "";
  }
}

function normalizeRuns(payload) {
  if (!payload || !Array.isArray(payload.workflow_runs)) {
    fail("GitHub returned an invalid workflow-runs response.");
  }
  return payload.workflow_runs;
}

function successfulRun(payload, { branch, sha }) {
  return normalizeRuns(payload)
    .filter(
      (run) =>
        run.head_sha === sha &&
        run.head_branch === branch &&
        run.event === "push",
    )
    .sort((left, right) => Number(right.id) - Number(left.id))
    .find((run) => run.status === "completed" && run.conclusion === "success");
}

function receiptFromRun(run, options, overrides = {}) {
  return Object.freeze({
    schemaVersion: 1,
    repository: options.repository,
    workflow: options.workflow,
    branch: options.branch,
    event: "push",
    headSha: options.sha,
    runId: run.id,
    runAttempt: run.run_attempt ?? 1,
    conclusion: run.conclusion,
    completedAt: run.updated_at,
    url: run.html_url,
    ...overrides,
  });
}

export function selectExactIntegrationReceipt(
  payload,
  options,
) {
  const { branch, sha } = options;
  const exact = normalizeRuns(payload)
    .filter(
      (run) =>
        run.head_sha === sha &&
        run.head_branch === branch &&
        run.event === "push",
    )
    .sort((left, right) => Number(right.id) - Number(left.id));

  const successful = successfulRun(payload, options);
  if (successful) {
    return receiptFromRun(successful, options);
  }

  const pending = exact.find((run) => run.status !== "completed");
  if (pending) {
    fail(
      `Exact dev integration is still ${pending.status}: ${pending.html_url ?? `run ${pending.id}`}`,
    );
  }

  const failed = exact.find((run) => run.status === "completed");
  if (failed) {
    fail(
      `Exact dev integration concluded ${failed.conclusion}: ${failed.html_url ?? `run ${failed.id}`}`,
    );
  }

  fail(
    `No push validation receipt exists for ${branch} at ${sha}. Merge through the protected branch and wait for Validation to finish.`,
  );
}

function runGit(args, cwd) {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  }).trim();
}

export function releaseOnlyParent(sha, { cwd = process.cwd() } = {}) {
  try {
    const parents = runGit(["show", "-s", "--format=%P", sha], cwd)
      .split(/\s+/)
      .filter(Boolean);
    if (parents.length !== 1) return null;

    const [parent] = parents;
    const files = runGit(
      ["diff", "--name-only", "--no-renames", parent, sha],
      cwd,
    )
      .split(/\r?\n/)
      .map((file) => file.trim())
      .filter(Boolean);
    if (files.length === 0) return null;

    const releaseOnly = files.every((file) => {
      if (isReleaseOnlyFile(file)) return true;
      if (file !== CARGO_LOCK_PATH) return false;
      return inspectCargoLockReleaseChange({
        fromRef: parent,
        toRef: sha,
        cwd,
      }).ok;
    });
    return releaseOnly ? parent : null;
  } catch {
    return null;
  }
}

export function selectIntegrationReceipt(
  payload,
  options,
  { inheritedFromSha = null } = {},
) {
  const exactRuns = normalizeRuns(payload).filter(
    (run) =>
      run.head_sha === options.sha &&
      run.head_branch === options.branch &&
      run.event === "push",
  );
  const exactFailure = exactRuns.find(
    (run) =>
      run.status === "completed" &&
      BLOCKING_CONCLUSIONS.has(run.conclusion),
  );
  if (exactFailure || !inheritedFromSha) {
    return selectExactIntegrationReceipt(payload, options);
  }

  const exactSuccess = successfulRun(payload, options);
  if (exactSuccess) return receiptFromRun(exactSuccess, options);

  const inherited = successfulRun(payload, {
    ...options,
    sha: inheritedFromSha,
  });
  if (!inherited) return selectExactIntegrationReceipt(payload, options);

  return receiptFromRun(inherited, options, {
    schemaVersion: 2,
    inherited: true,
    inheritedFromSha,
    validationHeadSha: inheritedFromSha,
    changeScope: "release-only",
  });
}

export async function fetchWorkflowRuns(
  { branch, repository, workflow },
  { token = resolveToken(), fetchImpl = fetch } = {},
) {
  if (!token) {
    fail(
      "GitHub authentication is required. Set GITHUB_TOKEN or authenticate the GitHub CLI.",
    );
  }
  const endpoint = new URL(
    `https://api.github.com/repos/${repository}/actions/workflows/${encodeURIComponent(workflow)}/runs`,
  );
  endpoint.searchParams.set("branch", branch);
  endpoint.searchParams.set("event", "push");
  endpoint.searchParams.set("per_page", "100");

  const response = await fetchImpl(endpoint, {
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "freed-release-admission",
    },
  });
  if (!response.ok) {
    fail(
      `GitHub workflow lookup failed with ${response.status.toLocaleString()} ${response.statusText}.`,
    );
  }
  return response.json();
}

export async function validateDevIntegrationReceipt(options, dependencies) {
  const payload = await fetchWorkflowRuns(options, dependencies);
  return selectIntegrationReceipt(payload, options, {
    inheritedFromSha: releaseOnlyParent(options.sha, dependencies),
  });
}

async function main(argv) {
  const options = parseArgs(argv);
  const receipt = await validateDevIntegrationReceipt(options);
  process.stdout.write(`${JSON.stringify(receipt, null, 2)}\n`);
}

if (
  typeof process.argv[1] === "string" &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  main(process.argv.slice(2)).catch((error) => {
    process.stderr.write(
      `${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exitCode = 1;
  });
}
