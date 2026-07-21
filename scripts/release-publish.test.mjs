import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const scriptsDir = path.dirname(fileURLToPath(import.meta.url));
const releasePublish = path.join(scriptsDir, "release-publish.sh");
const version = "26.7.2000-dev";
const tag = `v${version}`;
const gitEnvironment = {
  ...process.env,
  GIT_AUTHOR_EMAIL: "release-test@freed.wtf",
  GIT_AUTHOR_NAME: "Freed Release Test",
  GIT_COMMITTER_EMAIL: "release-test@freed.wtf",
  GIT_COMMITTER_NAME: "Freed Release Test",
};

function git(cwd, args, options = {}) {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    env: gitEnvironment,
    stdio: ["pipe", "pipe", "pipe"],
    ...options,
  }).trim();
}

function createTagObject(worktree, targetCommit, message) {
  const payload = [
    `object ${targetCommit}`,
    "type commit",
    `tag ${tag}`,
    "tagger Freed Release Test <release-test@freed.wtf> 1784520000 -0700",
    "",
    message,
    "",
  ].join("\n");
  return git(worktree, ["mktag"], { input: payload });
}

function pushObjectToRemoteTag(worktree, objectSha) {
  const temporaryRef = `refs/release-publish-test/${objectSha}`;
  git(worktree, ["update-ref", temporaryRef, objectSha]);
  try {
    git(worktree, [
      "push",
      "origin",
      `${temporaryRef}:refs/tags/${tag}`,
    ]);
  } finally {
    git(worktree, ["update-ref", "-d", temporaryRef]);
  }
}

function remoteTagObjectSha(worktree) {
  const output = git(worktree, [
    "ls-remote",
    "origin",
    `refs/tags/${tag}`,
  ]);
  return output ? output.split(/\s+/)[0] : null;
}

function advanceProtectedBranch(harness) {
  const tree = git(harness.worktree, ["rev-parse", "HEAD^{tree}"]);
  const nextCommit = git(
    harness.worktree,
    ["commit-tree", tree, "-p", harness.commit, "-m", "advance dev"],
  );
  git(harness.worktree, [
    "push",
    "origin",
    `${nextCommit}:refs/heads/dev`,
  ]);
  return nextCommit;
}

const publisherStub = String.raw`
import { execFileSync } from "node:child_process";

function git(args, options = {}) {
  return execFileSync("git", args, {
    cwd: process.cwd(),
    encoding: "utf8",
    ...options,
  }).trim();
}

function option(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function fail(message) {
  process.stderr.write(message + "\n");
  process.exit(1);
}

function emit(tagObjectSha, recovered) {
  const resultSha = process.env.PUBLISHER_RESULT_SHA || tagObjectSha;
  process.stdout.write(JSON.stringify({
    schemaVersion: 1,
    purpose: "freed-release-tag-publish-result",
    repo: option("--repo"),
    tag: option("--tag"),
    commit: option("--commit"),
    tagObjectSha: resultSha,
    recovered,
  }) + "\n");
}

function remoteTagObjectSha(tag) {
  const output = git(["ls-remote", "origin", "refs/tags/" + tag]);
  if (!output) return null;
  return output.split(/\s+/)[0];
}

function exactExistingTag(tag, commit, tagObjectSha) {
  git(["fetch", "--no-tags", "origin", "refs/tags/" + tag]);
  if (git(["rev-parse", "FETCH_HEAD"]) !== tagObjectSha) return false;
  if (git(["cat-file", "-t", "FETCH_HEAD"]) !== "tag") return false;
  if (git(["rev-parse", "FETCH_HEAD^{}"]) !== commit) return false;
  const raw = git(["cat-file", "tag", "FETCH_HEAD"]);
  const separator = raw.indexOf("\n\n");
  if (separator < 0) return false;
  const headers = new Map();
  for (const line of raw.slice(0, separator).split("\n")) {
    const space = line.indexOf(" ");
    if (space > 0) headers.set(line.slice(0, space), line.slice(space + 1));
  }
  return headers.get("object") === commit &&
    headers.get("type") === "commit" &&
    headers.get("tag") === tag &&
    raw.slice(separator + 2) === "Freed release " + tag;
}

function createExactTag(tag, commit) {
  const payload = [
    "object " + commit,
    "type commit",
    "tag " + tag,
    "tagger Freed Release Publisher <release@freed.wtf> 1784520000 -0700",
    "",
    "Freed release " + tag,
    "",
  ].join("\n");
  const tagObjectSha = git(["mktag"], { input: payload });
  const temporaryRef = "refs/publisher-stub/" + tagObjectSha;
  git(["update-ref", temporaryRef, tagObjectSha]);
  try {
    git(["push", "origin", temporaryRef + ":refs/tags/" + tag]);
  } finally {
    git(["update-ref", "-d", temporaryRef]);
  }
  return tagObjectSha;
}

if (process.env.PUBLISHER_SCENARIO === "malformed-output") {
  process.stdout.write('{"schemaVersion":1,"unexpected":true}\n');
  process.exit(0);
}

const requestedTag = option("--tag");
const requestedCommit = option("--commit");
const requestedBranch = option("--branch");
const existingTagObjectSha = remoteTagObjectSha(requestedTag);
if (existingTagObjectSha) {
  if (
    process.env.PUBLISHER_ALLOW_INEXACT !== "1" &&
    !exactExistingTag(requestedTag, requestedCommit, existingTagObjectSha)
  ) {
    fail("publisher rejected an inexact existing release tag");
  }
  emit(existingTagObjectSha, true);
  process.exit(0);
}

const remoteBranchLine = git([
  "ls-remote",
  "origin",
  "refs/heads/" + requestedBranch,
]);
const remoteBranchCommit = remoteBranchLine
  ? remoteBranchLine.split(/\s+/)[0]
  : "";
if (remoteBranchCommit !== requestedCommit) {
  fail("publisher rejected a stale protected branch for fresh creation");
}

const tagObjectSha = createExactTag(requestedTag, requestedCommit);
if (process.env.PUBLISHER_SCENARIO === "ref-response-loss") {
  fail("simulated ref response loss after commit");
}
if (process.env.PUBLISHER_SCENARIO === "revoke-response-loss") {
  fail("simulated token revocation response loss after commit");
}
emit(tagObjectSha, false);
`;

