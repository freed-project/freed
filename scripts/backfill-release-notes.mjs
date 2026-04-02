#!/usr/bin/env node

import { execFileSync } from "child_process";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, "..");

function run(command, args) {
  return execFileSync(command, args, {
    cwd: REPO_ROOT,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

function maybeGhToken() {
  try {
    return run("gh", ["auth", "token"]);
  } catch {
    return "";
  }
}

async function fetchPublishedTags() {
  const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN || maybeGhToken();
  const response = await fetch("https://api.github.com/repos/freed-project/freed/releases?per_page=100", {
    headers: {
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch releases: ${response.status}`);
  }

  const releases = await response.json();
  return releases
    .filter((release) => !release.draft && !release.prerelease)
    .map((release) => release.tag_name)
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
}

async function main() {
  const tags = await fetchPublishedTags();
  for (const tag of tags) {
    console.log(`Backfilling ${tag}...`);
    execFileSync("node", ["scripts/prepare-release-notes.mjs", tag], {
      cwd: REPO_ROOT,
      stdio: "inherit",
      env: process.env,
    });
  }
}

main().catch((error) => {
  console.error("[backfill-release-notes] Failed.");
  console.error(error);
  process.exit(1);
});
