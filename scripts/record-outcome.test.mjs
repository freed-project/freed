import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import {
  acquireLease,
  AUTOMATION_ACTOR_POLICIES,
  createTask,
  transitionTask,
} from "./lib/automation-control.mjs";
import { parseArgs } from "./record-outcome.mjs";
import { resolveStatePathWithLegacyFallback } from "./nightly-self-improve.mjs";
import { writeMeasuredOutcomeVerdict } from "./test-helpers/outcome-evidence.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CLI_PATH = path.join(__dirname, "record-outcome.mjs");

function acquireActorLease(stateRoot, actor) {
  const policy = AUTOMATION_ACTOR_POLICIES[actor];
  const token = `${actor}-lease-token`;
  const actorCredentialToken = `credential:${actor}:${"x".repeat(64)}`;
  const credentialDir = path.join(stateRoot, "control", "actor-credentials");
  mkdirSync(credentialDir, { recursive: true });
  writeFileSync(
    path.join(credentialDir, `${actor}.json`),
    `${JSON.stringify({
      schemaVersion: 1,
      actor,
      purpose: "automation-actor-lease",
      tokenSha256: createHash("sha256")
        .update(actorCredentialToken)
        .digest("hex"),
    })}\n`,
    { mode: 0o600 },
  );
  acquireLease({
    stateRoot,
    name: policy.leaseName,
    owner: actor,
    token,
    actorCredentialToken,
    ttlMs: policy.maxLeaseLifetimeMs,
  });
  return { actor, leaseName: policy.leaseName, leaseToken: token };
}

function prepareSoakingTask(stateRoot, taskId, build = "v26.7.203-dev") {
  const controller = acquireActorLease(stateRoot, "freed-stability-controller");
  const nightly = acquireActorLease(stateRoot, "freed-nightly-runner");
  const lifecycleStartMs = Date.parse("2026-07-09T18:00:00Z");
  createTask({
    stateRoot,
    taskId,
    ...controller,
    observerAuthority: "merge-safe",
    providerAuthority: "forbidden",
    details: { behavioral: true },
    nowMs: lifecycleStartMs,
  });
  for (const [index, [state, authentication]] of [
    ["triaged", controller],
    ["approved_for_pr", controller],
    ["implemented", nightly],
    ["validated", nightly],
    ["merged", nightly],
    ["installed", nightly],
    ["soaking", nightly],
  ].entries()) {
    transitionTask({
      stateRoot,
      taskId,
      toState: state,
      ...authentication,
      ...(state === "installed"
        ? {
            details: {
              behavioral: true,
              installedIdentity: {
                version: build.replace(/^v/i, ""),
                commitSha: "a".repeat(40),
                channel: "dev",
              },
            },
          }
        : {}),
      nowMs: lifecycleStartMs + (index + 1) * 60_000,
    });
  }
}

function writeVerdict(dir, { taskId, build, windowEnd }) {
  return writeMeasuredOutcomeVerdict(dir, {
    taskId,
    version: build.replace(/^v/i, ""),
    commitSha: "a".repeat(40),
    windowEnd,
    before: 30,
    after: 4,
  }).verdictPath;
}

function authenticationArgs(stateRoot, authentication, verdictPath) {
  return [
    "--state-root",
    stateRoot,
    "--actor",
    authentication.actor,
    "--lease-name",
    authentication.leaseName,
    "--lease-token",
    authentication.leaseToken,
    "--verdict-reference",
    verdictPath,
  ];
}

test("resolveStatePathWithLegacyFallback prefers an existing new-location file", () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "freed-state-fallback-"));
  const preferred = path.join(dir, "new", "outcomes.jsonl");
  const legacy = path.join(dir, "legacy", "outcomes.jsonl");
  writeFileSync(path.join(dir, "new-file"), "");
  const newPath = path.join(dir, "new-file");
  assert.equal(resolveStatePathWithLegacyFallback(newPath, legacy), newPath);
  assert.equal(
    resolveStatePathWithLegacyFallback(preferred, legacy),
    preferred,
  );
});

