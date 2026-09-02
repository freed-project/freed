#!/usr/bin/env node

import {
  existsSync,
  lstatSync,
  readFileSync,
  readdirSync,
  realpathSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.resolve(__dirname, "..");
export const MAX_ROOT_BYTES = 16 * 1024;
export const MAX_SCOPED_BYTES = 6 * 1024;
export const MAX_CHAIN_BYTES = 28 * 1024;
export const ARCHITECTURE_GUIDE = "docs/AGENT-INSTRUCTIONS.md";
export const CODEOWNERS_FILE = ".github/CODEOWNERS";
export const REQUIRED_SCOPED_FILES = Object.freeze([
  ".agents/skills/AGENTS.md",
  "website/AGENTS.md",
]);

const INSTRUCTION_NAMES = new Set(["AGENTS.md", "AGENTS.override.md"]);
const REQUIRED_CODEOWNER_RULES = Object.freeze([
  "/AGENTS.md @AubreyF",
  "**/AGENTS.md @AubreyF",
  "**/AGENTS.override.md @AubreyF",
]);
const INVOCATION_POLICY_SNIPPET = [
  "```yaml",
  "policy:",
  "  allow_implicit_invocation: true",
  "```",
].join("\n");
const IGNORED_DIRECTORIES = new Set([
  ".git",
  ".next",
  "coverage",
  "dist",
  "node_modules",
  "target",
]);

function toPosix(filePath) {
  return filePath.split(path.sep).join("/");
}

function collectInstructionFiles(repoRoot) {
  const files = [];

  function visit(directory, relativeDirectory = ".") {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (entry.isSymbolicLink() && INSTRUCTION_NAMES.has(entry.name)) {
        throw new Error(
          toPosix(path.join(relativeDirectory, entry.name)) +
            ": instruction files cannot be symbolic links.",
        );
      }
      if (entry.isDirectory()) {
        if (IGNORED_DIRECTORIES.has(entry.name)) continue;
        const childRelative =
          relativeDirectory === "."
            ? entry.name
            : path.join(relativeDirectory, entry.name);
        visit(path.join(directory, entry.name), childRelative);
        continue;
      }
      if (!entry.isFile() || !INSTRUCTION_NAMES.has(entry.name)) continue;
      files.push(
        toPosix(
          relativeDirectory === "."
            ? entry.name
            : path.join(relativeDirectory, entry.name),
        ),
      );
    }
  }

  visit(repoRoot);
  return files.sort();
}