function createHarness(t) {
  const root = mkdtempSync(path.join(os.tmpdir(), "freed-release-publish-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const origin = path.join(root, "origin.git");
  const worktree = path.join(root, "worktree");
  mkdirSync(worktree);
  git(root, ["init", "--bare", origin]);
  git(worktree, ["init"]);
  git(worktree, ["checkout", "-b", "dev"]);
  git(worktree, ["config", "user.name", "Freed Release Test"]);
  git(worktree, ["config", "user.email", "release-test@freed.wtf"]);
  mkdirSync(path.join(worktree, "scripts"));
  mkdirSync(path.join(worktree, "release-notes", "releases"), {
    recursive: true,
  });
  for (const scriptName of [
    "validate-release-identity.mjs",
    "validate-release-tag-authority.mjs",
    "validate-release-notes.mjs",
  ]) {
    writeFileSync(path.join(worktree, "scripts", scriptName), "process.exit(0);\n");
  }
  writeFileSync(
    path.join(worktree, "scripts", "release-tag-publisher.mjs"),
    publisherStub,
  );
  writeFileSync(
    path.join(worktree, "release-notes", "releases", `${tag}.json`),
    `${JSON.stringify({ approved: true, tag, source: {} }, null, 2)}\n`,
  );
  git(worktree, ["add", "."]);
  git(worktree, ["commit", "-m", "test release candidate"]);
  const commit = git(worktree, ["rev-parse", "HEAD"]);
  git(worktree, ["remote", "add", "origin", origin]);
  git(worktree, ["push", "origin", "HEAD:refs/heads/dev"]);
  git(worktree, ["push", "origin", "HEAD:refs/heads/main"]);
  return { root, origin, worktree, commit };
}

function runPublish(harness, extraEnvironment = {}) {
  const result = spawnSync("/bin/bash", [releasePublish, version], {
    cwd: harness.worktree,
    encoding: "utf8",
    env: {
      ...process.env,
      NODE_BIN: process.execPath,
      ...extraEnvironment,
    },
    timeout: 30_000,
  });
  assert.equal(result.signal, null, result.error?.message);
  return result;
}

test("release wrapper recovers ref response loss and repeats exact recovery", (t) => {
  const harness = createHarness(t);
  const first = runPublish(harness, {
    PUBLISHER_SCENARIO: "ref-response-loss",
  });
  assert.notEqual(first.status, 0);
  assert.match(first.stderr, /simulated ref response loss after commit/);
  assert.match(remoteTagObjectSha(harness.worktree), /^[0-9a-f]{40}$/);
  assert.equal(git(harness.worktree, ["tag", "--list", tag]), "");

  const retry = runPublish(harness, {
    PUBLISHER_SCENARIO: "ref-response-loss",
  });
  assert.equal(retry.status, 0, retry.stderr);
  assert.match(retry.stdout, /Recovered and verified immutable tag/);
  const recoveredTagObjectSha = git(harness.worktree, [
    "rev-parse",
    `refs/tags/${tag}`,
  ]);
  assert.equal(recoveredTagObjectSha, remoteTagObjectSha(harness.worktree));

  const repeated = runPublish(harness, {
    PUBLISHER_SCENARIO: "ref-response-loss",
  });
  assert.equal(repeated.status, 0, repeated.stderr);
  assert.match(repeated.stdout, /Recovered and verified immutable tag/);
});

test("release wrapper recovers token revocation response loss", (t) => {
  const harness = createHarness(t);
  const first = runPublish(harness, {
    PUBLISHER_SCENARIO: "revoke-response-loss",
  });
  assert.notEqual(first.status, 0);
  assert.match(first.stderr, /token revocation response loss/);

  const retry = runPublish(harness, {
    PUBLISHER_SCENARIO: "revoke-response-loss",
  });
  assert.equal(retry.status, 0, retry.stderr);
  assert.match(retry.stdout, /Recovered and verified immutable tag/);
});

test("release wrapper recovers after the protected branch advances", (t) => {
  const harness = createHarness(t);
  const first = runPublish(harness, {
    PUBLISHER_SCENARIO: "ref-response-loss",
  });
  assert.notEqual(first.status, 0);
  const advancedCommit = advanceProtectedBranch(harness);
  assert.notEqual(advancedCommit, harness.commit);

  const retry = runPublish(harness, {
    PUBLISHER_SCENARIO: "ref-response-loss",
  });
  assert.equal(retry.status, 0, retry.stderr);
  assert.match(retry.stdout, /Recovered and verified immutable tag/);
  assert.equal(
    git(harness.worktree, ["rev-parse", `refs/tags/${tag}^{}`]),
    harness.commit,
  );
});

test("release wrapper leaves fresh creation safety to the native publisher", (t) => {
  const harness = createHarness(t);
  advanceProtectedBranch(harness);
  const result = runPublish(harness);
  assert.notEqual(result.status, 0);
  assert.match(
    result.stderr,
    /publisher rejected a stale protected branch for fresh creation/,
  );
  assert.equal(remoteTagObjectSha(harness.worktree), null);
});

test("release wrapper rejects wrong existing annotations, types, and targets", async (t) => {
  await t.test("wrong message", (nested) => {
    const harness = createHarness(nested);
    const wrong = createTagObject(
      harness.worktree,
      harness.commit,
      "Unexpected release annotation",
    );
    pushObjectToRemoteTag(harness.worktree, wrong);
    const result = runPublish(harness, { PUBLISHER_ALLOW_INEXACT: "1" });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /not the exact approved annotation/);
  });

  await t.test("lightweight object", (nested) => {
    const harness = createHarness(nested);
    pushObjectToRemoteTag(harness.worktree, harness.commit);
    const result = runPublish(harness, { PUBLISHER_ALLOW_INEXACT: "1" });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /non-annotated remote tag/);
  });

  await t.test("wrong target commit", (nested) => {
    const harness = createHarness(nested);
    const tree = git(harness.worktree, ["rev-parse", "HEAD^{tree}"]);
    const wrongCommit = git(harness.worktree, [
      "commit-tree",
      tree,
      "-p",
      harness.commit,
      "-m",
      "wrong release target",
    ]);
    const wrong = createTagObject(
      harness.worktree,
      wrongCommit,
      `Freed release ${tag}`,
    );
    pushObjectToRemoteTag(harness.worktree, wrong);
    const result = runPublish(harness, { PUBLISHER_ALLOW_INEXACT: "1" });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /at the wrong commit/);
  });

  await t.test("wrong returned object", (nested) => {
    const harness = createHarness(nested);
    const exact = createTagObject(
      harness.worktree,
      harness.commit,
      `Freed release ${tag}`,
    );
    pushObjectToRemoteTag(harness.worktree, exact);
    const result = runPublish(harness, {
      PUBLISHER_RESULT_SHA: "f".repeat(40),
    });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /does not match the publisher result object/);
  });
});

test("release wrapper fails closed on a conflicting local tag", (t) => {
  const harness = createHarness(t);
  const exact = createTagObject(
    harness.worktree,
    harness.commit,
    `Freed release ${tag}`,
  );
  pushObjectToRemoteTag(harness.worktree, exact);
  const conflict = createTagObject(
    harness.worktree,
    harness.commit,
    "Conflicting local annotation",
  );
  git(harness.worktree, ["update-ref", `refs/tags/${tag}`, conflict]);

  const result = runPublish(harness);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /local tag .* conflicts/);
  assert.equal(
    git(harness.worktree, ["rev-parse", `refs/tags/${tag}`]),
    conflict,
  );
  assert.equal(remoteTagObjectSha(harness.worktree), exact);
});

test("release wrapper rejects malformed publisher output", (t) => {
  const harness = createHarness(t);
  const result = runPublish(harness, {
    PUBLISHER_SCENARIO: "malformed-output",
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /release publisher returned an inexact result/);
  assert.equal(remoteTagObjectSha(harness.worktree), null);
});