test("resolveStatePathWithLegacyFallback migrates legacy state to the new location", () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "freed-state-migrate-"));
  const preferred = path.join(dir, "new", "outcomes.jsonl");
  const legacy = path.join(dir, "legacy-outcomes.jsonl");
  writeFileSync(legacy, '{"id":"old","kind":"task","outcome":"shipped"}\n');

  const resolved = resolveStatePathWithLegacyFallback(preferred, legacy);

  assert.equal(resolved, preferred);
  assert.ok(existsSync(preferred));
  assert.match(readFileSync(preferred, "utf8"), /"id":"old"/);
});

test("resolveStatePathWithLegacyFallback keeps the legacy path when migration fails", () => {
  const failingOps = {
    existsSync: (p) => p === "/legacy/outcomes.jsonl",
    mkdirSync: () => {
      throw new Error("read-only");
    },
    copyFileSync: () => {
      throw new Error("read-only");
    },
  };
  assert.equal(
    resolveStatePathWithLegacyFallback(
      "/new/outcomes.jsonl",
      "/legacy/outcomes.jsonl",
      failingOps,
    ),
    "/legacy/outcomes.jsonl",
  );
});

test("record-outcome parseArgs requires an id and applies defaults", () => {
  assert.throws(() => parseArgs([]), /--id is required/);
  assert.throws(
    () => parseArgs(["--id", "W1-01", "--pr", "897"]),
    /requires --actor, --lease-name, and a token/,
  );
  const args = parseArgs([
    "--id",
    "W1-01",
    "--pr",
    "897",
    "--actor",
    "freed-nightly-runner",
    "--lease-name",
    "nightly-writer",
    "--lease-token",
    "token",
    "--evidence-digest",
    "a".repeat(64),
  ]);
  assert.equal(args.kind, "task");
  assert.equal(args.taskId, "W1-01");
  assert.equal(args.status, "merged");
  assert.equal(args.pr, "897");
  assert.ok(args.ledger.includes(path.join(".freed", "automation")));
  const customStateRoot = path.join(os.tmpdir(), "freed-custom-outcome-state");
  const custom = parseArgs([
    "--id",
    "W1-02",
    "--state-root",
    customStateRoot,
    "--actor",
    "freed-nightly-runner",
    "--lease-name",
    "nightly-writer",
    "--lease-token",
    "token",
    "--evidence-digest",
    "b".repeat(64),
  ]);
  assert.equal(custom.ledger, path.join(customStateRoot, "outcomes.jsonl"));
  assert.throws(
    () =>
      parseArgs([
        "--id",
        "W1-02",
        "--state-root",
        customStateRoot,
        "--ledger",
        path.join(customStateRoot, "alternate.jsonl"),
        "--actor",
        "freed-nightly-runner",
        "--lease-name",
        "nightly-writer",
        "--lease-token",
        "token",
        "--evidence-digest",
        "b".repeat(64),
      ]),
    /canonical state-root ledger/,
  );
  assert.throws(() => parseArgs(["--id", "x", "--bogus"]), /Unknown argument/);
});

test("record-outcome requires complete installed build identity", () => {
  const authentication = [
    "--actor",
    "freed-nightly-runner",
    "--lease-name",
    "nightly-writer",
    "--lease-token",
    "token",
    "--evidence-digest",
    "a".repeat(64),
  ];
  assert.throws(
    () =>
      parseArgs([
        "--id",
        "P1-01",
        "--status",
        "installed",
        "--build",
        "26.7.100-dev",
        ...authentication,
      ]),
    /require --build, --build-commit-sha, and --build-channel/,
  );
  const args = parseArgs([
    "--id",
    "P1-01",
    "--status",
    "installed",
    "--build",
    "26.7.100-dev",
    "--build-commit-sha",
    "b".repeat(40),
    "--build-channel",
    "dev",
    ...authentication,
  ]);
  assert.equal(args.buildCommitSha, "b".repeat(40));
  assert.equal(args.buildChannel, "dev");
});

