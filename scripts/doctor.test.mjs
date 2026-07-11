import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  classifyBinaryArch,
  checkAutomationStateDir,
  checkTrustedPublisherConfig,
  credentialHelperBinary,
  evaluateGhCheck,
  formatReport,
  remediationForCommandFailure,
  resolveExitCode,
  runChecks,
} from "./doctor.mjs";

const sourceRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

function sha256(filePath) {
  return createHash("sha256").update(readFileSync(filePath)).digest("hex");
}

function writePublisherConfigFixture(home, overrides = {}) {
  const configDir = path.join(home, "config");
  const stateRoot = path.join(home, "automation-state");
  const configPath = path.join(configDir, "trusted-publisher-host.json");
  const brokerPath = "/bin/sh";
  const launcherPath = path.join(
    sourceRoot,
    "scripts",
    "trusted-worktree-publish.sh",
  );
  mkdirSync(configDir, { recursive: true, mode: 0o700 });
  mkdirSync(stateRoot, { recursive: true, mode: 0o700 });
  writeFileSync(
    configPath,
    `${JSON.stringify({
      schemaVersion: 2,
      brokerPath,
      brokerSha256: sha256(brokerPath),
      brokerTeamIdentifier: "ABCDEF1234",
      brokerSigningIdentifier: "wtf.freed.publisher-host",
      controlRoot: sourceRoot,
      controlCommit: "a".repeat(40),
      stateRoot,
      launcherSha256: sha256(launcherPath),
      automationControlSha256: sha256(
        path.join(sourceRoot, "scripts", "automation-control.mjs"),
      ),
      automationControlLibrarySha256: sha256(
        path.join(sourceRoot, "scripts", "lib", "automation-control.mjs"),
      ),
      publisherHelperSha256: sha256(
        path.join(sourceRoot, "scripts", "worktree-publish.sh"),
      ),
      githubCLIPath: brokerPath,
      githubCLISha256: sha256(brokerPath),
      nodePath: process.execPath,
      nodeSha256: sha256(process.execPath),
      publisherPublicKeyBase64: Buffer.alloc(32, 7).toString("base64"),
      ...overrides,
    })}\n`,
    { mode: 0o600 },
  );
  const credentialDir = path.join(stateRoot, "control", "actor-credentials");
  mkdirSync(credentialDir, { recursive: true, mode: 0o700 });
  writeFileSync(
    path.join(credentialDir, "freed-pr-publisher.json"),
    `${JSON.stringify({
      schemaVersion: 1,
      actor: "freed-pr-publisher",
      purpose: "publisher-capability-signing",
      publicKeyBase64: Buffer.alloc(32, 7).toString("base64"),
    })}\n`,
    { mode: 0o600 },
  );
  return { brokerPath, configPath };
}

test("classifyBinaryArch flags an x86_64 binary on an arm64 machine", () => {
  const fileOutput = "/usr/local/bin/gh: Mach-O 64-bit executable x86_64";
  const result = classifyBinaryArch(fileOutput, "arm64");
  assert.deepEqual(result.detected, ["x86_64"]);
  assert.equal(result.matches, false);
});

test("classifyBinaryArch accepts a universal binary containing the machine arch", () => {
  const fileOutput = [
    "/opt/homebrew/bin/gh: Mach-O universal binary with 2 architectures",
    "gh (for architecture x86_64): Mach-O 64-bit executable x86_64",
    "gh (for architecture arm64): Mach-O 64-bit executable arm64",
  ].join("\n");
  const result = classifyBinaryArch(fileOutput, "arm64");
  assert.deepEqual(result.detected, ["x86_64", "arm64"]);
  assert.equal(result.matches, true);
});

test("classifyBinaryArch stays quiet when file output has no arch info", () => {
  assert.equal(classifyBinaryArch("", "arm64").matches, true);
});

test("successful macOS gh still warns when its architecture does not match", () => {
  const result = evaluateGhCheck({
    ghPath: "/usr/local/bin/gh",
    versionResult: { ok: true, stdout: "gh version 2.76.1", error: "" },
    fileResult: {
      ok: true,
      stdout: "/usr/local/bin/gh: Mach-O 64-bit executable x86_64",
      error: "",
    },
    machineArch: "arm64",
    platform: "darwin",
  });

  assert.equal(result.status, "warn");
  assert.match(result.detail, /gh runs/);
  assert.match(result.detail, /x86_64/);
  assert.match(result.remediation, /arm64 build of gh/);
});

test("credentialHelperBinary extracts absolute paths from shell helpers only", () => {
  assert.equal(
    credentialHelperBinary("!/usr/local/bin/gh auth git-credential"),
    "/usr/local/bin/gh",
  );
  assert.equal(credentialHelperBinary("osxkeychain"), "");
  assert.equal(credentialHelperBinary("!gh auth git-credential"), "");
  assert.equal(credentialHelperBinary(""), "");
});

test("Xcode license failures name the exact owner remediation", () => {
  assert.equal(
    remediationForCommandFailure(
      "You have not agreed to the Xcode license agreements.",
      "Install the tool.",
    ),
    "Run: sudo xcodebuild -license",
  );
  assert.equal(
    remediationForCommandFailure("missing", "Install the tool."),
    "Install the tool.",
  );
});

