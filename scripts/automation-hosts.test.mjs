import assert from "node:assert/strict";
import {
  chmodSync,
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { executeCommand, parseCommand } from "./automation-hosts.mjs";
import {
  CANONICAL_AUTOMATION_REPOSITORY,
  inspectAutomationHostAssignment,
  parseAutomationHostAssignments,
  parseAutomationHostProfile,
} from "./lib/automation-host-identity.mjs";

const HOST_ID = "b7c5b98e-3f78-435a-b734-8fef4f457549";

function fixture(t) {
  const root = realpathSync(
    mkdtempSync(path.join(os.tmpdir(), "freed-automation-hosts-")),
  );
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const profileRoot = path.join(
    root,
    "Library",
    "Application Support",
    "Freed",
  );
  const profilePath = path.join(profileRoot, "automation-host.json");
  const assignmentPath = path.join(root, "host-assignments.json");
  mkdirSync(profileRoot, { recursive: true, mode: 0o755 });
  chmodSync(profileRoot, 0o755);
  writeFileSync(
    assignmentPath,
    `${JSON.stringify({
      schemaVersion: 1,
      roles: { "primary-automation-host": HOST_ID },
    })}\n`,
  );
  return { root, profileRoot, profilePath, assignmentPath };
}

test("host records require exact schemas and an opaque UUID", () => {
  assert.deepEqual(
    parseAutomationHostProfile({
      schemaVersion: 1,
      hostId: HOST_ID,
      repository: CANONICAL_AUTOMATION_REPOSITORY,
    }),
    {
      schemaVersion: 1,
      hostId: HOST_ID,
      repository: CANONICAL_AUTOMATION_REPOSITORY,
    },
  );
  assert.deepEqual(
    parseAutomationHostAssignments({
      schemaVersion: 1,
      roles: { "primary-automation-host": HOST_ID },
    }).roles,
    { "primary-automation-host": HOST_ID },
  );
  assert.throws(
    () =>
      parseAutomationHostProfile({
        schemaVersion: 1,
        hostId: "my-mac.local",
        repository: CANONICAL_AUTOMATION_REPOSITORY,
      }),
    /UUIDv4/,
  );
});

test("inspection rejects a missing, writable, or mismatched host profile", (t) => {
  const value = fixture(t);
  const inspect = () =>
    inspectAutomationHostAssignment({
      assignmentPath: value.assignmentPath,
      profilePath: value.profilePath,
      profileRoot: value.profileRoot,
      requiredUid: process.getuid(),
    });
  assert.match(inspect().reason, /missing/);

  writeFileSync(
    value.profilePath,
    `${JSON.stringify({
      schemaVersion: 1,
      hostId: HOST_ID,
      repository: CANONICAL_AUTOMATION_REPOSITORY,
    })}\n`,
    { mode: 0o666 },
  );
  chmodSync(value.profilePath, 0o666);
  assert.match(inspect().reason, /not root-owned and immutable/);

  chmodSync(value.profilePath, 0o444);
  const assignment = JSON.parse(readFileSync(value.assignmentPath, "utf8"));
  assignment.roles["primary-automation-host"] =
    "6f7cfb27-83b4-4486-a0a5-30a605a32d6f";
  writeFileSync(value.assignmentPath, `${JSON.stringify(assignment)}\n`);
  assert.match(inspect().reason, /is not assigned/);
});

test("enroll installs and verifies the reviewed primary identity", (t) => {
  const value = fixture(t);
  const calls = [];
  const runner = (executable, args) => {
    calls.push({ executable, args });
    if (args[0] !== "/usr/bin/install") {
      return { status: 1, stdout: "", stderr: "unexpected command" };
    }
    if (args[1] === "-d") {
      mkdirSync(args.at(-1), { recursive: true, mode: 0o755 });
      chmodSync(args.at(-1), 0o755);
    } else {
      copyFileSync(args.at(-2), args.at(-1));
      chmodSync(args.at(-1), 0o444);
    }
    return { status: 0, stdout: "", stderr: "" };
  };
  const result = executeCommand(
    { action: "enroll" },
    {
      assignmentPath: value.assignmentPath,
      profilePath: value.profilePath,
      profileRoot: value.profileRoot,
      requiredUid: process.getuid(),
      runner,
      tempRoot: value.root,
    },
  );
  assert.equal(result.ready, true);
  assert.equal(result.hostId, HOST_ID);
  assert.equal(calls.length, 2);
  assert.equal(parseCommand(["inspect"]).action, "inspect");

  const repeated = executeCommand(
    { action: "enroll" },
    {
      assignmentPath: value.assignmentPath,
      profilePath: value.profilePath,
      profileRoot: value.profileRoot,
      requiredUid: process.getuid(),
      runner,
      tempRoot: value.root,
    },
  );
  assert.equal(repeated.alreadyEnrolled, true);
  assert.equal(calls.length, 2);
});
