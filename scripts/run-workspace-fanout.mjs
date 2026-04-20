#!/usr/bin/env node

import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const repoRoot = process.cwd();
const rootPackageJsonPath = path.join(repoRoot, "package.json");
const rootPackage = JSON.parse(readFileSync(rootPackageJsonPath, "utf8"));

const scriptName = process.argv[2];
const forwardedArgs = process.argv.slice(3);
const workspace = process.env.npm_config_workspace;
const runningWorkspaceSelection =
  workspace && process.env.npm_config_workspaces !== "true";

if (!scriptName) {
  console.error("Missing script name for workspace fanout.");
  process.exit(1);
}

if (runningWorkspaceSelection) {
  console.error(
    `Refusing to run root "${scriptName}" with --workspace=${workspace}.`
  );
  console.error("This monorepo can recurse badly in that mode.");
  console.error("Run the script from the workspace directory instead.");
  process.exit(1);
}

if (scriptName === "dev") {
  console.error('Refusing to run root "dev" from the monorepo root.');
  console.error("That path can start too many long-lived processes at once.");
  console.error("Use ./scripts/worktree-preview.sh <desktop|pwa|website> instead.");
  console.error(
    "Or cd into the workspace you actually want and run npm run dev there."
  );
  process.exit(1);
}

function expandWorkspacePattern(pattern) {
  const normalizedPattern = pattern.replace(/\/+$/, "");
  const wildcardSuffix = "/*";

  if (normalizedPattern.endsWith(wildcardSuffix)) {
    const baseDir = path.resolve(
      repoRoot,
      normalizedPattern.slice(0, -wildcardSuffix.length)
    );

    if (!existsSync(baseDir)) {
      return [];
    }

    return readdirSync(baseDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => path.join(baseDir, entry.name))
      .filter((candidate) => existsSync(path.join(candidate, "package.json")));
  }

  const candidate = path.resolve(repoRoot, normalizedPattern);
  if (existsSync(path.join(candidate, "package.json"))) {
    return [candidate];
  }

  return [];
}

function getWorkspaceDirs() {
  const workspacePatterns = rootPackage.workspaces ?? [];
  const dirs = workspacePatterns.flatMap(expandWorkspacePattern);
  return [...new Set(dirs)].sort((left, right) => left.localeCompare(right));
}

function workspaceHasScript(workspaceDir, name) {
  const packageJsonPath = path.join(workspaceDir, "package.json");
  const pkg = JSON.parse(readFileSync(packageJsonPath, "utf8"));
  return Object.prototype.hasOwnProperty.call(pkg.scripts ?? {}, name);
}

for (const workspaceDir of getWorkspaceDirs()) {
  if (!workspaceHasScript(workspaceDir, scriptName)) {
    continue;
  }

  const child = spawnSync("npm", ["run", scriptName, ...forwardedArgs], {
    cwd: workspaceDir,
    stdio: "inherit",
    shell: process.platform === "win32",
    env: process.env,
  });

  if (child.error) {
    console.error(child.error.message);
    process.exit(1);
  }

  if ((child.status ?? 1) !== 0) {
    process.exit(child.status ?? 1);
  }
}
