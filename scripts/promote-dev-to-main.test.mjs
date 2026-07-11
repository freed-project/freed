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
