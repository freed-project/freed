#!/usr/bin/env node

/**
 * Fail fast when the installed dependency tree does not match package-lock.json.
 *
 * A stale node_modules is silent. It does not warn, it does not fail to
 * resolve, and the code keeps running against whatever version happens to be
 * on disk. That is how a security control disappears without anyone noticing:
 * `packages/capture-rss/src/xml-security.ts` passes an entity-expansion limit
 * object as fast-xml-parser's `processEntities`, which is an options object in
 * v5 and a plain boolean in v4. Against an installed v4 every limit is
 * discarded and the object reads as truthy. Published v4.5.3 ignores those
 * numeric bounds for simple entities; it separately excludes nested entity
 * definitions. This is not a claim that v5's reserved maxExpansionDepth option
 * is enforced. The lockfile pinned v5 the whole time.
 *
 * CI never sees this because every workflow runs `npm ci`. This check exists
 * for local trees, where nothing else closes the gap.
 *
 * Pure filesystem comparison. No network, no registry, no install side effects
 * unless `--fix` is passed.
 */

import { existsSync, lstatSync, readFileSync, readdirSync, realpathSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** Versioned physical installs, including workspace-local and bundled paths. */
function isInstalledPackageEntry(entryPath, entry) {
  if (!/(^|\/)node_modules\//.test(entryPath)) return false;
  // Workspace symlinks carry a `link` flag and resolve to a local directory.
  if (entry.link === true) return false;
  // Bundled packages also have physical paths recorded in lockfile v2/v3.
  return typeof entry.version === "string";
}

function lockPackages(lock) {
  if (![2, 3].includes(lock?.lockfileVersion) || !lock.packages ||
      typeof lock.packages !== "object" || Array.isArray(lock.packages) || !Object.hasOwn(lock.packages, "")) {
    throw new Error("Expected a package-lock.json v2/v3 packages object.");
  }
  for (const [entryPath, entry] of Object.entries(lock.packages)) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry) ||
        (entryPath && (path.posix.isAbsolute(entryPath) || entryPath.includes("\\") ||
          entryPath.split("/").some((part) => !part || part === "." || part === "..")))) {
      throw new Error(`Invalid lockfile packages entry: ${entryPath}`);
    }
  }
  return lock.packages;
}

function absentOptionalParent(entryPath, packages, rootDir) {
  let parent = entryPath;
  while (parent.includes("/node_modules/")) {
    parent = parent.slice(0, parent.lastIndexOf("/node_modules/"));
    const entry = packages[parent];
    if (entry && (entry.optional === true || entry.devOptional === true) &&
        !existsSync(path.join(rootDir, parent, "package.json"))) return true;
  }
  return false;
}

/**
 * Compare one lock entry against what is installed at its path.
 *
 * Returns null when the entry matches, otherwise a finding describing the
 * drift. A missing `package.json` and an unreadable one are the same failure
 * from the caller's point of view: the locked version is not proven present.
 *
 * Optional dependencies are the exception. The lockfile records every
 * platform's prebuilt binary — `@esbuild/darwin-arm64`,
 * `@rollup/rollup-win32-x64-msvc`, `@img/sharp-*` — and npm installs only the
 * ones matching this `os` and `cpu`. Their absence is correct, so a missing
 * optional entry is not drift. A wrong *version* of one that did install still
 * is, so the version comparison below applies to optional entries too.
 */
function inspectEntry(entryPath, entry, packages, rootDir) {
  // Registry installs must be physical directories. A same-version link can
  // hide nested dependencies, so refuse it without reading its target.
  if (lstatSync(path.join(rootDir, entryPath), { throwIfNoEntry: false })?.isSymbolicLink()) {
    return { entryPath, expected: entry.version, actual: null, kind: "unexpected_link" };
  }
  const manifestPath = path.join(rootDir, entryPath, "package.json");
  if (!existsSync(manifestPath)) {
    if (entry.optional === true || entry.devOptional === true ||
        absentOptionalParent(entryPath, packages, rootDir)) return null;
    return { entryPath, expected: entry.version, actual: null, kind: "missing" };
  }

  let installedVersion;
  try {
    installedVersion = JSON.parse(readFileSync(manifestPath, "utf8")).version;
  } catch {
    return {
      entryPath,
      expected: entry.version,
      actual: null,
      kind: "unreadable",
    };
  }

  if (installedVersion !== entry.version) {
    return {
      entryPath,
      expected: entry.version,
      actual: installedVersion ?? null,
      kind: "mismatch",
    };
  }

  return null;
}

