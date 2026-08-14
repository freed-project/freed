#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  inspectLibraryCoreActivationManifest,
  LIBRARY_CORE_ACTIVATION_MANIFEST_PATH,
} from "./lib/library-core-release-activation.mjs";
import { readGitPathAtRef } from "./lib/git-path-at-ref.mjs";

const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

function argumentValue(name) {
  const prefix = `--${name}=`;
  return (
    process.argv
      .slice(2)
      .find((argument) => argument.startsWith(prefix))
      ?.slice(prefix.length) ?? null
  );
}

function readBaseManifest(baseRef) {
  const mergeBase = execFileSync("git", ["merge-base", "HEAD", baseRef], {
    cwd: REPO_ROOT,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
  const result = readGitPathAtRef({
    cwd: REPO_ROOT,
    ref: mergeBase,
    filePath: LIBRARY_CORE_ACTIVATION_MANIFEST_PATH,
  });
  return result.state === "present" ? result.contents : null;
}

function main() {
  const baseRef = argumentValue("base-ref") ?? "origin/dev";
  const currentContents = readFileSync(
    path.join(REPO_ROOT, LIBRARY_CORE_ACTIVATION_MANIFEST_PATH),
    "utf8",
  );
  const inspection = inspectLibraryCoreActivationManifest({
    previousContents: readBaseManifest(baseRef),
    currentContents,
  });
  process.stdout.write(
    `Validated Library Core activation manifest with ${inspection.transitions.length.toLocaleString()} new transition(s).\n`,
  );
}

try {
  main();
} catch (error) {
  process.stderr.write(
    `${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exitCode = 1;
}
