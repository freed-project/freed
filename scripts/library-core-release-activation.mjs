#!/usr/bin/env node

import { randomUUID } from "node:crypto";
import {
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  buildOwnerApprovedLibraryCoreReleaseArtifact,
  libraryCoreOwnerApprovalCommentBody,
  withReleaseArtifactWriteLock,
} from "./lib/library-core-release-activation.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
export const REPO_ROOT = path.resolve(__dirname, "..");
const RELEASE_ARTIFACT_PATTERN =
  /^release-notes\/releases\/(v\d+\.\d+\.\d+(?:-dev)?)\.json$/;

function usage() {
  return `Usage:
  node scripts/library-core-release-activation.mjs approval-comment --artifact=<release-json> --pull=<number> [--cwd=<path>]
  node scripts/library-core-release-activation.mjs record-owner-approval --artifact=<release-json> --comment-url=<url> [--cwd=<path>]`;
}

export function parseArgs(argv) {
  const options = {
    action: argv[0] ?? "",
    artifact: "",
    commentUrl: "",
    cwd: REPO_ROOT,
    help: false,
    pullNumber: null,
  };
  for (const argument of argv.slice(1)) {
    if (argument === "--help" || argument === "-h") options.help = true;
    else if (argument.startsWith("--artifact="))
      options.artifact = argument.slice("--artifact=".length);
    else if (argument.startsWith("--comment-url="))
      options.commentUrl = argument.slice("--comment-url=".length);
    else if (argument.startsWith("--cwd="))
      options.cwd = path.resolve(argument.slice("--cwd=".length));
    else if (argument.startsWith("--pull="))
      options.pullNumber = Number(argument.slice("--pull=".length));
    else throw new Error(`Unsupported argument: ${argument}`);
  }
  if (options.help) return options;
  if (
    options.action !== "approval-comment" &&
    options.action !== "record-owner-approval"
  ) {
    throw new Error(`A supported action is required.\n\n${usage()}`);
  }
  if (!options.artifact) {
    throw new Error(`--artifact is required.\n\n${usage()}`);
  }
  if (
    options.action === "approval-comment" &&
    (!Number.isSafeInteger(options.pullNumber) || options.pullNumber <= 0)
  ) {
    throw new Error(`--pull must be a positive integer.\n\n${usage()}`);
  }
  if (
    options.action === "record-owner-approval" &&
    options.commentUrl.length === 0
  ) {
    throw new Error(`--comment-url is required.\n\n${usage()}`);
  }
  return options;
}

function resolveArtifactPath({ artifact, cwd }) {
  const normalized = artifact.replace(/\\/g, "/").replace(/^\.\//, "");
  const match = RELEASE_ARTIFACT_PATTERN.exec(normalized);
  if (!match) {
    throw new Error(
      "--artifact must be one canonical release-notes/releases/v<version>.json path.",
    );
  }
  return {
    absolutePath: path.join(cwd, ...normalized.split("/")),
    expectedTag: match[1],
  };
}

function readReleaseArtifact(options) {
  const { absolutePath, expectedTag } = resolveArtifactPath(options);
  let originalContents;
  let artifact;
  try {
    originalContents = readFileSync(absolutePath, "utf8");
    artifact = JSON.parse(originalContents);
  } catch (error) {
    throw new Error(
      `Release artifact could not be read: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
  if (artifact?.tag !== expectedTag) {
    throw new Error(
      `Release artifact tag is ${String(artifact?.tag)}, expected ${expectedTag}.`,
    );
  }
  return { absolutePath, artifact, originalContents };
}

export function approvalCommentForArtifact({
  artifact,
  pullNumber,
}) {
  const activation = artifact?.source?.libraryCoreActivation;
  return libraryCoreOwnerApprovalCommentBody({
    value: activation,
    expectedRange: activation?.range,
    expectedManifestInspection: {
      manifest: activation?.manifest,
      transitions: activation?.transitions,
    },
    releaseArtifact: artifact,
    pullNumber,
  });
}

export function writeJsonAtomically(
  filePath,
  value,
  { expectedContents } = {},
) {
  if (typeof expectedContents !== "string") {
    throw new Error(
      "Library Core approval recording requires the exact original artifact bytes.",
    );
  }
  const temporaryPath = `${filePath}.library-core-${process.pid}-${randomUUID()}.tmp`;
  try {
    return withReleaseArtifactWriteLock(filePath, () => {
      if (readFileSync(filePath, "utf8") !== expectedContents) {
        throw new Error(
          "Library Core release artifact changed while owner approval was being verified.",
        );
      }
      const serialized = `${JSON.stringify(value, null, 2)}\n`;
      writeFileSync(temporaryPath, serialized, {
        encoding: "utf8",
        flag: "wx",
        mode: 0o644,
      });
      if (readFileSync(filePath, "utf8") !== expectedContents) {
        throw new Error(
          "Library Core release artifact changed before owner approval could be recorded.",
        );
      }
      renameSync(temporaryPath, filePath);
      if (readFileSync(filePath, "utf8") !== serialized) {
        throw new Error(
          "Library Core owner approval write could not be verified.",
        );
      }
    });
  } finally {
    rmSync(temporaryPath, { force: true });
  }
}

export function recordOwnerApproval({
  artifact,
  artifactPath,
  expectedArtifactContents,
  ownerApprovalReference,
  loadOwnerApprovalEvidence,
  writeArtifact = writeJsonAtomically,
}) {
  const approvedArtifact = buildOwnerApprovedLibraryCoreReleaseArtifact({
    artifact,
    ownerApprovalReference,
    loadOwnerApprovalEvidence,
  });
  writeArtifact(artifactPath, approvedArtifact, {
    expectedContents: expectedArtifactContents,
  });
  return approvedArtifact;
}

export function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  if (options.help) {
    process.stdout.write(`${usage()}\n`);
    return;
  }
  const { absolutePath, artifact, originalContents } =
    readReleaseArtifact(options);
  if (options.action === "approval-comment") {
    process.stdout.write(
      `${approvalCommentForArtifact({
        artifact,
        pullNumber: options.pullNumber,
      })}\n`,
    );
    return;
  }
  recordOwnerApproval({
    artifact,
    artifactPath: absolutePath,
    expectedArtifactContents: originalContents,
    ownerApprovalReference: options.commentUrl,
  });
  process.stdout.write(
    `Recorded authenticated Library Core owner approval in ${path.relative(
      options.cwd,
      absolutePath,
    )}.\n`,
  );
}

const invokedAsScript = process.argv[1]
  ? import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
  : false;

if (invokedAsScript) {
  try {
    main();
  } catch (error) {
    process.stderr.write(
      `${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exitCode = 1;
  }
}
