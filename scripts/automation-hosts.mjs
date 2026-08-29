#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  AUTOMATION_HOST_PROFILE_PATH,
  AUTOMATION_HOST_PROFILE_ROOT,
  CANONICAL_AUTOMATION_REPOSITORY,
  inspectAutomationHostAssignment,
  parseAutomationHostAssignments,
  PRIMARY_AUTOMATION_HOST_ROLE,
} from "./lib/automation-host-identity.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");
export const DEFAULT_ASSIGNMENT_PATH = path.join(
  REPO_ROOT,
  "automation",
  "host-assignments.json",
);

function usage() {
  return `Usage:
  npm run automation:hosts -- inspect
  npm run automation:hosts -- enroll

Enrollment installs the checked-in primary host identity as a root-owned,
read-only record at ${AUTOMATION_HOST_PROFILE_PATH}.
`;
}

export function parseCommand(argv) {
  if (argv.length === 0 || argv.includes("--help") || argv.includes("-h")) {
    return { action: "help" };
  }
  if (argv.length !== 1 || !["inspect", "enroll"].includes(argv[0])) {
    throw new Error(`Unsupported automation host command: ${argv.join(" ")}`);
  }
  return { action: argv[0] };
}

function runChecked(executable, args, purpose, runner = spawnSync) {
  const result = runner(executable, args, {
    encoding: "utf8",
    env: {
      HOME: os.homedir(),
      LANG: "C",
      LC_ALL: "C",
      PATH: "/usr/bin:/bin:/usr/sbin:/sbin",
    },
    stdio: ["inherit", "pipe", "pipe"],
  });
  if (result?.status !== 0) {
    throw new Error(
      `${purpose} failed${String(result?.stderr ?? "").trim() ? `: ${String(result.stderr).trim()}` : ""}`,
    );
  }
}

function trustedSystemGroup(platform = process.platform) {
  if (platform === "darwin") return "wheel";
  if (platform === "linux") return "root";
  throw new Error(`Unsupported automation host platform: ${platform}`);
}

export function executeCommand(
  command,
  {
    assignmentPath = DEFAULT_ASSIGNMENT_PATH,
    profilePath = AUTOMATION_HOST_PROFILE_PATH,
    profileRoot = AUTOMATION_HOST_PROFILE_ROOT,
    requiredUid = 0,
    runner = spawnSync,
    tempRoot = os.tmpdir(),
  } = {},
) {
  if (command.action === "help") return { usage: usage() };
  if (command.action === "inspect") {
    return inspectAutomationHostAssignment({
      assignmentPath,
      profilePath,
      profileRoot,
      requiredUid,
    });
  }
  const assignments = parseAutomationHostAssignments(
    JSON.parse(readFileSync(assignmentPath, "utf8")),
  );
  const hostId = assignments.roles[PRIMARY_AUTOMATION_HOST_ROLE];
  if (existsSync(profilePath)) {
    const current = inspectAutomationHostAssignment({
      assignmentPath,
      profilePath,
      profileRoot,
      requiredUid,
    });
    if (current.ready) {
      return { action: "enroll", alreadyEnrolled: true, ...current };
    }
    throw new Error(
      `Automation host identity already exists but is invalid: ${current.reason}`,
    );
  }
  const directory = mkdtempSync(path.join(tempRoot, "freed-host-enrollment-"));
  chmodSync(directory, 0o700);
  const stagedPath = path.join(directory, "automation-host.json");
  writeFileSync(
    stagedPath,
    `${JSON.stringify({
      schemaVersion: 1,
      hostId,
      repository: CANONICAL_AUTOMATION_REPOSITORY,
    })}\n`,
    { mode: 0o600 },
  );
  try {
    runChecked(
      "/usr/bin/sudo",
      [
        "/usr/bin/install",
        "-d",
        "-o",
        "root",
        "-g",
        trustedSystemGroup(),
        "-m",
        "0755",
        profileRoot,
      ],
      "Automation host directory installation",
      runner,
    );
    runChecked(
      "/usr/bin/sudo",
      [
        "/usr/bin/install",
        "-o",
        "root",
        "-g",
        trustedSystemGroup(),
        "-m",
        "0444",
        stagedPath,
        profilePath,
      ],
      "Automation host identity installation",
      runner,
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
  const result = inspectAutomationHostAssignment({
    assignmentPath,
    profilePath,
    profileRoot,
    requiredUid,
  });
  if (!result.ready) {
    throw new Error(
      `Installed automation host identity is invalid: ${result.reason}`,
    );
  }
  return { action: "enroll", ...result };
}

export function runCli(argv) {
  const result = executeCommand(parseCommand(argv));
  if (result.usage) process.stdout.write(result.usage);
  else process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    runCli(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(
      `${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exitCode = 1;
  }
}
