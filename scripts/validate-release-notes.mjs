#!/usr/bin/env node

import { readFileSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { validateReleaseShape } from "./release-notes-shared.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, "..");

function die(message) {
  console.error(message);
  process.exit(1);
}

function loadArtifact(filePath) {
  return JSON.parse(readFileSync(path.resolve(REPO_ROOT, filePath), "utf8"));
}

function main() {
  const filePath = process.argv[2];
  if (!filePath) {
    die("Usage: node scripts/validate-release-notes.mjs <release-json-path> [prior-json-path ...]");
  }

  const artifact = loadArtifact(filePath);
  const priorArtifacts = process.argv.slice(3).map((priorPath) => loadArtifact(priorPath).release ?? {});
  const result = validateReleaseShape(artifact.release ?? {}, {
    earlierReleases: priorArtifacts,
  });

  if (result.errors.length > 0) {
    for (const error of result.errors) {
      console.error(error);
    }
    process.exit(1);
  }

  console.log("Release notes are valid.");
}

main();
