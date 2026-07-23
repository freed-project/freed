#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import {
  loadRulesets,
  RELEASE_TAG_CREATION_RULESET_NAME,
  RELEASE_TAG_IMMUTABILITY_RULESET_NAME,
  verifyLiveReleaseTagAuthority,
} from "./sync-github-rulesets.mjs";

export function parseArgs(argv) {
  let repo = "freed-project/freed";
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--repo") repo = argv[++index];
    else if (arg.startsWith("--repo=")) repo = arg.slice("--repo=".length);
    else if (arg === "--help" || arg === "-h") return { help: true, repo };
    else throw new Error(`Unknown argument: ${arg}`);
  }
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo)) {
    throw new Error("--repo must use the owner/repository form.");
  }
  return { help: false, repo };
}

function ghJson(args, { exec = execFileSync } = {}) {
  return JSON.parse(
    exec("gh", args, { encoding: "utf8", maxBuffer: 16 * 1024 * 1024 }),
  );
}

export function loadLiveReleaseTagRulesets(repo, { exec = execFileSync } = {}) {
  const summary = ghJson(
    ["api", `repos/${repo}/rulesets?targets=tag&per_page=100`],
    { exec },
  );
  const names = [
    RELEASE_TAG_CREATION_RULESET_NAME,
    RELEASE_TAG_IMMUTABILITY_RULESET_NAME,
  ];
  const matches = names.map((name) =>
    summary.find((item) => item.name === name),
  );
  if (matches.some((match) => !match?.id)) {
    throw new Error(
      `Live release tag creation and immutability rulesets are required for ${repo}. Release tags are blocked until a dedicated release GitHub App and trusted publisher are provisioned.`,
    );
  }
  return matches.map((match) =>
    ghJson(["api", `repos/${repo}/rulesets/${match.id}`], { exec }),
  );
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    process.stdout.write(
      "Usage: node scripts/validate-release-tag-authority.mjs [--repo owner/repository]\n",
    );
    return;
  }
  const checkedIn = loadRulesets();
  const creation = checkedIn.find(
    (ruleset) => ruleset.name === RELEASE_TAG_CREATION_RULESET_NAME,
  );
  const expectedReleaseAppId = creation?.bypass_actors?.[0]?.actor_id;
  if (
    creation?.enforcement !== "active" ||
    !Number.isSafeInteger(expectedReleaseAppId)
  ) {
    throw new Error(
      "Checked-in release tag creation is pending owner-reviewed GitHub App activation.",
    );
  }
  const rulesets = loadLiveReleaseTagRulesets(args.repo);
  const result = verifyLiveReleaseTagAuthority(rulesets, expectedReleaseAppId);
  process.stdout.write(
    `Release tag authority is active for ${args.repo} through GitHub App ${result.releaseAppId.toLocaleString()}.\n`,
  );
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (error) {
    process.stderr.write(
      `${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exitCode = 1;
  }
}
