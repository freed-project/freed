#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { RELEASE_ONLY_FILES, listPromotionDiffFiles } from "./release-promotion-shared.mjs";
import { isVersionOnlyChange, validateDevIntegrationReceipt } from "./validate-dev-integration-receipt.mjs";

function git(args, cwd) {
  return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

// Promotion trailers select a candidate, never prove its equivalence. A newer
// release artifact takes precedence only if its entire product tree matches.
export function resolveIntegrationSource({ cwd = process.cwd(), headRef = "HEAD", snapshots = [] } = {}) {
  const candidates = [...snapshots];
  const version = JSON.parse(git(["show", `${headRef}:packages/desktop/package.json`], cwd)).version;
  if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error("Invalid release version");
  try {
    const artifact = JSON.parse(git(["show", `${headRef}:release-notes/releases/v${version}.json`], cwd));
    candidates.push(artifact.source?.promotedDevCommitSha);
  } catch { /* A promotion may precede release preparation. */ }
  candidates.push(...git(["log", "-100", "--format=%(trailers:key=Freed-Dev-Snapshot,valueonly)", headRef], cwd).split(/\s+/));
  const reasons = [];
  for (const sha of [...new Set(candidates)].filter((value) => /^[0-9a-f]{40}$/.test(value ?? ""))) {
    const mismatches = listPromotionDiffFiles({ fromRef: sha, toRef: headRef, cwd });
    for (const file of RELEASE_ONLY_FILES) {
      if (git(["diff", "--name-only", sha, headRef, "--", file], cwd) &&
          !isVersionOnlyChange(file, sha, headRef, { cwd })) mismatches.push(file);
    }
    if (mismatches.length === 0) return sha;
    reasons.push(`${sha}: ${mismatches.join(", ")}`);
  }
  throw new Error(`No immutable dev snapshot matches release inputs. ${reasons.join("; ")}`);
}

export function readMergedPromotionSnapshots(head, api) {
  const pulls = api(`commits/${head}/pulls`);
  return pulls.filter((pr) =>
    pr.merged_at && pr.merge_commit_sha === head && pr.base.ref === "main" &&
    /^[0-9a-f]{40}$/.test(pr.head.sha),
  ).flatMap((pr) => {
    const message = api(`commits/${pr.head.sha}`).commit.message;
    return [...message.matchAll(/^Freed-Dev-Snapshot: ([0-9a-f]{40})$/gm)]
      .map((match) => match[1]);
  });
}

export async function validateReleaseIntegration(options = {}, dependencies) {
  if (git(["status", "--porcelain"], options.cwd ?? process.cwd())) {
    throw new Error("Release integration reuse requires a clean worktree.");
  }
  const repository = process.env.GITHUB_REPOSITORY || "freed-project/freed";
  let sha;
  try {
    sha = resolveIntegrationSource(options);
  } catch (originalError) {
    // Squash merges may omit commit trailers. Recover the recorded snapshot
    // from the merged PR's immutable head, never from the moving dev tip.
    const head = git(["rev-parse", `${options.headRef ?? "HEAD"}^{commit}`], options.cwd);
    const api = (endpoint) => JSON.parse(execFileSync("gh", ["api", `repos/${repository}/${endpoint}`], {
      encoding: "utf8", stdio: ["ignore", "pipe", "pipe"],
    }));
    const snapshots = readMergedPromotionSnapshots(head, api);
    if (snapshots.length === 0) throw originalError;
    sha = resolveIntegrationSource({ ...options, snapshots });
  }
  return validateDevIntegrationReceipt({
    repository,
    workflow: "ci.yml", branch: "dev", sha,
  }, { ...dependencies, cwd: options.cwd ?? process.cwd() });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  validateReleaseIntegration().then((receipt) => {
    console.log(JSON.stringify(receipt, null, 2));
  }).catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
