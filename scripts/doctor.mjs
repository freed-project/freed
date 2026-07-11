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
// Worktree helpers run this automatically in warn-only mode. Continuous loops,
// mutation plans, and CI gates use --strict and stop on failures.

import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  statSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, "..");
const TRUSTED_PUBLISHER_CONFIG_PATH =
  "/Library/Application Support/Freed/trusted-publisher-host.json";

const CURL_FALLBACK_PATTERN = [
  "TOKEN=$(security find-generic-password -s \"gh:github.com\" -w | sed 's/^go-keyring-base64://' | base64 -d)",
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
    const stderr = String(error?.stderr ?? "").trim();
    return {
      ok: false,
      stdout: String(error?.stdout ?? "").trim(),
      error: stderr || (error instanceof Error ? error.message : String(error)),
    };
  }
}

export function remediationForCommandFailure(error, fallback) {
  return /have not agreed to the Xcode license agreements/i.test(
    String(error ?? ""),
  )
    ? "Run: sudo xcodebuild -license"
    : fallback;
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

const TRUSTED_PUBLISHER_CONFIG_KEYS = Object.freeze([
  "automationControlLibrarySha256",
  "automationControlSha256",
  "brokerPath",
  "brokerSha256",
  "brokerSigningIdentifier",
  "brokerTeamIdentifier",
  "controlCommit",
  "controlRoot",
  "githubCLIPath",
  "githubCLISha256",
  "launcherSha256",
  "nodePath",
  "nodeSha256",
  "publisherHelperSha256",
  "publisherPublicKeyBase64",
  "schemaVersion",
  "stateRoot",
]);

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
  const pinnedBinDir = path.join(
    home,
    ".nvm",
    "versions",
    "node",
    `v${pinned}`,
    "bin",
  );
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
  const missing = ["npm", "npx"].filter(
    (tool) => !existsSync(path.join(binDir, tool)),
  );
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

export function evaluateGhCheck({
  ghPath,
  versionResult,
  fileResult,
  machineArch,
  platform,
}) {
  if (!ghPath) {
    return check(
      "gh",
      "GitHub CLI",
      "warn",
      "gh is not installed.",
      `Install gh (brew install gh), or use the curl-based GitHub API fallback:\n    ${CURL_FALLBACK_PATTERN}`,
    );
  }

  let archDetail = "";
  let archMatches = true;
  if (platform === "darwin") {
    if (!fileResult?.ok) {
      archMatches = false;
      archDetail = " Binary architecture could not be inspected.";
    } else {
      const arch = classifyBinaryArch(fileResult.stdout, machineArch);
      archMatches = arch.matches;
      if (!arch.matches) {
        archDetail = ` Binary is ${arch.detected.join("+") || "unknown"} but this machine is ${machineArch}.`;
      }
    }
  }

  if (versionResult.ok && archMatches) {
    return check(
      "gh",
      "GitHub CLI",
      "ok",
      `${versionResult.stdout.split("\n")[0]} (${ghPath}).`,
    );
  }

  if (versionResult.ok) {
    return check(
      "gh",
      "GitHub CLI",
      "warn",
      `gh runs at ${ghPath}, but its binary does not match the native ${machineArch} architecture.${archDetail}`,
      `Reinstall the ${machineArch} build of gh (brew install gh).`,
    );
  }

  return check(
    "gh",
    "GitHub CLI",
    "warn",
    `gh exists at ${ghPath} but fails to run.${archDetail}`,
    `Reinstall the ${machineArch} build of gh (brew install gh). Until then, use the curl-based GitHub API fallback:\n    ${CURL_FALLBACK_PATTERN}`,
  );
}

function checkGh(machineArch, platform) {
  const ghPath = whichCommand("gh");
  const versionResult = ghPath
    ? tryExec(ghPath, ["--version"])
    : { ok: false, stdout: "", error: "gh is not installed" };
  const fileResult =
    ghPath && platform === "darwin"
      ? tryExec("/usr/bin/file", [ghPath])
      : { ok: true, stdout: "", error: "" };
  return evaluateGhCheck({
    ghPath,
    versionResult,
    fileResult,
    machineArch,
    platform,
  });
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
  const result = tryExec("git", [
    "config",
    "--get-regexp",
    String.raw`^credential(\..+)?\.helper$`,
  ]);
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
    return check(
      id,
      title,
      "ok",
      `${result.stdout.split("\n")[0]} (${commandPath}).`,
    );
  }
  return check(
    id,
    title,
    "fail",
    `${command} is unusable: ${result.error}`,
    remediationForCommandFailure(result.error, remediation),
  );
}

