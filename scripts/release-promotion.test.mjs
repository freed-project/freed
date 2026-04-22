import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { listPromotionDiffFiles } from "./release-promotion-shared.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const VALIDATE_RELEASE_PROMOTION = path.join(__dirname, "validate-release-promotion.mjs");
const VALIDATE_MAIN_PR = path.join(__dirname, "validate-main-pr.mjs");

function git(cwd, args) {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
  }).trim();
}

function writeRepoFile(cwd, relativePath, contents) {
  const filePath = path.join(cwd, relativePath);
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, contents);
}

function commitAll(cwd, message) {
  git(cwd, ["add", "."]);
  git(cwd, ["commit", "-m", message]);
}

function updateOriginRef(cwd, branchName, refName = branchName) {
  const sha = git(cwd, ["rev-parse", refName]);
  git(cwd, ["update-ref", `refs/remotes/origin/${branchName}`, sha]);
}

function makeTempRepo() {
  const cwd = mkdtempSync(path.join(tmpdir(), "freed-release-promotion-"));
  git(cwd, ["init", "-b", "main"]);
  git(cwd, ["config", "user.name", "Codex Test"]);
  git(cwd, ["config", "user.email", "codex@example.com"]);

  writeRepoFile(cwd, "packages/pwa/src/app.ts", "export const value = 'main';\n");
  writeRepoFile(cwd, "packages/pwa/package.json", "{\n  \"name\": \"@freed/pwa\",\n  \"version\": \"0.0.0\"\n}\n");
  writeRepoFile(cwd, "packages/desktop/package.json", "{\n  \"name\": \"@freed/desktop\",\n  \"version\": \"0.0.0\"\n}\n");
  writeRepoFile(cwd, "packages/desktop/src-tauri/Cargo.toml", "[package]\nname = \"freed\"\nversion = \"0.0.0\"\n");
  writeRepoFile(cwd, "packages/desktop/src-tauri/tauri.conf.json", "{\n  \"version\": \"0.0.0\"\n}\n");
  writeRepoFile(cwd, "scripts/release.sh", "#!/usr/bin/env bash\n");
  writeRepoFile(cwd, "docs/PHASE-1-FOUNDATION.md", "# Phase 1\n");
  writeRepoFile(cwd, "release-notes/releases/v0.0.0.json", "{\n  \"approved\": true\n}\n");
  commitAll(cwd, "initial");

  git(cwd, ["branch", "dev"]);
  updateOriginRef(cwd, "main");
  updateOriginRef(cwd, "dev");
  return cwd;
}

function runNode(scriptPath, args) {
  return spawnSync(process.execPath, [scriptPath, ...args], {
    encoding: "utf8",
  });
}

test("listPromotionDiffFiles ignores release-only metadata drift", (t) => {
  const cwd = makeTempRepo();
  t.after(() => rmSync(cwd, { recursive: true, force: true }));

  git(cwd, ["checkout", "dev"]);
  writeRepoFile(cwd, "packages/pwa/src/app.ts", "export const value = 'dev';\n");
  writeRepoFile(cwd, "packages/pwa/package.json", "{\n  \"name\": \"@freed/pwa\",\n  \"version\": \"26.4.2100\"\n}\n");
  writeRepoFile(cwd, "release-notes/releases/v26.4.2100.json", "{\n  \"approved\": true\n}\n");
  commitAll(cwd, "dev change");

  const files = listPromotionDiffFiles({
    fromRef: "dev",
    toRef: "main",
    cwd,
  });

  assert.deepEqual(files, ["packages/pwa/src/app.ts"]);
});

test("validate-release-promotion fails when main is stale on product files", (t) => {
  const cwd = makeTempRepo();
  t.after(() => rmSync(cwd, { recursive: true, force: true }));

  git(cwd, ["checkout", "dev"]);
  writeRepoFile(cwd, "packages/pwa/src/app.ts", "export const value = 'dev';\n");
  commitAll(cwd, "dev change");

  const result = runNode(VALIDATE_RELEASE_PROMOTION, [
    `--cwd=${cwd}`,
    "--from-ref=dev",
    "--to-ref=main",
  ]);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /Production release blocked/);
  assert.match(result.stderr, /packages\/pwa\/src\/app\.ts/);
});

test("validate-main-pr passes for a fresh promotion branch", (t) => {
  const cwd = makeTempRepo();
  t.after(() => rmSync(cwd, { recursive: true, force: true }));

  git(cwd, ["checkout", "dev"]);
  writeRepoFile(cwd, "packages/pwa/src/app.ts", "export const value = 'dev';\n");
  commitAll(cwd, "dev change");
  updateOriginRef(cwd, "dev");

  git(cwd, ["checkout", "-b", "chore/promote-dev-to-main-20260421", "main"]);
  git(cwd, ["merge", "--squash", "--no-commit", "dev"]);
  git(cwd, ["commit", "-m", "chore: promote dev into main for production release"]);

  const result = runNode(VALIDATE_MAIN_PR, [
    `--cwd=${cwd}`,
    "--base-ref=origin/main",
    "--head-ref=HEAD",
    "--head-branch=chore/promote-dev-to-main-20260421",
  ]);

  assert.equal(result.status, 0);
  assert.match(result.stdout, /Promotion branch matches origin\/dev/);
});

test("validate-main-pr rejects product changes on a non-promotion branch", (t) => {
  const cwd = makeTempRepo();
  t.after(() => rmSync(cwd, { recursive: true, force: true }));

  git(cwd, ["checkout", "-b", "fix/manual-main-edit", "main"]);
  writeRepoFile(cwd, "packages/pwa/src/app.ts", "export const value = 'oops';\n");
  commitAll(cwd, "manual main edit");

  const result = runNode(VALIDATE_MAIN_PR, [
    `--cwd=${cwd}`,
    "--base-ref=origin/main",
    "--head-ref=HEAD",
    "--head-branch=fix/manual-main-edit",
  ]);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /must come from a promotion branch/);
});

test("validate-main-pr allows release-only metadata updates", (t) => {
  const cwd = makeTempRepo();
  t.after(() => rmSync(cwd, { recursive: true, force: true }));

  git(cwd, ["checkout", "-b", "docs/release-note-sync", "main"]);
  writeRepoFile(cwd, "release-notes/releases/v26.4.2100.json", "{\n  \"approved\": true\n}\n");
  writeRepoFile(cwd, "packages/pwa/package.json", "{\n  \"name\": \"@freed/pwa\",\n  \"version\": \"26.4.2100\"\n}\n");
  commitAll(cwd, "release metadata");

  const result = runNode(VALIDATE_MAIN_PR, [
    `--cwd=${cwd}`,
    "--base-ref=origin/main",
    "--head-ref=HEAD",
    "--head-branch=docs/release-note-sync",
  ]);

  assert.equal(result.status, 0);
  assert.match(result.stdout, /Release-only metadata update detected/);
});
