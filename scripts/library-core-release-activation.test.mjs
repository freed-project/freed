import assert from "node:assert/strict";
import {
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import {
  createLibraryCoreReleaseActivation,
  inspectLibraryCoreActivationManifest,
} from "./lib/library-core-release-activation.mjs";
import {
  approvalCommentForArtifact,
  parseArgs,
  recordOwnerApproval,
  writeJsonAtomically,
} from "./library-core-release-activation.mjs";
import { releaseInspectionRange } from "./release-receipt.mjs";

const PRODUCT_SHA = "a".repeat(40);
const PULL_NUMBER = 1_205;
const COMMENT_ID = 9_001;
const COMMENT_URL = `https://github.com/freed-project/freed/pull/${PULL_NUMBER}#issuecomment-${COMMENT_ID}`;

function reviewRequiredArtifact() {
  const transition = {
    activationId: "migration-private-corpus-v1",
    gate: "C",
    kind: "migration_candidate_execution",
    rollbackTrigger:
      "The accepted checkpoint does not match the source frontier.",
    receiptExpectations: [
      "migration_receipt",
      "same_frontier_rollback_receipt",
    ],
  };
  const manifest = (transitions) =>
    `${JSON.stringify({ schemaVersion: 1, transitions }, null, 2)}\n`;
  const activation = createLibraryCoreReleaseActivation({
    range: releaseInspectionRange({
      channel: "dev",
      productCommitSha: PRODUCT_SHA,
    }),
    manifestInspection: inspectLibraryCoreActivationManifest({
      currentContents: manifest([transition]),
    }),
  });
  return {
    tag: "v26.7.2800-dev",
    version: "26.7.2800-dev",
    channel: "dev",
    dayKey: "26.7.28",
    approved: true,
    source: {
      channel: "dev",
      productCommitSha: PRODUCT_SHA,
      libraryCoreActivation: activation,
    },
    release: {
      deck: "Library Core release activation test.",
      features: [],
      fixes: [],
      followUps: [],
    },
  };
}

test("CLI arguments keep comment generation and approval recording explicit", () => {
  assert.deepEqual(
    parseArgs([
      "approval-comment",
      "--artifact=release-notes/releases/v26.7.2800-dev.json",
      "--pull=1205",
    ]),
    {
      action: "approval-comment",
      artifact: "release-notes/releases/v26.7.2800-dev.json",
      commentUrl: "",
      cwd: process.cwd(),
      help: false,
      pullNumber: 1_205,
    },
  );
  assert.throws(
    () =>
      parseArgs([
        "record-owner-approval",
        "--artifact=release-notes/releases/v26.7.2800-dev.json",
      ]),
    /--comment-url is required/,
  );
});

test("supported approval flow generates the exact comment and records only verified decision fields", () => {
  const artifact = reviewRequiredArtifact();
  const originalContents = `${JSON.stringify(artifact, null, 2)}\n`;
  const commentBody = approvalCommentForArtifact({
    artifact,
    pullNumber: PULL_NUMBER,
  });
  assert.match(
    commentBody,
    /freed-library-core-activation-approval/,
  );
  assert.match(commentBody, /I approve this exact Library Core release activation/);

  let write = null;
  const approved = recordOwnerApproval({
    artifact,
    artifactPath:
      "/fixture/release-notes/releases/v26.7.2800-dev.json",
    expectedArtifactContents: originalContents,
    ownerApprovalReference: COMMENT_URL,
    loadOwnerApprovalEvidence: () => ({
      pull: {
        number: PULL_NUMBER,
        state: "open",
        merged_at: null,
        base: {
          ref: "dev",
          sha: "a".repeat(40),
          repo: { full_name: "freed-project/freed" },
        },
        head: {
          sha: "b".repeat(40),
          repo: { full_name: "freed-project/freed" },
        },
      },
      comment: {
        id: COMMENT_ID,
        html_url: COMMENT_URL,
        issue_url:
          `https://api.github.com/repos/freed-project/freed/issues/${PULL_NUMBER}`,
        user: { login: "AubreyF", type: "User" },
        body: commentBody,
      },
      releaseArtifact: artifact,
    }),
    writeArtifact: (artifactPath, value, options) => {
      write = { artifactPath, options, value };
    },
  });

  assert.equal(
    approved.source.libraryCoreActivation.decision.state,
    "owner_approved",
  );
  assert.equal(
    approved.source.libraryCoreActivation.decision.ownerApprovalReference,
    COMMENT_URL,
  );
  assert.deepEqual(write, {
    artifactPath:
      "/fixture/release-notes/releases/v26.7.2800-dev.json",
    options: { expectedContents: originalContents },
    value: approved,
  });
  assert.equal(
    artifact.source.libraryCoreActivation.decision.state,
    "review_required",
  );
});

test("approval recording refuses to overwrite concurrent artifact edits", (t) => {
  const directory = mkdtempSync(
    path.join(tmpdir(), "freed-library-core-approval-"),
  );
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const artifactPath = path.join(directory, "v26.7.2800-dev.json");
  const artifact = reviewRequiredArtifact();
  const originalContents = `${JSON.stringify(artifact, null, 2)}\n`;
  writeFileSync(artifactPath, originalContents);
  writeFileSync(
    artifactPath,
    `${JSON.stringify({ ...artifact, release: { deck: "Concurrent edit." } }, null, 2)}\n`,
  );

  assert.throws(
    () =>
      writeJsonAtomically(
        artifactPath,
        { ...artifact, approved: true },
        { expectedContents: originalContents },
      ),
    /changed while owner approval was being verified/,
  );
  assert.match(readFileSync(artifactPath, "utf8"), /Concurrent edit/);
});

test("approval recording never removes another writer's lock", (t) => {
  const directory = mkdtempSync(
    path.join(tmpdir(), "freed-library-core-approval-lock-"),
  );
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const artifactPath = path.join(directory, "v26.7.2800-dev.json");
  const lockPath = `${artifactPath}.release-artifact-write.lock`;
  const artifact = reviewRequiredArtifact();
  const originalContents = `${JSON.stringify(artifact, null, 2)}\n`;
  writeFileSync(artifactPath, originalContents);
  writeFileSync(lockPath, "another writer\n");

  assert.throws(
    () =>
      writeJsonAtomically(
        artifactPath,
        { ...artifact, approved: true },
        { expectedContents: originalContents },
      ),
    /supported release artifact writer is active|cannot be locked/,
  );
  assert.equal(readFileSync(lockPath, "utf8"), "another writer\n");
  assert.equal(readFileSync(artifactPath, "utf8"), originalContents);
});
