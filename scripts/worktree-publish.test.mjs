import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
const scripts = path.dirname(fileURLToPath(import.meta.url));
function git(cwd, ...args) { return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim(); }

test("website publication requires private decisions and pushes only the verified committed head", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "freed-www-publish-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const repo = path.join(root, "repo"); fs.mkdirSync(repo);
  const origin = path.join(root, "origin.git"); git(root, "init", "--bare", origin);
  git(repo, "init"); git(repo, "config", "user.name", "Fixture"); git(repo, "config", "user.email", "fixture@example.invalid");
  fs.writeFileSync(path.join(repo, ".gitignore"), "TASK-DECISIONS.local.md\n");
  git(repo, "add", ".gitignore"); git(repo, "commit", "-m", "chore: fixture"); git(repo, "branch", "-M", "www");
  git(repo, "remote", "add", "origin", origin); git(repo, "push", "origin", "www"); git(repo, "checkout", "-b", "chore/fixture");
  fs.writeFileSync(path.join(repo, "change"), "intended"); git(repo, "add", "change"); git(repo, "commit", "-m", "chore: intended");
  const head = git(repo, "rev-parse", "HEAD");
  const body = path.join(root, "body.md"); fs.writeFileSync(body, "(AI Generated).\n\nSynthetic description.\n");
  const bin = path.join(root, "bin"); fs.mkdirSync(bin);
  const calls = path.join(root, "calls");
  fs.writeFileSync(path.join(bin, "gh"), '#!/bin/sh\nprintf "%s\\n" "$*" >> "$GH_CALLS"\nif [ "$1" = repo ]; then echo freed-project/freed; fi\n', { mode: 0o700 });
  const run = () => spawnSync("bash", [path.join(scripts, "worktree-publish.sh"), "--title", "chore: fixture", "--body-file", body, "--ready"], { cwd: repo, encoding: "utf8", env: { ...process.env, NODE_BIN: process.execPath, GH_CALLS: calls, PATH: bin + path.delimiter + process.env.PATH } });
  const missing = run(); assert.notEqual(missing.status, 0); assert.match(missing.stderr, /nonempty/); assert.equal(fs.existsSync(calls), false);
  fs.writeFileSync(path.join(repo, "TASK-DECISIONS.local.md"), "private decision sentinel");
  git(repo, "add", "-f", "TASK-DECISIONS.local.md");
  const staged = run(); assert.notEqual(staged.status, 0); assert.match(staged.stderr, /tracked or staged/); assert.equal(fs.existsSync(calls), false);
  git(repo, "rm", "--cached", "TASK-DECISIONS.local.md");
  const result = run(); assert.equal(result.status, 0, result.stderr);
  assert.equal(git(root, "--git-dir", origin, "rev-parse", "refs/heads/chore/fixture"), head);
  assert.match(fs.readFileSync(calls, "utf8"), /pr create --base www --head chore\/fixture/);
  assert.doesNotMatch(result.stdout + result.stderr + fs.readFileSync(calls, "utf8"), /private decision sentinel/);
});