test("automation state preflight rejects permissive control directories", () => {
  const stateDir = path.join(
    mkdtempSync(path.join(os.tmpdir(), "freed-doctor-state-permissions-")),
    "automation",
  );
  const leasesDir = path.join(stateDir, "control", "leases");
  mkdirSync(leasesDir, { recursive: true, mode: 0o700 });
  chmodSync(stateDir, 0o755);
  chmodSync(path.join(stateDir, "control"), 0o755);
  chmodSync(leasesDir, 0o755);

  const result = checkAutomationStateDir(stateDir);

  assert.equal(result.status, "fail");
  assert.match(result.detail, /is not mode 0700/);
  assert.match(result.remediation, /^Run: chmod 700 /);
});

test("trusted publisher config fails closed without a valid host handoff", () => {
  const home = mkdtempSync(
    path.join(os.tmpdir(), "freed-doctor-publisher-missing-"),
  );
  const configPath = path.join(home, "missing.json");
  const missing = checkTrustedPublisherConfig({}, home, { configPath });
  assert.equal(missing.status, "warn");
  assert.match(missing.detail, /publishing stays closed/);

  const malformed = checkTrustedPublisherConfig(
    { FREED_TRUSTED_PUBLISHER: "scripts/trusted-publisher-host" },
    home,
    { configPath },
  );
  assert.equal(malformed.status, "warn");
  assert.match(malformed.detail, /not a canonical absolute path/);
  assert.match(malformed.detail, /trusted publisher config does not exist/);
});

test("trusted publisher config rejects an arbitrary user-owned executable", () => {
  const home = mkdtempSync(
    path.join(os.tmpdir(), "freed-doctor-publisher-insecure-"),
  );
  const { brokerPath, configPath } = writePublisherConfigFixture(home);
  const result = checkTrustedPublisherConfig(
    { FREED_TRUSTED_PUBLISHER: brokerPath },
    home,
    { configPath },
  );
  assert.equal(result.status, "warn");
  assert.match(
    result.detail,
    /not a root-owned physical regular file|non-root-owned directory/,
  );
  assert.match(
    result.detail,
    /signing identifier does not match|team identifier does not match|not a non-adhoc hardened runtime binary|supported only on macOS/,
  );
  assert.match(
    result.detail,
    /control checkout does not match its pinned commit/,
  );
  assert.match(result.detail, /publishing stays closed/);
});

test("trusted publisher config rejects fields the broker does not accept", () => {
  const home = mkdtempSync(
    path.join(os.tmpdir(), "freed-doctor-publisher-extra-key-"),
  );
  const { brokerPath, configPath } = writePublisherConfigFixture(home, {
    candidateOverride: "/tmp/not-allowed",
  });

  const result = checkTrustedPublisherConfig(
    { FREED_TRUSTED_PUBLISHER: brokerPath },
    home,
    { configPath },
  );
  assert.equal(result.status, "warn");
  assert.match(result.detail, /must contain exactly/);
});

test("formatReport renders statuses, remediation, and a summary line", () => {
  const report = formatReport({
    checks: [
      {
        id: "a",
        title: "pinned Node toolchain",
        status: "ok",
        detail: "v24.14.1.",
        remediation: "",
      },
      {
        id: "b",
        title: "GitHub CLI",
        status: "warn",
        detail:
          "gh exists but fails to run. Binary is x86_64 but this machine is arm64.",
        remediation: "Reinstall the arm64 build of gh (brew install gh).",
      },
      {
        id: "c",
        title: "git",
        status: "fail",
        detail: "git is unusable: boom",
        remediation: "Install git.",
      },
    ],
    failures: 1,
    warnings: 1,
  });

  assert.match(report, /\[ok\] pinned Node toolchain: v24\.14\.1\./);
  assert.match(
    report,
    /\[WARN\] GitHub CLI: .*x86_64 but this machine is arm64/,
  );
  assert.match(report, /remediation: Reinstall the arm64 build of gh/);
  assert.match(report, /\[FAIL\] git: git is unusable: boom/);
  assert.match(report, /Summary: 1 ok, 1 warning, 1 failure\./);
});

test("resolveExitCode is warn-only by default and hard-fails under --strict", () => {
  const failing = { checks: [], failures: 2, warnings: 1 };
  const clean = { checks: [], failures: 0, warnings: 3 };
  const publisherClosed = {
    checks: [{ id: "trusted-publisher", status: "warn" }],
    failures: 0,
    warnings: 1,
  };
  const publisherReady = {
    checks: [{ id: "trusted-publisher", status: "ok" }],
    failures: 0,
    warnings: 0,
  };
  assert.equal(resolveExitCode(failing), 0);
  assert.equal(resolveExitCode(failing, { strict: true }), 1);
  assert.equal(resolveExitCode(clean, { strict: true }), 0);
  assert.equal(resolveExitCode(publisherClosed, { requirePublisher: true }), 1);
  assert.equal(resolveExitCode(publisherReady, { requirePublisher: true }), 0);
});

test("runChecks returns every check id with a valid status", () => {
  const stateDir = path.join(
    mkdtempSync(path.join(os.tmpdir(), "freed-doctor-")),
    "state",
  );
  const result = runChecks({ stateDir });
  const ids = result.checks.map((item) => item.id);
  assert.deepEqual(ids, [
    "node-toolchain",
    "path-node",
    "gh",
    "git-credential-helper",
    "git",
    "curl",
    "python3",
    "automation-state-dir",
    "trusted-publisher",
  ]);
  for (const item of result.checks) {
    assert.ok(
      ["ok", "warn", "fail"].includes(item.status),
      `${item.id} has status ${item.status}`,
    );
    assert.ok(item.detail.length > 0);
  }
  assert.equal(
    result.failures,
    result.checks.filter((item) => item.status === "fail").length,
  );
});
