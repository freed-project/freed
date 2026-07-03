#!/usr/bin/env node

// Machine preflight for the Freed automation loops.
//
// AGENTS.md says a surprising node/npm path is "a machine issue to fix before
// debugging the repo". This script is that rule as code: it checks the pinned
// Node toolchain, gh (including binary architecture on macOS), git, curl,
// python3, and the automation state directory, and prints exact remediation
// for anything broken.
//
// Usage:
//   node scripts/doctor.mjs            # report only, always exits 0 (warn-only)
//   node scripts/doctor.mjs --strict   # exit non-zero on hard failures (loops/CI)
//   node scripts/doctor.mjs --json     # machine-readable report
//
// worktree-add.sh, worktree-publish.sh, and nightly-self-improve.mjs run this
// automatically in warn-only mode. Loops and CI gates should use --strict.

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, "..");

const CURL_FALLBACK_PATTERN = [
  'TOKEN=$(security find-generic-password -s "gh:github.com" -w | sed \'s/^go-keyring-base64://\' | base64 -d)',
  'curl -sS -H "Authorization: Bearer $TOKEN" -H "Accept: application/vnd.github+json" https://api.github.com/repos/<owner>/<repo>/...',
].join("\n    ");

function tryExec(command, args, options = {}) {
  try {
    const stdout = execFileSync(command, args, {
      encoding: "utf8",
      timeout: options.timeout ?? 10_000,
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { ok: true, stdout: stdout.trim(), error: "" };
  } catch (error) {
    return {
      ok: false,
      stdout: String(error?.stdout ?? "").trim(),
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function whichCommand(name) {
  const result = tryExec("/usr/bin/which", [name]);
  return result.ok ? result.stdout.split("\n")[0].trim() : "";
}

export function readPinnedNodeVersion(repoRoot = REPO_ROOT) {
  const nvmrcPath = path.join(repoRoot, ".nvmrc");
  if (!existsSync(nvmrcPath)) {
    return "";
  }
  return readFileSync(nvmrcPath, "utf8").trim().replace(/^v/, "");
}

// Parses `file <binary>` output on darwin and decides whether the binary can
// run natively on this machine's architecture.
export function classifyBinaryArch(fileOutput, machineArch) {
  const text = String(fileOutput ?? "");
  const detected = [];
  if (/\bx86_64\b/.test(text)) {
    detected.push("x86_64");
  }
  if (/\barm64e?\b/.test(text)) {
    detected.push("arm64");
  }
  const wanted = machineArch === "arm64" ? "arm64" : "x86_64";
  return {
    detected,
    matches: detected.length === 0 ? true : detected.includes(wanted),
  };
}

function check(id, title, status, detail, remediation = "") {
  return { id, title, status, detail, remediation };
}

function checkPinnedToolchain(home, repoRoot) {
  const pinned = readPinnedNodeVersion(repoRoot);
  if (!pinned) {
    return check(
      "node-toolchain",
      "pinned Node toolchain",
      "fail",
      `.nvmrc not found in ${repoRoot}.`,
      "Restore .nvmrc; repo scripts resolve node from it.",
    );
  }

  const envNodeBin = process.env.NODE_BIN ?? "";
  const pinnedBinDir = path.join(home, ".nvm", "versions", "node", `v${pinned}`, "bin");
  const nodeBin = envNodeBin || path.join(pinnedBinDir, "node");

  if (!existsSync(nodeBin)) {
    return check(
      "node-toolchain",
      "pinned Node toolchain",
      "fail",
      `Node v${pinned} (.nvmrc) is not installed at ${nodeBin}.`,
      `Run: nvm install ${pinned}`,
    );
  }

  const versionResult = tryExec(nodeBin, ["-v"]);
  const actual = versionResult.stdout.replace(/^v/, "");
  if (!versionResult.ok || actual !== pinned) {
    return check(
      "node-toolchain",
      "pinned Node toolchain",
      "fail",
      `${nodeBin} reports v${actual || "unknown"}, .nvmrc pins v${pinned}.`,
      envNodeBin
        ? `NODE_BIN points at the wrong node. Unset it or point it at Node v${pinned}.`
        : `Run: nvm install ${pinned}`,
    );
  }

  const binDir = path.dirname(nodeBin);
  const missing = ["npm", "npx"].filter((tool) => !existsSync(path.join(binDir, tool)));
  if (missing.length > 0) {
    return check(
      "node-toolchain",
      "pinned Node toolchain",
      "fail",
      `${missing.join(" and ")} missing next to ${nodeBin}. Repo scripts require node, npm, and npx from the same install.`,
      `Reinstall Node v${pinned} (nvm install ${pinned}).`,
    );
  }

  return check(
    "node-toolchain",
    "pinned Node toolchain",
    "ok",
    `v${pinned} at ${nodeBin} with matching npm and npx.`,
  );
}

function checkPathNode(home, repoRoot) {
  const pinned = readPinnedNodeVersion(repoRoot);
  const pathNode = whichCommand("node");
  if (!pathNode) {
    return check(
      "path-node",
      "PATH node",
      "warn",
      "No node on PATH. Repo scripts resolve the pinned toolchain themselves, but bare `node` commands will fail.",
      `Prefix PATH with ${path.join(home, ".nvm", "versions", "node", `v${pinned}`, "bin")}.`,
    );
  }
  const versionResult = tryExec(pathNode, ["-v"]);
  const actual = versionResult.stdout.replace(/^v/, "");
  if (pinned && actual !== pinned) {
    return check(
      "path-node",
      "PATH node",
      "warn",
      `PATH node is v${actual || "unknown"} (${pathNode}); .nvmrc pins v${pinned}. Repo scripts resolve the pinned toolchain, but bare node/npm/npx commands use the stale one.`,
      `Prefix PATH with ${path.join(home, ".nvm", "versions", "node", `v${pinned}`, "bin")} (or \`nvm use\`).`,
    );
  }
  return check("path-node", "PATH node", "ok", `v${actual} (${pathNode}).`);
}

function checkGh(machineArch, platform) {
  const ghPath = whichCommand("gh");
  if (!ghPath) {
    return check(
      "gh",
      "GitHub CLI",
      "warn",
      "gh is not installed.",
      `Install gh (brew install gh), or use the curl-based GitHub API fallback:\n    ${CURL_FALLBACK_PATTERN}`,
    );
  }

  const versionResult = tryExec(ghPath, ["--version"]);
  if (versionResult.ok) {
    return check("gh", "GitHub CLI", "ok", `${versionResult.stdout.split("\n")[0]} (${ghPath}).`);
  }

  let archDetail = "";
  if (platform === "darwin") {
    const fileResult = tryExec("/usr/bin/file", [ghPath]);
    const arch = classifyBinaryArch(fileResult.stdout, machineArch);
    if (!arch.matches) {
      archDetail = ` Binary is ${arch.detected.join("+") || "unknown"} but this machine is ${machineArch}.`;
    }
  }

  return check(
    "gh",
    "GitHub CLI",
    "warn",
    `gh exists at ${ghPath} but fails to run.${archDetail}`,
    `Reinstall the ${machineArch} build of gh (brew install gh). Until then, use the curl-based GitHub API fallback:\n    ${CURL_FALLBACK_PATTERN}`,
  );
}

// Extracts the executable path from a shell-style git credential helper value
// like "!/usr/local/bin/gh auth git-credential". Returns "" for built-in
// helpers such as "osxkeychain" or "cache".
export function credentialHelperBinary(helperValue) {
  const value = String(helperValue ?? "").trim();
  if (!value.startsWith("!")) {
    return "";
  }
  const command = value.slice(1).trim().split(/\s+/)[0] ?? "";
  return command.startsWith("/") ? command : "";
}

function checkGitCredentialHelpers() {
  // --get-regexp also catches URL-scoped helpers such as
  // credential.https://github.com.helper, where stale gh paths tend to hide.
  const result = tryExec("git", ["config", "--get-regexp", String.raw`^credential(\..+)?\.helper$`]);
  const helpers = result.stdout
    .split("\n")
    .filter(Boolean)
    .map((line) => line.replace(/^\S+\s*/, ""))
    .filter(Boolean);
  const broken = [
    ...new Set(
      helpers
        .map((helper) => credentialHelperBinary(helper))
        .filter((binary) => binary && !existsSync(binary)),
    ),
  ];

  if (broken.length > 0) {
    const ghPath = whichCommand("gh");
    return check(
      "git-credential-helper",
      "git credential helper",
      "warn",
      `git credential helper references ${broken.join(", ")}, which does not exist. git push/fetch over https will fail.`,
      ghPath
        ? `Point it at the working gh: git config --global credential.helper '!${ghPath} auth git-credential' (or remove the stale entry).`
        : "Remove the stale credential.helper entry or reinstall gh.",
    );
  }

  return check(
    "git-credential-helper",
    "git credential helper",
    "ok",
    helpers.length > 0 ? helpers.join("; ") : "none configured.",
  );
}

function checkSimpleCommand(id, title, command, args, remediation) {
  const commandPath = whichCommand(command) || command;
  const result = tryExec(commandPath, args);
  if (result.ok) {
    return check(id, title, "ok", `${result.stdout.split("\n")[0]} (${commandPath}).`);
  }
  return check(id, title, "fail", `${command} is unusable: ${result.error}`, remediation);
}

function checkSystemPython() {
  const systemPython = "/usr/bin/python3";
  if (!existsSync(systemPython)) {
    // Linux CI runners may only have python3 on PATH; treat that as ok there.
    const pathPython = whichCommand("python3");
    if (pathPython) {
      const result = tryExec(pathPython, ["--version"]);
      if (result.ok) {
        return check("python3", "python3", "ok", `${result.stdout} (${pathPython}).`);
      }
    }
    return check(
      "python3",
      "python3",
      "fail",
      "No usable python3 (checked /usr/bin/python3 and PATH).",
      "Install python3 or repair the Xcode command line tools (xcode-select --install).",
    );
  }

  const result = tryExec(systemPython, ["--version"]);
  if (!result.ok) {
    return check(
      "python3",
      "python3",
      "fail",
      `/usr/bin/python3 is unusable: ${result.error}`,
      "Repair the Xcode command line tools (xcode-select --install).",
    );
  }

  const pathPython = whichCommand("python3");
  if (pathPython && pathPython !== systemPython) {
    const pathResult = tryExec(pathPython, ["--version"]);
    if (!pathResult.ok) {
      return check(
        "python3",
        "python3",
        "warn",
        `/usr/bin/python3 works (${result.stdout}), but PATH python3 (${pathPython}) is broken: ${pathResult.error}`,
        `Remove or repair the broken shim so PATH python3 works, or call /usr/bin/python3 explicitly.`,
      );
    }
  }

  return check("python3", "python3", "ok", `${result.stdout} (${systemPython}).`);
}

function checkAutomationStateDir(stateDir) {
  if (existsSync(stateDir)) {
    return check("automation-state-dir", "automation state dir", "ok", `${stateDir} exists.`);
  }
  try {
    mkdirSync(stateDir, { recursive: true });
    return check("automation-state-dir", "automation state dir", "ok", `${stateDir} created.`);
  } catch (error) {
    return check(
      "automation-state-dir",
      "automation state dir",
      "fail",
      `Cannot create ${stateDir}: ${error instanceof Error ? error.message : String(error)}`,
      `Create it manually: mkdir -p ${stateDir}`,
    );
  }
}

export function runChecks(options = {}) {
  const home = options.home ?? os.homedir();
  const repoRoot = options.repoRoot ?? REPO_ROOT;
  const machineArch = options.machineArch ?? os.arch();
  const platform = options.platform ?? os.platform();
  const stateDir = options.stateDir ?? path.join(home, ".freed-automation");

  const checks = [
    checkPinnedToolchain(home, repoRoot),
    checkPathNode(home, repoRoot),
    checkGh(machineArch, platform),
    checkGitCredentialHelpers(),
    checkSimpleCommand("git", "git", "git", ["--version"], "Install git (xcode-select --install)."),
    checkSimpleCommand("curl", "curl", "curl", ["--version"], "Install curl."),
    checkSystemPython(),
    checkAutomationStateDir(stateDir),
  ];

  return {
    checks,
    failures: checks.filter((item) => item.status === "fail").length,
    warnings: checks.filter((item) => item.status === "warn").length,
  };
}

const STATUS_GLYPHS = { ok: "ok", warn: "WARN", fail: "FAIL" };

export function formatReport(result) {
  const lines = ["Freed machine preflight (scripts/doctor.mjs)"];
  for (const item of result.checks) {
    lines.push(`  [${STATUS_GLYPHS[item.status] ?? item.status}] ${item.title}: ${item.detail}`);
    if (item.remediation && item.status !== "ok") {
      lines.push(`    remediation: ${item.remediation}`);
    }
  }
  const okCount = result.checks.length - result.failures - result.warnings;
  lines.push(
    `Summary: ${okCount} ok, ${result.warnings} warning${result.warnings === 1 ? "" : "s"}, ${result.failures} failure${result.failures === 1 ? "" : "s"}.`,
  );
  return `${lines.join("\n")}\n`;
}

export function resolveExitCode(result, { strict = false } = {}) {
  if (strict && result.failures > 0) {
    return 1;
  }
  return 0;
}

function main() {
  const argv = process.argv.slice(2);
  const strict = argv.includes("--strict");
  const json = argv.includes("--json");
  const unknown = argv.filter((arg) => !["--strict", "--json", "--help", "-h"].includes(arg));
  if (argv.includes("--help") || argv.includes("-h") || unknown.length > 0) {
    process.stdout.write(
      "Usage: node scripts/doctor.mjs [--strict] [--json]\n" +
        "  --strict  Exit non-zero on hard failures (loop/CI contexts).\n" +
        "  --json    Machine-readable report.\n",
    );
    process.exitCode = unknown.length > 0 ? 1 : 0;
    return;
  }

  const result = runChecks();
  if (json) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } else {
    process.stdout.write(formatReport(result));
  }
  process.exitCode = resolveExitCode(result, { strict });
}

if (process.argv[1] === __filename) {
  main();
}
