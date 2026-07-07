import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  classifyBinaryArch,
  credentialHelperBinary,
  formatReport,
  resolveExitCode,
  runChecks,
} from "./doctor.mjs";

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

test("credentialHelperBinary extracts absolute paths from shell helpers only", () => {
  assert.equal(
    credentialHelperBinary("!/usr/local/bin/gh auth git-credential"),
    "/usr/local/bin/gh",
  );
  assert.equal(credentialHelperBinary("osxkeychain"), "");
  assert.equal(credentialHelperBinary("!gh auth git-credential"), "");
  assert.equal(credentialHelperBinary(""), "");
});

test("formatReport renders statuses, remediation, and a summary line", () => {
  const report = formatReport({
    checks: [
      { id: "a", title: "pinned Node toolchain", status: "ok", detail: "v24.14.1.", remediation: "" },
      {
        id: "b",
        title: "GitHub CLI",
        status: "warn",
        detail: "gh exists but fails to run. Binary is x86_64 but this machine is arm64.",
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
  assert.match(report, /\[WARN\] GitHub CLI: .*x86_64 but this machine is arm64/);
  assert.match(report, /remediation: Reinstall the arm64 build of gh/);
  assert.match(report, /\[FAIL\] git: git is unusable: boom/);
  assert.match(report, /Summary: 1 ok, 1 warning, 1 failure\./);
});

test("resolveExitCode is warn-only by default and hard-fails under --strict", () => {
  const failing = { checks: [], failures: 2, warnings: 1 };
  const clean = { checks: [], failures: 0, warnings: 3 };
  assert.equal(resolveExitCode(failing), 0);
  assert.equal(resolveExitCode(failing, { strict: true }), 1);
  assert.equal(resolveExitCode(clean, { strict: true }), 0);
});

test("runChecks returns every check id with a valid status", () => {
  const stateDir = path.join(mkdtempSync(path.join(os.tmpdir(), "freed-doctor-")), "state");
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
  ]);
  for (const item of result.checks) {
    assert.ok(["ok", "warn", "fail"].includes(item.status), `${item.id} has status ${item.status}`);
    assert.ok(item.detail.length > 0);
  }
  assert.equal(
    result.failures,
    result.checks.filter((item) => item.status === "fail").length,
  );
});
