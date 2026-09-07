import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { checkDecisions, initDecisions, preserveDecisions } from "./task-decisions.mjs";

const scripts = path.dirname(fileURLToPath(import.meta.url));
const name = "TASK-DECISIONS.local.md";
function git(root, ...args) { return execFileSync("git", ["-C", root, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim(); }
function fixture(t) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "freed-decisions-")));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const repo = path.join(root, "repo"); fs.mkdirSync(repo);
  git(repo, "init"); git(repo, "config", "user.name", "Fixture"); git(repo, "config", "user.email", "fixture@example.invalid");
  fs.writeFileSync(path.join(repo, ".gitignore"), name + "\n");
  git(repo, "add", ".gitignore"); git(repo, "commit", "-m", "chore: fixture");
  return { root, repo, base: git(repo, "rev-parse", "HEAD") };
}

test("initialization preserves existing decisions and required checks reject missing or empty logs", (t) => {
  const { repo } = fixture(t);
  assert.throws(() => checkDecisions(repo, { required: true }), /nonempty/);
  const file = initDecisions(repo);
  fs.writeFileSync(file, "Owner-facing trade-off: cache expires on restart.\n");
  initDecisions(repo);
  assert.match(checkDecisions(repo, { required: true }).toString(), /cache expires/);
  fs.writeFileSync(file, "\n");
  assert.throws(() => checkDecisions(repo, { required: true }), /nonempty/);
});

test("publication rejects staged and previously committed private logs without exposing content", (t) => {
  const { repo, base } = fixture(t);
  fs.writeFileSync(initDecisions(repo), "private sentinel never publish");
  git(repo, "add", "-f", name);
  assert.throws(() => checkDecisions(repo, { base }), /tracked or staged/);
  git(repo, "commit", "-m", "chore: bad fixture");
  git(repo, "rm", name); git(repo, "commit", "-m", "chore: deletion fixture");
  assert.throws(() => checkDecisions(repo, { base }), /Outgoing history/);
  const cli = spawnSync(process.execPath, [path.join(scripts, "task-decisions.mjs"), "check", "--worktree", repo, "--base", base], { encoding: "utf8" });
  assert.notEqual(cli.status, 0);
  assert.doesNotMatch(cli.stdout + cli.stderr, /private sentinel/);
});

test("logs must be ignored and may not redirect reads through symlinks", (t) => {
  const { repo, root } = fixture(t);
  const file = initDecisions(repo);
  fs.writeFileSync(path.join(repo, ".gitignore"), "");
  assert.throws(() => checkDecisions(repo), /Git-ignored/);
  fs.writeFileSync(path.join(repo, ".gitignore"), name + "\n");
  fs.unlinkSync(file); fs.writeFileSync(path.join(root, "private"), "secret");
  fs.symlinkSync(path.join(root, "private"), file);
  assert.throws(() => checkDecisions(repo));
});

test("preservation is private, verified, idempotent, outside the worktree, and rejects redirected archives", (t) => {
  const { root, repo } = fixture(t);
  fs.writeFileSync(initDecisions(repo), "A real choice and its consequence.\n");
  const archiveRoot = path.join(root, "archive");
  const file = preserveDecisions(repo, { archiveRoot });
  assert.equal(preserveDecisions(repo, { archiveRoot }), file);
  assert.equal(fs.statSync(file).mode & 0o077, 0);
  assert.equal(fs.statSync(archiveRoot).mode & 0o077, 0);
  assert.deepEqual(fs.readFileSync(file), fs.readFileSync(path.join(repo, name)));
  assert.throws(() => preserveDecisions(repo, { archiveRoot: path.join(repo, "archive") }), /outside/);
  fs.symlinkSync(archiveRoot, path.join(root, "redirect"));
  assert.throws(() => preserveDecisions(repo, { archiveRoot: path.join(root, "redirect") }), /symbolic/);
  fs.writeFileSync(file, "corrupted");
  assert.throws(() => preserveDecisions(repo, { archiveRoot }), /verification/);
});

test("scoped cleanup retains dirty or advanced heads and preserves decisions before removal", (t) => {
  const { root, repo } = fixture(t);
  const worktree = path.join(root, "task space");
  git(repo, "worktree", "add", "-b", "fix/fixture", worktree);
  const mergedHead = git(worktree, "rev-parse", "HEAD");
  const bin = path.join(root, "bin"); fs.mkdirSync(bin);
  fs.writeFileSync(path.join(bin, "gh"), '#!/bin/sh\nif [ "$2" = list ]; then echo 123; else echo "$MERGED_HEAD"; fi\n', { mode: 0o700 });
  const env = { ...process.env, HOME: path.join(root, "home"), PATH: bin + path.delimiter + process.env.PATH, NODE_BIN: process.execPath, MERGED_HEAD: mergedHead };
  const run = () => spawnSync("bash", [path.join(scripts, "worktree-cleanup.sh"), "--yes", "--worktree", worktree], { cwd: repo, env, encoding: "utf8" });
  fs.writeFileSync(initDecisions(worktree), "Keep this after cleanup.\n");
  fs.writeFileSync(path.join(worktree, "uncommitted"), "owner change");
  assert.match(run().stdout, /has changes/); assert.ok(fs.existsSync(worktree));
  git(worktree, "add", "uncommitted"); git(worktree, "commit", "-m", "chore: advanced");
  assert.match(run().stdout, /differs from the merged/); assert.ok(fs.existsSync(worktree));
  env.MERGED_HEAD = git(worktree, "rev-parse", "HEAD");
  const result = run();
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.equal(fs.existsSync(worktree), false);
  const archive = path.join(env.HOME, ".freed", "task-decisions");
  assert.equal(fs.readFileSync(path.join(archive, fs.readdirSync(archive)[0]), "utf8"), "Keep this after cleanup.\n");
  assert.ok(fs.existsSync(repo));
});
