#!/usr/bin/env node

import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  assertNoRetiredAutomergeArtifactDirectory,
  assertNoRetiredLibraryCorePublicExports,
} from "./lib/retired-automerge-runtime.mjs";

const REPO_ROOT = fileURLToPath(new URL("..", import.meta.url));

function usage() {
  return "Usage: node scripts/validate-retired-automerge-runtime.mjs [desktop|pwa|all]";
}

export function parseRetiredAutomergeRuntimeArgs(argv) {
  if (argv.length > 1) throw new Error(usage());
  const surface = argv[0] ?? "all";
  if (!new Set(["desktop", "pwa", "all"]).has(surface)) {
    throw new Error(usage());
  }
  return surface;
}

export function validateRetiredAutomergeRuntimeArtifacts({
  repoRoot = REPO_ROOT,
  surface = "all",
} = {}) {
  assertNoRetiredLibraryCorePublicExports(repoRoot);
  const surfaces = surface === "all" ? ["desktop", "pwa"] : [surface];
  const summaries = [];
  for (const candidate of surfaces) {
    const artifactRoot = path.join(repoRoot, "packages", candidate, "dist");
    if (!existsSync(artifactRoot)) {
      throw new Error(
        `The ${candidate} release artifact directory does not exist: ${artifactRoot}`,
      );
    }
    summaries.push({
      surface: candidate,
      ...assertNoRetiredAutomergeArtifactDirectory(artifactRoot, candidate),
    });
  }
  return Object.freeze(summaries);
}

function printSummary(summaries) {
  for (const summary of summaries) {
    console.log(
      `Retired Automerge runtime guard passed for ${summary.surface}: ${summary.files.toLocaleString("en-US")} files, ${summary.bytes.toLocaleString("en-US")} bytes.`,
    );
  }
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    const surface = parseRetiredAutomergeRuntimeArgs(process.argv.slice(2));
    printSummary(validateRetiredAutomergeRuntimeArtifacts({ surface }));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
