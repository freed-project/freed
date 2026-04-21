#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

const MIN_NODE_MAJOR = 20;
const MIN_NPM_MAJOR = 10;

function parseVersion(raw) {
  const match = String(raw).trim().match(/^v?(\d+)(?:\.(\d+))?(?:\.(\d+))?/);
  if (!match) {
    return null;
  }

  return {
    major: Number(match[1] || 0),
    minor: Number(match[2] || 0),
    patch: Number(match[3] || 0),
    raw: match[0].replace(/^v/, ""),
  };
}

function compareVersions(a, b) {
  if (a.major !== b.major) return a.major - b.major;
  if (a.minor !== b.minor) return a.minor - b.minor;
  return a.patch - b.patch;
}

function run(bin, args) {
  const result = spawnSync(bin, args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });

  if (result.status !== 0) {
    return null;
  }

  return result.stdout.trim();
}

function findOnPath(binName) {
  const pathEntries = (process.env.PATH || "").split(path.delimiter).filter(Boolean);
  const matches = [];

  for (const entry of pathEntries) {
    const candidate = path.join(entry, binName);
    if (existsSync(candidate)) {
      matches.push(candidate);
    }
  }

  return matches;
}

function findNvmNpms() {
  const versionsDir = path.join(homedir(), ".nvm", "versions", "node");
  if (!existsSync(versionsDir)) {
    return [];
  }

  return readdirSync(versionsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(versionsDir, entry.name, "bin", "npm"))
    .filter((candidate) => existsSync(candidate));
}

function inspectCandidate(bin, source) {
  if (!bin || !existsSync(bin)) {
    return null;
  }

  let realId = bin;
  try {
    realId = realpathSync(bin);
  } catch {
    realId = bin;
  }

  const npmVersionRaw = run(bin, ["--version"]);
  const npmVersion = npmVersionRaw ? parseVersion(npmVersionRaw) : null;
  if (!npmVersion) {
    return null;
  }

  const nodeName = process.platform === "win32" ? "node.exe" : "node";
  const nodeBin = path.basename(bin).startsWith("npm")
    ? path.join(path.dirname(bin), nodeName)
    : null;
  const hasNodeBin = Boolean(nodeBin) && existsSync(nodeBin);
  const nodeVersionRaw = hasNodeBin ? run(nodeBin, ["--version"]) : null;
  const nodeVersion = nodeVersionRaw ? parseVersion(nodeVersionRaw) : null;

  return {
    bin,
    realId,
    source,
    npmVersion,
    nodeBin: hasNodeBin ? nodeBin : null,
    nodeVersion,
  };
}

function dedupe(candidates) {
  const seen = new Set();
  const unique = [];

  for (const candidate of candidates) {
    if (!candidate || seen.has(candidate.realId)) {
      continue;
    }

    seen.add(candidate.realId);
    unique.push(candidate);
  }

  return unique;
}

function candidateList() {
  const npmName = process.platform === "win32" ? "npm.cmd" : "npm";
  const activeNodeDir = path.dirname(realpathSync(process.execPath));
  const candidates = [
    inspectCandidate(process.env.FREED_NPM_BIN, "FREED_NPM_BIN"),
    inspectCandidate(path.join(activeNodeDir, npmName), "active-node"),
    ...findOnPath(npmName).map((bin, index) => inspectCandidate(bin, `PATH[${index}]`)),
    ...findNvmNpms().map((bin, index) => inspectCandidate(bin, `nvm[${index}]`)),
  ];

  return dedupe(candidates);
}

function chooseCandidate(candidates) {
  const compatible = candidates.filter((candidate) =>
    candidate.nodeVersion
    && candidate.nodeVersion.major >= MIN_NODE_MAJOR
    && candidate.npmVersion.major >= MIN_NPM_MAJOR
  );

  const sourceRank = (source) => {
    if (source === "FREED_NPM_BIN") return 0;
    if (source === "active-node") return 1;
    if (source.startsWith("PATH[")) return 2;
    if (source.startsWith("nvm[")) return 3;
    return 4;
  };

  compatible.sort((a, b) => {
    const sourceDiff = sourceRank(a.source) - sourceRank(b.source);
    if (sourceDiff !== 0) return sourceDiff;

    const nodeDiff = compareVersions(b.nodeVersion, a.nodeVersion);
    if (nodeDiff !== 0) return nodeDiff;

    return compareVersions(b.npmVersion, a.npmVersion);
  });

  return compatible[0] ?? null;
}

function npmCliFor(candidate) {
  if (candidate.bin.endsWith("npm-cli.js")) {
    return candidate.bin;
  }

  if (!candidate.nodeBin) {
    return null;
  }

  const prefix = path.dirname(path.dirname(candidate.nodeBin));
  const cliPath = path.join(prefix, "lib", "node_modules", "npm", "bin", "npm-cli.js");
  return existsSync(cliPath) ? cliPath : null;
}

function printFailure(candidates) {
  const detected = candidates.length > 0
    ? candidates
      .map((candidate) => {
        const nodeVersion = candidate.nodeVersion?.raw ?? "unknown";
        const npmVersion = candidate.npmVersion?.raw ?? "unknown";
        return `  - ${candidate.source}: node ${nodeVersion}, npm ${npmVersion}, ${candidate.bin}`;
      })
      .join("\n")
    : "  - none";

  console.error(
    [
      `Freed requires Node ${MIN_NODE_MAJOR}+ with npm ${MIN_NPM_MAJOR}+ for workspace installs and repo scripts.`,
      "",
      "Compatible npm could not be resolved automatically.",
      "",
      "Detected candidates:",
      detected,
      "",
      "Recommended fix:",
      "  1. Run `nvm use` in the repo root.",
      "  2. Retry with `node scripts/npmw.mjs ci --prefer-offline`.",
    ].join("\n"),
  );
}

const args = process.argv.slice(2);
const candidates = candidateList();
const chosen = chooseCandidate(candidates);

if (!chosen) {
  printFailure(candidates);
  process.exit(1);
}

if (args[0] === "--print-bin") {
  console.log(chosen.bin);
  process.exit(0);
}

if (args.length === 0) {
  console.error("Usage: node scripts/npmw.mjs <npm args...>");
  process.exit(1);
}

const npmCli = npmCliFor(chosen);
const result = npmCli
  ? spawnSync(chosen.nodeBin, [npmCli, ...args], { stdio: "inherit" })
  : spawnSync(chosen.bin, args, { stdio: "inherit" });

if (result.error) {
  console.error(result.error.message);
  process.exit(1);
}

process.exit(result.status ?? 1);
