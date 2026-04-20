#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const scriptName = process.argv[2];
const forwardedArgs = process.argv.slice(3);
const workspace = process.env.npm_config_workspace;
const runningWorkspaceSelection = workspace && process.env.npm_config_workspaces !== "true";

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

function resolveNpmCommand() {
  const siblingNpm = path.join(path.dirname(process.execPath), process.platform === "win32" ? "npm.cmd" : "npm");

  if (fs.existsSync(siblingNpm)) {
    return siblingNpm;
  }

  return "npm";
}

const child = spawnSync(
  resolveNpmCommand(),
  ["run", scriptName, "--workspaces", "--if-present", ...forwardedArgs],
  {
    stdio: "inherit",
    shell: process.platform === "win32",
    env: {
      ...process.env,
      npm_config_workspace: "",
    },
  }
);

if (child.error) {
  console.error(child.error.message);
  process.exit(1);
}

process.exit(child.status ?? 1);