/**
 * Collect every drift finding between the lockfile and the installed tree.
 *
 * Include unlisted physical packages: a stale workspace-local copy can shadow
 * a matching hoisted dependency without having an entry in the current lock.
 * Read metadata only; do not import package code or traverse package symlinks.
 */
export function findInstalledTreeDrift(lock, { rootDir = root } = {}) {
  const packages = lockPackages(lock);
  const entries = Object.entries(packages);
  const findings = [];
  const inspected = new Map();
  const refusedLinks = new Set();
  // Inspect parents first even when lock entries are in descendant-first order.
  // One refused link proves drift; do not inspect its recorded descendants.
  const physicalEntries = entries.filter(([entryPath, entry]) => isInstalledPackageEntry(entryPath, entry))
    .sort(([a], [b]) => a.split("/").length - b.split("/").length);
  for (const [entryPath, entry] of physicalEntries) {
    if ([...refusedLinks].some((parent) => entryPath.startsWith(`${parent}/`))) continue;
    const finding = inspectEntry(entryPath, entry, packages, rootDir);
    if (finding) inspected.set(entryPath, finding);
    if (finding?.kind === "unexpected_link") refusedLinks.add(entryPath);
  }
  for (const [entryPath] of entries) {
    if (inspected.has(entryPath)) findings.push(inspected.get(entryPath));
  }

  const directories = new Set(["node_modules"]);
  for (const [entryPath, entry] of entries) {
    if (entryPath && !/(^|\/)node_modules\//.test(entryPath) && entry.link !== true) {
      directories.add(`${entryPath}/node_modules`);
    }
  }
  for (const directory of directories) {
    const absoluteDirectory = path.join(rootDir, directory);
    if (!existsSync(absoluteDirectory)) continue;
    const children = readdirSync(absoluteDirectory, { withFileTypes: true })
      .filter((child) => !child.name.startsWith(".") && (child.isDirectory() || child.isSymbolicLink()))
      .flatMap((child) => child.name.startsWith("@") && child.isDirectory()
        ? readdirSync(path.join(absoluteDirectory, child.name), { withFileTypes: true })
          .filter((member) => member.isDirectory() || member.isSymbolicLink())
          .map((member) => ({ name: `${child.name}/${member.name}`, symlink: member.isSymbolicLink() }))
        : [{ name: child.name, symlink: child.isSymbolicLink() }]);
    for (const child of children) {
      const entryPath = `${directory}/${child.name}`;
      if (!Object.hasOwn(packages, entryPath)) {
        let actual = null;
        try { actual = JSON.parse(readFileSync(path.join(rootDir, entryPath, "package.json"), "utf8")).version ?? null; } catch { /* Still unlisted. */ }
        findings.push({ entryPath, expected: null, actual, kind: "extraneous" });
      }
      if (!child.symlink && packages[entryPath]?.link !== true) {
        directories.add(`${entryPath}/node_modules`);
      }
    }
  }
  return findings;
}

