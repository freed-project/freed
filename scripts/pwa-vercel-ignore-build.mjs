#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const PWA_BUILD_PATHS = Object.freeze([
  "packages/pwa",
  "packages/shared",
  "packages/sync",
  "packages/ui",
  "scripts/pwa-vercel-ignore-build.mjs",
  ".nvmrc",
  "package.json",
  "package-lock.json",
  "tsconfig.base.json",
  "tsconfig.json",
]);

const SHA_PATTERN = /^[0-9a-f]{40}$/;

function git(args, cwd) {
  return spawnSync("git", args, { cwd, encoding: "utf8" });
}

function resolveCurrentSha(cwd, requestedSha) {
  if (requestedSha) {
    return SHA_PATTERN.test(requestedSha) ? requestedSha : null;
  }
  const result = git(["rev-parse", "--verify", "HEAD^{commit}"], cwd);
  const sha = result.status === 0 ? result.stdout.trim() : "";
  return SHA_PATTERN.test(sha) ? sha : null;
}

function commitExists(cwd, sha) {
  return git(["cat-file", "-e", `${sha}^{commit}`], cwd).status === 0;
}

export function planPwaVercelBuild({
  cwd = process.cwd(),
  previousSha = process.env.VERCEL_GIT_PREVIOUS_SHA ?? "",
  currentSha = process.env.VERCEL_GIT_COMMIT_SHA ?? "",
} = {}) {
  const previous = String(previousSha).trim().toLowerCase();
  const current = resolveCurrentSha(cwd, String(currentSha).trim().toLowerCase());
  if (!SHA_PATTERN.test(previous)) {
    return Object.freeze({ ignore: false, reason: "missing previous successful deployment" });
  }
  if (current === null) {
    return Object.freeze({ ignore: false, reason: "invalid current deployment commit" });
  }
  if (!commitExists(cwd, previous) || !commitExists(cwd, current)) {
    return Object.freeze({ ignore: false, reason: "deployment history is unavailable" });
  }
  if (git(["merge-base", "--is-ancestor", previous, current], cwd).status !== 0) {
    return Object.freeze({ ignore: false, reason: "deployment baseline is not an ancestor" });
  }
  const diff = git(
    ["diff", "--quiet", previous, current, "--",
      ...PWA_BUILD_PATHS.map((buildPath) => `:(top)${buildPath}`)],
    cwd,
  );
  if (diff.status === 0) {
    return Object.freeze({ ignore: true, reason: "no PWA-relevant changes" });
  }
  return Object.freeze({
    ignore: false,
    reason: diff.status === 1 ? "PWA-relevant changes detected" : "Git diff failed",
  });
}

function main() {
  const plan = planPwaVercelBuild();
  process.stdout.write(`${plan.ignore ? "skip" : "build"}: ${plan.reason}\n`);
  process.exitCode = plan.ignore ? 0 : 1;
}

if (
  process.argv[1] &&
  fileURLToPath(import.meta.url) === path.resolve(process.argv[1])
) {
  main();
}
