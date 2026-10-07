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
 * discarded and the object reads as truthy, so entity expansion runs unbounded
 * on attacker-authored RSS and OPML. The lockfile pinned v5 the whole time.
 *
 * CI never sees this because every workflow runs `npm ci`. This check exists
 * for local trees, where nothing else closes the gap.
 *
 * Pure filesystem comparison. No network, no registry, no install side effects
 * unless `--fix` is passed.
 */

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** Lock entries that describe a workspace rather than an installed package. */
function isInstalledPackageEntry(entryPath, entry) {
  if (!entryPath.startsWith("node_modules/")) return false;
  // Workspace symlinks carry a `link` flag and resolve to a local directory.
  if (entry.link === true) return false;
  // Bundled dependencies ship inside their parent and have no own install path.
  if (entry.inBundle === true) return false;
  return typeof entry.version === "string";
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
function inspectEntry(entryPath, entry) {
  const manifestPath = path.join(root, entryPath, "package.json");
  if (!existsSync(manifestPath)) {
    if (entry.optional === true || entry.devOptional === true) return null;
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
 * Exported for the test, which supplies a synthetic lock object rather than
 * installing fixtures on disk.
 */
export function findInstalledTreeDrift(lock) {
  const entries = Object.entries(lock?.packages ?? {});
  const findings = [];
  for (const [entryPath, entry] of entries) {
    if (!isInstalledPackageEntry(entryPath, entry)) continue;
    const finding = inspectEntry(entryPath, entry);
    if (finding) findings.push(finding);
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
    return `  ${name}: installed ${finding.actual}, lockfile pins ${finding.expected}`;
  });
  const hidden = findings.length - lines.length;
  if (hidden > 0) lines.push(`  ...and ${hidden.toLocaleString()} more`);
  return lines.join("\n");
}

function readLock() {
  const lockPath = path.join(root, "package-lock.json");
  if (!existsSync(lockPath)) {
    throw new Error("package-lock.json is missing. Cannot verify the installed tree.");
  }
  return JSON.parse(readFileSync(lockPath, "utf8"));
}

function runNpmCi() {
  console.log("[check-installed-tree] Running npm ci to match the lockfile.");
  const result = spawnSync("npm", ["ci"], { cwd: root, stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`npm ci exited with status ${String(result.status)}.`);
  }
}

function main() {
  const fixRequested =
    process.argv.includes("--fix") || process.env.FREED_AUTO_INSTALL === "1";
  const findings = findInstalledTreeDrift(readLock());

  if (findings.length === 0) {
    if (!process.argv.includes("--quiet")) {
      console.log("[check-installed-tree] Installed tree matches package-lock.json.");
    }
    return;
  }

  console.error(
    `[check-installed-tree] Installed tree does not match package-lock.json ` +
      `(${findings.length.toLocaleString()} package${findings.length === 1 ? "" : "s"}):`,
  );
  console.error(formatFindings(findings));

  if (!fixRequested) {
    console.error("");
    console.error("Run `npm ci` to match the lockfile, or `npm run deps:fix`.");
    console.error("Set FREED_AUTO_INSTALL=1 to repair automatically instead of failing.");
    process.exitCode = 1;
    return;
  }

  runNpmCi();

  const remaining = findInstalledTreeDrift(readLock());
  if (remaining.length > 0) {
    console.error("[check-installed-tree] Drift survived npm ci:");
    console.error(formatFindings(remaining));
    process.exitCode = 1;
    return;
  }
  console.log("[check-installed-tree] Installed tree now matches package-lock.json.");
}

// Importing the module for its helpers must not run the check.
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (error) {
    console.error("[check-installed-tree] Failed to verify the installed tree.");
    console.error(error);
    process.exitCode = 1;
  }
}
