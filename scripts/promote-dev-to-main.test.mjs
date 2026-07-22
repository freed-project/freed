import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const scriptsDir = path.dirname(fileURLToPath(import.meta.url));
const sourceRoot = path.resolve(scriptsDir, "..");
const developerDirectory = "/Library/Developer/CommandLineTools";

function run(command, args, options = {}) {
  const environment = {
    ...process.env,
    DEVELOPER_DIR: developerDirectory,
    ...(options.env ?? {}),
  };
  const result = spawnSync(command, args, {
    encoding: "utf8",
    ...options,
    env: environment,
  });
  if (result.error) {
    throw result.error;
  }
  return result;
}

function mustRun(command, args, options = {}) {
  const result = run(command, args, options);
  assert.equal(
    result.status,
    0,
    `${command} ${args.join(" ")}\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`,
  );
  return result;
}

async function existingPromotionFixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "freed-promote-existing-"));
  t.after(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });
  const repo = path.join(root, "repo");
  const origin = path.join(root, "origin.git");
  const caller = path.join(root, "caller");
  const worktree = path.join(caller, "promotion-worktree");
  const branch = "chore/promote-dev-to-main-test";
  const publisherLog = path.join(root, "publisher-args.json");
  const validationLog = path.join(root, "validation-args.json");
  const reviewArtifact = path.join(caller, "provider-review.json");

  await fs.mkdir(path.join(repo, "scripts/lib"), { recursive: true });
  await fs.mkdir(path.join(repo, "packages/pwa/src"), { recursive: true });
  await fs.mkdir(caller, { recursive: true });
  await fs.copyFile(
    path.join(sourceRoot, "scripts/promote-dev-to-main.sh"),
    path.join(repo, "scripts/promote-dev-to-main.sh"),
  );
  await fs.copyFile(
    path.join(sourceRoot, "scripts/lib/node-tooling.sh"),
    path.join(repo, "scripts/lib/node-tooling.sh"),
  );
  await fs.copyFile(path.join(sourceRoot, ".nvmrc"), path.join(repo, ".nvmrc"));
  await fs.writeFile(
    path.join(repo, "scripts/validate-release-promotion.mjs"),
    "process.exit(1);\n",
  );
  await fs.writeFile(
    path.join(repo, "scripts/validate-main-pr.mjs"),
    `import fs from "node:fs";\nfs.writeFileSync(${JSON.stringify(validationLog)}, JSON.stringify(process.argv.slice(2)));\n`,
  );
  await fs.writeFile(
    path.join(repo, "scripts/worktree-publish.sh"),
    `#!${process.execPath}\nconst fs = require("node:fs");\nfs.writeFileSync(${JSON.stringify(publisherLog)}, JSON.stringify(process.argv.slice(2)));\n`,
    { mode: 0o755 },
  );
  await fs.writeFile(reviewArtifact, "{}\n");
  await fs.writeFile(
    path.join(repo, "packages/pwa/src/app.ts"),
    "export const value = 'main';\n",
  );

  mustRun("git", ["init", "--bare", origin]);
  mustRun("git", ["init"], { cwd: repo });
  mustRun("git", ["config", "user.name", "Freed Tests"], { cwd: repo });
  mustRun("git", ["config", "user.email", "tests@freed.invalid"], {
    cwd: repo,
  });
  mustRun("git", ["add", "-A"], { cwd: repo });
  mustRun("git", ["commit", "-m", "chore: seed main"], { cwd: repo });
  mustRun("git", ["branch", "-M", "main"], { cwd: repo });
  mustRun("git", ["remote", "add", "origin", origin], { cwd: repo });
  mustRun("git", ["push", "-u", "origin", "main"], { cwd: repo });
  mustRun("git", ["checkout", "-b", "dev"], { cwd: repo });
  await fs.writeFile(
    path.join(repo, "packages/pwa/src/app.ts"),
    "export const value = 'dev';\n",
  );
  mustRun("git", ["add", "packages/pwa/src/app.ts"], { cwd: repo });
  mustRun("git", ["commit", "-m", "feat: dev change"], { cwd: repo });
  mustRun("git", ["push", "-u", "origin", "dev"], { cwd: repo });
  mustRun("git", ["worktree", "add", worktree, "-b", branch, "origin/main"], {
    cwd: repo,
  });
  await fs.writeFile(
    path.join(worktree, "packages/pwa/src/app.ts"),
    "export const value = 'dev';\n",
  );
  mustRun("git", ["add", "packages/pwa/src/app.ts"], { cwd: worktree });
  mustRun("git", ["commit", "-m", "chore: promote dev into main"], {
    cwd: worktree,
  });
  return {
    branch,
    caller,
    origin,
    publisherLog,
    repo,
    reviewArtifact,
    validationLog,
    worktree,
  };
}