function localLinkTargets(text) {
  return [...String(text).matchAll(/]\(([^)]+)\)/g)]
    .map((match) => match[1].trim().split(/\s+["']/u, 1)[0])
    .filter(Boolean);
}

function resolveLocalLink(repoRoot, instructionFile, reference) {
  const withoutFragment = reference.split(/[?#]/u, 1)[0];
  if (
    !withoutFragment ||
    withoutFragment.startsWith("#") ||
    /^(?:[a-z][a-z0-9+.-]*:|\/\/)/iu.test(withoutFragment)
  ) {
    return null;
  }
  const resolved = path.resolve(
    repoRoot,
    path.dirname(instructionFile),
    withoutFragment,
  );
  const normalizedRoot = path.resolve(repoRoot);
  if (
    resolved !== normalizedRoot &&
    !resolved.startsWith(normalizedRoot + path.sep)
  ) {
    throw new Error(
      instructionFile +
        ": local link escapes the repository: " +
        reference +
        ".",
    );
  }
  return resolved;
}

function ancestorDirectories(relativeFile) {
  const directories = [];
  let directory = path.posix.dirname(relativeFile);
  while (true) {
    directories.push(directory);
    if (directory === ".") break;
    directory = path.posix.dirname(directory);
  }
  return directories.reverse();
}

function validatePortableInstructions(text, relativeFile) {
  if (/[\u2013\u2014]/u.test(text)) {
    throw new Error(
      relativeFile + ": use standard punctuation instead of em or en dashes.",
    );
  }
}

function validateLocalLinks(repoRoot, relativeFile, text) {
  for (const reference of localLinkTargets(text)) {
    const resolved = resolveLocalLink(repoRoot, relativeFile, reference);
    if (resolved && !existsSync(resolved)) {
      throw new Error(
        relativeFile + ": unresolved local link " + reference + ".",
      );
    }
    if (!resolved) continue;
    if (lstatSync(resolved).isSymbolicLink()) {
      throw new Error(
        relativeFile +
          ": local links cannot target a symbolic link: " +
          reference +
          ".",
      );
    }
    const realRoot = realpathSync(repoRoot);
    const realTarget = realpathSync(resolved);
    if (
      realTarget !== realRoot &&
      !realTarget.startsWith(realRoot + path.sep)
    ) {
      throw new Error(
        relativeFile +
          ": local link escapes the repository through a symbolic path: " +
          reference +
          ".",
      );
    }
  }
}

function isHierarchicalInstructionRoute(sourceFile, targetFile) {
  if (sourceFile === "AGENTS.md") return true;
  const sourceDirectory = path.posix.dirname(sourceFile);
  const targetDirectory = path.posix.dirname(targetFile);
  return (
    targetDirectory === sourceDirectory ||
    targetDirectory.startsWith(sourceDirectory + "/")
  );
}

function readRequiredFile(repoRoot, relativeFile) {
  const absoluteFile = path.join(repoRoot, relativeFile);
  if (!existsSync(absoluteFile)) {
    throw new Error(repoRoot + ": missing required " + relativeFile + ".");
  }
  return readFileSync(absoluteFile, "utf8");
}

function validateArchitectureGuide(repoRoot) {
  const text = readRequiredFile(repoRoot, ARCHITECTURE_GUIDE);
  validatePortableInstructions(text, ARCHITECTURE_GUIDE);
  validateLocalLinks(repoRoot, ARCHITECTURE_GUIDE, text);
  const occurrences = text.split(INVOCATION_POLICY_SNIPPET).length - 1;
  if (occurrences !== 1) {
    throw new Error(
      ARCHITECTURE_GUIDE +
        ": include exactly one Codex invocation policy example with allow_implicit_invocation indented two spaces under policy.",
    );
  }
  return { relativeFile: ARCHITECTURE_GUIDE, bytes: Buffer.byteLength(text) };
}

function validateCodeowners(repoRoot) {
  const text = readRequiredFile(repoRoot, CODEOWNERS_FILE);
  const rules = text
    .split(/\r?\n/u)
    .map((line) => line.trim().replace(/\s+/gu, " "))
    .filter((line) => line && !line.startsWith("#"));
  for (const requiredRule of REQUIRED_CODEOWNER_RULES) {
    if (rules.filter((rule) => rule === requiredRule).length !== 1) {
      throw new Error(
        CODEOWNERS_FILE +
          ": include exactly one owner rule `" +
          requiredRule +
          "`.",
      );
    }
  }
  return { relativeFile: CODEOWNERS_FILE, bytes: Buffer.byteLength(text) };
}

export function validateAgentInstructions({
  repoRoot = REPO_ROOT,
  requiredFiles = REQUIRED_SCOPED_FILES,
  maxRootBytes = MAX_ROOT_BYTES,
  maxScopedBytes = MAX_SCOPED_BYTES,
  maxChainBytes = MAX_CHAIN_BYTES,
} = {}) {
  const files = collectInstructionFiles(repoRoot);
  if (!files.includes("AGENTS.md")) {
    throw new Error(repoRoot + ": missing root AGENTS.md.");
  }

  const byDirectory = new Map();
  const records = [];
  for (const relativeFile of files) {
    const directory = path.posix.dirname(relativeFile);
    if (byDirectory.has(directory)) {
      throw new Error(
        directory + ": keep only one of AGENTS.md or AGENTS.override.md.",
      );
    }
    byDirectory.set(directory, relativeFile);

    const absoluteFile = path.join(repoRoot, relativeFile);
    const text = readFileSync(absoluteFile, "utf8");
    const bytes = Buffer.byteLength(text);
    const limit = relativeFile === "AGENTS.md" ? maxRootBytes : maxScopedBytes;
    if (bytes > limit) {
      throw new Error(
        relativeFile +
          ": " +
          bytes.toLocaleString() +
          " bytes exceeds the " +
          limit.toLocaleString() +
          " byte " +
          (relativeFile === "AGENTS.md" ? "root" : "scoped") +
          " instruction limit.",
      );
    }
    validatePortableInstructions(text, relativeFile);
    validateLocalLinks(repoRoot, relativeFile, text);
    records.push({ relativeFile, bytes, text });
  }

  const root = records.find((record) => record.relativeFile === "AGENTS.md");
  const linkedFiles = new Set();
  for (const reference of localLinkTargets(root.text)) {
    const resolved = resolveLocalLink(repoRoot, root.relativeFile, reference);
    if (!resolved) continue;
    linkedFiles.add(toPosix(path.relative(repoRoot, resolved)));
  }

  for (const requiredFile of requiredFiles) {
    if (!files.includes(requiredFile)) {
      throw new Error(repoRoot + ": missing required " + requiredFile + ".");
    }
    if (!linkedFiles.has(requiredFile)) {
      throw new Error(
        "AGENTS.md: must link required scoped instructions " +
          requiredFile +
          ".",
      );
    }
  }

  const instructionSet = new Set(files);
  const recordsByFile = new Map(
    records.map((record) => [record.relativeFile, record]),
  );
  const reachable = new Set(["AGENTS.md"]);
  const queue = ["AGENTS.md"];
  while (queue.length > 0) {
    const current = queue.shift();
    const record = recordsByFile.get(current);
    for (const reference of localLinkTargets(record.text)) {
      const resolved = resolveLocalLink(repoRoot, current, reference);
      if (!resolved) continue;
      const relativeTarget = toPosix(path.relative(repoRoot, resolved));
      if (
        !instructionSet.has(relativeTarget) ||
        !isHierarchicalInstructionRoute(current, relativeTarget) ||
        reachable.has(relativeTarget)
      ) {
        continue;
      }
      reachable.add(relativeTarget);
      queue.push(relativeTarget);
    }
  }
  const unreachable = files.filter(
    (relativeFile) => !reachable.has(relativeFile),
  );
  if (unreachable.length > 0) {
    throw new Error(
      "Instruction files must be reachable from root AGENTS.md: " +
        unreachable.join(", ") +
        ".",
    );
  }

  const bytesByFile = new Map(
    records.map(({ relativeFile, bytes }) => [relativeFile, bytes]),
  );
  let largestChain = { relativeFile: "AGENTS.md", bytes: root.bytes };
  for (const record of records) {
    const chain = ancestorDirectories(record.relativeFile)
      .map((directory) => byDirectory.get(directory))
      .filter(Boolean);
    const chainBytes = chain.reduce(
      (total, relativeFile) => total + bytesByFile.get(relativeFile),
      0,
    );
    if (chainBytes > maxChainBytes) {
      throw new Error(
        record.relativeFile +
          ": instruction chain is " +
          chainBytes.toLocaleString() +
          " bytes and exceeds the " +
          maxChainBytes.toLocaleString() +
          " byte limit.",
      );
    }
    if (chainBytes > largestChain.bytes) {
      largestChain = { relativeFile: record.relativeFile, bytes: chainBytes };
    }
  }

  const supplementalRecords = [
    validateArchitectureGuide(repoRoot),
    validateCodeowners(repoRoot),
  ];

  return { records, supplementalRecords, largestChain };
}

function main() {
  const result = validateAgentInstructions();
  process.stdout.write(
    "Validated " +
      result.records.length.toLocaleString() +
      " instruction files. Root: " +
      result.records
        .find((record) => record.relativeFile === "AGENTS.md")
        .bytes.toLocaleString() +
      " bytes. Largest chain: " +
      result.largestChain.bytes.toLocaleString() +
      " bytes at " +
      result.largestChain.relativeFile +
      ". Supplemental controls: " +
      result.supplementalRecords.length.toLocaleString() +
      ".\n",
  );
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (error) {
    process.stderr.write(
      (error instanceof Error ? error.message : String(error)) + "\n",
    );
    process.exitCode = 1;
  }
}