function checkSystemPython() {
  const systemPython = "/usr/bin/python3";
  if (!existsSync(systemPython)) {
    // Linux CI runners may only have python3 on PATH; treat that as ok there.
    const pathPython = whichCommand("python3");
    if (pathPython) {
      const result = tryExec(pathPython, ["--version"]);
      if (result.ok) {
        return check(
          "python3",
          "python3",
          "ok",
          `${result.stdout} (${pathPython}).`,
        );
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
      remediationForCommandFailure(
        result.error,
        "Repair the Xcode command line tools (xcode-select --install).",
      ),
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

  return check(
    "python3",
    "python3",
    "ok",
    `${result.stdout} (${systemPython}).`,
  );
}

const PRIVATE_AUTOMATION_DIRECTORIES = [
  "",
  "control",
  "control/.guards",
  "control/actor-credentials",
  "control/leases",
  "control/owner-capabilities",
  "control/owner-capabilities/consumed",
  "control/owner-capabilities/pending",
  "control/publisher-capabilities",
  "control/publisher-capabilities/consumed",
  "control/publisher-capabilities/pending",
  "control/task-transactions",
];

function shellQuote(value) {
  return `'${String(value).replaceAll("'", `'\\''`)}'`;
}

export function checkAutomationStateDir(stateDir) {
  if (existsSync(stateDir)) {
    const currentUid =
      typeof process.getuid === "function" ? process.getuid() : null;
    const problems = [];
    const repairableModes = [];
    for (const relativePath of PRIVATE_AUTOMATION_DIRECTORIES) {
      const directoryPath = relativePath
        ? path.join(stateDir, relativePath)
        : stateDir;
      if (!existsSync(directoryPath)) continue;
      const stats = lstatSync(directoryPath);
      if (
        !stats.isDirectory() ||
        stats.isSymbolicLink() ||
        (currentUid !== null && stats.uid !== currentUid)
      ) {
        problems.push(
          `${directoryPath} is not a physical directory owned by the current user`,
        );
        continue;
      }
      if ((stats.mode & 0o777) !== 0o700) {
        problems.push(`${directoryPath} is not mode 0700`);
        repairableModes.push(directoryPath);
      }
    }
    if (problems.length > 0) {
      const remediation =
        repairableModes.length === problems.length
          ? `Run: chmod 700 ${repairableModes.map(shellQuote).join(" ")}`
          : "Move aside the unsafe path, then recreate each listed directory as the current user with mode 0700.";
      return check(
        "automation-state-dir",
        "automation state dir",
        "fail",
        problems.join("; "),
        remediation,
      );
    }
    return check(
      "automation-state-dir",
      "automation state dir",
      "ok",
      `${stateDir} and its private control directories are mode 0700.`,
    );
  }
  try {
    mkdirSync(stateDir, { recursive: true, mode: 0o700 });
    return check(
      "automation-state-dir",
      "automation state dir",
      "ok",
      `${stateDir} created with mode 0700.`,
    );
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

function fileSha256(filePath) {
  try {
    return createHash("sha256").update(readFileSync(filePath)).digest("hex");
  } catch {
    return null;
  }
}

function immutableRootOwnedPathProblems(
  filePath,
  label,
  { executable = false } = {},
) {
  const problems = [];
  try {
    if (!path.isAbsolute(filePath) || realpathSync(filePath) !== filePath) {
      return [`${label} is not a canonical absolute path`];
    }
    const fileStats = lstatSync(filePath);
    if (
      !fileStats.isFile() ||
      fileStats.isSymbolicLink() ||
      fileStats.uid !== 0
    ) {
      problems.push(`${label} is not a root-owned physical regular file`);
    }
    if ((fileStats.mode & 0o022) !== 0) {
      problems.push(`${label} is group or world writable`);
    }
    if (executable && (fileStats.mode & 0o111) === 0) {
      problems.push(`${label} is not executable`);
    }
    let current = path.dirname(filePath);
    while (current !== path.dirname(current)) {
      const stats = lstatSync(current);
      if (!stats.isDirectory() || stats.isSymbolicLink() || stats.uid !== 0) {
        problems.push(`${label} has a non-root-owned directory in its path`);
        break;
      }
      if ((stats.mode & 0o022) !== 0) {
        problems.push(`${label} has a writable directory in its path`);
        break;
      }
      current = path.dirname(current);
    }
  } catch (error) {
    problems.push(
      `${label} cannot be inspected: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  return problems;
}

function publisherCodeSignatureProblems(config) {
  if (os.platform() !== "darwin") {
    return ["the signed publisher broker is supported only on macOS"];
  }
  const verify = spawnSync(
    "/usr/bin/codesign",
    ["--verify", "--strict", config.brokerPath],
    {
      encoding: "utf8",
    },
  );
  const details = spawnSync(
    "/usr/bin/codesign",
    ["-dv", "--verbose=4", config.brokerPath],
    {
      encoding: "utf8",
    },
  );
  const combined = `${details.stdout ?? ""}\n${details.stderr ?? ""}`;
  const problems = [];
  if (verify.status !== 0 || details.status !== 0) {
    problems.push("the publisher broker code signature is invalid");
  }
  if (!combined.includes(`Identifier=${config.brokerSigningIdentifier}`)) {
    problems.push("the publisher broker signing identifier does not match");
  }
  if (!combined.includes(`TeamIdentifier=${config.brokerTeamIdentifier}`)) {
    problems.push("the publisher broker team identifier does not match");
  }
  if (!/flags=.*runtime/i.test(combined) || /flags=.*adhoc/i.test(combined)) {
    problems.push(
      "the publisher broker is not a non-adhoc hardened runtime binary",
    );
  }
  return problems;
}

function trustedControlCheckoutProblems(config) {
  const environment = {
    DEVELOPER_DIR: "/Library/Developer/CommandLineTools",
    HOME: os.homedir(),
    PATH: "/usr/bin:/bin",
    GIT_CONFIG_GLOBAL: "/dev/null",
    GIT_CONFIG_NOSYSTEM: "1",
  };
  const runGit = (arguments_) =>
    spawnSync(
      "/usr/bin/git",
      [
        "-c",
        "core.fsmonitor=false",
        "-c",
        "core.hooksPath=/dev/null",
        "-C",
        String(config.controlRoot ?? ""),
        ...arguments_,
      ],
      { encoding: "utf8", env: environment },
    );
  const root = runGit(["rev-parse", "--show-toplevel"]);
  const head = runGit(["rev-parse", "HEAD"]);
  const status = runGit(["status", "--porcelain", "--untracked-files=all"]);
  const problems = [];
  if (root.status !== 0 || root.stdout.trim() !== config.controlRoot) {
    problems.push("the control root is not its Git checkout root");
  }
  if (head.status !== 0 || head.stdout.trim() !== config.controlCommit) {
    problems.push("the control checkout does not match its pinned commit");
  }
  if (status.status !== 0 || status.stdout.trim() !== "") {
    problems.push("the control checkout is not clean");
  }
  return problems;
}

export function checkTrustedPublisherConfig(
  env = process.env,
  _home = os.homedir(),
  { configPath = TRUSTED_PUBLISHER_CONFIG_PATH } = {},
) {
  const broker = String(env.FREED_TRUSTED_PUBLISHER ?? "").trim();
  const remediation = `To enable the optional unattended publisher, install the signed broker, immutable control checkout, immutable Node and GitHub CLI, and root-owned schema v2 config at ${configPath}.`;
  const problems = [];
  let config = null;

  if (!broker) {
    problems.push("FREED_TRUSTED_PUBLISHER is not configured");
  } else {
    problems.push(
      ...immutableRootOwnedPathProblems(broker, "FREED_TRUSTED_PUBLISHER", {
        executable: true,
      }),
    );
  }
  if (!existsSync(configPath)) {
    problems.push("the root-owned trusted publisher config does not exist");
  } else {
    problems.push(
      ...immutableRootOwnedPathProblems(configPath, "trusted publisher config"),
    );
    try {
      config = JSON.parse(readFileSync(configPath, "utf8"));
    } catch (error) {
      problems.push(
        `the trusted publisher config cannot be read: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  if (config) {
    const configKeys = Object.keys(config).sort();
    if (
      JSON.stringify(configKeys) !==
      JSON.stringify(TRUSTED_PUBLISHER_CONFIG_KEYS)
    ) {
      problems.push(
        `the trusted publisher host config must contain exactly: ${TRUSTED_PUBLISHER_CONFIG_KEYS.join(", ")}`,
      );
    }
    if (config.schemaVersion !== 2) {
      problems.push("the trusted publisher host config schema is unsupported");
    }
    if (broker !== config.brokerPath) {
      problems.push(
        "FREED_TRUSTED_PUBLISHER does not match the root-owned broker path",
      );
    }
    for (const [filePath, digest, label, executable] of [
      [config.brokerPath, config.brokerSha256, "publisher broker", true],
      [
        path.join(
          config.controlRoot ?? "",
          "scripts",
          "trusted-worktree-publish.sh",
        ),
        config.launcherSha256,
        "trusted publisher launcher",
        true,
      ],
      [
        path.join(
          config.controlRoot ?? "",
          "scripts",
          "automation-control.mjs",
        ),
        config.automationControlSha256,
        "automation control entry",
        false,
      ],
      [
        path.join(
          config.controlRoot ?? "",
          "scripts",
          "lib",
          "automation-control.mjs",
        ),
        config.automationControlLibrarySha256,
        "automation control library",
        false,
      ],
      [
        path.join(config.controlRoot ?? "", "scripts", "worktree-publish.sh"),
        config.publisherHelperSha256,
        "publisher helper",
        true,
      ],
      [
        config.githubCLIPath,
        config.githubCLISha256,
        "trusted GitHub CLI",
        true,
      ],
      [config.nodePath, config.nodeSha256, "trusted Node", true],
    ]) {
      problems.push(
        ...immutableRootOwnedPathProblems(String(filePath ?? ""), label, {
          executable,
        }),
      );
      if (!/^[0-9a-f]{64}$/.test(String(digest ?? ""))) {
        problems.push(`${label} digest is invalid`);
      } else if (existsSync(String(filePath ?? ""))) {
        const actualDigest = fileSha256(String(filePath));
        if (actualDigest === null) {
          problems.push(`${label} digest cannot be computed`);
        } else if (actualDigest !== digest) {
          problems.push(`${label} digest does not match`);
        }
      }
    }
    if (!/^[0-9a-f]{40}$/.test(String(config.controlCommit ?? ""))) {
      problems.push(
        "the configured control commit is not one full lowercase SHA",
      );
    } else if (existsSync(String(config.controlRoot ?? ""))) {
      problems.push(...trustedControlCheckoutProblems(config));
    }
    if (
      !path.isAbsolute(String(config.stateRoot ?? "")) ||
      !existsSync(config.stateRoot)
    ) {
      problems.push(
        "the configured state root is not an existing absolute path",
      );
    } else {
      const stateStats = lstatSync(config.stateRoot);
      const currentUid =
        typeof process.getuid === "function"
          ? process.getuid()
          : stateStats.uid;
      if (
        realpathSync(config.stateRoot) !== config.stateRoot ||
        !stateStats.isDirectory() ||
        stateStats.isSymbolicLink() ||
        stateStats.uid !== currentUid ||
        (stateStats.mode & 0o777) !== 0o700
      ) {
        problems.push(
          "the configured state root is not a private current-user directory",
        );
      }
    }
    let publicKey = null;
    try {
      publicKey = Buffer.from(
        String(config.publisherPublicKeyBase64 ?? ""),
        "base64",
      );
    } catch {
      publicKey = null;
    }
    if (
      !publicKey ||
      publicKey.length !== 32 ||
      publicKey.toString("base64") !== config.publisherPublicKeyBase64
    ) {
      problems.push(
        "the publisher public key is not 32 canonical base64 bytes",
      );
    }
    const publisherCredentialPath = path.join(
      String(config.stateRoot ?? ""),
      "control",
      "actor-credentials",
      "freed-pr-publisher.json",
    );
    if (!existsSync(publisherCredentialPath)) {
      problems.push("the publisher public key record does not exist");
    } else {
      const credentialStats = lstatSync(publisherCredentialPath);
      const currentUid =
        typeof process.getuid === "function"
          ? process.getuid()
          : credentialStats.uid;
      if (
        !credentialStats.isFile() ||
        credentialStats.isSymbolicLink() ||
        credentialStats.uid !== currentUid ||
        (credentialStats.mode & 0o777) !== 0o600
      ) {
        problems.push(
          "the publisher public key record is not a private current-user file",
        );
      }
      try {
        const credential = JSON.parse(
          readFileSync(publisherCredentialPath, "utf8"),
        );
        if (
          Object.keys(credential).sort().join("\n") !==
            ["actor", "publicKeyBase64", "purpose", "schemaVersion"]
              .sort()
              .join("\n") ||
          credential.schemaVersion !== 1 ||
          credential.actor !== "freed-pr-publisher" ||
          credential.purpose !== "publisher-capability-signing" ||
          credential.publicKeyBase64 !== config.publisherPublicKeyBase64
        ) {
          problems.push(
            "the publisher public key record does not match the root-owned key pin",
          );
        }
      } catch {
        problems.push("the publisher public key record is not valid JSON");
      }
    }
    if (
      !/^[A-Z0-9]{10}$/.test(String(config.brokerTeamIdentifier ?? "")) ||
      !/^[A-Za-z0-9][A-Za-z0-9.-]+$/.test(
        String(config.brokerSigningIdentifier ?? ""),
      )
    ) {
      problems.push("the broker signing requirement is invalid");
    } else if (existsSync(String(config.brokerPath ?? ""))) {
      problems.push(...publisherCodeSignatureProblems(config));
    }
    if (
      configPath === TRUSTED_PUBLISHER_CONFIG_PATH &&
      os.platform() === "darwin"
    ) {
      const keychainItem = spawnSync(
        "/usr/bin/security",
        [
          "find-generic-password",
          "-s",
          "freed-pr-publisher",
          "-a",
          "freed-pr-publisher-signing-key",
        ],
        { encoding: "utf8" },
      );
      if (keychainItem.status !== 0) {
        problems.push("the publisher signing key is not present in Keychain");
      }
    }
  }

  if (problems.length > 0) {
    return check(
      "trusted-publisher",
      "trusted PR publisher",
      "warn",
      `${[...new Set(problems)].join("; ")}. Optional broker-backed publication stays unavailable; normal GitHub-authenticated publication remains available.`,
      remediation,
    );
  }
  return check(
    "trusted-publisher",
    "trusted PR publisher bindings",
    "ok",
    `Broker ${broker} matches the root-owned schema v2 trust configuration.`,
  );
}

export function runChecks(options = {}) {
  const home = options.home ?? os.homedir();
  const repoRoot = options.repoRoot ?? REPO_ROOT;
  const machineArch = options.machineArch ?? os.arch();
  const platform = options.platform ?? os.platform();
  const stateDir = options.stateDir ?? path.join(home, ".freed", "automation");

  const checks = [
    checkPinnedToolchain(home, repoRoot),
    checkPathNode(home, repoRoot),
    checkGh(machineArch, platform),
    checkGitCredentialHelpers(),
    checkSimpleCommand(
      "git",
      "git",
      "git",
      ["--version"],
      "Install git (xcode-select --install).",
    ),
    checkSimpleCommand("curl", "curl", "curl", ["--version"], "Install curl."),
    checkSystemPython(),
    checkAutomationStateDir(stateDir),
    checkTrustedPublisherConfig(options.env ?? process.env, home),
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
    lines.push(
      `  [${STATUS_GLYPHS[item.status] ?? item.status}] ${item.title}: ${item.detail}`,
    );
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

export function resolveExitCode(
  result,
  { strict = false, requirePublisher = false } = {},
) {
  if (
    requirePublisher &&
    result.checks.find((item) => item.id === "trusted-publisher")?.status !==
      "ok"
  ) {
    return 1;
  }
  if (strict && result.failures > 0) {
    return 1;
  }
  return 0;
}

function main() {
  const argv = process.argv.slice(2);
  const strict = argv.includes("--strict");
  const requirePublisher = argv.includes("--require-publisher");
  const json = argv.includes("--json");
  const unknown = argv.filter(
    (arg) =>
      !["--strict", "--require-publisher", "--json", "--help", "-h"].includes(
        arg,
      ),
  );
  if (argv.includes("--help") || argv.includes("-h") || unknown.length > 0) {
    process.stdout.write(
      "Usage: node scripts/doctor.mjs [--strict] [--require-publisher] [--json]\n" +
        "  --strict  Exit non-zero on hard failures (loop/CI contexts).\n" +
        "  --require-publisher  Exit non-zero unless the root-owned publisher trust chain is ready.\n" +
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
  process.exitCode = resolveExitCode(result, { strict, requirePublisher });
}

if (process.argv[1] === __filename) {
  main();
}
