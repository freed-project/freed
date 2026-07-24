import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  chmodSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  buildStabilityStatus,
  formatStabilityStatus,
  readRepositoryStatus,
} from "./lib/stability-status.mjs";

const NOW = Date.parse("2026-07-24T09:00:00.000Z");

function fixtureTaskManifest(revision = 1) {
  return {
    schemaVersion: 1,
    revision,
    updatedAt: "2026-07-24T08:00:00.000Z",
    tasks: [
      {
        schemaVersion: 1,
        taskId: "github-issue-1107",
        state: "approved_for_pr",
        revision: 3,
        behavioral: false,
        observerAuthority: "merge-safe",
        providerAuthority: "forbidden",
        createdAt: "2026-07-24T07:10:15.153Z",
        updatedAt: "2026-07-24T07:11:10.608Z",
        details: {
          behavioral: false,
          estimatedMinutes: 120,
          githubIssue: {
            number: 1107,
            url: "https://github.com/freed-project/freed/issues/1107",
          },
        },
      },
    ],
  };
}

function writeFixtureState() {
  const stateRoot = realpathSync(
    mkdtempSync(path.join(os.tmpdir(), "freed-stability-status-")),
  );
  const control = path.join(stateRoot, "control");
  mkdirSync(path.join(control, "task-transactions", ".authority-retirements"), {
    recursive: true,
    mode: 0o700,
  });
  writeFileSync(
    path.join(control, "current-tasks.json"),
    `${JSON.stringify(fixtureTaskManifest(), null, 2)}\n`,
    { mode: 0o600 },
  );
  writeFileSync(path.join(stateRoot, "outcomes.jsonl"), "", { mode: 0o600 });
  chmodSync(control, 0o700);
  return stateRoot;
}

function fixedReaders() {
  return {
    repository: () => ({
      health: "healthy",
      root: "/machine-specific/worktree",
      commitSha: "a".repeat(40),
      branch: "feat/status",
      detached: false,
      dirty: false,
      originUrl: "https://github.com/freed-project/freed.git",
    }),
    actorBindings: () => ({
      health: "healthy",
      checkedCount: 5,
      matchedCount: 5,
      actors: [],
      drift: [],
    }),
    soak: () => ({
      model: {
        health: "unavailable",
        maturity: "unavailable",
        soakId: null,
        startedAt: null,
        stoppedAt: null,
        verdict: null,
      },
      directory: null,
    }),
    runtime: () => ({ health: "unavailable", identity: null }),
    artifacts: ({ artifactRoot }) => ({
      schemaVersion: 1,
      health: "unavailable",
      root: artifactRoot,
      counts: { valid: 0, stale: 0, malformed: 0, unsupported: 0 },
      records: [],
    }),
  };
}

function snapshotTree(root) {
  const rows = [];
  function visit(directory) {
    for (const name of readdirSync(directory).sort()) {
      const target = path.join(directory, name);
      const stats = lstatSync(target);
      const relative = path.relative(root, target);
      if (stats.isDirectory()) {
        rows.push({
          path: relative,
          type: "directory",
          mode: stats.mode,
          mtimeMs: stats.mtimeMs,
        });
        visit(target);
      } else {
        rows.push({
          path: relative,
          type: "file",
          mode: stats.mode,
          mtimeMs: stats.mtimeMs,
          digest: createHash("sha256")
            .update(readFileSync(target))
            .digest("hex"),
        });
      }
    }
  }
  visit(root);
  return rows;
}

test("stability status is repeatable, read-only, and changes when classified input changes", () => {
  const stateRoot = writeFixtureState();
  const readers = fixedReaders();
  const before = snapshotTree(stateRoot);
  const first = buildStabilityStatus({
    repoRoot: process.cwd(),
    stateRoot,
    nowMs: NOW,
    readers,
  });
  const second = buildStabilityStatus({
    repoRoot: process.cwd(),
    stateRoot,
    nowMs: NOW + 1_000,
    readers,
  });
  const after = snapshotTree(stateRoot);

  assert.equal(first.stableDigest, second.stableDigest);
  assert.notEqual(first.observedAt, second.observedAt);
  assert.deepEqual(after, before);
  assert.equal(
    first.nextAction.id,
    "implement_selected_task",
    first.control.reason,
  );
  assert.equal(first.nextAction.taskId, "github-issue-1107");
  assert.match(formatStabilityStatus(first), /Stable digest: [0-9a-f]{64}/);

  writeFileSync(
    path.join(stateRoot, "control", "current-tasks.json"),
    `${JSON.stringify(fixtureTaskManifest(2), null, 2)}\n`,
    { mode: 0o600 },
  );
  const changed = buildStabilityStatus({
    repoRoot: process.cwd(),
    stateRoot,
    nowMs: NOW,
    readers,
  });
  assert.notEqual(changed.stableDigest, first.stableDigest);
});

test("repository status invokes local git readers only", () => {
  const calls = [];
  const outputs = new Map([
    ["rev-parse HEAD", `${"b".repeat(40)}\n`],
    ["rev-parse --show-toplevel", "/repo\n"],
    ["symbolic-ref --quiet --short HEAD", "dev\n"],
    [
      "config --get remote.origin.url",
      "https://github.com/freed-project/freed.git\n",
    ],
    ["status --porcelain=v1 --untracked-files=normal", ""],
  ]);
  const status = readRepositoryStatus({
    repoRoot: "/repo",
    execFile(command, args) {
      calls.push({ command, args });
      return outputs.get(args.join(" "));
    },
  });

  assert.equal(status.health, "healthy");
  assert.equal(status.commitSha, "b".repeat(40));
  assert.ok(calls.every((call) => call.command === "git"));
  assert.ok(
    calls.every(
      (call) =>
        !call.args.some((argument) =>
          /fetch|pull|push|ls-remote|https?:/i.test(argument),
        ),
    ),
  );
});

test("observation time and machine paths do not affect the stable digest", () => {
  const stateRoot = writeFixtureState();
  const firstReaders = fixedReaders();
  const secondReaders = fixedReaders();
  secondReaders.repository = () => ({
    ...firstReaders.repository(),
    root: "/another/machine/worktree",
  });
  secondReaders.artifacts = () => ({
    schemaVersion: 1,
    health: "unavailable",
    root: "/another/machine/artifacts",
    counts: { valid: 0, stale: 0, malformed: 0, unsupported: 0 },
    records: [],
  });
  const first = buildStabilityStatus({
    repoRoot: process.cwd(),
    stateRoot,
    nowMs: NOW,
    readers: firstReaders,
  });
  const second = buildStabilityStatus({
    repoRoot: process.cwd(),
    stateRoot,
    nowMs: NOW + 60_000,
    readers: secondReaders,
  });
  assert.equal(first.stableDigest, second.stableDigest);
});
