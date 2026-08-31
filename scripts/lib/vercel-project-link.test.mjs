import assert from "node:assert/strict";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  resolveVercelProjectName,
  stageExistingVercelProjectLink,
} from "./vercel-project-link.mjs";

function withTempDirectory(run) {
  const directory = mkdtempSync(path.join(os.tmpdir(), "freed-vercel-link-"));
  try {
    return run(directory);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

test("deployment targets resolve to the approved Vercel projects", () => {
  assert.equal(resolveVercelProjectName("website"), "freed-www");
  assert.equal(resolveVercelProjectName("pwa"), "freed-pwa");
  assert.throws(
    () => resolveVercelProjectName("unknown"),
    /Unknown Vercel deployment target/,
  );
});

test("clean worktrees leave staging ready for explicit project bootstrap", () => {
  withTempDirectory((directory) => {
    const targetPath = path.join(directory, "staged", ".vercel", "project.json");
    assert.equal(
      stageExistingVercelProjectLink({
        sourcePath: path.join(directory, "missing", "project.json"),
        targetPath,
      }),
      false,
    );
    assert.throws(() => readFileSync(targetPath, "utf8"), /ENOENT/);
  });
});

test("linked worktrees preserve their exact project identity", () => {
  withTempDirectory((directory) => {
    const sourcePath = path.join(directory, "source", "project.json");
    const targetPath = path.join(directory, "staged", ".vercel", "project.json");
    const identity = JSON.stringify({
      projectId: "prj_test",
      orgId: "team_test",
      projectName: "freed-pwa",
    });
    mkdirSync(path.dirname(sourcePath), { recursive: true });
    writeFileSync(sourcePath, identity);
    assert.equal(
      stageExistingVercelProjectLink({ sourcePath, targetPath }),
      true,
    );
    assert.equal(readFileSync(targetPath, "utf8"), identity);
  });
});