test("record-outcome CLI appends a ledger line at the given path", () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "freed-record-outcome-"));
  const ledger = path.join(dir, "state", "outcomes.jsonl");
  const stateRoot = path.join(dir, "state");
  prepareSoakingTask(stateRoot, "W1-01");
  const authentication = acquireActorLease(stateRoot, "freed-release-verifier");
  const verdictPath = writeVerdict(dir, {
    taskId: "W1-01",
    build: "v26.7.203-dev",
    windowEnd: "2026-07-10T12:00:00Z",
  });

  const stdout = execFileSync(
    process.execPath,
    [
      CLI_PATH,
      "--id",
      "W1-01",
      "--task-id",
      "W1-01",
      "--kind",
      "task",
      "--status",
      "verified_effective",
      "--pr",
      "897",
      "--notes",
      "test entry",
      "--evidence-window-end",
      "2026-07-10T12:00:00Z",
      "--ledger",
      ledger,
      ...authenticationArgs(stateRoot, authentication, verdictPath),
    ],
    { encoding: "utf8" },
  );

  assert.match(stdout, /Recorded verified_effective outcome for W1-01/);
  const lines = readFileSync(ledger, "utf8").trim().split("\n");
  assert.equal(lines.length, 1);
  const entry = JSON.parse(lines[0]);
  assert.equal(entry.id, "W1-01");
  assert.equal(entry.kind, "task");
  assert.equal(entry.schemaVersion, 3);
  assert.equal(entry.outcome, "verified_effective");
  assert.equal(entry.pr, "897");
  assert.equal(entry.build, "26.7.203-dev");
  assert.deepEqual(entry.buildIdentity, {
    version: "26.7.203-dev",
    commitSha: "a".repeat(40),
    channel: "dev",
  });
  assert.deepEqual(entry.effect, {
    metric: "main-footprint-slope",
    before: 30,
    after: 4,
    delta: -26,
    unit: "MB/sample-hour",
  });
  assert.equal(entry.evidenceWindowEnd, "2026-07-10T12:00:00Z");
  assert.equal(entry.evidence.verdictReference, realpathSync(verdictPath));
  assert.equal(entry.authentication.actor, "freed-release-verifier");
  assert.ok(entry.ts);
});

test("record-outcome CLI rejects an invalid status", () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "freed-record-outcome-bad-"));
  const ledger = path.join(dir, "outcomes.jsonl");
  assert.throws(() =>
    execFileSync(
      process.execPath,
      [CLI_PATH, "--id", "x", "--status", "done", "--ledger", ledger],
      {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      },
    ),
  );
  assert.equal(existsSync(ledger), false);
});

test("record-outcome rejects caller-supplied effect measurements", () => {
  assert.throws(
    () => parseArgs(["--id", "x", "--metric", "rss", "--before", "10"]),
    /Unknown argument: --metric/,
  );
});

test("record-outcome rejects measured verification without attribution", () => {
  const dir = mkdtempSync(
    path.join(os.tmpdir(), "freed-record-outcome-unattributed-"),
  );
  const ledger = path.join(dir, "outcomes.jsonl");
  const authentication = acquireActorLease(dir, "freed-release-verifier");
  assert.throws(() =>
    execFileSync(
      process.execPath,
      [
        CLI_PATH,
        "--id",
        "x",
        "--status",
        "verified_effective",
        "--ledger",
        ledger,
        ...authenticationArgs(
          dir,
          authentication,
          path.join(dir, "missing-verdict.json"),
        ),
      ],
      { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
    ),
  );
  assert.equal(existsSync(ledger), false);
});