test("promotion fails closed when a configured publisher broker is not provisioned", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "freed-promote-main-"));
  t.after(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });
  const repo = path.join(root, "repo");
  const origin = path.join(root, "origin.git");
  const caller = path.join(root, "caller");
  const worktree = path.join(caller, "promotion-worktree");
  const publisherLog = path.join(root, "publisher-args.json");
  const validationLog = path.join(root, "validation-args.json");
  const approvalPath = path.join(caller, "provider-approval.json");

  await fs.mkdir(path.join(repo, "scripts/lib"), { recursive: true });
  await fs.mkdir(caller, { recursive: true });
  await fs.copyFile(
    path.join(sourceRoot, "scripts/promote-dev-to-main.sh"),
    path.join(repo, "scripts/promote-dev-to-main.sh"),
  );
  await fs.copyFile(
    path.join(sourceRoot, "scripts/lib/node-tooling.sh"),
    path.join(repo, "scripts/lib/node-tooling.sh"),
  );
  await fs.copyFile(
    path.join(sourceRoot, "scripts/doctor.mjs"),
    path.join(repo, "scripts/doctor.mjs"),
  );
  await fs.copyFile(path.join(sourceRoot, ".nvmrc"), path.join(repo, ".nvmrc"));
  await fs.writeFile(path.join(repo, "README.md"), "main\n");
  await fs.writeFile(approvalPath, "{}\n");
  await fs.writeFile(
    path.join(repo, "scripts/validate-release-promotion.mjs"),
    "process.exit(1);\n",
  );
  await fs.writeFile(
    path.join(repo, "scripts/validate-main-pr.mjs"),
    `import fs from "node:fs";\nfs.writeFileSync(${JSON.stringify(validationLog)}, JSON.stringify(process.argv.slice(2)));\n`,
  );
  await fs.writeFile(
    path.join(repo, "scripts/worktree-add.sh"),
    `#!/bin/bash\nset -euo pipefail\npath="$1"\nshift\n[[ "$1" == "-b" ]]\nbranch="$2"\nbase="$3"\n/usr/bin/git worktree add "$path" -b "$branch" "$base"\n`,
    { mode: 0o755 },
  );
  const publisher = path.join(repo, "trusted-publisher-host");
  await fs.writeFile(
    publisher,
    `#!${process.execPath}\nconst fs = require("node:fs");\nfs.writeFileSync(${JSON.stringify(publisherLog)}, JSON.stringify(process.argv.slice(2)));\n`,
    { mode: 0o755 },
  );

  mustRun("git", ["init", "--bare", origin]);
  mustRun("git", ["init"], { cwd: repo });
  mustRun("git", ["config", "user.name", "Freed Tests"], { cwd: repo });
  mustRun("git", ["config", "user.email", "tests@freed.invalid"], {
    cwd: repo,
  });
  mustRun("git", ["add", "-A"], { cwd: repo });
  mustRun("git", ["commit", "-m", "chore: seed main"], { cwd: repo });
  mustRun("git", ["branch", "-M", "main"], { cwd: repo });
  mustRun("git", ["remote", "add", "origin", origin], { cwd: repo });
  mustRun("git", ["push", "-u", "origin", "main"], { cwd: repo });
  mustRun("git", ["checkout", "-b", "dev"], { cwd: repo });
  await fs.writeFile(path.join(repo, "README.md"), "dev\n");
  mustRun("git", ["add", "README.md"], { cwd: repo });
  mustRun("git", ["commit", "-m", "feat: dev change"], { cwd: repo });
  mustRun("git", ["push", "-u", "origin", "dev"], { cwd: repo });

  const result = run(
    "bash",
    [
      path.join(repo, "scripts/promote-dev-to-main.sh"),
      "promotion-worktree",
      "chore/promote-dev-to-main-test",
      "--provider-risk-approval-file",
      "provider-approval.json",
    ],
    {
      cwd: caller,
      env: {
        ...process.env,
        NODE_BIN: process.execPath,
        FREED_TRUSTED_PUBLISHER: publisher,
      },
    },
  );
  assert.notEqual(
    result.status,
    0,
    `stdout:\n${result.stdout}\nstderr:\n${result.stderr}`,
  );
  assert.match(
    result.stderr,
    /trusted publisher host is not fully provisioned/,
  );
  await assert.rejects(fs.access(publisherLog));
  await assert.rejects(fs.access(validationLog));
  await assert.rejects(fs.access(worktree));
});

