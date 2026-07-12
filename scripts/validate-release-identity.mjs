#!/usr/bin/env node

import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { listPromotionDiffFiles } from "./release-promotion-shared.mjs";
import { parseReleaseVersion } from "./release-version.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, "..");

function runGit(args, cwd) {
  return execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
}

function readJson(filePath) {
  return JSON.parse(readFileSync(filePath, "utf8"));
}

function cargoPackageVersion(contents) {
  const packageBlock =
    contents.match(/\[package\]([\s\S]*?)(?=\n\[|$)/)?.[1] ?? "";
  return packageBlock.match(/^version\s*=\s*"([^"]+)"/m)?.[1] ?? null;
}

export function parseReleaseTag(tag) {
  const parsed = parseReleaseVersion(tag, { requireTagPrefix: true });
  return {
    tag: parsed.tag,
    version: parsed.version,
    appVersion: parsed.appVersion,
    channel: parsed.channel,
    dayKey: parsed.dayKey,
  };
}

export function validateReleaseIdentity({
  cwd = REPO_ROOT,
  tag,
  headRef = "HEAD",
  branchRef = null,
}) {
  const expected = parseReleaseTag(tag);
  const releasePath = path.join(
    cwd,
    "release-notes",
    "releases",
    `${expected.tag}.json`,
  );
  const artifact = readJson(releasePath);
  const desktopPackage = readJson(
    path.join(cwd, "packages/desktop/package.json"),
  );
  const pwaPackage = readJson(path.join(cwd, "packages/pwa/package.json"));
  const tauriConfig = readJson(
    path.join(cwd, "packages/desktop/src-tauri/tauri.conf.json"),
  );
  const cargoVersion = cargoPackageVersion(
    readFileSync(
      path.join(cwd, "packages/desktop/src-tauri/Cargo.toml"),
      "utf8",
    ),
  );
  const errors = [];

  if (branchRef) {
    const onProtectedBranch = spawnSync(
      "git",
      ["merge-base", "--is-ancestor", headRef, branchRef],
      { cwd, encoding: "utf8" },
    );
    if (onProtectedBranch.status !== 0) {
      errors.push(`${headRef} is not in protected ${branchRef} history.`);
    }
  }

  const exactFields = [
    ["release artifact tag", artifact.tag, expected.tag],
    ["release artifact version", artifact.version, expected.version],
    ["release artifact channel", artifact.channel, expected.channel],
    ["release source channel", artifact.source?.channel, expected.channel],
    ["release day key", artifact.dayKey, expected.dayKey],
    ["Desktop package version", desktopPackage.version, expected.appVersion],
    ["PWA package version", pwaPackage.version, expected.appVersion],
    ["Tauri bundle version", tauriConfig.version, expected.appVersion],
    ["Cargo package version", cargoVersion, expected.appVersion],
  ];
  for (const [label, actual, wanted] of exactFields) {
    if (actual !== wanted) {
      errors.push(`${label} is ${String(actual)}, expected ${String(wanted)}.`);
    }
  }

  const productCommitSha = String(
    artifact.source?.productCommitSha ?? "",
  ).trim();
  if (!/^[0-9a-f]{40,64}$/.test(productCommitSha)) {
    errors.push(
      "release source productCommitSha must be a full Git commit SHA.",
    );
  } else {
    const ancestor = spawnSync(
      "git",
      ["merge-base", "--is-ancestor", productCommitSha, headRef],
      { cwd, encoding: "utf8" },
    );
    if (ancestor.status !== 0) {
      errors.push(
        `release source productCommitSha ${productCommitSha} is not an ancestor of ${headRef}.`,
      );
    } else {
      const driftFiles = listPromotionDiffFiles({
        fromRef: productCommitSha,
        toRef: headRef,
        cwd,
      });
      if (driftFiles.length > 0) {
        errors.push(
          `product files changed after release notes were prepared: ${driftFiles.join(", ")}.`,
        );
      }
    }
  }

  let promotedDevCommitSha = null;
  if (expected.channel === "production") {
    promotedDevCommitSha = String(
      artifact.source?.promotedDevCommitSha ?? "",
    ).trim();
    if (!/^[0-9a-f]{40,64}$/.test(promotedDevCommitSha)) {
      errors.push(
        "production release source promotedDevCommitSha must be a full Git commit SHA.",
      );
    } else {
      const promotedCommit = spawnSync(
        "git",
        ["cat-file", "-e", `${promotedDevCommitSha}^{commit}`],
        { cwd, encoding: "utf8" },
      );
      if (promotedCommit.status !== 0) {
        errors.push(
          `production release source promotedDevCommitSha ${promotedDevCommitSha} is not a local commit.`,
        );
      } else if (/^[0-9a-f]{40,64}$/.test(productCommitSha)) {
        const promotionDrift = listPromotionDiffFiles({
          fromRef: promotedDevCommitSha,
          toRef: productCommitSha,
          cwd,
        });
        if (promotionDrift.length > 0) {
          errors.push(
            `recorded promoted dev snapshot does not match the prepared product commit: ${promotionDrift.join(", ")}.`,
          );
        }
      }
    }
  }

  if (errors.length > 0) {
    throw new Error(
      `Release identity validation failed:\n- ${errors.join("\n- ")}`,
    );
  }

  return {
    ...expected,
    productCommitSha,
    promotedDevCommitSha,
    headCommitSha: runGit(["rev-parse", headRef], cwd),
  };
}

function parseArgs(argv) {
  const options = {
    cwd: REPO_ROOT,
    tag: "",
    headRef: "HEAD",
    branchRef: null,
  };
  for (const arg of argv) {
    if (arg === "--help" || arg === "-h") options.help = true;
    else if (arg.startsWith("--cwd="))
      options.cwd = path.resolve(arg.slice("--cwd=".length));
    else if (arg.startsWith("--tag=")) options.tag = arg.slice("--tag=".length);
    else if (arg.startsWith("--head-ref="))
      options.headRef = arg.slice("--head-ref=".length);
    else if (arg.startsWith("--branch-ref="))
      options.branchRef = arg.slice("--branch-ref=".length);
    else throw new Error(`Unsupported argument: ${arg}`);
  }
  return options;
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    process.stdout.write(
      "Usage: node scripts/validate-release-identity.mjs --tag=vYY.M.DDBUILD[-dev] [--head-ref=HEAD] [--branch-ref=origin/dev|origin/main] [--cwd=path]\n",
    );
    return;
  }
  if (!options.tag) {
    throw new Error("--tag is required.");
  }
  const result = validateReleaseIdentity(options);
  process.stdout.write(
    `Release identity is valid for ${result.tag} at ${result.headCommitSha}.\n`,
  );
}

if (process.argv[1] === __filename) {
  try {
    main();
  } catch (error) {
    process.stderr.write(
      `${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exitCode = 1;
  }
}
