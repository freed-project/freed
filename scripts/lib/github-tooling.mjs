#!/usr/bin/env node

import { accessSync, constants, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DEFAULT_GITHUB_CLI_PATHS = Object.freeze([
  "/opt/homebrew/bin/gh",
  "/usr/local/bin/gh",
]);

function isExecutableFile(candidate) {
  try {
    accessSync(candidate, constants.X_OK);
    return statSync(candidate).isFile();
  } catch {
    return false;
  }
}

export function githubCliCandidates(environment = process.env) {
  const configured = String(environment.GH_BIN ?? "").trim();
  const pathEntries = String(environment.PATH ?? "")
    .split(path.delimiter)
    .filter(Boolean)
    .map((directory) => path.join(directory, "gh"));

  return [
    ...(configured ? [configured] : []),
    ...pathEntries,
    ...DEFAULT_GITHUB_CLI_PATHS,
  ];
}

export function resolveGitHubCli({
  environment = process.env,
  executable = isExecutableFile,
  required = true,
} = {}) {
  const seen = new Set();
  for (const candidate of githubCliCandidates(environment)) {
    if (!path.isAbsolute(candidate) || seen.has(candidate)) continue;
    seen.add(candidate);
    if (executable(candidate)) return candidate;
  }

  if (!required) return "";
  throw new Error(
    "GitHub CLI is unavailable. Set GH_BIN to an absolute executable path, add gh to PATH, or install it in /opt/homebrew/bin or /usr/local/bin.",
  );
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    process.stdout.write(`${resolveGitHubCli()}\n`);
  } catch (error) {
    process.stderr.write(
      `${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exitCode = 1;
  }
}