test("promotion forwards one provider review artifact to draft publication", async (t) => {
  const fixture = await existingPromotionFixture(t);
  const result = run(
    "bash",
    [
      path.join(fixture.repo, "scripts/promote-dev-to-main.sh"),
      fixture.worktree,
      fixture.branch,
      "--provider-risk-review-artifact",
      path.relative(fixture.caller, fixture.reviewArtifact),
    ],
    {
      cwd: fixture.caller,
      env: { ...process.env, NODE_BIN: process.execPath },
    },
  );

  assert.equal(result.status, 0, result.stderr);
  const publisherArgs = JSON.parse(await fs.readFile(fixture.publisherLog));
  const canonicalReviewArtifact = await fs.realpath(fixture.reviewArtifact);
  assert.deepEqual(
    publisherArgs.slice(-2),
    ["--provider-risk-review-artifact", canonicalReviewArtifact],
  );
  assert.equal(publisherArgs.includes("--provider-risk-approval-file"), false);
  assert.deepEqual(
    JSON.parse(await fs.readFile(fixture.validationLog)),
    [
      "--base-ref=origin/main",
      "--head-ref=HEAD",
      `--head-branch=${fixture.branch}`,
    ],
  );
});

test("promotion rejects a stale existing branch before validation or publication", async (t) => {
  const fixture = await existingPromotionFixture(t);
  mustRun("git", ["checkout", "main"], { cwd: fixture.repo });
  await fs.writeFile(path.join(fixture.repo, "MAIN-ONLY.txt"), "advanced\n");
  mustRun("git", ["add", "MAIN-ONLY.txt"], { cwd: fixture.repo });
  mustRun("git", ["commit", "-m", "fix: advance main"], {
    cwd: fixture.repo,
  });
  mustRun("git", ["push", "origin", "main"], { cwd: fixture.repo });

  const result = run(
    "bash",
    [
      path.join(fixture.repo, "scripts/promote-dev-to-main.sh"),
      fixture.worktree,
      fixture.branch,
      "--provider-risk-review-artifact",
      fixture.reviewArtifact,
    ],
    {
      cwd: fixture.caller,
      env: { ...process.env, NODE_BIN: process.execPath },
    },
  );

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /does not equal current origin\/main/);
  await assert.rejects(fs.access(fixture.validationLog));
  await assert.rejects(fs.access(fixture.publisherLog));
});

test("promotion rejects competing provider authority inputs before repository access", () => {
  const result = run("bash", [
    path.join(sourceRoot, "scripts/promote-dev-to-main.sh"),
    "/tmp/not-used",
    "chore/promote-dev-to-main-test",
    "--provider-risk-review-artifact",
    "/tmp/review.json",
    "--provider-risk-approval-file",
    "/tmp/approval.json",
  ]);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /mutually exclusive/);
});
