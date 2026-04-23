import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const scriptsDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptsDir, "..");
const publishScript = path.join(repoRoot, "scripts/worktree-publish.sh");

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    ...options,
  });

  if (result.error) {
    throw result.error;
  }

  return result;
}

function assertSuccess(result) {
  assert.equal(
    result.status,
    0,
    `stdout:\n${result.stdout ?? ""}\n\nstderr:\n${result.stderr ?? ""}`,
  );
}

async function createPublishFixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "freed-worktree-publish-"));
  t.after(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  const origin = path.join(root, "origin.git");
  const seed = path.join(root, "seed");
  const worktree = path.join(root, "worktree");
  const binDir = path.join(root, "bin");
  const ghStateFile = path.join(root, "gh-state.json");
  const ghLogFile = path.join(root, "gh-log.jsonl");

  await fs.mkdir(seed, { recursive: true });
  await fs.mkdir(binDir, { recursive: true });
  await fs.writeFile(ghStateFile, JSON.stringify({ prList: [] }, null, 2));
  await fs.writeFile(ghLogFile, "");

  assert.equal(run("git", ["init", "--bare", origin]).status, 0);
  assert.equal(run("git", ["init"], { cwd: seed }).status, 0);
  assert.equal(run("git", ["config", "user.name", "Freed Tests"], { cwd: seed }).status, 0);
  assert.equal(run("git", ["config", "user.email", "tests@freed.invalid"], { cwd: seed }).status, 0);
  await fs.writeFile(path.join(seed, "README.md"), "seed\n");
  assert.equal(run("git", ["add", "README.md"], { cwd: seed }).status, 0);
  assert.equal(run("git", ["commit", "-m", "chore: seed repo"], { cwd: seed }).status, 0);
  assert.equal(run("git", ["branch", "-M", "dev"], { cwd: seed }).status, 0);
  assert.equal(run("git", ["remote", "add", "origin", origin], { cwd: seed }).status, 0);
  assert.equal(run("git", ["push", "-u", "origin", "dev"], { cwd: seed }).status, 0);

  assert.equal(run("git", ["clone", "--branch", "dev", origin, worktree]).status, 0);
  assert.equal(run("git", ["config", "user.name", "Freed Tests"], { cwd: worktree }).status, 0);
  assert.equal(run("git", ["config", "user.email", "tests@freed.invalid"], { cwd: worktree }).status, 0);
  assert.equal(run("git", ["checkout", "-b", "fix/worktree-publish-test"], { cwd: worktree }).status, 0);

  const ghStub = `#!/usr/bin/env node
const fs = require("node:fs");

const args = process.argv.slice(2);
const stateFile = process.env.GH_STATE_FILE;
const logFile = process.env.GH_LOG_FILE;
const state = JSON.parse(fs.readFileSync(stateFile, "utf8"));

fs.appendFileSync(logFile, JSON.stringify({ args }) + "\\n");

if (args[0] !== "pr") {
  process.exit(1);
}

if (args[1] === "list") {
  process.stdout.write(JSON.stringify(state.prList || []));
  process.exit(0);
}

if (args[1] === "create") {
  process.stdout.write(state.createUrl || "https://github.com/freed-project/freed/pull/999");
  process.exit(0);
}

if (args[1] === "edit" || args[1] === "ready") {
  process.exit(0);
}

process.exit(1);
`;

  await fs.writeFile(path.join(binDir, "gh"), ghStub, { mode: 0o755 });

  return {
    worktree,
    ghStateFile,
    ghLogFile,
    env: {
      ...process.env,
      GH_STATE_FILE: ghStateFile,
      GH_LOG_FILE: ghLogFile,
      PATH: `${binDir}:${process.env.PATH}`,
    },
  };
}

async function readGhLog(logFile) {
  const raw = await fs.readFile(logFile, "utf8");
  return raw
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

test("worktree-publish converts an existing ready PR back to draft and updates it", async (t) => {
  const fixture = await createPublishFixture(t);

  await fs.writeFile(
    fixture.ghStateFile,
    JSON.stringify(
      {
        prList: [
          {
            number: 253,
            url: "https://github.com/freed-project/freed/pull/253",
            isDraft: false,
          },
        ],
      },
      null,
      2,
    ),
  );

  await fs.writeFile(path.join(fixture.worktree, "README.md"), "updated\n");

  const result = run(
    "bash",
    [
      publishScript,
      "--title",
      "fix: refresh worktree publish flow",
      "--summary",
      "Refresh the worktree publish flow",
      "--test",
      "node --test scripts/*.test.mjs",
    ],
    {
      cwd: fixture.worktree,
      env: fixture.env,
    },
  );

  assertSuccess(result);
  assert.match(result.stdout, /Updated draft PR: https:\/\/github.com\/freed-project\/freed\/pull\/253/);

  const headMessage = run("git", ["log", "-1", "--pretty=%s"], { cwd: fixture.worktree });
  assert.equal(headMessage.stdout.trim(), "fix: refresh worktree publish flow");

  const ghCalls = await readGhLog(fixture.ghLogFile);
  assert.deepEqual(ghCalls[0].args.slice(0, 2), ["pr", "list"]);
  assert.deepEqual(ghCalls[1].args, ["pr", "ready", "253", "--undo"]);
  assert.equal(ghCalls[2].args[0], "pr");
  assert.equal(ghCalls[2].args[1], "edit");
  assert.match(ghCalls[2].args.join("\n"), /\(AI Generated\)\./);
});

test("worktree-publish updates an existing draft PR without toggling it", async (t) => {
  const fixture = await createPublishFixture(t);

  await fs.writeFile(
    fixture.ghStateFile,
    JSON.stringify(
      {
        prList: [
          {
            number: 251,
            url: "https://github.com/freed-project/freed/pull/251",
            isDraft: true,
          },
        ],
      },
      null,
      2,
    ),
  );

  await fs.writeFile(path.join(fixture.worktree, "README.md"), "updated draft\n");

  const result = run(
    "bash",
    [
      publishScript,
      "--title",
      "fix: update draft publish helper",
      "--summary",
      "Update the draft publish helper",
    ],
    {
      cwd: fixture.worktree,
      env: fixture.env,
    },
  );

  assertSuccess(result);
  assert.match(result.stdout, /Updated draft PR: https:\/\/github.com\/freed-project\/freed\/pull\/251/);

  const ghCalls = await readGhLog(fixture.ghLogFile);
  assert.equal(ghCalls.some((call) => call.args[1] === "ready"), false);
  assert.equal(ghCalls.at(-1).args[1], "edit");
});

test("worktree-publish creates a new draft PR when none exists", async (t) => {
  const fixture = await createPublishFixture(t);
  await fs.writeFile(path.join(fixture.worktree, "README.md"), "fresh create\n");

  const result = run(
    "bash",
    [
      publishScript,
      "--title",
      "fix: create a new draft publish helper",
      "--summary",
      "Create the new draft publish helper",
    ],
    {
      cwd: fixture.worktree,
      env: fixture.env,
    },
  );

  assertSuccess(result);
  assert.match(result.stdout, /https:\/\/github.com\/freed-project\/freed\/pull\/999/);

  const ghCalls = await readGhLog(fixture.ghLogFile);
  assert.equal(ghCalls.at(-1).args[1], "create");
  assert.ok(ghCalls.at(-1).args.includes("--draft"));
});
