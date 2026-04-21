#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, "..");
const RESOLVED_NPM = path.join(
  path.dirname(process.execPath),
  process.platform === "win32" ? "npm.cmd" : "npm",
);
const NPM_BIN = existsSync(RESOLVED_NPM) ? RESOLVED_NPM : process.platform === "win32" ? "npm.cmd" : "npm";

function usage() {
  return `Usage:
  node scripts/run-workspace-script.mjs <script-name> [<extra-arg>...]

Runs the named npm script in each configured workspace that defines it.
`;
}

function workspaceCandidates() {
  const candidates = [];

  for (const rootDir of ["packages", "skills"]) {
    const absoluteRoot = path.join(REPO_ROOT, rootDir);
    if (!existsSync(absoluteRoot)) {
      continue;
    }

    for (const entry of readdirSync(absoluteRoot, { withFileTypes: true })) {
      if (!entry.isDirectory()) {
        continue;
      }

      const workspacePath = path.join(rootDir, entry.name);
      if (existsSync(path.join(REPO_ROOT, workspacePath, "package.json"))) {
        candidates.push(workspacePath.replace(/\\/g, "/"));
      }
    }
  }

  if (existsSync(path.join(REPO_ROOT, "website", "package.json"))) {
    candidates.push("website");
  }

  return candidates.sort();
}

function workspaceHasScript(workspacePath, scriptName) {
  const packageJson = JSON.parse(
    readFileSync(path.join(REPO_ROOT, workspacePath, "package.json"), "utf8"),
  );
  return Boolean(packageJson.scripts?.[scriptName]);
}

function runWorkspaceScript(scriptName, workspacePath, extraArgs) {
  console.log(`\n==> ${workspacePath} :: ${scriptName}`);
  const result = spawnSync(
    NPM_BIN,
    ["--workspace", workspacePath, "run", scriptName, ...extraArgs],
    {
      cwd: REPO_ROOT,
      env: process.env,
      stdio: "inherit",
    },
  );

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

function main(argv = process.argv.slice(2)) {
  const scriptName = argv[0];
  const extraArgs = argv.slice(1);

  if (!scriptName || scriptName === "--help" || scriptName === "-h") {
    console.log(usage());
    return;
  }

  for (const workspacePath of workspaceCandidates()) {
    if (workspaceHasScript(workspacePath, scriptName)) {
      runWorkspaceScript(scriptName, workspacePath, extraArgs);
    }
  }
}

main();
