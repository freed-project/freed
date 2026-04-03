#!/usr/bin/env node

import { execFileSync } from "child_process";
import { existsSync, readFileSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, "..");
const NODE_BIN = process.execPath;

function ghBinary() {
  const candidates = [
    process.env.GH_BIN,
    "/opt/homebrew/bin/gh",
    "/usr/local/bin/gh",
  ].filter(Boolean);

  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }

  return "gh";
}

function run(command, args, options = {}) {
  return execFileSync(command, args, {
    cwd: REPO_ROOT,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    ...options,
  }).trim();
}

function maybeGhToken() {
  try {
    return run(ghBinary(), ["auth", "token"]);
  } catch {
    return "";
  }
}

function parseArguments(argv) {
  return {
    rewriteGitHub: argv.includes("--rewrite-github"),
    dryRun: argv.includes("--dry-run"),
  };
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

function releaseBodyForTag(tag) {
  return readFileSync(path.join(REPO_ROOT, "release-notes", "releases", `${tag}.md`), "utf8");
}

function rewriteGitHubRelease(tag, body, dryRun) {
  if (dryRun) {
    console.log(`Would rewrite ${tag}`);
    return;
  }

  execFileSync(ghBinary(), ["release", "edit", tag, "--notes-file", "-"], {
    cwd: REPO_ROOT,
    stdio: ["pipe", "inherit", "inherit"],
    input: body,
  });
}

async function main() {
  const { rewriteGitHub, dryRun } = parseArguments(process.argv.slice(2));
  const tags = await fetchPublishedTags();

  for (const tag of tags) {
    console.log(`Backfilling ${tag}...`);
    execFileSync(NODE_BIN, ["scripts/prepare-release-notes.mjs", tag, "--force"], {
      cwd: REPO_ROOT,
      stdio: "inherit",
      env: process.env,
    });
  }

  if (!rewriteGitHub) {
    return;
  }

  for (const tag of tags) {
    console.log(`${dryRun ? "Previewing" : "Rewriting"} GitHub body for ${tag}...`);
    rewriteGitHubRelease(tag, releaseBodyForTag(tag), dryRun);
  }
}

main().catch((error) => {
  console.error("[backfill-release-notes] Failed.");
  console.error(error);
  process.exit(1);
});
