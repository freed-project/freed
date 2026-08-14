import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { readGitPathAtRef } from "./git-path-at-ref.mjs";

function git(cwd, args) {
  return execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
}

function makeRepo() {
  const cwd = mkdtempSync(path.join(tmpdir(), "freed-git-path-at-ref-"));
  git(cwd, ["init", "-b", "dev"]);
  git(cwd, ["config", "user.name", "Freed Test"]);
  git(cwd, ["config", "user.email", "test@freed.invalid"]);
  writeFileSync(path.join(cwd, "README.md"), "baseline\n");
  git(cwd, ["add", "."]);
  git(cwd, ["commit", "-m", "chore: baseline"]);
  const beforeIntroduction = git(cwd, ["rev-parse", "HEAD"]);

  mkdirSync(path.join(cwd, "docs"), { recursive: true });
  writeFileSync(path.join(cwd, "docs", "manifest.json"), '{"value":1}\n');
  git(cwd, ["add", "."]);
  git(cwd, ["commit", "-m", "docs: add manifest"]);
  return {
    cwd,
    beforeIntroduction,
    current: git(cwd, ["rev-parse", "HEAD"]),
  };
}

test("Git path reader distinguishes proven absence from present contents", (t) => {
  const fixture = makeRepo();
  t.after(() => rmSync(fixture.cwd, { recursive: true, force: true }));

  assert.deepEqual(
    readGitPathAtRef({
      cwd: fixture.cwd,
      ref: fixture.beforeIntroduction,
      filePath: "docs/manifest.json",
    }),
    {
      state: "absent",
      commitSha: fixture.beforeIntroduction,
      filePath: "docs/manifest.json",
    },
  );

  const present = readGitPathAtRef({
    cwd: fixture.cwd,
    ref: fixture.current,
    filePath: "docs/manifest.json",
  });
  assert.equal(present.state, "present");
  assert.equal(present.contents, '{"value":1}\n');
});

test("Git path reader rejects an invalid ref and a non-blob path", (t) => {
  const fixture = makeRepo();
  t.after(() => rmSync(fixture.cwd, { recursive: true, force: true }));

  assert.throws(
    () =>
      readGitPathAtRef({
        cwd: fixture.cwd,
        ref: "missing-ref",
        filePath: "docs/manifest.json",
      }),
    /Could not resolve Git ref missing-ref/,
  );
  assert.throws(
    () =>
      readGitPathAtRef({
        cwd: fixture.cwd,
        ref: fixture.current,
        filePath: "docs",
      }),
    /is tree, expected blob/,
  );
});

test("Git path reader fails closed on tree and object read failures", () => {
  const commitSha = "a".repeat(40);
  const objectId = "b".repeat(40);
  const treeEntry = `100644 blob ${objectId}\tdocs/manifest.json\0`;

  for (const [label, failureAt] of [
    ["tree permission", "ls-tree"],
    ["missing object", "cat-file"],
  ]) {
    const spawn = (_command, args) => {
      if (args[0] === "rev-parse") {
        return { status: 0, stdout: `${commitSha}\n`, stderr: "" };
      }
      if (args[0] === "ls-tree") {
        return failureAt === "ls-tree"
          ? { status: 1, stdout: "", stderr: "permission denied" }
          : { status: 0, stdout: treeEntry, stderr: "" };
      }
      return { status: 1, stdout: "", stderr: "missing object" };
    };

    assert.throws(
      () =>
        readGitPathAtRef({
          cwd: "/fixture",
          ref: "HEAD",
          filePath: "docs/manifest.json",
          spawn,
        }),
      failureAt === "ls-tree"
        ? /Could not inspect .*permission denied/
        : /Could not read .*missing object/,
      label,
    );
  }
});