export function formatFindings(findings, { limit = 20 } = {}) {
  const lines = findings.slice(0, limit).map((finding) => {
    const name = finding.entryPath.replace(/^node_modules\//, "");
    if (finding.kind === "missing") {
      return `  ${name}: not installed, lockfile pins ${finding.expected}`;
    }
    if (finding.kind === "unreadable") {
      return `  ${name}: manifest unreadable, lockfile pins ${finding.expected}`;
    }
    if (finding.kind === "extraneous") {
      return `  ${name}: installed ${finding.actual ?? "unknown version"}, not in lockfile`;
    }
    if (finding.kind === "unexpected_link") {
      return `  ${name}: unexpected symlink or junction, lockfile requires a physical install of ${finding.expected}`;
    }
    return `  ${name}: installed ${finding.actual}, lockfile pins ${finding.expected}`;
  });
  const hidden = findings.length - lines.length;
  if (hidden > 0) lines.push(`  ...and ${hidden.toLocaleString()} more`);
  return lines.join("\n");
}

function readLock(rootDir = root) {
  const lockPath = path.join(rootDir, "package-lock.json");
  if (!existsSync(lockPath)) {
    throw new Error("package-lock.json is missing. Cannot verify the installed tree.");
  }
  return JSON.parse(readFileSync(lockPath, "utf8"));
}

export function resolveNpmCommand({ nodePath = process.execPath, platform = process.platform,
  npmExecPath = process.env.npm_execpath, fileExists = existsSync } = {}) {
  const paths = platform === "win32" ? path.win32 : path;
  // npm supplies its own CLI path to lifecycle scripts. It may be installed
  // under a separate prefix; keep Node-plus-JavaScript execution without a shell.
  if (npmExecPath) {
    if (typeof npmExecPath !== "string" || !paths.isAbsolute(npmExecPath) ||
        !/\.[cm]?js$/i.test(npmExecPath) || !fileExists(npmExecPath)) {
      throw new Error("The caller-provided npm JavaScript CLI path is invalid or missing.");
    }
    return { command: nodePath, args: [npmExecPath, "ci"] };
  }
  const bin = paths.dirname(nodePath);
  const candidates = [
    paths.join(bin, "node_modules", "npm", "bin", "npm-cli.js"),
    paths.resolve(bin, "..", "lib", "node_modules", "npm", "bin", "npm-cli.js"),
  ];
  const cliPath = candidates.find(fileExists);
  if (!cliPath) throw new Error("Cannot locate npm's JavaScript CLI beside the running Node installation.");
  return { command: nodePath, args: [cliPath, "ci"] };
}

export function runNpmCi({ rootDir = root, cliPath, npmExecPath = process.env.npm_execpath,
  spawn = spawnSync, output = console } = {}) {
  output.log("[check-installed-tree] Running npm ci to match the lockfile.");
  const invocation = cliPath
    ? { command: process.execPath, args: [cliPath, "ci"] }
    : resolveNpmCommand({ npmExecPath });
  const result = spawn(invocation.command, invocation.args, { cwd: rootDir, stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`npm ci exited with status ${String(result.status)}.`);
  }
}

export function main({ argv = process.argv.slice(2), env = process.env, rootDir = root,
  install = () => runNpmCi({ rootDir }), output = console } = {}) {
  const fixRequested =
    argv.includes("--fix") || env.FREED_AUTO_INSTALL === "1";
  const findings = findInstalledTreeDrift(readLock(rootDir), { rootDir });

  if (findings.length === 0) {
    if (!argv.includes("--quiet")) {
      output.log("[check-installed-tree] Installed tree matches package-lock.json.");
    }
    return 0;
  }

  output.error(
    `[check-installed-tree] Installed tree does not match package-lock.json ` +
      `(${findings.length.toLocaleString()} package${findings.length === 1 ? "" : "s"}):`,
  );
  output.error(formatFindings(findings));

  if (!fixRequested) {
    output.error("");
    output.error("Run `npm ci` to match the lockfile, or `npm run deps:fix`.");
    output.error("Set FREED_AUTO_INSTALL=1 to repair automatically instead of failing.");
    return 1;
  }

  install();

  const remaining = findInstalledTreeDrift(readLock(rootDir), { rootDir });
  if (remaining.length > 0) {
    output.error("[check-installed-tree] Drift survived npm ci:");
    output.error(formatFindings(remaining));
    return 1;
  }
  output.log("[check-installed-tree] Installed tree now matches package-lock.json.");
  return 0;
}

// Importing the module for its helpers must not run the check.
if (process.argv[1] && existsSync(process.argv[1]) &&
    realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) {
  try {
    process.exitCode = main();
  } catch (error) {
    console.error("[check-installed-tree] Failed to verify the installed tree.");
    console.error(error);
    process.exitCode = 1;
  }
}
