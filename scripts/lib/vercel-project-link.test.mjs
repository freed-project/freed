import assert from "node:assert/strict";
import {
  copyFileSync,
  existsSync,
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import { execFileSync, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
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


test("transfer preview uses clean committed source and refuses missing OAuth configuration", () => {
  withTempDirectory((directory) => {
    const repo = path.join(directory, "repo");
    const bin = path.join(directory, "bin");
    const log = path.join(directory, "calls.jsonl");
    mkdirSync(path.join(repo, "scripts/lib"), { recursive: true });
    mkdirSync(path.join(repo, "packages/pwa"), { recursive: true });
    mkdirSync(bin);
    const sourceRoot = fileURLToPath(new URL("../..", import.meta.url));
    for (const file of ["scripts/vercel-deploy-preview.sh", "scripts/lib/node-tooling.sh",
      "scripts/lib/worktree-runtime.sh", "scripts/lib/vercel-project-link.mjs"]) {
      copyFileSync(path.join(sourceRoot, file), path.join(repo, file));
    }
    writeFileSync(path.join(repo, "packages/pwa/vercel.json"), JSON.stringify({
      buildCommand: "npm run build", outputDirectory: "dist", ignoreCommand: "obsolete",
    }));
    writeFileSync(path.join(repo, ".gitignore"), ".env.local\nTASK-DECISIONS.local.md\n");
    writeFileSync(path.join(repo, ".env.local"), "PRIVATE_SHOULD_NOT_UPLOAD=yes");
    writeFileSync(path.join(repo, "TASK-DECISIONS.local.md"), "private owner notes");
    const git = (...args) => execFileSync("git", args, { cwd: repo, stdio: "pipe" }).toString().trim();
    git("init", "-b", "feat/fixture");
    git("add", ".");
    git("-c", "user.name=Fixture", "-c", "user.email=fixture@example.test", "commit", "-m", "fixture");
    const sha = git("rev-parse", "HEAD");
    // Tool shims retain the real Node parser; no network or project registry exists.
    writeFileSync(path.join(bin, "node"), `#!/bin/sh\nexec '${process.execPath}' "$@"\n`);
    writeFileSync(path.join(bin, "npm"), "#!/bin/sh\nexit 0\n");
    writeFileSync(path.join(bin, "npx"), `#!${process.execPath}
const fs = require("node:fs"), path = require("node:path");
const args = process.argv.slice(2), command = args[1];
const cwd = args[args.indexOf("--cwd") + 1];
if (args[args.indexOf("--scope") + 1] !== "aubreyfs-projects" || args.includes("--prod")) process.exit(91);
if (command === "pull") {
  fs.mkdirSync(path.join(cwd, ".vercel"), { recursive: true });
  fs.writeFileSync(path.join(cwd, ".vercel/.env.preview.local"), process.env.FIXTURE_OAUTH || "");
}
const config = JSON.parse(fs.readFileSync(path.join(cwd, "vercel.json")));
fs.appendFileSync(process.env.FIXTURE_LOG, JSON.stringify({ command, args,
  sha: process.env.FREED_BUILD_COMMIT_SHA, kind: process.env.FREED_BUILD_KIND,
  config, privateFiles: [".env.local", "TASK-DECISIONS.local.md"].some(p => fs.existsSync(path.join(cwd, p))) }) + "\\n");
if (command === "deploy") console.log("https://fixture-aubreyfs-projects.vercel.app");
`);
    for (const file of ["node", "npm", "npx"]) chmodSync(path.join(bin, file), 0o755);
    const run = (oauth) => spawnSync("bash", ["scripts/vercel-deploy-preview.sh", "pwa-transfer-acceptance"], {
      cwd: repo, encoding: "utf8", env: { ...process.env, NODE_BIN: path.join(bin, "node"),
        FIXTURE_LOG: log, FIXTURE_OAUTH: oauth, VERCEL_TOKEN: "" },
    });
    const valid = run("VITE_GDRIVE_CLIENT_ID=fixture-client\nGDRIVE_CLIENT_SECRET=fixture-secret\n");
    assert.equal(valid.status, 0, valid.stdout + valid.stderr);
    const calls = readFileSync(log, "utf8").trim().split("\n").map(JSON.parse);
    assert.deepEqual(calls.map(c => c.command), ["pull", "build", "deploy"]);
    for (const call of calls) {
      assert.equal(call.sha, sha);
      assert.equal(call.kind, "preview");
      assert.equal(call.privateFiles, false);
      assert.match(call.config.buildCommand, /build:transfer-acceptance$/);
      assert.ok(call.config.buildCommand.includes(`FREED_BUILD_COMMIT_SHA=${sha}`));
      assert.equal(call.config.ignoreCommand, undefined);
    }
    assert.doesNotMatch(valid.stdout + valid.stderr, /fixture-secret/);
    rmSync(log);
    const missing = run("VITE_GDRIVE_CLIENT_ID=fixture-client\n");
    assert.notEqual(missing.status, 0);
    assert.match(missing.stderr, /matching server credentials/);
    assert.deepEqual(readFileSync(log, "utf8").trim().split("\n").map(JSON.parse).map(c => c.command), ["pull"]);
    rmSync(log);
    writeFileSync(path.join(repo, "untracked.txt"), "unreviewed");
    const dirty = run("");
    assert.notEqual(dirty.status, 0);
    assert.match(dirty.stderr, /clean committed source/);
    assert.equal(existsSync(log), false);
  });
});
