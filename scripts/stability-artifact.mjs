#!/usr/bin/env node

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  DEFAULT_STABILITY_ARTIFACT_ROOT,
  validateStabilityArtifact,
  writeStabilityArtifact,
} from "./lib/stability-artifacts.mjs";

const __filename = fileURLToPath(import.meta.url);

function usage() {
  return `Usage:
  node scripts/stability-artifact.mjs validate --input <manifest.json> [--kind <kind>]
  node scripts/stability-artifact.mjs write --input <manifest.json> [--artifact-root <path>]

The default artifact root is ${DEFAULT_STABILITY_ARTIFACT_ROOT}.
`;
}

export function parseArgs(argv) {
  const args = {
    command: argv[0] ?? "",
    input: "",
    kind: "",
    artifactRoot: "",
    help: false,
  };
  for (let index = 1; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--help" || arg === "-h") args.help = true;
    else if (arg === "--input") args.input = argv[++index] ?? "";
    else if (arg === "--kind") args.kind = argv[++index] ?? "";
    else if (arg === "--artifact-root") args.artifactRoot = argv[++index] ?? "";
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return args;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || !args.command) {
    process.stdout.write(usage());
    return;
  }
  if (!args.input) throw new Error("--input is required.");
  const inputPath = path.resolve(args.input);
  const artifact = JSON.parse(readFileSync(inputPath, "utf8"));
  if (args.command === "validate") {
    validateStabilityArtifact(artifact, { expectedKind: args.kind || null });
    process.stdout.write(
      `Validated ${artifact.kind} artifact for ${artifact.taskId}.\n`,
    );
    return;
  }
  if (args.command === "write") {
    const result = writeStabilityArtifact(artifact, {
      artifactRoot: args.artifactRoot
        ? path.resolve(args.artifactRoot)
        : undefined,
    });
    process.stdout.write(
      `${result.created ? "Wrote" : "Reused"} ${result.path}.\n`,
    );
    return;
  }
  throw new Error(`Unknown command: ${args.command}`);
}

if (process.argv[1] === __filename) {
  try {
    main();
  } catch (error) {
    process.stderr.write(
      `${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exitCode = 1;
  }
}
